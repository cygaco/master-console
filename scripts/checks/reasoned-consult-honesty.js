"use strict";
/**
 * reasoned-consult-honesty.js (SP-20260723-004 / ED-234) — a STRUCTURAL well-formedness lint over the
 * REASONED-CONSULT lane (the betaEvents ledger `paths.betaEvents`). Sibling of the ED-267a
 * betaevents-dedup-lint (same lane, same gitignored/never-CI posture); where that one checks DEDUP +
 * msg_id RESOLUTION hygiene over verdict rows, this one checks that each reasoned-consult row is
 * WELL-FORMED FOR ITS TYPE.
 *
 * WHAT IT IS NOT (β load-bearing rider 2, ED-234): this is STRUCTURAL honesty, NOT SEMANTIC verification.
 * A GREEN here means "every recognized consult-lane row carries its minimal required fields and valid
 * decision/class/confidence VALUES" — it does NOT mean the consult actually happened, that a verdict is
 * real, or that a msg_id resolves in the message log. That SEMANTIC check ("did the consult occur / does
 * the msg_id resolve") needs the msg-log authenticator and is deferred as ED-275. The output states this
 * boundary explicitly so a GREEN is never mis-read as more assurance than it provides.
 *
 * SCOPE (β rider 2): /scan:full-scoped ONLY. betaEvents is a GITIGNORED advisory ledger — absent on a
 * fresh clone / CI, where this SKIPS-with-note (exit 0). NEVER a CI/fresh-clone gate. REPORT-ONLY by
 * default (findings printed, exit 0); `--enforce` -> exit 1 on any structural finding.
 *
 * THE LEDGER IS MIXED. The betaEvents file carries BOTH (a) generic logger events (schema
 * {id, cat, actor, session, data}, no `type`) and (b) reasoned-consult records (typed). Only (b) is in
 * scope; (a) is classified `generic` and SKIPPED (counted, never a finding). A row that is neither a
 * recognized generic event nor a typed consult record is surfaced as an advisory, not a hard RED —
 * graceful, so a future shape does not false-RED (β rider: recognize the ACTUAL row shapes I write).
 *
 * ROW SHAPES recognized (from the live corpus): beta-consult (flexible; may be free-form Q/A or carry a
 * verdict), beta-consult-request / beta_consult (requests, no verdict), beta-consult-verdict /
 * beta-consult-verdict-reconfirm / beta-verdict / beta-directive / design-boundary-verdict /
 * fix-lock-verdict / design-lock / fix-lock / beta-consult-retraction / boundary (VERDICT rows — must
 * carry a decision OR a non-empty verdict), design-boundary-consult (consult half, verdict may be
 * "pending"), beta-ledger-reconcile (reconciles[], no decision/class). Optional fields
 * (riders/note/self_correction/supersedes/ts_approx/priming/open_adr/…) never cause a finding.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// Decision vocabulary present in the live lane (case-insensitive membership — a lowercase-but-valid token
// is not flagged; genuine garbage like "MAYBE"/"" is). Kept a small closed set on purpose.
const DECISION_VOCAB = new Set(["DECIDE", "DIRECTIVE", "ESCALATE", "REQUESTED"]);
const CLASS_VOCAB = new Set(["A", "B", "C"]);
// A msg_id is an id-shaped token (uuid / slug); a whitespace/control-bearing value is malformed.
const MSGID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Types that REPRESENT a rendered verdict — each must carry a valid `decision` OR a non-empty `verdict`.
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
  // Families the lane grew AFTER this enforcer's 2026-07-23 vocabulary snapshot (66c0caf9). Corpus-verified
  // 2026-09-12: 17 `gauntlet-boundary-verdict` + 5 `release-gate-verdict` + 1 `ledger-correction` rows
  // (2026-07-27..29, ED-286/287/310/267a), every one a β verdict carrying decision+class+confidence+msg_id.
  // They were false-REDing as `verdict_shaped_unknown_type`; naming them here puts them UNDER the
  // verdict-family requirement (valid decision or non-empty verdict) instead of outside it.
  "gauntlet-boundary-verdict",
  "release-gate-verdict",
  "ledger-correction",
]);
// Types that carry a reconcile payload — must have a non-empty `reconciles` array.
const RECONCILE_TYPES = new Set(["beta-ledger-reconcile"]);
// Flexible/request types — universal + conditional-value checks only, no per-family requirement.
const FLEX_TYPES = new Set([
  "beta-consult",
  "beta-consult-request",
  "beta_consult",
  "design-boundary-consult",
]);
// The full recognized set — an unrecognized `type` becomes an advisory (not a hard finding).
const KNOWN_TYPES = new Set([...VERDICT_TYPES, ...RECONCILE_TYPES, ...FLEX_TYPES]);

// A consult/request row must carry at least one CONTENT field — an envelope with only {type, ts} is not
// well-formed "for its type" (backend r1 HIGH-1). Corpus-verified 0-false-reject: all 82 live FLEX rows
// (sparsest = 6 substantive fields) carry >=1 of these.
const CONTENT_FIELDS = [
  "boundary", "decision", "verdict", "answer", "question", "summary",
  "topic", "note", "status", "key_rulings", "riders", "action", "recommendation", "from", "to",
  // `subject` — the hand-append lane's universal one-line title since 2026-07-27 (corpus-verified: every
  // post-snapshot row carries it; a `record_kind:"retraction"` envelope carries `subject` + retracted_claim /
  // corrected_mechanism and nothing from the original list, so without it a real retraction false-REDs).
  "subject",
];
// Fields that mark a row as VERDICT-SHAPED — a row carrying these but an UNKNOWN or ABSENT `type` is a
// structurally suspicious mutation (backend r1 HIGH-2: type is settable, so deleting/mutating it must not
// silently evade the verdict-family requirement). The STRUCTURAL check can flag the shape; distinguishing
// a benign new type from a malicious mutation is SEMANTIC (ED-275).
const VERDICT_SHAPE_FIELDS = ["decision", "verdict", "class", "confidence"];

function paths() {
  try {
    const P = require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS;
    return { betaEvents: P.betaEvents };
  } catch {
    return { betaEvents: path.join(".claude", "agents", "president", "_system", "beta", "events.jsonl") };
  }
}

/** A parseable timestamp: a non-empty string Date can parse. (Structural — not an ISO round-trip; the
 *  lane carries a few `ts_approx:true` rows whose `ts` is still a real timestamp.) */
function isParseableTs(v) {
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Date.parse(v));
}

/** A field is "provided" only when it is present AND not null — a `null` value is an explicit
 *  not-applicable marker (retractions/requests carry confidence:null), NOT a malformed value. */
function isProvided(v) {
  return v !== undefined && v !== null;
}

/** A plain (non-array) object — the only shape that can carry named row fields. A JSON `null`/scalar/array
 *  line parses fine but is not a row; the field helpers must not dereference it (r2 7G-002 crash). */
function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** A row is VERDICT-SHAPED if it carries any field that only a verdict/decision row would (used to catch a
 *  verdict row whose settable `type` was deleted/mutated to evade the verdict-family requirement).
 *  Null/non-object-safe: a JSON `null`/scalar line is never verdict-shaped (and never crashes the scan). */
function hasVerdictShape(row) {
  return isPlainObject(row) && VERDICT_SHAPE_FIELDS.some((f) => row[f] !== undefined && row[f] !== null);
}

/** A consult/request row carries CONTENT if any recognized content field is provided (not just {type,ts}). */
function hasContent(row) {
  return isPlainObject(row) && CONTENT_FIELDS.some((f) => row[f] !== undefined && row[f] !== null);
}

/** confidence is valid as EITHER a scalar in [0,1] OR a per-dimension object (`{lane_a:0.9, …}`) whose
 *  values are all numbers in [0,1] — the lane records multi-lane confidences that way. */
function confidenceValid(c) {
  if (typeof c === "number") return !Number.isNaN(c) && c >= 0 && c <= 1;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const vals = Object.values(c);
    return vals.length > 0 && vals.every((v) => typeof v === "number" && !Number.isNaN(v) && v >= 0 && v <= 1);
  }
  return false;
}

/**
 * classifyRow(row) -> "consult" | "generic" | "unclassifiable". A typed row is a consult-lane record; an
 * untyped row bearing the generic logger schema ({id, cat, actor, data}) is a generic event (out of
 * scope); anything else is unclassifiable (surfaced as advisory, never a hard finding).
 */
function classifyRow(row) {
  if (isPlainObject(row) && typeof row.type === "string" && row.type.trim() !== "") return "consult";
  // Generic requires the FULL logger schema {id, cat, actor, session, data} AND no top-level verdict shape
  // (backend r1 HIGH-2 / r2 7G-001 + β's masquerade flag): the generic-skip is by KNOWN-other-type, NEVER
  // an escape hatch. A partial {id,cat,actor} row, OR a full-schema row contaminated with a top-level
  // decision/verdict/class/confidence, falls to `unclassifiable` and is surfaced (verdict-shaped → RED).
  // Real generic logger rows keep verdict-ish content INSIDE `data`, never top-level (corpus-verified 0/105).
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

/**
 * checkConsultRow(row, lineNo) -> array of finding objects for ONE typed consult-lane row. Each finding:
 * { line, type, code, detail }. Empty array = structurally well-formed. All value checks are CONDITIONAL
 * (fire only when the field is present) except the universal `ts` requirement and the per-family
 * requirement. `code` "unknown_type" is ADVISORY (severity "advisory"); everything else is "structural".
 */
function checkConsultRow(row, lineNo) {
  const out = [];
  const type = row.type;
  const add = (code, detail, severity) => out.push({ line: lineNo, type, code, detail, severity: severity || "structural" });

  // Universal: a consult record must carry a parseable timestamp.
  if (!isParseableTs(row.ts)) {
    add("missing_or_invalid_ts", `ts is ${row.ts === undefined ? "absent" : JSON.stringify(row.ts)} (not a parseable timestamp)`);
  }

  // Conditional value-domain checks (fire only when the field is provided — present AND not null).
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

  // Per-family requirement.
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
      // F3 (backend r1 MED + r2 7G-003): a real reconcile entry is a (non-array) object or a string. A
      // null/primitive OR an ARRAY (typeof []==="object") is not a reconcile record.
      add("reconcile_entry_malformed", `type '${type}' has a 'reconciles' entry that is not a (non-array) object or string`);
    }
  } else if (FLEX_TYPES.has(type)) {
    // F1 (backend r1 HIGH-1): a consult/request row must carry SOME content — {type, ts} alone is empty.
    if (!hasContent(row)) {
      add("empty_consult_row", `type '${type}' carries no content field (${CONTENT_FIELDS.slice(0, 6).join("/")}/…) — an empty {type, ts} envelope`);
    }
  } else {
    // Unrecognized type. F2b (backend r1 HIGH-2): a VERDICT-SHAPED row with an unknown type is a
    // structurally suspicious mutation (the settable `type` was changed to evade the verdict-family gate)
    // and is a STRUCTURAL finding; a benign unknown type (no verdict shape) stays a graceful advisory (β
    // rider: a future shape must not false-RED).
    if (hasVerdictShape(row)) {
      add("verdict_shaped_unknown_type", `type '${type}' is unrecognized yet carries verdict-shaped fields (${VERDICT_SHAPE_FIELDS.filter((f) => row[f] != null).join("/")}) — a possible type mutation`);
    } else {
      add("unknown_type", `type '${type}' is not a recognized reasoned-consult shape — add a family or verify it is intentional`, "advisory");
    }
  }

  return out;
}

/**
 * computeFindings(text) -> {ok, checkedConsult, skippedGeneric, unclassifiable, malformedLines, findings,
 * advisoryCount, structuralCount}. `ok` reflects STRUCTURAL findings only (advisories do not fail).
 */
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
      // F2b: a verdict-SHAPED row with no `type` (a deleted-type mutation) is a STRUCTURAL finding; an
      // otherwise-untyped, non-generic row stays a graceful advisory.
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
  "NOT that the consults happened or that msg_ids resolve (that SEMANTIC check is deferred as ED-275).";

function argVal(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main(argv) {
  const enforce = argv.includes("--enforce");
  const jsonOut = argv.includes("--json");
  const ledgerOverride = argv.indexOf("--ledger") >= 0 ? argVal(argv, "--ledger") : null;
  const betaEvents = paths().betaEvents; // absolute from the PATHS lib; the fallback literal is relative
  const ledgerPath = ledgerOverride
    ? path.resolve(ledgerOverride)
    : path.isAbsolute(betaEvents)
      ? betaEvents
      : path.join(ROOT, betaEvents);

  let text;
  try {
    text = fs.readFileSync(ledgerPath, "utf8");
  } catch {
    // SKIP-when-unreadable (β rider): a gitignored ledger absent on a fresh clone/CI is not a failure.
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

  // REPORT-ONLY by default; --enforce turns a structural finding into a non-zero exit.
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
