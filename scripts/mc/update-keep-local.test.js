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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-keeplocal-"));
  const target = path.join(base, "target");
  const source = path.join(base, "source");
  const txDir = path.join(base, "tx");
  [target, source, txDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));

  const contentDest = ".claude/agents/_system/beta.md";
  const engineDest = "scripts/hooks/example-hook.js";

  const contentInstalled = write(base, path.join("installed-copy", contentDest), "orig content\n");
  const engineInstalled = write(base, path.join("installed-copy", engineDest), "// orig engine\n");

  write(target, contentDest, "CONTENT — operator edit\n");
  write(target, engineDest, "// ENGINE — operator edit\n");
  write(source, contentDest, "CONTENT — 2.2.0 version\n");
  write(source, engineDest, "// ENGINE — 2.2.0 version\n");

  const installed = {
    version: "0.16.0",
    assets: [
      { id: "beta", kind: "agent", dest: contentDest, owner: "framework", mergeStrategy: "replace_if_unmodified", installedHash: cHash.contentHash(contentInstalled) },
      { id: "hook", kind: "hook", dest: engineDest, owner: "framework", mergeStrategy: "replace_if_unmodified", installedHash: cHash.contentHash(engineInstalled) },
    ],
  };
  const capsule = { manifest: { assets: {
    agent: [{ id: "beta", kind: "agent", dest: contentDest, src: contentDest, owner: "framework", mergeStrategy: "replace_if_unmodified", sha256: "dead" }],
    hook: [{ id: "hook", kind: "hook", dest: engineDest, src: engineDest, owner: "framework", mergeStrategy: "replace_if_unmodified", sha256: "beef" }],
  } } };
  return { base, target, source, txDir, contentDest, engineDest, installed, capsule };
}

test("--keep-local: content kept live (+ .mc-new), engine takes target (+ .local-<v>); both recorded, never silently lost", () => {
  const fx = setup();
  try {
    const decisions = update.classify(fx.installed, fx.capsule, fx.target);
    const dc = decisions.find((x) => x.dest === fx.contentDest);
    const de = decisions.find((x) => x.dest === fx.engineDest);
    assert.strictEqual(dc.category, "MERGE_KEPT_LOCAL", `content expected MERGE_KEPT_LOCAL, got ${dc.category}`);
    assert.strictEqual(de.category, "MERGE_CONFLICT", `engine expected MERGE_CONFLICT, got ${de.category}`);

    const res = update.applyUpdateDecisions(fx.source, fx.target, decisions, fx.capsule.manifest, fx.txDir, {
      keepLocal: true,
      fromVersion: "0.16.0",
    });

    assert.strictEqual(fs.readFileSync(path.join(fx.target, fx.contentDest), "utf8"), "CONTENT — operator edit\n", "content file must stay the operator's edit");
    const contentNew = path.join(fx.target, `${fx.contentDest}.mc-new`);
    assert.ok(fs.existsSync(contentNew), ".mc-new sibling must exist for content");
    assert.strictEqual(fs.readFileSync(contentNew, "utf8"), "CONTENT — 2.2.0 version\n", ".mc-new must hold the incoming version");

    assert.strictEqual(fs.readFileSync(path.join(fx.target, fx.engineDest), "utf8"), "// ENGINE — 2.2.0 version\n", "engine file must take the target version");
    const engineLocal = path.join(fx.target, `${fx.engineDest}.local-0.16.0`);
    assert.ok(fs.existsSync(engineLocal), ".local-<v> sibling must exist for engine");
    assert.strictEqual(fs.readFileSync(engineLocal, "utf8"), "// ENGINE — operator edit\n", ".local-<v> must hold the operator's edit");

    assert.strictEqual(res.counts.kept_new_beside, 1);
    assert.strictEqual(res.counts.local_took_target, 1);
    const oc = res.localOverrides.find((o) => o.path === fx.contentDest);
    const oe = res.localOverrides.find((o) => o.path === fx.engineDest);
    assert.strictEqual(oc.class, "content");
    assert.strictEqual(oc.action, "kept-local");
    assert.strictEqual(oc.newerAvailable, true);
    assert.strictEqual(oe.class, "engine");
    assert.strictEqual(oe.action, "took-target");
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});

test("--keep-local: a file removed in target but locally modified is ORPHAN_KEPT: it stays on disk, unchanged", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-kl-del-"));
  const target = path.join(base, "target");
  const source = path.join(base, "source");
  const txDir = path.join(base, "tx");
  [target, source, txDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  try {
    const goners = ["scripts/old-gate.js", "scripts/legacy/removed-check.js"];
    const installedAssets = goners.map((dest, i) => {
      const inst = write(base, path.join("installed-copy", dest), `// orig ${i}\n`);
      write(target, dest, `// LOCAL EDIT ${i}\n`);
      return { id: `g${i}`, kind: "script", dest, owner: "framework", mergeStrategy: "replace_if_unmodified", installedHash: cHash.contentHash(inst) };
    });
    const installed = { version: "0.16.0", assets: installedAssets };
    const capsule = { manifest: { assets: { script: [] } } };

    const decisions = update.classify(installed, capsule, target);
    for (const dest of goners) {
      const d = decisions.find((x) => x.dest === dest);
      assert.ok(d, `decision for ${dest} must exist`);
      assert.strictEqual(d.category, "ORPHAN_KEPT", `${dest} expected ORPHAN_KEPT, got ${d.category}`);
    }

    const res = update.applyUpdateDecisions(source, target, decisions, capsule.manifest, txDir, {
      keepLocal: true,
      confirmDeletes: true,
      fromVersion: "0.16.0",
    });

    for (let i = 0; i < goners.length; i++) {
      const dest = goners[i];
      assert.strictEqual(fs.readFileSync(path.join(target, dest), "utf8"), `// LOCAL EDIT ${i}\n`, `${dest} must stay`);
      assert.ok(!fs.existsSync(path.join(target, `${dest}.local-0.16.0`)), "no sidecar is needed");
    }
    assert.strictEqual(res.counts.deleted, 0);
    assert.strictEqual(res.counts.kept_modified, goners.length);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("keepLocalOwnerClass: .md is content; everything else (incl engine-read JSON + unknown) is engine", () => {
  const cls = update.keepLocalOwnerClass;
  assert.strictEqual(cls(".claude/agents/_system/beta.md"), "content");
  assert.strictEqual(cls(".claude/agents/president/alpha.md"), "content");
  assert.strictEqual(cls("CLAUDE.md"), "content");
  assert.strictEqual(cls(".claude/commands/mc/doctor.md"), "content");
  assert.strictEqual(cls("scripts/hooks/x.js"), "engine");
  assert.strictEqual(cls("scripts/mc/update.js"), "engine");
  assert.strictEqual(cls("lib/foo.cjs"), "engine");
  assert.strictEqual(cls(".claude/agents/_org/role-registry.json"), "engine");
  assert.strictEqual(cls(".claude/agents/_org/sprint-hook-points.json"), "engine");
  assert.strictEqual(cls("framework/paths.registry.json"), "engine");
  assert.strictEqual(cls(".claude/paths.json"), "engine");
  assert.strictEqual(cls(".claude/settings.json"), "engine");
  assert.strictEqual(cls(".claude/framework-installed.json"), "engine");
  assert.strictEqual(cls("some/unknown.weirdext"), "engine");
  assert.strictEqual(cls("noextfile"), "engine");
});

test("--keep-local never overwrites an existing sibling: a repeat upgrade writes the next free name and keeps the earlier one", () => {
  const fx = setup();
  try {
    const earlierNew = write(fx.target, `${fx.contentDest}.mc-new`, "EDITED while reconciling the last update\n");
    const earlierLocal = write(fx.target, `${fx.engineDest}.local-0.16.0`, "// EARLIER saved local\n");
    const decisions = update.classify(fx.installed, fx.capsule, fx.target);
    const res = update.applyUpdateDecisions(fx.source, fx.target, decisions, fx.capsule.manifest, fx.txDir, {
      keepLocal: true,
      fromVersion: "0.16.0",
    });
    assert.strictEqual(fs.readFileSync(earlierNew, "utf8"), "EDITED while reconciling the last update\n", "an earlier .mc-new is never overwritten");
    assert.strictEqual(fs.readFileSync(earlierLocal, "utf8"), "// EARLIER saved local\n", "an earlier .local-<v> is never overwritten");
    assert.strictEqual(fs.readFileSync(`${earlierNew}.2`, "utf8"), "CONTENT — 2.2.0 version\n");
    assert.strictEqual(fs.readFileSync(`${earlierLocal}.2`, "utf8"), "// ENGINE — operator edit\n");
    const oc = res.localOverrides.find((o) => o.path === fx.contentDest);
    const oe = res.localOverrides.find((o) => o.path === fx.engineDest);
    assert.strictEqual(oc.sibling, `${fx.contentDest}.mc-new.2`);
    assert.strictEqual(oe.sibling, `${fx.engineDest}.local-0.16.0.2`);
  } finally {
    fs.rmSync(fx.base, { recursive: true, force: true });
  }
});
