"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BUILD = path.join(__dirname, "build.js");
const VALIDATE = path.join(__dirname, "validate.js");

function node(args) {
  return spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120000, windowsHide: true });
}

function withFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ihook-golden-"));
  try {
    fs.mkdirSync(path.join(dir, "_mc", "commands"), { recursive: true });
    fs.writeFileSync(path.join(dir, "_mc", "commands", "test.md"), "# test\n");
    fs.writeFileSync(path.join(dir, "version.json"), JSON.stringify({ version: "0.0.1" }));
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { }
  }
}

const build = (dir, extra) => node([BUILD, "--root", dir, "--source-prefix", "_mc", "--allow-unclassified", ...(extra || [])]);

test("GOLDEN install-update: build.js installs the manifest and a second run changes nothing (idempotent)", () => {
  withFixture((dir) => {
    const r1 = build(dir, ["--json"]);
    assert.strictEqual(r1.status, 0, `${r1.stderr}\n${r1.stdout}`);
    assert.doesNotThrow(() => JSON.parse(r1.stdout), "build --json summary must parse");
    const mf = path.join(dir, "_mc", "MANIFEST.json");
    assert.ok(fs.existsSync(mf), "_mc/MANIFEST.json written");
    const first = fs.readFileSync(mf, "utf8");
    const r2 = build(dir);
    assert.strictEqual(r2.status, 0, `${r2.stderr}\n${r2.stdout}`);
    const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => k !== "generatedAt").sort().map((k) => [k, canon(v[k])])) : v);
    assert.deepStrictEqual(canon(JSON.parse(fs.readFileSync(mf, "utf8"))), canon(JSON.parse(first)), "second build must not change the manifest content");
  });
});

test("GOLDEN install-update: validate.js --json reports coverage findings and is clean on a fresh build", () => {
  withFixture((dir) => {
    assert.strictEqual(build(dir).status, 0);
    const r = node([VALIDATE, "--root", dir, "--json"]);
    const parsed = JSON.parse(r.stdout);
    assert.strictEqual(typeof parsed.findings, "object");
    assert.strictEqual(typeof parsed.pathCount, "number");
    assert.strictEqual(typeof parsed.ownerCounts, "object");
    assert.strictEqual(parsed.findings.missing.length, 0, JSON.stringify(parsed.findings));
  });
});

test("GOLDEN install-update: PLANTED missing hook file is detected by validate.js", () => {
  withFixture((dir) => {
    assert.strictEqual(build(dir).status, 0);
    fs.rmSync(path.join(dir, "_mc", "commands", "test.md"));
    const r = node([VALIDATE, "--root", dir, "--json"]);
    const parsed = JSON.parse(r.stdout);
    assert.ok(parsed.findings.missing.length > 0, `removed file must be classed missing: ${r.stdout}`);
    assert.notStrictEqual(r.status, 0, "validate must exit non-zero on a missing file");
  });
});

test("GOLDEN install-update: mc-setup.js still wires the manifest-coverage hook and its flags", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "mc-setup.js"), "utf8");
  assert.ok(src.includes("--skip-manifest-check") && src.includes("SKIP_MANIFEST_CHECK"));
  assert.ok(src.includes("--strict-manifest") && src.includes("STRICT_MANIFEST"));
  assert.ok(src.includes("MANIFEST COVERAGE"));
  assert.ok(src.includes("regenerateMcManifest"), "hook regenerates via the shared scaffold core");
  assert.ok(src.includes("scripts/mc/manifest/validate.js"));
  assert.ok(src.includes("--strict-manifest set") || /refusing install/i.test(src));
});
