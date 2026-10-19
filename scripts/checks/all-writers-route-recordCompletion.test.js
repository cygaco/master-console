"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test } = require("node:test");
const assert = require("node:assert");

const { scan } = require("./all-writers-route-recordCompletion");

const ROOT = path.resolve(__dirname, "..", "..");

function tmpFixtureRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `awrrc-${tag}-`));
  fs.mkdirSync(path.join(dir, "scripts", "dispatch"), { recursive: true });
  return dir;
}

function write(dir, rel, body) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
  return abs;
}

test("HAPPY/binding: scanning the seeded bypass-writer fixture root flags bypassing-writer.js", () => {
  const fixtureRoot = tmpFixtureRoot("seeded-bypass-writer");
  write(fixtureRoot, path.join("scripts", "dispatch", "bypassing-writer.js"), "\"use strict\";\n// Synthetic planted writer: bypasses the recordCompletion sink, appending a raw record straight to the ledger.\nconst fs = require(\"fs\");\nconst path = require(\"path\");\nfunction bypassWrite(role, provider, ok) {\n  const file = path.join(__dirname, \"..\", \"..\", \".claude\", \"runtime\", \"dispatch-completions.jsonl\");\n  const record = { dispatch_id: `bypass-${Date.now()}`, role, provider, ok, phase: \"completed\" };\n  fs.appendFileSync(file, JSON.stringify(record) + \"\n\");\n  return file;\n}\nmodule.exports = { bypassWrite };\n");
  const res = scan(fixtureRoot);
  const flagged = res.violations.some((v) => /bypassing-writer\.js/.test(v.file || ""));
  assert.strictEqual(flagged, true, "the seeded bypassing writer must be flagged");
});

test("ADVERSARIAL: a freshly-authored writer that resolves PATHS.dispatchCompletionsFile inline and appends is flagged", () => {
  const dir = tmpFixtureRoot("adversarial-inline");
  write(
    dir,
    path.join("scripts", "dispatch", "brand-new-bypass.js"),
    `"use strict";\nconst fs = require("fs");\nconst { PATHS } = require("../hooks/lib/paths");\nfunction emit(rec) {\n  fs.appendFileSync(PATHS.dispatchCompletionsFile, JSON.stringify(rec) + "\\n");\n}\nmodule.exports = { emit };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.some((v) => /brand-new-bypass\.js/.test(v.file)), true);
});

test("ADVERSARIAL: writeFileSync (not just appendFileSync) to a ledger-bound variable is also flagged", () => {
  const dir = tmpFixtureRoot("adversarial-writefilesync");
  write(
    dir,
    path.join("scripts", "dispatch", "overwrite-bypass.js"),
    `"use strict";\nconst fs = require("fs");\nconst path = require("path");\nfunction reset() {\n  const ledgerFile = path.join(__dirname, "dispatch-completions.jsonl");\n  fs.writeFileSync(ledgerFile, "");\n}\nmodule.exports = { reset };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.some((v) => /overwrite-bypass\.js/.test(v.file)), true);
});

test("HAPPY: a writer that imports and calls recordCompletion (no raw fs write of its own) is clean", () => {
  const dir = tmpFixtureRoot("compliant");
  write(
    dir,
    path.join("scripts", "dispatch", "routed-writer.js"),
    `"use strict";\nconst { recordCompletion } = require("../dispatch-agent");\nfunction emit(rec) {\n  recordCompletion(rec); // routes through the single sink; no raw fs write here\n}\nmodule.exports = { emit };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.some((v) => /routed-writer\.js/.test(v.file)), false);
});

test("HAPPY: a raw fs write in a ledger-mentioning file is clean when its target correlates to an UNRELATED file", () => {
  const dir = tmpFixtureRoot("unrelated-write");
  write(
    dir,
    path.join("scripts", "dispatch", "artifact-writer.js"),
    `"use strict";\n// reads paths.dispatchCompletionsFile elsewhere in this file for reporting only\nconst fs = require("fs");\nconst path = require("path");\nfunction readLedgerPathForReport() {\n  return require("../hooks/lib/paths").PATHS.dispatchCompletionsFile;\n}\nfunction writeArtifact(dir2, data) {\n  const file = path.join(dir2, "report.json");\n  fs.writeFileSync(file, JSON.stringify(data));\n}\nmodule.exports = { readLedgerPathForReport, writeArtifact };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.some((v) => /artifact-writer\.js/.test(v.file)), false);
});

test("out-of-scope: a file with raw fs writes but NO ledger reference at all is never flagged", () => {
  const dir = tmpFixtureRoot("no-ledger-ref");
  write(
    dir,
    path.join("scripts", "dispatch", "unrelated.js"),
    `"use strict";\nconst fs = require("fs");\nfunction save(p, d) {\n  fs.writeFileSync(p, d);\n}\nmodule.exports = { save };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.length, 0);
});

test("the guard excludes dispatch-agent.js (the sink) and dispatch-record-fields.js (the pure builder module)", () => {
  const res = scan(ROOT);
  assert.strictEqual(res.violations.some((v) => /(^|\/)dispatch-agent\.js$/.test(v.file)), false);
  assert.strictEqual(res.violations.some((v) => /dispatch-record-fields\.js$/.test(v.file)), false);
});

test("the guard excludes itself from the scan", () => {
  const res = scan(ROOT);
  assert.strictEqual(res.violations.some((v) => /all-writers-route-recordCompletion\.js$/.test(v.file)), false);
});

test("*.test.js files are never scanned (a test fixture/scratch ledger write is not a production writer)", () => {
  const dir = tmpFixtureRoot("test-file-excluded");
  write(
    dir,
    path.join("scripts", "dispatch", "would-be-bypass.test.js"),
    `"use strict";\nconst fs = require("fs");\nfunction emit(file, rec) {\n  fs.appendFileSync(file, JSON.stringify(rec)); // file === dispatch-completions.jsonl in this test scratch\n}\nmodule.exports = { emit };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.length, 0);
});

test("the live scripts/ tree has zero all-writers-route-recordCompletion violations today", () => {
  const res = scan(ROOT);
  assert.deepStrictEqual(res.violations, []);
});

test("CLI: exits 0 clean on the real tree, --json emits a parseable {violations} shape", () => {
  const { spawnSync } = require("node:child_process");
  const r = spawnSync(process.execPath, [path.join(__dirname, "all-writers-route-recordCompletion.js"), "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.deepStrictEqual(parsed.violations, []);
});

test("CLI: the exported scan() the CLI calls is the same function exercised by the adversarial tests above", () => {
  const mod = require("./all-writers-route-recordCompletion");
  assert.strictEqual(typeof mod.scan, "function");
  const dir = tmpFixtureRoot("cli-parity");
  write(
    dir,
    path.join("scripts", "dispatch", "cli-parity-bypass.js"),
    `"use strict";\nconst fs = require("fs");\nfunction emit(rec) {\n  const file = "dispatch-completions.jsonl";\n  fs.appendFileSync(file, JSON.stringify(rec));\n}\nmodule.exports = { emit };\n`,
  );
  const res = mod.scan(dir);
  assert.strictEqual(res.violations.length > 0, true);
});

test("a NESTED ledger ref inside path.resolve(...) is caught", () => {
  const dir = tmpFixtureRoot("nested");
  write(
    dir,
    path.join("scripts", "dispatch", "nested-bypass.js"),
    `"use strict";\nconst fs = require("fs");\nconst path = require("path");\nconst { PATHS } = require("./lib/paths");\nfunction emit(rec) {\n  fs.appendFileSync(path.resolve(PATHS.dispatchCompletionsFile), JSON.stringify(rec));\n}\nmodule.exports = { emit };\n`,
  );
  const res = scan(dir);
  assert.ok(res.violations.some((v) => /nested-bypass\.js/.test(v.file)), "path.resolve(PATHS.dispatchCompletionsFile) must be flagged");
});

test("an ASYNC fs.promises.appendFile to the ledger is caught", () => {
  const dir = tmpFixtureRoot("async");
  write(
    dir,
    path.join("scripts", "dispatch", "async-bypass.js"),
    `"use strict";\nconst fsp = require("fs").promises;\nconst { PATHS } = require("./lib/paths");\nasync function emit(rec) {\n  await fsp.appendFile(PATHS.dispatchCompletionsFile, JSON.stringify(rec));\n}\nmodule.exports = { emit };\n`,
  );
  const res = scan(dir);
  assert.ok(res.violations.some((v) => /async-bypass\.js/.test(v.file)), "fs.promises.appendFile to the ledger must be flagged");
});

test("a bare appendFile(...) application function (no fs namespace) is NOT flagged", () => {
  const dir = tmpFixtureRoot("bare-appendfile");
  write(
    dir,
    path.join("scripts", "dispatch", "unrelated-appendfile.js"),
    `"use strict";\n// references the ledger name so the file IS scanned, but the write is to an fs-less app fn\nconst LEDGER = "dispatch-completions";\nfunction appendFile(buf, row) { buf.rows.push(row); return buf; }\nfunction use(b) { return appendFile(b, LEDGER); }\nmodule.exports = { appendFile, use };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.some((v) => /unrelated-appendfile\.js/.test(v.file)), false, "a bare appendFile() app fn must NOT trip the guard");
});

test("fs.createWriteStream(ledger) is caught (another raw sink)", () => {
  const dir = tmpFixtureRoot("cws");
  write(
    dir,
    path.join("scripts", "dispatch", "cws-bypass.js"),
    `"use strict";\nconst fs = require("fs");\nconst { PATHS } = require("./lib/paths");\nfunction emit() {\n  const s = fs.createWriteStream(PATHS.dispatchCompletionsFile, { flags: "a" });\n  s.write("x");\n}\nmodule.exports = { emit };\n`,
  );
  const res = scan(dir);
  assert.ok(res.violations.some((v) => /cws-bypass\.js/.test(v.file)), "fs.createWriteStream to the ledger must be flagged");
});
