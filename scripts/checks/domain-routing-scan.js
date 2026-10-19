#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ORG_MAP = path.join(
  REPO_ROOT,
  ".claude",
  "agents",
  "_org",
  "org-map.json",
);
const CONTRACTS_DIR = path.join(REPO_ROOT, "schemas", "contracts");

function knownRoles(org) {
  const roles = new Set();
  if (org.orchestrator) roles.add(org.orchestrator.role);
  if (org.referee) roles.add(org.referee.role);
  for (const d of Object.values(org.domains || {})) {
    if (d.director) roles.add(d.director.role);
    for (const l of d.leads || []) {
      roles.add(l.role);
      for (const s of l.specialists || []) roles.add(s.role);
    }
    for (const s of d.specialists || []) roles.add(s.role);
    for (const b of d.builders || []) roles.add(b.role);
  }
  for (const key of Object.keys(org.gauntlets || {})) roles.add(`${key}-gauntlet`);
  roles.add("enforcer");
  return roles;
}

function ownerDomainsFromContracts(dir) {
  const domains = new Map();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".schema.json"));
  if (files.length === 0) throw new Error(`no contract schemas in ${dir}`);
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const od = s.contract && s.contract.owner_domain;
    const t = s.properties && s.properties.type && s.properties.type.const;
    if (!od) throw new Error(`${f} missing contract.owner_domain`);
    if (!domains.has(od)) domains.set(od, []);
    domains.get(od).push(t || f);
  }
  return domains;
}

function scan(org, ownerDomains) {
  const errors = [];
  const routing = org.routing || {};
  const domains = org.domains || {};
  const roles = knownRoles(org);

  for (const [od, types] of ownerDomains) {
    if (!routing[od]) {
      errors.push(
        `unrouted-owner-domain: '${od}' (used by ${types.join(", ")}) has no entry in org-map.routing`,
      );
    }
  }
  for (const [od, r] of Object.entries(routing)) {
    if (od === "_doc") continue;
    if (r.domain !== "cross-domain" && !domains[r.domain]) {
      errors.push(
        `dangling-domain: routing['${od}'].domain='${r.domain}' not defined in org-map.domains`,
      );
    }
    if (!r.owner_role || !roles.has(r.owner_role)) {
      errors.push(
        `unknown-owner-role: routing['${od}'].owner_role='${r.owner_role}' is not a known org role`,
      );
    }
  }
  for (const od of Object.keys(routing)) {
    if (od === "_doc") continue;
    if (!ownerDomains.has(od)) {
      errors.push(
        `orphan-routing: routing['${od}'] maps a domain no contract declares`,
      );
    }
  }
  return errors;
}

function main(argv) {
  const json = argv.includes("--json");
  let org;
  let ownerDomains;
  try {
    org = JSON.parse(fs.readFileSync(ORG_MAP, "utf8"));
  } catch (e) {
    process.stderr.write(`domain-routing-scan error (org-map): ${e.message}\n`);
    return 2;
  }
  try {
    ownerDomains = ownerDomainsFromContracts(CONTRACTS_DIR);
  } catch (e) {
    process.stderr.write(`domain-routing-scan error (contracts): ${e.message}\n`);
    return 2;
  }
  let errors;
  try {
    errors = scan(org, ownerDomains);
  } catch (e) {
    process.stderr.write(`domain-routing-scan error: ${e.message}\n`);
    return 2;
  }
  if (json) {
    process.stdout.write(
      JSON.stringify({ ok: errors.length === 0, errors }, null, 2) + "\n",
    );
    return errors.length ? 1 : 0;
  }
  if (errors.length === 0) {
    process.stdout.write(
      "OK domain-routing: every contract owner_domain routes to a defined org domain + role\n",
    );
    return 0;
  }
  process.stderr.write(
    `FAIL domain-routing (${errors.length}):\n${errors.map((e) => "  - " + e).join("\n")}\n`,
  );
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  scan,
  knownRoles,
  ownerDomainsFromContracts,
  ORG_MAP,
  CONTRACTS_DIR,
};
