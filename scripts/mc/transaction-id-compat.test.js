"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const tx = require("./transaction");

const ROOT = path.resolve(__dirname, "..", "..");
const UPDATE_JS = path.join(ROOT, "scripts", "mc", "update.js");
const STALENESS_JS = path.join(ROOT, "scripts", "checks", "mc-staleness.js");

const OLD_FORMAT_ID = "2026-01-02T03-04-05-678Z-warp-update-demo-product";
const NEW_FORMAT_ID = "2026-01-02T03-04-05-678Z-mc-update-demo-product";

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("writer: newTransactionId emits <ts>-mc-update-<target-basename>", () => {
  const id = tx.newTransactionId(path.join(os.tmpdir(), "demo-product"));
  assert.match(id, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-mc-update-demo-product$/);
});

test("reader: isUpdateTransactionId accepts the new and the legacy id forms", () => {
  assert.strictEqual(typeof tx.isUpdateTransactionId, "function", "transaction.js exports isUpdateTransactionId");
  assert.strictEqual(tx.isUpdateTransactionId(NEW_FORMAT_ID), true, "new-format id");
  assert.strictEqual(tx.isUpdateTransactionId(OLD_FORMAT_ID), true, "legacy-format id");
  assert.strictEqual(tx.isUpdateTransactionId(`${NEW_FORMAT_ID}-notx`), true, "new-format --no-transaction id");
  assert.strictEqual(tx.isUpdateTransactionId("tx-20260801-stale"), false, "an unrelated dir is not an update transaction");
  assert.strictEqual(tx.isUpdateTransactionId("active.lock"), false, "the lock file is not a transaction");
});

function rollbackViaCli(txId) {
  const target = tmpdir("mc-txid-rollback-");
  try {
    const rel = path.join("dir-a", "file.md");
    const file = path.join(target, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "PRE-APPLY\n");
    const t = tx.beginTransaction({
      targetRoot: target,
      sourceTreeRoot: target,
      fromVersion: "1.0.0",
      toVersion: "1.0.1",
      decisions: [{ id: "a1", dest: "dir-a/file.md", kind: "skill", owner: "framework", category: "UPDATE_SAFE", reason: "test" }],
      skipFastPreflight: true,
      capsule: { dir: "/fake", release: { version: "1.0.1" } },
      txId,
    });
    assert.strictEqual(path.basename(t.txDir), txId, "transaction directory is named by the id");
    fs.writeFileSync(file, "POST-APPLY\n");
    const r = spawnSync(process.execPath, [UPDATE_JS, "--rollback", txId, "--target", target, "--json"], {
      encoding: "utf8",
      timeout: 60_000,
    });
    return { r, content: fs.readFileSync(file, "utf8") };
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

test("old-format transaction id still rolls back via update.js --rollback", () => {
  const { r, content } = rollbackViaCli(OLD_FORMAT_ID);
  assert.strictEqual(r.status, 0, `rollback exit ${r.status}: ${(r.stderr || r.stdout).slice(-400)}`);
  assert.strictEqual(content, "PRE-APPLY\n", "pre-apply content restored");
});

test("new-format transaction id rolls back via update.js --rollback", () => {
  const id = tx.newTransactionId(path.join(os.tmpdir(), "demo-product"));
  const { r, content } = rollbackViaCli(id);
  assert.strictEqual(r.status, 0, `rollback exit ${r.status}: ${(r.stderr || r.stdout).slice(-400)}`);
  assert.strictEqual(content, "PRE-APPLY\n", "pre-apply content restored");
});

function stalenessWith(txDirName) {
  const project = tmpdir("mc-txid-stale-");
  const canonical = tmpdir("mc-txid-canon-");
  try {
    fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".claude", "framework-installed.json"),
      JSON.stringify({ installedVersion: "0.1.0", installedAt: "2020-01-01T00:00:00.000Z" }),
    );
    fs.writeFileSync(path.join(canonical, "version.json"), JSON.stringify({ version: "9.9.9" }));
    if (txDirName) fs.mkdirSync(path.join(project, ".mc", "transactions", txDirName), { recursive: true });
    const env = { ...process.env, CLAUDE_PROJECT_DIR: project, MC_CANONICAL: canonical };
    const r = spawnSync(process.execPath, [STALENESS_JS, "--json"], { cwd: project, env, encoding: "utf8", timeout: 30_000 });
    let out = null;
    try { out = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop()); } catch { }
    return { status: r.status, out };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(canonical, { recursive: true, force: true });
  }
}

test("mc-staleness control: stale install with no pending transaction fails", () => {
  const { status } = stalenessWith(null);
  assert.strictEqual(status, 1);
});

test("mc-staleness: a pending new-format update transaction is recognised", () => {
  const { status, out } = stalenessWith(NEW_FORMAT_ID);
  assert.strictEqual(status, 0, JSON.stringify(out));
  assert.strictEqual(out && out.pendingTx, NEW_FORMAT_ID);
});

test("mc-staleness: a pending old-format update transaction is still recognised", () => {
  const { status, out } = stalenessWith(OLD_FORMAT_ID);
  assert.strictEqual(status, 0, JSON.stringify(out));
  assert.strictEqual(out && out.pendingTx, OLD_FORMAT_ID);
});
