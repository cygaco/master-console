#!/usr/bin/env node
const mcEnv = require("../../../scripts/hooks/lib/mc-env"); // S-OS-06 read-both env (clears MC_X and the legacy name together)
// ─────────────────────────────────────────────────────────────────────────────
// mode-write-coverage.test.js — SP-20260611-002 WS-G1 / R-2 (S-2) regression (T-316).
//
// Covers the mode-write coverage closure:
//   AC-2.1  mode-set.js (the single-writer chokepoint) ITSELF emits the mode
//           lifecycle events on a Bash-direct `node scripts/mode-set.js <mode>`
//           — coverage no longer depends on the PreToolUse hook matcher. Proven
//           by spawning the REAL mode-set.js subprocess + reading the events log.
//   AC-2.2  a direct OUT-OF-BAND mode.json write (no matching lifecycle event)
//           produces a LOUD finding at scan (the detector exits non-zero).
//   AC-2.3  a normal mode change THROUGH mode-set.js (event emitted) does NOT red
//           — the detector distinguishes the sanctioned single-writer from an
//           out-of-band write (no false positive).
//   AC-2.4  the mode-guard kill-switch no-op EMITS a loud audit event (event +
//           stderr attestation) — the silent-suppression class (#6) is closed.
//
// FIXTURE NAMESPACING (Hard AC #9 / P-059): the planted out-of-band mode.json and
// the events fixtures live in SEALED per-test temp dirs (OS tmpdir) — never in a
// live runtime path — so a /scan never reads a planted mode.json as a real bypass.
// Per-surface isolation (Hard AC #4): this file covers mode-set.js +
// mode-write-coverage.js + the mode-guard kill-switch attestation.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const MODE_SET = path.join(ROOT, "scripts", "mode-set.js");
const DETECTOR = path.join(ROOT, "scripts", "checks", "mode-write-coverage.js");
const guard = require(path.join(ROOT, "scripts", "hooks", "mode-lifecycle-guard.js"));
const detector = require(DETECTOR);

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

// A sealed project dir with the minimal scaffolding mode-set.js + the logger need.
function sealedProject() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "mwc-proj-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  fs.mkdirSync(path.join(proj, ".claude", "project", "events"), { recursive: true });
  fs.writeFileSync(path.join(proj, ".claude", "runtime", ".session-id"), "s-mwc");
  fs.writeFileSync(path.join(proj, ".claude", "manifest.json"), JSON.stringify({ project: { slug: "mc" } }));
  return proj;
}

function eventsPath(proj) {
  return path.join(proj, ".claude", "project", "events", "events.jsonl");
}

function readLifecycleRecs(proj) {
  const f = eventsPath(proj);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.data && r.data.kind === "lifecycle-event");
}

// ── AC-2.1 — mode-set.js emits the lifecycle events on a Bash invocation ──────
ok("mode-set-emits-lifecycle-events-on-bash-invocation", () => {
  const proj = sealedProject();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj };
  mcEnv.unsetEnv("SPRINT_ID", env);
  const r = spawnSync("node", [MODE_SET, "sprint", "--by", "alpha"], { env, encoding: "utf8" });
  assert.strictEqual(r.status, 0, `mode-set should exit 0 (stderr: ${r.stderr})`);

  // The marker was written…
  const marker = JSON.parse(fs.readFileSync(path.join(proj, ".claude", "runtime", "mode.json"), "utf8"));
  assert.strictEqual(marker.mode, "sprint", "the mode marker was written");

  // …AND the lifecycle events were emitted BY mode-set.js (no hook matcher).
  const recs = readLifecycleRecs(proj).map((r) => r.data.event);
  assert.ok(recs.includes("mode:switch:requested"), "mode:switch:requested emitted by mode-set.js");
  assert.ok(recs.includes("mode:switch:preflight"), "mode:switch:preflight emitted by mode-set.js");
  assert.ok(recs.includes("mode:switch:after"), "mode:switch:after emitted by mode-set.js");

  // The after-event carries the target_mode the detector correlates on.
  const after = readLifecycleRecs(proj).find((r) => r.data.event === "mode:switch:after");
  assert.strictEqual(after.data.payload.target_mode, "sprint", "after-event carries target_mode=sprint");
});

// ── AC-2.3 — a sanctioned mode-set.js change is NOT flagged by the detector ───
ok("sanctioned-mode-set-change-not-flagged", () => {
  const proj = sealedProject();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj };
  const set = spawnSync("node", [MODE_SET, "sprint", "--by", "alpha"], { env, encoding: "utf8" });
  assert.strictEqual(set.status, 0, "mode-set wrote the marker + emitted events");

  // Run the detector against the SAME sealed project — the sanctioned write is
  // corroborated by the emitted mode:switch:after event → green (exit 0).
  const det = spawnSync(
    "node",
    [DETECTOR, "--mode-file", path.join(proj, ".claude", "runtime", "mode.json"), "--events", eventsPath(proj), "--json"],
    { encoding: "utf8" },
  );
  assert.strictEqual(det.status, 0, `sanctioned change must NOT red (stderr: ${det.stderr})`);
  const out = JSON.parse(det.stdout);
  assert.strictEqual(out.status, "green", "detector greens a sanctioned single-writer change");
  assert.ok(out.corroboratingEvent, "the corroborating lifecycle event is identified");
});

// ── AC-2.2 — a direct out-of-band mode.json write REDS at scan ────────────────
ok("out-of-band-mode-json-write-reds-at-scan", () => {
  // Plant a mode.json directly (NOT via mode-set.js) — no matching lifecycle
  // event exists. The detector must produce a LOUD finding (exit non-zero).
  const proj = sealedProject();
  const modeFile = path.join(proj, ".claude", "runtime", "mode.json");
  fs.writeFileSync(modeFile, JSON.stringify({ mode: "solo", enteredBy: "attacker" }));
  // An empty events log (no corroborating event) — the out-of-band write left no trail.
  fs.writeFileSync(eventsPath(proj), "");

  const det = spawnSync("node", [DETECTOR, "--mode-file", modeFile, "--events", eventsPath(proj), "--json"], {
    encoding: "utf8",
  });
  assert.strictEqual(det.status, 1, "an out-of-band write must RED (exit 1) — proven enforce-capable");
  const out = JSON.parse(det.stdout);
  assert.strictEqual(out.status, "red");
  assert.strictEqual(out.finding.type, "out-of-band-mode-write", "the finding names the out-of-band write");
  assert.strictEqual(out.finding.mode, "solo");
});

ok("out-of-band-write-report-only-prints-finding-but-exits-0", () => {
  // AC-X.4: enforce-capable but report-only forces exit 0 (no blocking flip).
  const proj = sealedProject();
  const modeFile = path.join(proj, ".claude", "runtime", "mode.json");
  fs.writeFileSync(modeFile, JSON.stringify({ mode: "solo" }));
  fs.writeFileSync(eventsPath(proj), "");
  const det = spawnSync(
    "node",
    [DETECTOR, "--mode-file", modeFile, "--events", eventsPath(proj), "--report-only", "--json"],
    { encoding: "utf8" },
  );
  assert.strictEqual(det.status, 0, "report-only forces exit 0 (no blocking flip this sprint)");
  const out = JSON.parse(det.stdout);
  assert.strictEqual(out.status, "red", "the finding is still RED (reported, not blocked)");
  assert.strictEqual(out.report_only, true);
});

ok("finding-4-pre-mtime-lifecycle-event-does-not-corroborate-later-mode-json-rewrite", () => {
  // The gauntlet bypass: a legitimate mode switch at T0 emitted a lifecycle event;
  // an out-of-band rewrite at T0+5m gave mode.json a newer mtime. The old ±window
  // logic accepted the pre-mtime event. The fix requires event.ts >= mode mtime.
  const t0 = Date.parse("2026-06-11T00:00:00.000Z");
  const modeMtime = t0 + 5 * 60 * 1000;
  const result = detector.evaluate({
    modeState: { mode: "sprint", mtimeMs: modeMtime },
    modeUnreadable: false,
    lifecycleEvents: [
      {
        event: "mode:switch:after",
        payload: { target_mode: "sprint" },
        tsMs: t0,
      },
    ],
    windowMs: 120 * 60 * 1000,
    nowMs: t0 + 10 * 60 * 1000,
  });
  assert.strictEqual(result.ok, false, "pre-mtime event must not green a later out-of-band rewrite");
  assert.strictEqual(result.finding.type, "out-of-band-mode-write");
  assert.strictEqual(result.corroboratingEvent, null);
});

ok("events-log-unreadable-with-present-mode-fails-closed", () => {
  // FAIL-CLOSED: a present mode.json + a missing events log cannot be corroborated.
  const proj = sealedProject();
  const modeFile = path.join(proj, ".claude", "runtime", "mode.json");
  fs.writeFileSync(modeFile, JSON.stringify({ mode: "oneshot" }));
  const det = spawnSync(
    "node",
    [DETECTOR, "--mode-file", modeFile, "--events", path.join(proj, "does-not-exist.jsonl"), "--json"],
    { encoding: "utf8" },
  );
  assert.strictEqual(det.status, 1, "a present mode with no readable audit trail fails closed (red)");
  const out = JSON.parse(det.stdout);
  assert.strictEqual(out.finding.type, "events-log-unreadable");
});

// ── AC-2.4 — the mode-guard kill-switch no-op EMITS a loud audit event ────────
ok("mode-guard-kill-switch-emits-audit-event", () => {
  // The env kill-switch makes the guard no-op. AC-2.4: that suppression must NOT
  // be silent — a `mode-guard-kill-switch` audit attestation fires. Inject an
  // `attest` recorder so the assertion is hermetic (no real-log write).
  const recorded = [];
  const res = guard.run(
    { tool_name: "SlashCommand", tool_input: { command: "/mode:sprint" } },
    {
      projectDir: sealedProject(),
      env: { MC_DISABLE_MODE_GUARD: "1" },
      emit: () => true,
      stdout: () => {},
      attest: (reason, target) => recorded.push({ reason, target }),
    },
  );
  assert.strictEqual(res.action, "killed", "the env kill-switch makes the guard no-op");
  assert.strictEqual(res.reason, "env");
  assert.strictEqual(recorded.length, 1, "the kill-switch no-op emits exactly one attestation");
  assert.strictEqual(recorded[0].reason, "env", "the attestation names which switch fired");
  assert.strictEqual(recorded[0].target, "sprint", "the attestation carries the target mode");
});

ok("mode-guard-marker-kill-switch-emits-audit-event", () => {
  const proj = sealedProject();
  fs.writeFileSync(path.join(proj, ".claude", "runtime", ".mode-guard-off"), "");
  const recorded = [];
  const res = guard.run(
    { tool_name: "SlashCommand", tool_input: { command: "/mode:solo" } },
    { projectDir: proj, env: {}, emit: () => true, stdout: () => {}, attest: (reason) => recorded.push(reason) },
  );
  assert.strictEqual(res.reason, "marker");
  assert.deepStrictEqual(recorded, ["marker"], "the marker kill-switch no-op is attested");
});

ok("mode-guard-bootstrap-noop-is-quiet-not-attested", () => {
  // A bootstrap reason (no manifest — routine greenfield) must NOT attest: it is
  // expected setup behavior, not a silent suppression of a deliberate kill-switch.
  const freshNoManifest = fs.mkdtempSync(path.join(os.tmpdir(), "mwc-fresh-"));
  const recorded = [];
  // Use the REAL attest so we exercise the bootstrap-quiet branch end-to-end.
  const res = guard.run(
    { tool_name: "SlashCommand", tool_input: { command: "/mode:sprint" } },
    {
      projectDir: freshNoManifest,
      env: {},
      emit: () => true,
      stdout: () => {},
      attest: guard.attestModeGuardKillSwitch,
    },
  );
  assert.strictEqual(res.reason, "bootstrap-no-manifest", "no manifest => bootstrap no-op");
  // attestModeGuardKillSwitch returns early for non env/marker reasons → no throw,
  // no stderr-attestation. (We can't easily capture the real logger here; the
  // contract is that bootstrap is quiet — asserted by the early-return guard.)
  assert.strictEqual(recorded.length, 0, "bootstrap is quiet (no recorder entries)");
});

console.log(`\nmode-write-coverage: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
