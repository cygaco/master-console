#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");
const NAME = "dispatch-routing-parity";

const CLAUDE_BY_DEFINITION = new Set([
  "alpha",
  "beta",
  "gamma",
  "delta",
  "builder",
  "fixer",
  "skeleton-builder",
  "stub-scaffold",
]);

function fail(msg) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, check: NAME, error: msg }));
  } else {
    console.error(`FAIL [${NAME}] ${msg}`);
  }
  process.exit(1);
}

function loadProvidersMap() {
  const p = path.join(ROOT, "scripts", "hooks", "lib", "providers.js");
  if (!fs.existsSync(p)) return { error: `not found: ${p}` };
  try {
    const mod = require(p);
    const map = mod.DEFAULT_AGENT_PROVIDERS;
    if (!map || typeof map !== "object")
      return { error: "providers.js does not export DEFAULT_AGENT_PROVIDERS" };
    return { map };
  } catch (e) {
    return { error: `require(providers.js) threw: ${e.message}` };
  }
}

function loadCatalogMap() {
  const p = path.join(ROOT, "scripts", "dispatch", "catalog.js");
  if (!fs.existsSync(p)) return { error: `not found: ${p}` };
  try {
    const mod = require(p);
    const map = mod.DEFAULT_PROVIDER_PER_ROLE;
    if (!map || typeof map !== "object")
      return { error: "catalog.js does not export DEFAULT_PROVIDER_PER_ROLE" };
    return { map };
  } catch (e) {
    return { error: `require(catalog.js) threw: ${e.message}` };
  }
}

function loadRegistryMap() {
  const p = path.join(ROOT, "scripts", "dispatch", "registry-roles.js");
  if (!fs.existsSync(p)) return { error: `not found: ${p}` };
  try {
    const mod = require(p);
    if (typeof mod.providerMap !== "function")
      return { error: "registry-roles.js does not export providerMap()" };
    const map = mod.providerMap();
    if (!map || typeof map !== "object")
      return { error: "registry-roles.providerMap() returned no map" };
    return { map };
  } catch (e) {
    return { error: `registry-roles.providerMap() threw: ${e.message}` };
  }
}

const PROVIDER_NORMALIZE = {
  claude: "claude",
  anthropic: "claude",
  openai: "openai",
  gpt: "openai",
  codex: "openai",
  google: "antigravity",
  antigravity: "antigravity",
  agy: "antigravity",
};

function normalizeProvider(token) {
  if (!token) return null;
  const t = token
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .trim();
  return PROVIDER_NORMALIZE[t] || t || null;
}

function parseDocRoutingTable(docPath) {
  if (!fs.existsSync(docPath)) return { found: false, error: "doc not found" };
  const raw = fs.readFileSync(docPath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("|")) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    const lower = cells.map((c) => c.toLowerCase());
    const roleCol = lower.findIndex((c) => /\brole\b/.test(c));
    const provCol = lower.findIndex((c) => /\bprovider\b/.test(c));
    if (roleCol === -1 || provCol === -1) continue;

    const sep = lines[i + 1] || "";
    if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(sep) || !sep.includes("-")) continue;

    const table = {};
    for (let j = i + 2; j < lines.length; j++) {
      const row = lines[j];
      if (!row.trim() || !row.includes("|")) break;
      const rc = splitRow(row);
      if (rc.length <= Math.max(roleCol, provCol)) continue;
      const role = rc[roleCol]
        .toLowerCase()
        .replace(/[`*_]/g, "")
        .trim();
      const provider = normalizeProvider(rc[provCol]);
      if (!role || !provider) continue;
      table[role] = provider;
    }
    if (Object.keys(table).length > 0) return { found: true, table };
  }
  return { found: false };
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function compareRouting({
  registryMap = {},
  providersMap = {},
  catalogMap = {},
  docTable = {},
} = {}) {
  const allRoles = new Set([
    ...Object.keys(registryMap),
    ...Object.keys(providersMap),
    ...Object.keys(catalogMap),
  ]);

  const disagreements = [];
  const undocumented = [];

  for (const role of allRoles) {
    const inRegistry = registryMap[role];
    const inProviders = providersMap[role];
    const inCatalog = catalogMap[role];
    const inDoc = docTable[role];

    const present = {};
    if (inRegistry !== undefined) present.registry = inRegistry;
    if (inProviders !== undefined) present.providersJs = inProviders;
    if (inCatalog !== undefined) present.catalogJs = inCatalog;
    if (inDoc !== undefined) present.doc = inDoc;

    const distinct = new Set(Object.values(present));
    if (distinct.size > 1) {
      disagreements.push({ role, providers: present });
    }

    const codeProvider = inRegistry || inProviders || inCatalog;
    if (
      codeProvider &&
      codeProvider !== "claude" &&
      !CLAUDE_BY_DEFINITION.has(role) &&
      inDoc === undefined
    ) {
      undocumented.push({ role, codeProvider });
    }
  }

  return { rolesChecked: allRoles.size, disagreements, undocumented };
}

function run() {
  const p0 = loadRegistryMap();
  if (p0.error) fail(`registry: ${p0.error}`);
  const p1 = loadProvidersMap();
  if (p1.error) fail(`providers.js: ${p1.error}`);
  const p2 = loadCatalogMap();
  if (p2.error) fail(`catalog.js: ${p2.error}`);

  const registryMap = p0.map;
  const providersMap = p1.map;
  const catalogMap = p2.map;

  const docPath = path.join(
    ROOT,
    ".claude",
    "agents",
    "_system",
    "guides",
    "agent-dispatch-guide.md",
  );
  const doc = parseDocRoutingTable(docPath);
  const docTable = doc.found ? doc.table : {};

  const { rolesChecked, disagreements, undocumented } = compareRouting({
    registryMap,
    providersMap,
    catalogMap,
    docTable,
  });

  const docTableMissing = !doc.found;

  const ok =
    disagreements.length === 0 && !docTableMissing && undocumented.length === 0;

  if (JSON_OUT) {
    console.log(
      JSON.stringify({
        ok,
        check: NAME,
        sources: {
          registry: "scripts/dispatch/registry-roles.js#providerMap() (canonical)",
          providersJs: "scripts/hooks/lib/providers.js#DEFAULT_AGENT_PROVIDERS",
          catalogJs: "scripts/dispatch/catalog.js#DEFAULT_PROVIDER_PER_ROLE",
          doc: ".claude/agents/_system/guides/agent-dispatch-guide.md (role→provider table)",
        },
        docTableFound: doc.found,
        rolesChecked,
        disagreements,
        undocumented,
      }),
    );
    process.exit(ok ? 0 : 1);
  }

  if (ok) {
    console.log(
      `OK   [${NAME}] ${rolesChecked} roles agree across the registry, providers.js, catalog.js, and the dispatch guide`,
    );
    process.exit(0);
  }

  console.error(`FAIL [${NAME}] dispatch routing tables disagree:`);
  if (disagreements.length > 0) {
    console.error(`  ${disagreements.length} role(s) routed inconsistently:`);
    for (const d of disagreements) {
      const parts = Object.entries(d.providers)
        .map(([src, prov]) => `${src}=${prov}`)
        .join(", ");
      console.error(`    - ${d.role}: ${parts}`);
    }
  }
  if (docTableMissing) {
    console.error(
      "  agent-dispatch-guide.md has NO role→provider routing table.",
    );
    console.error(
      "    The guide documents the dispatch mechanism but never pins which role",
    );
    console.error(
      "    routes to which provider, so the doc cannot be checked against code.",
    );
    console.error(
      "    Fix: add a | Role | Provider | ... | table to the guide mirroring",
    );
    console.error(
      "    DEFAULT_AGENT_PROVIDERS / DEFAULT_PROVIDER_PER_ROLE.",
    );
  } else if (undocumented.length > 0) {
    console.error(
      `  ${undocumented.length} non-Claude role(s) routed in code but absent from the doc table:`,
    );
    for (const u of undocumented) {
      console.error(`    - ${u.role} → ${u.codeProvider} (code only)`);
    }
  }
  process.exit(1);
}

module.exports = { compareRouting };

if (require.main === module) run();
