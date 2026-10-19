"use strict";

const crypto = require("crypto");
const { SUITE_VERSION, CHECK_NAMES, REQUIRED_CHECKS } = require("./registry");

const REGISTRY = Object.freeze({
  "false-green-envelope": require("./checks/false-green-envelope"),
  "no-nul-bytes": require("./checks/no-nul-bytes"),
  "suite-completeness": require("./checks/suite-completeness"),
});

if (!Array.isArray(CHECK_NAMES) || CHECK_NAMES.length === 0) {
  throw new Error("check-lib registry drift: CHECK_NAMES must be a non-empty array (empty-check-set floor)");
}
if (!Array.isArray(REQUIRED_CHECKS) || REQUIRED_CHECKS.length === 0) {
  throw new Error("check-lib registry drift: REQUIRED_CHECKS must be a non-empty array (empty-check-set floor)");
}

for (const n of CHECK_NAMES) {
  const mod = REGISTRY[n];
  if (!mod || typeof mod.run !== "function" || mod.name !== n) {
    throw new Error(
      `check-lib registry drift: CHECK_NAMES entry '${n}' has no matching REGISTRY['${n}'] module with a run() and name==='${n}'`,
    );
  }
}
for (const n of REQUIRED_CHECKS) {
  if (!CHECK_NAMES.includes(n)) {
    throw new Error(`check-lib registry drift: REQUIRED_CHECKS entry '${n}' is not present in CHECK_NAMES`);
  }
}

function listChecks() {
  return CHECK_NAMES.slice();
}

function getCheck(name) {
  const mod = REGISTRY[name];
  if (!mod) {
    throw new Error(`check-lib: unregistered check name '${name}' — fail-closed (getCheck never returns undefined)`);
  }
  return mod;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value === undefined ? null : value;
}
function digestOf(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(obj))).digest("hex");
}

const VALID_STATUSES = new Set(["pass", "fail", "skipped", "timeout"]);

function runCheck(name, ctx = {}) {
  const check = getCheck(name);
  let raw;
  try {
    raw = check.run(ctx);
  } catch (e) {
    raw = { status: "fail", reason: "check-threw", evidence: { error: String(e && e.message ? e.message : e) } };
  }
  if (!raw || typeof raw !== "object" || !VALID_STATUSES.has(raw.status)) {
    raw = { status: "fail", reason: "check-malformed-result", evidence: { raw: raw === undefined ? null : raw } };
  }
  const result = {
    name,
    status: raw.status,
    reason: raw.reason != null ? raw.reason : "",
    evidence: raw.evidence && typeof raw.evidence === "object" ? raw.evidence : {},
  };
  result.digest = digestOf(result);
  if (ctx && ctx.nonce != null) result.nonce = ctx.nonce;
  return result;
}

function runSuite(names, ctx = {}) {
  const requested = Array.isArray(names) ? names : CHECK_NAMES.slice();
  const missing = [];
  const executedNames = [];
  for (const name of requested) {
    try {
      getCheck(name);
    } catch {
      missing.push(name);
      continue;
    }
    executedNames.push(name);
  }
  const suiteCtx = { ...ctx, executedNames };
  const results = executedNames.map((name) => runCheck(name, suiteCtx));
  return { version: SUITE_VERSION, results, missing };
}

module.exports = {
  SUITE_VERSION,
  CHECK_NAMES,
  REQUIRED_CHECKS,
  listChecks,
  getCheck,
  runCheck,
  runSuite,
};
