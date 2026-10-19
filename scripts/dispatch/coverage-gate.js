#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { contractForRole, ARGV_SCHEMA_VERSION } = require("./dispatch-contract");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function isBackedRecord(r) {
  return !!(r && typeof r.dispatch_id === "string" && r.dispatch_id && typeof r.cmdline_checksum === "string" && r.cmdline_checksum);
}

function waiverProvenance(waiver) {
  const w = waiver && typeof waiver === "object" ? waiver : {};
  const reason = typeof w.reason === "string" ? w.reason.trim() : "";
  const operator =
    (typeof w.operator === "string" && w.operator.trim()) ||
    (typeof w.source === "string" && w.source.trim()) ||
    "";
  const ts = typeof w.ts === "string" && w.ts.trim() ? w.ts.trim() : "";
  const trail =
    (typeof w.record === "string" && w.record.trim()) ||
    (typeof w.dispatch_id === "string" && w.dispatch_id.trim()) ||
    (typeof w.ticket === "string" && w.ticket.trim()) ||
    (typeof w.audit_ref === "string" && w.audit_ref.trim()) ||
    "";
  const missing = [];
  if (!reason) missing.push("reason");
  if (!operator) missing.push("operator/source");
  if (!ts) missing.push("ts");
  if (!trail) missing.push("record/dispatch_id/ticket/audit_ref");
  return {
    ok: missing.length === 0,
    missing,
    provenance: missing.length === 0 ? { reason, operator, ts, trail } : null,
  };
}

function hasArtifactProof(r) {
  if (r && typeof r.output_digest === "string" && r.output_digest) return true;
  if (r && Array.isArray(r.artifacts) && r.artifacts.some((a) => a && a.sha256)) return true;
  return false;
}

function sha256File(p) {
  try {
    return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}

const { isVerifiedLivenessRecord } = require("./verified-liveness-read");

function evaluate(input) {
  const {
    records = [],
    expected = [],
    runId = null,
    schemaVersion = ARGV_SCHEMA_VERSION,
    verifyArtifacts = false,
    requireSignature = true,
  } = input || {};
  const isLive = (r) => isVerifiedLivenessRecord(r, { requireSignature });
  const violations = [];
  const covered = [];
  const missing = [];
  const waived = [];
  const pool = (runId ? records.filter((r) => r && r.run_id === runId) : records.slice()).filter(Boolean);

  for (const exp of expected) {
    const role = exp && exp.role;
    if (!role) {
      violations.push("expected entry with no role");
      continue;
    }

    if (exp.waiver) {
      const p = waiverProvenance(exp.waiver);
      if (!p.ok) {
        violations.push(
          `role '${role}' is waived but the waiver lacks provenance (missing: ${p.missing.join(", ")}) — an unaccountable waiver is REJECTED. A waiver must name WHO (operator/source), WHEN (ts), WHY (reason), and an auditable trail (record/dispatch_id/ticket/audit_ref).`,
        );
      } else {
        waived.push({ role, reason: p.provenance.reason, provenance: p.provenance });
      }
      continue;
    }

    let c = null;
    try {
      c = contractForRole(role);
    } catch {
    }

    const roleRecs = pool.filter(
      (r) =>
        r.role === role &&
        isLive(r) &&
        isBackedRecord(r) &&
        (!exp.shape || r.shape === exp.shape) &&
        (!exp.plan_item_id || r.plan_item_id === exp.plan_item_id),
    );
    const hit = roleRecs.find((r) => r.argv_schema_version === schemaVersion && hasArtifactProof(r));

    if (!hit) {
      missing.push(role);
      const noProof = roleRecs.find((r) => r.argv_schema_version === schemaVersion && !hasArtifactProof(r));
      const staleOnly = roleRecs.find((r) => r.argv_schema_version !== schemaVersion);
      if (noProof) {
        violations.push(`expected role '${role}' has an ok:true backed record but NO output_digest/artifact proof — it shows a role 'ran' without proving it produced output (blind coverage). REJECTED.`);
      } else if (staleOnly) {
        violations.push(`expected role '${role}' has only a record at argv_schema_version=${JSON.stringify(staleOnly.argv_schema_version ?? null)} (current is ${JSON.stringify(schemaVersion)}) — a stale/backfilled record does not satisfy coverage.`);
      } else {
        violations.push(`expected role '${role}'${exp.shape ? ` (shape ${exp.shape})` : ""} has NO ok:true backed completion record${runId ? ` for run ${runId}` : ""} — coverage claim is UNBACKED (sprint-theater guard).`);
      }
      continue;
    }

    if (c && c.coverage && c.coverage.cross_provider_required && hit.provider === "claude") {
      violations.push(`role '${role}' requires cross-provider review but its record shows provider=claude — a Claude clone graded Claude's work (diversity violation).`);
    }

    if (exp.artifact) {
      const arts = Array.isArray(hit.artifacts) ? hit.artifacts : [];
      const a = arts.find((x) => x && x.path === exp.artifact);
      if (!a || !a.sha256) {
        violations.push(`role '${role}' was expected to produce artifact ${JSON.stringify(exp.artifact)} but its record carries no matching artifact digest.`);
      } else if (verifyArtifacts) {
        const onDisk = sha256File(path.isAbsolute(exp.artifact) ? exp.artifact : path.join(PROJECT_ROOT, exp.artifact));
        if (onDisk === null) {
          violations.push(`role '${role}' artifact ${JSON.stringify(exp.artifact)} does not exist on disk — the record claims it but it never appeared.`);
        } else if (onDisk !== a.sha256) {
          violations.push(`role '${role}' artifact ${JSON.stringify(exp.artifact)} on disk (${onDisk}) does not match the record's digest (${a.sha256}) — content drift / faked digest.`);
        }
      }
    }

    covered.push({ role, dispatch_id: hit.dispatch_id, provider: hit.provider || null, shape: hit.shape || null, output_digest: hit.output_digest || null });
  }

  // liveness-verified: this block REJECTS untrustworthy records (unbacked, or ok:true without a valid signature
  for (const r of pool) {
    if (r.ok === true && !isBackedRecord(r)) {
      violations.push(`a completion record (role=${r.role || "?"}) claims ok:true but lacks dispatch_id/cmdline_checksum — hand-authored phantom coverage row REJECTED.`);
    } else if (r.ok === true && requireSignature && !isLive(r)) {
      violations.push(`a completion record (role=${r.role || "?"}) claims ok:true and is field-backed but carries NO valid origin-proof signature — a forged/unsigned liveness record REJECTED (same-session verification).`);
    }
  }

  return { ok: violations.length === 0, violations, covered, missing, waived };
}

function readLedger(file) {
  const f = file || mcEnv.readEnv("COVERAGE_LEDGER") || path.join(PROJECT_ROOT, ".claude", "runtime", "dispatch-completions.jsonl");
  let txt;
  try {
    txt = fs.readFileSync(f, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
    }
  }
  return out;
}

function parseExpect(spec) {
  return String(spec || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => {
      const [role, shape] = tok.split(":");
      return shape ? { role, shape } : { role };
    });
}

const W3_REVIEW_LANE_MIN = Object.freeze({
  enforcer_or_gate_change: ["execution_access"],
  distribution_sensitive: ["cross_family_diff"],
});

function reviewLanePolicy(classesUnderChange, lanesRun, opts) {
  const enforce = !!(opts && opts.enforce);
  const run = new Set(Array.isArray(lanesRun) ? lanesRun : []);
  const warnings = [];
  for (const cls of Array.isArray(classesUnderChange) ? classesUnderChange : []) {
    const min = W3_REVIEW_LANE_MIN[cls];
    if (!min) continue;
    for (const lane of min) {
      if (!run.has(lane)) {
        warnings.push(
          `review-lane policy: risk class '${cls}' requires lane '${lane}' but it was not run (lanes run: ${[...run].join(", ") || "<none>"}).`,
        );
      }
    }
  }
  return { ok: enforce ? warnings.length === 0 : true, warnings, enforce };
}

module.exports = { evaluate, readLedger, isBackedRecord, hasArtifactProof, waiverProvenance, sha256File, parseExpect, reviewLanePolicy, W3_REVIEW_LANE_MIN };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const runId = flag("--run");
  const expected = parseExpect(flag("--expect"));
  const reportOnly = argv.includes("--report-only") || mcEnv.readEnv("COVERAGE_GATE_ENFORCE") === "report";
  const enforce = !reportOnly;
  const verifyArtifacts = argv.includes("--verify-artifacts");
  const records = readLedger(flag("--ledger"));
  const res = evaluate({ records, expected, runId, verifyArtifacts });
  process.stdout.write(
    JSON.stringify({ mode: enforce ? "blocking" : "report-only", run: runId, ...res }, null, 2) + "\n",
  );
  process.exit(enforce && !res.ok ? 1 : 0);
}
