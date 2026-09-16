#!/usr/bin/env node
"use strict";
// S-OS-06 r4 lane K5: render the occurrence-grain appendix (mixed files occurrence by occurrence; homogeneous files with every line:col) from occurrence-k5.out.json.
const fs = require("fs");
const path = require("path");
const o = JSON.parse(fs.readFileSync(path.join(__dirname, "occurrence-k5.out.json"), "utf8"));
const L = [];
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/`/g, "");
const mixed = new Set(o.mixedFiles.map((m) => m.file));
L.push(`## Appendix A1. Mixed files, occurrence by occurrence (${o.mixedFiles.length} files)`, "");
for (const m of o.mixedFiles) {
  L.push(`### \`${m.file}\`, ${JSON.stringify(m.tally)}`, "", "| Line:col | Form | Disposition | Warrant |", "|---|---|---|---|");
  for (const x of o.occurrences.filter((y) => y.file === m.file)) {
    L.push(`| L${x.line}:${x.col} | ${esc(x.form).slice(0, 60)} | ${x.disposition}${x.sub ? "/" + x.sub : ""}${x.pin ? " (pin: " + esc(x.pin) + ")" : ""} | ${esc(x.warrant).slice(0, 280)} |`);
  }
  L.push("");
}
const by = {};
for (const x of o.occurrences) if (!mixed.has(x.file)) (by[x.file] = by[x.file] || []).push(x);
L.push(`## Appendix A2. Homogeneous files: every occurrence carries the single disposition shown (${Object.keys(by).length} files)`, "");
L.push("Every occurrence is listed as line:col, so a reader can check the homogeneity claim against the tree. A name-only row stands for the file's basename (0 content occurrences).", "");
L.push("| File | Disposition | Occ | Occurrences (line:col) |", "|---|---|---:|---|");
for (const [f, xs] of Object.entries(by).sort()) {
  const d = [...new Set(xs.map((x) => x.disposition + (x.sub ? "/" + x.sub : "")))].join(",");
  L.push(`| \`${f}\` | ${d} | ${xs[0].nameOnly ? "0 (NAME)" : xs.length} | ${xs[0].nameOnly ? "basename" : xs.map((x) => x.line + ":" + x.col).join(" ")} |`);
}
fs.writeFileSync(path.join(__dirname, "LANE-K5-APPENDIX.md"), L.join("\n") + "\n");
console.log(`appendix lines ${L.length}; mixed ${o.mixedFiles.length}; homogeneous ${Object.keys(by).length}`);
