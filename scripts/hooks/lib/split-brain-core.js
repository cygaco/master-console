"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STATES = Object.freeze({
  ABSENT: "absent",
  NEW_ONLY: "new-only",
  LEGACY_ONLY: "legacy-only",
  DUAL_IDENTICAL: "dual-identical",
  DUAL_CONFLICTING: "dual-conflicting",
});

const DIVERGENCE_CAP = 20;

function diagnose({ current, legacy, currentLabel = "current", legacyLabel = "legacy", compare }) {
  const c = current || { present: false };
  const l = legacy || { present: false };
  if (!c.present && !l.present) {
    return result(STATES.ABSENT, true, null, null, false, null, `neither ${currentLabel} nor ${legacyLabel} is set`);
  }
  if (c.present && !l.present) {
    return result(STATES.NEW_ONLY, true, c.value, "current", false, null, `${currentLabel} is set; ${legacyLabel} is not`);
  }
  if (!c.present && l.present) {
    return result(
      STATES.LEGACY_ONLY,
      true,
      l.value,
      "legacy",
      true,
      null,
      `DEPRECATED: only ${legacyLabel} is set — falling back to it; set ${currentLabel} instead (the legacy name is removed in 2.2.0)`
    );
  }
  if (c.fingerprint === l.fingerprint) {
    return result(
      STATES.DUAL_IDENTICAL,
      true,
      c.value,
      "current",
      true,
      null,
      `${currentLabel} and ${legacyLabel} are both set and identical — using ${currentLabel}; remove ${legacyLabel}`
    );
  }
  const divergence = { current: c.detail, legacy: l.detail, ...(typeof compare === "function" ? compare(c, l) : {}) };
  return result(
    STATES.DUAL_CONFLICTING,
    false,
    c.value,
    "current",
    true,
    divergence,
    `DIVERGENCE: ${currentLabel} and ${legacyLabel} are both set and DIFFER — canonical precedence names ${currentLabel}, but a dual-conflicting state is diagnosed, never silently resolved`
  );
}

function result(state, ok, resolved, source, deprecated, divergence, message) {
  return { state, ok, resolved, source, deprecated, divergence, message };
}

function envSide(env, name) {
  const value = env[name];
  if (value === undefined) return { present: false };
  return { present: true, value, fingerprint: `v:${value}`, detail: { name, value } };
}

function diagnoseEnv(env, currentName, legacyName) {
  if (!currentName || !legacyName) throw new TypeError("diagnoseEnv(env, currentName, legacyName): both names are required");
  return diagnose({
    current: envSide(env || {}, currentName),
    legacy: envSide(env || {}, legacyName),
    currentLabel: currentName,
    legacyLabel: legacyName,
  });
}

function dirManifest(root) {
  const entries = [];
  const walk = (abs, rel) => {
    const names = fs.readdirSync(abs).sort();
    for (const name of names) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(a);
      if (st.isSymbolicLink()) entries.push({ rel: r, kind: "link", sig: fs.readlinkSync(a) });
      else if (st.isDirectory()) {
        entries.push({ rel: r, kind: "dir", sig: "" });
        walk(a, r);
      } else if (st.isFile()) {
        entries.push({ rel: r, kind: "file", sig: crypto.createHash("sha256").update(fs.readFileSync(a)).digest("hex") });
      }
    }
  };
  walk(root, "");
  return entries;
}

function dirSide(dir) {
  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    return { present: false };
  }
  if (!st.isDirectory()) return { present: false };
  const manifest = dirManifest(dir);
  const digest = crypto
    .createHash("sha256")
    .update(manifest.map((e) => `${e.kind}\t${e.rel}\t${e.sig}`).join("\n"))
    .digest("hex");
  return { present: true, value: dir, fingerprint: `d:${digest}`, detail: { path: dir, entries: manifest.length, digest }, manifest };
}

function compareDirs(c, l) {
  const cm = new Map(c.manifest.map((e) => [e.rel, e]));
  const lm = new Map(l.manifest.map((e) => [e.rel, e]));
  const onlyInCurrent = [...cm.keys()].filter((k) => !lm.has(k)).sort();
  const onlyInLegacy = [...lm.keys()].filter((k) => !cm.has(k)).sort();
  const differing = [...cm.keys()]
    .filter((k) => lm.has(k) && (cm.get(k).kind !== lm.get(k).kind || cm.get(k).sig !== lm.get(k).sig))
    .sort();
  return {
    onlyInCurrent: onlyInCurrent.slice(0, DIVERGENCE_CAP),
    onlyInLegacy: onlyInLegacy.slice(0, DIVERGENCE_CAP),
    differing: differing.slice(0, DIVERGENCE_CAP),
    counts: { onlyInCurrent: onlyInCurrent.length, onlyInLegacy: onlyInLegacy.length, differing: differing.length },
  };
}

function diagnoseDir(currentDir, legacyDir) {
  if (!currentDir || !legacyDir) throw new TypeError("diagnoseDir(currentDir, legacyDir): both directories are required");
  return diagnose({
    current: dirSide(currentDir),
    legacy: dirSide(legacyDir),
    currentLabel: currentDir,
    legacyLabel: legacyDir,
    compare: compareDirs,
  });
}

function pathSide(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return { present: false };
  }
  if (st.isDirectory()) return { ...dirSide(p), kind: "dir" };
  if (!st.isFile()) return { present: false };
  const digest = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  return { present: true, kind: "file", value: p, fingerprint: `f:${digest}`, detail: { path: p, kind: "file", digest } };
}

function comparePaths(c, l) {
  if (c.kind === "dir" && l.kind === "dir") return compareDirs(c, l);
  if (c.kind !== l.kind) return { kinds: { current: c.kind, legacy: l.kind } };
  return { content: "differs" };
}

function diagnosePath(currentPath, legacyPath) {
  if (!currentPath || !legacyPath) throw new TypeError("diagnosePath(currentPath, legacyPath): both paths are required");
  return diagnose({
    current: pathSide(currentPath),
    legacy: pathSide(legacyPath),
    currentLabel: currentPath,
    legacyLabel: legacyPath,
    compare: comparePaths,
  });
}

function exitCodeFor(diagnosis) {
  return diagnosis.ok ? 0 : 1;
}

module.exports = { STATES, diagnose, diagnoseEnv, diagnoseDir, diagnosePath, dirManifest, pathSide, exitCodeFor };
