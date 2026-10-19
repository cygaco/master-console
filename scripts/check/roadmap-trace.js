#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const { readYamlMaybe } = require("../sprint/fs");

const asJson = process.argv.includes("--json");
const regPath = path.join(
  REPO_ROOT,
  ".claude",
  "project",
  "sprint",
  "active-sprints.yaml",
);
const roadmapPath = path.join(REPO_ROOT, "ROADMAP.md");

const TRACKED = new Set(["done", "retrospected", "released"]);

function emitPass(note) {
  if (asJson)
    process.stdout.write(JSON.stringify({ ok: true, checks: [], note }) + "\n");
  else process.stdout.write(`# 0/0 traced (${note})\n`);
  process.exit(0);
}

const reg = readYamlMaybe(regPath);
if (!reg || !Array.isArray(reg.sprints)) emitPass("no sprint registry");

if (!fs.existsSync(roadmapPath)) {
  const note = "ROADMAP.md absent — roadmap trace skipped (warn, not fail)";
  if (asJson)
    process.stdout.write(
      JSON.stringify({ ok: true, warned: true, reason: note }) + "\n",
    );
  else process.stdout.write(`WARN  ${note}\n# 0/0 traced\n`);
  process.exit(0);
}

const roadmap = fs.readFileSync(roadmapPath, "utf8");

function shippedRegion(md) {
  const lines = md.split(/\r?\n/);
  const regions = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+.*shipped/i.exec(lines[i]);
    if (!m) continue;
    const level = m[1].length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const mm = /^(#{1,6})\s+/.exec(lines[j]);
      if (mm && mm[1].length <= level) {
        end = j;
        break;
      }
    }
    regions.push(lines.slice(i, end).join("\n"));
  }
  return regions.join("\n");
}

const shipped = shippedRegion(roadmap);
const targets = reg.sprints.filter((s) => TRACKED.has(s.status));
const checks = targets.map((s) => {
  const hasLedgerRow = roadmap.includes(s.id);
  const hasNarrative =
    shipped.includes(s.id) || (s.title && shipped.includes(s.title));
  return {
    id: s.id,
    status: s.status,
    ok: hasLedgerRow && hasNarrative,
    hasLedgerRow,
    hasNarrative,
  };
});

const failed = checks.filter((c) => !c.ok);
if (asJson) {
  process.stdout.write(
    JSON.stringify({ ok: failed.length === 0, checks }, null, 2) + "\n",
  );
} else {
  for (const c of checks) {
    const detail = c.ok
      ? ""
      : `  (ledger_row=${c.hasLedgerRow} shipped_narrative=${c.hasNarrative})`;
    process.stdout.write(`${c.ok ? "OK  " : "FAIL"}  ${c.id} (${c.status})${detail}\n`);
  }
  process.stdout.write(
    `# ${checks.length - failed.length}/${checks.length} sprints traced\n`,
  );
}
process.exit(failed.length ? 1 : 0);
