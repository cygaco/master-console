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

// H3 (S-OS-06 r5 fix brief): the previous skip was "any 8 digits" — every genuine calendar
// date (session/precedent/mirror_of literally carry bare YYYYMMDD dates throughout the real
// ledger) AND every fabricated all-digit id lookalike (the real bypass: a crafted `99999999`
// reference was never checked). A blanket removal of the skip was MEASURED against the live
// ledger and produced 52 false UNRESOLVED findings, all genuine dates — not viable. The fix is
// value-VALIDITY, not value-shape: only an 8-digit token that actually parses as a plausible
// YYYYMMDD calendar date is treated as a date; a non-date-shaped all-digit token (e.g.
// `99999999`, month 99) is checked like any other candidate id. Re-measured clean (0 false
// positives) against the live ledger after this change.
function isDateLikeToken(s) {
  if (!/^\d{8}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (y < 2000 || y > 2099) return false;
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}

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
  const countIdTokens = (v) => { ID_RE.lastIndex = 0; let c = 0, m; while ((m = ID_RE.exec(v))) if (!isDateLikeToken(m[1])) c++; return c; };
  const scan = (n, f, v, sink, unloggedSet) => {
    let m;
    ID_RE.lastIndex = 0;
    while ((m = ID_RE.exec(v))) {
      const full = m[0].toLowerCase();
      const short = m[1].toLowerCase();
      // Skip a token only when it is VALIDLY date-shaped (H3, S-OS-06 r5) — a non-date-shaped
      // all-digit token (e.g. 99999999) is checked like any other candidate id.
      if (isDateLikeToken(short)) continue;
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
  // Baseline is keyed on the resolved TARGET, never on how the path arrived (β verdict a71e5c34:
  // `--file` answers "where is the ledger"; reading it as "this is a fixture, suppress the baseline"
  // was one field answering two questions and produced false REDs on the real ledger from any
  // non-root cwd). Canonical ledger ⇒ baseline applies; any other target ⇒ off; `--baseline <path>`
  // sets it explicitly; `--no-baseline` is the explicit override.
  let baseline = [];
  const bi = argv.indexOf("--baseline");
  const canonicalLedger = (() => {
    try { const { PATHS } = require("../hooks/lib/paths"); if (PATHS && PATHS.betaEvents) return path.resolve(PATHS.betaEvents).toLowerCase(); } catch (_) { /* fall through */ }
    return path.resolve(__dirname, "../../.claude/agents/president/_system/beta/events.jsonl").toLowerCase();
  })();
  const norm = (p) => path.resolve(p).toLowerCase().replace(/\\/g, "/");
  const CANONICAL_SUFFIX = ".claude/agents/president/_system/beta/events.jsonl";
  const targetIsCanonical = norm(file) === canonicalLedger.replace(/\\/g, "/") || norm(file).endsWith(CANONICAL_SUFFIX);
  const baselineFile = argv.includes("--no-baseline") ? null
    : (bi >= 0 && argv[bi + 1]) ? path.resolve(argv[bi + 1])
    : (targetIsCanonical ? BASELINE_FILE : null);
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
  // H4 (S-OS-06 r5): ALLOWLIST the valid fulfilling forms — a row with a dummy or missing
  // record_kind must never "fulfil" a stub. Deny-listing only "issued-stub" let ANY other
  // record_kind (including none) fulfil, which is a fail-open on the stub-fulfilment check.
  const fulfilledIds = new Set(rows.filter(({ o }) => ["verdict", "withdrawn"].includes(o.record_kind) && typeof o.msg_id === "string").map(({ o }) => o.msg_id.toLowerCase()));
  const unfulfilledStubs = stubs.filter(({ o }) => !fulfilledIds.has(o.msg_id.toLowerCase())).map(({ n, o }) => ({ row: n, id: o.msg_id, party: o.issued_to || "", boundary: o.boundary || "" }));
  const malformedStubs = stubs.filter(({ o }) => o.authoritative !== false || "decision" in o || "answer" in o).map(({ n, o }) => ({ row: n, id: o.msg_id, why: o.authoritative !== false ? "missing authoritative:false" : "carries decision/answer (readable as a ruling)" }));
  // ARTIFACT MODE (β verdict c1d47a92, the targeted widening): `--artifact <file>` (repeatable) scans a
  // PRESENCE-CLAIM artifact — a file whose purpose is to assert what is in the ledger (e.g.
  // runtime/S-OS-06/r4/ALPHA-RULINGS.md). Not a general artifact sweep (that was refused by
  // measurement: uncited verdicts appear nowhere on disk). Every id-shaped token is bucketed:
  // ledger-row | git-object | declared-unlogged (an `UNLOGGED:` line naming it) | UNKNOWN → RED.
  const artifactFiles = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--artifact" && argv[i + 1]) artifactFiles.push(path.resolve(argv[++i]));
  const repoRoot = path.resolve(__dirname, "../..");
  const isGitObject = (tok) => {
    try { return require("child_process").spawnSync("git", ["-C", repoRoot, "cat-file", "-e", `${tok}^{object}`], { encoding: "utf8" }).status === 0; }
    catch (_) { return false; }
  };
  const artifacts = [];
  for (const af of artifactFiles) {
    const a = { file: af, exists: fs.existsSync(af), tokens: 0, ledger: [], gitObject: [], declaredUnlogged: [], unknown: [] };
    if (a.exists) {
      const text = fs.readFileSync(af, "utf8");
      const declared = new Set();
      for (const line of text.split(/\r?\n/)) if (/^\s*>?\s*UNLOGGED:/i.test(line)) { let m; ID_RE.lastIndex = 0; while ((m = ID_RE.exec(line))) declared.add(m[1].toLowerCase()); }
      const seen = new Set();
      let m;
      ID_RE.lastIndex = 0;
      while ((m = ID_RE.exec(text))) {
        const full = m[0].toLowerCase(), short = m[1].toLowerCase();
        if (isDateLikeToken(short) || seen.has(short)) continue;
        seen.add(short);
        a.tokens++;
        if (own.has(full) || own.has(short)) a.ledger.push(m[0]);
        else if (declared.has(short)) a.declaredUnlogged.push(m[0]);
        else if (isGitObject(m[0])) a.gitObject.push(m[0]);
        else a.unknown.push(m[0]);
      }
    }
    artifacts.push(a);
  }
  const artifactDefects = artifacts.flatMap((a) => (a.exists ? a.unknown.map((id) => ({ file: a.file, id })) : [{ file: a.file, id: "(artifact file not found)" }]));
  // A prefix collision means short-id resolution is ambiguous → fail closed.
  const ok = parseErrors.length === 0 && newDefects.length === 0 && staleBaseline.length === 0 && prefixCollisions.length === 0 && unfulfilledStubs.length === 0 && malformedStubs.length === 0 && artifactDefects.length === 0;
  const excludedList = Object.entries(fieldsExcluded).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const result = { file, rows: rows.length, parseErrors, fieldsScanned, fieldsExcluded, refsChecked, prefixLen: PREFIX_LEN, prefixCollisions, baselined: baseline.length, newDefects, staleBaseline, declaredUnlogged, correctionNoteRefs, issuedStubs: stubs.length, unfulfilledStubs, malformedStubs, artifacts, artifactDefects, ceiling: "checks that every CITED id resolves and every ISSUED-STUB is fulfilled; a verdict that was never cited and never stubbed is OUTSIDE this instrument", ok };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`beta-ledger-refs: ${rows.length} rows, ${fieldsScanned} fields scanned (default-scan; excluded by name-property), ${refsChecked} refs checked, ${baseline.length} baselined historical holes, prefix ceiling ${PREFIX_LEN} hex (${prefixCollisions.length} collisions), ${stubs.length} issued-stubs (${unfulfilledStubs.length} unfulfilled)`);
    console.log(`  CEILING: this check proves that every CITED id resolves and every ISSUED-STUB is fulfilled. A verdict that was never cited and never stubbed is OUTSIDE this instrument — GREEN does not mean every ruling is in the record.`);
    console.log(`  BASELINE-KEYING CEILING: the baseline applies to the exact canonical path OR any file at a canonical-shaped path (…/.claude/agents/president/_system/beta/events.jsonl); a stray copy at that shape inherits the row-numbered baseline and may read STALE-BASELINE. Applied here: ${baselineFile ? "yes" : "no"} (target ${targetIsCanonical ? "canonical-shaped" : "non-canonical"}).`);
    console.log(`  excluded-by-property (${excludedList.length} field names; id-shaped tokens NOT checked, for audit): ${excludedList.map(([k, c]) => `${k}=${c}`).join(" ") || "(none)"}`);
    for (const p of parseErrors) console.log(`  PARSE-ERROR row ${p.row}: ${p.error}`);
    for (const s of unfulfilledStubs) console.log(`  UNFULFILLED-STUB row ${s.row}: ${s.id} issued to ${s.party || "?"} re ${s.boundary || "?"} — no verdict (or withdrawn) row carries this id`);
    for (const s of malformedStubs) console.log(`  MALFORMED-STUB row ${s.row}: ${s.id} — ${s.why}; a stub must be authoritative:false and carry no judgment`);
    if (artifacts.length) console.log(`  artifact-mode bucket order: ledger-row → declared-unlogged → git-object → UNKNOWN. GIT-OBJECT CEILING: an 8-hex token that is not a ledger row is resolved against the object database (git cat-file -e), so a prefix that coincidentally names a real object is absolved (≈1 in 50,000 per token in this repo; grows with repo size and token count). DATE CEILING (S-OS-06 r5): an 8-digit token is excluded only when it parses as a PLAUSIBLE calendar date (YYYYMMDD, year 2000-2099, valid month/day) — a row number or a commit prefix that merely happens to be digits-only is NOT waved through by shape alone; it is checked like any other token (against ledger rows, then the object database). ABSENCE DISCRIMINATOR: a missing LEDGER is absent BY DESIGN (gitignored; the falsifier's live case SKIPS visibly) — a missing ARTIFACT is absent UNEXPECTEDLY (committed; RED).`);
    for (const a of artifacts) {
      if (!a.exists) { console.log(`  ARTIFACT-MISSING ${a.file} — a presence-claim artifact is committed; its absence is a defect, not a skip`); continue; }
      console.log(`  artifact ${path.relative(repoRoot, a.file)}: ${a.tokens} id-shaped tokens → ledger-row ${a.ledger.length}, git-object ${a.gitObject.length}, declared-unlogged ${a.declaredUnlogged.length}, UNKNOWN ${a.unknown.length}`);
      for (const id of a.unknown) console.log(`  UNKNOWN-IN-ARTIFACT ${path.relative(repoRoot, a.file)}: ${id} — resolves to neither a ledger row nor a git object and is not declared UNLOGGED`);
    }
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
