"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const update = require("./update");
const cHash = require("./lib/content-hash");

const KEPT_LABEL = "kept (modified by you)";
const UNVERIFIED_LABEL = "kept (cannot verify it is unmodified)";

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-update-orphan-"));
  const target = path.join(base, "target");
  const source = path.join(base, "source");
  const txDir = path.join(base, "tx");
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(txDir, { recursive: true });

  const files = {
    modifiedProject: { dest: "_docs/notes/plan.md", owner: "project_owned", installed: "installed text\n", local: "the user rewrote this\n" },
    modifiedTemplate: { dest: "_requirements/00-canonical/brief.md", owner: "framework_template", installed: "template\n", local: "user brief\n" },
    unmodifiedProject: { dest: "_docs/notes/old.md", owner: "project_owned", installed: "untouched\n", local: "untouched\n" },
    unmodifiedFramework: { dest: ".claude/commands/old/cmd.md", owner: "framework", installed: "cmd\n", local: "cmd\n" },
  };
  const installedAssets = [];
  for (const [id, f] of Object.entries(files)) {
    const installedPath = write(base, path.join("installed-copy", f.dest), f.installed);
    write(target, f.dest, f.local);
    installedAssets.push({ id, kind: "docs", dest: f.dest, owner: f.owner, installedHash: cHash.contentHash(installedPath) });
  }
  const installed = { version: "1.0.0", assets: installedAssets };
  const capsule = { manifest: { assets: {} } };
  return { base, target, source, txDir, files, installed, capsule };
}

function runApply(fx, confirmDeletes) {
  const decisions = update.classify(fx.installed, fx.capsule, fx.target);
  const result = update.applyUpdateDecisions(fx.source, fx.target, decisions, fx.capsule.manifest, fx.txDir, { confirmDeletes });
  return { decisions, result };
}

function entry(result, dest) {
  return result.perFile.find((p) => p.dest === dest);
}

test("a modified project-owned orphan survives a confirmed apply and is reported as kept (modified by you)", () => {
  const fx = setup();
  try {
    const { decisions, result } = runApply(fx, true);
    for (const key of ["modifiedProject", "modifiedTemplate"]) {
      const f = fx.files[key];
      const abs = path.join(fx.target, f.dest);
      assert.ok(fs.existsSync(abs), `${f.dest} must survive a confirmed apply`);
      assert.strictEqual(fs.readFileSync(abs, "utf8"), f.local, `${f.dest} must keep the user's content`);
      const d = decisions.find((x) => x.dest === f.dest);
      assert.notStrictEqual(d.category, "DELETE_SAFE", `${f.dest} must not be classified DELETE_SAFE`);
      assert.strictEqual(d.reason, KEPT_LABEL);
      const p = entry(result, f.dest);
      assert.notStrictEqual(p.status, "deleted");
      assert.strictEqual(p.reason, KEPT_LABEL);
    }
    const counts = update.summarize(decisions);
    assert.strictEqual(counts.DELETE_SAFE, 2, "only the two unmodified orphans count as deletions");
    assert.strictEqual(result.counts.deleted, 2);
    assert.strictEqual(result.counts.kept_modified, 2, "the summary counts the kept files");
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("an unmodified orphan is deleted on a confirmed apply", () => {
  const fx = setup();
  try {
    const { result } = runApply(fx, true);
    for (const key of ["unmodifiedProject", "unmodifiedFramework"]) {
      const f = fx.files[key];
      assert.ok(!fs.existsSync(path.join(fx.target, f.dest)), `${f.dest} must be deleted`);
      assert.strictEqual(entry(result, f.dest).status, "deleted");
    }
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("every deletion writes a backup into the transaction directory first; a kept file needs none", () => {
  const fx = setup();
  try {
    const { result } = runApply(fx, true);
    for (const key of ["unmodifiedProject", "unmodifiedFramework"]) {
      const f = fx.files[key];
      const backup = path.join(fx.txDir, "backup", f.dest);
      assert.ok(fs.existsSync(backup), `backup for ${f.dest} must exist`);
      assert.strictEqual(fs.readFileSync(backup, "utf8"), f.local);
    }
    assert.strictEqual(result.counts.backups, 2);
    assert.ok(!fs.existsSync(path.join(fx.txDir, "backup", fx.files.modifiedProject.dest)));
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("without --confirm-deletes no orphan is deleted, and a modified orphan is still reported as kept", () => {
  const fx = setup();
  try {
    const { result } = runApply(fx, false);
    for (const f of Object.values(fx.files)) {
      assert.ok(fs.existsSync(path.join(fx.target, f.dest)), `${f.dest} must remain`);
    }
    assert.strictEqual(result.counts.deleted, 0);
    assert.strictEqual(result.counts.deletes_skipped, 2);
    assert.strictEqual(entry(result, fx.files.modifiedProject.dest).reason, KEPT_LABEL);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("an orphan whose installed record has no installedHash survives a confirmed apply and is reported as kept (cannot verify it is unmodified)", () => {
  const fx = setup();
  try {
    const noHash = [
      { id: "noHashFramework", kind: "docs", dest: ".claude/commands/old/nohash.md", owner: "framework" },
      { id: "noHashProject", kind: "docs", dest: "_docs/notes/nohash.md", owner: "project_owned" },
    ];
    for (const rec of noHash) {
      write(fx.target, rec.dest, "content of unknown origin\n");
      fx.installed.assets.push(rec);
    }
    const { decisions, result } = runApply(fx, true);
    for (const rec of noHash) {
      const abs = path.join(fx.target, rec.dest);
      assert.ok(fs.existsSync(abs), `${rec.dest} must survive a confirmed apply`);
      const d = decisions.find((x) => x.dest === rec.dest);
      assert.strictEqual(d.category, "ORPHAN_KEPT");
      assert.strictEqual(d.reason, UNVERIFIED_LABEL);
      const p = entry(result, rec.dest);
      assert.strictEqual(p.status, "kept_unverified");
      assert.strictEqual(p.reason, UNVERIFIED_LABEL);
      assert.ok(!fs.existsSync(path.join(fx.txDir, "backup", rec.dest)));
    }
    assert.strictEqual(result.counts.kept_unverified, 2);
    assert.strictEqual(result.counts.kept_modified, 2);
    assert.strictEqual(result.counts.deleted, 2, "only the two verified-unmodified orphans are deleted");
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("an orphan the installed snapshot lists under userModified is kept even when it matches the snapshot hash", () => {
  const fx = setup();
  try {
    const edited = { id: "editedEarlier", kind: "docs", dest: "_requirements/00-canonical/earlier.md", owner: "framework_template" };
    const editedFw = { id: "editedEarlierFw", kind: "docs", dest: ".claude/commands/old/earlier.md", owner: "framework" };
    for (const rec of [edited, editedFw]) {
      const abs = write(fx.target, rec.dest, "edited before the previous update\n");
      fx.installed.assets.push({ ...rec, installedHash: cHash.contentHash(abs) });
    }
    fx.installed.userModified = [edited.dest, editedFw.dest];
    const { decisions, result } = runApply(fx, true);
    for (const rec of [edited, editedFw]) {
      assert.ok(fs.existsSync(path.join(fx.target, rec.dest)), `${rec.dest} must survive a confirmed apply`);
      assert.notStrictEqual(entry(result, rec.dest).status, "deleted");
    }
    assert.strictEqual(decisions.find((d) => d.dest === edited.dest).category, "ORPHAN_KEPT");
    assert.strictEqual(entry(result, edited.dest).reason, KEPT_LABEL);
    assert.strictEqual(decisions.find((d) => d.dest === editedFw.dest).category, "DELETE_CONFLICT");
    assert.strictEqual(result.counts.deleted, 2);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("list-decisions.js classifies orphans exactly as update.js does", () => {
  const fx = setup();
  try {
    const noHash = { id: "noHash", kind: "docs", dest: "_docs/notes/nohash.md", owner: "framework" };
    write(fx.target, noHash.dest, "content of unknown origin\n");
    fx.installed.assets.push(noHash);
    const modifiedFramework = { id: "modFw", kind: "docs", dest: ".claude/commands/old/edited.md", owner: "framework" };
    const fwInstalled = write(fx.base, path.join("installed-copy", modifiedFramework.dest), "shipped\n");
    write(fx.target, modifiedFramework.dest, "edited by the user\n");
    fx.installed.assets.push({ ...modifiedFramework, installedHash: cHash.contentHash(fwInstalled) });

    const version = "9.9.9";
    const capsuleDir = path.join(fx.source, "framework", "releases", version);
    write(capsuleDir, "release.json", JSON.stringify({ version }));
    write(capsuleDir, "framework-manifest.json", JSON.stringify(fx.capsule.manifest));
    write(fx.target, ".claude/framework-installed.json", JSON.stringify(fx.installed));

    const expected = new Map(update.classify(fx.installed, fx.capsule, fx.target).map((d) => [d.dest, d.category]));
    const r = spawnSync(process.execPath, [path.join(__dirname, "list-decisions.js"), "--target", fx.target, "--source", fx.source, "--to", version], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    const listed = new Map(
      r.stdout.split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
        const [category, dest] = l.split("\t");
        return [dest, category];
      }),
    );
    assert.deepStrictEqual(Object.fromEntries(listed), Object.fromEntries(expected));
    assert.strictEqual(listed.get(fx.files.modifiedProject.dest), "ORPHAN_KEPT");
    assert.strictEqual(listed.get(noHash.dest), "ORPHAN_KEPT");
    assert.strictEqual(listed.get(modifiedFramework.dest), "DELETE_CONFLICT");
    assert.strictEqual(listed.get(fx.files.unmodifiedProject.dest), "DELETE_SAFE");

    const c = spawnSync(process.execPath, [path.join(__dirname, "list-decisions.js"), "--target", fx.target, "--source", fx.source, "--to", version, "--category", "C"], { encoding: "utf8" });
    assert.strictEqual(c.status, 0, c.stderr);
    const cLines = c.stdout.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
    assert.deepStrictEqual(cLines, [`DELETE_CONFLICT\t${modifiedFramework.dest}`]);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});
