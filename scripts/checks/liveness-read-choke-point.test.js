"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { scan } = require("./liveness-read-choke-point");

function tmpRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lrcp-"));
  fs.mkdirSync(path.join(d, "scripts", "checks"), { recursive: true });
  return d;
}
const write = (root, rel, body) => fs.writeFileSync(path.join(root, "scripts", "checks", rel), body);

test("CATCHES a new same-session reader that reads dispatch-completions + gates on ok:true without verifying", () => {
  const root = tmpRoot();
  write(root, "bad-reader.js", 'const f = readFile("dispatch-completions.jsonl");\nconst ran = recs.some((r) => r.ok === true);\n');
  const res = scan(root);
  assert.ok(res.violations.some((v) => v.file.endsWith("bad-reader.js")), "the unverified reader must be flagged");
});

test("PASSES a reader that verifies via the choke-point (isVerifiedLivenessRecord)", () => {
  const root = tmpRoot();
  write(root, "good-reader.js", 'const f = readFile("dispatch-completions.jsonl");\nconst ran = recs.some((r) => isVerifiedLivenessRecord(r));\n// r.ok === true is inside the helper\nconst x = somerec.ok === true;\n');
  const res = scan(root);
  assert.ok(!res.violations.some((v) => v.file.endsWith("good-reader.js")), "a verifying reader must be clean");
});

test("PASSES a reader that verifies via attest-signing.verifyRecord directly", () => {
  const root = tmpRoot();
  write(root, "direct-verify.js", 'const f = readCompletions("dispatch-completions.jsonl");\nconst ok = verifyRecord(r) && r.ok === true;\n');
  const res = scan(root);
  assert.ok(!res.violations.some((v) => v.file.endsWith("direct-verify.js")));
});

test("IGNORES a file that reads the ledger but does NOT gate on a record's .ok (not a liveness gate)", () => {
  const root = tmpRoot();
  write(root, "compactor.js", 'const lines = readFile("dispatch-completions.jsonl");\nreturn { ok: true, compacted: lines.length };\n');
  const res = scan(root);
  assert.ok(!res.violations.some((v) => v.file.endsWith("compactor.js")), "an ok:true RETURN value is not a record gate");
});

test("the LIVE canonical tree passes the guard (every same-session reader verifies)", () => {
  const res = scan();
  assert.strictEqual(res.violations.length, 0, `canonical has unverified readers: ${JSON.stringify(res.violations)}`);
  assert.strictEqual(res.staleExempt.length, 0, `stale cross-session exemptions: ${res.staleExempt.join(", ")}`);
});
