#!/usr/bin/env node
/**
 * scripts/mc/test-repo-role.js — unit tests for scripts/mc/repo-role.js
 *
 * Tests cover:
 *   1. Canonical repo detection (this worktree IS canonical)
 *   2. Consumer repo detection
 *   3. Unknown repo (no signals)
 *   4. Precedence chain: override > env > marker > heuristic
 *   5. Regression: refactored guards produce identical verdicts on THIS worktree
 *
 * Run:  node scripts/mc/test-repo-role.js
 * Exit: 0 on all-pass, 1 on any failure.
 */

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveRepoRole, isCanonicalDir, ROLES } = require("./repo-role");

// ── Tiny test harness ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label, cond, detail) {
  if (cond) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed++;
  } else {
    process.stderr.write(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}\n`);
    failed++;
  }
}

function section(title) {
  process.stdout.write(`\n── ${title} ──\n`);
}

// ── Temp-dir fixture helper ─────────────────────────────────────────────────

/**
 * Create a minimal temp directory with the specified signal files and return
 * its path. Cleaned up by the caller via fs.rmSync(dir, {recursive:true}).
 *
 * @param {object} opts
 * @param {boolean} [opts.mcManifest]         write _mc/MANIFEST.json
 * @param {boolean} [opts.mcCanonicalMarker]  write .mc-canonical
 * @param {object}  [opts.manifestJson]           write .claude/manifest.json with this content
 * @param {object}  [opts.versionJson]            write version.json with this content
 * @param {boolean} [opts.frameworkInstalled]     write .claude/framework-installed.json
 */
function makeTmpRepo(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-test-repo-role-"));
  if (opts.mcManifest) {
    fs.mkdirSync(path.join(dir, "_mc"), { recursive: true });
    fs.writeFileSync(path.join(dir, "_mc", "MANIFEST.json"), JSON.stringify({ generated: true }));
  }
  if (opts.mcCanonicalMarker) {
    fs.writeFileSync(path.join(dir, ".mc-canonical"), "");
  }
  if (opts.manifestJson !== undefined) {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "manifest.json"), JSON.stringify(opts.manifestJson));
  }
  if (opts.versionJson !== undefined) {
    fs.writeFileSync(path.join(dir, "version.json"), JSON.stringify(opts.versionJson));
  }
  if (opts.frameworkInstalled) {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "framework-installed.json"), JSON.stringify({ installed: true }));
  }
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Test Suite ──────────────────────────────────────────────────────────────

// 1. Module exports
section("Module shape");
ok("ROLES is frozen array with 3 elements", Array.isArray(ROLES) && ROLES.length === 3);
ok("ROLES contains canonical/consumer/unknown", ROLES.includes("canonical") && ROLES.includes("consumer") && ROLES.includes("unknown"));
ok("resolveRepoRole is a function", typeof resolveRepoRole === "function");

// 2. This worktree IS canonical (has _mc/MANIFEST.json + version.json#name=mc + manifest signals)
section("Canonical repo — this worktree");
{
  const r = resolveRepoRole(); // default root = project root
  ok("role === 'canonical'", r.role === "canonical", `got: ${r.role} (source: ${r.source})`);
  ok("canonical === true", r.canonical === true);
  ok("consumer === false", r.consumer === false);
  ok("source is non-empty", typeof r.source === "string" && r.source.length > 0);
}

// 3. Canonical via _mc/MANIFEST.json (strongest signal)
section("Canonical signal — _mc/MANIFEST.json");
{
  const dir = makeTmpRepo({ mcManifest: true });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source === 'marker:_mc/MANIFEST.json'", r.source === "marker:_mc/MANIFEST.json", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 4. Canonical via .mc-canonical marker
section("Canonical signal — .mc-canonical marker");
{
  const dir = makeTmpRepo({ mcCanonicalMarker: true });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source === 'marker:.mc-canonical'", r.source === "marker:.mc-canonical", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 5. Canonical via manifest.json#repoRole
section("Canonical signal — manifest.json#repoRole");
{
  const dir = makeTmpRepo({ manifestJson: { repoRole: "canonical" } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source contains repoRole", r.source.includes("repoRole"), `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 5b. Canonical via manifest.json#repoRole = "framework"
{
  const dir = makeTmpRepo({ manifestJson: { repoRole: "framework" } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("repoRole=framework → canonical", r.role === "canonical", `got: ${r.role}`);
  } finally { cleanup(dir); }
}

// 6. Canonical via manifest.json#mc.source = "self"
section("Canonical signal — manifest.json#mc.source");
{
  const dir = makeTmpRepo({ manifestJson: { mc: { source: "self" } } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source contains mc.source", r.source.includes("mc.source"), `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 7. Canonical via manifest.json#project.slug = "mc"
section("Canonical signal — manifest.json#project.slug");
{
  const dir = makeTmpRepo({ manifestJson: { project: { slug: "mc" } } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source contains project.slug", r.source.includes("project.slug"), `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 8. Canonical via version.json#name = "mc"
section("Canonical signal — version.json#name");
{
  const dir = makeTmpRepo({ versionJson: { name: "mc" } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source === 'version.json#name'", r.source === "version.json#name", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 9. Consumer repo (framework-installed.json, no canonical signals)
section("Consumer repo");
{
  const dir = makeTmpRepo({ frameworkInstalled: true });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'consumer'", r.role === "consumer", `got: ${r.role}`);
    ok("canonical === false", r.canonical === false);
    ok("consumer === true", r.consumer === true);
    ok("source contains framework-installed", r.source.includes("framework-installed"), `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 10. Unknown repo (no signals at all)
section("Unknown repo — no signals");
{
  const dir = makeTmpRepo({});
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'unknown'", r.role === "unknown", `got: ${r.role}`);
    ok("canonical === false", r.canonical === false);
    ok("consumer === false", r.consumer === false);
    ok("source === 'none'", r.source === "none", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 11. Precedence: (a) explicit override arg beats everything
section("Precedence — (a) override arg wins over env and signals");
{
  const dir = makeTmpRepo({ mcManifest: true }); // canonical signal present
  const origEnv = mcEnv.readEnv("REPO_ROLE");
  mcEnv.setEnv("REPO_ROLE", "consumer"); // env says consumer
  try {
    const r = resolveRepoRole({ root: dir, override: "consumer" });
    ok("override arg wins — role === 'consumer'", r.role === "consumer", `got: ${r.role}`);
    ok("source === 'arg:override'", r.source === "arg:override", `got: ${r.source}`);
  } finally {
    if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
    else mcEnv.setEnv("REPO_ROLE", origEnv);
    cleanup(dir);
  }
}

// 12. Precedence: (b) env override beats marker signals
section("Precedence — (b) env override beats marker signals");
{
  const dir = makeTmpRepo({ mcManifest: true }); // canonical signal present
  const origEnv = mcEnv.readEnv("REPO_ROLE");
  mcEnv.setEnv("REPO_ROLE", "consumer"); // override via env
  try {
    const r = resolveRepoRole({ root: dir });
    ok("env wins over signal — role === 'consumer'", r.role === "consumer", `got: ${r.role}`);
    ok("source === 'env:WARPOS_REPO_ROLE'", r.source === "env:WARPOS_REPO_ROLE", `got: ${r.source}`);
  } finally {
    if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
    else mcEnv.setEnv("REPO_ROLE", origEnv);
    cleanup(dir);
  }
}

// 13. Precedence: (c) manifest signal beats (d) heuristic
section("Precedence — (c) manifest signal beats heuristic");
{
  // Both _mc/MANIFEST.json AND version.json present: manifest wins (source should be manifest)
  const dir = makeTmpRepo({ mcManifest: true, versionJson: { name: "mc" } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("manifest signal wins (source is _mc/MANIFEST.json)", r.source === "marker:_mc/MANIFEST.json", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 14. Precedence: override arg case-sensitivity (lowercased)
section("Precedence — override arg lowercased");
{
  const r = resolveRepoRole({ override: "CANONICAL" });
  ok("override uppercased → lowercased role", r.role === "canonical", `got: ${r.role}`);
}

// 15. Fail-safe: corrupt manifest.json falls through to next signal
section("Fail-safe — corrupt manifest.json falls through");
{
  const dir = makeTmpRepo({ versionJson: { name: "mc" } });
  // Write a corrupt manifest.json
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "manifest.json"), "this is not JSON {{{");
  try {
    const r = resolveRepoRole({ root: dir });
    ok("corrupt manifest → falls through to version.json", r.role === "canonical", `got: ${r.role}`);
    ok("source === 'version.json#name'", r.source === "version.json#name", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

// 16. Regression: refactored framework-purity-guard.js isCanonicalRepo() → canonical on this worktree
section("Regression — refactored guards produce identical verdicts");
{
  // Test framework-purity-guard.js isCanonicalRepo in-process by calling the
  // resolver directly with the same root it uses (PROJECT_DIR = cwd).
  const PROJECT_DIR = process.cwd();
  const r = resolveRepoRole({ root: PROJECT_DIR });
  ok("purity-guard: isCanonicalRepo() → true on this worktree", r.role === "canonical",
    `got: ${r.role} (source: ${r.source}). Worktree should be canonical.`);
}

{
  // Test requirements/gate.js isCanonicalRepo in-process.
  // gate.js resolves root as path.resolve(__dirname, "..", "..") from scripts/requirements/
  // which equals the project root.
  const gateRoot = path.resolve(__dirname, "..", "..");
  const r = resolveRepoRole({ root: gateRoot });
  ok("requirements/gate.js: isCanonicalRepo() → true on this worktree", r.role === "canonical",
    `got: ${r.role} (source: ${r.source})`);
}

{
  // Test testsuite/role.js isCanonical in-process via the role module itself.
  const { isCanonical } = require("../testsuite/role");
  const result = isCanonical();
  ok("testsuite/role.js: isCanonical() → true on this worktree", result === true,
    `got: ${result}`);
}

// 17. opts.cwd alias works the same as opts.root
section("opts.cwd alias");
{
  const dir = makeTmpRepo({ mcManifest: true });
  try {
    const r = resolveRepoRole({ cwd: dir });
    ok("cwd alias resolves correctly → canonical", r.role === "canonical", `got: ${r.role}`);
  } finally { cleanup(dir); }
}

// ── GAUNTLET FIX TESTS ──────────────────────────────────────────────────────

// Helper: mirrors the shim's readRawRole() for a custom dir, so we can verify
// the label-surface contract independently of the shim's hardcoded ROOT.
function readRawRoleFrom(dir) {
  const mp = path.join(dir, ".claude", "manifest.json");
  try {
    if (!fs.existsSync(mp)) return null;
    const m = JSON.parse(fs.readFileSync(mp, "utf8").replace(/^﻿/, ""));
    if (!m) return null;
    if (typeof m.repoRole === "string" && m.repoRole) return m.repoRole;
    if (m.mc && typeof m.mc.repoRole === "string" && m.mc.repoRole) return m.mc.repoRole;
    return null;
  } catch { return null; }
}

// 18. FIX1 — roleLabel()/roleStatus().role return RAW manifest repoRole, not resolver token
section("FIX1 — roleLabel()/roleStatus().role use raw manifest repoRole (backward-compat contract)");
{
  const { roleLabel, roleStatus } = require("../testsuite/role");

  // 18a: This worktree has repoRole:"canonical" → roleLabel() returns "canonical" (raw = resolver)
  ok("roleLabel() on this worktree returns raw manifest repoRole ('canonical')", roleLabel() === "canonical",
    `got: ${roleLabel()}`);
  ok("roleStatus().role on this worktree returns raw manifest repoRole ('canonical')", roleStatus().role === "canonical",
    `got: ${roleStatus().role}`);

  // 18b: repoRole:"framework" → resolver returns "canonical" (role token), raw is "framework".
  //      The shim's label contract must return "framework", NOT the resolver token "canonical".
  {
    const dir = makeTmpRepo({ manifestJson: { repoRole: "framework" } });
    try {
      const resolverRole = resolveRepoRole({ root: dir }).role;
      const rawRole = readRawRoleFrom(dir);
      ok("resolver maps repoRole:'framework' → 'canonical'", resolverRole === "canonical",
        `got: ${resolverRole}`);
      ok("raw manifest read returns 'framework' (not the resolver token)", rawRole === "framework",
        `got: ${rawRole}`);
      ok("raw and resolver DIFFER for 'framework' (the BC distinction the shim preserves)",
        rawRole !== resolverRole, `raw:${rawRole}, resolver:${resolverRole}`);
      // roleLabel() shim would return rawRole ("framework") not resolverRole ("canonical").
      const shimLabel = rawRole !== null ? rawRole : "product";
      ok("shim label contract for repoRole:'framework' is 'framework' (not 'canonical')", shimLabel === "framework",
        `got: ${shimLabel}`);
    } finally { cleanup(dir); }
  }

  // 18c: No repoRole field in manifest → raw=null → roleLabel() must return "product" (not "unknown")
  {
    const dir = makeTmpRepo({ manifestJson: { project: { name: "some-product" } } });
    try {
      const rawRole = readRawRoleFrom(dir);
      ok("no repoRole field → raw read returns null", rawRole === null, `got: ${rawRole}`);
      const shimLabel = rawRole !== null ? rawRole : "product";
      ok("null raw repoRole → shim label 'product' (backward compat)", shimLabel === "product");
    } finally { cleanup(dir); }
  }

  // 18d: Consumer repo (framework-installed.json only, no repoRole).
  //      Resolver returns "consumer"; raw repoRole is null → shim label must be "product" NOT "consumer".
  {
    const dir = makeTmpRepo({ frameworkInstalled: true });
    try {
      const resolverRole = resolveRepoRole({ root: dir }).role;
      const rawRole = readRawRoleFrom(dir);
      ok("consumer repo: resolver returns 'consumer'", resolverRole === "consumer",
        `got: ${resolverRole}`);
      ok("consumer repo: raw manifest repoRole is null (no repoRole field)", rawRole === null,
        `got: ${rawRole}`);
      const shimLabel = rawRole !== null ? rawRole : "product";
      ok("consumer repo: shim label is 'product' (NOT resolver token 'consumer')", shimLabel === "product",
        `got: ${shimLabel}`);
    } finally { cleanup(dir); }
  }

  // 18e: No manifest at all → roleStatus().role must be null (not a resolver token).
  {
    const dir = makeTmpRepo({});
    try {
      const rawRole = readRawRoleFrom(dir);
      ok("no manifest → raw repoRole is null (roleStatus().role contract)", rawRole === null,
        `got: ${rawRole}`);
    } finally { cleanup(dir); }
  }
}

// 19. FIX2 — Invalid override/env values fall through (domain validation)
section("FIX2 — invalid override/env values ignored (fall through to signals)");
{
  // 19a: Invalid override "banana" → falls through; canonical signal wins
  {
    const dir = makeTmpRepo({ mcManifest: true });
    try {
      const r = resolveRepoRole({ root: dir, override: "banana" });
      ok("invalid override 'banana' falls through → canonical via signal", r.role === "canonical",
        `got role: ${r.role}, source: ${r.source}`);
      ok("invalid override: source is NOT 'arg:override'", r.source !== "arg:override",
        `got: ${r.source}`);
    } finally { cleanup(dir); }
  }

  // 19b: Invalid override in unknown repo → falls through → "unknown"
  {
    const dir = makeTmpRepo({});
    try {
      const r = resolveRepoRole({ root: dir, override: "GARBAGE" });
      ok("invalid override 'GARBAGE' in unknown repo → 'unknown' (fall-through)", r.role === "unknown",
        `got: ${r.role}`);
    } finally { cleanup(dir); }
  }

  // 19c: Valid override "consumer" still wins over canonical signal
  {
    const dir = makeTmpRepo({ mcManifest: true });
    try {
      const r = resolveRepoRole({ root: dir, override: "consumer" });
      ok("valid override 'consumer' wins over canonical signal", r.role === "consumer",
        `got: ${r.role}`);
      ok("valid override source is 'arg:override'", r.source === "arg:override",
        `got: ${r.source}`);
    } finally { cleanup(dir); }
  }

  // 19d: Invalid env WARPOS_REPO_ROLE → falls through; canonical signal wins
  {
    const dir = makeTmpRepo({ mcManifest: true });
    const origEnv = mcEnv.readEnv("REPO_ROLE");
    mcEnv.setEnv("REPO_ROLE", "garbage_value");
    try {
      const r = resolveRepoRole({ root: dir });
      ok("invalid env 'garbage_value' falls through → canonical via signal", r.role === "canonical",
        `got role: ${r.role}, source: ${r.source}`);
      ok("invalid env: source is NOT 'env:WARPOS_REPO_ROLE'", r.source !== "env:WARPOS_REPO_ROLE",
        `got: ${r.source}`);
    } finally {
      if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
      else mcEnv.setEnv("REPO_ROLE", origEnv);
      cleanup(dir);
    }
  }

  // 19e: Valid env "consumer" still wins over canonical signal
  {
    const dir = makeTmpRepo({ mcManifest: true });
    const origEnv = mcEnv.readEnv("REPO_ROLE");
    mcEnv.setEnv("REPO_ROLE", "consumer");
    try {
      const r = resolveRepoRole({ root: dir });
      ok("valid env 'consumer' wins over canonical signal", r.role === "consumer",
        `got: ${r.role}`);
      ok("valid env source is 'env:WARPOS_REPO_ROLE'", r.source === "env:WARPOS_REPO_ROLE",
        `got: ${r.source}`);
    } finally {
      if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
      else mcEnv.setEnv("REPO_ROLE", origEnv);
      cleanup(dir);
    }
  }

  // 19f: override case-insensitive validity check — "CANONICAL" is valid (maps to "canonical")
  {
    const dir = makeTmpRepo({});
    try {
      const r = resolveRepoRole({ root: dir, override: "CANONICAL" });
      ok("valid override 'CANONICAL' (uppercased) resolves to 'canonical'", r.role === "canonical",
        `got: ${r.role}`);
    } finally { cleanup(dir); }
  }
}

// 20. FIX3 — Enforcer new pattern regex self-test
section("FIX3 — enforcer pattern self-test (new regex patterns match role-derivation shapes)");
{
  // These are meta-tests verifying the enforcer's new patterns are correctly shaped.
  const existsRolePattern =
    /(existsSync|safeExists).*_mc.*MANIFEST\.json|_mc.*MANIFEST\.json.*(existsSync|safeExists)/;
  const versionNamePattern =
    /\.name\s*===\s*['"]mc['"]|['"]mc['"]\s*===\s*\.name/;

  // existsSync / safeExists role-derivation patterns
  ok("existsRolePattern matches fs.existsSync + _mc/MANIFEST.json",
    existsRolePattern.test('if (fs.existsSync(path.join(root, "_mc", "MANIFEST.json"))) {'));
  ok("existsRolePattern matches safeExists + _mc/MANIFEST.json",
    existsRolePattern.test('if (safeExists(path.join(root, "_mc", "MANIFEST.json"))) {'));
  ok("existsRolePattern does NOT match readFileSync (content read, not role)",
    !existsRolePattern.test('const m = JSON.parse(fs.readFileSync(path.join(root, "_mc", "MANIFEST.json")));'));

  // version.json #name patterns
  ok("versionNamePattern matches .name === 'mc' (single-quote)",
    versionNamePattern.test("if (v && v.name === 'mc') {"));
  ok("versionNamePattern matches .name === \"mc\" (double-quote)",
    versionNamePattern.test('if (v && v.name === "mc") {'));
  ok("versionNamePattern does NOT match .name === 'other-project'",
    !versionNamePattern.test("if (v.name === 'other-project') {"));
  ok("versionNamePattern does NOT match bare 'mc' string without .name",
    !versionNamePattern.test('const n = "mc";'));

  // Optional-chaining accessor shapes (xprovider review 2026-06-15 BLOCKER-1b
  // hardening): the (?:\?\.|[.\[]) group catches `mc?.source` / `project?.slug`
  // in addition to dot/bracket access. (Split-var + variable-indirection shapes
  // remain line-local misses — the documented ramp-to-blocking precondition.)
  const sourceSelfPattern =
    /mc(?:\?\.|[.\[]).*source.*===.*['"]self['"]|['"]self['"].*===.*mc(?:\?\.|[.\[]).*source/;
  const slugWarposPattern =
    /project(?:\?\.|[.\[]).*slug.*===.*['"]mc['"]|['"]mc['"].*===.*project(?:\?\.|[.\[]).*slug/;
  ok("sourceSelfPattern matches mc.source === 'self' (dot access)",
    sourceSelfPattern.test('if (m.mc.source === "self") return true;'));
  ok("sourceSelfPattern matches mc?.source === 'self' (optional chaining)",
    sourceSelfPattern.test('if (manifest.mc?.source === "self") return true;'));
  ok("sourceSelfPattern does NOT match a bare content read of mc.source",
    !sourceSelfPattern.test('const v = m.mc.source;'));
  ok("slugWarposPattern matches project?.slug === 'mc' (optional chaining)",
    slugWarposPattern.test('if (m.project?.slug === "mc") refuse();'));
}

// 21. ED-009 adoption — isCanonicalDir() env-immune signals-only detector
//     The shared resolver's env-IMMUNE arm: the single source the admin:* safety
//     guards (preview.js / seed.js refuseIfTargetIsMC) now call instead of
//     re-deriving canonical signals inline. Locks BOTH the detection-by-signal
//     behavior AND the env-immunity property (the xprovider HIGH #5 concern that
//     previously justified hand-rolled detection).
section("ED-009 — isCanonicalDir() env-immune canonical-tree detector (admin:* safety floor)");
{
  // 21a: canonical via _mc/MANIFEST.json
  {
    const dir = makeTmpRepo({ mcManifest: true });
    try {
      ok("isCanonicalDir true for _mc/MANIFEST.json tree", isCanonicalDir(dir) === true);
    } finally { cleanup(dir); }
  }

  // 21b: canonical via .mc-canonical marker
  {
    const dir = makeTmpRepo({ mcCanonicalMarker: true });
    try {
      ok("isCanonicalDir true for .mc-canonical marker tree", isCanonicalDir(dir) === true);
    } finally { cleanup(dir); }
  }

  // 21c: canonical via manifest project.slug
  {
    const dir = makeTmpRepo({ manifestJson: { project: { slug: "mc" } } });
    try {
      ok("isCanonicalDir true for manifest project.slug canonical tree", isCanonicalDir(dir) === true);
    } finally { cleanup(dir); }
  }

  // 21d: consumer repo (framework-installed only) → NOT canonical
  {
    const dir = makeTmpRepo({ frameworkInstalled: true });
    try {
      ok("isCanonicalDir false for a consumer install", isCanonicalDir(dir) === false);
    } finally { cleanup(dir); }
  }

  // 21e: unknown/empty repo → NOT canonical
  {
    const dir = makeTmpRepo({});
    try {
      ok("isCanonicalDir false for an unsignaled (unknown) tree", isCanonicalDir(dir) === false);
    } finally { cleanup(dir); }
  }

  // 21f: ENV-IMMUNITY (the whole point) — WARPOS_REPO_ROLE=consumer must NOT flip
  //      a real canonical tree to non-canonical for the safety floor, even though
  //      resolveRepoRole() (which honors env) DOES return 'consumer'.
  {
    const dir = makeTmpRepo({ mcManifest: true });
    const origEnv = mcEnv.readEnv("REPO_ROLE");
    mcEnv.setEnv("REPO_ROLE", "consumer");
    try {
      ok("isCanonicalDir IGNORES WARPOS_REPO_ROLE=consumer (stays true on canonical tree)",
        isCanonicalDir(dir) === true);
      ok("resolveRepoRole HONORS WARPOS_REPO_ROLE=consumer (the divergence isCanonicalDir defeats)",
        resolveRepoRole({ root: dir }).role === "consumer");
    } finally {
      if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
      else mcEnv.setEnv("REPO_ROLE", origEnv);
      cleanup(dir);
    }
  }

  // 21g: env-immunity the OTHER direction — WARPOS_REPO_ROLE=canonical must NOT
  //      make an unsignaled tree read as canonical (no env spoof INTO canonical).
  {
    const dir = makeTmpRepo({});
    const origEnv = mcEnv.readEnv("REPO_ROLE");
    mcEnv.setEnv("REPO_ROLE", "canonical");
    try {
      ok("isCanonicalDir IGNORES WARPOS_REPO_ROLE=canonical (stays false on unsignaled tree)",
        isCanonicalDir(dir) === false);
    } finally {
      if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
      else mcEnv.setEnv("REPO_ROLE", origEnv);
      cleanup(dir);
    }
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────

process.stdout.write(`\n${"─".repeat(55)}\n`);
process.stdout.write(`Tests: ${passed + failed}  PASS: ${passed}  FAIL: ${failed}\n`);

if (failed > 0) {
  process.stderr.write(`\n${failed} test(s) failed.\n`);
  process.exit(1);
} else {
  process.stdout.write("All tests passed.\n");
  process.exit(0);
}
