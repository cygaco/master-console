#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");
const { isStartedRow } = require("../dispatch/dispatch-record-fields");
const { verifyRecord } = require("../dispatch/attest-signing");
const path = require("path");
const crypto = require("crypto");

const START = Date.now();
const NAME = "epsilon-liveness";

const ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_EVIDENCE_DIRS = [
  path.join(ROOT, ".claude", "runtime", "epsilon-prompts"),
  path.join(ROOT, "runtime", "epsilon-prompts"),
];
const DEFAULT_LEDGER = path.join(ROOT, ".claude", "runtime", "dispatch-completions.jsonl");
const DEFAULT_STALE_MINUTES = 10;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function isCanonicalIso(x) {
  if (typeof x !== "string" || !ISO_TS_RE.test(x)) return false;
  const d = new Date(x);
  return Number.isFinite(d.getTime()) && d.toISOString() === x;
}
const SKEW_MS = 5 * 60 * 1000;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

const JSON_OUT = process.argv.includes("--json");

function evaluate({ evidenceFiles, ledgerLines, nowMs, requireSignature = true }) {
  if (ledgerLines === null && evidenceFiles.length > 0) {
    return {
      ok: false,
      findings: evidenceFiles.map((f) => ({
        type: "epsilon-stalled",
        evidenceFile: f.path,
        reason: `ledger unreadable — cannot verify completion for stale evidence file (${Math.round((nowMs - f.mtimeMs) / 60000)}m old)`,
      })),
      malformedLines: 0,
      ledgerUnreadable: true,
    };
  }

  if (!evidenceFiles.length) {
    return { ok: true, findings: [], malformedLines: 0, ledgerUnreadable: false };
  }

  const records = [];
  let malformedLines = 0;
  for (const line of ledgerLines || []) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      malformedLines++;
    }
  }

  const findings = [];
  for (const ef of evidenceFiles) {
    if (ef.unreadable) {
      findings.push({
        type: "epsilon-stalled",
        evidenceFile: ef.path,
        reason: ef.mtimeMs === null
          ? "evidence file is un-stat-able — cannot verify freshness or completion (fail-closed)"
          : `evidence file aged ${Math.round((nowMs - ef.mtimeMs) / 60000)}m is unreadable — cannot verify completion (fail-closed)`,
      });
      continue;
    }
    const ageMins = Math.round((nowMs - ef.mtimeMs) / 60000);

    const _reqSig = requireSignature;
    const shaMatch = records.find(
      (r) => r.evidence_sha === ef.sha256 && isVerifiedLivenessRecord(r, { requireSignature: _reqSig }),
    );
    if (shaMatch) continue;

    const basename = path.basename(ef.path, ".return.txt");
    const filenameMatch = records.find((r) => {
      if (!isVerifiedLivenessRecord(r, { requireSignature: _reqSig })) return false;
      if (!r.sprint_id || !r.step || !r.role) return false;
      return basename === `${r.sprint_id}-${r.step}-${r.role}`;
    });
    if (filenameMatch) continue;

    findings.push({
      type: "epsilon-stalled",
      evidenceFile: ef.path,
      reason: `no ledger record for evidence file aged ${ageMins}m — conductor may be stalled`,
    });
  }

  return { ok: findings.length === 0, findings, malformedLines, ledgerUnreadable: false };
}

function evaluatePairedWaiter({ records, nowMs, staleMs, windowMs = 2 * 60 * 60 * 1000, artifactProduced, isVerified } = {}) {
  const verify = typeof isVerified === "function"
    ? isVerified
    : (r) => (r.ok === false ? verifyRecord(r) : isVerifiedLivenessRecord(r, { requireSignature: true }));
  const byId = new Map();
  for (const r of records || []) {
    if (!r || !r.dispatch_id) continue;
    if (!byId.has(r.dispatch_id)) byId.set(r.dispatch_id, []);
    byId.get(r.dispatch_id).push(r);
  }
  const findings = [];
  for (const [dispatchId, rows] of byId) {
    const started = rows.find((r) => r.phase === "started");
    if (!started) continue;
    // liveness-verified: `verify()` routes the ok:true read through isVerifiedLivenessRecord (default;
    if (!isCanonicalIso(started.started_at)) {
      findings.push({
        type: "outstanding-dispatch-malformed-start", dispatch_id: dispatchId, role: started.role || null,
        reason: `started_at '${started.started_at}' is not a canonical ISO timestamp — cannot establish the stall window (fail-closed)`,
      });
      continue;
    }
    const startedMs = Date.parse(started.started_at);
    if (startedMs > nowMs + SKEW_MS) {
      findings.push({
        type: "outstanding-dispatch-future-start", dispatch_id: dispatchId, role: started.role || null,
        reason: `started_at '${started.started_at}' is in the future (> now + ${SKEW_MS / 60000}m skew) — impossible (fail-closed)`,
      });
      continue;
    }
    const terminated = rows.some((r) => {
      if (isStartedRow(r) || !isCanonicalIso(r.completed_at)) return false;
      const completedMs = Date.parse(r.completed_at);
      if (completedMs < startedMs || completedMs > nowMs + SKEW_MS) return false;
      return typeof r.ok === "boolean" && verify(r);
    });
    if (terminated) continue;
    const age = nowMs - startedMs;
    if (age < staleMs || age > windowMs) continue;
    const artifactPath = typeof started.artifact_path === "string" && started.artifact_path ? started.artifact_path : null;
    const produced = !!(artifactPath && typeof artifactProduced === "function" && artifactProduced(artifactPath, startedMs));
    if (produced) continue;
    findings.push({
      type: "outstanding-dispatch-no-terminal",
      dispatch_id: dispatchId,
      role: started.role || null,
      reason: artifactPath
        ? `outstanding dispatch aged ${Math.round(age / 60000)}m with NO terminal completion record, and artifact_path '${artifactPath}' is not a real non-empty file produced after start — probable stall / kill-before-record`
        : `outstanding dispatch aged ${Math.round(age / 60000)}m with NO terminal completion record (no ok:false death, no verified ok:true) and no produced artifact — probable stall / kill-before-record`,
    });
  }
  return { findings };
}

function artifactProducedFs(p, startedMs) {
  try {
    const st = fs.lstatSync(p);
    return st.isFile() && st.size > 0 && st.mtimeMs >= (typeof startedMs === "number" ? startedMs : 0);
  } catch {
    return false;
  }
}

function sha256ofFile(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function collectEvidence(evidenceDir, staleMs, nowMs) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(evidenceDir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (!name.endsWith(".return.txt")) continue;
    const full = path.join(evidenceDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      files.push({ path: full, mtimeMs: null, sha256: null, unreadable: true });
      continue;
    }
    const mtimeMs = stat.mtimeMs;
    if (nowMs - mtimeMs < staleMs) continue;
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      files.push({ path: full, mtimeMs, sha256: null, unreadable: true });
      continue;
    }
    files.push({ path: full, mtimeMs, sha256: sha256ofFile(buf) });
  }
  return files;
}

function readLedger(ledgerPath) {
  try {
    return fs.readFileSync(ledgerPath, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
}

function emit({ result, pw, waiterEnforce }, evidenceDir, ledgerPath) {
  const waiterBlocking = waiterEnforce && pw.findings.length > 0;
  const systemError = pw.systemError || null;
  const ok = result.ok && !waiterBlocking && !systemError;
  const exitCode = systemError ? 2 : ok ? 0 : 1;
  const out = {
    name: NAME,
    status: ok ? "green" : "red",
    evidenceDir,
    ledger: ledgerPath,
    findings: result.findings,
    pairedWaiterFindings: pw.findings,
    pairedWaiterEnforced: !!waiterEnforce,
    systemError,
    malformedLedgerLines: result.malformedLines,
    ledgerUnreadable: result.ledgerUnreadable,
    durationMs: Date.now() - START,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out));
  } else {
    if (systemError) console.error(`ERROR [${NAME}] ${systemError}`);
    if (!result.ok) {
      console.error(`FAIL [${NAME}] ${result.findings.length} stale evidence file(s) with no completion record:`);
      for (const f of result.findings) console.error(`     - ${path.basename(f.evidenceFile)}: ${f.reason}`);
      if (result.ledgerUnreadable) console.error(`     fix: check dispatch-completions.jsonl is readable; run record-inprocess if conductor ran`);
    }
    if (pw.findings.length) {
      console.error(`${waiterBlocking ? "FAIL" : "WARN"} [${NAME}] (paired-waiter) ${pw.findings.length} outstanding dispatch(es) with no terminal completion:`);
      for (const f of pw.findings) console.error(`     - ${f.dispatch_id} (${f.role || "?"}): ${f.reason}`);
    }
    if (result.malformedLines > 0) console.error(`     (${result.malformedLines} malformed ledger line(s) skipped)`);
    if (ok && pw.findings.length === 0) console.log(`OK   [${NAME}] no stale unmatched evidence + no outstanding-dispatch findings`);
  }
  process.exit(exitCode);
}

if (require.main === module) {
  const nowArg = arg("--now");
  const nowMs = nowArg ? Date.parse(nowArg) : Date.now();
  if (nowArg && isNaN(nowMs)) {
    process.stderr.write(`[${NAME}] invalid --now value: ${nowArg}\n`);
    process.exit(2);
  }

  const staleMinutes =
    parseInt(arg("--stale-minutes") || String(DEFAULT_STALE_MINUTES), 10) ||
    DEFAULT_STALE_MINUTES;
  const staleMs = staleMinutes * 60 * 1000;

  let evidenceDir = arg("--evidence-dir");
  if (!evidenceDir) {
    evidenceDir =
      DEFAULT_EVIDENCE_DIRS.find((d) => {
        try {
          fs.accessSync(d);
          return true;
        } catch {
          return false;
        }
      }) || DEFAULT_EVIDENCE_DIRS[0];
  }
  evidenceDir = path.resolve(evidenceDir);

  const ledgerPath = path.resolve(arg("--ledger") || DEFAULT_LEDGER);

  const evidenceFiles = collectEvidence(evidenceDir, staleMs, nowMs);
  const ledgerLines = readLedger(ledgerPath);

  const result = evaluate({ evidenceFiles, ledgerLines, nowMs });

  const waiterEnforce = mcEnv.readEnv("WAITER_ENFORCE") === "1" || mcEnv.readEnv("WAITER_ENFORCE") === "true";
  const pw = { findings: [], systemError: null };
  if (ledgerLines === null) {
    if (waiterEnforce) pw.systemError = `ledger unreadable (${ledgerPath}) under MC_WAITER_ENFORCE — cannot verify outstanding dispatches (fail-closed)`;
  } else {
    const records = [];
    for (const line of ledgerLines) {
      const t = (line || "").trim();
      if (!t) continue;
      try { records.push(JSON.parse(t)); } catch { }
    }
    const rootArtifactProduced = (p, startedMs) => artifactProducedFs(path.isAbsolute(p) ? p : path.join(ROOT, p), startedMs);
    pw.findings = evaluatePairedWaiter({ records, nowMs, staleMs, artifactProduced: rootArtifactProduced }).findings;
  }

  emit({ result, pw, waiterEnforce }, evidenceDir, ledgerPath);
}

module.exports = { evaluate, evaluatePairedWaiter, artifactProducedFs };
