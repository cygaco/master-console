"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { validate, oneSentence, loadOpenEdIds } = require("./golden-paths-validate");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(__dirname, "golden-paths-validate.js");
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "golden-paths", "sample.json"), "utf8"));

const clone = (o) => JSON.parse(JSON.stringify(o));
const allExist = () => true;
const codes = (r) => r.findings.map((f) => f.code);
const OPEN = new Set(["ED-999444"]);

test("the shipped sample glossary is valid on disk (real existsSync)", () => {
  const r = validate(REAL, { root: ROOT, openEdIds: OPEN });
  assert.deepStrictEqual(r.findings, []);
  assert.ok(r.featureCount >= 6);
});

test("CLI: real file exits 0 unpiped", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--file", path.join(__dirname, "fixtures", "golden-paths", "sample.json"), "--ledger", path.join(ROOT, "no-such-ledger.jsonl")], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ed_ledger_unavailable/);
});

test("CLI: unparseable file exits 2 (runner error, fail-closed)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--file", path.join(ROOT, "no-such.json")], { encoding: "utf8" });
  assert.strictEqual(r.status, 2);
});

test("CLI: no --file and no default glossary prints one SKIP line and exits 0", () => {
  const root = fs.mkdtempSync(path.join(require("os").tmpdir(), "gp-root-"));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8", cwd: root });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(r.stdout, "golden-paths-validate: SKIP no Golden Features glossary at paths.goldenPaths — nothing to validate\n");
    assert.strictEqual(r.stderr, "");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI: a present but malformed default glossary still exits 2 (fail-closed)", () => {
  const root = fs.mkdtempSync(path.join(require("os").tmpdir(), "gp-root-"));
  try {
    fs.mkdirSync(path.join(root, "_planning"));
    fs.writeFileSync(path.join(root, "_planning", "golden-paths.json"), "{ not json");
    const r = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8", cwd: root });
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /SKIP/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI: findings exit 1", () => {
  const tmp = path.join(require("os").tmpdir(), `gp-${process.pid}.json`);
  const bad = clone(REAL); bad.features = bad.features.slice(0, 2);
  fs.writeFileSync(tmp, JSON.stringify(bad));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, "--file", tmp], { encoding: "utf8" });
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /too_few_features/);
  } finally { fs.rmSync(tmp, { force: true }); }
});

test("missing entry path is refused", () => {
  const d = clone(REAL);
  d.features[0].entry.push("scripts/does-not-exist.js");
  assert.ok(codes(validate(d, { root: ROOT, openEdIds: OPEN })).includes("entry_missing"));
});

test("missing smoke test path is refused", () => {
  const d = clone(REAL);
  d.features[1].smoke_tests.push("scripts/sprint/nope.test.js");
  assert.ok(codes(validate(d, { root: ROOT, openEdIds: OPEN })).includes("smoke_missing"));
});

test("fewer than 6 features is refused; exactly 6 passes (the boundary)", () => {
  const d = clone(REAL);
  d.features = d.features.slice(0, 5);
  assert.ok(codes(validate(d, { exists: allExist, openEdIds: OPEN })).includes("too_few_features"));
  assert.ok(!codes(validate(clone(REAL), { exists: allExist, openEdIds: OPEN })).includes("too_few_features"));
});

test("zero features is refused, never a pass", () => {
  const d = clone(REAL); d.features = [];
  assert.ok(codes(validate(d, { exists: allExist })).includes("too_few_features"));
});

test("golden_path near-misses are refused (not one sentence)", () => {
  for (const bad of ["", "no terminator at all here", "First sentence. Second sentence.", "Ends with colon:", 7, null]) {
    const d = clone(REAL); d.features[0].golden_path = bad;
    assert.ok(codes(validate(d, { exists: allExist, openEdIds: OPEN })).includes("golden_path_not_sentence"), String(bad));
  }
  assert.strictEqual(oneSentence("It works, e.g. in CI, and ships."), true);
  assert.strictEqual(oneSentence("It works!"), false);
});

test("empty smoke_tests without an ED id is refused; malformed id too", () => {
  for (const ed of [undefined, "", "ED-", "ed-444", "444", 444]) {
    const d = clone(REAL);
    const f = d.features.find((x) => x.smoke_tests.length === 0);
    if (ed === undefined) delete f.enforcement_debt; else f.enforcement_debt = ed;
    assert.ok(codes(validate(d, { exists: allExist, openEdIds: OPEN })).includes("smoke_gap_undeclared"), String(ed));
  }
});

test("empty smoke_tests naming an ED id absent from / closed in the ledger is refused", () => {
  assert.ok(codes(validate(clone(REAL), { exists: allExist, openEdIds: new Set(["ED-999001"]) })).includes("smoke_gap_ed_unknown"));
});

test("unavailable ledger is UNKNOWN (note), not a pass-claim; --strict-ledger makes it a finding", () => {
  const soft = validate(clone(REAL), { exists: allExist, openEdIds: null });
  assert.deepStrictEqual(soft.findings, []);
  assert.match(soft.notes.join(" "), /ed_ledger_unavailable/);
  const strict = validate(clone(REAL), { exists: allExist, openEdIds: null, strictLedger: true });
  assert.ok(codes(strict).includes("smoke_gap_ed_unknown"));
});

test("unsafe paths are refused", () => {
  for (const p of ["../outside.js", "/etc/passwd", "C:\\x.js", "scripts/../../x.js"]) {
    const d = clone(REAL); d.features[0].entry.push(p);
    assert.ok(codes(validate(d, { exists: allExist, openEdIds: OPEN })).includes("path_unsafe"), p);
  }
});

test("schema mismatch, duplicate id, malformed feature, bad globs", () => {
  let d = clone(REAL); d.schema = "mc/golden-paths/v0";
  assert.ok(codes(validate(d, { exists: allExist, openEdIds: OPEN })).includes("schema_mismatch"));
  d = clone(REAL); d.features[1].id = d.features[0].id;
  assert.ok(codes(validate(d, { exists: allExist, openEdIds: OPEN })).includes("duplicate_feature_id"));
  d = clone(REAL); delete d.features[2].security_surface;
  assert.ok(codes(validate(d, { exists: allExist, openEdIds: OPEN })).includes("feature_malformed"));
  d = clone(REAL); d.security_surface_globs = [];
  assert.ok(codes(validate(d, { exists: allExist, openEdIds: OPEN })).includes("globs_malformed"));
  d = clone(REAL); d.security_surface_globs = ["ok/**", 5];
  assert.ok(codes(validate(d, { exists: allExist, openEdIds: OPEN })).includes("globs_malformed"));
  assert.ok(codes(validate(null, {})).includes("schema_mismatch"));
});

test("loadOpenEdIds: later closure row overrides; unreadable file is null", () => {
  const tmp = path.join(require("os").tmpdir(), `ed-${process.pid}.jsonl`);
  fs.writeFileSync(tmp, '{"id":"ED-999001","status":"open"}\nnot json\n{"id":"ED-999002","status":"open"}\n{"id":"ED-999002","status":"enforced"}\n');
  try {
    assert.deepStrictEqual([...loadOpenEdIds(tmp)], ["ED-999001"]);
  } finally { fs.rmSync(tmp, { force: true }); }
  assert.strictEqual(loadOpenEdIds(path.join(ROOT, "nope.jsonl")), null);
});

test("paths.goldenPaths resolves to the glossary file in the generated registry", () => {
  const { PATHS } = require(path.join(ROOT, "scripts", "hooks", "lib", "paths"));
  assert.strictEqual(path.resolve(PATHS.goldenPaths), path.join(ROOT, "_planning", "golden-paths.json"));
});
