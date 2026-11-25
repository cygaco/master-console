#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mc-backup-"));
process.chdir(ROOT);
const backup = require(path.join(__dirname, "backup.js"));

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

const spec = path.join(ROOT, ".claude", "agents", "engineering", "builder.md");
fs.mkdirSync(path.dirname(spec), { recursive: true });
fs.writeFileSync(spec, "---\nmodel: original\n---\n", "utf8");

ok("the ring lives under .claude/runtime/dispatch-backups", () => {
  assert.strictEqual(path.resolve(backup.BACKUP_DIR), path.resolve(ROOT, ".claude", "runtime", "dispatch-backups"));
});

ok("the ring is not inside .claude/agents", () => {
  const rel = path.relative(path.join(ROOT, ".claude", "agents"), backup.BACKUP_DIR);
  assert.ok(rel.startsWith(".."), `backup dir is outside .claude/agents: ${backup.BACKUP_DIR}`);
});

let entry;
ok("createBackup copies the file into the ring and indexes it", () => {
  entry = backup.createBackup([spec], { summary: "fixture" });
  const held = path.join(backup.BACKUP_DIR, entry.id, ".claude", "agents", "engineering", "builder.md");
  assert.ok(fs.existsSync(held), `held copy exists: ${held}`);
  assert.ok(!fs.existsSync(path.join(ROOT, ".claude", "agents", ".system")), "nothing written under .claude/agents/.system");
  assert.strictEqual(backup.listBackups()[0].id, entry.id);
});

ok("restoreBackup reads the new location and undoes the change", () => {
  fs.writeFileSync(spec, "---\nmodel: changed\n---\n", "utf8");
  const r = backup.restoreBackup(entry.id);
  assert.deepStrictEqual(r.restored, [".claude/agents/engineering/builder.md"]);
  assert.strictEqual(fs.readFileSync(spec, "utf8"), "---\nmodel: original\n---\n");
});

process.chdir(os.tmpdir());
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\nbackup: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
