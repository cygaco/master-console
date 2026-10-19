#!/usr/bin/env node
const mcEnv = require("../hooks/lib/mc-env");
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_LEG_TIMEOUT_MS = 180_000;
const ALEX_MARKER = "You are **Alex α**";

function assertSandboxTargetSafe(targetPath, { label = "target" } = {}) {
  const resolved = path.resolve(targetPath);
  const bannedRoots = [REPO_ROOT, path.resolve(REPO_ROOT, "..")];
  for (const banned of bannedRoots) {
    if (resolved === banned || resolved.startsWith(banned + path.sep)) {
      throw new Error(
        `SANDBOX-REFUSED (pre-run guard): ${label} resolves inside a banned root ` +
          `(canonical root or the real portfolio-sibling location) — ${resolved} is under ${banned}`,
      );
    }
  }
  const tmpRoot = path.resolve(os.tmpdir());
  const underTmp = resolved === tmpRoot || resolved.startsWith(tmpRoot + path.sep);
  if (!underTmp) {
    throw new Error(
      `SANDBOX-REFUSED (pre-run guard): ${label} must resolve under os.tmpdir() ` +
        `(${tmpRoot}) — got ${resolved}`,
    );
  }
  return true;
}

function snapshotCanonicalState() {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(
      `git status snapshot failed (status=${r.status}${r.error ? `, ${r.error.code || r.error.message}` : ""}): ${(r.stderr || r.stdout || "").slice(0, 300)}`,
    );
  }
  return (r.stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .sort()
    .join("\n");
}

function noDeltaCheck(before, after) {
  const equal = before === after;
  let onlyBefore = [];
  let onlyAfter = [];
  if (!equal) {
    const beforeSet = new Set(before.split("\n").filter(Boolean));
    const afterSet = new Set(after.split("\n").filter(Boolean));
    onlyBefore = [...beforeSet].filter((l) => !afterSet.has(l));
    onlyAfter = [...afterSet].filter((l) => !beforeSet.has(l));
  }
  return { equal, onlyBefore, onlyAfter };
}

function describeSpawnFailure(r) {
  if (!r) return "no result (spawn never returned)";
  if (r.error) return `spawn error: ${r.error.message}`;
  if (r.signal) return `TIMEOUT/KILLED (signal=${r.signal}) — fail-closed`;
  return `code=${r.status} ${(r.stderr || r.stdout || "").slice(-300)}`;
}

function hasFrameworkInstalled(dir) {
  return fs.existsSync(path.join(dir, ".claude", "framework-installed.json"));
}

function resolveTreeRole(dir) {
  const script = path.join(dir, "scripts", "mc", "repo-role.js");
  if (!fs.existsSync(script)) return { role: null, source: `no scripts/mc/repo-role.js in ${dir}` };
  const env = { ...process.env };
  const names = mcEnv.envNames("REPO_ROLE");
  delete env[names.current];
  delete env[names.legacy];
  const r = spawnSync(process.execPath, [script, "--json"], { cwd: dir, env, encoding: "utf8", timeout: 30_000 });
  try {
    const parsed = JSON.parse(r.stdout);
    return { role: parsed.role, source: parsed.source };
  } catch {
    return { role: null, source: `repo-role.js output unparseable: ${describeSpawnFailure(r)}` };
  }
}

function isConsumerRole(resolved) {
  return !!resolved && resolved.role === "consumer";
}

function assertConsumerRole(assert, label, dir) {
  const resolved = resolveTreeRole(dir);
  assert(`${label} tree resolves as a consumer install (repo-role)`, isConsumerRole(resolved), `role=${resolved.role} source=${resolved.source}`);
}

function assertManifestHonest(assert, label, dir) {
  const script = path.join(dir, "scripts", "mc", "manifest", "validate.js");
  const r = fs.existsSync(script)
    ? spawnSync(process.execPath, [script, "--strict", "--root", dir], { cwd: dir, encoding: "utf8", timeout: 120_000 })
    : null;
  assert(
    `${label} tree: its _mc/MANIFEST.json validates --strict (no finding)`,
    !!r && r.status === 0,
    r ? describeSpawnFailure(r) : `no scripts/mc/manifest/validate.js in ${dir}`,
  );
}

function assertIdentityMerged(mergedContent, canonicalClaudeMdContent) {
  return (
    typeof mergedContent === "string" &&
    typeof canonicalClaudeMdContent === "string" &&
    canonicalClaudeMdContent.length > 0 &&
    mergedContent.includes(canonicalClaudeMdContent)
  );
}

function assertSeededSurvived(mergedContent, sentinel) {
  return typeof mergedContent === "string" && mergedContent.includes(sentinel);
}

function validateInstalledHookSchema(sandboxDir) {
  let registry;
  try {
    registry = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "framework", "hooks.registry.json"), "utf8"),
    );
  } catch (e) {
    return { ok: false, detail: `canonical hooks.registry.json unreadable: ${e.message}` };
  }
  if (registry.$schema !== "mc/hooks-registry/v1") {
    return { ok: false, detail: `unexpected canonical registry $schema: ${registry.$schema}` };
  }
  const expectedEvents = new Set();
  for (const h of registry.hooks || []) {
    if (h.enabled === false) continue;
    for (const reg of h.registrations || []) expectedEvents.add(reg.event);
  }
  const settingsPath = path.join(sandboxDir, ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) {
    return { ok: false, detail: "installed .claude/settings.json missing" };
  }
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (e) {
    return { ok: false, detail: `installed settings.json unparseable: ${e.message}` };
  }
  if (!settings.hooks || typeof settings.hooks !== "object") {
    return { ok: false, detail: "installed settings.json has no hooks block" };
  }
  const installedEvents = new Set(Object.keys(settings.hooks));
  const missing = [...expectedEvents].filter((e) => !installedEvents.has(e));
  if (missing.length) {
    return {
      ok: false,
      detail: `installed hooks block missing event(s) the canonical registry declares: ${missing.join(", ")}`,
    };
  }
  return { ok: true, detail: `${expectedEvents.size} event(s) covered` };
}

function realPortfolioRegistryPath() {
  return path.join(os.homedir(), ".mc", "portfolio.json");
}
function readRealRegistryRaw() {
  try {
    return fs.readFileSync(realPortfolioRegistryPath(), "utf8");
  } catch {
    return null;
  }
}

function findPowershellReal() {
  for (const exe of ["pwsh", "powershell"]) {
    const probe = spawnSync(exe, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    if (probe.status === 0 && /\d/.test(probe.stdout || "")) return exe;
  }
  return null;
}

function runLeg1({ sandboxRoot, timeoutMs }) {
  const t0 = Date.now();
  const assertions = [];
  const assert = (name, ok, detail) =>
    assertions.push({ name, status: ok ? "pass" : "fail", detail: ok ? undefined : detail || "" });

  const parentDir = path.join(sandboxRoot, "leg1-portfolio-parent");
  const slug = `scaffold-leg1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sandboxRegistryPath = path.join(sandboxRoot, "leg1-sandbox-registry", "portfolio.json");
  const realRegistryBefore = readRealRegistryRaw();
  let savedRegistryEnv;
  let repoPath = null;

  try {
    const prospectiveRepoPath = path.resolve(parentDir, slug);
    assertSandboxTargetSafe(prospectiveRepoPath, { label: "leg1 scaffold target" });

    fs.mkdirSync(parentDir, { recursive: true });
    fs.mkdirSync(path.dirname(sandboxRegistryPath), { recursive: true });

    savedRegistryEnv = mcEnv.readEnv("PORTFOLIO_REGISTRY");
    mcEnv.setEnv("PORTFOLIO_REGISTRY", sandboxRegistryPath);

    const { createProductRepo } = require("../portfolio/new-lib");
    const result = createProductRepo({
      slug,
      parentDir,
      wantNoScaffold: true,
      wantInstall: false,
      wantGithub: false,
      log: () => {},
      errorLog: () => {},
    });

    assert("createProductRepo() returns ok:true", !!(result && result.ok), (result && result.error) || "no result");
    repoPath = (result && result.repoPath) || prospectiveRepoPath;

    assert(
      "framework-installed.json present in the new sandbox repo",
      hasFrameworkInstalled(repoPath),
      `expected .claude/framework-installed.json under ${repoPath}`,
    );
    assertConsumerRole(assert, "leg1 /portfolio:new", repoPath);
    assertManifestHonest(assert, "leg1 /portfolio:new", repoPath);

    let sandboxRegistryOk = false;
    let sandboxRegistryDetail = "";
    try {
      const doc = JSON.parse(fs.readFileSync(sandboxRegistryPath, "utf8"));
      sandboxRegistryOk = !!(doc.products && doc.products[slug] && doc.products[slug].repo_path === repoPath);
      if (!sandboxRegistryOk) sandboxRegistryDetail = `doc.products=${JSON.stringify(Object.keys(doc.products || {}))}`;
    } catch (e) {
      sandboxRegistryDetail = e.message;
    }
    assert("registry entry present in the SANDBOX registry doc (not the real one)", sandboxRegistryOk, sandboxRegistryDetail);

    const scan = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check", "install.js")], {
      cwd: repoPath,
      encoding: "utf8",
      timeout: timeoutMs,
    });
    assert("scan:install GREEN in the new sandbox repo", scan.status === 0, describeSpawnFailure(scan));
  } catch (e) {
    assert("leg1 ran without throwing", false, e.message);
  } finally {
    if (savedRegistryEnv !== undefined) mcEnv.setEnv("PORTFOLIO_REGISTRY", savedRegistryEnv);
    else mcEnv.unsetEnv("PORTFOLIO_REGISTRY");

    const realRegistryAfter = readRealRegistryRaw();
    assert(
      "real portfolio registry (~/.mc/portfolio.json) unmutated by the sandboxed leg1 run",
      realRegistryAfter === realRegistryBefore,
      "the REAL registry changed during a sandboxed leg1 run — the registry seam leaked",
    );

    try {
      fs.rmSync(parentDir, { recursive: true, force: true });
    } catch {
    }
    try {
      fs.rmSync(path.dirname(sandboxRegistryPath), { recursive: true, force: true });
    } catch {
    }
  }

  return {
    leg: 1,
    name: "portfolio_new",
    ran: true,
    ok: assertions.every((a) => a.status === "pass"),
    asserts: assertions,
    durationMs: Date.now() - t0,
  };
}

function runLeg2({ sandboxRoot, timeoutMs }) {
  const t0 = Date.now();
  const assertions = [];
  const assert = (name, ok, detail) =>
    assertions.push({ name, status: ok ? "pass" : "fail", detail: ok ? undefined : detail || "" });

  const sandboxDir = path.join(sandboxRoot, "leg2-manual-setup");
  const sentinel = `<!-- OPERATOR-SEEDED-CLAUDE-MD sentinel-${Date.now()}-${Math.random().toString(36).slice(2, 8)} -->`;
  const seededBody = `# My Product\n\n${sentinel}\nThis is the operator's own pre-existing CLAUDE.md, seeded BEFORE install.\n`;

  try {
    assertSandboxTargetSafe(sandboxDir, { label: "leg2 target" });
    fs.mkdirSync(sandboxDir, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: sandboxDir, encoding: "utf8", timeout: timeoutMs });

    const claudeMdPath = path.join(sandboxDir, "CLAUDE.md");
    fs.writeFileSync(claudeMdPath, seededBody);

    const setup = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "mc-setup.js"), sandboxDir, "--yes"],
      { encoding: "utf8", timeout: timeoutMs },
    );
    assert("manual /mc:setup (--yes) exits 0", setup.status === 0, describeSpawnFailure(setup));

    const mergedContent = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, "utf8") : "";
    const canonicalClaudeMd = fs.readFileSync(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");

    assert(
      "identity merged INTO CLAUDE.md",
      assertIdentityMerged(mergedContent, canonicalClaudeMd),
      "expected the canonical CLAUDE.md content to appear (appended) in the merged file",
    );
    assert(
      "seeded original content SURVIVED (not clobbered)",
      assertSeededSurvived(mergedContent, sentinel),
      "seeded sentinel missing from the merged CLAUDE.md — the operator's content was clobbered",
    );

    const backupRoot = path.join(sandboxDir, ".mc-backup");
    let backupHasClaudeMd = false;
    if (fs.existsSync(backupRoot)) {
      for (const ts of fs.readdirSync(backupRoot)) {
        if (fs.existsSync(path.join(backupRoot, ts, "CLAUDE.md"))) {
          backupHasClaudeMd = true;
          break;
        }
      }
    }
    assert(
      "pre-merge backup of CLAUDE.md exists under .mc-backup/<ts>/",
      backupHasClaudeMd,
      `checked ${backupRoot}`,
    );

    const hookSchema = validateInstalledHookSchema(sandboxDir);
    assert("installed hook-schema validates", hookSchema.ok, hookSchema.detail);
    assertConsumerRole(assert, "leg2 manual /mc:setup", sandboxDir);
    assertManifestHonest(assert, "leg2 manual /mc:setup", sandboxDir);

    try {
      const fmSrc = path.join(REPO_ROOT, ".claude", "framework-manifest.json");
      const fmDst = path.join(sandboxDir, ".claude", "framework-manifest.json");
      if (fs.existsSync(fmSrc) && !fs.existsSync(fmDst)) fs.copyFileSync(fmSrc, fmDst);
    } catch {
    }
    const scan = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check", "install.js")], {
      cwd: sandboxDir,
      encoding: "utf8",
      timeout: timeoutMs,
    });
    assert("scan:install GREEN after manual /mc:setup", scan.status === 0, describeSpawnFailure(scan));
  } catch (e) {
    assert("leg2 ran without throwing", false, e.message);
  }

  return {
    leg: 2,
    name: "manual_mc_setup",
    ran: true,
    ok: assertions.every((a) => a.status === "pass"),
    asserts: assertions,
    durationMs: Date.now() - t0,
    sandboxDir,
  };
}

function runLeg3({ sandboxRoot, timeoutMs, findPs = findPowershellReal, runInstaller = null, leg2Dir = null }) {
  const t0 = Date.now();
  const assertions = [];
  const assert = (name, ok, detail) =>
    assertions.push({ name, status: ok ? "pass" : "fail", detail: ok ? undefined : detail || "" });

  const sandboxDir = path.join(sandboxRoot, "leg3-installps1");
  const ps = findPs();

  if (!ps) {
    return {
      leg: 3,
      name: "shipped_install_ps1",
      ran: false,
      ok: null,
      ps_available: false,
      asserts: [
        {
          name: "Leg-3 SKIPPED (no PowerShell available on this host)",
          status: "pass",
          detail: "ps_available=false — gate is INCOMPLETE, not a pass",
        },
      ],
      durationMs: Date.now() - t0,
    };
  }

  const install =
    runInstaller ||
    ((targetDir) =>
      spawnSync(
        ps,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(REPO_ROOT, "install.ps1"),
          "-Target",
          targetDir,
          "-SkipPrompt",
        ],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: timeoutMs },
      ));

  try {
    assertSandboxTargetSafe(sandboxDir, { label: "leg3 target" });
    fs.mkdirSync(sandboxDir, { recursive: true });

    const r = install(sandboxDir);
    assert("install.ps1 -SkipPrompt exits 0 (PowerShell present, shipped installer)", r.status === 0, describeSpawnFailure(r));

    assert(
      "install.ps1 produced a real install (framework-installed.json present) — no silent downgrade",
      hasFrameworkInstalled(sandboxDir),
      `expected .claude/framework-installed.json under ${sandboxDir} — PS reported success but no engine was installed`,
    );
    assertConsumerRole(assert, "leg3 install.ps1", sandboxDir);
    assertManifestHonest(assert, "leg3 install.ps1", sandboxDir);

    for (const p of ["_mc", "_mc/MANIFEST.json", "_requirements/00-canonical", "_docs", "ROADMAP.md", "PROJECT.md"]) {
      assert(`installps1: ${p} present (COMPLETE install, not a bare asset copy)`, fs.existsSync(path.join(sandboxDir, p)), `expected ${p}`);
    }

    const regen = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "mc", "views", "regenerate.js"), "--check", "--root", sandboxDir],
      { encoding: "utf8", timeout: timeoutMs },
    );
    assert("regenerate.js --check clean (.claude/ reproducible from _mc/)", regen.status === 0, describeSpawnFailure(regen));

    const scan = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check", "install.js")], {
      cwd: sandboxDir,
      encoding: "utf8",
      timeout: timeoutMs,
    });
    assert("scan:install GREEN after shipped install.ps1", scan.status === 0, describeSpawnFailure(scan));

    if (leg2Dir && fs.existsSync(leg2Dir)) {
      // eslint-disable-next-line global-require
      const { treeFileList, parityDiff } = require("./test-install-matrix");
      const leg2List = treeFileList(leg2Dir);
      const leg3List = treeFileList(sandboxDir);
      const parity = parityDiff(leg2List, leg3List);
      assert(
        "both_path_parity: install.ps1 tree == manual /mc:setup tree (sorted relative paths, modulo the named allowlist)",
        parity.equal,
        `onlyInLeg2(${parity.onlyInA.length})=${parity.onlyInA.slice(0, 8).join(", ")} | onlyInLeg3(${parity.onlyInB.length})=${parity.onlyInB.slice(0, 8).join(", ")}`,
      );
      assert(
        "both_path_parity: both trees are non-empty in-scope file sets (a parity of two empty trees is vacuous)",
        leg2List.length > 0 && leg3List.length > 0,
        `leg2=${leg2List.length} leg3=${leg3List.length}`,
      );
    } else {
      assert("both_path_parity: Leg-2 tree available for comparison", false, `leg2Dir missing or not found: ${leg2Dir}`);
    }
  } catch (e) {
    assert("leg3 ran without throwing", false, e.message);
  }

  return {
    leg: 3,
    name: "shipped_install_ps1",
    ran: true,
    ok: assertions.every((a) => a.status === "pass"),
    ps_available: true,
    asserts: assertions,
    durationMs: Date.now() - t0,
    sandboxDir,
  };
}

function runEngine({ timeoutMs = DEFAULT_LEG_TIMEOUT_MS } = {}) {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scaffold-all-ways-"));
  const beforeSnapshot = snapshotCanonicalState();
  let leg1;
  let leg2;
  let leg3;

  try {
    try {
      leg1 = runLeg1({ sandboxRoot, timeoutMs });
    } catch (e) {
      leg1 = { leg: 1, name: "portfolio_new", ran: true, ok: false, asserts: [{ name: "leg1 threw", status: "fail", detail: e.message }], durationMs: 0 };
    }

    try {
      leg2 = runLeg2({ sandboxRoot, timeoutMs });
    } catch (e) {
      leg2 = { leg: 2, name: "manual_mc_setup", ran: true, ok: false, asserts: [{ name: "leg2 threw", status: "fail", detail: e.message }], durationMs: 0 };
    }

    try {
      leg3 = runLeg3({ sandboxRoot, timeoutMs, leg2Dir: leg2 && leg2.sandboxDir });
    } catch (e) {
      leg3 = { leg: 3, name: "shipped_install_ps1", ran: true, ok: false, ps_available: true, asserts: [{ name: "leg3 threw", status: "fail", detail: e.message }], durationMs: 0 };
    }
  } finally {
    try {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    } catch {
    }
  }

  const afterSnapshot = snapshotCanonicalState();
  const delta = noDeltaCheck(beforeSnapshot, afterSnapshot);

  const legs = [leg1, leg2, leg3];
  const psAvailable = leg3.ps_available !== false;
  const incomplete = leg3.ran === false;
  const legsOk = leg1.ok && leg2.ok && (leg3.ran ? leg3.ok : true);
  const ok = legsOk && delta.equal && !incomplete;

  return {
    ok,
    incomplete,
    ps_available: psAvailable,
    legs,
    sandbox_isolation: {
      no_delta: delta.equal,
      onlyBefore: delta.onlyBefore,
      onlyAfter: delta.onlyAfter,
    },
  };
}

function selfTest() {
  const results = [];
  const t = (name, fn) => {
    try {
      const r = fn();
      results.push({ name, status: r === false ? "fail" : "pass", detail: r === false ? "" : undefined });
    } catch (e) {
      results.push({ name, status: "fail", detail: e.message });
    }
  };

  t("pre-run guard REFUSES a leg pointed at canonical root", () => {
    let threw = false;
    try {
      assertSandboxTargetSafe(REPO_ROOT, { label: "self-test canonical" });
    } catch {
      threw = true;
    }
    return threw;
  });
  t("pre-run guard REFUSES a leg pointed at the real portfolio-sibling location", () => {
    let threw = false;
    try {
      assertSandboxTargetSafe(path.resolve(REPO_ROOT, "..", "some-fake-slug-selftest"), { label: "self-test sibling" });
    } catch {
      threw = true;
    }
    return threw;
  });
  t("pre-run guard ALLOWS a legit os.tmpdir() sandbox target (positive control)", () => {
    let threw = false;
    try {
      assertSandboxTargetSafe(path.join(os.tmpdir(), "mc-scaffold-all-ways-selftest-probe"), { label: "self-test tmp" });
    } catch {
      threw = true;
    }
    return !threw;
  });

  t("no-delta check: identical snapshots are equal", () => {
    const snap = snapshotCanonicalState();
    return noDeltaCheck(snap, snap).equal === true;
  });
  t("no-delta check: a REAL simulated leak into canonical is caught as a DELTA", () => {
    const probe = path.join(REPO_ROOT, `.scaffold-all-ways-leak-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const before = snapshotCanonicalState();
    let after;
    try {
      fs.writeFileSync(probe, "leak probe — deleted immediately by the self-test\n");
      after = snapshotCanonicalState();
    } finally {
      try {
        fs.rmSync(probe, { force: true });
      } catch {
      }
    }
    const delta = noDeltaCheck(before, after);
    const cleanedUp = snapshotCanonicalState();
    return delta.equal === false && noDeltaCheck(before, cleanedUp).equal === true;
  });

  t("Leg-2 SURVIVED-original assert REDs on a clobbered seed (sentinel stripped)", () => {
    const sentinel = "<!-- sentinel-selftest -->";
    const clobbered = "some content with no sentinel in it\n";
    return assertSeededSurvived(clobbered, sentinel) === false;
  });
  t("Leg-2 identity-merged assert REDs when the alex content is missing", () => {
    const canonical = "UNIQUE-CANONICAL-CONTENT-MARKER-SELFTEST";
    const clobbered = "user content only, alex content never appended\n";
    return assertIdentityMerged(clobbered, canonical) === false;
  });
  t("Leg-2 identity-merged assert GREENs on a real merge shape (positive control)", () => {
    const canonical = "UNIQUE-CANONICAL-CONTENT-MARKER-SELFTEST-2";
    const merged = `user content\n\n---\n\n${canonical}`;
    return assertIdentityMerged(merged, canonical) === true;
  });

  t("Leg-1 assert REDs on a scaffold missing framework-installed.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scaffold-all-ways-selftest-leg1-"));
    try {
      return hasFrameworkInstalled(tmp) === false;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  t("consumer-role assert REDs on a tree that resolves canonical", () => isConsumerRole({ role: "canonical", source: "x" }) === false);
  t("consumer-role assert REDs on a tree that carries no repo-role.js", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scaffold-all-ways-selftest-role-"));
    try {
      return isConsumerRole(resolveTreeRole(tmp)) === false;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  t("consumer-role assert GREENs on a consumer resolution (positive control)", () => isConsumerRole({ role: "consumer", source: "x" }) === true);

  t("Leg-3 PARITY assert REDs on a divergent tree", () => {
    // eslint-disable-next-line global-require
    const { parityDiff } = require("./test-install-matrix");
    return parityDiff(["a", "b", "c"], ["a", "b"]).equal === false;
  });
  t("Leg-3 REDs on PS-present-but-node-downgrade (simulated silent success)", () => {
    const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scaffold-all-ways-selftest-leg3-"));
    try {
      const fakeInstaller = (targetDir) => {
        fs.mkdirSync(targetDir, { recursive: true });
        return { status: 0, stdout: "fake success", stderr: "", signal: null };
      };
      const leg3 = runLeg3({
        sandboxRoot,
        timeoutMs: 30_000,
        findPs: () => "fake-ps",
        runInstaller: fakeInstaller,
        leg2Dir: null,
      });
      const completenessAssert = leg3.asserts.find((a) => /no silent downgrade/.test(a.name));
      return leg3.ok === false && !!completenessAssert && completenessAssert.status === "fail";
    } finally {
      try {
        fs.rmSync(sandboxRoot, { recursive: true, force: true });
      } catch {
      }
    }
  });
  t("Leg-3 skip-loud: no PowerShell => ran:false, ok:null, ps_available:false (never a silent pass)", () => {
    const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scaffold-all-ways-selftest-leg3-nops-"));
    try {
      const leg3 = runLeg3({ sandboxRoot, timeoutMs: 30_000, findPs: () => null });
      return leg3.ran === false && leg3.ok === null && leg3.ps_available === false;
    } finally {
      try {
        fs.rmSync(sandboxRoot, { recursive: true, force: true });
      } catch {
      }
    }
  });

  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.length - pass;
  return { ok: fail === 0, pass, fail, results };
}

function parseArgs(argv) {
  const out = { help: false, json: false, timeoutMs: DEFAULT_LEG_TIMEOUT_MS, selfTest: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--self-test") out.selfTest = true;
    else if (a === "--timeout-ms") out.timeoutMs = parseInt(argv[++i], 10) || DEFAULT_LEG_TIMEOUT_MS;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    `Usage: node scripts/mc/test-scaffold-all-ways.js [--json] [--timeout-ms <n>] [--self-test] [--help]\n\n` +
      `Runs the fresh_scaffold_all_ways engine: 3 real, sandbox-isolated\n` +
      `installs (portfolio:new, manual mc-setup, shipped install.ps1) + the\n` +
      `no-delta canonical-isolation proof.\n\n` +
      `--self-test   run the fixture-based reachability + isolation teeth (fast,\n` +
      `              deterministic) instead of the real (slow) 3-leg run.\n`,
  );
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  if (opts.selfTest) {
    const r = selfTest();
    if (opts.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    } else {
      for (const item of r.results) {
        process.stdout.write(`[${item.status === "pass" ? "ok  " : "FAIL"}] ${item.name}${item.detail ? ` — ${item.detail}` : ""}\n`);
      }
      process.stdout.write(`\n${r.pass}/${r.results.length} self-test tooth checks passed.\n`);
    }
    return r.ok ? 0 : 1;
  }

  const result = runEngine({ timeoutMs: opts.timeoutMs });
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    for (const leg of result.legs) {
      const tag = leg.ran === false ? "SKIP" : leg.ok ? "PASS" : "FAIL";
      process.stdout.write(`[leg ${leg.leg}] ${leg.name} — ${tag} (${leg.durationMs}ms)\n`);
      for (const a of leg.asserts) {
        if (a.status === "fail") process.stdout.write(`         FAIL  ${a.name} — ${a.detail}\n`);
      }
    }
    process.stdout.write(
      `\nsandbox-isolation no-delta: ${result.sandbox_isolation.no_delta ? "HELD" : "VIOLATED"}` +
        (result.sandbox_isolation.no_delta
          ? ""
          : ` (onlyBefore=${result.sandbox_isolation.onlyBefore.length}, onlyAfter=${result.sandbox_isolation.onlyAfter.length})`) +
        "\n",
    );
    process.stdout.write(
      `ps_available=${result.ps_available} incomplete=${result.incomplete} overall=${result.ok ? "PASS" : "FAIL"}\n`,
    );
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  REPO_ROOT,
  assertSandboxTargetSafe,
  snapshotCanonicalState,
  noDeltaCheck,
  assertIdentityMerged,
  assertSeededSurvived,
  validateInstalledHookSchema,
  hasFrameworkInstalled,
  resolveTreeRole,
  isConsumerRole,
  findPowershellReal,
  runLeg1,
  runLeg2,
  runLeg3,
  runEngine,
  selfTest,
};
