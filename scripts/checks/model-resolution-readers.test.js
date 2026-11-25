"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const R = require("./model-resolution-readers");

const REPO = path.resolve(__dirname, "..", "..");

function fakeRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mrr-"));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const census = (readers) => JSON.stringify({ patterns: ["getProviderForRole\\(", "provider_model"], readers });

test("the shipped census lists every reader; no second reader of the sign-in record", () => {
  const r = R.findUnlistedReaders({ root: REPO });
  assert.deepEqual([r.unlisted, r.stale, r.bad], [[], [], []]);
  assert.ok(r.counts.routed >= 5);
  const s = R.findSigninCacheReaders({ root: REPO });
  assert.deepEqual(s.offenders, []);
});

test("RED: a new file that picks a provider and is not in the census is named", () => {
  const root = fakeRoot({
    [R.CENSUS_REL]: census({ "scripts/known.js": { class: "routed", reason: "x" } }),
    "scripts/known.js": "getProviderForRole(role)",
    "scripts/sneaky.js": "const p = getProviderForRole(role); run(p)",
    "scripts/sneaky.test.js": "getProviderForRole(role)",
    "scripts/quiet.js": "module.exports = 1;",
  });
  const r = R.findUnlistedReaders({ root });
  assert.deepEqual(r.unlisted, ["scripts/sneaky.js"]);
  assert.equal(r.ok, false);
});

test("RED: a stale row and a row with a bad class are named", () => {
  const root = fakeRoot({
    [R.CENSUS_REL]: census({ "scripts/gone.js": { class: "routed", reason: "x" }, "scripts/a.js": { class: "maybe", reason: "x" } }),
    "scripts/a.js": "provider_model",
  });
  const r = R.findUnlistedReaders({ root });
  assert.deepEqual([r.stale, r.bad], [["scripts/gone.js"], ["scripts/a.js"]]);
});

test("RED: a second reader of the sign-in record (by key or by file name) is named", () => {
  const root = fakeRoot({
    "scripts/dispatch/model-resolve.js": "PATHS.modelSigninCache",
    "scripts/dispatch/signin.js": "PATHS.modelSigninCache",
    "scripts/hooks/peek.js": "const f = PATHS.modelSigninCache; JSON.parse(read(f))",
    "scripts/other.js": "read('.claude/runtime/model-signin.json')",
    ".claude/paths.json": "{\"modelSigninCache\": \"x\"}",
  });
  const s = R.findSigninCacheReaders({ root, fileNames: ["model-signin.json"] });
  assert.deepEqual(s.offenders.sort(), ["scripts/hooks/peek.js", "scripts/other.js"]);
});
