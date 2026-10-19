#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

let registryLib;
try {
  registryLib = require("../guides/registry");
} catch (e) {
  console.error(`guides-coverage: cannot load registry lib: ${e.message}`);
  process.exit(2);
}
const { REPO_ROOT, loadGuides, validateGuideFrontmatter, buildRegistry, REGISTRY_FILE } =
  registryLib;

let PATHS;
try {
  PATHS = require("../hooks/lib/paths").PATHS;
} catch {
  PATHS = null;
}
const MAPS_DIR = PATHS && PATHS.maps ? PATHS.maps : path.join(REPO_ROOT, ".claude/project/maps");
const INTEGRATION_LOG = path.join(MAPS_DIR, "guide-integration.jsonl");
const BOOTSTRAP_DIR = path.join(REPO_ROOT, ".claude/commands/bootstrap");

const MARKER_RE = /<!--\s*guide-anchor:([A-Z0-9_]+)\s/g;

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        return { __parse_error: true, __line: i + 1 };
      }
    });
}

function collectMarkers() {
  const markers = [];
  if (!fs.existsSync(BOOTSTRAP_DIR)) return markers;
  for (const f of fs.readdirSync(BOOTSTRAP_DIR).filter((x) => x.endsWith(".md"))) {
    const content = fs.readFileSync(path.join(BOOTSTRAP_DIR, f), "utf8");
    let m;
    MARKER_RE.lastIndex = 0;
    while ((m = MARKER_RE.exec(content)) !== null) {
      markers.push({ guide: m[1], file: f });
    }
  }
  return markers;
}

function run() {
  const problems = [];
  const notes = [];

  let built;
  try {
    built = buildRegistry();
  } catch (e) {
    return { ok: false, problems: [`registry build failed: ${e.message}`], notes, fatal: true };
  }
  const onDisk = (() => {
    try {
      return fs.readFileSync(REGISTRY_FILE, "utf8");
    } catch {
      return null;
    }
  })();
  if (onDisk === null) {
    problems.push("INV-1: _guides/registry.json is missing — run /guides:organize.");
  } else if (onDisk !== JSON.stringify(built, null, 2) + "\n") {
    problems.push("INV-1: _guides/registry.json is STALE vs guide frontmatter — rebuild it.");
  }

  const guides = loadGuides();
  const anchored = [];
  for (const g of guides) {
    if (g.stem === "README") {
      if (g.frontmatter && g.frontmatter.anchor && g.frontmatter.anchor !== "none") {
        problems.push(`INV-2: README index should be anchor:none, found '${g.frontmatter.anchor}'`);
      }
      continue;
    }
    const probs = validateGuideFrontmatter(g);
    problems.push(...probs.map((p) => `INV-2: ${p}`));
    if (g.frontmatter && g.frontmatter.guide && g.frontmatter.anchor) {
      if (g.frontmatter.anchor !== "none") {
        anchored.push({
          guide: g.frontmatter.guide,
          anchor: g.frontmatter.anchor,
          shape: g.frontmatter.shape,
          file: g.file,
        });
      }
    }
  }

  const records = readJsonl(INTEGRATION_LOG);
  const parseErrs = records.filter((r) => r.__parse_error);
  for (const pe of parseErrs)
    problems.push(`INV-3: guide-integration.jsonl line ${pe.__line} is not valid JSON`);
  const active = records.filter((r) => !r.__parse_error && r.status === "active");
  const registryGuides = new Set(built.guides.map((g) => g.guide));

  const activeByGuide = new Map(active.map((r) => [r.guide, r]));
  for (const a of anchored) {
    if (!activeByGuide.has(a.guide)) {
      problems.push(
        `INV-3: guide '${a.guide}' is anchored (${a.anchor}) but has no active integration record — run /guides:integrate.`
      );
    }
  }

  const markers = collectMarkers();
  const markerGuides = new Set(markers.map((m) => m.guide));
  for (const r of active) {
    if (!registryGuides.has(r.guide)) {
      problems.push(`INV-5: integration record for '${r.guide}' has no matching guide in the registry (orphan record).`);
    }
    if (!markerGuides.has(r.guide)) {
      problems.push(
        `INV-4: record for '${r.guide}' claims integration but no guide-anchor marker is present in the bootstrap pipeline (phantom record).`
      );
    }
  }

  for (const m of markers) {
    if (!activeByGuide.has(m.guide)) {
      problems.push(`INV-6: guide-anchor marker for '${m.guide}' in ${m.file} has no active integration record (orphan marker).`);
    }
  }

  notes.push(
    `${guides.length} guide files · ${anchored.length} anchored · ${active.length} active integration record(s) · ${markers.length} pipeline marker(s)`
  );

  return { ok: problems.length === 0, problems, notes, fatal: false };
}

function main() {
  const jsonOut = process.argv.includes("--json");
  let res;
  try {
    res = run();
  } catch (e) {
    console.error(`guides-coverage: runner error (fail-closed): ${e.message}`);
    process.exit(2);
  }
  if (jsonOut) {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.fatal ? 2 : res.ok ? 0 : 1);
  }
  if (res.ok) {
    console.log(`PASS [guides-coverage] ${res.notes.join(" · ")}`);
    process.exit(0);
  }
  console.error(`FAIL [guides-coverage] ${res.problems.length} gap(s):`);
  for (const p of res.problems) console.error(`  - ${p}`);
  if (res.notes.length) console.error(`  (${res.notes.join(" · ")})`);
  process.exit(res.fatal ? 2 : 1);
}

if (require.main === module) main();

module.exports = { run, collectMarkers, INTEGRATION_LOG, BOOTSTRAP_DIR };
