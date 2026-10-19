#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

let registryLib;
try {
  registryLib = require("../knowledge/registry");
} catch (e) {
  console.error(`knowledge-coverage: cannot load registry lib: ${e.message}`);
  process.exit(2);
}
const { REPO_ROOT, REGISTRY_FILE, buildRegistry } = registryLib;

let PATHS;
try {
  PATHS = require("../hooks/lib/paths").PATHS;
} catch {
  PATHS = null;
}
const MAPS_DIR =
  PATHS && PATHS.maps ? PATHS.maps : path.join(REPO_ROOT, ".claude/project/maps");
const INTEGRATION_LOG = path.join(MAPS_DIR, "knowledge-integration.jsonl");
const AGENTS_DIR = path.join(REPO_ROOT, ".claude/agents");
const ROLE_REGISTRY_FILE = path.join(
  REPO_ROOT,
  ".claude/agents/_org/role-registry.json"
);

const OPEN_MARKER_RE = /<!--\s+knowledge:([a-z][a-z-]*)\s+role:([a-z][a-z-]*)\b/g;

const normPath = (p) => (p || "").replace(/\\/g, "/");
const markerKey = (domain, role) => `${domain}::${role}`;

function evaluate({ domains, active, markers, roleSpecs }) {
  const problems = [];
  const domainByName = new Map(domains.map((d) => [d.domain, d]));
  const markerSet = new Set(markers.map((m) => markerKey(m.domain, m.role)));
  const activeKey = new Set(active.map((r) => markerKey(r.domain, r.role)));

  // INV-3: library consumers wired (active record + live marker in their OWN spec).
  for (const d of domains) {
    if (d.kind !== "library") continue;
    for (const role of d.consumers) {
      const hasRecord = active.some((r) => r.domain === d.domain && r.role === role);
      if (!hasRecord) {
        problems.push(
          `INV-3: library domain '${d.domain}' consumer '${role}' has no active integration record — run /knowledge:integrate.`
        );
      }
      const spec = roleSpecs.get(role);
      const inOwnSpec = markers.some(
        (m) =>
          m.domain === d.domain &&
          m.role === role &&
          spec &&
          normPath(m.file) === normPath(spec)
      );
      if (!inOwnSpec) {
        problems.push(
          `INV-3: library domain '${d.domain}' consumer '${role}' has no live <!-- knowledge:${d.domain} role:${role} --> marker in its spec (${spec || "spec unknown"}).`
        );
      }
    }
  }

  const recordIsKnown = (rec) => {
    const d = domainByName.get(rec.domain);
    if (!d) return false;
    if (d.kind === "library") return d.consumers.includes(rec.role);
    return rec.role === d.producer || d.consumers.includes(rec.role);
  };
  for (const r of active) {
    if (!recordIsKnown(r)) {
      problems.push(
        `INV-7: integration record for (${r.domain}, ${r.role}) has no matching domain/role in the registry (orphan record).`
      );
      continue;
    }
    const d = domainByName.get(r.domain);
    if (d.kind === "library" && !markerSet.has(markerKey(r.domain, r.role))) {
      problems.push(
        `INV-6: record for (${r.domain}, ${r.role}) claims integration but no knowledge marker is present in the specs (phantom record).`
      );
    }
  }

  for (const m of markers) {
    if (!activeKey.has(markerKey(m.domain, m.role))) {
      problems.push(
        `INV-8: marker <!-- knowledge:${m.domain} role:${m.role} --> in ${m.file} has no active integration record (orphan marker).`
      );
    }
  }
  return problems;
}

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

function walkMd(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walkMd(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

function loadRoleSpecs() {
  const raw = JSON.parse(fs.readFileSync(ROLE_REGISTRY_FILE, "utf8"));
  const roles = raw.roles || raw;
  const map = new Map();
  for (const [slug, def] of Object.entries(roles)) {
    if (def && typeof def === "object") {
      const spec = def.spec || def.current_spec || null;
      if (spec) map.set(slug, spec);
    }
  }
  return map;
}

function collectMarkers() {
  const markers = [];
  for (const f of walkMd(AGENTS_DIR)) {
    const content = fs.readFileSync(f, "utf8");
    OPEN_MARKER_RE.lastIndex = 0;
    let m;
    while ((m = OPEN_MARKER_RE.exec(content)) !== null) {
      markers.push({
        domain: m[1],
        role: m[2],
        file: normPath(path.relative(REPO_ROOT, f)),
      });
    }
  }
  return markers;
}

const abs = (rel) => path.join(REPO_ROOT, rel);

function run() {
  const problems = [];
  const notes = [];

  let built;
  try {
    built = buildRegistry();
  } catch (e) {
    return { ok: false, problems: [`INV-2: domain validation failed: ${e.message}`], notes, fatal: true };
  }
  const onDisk = (() => {
    try {
      return fs.readFileSync(REGISTRY_FILE, "utf8");
    } catch {
      return null;
    }
  })();
  if (onDisk === null) {
    problems.push("INV-1: _knowledge/registry.json is missing — run `node scripts/knowledge/registry.js`.");
  } else if (onDisk !== JSON.stringify(built, null, 2) + "\n") {
    problems.push("INV-1: _knowledge/registry.json is STALE vs the _domain.json files — rebuild it.");
  }

  let roleSpecs;
  try {
    roleSpecs = loadRoleSpecs();
  } catch (e) {
    return { ok: false, problems: [`role-registry unreadable: ${e.message}`], notes, fatal: true };
  }

  const records = readJsonl(INTEGRATION_LOG);
  for (const pe of records.filter((r) => r.__parse_error))
    problems.push(`knowledge-integration.jsonl line ${pe.__line} is not valid JSON`);
  const active = records.filter((r) => !r.__parse_error && r.status === "active");
  const markers = collectMarkers();

  for (const d of built.domains) {
    if (d.kind === "library") {
      const indexRel = d.index;
      if (!indexRel || !fs.existsSync(abs(indexRel))) {
        problems.push(`INV-4: library domain '${d.domain}' index '${indexRel}' is missing.`);
      } else {
        let idx = null;
        try {
          idx = JSON.parse(fs.readFileSync(abs(indexRel), "utf8"));
        } catch (e) {
          problems.push(`INV-4: ${indexRel} is not valid JSON (${e.message}).`);
        }
        if (idx) {
          const entries = Array.isArray(idx.guides) ? idx.guides : [];
          if (entries.length !== d.artifact_count) {
            problems.push(
              `INV-4: ${indexRel} lists ${entries.length} entries but ${d.artifact_count} artifact file(s) are on disk — the index drifted.`
            );
          }
          for (const g of entries) {
            if (g.path && !fs.existsSync(abs(g.path))) {
              problems.push(`INV-4: ${indexRel} references '${g.path}' which does not exist.`);
            }
          }
        }
      }
    } else {
      const contract = d.contract;
      if (!contract || !fs.existsSync(abs(contract))) {
        problems.push(`INV-5: store domain '${d.domain}' contract README '${contract}' is missing.`);
      }
      const pspec = roleSpecs.get(d.producer);
      if (!pspec || !fs.existsSync(abs(pspec))) {
        problems.push(`INV-5: store domain '${d.domain}' producer '${d.producer}' spec not found.`);
      } else if (!fs.readFileSync(abs(pspec), "utf8").includes(`_knowledge/${d.domain}`)) {
        problems.push(
          `INV-5: store domain '${d.domain}' producer '${d.producer}' (${pspec}) does not reference '_knowledge/${d.domain}' — wire the grounding ref.`
        );
      }
    }
  }

  problems.push(...evaluate({ domains: built.domains, active, markers, roleSpecs }));

  notes.push(
    `${built.domains.length} domain(s) (${built.domains.filter((d) => d.kind === "library").length} library · ${built.domains.filter((d) => d.kind === "store").length} store) · ${active.length} active record(s) · ${markers.length} marker(s)`
  );

  return { ok: problems.length === 0, problems, notes, fatal: false };
}

function main() {
  const jsonOut = process.argv.includes("--json");
  let res;
  try {
    res = run();
  } catch (e) {
    console.error(`knowledge-coverage: runner error (fail-closed): ${e.message}`);
    process.exit(2);
  }
  if (jsonOut) {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.fatal ? 2 : res.ok ? 0 : 1);
  }
  if (res.ok) {
    console.log(`PASS [knowledge-coverage] ${res.notes.join(" · ")}`);
    process.exit(0);
  }
  console.error(`FAIL [knowledge-coverage] ${res.problems.length} gap(s):`);
  for (const p of res.problems) console.error(`  - ${p}`);
  if (res.notes.length) console.error(`  (${res.notes.join(" · ")})`);
  process.exit(res.fatal ? 2 : 1);
}

if (require.main === module) main();

module.exports = { run, evaluate, collectMarkers, loadRoleSpecs, INTEGRATION_LOG, OPEN_MARKER_RE };
