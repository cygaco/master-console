#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { deriveClass, CROSS_PROVIDER_SCOPE } = require("./role-parity-scan");

const NAME = "meta-lockstep";
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const CONTRACT_PATH = path.join(ROOT, ".claude", "agents", "_org", "dispatch-contract.json");
const REGISTRY_PATH = path.join(ROOT, ".claude", "agents", "_org", "role-registry.json");
const ROLE_PARITY_SRC = path.join(__dirname, "role-parity-scan.js");

const BASELINE_WAIVER = Object.freeze([
  Object.freeze({
    dimension: "tier",
    value: "director",
    provider: "antigravity",
    why: "ADR-0031 deferral: no live antigravity director exists; role-parity self-detects the gap when one is introduced. Do NOT re-add the {tier:director,provider:antigravity} rule.",
  }),
]);

function classRoutesCrossProvider(derivedClass, roleClasses) {
  const entry = roleClasses && roleClasses[derivedClass];
  const shapes = (entry && entry.allowed_shapes) || [];
  return shapes.includes("subprocess-cross-provider");
}

function routesCrossProvider(dimension, value, provider, rules, fallbackClass, roleClasses) {
  const attrs = { [dimension]: value, provider };
  const cls = deriveClass(attrs, rules, fallbackClass);
  return classRoutesCrossProvider(cls, roleClasses);
}

function hasLiveRole(reg, dimension, value, provider) {
  const roles = (reg && reg.roles) || {};
  return Object.values(roles).some(
    (r) => r && typeof r === "object" && r[dimension] === value && (r.provider || "claude") === provider,
  );
}

const waiverKey = (w) => `${w.dimension}:${w.value}:${w.provider}`;

function isWaived(waiver, dimension, value, provider) {
  return (waiver || []).some(
    (w) => w && w.dimension === dimension && w.value === value && w.provider === provider,
  );
}

function crossProviderKeys(rules, roleClasses, scope) {
  const keys = new Map();
  for (const rule of rules || []) {
    const when = (rule && rule.when) || {};
    if (!when.provider || !scope.includes(when.provider)) continue;
    if (!classRoutesCrossProvider(rule.class, roleClasses)) continue;
    for (const dim of ["tier", "kind"]) {
      if (when[dim] == null) continue;
      keys.set(`${dim}:${when[dim]}`, { dimension: dim, value: when[dim] });
    }
  }
  return [...keys.values()];
}

function checkWaiverIntegrity(waiver, baseline = BASELINE_WAIVER) {
  const errors = [];
  const baseKeys = new Set(baseline.map(waiverKey));
  for (const w of waiver || []) {
    if (!w || typeof w !== "object") {
      errors.push(`${NAME}: waiver integrity — a waiver entry is not an object (${JSON.stringify(w)}). FIX: each waiver is a {dimension,value,provider,why} triple.`);
      continue;
    }
    if (!w.dimension || !w.value || !w.provider) {
      errors.push(`${NAME}: waiver integrity — entry ${JSON.stringify(w)} is NOT narrowest-form (a director-wide or provider-wide skip is forbidden). FIX: pin a single {dimension,value,provider} triple (e.g. {tier:"director",provider:"antigravity"}).`);
    }
    if (!w.why || String(w.why).trim() === "") {
      errors.push(`${NAME}: waiver integrity — entry {${w.dimension}:${w.value}, provider:${w.provider}} has NO 'why'. FIX: every waiver must document its rationale (point to ADR-0031 + the nonexistent-consumer reason).`);
    }
    if (!baseKeys.has(waiverKey(w))) {
      errors.push(`${NAME}: waiver WIDENED beyond the frozen baseline — {${w.dimension}:${w.value}, provider:${w.provider}} is not in BASELINE_WAIVER. A waiver that grows unobserved re-introduces the silent-absence it cures (a bypass). FIX: remove it, or extend the baseline through waiver-review (ADR-0031).`);
    }
  }
  return errors;
}

function evaluateMetaLockstep({ reg, contract, scope = CROSS_PROVIDER_SCOPE, waiver = BASELINE_WAIVER } = {}) {
  const errors = [];
  const rules = (contract && contract.class_derivation && contract.class_derivation.rules) || [];
  const fallbackClass =
    (contract && contract.class_derivation && contract.class_derivation.fallback_class) || "manager";
  const roleClasses = (contract && contract.role_classes) || {};

  errors.push(...checkWaiverIntegrity(waiver));

  const refKeys = crossProviderKeys(rules, roleClasses, scope);
  for (const { dimension, value } of refKeys) {
    for (const provider of scope) {
      if (routesCrossProvider(dimension, value, provider, rules, fallbackClass, roleClasses)) continue;
      if (isWaived(waiver, dimension, value, provider)) continue;
      if (!hasLiveRole(reg, dimension, value, provider)) continue;
      errors.push(
        `${NAME}: cross-provider routing ASYMMETRY — a LIVE ${dimension}="${value}" role exists for ` +
          `provider "${provider}", but no class_derivation rule routes {${dimension}:"${value}", provider:` +
          `"${provider}"} to a subprocess-cross-provider class (another in-scope provider in ` +
          `[${scope.join(", ")}] does). The scope filter includes "${provider}" without its paired rule. ` +
          `FIX: add the paired cross-provider class_derivation rule (mirror the other provider's ` +
          `{${dimension}:"${value}"} rule), OR add a narrowest-form documented waiver ` +
          `{dimension:"${dimension}",value:"${value}",provider:"${provider}",why:...} (ADR-0031 / waiver-review).`,
      );
    }
  }
  return { errors };
}

function shapeFilterReadsScopeConstant(src) {
  if (typeof src !== "string") return false;
  const fnStart = src.indexOf("function evaluateShapeRouteConflicts");
  if (fnStart === -1) return false;
  const fnBody = src.slice(fnStart, fnStart + 2000);
  return /scope\s*=\s*CROSS_PROVIDER_SCOPE/.test(fnBody) && /!\s*scope\.includes\(\s*provider\s*\)/.test(fnBody);
}

function shapeFilterReadsScopeBehaviorally() {
  let rp;
  try {
    rp = require("./role-parity-scan");
  } catch {
    return false;
  }
  const contract = {
    class_derivation: { rules: [{ when: { tier: "lead", provider: "openai" }, class: "x" }, { when: { tier: "lead" }, class: "m" }], fallback_class: "m" },
    role_classes: { x: { allowed_shapes: ["subprocess-cross-provider"] }, m: { allowed_shapes: ["in-process-agent"] } },
  };
  const reg = { roles: { "ag-lead": { tier: "lead", provider: "antigravity" } } };
  try {
    const withAnti = rp.evaluateShapeRouteConflicts({ reg, contract, scope: ["openai", "antigravity"] });
    const withoutAnti = rp.evaluateShapeRouteConflicts({ reg, contract, scope: ["openai"] });
    return withAnti.length > withoutAnti.length && withoutAnti.length === 0;
  } catch {
    return false;
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main(argv) {
  const json = argv.includes("--json");
  let reg, contract, roleParitySrc;
  try {
    reg = readJson(REGISTRY_PATH);
    contract = readJson(CONTRACT_PATH);
    roleParitySrc = fs.readFileSync(ROLE_PARITY_SRC, "utf8");
  } catch (e) {
    process.stderr.write(`${NAME}: FAIL-CLOSED — could not read inputs: ${e.message}\n`);
    return 2;
  }

  const { errors } = evaluateMetaLockstep({ reg, contract });
  if (!shapeFilterReadsScopeBehaviorally() || !shapeFilterReadsScopeConstant(roleParitySrc)) {
    errors.push(
      `${NAME}: SCOPE-DRIFT — role-parity-scan.js#evaluateShapeRouteConflicts does not read the shared injected ` +
        `scope (behavioral: a scope perturbation did not change the evaluated set, and/or a re-inlined provider ` +
        `literal at the filter). The scope filter and this enforcer must share ONE source. FIX: restore ` +
        `\`if (!scope.includes(provider)) continue;\` with the \`scope = CROSS_PROVIDER_SCOPE\` default.`,
    );
  }

  if (json) {
    process.stdout.write(JSON.stringify({ name: NAME, ok: errors.length === 0, errors }, null, 2) + "\n");
  } else if (errors.length === 0) {
    process.stdout.write(`${NAME}: OK — scope filter [${CROSS_PROVIDER_SCOPE.join(", ")}] is in lockstep with the class_derivation rule-table.\n`);
  } else {
    process.stdout.write(`${NAME}: ${errors.length} finding(s):\n${errors.map((e) => "  - " + e).join("\n")}\n`);
  }
  return errors.length === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  NAME,
  BASELINE_WAIVER,
  classRoutesCrossProvider,
  routesCrossProvider,
  hasLiveRole,
  isWaived,
  crossProviderKeys,
  checkWaiverIntegrity,
  evaluateMetaLockstep,
  shapeFilterReadsScopeConstant,
  shapeFilterReadsScopeBehaviorally,
};
