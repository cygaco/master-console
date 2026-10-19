"use strict";
// FALSIFIER: AC-F9 acceptance-read choke-point BYPASS — record-trust gate, surface acceptance-record-at-integration.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const GUARD = path.join(ROOT, "scripts", "checks", "acceptance-read-choke-point.js");
const os = require("os");
function seedFixtureRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acc-bypass-"));
  const f = path.join(dir, "scripts", "dispatch", "unrouted-integrator.js");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "\"use strict\";\n// Synthetic un-routed integrator: authorizes a MERGE on a ResultEnvelope's `.success` WITHOUT routing through\n// acceptance-record.authorizesIntegration (the SP-TEST-004 \"un-routed reader\" class).\nfunction integrate(resultEnvelope, targetRef) {\n  if (resultEnvelope.success === true) {\n    return mergeIntoIntegrationHead(targetRef);\n  }\n  return false;\n}\nfunction mergeIntoIntegrationHead(_ref) {\n  return true;\n}\nmodule.exports = { integrate };\n", "utf8");
  return dir;
}

test("AC-F9 un-routed integrator (reads envelope.success, no authorizesIntegration) MUST-BLOCK — guard flags it", (t) => {
  const { scan } = require(GUARD);
  const res = scan(seedFixtureRoot());
  const flagged = (res.violations || []).some((v) => /unrouted-integrator\.js/.test(v.file || ""));
  assert.strictEqual(
    flagged,
    true,
    "MUST-BLOCK: the structural guard must flag an integrator that authorizes a merge on envelope.success without routing through authorizesIntegration",
  );
});
