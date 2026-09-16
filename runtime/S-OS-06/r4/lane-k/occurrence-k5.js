#!/usr/bin/env node
"use strict";
/**
 * S-OS-06 r4 lane K5 — re-emit the lane K RESIDUE at OCCURRENCE grain (grain correction; re-adjudicates nothing
 * the standing record decided, measures nothing new, fixes nothing).
 *
 * Input: adjudication-k.out.json (standing RESIDUE + CANNOT_ASSESS + CI_UNRULED rows) and occurrence-k5.overlay.json
 * (per-line dispositions for occurrences the per-file row bundled, plus the five cannot-assess read individually).
 * Per occurrence, in order: (1) an R-sprint-body row takes the standing per-occurrence kind rule (abspath -> B,
 * schema-id -> the sprint's schemaSet, other -> otherSet), taken from the row's own occurrenceTally keys; (2) an
 * explicit row with liveLines puts occurrences on a live line in RESIDUE/<sub>, and every other occurrence takes the
 * overlay line decision or, failing that, CANNOT-ASSESS (never silently inherits); (3) an explicit row without
 * liveLines takes the overlay line decision if one exists, else RESIDUE/<sub>, with the matched token form emitted as
 * the homogeneity evidence. Name-only rows (0 content occurrences) emit one NAME occurrence, tallied separately.
 * Refuses (exit 2) when a scanned count differs from the standing row count, or when a tally fails to reconcile.
 * Usage: node occurrence-k5.js [--out occurrence-k5.out.json]
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const TOKEN = ["wa", "rp"].join("");
const refuse = (m) => { console.error(`occurrence-k5: REFUSED — ${m}`); process.exit(2); };
const std = JSON.parse(fs.readFileSync(path.join(__dirname, "adjudication-k.out.json"), "utf8"));
const ov = JSON.parse(fs.readFileSync(path.join(__dirname, "occurrence-k5.overlay.json"), "utf8"));
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();

function scan(rel) {
  const out = [];
  fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/).forEach((t, i) => {
    const re = new RegExp(TOKEN, "gi");
    let m;
    while ((m = re.exec(t)) !== null) {
      const before = t.slice(Math.max(0, m.index - 80), m.index);
      const abspath = /(^|[\s`'"(=:])([A-Za-z]:|\/[a-z])([\\/]{1,2}[^\s`'"\\/]+)*[\\/]{1,2}Projects[\\/]{1,2}$/.test(before);
      const schemaLine = /^\s*["']?(\$?schema)["']?\s*:\s*["']?$/.test(t.slice(0, m.index));
      let s = m.index, e = m.index + m[0].length;
      while (s > 0 && /[\w$./:@{}-]/.test(t[s - 1])) s--;
      while (e < t.length && /[\w$./:@{}-]/.test(t[e])) e++;
      out.push({ line: i + 1, col: m.index + 1, form: t.slice(s, e).replace(/[.:,]+$/, ""), kind: abspath ? "abspath" : schemaLine ? "schema-id" : "other" });
    }
  });
  return out;
}

const occ = [];
const push = (row, o, d, sub, w, extra) => occ.push({ file: row.file, line: o.line, col: o.col, form: o.form, kind: o.kind, standingRule: row.rule, standingFileSub: row.sub || null, disposition: d, sub: sub || null, warrant: w, ...(extra || {}) });
const residueRows = std.RESIDUE.map((r) => ({ ...r, origin: "RESIDUE" }));
for (const row of residueRows) {
  const found = scan(row.file);
  if (found.length !== row.occurrences) refuse(`${row.file}: scanned ${found.length} != standing ${row.occurrences} (tree moved; re-derive)`);
  if (found.length === 0) {
    occ.push({ file: row.file, line: null, col: null, form: path.basename(row.file), kind: "NAME", standingRule: row.rule, standingFileSub: row.sub, disposition: "RESIDUE", sub: row.sub, warrant: row.reason, nameOnly: true });
    continue;
  }
  const lineOv = ov.lines[row.file] || {};
  if (row.rule === "R-sprint-body") {
    const kindSet = {};
    for (const k of Object.keys(row.occurrenceTally)) { const [kind, set] = k.split(":"); kindSet[kind] = set; }
    for (const o of found) {
      const set = kindSet[o.kind];
      if (!set) refuse(`${row.file} L${o.line}: kind ${o.kind} absent from standing tally`);
      const w = o.kind === "abspath" ? "checkout directory name inside an absolute machine path records where the document lived (B whatever the sprint state)"
        : o.kind === "schema-id" ? `legacy schema id on a state-file schema line; sprint ${row.sprint} state '${row.sprintState}' -> ${set}`
        : `other occurrence takes sprint ${row.sprint} established state '${row.sprintState}' -> ${set}`;
      push(row, o, set, set === "RESIDUE" ? row.sub : set === "A" ? "sprint-state-instrument" : null, w, set === "A" ? { pin: "OWED" } : null);
    }
    continue;
  }
  for (const o of found) {
    const lo = lineOv[String(o.line)] || lineOv["*"];
    const live = Array.isArray(row.liveLines) && row.liveLines.includes(o.line);
    if (live) push(row, o, "RESIDUE", row.sub, `standing live line: ${row.reason}`);
    else if (lo) push(row, o, lo.d, lo.sub || (lo.d === "RESIDUE" ? row.sub : null), lo.w, lo.pin ? { pin: lo.pin } : null);
    else if (Array.isArray(row.liveLines)) push(row, o, "CANNOT-ASSESS", null, "non-live occurrence in a mixed file with no per-occurrence disposition");
    else push(row, o, "RESIDUE", row.sub, `homogeneous file (no liveLines partition; form '${o.form}'): ${row.reason}`);
  }
}
// the five standing CANNOT-ASSESS, read individually
const five = [];
for (const row of std.CANNOT_ASSESS) {
  const found = scan(row.file);
  const dec = ov.cannotAssessFive[row.file];
  if (!dec) refuse(`no individual reading for ${row.file}`);
  if (found.length !== 1 || found[0].line !== dec.line) refuse(`${row.file}: expected one occurrence at L${dec.line}, found ${JSON.stringify(found.map((f) => f.line))}`);
  five.push({ file: row.file, line: found[0].line, col: found[0].col, form: found[0].form, kind: found[0].kind, standing: "CANNOT-ASSESS", disposition: dec.d, sub: dec.sub || null, warrant: dec.w });
}
// the CI hit, once
const ci = std.CI_UNRULED.map((row) => ({ file: row.file, occurrences: scan(row.file).map((o) => ({ line: o.line, col: o.col, form: o.form })), disposition: "OPERATOR-GATED", countedOnce: true, sameOccurrenceAs: ["lane J (deferred)", "property D (resolved operator-gated)"] }));

const tally = (rows) => rows.reduce((a, x) => { const k = `${x.disposition}${x.sub ? "/" + x.sub : ""}`; a[k] = (a[k] || 0) + 1; return a; }, {});
const content = occ.filter((x) => !x.nameOnly);
const names = occ.filter((x) => x.nameOnly);
const stdOcc = std.RESIDUE.reduce((a, r) => a + r.occurrences, 0);
if (content.length !== stdOcc) refuse(`content occurrences ${content.length} != standing RESIDUE ${stdOcc}`);
const files = {};
for (const x of occ) { (files[x.file] = files[x.file] || new Set()).add(x.disposition); }
const mixed = Object.entries(files).filter(([, s]) => s.size > 1).map(([f, s]) => ({ file: f, dispositions: [...s].sort(), tally: tally(occ.filter((x) => x.file === f)) }));
const perFileNoResidue = Object.entries(files).filter(([, s]) => !s.has("RESIDUE")).map(([f]) => f);
const out = {
  $lane: "S-OS-06 r4 lane K5 — RESIDUE re-emitted at occurrence grain",
  beta: ov.beta, head, standingInstrumentHead: std.head,
  population: { standingResidueFiles: std.RESIDUE.length, standingResidueContentOccurrences: stdOcc, nameOnlyFiles: names.length },
  reconciliation: `content occurrences ${content.length} == standing RESIDUE ${stdOcc} [holds=true]`,
  tallyContent: tally(content), tallyNameOnly: tally(names),
  mixedFiles: mixed, filesLeavingResidue: perFileNoResidue,
  cannotAssessFive: five, tallyFive: tally(five),
  ci, removed: { files: 0, occurrences: 0, where: "lane K removed nothing; the round's entire REMOVED count sits in lane J, and neither lane's tally includes the other's" },
  occurrences: occ,
};
const oi = process.argv.indexOf("--out");
if (oi >= 0) fs.writeFileSync(path.resolve(process.argv[oi + 1]), JSON.stringify(out, null, 1) + "\n");
console.log(`head ${head} (standing instrument head ${std.head})`);
console.log(out.reconciliation);
console.log("content:", JSON.stringify(out.tallyContent));
console.log("nameOnly:", JSON.stringify(out.tallyNameOnly));
console.log("mixed files:", mixed.length, JSON.stringify(mixed.map((m) => `${m.file} ${JSON.stringify(m.tally)}`)));
console.log("files leaving RESIDUE entirely:", JSON.stringify(perFileNoResidue));
console.log("five:", JSON.stringify(out.tallyFive));
console.log("CANNOT-ASSESS in residue:", content.filter((x) => x.disposition === "CANNOT-ASSESS").length);
