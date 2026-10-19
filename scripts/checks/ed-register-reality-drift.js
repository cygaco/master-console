#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const DEFAULT_REGISTER = path.join(REPO, ".claude", "project", "memory", "enforcement-debt.jsonl");
const NAME = "ed-register-reality-drift";

const ENFORCER_PATH_RE = /scripts\/(?:checks|enforcement)\/[A-Za-z0-9_.-]+\.(?:js|cjs|mjs)/g;

const DELIVERABLE_FIELDS = ["trigger", "file", "missing_enforcer", "gap", "policy", "note"];

const PARTIAL_MARKER_RE = /\b(REMAINING OPEN|open_adr|residual|sub-item|partially|partial_enforced|deferred|still open|remains open)\b/i;
const PARTIAL_FIELDS = ["open_adr", "partial_enforced", "remaining_open"];

function hasPartialSignal(objs) {
  for (const o of objs) {
    for (const k of PARTIAL_FIELDS) {
      const v = o[k];
      if (v === true || (typeof v === "string" && v.length > 0) || (Array.isArray(v) && v.length > 0)) return true;
    }
    for (const v of Object.values(o)) {
      if (typeof v === "string" && PARTIAL_MARKER_RE.test(v)) return true;
      if (Array.isArray(v)) {
        for (const e of v) {
          if (typeof e === "string" && PARTIAL_MARKER_RE.test(e)) return true;
          if (e && typeof e === "object" && PARTIAL_MARKER_RE.test(JSON.stringify(Object.values(e)))) return true;
        }
      }
    }
  }
  return false;
}

function loadParser() {
  return require(path.join(REPO, "scripts", "enforcement", "ed-registry")).parseRegister;
}

function isClosureRow(o) {
  const nonEmpty = (x) => typeof x === "string" && x.trim().length > 0;
  return o.status === "closed" || nonEmpty(o.closure_receipt) || nonEmpty(o.closed_ts) || nonEmpty(o.resolution);
}

function isCreationContext(text, rel, idx) {
  const at = typeof idx === "number" && idx >= 0 ? idx : text.indexOf(rel);
  if (at < 0) return false;
  let clauseStart = 0;
  const delimRe = /[;,\n]|\.(?=\s)/g;
  let dm;
  const pre = text.slice(0, at);
  while ((dm = delimRe.exec(pre)) !== null) clauseStart = dm.index + dm[0].length;
  const clause = text.slice(clauseStart, at).toLowerCase();
  return /\b(build|create|introduce|ship|scaffold)\b|\bnew\s+(?:lint|check|enforcer|file|script|test)\b|\badd(?:s|ed|ing)?\s+a\s+new\b/.test(clause);
}

function evaluate({ registerText, fileExists, parse }) {
  const parseRegister = parse || loadParser();
  const rows = parseRegister(registerText);
  const byId = new Map();
  let malformedLines = 0;
  for (const r of rows) {
    if (r.malformed) { malformedLines++; continue; }
    if (!r.id) continue;
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r.obj);
  }
  const findings = [];
  const phantomClose = [];
  let skippedPartial = 0;
  for (const [id, objs] of byId) {
    const closed = objs.some(isClosureRow);
    if (closed) {
      const closureRows = objs.filter(isClosureRow);
      const seenC = new Set();
      for (const cr of closureRows) {
        const ctext = ["enforcer", "closure_receipt", "resolution", "note", "file"].map((k) => (typeof cr[k] === "string" ? cr[k] : "")).join("\n");
        let cm; ENFORCER_PATH_RE.lastIndex = 0;
        while ((cm = ENFORCER_PATH_RE.exec(ctext)) !== null) {
          const rel = cm[0];
          if (seenC.has(rel)) continue; seenC.add(rel);
          if (!fileExists(rel)) {
            phantomClose.push({ id, deliverable: rel, reason: `PHANTOM-CLOSE candidate: ED ${id} is marked closed citing enforcer ${rel}, but that file does NOT exist on disk — the closure may be lying (renamed/removed/never-shipped). VERIFY.` });
          }
        }
      }
      continue;
    }
    if (hasPartialSignal(objs)) { skippedPartial++; continue; }
    const text = objs.map((o) => DELIVERABLE_FIELDS.map((k) => (typeof o[k] === "string" ? o[k] : "")).join("\n")).join("\n");
    const creationPaths = new Set();
    let m;
    ENFORCER_PATH_RE.lastIndex = 0;
    while ((m = ENFORCER_PATH_RE.exec(text)) !== null) {
      if (isCreationContext(text, m[0], m.index)) creationPaths.add(m[0]);
    }
    for (const rel of creationPaths) {
      const testRel = rel.replace(/\.(js|cjs|mjs)$/, ".test.$1");
      if (fileExists(rel) && fileExists(testRel)) {
        findings.push({
          id,
          deliverable: rel,
          test: testRel,
          reason: `CANDIDATE stale-open: ED ${id} is marked open, but its named NEW enforcer ${rel} exists on disk WITH a sibling test ${testRel}, the row carries no open-residual markers, and it is not a modify-existing reference — VERIFY against the requirement, then append a closure row if resolved (or record the open residual).`,
        });
      }
    }
  }
  return { skip: false, findings, phantomClose, malformedLines, skippedPartial };
}

function realFileExists(rel) {
  try {
    return fs.existsSync(path.join(REPO, rel));
  } catch {
    return false;
  }
}

function main(argv) {
  const jsonOut = argv.includes("--json");
  const enforce = argv.includes("--enforce");
  const ri = argv.indexOf("--register");
  const registerPath = ri !== -1 && argv[ri + 1] ? path.resolve(argv[ri + 1]) : DEFAULT_REGISTER;

  let registerText;
  try {
    registerText = fs.readFileSync(registerPath, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") {
      const out = { name: NAME, status: "skip", reason: `register absent (${registerPath}) — gitignored ledger, nothing to check`, findings: [] };
      process.stdout.write(jsonOut ? JSON.stringify(out) + "\n" : `SKIP [${NAME}] register absent (gitignored) — ${registerPath}\n`);
      return 0;
    }
    process.stderr.write(`ERROR [${NAME}] register unreadable (fail-closed): ${e.message}\n`);
    return 2;
  }

  const { findings, phantomClose, malformedLines, skippedPartial } = evaluate({ registerText, fileExists: realFileExists });
  const blocking = enforce && findings.length > 0;
  const REALITY_DISCLAIMER = "CANDIDATE-probe, NOT proof: 'file exists' is not 'ED resolved' (a stub/unwired file fools it) and 'file absent' is not 'closure false' (a legit rename). GREEN = no candidates, NOT register-accurate; never auto-close.";
  const out = {
    name: NAME,
    status: blocking ? "red" : "green",
    register: registerPath,
    enforced: enforce,
    findings,
    phantomClose,
    skippedPartial,
    malformedLines,
    disclaimer: REALITY_DISCLAIMER,
  };
  if (jsonOut) {
    process.stdout.write(JSON.stringify(out) + "\n");
  } else {
    if (findings.length) {
      process.stderr.write(`${blocking ? "FAIL" : "WARN"} [${NAME}] ${findings.length} open ED(s) whose enforcer shipped (register lags reality — direction a):\n`);
      for (const f of findings) process.stderr.write(`     - ${f.id}: ${f.deliverable} (+ ${f.test}) exists — verify + append a closure row\n`);
    }
    if (phantomClose.length) {
      process.stderr.write(`INFO [${NAME}] ${phantomClose.length} PHANTOM-CLOSE candidate(s) (closed ED, named enforcer ABSENT — direction b, report-only):\n`);
      for (const f of phantomClose) process.stderr.write(`     - ${f.id}: ${f.deliverable} absent\n`);
    }
    if (malformedLines) process.stderr.write(`     (${malformedLines} malformed register line(s) skipped)\n`);
    if (!findings.length && !phantomClose.length) process.stdout.write(`OK   [${NAME}] no reality-drift candidates (neither stale-open nor phantom-close)\n`);
    process.stderr.write(`     NOTE (${NAME}): ${REALITY_DISCLAIMER}\n`);
  }
  return blocking ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, NAME };
