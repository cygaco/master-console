"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const SIZE_FLOOR_BYTES = 12000;
const ENFORCE_SUFFIX = "BUILDER_SIZE_ENFORCE";
const ENFORCE_ENV = mcEnv.envNames(ENFORCE_SUFFIX).current;

function assessBuilderPrompt({ role, promptBytes, isBuildChain, enforce } = {}) {
  if (!isBuildChain) return { level: "ok", reason: "not a build-chain role — right-sizing not assessed" };
  if (typeof promptBytes !== "number" || promptBytes <= SIZE_FLOOR_BYTES) {
    return { level: "ok", reason: `prompt ${promptBytes}B within the ~${SIZE_FLOOR_BYTES}B right-size floor` };
  }
  const reason =
    `build-chain prompt for '${role}' is ${promptBytes}B (> ${SIZE_FLOOR_BYTES}B floor) — implies a >15-min unit ` +
    `that may reap read-only with zero worktree diff. Extract an interface/spec pass first, ` +
    `then chunk to <=15-min units with a per-chunk savepoint.`;
  return { level: enforce ? "block" : "warn", reason };
}

function enforceEnabled(env = process.env) {
  const v = mcEnv.readEnv(ENFORCE_SUFFIX, env || {});
  return v === "1" || v === "true";
}

module.exports = { assessBuilderPrompt, enforceEnabled, SIZE_FLOOR_BYTES, ENFORCE_ENV };
