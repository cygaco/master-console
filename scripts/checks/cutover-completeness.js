#!/usr/bin/env node
"use strict";

/**
 * scripts/checks/cutover-completeness.js — ED-026 fail-closed cutover gate.
 *
 * A tree-wide rename/cutover (ADR-0007: 00-alex/01-adhoc/02-oneshot/03-managers
 * → president/engineering/product/growth/_system, and the role renames
 * product-designer→design-lead, web-conversion-designer→conversion-lead,
 * research-insight-lead→research-lead, growth-lead→marketing-lead) is only DONE
 * when the IMPERATIVE layer is migrated too — runtime path consumers, hooks, the
 * paths registry/fallback tables, fixtures, and the keystone registries.
 *
 * The declarative role↔spec bijection (/scan:role-parity) does NOT cover this:
 * it proved 33/33 GREEN while 21 oneshot-δ scripts + the paths.js fallback table
 * still pointed at the deleted tree (δ would ENOENT-crash mid-run). Worse, the
 * role-aliases.js back-compat table RESOLVES old→new, so manager-principles +
 * role-parity scan GREEN on STALE registry data — masking the staleness entirely
 * (L-2026-06-05-alias-table-masks-cutover-staleness).
 *
 * THE KEY INSIGHT: this gate greps the RAW LITERALS, NOT the alias-resolved
 * roles. A passing alias-resolved scan is NOT evidence the source is clean.
 *
 * INVARIANT (any FUNCTIONAL hit => exit 1): no deleted-old-tree path literal and
 * no renamed-away role name appears as LIVE (non-comment, non-`was:`) content in
 * the imperative layer or the keystone registries.
 *
 * ALLOWLISTED (never flagged — the legit exceptions):
 *   - the role-aliases.js back-compat table itself (it MUST name the old names)
 *   - frozen framework/releases/* capsules (immutable shipped artifacts)
 *   - `"was": ...` registry fields (the historical record of a rename)
 *   - the ADR-0007 doc that documents the cutover
 *   - migrated-from / ADR-context code comments (`// ... moved under ADR-0007`)
 *   - dispatch-agent.js's LEGACY_TREE coexistence shim (names the old dirs by
 *     design so a stale duplicate can't shadow the new spec during the window)
 *   - a small file/prefix allowlist (cutover-completeness.allowlist.json) for
 *     any other sanctioned residue, each with a reason
 *
 * The flag/allow DECISION is isolated in the pure evaluate({ hits, fileAllow,
 * prefixAllow }) so the bite-test fires each finding class — and proves the
 * allowlisted classes do NOT flag — on synthetic input with no disk. Disk I/O
 * (target enumeration, literal extraction, comment/field classification) lives in
 * run(). Read-only. Exit 0 clean · 1 at least one live-stale ref · 2 runner error
 * (fail-closed: a runner error is NOT a pass).
 *
 *   node scripts/checks/cutover-completeness.js [--json]
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "cutover-completeness";
const ALLOWLIST_FILE = path.join(__dirname, "cutover-completeness.allowlist.json");

// ── S-OS-06 T2: the rename partition's FROZEN allow-list (β r3 Req1, AC-7.1) ──
// The ONE literal the suppressed-count emission searches for sits on the next line; that
// line is a Class-3 occurrence pin in the partition (anchor "const LEGACY_SLUG_NEEDLE = "),
// so the rename codemod never rewrites it.
const LEGACY_SLUG_NEEDLE = "warpos";
const PARTITION_MAX_BYTES = 8 * 1024 * 1024;
const PARTITION_BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|svg|woff2?|ttf|eot|pdf|zip|gz|tgz|tar|7z|mp[34]|wav|mov|exe|dll|node|wasm)$/i;

/**
 * The partition half of this gate. Reads the ONE partition artifact through the ONE
 * loader (never the file directly) and returns:
 *   { fatal }                         — unreadable/empty/truncated partition (F3) or a
 *                                       runner error: exit 2, never green
 *   { problems, notes, tally, ... }   — problems are F2 (unwarranted entry), SCHEMA,
 *                                       F7 (entry matching nothing), F8 (post-freeze
 *                                       silent addition): each one is exit 1
 * and ALWAYS the per-entry suppressed legacy-slug counts (emitted, never swallowed).
 */
function runPartitionChecks() {
  let loader;
  try {
    loader = require("../open-source/partition-loader");
  } catch (e) {
    return { fatal: `partition loader unavailable — failing CLOSED: ${e.message}` };
  }
  let partition;
  try {
    partition = loader.loadPartition({ forceReload: true });
  } catch (e) {
    return { fatal: `partition unreadable — failing CLOSED (F3): ${e.message}` };
  }
  if (!partition.allowList || partition.allowList.size === 0) {
    return {
      fatal:
        "the partition allow-list view is EMPTY (no Class-3/4 entries, no occurrence pins) — an empty allow-list is a truncated allow-list (F3); refusing to read green",
    };
  }
  const root = loader.PARTITION_ROOT;
  try {
    const tracked = loader.listRepoFiles(root);
    const problems = [...partition.validateEntries()];
    const stale = partition.checkStale({ root, trackedFiles: tracked });
    problems.push(...stale.problems);
    const freeze = partition.checkFreeze({ root });
    problems.push(...freeze.problems);
    const tally = partition.createLegacySlugTally();
    for (const rel of tracked) {
      if (PARTITION_BINARY_EXT.test(rel)) continue;
      const abs = path.join(root, rel);
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue; // in the index, deleted on disk
      }
      if (!st.isFile() || st.size > PARTITION_MAX_BYTES) continue;
      const buf = fs.readFileSync(abs);
      if (buf.subarray(0, 8192).includes(0)) continue;
      partition.tallyLegacySlug(tally, rel, buf.toString("utf8"), LEGACY_SLUG_NEEDLE);
    }
    return {
      fatal: null,
      root,
      allowEntries: partition.allowList.size,
      problems,
      notes: [...stale.notes, ...freeze.notes],
      tally,
      formatted: partition.formatLegacySlugTally(tally, { indent: "  ", maxPending: 0 }),
    };
  } catch (e) {
    return { fatal: `partition check runner error — failing CLOSED: ${e.message}` };
  }
}

// ── The deleted-tree path literals + renamed-away role names ─────────────────
// Deleted old-tree DIRECTORIES (ADR-0007). Anchored so a path SEGMENT must match:
// `01-adhoc/`, `/00-alex/` etc — never a coincidental substring. `00-alex` and
// `03-managers` are matched as bare segments too (they appear without a trailing
// slash in some refs, e.g. `00-alex` as a fallback-table token).
const DEAD_TREE = [
  { literal: "00-alex", re: /\b00-alex\b/ },
  { literal: "01-adhoc/", re: /\b01-adhoc\// },
  { literal: "02-oneshot/", re: /\b02-oneshot\// },
  { literal: "03-managers", re: /\b03-managers\b/ },
  // D-2 (2026-06-08): the president/.system → president/_system de-dot. A live
  // straggler still naming the dotted dir in a scanned dir is exit-1. (This file
  // is self-allowlisted, so this needle definition does not self-flag.)
  { literal: "president/.system", re: /president\/\.system/ },
];
// Renamed-away ROLE names (1:1 ADR-0007 renames whose target now exists). Matched
// as whole tokens (word-ish boundary) so `research-lead` never matches inside
// `research-insight-lead` and vice-versa.
const DEAD_ROLES = [
  "product-designer",
  "web-conversion-designer",
  "research-insight-lead",
  "growth-lead",
].map((r) => ({ literal: r, re: new RegExp(`(?<![A-Za-z0-9_-])${r}(?![A-Za-z0-9_-])`) }));

const ALL_NEEDLES = [...DEAD_TREE, ...DEAD_ROLES];

// ── The imperative + keystone TARGET set ─────────────────────────────────────
// The layer role-parity does NOT cover: runtime path consumers, the path
// registry + fallback tables, hooks, the keystone registries, fixtures.
// We scope to UNAMBIGUOUSLY-LIVE surfaces + the keystones. Historical run-N /
// one-off archive scripts (frozen records of past runs) are excluded by the
// archive-prefix allowlist (cutover-completeness.allowlist.json), so the signal
// is the live-stale refs — not 40 frozen one-offs.
const PATH_LAYER_FILES = [
  "scripts/hooks/lib/paths.js",
  "scripts/hooks/lib/paths.generated.js",
  ".claude/paths.json",
  "framework/paths.registry.json",
];
const LIVE_SCRIPT_FILES = [
  "scripts/dispatch-agent.js",
  "scripts/dispatch-claude.js",
  "scripts/phase0-verify.js",
  "scripts/test-sprint.js",
  "scripts/mc/manifest/build.js",
  "scripts/mc/manifest/test-bootstrap.js",
  "scripts/mc/codemod-docs-to-requirements.js",
];
const KEYSTONE_REGISTRIES = [
  ".claude/agents/_principles/registry.json",
  ".claude/agents/_org/role-registry.json",
  // _evals/*.json enumerated at scan time.
];
// Directories scanned recursively for *.js / *.json.
const SCAN_DIRS = [
  "scripts/hooks",
  "scripts/checks",
  "scripts/sprint",
  "fixtures",
  "scripts/canon/fixtures",
  "scripts/contracts/fixtures",
  ".claude/agents/_evals",
];

// ── Pure flag/allow core (no fs) ─────────────────────────────────────────────
/**
 * Decide, for each extracted hit, whether it is a FLAGGED live-stale ref or an
 * allowed exception. This is the bug-prone classification, isolated from disk.
 *
 *   hits : [{ file, line, literal, text, inComment, wasField }]
 *          file  = repo-relative, forward slashes
 *          text  = the source line (trimmed) — for the report
 *          inComment = the literal occurs inside a // , # , or /* *​/ comment
 *          wasField  = the literal is the value of a JSON `"was"` field
 *   fileAllow   : Set<string> of repo-relative files entirely exempt (+reason elsewhere)
 *   prefixAllow : [{prefix, reason}] — a hit whose file starts with prefix is exempt
 *
 * Returns { findings, allowed } — findings[] are the live-stale refs (exit 1);
 * allowed[] is every hit suppressed by an allowlist rule (for --json visibility +
 * the false-positive-guard test).
 */
function evaluate({ hits, fileAllow, prefixAllow }) {
  const findings = [];
  const allowed = [];
  const fAllow = fileAllow || new Set();
  const pAllow = prefixAllow || [];
  for (const h of hits) {
    const byFile = fAllow.has(h.file);
    const byPrefix = pAllow.find((p) => h.file.startsWith(p.prefix));
    let reason = null;
    if (byFile) reason = "file-allowlist";
    else if (byPrefix) reason = `prefix-allowlist (${byPrefix.reason})`;
    else if (h.inComment) reason = "comment (migrated-from / ADR-context)";
    else if (h.wasField) reason = "`was:` field (historical rename record)";
    if (reason) {
      allowed.push({ ...h, allowedBy: reason });
      continue;
    }
    findings.push({
      severity: "high",
      check: NAME,
      kind: DEAD_TREE.some((d) => d.literal === h.literal) ? "dead-tree-path" : "renamed-away-role",
      file: h.file,
      line: h.line,
      literal: h.literal,
      message: `live-stale '${h.literal}' at ${h.file}:${h.line} — deleted-old-tree ref in the imperative/keystone layer (the alias table masks this; role-parity passes GREEN). ${h.text}`,
      suggestedFix: `Repoint to the migrated location (see ADR-0007), or — if this is a sanctioned exception — add ${h.file} (or its prefix) to cutover-completeness.allowlist.json with a reason. Do NOT rely on role-aliases.js to resolve it.`,
    });
  }
  return { findings, allowed };
}

// ── Disk: literal extraction with comment / `was:`-field awareness ───────────

/**
 * For a single source line, classify each needle occurrence. Comment detection is
 * line-granularity (a `//` or `#` before the literal, or the line sits inside a
 * /* … *​/ block — block state is threaded by the caller). JSON `"was"`-field
 * detection: the line assigns a `"was"` key (`"was": "..."` or `"was": [...]`).
 */
const WAS_FIELD_RE = /"was"\s*:/;

function lineHits({ file, lineNo, line, inBlockComment, isJson }) {
  const out = [];
  // Comment span: everything after an UNQUOTED // (js) or # (non-json), if any.
  // Coarse but safe: we only need "is the literal inside a comment", and the
  // literals never legitimately appear before a trailing comment on a live line.
  let commentFrom = Infinity;
  if (!isJson) {
    const slashIdx = indexOfUnquoted(line, "//");
    if (slashIdx >= 0) commentFrom = Math.min(commentFrom, slashIdx);
    const hashIdx = indexOfUnquoted(line, "#");
    if (hashIdx >= 0) commentFrom = Math.min(commentFrom, hashIdx);
  }
  const wasField = isJson && WAS_FIELD_RE.test(line);
  for (const needle of ALL_NEEDLES) {
    const m = needle.re.exec(line);
    if (!m) continue;
    const at = m.index;
    const inComment = inBlockComment || at >= commentFrom;
    out.push({
      file,
      line: lineNo,
      literal: needle.literal,
      text: line.trim().slice(0, 200),
      inComment,
      wasField,
    });
  }
  return out;
}

/** Index of the first occurrence of `tok` that is NOT inside a quote. -1 if none. */
function indexOfUnquoted(s, tok) {
  let quote = null;
  for (let i = 0; i + tok.length <= s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (s.startsWith(tok, i)) return i;
  }
  return -1;
}

/** Extract every needle hit from a file, threading /* *​/ block-comment state. */
function extractFile(absFile, relFile) {
  const isJson = relFile.endsWith(".json");
  const src = fs.readFileSync(absFile, "utf8");
  const lines = src.split(/\r?\n/);
  const hits = [];
  let inBlock = false; // inside a /* … *​/ block comment (js only)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Update block-comment state for THIS line's start, then for its end.
    const startsInBlock = inBlock;
    if (!isJson) {
      // Toggle on each unquoted /* and *​/ — coarse, line-by-line is enough here.
      let scan = line;
      let openIdx = startsInBlock ? 0 : indexOfUnquoted(scan, "/*");
      let cur = startsInBlock;
      // Walk the line tracking whether we end inside a block comment.
      if (!startsInBlock && openIdx < 0) {
        cur = false;
      } else {
        let pos = startsInBlock ? 0 : openIdx + 2;
        cur = true;
        while (pos <= line.length) {
          const close = line.indexOf("*/", pos);
          if (close < 0) {
            cur = true;
            break;
          }
          const nextOpen = line.indexOf("/*", close + 2);
          if (nextOpen < 0) {
            cur = false;
            break;
          }
          pos = nextOpen + 2;
          cur = true;
        }
      }
      inBlock = cur;
    }
    const lineInBlock =
      startsInBlock || (!isJson && indexOfUnquoted(line, "/*") >= 0 && inBlock);
    hits.push(
      ...lineHits({
        file: relFile,
        lineNo: i + 1,
        line,
        inBlockComment: lineInBlock,
        isJson,
      }),
    );
  }
  return hits;
}

function listFilesRecursive(absDir, exts) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  const stack = [absDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        stack.push(full);
      } else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) {
        // Bite-test files (`*.test.js`) are dev-tooling test SCAFFOLDING, not
        // runtime imperative-layer consumers — and several deliberately embed the
        // OLD role names as synthetic fixtures to PROVE the stale-name detectors
        // fire (role-parity.test.js, skill-hook-coverage.test.js). Scanning them
        // would flag the very fixtures that test cutover detection. The imperative
        // layer = code that runs at product/dispatch time; tests are excluded by
        // construction (not by allowlist, so this can't rot into a hole).
        if (e.name.endsWith(".test.js")) continue;
        out.push(full);
      }
    }
  }
  return out;
}

function loadAllowlist() {
  // { files: { "<rel>": "<reason>" }, prefixes: { "<rel-prefix>": "<reason>" } }
  if (!fs.existsSync(ALLOWLIST_FILE)) return { fileAllow: new Set(), prefixAllow: [] };
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8").replace(/^﻿/, ""));
  const files = raw.files || {};
  const prefixes = raw.prefixes || {};
  const fileAllow = new Set(Object.keys(files).filter((k) => !k.startsWith("_")));
  const prefixAllow = Object.entries(prefixes)
    .filter(([k]) => !k.startsWith("_"))
    .map(([prefix, reason]) => ({ prefix, reason: String(reason || "") }));
  return { fileAllow, prefixAllow, files, prefixes };
}

const norm = (p) => p.replace(/\\/g, "/");

/** Enumerate every target file (repo-relative, forward slashes), de-duplicated. */
function enumerateTargets() {
  const set = new Set();
  for (const f of [...PATH_LAYER_FILES, ...LIVE_SCRIPT_FILES, ...KEYSTONE_REGISTRIES]) {
    if (fs.existsSync(path.join(ROOT, f))) set.add(norm(f));
  }
  for (const d of SCAN_DIRS) {
    for (const abs of listFilesRecursive(path.join(ROOT, d), [".js", ".json"])) {
      set.add(norm(path.relative(ROOT, abs)));
    }
  }
  return [...set].sort();
}

function run() {
  const problems = [];
  const notes = [];
  let allow;
  try {
    allow = loadAllowlist();
  } catch (e) {
    return { ok: false, problems: [`allowlist unreadable: ${e.message}`], notes, fatal: true, allowed: [] };
  }
  const targets = enumerateTargets();
  const hits = [];
  for (const rel of targets) {
    try {
      hits.push(...extractFile(path.join(ROOT, rel), rel));
    } catch (e) {
      return { ok: false, problems: [`could not read target ${rel}: ${e.message}`], notes, fatal: true, allowed: [] };
    }
  }
  const { findings, allowed } = evaluate({
    hits,
    fileAllow: allow.fileAllow,
    prefixAllow: allow.prefixAllow,
  });

  // Allowlist hygiene: a file/prefix allowlist entry that matches NOTHING is stale.
  const matchedFiles = new Set(allowed.filter((a) => a.allowedBy === "file-allowlist").map((a) => a.file));
  for (const f of allow.fileAllow) {
    if (!matchedFiles.has(f)) {
      notes.push(`stale-allowlist-file: '${f}' is on the allowlist but has no dead-tree/role literal (safe to remove).`);
    }
  }

  for (const f of findings) problems.push(f.message);
  notes.push(
    `${targets.length} target file(s) scanned · ${hits.length} raw literal hit(s) · ${findings.length} live-stale · ${allowed.length} allowlisted`,
  );

  // S-OS-06 T2: the rename partition's frozen allow-view (F2 warrants, F3 fail-closed,
  // F7 stale entries, F8 freeze) + the per-entry suppressed legacy-slug counts.
  const partition = runPartitionChecks();
  if (partition.fatal) {
    return { ok: false, problems: [...problems, partition.fatal], notes, fatal: true, findings, allowed, partition };
  }
  for (const p of partition.problems) problems.push(`[${p.id}] ${p.message}`);
  return {
    ok: findings.length === 0 && partition.problems.length === 0,
    problems,
    notes,
    fatal: false,
    findings,
    allowed,
    partition,
  };
}

function partitionReportLines(partition) {
  if (!partition || partition.fatal) return [];
  return [
    `  rename partition (read via scripts/open-source/partition-loader.js): ${partition.allowEntries} allow-view entr${partition.allowEntries === 1 ? "y" : "ies"} · ${partition.problems.length} problem(s)`,
    ...partition.formatted,
    ...partition.notes.map((n) => `  note: ${n}`),
  ];
}

function main() {
  const asJson = process.argv.includes("--json");
  let res;
  try {
    res = run();
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: false, check: NAME, error: msg }) : `ERROR  [${NAME}] runner error (fail-closed): ${msg}`) + "\n",
    );
    process.exit(2); // fail-closed
  }
  if (asJson) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    process.exit(res.fatal ? 2 : res.ok ? 0 : 1);
  }
  // The suppressed counts are EMITTED on every non-fatal run, pass or fail (AC-7.1).
  const report = partitionReportLines(res.partition);
  if (res.ok) {
    process.stdout.write(`PASS [${NAME}] ${res.notes.join(" · ")}\n`);
    if (report.length) process.stdout.write(report.join("\n") + "\n");
    process.exit(0);
  }
  if (res.findings && res.findings.length) {
    process.stderr.write(`FAIL [${NAME}] ${res.findings.length} live-stale ref(s):\n`);
    for (const f of res.findings) process.stderr.write(`  - ${f.message}\n`);
  }
  if (res.fatal) {
    process.stderr.write(`FAIL [${NAME}] fail-closed (exit 2):\n`);
    for (const p of res.problems.filter((m) => !(res.findings || []).some((f) => f.message === m))) {
      process.stderr.write(`  - ${p}\n`);
    }
  } else if (res.partition && res.partition.problems.length) {
    process.stderr.write(`FAIL [${NAME}] rename partition: ${res.partition.problems.length} problem(s):\n`);
    for (const p of res.partition.problems) process.stderr.write(`  - [${p.id}] ${p.message}\n`);
  }
  if (report.length) process.stderr.write(report.join("\n") + "\n");
  if (res.notes.length) process.stderr.write(`  (${res.notes.join(" · ")})\n`);
  process.exit(res.fatal ? 2 : 1);
}

if (require.main === module) main();

module.exports = {
  evaluate,
  extractFile,
  lineHits,
  enumerateTargets,
  loadAllowlist,
  run,
  runPartitionChecks,
  DEAD_TREE,
  DEAD_ROLES,
  ALLOWLIST_FILE,
};
