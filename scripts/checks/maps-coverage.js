#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "maps-coverage";

const MAPS_SKILL_DIR = path.join(ROOT, ".claude", "commands", "maps");
const MAPS_DATA_DIR = path.join(ROOT, ".claude", "project", "maps");
const ALL_MD = path.join(MAPS_SKILL_DIR, "all.md");
const ALLOWLIST = path.join(__dirname, "maps-coverage.allowlist.json");
const STALE_DAYS_DEFAULT = 7;

function listMapsSkills(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));
}

function parseAllRefs(md) {
  const set = new Set();
  for (const m of md.matchAll(/\/maps:([a-z0-9][a-z0-9-]*)/gi)) set.add(m[1].toLowerCase());
  return set;
}

function listMapFiles(dir) {
  let ents;
  try {
    ents = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return ents.filter((f) => !f.startsWith(".") && /\.(jsonl|md|json)$/.test(f));
}

function evaluate({ mapsSkills, allSelf, allReferenced, mapFiles, generators, allowlist, staleNames }) {
  const findings = [];
  const skillSet = new Set(mapsSkills);
  const excl = allowlist || {};
  const exclSet = new Set(Object.keys(excl));

  for (const s of mapsSkills) {
    if (s === allSelf) continue;
    if (allReferenced.has(s)) continue;
    if (exclSet.has(s)) continue;
    findings.push({
      severity: "high",
      check: NAME,
      kind: "unregistered-skill",
      message: `/maps:${s} exists but /maps:all does not reference it and it is not on the allowlist`,
      file: `.claude/commands/maps/${s}.md`,
      suggestedFix: `Add /maps:${s} to /maps:all's registry, OR add it to maps-coverage.allowlist.json with a reason.`,
    });
  }

  for (const r of allReferenced) {
    if (r === allSelf) continue;
    if (!skillSet.has(r)) {
      findings.push({
        severity: "high",
        check: NAME,
        kind: "dangling-registry",
        message: `/maps:all references /maps:${r} but no .claude/commands/maps/${r}.md exists`,
        suggestedFix: `Remove the stale /maps:${r} reference from all.md, or restore the skill.`,
      });
    }
  }

  for (const f of mapFiles) {
    const stem = f.split(".")[0].toLowerCase();
    if (generators.has(stem)) continue;
    if (exclSet.has(stem) || exclSet.has(f)) continue;
    findings.push({
      severity: "medium",
      check: NAME,
      kind: "orphan-map-file",
      message: `map file ${f} has no /maps:<x> generator and is not on the allowlist`,
      file: `.claude/project/maps/${f}`,
      suggestedFix: `Either add a /maps:${stem} generator, or allowlist "${stem}" in maps-coverage.allowlist.json with a reason (e.g. manual registry / inventory snapshot).`,
    });
  }

  for (const [name, reason] of Object.entries(excl)) {
    const known = skillSet.has(name) || mapFiles.some((f) => f.split(".")[0].toLowerCase() === name || f === name);
    if (!known) {
      findings.push({
        severity: "low",
        check: NAME,
        kind: "stale-exclusion",
        message: `maps-coverage.allowlist.json excludes "${name}" but no such skill or map file exists`,
        suggestedFix: `Remove the stale exclusion.`,
      });
    } else if (!reason || !String(reason).trim()) {
      findings.push({
        severity: "low",
        check: NAME,
        kind: "reasonless-exclusion",
        message: `"${name}" is excluded without a reason`,
        suggestedFix: `Add a reason string.`,
      });
    }
  }

  for (const s of staleNames || []) {
    findings.push({
      severity: "warn",
      check: NAME,
      kind: "stale-map",
      message: `generated map ${s} is stale (older than threshold)`,
      suggestedFix: `Refresh it: /maps:${s.split(".")[0]} --refresh (or /maps:all --regenerate).`,
    });
  }

  return findings;
}

function verdict({ findings, mapFiles }) {
  const blocking = (findings || []).filter((f) => f.severity !== "warn");
  if (blocking.length) return { code: 1, status: "findings", blocking };
  if (!mapFiles || mapFiles.length === 0) return { code: 3, status: "not-initialized", blocking };
  return { code: 0, status: "ok", blocking };
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST)) return {};
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8").replace(/^﻿/, ""));
  const map = raw && raw.exclusions ? raw.exclusions : raw;
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (k.startsWith("_")) continue;
    out[k.toLowerCase()] = v;
  }
  return out;
}

function main() {
  const asJson = process.argv.includes("--json");
  const sdIdx = process.argv.indexOf("--stale-days");
  const staleDays = sdIdx !== -1 ? Number(process.argv[sdIdx + 1]) : STALE_DAYS_DEFAULT;

  let mapsSkills, allReferenced, mapFiles, allowlist, staleNames;
  try {
    mapsSkills = listMapsSkills(MAPS_SKILL_DIR);
    allReferenced = parseAllRefs(fs.readFileSync(ALL_MD, "utf8"));
    mapFiles = listMapFiles(MAPS_DATA_DIR);
    allowlist = loadAllowlist();
    const cutoff = Date.now() - staleDays * 86400000;
    staleNames = mapFiles.filter((f) => {
      if (!/\.(jsonl|md)$/.test(f)) return false;
      try {
        return fs.statSync(path.join(MAPS_DATA_DIR, f)).mtimeMs < cutoff;
      } catch {
        return false;
      }
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: false, check: NAME, error: msg }) : `ERROR  ${NAME}: ${msg}`) + "\n",
    );
    process.exit(2);
  }

  const generators = new Set(mapsSkills.filter((s) => s !== "all" && s !== "coverage"));
  const findings = evaluate({
    mapsSkills,
    allSelf: "all",
    allReferenced,
    mapFiles,
    generators,
    allowlist,
    staleNames,
  });

  const v = verdict({ findings, mapFiles });
  const blocking = v.blocking;
  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: v.code === 0 ? true : v.code === 3 ? null : false,
          status: v.status,
          check: NAME,
          counts: { skills: mapsSkills.length, mapFiles: mapFiles.length, excluded: Object.keys(allowlist).length, stale: staleNames.length },
          findings,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    for (const f of findings) {
      const tag = f.severity === "warn" ? "WARN" : f.severity === "high" ? "FAIL" : "WARN";
      process.stdout.write(`${tag}  [${f.kind}] ${f.message}\n`);
    }
    process.stdout.write(
      `# maps-coverage: ${mapsSkills.length} skills, ${mapFiles.length} map files, ${Object.keys(allowlist).length} excluded, ${staleNames.length} stale — ${blocking.length} blocking finding(s)\n`,
    );
    if (v.code === 3) process.stdout.write(`NOT-INITIALIZED [${NAME}] no generated map file yet — run /maps:all --regenerate to create them; coverage is UNKNOWN until then\n`);
  }
  process.exit(v.code);
}

if (require.main === module) main();

module.exports = { evaluate, verdict, parseAllRefs, listMapsSkills };
