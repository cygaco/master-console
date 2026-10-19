"use strict";

const core = require("./split-brain-core");

const LEGACY_SLUG = "warpos";
const CURRENT_SLUG = "mc";
const CURRENT_PREFIX = `${CURRENT_SLUG.toUpperCase()}_`;
const LEGACY_PREFIX = `${LEGACY_SLUG.toUpperCase()}_`;
const REMOVED_IN = "mc@2.2.0";
const SUFFIX_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

const warned = { env: false };
const divergenceWarned = new Set();

function defaultSink(line) {
  try {
    process.stderr.write(`${line}\n`);
  } catch {
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

function envNames(suffix) {
  assertSuffix(suffix);
  return { current: CURRENT_PREFIX + suffix, legacy: LEGACY_PREFIX + suffix };
}

function diagnoseEnvVar(suffix, env = process.env) {
  const { current, legacy } = envNames(suffix);
  return core.diagnoseEnv(env || {}, current, legacy);
}

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

function envPair(suffix, value) {
  const { current, legacy } = envNames(suffix);
  if (value === undefined || value === null) return {};
  const v = String(value);
  return { [current]: v, [legacy]: v };
}

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
