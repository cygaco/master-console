#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = mcEnv.readEnv("PURITY_ROOT")
  ? path.resolve(mcEnv.readEnv("PURITY_ROOT"))
  : path.resolve(__dirname, "..", "..");

const LEGACY_SLUG_NEEDLE = "warpos";
const LEGACY_SLUG_ENFORCE_MAJOR = 2;

const PARTITION_LOADER_DEFAULT = path.resolve(__dirname, "..", "open-source", "partition-loader.js");
function resolveLoaderPath(opts) {
  const p = (opts && opts.partitionLoaderPath) || mcEnv.readEnv("PURITY_PARTITION_LOADER");
  return p ? path.resolve(p) : PARTITION_LOADER_DEFAULT;
}
function loadGatePartition(opts) {
  const loaderPath = resolveLoaderPath(opts);
  if (!fs.existsSync(loaderPath)) return { absent: true, loaderPath };
  const loader = loaderPath === PARTITION_LOADER_DEFAULT ? require("../open-source/partition-loader") : require(loaderPath);
  return { absent: false, partition: loader.loadPartition({ forceReload: true }) };
}
const LEGACY_SLUG_SKIP_REASON =
  "partition-loader.js not present (no rename map configured on this tree) — legacy-slug detector did NOT run";

function readRootVersion() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8").replace(/^﻿/, "")).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
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
      : `package.json ${version} < ${LEGACY_SLUG_ENFORCE_MAJOR}.0.0 — report-only below ${LEGACY_SLUG_ENFORCE_MAJOR}.0.0`,
  };
}

const SLUGS_FILE_DEFAULT = path.resolve(__dirname, "..", "..", ".claude", "project", "memory", "framework-purity.local.json");
function loadClientSlugs() {
  const BAD = "framework-purity: private slugs file unreadable, malformed, a symlink, or (required mode) tracked by git";
  const file = mcEnv.readEnv("PURITY_SLUGS_FILE") || SLUGS_FILE_DEFAULT;
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw new Error(BAD);
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(BAD);
  if (mcEnv.readEnv("REQUIRE_PRIVATE_DENYLIST") === "1") {
    const t = require("child_process").spawnSync("git", ["ls-files", "--error-unmatch", "--", path.basename(file)], { cwd: path.dirname(file), stdio: "ignore" });
    if (t.status === 0) throw new Error(BAD);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    throw new Error(BAD);
  }
  if (!cfg || !Array.isArray(cfg.clientSlugs) || cfg.clientSlugs.some((x) => typeof x !== "string" || !x)) throw new Error(BAD);
  return cfg.clientSlugs;
}
const CLIENT_SLUGS = loadClientSlugs();

const VOCAB_FILE_DEFAULT = path.resolve(__dirname, "..", "..", ".claude", "project", "memory", "framework-purity.domain-vocab.local.json");
function loadDomainVocab(file = mcEnv.readEnv("PURITY_VOCAB_FILE") || VOCAB_FILE_DEFAULT) {
  const skip = (why) => ({ status: `skipped (${why})`, terms: [] });
  let raw;
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) return skip("local term file is not a regular file");
    raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch (e) {
    return skip(e && e.code === "ENOENT" ? "no local term file" : "local term file unreadable");
  }
  let cfg;
  try { cfg = JSON.parse(raw); } catch { return skip("local term file malformed"); }
  if (!cfg || !Array.isArray(cfg.domainVocab)) return skip("local term file malformed");
  const terms = [];
  for (const t of cfg.domainVocab) {
    try {
      if (typeof t === "string" && t) terms.push({ label: t, re: new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) });
      else if (t && typeof t.pattern === "string" && t.pattern) terms.push({ label: String(t.label || t.pattern), re: new RegExp(t.pattern, String(t.flags || "").replace(/g/g, "")) });
      else return skip("local term file malformed");
    } catch {
      return skip("local term file has an invalid pattern");
    }
  }
  return { status: "loaded", terms };
}
const DOMAIN_VOCAB = loadDomainVocab();

const ABS_PATH_PATTERNS = [
  /C:[\\/]+Users[\\/]+(?![<$%{])[A-Za-z][A-Za-z0-9_-]+/i,
  /\/c\/Users\/(?![<$%{])[A-Za-z][A-Za-z0-9_-]+/i,
  /\/home\/[^/\s]+\/Desktop\//,
  /\/Users\/[^/\s]+\/Desktop\//,
];

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
  "warpos-to-update.md",
  ".warpos-sync.json",
  ".warpos-sync-commit-msg.txt",
  "warpos-promoted-archive.md",
];

const PROMOTE_RELIC_REGEX = [
  /\bwarposFlagLedger\b/,
  /\bwarposPromotedArchive\b/,
  /\bwarposPromoteReports\b/,
  /\b\/warp:promote\b/,
  /\b\/warp:promote-flags\b/,
];

const ROOT_LEAK_PREFIXES = ["_requirements/", "_docs/"];

const ALLOW_CLIENT_SLUG_PATHS = [
  /^scripts\/checks\/framework-purity\.js$/,
  /^\.claude\/project\/sprint\//,
  /^\.claude\/dreams\//,
  /^\.claude\/project\/decisions\//,
  /^\.claude\/project\/learnings\//,
  /^framework\/releases\/.+\/changelog\.md$/,
  /^ROADMAP\.md$/,
  /^RELEASES\.md$/,
  /^trackers\//,
  /^_planning\/epics\//,
  /^_mc\/MANIFEST\.json$/,
];

const ALLOW_DOMAIN_VOCAB_PATHS = [
  /^scripts\/checks\/framework-purity\.js$/,
  /^scripts\/checks\/framework-purity\.test\.js$/,
];

const ALLOW_PROMOTE_RELIC_PATHS = [
  /^scripts\/checks\/framework-purity\.js$/,
  /^\.claude\/commands\/scan\/framework-purity\.md$/,
  /^\.claude\/commands\/check\/framework-purity\.md$/,
  /^scripts\/hooks\/framework-purity-guard\.js$/,
  /^ROADMAP\.md$/,
  /^RELEASES\.md$/,
  /^\.claude\/project\/sprint\//,
  /^\.claude\/dreams\//,
  /^framework\/releases\/.+\/changelog\.md$/,
  /^_mc\/MANIFEST\.json$/,
  /^scripts\/hooks\/version-bump-guard\.js$/,
  /^scripts\/open-source\/rename-mc\.(denylist|occurrences)\.json$/,
];

const ALLOW_ABS_PATH_PATHS = [
  /^\.claude\/\.session-/,
  /^\.claude\/\.last-checkpoint/,
  /^\.claude\/\.agent-result-hashes\.json$/,
  /^\.claude\/project\/builds\//,
  /^\.claude\/project\/sprint\//,
  /^\.claude\/project\/(events|memory|decisions)\//,
  /^\.claude\/runtime\//,
  /^\.claude\/agents\/.+\/events\.jsonl$/,
  /^scripts\/checks\/framework-purity\.js$/,
  /^scripts\/checks\/framework-purity-gate\.test\.js$/,
  /^\.mc\//,
];

function isAllowed(rel, allowList) {
  return allowList.some((re) => re.test(rel));
}

function scanContent(rel, content, findings) {
  if (typeof content !== "string") {
    throw new TypeError(`scanContent: content for ${rel} must be a string`);
  }
  if (!isAllowed(rel, ALLOW_CLIENT_SLUG_PATHS)) {
    for (const slug of CLIENT_SLUGS) {
      if (content.includes(slug)) {
        findings.client_slug.push({ path: rel, slug });
        break;
      }
    }
  }
  if (inAbsPathScope(rel) && !isAllowed(rel, ALLOW_ABS_PATH_PATHS)) {
    for (const re of ABS_PATH_PATTERNS) {
      if (re.test(content)) {
        findings.abs_path.push({ path: rel, pattern: re.source });
        break;
      }
    }
  }
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
  if (!isAllowed(rel, ALLOW_DOMAIN_VOCAB_PATHS)) {
    for (const t of DOMAIN_VOCAB.terms) {
      if (t.re.test(content)) {
        findings.domain_vocab.push({ path: rel, token: t.label });
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
  for (const prefix of ROOT_LEAK_PREFIXES) {
    if (rel.startsWith(prefix)) {
      findings.root_leak.push({ path: rel });
      break;
    }
  }
}

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

function gitTrackedFiles() {
  try {
    return gitLines("git ls-files");
  } catch {
    return null;
  }
}

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

const MAX_BYTES = 8 * 1024 * 1024;
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
    root_leak: [],
    client_slug: [],
    abs_path: [],
    promote_relic: [],
    domain_vocab: [],
  };

  if (CLIENT_SLUGS.length === 0 && mcEnv.readEnv("REQUIRE_PRIVATE_DENYLIST") === "1") {
    return {
      ok: false,
      code: 2,
      mode,
      error:
        "MC_REQUIRE_PRIVATE_DENYLIST=1 but 0 private slugs loaded — provide MC_PURITY_SLUGS_FILE or .claude/project/memory/framework-purity.local.json",
      private_slugs: 0,
      scanned: 0,
      skipped_large: [],
      summary: null,
      findings,
    };
  }

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

  let partition = null;
  let loaderAbsent = false;
  try {
    const loaded = loadGatePartition(opts);
    if (loaded.absent) loaderAbsent = true;
    else partition = loaded.partition;
  } catch (e) {
    return {
      ok: false,
      code: 2,
      mode,
      error: `rename map unreadable — failing CLOSED: ${e.message}`,
      scanned: 0,
      skipped_large: [],
      summary: null,
      findings,
      legacy_slug: null,
    };
  }
  if (loaderAbsent && ((opts && opts.enforceLegacySlug) || mcEnv.readEnv("REQUIRE_PRIVATE_DENYLIST") === "1")) {
    return {
      ok: false,
      code: 2,
      mode,
      error: `legacy-slug enforcement explicitly requested (${opts && opts.enforceLegacySlug ? "--enforce-legacy-slug" : "MC_REQUIRE_PRIVATE_DENYLIST=1"}) but the rename-map loader is absent — failing CLOSED, not skipping: ${LEGACY_SLUG_SKIP_REASON}`,
      scanned: 0,
      skipped_large: [],
      summary: null,
      findings,
      legacy_slug: null,
    };
  }
  const slugMode = resolveLegacySlugMode(opts);
  const slugTally = loaderAbsent ? null : partition.createLegacySlugTally({ version: readRootVersion() });
  const slugUnscanned = [];

  const skippedLarge = [];
  for (const rel of files) {
    scanPath(rel, findings);
    if (BINARY_EXT.test(rel)) continue;
    const abs = path.join(REPO_ROOT, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_BYTES) {
      skippedLarge.push(rel);
      if (!loaderAbsent) {
        const cls = partition.classifyPath(rel);
        if (cls.class === 1 && cls.kind !== "generated-view") slugUnscanned.push(rel);
      }
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
    if (!loaderAbsent) partition.tallyLegacySlug(slugTally, rel, text, LEGACY_SLUG_NEEDLE);
  }

  if (loaderAbsent) {
    findings.legacy_slug = [];
    findings.legacy_slug_path = [];
    const violations =
      findings.client_slug.length + findings.abs_path.length + findings.promote_relic.length;
    return {
      ok: violations === 0,
      code: violations === 0 ? 0 : 1,
      mode,
      scanned: files.length,
      private_slugs: CLIENT_SLUGS.length,
      skipped_large: skippedLarge,
      summary: {
        client_slug: findings.client_slug.length,
        abs_path: findings.abs_path.length,
        promote_relic: findings.promote_relic.length,
        legacy_slug: 0,
        legacy_slug_path: 0,
        root_leak: findings.root_leak.length,
        domain_vocab: findings.domain_vocab.length,
      },
      domain_vocab_lane: DOMAIN_VOCAB.status,
      legacy_slug: { skipped: true, reason: LEGACY_SLUG_SKIP_REASON },
      findings,
    };
  }

  findings.legacy_slug = slugMode.enforce
    ? [
        ...Object.entries(slugTally.pendingByFile)
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .map(([p, count]) => ({ path: p, pattern: `${count} live-unallowed`, sample: slugTally.pendingSamples[p] || null })),
        ...slugUnscanned.map((p) => ({ path: p, pattern: "unscanned (too large) — unverifiable" })),
      ]
    : [];

  const pathTally = partition.tallyLegacySlugPathNames(files, LEGACY_SLUG_NEEDLE, { version: readRootVersion() });
  findings.legacy_slug_path = slugMode.enforce
    ? pathTally.liveUnallowedPaths.map((x) => ({ path: x.path, pattern: `path-name live-unallowed: ${x.reason}` }))
    : [];

  const violationCount =
    findings.client_slug.length +
    findings.abs_path.length +
    findings.promote_relic.length +
    findings.legacy_slug.length +
    findings.legacy_slug_path.length;

  return {
    ok: violationCount === 0,
    code: violationCount === 0 ? 0 : 1,
    mode,
    scanned: files.length,
    private_slugs: CLIENT_SLUGS.length,
    skipped_large: skippedLarge,
    summary: {
      client_slug: findings.client_slug.length,
      abs_path: findings.abs_path.length,
      promote_relic: findings.promote_relic.length,
      legacy_slug: slugTally.pendingTotal + slugUnscanned.length,
      legacy_slug_path: pathTally.byDisposition.liveUnallowed,
      root_leak: findings.root_leak.length,
      domain_vocab: findings.domain_vocab.length,
    },
    domain_vocab_lane: DOMAIN_VOCAB.status,
    legacy_slug: {
      enforce: slugMode.enforce,
      version: slugMode.version,
      reason: slugMode.reason,
      live_unallowed: slugTally.pendingTotal,
      unscanned: slugUnscanned,
      suppressed: slugTally.suppressedTotal,
      pinned: slugTally.pinnedTotal,
      derived: slugTally.derivedTotal,
      compat: slugTally.compatTotal,
      compat_by_surface: slugTally.compatBySurface,
      compat_expired: slugTally.compatExpiredTotal,
      compat_expired_by_surface: slugTally.compatExpiredBySurface,
      compat_clock: slugTally.versionReason,
      dispositions: partition.dispositionSummary(slugTally),
      suppressed_by_entry: slugTally.suppressedByEntry,
      pinned_by_pin: slugTally.pinnedByPin,
      derived_by_view: slugTally.derivedByView,
      pending_by_file: slugTally.pendingByFile,
      formatted: partition.formatLegacySlugTally(slugTally, { indent: "    ", maxPending: slugMode.enforce ? 0 : 10 }),
      path_names: {
        total: pathTally.total,
        dispositions: pathTally.byDisposition,
        by_entry: pathTally.byEntry,
        compat_by_surface: pathTally.compatBySurface,
        compat_expired_by_surface: pathTally.compatExpiredBySurface,
        live_unallowed: pathTally.byDisposition.liveUnallowed,
        live_unallowed_paths: pathTally.liveUnallowedPaths,
        compat_clock: pathTally.versionReason,
        formatted: partition.formatPathNameTally(pathTally, { indent: "    " }),
      },
    },
    findings,
  };
}

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
  legacy_slug     the pre-rebrand slug in a LIVE (non-pinned, non-derived) path,
                  classified through scripts/open-source/partition-loader.js. REPORT-ONLY
                  (prints the pending count) while package.json < 2.0.0; ENFORCING at
                  >= 2.0.0 or with --enforce. Suppressed counts are always printed.
                  compat: an occurrence is permitted ONLY inside a REGISTERED compat window
                  (the rename map's compatWindows: enumerated members + anchored occurrences,
                  each window with its OWN expires version); counts are emitted per surface;
                  at package.json >= a window's expiry its occurrences are live-unallowed.

Advisory (report-only — never affects the exit code):
  root_leak       _requirements/ or _docs/ at canonical root
  domain_vocab    terms from the instance-local term file (skipped when the file is absent)

Modes:
  --full  (default)  every git-tracked file (git ls-files) — the leak gate
  --diff             git diff --cached + git diff (staged + unstaged)
  --staged           git diff --cached only (the commit gate)
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
  if (typeof r.private_slugs === "number") lines.push(`  private slugs loaded: ${r.private_slugs}`);
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
  if (r.legacy_slug && r.legacy_slug.skipped) {
    lines.push(`    legacy_slug:     SKIPPED — ${r.legacy_slug.reason}`);
  } else if (r.legacy_slug) {
    const ls = r.legacy_slug;
    lines.push(
      `    legacy_slug:     ${r.summary.legacy_slug}  [${ls.enforce ? "ENFORCING" : "REPORT-ONLY — pending until the cut"}: ${ls.reason}]`
    );
    lines.push("");
    lines.push("  legacy slug tally (rename map):");
    lines.push(...ls.formatted);
    if (ls.unscanned.length) lines.push(`    unscanned live files (too large): ${ls.unscanned.length}`);
    if (ls.path_names) {
      lines.push(`    legacy_slug_path: ${r.summary.legacy_slug_path}  [${ls.enforce ? "ENFORCING" : "REPORT-ONLY"}]`);
      lines.push(...ls.path_names.formatted);
    }
  }
  lines.push("");
  lines.push(`  advisory (report-only, does NOT affect exit code):`);
  lines.push(`    root_leak:       ${r.summary.root_leak}`);
  lines.push(`    domain_vocab:    ${r.summary.domain_vocab}${r.domain_vocab_lane && r.domain_vocab_lane !== "loaded" ? ` (${r.domain_vocab_lane})` : ""}`);
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
  lines.push(
    `  result: ${r.ok ? "OK" : "FAIL"} (exit ${r.code})` +
      (r.legacy_slug && r.legacy_slug.skipped ? " — legacy-slug detector SKIPPED (loader absent); all other detectors ran" : "")
  );
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
  DOMAIN_VOCAB,
  loadDomainVocab,
};
