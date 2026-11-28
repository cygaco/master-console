"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { isDeepStrictEqual } = require("util");
const cHash = require("./content-hash");

const GIT_TIMEOUT_MS = 15000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  return env;
}

function git(args, cwd) {
  return spawnSync("git", args, {
    cwd,
    env: gitEnv(),
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  });
}

function toLf(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function readInstalledBase(opts) {
  try {
    const { sourceRoot, installedCommit, src, expectedHash } = opts;
    for (const v of [sourceRoot, installedCommit, src, expectedHash]) {
      if (typeof v !== "string" || !v) return null;
    }
    if (/^-|[\s:]/.test(installedCommit)) return null;
    const res = git(["-C", sourceRoot, "show", `${installedCommit}:${src}`]);
    if (res.error || res.status !== 0) return null;
    const hash = cHash.contentHash(res.stdout, { text: true });
    if (!cHash.hashMatches(hash, expectedHash)) return null;
    return res.stdout.toString("utf8");
  } catch {
    return null;
  }
}

function mergeMarkdown3(opts) {
  const localText = opts ? opts.localText : undefined;
  const failed = { clean: false, text: localText };
  let dir = null;
  try {
    const { baseText, targetText } = opts;
    const inputs = [localText, baseText, targetText];
    if (inputs.some((t) => typeof t !== "string")) return failed;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-"));
    ["l", "b", "t"].forEach((name, i) => {
      fs.writeFileSync(path.join(dir, name), toLf(inputs[i]), "utf8");
    });
    const res = git(["merge-file", "-p", "l", "b", "t"], dir);
    if (res.error || res.status !== 0) return failed;
    const merged = res.stdout.toString("utf8");
    return {
      clean: true,
      text: localText.includes("\r\n") ? merged.replace(/\n/g, "\r\n") : merged,
    };
  } catch {
    return failed;
  } finally {
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
      }
    }
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function unionValue(local, target, keyPath) {
  if (Array.isArray(local) && Array.isArray(target)) {
    if (![...local, ...target].every((v) => typeof v === "string")) {
      throw new Error(`array of non-strings at ${keyPath || "<root>"}`);
    }
    return [...new Set([...target, ...local])];
  }
  if (isPlainObject(local) && isPlainObject(target)) {
    const out = new Map(Object.entries(target));
    for (const [key, value] of Object.entries(local)) {
      out.set(
        key,
        out.has(key)
          ? unionValue(value, out.get(key), keyPath ? `${keyPath}.${key}` : key)
          : value,
      );
    }
    return Object.fromEntries(out);
  }
  if (!isDeepStrictEqual(local, target)) {
    throw new Error(`no installed base and the values differ at ${keyPath || "<root>"}`);
  }
  return target;
}

function jsonType(v) {
  if (Array.isArray(v)) return "array";
  return v === null ? "null" : typeof v;
}

function childPath(keyPath, key) {
  return keyPath ? `${keyPath}.${key}` : key;
}

function has(obj, key) {
  return obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key);
}

function assertSameShape(sides, keyPath) {
  if (new Set(sides.map(jsonType)).size > 1) {
    throw new Error(`types differ at ${keyPath || "<root>"}`);
  }
  if (Array.isArray(sides[0])) {
    if (!sides.flat(1).every((v) => typeof v === "string")) {
      throw new Error(`array of non-strings at ${keyPath || "<root>"}`);
    }
  }
}

function assertCompatible(a, b, keyPath) {
  assertSameShape([a, b], keyPath);
  if (!isPlainObject(a)) return;
  for (const [key, value] of Object.entries(a)) {
    if (has(b, key)) assertCompatible(value, b[key], childPath(keyPath, key));
  }
}

function setMergeValue(local, target, base, keyPath) {
  assertSameShape(
    base === undefined ? [local, target] : [local, target, base],
    keyPath,
  );
  if (Array.isArray(target)) {
    const was = new Set(base || []);
    const mine = new Set(local);
    const added = local.filter((v) => !was.has(v));
    return [...new Set([...target, ...added])].filter(
      (v) => mine.has(v) || !was.has(v),
    );
  }
  if (!isPlainObject(target)) {
    if (base !== undefined) {
      if (isDeepStrictEqual(local, base)) return target;
      if (isDeepStrictEqual(target, base)) return local;
    }
    if (isDeepStrictEqual(local, target)) return target;
    throw new Error(`both changed ${keyPath || "<root>"}`);
  }
  const out = new Map();
  for (const [key, value] of Object.entries(target)) {
    const at = childPath(keyPath, key);
    const baseValue = has(base, key) ? base[key] : undefined;
    if (has(local, key)) {
      out.set(key, setMergeValue(local[key], value, baseValue, at));
    } else {
      if (baseValue !== undefined) assertCompatible(baseValue, value, at);
      out.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(local)) {
    if (has(target, key)) continue;
    if (!has(base, key)) {
      out.set(key, value);
      continue;
    }
    assertCompatible(base[key], value, childPath(keyPath, key));
    if (Array.isArray(value)) {
      const was = new Set(base[key]);
      const added = [...new Set(value.filter((v) => !was.has(v)))];
      if (added.length) out.set(key, added);
    } else if (!isDeepStrictEqual(value, base[key])) {
      out.set(key, value);
    }
  }
  return Object.fromEntries(out);
}

function parseJson(text, side) {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`${side} is not valid JSON: ${e.message}`);
  }
}

function mergeJsonUnion(opts) {
  try {
    const { localText, targetText, baseText } = opts;
    const threeWay = baseText !== undefined && baseText !== null;
    const local = parseJson(localText, "local");
    const target = parseJson(targetText, "target");
    const base = threeWay ? parseJson(baseText, "base") : undefined;
    const sides = threeWay ? [local, target, base] : [local, target];
    if (!sides.every(isPlainObject)) {
      return { ok: false, reason: "top level must be a JSON object on every side" };
    }
    const indent = (/^([ \t]+)\S/m.exec(localText) || [])[1] || 2;
    const merged = threeWay
      ? setMergeValue(local, target, base, "")
      : unionValue(local, target, "");
    return { ok: true, text: JSON.stringify(merged, null, indent) + "\n" };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

module.exports = { readInstalledBase, mergeMarkdown3, mergeJsonUnion };
