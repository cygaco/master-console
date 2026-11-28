
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const events = require("./lib/update-events");

const TX_ROOT_REL = path.join(".mc", "transactions");

const stripBom = (s) => (typeof s === "string" ? s.replace(/^﻿/, "") : s);

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const TX_KIND = "mc-update";
const LEGACY_TX_KIND = "warp-update";

function newTransactionId(targetRoot) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-${TX_KIND}-${path.basename(targetRoot)}`;
}

function isUpdateTransactionId(name) {
  const s = String(name || "");
  return s.includes(`-${TX_KIND}-`) || s.includes(`-${LEGACY_TX_KIND}-`);
}

function txRootFor(targetRoot) {
  return path.join(targetRoot, TX_ROOT_REL);
}

function activeLockPath(targetRoot) {
  return path.join(txRootFor(targetRoot), "active.lock");
}

function checkActiveLock(targetRoot) {
  const lock = activeLockPath(targetRoot);
  if (!fs.existsSync(lock)) return { locked: false };
  try {
    const txt = fs.readFileSync(lock, "utf8").trim();
    return { locked: true, existingTxId: txt, path: lock };
  } catch {
    return { locked: true, existingTxId: null, path: lock };
  }
}

function writeActiveLock(targetRoot, txId) {
  const lock = activeLockPath(targetRoot);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, txId);
}

function clearActiveLock(targetRoot) {
  const lock = activeLockPath(targetRoot);
  try {
    if (fs.existsSync(lock)) fs.unlinkSync(lock);
  } catch {
  }
}

function runFastPreflightSubset(opts) {
  const preflight = require("./preflight");
  const r = preflight.runPreflight({
    targetRoot: opts.targetRoot,
    sourceTreeRoot: opts.sourceTreeRoot,
    toVersion: opts.toVersion,
    sourceRoot: opts.sourceRoot,
    allowStale: opts.allowStale,
    forceFresh: opts.forceFresh,
    allowVersionDrift: opts.allowVersionDrift,
    operatorOverrides: opts.operatorOverrides,
    overrideReason: opts.overrideReason,
    operator: opts.operator,
    allRed: true,
    txId: opts.txId,
  });
  const subset = [
    "mc-install-baseline",
    "mc-manifest-honesty",
    "mc-tracked-transients",
  ];
  const gates = r.gates.filter((g) => subset.includes(g.name));
  const ok = gates.every((g) => g.status === "green" || g.status === "yellow");
  return { ok, gates };
}

const SNAPSHOT_CATEGORIES = new Set([
  "ADD_SAFE",
  "UPDATE_SAFE",
  "GENERATED_REBUILD",
  "DELETE_SAFE",
]);

function buildSnapshotEntries(targetRoot, txDir, decisions) {
  const entries = [];
  const backupRoot = path.join(txDir, "backup");
  for (const d of decisions) {
    if (!SNAPSHOT_CATEGORIES.has(d.category)) continue;
    const abs = path.join(targetRoot, d.dest);
    const existed = fs.existsSync(abs);
    let pre_state_sha256 = null;
    let backup_path = null;
    if (existed) {
      pre_state_sha256 = sha256File(abs);
      const backupAbs = path.join(backupRoot, d.dest);
      fs.mkdirSync(path.dirname(backupAbs), { recursive: true });
      fs.copyFileSync(abs, backupAbs);
      backup_path = path.relative(txDir, backupAbs).replace(/\\/g, "/");
    }
    let intended_action = "overwrite";
    if (d.category === "ADD_SAFE") intended_action = "create";
    else if (d.category === "DELETE_SAFE") intended_action = "delete";
    else if (d.category === "GENERATED_REBUILD") intended_action = "overwrite";
    entries.push({
      dest: d.dest,
      category: d.category,
      existed_pre_apply: existed,
      pre_state_sha256,
      backup_path,
      intended_action,
    });
  }
  return entries;
}

const METADATA_FILES = [
  ".claude/framework-installed.json",
  ".claude/manifest.json",
];

function buildMetadataEntries(targetRoot, txDir, entries) {
  const out = [];
  for (const dest of METADATA_FILES) {
    if (entries.some((e) => e.dest === dest)) continue;
    const abs = path.join(targetRoot, dest);
    const existed = fs.existsSync(abs);
    if (!existed && dest !== ".claude/framework-installed.json") continue;
    let backup_path = null;
    if (existed) {
      backup_path = `backup-meta/${dest}`;
      const backupAbs = path.join(txDir, backup_path);
      fs.mkdirSync(path.dirname(backupAbs), { recursive: true });
      fs.copyFileSync(abs, backupAbs);
    }
    out.push({ dest, existed_pre_apply: existed, backup_path });
  }
  return out;
}

function atomicWriteJSON(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function beginTransaction(opts) {
  if (!opts || !opts.targetRoot)
    throw new Error("beginTransaction: targetRoot required");
  const targetRoot = path.resolve(opts.targetRoot);
  const lockState = checkActiveLock(targetRoot);
  if (lockState.locked) {
    const err = new Error(
      `another mc update is in progress (or crashed). Active txId: ${lockState.existingTxId || "<unknown>"}. Inspect ${lockState.path} — if no apply is running, remove the file and retry.`,
    );
    err.code = "ETXLOCK";
    err.lock = lockState;
    throw err;
  }
  if (!opts.skipFastPreflight) {
    const sub = runFastPreflightSubset(opts);
    if (!sub.ok) {
      const reds = sub.gates
        .filter((g) => g.status === "red")
        .map((g) => g.name);
      const err = new Error(
        `fast preflight subset disagreed with earlier pass: ${reds.join(", ")}. State changed between classify and apply — re-run /mc:update --to <v>.`,
      );
      err.code = "EFASTPREFLIGHTDRIFT";
      err.fastSubset = sub;
      throw err;
    }
  }

  const txId = opts.txId || newTransactionId(targetRoot);
  const txDir = path.join(txRootFor(targetRoot), txId);
  fs.mkdirSync(txDir, { recursive: true });

  const planFile = path.join(txDir, "plan.json");
  atomicWriteJSON(planFile, opts.decisions || []);

  const entries = buildSnapshotEntries(targetRoot, txDir, opts.decisions || []);
  const snapshot = {
    $schema: "mc/update-snapshot/v1",
    txId,
    entries,
    metadata: buildMetadataEntries(targetRoot, txDir, entries),
  };
  const snapshotFile = path.join(txDir, "snapshot.json");
  atomicWriteJSON(snapshotFile, snapshot);
  const snapshotSha256 = sha256File(snapshotFile);
  try {
    fs.chmodSync(snapshotFile, 0o400);
  } catch {
  }
  fs.writeFileSync(path.join(txDir, "snapshot.delta.jsonl"), "");

  const headerFile = path.join(txDir, "header.json");
  const header = {
    kind: "mc:update",
    txId,
    fromVersion: opts.fromVersion,
    toVersion: opts.toVersion,
    sourceRoot: opts.sourceRoot || null,
    targetRoot,
    sourceTreeRoot: opts.sourceTreeRoot || null,
    startedAt: new Date().toISOString(),
    snapshotSha256,
  };
  atomicWriteJSON(headerFile, header);

  if (opts.capsule) {
    atomicWriteJSON(path.join(txDir, "capsule.json"), {
      dir: opts.capsule.dir,
      release: opts.capsule.release,
    });
  }

  writeActiveLock(targetRoot, txId);

  events.emitTransactionStart(targetRoot, {
    txId,
    fromVersion: opts.fromVersion,
    toVersion: opts.toVersion,
    filesToWrite: entries.filter(
      (e) =>
        e.intended_action === "overwrite" || e.intended_action === "create",
    ).length,
    filesToDelete: entries.filter((e) => e.intended_action === "delete").length,
    filesToAdd: entries.filter((e) => e.intended_action === "create").length,
    backupPlanCount: entries.filter((e) => e.backup_path != null).length,
  });

  return { txId, txDir, snapshot, headerFile, planFile, snapshotFile };
}

function recordDelta(txDir, entry) {
  try {
    fs.appendFileSync(
      path.join(txDir, "snapshot.delta.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    );
    return true;
  } catch {
    return false;
  }
}

function readDeltas(txDir) {
  const file = path.join(txDir, "snapshot.delta.jsonl");
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && rec.kind && (rec.dest || Array.isArray(rec.paths))) out.push(rec);
    } catch {
    }
  }
  return out;
}

const PATH_BATCH = 100;

function batches(list) {
  const out = [];
  for (let i = 0; i < list.length; i += PATH_BATCH) out.push(list.slice(i, i + PATH_BATCH));
  return out;
}

function trackedPaths(targetRoot, paths) {
  const { git } = require("../lib/ensure-gitignore-line");
  const out = [];
  for (const batch of batches(paths)) {
    const r = git(targetRoot, ["--literal-pathspecs", "ls-files", "-z", "--", ...batch]);
    if (r.status === 0) out.push(...r.stdout.split("\0").filter(Boolean));
  }
  return out;
}

function retrackPaths(targetRoot, paths) {
  const { git } = require("../lib/ensure-gitignore-line");
  const tracked = new Set(trackedPaths(targetRoot, paths));
  const wanted = paths.filter(
    (p) => !tracked.has(p) && fs.existsSync(path.join(targetRoot, p)),
  );
  const added = [];
  const failed = [];
  let error = null;
  for (const batch of batches(wanted)) {
    const r = git(targetRoot, ["--literal-pathspecs", "add", "-f", "--", ...batch]);
    if (r.status === 0) added.push(...batch);
    else {
      failed.push(...batch);
      error = error || (r.stderr || (r.error && r.error.message) || "git add failed").trim();
    }
  }
  return { added, failed, error };
}

function describeRetrack(r) {
  const parts = [];
  if (r.added.length) parts.push(`tracked in git again: ${r.added.join(", ")}`);
  if (r.failed.length) {
    parts.push(
      `could NOT re-add (run git add -f yourself): ${r.failed.join(", ")} — ${r.error.replace(/\s+/g, " ")}`,
    );
  }
  return parts.join("; ") || "no untracked file needed to be added back to git";
}

const RESTORE_KINDS = new Set(["keep-local-engine-restore", "conflict-restore"]);

function keepUndoCopy(txDir, targetRoot, dest) {
  const abs = path.join(targetRoot, dest);
  if (!fs.existsSync(abs)) return false;
  const first = path.join(txDir, "rollback-undo", dest);
  const current = sha256File(abs);
  let dst = first;
  for (let n = 2; fs.existsSync(dst); n++) {
    if (sha256File(dst) === current) return true;
    dst = `${first}.${n}`;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(abs, dst);
  return true;
}

function saveUnproven(txDir, targetRoot, dest, st) {
  if (keepUndoCopy(txDir, targetRoot, dest)) st.savedBeforeRestore.push(dest);
}

function leaveInPlace(txDir, rel, st) {
  st.leftInPlace.push(rel);
  const msg = `${rel} changed after the update — left in place`;
  writeDiagnostic(txDir, `rollback: ${msg}`);
  console.error(msg);
}

function rollbackEntries(txDir, targetRoot, snapshot, st) {
  const written = new Map(
    readDeltas(txDir)
      .filter((r) => r.kind === "entry-written")
      .map((r) => [r.dest, r.sha256]),
  );
  for (const e of snapshot.entries) {
    const abs = path.join(targetRoot, e.dest);
    try {
      const restores = !!(e.existed_pre_apply && e.backup_path);
      if (!restores && e.existed_pre_apply) continue;
      const backupAbs = restores ? path.join(txDir, e.backup_path) : null;
      if (restores && !fs.existsSync(backupAbs)) {
        st.partial = true;
        st.firstError = st.firstError || `backup missing: ${e.backup_path}`;
        writeDiagnostic(
          txDir,
          `rollback: backup missing for ${e.dest} — leaving in place`,
        );
        continue;
      }
      const current = sha256File(abs);
      const original = restores ? sha256File(backupAbs) : null;
      if (!restores && current === null) continue;
      if (!written.has(e.dest)) {
        if (current !== original) saveUnproven(txDir, targetRoot, e.dest, st);
      } else if (current !== written.get(e.dest) && current !== original) {
        leaveInPlace(txDir, e.dest, st);
        continue;
      }
      if (restores) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.copyFileSync(backupAbs, abs);
        st.restoredCount += 1;
      } else {
        fs.unlinkSync(abs);
        st.unlinkedCount += 1;
      }
    } catch (err) {
      st.partial = true;
      st.firstError = st.firstError || err.message;
      writeDiagnostic(txDir, `rollback: error on ${e.dest}: ${err.message}`);
    }
  }
}

function rollbackRecorded(txDir, targetRoot, snapshot, st) {
  const deltas = readDeltas(txDir);
  const notRestored = new Set();
  const leave = (rel) => leaveInPlace(txDir, rel, st);
  const fail = (rel, message) => {
    st.partial = true;
    st.firstError = st.firstError || message;
    notRestored.add(rel);
    writeDiagnostic(txDir, `rollback: ${message}`);
  };

  const metadata = snapshot.metadata || [];
  const metaDests = new Set(metadata.map((m) => m.dest));
  for (const m of metadata) {
    const abs = path.join(targetRoot, m.dest);
    try {
      const backupAbs = m.backup_path ? path.join(txDir, m.backup_path) : null;
      if (m.existed_pre_apply && !(backupAbs && fs.existsSync(backupAbs))) {
        fail(m.dest, `backup missing: ${m.backup_path}`);
        continue;
      }
      const current = sha256File(abs);
      const original = m.existed_pre_apply ? sha256File(backupAbs) : null;
      if (current === original) continue;
      const written = deltas.find(
        (r) => r.kind === "metadata-written" && r.dest === m.dest,
      );
      if (written && written.sha256 !== current) {
        notRestored.add(m.dest);
        leave(m.dest);
        continue;
      }
      if (written) keepUndoCopy(txDir, targetRoot, m.dest);
      else saveUnproven(txDir, targetRoot, m.dest, st);
      if (m.existed_pre_apply) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.copyFileSync(backupAbs, abs);
        st.restoredCount += 1;
      } else {
        fs.unlinkSync(abs);
        st.unlinkedCount += 1;
      }
    } catch (err) {
      fail(m.dest, `error restoring ${m.dest}: ${err.message}`);
    }
  }

  for (const rec of deltas) {
    if (!RESTORE_KINDS.has(rec.kind) || metaDests.has(rec.dest)) continue;
    const backupAbs = path.join(txDir, "backup", rec.dest);
    const liveAbs = path.join(targetRoot, rec.dest);
    try {
      if (!fs.existsSync(backupAbs)) {
        fail(rec.dest, `${rec.kind} backup missing: ${rec.dest} — leaving in place`);
        continue;
      }
      const current = sha256File(liveAbs);
      if (current === sha256File(backupAbs)) continue;
      if (rec.sha256 === undefined) {
        saveUnproven(txDir, targetRoot, rec.dest, st);
      } else if (current !== rec.sha256) {
        notRestored.add(rec.dest);
        leave(rec.dest);
        continue;
      }
      fs.mkdirSync(path.dirname(liveAbs), { recursive: true });
      fs.copyFileSync(backupAbs, liveAbs);
      st.restoredCount += 1;
    } catch (err) {
      fail(rec.dest, `error restoring ${rec.dest}: ${err.message}`);
    }
  }

  for (const rec of deltas) {
    if (rec.kind !== "untracked" || !Array.isArray(rec.paths)) continue;
    try {
      const r = retrackPaths(targetRoot, rec.paths);
      st.retracked.push(...r.added);
      const line = `rollback: ${describeRetrack(r)}`;
      writeDiagnostic(txDir, line);
      console.error(line);
      if (r.failed.length) {
        st.partial = true;
        st.firstError = st.firstError || line;
      }
    } catch (err) {
      fail(".mc", `error re-adding untracked files: ${err.message}`);
    }
  }

  for (const rec of deltas) {
    if (rec.kind !== "keep-local-sibling") continue;
    const abs = path.join(targetRoot, rec.dest);
    try {
      if (!fs.existsSync(abs)) continue;
      if (rec.preservesFor && notRestored.has(rec.preservesFor)) {
        writeDiagnostic(
          txDir,
          `rollback: keeping ${rec.dest} — ${rec.preservesFor} was not restored`,
        );
        continue;
      }
      if (sha256File(abs) !== rec.sha256) {
        leave(rec.dest);
        continue;
      }
      fs.unlinkSync(abs);
      st.unlinkedCount += 1;
    } catch (err) {
      fail(rec.dest, `error unlinking sibling ${rec.dest}: ${err.message}`);
    }
  }
}

function commitTransaction(txDir, opts) {
  if (!txDir) throw new Error("commitTransaction: txDir required");
  const header = readHeader(txDir);
  const targetRoot = header.targetRoot;
  if (fs.existsSync(path.join(txDir, "snapshot.json"))) {
    const snapshot = readSnapshot(txDir);
    for (const [kind, list] of [
      ["entry-written", snapshot.entries || []],
      ["metadata-written", snapshot.metadata || []],
    ]) {
      for (const { dest } of list) {
        recordDelta(txDir, {
          kind,
          dest,
          sha256: sha256File(path.join(targetRoot, dest)),
        });
      }
    }
  }
  const resultFile = path.join(txDir, "result.json");
  const result = {
    completedAt: new Date().toISOString(),
    outcome: "committed",
    apply: opts.apply || null,
    migrations: opts.migrations || null,
    postUpdateChecks: opts.postUpdateChecks || null,
    rollback: null,
  };
  atomicWriteJSON(resultFile, result);
  events.emitTransactionCommit(targetRoot, {
    txId: header.txId,
    fromVersion: header.fromVersion,
    toVersion: header.toVersion,
    applyDurationMs: opts.applyDurationMs || 0,
    migrationsRan: (opts.migrations && opts.migrations.ran) || 0,
    filesWritten:
      (opts.apply &&
        opts.apply.counts &&
        (opts.apply.counts.added || 0) + (opts.apply.counts.updated || 0)) ||
      0,
    backupsTaken:
      (opts.apply && opts.apply.counts && opts.apply.counts.backups) || 0,
  });
  clearActiveLock(targetRoot);
  return result;
}

function readHeader(txDir) {
  const file = path.join(txDir, "header.json");
  return JSON.parse(stripBom(fs.readFileSync(file, "utf8")));
}

function readSnapshot(txDir) {
  const file = path.join(txDir, "snapshot.json");
  return JSON.parse(stripBom(fs.readFileSync(file, "utf8")));
}

function rollbackTransaction(txDir, opts) {
  const start = Date.now();
  const header = readHeader(txDir);
  const targetRoot = header.targetRoot;
  const snapshotFile = path.join(txDir, "snapshot.json");
  const snapshot = readSnapshot(txDir);

  const actualSha = sha256File(snapshotFile);
  if (header.snapshotSha256 && actualSha !== header.snapshotSha256) {
    const err = `snapshot.json hash mismatch (expected ${header.snapshotSha256.slice(0, 8)}, got ${(actualSha || "").slice(0, 8)})`;
    writeDiagnostic(txDir, `ROLLBACK REFUSED: ${err}`);
    events.emitTransactionRollback(targetRoot, {
      txId: header.txId,
      trigger: opts && opts.trigger,
      failedAt: opts && opts.failedAt,
      errorMessage: err,
      restoredCount: 0,
      unlinkedCount: 0,
      rollbackDurationMs: Date.now() - start,
      partial: true,
    });
    return { restoredCount: 0, unlinkedCount: 0, partial: true, error: err };
  }

  if (opts && opts.undo) {
    try {
      const undoDir = path.join(txDir, "rollback-undo");
      fs.mkdirSync(undoDir, { recursive: true });
      for (const e of snapshot.entries) {
        const abs = path.join(targetRoot, e.dest);
        if (fs.existsSync(abs)) {
          const dst = path.join(undoDir, e.dest);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(abs, dst);
        }
      }
    } catch (e) {
      writeDiagnostic(txDir, `rollback-undo snapshot failed: ${e.message}`);
    }
  }

  const st = {
    restoredCount: 0,
    unlinkedCount: 0,
    partial: false,
    firstError: null,
    leftInPlace: [],
    savedBeforeRestore: [],
    retracked: [],
  };
  rollbackEntries(txDir, targetRoot, snapshot, st);

  try {
    rollbackRecorded(txDir, targetRoot, snapshot, st);
  } catch (err) {
    st.partial = true;
    st.firstError = st.firstError || err.message;
    writeDiagnostic(txDir, `rollback: delta-pass failed: ${err.message}`);
  }
  const { restoredCount, unlinkedCount, partial, firstError, leftInPlace, savedBeforeRestore } = st;
  if (savedBeforeRestore.length) {
    const line =
      `rollback: no record of what the update wrote for ${savedBeforeRestore.length} file(s) — ` +
      `their current copies were saved to ${path.join(txDir, "rollback-undo")} first`;
    writeDiagnostic(txDir, `${line}: ${savedBeforeRestore.join(", ")}`);
    console.error(line);
  }

  const resultFile = path.join(txDir, "result.json");
  const outcome = partial ? "rollback-partial" : "rolled-back";
  const result = {
    completedAt: new Date().toISOString(),
    outcome,
    apply: null,
    migrations: null,
    rollback: {
      trigger: (opts && opts.trigger) || "unknown",
      failedAt: (opts && opts.failedAt) || null,
      error: (opts && opts.errorMessage) || firstError,
      restoredCount,
      unlinkedCount,
      leftInPlace,
      savedBeforeRestore,
      retracked: st.retracked,
      rollbackDurationMs: Date.now() - start,
    },
  };
  atomicWriteJSON(resultFile, result);

  events.emitTransactionRollback(targetRoot, {
    txId: header.txId,
    trigger: (opts && opts.trigger) || "unknown",
    failedAt: (opts && opts.failedAt) || null,
    errorMessage: (opts && opts.errorMessage) || firstError,
    restoredCount,
    unlinkedCount,
    rollbackDurationMs: Date.now() - start,
    partial,
  });

  clearActiveLock(targetRoot);

  return {
    restoredCount,
    unlinkedCount,
    partial,
    error: firstError,
    leftInPlace,
    rollback: result.rollback,
  };
}

function writeDiagnostic(txDir, msg) {
  try {
    fs.appendFileSync(
      path.join(txDir, "diagnostics.log"),
      `${new Date().toISOString()} ${msg}\n`,
    );
  } catch {
  }
}

module.exports = {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  isUpdateTransactionId,
  TX_KIND,
  LEGACY_TX_KIND,
  newTransactionId,
  buildSnapshotEntries,
  checkActiveLock,
  clearActiveLock,
  readHeader,
  readSnapshot,
  recordDelta,
  trackedPaths,
  retrackPaths,
  describeRetrack,
  sha256File,
  sha256Buffer,
  atomicWriteJSON,
  TX_ROOT_REL,
};
