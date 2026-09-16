#!/usr/bin/env node
"use strict";
// S-OS-06 r4 lane I3 — falsifiers 4 (TAP pinned), 5 (fixed-point refusal) and 6 (basePath), RUN against the
// COMMITTED runner and register. Also: normalizer idempotence (the property the fixed-point guarantee rests on)
// and the register's I6/I7 wording. Writes probe-f456.summary.json beside itself. Never writes tests/ or scripts/.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const rt = require(path.join(ROOT, "scripts", "checks", "run-tests.js"));
const REAL_Q = path.join(ROOT, "tests", "quarantine.json");
const real = JSON.parse(fs.readFileSync(REAL_Q, "utf8"));
const ctx = rt.normalizerContext(ROOT);
const results = [];
const rec = (falsifier, name, pass, detail) => {
  results.push({ falsifier, name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${falsifier}] ${name}${detail && !pass ? ` :: ${String(detail).slice(0, 300)}` : ""}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "s2i3-probe-"));
const clone = () => JSON.parse(JSON.stringify(real));
function loadErr(doc) {
  const f = path.join(tmp, `q-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(doc, null, 2), "utf8");
  try {
    rt.loadQuarantine(f, ROOT);
    return null;
  } catch (e) {
    return e.message;
  }
}

(async () => {
  // ───────── F4: TAP pinned ─────────
  rec("F4", "nodeTestArgs pins --test-reporter=tap", JSON.stringify(rt.nodeTestArgs(["x.test.js"])) === JSON.stringify(["--test", "--test-reporter=tap", "x.test.js"]));
  const src = fs.readFileSync(path.join(ROOT, "scripts", "checks", "run-tests.js"), "utf8");
  const nodeSpawns = src.match(/spawn(?:Sync)?\(process\.execPath,[^)]*\)/g) || [];
  rec("F4", "every node spawn in run-tests.js goes through nodeTestArgs (static)", nodeSpawns.length === 1 && /nodeTestArgs\(files\)/.test(nodeSpawns[0]), JSON.stringify(nodeSpawns));
  const runCalls = (src.match(/runNodeTest\(/g) || []).length;
  rec("F4", "runNodeTest is the only runner of tests (primary + quarantine + base = 3 call sites + definition)", runCalls === 4, `runNodeTest( occurrences: ${runCalls}`);
  const old = fs.readFileSync(path.join(__dirname, "run-tests.132a2222.js"), "utf8");
  rec("F4", "RED HALF: the pre-rewrite runner (132a2222) spawned node --test with NO reporter flag", /spawn\(process\.execPath, \["--test", \.\.\.files\]/.test(old));
  const probeEntry = real.entries.find((e) => e.file === "tests/regression/S-LC-06/coverage-gate-caller.test.js");
  const r1 = await rt.runNodeTest(ROOT, [probeEntry.file], { tee: false, timeoutMs: 600000 });
  rec("F4", "a real quarantined run emits TAP (TAP version 13 header)", /^TAP version 13$/m.test(r1.output), r1.output.slice(0, 200));
  {
    const d = clone();
    d.entries[0].observedOn.reporter = "spec";
    const err = loadErr(d);
    rec("F4", "register refuses an entry observed under a non-tap reporter", err && /the reporter is pinned to "tap"/.test(err), err);
  }
  {
    const prev = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = `${prev ? prev + " " : ""}--test-reporter=spec`;
    const r2 = await rt.runNodeTest(ROOT, [probeEntry.file], { tee: false, timeoutMs: 600000 });
    if (prev === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = prev;
    const cap2 = rt.captureCauseLines(r2.output, ctx);
    rec("F4", "EDGE (informational): ambient NODE_OPTIONS=--test-reporter=spec does not create a FALSE GREEN (lock either still equal with TAP output, or fails closed)", true, JSON.stringify({ exit: r2.status, tapHeader: /^TAP version 13$/m.test(r2.output), specMarkers: /^ℹ tests \d+/m.test(r2.output), multisetEqualsRegister: rt.sameMultiset(cap2.lines, probeEntry.causeLines), observedLines: cap2.lines.length }));
    results[results.length - 1].edge = JSON.parse(results[results.length - 1].detail);
  }

  // ───────── F5: fixed-point refusal ─────────
  rec("F5", "GREEN CONTROL: the committed register loads (every stored line is a fixed point, canonical order)", loadErr(clone()) === null, loadErr(clone()));
  const plants = {
    "leading reporter marker": (l) => `# ${l}`,
    "leading info marker": (l) => `ℹ ${l}`,
    "double internal space": (l) => l.replace(" ", "  "),
    "trailing space": (l) => `${l} `,
    "backslash separator": (l) => `${l} a\\b`,
    "escaped hash": (l) => `${l} \\#x`,
    "timing": (l) => `${l} (12ms)`,
    "absolute repo root": (l) => `${l} ${ctx.root}/x`,
    "tab": (l) => `${l}\tz`,
  };
  for (const [kind, mut] of Object.entries(plants)) {
    const d = clone();
    const e = d.entries.find((x) => x.file === probeEntry.file);
    e.causeLines[0] = mut(e.causeLines[0]);
    e.causeLines = rt.causeMultiset(e.causeLines); // keep canonical order so ONLY the fixed-point property is under test
    const err = loadErr(d);
    rec("F5", `planted non-fixed-point line (${kind}) is REFUSED`, err && /is not a fixed point of the normalizer/.test(err), err);
  }
  {
    const d = clone();
    const e = d.entries.find((x) => x.causeLines.length >= 2 && x.causeLines[0] !== x.causeLines[1]);
    [e.causeLines[0], e.causeLines[1]] = [e.causeLines[1], e.causeLines[0]];
    const err = loadErr(d);
    rec("F5", "stored causeLines out of canonical order is REFUSED (order part of the stored fixed point)", err && /not in canonical order/.test(err), err);
  }
  {
    const d = clone();
    d.entries[0].causeLines.push("at foo (<repo>/x.js:1:2)");
    d.entries[0].causeLines = rt.causeMultiset(d.entries[0].causeLines);
    const err = loadErr(d);
    rec("F5", "a stored line in the drop class is REFUSED (could never be observed)", err && /is in the drop class/.test(err), err);
  }
  // Idempotence: normalize(normalize(x)) === normalize(x). If this fails for some observable x, an observed line
  // can never equal any (fixed-point) stored line => a permanent fail-closed CAUSE-LOCK, not a false green.
  const rawComment = [];
  for (const e of real.entries) {
    const r = await rt.runNodeTest(ROOT, [e.file], { tee: false, timeoutMs: 600000 });
    for (const l of r.output.split(/\r?\n/)) if (/^\s*#/.test(l)) rawComment.push(l);
  }
  let rng = 0x5eed;
  const rand = (n) => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff), rng % n);
  const atoms = ["\\", "\\\\", "#", "# ", "ℹ", "ℹ ", " ", "  ", "\t", "(", ")", "ms", "12", "(3ms)", "(1.5ms)", "/", "a", "Z", "-", ".", ">", "<tmp>", "<repo>", ctx.root, ctx.tmp, `${ctx.tmp}/abc123XYZ`, "\\t", "x"];
  const fuzz = [];
  for (let i = 0; i < 200000; i++) {
    let s = "";
    const k = 1 + rand(8);
    for (let j = 0; j < k; j++) s += atoms[rand(atoms.length)];
    fuzz.push(s);
  }
  const counter = [];
  for (const s of [...rawComment, ...fuzz]) {
    const once = rt.normalizeLine(s, ctx);
    const twice = rt.normalizeLine(once, ctx);
    if (once !== twice && counter.length < 10) counter.push({ input: s, once, twice });
    if (once !== twice) counter.n = (counter.n || 0) + 1;
  }
  rec("F5", `normalizer idempotent over ${rawComment.length} real raw TAP comment lines (23 entries, 1 pass) + ${fuzz.length} fuzz strings`, counter.length === 0, JSON.stringify({ violations: counter.n || 0, examples: counter }));
  results[results.length - 1].counterexamples = counter;
  results[results.length - 1].counterexampleCount = counter.n || 0;

  // ───────── F6: basePath ─────────
  const base = real.base;
  const renamed = real.entries.filter((e) => e.basePath);
  rec("F6", "exactly 5 entries carry basePath, all tests/mc/* renamed from tests/warpos/*", renamed.length === 5 && renamed.every((e) => e.file.startsWith("tests/mc/") && e.basePath === e.file.replace("tests/mc/", "tests/warpos/")), JSON.stringify(renamed.map((e) => [e.basePath, e.file])));
  const allProblems = real.entries.map((e) => [e.file, rt.baseIdentityProblems(ROOT, base, e)]).filter(([, p]) => p.length);
  rec("F6", "all 23 real entries pass base identity (absent=identical for 18, present-and-correct for 5)", allProblems.length === 0, JSON.stringify(allProblems));
  {
    const e = { ...renamed[0] };
    delete e.basePath;
    const p = rt.baseIdentityProblems(ROOT, base, e);
    rec("F6", "ABSENT on a renamed entry -> refused NOT AT BASE (absence means identical, and identical is false)", p.length === 1 && /^NOT AT BASE: .* does not exist at base/.test(p[0]), JSON.stringify(p));
  }
  {
    const e = real.entries.find((x) => !x.basePath);
    const p = rt.baseIdentityProblems(ROOT, base, e);
    rec("F6", "ABSENT on a non-renamed entry -> accepted (identical)", p.length === 0, JSON.stringify(p));
  }
  {
    const p = rt.baseIdentityProblems(ROOT, base, renamed[0]);
    rec("F6", "PRESENT-AND-CORRECT -> accepted", p.length === 0, JSON.stringify(p));
  }
  {
    const e = { ...renamed[0], basePath: renamed[1].basePath }; // exists at base, renamed to a DIFFERENT file
    const p = rt.baseIdentityProblems(ROOT, base, e);
    rec("F6", "PRESENT-BUT-NOT-A-RENAME (basePath exists at base, is another file's rename source) -> refused", p.length === 1 && /^BASEPATH NOT A RENAME/.test(p[0]), JSON.stringify(p));
  }
  {
    const e = { ...real.entries.find((x) => x.file === "tests/regression/S-LC-06/coverage-gate-caller.test.js"), basePath: "tests/regression/S-LC-06/mode-profile.test.js" }; // exists at base AND at HEAD, unrenamed
    const p = rt.baseIdentityProblems(ROOT, base, e);
    rec("F6", "PRESENT-BUT-NOT-A-RENAME (basePath exists at base and still at HEAD, unrenamed) -> refused", p.length === 1 && /^BASEPATH NOT A RENAME/.test(p[0]), JSON.stringify(p));
  }
  {
    const e = { ...renamed[0], basePath: "tests/warpos/no-such-file.test.js" };
    const p = rt.baseIdentityProblems(ROOT, base, e);
    rec("F6", "basePath naming a file absent at base -> refused NOT AT BASE", p.length === 1 && /^NOT AT BASE: .* names basePath/.test(p[0]), JSON.stringify(p));
  }
  {
    const d = clone();
    d.entries.find((x) => x.basePath).basePath = d.entries.find((x) => x.basePath).file;
    const err = loadErr(d);
    rec("F6", "basePath equal to file -> register refused", err && /"basePath" must be a repo-relative \*\.test\.js path different from "file"/.test(err), err);
  }
  {
    const one = spawnSync("git", ["-c", "diff.renames=true", "diff", `-M${rt.RENAME_SIMILARITY}`, "--name-status", base, "HEAD", "--", renamed[0].file], { cwd: ROOT, encoding: "utf8" });
    const pair = spawnSync("git", ["-c", "diff.renames=true", "diff", `-M${rt.RENAME_SIMILARITY}`, "--name-status", base, "HEAD", "--", renamed[0].basePath, renamed[0].file], { cwd: ROOT, encoding: "utf8" });
    rec("F6", "RED HALF: single-path pathspec reports A (no rename); the pair-limited pathspec reports R", /^A\t/.test(one.stdout.trim()) && /^R\d{3}\t/.test(pair.stdout.trim()), JSON.stringify({ single: one.stdout.trim(), pair: pair.stdout.trim() }));
  }
  rec("F6", "real-register base assertion refuses a different base", /changing it is refused here \(this is a runner check, not freeze coverage\)/.test(rt.checkRealRegisterBase(REAL_Q, "0".repeat(40)) || ""));
  rec("F6", "real-register base assertion does not apply to a fixture register", rt.checkRealRegisterBase(path.join(tmp, "q.json"), "0".repeat(40)) === null);

  // ───────── I6 / I7 wording on the committed artifacts ─────────
  const regText = fs.readFileSync(REAL_Q, "utf8");
  const freezeSentences = [];
  for (const [label, text] of [["register", regText], ["runner", src]]) {
    for (const s of text.split(/(?<=[.!?])\s+|\n/)) if (/freez/i.test(s)) freezeSentences.push({ where: label, sentence: s.trim().slice(0, 300) });
  }
  rec("I6", "sentences mentioning freeze (review by eye: none may claim the register IS under freeze)", true, JSON.stringify(freezeSentences));
  results[results.length - 1].freezeSentences = freezeSentences;
  rec("I7", "$policy says 'fails at base' and not 'fails identically at base' as the claim", /fails at base/.test(real.$policy), real.$policy);
  rec("I5", "register records basePath as rename provenance", /provenance/i.test(regText), "");
  rec("I7", "$format no longer declares a temp substitution the code does not perform (temp IS performed now: step 3)", /<tmp>/.test(rt.NORMALIZER_DECLARATION[3]) && /ctx\.tmp/.test(src), "");
  rec("I10", "no cap on stored lines (no truncation of causeLines in capture or load)", !/causeLines\.slice|lines\.slice\(0/.test(src), "");

  fs.rmSync(tmp, { recursive: true, force: true });
  const out = { env: { platform: process.platform, node: process.versions.node, reporter: rt.REPORTER, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR || null }, at: new Date().toISOString(), passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, results };
  fs.writeFileSync(path.join(__dirname, "probe-f456.summary.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ passed: out.passed, failed: out.failed }));
  process.exitCode = out.failed ? 1 : 0;
})().catch((e) => {
  console.error(e.stack || e);
  process.exitCode = 2;
});
