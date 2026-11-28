"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const update = require("./update");
const cHash = require("./lib/content-hash");

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-saveconf-"));
  const target = path.join(base, "target");
  const source = path.join(base, "source");
  const txDir = path.join(base, "tx");
  const conflictsDir = path.join(target, ".mc", "pre-2.2.0-conflicts");
  [target, source, txDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));

  const dest = "scripts/hooks/beta-hook.js";
  const installedAbs = write(base, path.join("installed-copy", dest), "orig\n");
  write(target, dest, "CUSTOM — the operator's edit\n");
  write(source, dest, "V2 — the 2.2.0 version\n");

  const installed = { version: "0.16.0", assets: [
    { id: "beta", kind: "agent", dest, owner: "framework", mergeStrategy: "replace_if_unmodified", installedHash: cHash.contentHash(installedAbs) },
  ] };
  const capsule = { manifest: { assets: { agent: [
    { id: "beta", kind: "agent", dest, src: dest, owner: "framework", mergeStrategy: "replace_if_unmodified", sha256: "deadbeef" },
  ] } } };
  return { base, target, source, txDir, conflictsDir, dest };
}

test("--save-conflicts saves the operator's MERGE_CONFLICT copy aside, then applies the target version; never silently overwritten", () => {
  const fx = setup();
  try {
    const installed = { version: "0.16.0", assets: [
      { id: "beta", kind: "agent", dest: fx.dest, owner: "framework", mergeStrategy: "replace_if_unmodified", installedHash: cHash.contentHash(path.join(fx.base, "installed-copy", fx.dest)) },
    ] };
    const capsule = { manifest: { assets: { agent: [
      { id: "beta", kind: "agent", dest: fx.dest, src: fx.dest, owner: "framework", mergeStrategy: "replace_if_unmodified", sha256: "deadbeef" },
    ] } } };
    const decisions = update.classify(installed, capsule, fx.target);
    const d = decisions.find((x) => x.dest === fx.dest);
    assert.strictEqual(d.category, "MERGE_CONFLICT", `expected MERGE_CONFLICT, got ${d.category}`);

    const res = update.applyUpdateDecisions(fx.source, fx.target, decisions, capsule.manifest, fx.txDir, { saveConflicts: true, conflictsDir: fx.conflictsDir });

    const savedAbs = path.join(fx.conflictsDir, fx.dest);
    assert.ok(fs.existsSync(savedAbs), "the local copy must be saved to the conflicts dir");
    assert.strictEqual(fs.readFileSync(savedAbs, "utf8"), "CUSTOM — the operator's edit\n", "the saved copy must be the operator's exact content (never lost)");
    assert.strictEqual(fs.readFileSync(path.join(fx.target, fx.dest), "utf8"), "V2 — the 2.2.0 version\n", "the target version must be applied");
    assert.strictEqual((res.savedConflicts || []).length, 1);
    assert.strictEqual(res.savedConflicts[0].dest, fx.dest);
    assert.strictEqual(res.counts.conflicts_saved, 1);
    const p = res.perFile.find((x) => x.dest === fx.dest);
    assert.strictEqual(p.status, "conflict_saved");
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("without --save-conflicts a MERGE_CONFLICT is held (no write, no overwrite)", () => {
  const fx = setup();
  try {
    const installed = { version: "0.16.0", assets: [
      { id: "beta", kind: "agent", dest: fx.dest, owner: "framework", mergeStrategy: "replace_if_unmodified", installedHash: cHash.contentHash(path.join(fx.base, "installed-copy", fx.dest)) },
    ] };
    const capsule = { manifest: { assets: { agent: [
      { id: "beta", kind: "agent", dest: fx.dest, src: fx.dest, owner: "framework", mergeStrategy: "replace_if_unmodified", sha256: "deadbeef" },
    ] } } };
    const decisions = update.classify(installed, capsule, fx.target);
    const res = update.applyUpdateDecisions(fx.source, fx.target, decisions, capsule.manifest, fx.txDir, {});
    assert.strictEqual(fs.readFileSync(path.join(fx.target, fx.dest), "utf8"), "CUSTOM — the operator's edit\n", "held: the local copy is untouched");
    assert.strictEqual((res.savedConflicts || []).length, 0);
    assert.strictEqual(res.counts.merge_conflicts_held, 1);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("--save-conflicts backs the live copy up into the transaction and never overwrites an earlier saved copy", () => {
  const fx = setup();
  try {
    const installed = { version: "0.16.0", assets: [
      { id: "beta", kind: "agent", dest: fx.dest, owner: "framework", mergeStrategy: "replace_if_unmodified", installedHash: cHash.contentHash(path.join(fx.base, "installed-copy", fx.dest)) },
    ] };
    const capsule = { manifest: { assets: { agent: [
      { id: "beta", kind: "agent", dest: fx.dest, src: fx.dest, owner: "framework", mergeStrategy: "replace_if_unmodified", sha256: "deadbeef" },
    ] } } };
    const firstSaved = write(fx.conflictsDir, fx.dest, "EARLIER saved copy\n");
    const decisions = update.classify(installed, capsule, fx.target);
    const res = update.applyUpdateDecisions(fx.source, fx.target, decisions, capsule.manifest, fx.txDir, { saveConflicts: true, conflictsDir: fx.conflictsDir });
    const backup = path.join(fx.txDir, "backup", fx.dest);
    assert.ok(fs.existsSync(backup), "the live copy must be backed up into the transaction before it is replaced");
    assert.strictEqual(fs.readFileSync(backup, "utf8"), "CUSTOM — the operator's edit\n");
    assert.ok(res.counts.backups >= 1);
    assert.strictEqual(fs.readFileSync(firstSaved, "utf8"), "EARLIER saved copy\n", "an earlier saved copy is never overwritten");
    assert.strictEqual(fs.readFileSync(`${firstSaved}.2`, "utf8"), "CUSTOM — the operator's edit\n");
    assert.strictEqual(res.savedConflicts[0].savedTo.endsWith(".2"), true);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});
