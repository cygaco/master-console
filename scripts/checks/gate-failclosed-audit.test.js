"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  analyzeSource,
  oldNaiveDetect,
  cleanSource,
  runAudit,
  walkJsFiles,
  getWiredStatus,
} = require("./gate-failclosed-audit.js");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "gate-failclosed");

const FIXTURES = [
  { file: "fn-nested-brace.js", expected: true, class: "false-negative" },
  { file: "fn-long-handler.js", expected: true, class: "false-negative" },
  { file: "fn-spacing-variant.js", expected: true, class: "false-negative" },
  { file: "fn-quoted-reordered-key.js", expected: true, class: "false-negative" },
  { file: "fp-string-literal.js", expected: false, class: "false-positive" },
  { file: "fp-method-named-catch.js", expected: false, class: "false-positive" },
  { file: "fp-unreachable-after-throw.js", expected: false, class: "false-positive" },
  { file: "fp-false-value.js", expected: false, class: "false-positive" },
];

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

test("fixture files exist and are non-empty (sanity — a missing fixture must not silently read as empty-source-clean)", () => {
  for (const f of FIXTURES) {
    const p = path.join(FIXTURE_DIR, f.file);
    assert.ok(fs.existsSync(p), `missing fixture: ${f.file}`);
    const content = fs.readFileSync(p, "utf8");
    assert.ok(content.length > 20, `fixture suspiciously short: ${f.file}`);
  }
});

for (const f of FIXTURES) {
  test(`NEW detector: ${f.file} (${f.class}) — expected flagged=${f.expected}`, () => {
    const src = readFixture(f.file);
    const findings = analyzeSource(src);
    const flagged = findings.length > 0;
    assert.equal(
      flagged,
      f.expected,
      `analyzeSource(${f.file}) findings=${JSON.stringify(findings)}`,
    );
  });

  test(`OLD naive-regex predicate is OBSERVED RED on: ${f.file} (proves the fixture actually discriminates)`, () => {
    const src = readFixture(f.file);
    const oldFlagged = oldNaiveDetect(src);
    assert.notEqual(
      oldFlagged,
      f.expected,
      `old predicate agreed with ground truth on ${f.file} — this fixture no longer discriminates`,
    );
  });
}

test("no-op mutation guard: a predicate that does nothing differently must still be caught wrong by every fixture", () => {
  const noOpWrapped = (src) => oldNaiveDetect(src);
  let disagreements = 0;
  for (const f of FIXTURES) {
    const src = readFixture(f.file);
    const a = oldNaiveDetect(src);
    const b = noOpWrapped(src);
    assert.equal(a, b, `no-op wrapper changed behavior on ${f.file} — wrapper is not actually a no-op`);
    if (b !== f.expected) disagreements++;
  }
  assert.equal(
    disagreements,
    FIXTURES.length,
    "no-op-wrapped old predicate must disagree with ground truth on ALL 8 fixtures, same as the bare old predicate",
  );
});

test("NESTED-TRY: a try/catch nested inside an outer try's body — BOTH permissive handlers are found", () => {
  const src = readFixture("nt-both-permissive.js");
  const findings = analyzeSource(src);
  const lines = findings.map((f) => f.line).sort((a, b) => a - b);
  assert.equal(findings.length, 2, `expected both the inner and outer handler flagged, got ${JSON.stringify(findings)}`);
  assert.deepEqual(lines, [15, 20], "expected the inner process.exit(0) at line 15 AND the outer success-shaped return at line 20");
});

test("NESTED-TRY no-op⇒FAIL guard: a mutation that restores the old skip-ahead behavior must miss the inner finding", () => {
  const { cleanSource } = require("./gate-failclosed-audit.js");
  function oldFindCatchHandlers(clean) {
    const out = [];
    const tryRe = /\btry\b/g;
    let m;
    while ((m = tryRe.exec(clean))) {
      const tryIdx = m.index;
      if (precedingNonSpaceCharLocal(clean, tryIdx) === ".") continue;
      const afterTry = nextNonSpaceIndexLocal(clean, tryIdx + 3);
      if (clean[afterTry] !== "{") continue;
      const tryBlockEnd = matchDelimLocal(clean, afterTry);
      if (tryBlockEnd === -1) continue;
      let pos = nextNonSpaceIndexLocal(clean, tryBlockEnd + 1);
      if (clean.slice(pos, pos + 5) !== "catch") continue;
      const afterCatchWord = pos + 5;
      if (/[A-Za-z0-9_$]/.test(clean[afterCatchWord] || "")) continue;
      let p = nextNonSpaceIndexLocal(clean, afterCatchWord);
      if (clean[p] === "(") {
        const parenEnd = matchDelimLocal(clean, p);
        if (parenEnd === -1) continue;
        p = nextNonSpaceIndexLocal(clean, parenEnd + 1);
      }
      if (clean[p] !== "{") continue;
      const handlerEnd = matchDelimLocal(clean, p);
      if (handlerEnd === -1) continue;
      out.push({ catchIdx: pos, handlerStart: p + 1, handlerEnd });
      tryRe.lastIndex = handlerEnd + 1;
    }
    return out;
  }
  function precedingNonSpaceCharLocal(clean, idx) {
    let k = idx - 1;
    while (k >= 0 && /\s/.test(clean[k])) k--;
    return k >= 0 ? clean[k] : "";
  }
  function nextNonSpaceIndexLocal(clean, idx) {
    let k = idx;
    while (k < clean.length && /\s/.test(clean[k])) k++;
    return k;
  }
  function matchDelimLocal(clean, openIdx) {
    const open = clean[openIdx];
    const pairs = { "{": "}", "(": ")", "[": "]" };
    const close = pairs[open];
    if (!close) return -1;
    let depth = 0;
    for (let k = openIdx; k < clean.length; k++) {
      if (clean[k] === open) depth++;
      else if (clean[k] === close) {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  }

  const src = readFixture("nt-both-permissive.js");
  const clean = cleanSource(src);
  const oldHandlers = oldFindCatchHandlers(clean);
  assert.equal(
    oldHandlers.length,
    1,
    "the reverted (pre-fix) traversal must still miss the nested handler on this fixture — if it now finds both, the fixture no longer discriminates",
  );
});

test("real brace matching: nested handler >1 level deep with mixed delimiters still finds process.exit(0)", () => {
  const src = `
    function h() {
      try {
        go();
      } catch (e) {
        if (a) {
          for (const x of [1,2,3]) {
            if (x) { doThing({ nested: { deeper: [1,2,{x:3}] } }); }
          }
        }
        process.exit(0);
      }
    }
  `;
  const findings = analyzeSource(src);
  assert.ok(findings.length > 0, "expected a finding through multi-level nesting");
});

test("catch with no binding (optional catch binding, ES2019) is still recognized as a real catch clause", () => {
  const src = `
    function h() {
      try {
        go();
      } catch {
        process.exit(0);
      }
    }
  `;
  const findings = analyzeSource(src);
  assert.equal(findings.length, 1);
});

test("try without a following catch (try/finally only) produces no finding and does not throw", () => {
  const src = `
    function h() {
      try {
        go();
      } finally {
        process.exit(0);
      }
    }
  `;
  assert.doesNotThrow(() => analyzeSource(src));
  const findings = analyzeSource(src);
  assert.equal(findings.length, 0);
});

test("cleanSource masks string/comment/template-text content but preserves length and code", () => {
  const src = 'const s = "process.exit(0)"; // comment with { brace\nconst t = `plain ${1+1} text`;';
  const clean = cleanSource(src);
  assert.equal(clean.length, src.length);
  assert.ok(!clean.includes("process.exit"), "string content should be masked in clean buffer");
  assert.ok(clean.includes("1+1"), "template ${...} expression code must remain live, not masked");
});

test("blindness guard 1: zero successfully-read files under an empty/nonexistent root yields UNKNOWN, exit 2, never clean", () => {
  const emptyRoot = path.join(FIXTURE_DIR, "__does_not_exist__");
  const { exitCode, report } = runAudit(emptyRoot);
  assert.equal(exitCode, 2);
  assert.equal(report.status, "unknown");
  assert.equal(report.files_scanned, 0);
});

test("blindness guard 1b: a dangling symlink (or unreadable file) does not count toward files_scanned", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gfa-symlink-"));
  fs.mkdirSync(tmpDir, { recursive: true });
  const target = path.join(tmpDir, "does-not-exist-target.js");
  const linkPath = path.join(tmpDir, "dangling-link.js");
  try {
    fs.symlinkSync(target, linkPath, "file");
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    t.skip("could not create a symlink on this machine/permission set — guard not assessable here");
    return;
  }
  const { scanned, unreadable } = walkJsFiles(tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  assert.equal(scanned.length, 0, "dangling symlink must not count as successfully scanned");
  assert.ok(unreadable.length >= 1, "dangling symlink must be recorded as unreadable, not silently dropped");
});

test("blindness guard 2: unreadable/malformed settings.json yields wired='unknown', never collapsed to false", () => {
  const fakeRepoRoot = FIXTURE_DIR;
  const status = getWiredStatus(fakeRepoRoot, "scripts/checks/gate-failclosed-audit.js");
  assert.equal(status, "unknown", "missing settings.json must yield 'unknown', not false");
});

test("real-repo self-scan produces a list (never a bare count) and reports the ceiling text", () => {
  const { report } = runAudit("scripts/checks");
  assert.ok(Array.isArray(report.findings));
  assert.ok(typeof report.ceiling === "string" && report.ceiling.length > 0);
  assert.ok(typeof report.property === "string" && report.property.length > 0);
  for (const f of report.findings) {
    assert.ok(f.file && typeof f.line === "number");
  }
});
