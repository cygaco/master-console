"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const SAVE = path.join(__dirname, "save.js");
const PRESETS = path.join(__dirname, "presets.js");
const ROLE = "zz-custom-role";

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function project() {
  const dir = tmp("savepre-");
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  w(".claude/paths.json", fs.readFileSync(path.join(REPO, ".claude", "paths.json"), "utf8"));
  w(".claude/manifest.json", JSON.stringify({ agentProviders: {} }, null, 2) + "\n");
  w(".claude/agents/_org/role-registry.json", JSON.stringify({
    roles: { [ROLE]: { provider: "claude", model: "claude-sonnet-5-5", effort: "high", spec: `.claude/agents/${ROLE}.md` } },
  }));
  w(`.claude/agents/${ROLE}.md`, `---\nname: ${ROLE}\nmodel: claude-sonnet-5-5\neffort: high\n---\nbody\n`);
  w(".claude/agents/_org/presets/p.json", JSON.stringify({
    id: "p", title: "p", dated: "2026-10-31", reason: "Because.", evidence: ["fixture"],
    review: { cross_family_required: true },
    pins: { [ROLE]: { provider: "claude", model: "claude-opus-5-5", effort: "high" } },
  }));
  return dir;
}

const logOf = (dir) => path.join(dir, ".claude", "project", "model-presets.log.jsonl");
const rowsOf = (file) =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

test("F3.2 every pin of every shipped preset passes the REAL previewSave", () => {
  process.chdir(REPO);
  const { previewSave } = require("./save");
  const P = require("./presets");
  const presetsDir = path.join(REPO, ".claude", "agents", "_org", "presets");
  const ids = fs.readdirSync(presetsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  assert.ok(ids.length >= 3);
  for (const id of ids) {
    const preset = P.loadPreset(id, { presetsDir });
    for (const [role, want] of Object.entries(preset.pins)) {
      const r = previewSave({
        role,
        provider: want.provider,
        model: want.model,
        effort: want.effort || null,
        fallback: want.fallback || (want.provider === "claude" ? null : "claude"),
      });
      assert.equal(r.ok, true, `${id}/${role}: ${r.error}`);
    }
  }
});

test("F3.2 a role that is in the registry but not in the catalog list is accepted", () => {
  const dir = project();
  const script = path.join(tmp("child-"), "preview.js");
  fs.writeFileSync(script, `const r=require(${JSON.stringify(SAVE)}).previewSave({role:${JSON.stringify(ROLE)},provider:"claude",model:"claude-opus-5-5",effort:"high"});console.log(JSON.stringify({ok:r.ok,error:r.error}));`);
  const r = spawnSync(process.execPath, [script], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout), { ok: true });
});

test("F3.1 + F3.6 a hand save reads and logs under the write root; a preset write logs nothing", () => {
  const dir = project();
  const decoy = tmp("decoy-");
  fs.mkdirSync(path.join(decoy, ".claude"), { recursive: true });
  fs.copyFileSync(path.join(dir, ".claude", "paths.json"), path.join(decoy, ".claude", "paths.json"));
  const script = path.join(tmp("child-"), "save.js");
  fs.writeFileSync(script, `
const s=require(${JSON.stringify(SAVE)});
const a={role:${JSON.stringify(ROLE)},provider:"claude",model:"claude-opus-5-5",effort:"high"};
const b={...a,effort:"low"};
const r1=s.applySave(a,{source:"preset",skipBackup:true});
const r2=s.applySave(b);
console.log(JSON.stringify({r1:r1.ok,r2:r2.ok}));`);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: decoy };
  const r = spawnSync(process.execPath, [script], { cwd: dir, env, encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout), { r1: true, r2: true }, r.stderr);
  const rows = rowsOf(logOf(dir));
  assert.equal(rows.filter((x) => x.type === "manual-pin").length, 1);
  const mp = rows.find((x) => x.type === "manual-pin");
  assert.equal(mp.from.effort, "high");
  assert.equal(mp.to.effort, "low");
  assert.equal(fs.existsSync(logOf(decoy)), false);
});

test("F3.5 HELD: the command line refuses apply/undo/unapply (non-zero + held message), writes nothing", () => {
  const dir = project();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const before = fs.readFileSync(path.join(dir, ".claude", "agents", `${ROLE}.md`), "utf8");
  for (const argv of [["apply", "p"], ["undo"], ["unapply", "p"]]) {
    const r = spawnSync(process.execPath, [PRESETS, ...argv], { cwd: dir, env, encoding: "utf8" });
    assert.equal(r.status, 1, argv.join(" "));
    assert.match(r.stderr, /held this release/);
  }
  assert.equal(fs.existsSync(logOf(dir)), false, "no log row written");
  assert.equal(fs.readFileSync(path.join(dir, ".claude", "agents", `${ROLE}.md`), "utf8"), before);
});

test("a failed provenance write is reported as provenanceLogged:false, and the pin is still saved", () => {
  const dir = project();
  const script = path.join(tmp("child-"), "save.js");
  fs.writeFileSync(script, `
const s=require(${JSON.stringify(SAVE)});
const P=require(${JSON.stringify(PRESETS)});
P.recordManualPin=()=>{throw new Error("log disk full");};
const a={role:${JSON.stringify(ROLE)},provider:"claude",model:"claude-opus-5-5",effort:"low"};
const r=s.applySave(a);
console.log(JSON.stringify({ok:r.ok,logged:r.provenanceLogged,err:r.provenanceError}));`);
  const r = spawnSync(process.execPath, [script], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, logged: false, err: "log disk full" }, r.stderr);
  assert.match(r.stderr, /preset log not updated/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, ".claude", "manifest.json"), "utf8")).agentProviders[ROLE], { provider: "claude", model: "claude-opus-5-5", effort: "low" }, "the pin is in the project layer");
  assert.match(fs.readFileSync(path.join(dir, ".claude", "agents", `${ROLE}.md`), "utf8"), /^model: claude-sonnet-5-5$/m, "the spec keeps the product default");
});

test("failed provenance write sets a durable marker; apply/undo REFUSE until --confirm", () => {
  const dir = project();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const script = path.join(tmp("child-"), "save.js");
  fs.writeFileSync(script, `
const s=require(${JSON.stringify(SAVE)});
const P=require(${JSON.stringify(PRESETS)});
P.recordManualPin=()=>{throw new Error("log disk full");};
const r=s.applySave({role:${JSON.stringify(ROLE)},provider:"claude",model:"claude-opus-5-5",effort:"low"});
console.log(JSON.stringify({ok:r.ok,logged:r.provenanceLogged,marked:r.provenanceMarked}));`);
  const r = spawnSync(process.execPath, [script], { cwd: dir, env, encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, logged: false, marked: true }, r.stderr);
  assert.ok(fs.existsSync(logOf(dir) + ".provenance-incomplete"), "durable marker file");
  const a = spawnSync(process.execPath, [PRESETS, "apply", "p"], { cwd: dir, env, encoding: "utf8" });
  assert.equal(a.status, 1);
  assert.match(a.stderr, /held this release/);
  const u = spawnSync(process.execPath, [PRESETS, "undo"], { cwd: dir, env, encoding: "utf8" });
  assert.equal(u.status, 1);
  assert.match(u.stderr, /held this release/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, ".claude", "manifest.json"), "utf8")).agentProviders[ROLE], { provider: "claude", model: "claude-opus-5-5", effort: "low" }, "the pin is in the project layer");
  assert.match(fs.readFileSync(path.join(dir, ".claude", "agents", `${ROLE}.md`), "utf8"), /^model: claude-sonnet-5-5$/m, "the spec keeps the product default");
  assert.ok(fs.existsSync(logOf(dir) + ".provenance-incomplete"), "marker intact");
});

test("HELD: undo (with or without --confirm-overrides) exits 1 with the held message", () => {
  const dir = project();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  for (const argv of [["undo"], ["undo", "--confirm-overrides"]]) {
    const r = spawnSync(process.execPath, [PRESETS, ...argv], { cwd: dir, env, encoding: "utf8" });
    assert.equal(r.status, 1, "refusal must exit non-zero");
    assert.match(r.stderr, /held this release/);
  }
});

test("a manual pin whose provenance write AND marker write both fail still blocks a later apply/undo (no marker needed)", () => {
  const dir = project();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const script = path.join(tmp("child-"), "save.js");
  fs.writeFileSync(script, `
const s=require(${JSON.stringify(SAVE)});
const P=require(${JSON.stringify(PRESETS)});
P.recordManualPin=()=>{throw new Error("log disk full");};
P.markProvenanceIncomplete=()=>{throw new Error("marker disk full");};
const r=s.applySave({role:${JSON.stringify(ROLE)},provider:"claude",model:"claude-opus-5-5",effort:"low"});
console.log(JSON.stringify({ok:r.ok,logged:r.provenanceLogged,marked:r.provenanceMarked}));`);
  const r = spawnSync(process.execPath, [script], { cwd: dir, env, encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, logged: false, marked: false }, r.stderr);
  assert.equal(fs.existsSync(logOf(dir) + ".provenance-incomplete"), false, "NO marker exists");
  const a = spawnSync(process.execPath, [PRESETS, "apply", "p"], { cwd: dir, env, encoding: "utf8" });
  assert.equal(a.status, 1, a.stdout);
  assert.match(a.stderr, /held this release/);
  const u = spawnSync(process.execPath, [PRESETS, "undo"], { cwd: dir, env, encoding: "utf8" });
  assert.equal(u.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".claude", "manifest.json"), "utf8")).agentProviders[ROLE].effort, "low");
  assert.match(fs.readFileSync(path.join(dir, ".claude", "agents", `${ROLE}.md`), "utf8"), /^effort: high$/m);
});

test("PIN set: an in-process pin to a model no tier alias reaches is refused (a pin chooses a tier)", () => {
  const dir = project();
  const script = path.join(tmp("child-"), "preview.js");
  fs.writeFileSync(script, `const r=require(${JSON.stringify(SAVE)}).previewSave({role:${JSON.stringify(ROLE)},provider:"claude",model:"claude-opus-4-8",effort:"high"});console.log(JSON.stringify({ok:r.ok,error:r.error}));`);
  const r = spawnSync(process.execPath, [script], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.error, /An in-process pin chooses a tier: claude-opus-4-8/);
});

test("PIN set --default: removes the project pin and puts the spec back to the product default", () => {
  const dir = project();
  const script = path.join(tmp("child-"), "save.js");
  fs.writeFileSync(script, `
const s=require(${JSON.stringify(SAVE)});
const a=s.applySave({role:${JSON.stringify(ROLE)},provider:"claude",model:"claude-opus-5-5",effort:"low"},{skipBackup:true});
const b=s.applySave({role:${JSON.stringify(ROLE)},remove:true},{skipBackup:true});
console.log(JSON.stringify({a:a.ok,b:b.ok,err:b.error||null}));`);
  const r = spawnSync(process.execPath, [script], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout), { a: true, b: true, err: null }, r.stderr);
  const ap = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "manifest.json"), "utf8")).agentProviders;
  assert.equal(Object.prototype.hasOwnProperty.call(ap, ROLE), false, "the pin is gone");
});
