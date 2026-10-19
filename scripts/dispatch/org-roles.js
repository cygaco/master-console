#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const ORG_MAP_PATH = path.join(
  ROOT,
  ".claude",
  "agents",
  "_org",
  "org-map.json",
);

const STATIC_GAMMA_ONLY_AUGMENT = [
  "builder",
  "qa",
  "ops-analyst",
  "learner",
  "delta",
  "fix-agent",
  "evaluator",
  "auditor",
  "reviewer",
  "compliance",
  "redteam",
];

let registryRoles = null;
try {
  registryRoles = require("./registry-roles");
} catch {
}

const REMEDIATION_ROLES = new Set(
  registryRoles
    ? registryRoles.deriveOrFallback(
        () => [...registryRoles.fixerRoles(), "fixer", "fix-agent"],
        ["fixer", "fix-agent"],
        "org-roles.REMEDIATION_ROLES",
      )
    : ["fixer", "fix-agent"],
);

function readOrgMap() {
  return JSON.parse(fs.readFileSync(ORG_MAP_PATH, "utf8").replace(/^﻿/, ""));
}

function buildChainDoerRoles(org = readOrgMap()) {
  const set = new Set();
  const builders = registryRoles
    ? registryRoles.deriveOrFallback(
        () => registryRoles.buildChainRoles(),
        Object.values(org.domains || {}).flatMap((d) => (d.builders || []).map((b) => b.role).filter(Boolean)),
        "org-roles.buildChainDoerRoles(builders)",
      )
    : Object.values(org.domains || {}).flatMap((d) => (d.builders || []).map((b) => b.role).filter(Boolean));
  for (const r of builders) if (r) set.add(r);
  for (const g of Object.values(org.gauntlets || {})) {
    for (const m of g.members || []) set.add(m);
  }
  return set;
}

function gammaOnlyTypes(org = readOrgMap()) {
  return new Set([...STATIC_GAMMA_ONLY_AUGMENT, ...buildChainDoerRoles(org)]);
}

function gauntlets(org = readOrgMap()) {
  return org.gauntlets || {};
}

function gauntletForDomain(domain, org = readOrgMap()) {
  const out = {};
  for (const [name, g] of Object.entries(org.gauntlets || {})) {
    if (g.domain === domain || g.domain === "cross-domain") out[name] = g;
  }
  return out;
}

function reviewGauntletRoles(domain, org = readOrgMap()) {
  const roles = [];
  for (const g of Object.values(gauntletForDomain(domain, org))) {
    for (const m of g.members || []) {
      if (!REMEDIATION_ROLES.has(m) && !roles.includes(m)) roles.push(m);
    }
  }
  return roles;
}

const POD_REVIEWER_PODS = { "frontend-reviewer": "frontend", "backend-reviewer": "backend" };

const NON_GAUNTLET_REVIEWERS = new Set(["design-quality", "visual-review", "test-runner"]);

function gauntletReviewRoles(org = readOrgMap()) {
  const codeQc = (org.gauntlets || {})["code-qc"];
  const members = (codeQc && codeQc.members) || [];
  const roles = [];
  for (const m of members) {
    if (REMEDIATION_ROLES.has(m)) continue;
    if (NON_GAUNTLET_REVIEWERS.has(m)) continue;
    if (!roles.includes(m)) roles.push(m);
  }
  return roles;
}

function expectedGauntletRoles(pods, org = readOrgMap()) {
  const all = gauntletReviewRoles(org);
  const podSet = Array.isArray(pods) && pods.length ? new Set(pods) : null;
  const out = [];
  for (const r of all) {
    const pod = POD_REVIEWER_PODS[r];
    if (pod && podSet && !podSet.has(pod)) continue;
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

const PRODUCT_STUDIO_HOMES = new Set(["product", "engineering", "growth", "marketing"]);

function domainRoles(org = readOrgMap()) {
  const fromOrgMap = () => {
    const set = new Set();
    for (const d of Object.values(org.domains || {})) {
      if (d.director && d.director.role) set.add(d.director.role);
      for (const lead of d.leads || []) {
        if (lead.role) set.add(lead.role);
        for (const sp of lead.specialists || []) if (sp.role) set.add(sp.role);
      }
      for (const sp of d.specialists || []) if (sp.role) set.add(sp.role);
      for (const b of d.builders || []) if (b.role) set.add(b.role);
    }
    return [...set];
  };
  const list = registryRoles
    ? registryRoles.deriveOrFallback(
        () => {
          const roles = registryRoles.loadRoles();
          return registryRoles
            .roleIds(roles)
            .filter((r) => PRODUCT_STUDIO_HOMES.has((roles[r] || {}).home));
        },
        fromOrgMap(),
        "org-roles.domainRoles",
      )
    : fromOrgMap();
  return new Set(list);
}

module.exports = {
  ORG_MAP_PATH,
  STATIC_GAMMA_ONLY_AUGMENT,
  REMEDIATION_ROLES,
  POD_REVIEWER_PODS,
  readOrgMap,
  buildChainDoerRoles,
  gammaOnlyTypes,
  gauntlets,
  gauntletForDomain,
  reviewGauntletRoles,
  gauntletReviewRoles,
  expectedGauntletRoles,
  domainRoles,
};

if (require.main === module) {
  const org = readOrgMap();
  const out = {
    gammaOnlyTypes: [...gammaOnlyTypes(org)].sort(),
    buildChainDoerRoles: [...buildChainDoerRoles(org)].sort(),
    domainRoles: [...domainRoles(org)].sort(),
    gauntlets: Object.keys(gauntlets(org)),
    reviewGauntletRoles_engineering: reviewGauntletRoles("engineering", org),
    gauntletReviewRoles: gauntletReviewRoles(org),
    expectedGauntletRoles_all: expectedGauntletRoles(null, org),
    expectedGauntletRoles_frontendOnly: expectedGauntletRoles(["frontend"], org),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
