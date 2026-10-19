"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

const DECISION_VOCAB = new Set(["DECIDE", "DIRECTIVE", "ESCALATE", "REQUESTED"]);
const CLASS_VOCAB = new Set(["A", "B", "C"]);
const MSGID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const VERDICT_TYPES = new Set([
  "beta-consult-verdict",
  "beta-consult-verdict-reconfirm",
  "beta-verdict",
  "beta-directive",
  "design-boundary-verdict",
  "fix-lock-verdict",
  "design-lock",
  "fix-lock",
  "beta-consult-retraction",
  "boundary",
  "gauntlet-boundary-verdict",
  "release-gate-verdict",
  "ledger-correction",
  "beta-prerequisite-flag",
]);
const RECONCILE_TYPES = new Set(["beta-ledger-reconcile"]);
const FLEX_TYPES = new Set([
  "beta-consult",
  "beta-consult-request",
  "beta_consult",
  "design-boundary-consult",
]);
const KNOWN_TYPES = new Set([...VERDICT_TYPES, ...RECONCILE_TYPES, ...FLEX_TYPES]);

const CONTENT_FIELDS = [
  "boundary", "decision", "verdict", "answer", "question", "summary",
  "topic", "note", "status", "key_rulings", "riders", "action", "recommendation", "from", "to",
  "subject",
];
const VERDICT_SHAPE_FIELDS = ["decision", "verdict", "class", "confidence"];

function paths() {
  try {
    const P = require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS;
    return { betaEvents: P.betaEvents };
  } catch {
    return { betaEvents: path.join(".claude", "agents", "president", "_system", "beta", "events.jsonl") };
  }
}

function isParseableTs(v) {
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Date.parse(v));
}

function isProvided(v) {
  return v !== undefined && v !== null;
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function hasVerdictShape(row) {
  return isPlainObject(row) && VERDICT_SHAPE_FIELDS.some((f) => row[f] !== undefined && row[f] !== null);
}

function hasContent(row) {
  return isPlainObject(row) && CONTENT_FIELDS.some((f) => row[f] !== undefined && row[f] !== null);
}

function confidenceValid(c) {
  if (typeof c === "number") return !Number.isNaN(c) && c >= 0 && c <= 1;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const vals = Object.values(c);
    return vals.length > 0 && vals.every((v) => typeof v === "number" && !Number.isNaN(v) && v >= 0 && v <= 1);
  }
  return false;
}

function classifyRow(row) {
  if (isPlainObject(row) && typeof row.type === "string" && row.type.trim() !== "") return "consult";
  if (
    isPlainObject(row) &&
    row.type == null &&
    typeof row.cat === "string" &&
    row.id != null &&
    row.actor != null &&
    row.session != null &&
    row.data != null &&
    !hasVerdictShape(row)
  ) {
    return "generic";
  }
  return "unclassifiable";
}

function checkConsultRow(row, lineNo) {
  const out = [];
  const type = row.type;
  const add = (code, detail, severity) => out.push({ line: lineNo, type, code, detail, severity: severity || "structural" });

  if (!isParseableTs(row.ts)) {
    add("missing_or_invalid_ts", `ts is ${row.ts === undefined ? "absent" : JSON.stringify(row.ts)} (not a parseable timestamp)`);
  }

  if (isProvided(row.decision)) {
    if (typeof row.decision !== "string" || !DECISION_VOCAB.has(row.decision.toUpperCase())) {
      add("invalid_decision", `decision ${JSON.stringify(row.decision)} not in {DECIDE, DIRECTIVE, ESCALATE, REQUESTED}`);
    }
  }
  if (isProvided(row.class)) {
    if (typeof row.class !== "string" || !CLASS_VOCAB.has(row.class.toUpperCase())) {
      add("invalid_class", `class ${JSON.stringify(row.class)} not in {A, B, C}`);
    }
  }
  if (isProvided(row.confidence)) {
    if (!confidenceValid(row.confidence)) {
      add("invalid_confidence", `confidence ${JSON.stringify(row.confidence)} not a number (or per-dimension object) in [0,1]`);
    }
  }
  if (isProvided(row.msg_id)) {
    if (typeof row.msg_id !== "string" || !MSGID_RE.test(row.msg_id)) {
      add("invalid_msg_id", `msg_id ${JSON.stringify(row.msg_id)} is not an id-shaped token`);
    }
  }

  if (VERDICT_TYPES.has(type)) {
    const hasDecision = typeof row.decision === "string" && DECISION_VOCAB.has(row.decision.toUpperCase());
    const hasVerdict = typeof row.verdict === "string" && row.verdict.trim() !== "";
    if (!hasDecision && !hasVerdict) {
      add("verdict_row_missing_verdict", `type '${type}' represents a verdict but carries neither a valid decision nor a non-empty verdict`);
    }
  } else if (RECONCILE_TYPES.has(type)) {
    if (!Array.isArray(row.reconciles) || row.reconciles.length === 0) {
      add("reconcile_missing_reconciles", `type '${type}' must carry a non-empty 'reconciles' array`);
    } else if (row.reconciles.some((e) => !isPlainObject(e) && typeof e !== "string")) {
      add("reconcile_entry_malformed", `type '${type}' has a 'reconciles' entry that is not a (non-array) object or string`);
    }
  } else if (FLEX_TYPES.has(type)) {
    if (!hasContent(row)) {
      add("empty_consult_row", `type '${type}' carries no content field (${CONTENT_FIELDS.slice(0, 6).join("/")}/…) — an empty {type, ts} envelope`);
    }
  } else {
    if (hasVerdictShape(row)) {
      add("verdict_shaped_unknown_type", `type '${type}' is unrecognized yet carries verdict-shaped fields (${VERDICT_SHAPE_FIELDS.filter((f) => row[f] != null).join("/")}) — a possible type mutation`);
    } else {
      add("unknown_type", `type '${type}' is not a recognized reasoned-consult shape — add a family or verify it is intentional`, "advisory");
    }
  }

  return out;
}

function computeFindings(text) {
  const lines = String(text || "").split(/\r?\n/);
  let checkedConsult = 0;
  let skippedGeneric = 0;
  let unclassifiable = 0;
  let malformedLines = 0;
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || raw.trim() === "") continue;
    const lineNo = i + 1;
    let row;
    try {
      row = JSON.parse(raw);
    } catch {
      malformedLines++;
      findings.push({ line: lineNo, type: null, code: "malformed_json", detail: "line is not parseable JSON", severity: "structural" });
      continue;
    }
    const scope = classifyRow(row);
    if (scope === "generic") {
      skippedGeneric++;
      continue;
    }
    if (scope === "unclassifiable") {
      unclassifiable++;
      if (hasVerdictShape(row)) {
        findings.push({ line: lineNo, type: null, code: "verdict_shaped_untyped_row", detail: `untyped row carries verdict-shaped fields (${VERDICT_SHAPE_FIELDS.filter((f) => row[f] != null).join("/")}) — a possible type deletion`, severity: "structural" });
      } else {
        findings.push({ line: lineNo, type: row && row.type, code: "unclassifiable_row", detail: "row has no `type` and is not the generic logger schema", severity: "advisory" });
      }
      continue;
    }
    checkedConsult++;
    for (const f of checkConsultRow(row, lineNo)) findings.push(f);
  }

  const structuralCount = findings.filter((f) => f.severity !== "advisory").length;
  const advisoryCount = findings.length - structuralCount;
  return {
    ok: structuralCount === 0,
    checkedConsult,
    skippedGeneric,
    unclassifiable,
    malformedLines,
    findings,
    advisoryCount,
    structuralCount,
  };
}

const DISCLAIMER =
  "NOTE: STRUCTURAL well-formedness only — a GREEN means rows are well-formed for their type, " +
  "NOT that the consults happened or that msg_ids resolve (that SEMANTIC check is deferred).";

function argVal(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main(argv) {
  const enforce = argv.includes("--enforce");
  const jsonOut = argv.includes("--json");
  const ledgerOverride = argv.indexOf("--ledger") >= 0 ? argVal(argv, "--ledger") : null;
  const betaEvents = paths().betaEvents;
  const ledgerPath = ledgerOverride
    ? path.resolve(ledgerOverride)
    : path.isAbsolute(betaEvents)
      ? betaEvents
      : path.join(ROOT, betaEvents);

  let text;
  try {
    text = fs.readFileSync(ledgerPath, "utf8");
  } catch {
    if (jsonOut) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: "betaEvents unreadable/absent", ledgerPath }));
    } else {
      console.log(`SKIP [reasoned-consult-honesty] betaEvents unreadable/absent (${ledgerPath}) — /scan:full-only, never a CI gate. ${DISCLAIMER}`);
    }
    process.exit(0);
  }

  const res = computeFindings(text);

  if (jsonOut) {
    console.log(JSON.stringify({
      ok: res.ok,
      enforce,
      checkedConsult: res.checkedConsult,
      skippedGeneric: res.skippedGeneric,
      unclassifiable: res.unclassifiable,
      malformedLines: res.malformedLines,
      structuralCount: res.structuralCount,
      advisoryCount: res.advisoryCount,
      findings: res.findings.slice(0, 40),
      truncated: res.findings.length > 40,
      disclaimer: DISCLAIMER,
    }));
  } else {
    const summary = `${res.checkedConsult} consult-lane row(s) checked, ${res.skippedGeneric} generic skipped, ${res.structuralCount} structural finding(s), ${res.advisoryCount} advisory`;
    if (res.structuralCount === 0) {
      console.log(`OK   [reasoned-consult-honesty] ${summary}`);
      console.log(`     ${DISCLAIMER}`);
      if (res.advisoryCount > 0) {
        for (const f of res.findings.filter((f) => f.severity === "advisory").slice(0, 10)) {
          process.stdout.write(`     advisory L${f.line} [${f.code}] ${f.detail}\n`);
        }
      }
    } else {
      process.stderr.write(`FAIL [reasoned-consult-honesty] ${summary}:\n\n`);
      for (const f of res.findings.filter((f) => f.severity !== "advisory").slice(0, 20)) {
        process.stderr.write(`  L${f.line} [${f.code}] ${f.type != null ? "type=" + f.type + " " : ""}${f.detail}\n`);
      }
      const more = res.structuralCount - Math.min(res.structuralCount, 20);
      if (more > 0) process.stderr.write(`\n  ... and ${more} more\n`);
      process.stderr.write(`\n  ${DISCLAIMER}\n`);
    }
  }

  process.exit(enforce && !res.ok ? 1 : 0);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  classifyRow,
  checkConsultRow,
  computeFindings,
  isParseableTs,
  isProvided,
  confidenceValid,
  isPlainObject,
  hasVerdictShape,
  hasContent,
  CONTENT_FIELDS,
  VERDICT_SHAPE_FIELDS,
  DECISION_VOCAB,
  CLASS_VOCAB,
  VERDICT_TYPES,
  RECONCILE_TYPES,
  FLEX_TYPES,
  KNOWN_TYPES,
  DISCLAIMER,
  MSGID_RE,
};
