#!/usr/bin/env node
"use strict";

/**
 * S-OS-06 r4 lane K — PROPERTY ADJUDICATION of the partition's allow-listed population (reads, fixes nothing).
 *
 * Applies STOP-CONDITION.md section 1 (property A = instrument, property B = record) to every allow-listed file the
 * inventory measured with an occurrence, and emits THREE SETS plus the named remainder:
 *   A        — rewriting the legacy literal would break the file's own function (verbatim AND test-pinned; pin recorded or OWED)
 *   B        — rewriting would falsify a record of something that happened (verbatim)
 *   RESIDUE  — neither property admits it: the FIX population (sub: fix | rename | fix+rename | compat-seam)
 *   CANNOT-ASSESS — not reached / not decidable inside the time box, named with its reason (never silently admitted)
 *   CI-UNRULED    — the continuous-integration hit, identified and NOT adjudicated (property D unruled)
 *
 * Decision order per file: (1) explicit per-file decision; (2) sprint-body rule (per-occurrence, keyed on the sprint's
 * established state); (3) prefix rules; (4) otherwise CANNOT-ASSESS "no decision" (the count proves coverage).
 * Partition class is never the test: every rule states the property reading it applies.
 *
 * Usage: node runtime/S-OS-06/r4/lane-k/adjudicate-k.js --inventory <inventory.json> --decisions <decisions.json>
 *                                                        [--out <adjudication.json>]
 * Refuses (exit 2) on an unreadable input, an inventory whose reconciliation does not hold, or a set tally that does
 * not reconcile to the inventory's withOccurrence count. Self-reference hygiene: the root token is assembled at runtime.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const TOKEN = ["wa", "rp"].join("");
const AT = String.fromCharCode(64);

function refuse(msg) {
  console.error(`adjudicate-k: REFUSED — ${msg}`);
  process.exit(2);
}
function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}
const argv = process.argv.slice(2);
const arg = (k) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : null);
const invPath = arg("--inventory");
const decPath = arg("--decisions");
if (!invPath || !decPath) refuse("--inventory and --decisions are required");
let inv;
let dec;
try {
  inv = JSON.parse(fs.readFileSync(path.resolve(invPath), "utf8"));
  dec = JSON.parse(fs.readFileSync(path.resolve(decPath), "utf8"));
} catch (e) {
  refuse(`unreadable input: ${e.message}`);
}
const pop = inv.population;
if (pop.allowListed !== pop.allowListedWithOccurrence + pop.allowListedNoOccurrence) refuse("inventory reconciliation does not hold");
const head = git(["rev-parse", "HEAD"]).stdout.trim();

// ---------- sprint registry state ----------
const registryText = fs.readFileSync(path.join(ROOT, ".claude/project/sprint/active-sprints.yaml"), "utf8");
const registry = {};
{
  let cur = null;
  for (const l of registryText.split(/\r?\n/)) {
    let m = l.match(/^\s+- id: *"?([^"\s]+)/);
    if (m) cur = m[1];
    m = l.match(/^\s+status: *([a-z_-]+)/);
    if (m && cur && !registry[cur]) registry[cur] = m[1];
  }
}
const SB = dec.sprintBody;
function sprintState(id) {
  if (SB.states[id]) return { ...SB.states[id], source: "evidence" };
  const st = registry[id];
  if (st && SB.registryTerminalStatuses.includes(st)) return { state: "terminal", otherSet: "B", schemaSet: "B", evidence: `registry status: ${st}`, source: "registry" };
  return { state: "unestablished", otherSet: "CANNOT-ASSESS", schemaSet: "CANNOT-ASSESS", evidence: `registry status: ${st || "unregistered"}; no execution evidence recorded`, source: "default" };
}

// ---------- per-occurrence scan (for rules that decide below file grain) ----------
function occurrences(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const out = [];
  text.split(/\r?\n/).forEach((t, i) => {
    const re = new RegExp(TOKEN, "gi");
    let m;
    while ((m = re.exec(t)) !== null) {
      const before = t.slice(Math.max(0, m.index - 80), m.index);
      const abspath = /(^|[\s`'"(=:])([A-Za-z]:|\/[a-z])([\\/]{1,2}[^\s`'"\\/]+)*[\\/]{1,2}Projects[\\/]{1,2}$/.test(before);
      const schemaLine = /^\s*["']?(\$?schema)["']?\s*:\s*["']?$/.test(t.slice(0, m.index));
      out.push({ line: i + 1, col: m.index + 1, abspath, schemaLine });
    }
  });
  return out;
}

const RANK = { RESIDUE: 4, "CANNOT-ASSESS": 3, A: 2, B: 1 };
const rows = [];
const invFiles = inv.files.filter((r) => r.occurrences > 0 || r.nameHit);
for (const r of invFiles) {
  const rel = r.file;
  const base = { file: rel, occurrences: r.occurrences, nameHit: r.nameHit, partitionEntry: r.entry };
  const d = dec.files[rel];
  if (d) {
    rows.push({ ...base, ...d, rule: "explicit" });
    continue;
  }
  const p = rel.split("/");
  if (rel.startsWith(".claude/project/sprint/")) {
    const sub = p[3];
    if (SB.recordSubdirs.includes(sub)) {
      rows.push({ ...base, set: "B", rule: "R-sprint-records", reason: SB.recordSubdirReason });
      continue;
    }
    if ((sub === "requirements" || sub === "sprints") && p.length > 5) {
      const id = p[4];
      const s = sprintState(id);
      const occ = occurrences(rel);
      const tally = {};
      let set = null;
      const liveLines = [];
      for (const o of occ) {
        const k = o.abspath ? "B" : o.schemaLine ? s.schemaSet : s.otherSet;
        const kind = o.abspath ? "abspath" : o.schemaLine ? "schema-id" : "other";
        tally[`${kind}:${k}`] = (tally[`${kind}:${k}`] || 0) + 1;
        if (k === "RESIDUE" && !liveLines.includes(o.line)) liveLines.push(o.line);
        if (!set || RANK[k] > RANK[set]) set = k;
      }
      if (!set) set = "B";
      const row = { ...base, set, rule: "R-sprint-body", sprint: id, sprintState: s.state, stateEvidence: s.evidence, occurrenceTally: tally };
      if (set === "RESIDUE") {
        row.sub = s.residueSub || "fix";
        row.liveLines = liveLines;
      }
      if (set === "A") row.pin = s.pin || "OWED";
      row.reason = s.reason || SB.ruleReason;
      if (occ.length !== r.occurrences) row.occurrenceCountMismatch = { scanned: occ.length, inventory: r.occurrences };
      rows.push(row);
      continue;
    }
  }
  const pr = dec.prefixRules.find((x) => (x.prefix ? rel.startsWith(x.prefix) : true) && (x.suffixRe ? new RegExp(x.suffixRe).test(rel) : true));
  if (pr) {
    const row = { ...base, set: pr.set, rule: pr.id, reason: pr.reason };
    if (pr.pin) row.pin = pr.pin;
    if (pr.section7b) row.section7b = true;
    if (pr.id === "R-release-capsule") {
      const relDir = p.slice(0, 3).join("/");
      let pinned = false;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(ROOT, relDir, "checksums.json"), "utf8"));
        pinned = p[3] === "checksums.json" ? "self (the pin file)" : Object.prototype.hasOwnProperty.call(c.entries || {}, p.slice(3).join("/"));
      } catch (e) {
        pinned = `unreadable checksums.json: ${e.message}`;
      }
      row.checksumPinned = pinned;
    }
    rows.push(row);
    continue;
  }
  rows.push({ ...base, set: "CANNOT-ASSESS", rule: "none", reason: "no decision reached this file" });
}

// ---------- tallies + reconciliation ----------
const sets = {};
for (const row of rows) {
  const k = row.set;
  if (!sets[k]) sets[k] = { files: 0, occurrences: 0, bySub: {} };
  sets[k].files += 1;
  sets[k].occurrences += row.occurrences;
  const s = row.sub || "-";
  sets[k].bySub[s] = sets[k].bySub[s] || { files: 0, occurrences: 0 };
  sets[k].bySub[s].files += 1;
  sets[k].bySub[s].occurrences += row.occurrences;
}
const tallyFiles = Object.values(sets).reduce((a, v) => a + v.files, 0);
const tallyOcc = Object.values(sets).reduce((a, v) => a + v.occurrences, 0);
const invOcc = invFiles.reduce((a, r) => a + r.occurrences, 0);
if (tallyFiles !== pop.allowListedWithOccurrence) refuse(`set tally ${tallyFiles} files != inventory withOccurrence ${pop.allowListedWithOccurrence}`);
if (tallyOcc !== invOcc) refuse(`set tally ${tallyOcc} occurrences != inventory ${invOcc}`);

// ---------- regression-directory breakdown (ALL tracked files, emitted before any admission is read) ----------
const REG = "tests/regression/S-OS-06/";
const regTracked = git(["ls-files", REG]).stdout.split(/\r?\n/).filter(Boolean);
const regressionBreakdown = regTracked.map((f) => {
  const row = rows.find((x) => x.file === f);
  if (!row) return { file: f, occurrences: 0, set: "NO-OCCURRENCE", reason: "no legacy literal in content or name: nothing to admit, nothing to fix" };
  return { file: f, occurrences: row.occurrences, nameHit: row.nameHit, guard: row.guard, set: row.set, sub: row.sub, reason: row.reason, pin: row.pin };
});

// ---------- directory-name occurrences (the inventory's nameHit reads basenames only) ----------
const loader = require(path.join(ROOT, "scripts", "open-source", "partition-loader.js"));
const partition = loader.loadPartition({ forceReload: true });
const dirs = {};
for (const f of git(["ls-files", "-z"]).stdout.split(String.fromCharCode(0)).filter(Boolean)) {
  const segs = f.split("/").slice(0, -1);
  for (let i = 0; i < segs.length; i++) {
    if (!new RegExp(TOKEN, "i").test(segs[i])) continue;
    const dir = segs.slice(0, i + 1).join("/");
    const pc = partition.classifyPath(f);
    if (!pc || pc.class === 1) continue;
    if (!dirs[dir]) dirs[dir] = { trackedAllowListedFiles: 0 };
    dirs[dir].trackedAllowListedFiles += 1;
  }
}
const dirNames = Object.entries(dirs).map(([dir, v]) => ({ dir, ...v, ...(dec.dirNames[dir] || { set: "CANNOT-ASSESS", reason: "no decision for this directory name" }) }));

// ---------- authored members (lane G handoff) — position re-verified at this head ----------
const authored = dec.authored21.map((a) => {
  let verified;
  try {
    const t = fs.readFileSync(path.join(ROOT, a.file), "utf8").split(/\r?\n/)[a.line - 1] || "";
    verified = t.substr(a.col - 1, 3) === `mc${AT}`;
  } catch (e) {
    verified = `unreadable: ${e.message}`;
  }
  return { ...a, currentLabTokenAtPositionVerified: verified };
});
const authoredTally = {};
for (const a of authored) authoredTally[a.set] = (authoredTally[a.set] || 0) + 1;

// ---------- section 7b: the round's own measurement artifacts inside the swept population ----------
const r4 = rows.filter((x) => x.file.startsWith("runtime/S-OS-06/r4/"));
const laneK = r4.filter((x) => x.file.startsWith("runtime/S-OS-06/r4/lane-k/"));
const section7b = {
  statement: "the round's own measurement artifacts under runtime/S-OS-06/r4/** are INSIDE the swept population and adjudicated as records; they are not excluded by path",
  r4: { files: r4.length, occurrences: r4.reduce((a, x) => a + x.occurrences, 0) },
  laneK: { files: laneK.length, occurrences: laneK.reduce((a, x) => a + x.occurrences, 0), members: laneK.map((x) => `${x.file} (${x.occurrences})`) },
};

const pick = (k) => rows.filter((x) => x.set === k).sort((a, b) => a.file.localeCompare(b.file));
const out = {
  $lane: "S-OS-06 r4 lane K — property adjudication (A instrument / B record / RESIDUE fix population)",
  head,
  inventoryHead: inv.head,
  spec: "runtime/S-OS-06/r4/STOP-CONDITION.md section 1 (properties A and B, the regression guard, reconciliation) + section 7b",
  population: pop,
  reconciliation: `adjudicated files ${tallyFiles} == inventory withOccurrence ${pop.allowListedWithOccurrence}; occurrences ${tallyOcc} == ${invOcc} [holds=true]`,
  removed: dec.removed,
  counts: sets,
  regressionBreakdown,
  A: pick("A"),
  B: pick("B"),
  RESIDUE: pick("RESIDUE"),
  CANNOT_ASSESS: pick("CANNOT-ASSESS"),
  CI_UNRULED: pick("CI-UNRULED"),
  dirNames,
  authored21: { source: "runtime/S-OS-06/r4/join-authored-for-K.json", tally: authoredTally, members: authored },
  heldReferral: dec.heldReferral,
  sprintBody: { registryTerminalStatuses: SB.registryTerminalStatuses, recordSubdirs: SB.recordSubdirs, states: SB.states, ruleReason: SB.ruleReason },
  prefixRules: dec.prefixRules,
  section7b,
};
const outPath = arg("--out");
if (outPath) fs.writeFileSync(path.resolve(outPath), JSON.stringify(out, null, 1) + "\n");
console.log(`head ${head} (inventory measured at ${inv.head})`);
console.log(out.reconciliation);
for (const [k, v] of Object.entries(sets)) console.log(`${k.padEnd(14)} files ${String(v.files).padStart(5)}  occ ${String(v.occurrences).padStart(6)}  ${JSON.stringify(v.bySub)}`);
console.log(`regression dir: ${regressionBreakdown.length} tracked; ${JSON.stringify(regressionBreakdown.reduce((a, x) => ((a[x.set] = (a[x.set] || 0) + 1), a), {}))}`);
console.log(`authored21: ${JSON.stringify(authoredTally)}; positions verified ${authored.filter((a) => a.currentLabTokenAtPositionVerified === true).length}/${authored.length}`);
console.log(`dirNames: ${dirNames.map((d) => `${d.dir}=${d.set}`).join(", ")}`);
console.log(`section7b: r4 ${JSON.stringify(section7b.r4)} laneK ${JSON.stringify({ files: section7b.laneK.files, occurrences: section7b.laneK.occurrences })}`);
