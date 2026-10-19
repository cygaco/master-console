
"use strict";

const ROLE_ALIASES = Object.freeze({
  evaluator: "reviewer",
  auditor: "ops-analyst",
  learner: "ops-analyst",
  "product-designer": "design-lead",
  "director-of-qa": "quality-lead",
  "research-insight-lead": "research-lead",
  "director-of-marketing": "director-of-growth",
  "growth-lead": "marketing-lead",
  "web-conversion-designer": "conversion-lead",
  redteam: "security-reviewer",
  qa: "qa-reviewer",
  compliance: "qa-reviewer",
  "req-reviewer": "qa-reviewer",
  "stub-scaffold": "skeleton-builder",
  advisor: "cabinet",
  consult: "cabinet",
});

const LEGACY_ROLE_NAMES = Object.freeze({
  reviewer: "evaluator",
  "ops-analyst": "learner",
  "skeleton-builder": "stub-scaffold",
  cabinet: "advisor",
});

function normalizeRole(name) {
  if (!name || typeof name !== "string") return name;
  return ROLE_ALIASES[name] || name;
}

function legacyRoleFor(canonical) {
  return LEGACY_ROLE_NAMES[canonical] || null;
}

function isRole(name, expected) {
  return normalizeRole(name) === expected;
}

module.exports = {
  ROLE_ALIASES,
  LEGACY_ROLE_NAMES,
  normalizeRole,
  legacyRoleFor,
  isRole,
};
