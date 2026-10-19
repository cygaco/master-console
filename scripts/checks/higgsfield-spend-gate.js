#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const CEILING_USD = 5;

const APPROVAL_ENV = "HIGGSFIELD_SPEND_APPROVAL";
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const APPROVAL_FILE = path.join(ROOT, "runtime", "growth", "spend-approval.token");

function defaultCost(op) {
  const hf = require("../growth/higgsfield");
  return hf.cost({ jst: op.jst, input: op.input });
}
function defaultMode() {
  const { getMode } = require("../hooks/lib/mode");
  return getMode();
}
function defaultEmit(rec) {
  const { emit } = require("../arbitration/emit");
  return emit(rec);
}
function defaultApprovalPresent() {
  if (process.env[APPROVAL_ENV] && String(process.env[APPROVAL_ENV]).trim()) return true;
  try {
    return fs.existsSync(APPROVAL_FILE) && fs.readFileSync(APPROVAL_FILE, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

function evaluate(req = {}, deps = {}) {
  const costFn = deps.cost || defaultCost;
  const modeFn = deps.mode || defaultMode;
  const emitFn = deps.emit || defaultEmit;
  const approvalFn = deps.approvalPresent || defaultApprovalPresent;

  const ops = Array.isArray(req.ops) ? req.ops : null;
  if (!ops || ops.length === 0) {
    return errorResult("higgsfield-spend-gate: request has no `ops[]` to evaluate");
  }

  const mode = (req.mode || modeFn() || "solo").toLowerCase();

  const priced = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op || !op.jst) {
      return errorResult(`higgsfield-spend-gate: ops[${i}] missing required \`jst\``);
    }
    let c;
    try {
      c = costFn(op);
    } catch (e) {
      return errorResult(`higgsfield-spend-gate: cannot price ops[${i}] (${op.jst}): ${String(e.message || e)}`);
    }
    if (!c || typeof c.usd !== "number" || !Number.isFinite(c.usd)) {
      return errorResult(`higgsfield-spend-gate: cost() returned no usable usd for ops[${i}] (${op.jst})`);
    }
    priced.push({ idx: i, op, usd: c.usd, credits: c.credits, jst: op.jst });
  }

  const totalUsd = round2(priced.reduce((s, p) => s + p.usd, 0));

  const overCeiling = priced.filter((p) => p.usd >= CEILING_USD);
  const eligible = priced.filter((p) => p.usd < CEILING_USD);

  if (mode === "oneshot") {
    return evaluateOneshot({ req, priced, totalUsd, overCeiling, eligible, mode, emitFn, approvalFn });
  }
  return evaluateCapAndDefer({ priced, totalUsd, overCeiling, eligible, mode });
}

function evaluateCapAndDefer({ priced, totalUsd, overCeiling, eligible, mode }) {
  const allowed = [];
  const deferred = [];
  let running = 0;
  for (const p of eligible) {
    if (round2(running + p.usd) < CEILING_USD) {
      allowed.push(p);
      running = round2(running + p.usd);
    } else {
      deferred.push(p);
    }
  }
  for (const p of overCeiling) deferred.push(p);

  const allowedUsd = round2(allowed.reduce((s, p) => s + p.usd, 0));
  const decision = allowed.length > 0 ? "allow" : "block";
  const reasonBits = [];
  if (deferred.length) reasonBits.push(`${deferred.length} deferred (cap < $${CEILING_USD})`);
  if (overCeiling.length) reasonBits.push(`${overCeiling.length} blocked (single op ≥ $${CEILING_USD})`);
  return finalize({
    decision,
    exitCode: decision === "allow" ? 0 : 1,
    mode,
    allowed,
    deferred,
    blocked: overCeiling,
    totalUsd,
    allowedUsd,
    reason:
      decision === "allow"
        ? `${allowed.length} op(s) cleared at $${allowedUsd} (< $${CEILING_USD} cap)${reasonBits.length ? "; " + reasonBits.join("; ") : ""}`
        : `nothing cleared: ${reasonBits.join("; ") || "all ops over cap/ceiling"}`,
  });
}

function evaluateOneshot({ req, priced, totalUsd, overCeiling, eligible, mode, emitFn, approvalFn }) {
  const fullUnder = totalUsd < CEILING_USD && overCeiling.length === 0;
  if (fullUnder) {
    return finalize({
      decision: "allow",
      exitCode: 0,
      mode,
      allowed: priced,
      deferred: [],
      blocked: [],
      totalUsd,
      allowedUsd: totalUsd,
      reason: `oneshot full fan-out cleared at $${totalUsd} (< $${CEILING_USD}, no single op ≥ ceiling)`,
    });
  }

  const unit = req.unit || "growth_render_fanout";
  const approved = approvalFn();

  let arbitration = null;
  try {
    arbitration = emitFn({
      unit,
      owner: "growth_spend_gate",
      decision: approved
        ? `oneshot fan-out $${totalUsd} ≥ $${CEILING_USD} — pre-run spend-approval token PRESENT; full set authorized`
        : `oneshot fan-out $${totalUsd} ≥ $${CEILING_USD} — BLOCKED pending pre-run spend-approval token`,
      rationale: `oneshot must not run a partial render set; full projected spend $${totalUsd} crosses the $${CEILING_USD} autonomy ceiling (${priced.length} ops${overCeiling.length ? `, ${overCeiling.length} individually ≥ ceiling` : ""}). Set ${APPROVAL_ENV} or write ${APPROVAL_FILE} to authorize.`,
      precedenceBasis: "CLAUDE.md ## Autonomy — API calls ≥ $5 require approval",
      confidence: 0.9,
      arbitrationNeeded: !approved,
      artifactPrecedence: 90,
    });
  } catch (e) {
    return errorResult(`higgsfield-spend-gate: oneshot escalation emit() failed: ${String(e.message || e)}`);
  }

  if (approved) {
    return finalize({
      decision: "allow",
      exitCode: 0,
      mode,
      allowed: priced,
      deferred: [],
      blocked: [],
      totalUsd,
      allowedUsd: totalUsd,
      arbitration,
      reason: `oneshot full fan-out $${totalUsd} authorized by pre-run spend-approval token`,
    });
  }

  return finalize({
    decision: "block",
    exitCode: 1,
    mode,
    allowed: [],
    deferred: priced,
    blocked: overCeiling,
    totalUsd,
    allowedUsd: 0,
    arbitration,
    reason: `oneshot full fan-out $${totalUsd} ≥ $${CEILING_USD} — refusing to launch a partial set; arbitration emitted (${arbitration.id}) and a pre-run spend-approval token is required (${APPROVAL_ENV} or ${APPROVAL_FILE})`,
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function summarizeOps(list) {
  return list.map((p) => ({ idx: p.idx, jst: p.jst, usd: p.usd, credits: p.credits }));
}

function finalize(r) {
  return {
    ...r,
    ceilingUsd: CEILING_USD,
    allowed: summarizeOps(r.allowed),
    deferred: summarizeOps(r.deferred),
    blocked: summarizeOps(r.blocked),
  };
}

function errorResult(message) {
  return {
    decision: "block",
    exitCode: 2,
    mode: null,
    ceilingUsd: CEILING_USD,
    allowed: [],
    deferred: [],
    blocked: [],
    totalUsd: 0,
    allowedUsd: 0,
    error: message,
    reason: message,
  };
}

module.exports = {
  evaluate,
  CEILING_USD,
  APPROVAL_ENV,
  APPROVAL_FILE,
};

if (require.main === module) {
  readInput()
    .then((raw) => {
      let req;
      try {
        req = JSON.parse(raw);
      } catch (e) {
        const r = errorResult(`higgsfield-spend-gate: bad request JSON: ${e.message}`);
        process.stdout.write(JSON.stringify(r, null, 2) + "\n");
        process.exit(r.exitCode);
      }
      const result = evaluate(req);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exit(result.exitCode);
    })
    .catch((e) => {
      const r = errorResult(`higgsfield-spend-gate: ${String(e.message || e)}`);
      process.stderr.write(JSON.stringify(r, null, 2) + "\n");
      process.exit(r.exitCode);
    });
}

function readInput() {
  return new Promise((resolve, reject) => {
    const arg = process.argv[2];
    if (arg) return resolve(arg);
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf.trim()));
    process.stdin.on("error", reject);
    setTimeout(() => {
      if (!buf) reject(new Error("no request provided (argv or stdin)"));
    }, 200).unref();
  });
}
