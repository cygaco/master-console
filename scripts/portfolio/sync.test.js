#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const {
  buildUpdateArgs,
  readMcVersion,
  runUpdate,
  locateMcCloneRoot,
} = require("./sync");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e && e.message ? e.message : e}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e && e.message ? e.message : e}`);
  }
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

const UPDATE = "/mc/scripts/mc/update.js";
const PRODUCT = "/projects/some-product";
const MC = "/projects/master-console";

test("apply mode pins --to, --source, --target and --apply", () => {
  const args = buildUpdateArgs(UPDATE, PRODUCT, MC, { toVersion: "2.2.0" });
  assert.strictEqual(args[0], UPDATE, "update script is argv[0]");
  assert.strictEqual(flagValue(args, "--to"), "2.2.0", "--to carries the version");
  assert.strictEqual(flagValue(args, "--source"), MC, "--source is the MC clone");
  assert.strictEqual(flagValue(args, "--target"), PRODUCT, "--target is the product");
  assert.ok(args.includes("--apply"), "apply mode passes --apply");
  assert.ok(!args.includes("--dry-run"), "apply mode does NOT pass --dry-run");
});

test("dry-run mode passes --dry-run instead of --apply", () => {
  const args = buildUpdateArgs(UPDATE, PRODUCT, MC, { toVersion: "2.2.0", dryRun: true });
  assert.ok(args.includes("--dry-run"), "dry-run mode passes --dry-run");
  assert.ok(!args.includes("--apply"), "dry-run mode does NOT pass --apply");
  assert.strictEqual(flagValue(args, "--to"), "2.2.0");
});

test("--target is the PRODUCT and --source is the MC clone (self-update guard)", () => {
  const args = buildUpdateArgs(UPDATE, PRODUCT, MC, { toVersion: "2.2.0" });
  const target = flagValue(args, "--target");
  const source = flagValue(args, "--source");
  assert.notStrictEqual(target, source, "target and source must differ");
  assert.strictEqual(target, PRODUCT, "target must be the product, never the MC clone");
  assert.strictEqual(source, MC, "source must be the MC clone");
});

test("confirmDeletes appends --confirm-deletes; absent by default", () => {
  const withDel = buildUpdateArgs(UPDATE, PRODUCT, MC, { toVersion: "2.2.0", confirmDeletes: true });
  assert.ok(withDel.includes("--confirm-deletes"));
  const without = buildUpdateArgs(UPDATE, PRODUCT, MC, { toVersion: "2.2.0" });
  assert.ok(!without.includes("--confirm-deletes"));
});

test("readMcVersion reads version.json#version", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sync-ver-"));
  try {
    fs.writeFileSync(path.join(dir, "version.json"), JSON.stringify({ version: "2.2.0" }));
    assert.strictEqual(readMcVersion(dir), "2.2.0");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readMcVersion returns null on a missing/unparseable version.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sync-ver-"));
  try {
    assert.strictEqual(readMcVersion(dir), null, "missing file → null");
    fs.writeFileSync(path.join(dir, "version.json"), "{ not json");
    assert.strictEqual(readMcVersion(dir), null, "unparseable → null");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

(async () => {
  await testAsync("runUpdate returns update-script-missing when update.js is absent", async () => {
    const r = await runUpdate(PRODUCT, "/no/such/mc/clone", { toVersion: "2.2.0" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, "update-script-missing");
  });

  await testAsync("runUpdate refuses without a toVersion (never a bare exit-2)", async () => {
    const mc = locateMcCloneRoot();
    const r = await runUpdate(PRODUCT, mc, {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, "missing-to-version");
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll sync.test.js tests passed.");
})();
