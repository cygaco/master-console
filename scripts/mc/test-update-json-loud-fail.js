#!/usr/bin/env node
/**
 * scripts/mc/test-update-json-loud-fail.js
 *
 * Tooth for the BC-16 lying-diagnostic fix (SP-20260721-001 D-4 INC-3 chunk 3
 * SCOPE-ADD). Before the fix, `update.js --json` did:
 *
 *   if (opts.json) { console.log(JSON.stringify(r, null, 2)); return; }
 *
 * with NO process.exit — so a `!r.ok` run (Class-C ESCALATE, a PREFLIGHT
 * BLOCKED gate, or any structured error) exited 0. A CI/scripting caller that
 * only checks the exit code (as GATE-B's engine explicitly does NOT — it uses
 * run() directly, never this CLI — but every OTHER --json consumer would)
 * would silently believe a blocked/failed update succeeded.
 *
 * This test forces a REAL preflight-block cheaply (no full install): it
 * points --target at a throwaway sandbox dir with NO
 * .claude/framework-installed.json. classify() against an empty target
 * produces 0 Class-C conflicts (nothing local to conflict with), so run()
 * proceeds into the SP-005 preflight composer, whose FIRST gate
 * (mc-install-baseline) reds fail-fast on a missing baseline — a real,
 * fast, structured `PREFLIGHT BLOCKED:` failure (r.ok === false).
 *
 * PRE-FIX this exited 0 (the lying-exit-0 the fix closes). POST-FIX it must
 * exit non-zero.
 *
 * (SP-20260721-001 D-4 INC-3 gauntlet-r1 F7 — qa INT-TEST-REACH) The tooth
 * logic is exported as `runTooth()` so a committed suite (test-gate-wiring.js)
 * can invoke it directly and have it fire CONTINUOUSLY as part of that
 * suite's run, not only when this file is executed standalone. The CLI
 * entrypoint below (guarded by `require.main === module`) is unchanged.
 *
 * Exit 0 = tooth passes (fix holds). Exit 1 = regression (lying exit-0 is back).
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const UPDATE_JS = path.join(REPO_ROOT, "scripts", "mc", "update.js");

/**
 * Runs the BC-16 --json loud-fail tooth suite and returns { pass, fail,
 * results }. Prints each assertion's ok/FAIL line to stdout/stderr as it
 * goes (same visible-progress contract as the standalone CLI run), but never
 * calls process.exit — callers decide what to do with the result.
 */
function runTooth() {
  let pass = 0;
  let fail = 0;
  const results = [];
  function ok(name, cond, detail) {
    results.push({ name, status: cond ? "pass" : "fail", detail: cond ? undefined : detail || "" });
    if (cond) {
      process.stdout.write(`  ok  ${name}\n`);
      pass++;
    } else {
      process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
      fail++;
    }
  }

  // version.json — resolve the current release version to target with --to,
  // so the capsule under framework/releases/<version>/ is guaranteed to
  // exist in canonical (dynamic, never hardcoded — same discipline as the
  // GATE-B engine's Step 0).
  const versionDoc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "version.json"), "utf8"));
  const toVersion = versionDoc.version;

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "mc-update-json-loud-fail-"));
  try {
    // Sandbox target deliberately has NO .claude/framework-installed.json —
    // the mc-install-baseline preflight gate (gate 1, fail-fast) reds on
    // exactly this, cheaply and fast (no real install/apply work happens).
    const r = spawnSync(
      process.execPath,
      [
        UPDATE_JS,
        "--to",
        toVersion,
        "--source",
        REPO_ROOT,
        "--target",
        sandbox,
        "--apply",
        "--json",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 },
    );

    ok(
      "update.js --json --apply against a target with no installed baseline exits NON-ZERO (BC-16 fix holds — pre-fix this was exit 0)",
      r.status !== 0 && r.status !== null,
      `status=${r.status} signal=${r.signal} stdout(tail)=${(r.stdout || "").slice(-300)} stderr(tail)=${(r.stderr || "").slice(-300)}`,
    );

    // Confirm the run actually took the structured PREFLIGHT BLOCKED / r.ok
    // === false path (not some unrelated usage/crash exit) — parse the
    // --json payload from stdout and assert ok === false.
    let payload = null;
    try {
      payload = JSON.parse(r.stdout || "{}");
    } catch {
      /* leave payload null — the next assertion fails loudly with detail */
    }
    ok(
      "the --json payload is parseable and reports ok:false (a real structured failure, not a crash/usage error)",
      !!payload && payload.ok === false,
      `payload=${JSON.stringify(payload)}`,
    );
    ok(
      "the failure is a STRUCTURED failure of the BC-16 loud-fail contract (not an unrelated crash) — robust to WHICH gate/phrase fires",
      // (R3-4 — 2nd recurrence fix, qa 7C-006) Do NOT match any SPECIFIC
      // failure NAME or phrase (not "PREFLIGHT BLOCKED", not "^ESCALATE:", not
      // any other gate's wording — e.g. the real
      // "TRANSACTION BEGIN FAILED (EFASTPREFLIGHTDRIFT)" text was rejected by
      // the previous regex pin). Assert ONLY the load-bearing INVARIANTS of
      // the contract under test: the run reports not-ok, did NOT commit, the
      // process actually exited non-zero (already asserted above), and a
      // non-empty structured error string is present. This is the property
      // "a !ok run exits non-zero with a structured error" — not which gate
      // fired — so it accepts the WHOLE structured-failure family.
      !!payload &&
        payload.ok === false &&
        payload.committed !== true &&
        typeof payload.error === "string" &&
        payload.error.length > 0,
      `payload.ok=${payload && payload.ok} payload.committed=${payload && payload.committed} error=${payload && payload.error}`,
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  return { pass, fail, results };
}

if (require.main === module) {
  const { pass, fail } = runTooth();
  process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

module.exports = { runTooth };
