#!/usr/bin/env node
"use strict";
// S-OS-06 r4 lane I3 — falsifiers 1 and 2, RUN rather than inspected.
//
// For each of the 7 degenerate entries (s2a-comparator premise findings P2) plus the flapping CONTROL
// dispatch-readiness, a TEMPORARY COPY of the real test file is written beside it (same directory so its
// relative requires resolve; a non-.test.js name so no glob picks it up) with ONE auditable injection that
// reads S2I3_SWAP from the environment:
//   - FIDELITY run  : S2I3_SWAP = {}                       -> the copy must behave as the original
//   - SWAP run      : S2I3_SWAP = {pass: A, fail: B, detail} -> case A (registered failing) is forced to PASS,
//                     case B (registered passing) is forced to FAIL, so the FAILING COUNT IS UNCHANGED.
//                     Where possible the forced failure carries the SAME detail text, so only the case
//                     identity differs (the adversarial shape a count-summary lock is blind to).
// Each copy runs through the COMMITTED runner's own runNodeTest (TAP pinned) + captureCauseLines, and the
// multiset is compared with the REGISTER's stored lines (fidelity) and with the swap (flip).
// Red half: a RECONSTRUCTION of the keyword grain (REP as quoted in s2a findings P2, applied to the same
// normalized comment lines) is evaluated on both runs; equal => that grain could not see the swap.
// The tracked test files are never written. Copies are deleted in finally.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const rt = require(path.join(ROOT, "scripts", "checks", "run-tests.js"));
const REP = /(^|\s)(not ok|FAIL(?:ED)?|✖)(?!\w)|Error\b|AssertionError/;

const INJECT = {
  harness: {
    anchor: /^const h = harness\(.*\);\s*$/m,
    code:
      ';(() => { const S = JSON.parse(process.env.S2I3_SWAP || "{}"); for (const k of ["pass", "violation", "failClosed", "test"]) { const o = h[k]; h[k] = (name, fn) => o(name, name === S.fail ? (k === "test" ? () => { throw new Error(S.detail || "forced"); } : k === "pass" ? () => ({ ok: false }) : () => ({ ok: true })) : name === S.pass ? (k === "test" ? () => {} : k === "pass" ? () => ({ ok: true }) : () => ({ ok: false })) : fn); } })();',
  },
  check: {
    anchor: /^function check\(name, cond, detail\) \{\s*$/m,
    code: '{ const S = JSON.parse(process.env.S2I3_SWAP || "{}"); if (name === S.fail) { cond = false; if (S.detail !== undefined) detail = S.detail; } if (name === S.pass) cond = true; }',
  },
  tests: {
    anchor: /^\s*for \(const t of tests\) \{\s*$/m,
    code: '{ const S = JSON.parse(process.env.S2I3_SWAP || "{}"); if (t.name === S.fail) t.fn = () => { throw new Error(S.detail || "forced"); }; if (t.name === S.pass) t.fn = () => {}; }',
  },
};

const CASES = [
  { file: "tests/mc/provider-smoke.unit.test.js", role: "degenerate + CONTROL", shape: "check", pass: "KNOWN_PROVIDERS set", fail: "KNOWN_PROVIDERS length 3" },
  { file: "tests/regression/S-LC-06/coverage-gate-caller.test.js", role: "degenerate", shape: "harness", pass: "auditLedger: a clean backed+proof ledger has 0 gaps", fail: "CLI: clean ledger → exit 0 (report-only)" },
  { file: "tests/regression/S-LC-06/mode-profile.test.js", role: "degenerate", shape: "harness", pass: "mode_profiles.sprint.alpha_only_shapes === ['in-process-agent'] (ED-041)", fail: "runtime narrowing returns the class default when a mode does not narrow the role", detail: "Expected values to be strictly deep-equal:" },
  { file: "tests/regression/S-PF-03/admin-surface.test.js", role: "degenerate", shape: "tests", pass: "unsigned-header-auth-fixture-fails", fail: "missing-audit-fixture-fails", detail: 'missing error /signed request-bound admin session cookie/; got ["duplicate telemetry sink/raw emit outside sink.ts: src/hooks/useVoiceInput.ts.tmpl"]' },
  { file: "tests/regression/S-PF-04/founders-checklist.test.js", role: "degenerate", shape: "tests", pass: "real-scaffold-founders-checklist-contract-passes", fail: "missing-template-fixture-fails-scaffold-coverage", detail: "Expected values to be strictly deep-equal:" },
  { file: "tests/regression/SP-20260611-002/coverage-gate-scan-live-cli.test.js", role: "degenerate", shape: "harness", pass: "LIVE CLI with --expected-source reports no gap when BOTH expected roles have records", fail: "LIVE CLI with a malformed --expected-source falls back to self-derive (fail-open, exit 0)" },
  { file: "tests/regression/SP-20260611-002/coverage-gate-scan-source.test.js", role: "degenerate", shape: "harness", pass: "resolveExpected UNIONs the external set with claimed roles", fail: "AC-5.3 the gap names the omitted (no-record) role", detail: "Expected values to be strictly deep-equal:" },
  { file: "tests/mc/dispatch-readiness.test.js", role: "CONTROL (the order-flapping one)", shape: "check", pass: "KNOWN_DANGLING_REFS is empty by default (no pre-populated allowlist)", fail: "exit code: green → 0", detail: "length=33" },
];

async function runCopy(copyRel, swap) {
  const prev = process.env.S2I3_SWAP;
  process.env.S2I3_SWAP = JSON.stringify(swap);
  try {
    const r = await rt.runNodeTest(ROOT, [copyRel], { tee: false, timeoutMs: 10 * 60 * 1000 });
    const cap = rt.captureCauseLines(r.output, rt.normalizerContext(ROOT));
    return { status: r.status, truncated: r.truncated, failCount: (/^# fail (\d+)\s*$/m.exec(r.output) || [])[1] || null, lines: cap.lines };
  } finally {
    if (prev === undefined) delete process.env.S2I3_SWAP;
    else process.env.S2I3_SWAP = prev;
  }
}

(async () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "quarantine.json"), "utf8"));
  const out = { env: { platform: process.platform, node: process.versions.node, reporter: rt.REPORTER, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR || null }, at: new Date().toISOString(), rows: [] };
  for (const c of CASES) {
    const entry = reg.entries.find((e) => e.file === c.file);
    const src = fs.readFileSync(path.join(ROOT, ...c.file.split("/")), "utf8");
    const inj = INJECT[c.shape];
    const hits = src.match(new RegExp(inj.anchor.source, "gm")) || [];
    const row = { file: c.file, role: c.role, shape: c.shape, forcedPass: c.pass, forcedFail: c.fail, sameDetail: c.detail !== undefined || c.shape === "harness" || c.shape === "check", anchorHits: hits.length };
    out.rows.push(row);
    if (hits.length !== 1) {
      row.verdict = "NOT RUN: injection anchor not unique";
      continue;
    }
    const mutated = src.replace(inj.anchor, (m) => `${m.replace(/\s*$/, "")}\n${inj.code}\n`);
    const copyRel = path.posix.join(path.posix.dirname(c.file), `__s2i3probe__${path.posix.basename(c.file).replace(/\.test\.js$/, "")}.probe.js`);
    const copyAbs = path.join(ROOT, ...copyRel.split("/"));
    fs.writeFileSync(copyAbs, mutated, "utf8");
    try {
      const fid = await runCopy(copyRel, {});
      const swp = await runCopy(copyRel, { pass: c.pass, fail: c.fail, detail: c.detail });
      const fidDiff = rt.multisetDifference(fid.lines, entry.causeLines);
      const swpDiff = rt.multisetDifference(swp.lines, fid.lines);
      Object.assign(row, {
        copy: copyRel,
        fidelity: { exit: fid.status, failCount: fid.failCount, lines: fid.lines.length, multisetEqualsRegister: rt.sameMultiset(fid.lines, entry.causeLines), onlyInCopy: fidDiff.onlyA, onlyInRegister: fidDiff.onlyB },
        swap: { exit: swp.status, failCount: swp.failCount, lines: swp.lines.length },
        countSummaryUnchanged: JSON.stringify(fid.lines.filter((l) => /\b(passed|failed|FAILED)\b/.test(l) && /\d/.test(l))) === JSON.stringify(swp.lines.filter((l) => /\b(passed|failed|FAILED)\b/.test(l) && /\d/.test(l))),
        multisetLockFlips: !rt.sameMultiset(swp.lines, fid.lines) && !rt.sameMultiset(swp.lines, entry.causeLines),
        swapVsFidelity: { onlyInSwap: swpDiff.onlyA, onlyInFidelity: swpDiff.onlyB },
        keywordGrainReconstruction: { fidelity: fid.lines.filter((l) => REP.test(l)), swap: swp.lines.filter((l) => REP.test(l)) },
      });
      row.keywordGrainBlind = JSON.stringify(row.keywordGrainReconstruction.fidelity) === JSON.stringify(row.keywordGrainReconstruction.swap);
      row.verdict = !row.fidelity.multisetEqualsRegister
        ? "INCONCLUSIVE vs register: the copy does not reproduce the register (flip judged against the copy's own fidelity run only)"
        : row.multisetLockFlips && row.countSummaryUnchanged && swp.status === 1
          ? "GREEN: same failing count, different sub-case, multiset lock FLIPS"
          : `RED/INCONCLUSIVE: flips=${row.multisetLockFlips} countSummaryUnchanged=${row.countSummaryUnchanged} swapExit=${swp.status}`;
    } finally {
      fs.rmSync(copyAbs, { force: true });
    }
  }
  const f = path.join(__dirname, "swap-experiment.summary.json");
  fs.writeFileSync(f, JSON.stringify(out, null, 2) + "\n", "utf8");
  for (const r of out.rows) console.log(`${r.verdict} | keywordGrainBlind=${r.keywordGrainBlind} | fid ${r.fidelity ? `${r.fidelity.lines}L eqReg=${r.fidelity.multisetEqualsRegister}` : "-"} | swap ${r.swap ? `${r.swap.lines}L exit ${r.swap.exit} fc ${r.swap.failCount}` : "-"} | ${r.file}`);
})().catch((e) => {
  console.error(e.stack || e);
  process.exitCode = 2;
});
