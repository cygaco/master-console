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
      if (EXCLUDE_NAME_RE.test(f)) continue;
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
  // A prefix collision means short-id resolution is ambiguous → fail closed.
  const ok = parseErrors.length === 0 && newDefects.length === 0 && staleBaseline.length === 0 && prefixCollisions.length === 0;
  const result = { file, rows: rows.length, parseErrors, fieldsScanned, refsChecked, prefixLen: PREFIX_LEN, prefixCollisions, baselined: baseline.length, newDefects, staleBaseline, declaredUnlogged, correctionNoteRefs, ok };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`beta-ledger-refs: ${rows.length} rows, ${fieldsScanned} fields scanned (default-scan; excluded by name-property), ${refsChecked} refs checked, ${baseline.length} baselined historical holes, prefix ceiling ${PREFIX_LEN} hex (${prefixCollisions.length} collisions)`);
    for (const p of parseErrors) console.log(`  PARSE-ERROR row ${p.row}: ${p.error}`);
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
