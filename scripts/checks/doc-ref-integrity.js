#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "doc-ref-integrity";
const ALLOWLIST_FILE = path.join(__dirname, "doc-ref-integrity.allowlist.json");

const norm = (p) => p.replace(/\\/g, "/");

const LEGACY_RENAME_SURFACE = "doc-ref-legacy-rename";
const LEGACY_PATH_SLUG = "warpos";
const LEGACY_PATH_SLUG_RE = new RegExp(LEGACY_PATH_SLUG, "i");

function resolveLegacyRename({ partition, version, isExpired, loadError } = {}) {
  const off = (expires, reason) => ({ active: false, surface: LEGACY_RENAME_SURFACE, expires, reason: `${reason} — tolerance OFF (fail closed)` });
  if (!partition) return off(null, `rename map unavailable (${loadError || "not loaded"})`);
  const w = (partition.compatWindows || []).find((x) => x && x.surface === LEGACY_RENAME_SURFACE);
  if (!w) return off(null, `compat surface '${LEGACY_RENAME_SURFACE}' is not registered`);
  if (typeof isExpired !== "function") return off(w.expires || null, "no expiry clock supplied");
  const shown = version === null || version === undefined ? "<unknown>" : version;
  if (isExpired(w.expires, version)) return off(w.expires || null, `compat surface '${LEGACY_RENAME_SURFACE}' expired (expires ${w.expires}, tree ${shown})`);
  return { active: true, surface: LEGACY_RENAME_SURFACE, expires: w.expires, reason: `compat surface '${LEGACY_RENAME_SURFACE}' registered (expires ${w.expires}, tree ${shown})` };
}

function loadLegacyRename() {
  let loader;
  let renamePath;
  try {
    loader = require("../open-source/partition-loader");
    renamePath = require("../open-source/rename-mc").renamePath;
  } catch (e) {
    return { ...resolveLegacyRename({ partition: null, loadError: e.message }), renamePath: null };
  }
  if (typeof renamePath !== "function") {
    return { ...resolveLegacyRename({ partition: null, loadError: "the codemod exports no renamePath" }), renamePath: null };
  }
  let partition;
  try {
    partition = loader.loadPartition();
  } catch (e) {
    return { ...resolveLegacyRename({ partition: null, loadError: e.message }), renamePath };
  }
  const version = loader.readTreeVersion().version;
  return { ...resolveLegacyRename({ partition, version, isExpired: loader.isCompatExpired }), renamePath };
}

function annotateLegacyRename(r, renamePath, existsFn) {
  if (!r || r.exists || !r.target || typeof renamePath !== "function") return r;
  const target = norm(r.target);
  if (!LEGACY_PATH_SLUG_RE.test(target)) return r;
  const counterpart = renamePath(target);
  if (!counterpart || counterpart === target) return r;
  r.legacyCounterpart = counterpart;
  r.legacyCounterpartExists = Boolean(existsFn(r.file, counterpart));
  return r;
}

const REPO_ANCHORS = ["scripts", ".claude", "trackers", "framework", "_mc", "runtime"];
const BACKTICK_PATH_RE = new RegExp(
  "(?<![\\w./-])(?:" + REPO_ANCHORS.map((a) => a.replace(/[.]/g, "\\.")).join("|") + ")\\/[\\w./-]+\\.\\w+",
  "g",
);
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const IGNORE_MARK = "doc-ref-ignore";
const IGNORE_RE = /<!--\s*doc-ref-ignore/;

const EXCLUDED_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "worktrees",
  "releases",
]);
function isExcludedFile(rel) {
  const segs = norm(rel).split("/");
  if (segs.includes("runtime")) return true;
  return segs.some((s) => EXCLUDED_DIR_SEGMENTS.has(s));
}

function isExternalOrAnchor(t) {
  return (
    !t ||
    /^[a-z][a-z0-9+.-]*:/i.test(t) ||
    t.startsWith("#") ||
    t.startsWith("/") ||
    t.includes("<") ||
    t.includes(">") ||
    t.includes("*") ||
    t.includes("{") ||
    /\bfoo\.(js|md|ts|json)$/.test(t) ||
    t.startsWith("path/to/")
  );
}

function stripFragment(t) {
  return t.replace(/[#?].*$/, "");
}

function evaluate({ refs, allowlist, legacyRename }) {
  const findings = [];
  const allowed = [];
  let allowedRenamed = 0;
  const tolerance = legacyRename || { active: false, reason: "no legacy-rename tolerance supplied — tolerance OFF (fail closed)" };
  const prefixes = (allowlist && allowlist.pathPrefixes) || [];
  const literals = new Set((allowlist && allowlist.literals) || []);
  for (const r of refs || []) {
    if (!r || !r.target) continue;
    if (r.exists) continue;
    const target = norm(r.target);
    const candidates = [target];
    if (r.file && /^\.\.?\//.test(target)) {
      candidates.push(norm(path.posix.normalize(path.posix.join(path.posix.dirname(norm(r.file)), target))));
    }
    const allowedByPrefix = prefixes.find((p) => candidates.some((c) => c.startsWith(p)));
    if (candidates.some((c) => literals.has(c))) {
      allowed.push({ ...r, allowedBy: "literal-allowlist" });
      continue;
    }
    if (allowedByPrefix) {
      allowed.push({ ...r, allowedBy: `prefix-allowlist (${allowedByPrefix})` });
      continue;
    }
    if (r.legacyCounterpart && r.legacyCounterpartExists && tolerance.active) {
      allowed.push({ ...r, renamed: true, allowedBy: `compat-renamed (${tolerance.surface}, expires ${tolerance.expires}) -> ${r.legacyCounterpart}` });
      allowedRenamed += 1;
      continue;
    }
    let legacyNote = "";
    if (r.legacyCounterpart && !r.legacyCounterpartExists) {
      legacyNote = ` It carries the legacy slug, but its mc-renamed counterpart '${r.legacyCounterpart}' does not exist either — a pre-rename citation is allowed-renamed ONLY when that counterpart is on disk.`;
    } else if (r.legacyCounterpart) {
      legacyNote = ` Its mc-renamed counterpart '${r.legacyCounterpart}' exists, but the legacy-rename tolerance is OFF: ${tolerance.reason}.`;
    }
    findings.push({
      severity: "high",
      check: NAME,
      kind: "broken-doc-ref",
      file: r.file,
      line: r.line,
      target: r.target,
      message: `${r.file}:${r.line} cites '${r.target}' which does not resolve on disk (relative to repo root or the doc's dir). The path likely moved/renamed and this prose drifted. Repoint it, or — if the ref is legitimately absent (ephemeral/design/illustrative) — add it to doc-ref-integrity.allowlist.json or mark the line with ${IGNORE_MARK}.${legacyNote}`,
    });
  }
  return { findings, allowed, allowedRenamed };
}

function collectMd(absStart, relStart, out) {
  let entries;
  try {
    entries = fs.readdirSync(absStart, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = relStart ? `${relStart}/${e.name}` : e.name;
    if (isExcludedFile(rel)) continue;
    const abs = path.join(absStart, e.name);
    if (e.isDirectory()) {
      collectMd(abs, rel, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(norm(rel));
    }
  }
}

function scanFiles() {
  const out = [];
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(ROOT, { withFileTypes: true });
  } catch {
  }
  for (const e of rootEntries) {
    if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(e.name);
  }
  for (const dir of [".claude/agents", ".claude/commands", "trackers"]) {
    collectMd(path.join(ROOT, dir), dir, out);
  }
  return [...new Set(out)].sort();
}

function extractRefs(relFile, text) {
  const refs = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (IGNORE_RE.test(ln)) return;
    const lineNo = i + 1;
    const seen = new Set();
    const push = (target) => {
      const key = target;
      if (seen.has(key)) return;
      seen.add(key);
      refs.push({ file: relFile, line: lineNo, target });
    };
    let m;
    MD_LINK_RE.lastIndex = 0;
    while ((m = MD_LINK_RE.exec(ln))) {
      const raw = stripFragment(m[1].trim());
      if (isExternalOrAnchor(raw)) continue;
      push(raw);
    }
    const bt = ln.match(/`[^`]+`/g) || [];
    for (const span of bt) {
      const inner = span.slice(1, -1);
      BACKTICK_PATH_RE.lastIndex = 0;
      let pm;
      while ((pm = BACKTICK_PATH_RE.exec(inner))) {
        if (isExternalOrAnchor(pm[0])) continue;
        push(pm[0]);
      }
    }
  });
  return refs;
}

function refExists(relFile, target) {
  const t = stripFragment(target);
  const candidates = [
    path.join(ROOT, t),
    path.join(ROOT, path.dirname(relFile), t),
  ];
  return candidates.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return { pathPrefixes: [], literals: [] };
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8").replace(/^﻿/, ""));
  return {
    pathPrefixes: Array.isArray(raw.pathPrefixes) ? raw.pathPrefixes.map(norm) : [],
    literals: Array.isArray(raw.literals) ? raw.literals.map(norm) : [],
  };
}

function run() {
  const notes = [];
  let allowlist;
  try {
    allowlist = loadAllowlist();
  } catch (e) {
    return { ok: false, fatal: true, problems: [`allowlist unreadable: ${e.message}`], notes };
  }
  let files;
  try {
    files = scanFiles();
  } catch (e) {
    return { ok: false, fatal: true, problems: [`canon scan failed: ${e.message}`], notes };
  }
  const legacy = loadLegacyRename();
  const refs = [];
  for (const rel of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    for (const r of extractRefs(rel, text)) {
      r.exists = refExists(r.file, r.target);
      annotateLegacyRename(r, legacy.renamePath, refExists);
      refs.push(r);
    }
  }

  const legacyRename = { active: legacy.active, surface: legacy.surface, expires: legacy.expires, reason: legacy.reason };
  const { findings, allowed, allowedRenamed } = evaluate({ refs, allowlist, legacyRename });

  notes.push(
    `${files.length} canon doc(s) · ${refs.length} repo-path ref(s) · ${findings.length} broken · ${allowed.length - allowedRenamed} allowed-absent · ${allowedRenamed} allowed-renamed`,
  );
  notes.push(`legacy-rename tolerance ${legacyRename.active ? "ON" : "OFF"}: ${legacyRename.reason}`);
  const problems = findings.map((f) => f.message);
  return { ok: findings.length === 0, fatal: false, problems, notes, findings, allowed, allowedRenamed, legacyRename };
}

function main() {
  const asJson = process.argv.includes("--json");
  const enforce =
    process.argv.includes("--enforce") || mcEnv.readEnv("DOC_REF_INTEGRITY_ENFORCE") === "block";
  let res;
  try {
    res = run();
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson
        ? JSON.stringify({ ok: false, check: NAME, error: msg })
        : `ERROR  [${NAME}] runner error (fail-closed): ${msg}`) + "\n",
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
  process.stderr.write(`${label} [${NAME}] (${mode}) ${res.findings.length} broken doc ref(s):\n`);
  for (const f of res.findings) process.stderr.write(`  - ${f.message}\n`);
  if (res.notes.length) process.stderr.write(`  (${res.notes.join(" · ")})\n`);
  process.exit(enforce ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  evaluate,
  extractRefs,
  refExists,
  scanFiles,
  loadAllowlist,
  isExternalOrAnchor,
  resolveLegacyRename,
  loadLegacyRename,
  annotateLegacyRename,
  run,
  ALLOWLIST_FILE,
  REPO_ANCHORS,
  LEGACY_RENAME_SURFACE,
};
