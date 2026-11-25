"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const preflight = require("./preflight");
const transaction = require("./transaction");

const SOURCE_TREE_ROOT = path.resolve(__dirname, "..", "..");

function makeHonestyRedInstall() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ovr-"));
  fs.mkdirSync(path.join(target, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(target, "DRIFT.md"), "operator-edited content\n");
  fs.writeFileSync(
    path.join(target, ".claude", "framework-installed.json"),
    JSON.stringify(
      {
        version: "2.2.0",
        assets: [
          {
            id: "drift-doc",
            kind: "doc",
            dest: "DRIFT.md",
            owner: "framework",
            installedHash: "0".repeat(64),
          },
        ],
      },
      null,
      2,
    ),
  );
  return target;
}

function manifestHonestyGate(report) {
  return report.gates.find((g) => g.name === "mc-manifest-honesty");
}

test("preflight honors --operator-override manifest-honesty (red -> yellow, no re-baseline)", () => {
  const target = makeHonestyRedInstall();
  try {
    const base = {
      targetRoot: target,
      sourceTreeRoot: SOURCE_TREE_ROOT,
      toVersion: "2.2.0",
      allRed: true,
    };

    const plain = preflight.runPreflight(base);
    const g1 = manifestHonestyGate(plain);
    assert.ok(g1, "manifest-honesty gate must run");
    assert.strictEqual(g1.status, "red", "drift must make the gate red without an override");

    const overridden = preflight.runPreflight({
      ...base,
      operatorOverrides: new Set(["manifest-honesty"]),
      overrideReason: "customized install; drift expected and handled by --save-conflicts",
    });
    const g2 = manifestHonestyGate(overridden);
    assert.strictEqual(g2.status, "yellow", "the override must downgrade red -> yellow");
    assert.strictEqual(g2.overrideUsed, true, "overrideUsed must be recorded true");
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("beginTransaction forwards the override into its fast-preflight subset (no EFASTPREFLIGHTDRIFT)", () => {
  const target = makeHonestyRedInstall();
  try {
    const base = {
      targetRoot: target,
      sourceTreeRoot: SOURCE_TREE_ROOT,
      fromVersion: "0.16.0",
      toVersion: "2.2.0",
      decisions: [],
      capsule: { dir: target, release: { version: "2.2.0" }, manifest: {} },
    };

    let threw = null;
    try {
      transaction.beginTransaction(base);
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, "fast-preflight must throw on the un-overridden drift");
    assert.strictEqual(threw.code, "EFASTPREFLIGHTDRIFT", `expected EFASTPREFLIGHTDRIFT, got ${threw.code}`);

    let drift = null;
    try {
      transaction.beginTransaction({
        ...base,
        operatorOverrides: new Set(["manifest-honesty"]),
        overrideReason: "customized install; drift expected and handled by --save-conflicts",
      });
    } catch (e) {
      drift = e;
    }
    if (drift) {
      assert.notStrictEqual(
        drift.code,
        "EFASTPREFLIGHTDRIFT",
        "the override must clear the fast-preflight drift; any later error is a different concern",
      );
    }
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("override-reason / known-gate contract the update.js CLI parse depends on", () => {
  assert.ok(
    preflight.KNOWN_GATE_NAMES.has("manifest-honesty"),
    "manifest-honesty must stay an overridable gate name (the installed-product upgrade route depends on it)",
  );
  assert.strictEqual(preflight.validateOverrideReason("short"), null, "under 8 chars is rejected");
  assert.strictEqual(preflight.validateOverrideReason("   "), null, "whitespace-only is rejected");
  assert.strictEqual(
    preflight.validateOverrideReason("a valid reason text"),
    "a valid reason text",
    "a valid reason is returned trimmed",
  );
  assert.strictEqual(preflight.validateOverrideReason("x".repeat(501)), null, "over 500 chars is rejected");
});
