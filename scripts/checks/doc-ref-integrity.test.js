#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// doc-ref-integrity.test.js — P5 planted-violation test for the S-13b
// doc-reference-integrity enforcer (E-SYSTEM-ORG-001).
//
// Two layers:
//   • PURE evaluate(): a synthetic BROKEN ref MUST flag; resolvable + allowlisted
//     (literal + prefix) refs MUST NOT — proves the flag/allow core with no disk.
//   • extractRefs(): markdown links + anchored backtick path-refs are extracted;
//     external/anchor/placeholder targets are NOT; the `<!-- doc-ref-ignore -->`
//     line escape works; a placeholder like `scripts/<name>.js` is not a ref.
//   • LIVE run(): the real canon scan returns ok:true (no broken ref ships) — and
//     a temp doc with a planted dead link, scanned via a sealed CLAUDE_PROJECT_DIR,
//     is caught by the real disk path end-to-end.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CHECK = path.join(__dirname, "doc-ref-integrity.js");
const mod = require("./doc-ref-integrity.js");

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

// ── PURE evaluate() ──────────────────────────────────────────────────────────
ok("PLANTED: a broken ref flags (high-severity finding)", () => {
  const { findings } = mod.evaluate({
    refs: [{ file: "CLAUDE.md", line: 7, target: "scripts/checks/dispatch-contract.js", exists: false }],
    allowlist: { pathPrefixes: [], literals: [] },
  });
  assert.strictEqual(findings.length, 1, "exactly one finding");
  assert.strictEqual(findings[0].kind, "broken-doc-ref");
  assert.ok(/dispatch-contract\.js/.test(findings[0].message));
});

ok("a resolvable ref does NOT flag", () => {
  const { findings } = mod.evaluate({
    refs: [{ file: "AGENTS.md", line: 1, target: ".claude/agents/_system/agent-system.md", exists: true }],
    allowlist: { pathPrefixes: [], literals: [] },
  });
  assert.strictEqual(findings.length, 0);
});

ok("literal-allowlisted absent ref does NOT flag", () => {
  const { findings, allowed } = mod.evaluate({
    refs: [{ file: "X.md", line: 1, target: "design/placeholder.md", exists: false }],
    allowlist: { pathPrefixes: [], literals: ["design/placeholder.md"] },
  });
  assert.strictEqual(findings.length, 0);
  assert.strictEqual(allowed[0].allowedBy, "literal-allowlist");
});

ok("prefix-allowlisted absent ref does NOT flag", () => {
  const { findings, allowed } = mod.evaluate({
    refs: [{ file: "X.md", line: 1, target: "runtime/notes/scratch.md", exists: false }],
    allowlist: { pathPrefixes: ["runtime/"], literals: [] },
  });
  assert.strictEqual(findings.length, 0);
  assert.ok(/prefix-allowlist/.test(allowed[0].allowedBy));
});

// ── extractRefs() ──────────────────────────────────────────────────────────
ok("extracts a markdown link target", () => {
  const refs = mod.extractRefs("AGENTS.md", "see [spec](.claude/agents/_system/agent-system.md) for more");
  assert.ok(refs.some((r) => r.target === ".claude/agents/_system/agent-system.md"));
});

ok("extracts an anchored backtick path-ref (even with a trailing arg)", () => {
  const refs = mod.extractRefs("CLAUDE.md", "Enforcer: `scripts/checks/dispatch-contract.js validate`.");
  assert.ok(refs.some((r) => r.target === "scripts/checks/dispatch-contract.js"));
});

ok("does NOT extract external/anchor/site-absolute targets", () => {
  const refs = mod.extractRefs(
    "X.md",
    "[a](https://x.com) [b](#section) [c](mailto:x@y.z) [d](/abs/site)",
  );
  assert.strictEqual(refs.length, 0, `expected 0 refs, got ${JSON.stringify(refs)}`);
});

ok("does NOT extract a <placeholder> path (templates don't false-fire)", () => {
  const refs = mod.extractRefs("X.md", "run `scripts/<name>.js` for a one-off");
  assert.strictEqual(refs.length, 0);
});

ok("a `<!-- doc-ref-ignore -->` line is skipped entirely", () => {
  const refs = mod.extractRefs("X.md", "see [gone](scripts/dead/file.js) <!-- doc-ref-ignore -->");
  assert.strictEqual(refs.length, 0);
});

ok("isExternalOrAnchor classifies correctly", () => {
  assert.ok(mod.isExternalOrAnchor("https://x"));
  assert.ok(mod.isExternalOrAnchor("#frag"));
  assert.ok(mod.isExternalOrAnchor("/abs"));
  assert.ok(mod.isExternalOrAnchor("<x>"));
  assert.ok(mod.isExternalOrAnchor("scripts/foo.js"), "foo.* is a conventional placeholder");
  assert.ok(mod.isExternalOrAnchor("path/to/file.md"), "path/to/ is a conventional placeholder");
  assert.ok(!mod.isExternalOrAnchor("scripts/checks/dispatch-contract.js"), "a real path is not external");
});

ok("backtick foo.* placeholder is NOT extracted (filter applies to backticks too)", () => {
  const refs = mod.extractRefs("X.md", "create `scripts/hooks/foo.js` as a template");
  assert.strictEqual(refs.length, 0);
});

ok("`<!-- doc-ref-ignore: reason -->` (with a reason) also skips the line", () => {
  const refs = mod.extractRefs("X.md", "old [x](scripts/dead/gone.js) <!-- doc-ref-ignore: historical -->");
  assert.strictEqual(refs.length, 0);
});

// ── PER-MACHINE class: canon docs legitimately cite gitignored / per-machine files
// (raw /beta:mine output, private _planning/ingest material, the operator's
// .claude/settings.local.json layer). A fresh clone (CI, a new worktree) never has
// them, so the SHIPPED allowlist must classify such a ref as allowed-absent — asserted
// synthetically (exists:false) so it holds regardless of what THIS machine has on disk. ──
ok("PER-MACHINE: refs to gitignored/per-machine targets are allowed-absent under the shipped allowlist", () => {
  const allowlist = mod.loadAllowlist();
  const refs = [
    { file: ".claude/agents/president/beta.md", line: 1, target: ".claude/agents/president/_system/beta/mined/beta-source-data.md", exists: false },
    { file: "trackers/epics/E-X.md", line: 1, target: "../../_planning/ingest/mc-lifecycle.md", exists: false },
    { file: ".claude/commands/permissions/authorized.md", line: 1, target: ".claude/settings.local.json", exists: false },
  ];
  const { findings, allowed } = mod.evaluate({ refs, allowlist });
  assert.strictEqual(findings.length, 0, `per-machine targets must not be broken refs: ${JSON.stringify(findings.map((f) => f.target))}`);
  assert.strictEqual(allowed.length, refs.length, "every per-machine ref is accounted for as allowed-absent");
  // The shipped .gitignore agrees these are per-machine (the allowlist is not free-floating).
  const gitignore = fs.readFileSync(path.join(__dirname, "..", "..", ".gitignore"), "utf8");
  assert.ok(/^\.claude\/agents\/president\/_system\/beta\/mined\/$/m.test(gitignore), ".gitignore lists beta/mined/");
  assert.ok(/^_planning\/ingest\/$/m.test(gitignore), ".gitignore lists _planning/ingest/");
});

// ── PER-MACHINE (untracked private plan, T5-E2d): the E-LIFECYCLE-001 plan is cited under a root spelling
// (ROADMAP.md) AND a dir-relative spelling (the epic). One literal must cover both — literals match the citing
// file's resolution exactly like prefixes do. ──
ok("PER-MACHINE: the untracked lifecycle plan is allowed-absent under its root AND dir-relative spellings", () => {
  const allowlist = mod.loadAllowlist();
  const refs = [
    { file: "ROADMAP.md", line: 1, target: "_planning/mc-lifecycle-plan.md", exists: false },
    { file: "trackers/epics/E-LIFECYCLE-001-mode-lifecycle-enforcement.md", line: 1, target: "../../_planning/mc-lifecycle-plan.md", exists: false },
  ];
  const { findings, allowed } = mod.evaluate({ refs, allowlist });
  assert.strictEqual(findings.length, 0, `both spellings must be allowed-absent: ${JSON.stringify(findings.map((f) => f.target))}`);
  assert.ok(allowed.every((a) => a.allowedBy === "literal-allowlist"), "allowed by the literal, not by accident");
  // A dir-relative spelling that resolves ELSEWHERE is not the literal.
  const stray = mod.evaluate({
    refs: [{ file: "trackers/epics/E-X.md", line: 1, target: "../_planning/mc-lifecycle-plan.md", exists: false }],
    allowlist,
  });
  assert.strictEqual(stray.findings.length, 1, "a spelling resolving to trackers/_planning/... is still a broken ref");
});

// ── LIVE run() against the REAL canon ─────────────────────────────────────────
ok("LIVE: the real canon scan ships zero broken refs (run() ok:true)", () => {
  const res = mod.run();
  assert.strictEqual(res.fatal, false, "must not be fatal");
  if (!res.ok) {
    const sample = res.findings.slice(0, 8).map((f) => `${f.file}:${f.line} → ${f.target}`).join("\n      ");
    assert.fail(`canon has ${res.findings.length} broken ref(s):\n      ${sample}`);
  }
  assert.strictEqual(res.ok, true);
});

// ── LIVE end-to-end: a planted dead link in a sealed repo is caught on disk ───
ok("LIVE-PLANTED: a dead markdown link in a sealed repo is caught end-to-end", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "dri-proj-"));
  // Minimal real file so a VALID ref also exists (proves we don't just flag all).
  fs.mkdirSync(path.join(proj, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(proj, "scripts", "real.js"), "// real\n");
  fs.writeFileSync(
    path.join(proj, "CLAUDE.md"),
    "valid: [r](scripts/real.js)\nbroken: [d](scripts/checks/moved-away.js)\n",
  );
  const r = spawnSync("node", [CHECK, "--json"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
    encoding: "utf8",
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.ok, false, "should report a broken ref");
  assert.strictEqual(out.fatal, false);
  assert.ok(
    out.findings.some((f) => f.target === "scripts/checks/moved-away.js"),
    "the dead link must be the finding",
  );
  assert.ok(
    !out.findings.some((f) => f.target === "scripts/real.js"),
    "the valid ref must NOT be flagged",
  );
  // report-only: exit 0 even with a finding.
  assert.strictEqual(r.status, 0, "report-only exits 0");
  // --enforce flips it to exit 1.
  const r2 = spawnSync("node", [CHECK, "--enforce"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
    encoding: "utf8",
  });
  assert.strictEqual(r2.status, 1, "--enforce blocks on a broken ref");
});

console.log(`\ndoc-ref-integrity: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
