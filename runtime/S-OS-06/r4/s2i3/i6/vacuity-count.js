#!/usr/bin/env node
"use strict";
/**
 * S-OS-06 r4 lane I6, step 5: THE VACUITY COUNT (a COUNT, not an outcome diff).
 *
 * For each of the 23 real register entries, emit PER ENTRY whether the OBSERVED cause set is EMPTY or
 * non-empty, under:
 *   COMMITTED  the runner at 6d46a818: spawn `node --test <file>` with ITS childEnv, capture = its
 *              firstFailureLine() (empty => the sentinel "(no failure line captured)"), lock = its
 *              `observed.includes(registered)` against the register AT 6d46a818.
 *   PREFIX     this branch's runner before lane I6 (aa0835ca): captureCauseLines() with keyInd = ind + 2,
 *              applied to the SAME tap output the FIXED runner observed (so a move is the parser alone).
 *   FIXED      this branch's runner at HEAD: its own exported runNodeTest() (tap, its childEnv) +
 *              captureCauseLines(), lock = multiset equality against the register at HEAD.
 *
 * Measurement, not a code read: every observation is a real child run of the real file from the worktree root.
 * Usage: node runtime/S-OS-06/r4/s2i3/i6/vacuity-count.js <outJson>
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const out = process.argv[2] || path.join(__dirname, "vacuity-count.json");
const show = (rev, p) => execFileSync("git", ["show", `${rev}:${p}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// ---- COMMITTED runner (6d46a818): extract its own function text; it has no exports and runs main on require.
const cSrc = show("6d46a818", "scripts/checks/run-tests.js");
const grab = (name) => {
  const i = cSrc.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`committed runner has no function ${name}`);
  const j = cSrc.indexOf("\n}\n", i);
  return cSrc.slice(i, j + 3);
};
const C = new Function("path", "process", `${grab("childEnv")}\n${grab("firstFailureLine")}\n${grab("normalizeFailure")}\n${grab("counts")}\n${grab("failCount")}\nreturn { childEnv, firstFailureLine, normalizeFailure, failCount };`)(path, process);
const C_SENTINEL = "(no failure line captured)";
const cReg = JSON.parse(show("6d46a818", "tests/quarantine.json"));

// ---- PREFIX runner (aa0835ca): written to a temp module (capture functions only are used).
const pDir = fs.mkdtempSync(path.join(os.tmpdir(), "i6-prefix-"));
const pFile = path.join(pDir, "run-tests.js");
fs.writeFileSync(pFile, show("aa0835ca", "scripts/checks/run-tests.js"));
const P = require(pFile);

// ---- FIXED runner (HEAD, the worktree file).
const F = require(path.join(ROOT, "scripts", "checks", "run-tests.js"));
const fReg = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "quarantine.json"), "utf8"));

function spawnCommitted(file) {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, ["--test", file], { cwd: ROOT, env: C.childEnv(), windowsHide: true });
    child.stdout.on("data", (c) => (output += c.toString("utf8")));
    child.stderr.on("data", (c) => (output += c.toString("utf8")));
    child.on("close", (code) => resolve({ status: code, output }));
  });
}

(async () => {
  const rows = [];
  const ctx = F.normalizerContext(ROOT);
  const pctx = P.normalizerContext(ROOT);
  for (let k = 0; k < fReg.entries.length; k++) {
    const e = fReg.entries[k];
    const ce = cReg.entries.find((x) => x.file === e.file);
    // COMMITTED
    const cr = await spawnCommitted(e.file);
    const cFirst = C.firstFailureLine(cr.output);
    const cObserved = C.normalizeFailure(cFirst, ROOT);
    const cRegistered = ce ? C.normalizeFailure(ce.firstFailingAssertion, ROOT) : null;
    const committed = {
      status: cr.status,
      observedEmpty: cFirst === C_SENTINEL,
      observed: cObserved,
      registered: cRegistered,
      registeredIsEmptySentinel: !!ce && ce.firstFailingAssertion === C_SENTINEL,
      lockMatches: !!cRegistered && cObserved.includes(cRegistered),
      failCount: C.failCount(cr.output),
    };
    committed.emptyReadAsAgreement = committed.observedEmpty && committed.lockMatches;
    // FIXED (and PREFIX on the same output)
    const fr = await F.runNodeTest(ROOT, [e.file], { tee: false, timeoutMs: 10 * 60 * 1000 });
    const fcap = F.captureCauseLines(fr.output, ctx);
    const pcap = P.captureCauseLines(fr.output, pctx);
    const fObs = F.causeMultiset(fcap.lines);
    const pObs = P.causeMultiset(pcap.lines);
    const fixed = {
      status: fr.status,
      truncated: fr.truncated,
      observedEmpty: fObs.length === 0,
      observedCount: fObs.length,
      vacuous: F.isVacuous(fObs, { file: e.file, basePath: e.basePath, testNames: fcap.testNames }),
      lockMatches: F.sameMultiset(fObs, e.causeLines),
      registeredCount: e.causeLines.length,
    };
    const prefix = {
      observedEmpty: pObs.length === 0,
      observedCount: pObs.length,
      vacuous: P.isVacuous(pObs, { file: e.file, basePath: e.basePath, testNames: pcap.testNames }),
      lockMatches: P.sameMultiset(pObs, e.causeLines),
    };
    const movedUnderParserFix = prefix.observedCount !== fixed.observedCount || prefix.lockMatches !== fixed.lockMatches;
    const addedByParser = movedUnderParserFix ? fObs.filter((l) => !pObs.includes(l)) : [];
    rows.push({ n: k + 1, file: e.file, committed, prefix, fixed, movedUnderParserFix, addedByParser });
    process.stdout.write(
      `${String(k + 1).padStart(2)} ${e.file}\n   COMMITTED exit ${committed.status} observed ${committed.observedEmpty ? "EMPTY" : "non-empty"} (registered sentinel: ${committed.registeredIsEmptySentinel}) lock ${committed.lockMatches ? "MATCH" : "no-match"}${committed.emptyReadAsAgreement ? "  <== EMPTY READ AS AGREEMENT" : ""}\n` +
        `   PREFIX    observed ${prefix.observedEmpty ? "EMPTY" : "non-empty"} (${prefix.observedCount}) vacuous ${prefix.vacuous} lock ${prefix.lockMatches ? "MATCH" : "no-match"}\n` +
        `   FIXED     exit ${fixed.status} observed ${fixed.observedEmpty ? "EMPTY" : "non-empty"} (${fixed.observedCount}) vacuous ${fixed.vacuous} lock ${fixed.lockMatches ? "MATCH" : "no-match"} moved-under-parser-fix ${movedUnderParserFix}\n`
    );
  }
  const sum = (pred) => rows.filter(pred).length;
  const summary = {
    entries: rows.length,
    committed: { observedEmpty: sum((r) => r.committed.observedEmpty), registeredEmptySentinel: sum((r) => r.committed.registeredIsEmptySentinel), emptyReadAsAgreement: sum((r) => r.committed.emptyReadAsAgreement), lockMatches: sum((r) => r.committed.lockMatches) },
    prefix: { observedEmpty: sum((r) => r.prefix.observedEmpty), vacuous: sum((r) => r.prefix.vacuous), lockMatches: sum((r) => r.prefix.lockMatches) },
    fixed: { observedEmpty: sum((r) => r.fixed.observedEmpty), vacuous: sum((r) => r.fixed.vacuous), lockMatches: sum((r) => r.fixed.lockMatches) },
    movedUnderParserFix: sum((r) => r.movedUnderParserFix),
    node: process.version,
    platform: process.platform,
  };
  process.stdout.write(`SUMMARY ${JSON.stringify(summary)}\n`);
  fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2) + "\n");
  fs.rmSync(pDir, { recursive: true, force: true });
})();
