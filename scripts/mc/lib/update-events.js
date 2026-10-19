
const mcEnv = require("../../hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function resolveEventsFile(targetRoot) {
  const candidates = [];
  if (mcEnv.readEnv("EVENTS_FILE")) {
    candidates.push(mcEnv.readEnv("EVENTS_FILE"));
  }
  const roots = [];
  if (targetRoot) roots.push(path.resolve(targetRoot));
  if (process.env.CLAUDE_PROJECT_DIR)
    roots.push(path.resolve(process.env.CLAUDE_PROJECT_DIR));
  roots.push(process.cwd());
  for (const root of roots) {
    try {
      const pathsJson = path.join(root, ".claude", "paths.json");
      if (fs.existsSync(pathsJson)) {
        const raw = JSON.parse(fs.readFileSync(pathsJson, "utf8"));
        if (raw.eventsFile) candidates.push(path.join(root, raw.eventsFile));
      }
    } catch {
    }
    candidates.push(
      path.join(root, ".claude", "project", "events", "events.jsonl"),
    );
  }
  for (const cand of candidates) {
    try {
      fs.mkdirSync(path.dirname(cand), { recursive: true });
      return cand;
    } catch {
    }
  }
  return null;
}

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function sessionId() {
  return process.env.CLAUDE_SESSION_ID || "mc-update";
}

function writeEnvelope(targetRoot, cat, data) {
  const file = resolveEventsFile(targetRoot);
  if (!file) return;
  const envelope = {
    id: makeId(),
    ts: new Date().toISOString(),
    cat,
    actor: "system",
    session: sessionId(),
    data: data || {},
  };
  try {
    fs.appendFileSync(file, JSON.stringify(envelope) + "\n");
  } catch {
  }
}

function emitPreflightGate(
  targetRoot,
  {
    txId,
    gate,
    status,
    reason,
    remediation,
    durationMs,
    evidence,
    overrideUsed,
  },
) {
  writeEnvelope(targetRoot, "mc.update.preflight", {
    txId: txId || null,
    phase: "preflight-gate",
    gate,
    status,
    reason,
    remediation: remediation || null,
    durationMs: durationMs || 0,
    evidence: evidence || {},
    overrideUsed: !!overrideUsed,
  });
}

function emitPreflightSummary(
  targetRoot,
  { txId, ok, gateCount, redCount, yellowCount, greenCount, totalDurationMs },
) {
  writeEnvelope(targetRoot, "mc.update.preflight", {
    txId: txId || null,
    phase: "preflight-summary",
    ok,
    gateCount,
    redCount,
    yellowCount,
    greenCount,
    totalDurationMs: totalDurationMs || 0,
  });
}

function emitTransactionStart(
  targetRoot,
  {
    txId,
    fromVersion,
    toVersion,
    filesToWrite,
    filesToDelete,
    filesToAdd,
    backupPlanCount,
  },
) {
  writeEnvelope(targetRoot, "mc.update.transaction.start", {
    txId,
    fromVersion,
    toVersion,
    filesToWrite,
    filesToDelete,
    filesToAdd,
    backupPlanCount,
  });
}

function emitTransactionRollback(
  targetRoot,
  {
    txId,
    trigger,
    failedAt,
    errorMessage,
    restoredCount,
    unlinkedCount,
    rollbackDurationMs,
    partial,
  },
) {
  writeEnvelope(targetRoot, "mc.update.transaction.rollback", {
    txId,
    trigger,
    failedAt: failedAt || null,
    errorMessage: errorMessage || null,
    restoredCount: restoredCount || 0,
    unlinkedCount: unlinkedCount || 0,
    rollbackDurationMs: rollbackDurationMs || 0,
    partial: !!partial,
  });
}

function emitTransactionCommit(
  targetRoot,
  {
    txId,
    fromVersion,
    toVersion,
    applyDurationMs,
    migrationsRan,
    filesWritten,
    backupsTaken,
  },
) {
  writeEnvelope(targetRoot, "mc.update.transaction.commit", {
    txId,
    fromVersion,
    toVersion,
    applyDurationMs: applyDurationMs || 0,
    migrationsRan: migrationsRan || 0,
    filesWritten: filesWritten || 0,
    backupsTaken: backupsTaken || 0,
  });
}

function emitPostflight(
  targetRoot,
  {
    txId,
    ok,
    checkCount,
    greenCount,
    yellowCount,
    redCount,
    degradedCount,
    operatorAction,
    evidencePath,
    durationMs,
  },
) {
  writeEnvelope(targetRoot, "mc.update.postflight", {
    txId,
    ok,
    checkCount,
    greenCount: greenCount || 0,
    yellowCount: yellowCount || 0,
    redCount: redCount || 0,
    degradedCount: degradedCount || 0,
    operatorAction,
    evidencePath: evidencePath || null,
    durationMs: durationMs || 0,
  });
}

function emitPostflightCheck(
  targetRoot,
  { txId, check, status, reason, durationMs, evidence },
) {
  writeEnvelope(targetRoot, "mc.update.postflight", {
    txId,
    phase: "postflight-check",
    check,
    status,
    reason: reason || null,
    durationMs: durationMs || 0,
    evidence: evidence || {},
  });
}

function emitEvidence(
  targetRoot,
  { txId, evidencePath, transactionDir, outcome, postflightOk },
) {
  writeEnvelope(targetRoot, "mc.update.evidence", {
    txId,
    evidencePath,
    transactionDir,
    outcome,
    postflightOk: !!postflightOk,
  });
}

function emitContentHashMismatch(
  targetRoot,
  { txId, file, contentHashLocal, rawHashLocal, expectedHash, kind },
) {
  writeEnvelope(targetRoot, "mc.update.content-hash-mismatch", {
    txId: txId || null,
    file,
    contentHashLocal,
    rawHashLocal,
    expectedHash,
    kind: kind === "real_drift" ? "real_drift" : "lf_only",
  });
}

function emitOperatorOverrideUsed(
  targetRoot,
  { txId, gate, reason, operator, gateStatusBefore },
) {
  writeEnvelope(targetRoot, "mc.update.operator-override-used", {
    txId: txId || null,
    gate,
    reason,
    operator: operator || process.env.USER || process.env.USERNAME || "unknown",
    gateStatusBefore: gateStatusBefore || null,
  });
}

function emitOwnershipTransitioned(
  targetRoot,
  { txId, file, from, to, reason },
) {
  writeEnvelope(targetRoot, "mc.update.ownership-transitioned", {
    txId: txId || null,
    file,
    from: from || "framework_template",
    to: to || "project_owned",
    reason: reason || "consumer_edit_detected",
  });
}

module.exports = {
  resolveEventsFile,
  emitPreflightGate,
  emitPreflightSummary,
  emitTransactionStart,
  emitTransactionCommit,
  emitTransactionRollback,
  emitPostflight,
  emitPostflightCheck,
  emitEvidence,
  emitContentHashMismatch,
  emitOperatorOverrideUsed,
  emitOwnershipTransitioned,
};
