#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mc-swap-"));
const SRC = path.resolve(__dirname, "..", "..");
process.chdir(ROOT);
const swapLib = require(path.join(SRC, "scripts", "models", "swap.js"));
const models = require(path.join(SRC, "scripts", "models", "models.js"));

const OLD = "gemini-4-argon-high";
const NEW = "gemini-9-testnew-high";
const rel = {
  preset: ".claude/agents/_org/presets/default.json",
  preset2: ".claude/agents/_org/presets/other.json",
  registry: ".claude/agents/_org/role-registry.json",
  panel: ".claude/agents/_org/panel-lane-manifest.json",
  rows: "scripts/dispatch/catalog-models.json",
  other: "notes.txt",
  spec: ".claude/agents/engineering/security/reviewer.md",
  spec2: ".claude/agents/growth/other-lead.md",
};
const A = (r) => path.join(ROOT, rel[r]);
const entry = (provider, model, effort) => `{ "provider": "${provider}", "model": "${model}", "effort": ${effort} }`;
const BACKUPS = path.join(ROOT, ".claude", "runtime");

function fixture() {
  fs.rmSync(BACKUPS, { recursive: true, force: true });
  const w = (r, text) => {
    fs.mkdirSync(path.dirname(A(r)), { recursive: true });
    fs.writeFileSync(A(r), text, "utf8");
  };
  w("preset", `{\r\n  "id": "default",\r\n  "chains": {\r\n    "beta": [\r\n      ${entry("antigravity", OLD, "null")},\r\n      ${entry("claude", "claude-opus-5-5", '"high"')}\r\n    ],\r\n    "gamma": [\r\n      ${entry("antigravity", OLD, "null")}\r\n    ]\r\n  }\r\n}\r\n`);
  w("preset2", `{\n\t"id": "other",\n\t"chains": { "beta": [ ${entry("claude", "claude-opus-5-5", '"high"')} ] }\n}\n`);
  w("registry", `{\n  "roles": {\n    "security-reviewer": { "provider": "antigravity", "model": "${OLD}", "effort": null, "second_pass": { "provider": "openai", "model": "gpt-6.1-sol" }, "_note": "uses ${OLD} here" },\n    "alpha": { "provider": "claude", "model": "claude-opus-5-5", "effort": "high" }\n  }\n}\n`);
  w("panel", `{\n  "lanes": {\n    "agy": { "provider": "antigravity", "model": "${OLD}", "fallback": "openai" }\n  }\n}\n`);
  w("rows", `{\n  "schema": "mc/catalog-models/v1",\n  "models": []\n}\n`);
  w("other", `${OLD} stays in prose\n`);
  w("spec", `---\r\nname: reviewer\r\nprovider_model: ${OLD}   # cross-provider\r\n---\r\n\r\nBody says provider_model: ${OLD} here.\r\n`);
  w("spec2", `---\nname: other\nprovider_model: gpt-6.1-sol\n---\nprovider_model: ${OLD}\n`);
}
const w2 = (r, text) => fs.writeFileSync(A(r), text, "utf8");
const snap = () => Object.fromEntries(Object.keys(rel).map((k) => [k, fs.existsSync(A(k)) ? fs.readFileSync(A(k)) : null]));
const same = (a, b) => Object.keys(a).every((k) => (a[k] === null ? b[k] === null : b[k] !== null && a[k].equals(b[k])));

const okSync = () => ({ ok: true, detail: "ok" });
const okChecks = () => [{ name: "model-resolution", ok: true, detail: "ok" }];
const served = (ids) => (provider) => ({ provider, source: "cli:test", note: "", models: ids.map((id) => ({ id, displayName: id.toUpperCase() })) });
const base = (extra) => ({ root: ROOT, old: OLD, new: NEW, noPing: true, noRegen: true, syncSpecs: okSync, runChecks: okChecks, listServed: served([NEW]), ...extra });

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fixture();
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}
const eq = (a, b, m) => {
  if (a !== b) throw new Error(`${m || "not equal"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
};
const ok = (c, m) => {
  if (!c) throw new Error(m);
};

test("swap replaces model fields in all three file kinds and nowhere else", () => {
  const before = snap();
  const r = swapLib.swap(base());
  ok(r.ok, r.lines.join("|"));
  const t = (k) => fs.readFileSync(A(k), "utf8");
  eq((t("preset").match(new RegExp(NEW, "g")) || []).length, 2, "preset count");
  ok(!t("preset").includes(OLD), "old left in preset");
  ok(t("registry").includes(`"model": "${NEW}"`) && t("registry").includes(`uses ${OLD} here`), "registry: field changed, note kept");
  ok(t("panel").includes(`"model": "${NEW}"`), "panel");
  ok(before.preset2.equals(fs.readFileSync(A("preset2"))), "unrelated preset touched");
  ok(before.other.equals(fs.readFileSync(A("other"))), "prose touched");
  ok(t("preset").includes("\r\n") && !/[^\r]\n/.test(t("preset")), "CRLF preserved");
  ok(t("preset") === before.preset.toString("utf8").split(OLD).join(NEW), "formatting preserved");
});

test("a model missing from the catalog is appended as a data row", () => {
  const r = swapLib.swap(base());
  ok(r.ok, r.lines.join("|"));
  const d = JSON.parse(fs.readFileSync(A("rows"), "utf8"));
  eq(d.models.length, 1, "row count");
  eq(JSON.stringify(d.models[0]), JSON.stringify({ provider: "antigravity", id: NEW, displayName: NEW.toUpperCase() }), "row");
});

test("the rows file is created with the schema line when absent", () => {
  fs.rmSync(A("rows"));
  const r = swapLib.swap(base());
  ok(r.ok, r.lines.join("|"));
  eq(JSON.parse(fs.readFileSync(A("rows"), "utf8")).schema, "mc/catalog-models/v1");
  swapLib.undo({ root: ROOT, syncSpecs: okSync, noRegen: true });
  ok(!fs.existsSync(A("rows")), "undo removes a file the swap created");
});

test("an unserved new model is refused and nothing is written", () => {
  const before = snap();
  const r = swapLib.swap(base({ listServed: served(["something-else"]) }));
  ok(!r.ok && r.refused, "should refuse");
  ok(same(before, snap()), "files changed");
  ok(!fs.existsSync(BACKUPS), "a backup was taken");
});

test("a model nothing uses is refused", () => {
  const r = swapLib.swap(base({ old: "gemini-9-none" }));
  ok(!r.ok && /nothing uses/.test(r.lines[0]), r.lines[0]);
});

test("a swap to another lab's model is refused", () => {
  const before = snap();
  const r = swapLib.swap(base({ new: "gpt-6.1-sol" }));
  ok(!r.ok && /within one lab/.test(r.lines[0]), r.lines[0]);
  ok(same(before, snap()), "files changed");
});

test("dry-run writes nothing and takes no backup", () => {
  const before = snap();
  const r = swapLib.swap(base({ dryRun: true }));
  ok(r.ok && r.dryRun, "dry run result");
  ok(/2 in presets, 1 in registry, 1 in panel/.test(r.lines[0]), r.lines[0]);
  ok(same(before, snap()), "files changed");
  ok(!fs.existsSync(BACKUPS), "a backup was taken");
});

test("a red check undoes the swap automatically and says which", () => {
  const before = snap();
  const r = swapLib.swap(base({ runChecks: () => [{ name: "model-resolution", ok: false, detail: "no catalog model" }] }));
  ok(!r.ok && r.undone, "should be undone");
  ok(/model-resolution/.test(r.lines[0]) && /no catalog model/.test(r.lines[0]), r.lines[0]);
  ok(same(before, snap()), "files not restored byte-for-byte");
});

test("undo restores byte-identical files, by id; an unknown id fails", () => {
  const before = snap();
  const r = swapLib.swap(base());
  ok(r.ok && !same(before, snap()), "swap should change files");
  const u = swapLib.undo({ root: ROOT, id: r.backup, syncSpecs: okSync, noRegen: true });
  ok(u.ok, u.lines.join("|"));
  ok(same(before, snap()), "not byte-identical");
  const none = swapLib.undo({ root: ROOT, id: "nope", syncSpecs: okSync, noRegen: true });
  ok(!none.ok, "unknown id should fail");
});

test("--role pins only that role through the project layer", () => {
  const before = snap();
  let saved = null;
  const r = swapLib.swap(base({
    role: "security-reviewer",
    rolePlan: () => ({ ok: true, files: [".claude/manifest.json"] }),
    roleSave: (input) => {
      saved = input;
      return { ok: true };
    },
  }));
  ok(r.ok, r.lines.join("|"));
  eq(saved.role, "security-reviewer");
  eq(saved.model, NEW);
  eq(saved.provider, "antigravity");
  ok(same({ ...before, rows: null }, { ...snap(), rows: null }), "shipped defaults changed");
  const missing = swapLib.swap(base({ role: "alpha", rolePlan: () => ({ ok: true, files: [] }), roleSave: () => ({ ok: true }) }));
  ok(!missing.ok && /does not use/.test(missing.lines[0]), "role not using old is refused");
});

test("the result is at most five lines, including with ping and regen", () => {
  const r = swapLib.swap(base({ noPing: false, noRegen: false, ping: () => ({ ok: true }), regen: () => ({ ok: true, detail: "3 regenerated" }) }));
  ok(r.ok && r.lines.length <= 5, `${r.lines.length} lines`);
  ok(/undo: node scripts\/models\/models\.js undo /.test(r.lines[r.lines.length - 1]), "undo command");
  ok(r.lines.some((l) => /ping antigravity ok/.test(l)), "ping line");
});

test("a failed ping is reported and does not undo", () => {
  const r = swapLib.swap(base({ noPing: false, ping: () => ({ ok: false, detail: "timeout" }) }));
  ok(r.ok && r.changed, "swap kept");
  ok(r.lines.some((l) => /FAILED \(timeout\)/.test(l)), "failure reported");
});

test("undo keeps an edit made after the swap in a snapshot and prints its id", () => {
  const r = swapLib.swap(base());
  ok(r.ok, r.lines.join("|"));
  fs.writeFileSync(A("registry"), fs.readFileSync(A("registry"), "utf8").replace('"alpha":', '"USER_EDIT": { "provider": "claude", "model": "claude-opus-5-5" },\n    "alpha":'));
  const u = swapLib.undo({ root: ROOT, syncSpecs: okSync, noRegen: true });
  ok(u.ok && u.snapshot && u.lines.some((l) => l.includes(u.snapshot)), "snapshot id not printed");
  const held = path.join(BACKUPS, "dispatch-backups", u.snapshot, ...rel.registry.split("/"));
  ok(fs.readFileSync(held, "utf8").includes("USER_EDIT"), "snapshot lacks the edit");
});

test("a bare undo skips a swap that rolled itself back and reverts the one in effect", () => {
  const before = snap();
  const a = swapLib.swap(base());
  ok(a.ok, a.lines.join("|"));
  const b = swapLib.swap(base({ old: NEW, new: "gemini-4-zinc-high", listServed: served(["gemini-4-zinc-high"]), runChecks: () => [{ name: "c", ok: false, detail: "red" }] }));
  ok(!b.ok && b.undone, "second swap should roll back");
  const u = swapLib.undo({ root: ROOT, syncSpecs: okSync, noRegen: true });
  ok(u.ok && u.backup === a.backup, "undo picked the wrong swap");
  ok(same(before, snap()), "first swap still in effect");
  const again = swapLib.undo({ root: ROOT, syncSpecs: okSync, noRegen: true });
  ok(!again.ok && /no swap in effect/.test(again.lines[0]), "second bare undo should find nothing");
  const rolled = swapLib.undo({ root: ROOT, id: b.backup, syncSpecs: okSync, noRegen: true });
  ok(!rolled.ok && /never took effect/.test(rolled.lines[0]), "rolled-back swap must not be restorable by id");
});

test("a file that existed but failed to copy refuses the swap and writes nothing", () => {
  const real = require(path.join(SRC, "scripts", "dispatch", "backup.js"));
  const flaky = {
    ...real,
    createBackup: (files, meta) => {
      const e = real.createBackup(files, meta);
      fs.rmSync(path.join(real.BACKUP_DIR, e.id, ...rel.panel.split("/")), { force: true });
      return e;
    },
  };
  const before = snap();
  const r = swapLib.swap(base({ backup: flaky }));
  ok(!r.ok && r.refused && /could not back up/.test(r.lines[0]), r.lines[0]);
  ok(same(before, snap()), "files changed");
  const u = swapLib.undo({ root: ROOT, syncSpecs: okSync, noRegen: true });
  ok(!u.ok, "failed backup must not be undoable");
});

test("undo deletes only files the swap created, never a live file missing from the backup", () => {
  const r = swapLib.swap(base());
  ok(r.ok, r.lines.join("|"));
  fs.rmSync(path.join(BACKUPS, "dispatch-backups", r.backup, ...rel.panel.split("/")), { force: true });
  swapLib.undo({ root: ROOT, id: r.backup, syncSpecs: okSync, noRegen: true });
  ok(fs.existsSync(A("panel")), "live file deleted");
});

test("a swap used only in the panel manifest skips the ping and still prints the result", () => {
  w2("registry", `{
  "roles": {
    "alpha": { "provider": "claude", "model": "claude-opus-5-5", "effort": "high" }
  }
}
`);
  w2("preset", `{ "id": "default", "chains": {} }
`);
  let pinged = 0;
  const r = swapLib.swap(base({ noPing: false, ping: () => { pinged++; return { ok: true }; } }));
  ok(r.ok && pinged === 0, "ping should not run");
  ok(r.lines.some((l) => /ping skipped \(no role uses/.test(l)) && /undo: /.test(r.lines[r.lines.length - 1]), r.lines.join("|"));
});

test("a ping that throws cannot hide the backup id and the undo line", () => {
  const r = swapLib.swap(base({ noPing: false, ping: () => { throw new Error("boom"); } }));
  ok(r.ok && r.lines.some((l) => /FAILED \(boom\)/.test(l)) && /undo: /.test(r.lines[r.lines.length - 1]), r.lines.join("|"));
  ok(r.lines.some((l) => l.startsWith("backup ")), "backup line");
});

test("provider_model is replaced in frontmatter only, backed up, and restored by undo", () => {
  const before = snap();
  const r = swapLib.swap(base());
  ok(r.ok, r.lines.join("|"));
  const spec = fs.readFileSync(A("spec"), "utf8");
  ok(spec.includes(`provider_model: ${NEW}   # cross-provider\r\n`), "frontmatter line not replaced");
  ok(spec.includes(`Body says provider_model: ${OLD} here.`), "body mention was edited");
  ok(before.spec2.equals(fs.readFileSync(A("spec2"))), "a spec naming another model, or only the body, was touched");
  ok(/1 in role specs/.test(r.lines[0]), r.lines[0]);
  const held = path.join(BACKUPS, "dispatch-backups", r.backup, ...rel.spec.split("/"));
  ok(fs.readFileSync(held, "utf8").includes(`provider_model: ${OLD}`), "spec not in the backup");
  const u = swapLib.undo({ root: ROOT, id: r.backup, syncSpecs: okSync, noRegen: true });
  ok(u.ok, u.lines.join("|"));
  ok(same(before, snap()), "not byte-identical after undo");
  ok(/^restored \d+ files? from/.test(u.lines[0]) && u.lines[0].startsWith("restored 5 files"), u.lines[0]);
});

test("a red model-chain check undoes the swap, specs included", () => {
  const before = snap();
  const r = swapLib.swap(base({ runChecks: () => [{ name: "model-resolution", ok: true, detail: "ok" }, { name: "model-chain", ok: false, detail: "spec drift" }] }));
  ok(!r.ok && r.undone && /model-chain/.test(r.lines[0]), r.lines[0]);
  ok(same(before, snap()), "files not restored");
});

test("the default checks include model-chain", () => {
  const src = fs.readFileSync(path.join(SRC, "scripts", "models", "swap.js"), "utf8");
  ok(/\["model-chain", \["scripts\/checks\/model-chain\.js"\]\]/.test(src), "model-chain missing from default checks");
});

test("a ping answered by another model is reported, not ok", () => {
  const r = swapLib.swap(base({ noPing: false, ping: (root, role, lab, id) => ({ ok: id !== NEW, detail: `answered by ${OLD}, not ${NEW}` }) }));
  ok(r.ok && r.lines.some((l) => /FAILED \(answered by .*, not /.test(l)), r.lines.join("|"));
});

test("models.js: an unknown flag exits 2 and writes nothing", () => {
  const before = snap();
  const lines = [];
  const opts = { syncSpecs: okSync, runChecks: okChecks, listServed: served([NEW]) };
  eq(models.main(["swap", OLD, NEW, "--dryrun", "--no-ping", "--no-regen"], { root: ROOT, out: (s) => lines.push(s), swapOpts: opts }), 2, "exit");
  eq(lines.length, 1, "one line");
  ok(same(before, snap()) && !fs.existsSync(BACKUPS), "something was written");
  eq(models.main(["undo", "--bogus"], { root: ROOT, out: (s) => lines.push(s), swapOpts: opts }), 2, "undo exit");
});

test("undo --no-regen skips regen; without it regen runs", () => {
  let regens = 0;
  const regen = () => {
    regens++;
    return { ok: true, detail: "x" };
  };
  const opts = { syncSpecs: okSync, runChecks: okChecks, listServed: served([NEW]), regen };
  const a = swapLib.swap(base());
  ok(a.ok, a.lines.join("|"));
  eq(models.main(["undo", "--no-regen"], { root: ROOT, out: () => {}, swapOpts: opts }), 0, "exit");
  eq(regens, 0, "regen ran despite --no-regen");
  const b = swapLib.swap(base());
  ok(b.ok, b.lines.join("|"));
  eq(models.main(["undo"], { root: ROOT, out: () => {}, swapOpts: opts }), 0, "exit");
  eq(regens, 1, "regen did not run");
});

test("models.js: swap, undo, usage and delegation to find", () => {
  const lines = [];
  const out = (s) => lines.push(s);
  const opts = { syncSpecs: okSync, runChecks: okChecks, listServed: served([NEW]) };
  eq(models.main(["swap", OLD, NEW, "--no-ping", "--no-regen", "--dry-run"], { root: ROOT, out, swapOpts: opts }), 0, "dry-run exit");
  ok(lines.length <= 5, "dry-run lines");
  eq(models.main(["swap", OLD], { root: ROOT, out }), 2, "usage exit");
  eq(models.main(["swap", OLD, NEW, "--no-ping", "--no-regen"], { root: ROOT, out, swapOpts: opts }), 0, "swap exit");
  eq(models.main(["undo"], { root: ROOT, out, swapOpts: { ...opts, noRegen: true } }), 0, "undo exit");
  eq(models.main(["find"], { out, find: { main: () => 7 } }), 7, "find delegates");
  eq(models.main(["bogus"], { out }), 2, "unknown verb");
});

try {
  process.chdir(SRC);
  fs.rmSync(ROOT, { recursive: true, force: true });
} catch (_) {
}
if (failures.length) {
  console.error(failures.map((f) => `FAIL ${f}`).join("\n"));
  console.error(`${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
