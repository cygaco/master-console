#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const KNOWLEDGE_DIR = path.join(REPO_ROOT, "_knowledge");
const REGISTRY_FILE = path.join(KNOWLEDGE_DIR, "registry.json");
const REGISTRY_SCHEMA = "mc/knowledge/registry/v1";
const ROLE_REGISTRY_FILE = path.join(REPO_ROOT, ".claude/agents/_org/role-registry.json");

const VALID_KINDS = ["library", "store"];

function loadRoleSet() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(ROLE_REGISTRY_FILE, "utf8"));
  } catch (e) {
    throw new Error(`cannot load role-registry (${ROLE_REGISTRY_FILE}): ${e.message}`);
  }
  const roles = raw.roles || raw;
  return new Set(
    Object.keys(roles).filter((k) => roles[k] && typeof roles[k] === "object")
  );
}

function loadDomains() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    throw new Error(`_knowledge dir not found at ${KNOWLEDGE_DIR}`);
  }
  const out = [];
  for (const name of fs.readdirSync(KNOWLEDGE_DIR).sort()) {
    const dir = path.join(KNOWLEDGE_DIR, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const domainFile = path.join(dir, "_domain.json");
    if (!fs.existsSync(domainFile)) continue;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(domainFile, "utf8"));
    } catch (e) {
      throw new Error(`_knowledge/${name}/_domain.json: invalid JSON (${e.message})`);
    }
    out.push({ domain: name, dir, meta });
  }
  return out;
}

function countArtifacts(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toUpperCase() !== "README.MD").length;
}

function validateDomain(d, roleSet) {
  const problems = [];
  const m = d.meta || {};
  const at = `_knowledge/${d.domain}/_domain.json`;
  if (m.domain !== d.domain)
    problems.push(`${at}: 'domain' (${m.domain}) must equal the dir name (${d.domain})`);
  if (!VALID_KINDS.includes(m.kind))
    problems.push(`${at}: invalid kind '${m.kind}' (want ${VALID_KINDS.join("|")})`);
  if (!m.producer) problems.push(`${at}: missing 'producer'`);
  else if (!roleSet.has(m.producer))
    problems.push(`${at}: producer '${m.producer}' is not a role in role-registry`);
  if (!Array.isArray(m.consumers) || m.consumers.length === 0)
    problems.push(`${at}: 'consumers' must be a non-empty array of role slugs`);
  else
    for (const c of m.consumers)
      if (!roleSet.has(c))
        problems.push(`${at}: consumer '${c}' is not a role in role-registry`);
  if (m.kind === "library") {
    if (!m.index) problems.push(`${at}: library domain missing 'index'`);
    if (!m.overview) problems.push(`${at}: library domain missing 'overview'`);
  } else if (m.kind === "store") {
    if (!m.contract) problems.push(`${at}: store domain missing 'contract' (README path)`);
  }
  return problems;
}

function buildRegistry(roleSet) {
  roleSet = roleSet || loadRoleSet();
  const domains = loadDomains()
    .map((d) => {
      const m = d.meta;
      const row = {
        domain: d.domain,
        kind: m.kind,
        producer: m.producer,
        consumers: [...(m.consumers || [])].sort(),
      };
      if (m.kind === "library") {
        row.index = m.index || null;
        row.overview = m.overview || null;
        row.artifact_count = countArtifacts(d.dir);
      } else {
        row.contract = m.contract || null;
        row.schema_ref = m.schema_ref || null;
      }
      return row;
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return { schema: REGISTRY_SCHEMA, domains };
}

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  } catch {
    return null;
  }
}

function serialize(reg) {
  return JSON.stringify(reg, null, 2) + "\n";
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const jsonOnly = args.includes("--json");

  let built;
  try {
    const roleSet = loadRoleSet();
    const domains = loadDomains();
    const problems = domains.flatMap((d) => validateDomain(d, roleSet));
    if (problems.length) {
      console.error(`knowledge/registry: ${problems.length} validation problem(s):`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(2);
    }
    built = buildRegistry(roleSet);
  } catch (e) {
    console.error(`knowledge/registry: ${e.message}`);
    process.exit(2);
  }

  if (jsonOnly) {
    process.stdout.write(serialize(built));
    process.exit(0);
  }

  if (check) {
    const current = (() => {
      try {
        return fs.readFileSync(REGISTRY_FILE, "utf8");
      } catch {
        return null;
      }
    })();
    if (current === serialize(built)) {
      console.log(`knowledge/registry: fresh (${built.domains.length} domains)`);
      process.exit(0);
    }
    console.error(
      "knowledge/registry: STALE — _knowledge/registry.json does not match the _domain.json files. Run `node scripts/knowledge/registry.js` (or /knowledge:coverage will fail)."
    );
    process.exit(1);
  }

  fs.writeFileSync(REGISTRY_FILE, serialize(built));
  console.log(
    `knowledge/registry: wrote _knowledge/registry.json (${built.domains.length} domains)`
  );
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  REPO_ROOT,
  KNOWLEDGE_DIR,
  REGISTRY_FILE,
  REGISTRY_SCHEMA,
  VALID_KINDS,
  loadRoleSet,
  loadDomains,
  countArtifacts,
  validateDomain,
  buildRegistry,
  loadRegistry,
};
