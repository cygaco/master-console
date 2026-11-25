"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const update = require("./update");

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

function setup(n) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-update-fullplan-"));
  const source = path.join(base, "source");
  const target = path.join(base, "target");
  const version = "9.9.9";
  fs.mkdirSync(path.join(source, ".claude"), { recursive: true });
  write(source, "version.json", JSON.stringify({ version }));
  const assets = [];
  for (let i = 0; i < n; i++) {
    const dest = `.claude/commands/new/cmd-${i}.md`;
    write(source, dest, `# cmd ${i}\n`);
    assets.push({ id: `cmd-${i}`, kind: "skill", dest, src: dest, owner: "framework", sha256: "deadbeef" });
  }
  const manifest = { version, assets: { skill: assets } };
  const capsuleDir = path.join(source, "framework", "releases", version);
  write(capsuleDir, "release.json", JSON.stringify({ version }));
  write(capsuleDir, "framework-manifest.json", JSON.stringify(manifest));
  fs.mkdirSync(target, { recursive: true });
  return { base, source, target, version, n };
}

test("--full-plan emits the complete Class A list while the sample stays capped at 5", async () => {
  const fx = setup(7);
  try {
    const r = await update.run({ to: fx.version, source: fx.source, target: fx.target, dryRun: true, fullPlan: true });
    assert.strictEqual(r.mode, "dry-run");
    assert.strictEqual(r.report.classCounts.A, 7, "all 7 new assets classify Class A (ADD_SAFE)");
    assert.strictEqual(r.sample.A.length, 5, "the sample is capped at 5");
    assert.ok(r.fullPlan, "--full-plan populates fullPlan");
    assert.strictEqual(r.fullPlan.A.length, 7, "fullPlan carries every Class A entry");
    for (const row of r.fullPlan.A) assert.ok(row.id && row.dest && row.category, "each row carries id/dest/category");
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("without --full-plan a dry run carries no fullPlan (only the capped sample)", async () => {
  const fx = setup(7);
  try {
    const r = await update.run({ to: fx.version, source: fx.source, target: fx.target, dryRun: true });
    assert.strictEqual(r.fullPlan, undefined, "fullPlan is absent unless --full-plan is passed");
    assert.strictEqual(r.sample.A.length, 5);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});
