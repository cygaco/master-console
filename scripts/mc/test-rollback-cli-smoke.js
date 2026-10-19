#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const tx = require("./transaction");

function log(name, ok, extra) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  ${tag} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-rb-cli-smoke-"));
console.log(`[smoke] tmpRoot = ${tmpRoot}`);

const updateScript = path.resolve(__dirname, "update.js");

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
console.log(`[smoke] beginTransaction.txId = ${t.txId}`);

fs.writeFileSync(preFile, "POST-APPLY (new version)\n");
const newFile = path.join(tmpRoot, "dir-b", "new.md");
fs.mkdirSync(path.dirname(newFile), { recursive: true });
fs.writeFileSync(newFile, "NEW FILE FROM CAPSULE\n");

const r1 = spawnSync(
  process.execPath,
  [updateScript, "--rollback", t.txId, "--target", tmpRoot],
  { encoding: "utf8", timeout: 30_000 },
);
log(
  "CLI --rollback positional: exit 0",
  r1.status === 0,
  `status=${r1.status}`,
);
log(
  "CLI stdout contains [OK]",
  r1.stdout.includes("[OK] rollback"),
  r1.stdout.split("\n")[0],
);
log(
  "CLI stdout reports restored=1 unlinked=1",
  r1.stdout.includes("restored=1") && r1.stdout.includes("unlinked=1"),
);
log(
  "Pre-apply content restored on disk",
  fs.readFileSync(preFile, "utf8") === "PRE-APPLY CONTENT\n",
);
log("Added file unlinked on disk", !fs.existsSync(newFile));
log(
  "result.json outcome=rolled-back",
  JSON.parse(fs.readFileSync(path.join(t.txDir, "result.json"), "utf8"))
    .outcome === "rolled-back",
);
log(
  "rollback trigger=operator",
  JSON.parse(fs.readFileSync(path.join(t.txDir, "result.json"), "utf8"))
    .rollback.trigger === "operator",
);

const r2 = spawnSync(
  process.execPath,
  [updateScript, "--rollback", "no-such-txid", "--target", tmpRoot],
  { encoding: "utf8", timeout: 30_000 },
);
log("CLI bad txId: exit 4", r2.status === 4, `status=${r2.status}`);
log(
  "CLI bad txId stderr mentions 'not found'",
  /not found/i.test(r2.stderr || ""),
);

fs.writeFileSync(preFile, "PRE-APPLY CONTENT 2\n");
const t3 = tx.beginTransaction({
  targetRoot: tmpRoot,
  sourceTreeRoot: tmpRoot,
  fromVersion: "0.4.4",
  toVersion: "0.5.0",
  decisions,
  skipFastPreflight: true,
  capsule: { dir: "/fake", release: { version: "0.5.0" } },
});
fs.writeFileSync(preFile, "MID-FLIGHT CONTENT 2\n");
fs.writeFileSync(newFile, "MID-FLIGHT NEW 2\n");
const r3 = spawnSync(
  process.execPath,
  [updateScript, `--rollback=${t3.txId}`, "--target", tmpRoot],
  { encoding: "utf8", timeout: 30_000 },
);
log(
  "CLI --rollback=<txId> equals form: exit 0",
  r3.status === 0,
  `status=${r3.status}`,
);
log(
  "CLI equals form restored content",
  fs.readFileSync(preFile, "utf8") === "PRE-APPLY CONTENT 2\n",
);

fs.writeFileSync(preFile, "PRE-APPLY CONTENT 3\n");
const t4 = tx.beginTransaction({
  targetRoot: tmpRoot,
  sourceTreeRoot: tmpRoot,
  fromVersion: "0.4.4",
  toVersion: "0.5.0",
  decisions,
  skipFastPreflight: true,
  capsule: { dir: "/fake", release: { version: "0.5.0" } },
});
fs.writeFileSync(preFile, "MID-FLIGHT 3\n");
fs.writeFileSync(newFile, "MID-FLIGHT NEW 3\n");
const r4 = spawnSync(
  process.execPath,
  [updateScript, "--rollback", t4.txId, "--target", tmpRoot, "--json"],
  { encoding: "utf8", timeout: 30_000 },
);
log("CLI --json: exit 0", r4.status === 0, `status=${r4.status}`);
let parsed = null;
try {
  parsed = JSON.parse(r4.stdout);
} catch (_e) {
}
log("CLI --json output is valid JSON", parsed !== null);
log(
  "CLI --json reports ok=true mode=rollback",
  parsed && parsed.ok === true && parsed.mode === "rollback",
);
log(
  "CLI --json reports restoredCount=1 unlinkedCount=1",
  parsed && parsed.restoredCount === 1 && parsed.unlinkedCount === 1,
);

const r5 = spawnSync(process.execPath, [updateScript, "--rollback"], {
  encoding: "utf8",
  timeout: 30_000,
});
log(
  "CLI --rollback with no arg: exit 2 (usage)",
  r5.status === 2,
  `status=${r5.status}`,
);

console.log(
  process.exitCode === 1
    ? "\n[smoke] SOME ASSERTIONS FAILED"
    : "\n[smoke] ALL ASSERTIONS PASSED",
);
