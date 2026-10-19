#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

function resolveRoot() {
  const anchor = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchor, ".claude"))) return anchor;
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (envRoot && fs.existsSync(path.join(envRoot, ".claude"))) return envRoot;
  return anchor;
}

const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);
const SKIP_REL_SEGMENTS = [
  "node_modules",
  ".git",
  "test-fixtures",
  "archive",
  "authority-pollution",
];
const SKIP_REL_SUBSTR = [".mc-backup", path.sep + "backup"];

const LOCAL_SKIPS_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  ".claude",
  "project",
  "memory",
  "authority-pollution-skip.local.json",
);
const NO_LOCAL_SKIPS = "none (no instance-local skip file)";
let localSkipsCache;

function loadLocalSkips() {
  if (localSkipsCache !== undefined) return localSkipsCache;
  const BAD =
    'authority-pollution-scan: instance-local skip file malformed (expected { "skipSegments": ["…"], "skipSubstrings": ["…"] } of non-empty strings; a segment has no path separator)';
  let raw;
  try {
    raw = fs.readFileSync(LOCAL_SKIPS_FILE, "utf8").replace(/^﻿/, "");
  } catch (e) {
    if (e && e.code === "ENOENT") return (localSkipsCache = null);
    throw new Error("authority-pollution-scan: instance-local skip file unreadable");
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    throw new Error(BAD);
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error(BAD);
  if (!("skipSegments" in cfg) && !("skipSubstrings" in cfg)) throw new Error(BAD);
  const okList = (v, noSep) =>
    v === undefined ||
    (Array.isArray(v) && v.every((s) => typeof s === "string" && s && !(noSep && /[\\/]/.test(s))));
  if (!okList(cfg.skipSegments, true) || !okList(cfg.skipSubstrings, false)) throw new Error(BAD);
  localSkipsCache = {
    segments: (cfg.skipSegments || []).map((s) => s.toLowerCase()),
    substrings: cfg.skipSubstrings || [],
  };
  return localSkipsCache;
}

function instanceSkipStatus() {
  const local = loadLocalSkips();
  return local ? local.segments.length + local.substrings.length : NO_LOCAL_SKIPS;
}

const NEUTRAL_BASENAMES = new Set(["AGENTS.md", "GEMINI.md", "CLAUDE.md"]);

const PATTERNS = [
  {
    id: "identity-assertion",
    re: /\byou\s+are\s+(?:alex\b|the\s+president\b|alpha\b|alex[-\s]?alpha\b)/i,
    what: "a neutral surface asserts a top-level IDENTITY to the reader (you are Alex/Alpha/President)",
  },
  {
    id: "default-binding",
    re: /\b(?:default\s+top[-\s]?level\s+human[-\s]?facing\s+role\s*[:=]\s*(?:alex[-\s]?)?alpha\b|top[-\s]?level\s+(?:human[-\s]?facing\s+)?(?:session\s+)?default(?:s)?\s*(?:[:=]|\bis\b|\bto\b)\s*(?:the\s+)?(?:alex[-\s]?)?(?:alpha|president)\b|defaults?\s+to\s+(?:alex[-\s]?alpha|the\s+president)\b)/i,
    what: "a neutral surface plants a DEFAULT top-level role binding (default human-facing role = alpha)",
  },
  {
    id: "authority-grant",
    re: /\byou\s+(?:have|hold|are\s+granted|possess)\s+(?:the\s+|unconditional\s+|full\s+)?(?:merge|deploy(?:ment)?|approval|release|integration|push)\s+authority\b/i,
    what: "a neutral surface grants the reader unconditional merge/deploy/approval/integration AUTHORITY",
  },
  {
    id: "authority-permission",
    re: /\byou\s+(?:may|can|are\s+authoriz(?:ed|ed\s+to))\s+(?:approve|merge|deploy|release|integrate)\b(?![^.\n]{0,40}\b(?:propos|worktree|isolated|request|draft)\b)/i,
    what: "a neutral surface tells the reader they may approve/merge/deploy/release (unconditional)",
  },
  {
    id: "operator-audience",
    re: /\b(?:lead\s+every\s+operator[-\s]?facing|operator[-\s]?facing\s+answer|eli5[-\s]?default|when\s+(?:talking|speaking|responding)\s+to\s+the\s+operator|operator[-\s]?voice\s+directive)\b/i,
    what: "a neutral surface carries an OPERATOR-AUDIENCE / operator-voice directive (must be helm-only)",
  },
];

function shouldSkipRel(rel) {
  if (!rel || rel.startsWith("..")) return false;
  const local = loadLocalSkips() || { segments: [], substrings: [] };
  const relLower = rel.toLowerCase();
  const segs = relLower.split(path.sep);
  if (segs.some((s) => SKIP_REL_SEGMENTS.includes(s) || local.segments.includes(s))) return true;
  return SKIP_REL_SUBSTR.concat(local.substrings).some((s) => relLower.includes(s.toLowerCase()));
}

function collectSurfaces(root) {
  const rootClaude = path.join(root, "CLAUDE.md");
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(e.name)) continue;
        if (shouldSkipRel(path.relative(root, abs))) continue;
        stack.push(abs);
      } else if (e.isFile() && NEUTRAL_BASENAMES.has(e.name)) {
        if (shouldSkipRel(path.relative(root, abs))) continue;
        if (e.name === "CLAUDE.md" && abs === rootClaude) continue;
        out.push(abs);
      }
    }
  }
  return out;
}

function scanSurfaces(surfaces, root) {
  const violations = [];
  for (const file of surfaces) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const p of PATTERNS) {
        if (p.re.test(line)) {
          violations.push({
            file: root ? path.relative(root, file) : file,
            line: i + 1,
            patternId: p.id,
            what: p.what,
            text: line.trim().slice(0, 160),
          });
        }
      }
    }
  }
  return { violations };
}

function scan(root = resolveRoot()) {
  const instanceSkips = instanceSkipStatus();
  const surfaces = collectSurfaces(root);
  const { violations } = scanSurfaces(surfaces, root);
  return { root, surfaceCount: surfaces.length, surfaces, violations, instanceSkips };
}

module.exports = { scan, scanSurfaces, collectSurfaces, PATTERNS, resolveRoot, LOCAL_SKIPS_FILE };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const ri = argv.indexOf("--root");
  const root = ri !== -1 && argv[ri + 1] ? path.resolve(argv[ri + 1]) : resolveRoot();
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "authority-pollution-scan — standing enforcer. Fails if a NEUTRAL instruction surface\n" +
        "(AGENTS.md / GEMINI.md / a non-root CLAUDE.md) asserts a top-level identity, a default top-level\n" +
        "role binding, or unconditional operator authority. The canonical ROOT CLAUDE.md (Claude-helm\n" +
        "projection) is exempt. Detector at the completeness ceiling (lower bound); the STRUCTURAL\n" +
        "guarantee is role-resolver.js (derived-not-settable). Usage:\n" +
        "  node scripts/checks/authority-pollution-scan.js [--root <dir>] [--json]\n" +
        "Exit: 0 clean · 1 violation · 2 usage.\n",
    );
    process.exit(0);
  }
  let res;
  try {
    res = scan(root);
  } catch (e) {
    process.stderr.write(`authority-pollution-scan: internal error (fail-closed): ${e.message}\n`);
    process.exit(2);
  }
  if (json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  } else if (res.violations.length === 0) {
    process.stdout.write(
      `OK   [authority-pollution-scan] ${res.surfaceCount} neutral surface(s) scanned — zero ambient authority/identity (CORE-3); instance-local skips: ${res.instanceSkips}.\n`,
    );
  } else {
    process.stdout.write(
      `FAIL [authority-pollution-scan] ${res.violations.length} authority-pollution violation(s) in the neutral instruction graph (CORE-3); instance-local skips: ${res.instanceSkips}:\n`,
    );
    for (const v of res.violations) {
      process.stdout.write(`  ${v.file}:${v.line}  [${v.patternId}] ${v.what}\n    > ${v.text}\n`);
    }
    process.stdout.write(
      "A neutral surface can never MANUFACTURE a binding (CORE-3), but its presence leaks authority to any\n" +
        "worker that auto-loads it. Move it into a role-scoped helm projection, or remove it.\n",
    );
  }
  process.exit(res.violations.length === 0 ? 0 : 1);
}
