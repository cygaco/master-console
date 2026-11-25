#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const CENSUS_REL = "scripts/checks/model-resolution.readers.json";
const CLASSES = ["routed", "display-only", "unrouted"];
const SKIP_DIRS = new Set(["node_modules", "fixtures", "falsifiers", ".git"]);
const isTestFile = (rel) => /\.test\.js$/.test(rel) || /(^|\/)test-[^/]+\.js$/.test(rel);

function walkJs(dir, root, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(full, root, out);
    else if (e.isFile() && e.name.endsWith(".js")) out.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return out;
}

function loadCensus(root) {
  return JSON.parse(fs.readFileSync(path.join(root, CENSUS_REL), "utf8").replace(/^﻿/, ""));
}

function findUnlistedReaders(opts) {
  const root = path.resolve((opts && opts.root) || path.join(__dirname, "..", ".."));
  const census = (opts && opts.census) || loadCensus(root);
  const readers = census.readers || {};
  const patterns = (census.patterns || []).map((p) => new RegExp(p));
  const files = walkJs(path.join(root, "scripts"), root, []).filter((rel) => !isTestFile(rel));
  const unlisted = [];
  for (const rel of files) {
    if (Object.prototype.hasOwnProperty.call(readers, rel)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (patterns.some((re) => re.test(text))) unlisted.push(rel);
  }
  const stale = Object.keys(readers).filter((rel) => !fs.existsSync(path.join(root, rel)));
  const bad = Object.entries(readers)
    .filter(([, v]) => !v || !CLASSES.includes(v.class) || typeof v.reason !== "string" || !v.reason.trim())
    .map(([rel]) => rel);
  const counts = {};
  for (const c of CLASSES) counts[c] = Object.values(readers).filter((v) => v && v.class === c).length;
  return { ok: unlisted.length === 0 && stale.length === 0 && bad.length === 0, unlisted, stale, bad, counts };
}

function findSigninCacheReaders(opts) {
  const root = path.resolve((opts && opts.root) || path.join(__dirname, "..", ".."));
  const names = new Set(["modelSigninCache", ...((opts && opts.fileNames) || [])]);
  try {
    const mr = require(path.join(root, "scripts", "dispatch", "model-resolve.js"));
    names.add(mr.SIGNIN_FALLBACK_FILE);
    const p = mr.signinCachePath({});
    if (p) names.add(path.basename(p));
  } catch {
  }
  const allowed = new Set([
    "scripts/dispatch/model-resolve.js",
    "scripts/dispatch/signin.js",
    "scripts/checks/model-resolution-readers.js",
  ]);
  const generated = (rel) =>
    /(^|\/)paths\.json$/.test(rel) || /paths\.generated\.js$/.test(rel) || /path-lint\.rules\.generated\.json$/.test(rel) ||
    /paths\.schema\.json$/.test(rel) || /framework-(manifest|installed)\.json$/.test(rel);
  const scan = (dirRel, exts) => {
    const out = [];
    const walk = (d) => {
      let entries;
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (SKIP_DIRS.has(e.name) || e.name === "worktrees" || e.name === "runtime") continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    };
    walk(path.join(root, dirRel));
    return out;
  };
  const candidates = [...scan("scripts", [".js", ".cjs", ".mjs"]), ...scan(".claude", [".js", ".cjs", ".mjs", ".md"])];
  const offenders = [];
  for (const rel of candidates) {
    if (allowed.has(rel) || isTestFile(rel) || generated(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if ([...names].some((n) => text.includes(n))) offenders.push(rel);
  }
  return { ok: offenders.length === 0, names: [...names], offenders };
}

function main(argv) {
  const json = argv.includes("--json");
  const r = findUnlistedReaders();
  const s = findSigninCacheReaders();
  const ok = r.ok && s.ok;
  if (json) {
    process.stdout.write(JSON.stringify({ ok, readers: r, signinCache: s }, null, 2) + "\n");
    return ok ? 0 : 1;
  }
  for (const f of r.unlisted) process.stderr.write(`UNLISTED reader ${f} — classify it in ${CENSUS_REL}\n`);
  for (const f of r.stale) process.stderr.write(`STALE census row ${f} — the file is gone\n`);
  for (const f of r.bad) process.stderr.write(`BAD census row ${f} — class must be ${CLASSES.join(" | ")} with a reason\n`);
  for (const f of s.offenders) process.stderr.write(`SECOND READER ${f} names the sign-in record — only model-resolve.js may read it\n`);
  process.stdout.write(
    `${ok ? "OK  " : "FAIL"} [model-resolution-readers] routed ${r.counts.routed}, display-only ${r.counts["display-only"]}, unrouted ${r.counts.unrouted}; sign-in record readers outside the resolver: ${s.offenders.length}\n`,
  );
  return ok ? 0 : 1;
}

module.exports = { findUnlistedReaders, findSigninCacheReaders, CENSUS_REL, CLASSES };

if (require.main === module) process.exit(main(process.argv.slice(2)));
