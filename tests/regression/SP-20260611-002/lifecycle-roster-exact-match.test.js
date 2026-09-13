#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// lifecycle-roster-exact-match.test.js — SP-20260611-002 WS-G1 / R-1 AC-1.5 (T-316).
//
// The lifecycle MANAGER's verify() liveness check used a SUBSTRING match
// (`blob = JSON.stringify(members).toLowerCase(); faces.every(f => blob.includes(f))`).
// That let a member named/typed to merely CONTAIN a face token — `epsilon-helper`,
// or ANY field whose JSON contains `beta` — false-satisfy that face. verify() is
// the surrogate the SessionEnd/resume paths + /scan rely on, so the substring
// spoof is a live readiness bypass.
//
// This asserts the OLD ATTACK NOW FAILS CLOSED: an exact per-member identity match
// (agentType/role/name === face or its symbol) — the same `===` posture as
// team-guard's isConductor. Per-surface isolation (Hard AC #4): this file covers
// ONLY scripts/teams/lifecycle.js.
//
// The exploit fixtures are SYNTHETIC in-memory rosters passed to the exported
// membersCoverFaces() — nothing is written to ~/.claude/teams (which holds other
// projects' live teams). The end-to-end verify() path is exercised with an
// injected teamsRoot temp dir (the lifecycle manager's own test-injection seam).
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const lifecycle = require(path.join(ROOT, "scripts", "teams", "lifecycle.js"));

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

// ── AC-1.5 (unit) — substring spoof must NOT false-satisfy a face ────────────
ok("substring-member-name-does-not-false-satisfy-face", () => {
  // A roster whose only "epsilon-ish" member is a SUBSTRING spoof. The required
  // faces are the sprint roster. The old blob.includes("epsilon") matched
  // "epsilon-helper"; the exact match must NOT.
  const spoofRoster = [
    { name: "epsilon-helper", agentType: "general-purpose" },
    { name: "betamax-bot", agentType: "general-purpose" }, // contains "beta"
    { name: "alphanumeric", agentType: "general-purpose" }, // contains "alpha"
  ];
  assert.strictEqual(
    lifecycle.membersCoverFaces(spoofRoster, ["epsilon", "beta"]),
    false,
    "a substring-containment roster must NOT cover the faces",
  );
});

ok("field-containing-face-token-does-not-false-satisfy", () => {
  // ANY field whose JSON merely CONTAINS a face token must not satisfy it.
  const roster = [
    { name: "worker-1", agentType: "general-purpose", role: "epsilon-shadow" },
    { name: "worker-2", agentType: "beta-tester-bot" },
  ];
  assert.strictEqual(
    lifecycle.membersCoverFaces(roster, ["epsilon", "beta"]),
    false,
    "a role/type field that merely contains a face token must not satisfy the face",
  );
});

// ── AC-1.5 (happy path) — an EXACT roster still satisfies (no regression) ─────
ok("exact-face-roster-still-satisfies", () => {
  const roster = [
    { name: "epsilon", agentType: "epsilon" },
    { name: "beta", agentType: "beta" },
  ];
  assert.strictEqual(
    lifecycle.membersCoverFaces(roster, ["epsilon", "beta"]),
    true,
    "a roster with exact face identities still covers the faces",
  );
});

ok("face-symbol-also-satisfies", () => {
  // A member identified by the face SYMBOL (ε/β) — a config may carry either —
  // still satisfies the face by exact match.
  const roster = [
    { name: "ε", agentType: "ε" },
    { name: "β", role: "β" },
  ];
  assert.strictEqual(
    lifecycle.membersCoverFaces(roster, ["epsilon", "beta"]),
    true,
    "a member identified by the exact face symbol satisfies the face",
  );
});

ok("partial-roster-missing-a-face-is-not-live", () => {
  const roster = [{ name: "epsilon", agentType: "epsilon" }];
  assert.strictEqual(
    lifecycle.membersCoverFaces(roster, ["epsilon", "beta"]),
    false,
    "a roster missing a required face is not covered (the gate must not pass it)",
  );
});

// ── AC-1.5 (end-to-end) — verify() over an injected teamsRoot rejects the spoof ─
ok("verify-end-to-end-rejects-substring-spoof-team", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lc-em-"));
  const teamsRoot = path.join(home, "teams");
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "lc-proj-"));
  // The team belongs to this project (slug "mc") + mode "sprint" but its
  // roster is a SUBSTRING spoof — verify() must report NOT live.
  const cfgDir = path.join(teamsRoot, "mc-sprint");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({
      name: "mc-sprint",
      members: [
        { name: "epsilon-helper", agentType: "general-purpose" },
        { name: "builder", agentType: "general-purpose" },
      ],
    }),
  );
  const v = lifecycle.verify({ teamsRoot, slug: "mc", mode: "sprint", projectDir: proj });
  assert.strictEqual(v.live, false, "a substring-spoof roster must read NOT live end-to-end");
});

ok("verify-end-to-end-accepts-exact-roster-team", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lc-em-"));
  const teamsRoot = path.join(home, "teams");
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "lc-proj-"));
  const cfgDir = path.join(teamsRoot, "mc-sprint");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({
      name: "mc-sprint",
      members: [
        { name: "epsilon", agentType: "epsilon" },
        { name: "beta", agentType: "beta" },
      ],
    }),
  );
  const v = lifecycle.verify({ teamsRoot, slug: "mc", mode: "sprint", projectDir: proj });
  assert.strictEqual(v.live, true, "an exact-roster ε+β team reads live end-to-end (no regression)");
});

console.log(`\nlifecycle-roster-exact-match: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
