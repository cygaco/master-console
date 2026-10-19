#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const EPICS_DIR = path.join(REPO, "trackers", "epics");

const LEGEND =
  /(Verified Exists[^\n]*Verified Nonexistent|Allowed states|states:\s*`?Verified)/i;
const SCRIPT_RE = /(scripts\/[A-Za-z0-9_.\/-]+\.(?:js|cjs|mjs))/g;
const BACKTICK_PATH_RE = /`([A-Za-z0-9_][A-Za-z0-9_.\/-]*\.(?:js|cjs|mjs|json))`/g;

function existsRel(rel) {
  try {
    return fs.existsSync(path.join(REPO, rel));
  } catch {
    return false;
  }
}

function historyStart(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,3}\s+(Session log|Change log)\b/i.test(lines[i])) return i;
  }
  return lines.length;
}

function scanFile(file, txt) {
  const findings = [];
  const lines = txt.split(/\r?\n/);
  const end = historyStart(lines);
  for (let i = 0; i < end; i++) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) continue;
    if (LEGEND.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (!cells.some((c) => /^missing but required$/i.test(c))) continue;
    const paths = new Set();
    let m;
    SCRIPT_RE.lastIndex = 0;
    while ((m = SCRIPT_RE.exec(line))) paths.add(m[1]);
    BACKTICK_PATH_RE.lastIndex = 0;
    while ((m = BACKTICK_PATH_RE.exec(line))) paths.add(m[1]);
    for (const p of paths) {
      if (existsRel(p)) {
        findings.push({ file, line: i + 1, artifact: p, snippet: line.trim().slice(0, 130) });
      }
    }
  }
  return findings;
}

function scan(opts) {
  const o = opts || {};
  const dir = o.epicsDir || EPICS_DIR;
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch (e) {
    return { error: `cannot read epics dir ${dir}: ${e.message}` };
  }
  const findings = [];
  for (const f of files) {
    let txt;
    try {
      txt = fs.readFileSync(path.join(dir, f), "utf8");
    } catch (e) {
      return { error: `cannot read ${f}: ${e.message}` };
    }
    findings.push(...scanFile(f, txt));
  }
  return { findings, fileCount: files.length };
}

if (require.main === module) {
  const enforce = process.argv.includes("--enforce");
  let r;
  try {
    r = scan();
  } catch (e) {
    process.stderr.write(`[tracker-reality-drift] internal error (fail-closed): ${e && e.message}\n`);
    process.exit(2);
  }
  if (r.error) {
    process.stderr.write(`[tracker-reality-drift] FAIL-CLOSED: ${r.error}\n`);
    process.exit(2);
  }
  const n = r.findings.length;
  if (n === 0) {
    process.stdout.write(
      `OK   [tracker-reality-drift] ${r.fileCount} epic tracker(s); 0 stale-claimed-missing findings (no current-state line claims missing/unbuilt while naming an artifact that exists)\n`,
    );
    process.exit(0);
  }
  process.stdout.write(
    `${enforce ? "FAIL" : "WARN"} [tracker-reality-drift] ${n} current-state line(s) CLAIM missing/unbuilt but NAME an artifact that EXISTS on disk (stale-claimed-done — verify-don't-inherit):\n`,
  );
  for (const f of r.findings.slice(0, 40)) {
    process.stdout.write(`  ${f.file}:${f.line} — names ${f.artifact} (EXISTS) — "${f.snippet}"\n`);
  }
  if (n > 40) process.stdout.write(`  … and ${n - 40} more\n`);
  process.stdout.write(
    `Fix: reconcile the tracker line to reality (the artifact exists), or — if genuinely a different/unbuilt artifact — rename the reference. ${enforce ? "" : "(report-only — pass --enforce to block)"}\n`,
  );
  process.exit(enforce && n > 0 ? 1 : 0);
}

module.exports = { scan, scanFile, historyStart };
