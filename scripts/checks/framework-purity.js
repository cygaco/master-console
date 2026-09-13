#!/usr/bin/env node
/**
 * scripts/checks/framework-purity.js — refuse product-content leaks in the
 * public framework repo. FAIL-CLOSED, FULL-TREE by default (S-OS-04 / ED-417).
 *
 * SP-20260522-001 / T-180-followup introduced this gate in DIFF mode with a
 * pending-scrub allow-list for the private product slugs. S-OS-04 flipped it:
 * the default mode scans every git-TRACKED file (what actually ships), the
 * slug detector has no pending-scrub exemptions, and a violation exits 1.
 *
 * Detectors (HARD — each one fails the gate):
 *
 *   1. CLIENT-SLUG   — Known private product slugs in tracked file content
 *                      (CLIENT_SLUGS). Only planning/history RECORDS are
 *                      exempt (ALLOW_CLIENT_SLUG_PATHS: trackers, ROADMAP,
 *                      release changelogs, the dream journal) — never shipped
 *                      framework content.
 *   2. ABS-PATH      — Maintainer-home absolute paths in EXECUTABLE / CONFIG
 *                      files under scripts/ and .claude/ (.js .mjs .cjs .ps1
 *                      .sh .cmd .bat .json). Both the old `C:\Users\Vladislav`
 *                      and the current `C:\Users\Vlad\` forms, plus the
 *                      `/home/<u>/Desktop/` + `/Users/<u>/Desktop/` forms.
 *                      DELIBERATELY NOT applied to docs/logs/markdown: the
 *                      operator is a public figure and old paths inside prose
 *                      or historical logs are fine — a hardcoded path in a
 *                      script is a portability bug AND a leak; in a doc it is
 *                      neither.
 *   3. PROMOTE-RELIC — Reintroduction of any of the purged promote-suite
 *                      paths/tokens (SP-20260522-001).
 *
 * Plus two REPORT-ONLY advisories (never affect the exit code):
 *
 *   • ROOT-LEAK      — Files under `_requirements/` or `_docs/` at canonical
 *                      root. The canonical repo dogfoods its own product canon
 *                      there (66 + 113 tracked files); whether to relocate them
 *                      is a scope decision outside this gate, so it REPORTS
 *                      (visible) instead of the previous silent-off
 *                      ROOT_LEAK_PENDING_SCRUB switch.
 *   • DOMAIN-VOCAB   — Product-origin domain identifiers (debitRockets,
 *                      untrusted_job_data, masterResume, targetedResumes) on
 *                      framework-neutral surfaces. NARROW hard-ref identifiers,
 *                      not broad English words (E-DISPATCH-PERFECT-001 W4).
 *
 * Modes:
 *   --full   (default) Every git-TRACKED file (`git ls-files`, so staged adds
 *            count and gitignored local state does not). The leak gate.
 *   --diff   Scan `git diff --cached` (staged) + `git diff` (unstaged) changes.
 *   --staged Scan ONLY `git diff --cached` (staged) changes — the COMMIT gate
 *            (WI-23), wired into scripts/hooks/framework-purity-guard.js.
 *
 * Usage:
 *   node scripts/checks/framework-purity.js [--full | --diff | --staged] [--json] [--quiet]
 *
 * Exit codes:
 *   0  clean — no violations
 *   1  violations detected
 *   2  CLI / git error (fail-closed: an unreadable tree never reads green)
 *
 * Enforcer of its own contract: scripts/checks/framework-purity.test.js
 * (detector unit tests) + scripts/checks/framework-purity-gate.test.js
 * (planted-leak RED proof against a throwaway git repo, via WARPOS_PURITY_ROOT).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// REPO_ROOT defaults to the canonical repo (two levels up from this file).
// WARPOS_PURITY_ROOT is a test-only seam: it lets the test suite point the
// scanner at a throwaway git repo so the modes can be exercised hermetically
// without a false-RED on the real working tree.
const REPO_ROOT = process.env.WARPOS_PURITY_ROOT
  ? path.resolve(process.env.WARPOS_PURITY_ROOT)
  : path.resolve(__dirname, "..", "..");

// ── Legacy-slug live-dir detector (S-OS-06 T2, resolution R1) ────────
// The ONE literal this detector searches for sits on the next line. That line is a
// Class-3 occurrence pin in the rename partition (anchor "const LEGACY_SLUG_NEEDLE = "),
// so the rename codemod never rewrites the detector into searching for its own output.
const LEGACY_SLUG_NEEDLE = "warpos";
// Version on-switch: REPORT-ONLY below this major (before the cut the live tree still
// carries the legacy slug everywhere), ENFORCING at/above it. An unreadable or
// unparseable package.json version fails closed INTO enforcement.
const LEGACY_SLUG_ENFORCE_MAJOR = 2;

// The partition (allow-view + dispositions) is read ONLY through the one loader
// (β r3 Req1). Lazy so a missing loader is a fail-closed exit 2, not a crash.
function loadGatePartition() {
  const loader = require("../open-source/partition-loader");
  return loader.loadPartition({ forceReload: true });
}

function resolveLegacySlugMode(opts) {
  if (opts && opts.enforceLegacySlug) {
    return { enforce: true, version: null, reason: "--enforce-legacy-slug" };
  }
  let version;
  try {
    const raw = fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8");
    version = JSON.parse(raw.replace(/^﻿/, "")).version;
  } catch (e) {
    return {
      enforce: true,
      version: null,
      reason: `package.json unreadable (${e.code || e.name}) — enforcing (fail closed)`,
    };
  }
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ""));
  if (!m) {
    return {
      enforce: true,
      version: version === undefined ? null : version,
      reason: `package.json version ${JSON.stringify(version)} unparseable — enforcing (fail closed)`,
    };
  }
  const enforce = Number(m[1]) >= LEGACY_SLUG_ENFORCE_MAJOR;
  return {
    enforce,
    version,
    reason: enforce
      ? `package.json ${version} >= ${LEGACY_SLUG_ENFORCE_MAJOR}.0.0`
      : `package.json ${version} < ${LEGACY_SLUG_ENFORCE_MAJOR}.0.0 — report-only until the cut`,
  };
}

// ── Configurable rule set ────────────────────────────────────────────

// Private product slugs. This list is the DEFINITION of the detector and is
// the one sanctioned place the slugs appear in shipped content (self-exempt).
const CLIENT_SLUGS = [
  "Jobzooka",
  "jobzooka",
  "DreamTeam",
  "dreamteam",
  "Dreamteam",
  "aiweb", // operator-confirmed portfolio product
  "ai-web",
  "companycam",
  "CompanyCam",
];

// REPORT-ONLY domain-vocabulary advisory. NARROW hard-ref identifiers from the
// origin resume/job-application product — NOT broad English words.
// Deliberately excludes "resume"/"job"/"market" (false-positive storm).
const DOMAIN_VOCAB_TOKENS = [
  "debitRockets",
  "untrusted_job_data",
  "masterResume",
  "targetedResumes",
];

// Maintainer-home absolute paths. `[\\/]+` so JSON-escaped `C:\\Users\\…`
// (double backslash) and forward-slash forms both match.
const ABS_PATH_PATTERNS = [
  /C:[\\/]+Users[\\/]+Vladislav/i, // old home dir
  /C:[\\/]+Users[\\/]+Vlad(?![A-Za-z0-9_-])/i, // current home dir (`C:\Users\Vlad\…`)
  /\/c\/Users\/Vlad/i, // msys / Git-Bash form
  /\/home\/[^/\s]+\/Desktop\//,
  /\/Users\/[^/\s]+\/Desktop\//,
];

// The abs-path rule is SCOPED to executable/config files under these roots.
const ABS_PATH_SCOPE_PREFIXES = ["scripts/", ".claude/"];
const ABS_PATH_SCOPE_EXTS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ps1",
  ".sh",
  ".cmd",
  ".bat",
  ".json",
]);

function inAbsPathScope(rel) {
  if (!ABS_PATH_SCOPE_PREFIXES.some((p) => rel.startsWith(p))) return false;
  return ABS_PATH_SCOPE_EXTS.has(path.posix.extname(rel).toLowerCase());
}

const PROMOTE_RELIC_FILES = [
  "scripts/warpos/promote.js",
  "scripts/warpos/promote-flags.js",
  "scripts/warpos/flag.js",
  "scripts/warpos/manifest/promote.js",
  ".claude/commands/warp/promote.md",
  ".claude/commands/warp/promote-flags.md",
  // warp/flag.md is intentionally NOT a relic: redefined 2026-05-26 as the MC.md
  // gap-register PRODUCER (canonical reads it via /warp:reconcile; it does not push
  // code upstream, so it does not reopen the promote surface SP-20260522-001 closed).
  "warpos-to-update.md",
  ".warpos-sync.json",
  ".warpos-sync-commit-msg.txt",
  "warpos-promoted-archive.md",
];

const PROMOTE_RELIC_REGEX = [
  /\bwarposFlagLedger\b/,
  /\bwarposPromotedArchive\b/,
  /\bwarposPromoteReports\b/,
  // /warp:flag freed 2026-05-26 — now the gap-register producer, not the purged promote relic
  /\b\/warp:promote\b/, // (release.md exception handled per-file)
  /\b\/warp:promote-flags\b/,
];

const ROOT_LEAK_PREFIXES = ["_requirements/", "_docs/"];

// ── Skip surfaces ────────────────────────────────────────────────────

// Paths where a client-slug reference is ALLOWED. ONE class only: planning /
// history RECORDS that document de-contaminating the product (a tracker that
// says "sweep <slug> vocab" is not shipped framework content). The former
// pending-scrub entries (_mc/EXAMPLES/, _docs/{briefs,clones,imports,
// research}/, scripts/portfolio/, _index/) are GONE — S-OS-04 untracked the
// private trees and neutralised the remaining mentions instead.
const ALLOW_CLIENT_SLUG_PATHS = [
  /^scripts\/checks\/framework-purity\.js$/, // self-reference: the slug list IS the detector
  /^\.claude\/project\/sprint\//, // historical sprint planning records
  /^\.claude\/dreams\//, // operator's private journal (history)
  /^\.claude\/project\/decisions\//, // historical decisions
  /^\.claude\/project\/learnings\//, // historical learnings
  /^framework\/releases\/.+\/changelog\.md$/, // shipped release notes (history)
  /^ROADMAP\.md$/, // the purge plan itself
  /^RELEASES\.md$/, // shipped release history
  /^trackers\//, // epic + sprint trackers legitimately NAME the product they document de-contaminating (planning/history record, never shipped framework content)
  /^_planning\/epics\//, // the epic trackers' companion plan artifacts (same rationale)
  /^_mc\/MANIFEST\.json$/, // DERIVED view of the tree (regenerated by the manifest build); a slug path listed here implies the same path in the tree, which this gate catches directly
];

// File patterns where DOMAIN_VOCAB advisory hits are suppressed — surfaces that
// legitimately name the identifiers (the detector's own definition + its test).
const ALLOW_DOMAIN_VOCAB_PATHS = [
  /^scripts\/checks\/framework-purity\.js$/, // self-reference (token list)
  /^scripts\/checks\/framework-purity\.test\.js$/, // planted-fixture test
];

// File patterns where PROMOTE_RELIC is allowed — historical docs +
// migration notes legitimately reference the purged identifiers to
// document the retirement.
const ALLOW_PROMOTE_RELIC_PATHS = [
  /^scripts\/checks\/framework-purity\.js$/, // self-reference
  /^\.claude\/commands\/scan\/framework-purity\.md$/, // skill body
  /^\.claude\/commands\/check\/framework-purity\.md$/, // deprecated alias skill body
  /^scripts\/hooks\/framework-purity-guard\.js$/, // hook
  /^ROADMAP\.md$/, // documents the retirement plan
  /^RELEASES\.md$/, // shipped release history
  /^\.claude\/project\/sprint\//, // historical sprint planning
  /^\.claude\/dreams\//, // operator journal
  /^framework\/releases\/.+\/changelog\.md$/,
  /^_mc\/MANIFEST\.json$/,
  /^scripts\/hooks\/version-bump-guard\.js$/, // FRAMEWORK_PREFIXES mirror comment
  /^scripts\/phase0-verify\.js$/, // historical test names
  /^(_mc\/BASELINE\/)?_docs\/phase0\//, // historical phase-0 report documenting the retired ledger
];

// File patterns where ABS_PATH is allowed even inside the scoped surface —
// runtime/session RECORDS that legitimately capture absolute paths from the
// maintainer's machine (they are logs, not executables).
const ALLOW_ABS_PATH_PATHS = [
  /^\.claude\/\.session-/, // .session-checkpoint.json, .session-id, etc
  /^\.claude\/\.last-checkpoint/,
  /^\.claude\/\.agent-result-hashes\.json$/,
  /^\.claude\/project\/builds\//, // builder transaction logs
  /^\.claude\/project\/sprint\//, // sprint progress records resolve abs paths
  /^\.claude\/project\/(events|memory|decisions)\//, // runtime ledgers
  /^\.claude\/runtime\//,
  /^\.claude\/agents\/.+\/events\.jsonl$/,
  /^scripts\/checks\/framework-purity\.js$/, // self-reference (the patterns)
  /^scripts\/checks\/framework-purity-gate\.test\.js$/, // planted-fixture test
  /^\.mc\//, // transaction snapshots
];

// ── Detector machinery ───────────────────────────────────────────────

function isAllowed(rel, allowList) {
  return allowList.some((re) => re.test(rel));
}

function scanContent(rel, content, findings) {
  if (typeof content !== "string") {
    throw new TypeError(`scanContent: content for ${rel} must be a string`);
  }
  // Client slug — HARD.
  if (!isAllowed(rel, ALLOW_CLIENT_SLUG_PATHS)) {
    for (const slug of CLIENT_SLUGS) {
      if (content.includes(slug)) {
        findings.client_slug.push({ path: rel, slug });
        break; // one finding per file is enough
      }
    }
  }
  // Abs path — HARD, but SCOPED to executable/config files (see header).
  if (inAbsPathScope(rel) && !isAllowed(rel, ALLOW_ABS_PATH_PATHS)) {
    for (const re of ABS_PATH_PATTERNS) {
      if (re.test(content)) {
        findings.abs_path.push({ path: rel, pattern: re.source });
        break;
      }
    }
  }
  // Promote relics in CONTENT — HARD.
  if (!isAllowed(rel, ALLOW_PROMOTE_RELIC_PATHS)) {
    for (const re of PROMOTE_RELIC_REGEX) {
      if (re.test(content)) {
        findings.promote_relic.push({
          path: rel,
          pattern: re.source,
        });
        break;
      }
    }
  }
  // Domain-vocab advisory (REPORT-ONLY — never counted toward violations).
  if (!isAllowed(rel, ALLOW_DOMAIN_VOCAB_PATHS)) {
    for (const tok of DOMAIN_VOCAB_TOKENS) {
      const re = new RegExp(`\\b${tok}\\b`);
      if (re.test(content)) {
        findings.domain_vocab.push({ path: rel, token: tok });
      }
    }
  }
}

function scanPath(rel, findings) {
  if (PROMOTE_RELIC_FILES.includes(rel)) {
    findings.promote_relic.push({
      path: rel,
      pattern: "purged-file-reintroduced",
    });
  }
  // ROOT-LEAK is REPORT-ONLY (see header).
  for (const prefix of ROOT_LEAK_PREFIXES) {
    if (rel.startsWith(prefix)) {
      findings.root_leak.push({ path: rel });
      break;
    }
  }
}

// ── Git file lists ───────────────────────────────────────────────────

function gitLines(cmd) {
  const out = execSync(cmd, {
    encoding: "utf8",
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Every git-TRACKED file (the index: committed + staged adds). Returns null on
// a git failure so the caller can fail CLOSED (exit 2) instead of scanning an
// empty list and reading green.
function gitTrackedFiles() {
  try {
    return gitLines("git ls-files");
  } catch {
    return null;
  }
}

// stagedOnly=true → only `git diff --cached` (the commit gate, WI-23).
// stagedOnly=false → staged + unstaged (the manual change-set view).
function gitChangedFiles(stagedOnly) {
  try {
    const staged = gitLines("git diff --cached --name-only --diff-filter=ACMR");
    const unstaged = stagedOnly
      ? []
      : gitLines("git diff --name-only --diff-filter=ACMR");
    return Array.from(new Set([...staged, ...unstaged]));
  } catch {
    return null;
  }
}

// ── Driver ───────────────────────────────────────────────────────────

const MAX_BYTES = 8 * 1024 * 1024; // above this a file is skipped AND reported
const BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|svg|woff2?|ttf|eot|pdf|zip|gz|tgz|tar|7z|mp[34]|wav|mov|exe|dll|node|wasm)$/i;

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function run(opts) {
  const mode = opts.mode || "full";
  const findings = {
    root_leak: [], // REPORT-ONLY advisory
    client_slug: [],
    abs_path: [],
    promote_relic: [],
    domain_vocab: [], // REPORT-ONLY advisory
  };

  let files;
  if (mode === "diff" || mode === "staged") {
    files = gitChangedFiles(mode === "staged");
  } else {
    files = gitTrackedFiles();
  }
  if (files === null) {
    return {
      ok: false,
      code: 2,
      mode,
      error: "git file listing failed — refusing to read green on an unreadable tree",
      scanned: 0,
      skipped_large: [],
      summary: null,
      findings,
    };
  }

  // S-OS-06 R1: the legacy-slug live-dir detector classifies through the ONE partition
  // loader. An unreadable/truncated partition is exit 2 (F3) — never a silent skip.
  let partition;
  try {
    partition = loadGatePartition();
  } catch (e) {
    return {
      ok: false,
      code: 2,
      mode,
      error: `rename partition unreadable — failing CLOSED (F3): ${e.message}`,
      scanned: 0,
      skipped_large: [],
      summary: null,
      findings,
      legacy_slug: null,
    };
  }
  const slugMode = resolveLegacySlugMode(opts);
  const slugTally = partition.createLegacySlugTally();
  const slugUnscanned = []; // live files too large to scan: unverifiable, fail closed when enforcing

  const skippedLarge = [];
  for (const rel of files) {
    scanPath(rel, findings);
    if (BINARY_EXT.test(rel)) continue;
    const abs = path.join(REPO_ROOT, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue; // deleted on disk but still in the index — nothing to read
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_BYTES) {
      skippedLarge.push(rel);
      const cls = partition.classifyPath(rel);
      if (cls.class === 1 && cls.kind !== "generated-view") slugUnscanned.push(rel);
      continue;
    }
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;
    const text = buf.toString("utf8");
    scanContent(rel, text, findings);
    partition.tallyLegacySlug(slugTally, rel, text, LEGACY_SLUG_NEEDLE);
  }

  findings.legacy_slug = slugMode.enforce
    ? [
        ...Object.entries(slugTally.pendingByFile)
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .map(([p, count]) => ({ path: p, pattern: `${count} live-unallowed`, sample: slugTally.pendingSamples[p] || null })),
        ...slugUnscanned.map((p) => ({ path: p, pattern: "unscanned (too large) — unverifiable" })),
      ]
    : [];

  // root_leak + domain_vocab are ADVISORY and deliberately excluded from the
  // violation count — they must never flip the exit code. legacy_slug counts only
  // when ENFORCING (package.json >= 2.0.0, or --enforce).
  const violationCount =
    findings.client_slug.length +
    findings.abs_path.length +
    findings.promote_relic.length +
    findings.legacy_slug.length;

  return {
    ok: violationCount === 0,
    code: violationCount === 0 ? 0 : 1,
    mode,
    scanned: files.length,
    skipped_large: skippedLarge,
    summary: {
      client_slug: findings.client_slug.length,
      abs_path: findings.abs_path.length,
      promote_relic: findings.promote_relic.length,
      legacy_slug: slugTally.pendingTotal + slugUnscanned.length, // a violation only when enforcing
      root_leak: findings.root_leak.length, // advisory, not a violation
      domain_vocab: findings.domain_vocab.length, // advisory, not a violation
    },
    legacy_slug: {
      enforce: slugMode.enforce,
      version: slugMode.version,
      reason: slugMode.reason,
      live_unallowed: slugTally.pendingTotal,
      unscanned: slugUnscanned,
      suppressed: slugTally.suppressedTotal,
      pinned: slugTally.pinnedTotal,
      derived: slugTally.derivedTotal,
      changelog_historical: slugTally.changelogHistoricalTotal,
      suppressed_by_entry: slugTally.suppressedByEntry,
      pinned_by_pin: slugTally.pinnedByPin,
      derived_by_view: slugTally.derivedByView,
      pending_by_file: slugTally.pendingByFile,
      formatted: partition.formatLegacySlugTally(slugTally, { indent: "    ", maxPending: slugMode.enforce ? 0 : 10 }),
    },
    findings,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    mode: "full",
    json: false,
    quiet: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--full") out.mode = "full";
    else if (a === "--diff") out.mode = "diff";
    else if (a === "--staged") out.mode = "staged";
    else if (a === "--json") out.json = true;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--enforce" || a === "--enforce-legacy-slug") out.enforceLegacySlug = true;
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
scripts/checks/framework-purity.js — refuse product-content leaks in canonical (fail-closed)

Usage:
  node scripts/checks/framework-purity.js [--full | --diff | --staged] [--json] [--quiet]

Hard detectors (each one fails the gate):
  client_slug     private product slugs (CLIENT_SLUGS) in tracked file content;
                  only planning/history records are exempt
  abs_path        maintainer-home absolute paths in executable/config files
                  under scripts/ and .claude/ (.js .mjs .cjs .ps1 .sh .cmd .bat .json)
  promote_relic   reintroduction of /warp:promote-suite paths or tokens
  legacy_slug     the pre-rebrand slug in a LIVE (Class-1, non-pinned, non-derived) path,
                  classified through scripts/open-source/partition-loader.js. REPORT-ONLY
                  (prints the pending count) while package.json < 2.0.0; ENFORCING at
                  >= 2.0.0 or with --enforce. Suppressed counts are always printed.

Advisory (report-only — never affects the exit code):
  root_leak       _requirements/ or _docs/ at canonical root
  domain_vocab    origin-product domain identifiers on framework-neutral surfaces

Modes:
  --full  (default)  every git-tracked file (git ls-files) — the leak gate
  --diff             git diff --cached + git diff (staged + unstaged)
  --staged           git diff --cached only (the commit gate, WI-23)
  --enforce          force the legacy_slug detector ON regardless of package.json

Exit codes:
  0  clean
  1  violations
  2  CLI / git error (fail-closed)
`);
}

function formatHuman(r) {
  const lines = [];
  lines.push(`scripts/checks/framework-purity.js — ${r.mode} mode`);
  if (r.error) {
    lines.push(`  ERROR: ${r.error}`);
    lines.push(`  result: FAIL (exit ${r.code})`);
    return lines.join("\n") + "\n";
  }
  lines.push(`  scanned files:  ${r.scanned}`);
  if (r.skipped_large.length) {
    lines.push(`  skipped (> ${MAX_BYTES} bytes): ${r.skipped_large.length}`);
  }
  lines.push("");
  lines.push("  violations:");
  lines.push(`    client_slug:     ${r.summary.client_slug}`);
  lines.push(`    abs_path:        ${r.summary.abs_path}`);
  lines.push(`    promote_relic:   ${r.summary.promote_relic}`);
  if (r.legacy_slug) {
    const ls = r.legacy_slug;
    lines.push(
      `    legacy_slug:     ${r.summary.legacy_slug}  [${ls.enforce ? "ENFORCING" : "REPORT-ONLY — pending until the cut"}: ${ls.reason}]`
    );
    lines.push("");
    lines.push("  legacy slug partition tally:");
    lines.push(...ls.formatted);
    if (ls.unscanned.length) lines.push(`    unscanned live files (too large): ${ls.unscanned.length}`);
  }
  lines.push("");
  lines.push(`  advisory (report-only, does NOT affect exit code):`);
  lines.push(`    root_leak:       ${r.summary.root_leak}`);
  lines.push(`    domain_vocab:    ${r.summary.domain_vocab}`);
  for (const k of Object.keys(r.findings)) {
    const list = r.findings[k];
    if (list.length === 0) continue;
    lines.push("");
    const advisory = k === "domain_vocab" || k === "root_leak";
    const label = advisory ? `${k.toUpperCase()} (advisory)` : k.toUpperCase();
    lines.push(`  ${label}:`);
    const cap = advisory ? 5 : 50;
    for (const f of list.slice(0, cap)) {
      const tag = f.slug || f.pattern || f.token;
      const detail = tag ? `  [${tag}]` : "";
      lines.push(`    - ${f.path}${detail}`);
    }
    if (list.length > cap) {
      lines.push(`    ... and ${list.length - cap} more`);
    }
  }
  lines.push("");
  lines.push(`  result: ${r.ok ? "OK" : "FAIL"} (exit ${r.code})`);
  return lines.join("\n") + "\n";
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  let r;
  try {
    r = run(opts);
  } catch (e) {
    // A runner error is never a pass and never a plain violation: exit 2 (fail closed).
    const msg = String((e && e.message) || e);
    process.stdout.write(
      opts.json ? JSON.stringify({ ok: false, code: 2, error: msg }) + "\n" : `framework-purity: runner error (fail-closed): ${msg}\n`
    );
    return 2;
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else if (!opts.quiet) {
    process.stdout.write(formatHuman(r));
  }
  return r.code;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  run,
  scanContent,
  scanPath,
  inAbsPathScope,
  resolveLegacySlugMode,
  LEGACY_SLUG_ENFORCE_MAJOR,
  CLIENT_SLUGS,
  ABS_PATH_PATTERNS,
  DOMAIN_VOCAB_TOKENS,
};
