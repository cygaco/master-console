#!/usr/bin/env node

/**
 * scripts/test-update-discovery.js — Test 0.4.1's canonical auto-discovery.
 *
 * Exercises scripts/mc/update.js#discoverCanonical against synthetic
 * product-repo layouts. Verifies:
 *
 *   1. Sibling ../MC hit
 *   2. Sibling ../mc hit
 *   3. .claude/manifest.json#mc.source hit
 *   4. .claude/framework-installed.json#source hit
 *   5. Missing-target-capsule miss (returns null)
 *   6. Non-existent candidate skipped silently
 *
 * Uses a temp dir per case, cleaned up at end. No process state mutated.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { discoverCanonical } = require("./mc/update");

const CANONICAL = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  process.stdout.write(`  ok    ${name}\n`);
}

function fail(name, detail) {
  failed++;
  process.stdout.write(`  FAIL  ${name}\n`);
  if (detail) process.stdout.write(`        ${detail}\n`);
}

function mkProduct(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wpu-disc-"));
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  if (layout.manifest) {
    fs.writeFileSync(
      path.join(root, ".claude", "manifest.json"),
      JSON.stringify(layout.manifest, null, 2),
    );
  }
  if (layout.installed) {
    fs.writeFileSync(
      path.join(root, ".claude", "framework-installed.json"),
      JSON.stringify(layout.installed, null, 2),
    );
  }
  return root;
}

function rm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function mkSiblingCanonical(parentDir, name) {
  // create a sibling dir that LOOKS like a canonical (has version.json +
  // framework/ + a target capsule)
  const dir = path.join(parentDir, name);
  fs.mkdirSync(path.join(dir, "framework", "releases", "0.4.1"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(dir, "version.json"),
    JSON.stringify({ version: "0.4.1" }),
  );
  fs.writeFileSync(
    path.join(dir, "framework", "releases", "0.4.1", "release.json"),
    JSON.stringify({ version: "0.4.1" }),
  );
  return dir;
}

function testSiblingMC() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wpu-disc-parent-"));
  const sibling = mkSiblingCanonical(parent, "MC");
  const product = path.join(parent, "product");
  fs.mkdirSync(product, { recursive: true });
  try {
    const found = discoverCanonical(product, "0.4.1");
    if (found && path.resolve(found) === path.resolve(sibling)) {
      ok("sibling ../MC discovered");
    } else {
      fail("sibling ../MC discovered", `got: ${found}`);
    }
  } finally {
    rm(parent);
  }
}

function testSiblingLowercase() {
  // On Windows the filesystem is case-insensitive so ../MC and
  // ../mc resolve to the same directory; on Linux/macOS they don't.
  // Verify discovery succeeds either way; case-insensitive compare.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wpu-disc-parent-"));
  const sibling = mkSiblingCanonical(parent, "mc");
  const product = path.join(parent, "product");
  fs.mkdirSync(product, { recursive: true });
  try {
    const found = discoverCanonical(product, "0.4.1");
    const eq =
      found &&
      path.resolve(found).toLowerCase() === path.resolve(sibling).toLowerCase();
    if (eq) ok("sibling ../mc discovered (case-insensitive)");
    else fail("sibling ../mc discovered", `got: ${found}`);
  } finally {
    rm(parent);
  }
}

function testManifestHint() {
  // Use the real canonical for the manifest hint
  const product = mkProduct({
    manifest: { mc: { source: CANONICAL } },
  });
  try {
    const found = discoverCanonical(product, "0.4.1");
    if (found && path.resolve(found) === path.resolve(CANONICAL)) {
      ok("manifest.json#mc.source hit");
    } else {
      fail("manifest.json#mc.source hit", `got: ${found}`);
    }
  } finally {
    rm(product);
  }
}

function testInstalledHint() {
  const product = mkProduct({
    installed: { source: CANONICAL },
  });
  try {
    const found = discoverCanonical(product, "0.4.1");
    if (found && path.resolve(found) === path.resolve(CANONICAL)) {
      ok("framework-installed.json#source hit");
    } else {
      fail("framework-installed.json#source hit", `got: ${found}`);
    }
  } finally {
    rm(product);
  }
}

function testMissingCapsule() {
  // Hint at canonical, but request a non-existent version
  const product = mkProduct({ installed: { source: CANONICAL } });
  try {
    const found = discoverCanonical(product, "99.99.99");
    if (found === null) {
      ok("missing target capsule returns null");
    } else {
      fail("missing target capsule returns null", `got: ${found}`);
    }
  } finally {
    rm(product);
  }
}

function testNonExistentCandidate() {
  // Hint at a path that doesn't exist
  const product = mkProduct({
    installed: { source: "/this/path/does/not/exist/anywhere/at/all" },
  });
  try {
    const found = discoverCanonical(product, "0.4.1");
    if (found === null) {
      ok("non-existent candidate skipped (returns null)");
    } else {
      fail("non-existent candidate skipped", `got: ${found}`);
    }
  } finally {
    rm(product);
  }
}

function testFirstHitWins() {
  // Sibling AND manifest both point at canonicals — sibling should win
  // (walk order: sibling first, then hints)
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wpu-disc-parent-"));
  const sibling = mkSiblingCanonical(parent, "MC");
  const product = path.join(parent, "product");
  fs.mkdirSync(path.join(product, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(product, ".claude", "manifest.json"),
    JSON.stringify({ mc: { source: CANONICAL } }),
  );
  try {
    const found = discoverCanonical(product, "0.4.1");
    if (found && path.resolve(found) === path.resolve(sibling)) {
      ok("sibling beats manifest hint (walk order)");
    } else {
      fail(
        "sibling beats manifest hint",
        `expected sibling ${sibling}, got: ${found}`,
      );
    }
  } finally {
    rm(parent);
  }
}

function main() {
  process.stdout.write(
    "scripts/test-update-discovery.js — 0.4.1 canonical auto-discovery\n",
  );
  testSiblingMC();
  testSiblingLowercase();
  testManifestHint();
  testInstalledHint();
  testMissingCapsule();
  testNonExistentCandidate();
  testFirstHitWins();
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
