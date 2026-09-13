#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// mode-lifecycle-guard.test.js — S-LC-03 / REAL PreToolUse guard #1.
//
// Asserts the four contract invariants of scripts/hooks/mode-lifecycle-guard.js:
//   1. A `/mode:<x>` PreToolUse payload emits mode:switch:requested THEN
//      mode:switch:preflight, each with a well-formed labels-only payload; a
//      non-/mode Skill is a pass-through no-op (no events).
//   2. FAIL-OPEN — a malformed registry / malformed team-config never throws and
//      never blocks (guard returns allow; decision is null).
//   3. KILL-SWITCH — env + marker (+ bootstrap) => the guard no-ops (no events).
//   4. REPORT-ONLY — the guard NEVER returns a `decision:"block"` and never
//      writes a block decision to stdout.
//
// Strategy mirrors the S-LC-02 lifecycle-events test: monkeypatch the canonical
// logger.log() to a TEMP events sink so the REAL emit path (lifecycle-events.js)
// is exercised end-to-end without touching the real events log. The real
// .claude/agents/_org/mode-lifecycle-hooks.json registry is read, never mutated.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const logger = require(path.join(ROOT, "scripts", "hooks", "lib", "logger.js"));
const lifecycle = require(path.join(ROOT, "scripts", "hooks", "lib", "lifecycle-events.js"));
const guard = require(path.join(ROOT, "scripts", "hooks", "mode-lifecycle-guard.js"));

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

// ── TEMP events sink (real emit path, no real-log writes) ────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-guard-"));
const SINK = path.join(tmpDir, "events.jsonl");
const origLog = logger.log;
function installSink() {
  logger.log = (cat, data, opts) => {
    const env = { cat, ts: new Date().toISOString(), actor: (opts && opts.actor) || "system", data };
    fs.appendFileSync(SINK, JSON.stringify(env) + "\n", "utf8");
  };
}
function restoreLog() {
  logger.log = origLog;
}
function readSink() {
  if (!fs.existsSync(SINK)) return [];
  return fs.readFileSync(SINK, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}
function lifecycleRecs() {
  return readSink().filter((e) => e.cat === "lifecycle" && e.data && e.data.kind === "lifecycle-event");
}
function truncateSink() {
  fs.writeFileSync(SINK, "", "utf8");
}

// A captured-stdout helper so we can assert what (if anything) the guard writes.
function capture() {
  const lines = [];
  return { fn: (s) => lines.push(String(s)), lines };
}

// Common injected context — keeps the test hermetic (no live team/git reads).
function baseOpts(extra) {
  return Object.assign(
    {
      projectDir: tmpDir,
      cwd: tmpDir,
      env: {}, // empty env => no kill-switch
      slug: "mc",
      prevMode: "adhoc",
      sessionId: "sess-test-1",
      activeTeam: null, // injected => no live ~/.claude/teams read
      homeDir: tmpDir,
    },
    extra || {},
  );
}

installSink();

// Ensure the bootstrap "no manifest" allow-list never fires in the emit tests:
// create a manifest stub in the temp projectDir.
fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
fs.writeFileSync(path.join(tmpDir, ".claude", "manifest.json"), JSON.stringify({ project: { slug: "mc" } }));

// ── 1a. /mode:sprint emits BOTH events in order, labels-only ─────────────────
ok("mode-sprint-emits-requested-then-preflight", () => {
  truncateSink();
  const cap = capture();
  const event = { tool_name: "SlashCommand", tool_input: { command: "/mode:sprint" } };
  const res = guard.run(event, baseOpts({ stdout: cap.fn, emit: lifecycle.emit, activeTeam: "mc-adhoc" }));

  assert.strictEqual(res.action, "emitted", "a /mode:* call is acted on");
  assert.strictEqual(res.decision, null, "REPORT-ONLY: decision is null");
  assert.deepStrictEqual(res.events, ["mode:switch:requested", "mode:switch:preflight"], "both events emitted IN ORDER");

  const recs = lifecycleRecs();
  assert.strictEqual(recs.length, 2, "exactly two lifecycle-event records appended");
  assert.strictEqual(recs[0].data.event, "mode:switch:requested", "first record is requested");
  assert.strictEqual(recs[1].data.event, "mode:switch:preflight", "second record is preflight");

  // requested payload — labels only, declared fields preserved
  const r = recs[0].data.payload;
  assert.strictEqual(r.prev_mode, "adhoc");
  assert.strictEqual(r.target_mode, "sprint");
  assert.strictEqual(r.project_slug, "mc");
  assert.ok(r.correlation_id, "carries a correlation id");

  // preflight payload — team detection + shared correlation id + dry_run backstop
  const p = recs[1].data.payload;
  assert.strictEqual(p.target_mode, "sprint");
  assert.strictEqual(p.existing_team_id, "mc-adhoc", "active team detected");
  assert.strictEqual(p.required_team_id, "mc-sprint", "target team derived from slug+mode");
  assert.strictEqual(p.dry_run, true, "backstop preflight is a dry_run this sprint");
  assert.strictEqual(p.correlation_id, r.correlation_id, "requested+preflight share one correlation id");
  assert.ok(["on", "off", "scoped"].includes(p.turbo_perms_state), "turbo is a status label");

  // the advisory written to stdout is NON-blocking (never a decision:block)
  assert.strictEqual(cap.lines.length, 1, "one advisory written");
  const adv = JSON.parse(cap.lines[0]);
  assert.ok(adv.hookSpecificOutput && adv.hookSpecificOutput.additionalContext, "advisory uses additionalContext");
  assert.ok(!("decision" in adv), "advisory carries NO decision field");
});

// ── 1b. Skill-tool shape (mode:sprint without leading slash) also fires ───────
ok("mode-skill-shape-fires", () => {
  truncateSink();
  const cap = capture();
  const event = { tool_name: "Skill", tool_input: { skill: "mode:oneshot" } };
  const res = guard.run(event, baseOpts({ stdout: cap.fn, emit: lifecycle.emit, prevMode: "sprint" }));
  assert.strictEqual(res.action, "emitted");
  assert.strictEqual(res.target, "oneshot");
  const recs = lifecycleRecs();
  assert.strictEqual(recs.length, 2);
  assert.strictEqual(recs[1].data.payload.required_team_id, null, "oneshot requires no persistent team");
});

// ── 1c. A non-/mode Skill is a pass-through no-op (no events, no stdout) ──────
ok("non-mode-skill-is-noop", () => {
  truncateSink();
  const cap = capture();
  const recorder = [];
  const res = guard.run(
    { tool_name: "Skill", tool_input: { skill: "scan:full" } },
    baseOpts({ stdout: cap.fn, emit: (e, p) => { recorder.push(e); return true; } }),
  );
  assert.strictEqual(res.action, "noop", "non-/mode tool is a no-op");
  assert.strictEqual(res.decision, null);
  assert.strictEqual(recorder.length, 0, "no events emitted for a non-/mode tool");
  assert.strictEqual(cap.lines.length, 0, "no advisory written for a non-/mode tool");
  assert.strictEqual(lifecycleRecs().length, 0, "no lifecycle records for a non-/mode tool");
});

// ── 1d. A plain SlashCommand that isn't /mode is a no-op ──────────────────────
ok("non-mode-slashcommand-is-noop", () => {
  const recorder = [];
  const res = guard.run(
    { tool_name: "SlashCommand", tool_input: { command: "/sprint:full" } },
    baseOpts({ emit: (e) => { recorder.push(e); return true; } }),
  );
  assert.strictEqual(res.action, "noop");
  assert.strictEqual(recorder.length, 0);
});

// ── 2a. FAIL-OPEN: emit() throwing never throws out of the guard ──────────────
ok("fail-open-emit-throws", () => {
  let threw = false;
  let res;
  try {
    res = guard.run(
      { tool_name: "SlashCommand", tool_input: { command: "/mode:sprint" } },
      baseOpts({ emit: () => { throw new Error("simulated emitter failure"); } }),
    );
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, false, "guard must NOT throw even if emit throws");
  assert.strictEqual(res.action, "emitted", "guard still completes (degraded)");
  assert.strictEqual(res.decision, null, "still report-only / never blocks");
  assert.deepStrictEqual(res.events, [], "no events recorded when the emitter fails");
});

// ── 2b. FAIL-OPEN: malformed registry => the REAL emit path catches it, returns
//        false, never throws, never blocks. Drive the internal loadRegistry to
//        parse garbage by intercepting fs.readFileSync for the registry file
//        only (the real registry file is NEVER mutated). ────────────────────
ok("fail-open-malformed-registry", () => {
  truncateSink();
  const realRead = fs.readFileSync;
  lifecycle._clearCache(); // force a fresh read through our interceptor
  fs.readFileSync = function (p, ...rest) {
    if (String(p).endsWith("mode-lifecycle-hooks.json")) return "{ this is : not json ]";
    return realRead.call(fs, p, ...rest);
  };
  let threw = false;
  let res;
  try {
    res = guard.run(
      { tool_name: "SlashCommand", tool_input: { command: "/mode:sprint" } },
      baseOpts({ emit: lifecycle.emit }),
    );
  } catch {
    threw = true;
  } finally {
    fs.readFileSync = realRead;
    lifecycle._clearCache();
  }
  assert.strictEqual(threw, false, "a malformed registry must never throw out of the guard");
  assert.strictEqual(res.decision, null, "still never blocks on a malformed registry");
  assert.strictEqual(res.action, "emitted");
  assert.deepStrictEqual(res.events, [], "emit returns false for every event on a broken registry");
  assert.strictEqual(lifecycleRecs().length, 0, "no lifecycle-event records emitted from a broken registry");
});

// ── 2c. FAIL-OPEN: malformed team-config never throws; team reads as absent ───
ok("fail-open-malformed-team-config", () => {
  // Build a fake ~/.claude/teams with one malformed config + one valid-but-other-project.
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "lc-guard-home-"));
  const teamsRoot = path.join(fakeHome, ".claude", "teams");
  fs.mkdirSync(path.join(teamsRoot, "mc-sprint"), { recursive: true });
  fs.writeFileSync(path.join(teamsRoot, "mc-sprint", "config.json"), "{ broken json ]]]");
  fs.mkdirSync(path.join(teamsRoot, "other-proj-sprint"), { recursive: true });
  fs.writeFileSync(
    path.join(teamsRoot, "other-proj-sprint", "config.json"),
    JSON.stringify({ name: "other-proj-sprint", members: [{ cwd: "C:/some/other/proj" }] }),
  );

  let threw = false;
  let teamId;
  try {
    teamId = guard.findActiveTeamForProject("mc", "C:/Users/x/MC", fakeHome);
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, false, "malformed team-config must never throw");
  assert.strictEqual(teamId, null, "malformed/other-project teams resolve to no active team");

  // And the full guard run survives a malformed team-config (live read path).
  const res = guard.run(
    { tool_name: "SlashCommand", tool_input: { command: "/mode:sprint" } },
    baseOpts({ emit: () => false, activeTeam: undefined, homeDir: fakeHome, slug: "mc" }),
  );
  assert.strictEqual(res.decision, null, "guard never blocks on a malformed team-config");
});

// ── 3a. KILL-SWITCH via env ───────────────────────────────────────────────────
ok("kill-switch-env", () => {
  const recorder = [];
  const cap = capture();
  const res = guard.run(
    { tool_name: "SlashCommand", tool_input: { command: "/mode:sprint" } },
    baseOpts({ env: { MC_DISABLE_MODE_GUARD: "1" }, emit: (e) => { recorder.push(e); return true; }, stdout: cap.fn }),
  );
  assert.strictEqual(res.action, "killed", "env kill-switch => guard no-ops");
  assert.strictEqual(res.reason, "env");
  assert.strictEqual(res.decision, null);
  assert.strictEqual(recorder.length, 0, "no events emitted when killed");
  assert.strictEqual(cap.lines.length, 0, "no advisory written when killed");
});

// ── 3b. KILL-SWITCH via marker file ──────────────────────────────────────────
ok("kill-switch-marker", () => {
  const killDir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-guard-kill-"));
  fs.mkdirSync(path.join(killDir, ".claude", "runtime"), { recursive: true });
  fs.writeFileSync(path.join(killDir, ".claude", "manifest.json"), "{}");
  fs.writeFileSync(path.join(killDir, ".claude", "runtime", ".mode-guard-off"), "");
  const recorder = [];
  const res = guard.run(
    { tool_name: "SlashCommand", tool_input: { command: "/mode:sprint" } },
    baseOpts({ projectDir: killDir, emit: (e) => { recorder.push(e); return true; } }),
  );
  assert.strictEqual(res.action, "killed", "marker kill-switch => guard no-ops");
  assert.strictEqual(res.reason, "marker");
  assert.strictEqual(recorder.length, 0, "no events emitted when marker present");
});

// ── 3c. BOOTSTRAP allow-list: no manifest yet => no-op (initial setup) ────────
ok("bootstrap-no-manifest-noop", () => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-guard-fresh-"));
  const recorder = [];
  const res = guard.run(
    { tool_name: "SlashCommand", tool_input: { command: "/mode:sprint" } },
    baseOpts({ projectDir: freshDir, emit: (e) => { recorder.push(e); return true; } }),
  );
  assert.strictEqual(res.action, "killed", "no manifest (initial setup) => guard no-ops");
  assert.strictEqual(res.reason, "bootstrap-no-manifest");
  assert.strictEqual(recorder.length, 0);
});

// ── 4. REPORT-ONLY: across every accepted /mode target, decision stays null and
//       stdout NEVER carries a block decision. ────────────────────────────────
ok("report-only-never-blocks", () => {
  for (const target of ["solo", "adhoc", "oneshot", "sprint"]) {
    const cap = capture();
    const res = guard.run(
      { tool_name: "SlashCommand", tool_input: { command: `/mode:${target}` } },
      baseOpts({ stdout: cap.fn, emit: () => true }),
    );
    assert.strictEqual(res.decision, null, `decision null for /mode:${target}`);
    for (const line of cap.lines) {
      const parsed = JSON.parse(line);
      assert.ok(!("decision" in parsed), `no decision field in stdout for /mode:${target}`);
      assert.notStrictEqual(
        parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision,
        "deny",
        `never a deny permissionDecision for /mode:${target}`,
      );
    }
  }
});

// ── 5. extractModeTarget unit coverage (the scope boundary) ──────────────────
ok("extract-mode-target-boundary", () => {
  assert.strictEqual(guard.extractModeTarget({ tool_input: { command: "/mode:sprint extra" } }), "sprint");
  assert.strictEqual(guard.extractModeTarget({ tool_input: { skill: "mode:adhoc" } }), "adhoc");
  assert.strictEqual(guard.extractModeTarget({ tool_input: { command: "/modeling:foo" } }), null, "/modeling is NOT /mode");
  assert.strictEqual(guard.extractModeTarget({ tool_input: { command: "/scan:full" } }), null);
  assert.strictEqual(guard.extractModeTarget({ tool_input: {} }), null);
  assert.strictEqual(guard.extractModeTarget(null), null);
});

restoreLog();
console.log(`\nmode-lifecycle-guard: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
