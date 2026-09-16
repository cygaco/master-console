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

const CROSS_REF_FIELDS = [
  "related_beta_verdict_ids",
  "precedent",
  "parent_msg_id",
  "supplements",
  "supplements_msg_id",
  "supersedes",
  "supersedes_msg_id",
  "supersedes_in_part",
  "superseded_by_msg_id",
  "voids",
  "amends",
  "amends_msg_id",
  "amendments",
];
// Correction notes cite the WRONG id by design (they name a defect, not a presence claim),
// so they are scanned for reporting but never fail the check.
const CORRECTION_NOTE_FIELDS = ["id_correction_note", "related_id_correction_note"];
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
  // Index of own ids (full + 8-char prefix).
  const own = new Set();
  for (const { o } of rows) {
    for (const k of ["msg_id", "beta_verdict_msg_id", "id"]) {
      const v = o[k];
      if (typeof v === "string" && v.length >= 8) { own.add(v.toLowerCase()); own.add(v.slice(0, 8).toLowerCase()); }
    }
  }
  const unresolved = [];
  const correctionNoteRefs = [];
  let refsChecked = 0;
  const scan = (n, f, v, sink) => {
    let m;
    ID_RE.lastIndex = 0;
    while ((m = ID_RE.exec(v))) {
      const full = m[0].toLowerCase();
      const short = m[1].toLowerCase();
      // Skip pure-numeric 8-digit tokens (dates like 20260916) — not ids.
      if (/^\d{8}$/.test(short)) continue;
      refsChecked++;
      if (own.has(full) || own.has(short)) continue;
      // A reference explicitly marked as unlogged is an honest claim, not a false one.
      const ctx = v.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80).toLowerCase();
      if (/\b(unlogged|not logged|no row|unverified|not in the (ledger|record))\b/.test(ctx)) continue;
      sink.push({ row: n, field: f, id: m[0] });
    }
  };
  for (const { n, o } of rows) {
    for (const f of CROSS_REF_FIELDS) if (typeof o[f] === "string") scan(n, f, o[f], unresolved);
    for (const f of CORRECTION_NOTE_FIELDS) if (typeof o[f] === "string") scan(n, f, o[f], correctionNoteRefs);
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
  const ok = parseErrors.length === 0 && newDefects.length === 0 && staleBaseline.length === 0;
  const result = { file, rows: rows.length, parseErrors, refsChecked, baselined: baseline.length, newDefects, staleBaseline, correctionNoteRefs, ok };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`beta-ledger-refs: ${rows.length} rows, ${refsChecked} cross-refs checked, ${baseline.length} baselined historical holes`);
    for (const p of parseErrors) console.log(`  PARSE-ERROR row ${p.row}: ${p.error}`);
    for (const u of newDefects) console.log(`  UNRESOLVED row ${u.row} ${u.field}: ${u.id} — no row carries this as its own msg_id`);
    for (const b of staleBaseline) console.log(`  STALE-BASELINE row ${b.row} ${b.field}: ${b.id} — now resolves (or vanished); remove it from the baseline`);
    for (const c of correctionNoteRefs) console.log(`  note: correction-note ref row ${c.row} ${c.field}: ${c.id} (exempt by design)`);
    console.log(ok ? "GREEN" : "RED");
  }
  process.exit(ok ? 0 : 1);
}

main();
