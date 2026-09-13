"use strict";

/**
 * scripts/hooks/lib/mc-env.js — the ONE read-both compat helper for the mc@2.0.0 one-release window
 * (S-OS-06 COMPAT CONTRACT: AC-3.1 precedence, AC-3.2 dual-state diagnosis, AC-3.3 no raw read outside it).
 *
 * ENV. Every framework read of an engine env var goes through readEnv(SUFFIX) — the name WITHOUT its prefix:
 *   MC_<SUFFIX> set                          -> its value (canonical precedence)
 *   only the legacy-prefixed name set        -> the legacy value + ONE deprecation warning per process (stderr)
 *   both set, identical                      -> the value, silent (setEnv emits both on purpose)
 *   both set, DIFFERENT                      -> the MC_ value (canonical precedence) + a deterministic DIVERGENCE
 *                                                line on stderr (once per name, values never printed); the full
 *                                                diagnosis object is diagnoseEnvVar(SUFFIX)
 *   neither                                  -> undefined
 * Set sites emit BOTH names (setEnv / unsetEnv / envPair), so a child reading either name sees one value for the
 * whole window. A raw `process.env.<MC|legacy>_*` access outside this file is refused by
 * tests/regression/S-OS-06/env-read-both.test.js (no-raw-env-read-outside-helper).
 *
 * The decision rule lives in split-brain-core.js#diagnose — this module only adapts it (one rule, one place).
 * Removal: the legacy names stop being read in mc@2.1.0.
 */

const core = require("./split-brain-core");

// The ONE legacy literal in this helper — occurrence-pinned in the S-OS-06 partition as compat DATA.
const LEGACY_SLUG = "warpos";
const CURRENT_SLUG = "mc";
const CURRENT_PREFIX = `${CURRENT_SLUG.toUpperCase()}_`;
const LEGACY_PREFIX = `${LEGACY_SLUG.toUpperCase()}_`;
const REMOVED_IN = "mc@2.1.0";
const SUFFIX_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

const warned = { env: false };
const divergenceWarned = new Set();

function defaultSink(line) {
  try {
    process.stderr.write(`${line}\n`);
  } catch {
    /* a warning must never break a read */
  }
}
let warnSink = defaultSink;

function assertSuffix(suffix) {
  if (typeof suffix !== "string" || !SUFFIX_RE.test(suffix)) {
    throw new TypeError(`mc-env: expected an env-name suffix matching ${SUFFIX_RE} (got ${JSON.stringify(suffix)})`);
  }
  if (suffix.startsWith(CURRENT_PREFIX) || suffix.startsWith(LEGACY_PREFIX)) {
    throw new TypeError(`mc-env: pass the suffix WITHOUT its prefix (got ${JSON.stringify(suffix)})`);
  }
  return suffix;
}

/** { current: "MC_<SUFFIX>", legacy: "<LEGACY>_<SUFFIX>" } */
function envNames(suffix) {
  assertSuffix(suffix);
  return { current: CURRENT_PREFIX + suffix, legacy: LEGACY_PREFIX + suffix };
}

/** The full split-brain diagnosis for one env var (state, ok, resolved, source, deprecated, divergence, message). */
function diagnoseEnvVar(suffix, env = process.env) {
  const { current, legacy } = envNames(suffix);
  return core.diagnoseEnv(env || {}, current, legacy);
}

/** Read-both: MC_<SUFFIX> first, else the legacy name (one deprecation warning per process). */
function readEnv(suffix, env = process.env) {
  const d = diagnoseEnvVar(suffix, env);
  if (d.state === core.STATES.LEGACY_ONLY && !warned.env) {
    warned.env = true;
    const { current, legacy } = envNames(suffix);
    warnSink(
      `[mc] DEPRECATION: ${legacy} is set but ${current} is not — using ${legacy} for now. Rename it to ${current}; ` +
        `legacy ${LEGACY_PREFIX}* names stop being read in ${REMOVED_IN}. (One warning per process.)`
    );
  } else if (d.state === core.STATES.DUAL_CONFLICTING) {
    const { current, legacy } = envNames(suffix);
    if (!divergenceWarned.has(current)) {
      divergenceWarned.add(current);
      warnSink(
        `[mc] ENV DIVERGENCE: ${current} and ${legacy} are both set and DIFFER — using ${current} (canonical precedence). ` +
          `Unset ${legacy} or make it match. (values not printed)`
      );
    }
  }
  return d.resolved === null ? undefined : d.resolved;
}

/** Set BOTH names (undefined/null unsets both). Never touches any other key. */
function setEnv(suffix, value, env = process.env) {
  const { current, legacy } = envNames(suffix);
  if (value === undefined || value === null) {
    delete env[current];
    delete env[legacy];
    return;
  }
  const v = String(value);
  env[current] = v;
  env[legacy] = v;
}

function unsetEnv(suffix, env = process.env) {
  setEnv(suffix, undefined, env);
}

/** Both names as an object to spread into a child env: { ...process.env, ...envPair("X", "1") }. */
function envPair(suffix, value) {
  const { current, legacy } = envNames(suffix);
  if (value === undefined || value === null) return {};
  const v = String(value);
  return { [current]: v, [legacy]: v };
}

/** Exact save/restore of both names (test seams). */
function snapshotEnv(suffixes, env = process.env) {
  const entries = [];
  for (const s of [].concat(suffixes)) {
    const { current, legacy } = envNames(s);
    for (const name of [current, legacy]) entries.push([name, Object.prototype.hasOwnProperty.call(env, name), env[name]]);
  }
  return { env, entries };
}

function restoreEnv(snapshot) {
  for (const [name, had, value] of snapshot.entries) {
    if (had) snapshot.env[name] = value;
    else delete snapshot.env[name];
  }
}

function _resetWarningsForTest() {
  for (const k of Object.keys(warned)) warned[k] = false;
  divergenceWarned.clear();
}

function _setWarnSinkForTest(fn) {
  warnSink = typeof fn === "function" ? fn : defaultSink;
}

module.exports = {
  CURRENT_PREFIX,
  LEGACY_PREFIX,
  REMOVED_IN,
  envNames,
  diagnoseEnvVar,
  readEnv,
  setEnv,
  unsetEnv,
  envPair,
  snapshotEnv,
  restoreEnv,
  _resetWarningsForTest,
  _setWarnSinkForTest,
};
