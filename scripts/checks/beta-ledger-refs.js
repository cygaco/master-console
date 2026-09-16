#!/usr/bin/env node
"use strict";
/**
 * beta-ledger-refs — referential-integrity lint over paths.betaEvents.
 *
 * POLICY (β, 2026-09-16, S-OS-06 r4): every β-verdict identifier that appears in a
 * CROSS-REFERENCE field of a ledger row must resolve to a row whose OWN msg_id /
 * beta_verdict_msg_id is that identifier. A cross-reference is a claim that a ruling is
 * in the record; an unresolvable one is either a silently absent row (4f7b2c93, 09-15)
 * or a falsely annotated one (b3f81d47 "epsilon-logged" in row 481, 09-16). Both are the
 * same class: a completion claim from the party who owes the action treated as evidence.
 *
 * ENFORCER for that policy. Fail-closed: any unresolved reference → exit 1.
 *
 * What is checked: identifiers (full UUID or ≥8-hex short id) found in the cross-ref
 * fields listed in CROSS_REF_FIELDS. Harness / consult message ids live in fields whose
 * names end in _harness_msg_id / consult_msg_id and are NOT ledger rows, so those fields
 * are excluded by name.
 *
 * Usage: node scripts/checks/beta-ledger-refs.js [--file <path>] [--json]
 */
const fs = require("fs");
const path = require("path");

// FIELD SELECTION IS A PROPERTY, NOT A LIST (β verdict d9c17e45, F1): every string field is
// scanned by DEFAULT; a field is EXCLUDED only if its NAME carries one of these properties.
// A new bespoke cross-ref field is therefore scanned automatically; a new free-text field
// produces a visible RED (the fail-closed direction), never a silent green.
const EXCLUDE_NAME_RE = new RegExp([
  // identifiers of OTHER stores (harness / consult message ids are not ledger rows). MEASURED
  // 2026-09-16: consult_thread / topic / reply_to / answers_consult / corrects carry consult
  // (harness) ids — 47 hex tokens, 0 of them ledger rows; commit / verified_head / gauntlet /
  // read_in_tree carry git SHAs.
  "(_harness_msg_id|consult_msg_id|_consult_id|consult_addendum_msg_id|consult_update_msg_id|event_id|panel_run_id|sprint_id)$",
  "(consult|thread|topic|reply_to|answers_|corrects|logged_by)",
  "(commit|_head$|^head$|tree|sha|gauntlet)",
  // the row's OWN identity fields (indexed, not referenced)
  "^(msg_id|beta_verdict_msg_id|id)$",
  // labels / clocks / provenance and free-text NARRATIVE fields — prose about a ruling, not a
  // claim that a ruling is in the record. Commit SHAs and harness ids live here.
  "(_label|_note|_notes|^note$|^ts|^type$|^record_kind$|^sprint$|^boundary$|^decision$|^class$|^subject$|^summary$|^answer$|^reasoning$|_recorded$|_resolution$|_action$|_depth|_split$|^also_in|^scope_effect$|^contested_reading$|^concession_to_alpha$|^beta_self_corrections$|^standing_notes$|^verified_at_source$|^attested_not_verified$|^not_read$|^consulted_by$|^appended_by$|^append_lane$|^evidence$|^residuals|^rider|^merge_time_rider|audit)",
  // voided message ids are BY CONSTRUCTION not rulings (β: the consult went to a dead handle
  // and no verdict was ever produced) — the field records a message that went nowhere.
  "^voids$",
].join("|"), "i");
// Correction notes cite the WRONG id by design (they name a defect, not a presence claim),
// so they are scanned for reporting but never fail the check.
const CORRECTION_NOTE_RE = /correction_note$/i;
// STRUCTURED unlogged declaration (β F2): a row may carry `unlogged_refs: ["<id>", ...]` —
// the ONLY way a cross-referenced id may be absent without RED. No prose-proximity escape:
// one honest marker must never absolve a neighbouring id in the same string.
const UNLOGGED_FIELD = "unlogged_refs";
// Prefix ceiling: short ids resolve on the first PREFIX_LEN hex chars. Printed in the output.
const PREFIX_LEN = 8;
// Historical holes that predate this enforcer. Shrink-only: an entry that now RESOLVES
// is a stale baseline (RED); an unresolved ref NOT in the baseline is a new defect (RED).
const BASELINE_FILE = path.join(__dirname, "beta-ledger-refs.baseline.json");
const ID_RE = /\b([0-9a-f]{8})(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\b/gi;
// Tokens that look like short ids but are commit SHAs / row refs are excluded by context:
// we only scan the cross-ref fields above, never free-text answer fields.

function resolveLedgerPath(argv) {
  const i = argv.indexOf("--file");
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  try {
    const { PATHS } = require("../hooks/lib/paths");
    if (PATHS && PATHS.betaEvents) return path.resolve(PATHS.betaEvents);
  } catch (_) { /* fall through */ }
  return path.resolve(".claude/agents/president/_system/beta/events.jsonl");
}

function main() {
  const argv = process.argv.slice(2);
  const file = resolveLedgerPath(argv);
  const asJson = argv.includes("--json");
  if (!fs.existsSync(file)) {
    console.error(`beta-ledger-refs: ledger not found: ${file}`);
    process.exit(2);
  }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  const parseErrors = [];
  lines.forEach((l, idx) => {
    try { rows.push({ n: idx + 1, o: JSON.parse(l) }); }
    catch (e) { parseErrors.push({ row: idx + 1, error: e.message }); }
  });
  // Index of own ids (full + PREFIX_LEN-char prefix). Prefix collisions are reported.
  const own = new Set();
  const prefixOwners = new Map();
  for (const { o } of rows) {
    for (const k of ["msg_id", "beta_verdict_msg_id", "id"]) {
      const v = o[k];
      if (typeof v === "string" && v.length >= PREFIX_LEN) {
        const full = v.toLowerCase();
        own.add(full);
        // Prefix resolution is for HEX-shaped ids only (UUID / hex). Slug-style ids
        // (evt-…, beta-…) are matched in full; indexing their prefix collides by design.
        if (/^[0-9a-f]{8}/.test(full)) {
          const pre = full.slice(0, PREFIX_LEN);
          own.add(pre);
          if (!prefixOwners.has(pre)) prefixOwners.set(pre, new Set());
          prefixOwners.get(pre).add(full);
        }
      }
    }
  }
  const prefixCollisions = [...prefixOwners.entries()].filter(([, s]) => s.size > 1).map(([p, s]) => ({ prefix: p, ids: [...s] }));
  const unresolved = [];
  const correctionNoteRefs = [];
  const declaredUnlogged = [];
  let refsChecked = 0;
  let fieldsScanned = 0;
  // POPULATION RECONCILIATION (β verdict e4b7d209): every field the check DECLINES to scan is
  // emitted with the count of id-shaped tokens it held, so an over-matching exclusion is
  // auditable instead of invisible. Every printed GREEN ships what it did not scan.
  const fieldsExcluded = {};
  const countIdTokens = (v) => { ID_RE.lastIndex = 0; let c = 0, m; while ((m = ID_RE.exec(v))) if (!/^\d{8}$/.test(m[1])) c++; return c; };
  const scan = (n, f, v, sink, unloggedSet) => {
    let m;
    ID_RE.lastIndex = 0;
    while ((m = ID_RE.exec(v))) {
      const full = m[0].toLowerCase();
      const short = m[1].toLowerCase();
      // Skip pure-numeric 8-digit tokens (dates like 20260916) — not ids.
      if (/^\d{8}$/.test(short)) continue;
      refsChecked++;
      if (own.has(full) || own.has(short)) continue;
      if (unloggedSet.has(full) || unloggedSet.has(short)) { declaredUnlogged.push({ row: n, field: f, id: m[0] }); continue; }
      sink.push({ row: n, field: f, id: m[0] });
    }
  };
  for (const { n, o } of rows) {
    const unloggedSet = new Set(Array.isArray(o[UNLOGGED_FIELD]) ? o[UNLOGGED_FIELD].map((s) => String(s).toLowerCase()) : []);
    for (const s of unloggedSet) unloggedSet.add(s.slice(0, PREFIX_LEN));
    for (const [f, v] of Object.entries(o)) {
      if (typeof v !== "string" || f === UNLOGGED_FIELD) continue;
      if (CORRECTION_NOTE_RE.test(f)) { scan(n, f, v, correctionNoteRefs, unloggedSet); continue; }
      if (EXCLUDE_NAME_RE.test(f)) { fieldsExcluded[f] = (fieldsExcluded[f] || 0) + countIdTokens(v); continue; }
      fieldsScanned++;
      scan(n, f, v, unresolved, unloggedSet);
    }
  }
  // Baseline: shrink-only. Applies to the canonical ledger by default; an explicit --file
  // (fixture) uses no baseline unless --baseline <path> is passed.
  let baseline = [];
  const bi = argv.indexOf("--baseline");
  const baselineFile = bi >= 0 && argv[bi + 1] ? path.resolve(argv[bi + 1]) : (argv.includes("--file") ? null : BASELINE_FILE);
  if (baselineFile && fs.existsSync(baselineFile)) {
    try { baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8")).entries || []; }
    catch (e) { parseErrors.push({ row: 0, error: `baseline unreadable: ${e.message}` }); }
  }
  const key = (u) => `${u.row}|${u.field}|${String(u.id).toLowerCase().slice(0, 8)}`;
  const baselineKeys = new Set(baseline.map(key));
  const unresolvedKeys = new Set(unresolved.map(key));
  const newDefects = unresolved.filter((u) => !baselineKeys.has(key(u)));
  const staleBaseline = baseline.filter((b) => !unresolvedKeys.has(key(b)));
  // ISSUED-STUB RULE (β verdict e79b4d13, the enforcer's ceiling): a verdict that nothing cites is
  // invisible to referential integrity. To make it visible, β cc's α an ISSUED line at issue time
  // and α appends a row with record_kind "issued-stub"; a stub whose id never receives a full
  // verdict row (record_kind "verdict" carrying the same msg_id) is RED. issued-vs-logged is then
  // computable from the store instead of from anyone's memory.
  // β conditions (verdict b8e5f3c7): (1) a stub carries NO judgment and is explicitly
  // non-authoritative — a stub that carries decision/answer, or lacks `authoritative:false`,
  // is itself a defect (it could be read as a ruling); (2) a WITHDRAWAL path closed by
  // registration: a later row with the same id and record_kind "withdrawn" resolves the stub.
  const stubs = rows.filter(({ o }) => o.record_kind === "issued-stub" && typeof o.msg_id === "string");
  const fulfilledIds = new Set(rows.filter(({ o }) => (o.record_kind !== "issued-stub") && typeof o.msg_id === "string").map(({ o }) => o.msg_id.toLowerCase()));
  const unfulfilledStubs = stubs.filter(({ o }) => !fulfilledIds.has(o.msg_id.toLowerCase())).map(({ n, o }) => ({ row: n, id: o.msg_id, party: o.issued_to || "", boundary: o.boundary || "" }));
  const malformedStubs = stubs.filter(({ o }) => o.authoritative !== false || "decision" in o || "answer" in o).map(({ n, o }) => ({ row: n, id: o.msg_id, why: o.authoritative !== false ? "missing authoritative:false" : "carries decision/answer (readable as a ruling)" }));
  // A prefix collision means short-id resolution is ambiguous → fail closed.
  const ok = parseErrors.length === 0 && newDefects.length === 0 && staleBaseline.length === 0 && prefixCollisions.length === 0 && unfulfilledStubs.length === 0 && malformedStubs.length === 0;
  const excludedList = Object.entries(fieldsExcluded).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const result = { file, rows: rows.length, parseErrors, fieldsScanned, fieldsExcluded, refsChecked, prefixLen: PREFIX_LEN, prefixCollisions, baselined: baseline.length, newDefects, staleBaseline, declaredUnlogged, correctionNoteRefs, issuedStubs: stubs.length, unfulfilledStubs, malformedStubs, ceiling: "checks that every CITED id resolves and every ISSUED-STUB is fulfilled; a verdict that was never cited and never stubbed is OUTSIDE this instrument", ok };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`beta-ledger-refs: ${rows.length} rows, ${fieldsScanned} fields scanned (default-scan; excluded by name-property), ${refsChecked} refs checked, ${baseline.length} baselined historical holes, prefix ceiling ${PREFIX_LEN} hex (${prefixCollisions.length} collisions), ${stubs.length} issued-stubs (${unfulfilledStubs.length} unfulfilled)`);
    console.log(`  CEILING: this check proves that every CITED id resolves and every ISSUED-STUB is fulfilled. A verdict that was never cited and never stubbed is OUTSIDE this instrument — GREEN does not mean every ruling is in the record.`);
    console.log(`  excluded-by-property (${excludedList.length} field names; id-shaped tokens NOT checked, for audit): ${excludedList.map(([k, c]) => `${k}=${c}`).join(" ") || "(none)"}`);
    for (const p of parseErrors) console.log(`  PARSE-ERROR row ${p.row}: ${p.error}`);
    for (const s of unfulfilledStubs) console.log(`  UNFULFILLED-STUB row ${s.row}: ${s.id} issued to ${s.party || "?"} re ${s.boundary || "?"} — no verdict (or withdrawn) row carries this id`);
    for (const s of malformedStubs) console.log(`  MALFORMED-STUB row ${s.row}: ${s.id} — ${s.why}; a stub must be authoritative:false and carry no judgment`);
    for (const c of prefixCollisions) console.log(`  PREFIX-COLLISION ${c.prefix}: ${c.ids.join(", ")} — short-id resolution ambiguous; raise PREFIX_LEN`);
    for (const u of newDefects) console.log(`  UNRESOLVED row ${u.row} ${u.field}: ${u.id} — no row carries this as its own msg_id`);
    for (const b of staleBaseline) console.log(`  STALE-BASELINE row ${b.row} ${b.field}: ${b.id} — now resolves (or vanished); remove it from the baseline`);
    for (const d of declaredUnlogged) console.log(`  note: row ${d.row} ${d.field}: ${d.id} declared in unlogged_refs (honest absence, exempt)`);
    for (const c of correctionNoteRefs) console.log(`  note: correction-note ref row ${c.row} ${c.field}: ${c.id} (exempt by design)`);
    console.log(ok ? "GREEN" : "RED");
  }
  process.exit(ok ? 0 : 1);
}

main();
