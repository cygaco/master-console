#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveRepoRole, isCanonicalDir, ROLES } = require("./repo-role");

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
  if (opts.installRecord !== undefined) {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "framework-installed.json"), JSON.stringify(opts.installRecord));
  }
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
}

section("Module shape");
ok("ROLES is frozen array with 3 elements", Array.isArray(ROLES) && ROLES.length === 3);
ok("ROLES contains canonical/consumer/unknown", ROLES.includes("canonical") && ROLES.includes("consumer") && ROLES.includes("unknown"));
ok("resolveRepoRole is a function", typeof resolveRepoRole === "function");

section("Canonical repo — this worktree");
{
  const r = resolveRepoRole();
  ok("role === 'canonical'", r.role === "canonical", `got: ${r.role} (source: ${r.source})`);
  ok("canonical === true", r.canonical === true);
  ok("consumer === false", r.consumer === false);
  ok("source is non-empty", typeof r.source === "string" && r.source.length > 0);
}

section("Canonical signal — _mc/MANIFEST.json");
{
  const dir = makeTmpRepo({ mcManifest: true });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source === 'marker:_mc/MANIFEST.json'", r.source === "marker:_mc/MANIFEST.json", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

section("Canonical signal — .mc-canonical marker");
{
  const dir = makeTmpRepo({ mcCanonicalMarker: true });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source === 'marker:.mc-canonical'", r.source === "marker:.mc-canonical", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

section("Canonical signal — manifest.json#repoRole");
{
  const dir = makeTmpRepo({ manifestJson: { repoRole: "canonical" } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source contains repoRole", r.source.includes("repoRole"), `got: ${r.source}`);
  } finally { cleanup(dir); }
}

{
  const dir = makeTmpRepo({ manifestJson: { repoRole: "framework" } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("repoRole=framework → canonical", r.role === "canonical", `got: ${r.role}`);
  } finally { cleanup(dir); }
}

section("Canonical signal — manifest.json#mc.source");
{
  const dir = makeTmpRepo({ manifestJson: { mc: { source: "self" } } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source contains mc.source", r.source.includes("mc.source"), `got: ${r.source}`);
  } finally { cleanup(dir); }
}

section("Canonical signal — manifest.json#project.slug");
{
  const dir = makeTmpRepo({ manifestJson: { project: { slug: "mc" } } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source contains project.slug", r.source.includes("project.slug"), `got: ${r.source}`);
  } finally { cleanup(dir); }
}

section("Canonical signal — version.json#name");
{
  const dir = makeTmpRepo({ versionJson: { name: "mc" } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("source === 'version.json#name'", r.source === "version.json#name", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

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

section("Precedence — (a) override arg wins over env and signals");
{
  const dir = makeTmpRepo({ mcManifest: true });
  const origEnv = mcEnv.readEnv("REPO_ROLE");
  mcEnv.setEnv("REPO_ROLE", "consumer");
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

section("Precedence — (b) env override beats marker signals");
{
  const dir = makeTmpRepo({ mcManifest: true });
  const origEnv = mcEnv.readEnv("REPO_ROLE");
  mcEnv.setEnv("REPO_ROLE", "consumer");
  try {
    const r = resolveRepoRole({ root: dir });
    ok("env wins over signal — role === 'consumer'", r.role === "consumer", `got: ${r.role}`);
    ok("source === 'env:MC_REPO_ROLE'", r.source === "env:MC_REPO_ROLE", `got: ${r.source}`);
  } finally {
    if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
    else mcEnv.setEnv("REPO_ROLE", origEnv);
    cleanup(dir);
  }
}

section("Precedence — (c) manifest signal beats heuristic");
{
  const dir = makeTmpRepo({ mcManifest: true, versionJson: { name: "mc" } });
  try {
    const r = resolveRepoRole({ root: dir });
    ok("role === 'canonical'", r.role === "canonical", `got: ${r.role}`);
    ok("manifest signal wins (source is _mc/MANIFEST.json)", r.source === "marker:_mc/MANIFEST.json", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

section("Precedence — override arg lowercased");
{
  const r = resolveRepoRole({ override: "CANONICAL" });
  ok("override uppercased → lowercased role", r.role === "canonical", `got: ${r.role}`);
}

section("Fail-safe — corrupt manifest.json falls through");
{
  const dir = makeTmpRepo({ versionJson: { name: "mc" } });
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "manifest.json"), "this is not JSON {{{");
  try {
    const r = resolveRepoRole({ root: dir });
    ok("corrupt manifest → falls through to version.json", r.role === "canonical", `got: ${r.role}`);
    ok("source === 'version.json#name'", r.source === "version.json#name", `got: ${r.source}`);
  } finally { cleanup(dir); }
}

section("Regression — refactored guards produce identical verdicts");
{
  const PROJECT_DIR = process.cwd();
  const r = resolveRepoRole({ root: PROJECT_DIR });
  ok("purity-guard: isCanonicalRepo() → true on this worktree", r.role === "canonical",
    `got: ${r.role} (source: ${r.source}). Worktree should be canonical.`);
}

{
  const gateRoot = path.resolve(__dirname, "..", "..");
  const r = resolveRepoRole({ root: gateRoot });
  ok("requirements/gate.js: isCanonicalRepo() → true on this worktree", r.role === "canonical",
    `got: ${r.role} (source: ${r.source})`);
}

{
  const { isCanonical } = require("../testsuite/role");
  const result = isCanonical();
  ok("testsuite/role.js: isCanonical() → true on this worktree", result === true,
    `got: ${result}`);
}

section("opts.cwd alias");
{
  const dir = makeTmpRepo({ mcManifest: true });
  try {
    const r = resolveRepoRole({ cwd: dir });
    ok("cwd alias resolves correctly → canonical", r.role === "canonical", `got: ${r.role}`);
  } finally { cleanup(dir); }
}

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

section("roleLabel()/roleStatus().role use raw manifest repoRole (backward-compat contract)");
{
  const { roleLabel, roleStatus } = require("../testsuite/role");

  ok("roleLabel() on this worktree returns raw manifest repoRole ('canonical')", roleLabel() === "canonical",
    `got: ${roleLabel()}`);
  ok("roleStatus().role on this worktree returns raw manifest repoRole ('canonical')", roleStatus().role === "canonical",
    `got: ${roleStatus().role}`);

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
      const shimLabel = rawRole !== null ? rawRole : "product";
      ok("shim label contract for repoRole:'framework' is 'framework' (not 'canonical')", shimLabel === "framework",
        `got: ${shimLabel}`);
    } finally { cleanup(dir); }
  }

  {
    const dir = makeTmpRepo({ manifestJson: { project: { name: "some-product" } } });
    try {
      const rawRole = readRawRoleFrom(dir);
      ok("no repoRole field → raw read returns null", rawRole === null, `got: ${rawRole}`);
      const shimLabel = rawRole !== null ? rawRole : "product";
      ok("null raw repoRole → shim label 'product' (backward compat)", shimLabel === "product");
    } finally { cleanup(dir); }
  }

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

  {
    const dir = makeTmpRepo({});
    try {
      const rawRole = readRawRoleFrom(dir);
      ok("no manifest → raw repoRole is null (roleStatus().role contract)", rawRole === null,
        `got: ${rawRole}`);
    } finally { cleanup(dir); }
  }
}

section("invalid override/env values ignored (fall through to signals)");
{
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

  {
    const dir = makeTmpRepo({});
    try {
      const r = resolveRepoRole({ root: dir, override: "GARBAGE" });
      ok("invalid override 'GARBAGE' in unknown repo → 'unknown' (fall-through)", r.role === "unknown",
        `got: ${r.role}`);
    } finally { cleanup(dir); }
  }

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

  {
    const dir = makeTmpRepo({ mcManifest: true });
    const origEnv = mcEnv.readEnv("REPO_ROLE");
    mcEnv.setEnv("REPO_ROLE", "garbage_value");
    try {
      const r = resolveRepoRole({ root: dir });
      ok("invalid env 'garbage_value' falls through → canonical via signal", r.role === "canonical",
        `got role: ${r.role}, source: ${r.source}`);
      ok("invalid env: source is NOT 'env:MC_REPO_ROLE'", r.source !== "env:MC_REPO_ROLE",
        `got: ${r.source}`);
    } finally {
      if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
      else mcEnv.setEnv("REPO_ROLE", origEnv);
      cleanup(dir);
    }
  }

  {
    const dir = makeTmpRepo({ mcManifest: true });
    const origEnv = mcEnv.readEnv("REPO_ROLE");
    mcEnv.setEnv("REPO_ROLE", "consumer");
    try {
      const r = resolveRepoRole({ root: dir });
      ok("valid env 'consumer' wins over canonical signal", r.role === "consumer",
        `got: ${r.role}`);
      ok("valid env source is 'env:MC_REPO_ROLE'", r.source === "env:MC_REPO_ROLE",
        `got: ${r.source}`);
    } finally {
      if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
      else mcEnv.setEnv("REPO_ROLE", origEnv);
      cleanup(dir);
    }
  }

  {
    const dir = makeTmpRepo({});
    try {
      const r = resolveRepoRole({ root: dir, override: "CANONICAL" });
      ok("valid override 'CANONICAL' (uppercased) resolves to 'canonical'", r.role === "canonical",
        `got: ${r.role}`);
    } finally { cleanup(dir); }
  }
}

section("enforcer pattern self-test (new regex patterns match role-derivation shapes)");
{
  const existsRolePattern =
    /(existsSync|safeExists).*_mc.*MANIFEST\.json|_mc.*MANIFEST\.json.*(existsSync|safeExists)/;
  const versionNamePattern =
    /\.name\s*===\s*['"]mc['"]|['"]mc['"]\s*===\s*\.name/;

  ok("existsRolePattern matches fs.existsSync + _mc/MANIFEST.json",
    existsRolePattern.test('if (fs.existsSync(path.join(root, "_mc", "MANIFEST.json"))) {'));
  ok("existsRolePattern matches safeExists + _mc/MANIFEST.json",
    existsRolePattern.test('if (safeExists(path.join(root, "_mc", "MANIFEST.json"))) {'));
  ok("existsRolePattern does NOT match readFileSync (content read, not role)",
    !existsRolePattern.test('const m = JSON.parse(fs.readFileSync(path.join(root, "_mc", "MANIFEST.json")));'));

  ok("versionNamePattern matches .name === 'mc' (single-quote)",
    versionNamePattern.test("if (v && v.name === 'mc') {"));
  ok("versionNamePattern matches .name === \"mc\" (double-quote)",
    versionNamePattern.test('if (v && v.name === "mc") {'));
  ok("versionNamePattern does NOT match .name === 'other-project'",
    !versionNamePattern.test("if (v.name === 'other-project') {"));
  ok("versionNamePattern does NOT match bare 'mc' string without .name",
    !versionNamePattern.test('const n = "mc";'));

  const sourceSelfPattern =
    /mc(?:\?\.|[.\[]).*source.*===.*['"]self['"]|['"]self['"].*===.*mc(?:\?\.|[.\[]).*source/;
  const slugMcPattern =
    /project(?:\?\.|[.\[]).*slug.*===.*['"]mc['"]|['"]mc['"].*===.*project(?:\?\.|[.\[]).*slug/;
  ok("sourceSelfPattern matches mc.source === 'self' (dot access)",
    sourceSelfPattern.test('if (m.mc.source === "self") return true;'));
  ok("sourceSelfPattern matches mc?.source === 'self' (optional chaining)",
    sourceSelfPattern.test('if (manifest.mc?.source === "self") return true;'));
  ok("sourceSelfPattern does NOT match a bare content read of mc.source",
    !sourceSelfPattern.test('const v = m.mc.source;'));
  ok("slugMcPattern matches project?.slug === 'mc' (optional chaining)",
    slugMcPattern.test('if (m.project?.slug === "mc") refuse();'));
}

section("isCanonicalDir() env-immune canonical-tree detector (admin:* safety floor)");
{
  {
    const dir = makeTmpRepo({ mcManifest: true });
    try {
      ok("isCanonicalDir true for _mc/MANIFEST.json tree", isCanonicalDir(dir) === true);
    } finally { cleanup(dir); }
  }

  {
    const dir = makeTmpRepo({ mcCanonicalMarker: true });
    try {
      ok("isCanonicalDir true for .mc-canonical marker tree", isCanonicalDir(dir) === true);
    } finally { cleanup(dir); }
  }

  {
    const dir = makeTmpRepo({ manifestJson: { project: { slug: "mc" } } });
    try {
      ok("isCanonicalDir true for manifest project.slug canonical tree", isCanonicalDir(dir) === true);
    } finally { cleanup(dir); }
  }

  {
    const dir = makeTmpRepo({ frameworkInstalled: true });
    try {
      ok("isCanonicalDir false for a consumer install", isCanonicalDir(dir) === false);
    } finally { cleanup(dir); }
  }

  {
    const dir = makeTmpRepo({});
    try {
      ok("isCanonicalDir false for an unsignaled (unknown) tree", isCanonicalDir(dir) === false);
    } finally { cleanup(dir); }
  }

  {
    const dir = makeTmpRepo({ mcManifest: true });
    const origEnv = mcEnv.readEnv("REPO_ROLE");
    mcEnv.setEnv("REPO_ROLE", "consumer");
    try {
      ok("isCanonicalDir IGNORES MC_REPO_ROLE=consumer (stays true on canonical tree)",
        isCanonicalDir(dir) === true);
      ok("resolveRepoRole HONORS MC_REPO_ROLE=consumer (the divergence isCanonicalDir defeats)",
        resolveRepoRole({ root: dir }).role === "consumer");
    } finally {
      if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
      else mcEnv.setEnv("REPO_ROLE", origEnv);
      cleanup(dir);
    }
  }

  {
    const dir = makeTmpRepo({});
    const origEnv = mcEnv.readEnv("REPO_ROLE");
    mcEnv.setEnv("REPO_ROLE", "canonical");
    try {
      ok("isCanonicalDir IGNORES MC_REPO_ROLE=canonical (stays false on unsignaled tree)",
        isCanonicalDir(dir) === false);
    } finally {
      if (origEnv === undefined) mcEnv.unsetEnv("REPO_ROLE");
      else mcEnv.setEnv("REPO_ROLE", origEnv);
      cleanup(dir);
    }
  }
}

section("installed product — install record outranks the structural signals");
{
  const record = (source) => ({ $schema: "mc/framework-installed/v2", installedVersion: "2.1.0", source });

  const cases = [
    ["install record + _mc/MANIFEST.json → consumer", { installRecord: record("C:\\src\\mc"), mcManifest: true }, "consumer"],
    ["install record + version.json#name=mc → consumer", { installRecord: record("https://example.invalid/mc.git"), versionJson: { name: "mc" } }, "consumer"],
    ["install record + both structural signals → consumer", { installRecord: record("/src/mc"), mcManifest: true, versionJson: { name: "mc" } }, "consumer"],
    ["source 'self' record + _mc/MANIFEST.json → canonical (the framework's own snapshot)", { installRecord: record("self"), mcManifest: true }, "canonical"],
    ["install record + manifest.json#repoRole=canonical → canonical (explicit declaration wins)", { installRecord: record("/src/mc"), mcManifest: true, manifestJson: { repoRole: "canonical" } }, "canonical"],
    ["install record + .mc-canonical marker → canonical", { installRecord: record("/src/mc"), mcManifest: true, mcCanonicalMarker: true }, "canonical"],
    ["record without the framework-installed $schema + _mc/MANIFEST.json → canonical (not an install record)", { installRecord: { source: "/src/mc" }, mcManifest: true }, "canonical"],
  ];
  for (const [label, opts, want] of cases) {
    const dir = makeTmpRepo(opts);
    try {
      const r = resolveRepoRole({ root: dir });
      ok(label, r.role === want, `got: ${r.role} (source: ${r.source})`);
      ok(`${label} — isCanonicalDir agrees`, isCanonicalDir(dir) === (want === "canonical"), `got: ${isCanonicalDir(dir)}`);
    } finally { cleanup(dir); }
  }

  {
    const dir = makeTmpRepo({ installRecord: record("C:\\src\\mc"), mcManifest: true, versionJson: { name: "mc" } });
    try {
      const r = resolveRepoRole({ root: dir });
      ok("installed product: source names the install record", r.source === "heuristic:framework-installed.json", `got: ${r.source}`);
    } finally { cleanup(dir); }
  }
}

section("install record — source 'self' is matched case- and whitespace-insensitively");
{
  for (const self of ["self", "SELF", " Self ", "\tself\n"]) {
    const dir = makeTmpRepo({ installRecord: { $schema: "mc/framework-installed/v2", source: self }, mcManifest: true });
    try {
      const r = resolveRepoRole({ root: dir });
      ok(`record source ${JSON.stringify(self)} is the framework's own snapshot → canonical`, r.role === "canonical", `got: ${r.role} (source: ${r.source})`);
    } finally { cleanup(dir); }
  }
}

section("precedence pin — explicit declarations win over an install record and the structural signals");
{
  const forged = { $schema: "mc/framework-installed/v2", installedVersion: "2.1.0", source: "C:\\forged\\source" };
  const declarations = [
    ["marker:.mc-canonical", { mcCanonicalMarker: true }],
    ["manifest.json#repoRole", { manifestJson: { repoRole: "canonical" } }],
    ["manifest.json#mc.repoRole", { manifestJson: { mc: { repoRole: "canonical" } } }],
    ["manifest.json#mc.source", { manifestJson: { mc: { source: "self" } } }],
    ["manifest.json#project.slug", { manifestJson: { project: { slug: "mc" } } }],
  ];
  for (const [token, decl] of declarations) {
    for (const withRecord of [true, false]) {
      const opts = { ...decl, mcManifest: true, versionJson: { name: "mc" } };
      if (withRecord) opts.installRecord = forged;
      const dir = makeTmpRepo(opts);
      try {
        const r = resolveRepoRole({ root: dir });
        const label = `${token}${withRecord ? " + forged install record" : ""} + structural signals`;
        ok(`${label} → canonical`, r.role === "canonical", `got: ${r.role}`);
        ok(`${label} → source is the declaration`, r.source === token, `got: ${r.source}`);
        ok(`${label} → isCanonicalDir true`, isCanonicalDir(dir) === true);
      } finally { cleanup(dir); }
    }
  }
}

section("tripwire — this framework tree resolves via an explicit declaration");
{
  const EXPLICIT = new Set([
    "marker:.mc-canonical",
    "manifest.json#repoRole",
    "manifest.json#mc.repoRole",
    "manifest.json#mc.source",
    "manifest.json#project.slug",
  ]);
  const r = resolveRepoRole({ root: path.resolve(__dirname, "..", "..") });
  ok("this tree resolves canonical", r.role === "canonical", `got: ${r.role} (source: ${r.source})`);
  ok("this tree's canonical source is an explicit declaration", EXPLICIT.has(r.source), `got: ${r.source}`);
}

process.stdout.write(`\n${"─".repeat(55)}\n`);
process.stdout.write(`Tests: ${passed + failed}  PASS: ${passed}  FAIL: ${failed}\n`);

if (failed > 0) {
  process.stderr.write(`\n${failed} test(s) failed.\n`);
  process.exit(1);
} else {
  process.stdout.write("All tests passed.\n");
  process.exit(0);
}
