#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { cleanSource, runAudit } = require("./gate-failclosed-audit.js");

const DEFAULT_REGISTRY = path.join(__dirname, "gate-failclosed-registry.json");
const DEFAULT_BASELINE = path.join(__dirname, "gate-failclosed-baseline.json");

function loadJson(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function loadRegistry(registryPath) {
  const data = loadJson(registryPath);
  if (!Array.isArray(data.rows)) {
    throw new Error("registry malformed: .rows is not an array — " + registryPath);
  }
  for (const row of data.rows) {
    if (row.polarity_provenance !== "manual-by-read" && row.polarity_provenance !== "tool-derived") {
      throw new Error(
        "registry row " + row.site_id + " has missing/blended polarity_provenance: " +
          JSON.stringify(row.polarity_provenance),
      );
    }
    if (row.polarity_provenance === "manual-by-read" && !row.decision_semantics_quote) {
      throw new Error(
        "registry row " + row.site_id + " is manual-by-read but carries no decision_semantics_quote",
      );
    }
  }
  return data;
}

function loadBaseline(baselinePath) {
  const data = loadJson(baselinePath);
  if (!Array.isArray(data.site_ids)) {
    throw new Error("baseline malformed: .site_ids is not an array — " + baselinePath);
  }
  return data;
}

const WINDOW_LINES = 12;
const PERMISSIVE_EXIT_RE = /process\s*\.\s*exit\s*\(\s*0\s*\)/;
const PERMISSIVE_OK_RE = /\bok\b\s*:\s*true\b/;

function siteStillPermissive(baseDir, row) {
  const fullPath = path.join(baseDir, row.file);
  let content;
  try {
    content = fs.readFileSync(fullPath, "utf8");
  } catch (e) {
    return { checked: false, permissive: null, reason: "file-unreadable: " + (e.code || e.message) };
  }
  const lines = content.split(/\r?\n/);
  const startIdx = Math.max(0, row.line - 1);
  const windowSrc = lines.slice(startIdx, startIdx + WINDOW_LINES).join("\n");
  const clean = cleanSource(windowSrc);
  const permissive = PERMISSIVE_EXIT_RE.test(clean) || PERMISSIVE_OK_RE.test(clean);
  return { checked: true, permissive, reason: null };
}

function checkRegistryRegressions(registryRows, baseDir) {
  const regressed = [];
  const checkedRepaired = [];
  for (const row of registryRows) {
    if (row.expected_finding !== "absent") continue;
    const result = siteStillPermissive(baseDir, row);
    checkedRepaired.push({ site_id: row.site_id, ...result });
    if (result.checked && result.permissive) {
      regressed.push({ site_id: row.site_id, file: row.file, line: row.line, reason: "still permissive-shaped despite expected_finding=absent" });
    }
  }
  return { regressed, checkedRepaired };
}

const PLANTED_SAMPLES_DIR = path.join(__dirname, "fixtures", "gate-failclosed");

function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

function toSlash(p) {
  return p.split(path.sep).join("/");
}

function checkNewEntrants(root, baselineSiteIdSet, excludedDirs = [PLANTED_SAMPLES_DIR]) {
  const { report } = runAudit(root);
  const rootAbs = path.resolve(root);
  const activeExcludes = excludedDirs.map((d) => path.resolve(d)).filter((d) => !isWithin(rootAbs, d));
  const currentSiteIds = [];
  const excludedSiteIds = [];
  for (const f of report.findings) {
    const id = toSlash(f.file) + ":" + f.line;
    if (activeExcludes.some((d) => isWithin(path.resolve(f.file), d))) excludedSiteIds.push(id);
    else currentSiteIds.push(id);
  }
  const currentSet = new Set(currentSiteIds);
  const newEntrants = currentSiteIds.filter((id) => !baselineSiteIdSet.has(id));
  return {
    report,
    currentSet,
    currentSiteIds,
    newEntrants,
    excludedSiteIds,
    excludedDirs: activeExcludes.map((d) => toSlash(path.relative(process.cwd(), d))),
  };
}

function citeProblem(fullPath, line, cache) {
  if (!Number.isInteger(line) || line < 1) {
    return { reason: "bad-line", detail: "cited line " + JSON.stringify(line) + " is not a positive integer" };
  }
  let info = cache.get(fullPath);
  if (!info) {
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      const raw = content.split(/\r?\n/);
      const count = content === "" ? 0 : content.endsWith("\n") ? raw.length - 1 : raw.length;
      info = { raw, clean: cleanSource(content).split(/\r?\n/), count };
    } catch (e) {
      info = { error: e.code || e.message };
    }
    cache.set(fullPath, info);
  }
  if (info.error) return { reason: "file-unreadable", detail: "file unreadable: " + info.error };
  if (line > info.count) {
    return { reason: "past-eof", detail: "line " + line + " is past the end of the file (" + info.count + " lines)" };
  }
  if (info.raw[line - 1].trim() === "") return { reason: "blank", detail: "line " + line + " is blank" };
  if (info.clean[line - 1].trim() === "") {
    return { reason: "no-code", detail: "line " + line + " holds only comment or literal text, no code" };
  }
  return null;
}

function checkStaleCites(baselineSiteIds, registryRows, baseDir) {
  const cache = new Map();
  const stale = [];
  for (const id of baselineSiteIds) {
    const i = id.lastIndexOf(":");
    const file = i === -1 ? id : id.slice(0, i);
    const line = i === -1 ? null : Number(id.slice(i + 1));
    const p = citeProblem(path.resolve(file), line, cache);
    if (p) stale.push({ ledger: "baseline", entry: id, field: "site_ids", file, line, reason: p.reason, detail: p.detail });
  }
  for (const row of registryRows) {
    const fullPath = path.join(baseDir, row.file);
    for (const field of ["line", "tool_finding_line"]) {
      if (field === "tool_finding_line" && row[field] == null) continue;
      const p = citeProblem(fullPath, row[field], cache);
      if (p) {
        stale.push({ ledger: "registry", entry: row.site_id, field, file: row.file, line: row[field], reason: p.reason, detail: p.detail });
      }
    }
  }
  return stale;
}

function computeCoverage(registryRows, baseline) {
  const baselineSet = new Set(baseline.site_ids);
  const enforcedDispositions = new Set(["defect", "contested"]);
  const triagedNonEnforcedDispositions = new Set(["not-a-defect", "not-a-gate"]);

  const backedIds = new Set();
  const enforcedIds = new Set();
  const triagedNotEnforcedIds = new Set();

  for (const row of registryRows) {
    if (!row.tool_correlated || row.tool_finding_line == null) continue;
    const toolSiteId = row.file + ":" + row.tool_finding_line;
    if (!baselineSet.has(toolSiteId)) continue;
    backedIds.add(toolSiteId);
    if (enforcedDispositions.has(row.disposition)) enforcedIds.add(toolSiteId);
    else if (triagedNonEnforcedDispositions.has(row.disposition)) triagedNotEnforcedIds.add(toolSiteId);
  }

  const M = baseline.site_ids.length;
  const N = enforcedIds.size;
  const triagedNotEnforced = triagedNotEnforcedIds.size;
  const K = M - backedIds.size;
  const uncorrelatedRegistryDefects = registryRows.filter(
    (r) => (r.disposition === "defect" || r.disposition === "contested") && !r.tool_correlated,
  ).length;

  return {
    detector_sha: baseline.detector_sha,
    M,
    N,
    triaged_not_enforced: triagedNotEnforced,
    K,
    uncorrelated_registry_defects: uncorrelatedRegistryDefects,
    phrasing:
      N + " of the " + M + " baseline sites are under enforcement, " + K + " untriaged" +
      " (" + triagedNotEnforced + " further baseline site(s) are triaged non-enforced [not-a-defect/not-a-gate]; " +
      uncorrelatedRegistryDefects + " registry defect row(s) have no live-detector counterpart at this sha)." +
      " The baseline's original sites were captured by the detector at " + baseline.detector_sha + ".",
  };
}

function runEnforcer({ root, registryPath, baselinePath, baseDir }) {
  root = root || "scripts";
  registryPath = registryPath || DEFAULT_REGISTRY;
  baselinePath = baselinePath || DEFAULT_BASELINE;
  baseDir = baseDir || process.cwd();

  const registry = loadRegistry(registryPath);
  const baseline = loadBaseline(baselinePath);
  const baselineSet = new Set(baseline.site_ids);

  const { report: liveReport, newEntrants, excludedSiteIds, excludedDirs } = checkNewEntrants(root, baselineSet);
  const { regressed, checkedRepaired } = checkRegistryRegressions(registry.rows, baseDir);
  const staleCites = checkStaleCites(baseline.site_ids, registry.rows, baseDir);
  const coverage = computeCoverage(registry.rows, baseline);

  const ok = regressed.length === 0 && newEntrants.length === 0 && staleCites.length === 0;

  const result = {
    status: ok ? "ok" : "blocked",
    exitCode: ok ? 0 : 1,
    coverage,
    regressed,
    stale_cites: staleCites,
    checked_repaired_count: checkedRepaired.length,
    new_entrants: newEntrants,
    live_excluded_dirs: excludedDirs,
    live_excluded_sites: excludedSiteIds,
    live_files_scanned: liveReport.files_scanned,
    live_files_unreadable: liveReport.files_unreadable,
    live_detector_sha: liveReport.detector_sha,
    baseline_detector_sha: baseline.detector_sha,
    baseline_site_count: baseline.site_ids.length,
    registry_row_count: registry.rows.length,
  };
  return result;
}

function main() {
  const args = process.argv.slice(2);
  function flag(name, def) {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  }
  const root = flag("--root", "scripts");
  const registryPath = flag("--registry", DEFAULT_REGISTRY);
  const baselinePath = flag("--baseline", DEFAULT_BASELINE);
  const baseDir = flag("--base-dir", process.cwd());

  const result = runEnforcer({ root, registryPath, baselinePath, baseDir });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  loadRegistry,
  loadBaseline,
  siteStillPermissive,
  checkRegistryRegressions,
  checkNewEntrants,
  checkStaleCites,
  computeCoverage,
  runEnforcer,
  WINDOW_LINES,
  PLANTED_SAMPLES_DIR,
};
