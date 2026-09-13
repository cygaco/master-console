#!/usr/bin/env node
"use strict";

/**
 * /scan:scan-coverage — the scan suite's SELF-INVENTORY enforcer (SP-20260531-004).
 *
 * The /scan:* suite grew one-enforcer-per-sprint to 40+ skills. /scan:full is a
 * HAND-MAINTAINED tier list that silently drifts from the actual scan/ directory:
 * full.md ITSELF documents the failure mode — mc-ship-coverage existed + passed
 * but was never delegated by /scan:full ("the enforcer exists but isn't on the path").
 * Nothing asserted dir <-> aggregator parity. This is that enforcer — the suite
 * scanning itself.
 *
 * REJECTS (exit 1) on any finding:
 *   1. UNCOVERED   — a /scan:<x> skill exists but /scan:full neither delegates it
 *                    NOR is it on the explicit exclusion allowlist (with a reason).
 *   2. DANGLING    — /scan:full references /scan:<x> but no skill file exists.
 *   3. STALE-EXCL  — the allowlist excludes a /scan:<x> that no longer exists.
 *   4. REASONLESS  — an exclusion carries no reason (silent exclusion = future drift).
 * Internal/setup error => exit 2 (fail-closed: a self-inventory that errors must
 * never read green — the false-green lesson).
 *
 * Pure core = evaluate({ scanSkills, fullSelf, fullReferenced, exclusions }) with
 * injected seams, so the bite-test (scan-coverage.test.js) proves each class without
 * touching disk. Mirrors role-parity-scan.js.
 *
 *   node scripts/checks/scan-coverage.js [--json]
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "scan-coverage";

const SCAN_DIR = path.join(ROOT, ".claude", "commands", "scan");
const FULL_MD = path.join(SCAN_DIR, "full.md");
const ALLOWLIST = path.join(__dirname, "scan-coverage.allowlist.json");

// Scan skills = basenames (sans .md) of every file in .claude/commands/scan/.
function listScanSkills(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));
}

// Every /scan:<x> token referenced anywhere in full.md (table cells, lists, prose).
// Coarse-by-design: if full.md mentions a scan at all, it's "on the path".
function parseFullRefs(md) {
  const set = new Set();
  for (const m of md.matchAll(/\/scan:([a-z0-9][a-z0-9-]*)/gi)) {
    set.add(m[1].toLowerCase());
  }
  return set;
}

/**
 * Pure assertion core. Returns findings[] (empty = suite is self-consistent).
 * @param scanSkills      string[] of scan skill basenames (incl. "full")
 * @param fullSelf        the aggregator's own name ("full") — never needs delegating
 * @param fullReferenced  Set<string> of /scan:<x> names referenced by full.md
 * @param exclusions      { [name]: reason } intentionally-not-in-full allowlist
 */
function evaluate({ scanSkills, fullSelf, fullReferenced, exclusions }) {
  const findings = [];
  const skillSet = new Set(scanSkills);
  const excl = exclusions || {};
  const exclSet = new Set(Object.keys(excl));

  // 1. UNCOVERED — every skill (except the aggregator) is delegated or excluded.
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

  // 2. DANGLING — full.md references a scan with no skill file.
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

  // 3/4. Allowlist hygiene — exclusions must name a real skill AND carry a reason.
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
  // Accept { exclusions: {...} } (preferred) or a flat { name: reason } map.
  const map = raw && raw.exclusions ? raw.exclusions : raw;
  // Drop comment-ish keys.
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
    process.exit(2); // fail-closed
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
