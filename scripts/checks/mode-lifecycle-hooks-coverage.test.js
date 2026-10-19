"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { loadAllowlistSchema, versionGte, readFrameworkVersion, DEFAULT_ALLOWLIST, readJson } = require("./mode-lifecycle-hooks-coverage.js");

const NOW = new Date("2030-06-15T12:00:00Z");
const entry = (extra) => ({ wiring_pending: { "x:event": { owner: "o", reason: "r", ...extra } } });
const isPending = (r) => r.pending.has("x:event") && r.flagged.length === 0;
const flagged = (r, re) => !r.pending.has("x:event") && r.flagged.some((f) => re.test(f.problem));

test("date form: a future review_by is honored, a past one is flagged", () => {
  assert.ok(isPending(loadAllowlistSchema(entry({ review_by: "2030-12-31" }), NOW, "1.0.0")));
  assert.ok(flagged(loadAllowlistSchema(entry({ review_by: "2030-01-01" }), NOW, "1.0.0"), /EXPIRED/));
});

test("version form: honored below the version, flagged once the framework version reaches it", () => {
  assert.ok(isPending(loadAllowlistSchema(entry({ review_by_version: "2.2.0" }), NOW, "2.1.9")));
  assert.ok(flagged(loadAllowlistSchema(entry({ review_by_version: "2.2.0" }), NOW, "2.2.0"), /REVIEW DUE/));
  assert.ok(flagged(loadAllowlistSchema(entry({ review_by_version: "2.2.0" }), NOW, "3.0.0"), /REVIEW DUE/));
});

test("version form is never due by the calendar alone", () => {
  assert.ok(isPending(loadAllowlistSchema(entry({ review_by_version: "2.2.0" }), new Date("2099-01-01T00:00:00Z"), "2.1.0")));
});

test("fail-closed: a malformed version, an unreadable framework version, or no review at all", () => {
  assert.ok(flagged(loadAllowlistSchema(entry({ review_by: "2099-99-99" }), NOW, "2.1.0"), /unparseable review_by\/expiry/));
  assert.ok(flagged(loadAllowlistSchema(entry({ expiry: "2030-02-30" }), NOW, "2.1.0"), /unparseable review_by\/expiry/));
  assert.ok(flagged(loadAllowlistSchema(entry({ review_by_version: "next" }), NOW, "2.1.0"), /unparseable review_by_version/));
  assert.ok(flagged(loadAllowlistSchema(entry({ review_by_version: "2.2.0" }), NOW, null), /version unreadable/));
  assert.ok(flagged(loadAllowlistSchema(entry({}), NOW, "2.1.0"), /schemaless/));
});

test("versionGte compares MAJOR.MINOR.PATCH numerically", () => {
  assert.strictEqual(versionGte("2.10.0", "2.9.0"), true);
  assert.strictEqual(versionGte("2.1.0", "2.2.0"), false);
  assert.strictEqual(versionGte("2.2.0", "2.2.0"), true);
});

test("the shipped allowlist carries no calendar review dates", () => {
  const al = readJson(DEFAULT_ALLOWLIST);
  const dated = Object.entries(al.wiring_pending || {}).filter(([, e]) => e && (e.review_by != null || e.expiry != null)).map(([k]) => k);
  assert.deepStrictEqual(dated, [], "shipped entries must use review_by_version: " + dated.join(", "));
  assert.ok(typeof readFrameworkVersion() === "string", "this tree's framework version is readable");
});

test("framework version source: the install record in an install, the framework's own version.json otherwise", () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const tree = (files) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "mlc-ver-"));
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
      fs.writeFileSync(path.join(d, rel), JSON.stringify(body));
    }
    return d;
  };
  const FW = { $schema: "mc/version/v1", name: "mc", version: "2.1.0" };
  const HOST = { name: "host-app", version: "9.9.9" };
  const REC = (source, v) => ({ $schema: "mc/framework-installed/v2", installedVersion: v, source });
  const cases = [
    ["install record + host version.json", { ".claude/framework-installed.json": REC("https://example.invalid/mc.git", "2.1.0"), "version.json": HOST }, "2.1.0"],
    ["install record, no version.json", { ".claude/framework-installed.json": REC("fixture", "2.1.0") }, "2.1.0"],
    ["framework tree (record source self)", { ".claude/framework-installed.json": REC("self", "2.0.0"), "version.json": FW }, "2.1.0"],
    ["framework tree, no record", { "version.json": FW }, "2.1.0"],
    ["host version.json only", { "version.json": HOST }, null],
    ["record with a foreign schema, host version.json", { ".claude/framework-installed.json": { installedVersion: "9.9.9", source: "x" }, "version.json": HOST }, null],
  ];
  for (const [name, files, want] of cases) {
    const d = tree(files);
    try {
      assert.strictEqual(readFrameworkVersion(d), want, name);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  }
});
