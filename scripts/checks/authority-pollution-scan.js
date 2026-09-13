#!/usr/bin/env node
"use strict";
/**
 * authority-pollution-scan.js — the STANDING authority-pollution enforcer (SP-20260718-004 Phase 2,
 * G2.3; CORE-3). Exits non-zero if any NEUTRAL/ambient instruction surface — a file EVERY provider
 * auto-loads for EVERY role, dispatched workers included — asserts a top-level IDENTITY, a default
 * top-level role BINDING, or unconditional operator-facing AUTHORITY. Such prose can never manufacture
 * a binding (CORE-3), but its PRESENCE in a neutral surface is the leak this closes: a dispatched
 * worker that auto-loads it reads authority it must never have.
 *
 * HONEST SCOPE (β spine — do NOT overclaim): this scan is a DETECTOR at the R6 completeness ceiling. A
 * WORD/pattern match is a LOWER BOUND — a paraphrase ("the operator trusts your judgment on shipping"
 * vs "you have merge authority") can slip. The scan is DEFENSE-IN-DEPTH; the real guarantee is
 * STRUCTURAL (scripts/dispatch/role-resolver.js derives a worker's role from the CHANNEL, so ambient
 * text is INERT-BY-CONSTRUCTION regardless of phrasing). Pairs with contract-lint.js / conformance-
 * matrix.js (the CORE-1/CORE-3 structural enforcers).
 *
 * SURFACE SET (labelled LOWER BOUND, P-057): the LIVE provider-neutral auto-load surfaces —
 *   - AGENTS.md   (codex auto-loads root AGENTS.md into EVERY run, worker or not)
 *   - GEMINI.md   (the gemini/agy neutral shim)
 *   - a non-root CLAUDE.md (a worktree/stale copy a dispatched Claude worker auto-loads — the G2.4
 *     President-leak surface; the canonical ROOT CLAUDE.md is EXEMPT — it is the Claude helm's trusted
 *     explicit_top_level_helm projection for the top-level session, R4-3, never a neutral surface).
 * IMPLEMENTATION IS A HAND-LIST, LABELLED (honest scope — gauntlet R1 BE-CQ-004): collectSurfaces
 * recursively scans a FIXED BASENAME SET (AGENTS.md / GEMINI.md / non-root CLAUDE.md) with skip rules — it
 * does NOT inspect provider harness configuration or an effective-context graph. That basename list is a
 * LOWER BOUND (P-057). Deriving the surface set from how the harness ACTUALLY assembles a worker's context
 * (imports/@includes, agent-spec loads, shims, generated projections, handoff prompts) is the completeness
 * upgrade this scan does NOT yet do — tracked debt, not a delivered property. Role-specific projections
 * (.claude/agents/**, the root CLAUDE.md helm binding) are NOT neutral surfaces — each is scoped to one
 * role's own identity — and are intentionally out of scope.
 *
 * Exit: 0 clean · 1 a neutral surface asserts identity/default-binding/authority · 2 usage/internal.
 * Wired into /scan:full + CI; self-detecting on RE-INTRODUCTION (a new worktree CLAUDE.md / neutral
 * shim / stale handoff that reintroduces ambient authority trips it).
 */
const fs = require("fs");
const path = require("path");

function resolveRoot() {
  const anchor = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchor, ".claude"))) return anchor;
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (envRoot && fs.existsSync(path.join(envRoot, ".claude"))) return envRoot;
  return anchor;
}

// Directories that are NOT the live effective graph: vendored, VCS, test fixtures, backups, archives,
// the original packet, worktree salvage, and the v1 rebuild WIP. A neutral surface INSIDE one of these
// is not auto-loaded by a live worker, so scanning it would false-positive on scaffolded/archived copies.
const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);
// Skip SEGMENTS matched against the path RELATIVE TO THE SCAN ROOT — so the standing canonical scan
// skips these subtrees, but a test/CI run that points --root AT one of them (e.g. the committed
// authority-pollution fixture) still scans it (its relative path no longer contains the skip segment).
const SKIP_REL_SEGMENTS = [
  "node_modules",
  ".git",
  "test-fixtures",
  "packet-original",
  "worktree-salvage",
  "archive",
  "authority-pollution", // the committed G2.3 fixture subtree (see fixtures/authority-pollution/)
];
// Relative-path substrings for dirs whose NAME carries the marker (backups, the v1 rebuild WIP).
const SKIP_REL_SUBSTR = [".mc-backup", "mc-v1", path.sep + "backup"];

// The neutral surfaces (basenames) + which is EXEMPT at the canonical root.
const NEUTRAL_BASENAMES = new Set(["AGENTS.md", "GEMINI.md", "CLAUDE.md"]);

// ── Detection patterns (LOWER BOUND — see honest-scope note). Reader-DIRECTED assertions only, so a
// descriptive mention ("Alex is the President of this company") in a neutral doc does NOT trip it; only
// a second-person identity/authority assertion or a default-role binding does. ──
const PATTERNS = [
  {
    id: "identity-assertion",
    re: /\byou\s+are\s+(?:alex\b|the\s+president\b|alpha\b|alex[-\s]?alpha\b)/i,
    what: "a neutral surface asserts a top-level IDENTITY to the reader (you are Alex/Alpha/President)",
  },
  {
    id: "default-binding",
    // The class β flagged as the one that matters: a rule-#5-STYLE default top-level role binding in a
    // neutral file. Matches the literal form AND common paraphrases.
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
    // G2.6 (operator-voice helm-only): the operator-voice/operator-audience directive (ELI5-default,
    // "lead every operator-facing answer") is AUDIENCE-scoped and belongs ONLY in a helm binding — never
    // in a neutral surface EVERY provider auto-loads for EVERY role (a dispatched worker has no operator
    // audience). Its presence in a neutral file is the pollution G2.6 asserts against ("projected helm-only").
    id: "operator-audience",
    re: /\b(?:lead\s+every\s+operator[-\s]?facing|operator[-\s]?facing\s+answer|eli5[-\s]?default|when\s+(?:talking|speaking|responding)\s+to\s+the\s+operator|operator[-\s]?voice\s+directive)\b/i,
    what: "a neutral surface carries an OPERATOR-AUDIENCE / operator-voice directive (must be helm-only, G2.6)",
  },
];

// Skip decision RELATIVE to the scan root. A subtree is skipped only when its path BELOW the scanned
// root contains a skip segment — pointing --root directly at such a subtree scans it (its own relative
// path no longer contains the segment), which is what lets the fixture test prove a catch.
function shouldSkipRel(rel) {
  if (!rel || rel.startsWith("..")) return false; // outside root — don't skip (explicit root)
  const relLower = rel.toLowerCase();
  const segs = relLower.split(path.sep);
  if (segs.some((s) => SKIP_REL_SEGMENTS.includes(s))) return true;
  return SKIP_REL_SUBSTR.some((s) => relLower.includes(s.toLowerCase()));
}

/** Collect the LIVE neutral instruction surfaces under root (excluding the exempt canonical root CLAUDE.md). */
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
        // The canonical root CLAUDE.md is the Claude-helm projection (R4-3) — EXEMPT. A CLAUDE.md
        // ANYWHERE ELSE is a worktree/stale ambient copy a dispatched worker auto-loads (the leak).
        if (e.name === "CLAUDE.md" && abs === rootClaude) continue;
        out.push(abs);
      }
    }
  }
  return out;
}

/** Scan a set of surfaces; returns { violations: [{file, line, patternId, what, text}] }. */
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

/** Full scan over a root. Returns { root, surfaces, violations }. */
function scan(root = resolveRoot()) {
  const surfaces = collectSurfaces(root);
  const { violations } = scanSurfaces(surfaces, root);
  return { root, surfaceCount: surfaces.length, surfaces, violations };
}

module.exports = { scan, scanSurfaces, collectSurfaces, PATTERNS, resolveRoot };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const ri = argv.indexOf("--root");
  const root = ri !== -1 && argv[ri + 1] ? path.resolve(argv[ri + 1]) : resolveRoot();
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "authority-pollution-scan — G2.3 standing enforcer. Fails if a NEUTRAL instruction surface\n" +
        "(AGENTS.md / GEMINI.md / a non-root CLAUDE.md) asserts a top-level identity, a default top-level\n" +
        "role binding, or unconditional operator authority. The canonical ROOT CLAUDE.md (Claude-helm\n" +
        "projection) is exempt. Detector at the R6 completeness ceiling (lower bound); the STRUCTURAL\n" +
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
      `OK   [authority-pollution-scan] ${res.surfaceCount} neutral surface(s) scanned — zero ambient authority/identity (G2.3, CORE-3).\n`,
    );
  } else {
    process.stdout.write(
      `FAIL [authority-pollution-scan] ${res.violations.length} authority-pollution violation(s) in the neutral instruction graph (CORE-3):\n`,
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
