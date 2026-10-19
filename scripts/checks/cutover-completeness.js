#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const mcEnv = require("../hooks/lib/mc-env");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "cutover-completeness";
const ALLOWLIST_FILE = path.join(__dirname, "cutover-completeness.allowlist.json");

const LEGACY_SLUG_NEEDLE = "warpos";
const PARTITION_MAX_BYTES = 8 * 1024 * 1024;
const PARTITION_BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|svg|woff2?|ttf|eot|pdf|zip|gz|tgz|tar|7z|mp[34]|wav|mov|exe|dll|node|wasm)$/i;

const PARTITION_LOADER_DEFAULT = path.resolve(__dirname, "..", "open-source", "partition-loader.js");
const PARTITION_SKIP_REASON =
  "partition-loader.js not present (no rename map configured on this tree) — the rename-map checks did NOT run";
function runPartitionChecks() {
  const override = mcEnv.readEnv("CUTOVER_PARTITION_LOADER");
  const loaderPath = override ? path.resolve(override) : PARTITION_LOADER_DEFAULT;
  if (!fs.existsSync(loaderPath)) return { skipped: true, reason: PARTITION_SKIP_REASON };
  let loader;
  try {
    loader = loaderPath === PARTITION_LOADER_DEFAULT ? require("../open-source/partition-loader") : require(loaderPath);
  } catch (e) {
    return { fatal: `rename-map loader present but unloadable — failing CLOSED: ${e.message}` };
  }
  let partition;
  try {
    partition = loader.loadPartition({ forceReload: true });
  } catch (e) {
    return { fatal: `rename map unreadable — failing CLOSED, never read as a truncated allow-list: ${e.message}` };
  }
  if (!partition.allowList || partition.allowList.size === 0) {
    return {
      fatal:
        "the rename map's allow-list view is EMPTY (no pinned or historical-allow-listed path entries, no occurrence pins) — an empty allow-list is a truncated allow-list; refusing to read green",
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
        continue;
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
    return { fatal: `rename-map check runner error — failing CLOSED: ${e.message}` };
  }
}

const DEAD_TREE = [
  { literal: "00-alex", re: /\b00-alex\b/ },
  { literal: "01-adhoc/", re: /\b01-adhoc\// },
  { literal: "02-oneshot/", re: /\b02-oneshot\// },
  { literal: "03-managers", re: /\b03-managers\b/ },
  { literal: "president/.system", re: /president\/\.system/ },
];
const DEAD_ROLES = [
  "product-designer",
  "web-conversion-designer",
  "research-insight-lead",
  "growth-lead",
].map((r) => ({ literal: r, re: new RegExp(`(?<![A-Za-z0-9_-])${r}(?![A-Za-z0-9_-])`) }));

const ALL_NEEDLES = [...DEAD_TREE, ...DEAD_ROLES];

const PATH_LAYER_FILES = [
  "scripts/hooks/lib/paths.js",
  "scripts/hooks/lib/paths.generated.js",
  ".claude/paths.json",
  "framework/paths.registry.json",
];
const LIVE_SCRIPT_FILES = [
  "scripts/dispatch-agent.js",
  "scripts/dispatch-claude.js",
  "scripts/test-sprint.js",
  "scripts/mc/manifest/build.js",
  "scripts/mc/manifest/test-bootstrap.js",
  "scripts/mc/codemod-docs-to-requirements.js",
];
const KEYSTONE_REGISTRIES = [
  ".claude/agents/_principles/registry.json",
  ".claude/agents/_org/role-registry.json",
];
const SCAN_DIRS = [
  "scripts/hooks",
  "scripts/checks",
  "scripts/sprint",
  "fixtures",
  "scripts/canon/fixtures",
  "scripts/contracts/fixtures",
  ".claude/agents/_evals",
];

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

const WAS_FIELD_RE = /"was"\s*:/;

function lineHits({ file, lineNo, line, inBlockComment, isJson }) {
  const out = [];
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

function extractFile(absFile, relFile) {
  const isJson = relFile.endsWith(".json");
  const src = fs.readFileSync(absFile, "utf8");
  const lines = src.split(/\r?\n/);
  const hits = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startsInBlock = inBlock;
    if (!isJson) {
      let scan = line;
      let openIdx = startsInBlock ? 0 : indexOfUnquoted(scan, "/*");
      let cur = startsInBlock;
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
        if (e.name.endsWith(".test.js")) continue;
        out.push(full);
      }
    }
  }
  return out;
}

function loadAllowlist() {
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

  const partition = runPartitionChecks();
  if (partition.fatal) {
    return { ok: false, problems: [...problems, partition.fatal], notes, fatal: true, findings, allowed, partition };
  }
  if (partition.skipped) {
    notes.push(`rename-map half SKIPPED — ${partition.reason}`);
    return { ok: findings.length === 0, problems, notes, fatal: false, findings, allowed, partition };
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
  if (!partition || partition.fatal || partition.skipped) return [];
  return [
    `  rename map (read via scripts/open-source/partition-loader.js): ${partition.allowEntries} allow-view entr${partition.allowEntries === 1 ? "y" : "ies"} · ${partition.problems.length} problem(s)`,
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
    process.exit(2);
  }
  if (asJson) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    process.exit(res.fatal ? 2 : res.ok ? 0 : 1);
  }
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
  } else if (res.partition && res.partition.problems && res.partition.problems.length) {
    process.stderr.write(`FAIL [${NAME}] rename map: ${res.partition.problems.length} problem(s):\n`);
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
