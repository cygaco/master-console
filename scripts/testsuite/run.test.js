"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const RUN_JS = path.join(__dirname, "run.js");
const REGISTRY = path.join(REPO, "_requirements", "07-testing", "recurring-bug-classes.json");
const MARKER = "mc/public-repo-generated/v1";

const STUB_DETECTOR = [
  "const fs = require('fs');",
  "const path = require('path');",
  "const manifest = path.join(process.cwd(), '_mc', 'MANIFEST.json');",
  "if (!fs.existsSync(manifest)) {",
  "  process.stderr.write('manifest not found\\n');",
  "  process.exit(2);",
  "}",
  "if (fs.readFileSync(manifest, 'utf8').includes('drift')) {",
  "  process.stdout.write('drift: 1\\n');",
  "  process.exit(1);",
  "}",
  "process.exit(0);",
  "",
].join("\n");

function realBc02() {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8").replace(/^﻿/, ""));
  const row = reg.classes.find((c) => c.id === "BC-02");
  assert.ok(row, "BC-02 row present in the registry");
  return JSON.parse(JSON.stringify(row));
}

function makeTree(t, { marker, manifest, mutateRow }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-testsuite-run-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, body) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  fs.mkdirSync(path.join(root, "scripts", "testsuite"), { recursive: true });
  fs.copyFileSync(RUN_JS, path.join(root, "scripts", "testsuite", "run.js"));
  const row = realBc02();
  if (mutateRow) mutateRow(row);
  write("_requirements/07-testing/recurring-bug-classes.json", JSON.stringify({ classes: [row] }, null, 2));
  write("scripts/mc/manifest/validate.js", STUB_DETECTOR);
  if (marker != null) write("ci/GENERATED", marker);
  if (manifest) write("_mc/MANIFEST.json", manifest === "drift" ? '{ "drift": true }\n' : "{}\n");
  return root;
}

function runSuite(root, args) {
  return cp.spawnSync(process.execPath, [path.join(root, "scripts", "testsuite", "run.js"), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
}

function bc02(root) {
  const r = runSuite(root, ["--json"]);
  const out = JSON.parse(r.stdout);
  return { status: r.status, row: out.results.find((x) => x.id === "BC-02"), summary: out.summary };
}

const REASON = "this product tree does not ship _mc/MANIFEST.json";

test("BC-02 row declares its n/a condition: the generated-product marker AND no _mc/MANIFEST.json", () => {
  const row = realBc02();
  assert.deepEqual(row.detector.na_when, {
    file_first_line: { path: "ci/GENERATED", equals: MARKER },
    file_absent: "_mc/MANIFEST.json",
    reason: REASON,
  });
  assert.equal(row.detector.expect_canonical, "pass");
});

test("(a) product-shaped tree (ci/GENERATED marker, no _mc/MANIFEST.json) reports BC-02 n/a, not FAIL", (t) => {
  const root = makeTree(t, { marker: `${MARKER}\nsecond line: not part of the marker\n`, manifest: false });
  const { status, row, summary } = bc02(root);
  assert.equal(row.result, "na");
  assert.equal(row.reason, REASON);
  assert.equal(summary.regressions, 0);
  assert.equal(status, 0);
  const human = runSuite(root, []);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /\[n\/a \] BC-02 .*n\/a: this product tree does not ship _mc\/MANIFEST\.json/);
});

test("(d) a generated tree WITH a drifted _mc/MANIFEST.json still FAILS BC-02", (t) => {
  const root = makeTree(t, { marker: `${MARKER}\n`, manifest: "drift" });
  const { status, row, summary } = bc02(root);
  assert.equal(row.result, "fail");
  assert.equal(row.exit, 1);
  assert.equal(row.reason, undefined);
  assert.equal(summary.regressions, 1);
  assert.equal(status, 1);
});

test("(e) an unknown na_when key keeps the BC-02 failure", (t) => {
  const root = makeTree(t, {
    marker: `${MARKER}\n`,
    manifest: false,
    mutateRow: (row) => { row.detector.na_when.unknown_condition = true; },
  });
  const { status, row } = bc02(root);
  assert.equal(row.result, "fail");
  assert.equal(row.reason, undefined);
  assert.equal(status, 1);
});

test("(e) an unknown key inside file_first_line keeps the BC-02 failure", (t) => {
  const root = makeTree(t, {
    marker: `${MARKER}\n`,
    manifest: false,
    mutateRow: (row) => { row.detector.na_when.file_first_line.unknown_option = true; },
  });
  assert.equal(bc02(root).row.result, "fail");
});

test("(e) an na_when without a reason keeps the BC-02 failure", (t) => {
  const root = makeTree(t, {
    marker: `${MARKER}\n`,
    manifest: false,
    mutateRow: (row) => { delete row.detector.na_when.reason; },
  });
  assert.equal(bc02(root).row.result, "fail");
});

test("(a) the marker matches with CRLF line endings too", (t) => {
  const root = makeTree(t, { marker: `${MARKER}\r\nsecond line: not part of the marker\r\n`, manifest: false });
  assert.equal(bc02(root).row.result, "na");
});

test("(b) instance-shaped tree with the manifest removed (no ci/GENERATED) still FAILS BC-02", (t) => {
  const root = makeTree(t, { marker: null, manifest: false });
  const { status, row, summary } = bc02(root);
  assert.equal(row.result, "fail");
  assert.equal(row.exit, 2);
  assert.equal(row.reason, undefined);
  assert.equal(summary.regressions, 1);
  assert.equal(status, 1);
});

test("(b) a ci/GENERATED whose first line is not the marker does not make BC-02 n/a", (t) => {
  const root = makeTree(t, { marker: `not-the-marker\n${MARKER}\n`, manifest: false });
  const { status, row } = bc02(root);
  assert.equal(row.result, "fail");
  assert.equal(status, 1);
});

test("(c) instance-shaped tree with the manifest present passes BC-02 as before", (t) => {
  const root = makeTree(t, { marker: null, manifest: true });
  const { status, row } = bc02(root);
  assert.equal(row.result, "pass");
  assert.equal(row.reason, undefined);
  assert.equal(status, 0);
});

test("a product-shaped tree whose detector passes reports pass, not n/a", (t) => {
  const root = makeTree(t, { marker: `${MARKER}\n`, manifest: true });
  assert.equal(bc02(root).row.result, "pass");
});
