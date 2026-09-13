#!/usr/bin/env node
/**
 * scripts/mc/test-scaffold-all-ways.js
 *
 * GATE-A `fresh_scaffold_all_ways` engine (SP-20260721-001 D-4 INC-2).
 *
 * The operator's D-4 standing standard #1 ("fresh-scaffold, ALL WAYS") made
 * REAL: runs the three SHIPPED install paths for real, end to end, and PROVES
 * the run never touched canonical. Replaces the two cosmetic fixture-existence
 * gates (`fresh_install_fixture`, `customized_install_fixture` — see
 * release-gates.js retirement comment) with real installs.
 *
 *   Leg 1 — /portfolio:new              (scripts/portfolio/new-lib.js#createProductRepo)
 *   Leg 2 — manual /mc:setup          (scripts/warp-setup.js --yes) over a SEEDED
 *                                        pre-existing CLAUDE.md
 *   Leg 3 — shipped install.ps1         (REAL run, PowerShell required; fail-closed
 *                                        if PS is present but the run doesn't produce
 *                                        a real install — never a silent node-downgrade)
 *
 * ── BINDING: SANDBOX ISOLATION (R1) ─────────────────────────────────────────
 * A gate that shells REAL installers 3x MUST prove it never touched canonical
 * (operator directive — a real canonical-corruption incident this session).
 * Four leak vectors, each sandbox-scoped:
 *   (a) scaffold TARGET      — createProductRepo's new `parentDir` opt overrides
 *                              new-lib.js's `path.resolve(WARPOS_ROOT,"..",slug)`.
 *                              The engine always passes an os.tmpdir() sandbox.
 *                              Never `../<slug>`.
 *   (b) portfolio REGISTRY   — createProductRepo writes the real registry via
 *                              registry.js#save()/load(), which resolve their path
 *                              via `WARPOS_PORTFOLIO_REGISTRY` FIRST (registry.js
 *                              registryPath()) — an existing, tested seam
 *                              (registry-path.test.js). The engine points it at a
 *                              sandbox doc for the duration of Leg 1, then restores
 *                              it and CONFIRMS the real registry file (~/.mc/
 *                              portfolio.json) is byte-identical before/after —
 *                              save() cannot reach the real registry via ANY path
 *                              while the override is active (β R1b).
 *   (c) install.ps1 side-effects — confirmed by inspection: install.ps1 only ever
 *                              writes under $Target; every write below Stage 1 is
 *                              `Join-Path $Target ...`. Reads from $Source
 *                              (canonical) are read-only. No out-of-sandbox write.
 *   (d) GIT ops              — every git call in the legs below is scoped to a
 *                              sandbox cwd (or is a read-only `git config`/`git
 *                              rev-parse` against WARPOS_ROOT, which new-lib.js
 *                              already does and is explicitly allowed — reads
 *                              only, never a write).
 *
 * MECHANIZED PROOF — R1a NO-DELTA (not absolute-clean; β refinement): snapshot
 * canonical (`git status --porcelain --untracked-files=all`) BEFORE the run;
 * assert IDENTICAL after (before === after). No-delta is robust to a
 * legitimately-dirty dev/release host. `--untracked-files=all` without
 * `--ignored` already excludes every gitignored scratch path (.mc/,
 * .claude/runtime/, .claude/project/events/ — the engine's OWN telemetry lands
 * there and is invisible to this snapshot by construction, confirmed empirically
 * during design) — so a real leak (a modified tracked file, or a new untracked
 * NON-ignored path) is the only thing that can produce a delta.
 *
 * PRE-RUN GUARD — R1b (defense-in-depth): before each leg, assert its sandbox
 * target resolves OUTSIDE canonical (REPO_ROOT) AND outside the real sibling
 * location (REPO_ROOT/..) — refuse pre-run if not. Paired with the post-run
 * no-delta assertion (BOTH, not either).
 *
 * ── R2 — Leg-3 skip-loud, never a silent pass ───────────────────────────────
 * A host without PowerShell makes the GATE non-green (severity "degraded" at
 * the release-gates.js wiring), never a silent pass. `ps_available` is always
 * recorded. This engine's Leg 3 has NO node-mode fallback path at all (unlike
 * test-install-matrix.js's `installPs1EquivalentPath`, which silently falls
 * back to a node-equivalent path on PS failure — precisely the "gap #5 silent
 * downgrade" this gate exists to kill). If PowerShell is present but the real
 * `install.ps1` run doesn't produce a complete install, that is a RED, full stop.
 *
 * ── R3 — sandbox opts are NON-TRUST seams ───────────────────────────────────
 * `parentDir` + the registry-env seam relocate I/O only. Every assertion below
 * verifies the REAL artifact produced IN the sandbox — never the seam itself.
 *
 * ── R4 — parity-diff completeness (Leg 3 vs Leg 2) ──────────────────────────
 * Reuses `treeFileList`/`parityDiff`/`PARITY_ALLOWLIST` from
 * test-install-matrix.js verbatim — that allowlist already enumerates + justifies
 * its normalization set per-entry (timestamps live inside files, not in the path
 * set; `.claude/framework-installed.json` carries an install-id + per-asset
 * hashes; `.claude/framework-manifest.json` is legitimately install.ps1-only vs
 * warp-setup.js's in-place path; `.git`/`.mc`/runtime/event/memory dirs are
 * per-install scratch). Reusing the SAME reviewed constants (rather than
 * re-deriving a second normalization set) is the deliberate, lower-risk choice.
 *
 * Usage:
 *   node scripts/mc/test-scaffold-all-ways.js [--json] [--timeout-ms <n>]
 *                                                  [--self-test] [--help]
 *
 * Exit codes: 0 = all 3 legs pass + no-delta holds; 1 = a leg or the
 * sandbox-isolation assertion failed; 2 = usage/internal error (fail-CLOSED —
 * a crash is never a pass).
 */
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_LEG_TIMEOUT_MS = 180_000;
const ALEX_MARKER = "You are **Alex α**"; // mirrors scripts/warp-setup.js's own marker

// ── R1b — pre-run sandbox-target guard ──────────────────────────────────────
//
// Refuses (throws) any target that resolves inside canonical (REPO_ROOT) or
// the real portfolio-sibling location (REPO_ROOT/..) — vector (a). Requires
// the target resolve under os.tmpdir() — the engine's ONLY allowed sandbox
// root (matches the "engine passes a sandbox tmp dir" contract; never
// REPO_ROOT-relative).
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

// ── R1a — canonical-state snapshot + no-delta ───────────────────────────────
function snapshotCanonicalState() {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
    // `--untracked-files=all` lists EVERY untracked file, so this output grows with accumulated
    // artifacts, not with the size of the change under test. Node's spawnSync default maxBuffer is
    // 1 MiB; once the listing crosses it the child is SIGTERM'd with ENOBUFS and `status` comes back
    // null, which this function raises as a snapshot failure and the callers surface as a GATE-A/
    // GATE-B failure — a gate that can no longer RUN reporting as a gate that FAILED. Observed at
    // 1,076,925 bytes / 10,307 files, only 2.7% over the default. Generous on purpose: the margin
    // must not be re-crossable by ordinary artifact accumulation.
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

// ── shared helpers ───────────────────────────────────────────────────────────
function describeSpawnFailure(r) {
  if (!r) return "no result (spawn never returned)";
  if (r.error) return `spawn error: ${r.error.message}`;
  if (r.signal) return `R8 TIMEOUT/KILLED (signal=${r.signal}) — fail-closed`;
  return `code=${r.status} ${(r.stderr || r.stdout || "").slice(-300)}`;
}

function hasFrameworkInstalled(dir) {
  return fs.existsSync(path.join(dir, ".claude", "framework-installed.json"));
}

// Leg 2's identity-merge ground truth: the merged CLAUDE.md must contain the
// CURRENT canonical CLAUDE.md content verbatim (warp-setup.js appends it
// as-is). Deliberately NOT keyed on scripts/warp-setup.js's own ALEX_MARKER
// string ("You are **Alex α**") — that marker is STALE (see
// FOUNDATION-UPDATE-REQUEST in this build's return notes): canonical CLAUDE.md
// no longer contains that literal text, so a marker-based check would false-RED
// every real merge. Checking against the actual source content is real ground
// truth and immune to that drift.
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

// "the installed hook-schema validates" (Leg 2): every enabled event the
// CANONICAL hooks registry declares must appear as a key in the installed
// .claude/settings.json#hooks block. A real, structural check — not a
// presence-only stub.
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
    return null; // absent — a valid "before" state too
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

// ── Leg 1 — /portfolio:new (createProductRepo) ──────────────────────────────
function runLeg1({ sandboxRoot, timeoutMs }) {
  const t0 = Date.now();
  const assertions = [];
  const assert = (name, ok, detail) =>
    assertions.push({ name, status: ok ? "pass" : "fail", detail: ok ? undefined : detail || "" });

  const parentDir = path.join(sandboxRoot, "leg1-portfolio-parent");
  const slug = `gate-a-leg1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sandboxRegistryPath = path.join(sandboxRoot, "leg1-sandbox-registry", "portfolio.json");
  const realRegistryBefore = readRealRegistryRaw();
  let savedRegistryEnv;
  let repoPath = null;

  try {
    // vector (a): scaffold target — pre-run guard on what createProductRepo
    // will resolve internally once parentDir is threaded (same computation).
    const prospectiveRepoPath = path.resolve(parentDir, slug);
    assertSandboxTargetSafe(prospectiveRepoPath, { label: "leg1 scaffold target" });

    fs.mkdirSync(parentDir, { recursive: true });
    fs.mkdirSync(path.dirname(sandboxRegistryPath), { recursive: true });

    // vector (b): portfolio registry — point the existing, tested
    // WARPOS_PORTFOLIO_REGISTRY seam (registry.js#registryPath()) at a
    // sandbox doc for the duration of this leg only.
    savedRegistryEnv = mcEnv.readEnv("PORTFOLIO_REGISTRY");
    mcEnv.setEnv("PORTFOLIO_REGISTRY", sandboxRegistryPath);

    const { createProductRepo } = require("../portfolio/new-lib");
    const result = createProductRepo({
      slug,
      parentDir,
      wantNoScaffold: true, // keep the leg bounded — app-scaffold/npm is out of scope here
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

    // vector (b), continued — NON-TRUST confirmation (β R1b): the real
    // registry must be byte-identical before/after, regardless of what the
    // sandbox seam did during the run.
    const realRegistryAfter = readRealRegistryRaw();
    assert(
      "real portfolio registry (~/.mc/portfolio.json) unmutated by the sandboxed leg1 run",
      realRegistryAfter === realRegistryBefore,
      "the REAL registry changed during a sandboxed leg1 run — the registry seam leaked",
    );

    try {
      fs.rmSync(parentDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    try {
      fs.rmSync(path.dirname(sandboxRegistryPath), { recursive: true, force: true });
    } catch {
      /* best-effort */
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

// ── Leg 2 — manual /mc:setup over a SEEDED pre-existing CLAUDE.md ─────────
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
      [path.join(REPO_ROOT, "scripts", "warp-setup.js"), sandboxDir, "--yes"],
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

    // Bonus, non-spec-required but low-cost and load-bearing: the installed
    // repo should also certify. Mirrors test-fresh-install-smoke.js's
    // documented accommodation: warp-setup.js's in-place source-clone path
    // intentionally does NOT ship .claude/framework-manifest.json (owner
    // =generated; canonical already has its own — install.ps1's asset-copy
    // path is the one that regenerates it against the target). Lay it down
    // the same way the smoke test does so this is a real check of everything
    // ELSE, not a false-red on a known, documented, by-design divergence.
    try {
      const fmSrc = path.join(REPO_ROOT, ".claude", "framework-manifest.json");
      const fmDst = path.join(sandboxDir, ".claude", "framework-manifest.json");
      if (fs.existsSync(fmSrc) && !fs.existsSync(fmDst)) fs.copyFileSync(fmSrc, fmDst);
    } catch {
      /* the scan:install assertion below will catch any resulting gap */
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
    name: "manual_warp_setup",
    ran: true,
    ok: assertions.every((a) => a.status === "pass"),
    asserts: assertions,
    durationMs: Date.now() - t0,
    sandboxDir,
  };
}

// ── Leg 3 — shipped install.ps1 (REAL run; fail-closed, no node fallback) ──
//
// Deliberately does NOT reuse test-install-matrix.js#installPs1EquivalentPath:
// that helper silently falls back to a node-equivalent path when PS is present
// but the run fails — exactly the "gap #5 silent downgrade" this gate exists
// to close (R2). Injectable `findPs`/`runInstaller` seams make the fail-closed
// behavior directly unit-testable (see selfTest()).
function runLeg3({ sandboxRoot, timeoutMs, findPs = findPowershellReal, runInstaller = null, leg2Dir = null }) {
  const t0 = Date.now();
  const assertions = [];
  const assert = (name, ok, detail) =>
    assertions.push({ name, status: ok ? "pass" : "fail", detail: ok ? undefined : detail || "" });

  const sandboxDir = path.join(sandboxRoot, "leg3-installps1");
  const ps = findPs();

  if (!ps) {
    // R2: skip-loud, never a silent pass. Recorded distinctly — the caller
    // (release-gates.js) maps this to severity "degraded", not "green".
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
          detail: "ps_available=false — gate is INCOMPLETE, not a pass (R2)",
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

    // R2 fail-closed: PS present + exit 0 is NOT enough — the run must have
    // actually produced a real install. A "success" that produced no engine
    // is the silent-downgrade class this gate exists to catch.
    assert(
      "install.ps1 produced a real install (framework-installed.json present) — no silent downgrade",
      hasFrameworkInstalled(sandboxDir),
      `expected .claude/framework-installed.json under ${sandboxDir} — PS reported success but no engine was installed`,
    );

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

    // R4 — the load-bearing cross-check: install.ps1's tree must be
    // PATH-SET-IDENTICAL to /mc:setup's tree (Leg 2), modulo the SAME
    // reviewed, named allowlist test-install-matrix.js already uses.
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

// ── Orchestration ────────────────────────────────────────────────────────────
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
      leg2 = { leg: 2, name: "manual_warp_setup", ran: true, ok: false, asserts: [{ name: "leg2 threw", status: "fail", detail: e.message }], durationMs: 0 };
    }

    try {
      leg3 = runLeg3({ sandboxRoot, timeoutMs, leg2Dir: leg2 && leg2.sandboxDir });
    } catch (e) {
      leg3 = { leg: 3, name: "shipped_install_ps1", ran: true, ok: false, ps_available: true, asserts: [{ name: "leg3 threw", status: "fail", detail: e.message }], durationMs: 0 };
    }
  } finally {
    // Each leg's own sandbox subdir lives under sandboxRoot; Leg 2's tree is
    // kept alive across Leg 3's parity check (a genuine cross-leg dependency),
    // so cleanup happens HERE — still inside a finally, still guaranteed on
    // both pass and fail, for every leg's sandbox at once.
    try {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  const afterSnapshot = snapshotCanonicalState();
  const delta = noDeltaCheck(beforeSnapshot, afterSnapshot);

  const legs = [leg1, leg2, leg3];
  const psAvailable = leg3.ps_available !== false;
  const incomplete = leg3.ran === false; // no PS on this host
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

// ── Self-test (R7 reachability + sandbox-isolation teeth) ───────────────────
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

  // ── Pre-run guard teeth (R1b) ──
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

  // ── No-delta teeth (R1a) ──
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
        /* best-effort */
      }
    }
    const delta = noDeltaCheck(before, after);
    const cleanedUp = snapshotCanonicalState();
    return delta.equal === false && noDeltaCheck(before, cleanedUp).equal === true;
  });

  // ── Leg-2 reachability teeth (R7) ──
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

  // ── Leg-1 reachability tooth (R7) ──
  t("Leg-1 assert REDs on a scaffold missing framework-installed.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scaffold-all-ways-selftest-leg1-"));
    try {
      return hasFrameworkInstalled(tmp) === false;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ── Leg-3 reachability teeth (R7) ──
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
        // Deliberately does NOT write .claude/framework-installed.json —
        // simulating a "PS ran, reported success, produced no real install"
        // silent downgrade.
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
        /* best-effort */
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
        /* best-effort */
      }
    }
  });

  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.length - pass;
  return { ok: fail === 0, pass, fail, results };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
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
      `Runs the GATE-A fresh_scaffold_all_ways engine: 3 real, sandbox-isolated\n` +
      `installs (portfolio:new, manual warp-setup, shipped install.ps1) + the\n` +
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
  findPowershellReal,
  runLeg1,
  runLeg2,
  runLeg3,
  runEngine,
  selfTest,
};
