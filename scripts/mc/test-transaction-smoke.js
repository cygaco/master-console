#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const tx = require("./transaction");

function log(name, ok, extra) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  ${tag} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-tx-smoke-"));
console.log(`[smoke] tmpRoot = ${tmpRoot}`);

const preFile = path.join(tmpRoot, "dir-a", "file.md");
fs.mkdirSync(path.dirname(preFile), { recursive: true });
fs.writeFileSync(preFile, "PRE-APPLY CONTENT\n");

const decisions = [
  {
    id: "asset-1",
    dest: "dir-a/file.md",
    kind: "skill",
    owner: "framework",
    category: "UPDATE_SAFE",
    reason: "test",
  },
  {
    id: "asset-2",
    dest: "dir-b/new.md",
    kind: "skill",
    owner: "framework",
    category: "ADD_SAFE",
    reason: "test new",
  },
];

const t = tx.beginTransaction({
  targetRoot: tmpRoot,
  sourceTreeRoot: tmpRoot,
  fromVersion: "0.4.4",
  toVersion: "0.5.0",
  decisions,
  skipFastPreflight: true,
  capsule: { dir: "/fake", release: { version: "0.5.0" } },
});

console.log("[smoke] beginTransaction:");
console.log("  txId =", t.txId);
log(
  "header.json exists",
  fs.existsSync(path.join(t.txDir, "header.json")),
);
log(
  "plan.json exists",
  fs.existsSync(path.join(t.txDir, "plan.json")),
);
log(
  "snapshot.json exists",
  fs.existsSync(path.join(t.txDir, "snapshot.json")),
);
log(
  "snapshot has 2 entries (UPDATE_SAFE + ADD_SAFE)",
  t.snapshot.entries.length === 2,
  "len=" + t.snapshot.entries.length,
);
log(
  "capsule.json exists",
  fs.existsSync(path.join(t.txDir, "capsule.json")),
);
log(
  "active.lock written",
  fs.existsSync(path.join(tmpRoot, ".mc", "transactions", "active.lock")),
);

const crypto = require("crypto");
const expectedSha = crypto
  .createHash("sha256")
  .update(fs.readFileSync(preFile))
  .digest("hex");
const updateEntry = t.snapshot.entries.find((e) => e.dest === "dir-a/file.md");
log(
  "pre_state_sha256 matches actual",
  updateEntry && updateEntry.pre_state_sha256 === expectedSha,
);
log(
  "backup file content identical",
  fs.readFileSync(path.join(t.txDir, "backup", "dir-a", "file.md"), "utf8") ===
    "PRE-APPLY CONTENT\n",
);
const addEntry = t.snapshot.entries.find((e) => e.dest === "dir-b/new.md");
log(
  "ADD_SAFE entry has existed_pre_apply=false + backup_path=null",
  addEntry &&
    addEntry.existed_pre_apply === false &&
    addEntry.backup_path === null &&
    addEntry.intended_action === "create",
);

fs.writeFileSync(preFile, "POST-APPLY (new version)\n");
const newFile = path.join(tmpRoot, "dir-b", "new.md");
fs.mkdirSync(path.dirname(newFile), { recursive: true });
fs.writeFileSync(newFile, "NEW FILE FROM CAPSULE\n");

const r = tx.rollbackTransaction(t.txDir, {
  trigger: "apply",
  failedAt: "asset-3",
  errorMessage: "simulated error for smoke",
});

console.log("[smoke] rollbackTransaction:");
console.log(
  `  restoredCount=${r.restoredCount} unlinkedCount=${r.unlinkedCount} partial=${r.partial}`,
);
log(
  "restoredCount=1 (the UPDATE_SAFE backup)",
  r.restoredCount === 1,
  `got ${r.restoredCount}`,
);
log(
  "unlinkedCount=1 (the ADD_SAFE write)",
  r.unlinkedCount === 1,
  `got ${r.unlinkedCount}`,
);
log(
  "pre-existing content restored",
  fs.readFileSync(preFile, "utf8") === "PRE-APPLY CONTENT\n",
);
log("added file unlinked", !fs.existsSync(newFile));
const result = JSON.parse(
  fs.readFileSync(path.join(t.txDir, "result.json"), "utf8"),
);
log(
  "result.outcome=rolled-back",
  result.outcome === "rolled-back",
  result.outcome,
);
log(
  "restoredCount+unlinkedCount = 2",
  result.rollback.restoredCount + result.rollback.unlinkedCount === 2,
);
log(
  "active.lock cleared after rollback",
  !fs.existsSync(path.join(tmpRoot, ".mc", "transactions", "active.lock")),
);

const header = JSON.parse(
  fs.readFileSync(path.join(t.txDir, "header.json"), "utf8"),
);
log(
  "header.snapshotSha256 recorded",
  typeof header.snapshotSha256 === "string" &&
    header.snapshotSha256.length === 64,
);

fs.writeFileSync(
  path.join(tmpRoot, ".mc", "transactions", "active.lock"),
  "fake-tx-id",
);
let lockThrew = false;
try {
  tx.beginTransaction({
    targetRoot: tmpRoot,
    sourceTreeRoot: tmpRoot,
    fromVersion: "0.4.4",
    toVersion: "0.5.0",
    decisions,
    skipFastPreflight: true,
  });
} catch (e) {
  lockThrew = e.code === "ETXLOCK";
}
log("begin refuses when active.lock present", lockThrew);

try {
  fs.unlinkSync(path.join(tmpRoot, ".mc", "transactions", "active.lock"));
} catch {
}

console.log(
  process.exitCode === 1
    ? "\n[smoke] SOME ASSERTIONS FAILED"
    : "\n[smoke] ALL ASSERTIONS PASSED",
);
