#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "scan-coverage";

const SCAN_DIR = path.join(ROOT, ".claude", "commands", "scan");
const FULL_MD = path.join(SCAN_DIR, "full.md");
const ALLOWLIST = path.join(__dirname, "scan-coverage.allowlist.json");

function listScanSkills(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));
}

function parseFullRefs(md) {
  const set = new Set();
  for (const m of md.matchAll(/\/scan:([a-z0-9][a-z0-9-]*)/gi)) {
    set.add(m[1].toLowerCase());
  }
  return set;
}

function evaluate({ scanSkills, fullSelf, fullReferenced, exclusions }) {
  const findings = [];
  const skillSet = new Set(scanSkills);
  const excl = exclusions || {};
  const exclSet = new Set(Object.keys(excl));

  for (const s of scanSkills) {
    if (s === fullSelf) continue;
    if (fullReferenced.has(s)) continue;
    if (exclSet.has(s)) continue;
    findings.push({
      severity: "high",
      check: NAME,
      kind: "uncovered",
      message: `/scan:${s} exists but /scan:full does not delegate it and it is not on the exclusion allowlist`,
      file: `.claude/commands/scan/${s}.md`,
      suggestedFix: `Add /scan:${s} to /scan:full's tier list, OR add it to scan-coverage.allowlist.json with a reason.`,
    });
  }

  for (const r of fullReferenced) {
    if (r === fullSelf) continue;
    if (!skillSet.has(r)) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "dangling",
        message: `/scan:full references /scan:${r} but no .claude/commands/scan/${r}.md exists`,
        suggestedFix: `Remove the stale /scan:${r} reference from full.md, or restore the skill.`,
      });
    }
  }

  for (const [name, reason] of Object.entries(excl)) {
    if (!skillSet.has(name)) {
      findings.push({
        severity: "medium",
        check: NAME,
        kind: "stale-exclusion",
        message: `scan-coverage.allowlist.json excludes /scan:${name} but no such skill exists`,
        suggestedFix: `Remove the stale exclusion entry.`,
      });
    } else if (!reason || !String(reason).trim()) {
      findings.push({
        severity: "medium",
        check: NAME,
        kind: "reasonless-exclusion",
        message: `/scan:${name} is excluded from /scan:full without a reason`,
        suggestedFix: `Add a reason string explaining why it is intentionally not a /scan:full health input.`,
      });
    }
  }

  return findings;
}

function loadExclusions() {
  if (!fs.existsSync(ALLOWLIST)) return {};
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8").replace(/^﻿/, ""));
  const map = raw && raw.exclusions ? raw.exclusions : raw;
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (k.startsWith("_")) continue;
    out[k] = v;
  }
  return out;
}

function main() {
  const asJson = process.argv.includes("--json");
  let scanSkills, fullReferenced, exclusions;
  try {
    scanSkills = listScanSkills(SCAN_DIR);
    fullReferenced = parseFullRefs(fs.readFileSync(FULL_MD, "utf8"));
    exclusions = loadExclusions();
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: false, check: NAME, error: msg }) : `ERROR  ${NAME}: ${msg}`) + "\n",
    );
    process.exit(2);
  }

  const findings = evaluate({
    scanSkills,
    fullSelf: "full",
    fullReferenced,
    exclusions,
  });

  const delegated = [...fullReferenced].filter((r) => r !== "full").length;
  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: findings.length === 0,
          check: NAME,
          counts: { skills: scanSkills.length, delegated, excluded: Object.keys(exclusions).length },
          findings,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    for (const f of findings) {
      process.stdout.write(`${f.severity === "high" ? "FAIL" : "WARN"}  [${f.kind}] ${f.message}\n`);
    }
    process.stdout.write(
      `# scan-coverage: ${scanSkills.length} scans, ${delegated} delegated by /scan:full, ${Object.keys(exclusions).length} excluded — ${findings.length} finding(s)\n`,
    );
  }
  process.exit(findings.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { evaluate, parseFullRefs, listScanSkills };
