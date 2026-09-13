#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * scripts/checks/duplicate-doc-drift.js — S-6 / D-4 duplicate-doc-drift enforcer.
 *
 * `scan:references` catches a BROKEN ref (a path that points at nothing). It is
 * BLIND to the opposite failure: TWO shipped framework files share a basename and
 * are MEANT to be the same canonical doc, but their CONTENT has silently DRIFTED.
 * Both files exist, so every ref resolves — yet a consumer reading one copy and a
 * consumer reading the other get different doctrine. The reference case is the
 * dispatch guide shipped at both `.claude/agents/.system/guides/agent-dispatch-guide.md`
 * AND `.claude/project/reference/agent-dispatch-guide.md` with diverged content.
 * This enforcer makes that class self-detecting.
 *
 * THE SHIPPED-FRAMEWORK SURFACE (not the whole repo): the candidate set is read
 * from the framework manifest (`.claude/framework-manifest.json`) — only
 * owner=framework, not-removed assets. A basename that isn't shipped twice isn't
 * this bug. We further scope to DOC-like `.md` assets and exclude the kinds whose
 * same-basename-different-content is BY DESIGN and not a "duplicate doc":
 *   - `skill`        — distinct slash-commands legitimately share a leaf name
 *                      (`list.md`, `run.md`); they are different skills, not dups.
 *   - `template` / `fixture` — scaffolding inputs, expected to differ per fixture.
 *   - `release_capsule` — frozen per-version artifacts (changelog.md ×N), immutable.
 * Plus a path-prefix exclusion for the same surfaces (`.claude/commands/`,
 * `framework/releases/`, `fixtures/`, `**​/templates/`) so a mis-kinded asset can't
 * sneak the storm back in.
 *
 * D-4 — SANCTIONED DUPLICATES MUST NOT FAIL: some framework docs ship the same
 * basename at multiple paths and their content is EXPECTED to differ — per-pod
 * role docs (`builder.md`/`fixer.md`/`reviewer.md` across engineering pods),
 * mode protocols (`protocol.md` adhoc+oneshot), per-directory READMEs. These are
 * exempted by a path-pair allowlist (duplicate-doc-drift.allowlist.json): a
 * duplicate GROUP is suppressed only if EVERY shipped path in it matches a
 * sanctioned (basename + dir-glob) rule. A member outside the sanctioned dirs is
 * NOT covered, so a real drifted dup hiding next to a sanctioned one still fires.
 *
 * The flag/allow DECISION is isolated in the pure `evaluate({ groups, rules })` so
 * the bite-test fires the drift class — and proves sanctioned + identical dups do
 * NOT flag — on synthetic input with no disk. Disk I/O (manifest read, content
 * hashing, allowlist load) lives in `run()`.
 *
 * REPORT-ONLY by default (PLAN §4 ramp): findings are printed, exit 0. Pass
 * `--enforce` (or `WARPOS_DUPLICATE_DOC_DRIFT_ENFORCE=block`) to make a drift
 * finding exit 1 — the §4-flipped state. FAIL-CLOSED on its own errors: a runner
 * error (unreadable/malformed manifest, unreadable allowlist, unreadable doc)
 * exits 2 — a runner error is NEVER a pass (false-green-gauntlet lesson).
 *
 *   node scripts/checks/duplicate-doc-drift.js [--json] [--enforce]
 *
 * Zero runtime deps.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "duplicate-doc-drift";
const MANIFEST_FILE = path.join(ROOT, ".claude", "framework-manifest.json");
const ALLOWLIST_FILE = path.join(__dirname, "duplicate-doc-drift.allowlist.json");

// Manifest asset kinds whose same-basename copies are duplicates BY DESIGN — not
// the "one canonical doc shipped twice" class this enforcer hunts.
const EXCLUDED_KINDS = new Set(["skill", "template", "fixture", "release_capsule"]);
// Path prefixes for the same surfaces (defense in depth against a mis-kinded asset).
const EXCLUDED_PREFIXES = [".claude/commands/", "framework/releases/"];
const norm = (p) => p.replace(/\\/g, "/");
// A path SEGMENT match anywhere in the path (not a top-level prefix).
const isTemplatePath = (p) => /(^|\/)templates\//.test(p);
// D-4 INC-4 fix: `fixtures/` was a top-level-only PREFIX in EXCLUDED_PREFIXES, so it missed NESTED
// fixture dirs (e.g. scripts/checks/fixtures/authority-pollution/) — the docstring already promises
// fixtures are excluded, so this aligns the impl with intent (the AGENTS.md false-positive).
const isFixturePath = (p) => /(^|\/)fixtures\//.test(p);

function isExcludedPath(p) {
  return EXCLUDED_PREFIXES.some((pre) => p.startsWith(pre)) || isTemplatePath(p) || isFixturePath(p);
}

// ── dir-glob matcher (a single trailing `*` = one path segment) ──────────────
/**
 * Match a repo-relative file's DIRECTORY against a dir-glob. A `*` matches exactly
 * one path segment; everything else is literal. The glob must end in `/` (it
 * matches a directory the file lives directly in). Examples:
 *   ".claude/agents/engineering/*​/"  matches  ".claude/agents/engineering/frontend/builder.md"
 *   "_knowledge/*​/"                   matches  "_knowledge/design/README.md"
 *   "patterns/"                       matches  "patterns/README.md"
 */
function fileMatchesDirGlob(file, dirGlob) {
  const f = norm(file);
  const g = norm(dirGlob);
  if (!g.endsWith("/")) return false;
  const dir = f.slice(0, f.lastIndexOf("/") + 1); // includes trailing slash
  // Translate the glob to a regex: `*` => one non-slash segment, escape the rest.
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

// ── Pure flag/allow core (no fs) ─────────────────────────────────────────────
/**
 * Decide which duplicate GROUPS are drifted-and-unsanctioned (findings) vs
 * sanctioned or identical (allowed). Isolated from disk so the bite-test drives
 * it on synthetic groups.
 *
 *   groups : [{ basename, members: [{ file, hash }] }]   (each group is one
 *            basename appearing at >=2 shipped doc paths; file = repo-relative,
 *            forward slashes; hash = content digest)
 *   rules  : [{ basename, dirGlobs:[...], reason }]       (the allowlist pairs)
 *
 * Returns { findings, allowed }:
 *   findings[] — groups whose content DRIFTED and that are NOT fully sanctioned.
 *   allowed[]  — groups suppressed (identical content, or sanctioned-by-allowlist),
 *                with the reason (for --json visibility + the false-positive guard).
 */
function evaluate({ groups, rules }) {
  const findings = [];
  const allowed = [];
  const ruleList = rules || [];
  for (const g of groups || []) {
    const members = (g && g.members) || [];
    if (members.length < 2) continue; // not a duplicate
    const distinct = new Set(members.map((m) => m.hash));
    const drifted = distinct.size > 1;

    // A group is SANCTIONED iff some allowlist rule for this basename covers EVERY
    // member's directory. A member outside the sanctioned dirs breaks the exemption.
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

// ── Disk: manifest surface + content hashing ─────────────────────────────────

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * Read the framework manifest and return the framework-owned, not-removed, doc-like
 * `.md` asset dest paths (repo-relative, forward slashes), excluding the by-design
 * duplicate kinds + path surfaces. Throws on a missing/malformed manifest (the
 * caller turns that into a fail-closed exit 2).
 */
function shippedDocPaths(manifestFile) {
  const raw = fs.readFileSync(manifestFile, "utf8").replace(/^﻿/, "");
  const fm = JSON.parse(raw);
  const assets = fm && fm.assets;
  if (!assets || typeof assets !== "object") {
    throw new Error("manifest has no `assets` object");
  }
  const out = new Set();
  // `assets` is keyed by kind → array of asset entries.
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

/** Group shipped doc paths by basename; only groups with >=2 members are duplicates. */
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
      const hash = sha256(fs.readFileSync(abs)); // throws if a shipped doc is missing → fail-closed
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

  // Allowlist hygiene: a rule that suppressed no group is stale residue.
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
    process.exit(2); // fail-closed
  }
  const mode = enforce ? "blocking" : "report-only";
  if (asJson) {
    process.stdout.write(JSON.stringify({ mode, ...res }, null, 2) + "\n");
    // Report-only: a drift finding does NOT block (exit 0); a runner error always does.
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
  // Findings present. Print them; block only in --enforce mode.
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
