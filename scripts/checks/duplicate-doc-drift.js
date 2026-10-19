#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "duplicate-doc-drift";
const MANIFEST_FILE = path.join(ROOT, ".claude", "framework-manifest.json");
const ALLOWLIST_FILE = path.join(__dirname, "duplicate-doc-drift.allowlist.json");

const EXCLUDED_KINDS = new Set(["skill", "template", "fixture", "release_capsule"]);
const EXCLUDED_PREFIXES = [".claude/commands/", "framework/releases/"];
const norm = (p) => p.replace(/\\/g, "/");
const isTemplatePath = (p) => /(^|\/)templates\//.test(p);
const isFixturePath = (p) => /(^|\/)fixtures\//.test(p);

function isExcludedPath(p) {
  return EXCLUDED_PREFIXES.some((pre) => p.startsWith(pre)) || isTemplatePath(p) || isFixturePath(p);
}

function fileMatchesDirGlob(file, dirGlob) {
  const f = norm(file);
  const g = norm(dirGlob);
  if (!g.endsWith("/")) return false;
  const dir = f.slice(0, f.lastIndexOf("/") + 1);
  const re = new RegExp(
    "^" +
      g
        .split("/")
        .map((seg) => (seg === "*" ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("/") +
      "$",
  );
  return re.test(dir);
}

function evaluate({ groups, rules }) {
  const findings = [];
  const allowed = [];
  const ruleList = rules || [];
  for (const g of groups || []) {
    const members = (g && g.members) || [];
    if (members.length < 2) continue;
    const distinct = new Set(members.map((m) => m.hash));
    const drifted = distinct.size > 1;

    const rule = ruleList.find(
      (r) =>
        r.basename === g.basename &&
        members.every((m) => (r.dirGlobs || []).some((dg) => fileMatchesDirGlob(m.file, dg))),
    );

    if (!drifted) {
      allowed.push({ basename: g.basename, files: members.map((m) => m.file), allowedBy: "identical-content" });
      continue;
    }
    if (rule) {
      allowed.push({
        basename: g.basename,
        files: members.map((m) => m.file),
        allowedBy: `sanctioned-duplicate (${rule.reason})`,
      });
      continue;
    }
    findings.push({
      severity: "high",
      check: NAME,
      kind: "duplicate-doc-drift",
      basename: g.basename,
      files: members.map((m) => m.file),
      message: `shipped framework doc '${g.basename}' exists at ${members.length} paths with DRIFTED content — ${members
        .map((m) => `${m.file} (${m.hash.slice(0, 8)})`)
        .join(" ≠ ")}. scan:references can't see this (both files exist). Reconcile to one canonical copy (single-source it, or repoint consumers), or — if this duplicate is sanctioned — add a basename+dirGlob rule to duplicate-doc-drift.allowlist.json with a reason.`,
    });
  }
  return { findings, allowed };
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function shippedDocPaths(manifestFile) {
  const raw = fs.readFileSync(manifestFile, "utf8").replace(/^﻿/, "");
  const fm = JSON.parse(raw);
  const assets = fm && fm.assets;
  if (!assets || typeof assets !== "object") {
    throw new Error("manifest has no `assets` object");
  }
  const out = new Set();
  for (const kind of Object.keys(assets)) {
    const arr = assets[kind];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      if (!e || e.owner !== "framework" || e.removedIn) continue;
      if (EXCLUDED_KINDS.has(e.kind)) continue;
      const dest = e.dest && norm(e.dest);
      if (!dest || !dest.endsWith(".md")) continue;
      if (isExcludedPath(dest)) continue;
      out.add(dest);
    }
  }
  return [...out].sort();
}

function buildGroups(docPaths) {
  const byBase = new Map();
  for (const rel of docPaths) {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(rel);
  }
  const groups = [];
  for (const [basename, files] of byBase) {
    if (files.length < 2) continue;
    const members = files.sort().map((file) => {
      const abs = path.join(ROOT, file);
      const hash = sha256(fs.readFileSync(abs));
      return { file, hash };
    });
    groups.push({ basename, members });
  }
  return groups.sort((a, b) => a.basename.localeCompare(b.basename));
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return { rules: [] };
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8").replace(/^﻿/, ""));
  const rules = (raw.pairs || [])
    .filter((p) => p && p.basename && Array.isArray(p.dirGlobs))
    .map((p) => ({ basename: p.basename, dirGlobs: p.dirGlobs, reason: String(p.reason || "") }));
  return { rules };
}

function run() {
  const notes = [];
  let allow;
  try {
    allow = loadAllowlist();
  } catch (e) {
    return { ok: false, fatal: true, problems: [`allowlist unreadable: ${e.message}`], notes };
  }
  let docPaths;
  try {
    docPaths = shippedDocPaths(MANIFEST_FILE);
  } catch (e) {
    return { ok: false, fatal: true, problems: [`framework-manifest unreadable/malformed: ${e.message}`], notes };
  }
  let groups;
  try {
    groups = buildGroups(docPaths);
  } catch (e) {
    return { ok: false, fatal: true, problems: [`could not hash a shipped doc: ${e.message}`], notes };
  }

  const { findings, allowed } = evaluate({ groups, rules: allow.rules });

  const usedReasons = new Set(allowed.filter((a) => /^sanctioned-duplicate/.test(a.allowedBy)).map((a) => a.basename));
  for (const r of allow.rules) {
    if (!usedReasons.has(r.basename)) {
      notes.push(`stale-allowlist-pair: '${r.basename}' is on the allowlist but matched no sanctioned drifted group (safe to remove).`);
    }
  }

  notes.push(
    `${docPaths.length} shipped framework doc(s) · ${groups.length} duplicate-basename group(s) · ${findings.length} drifted · ${allowed.length} allowed (identical or sanctioned)`,
  );
  const problems = findings.map((f) => f.message);
  return { ok: findings.length === 0, fatal: false, problems, notes, findings, allowed };
}

function main() {
  const asJson = process.argv.includes("--json");
  const enforce = process.argv.includes("--enforce") || mcEnv.readEnv("DUPLICATE_DOC_DRIFT_ENFORCE") === "block";
  let res;
  try {
    res = run();
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: false, check: NAME, error: msg }) : `ERROR  [${NAME}] runner error (fail-closed): ${msg}`) + "\n",
    );
    process.exit(2);
  }
  const mode = enforce ? "blocking" : "report-only";
  if (asJson) {
    process.stdout.write(JSON.stringify({ mode, ...res }, null, 2) + "\n");
    process.exit(res.fatal ? 2 : enforce && !res.ok ? 1 : 0);
  }
  if (res.fatal) {
    process.stderr.write(`ERROR  [${NAME}] ${res.problems.join(" · ")}\n`);
    process.exit(2);
  }
  if (res.ok) {
    process.stdout.write(`PASS [${NAME}] ${res.notes.join(" · ")}\n`);
    process.exit(0);
  }
  const label = enforce ? "FAIL" : "WARN";
  process.stderr.write(`${label} [${NAME}] (${mode}) ${res.findings.length} drifted duplicate doc(s):\n`);
  for (const f of res.findings) process.stderr.write(`  - ${f.message}\n`);
  if (res.notes.length) process.stderr.write(`  (${res.notes.join(" · ")})\n`);
  process.exit(enforce ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  evaluate,
  fileMatchesDirGlob,
  shippedDocPaths,
  buildGroups,
  loadAllowlist,
  run,
  EXCLUDED_KINDS,
  EXCLUDED_PREFIXES,
  MANIFEST_FILE,
  ALLOWLIST_FILE,
};
