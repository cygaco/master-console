"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { build, buildRules, classify } = require("./build");
const { validate } = require("./validate");

function write(root, rel, body) {
  const full = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function productWithBackup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-mc-backup-"));
  write(root, "CLAUDE.md", "# product\n");
  write(root, "_mc/commands/demo.md", "demo\n");
  write(root, ".claude/commands/demo.md", "demo\n");
  write(root, ".mc-backup/2026-01-01T00-00-00-000Z/CLAUDE.md", "# pre-install\n");
  write(root, ".mc-backup/2026-01-01T00-00-00-000Z/BACKUP_MANIFEST.json", "{}\n");
  write(root, ".mc-backup/2026-01-01T00-00-00-000Z/.claude/commands/old.md", "old\n");
  return root;
}

test("the install backup tree classifies as runtime, unmanaged, in product and canonical mode", () => {
  for (const prefix of ["_mc", "framework"]) {
    const rules = buildRules(prefix);
    for (const rel of [
      ".mc-backup/2026-01-01T00-00-00-000Z/CLAUDE.md",
      ".mc-backup/2026-01-01T00-00-00-000Z/BACKUP_MANIFEST.json",
      ".mc-backup/2026-01-01T00-00-00-000Z/.claude/commands/old.md",
    ]) {
      const c = classify(rel, rules);
      assert.ok(c && c.entry, `${prefix}: ${rel} is unclassified`);
      assert.strictEqual(c.entry.owner, "runtime", `${prefix}: ${rel} owner`);
      assert.strictEqual(c.entry.managed, false, `${prefix}: ${rel} managed`);
    }
  }
});

test("a product carrying an install backup gets its _mc/MANIFEST.json written, and validate finds nothing unmanifested in the backup", () => {
  const root = productWithBackup();
  try {
    const r = build({ root, sourcePrefix: "_mc" });
    assert.strictEqual(r.ok, true, `build refused: ${r.error} ${JSON.stringify(r.unclassified || [])}`);
    const manifestPath = path.join(root, "_mc", "MANIFEST.json");
    assert.ok(fs.existsSync(manifestPath), "_mc/MANIFEST.json not written");
    const v = validate({ manifestPath, root });
    const backupFindings = (v.findings.unmanifested || []).filter((p) => p.startsWith(".mc-backup/"));
    assert.deepStrictEqual(backupFindings, []);
    assert.deepStrictEqual(v.findings.missing, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
