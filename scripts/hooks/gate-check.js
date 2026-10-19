#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { getDeps, getFeatureIds } = require("./lib/project-config");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const DEPS = getDeps();
const FEATURE_NAMES = getFeatureIds();

// security-reviewer; "qa" matches qa-reviewer; "security" matches security-*.
const SKIP_ROLES = [
  "reviewer", // covers frontend-/backend-/qa-/security-reviewer + generic reviewer
  "evaluator",
  "redteam", // legacy → security-reviewer
  "security", // security-reviewer / security-builder / security-fixer
  "fixer",
  "ops-analyst",
  "learner",
  "auditor",
  "compliance",
  "qa",
  "cabinet",
];

function loadStore() {
  let agentsDir;
  try {
    const { PATHS: _P } = require("./lib/paths");
    agentsDir = _P.agents;
  } catch {
  }
  const storePath = agentsDir
    ? path.join(agentsDir, "store.json")
    : path.resolve(__dirname, "..", "..", ".claude", "agents", "store.json");
  let raw;
  try {
    raw = fs.readFileSync(storePath, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  return JSON.parse(raw);
}

function isBuilderDispatch(prompt) {
  const lower = prompt.toLowerCase();

  for (const role of SKIP_ROLES) {
    if (lower.includes(role)) return false;
  }

  if (!lower.includes("build-") && !lower.includes("builder")) return false;

  return true;
}

function identifyFeature(prompt) {
  const declMatch = prompt.match(/feature:\s*([a-z][a-z0-9-]*)/i);
  if (declMatch) {
    const declared = declMatch[1].toLowerCase();
    if (FEATURE_NAMES.includes(declared)) return declared;
  }

  const taskMatch = prompt.match(/build-([a-z][a-z0-9-]*)/i);
  if (taskMatch) {
    const taskFeature = taskMatch[1].toLowerCase();
    if (FEATURE_NAMES.includes(taskFeature)) return taskFeature;
  }

  return null;
}

function checkFoundationDeps(store) {
  const foundationFeatures = Object.keys(store.features).filter((k) =>
    k.startsWith("foundation-"),
  );
  const blockers = [];
  for (const f of foundationFeatures) {
    const status = store.features[f]?.status;
    if (status !== "done") {
      blockers.push(`${f} is "${status}" (needs "done")`);
    }
  }
  return blockers;
}

function checkDeps(feature, store) {
  const deps = DEPS[feature];
  if (!deps) return [];

  const blockers = [];

  for (const dep of deps) {
    if (dep === "foundation") {
      blockers.push(...checkFoundationDeps(store));
      continue;
    }

    const entry = store.features[dep];
    if (!entry) {
      blockers.push(`${dep} not found in store`);
      continue;
    }

    if (dep.startsWith("foundation-")) {
      if (entry.status !== "done") {
        blockers.push(`${dep} is "${entry.status}" (needs "done")`);
      }
      continue;
    }

    const passing = ["eval_pass", "security_pass", "done"];
    if (!passing.includes(entry.status)) {
      blockers.push(`${dep} is "${entry.status}" (needs at least "eval_pass")`);
    }
  }

  return blockers;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const prompt = event.tool_input?.prompt || "";

    if (!prompt || !isBuilderDispatch(prompt)) process.exit(0);

    const feature = identifyFeature(prompt);
    if (!feature) process.exit(0);

    const store = loadStore();
    if (!store) {
      process.stderr.write(
        `${YELLOW}[gate-check] WARNING: Could not read store.json, allowing dispatch${RESET}\n`,
      );
      process.exit(0);
    }

    const blockers = checkDeps(feature, store);

    if (blockers.length > 0) {
      process.stderr.write(
        `${RED}[gate-check] BLOCKED: Builder for "${feature}" cannot start.${RESET}\n`,
      );
      process.stderr.write(`${RED}Unmet dependencies:${RESET}\n`);
      for (const b of blockers) {
        process.stderr.write(`${RED}  - ${b}${RESET}\n`);
      }
      process.stderr.write(
        `${YELLOW}Resolve dependency features before dispatching this builder.${RESET}\n`,
      );
      process.exit(2);
    }

    process.stderr.write(
      `${GREEN}[gate-check] OK: "${feature}" deps satisfied, builder allowed.${RESET}\n`,
    );
    process.exit(0);
  } catch (e) {
    process.stderr.write(
      `${RED}[gate-check] BLOCKED: could not evaluate the dependency gate (${e && e.message ? e.message : "unknown error"}) — failing closed.${RESET}\n`,
    );
    process.exit(2);
  }
});
