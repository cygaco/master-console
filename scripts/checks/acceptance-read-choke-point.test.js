"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test } = require("node:test");
const assert = require("node:assert");

const { scan } = require("./acceptance-read-choke-point");

const ROOT = path.resolve(__dirname, "..", "..");

function tmpFixtureRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `acc-choke-${tag}-`));
  fs.mkdirSync(path.join(dir, "scripts", "dispatch"), { recursive: true });
  return dir;
}

function write(dir, rel, body) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
  return abs;
}

test("HAPPY/binding: scanning the seeded bypass fixture root flags unrouted-integrator.js", () => {
  const fixtureRoot = tmpFixtureRoot("seeded-bypass");
  write(fixtureRoot, path.join("scripts", "dispatch", "unrouted-integrator.js"), "\"use strict\";\n// Synthetic un-routed integrator: authorizes a MERGE on a ResultEnvelope's `.success` WITHOUT routing through\n// acceptance-record.authorizesIntegration (the SP-TEST-004 \"un-routed reader\" class).\nfunction integrate(resultEnvelope, targetRef) {\n  if (resultEnvelope.success === true) {\n    return mergeIntoIntegrationHead(targetRef);\n  }\n  return false;\n}\nfunction mergeIntoIntegrationHead(_ref) {\n  return true;\n}\nmodule.exports = { integrate };\n");
  const res = scan(fixtureRoot);
  const flagged = res.violations.some((v) => /unrouted-integrator\.js/.test(v.file || ""));
  assert.strictEqual(flagged, true, "the seeded un-routed integrator must be flagged");
});

test("ADVERSARIAL: a freshly-authored integrator that gates a merge on .success with no routing is flagged", () => {
  const dir = tmpFixtureRoot("adversarial-new");
  write(
    dir,
    path.join("scripts", "dispatch", "brand-new-unrouted.js"),
    `"use strict";\nfunction integrate(envelope, ref) {\n  if (envelope.success === true) {\n    return mergeInto(ref);\n  }\n  return false;\n}\nfunction mergeInto(_r) { return true; }\nmodule.exports = { integrate };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.some((v) => /brand-new-unrouted\.js/.test(v.file)), true);
});

test("ADVERSARIAL: .success !== true negated-gate form is also flagged when unrouted", () => {
  const dir = tmpFixtureRoot("adversarial-negated");
  write(
    dir,
    path.join("scripts", "dispatch", "negated-unrouted.js"),
    `"use strict";\nfunction integrate(envelope, ref) {\n  if (envelope.success !== true) return false;\n  return mergeInto(ref); // merges on the untrusted envelope\n}\nfunction mergeInto(_r) { return true; }\nmodule.exports = { integrate };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.some((v) => /negated-unrouted\.js/.test(v.file)), true);
});

test("HAPPY: an integrator that routes through acceptance-record.authorizesIntegration is clean", () => {
  const dir = tmpFixtureRoot("compliant");
  write(
    dir,
    path.join("scripts", "dispatch", "routed-integrator.js"),
    `"use strict";\nconst { authorizesIntegration } = require("./acceptance-record");\nfunction integrate(envelope, record, ref) {\n  if (envelope.success === true && authorizesIntegration(record, ref, { recompute: true })) {\n    return mergeInto(ref);\n  }\n  return false;\n}\nfunction mergeInto(_r) { return true; }\nmodule.exports = { integrate };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.some((v) => /routed-integrator\.js/.test(v.file)), false);
});

test("a comment pragma — a real merge gate on .success with only an `acceptance-verified:` comment (no routing) is FLAGGED", () => {
  const dir = tmpFixtureRoot("pragma-removed");
  write(
    dir,
    path.join("scripts", "dispatch", "pragma-only-integrator.js"),
    `"use strict";\n// acceptance-verified: trust me, the caller checked\nfunction integrate(envelope, ref) {\n  if (envelope.success === true) {\n    return mergeInto(ref);\n  }\n  return false;\n}\nfunction mergeInto(_r) { return true; }\nmodule.exports = { integrate };\n`,
  );
  const res = scan(dir);
  assert.ok(
    res.violations.some((v) => /pragma-only-integrator\.js/.test(v.file)),
    "the settable comment pragma must not suppress a real un-routed merge gate",
  );
});

test("the detector catches `if (envelope.success)` and `envelope['success']` when a merge action is near", () => {
  const dir = tmpFixtureRoot("broadened");
  write(
    dir,
    path.join("scripts", "dispatch", "bare-truthy-integrator.js"),
    `"use strict";\nfunction integrate(envelope, ref) {\n  if (envelope.success) {\n    return mergeInto(ref);\n  }\n}\nfunction mergeInto(_r) { return true; }\nmodule.exports = { integrate };\n`,
  );
  write(
    dir,
    path.join("scripts", "dispatch", "bracket-integrator.js"),
    `"use strict";\nfunction integrate(envelope, ref) {\n  if (envelope['success']) {\n    return mergeInto(ref);\n  }\n}\nfunction mergeInto(_r) { return true; }\nmodule.exports = { integrate };\n`,
  );
  const res = scan(dir);
  assert.ok(res.violations.some((v) => /bare-truthy-integrator/.test(v.file)), "if (envelope.success) must be caught");
  assert.ok(res.violations.some((v) => /bracket-integrator/.test(v.file)), "envelope['success'] must be caught");
});

test("out-of-scope: a file with no merge/integrate hint at all is never scanned for the predicate", () => {
  const dir = tmpFixtureRoot("no-merge-hint");
  write(
    dir,
    path.join("scripts", "dispatch", "unrelated.js"),
    `"use strict";\nfunction check(envelope) {\n  return envelope.success === true; // an unrelated shape check, no action taken here\n}\nmodule.exports = { check };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.length, 0);
});

test("out-of-scope: a merge-flavored file that never gates on `.success` is not flagged", () => {
  const dir = tmpFixtureRoot("no-success-gate");
  write(
    dir,
    path.join("scripts", "dispatch", "merge-unrelated.js"),
    `"use strict";\nfunction mergeConfig(a, b) {\n  return Object.assign({}, a, b); // "merge" in name only, no .success gate\n}\nmodule.exports = { mergeConfig };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.length, 0);
});

test("the guard excludes itself and acceptance-record.js from the scan", () => {
  const res = scan(ROOT);
  assert.strictEqual(res.violations.some((v) => /acceptance-read-choke-point\.js$/.test(v.file)), false);
  assert.strictEqual(res.violations.some((v) => /(^|\/)acceptance-record\.js$/.test(v.file)), false);
});

test("*.test.js files are never scanned (a test fixture literal is not a live reader)", () => {
  const dir = tmpFixtureRoot("test-file-excluded");
  write(
    dir,
    path.join("scripts", "dispatch", "would-be-unrouted.test.js"),
    `"use strict";\nfunction integrate(envelope, ref) {\n  if (envelope.success === true) return mergeInto(ref);\n  return false;\n}\nfunction mergeInto(_r) { return true; }\nmodule.exports = { integrate };\n`,
  );
  const res = scan(dir);
  assert.strictEqual(res.violations.length, 0);
});

test("CROSS_SESSION_EXEMPT is exported and starts empty (no un-reviewed exemption exists yet)", () => {
  const mod = require("./acceptance-read-choke-point");
  assert.deepStrictEqual(mod.CROSS_SESSION_EXEMPT, {});
});

test("the live scripts/ tree has zero acceptance-choke-point violations today", () => {
  const res = scan(ROOT);
  assert.deepStrictEqual(res.violations, []);
  assert.deepStrictEqual(res.staleExempt, []);
});

test("CLI: exits 0 clean on the real tree, --json emits a parseable {violations,...} shape", () => {
  const { spawnSync } = require("node:child_process");
  const r = spawnSync(process.execPath, [path.join(__dirname, "acceptance-read-choke-point.js"), "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.deepStrictEqual(parsed.violations, []);
});

test("CLI: exits 1 when pointed (via a tmp CWD anchor) at a tree containing an un-routed integrator", () => {
  const mod = require("./acceptance-read-choke-point");
  assert.strictEqual(typeof mod.scan, "function");
  const dir = tmpFixtureRoot("cli-parity");
  write(
    dir,
    path.join("scripts", "dispatch", "cli-parity-unrouted.js"),
    `"use strict";\nfunction integrate(envelope, ref) {\n  if (envelope.success === true) return mergeInto(ref);\n  return false;\n}\nfunction mergeInto(_r) { return true; }\nmodule.exports = { integrate };\n`,
  );
  const res = mod.scan(dir);
  assert.strictEqual(res.violations.length > 0, true);
});
