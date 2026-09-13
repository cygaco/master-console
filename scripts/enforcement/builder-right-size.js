"use strict";
/**
 * builder-right-size.js (SP-20260723-003 / ED-257) — the builder prompt-size right-sizing heuristic.
 *
 * A build-chain builder whose prompt implies a >15-min unit reaps read-only with ZERO worktree diff (it
 * spends its whole window reading before it can write — the SP-20260721-002 monolith-reap; after a
 * pre-extraction pass the chunks ran 5-9 min each). ">15-min" is a HEURISTIC PROXY (β) assessed from
 * prompt SIZE. WARN by default; BLOCK only under an explicit enforce env — a large-but-LEGITIMATE prompt
 * must NEVER be hard-blocked (β rider: warn-by-default / enforce-only-under-env).
 */
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const SIZE_FLOOR_BYTES = 12000; // ~a monolith spec; a right-sized <=15-min chunk is well under this.
const ENFORCE_SUFFIX = "BUILDER_SIZE_ENFORCE";
const ENFORCE_ENV = mcEnv.envNames(ENFORCE_SUFFIX).current; // "MC_BUILDER_SIZE_ENFORCE" (the legacy name is read as fallback)

/**
 * assessBuilderPrompt({ role, promptBytes, isBuildChain, enforce }) -> { level, reason }
 * level ∈ "ok" | "warn" | "block". Only a build-chain role over the floor is ever warn/block.
 */
function assessBuilderPrompt({ role, promptBytes, isBuildChain, enforce } = {}) {
  if (!isBuildChain) return { level: "ok", reason: "not a build-chain role — right-sizing not assessed" };
  if (typeof promptBytes !== "number" || promptBytes <= SIZE_FLOOR_BYTES) {
    return { level: "ok", reason: `prompt ${promptBytes}B within the ~${SIZE_FLOOR_BYTES}B right-size floor` };
  }
  const reason =
    `build-chain prompt for '${role}' is ${promptBytes}B (> ${SIZE_FLOOR_BYTES}B floor) — implies a >15-min unit ` +
    `that may reap read-only with zero worktree diff (SP-20260721-002). Extract an interface/spec pass first, ` +
    `then chunk to <=15-min units with a per-chunk savepoint.`;
  return { level: enforce ? "block" : "warn", reason };
}

/** enforceEnabled(env) — true only when the enforce env is explicitly "1"/"true" (default warn-only). */
function enforceEnabled(env = process.env) {
  const v = mcEnv.readEnv(ENFORCE_SUFFIX, env || {});
  return v === "1" || v === "true";
}

module.exports = { assessBuilderPrompt, enforceEnabled, SIZE_FLOOR_BYTES, ENFORCE_ENV };
