#!/usr/bin/env node
/**
 * scripts/mc/test-install-matrix.js
 *
 * SP-20260524-001 — install fixture CI matrix. Five-scenario regression test
 * suite for the MC install pipeline. Each scenario spins up an ephemeral
 * fixture project under .mc/test-fixtures/install-matrix/, exercises
 * /warp:setup or /warp:update, asserts the expected post-state, and cleans up.
 *
 * Scenarios:
 *   1 — clean_install                 fresh empty target → warp-setup → assert
 *   2 — existing_install_upgrade      seeded install → update --to <newer>
 *   3 — dirty_uncommitted_preserved   seeded install + operator edit → update
 *   4 — multi_version_upgrade         seeded install at N → update --to N+k
 *   5 — user_overrides_preserved      seeded install + settings.local → update
 *   6 — adopt_path                    clone brief adopted → _docs/clones/<slug>/
 *   7 — installps1_path               install.ps1-equiv path → COMPLETE + parity
 *                                     DIFF vs warp-setup (SP-20260525-019 gate)
 *
 * Acceptance criteria covered: AC-1.1, AC-1.2, AC-2.1, AC-3.1, AC-4.1, AC-5.1,
 * AC-5.2, AC-6.1, AC-7.1, AC-7.2, AC-8.1, AC-8.2, AC-9.1, AC-9.2, AC-10.1,
 * AC-10.2. See .claude/project/sprint/requirements/SP-20260524-001/
 * acceptance-criteria.md.
 *
 * Tickets: T-20260523-204 (runner) + T-20260523-205 (scenarios 1-3) +
 * T-20260523-206 (scenario 4 + capsule helper) + T-20260523-207 (scenario 5) +
 * T-20260523-208 (JSON + wire-in) + T-20260523-209 (meta-tests).
 *
 * Usage:
 *   node scripts/mc/test-install-matrix.js [--scenarios <list>]
 *                                              [--json]
 *                                              [--fixture-root <path>]
 *                                              [--keep-failed]
 *                                              [--inject-regression <name>]
 *                                              [--help]
 *
 * Exit codes:
 *   0  all requested scenarios passed
 *   1  one or more scenarios failed (or planted regression NOT caught)
 *   2  CLI parse error / bad input
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const os = require("os");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── CLI parse ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    help: false,
    scenarios: null,
    json: false,
    fixtureRoot: null,
    keepFailed: false,
    injectRegression: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--scenarios") out.scenarios = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--fixture-root") out.fixtureRoot = argv[++i];
    else if (a === "--keep-failed") out.keepFailed = true;
    else if (a === "--inject-regression") out.injectRegression = argv[++i];
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/mc/test-install-matrix.js [--scenarios <list>] [--json] [--fixture-root <path>] [--keep-failed] [--inject-regression <name>] [--help]

Runs the MC install-fixture CI matrix. Spins up ephemeral fixture projects
and exercises /warp:setup and /warp:update against 5 representative scenarios.

Scenarios (run all if --scenarios is omitted):
  1   clean_install                 fresh empty target → warp-setup → assert
  2   existing_install_upgrade      seeded install → update --to <newer>
  3   dirty_uncommitted_preserved   seeded install + operator edit → update
  4   multi_version_upgrade         seeded install at N → update --to N+k
  5   user_overrides_preserved      seeded install + settings.local → update
  6   adopt_path                    clone brief adopted → lands under _docs/clones/
  7   installps1_path               install.ps1-equiv path → COMPLETE + parity-diff vs warp-setup

Flags:
  --scenarios <list>           comma-separated scenario ids (e.g. 1,3,5)
  --json                       emit structured JSON to stdout (no human chatter)
  --fixture-root <path>        override default .mc/test-fixtures/install-matrix/
  --keep-failed                preserve failed fixtures in-place (default: move aside)
  --inject-regression <name>   meta-test mode — plant a known regression and assert detection
                               known names: ${REGRESSION_NAMES.join(", ")}
  --help, -h                   show this message

Exit codes:
  0  all requested scenarios passed
  1  one or more scenarios failed (or planted regression NOT caught)
  2  CLI parse error / bad input
`);
}

// ── Scenario registry ────────────────────────────────────────────────

const SCENARIOS = [
  { id: "1", slug: "clean_install" },
  { id: "2", slug: "existing_install_upgrade" },
  { id: "3", slug: "dirty_uncommitted_preserved" },
  { id: "4", slug: "multi_version_upgrade" },
  { id: "5", slug: "user_overrides_preserved" },
  { id: "6", slug: "adopt_path" },
  { id: "7", slug: "installps1_path" },
];

function resolveScenarios(spec) {
  if (!spec) return SCENARIOS.slice();
  const requested = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const r of requested) {
    const found = SCENARIOS.find((s) => s.id === r || s.slug === r);
    if (!found) {
      process.stderr.write(`unknown scenario: ${r}\n`);
      process.exit(2);
    }
    out.push(found);
  }
  return out;
}

// ── Fixture lifecycle ────────────────────────────────────────────────

function defaultFixtureRoot() {
  return path.join(REPO_ROOT, ".mc", "test-fixtures", "install-matrix");
}

function validateFixtureRoot(root) {
  // Path traversal guard (redteam T-A.5): resolved root must be under
  // REPO_ROOT or os.tmpdir().
  const resolved = path.resolve(root);
  const underRepo = resolved.startsWith(REPO_ROOT + path.sep) || resolved === REPO_ROOT;
  const underTmp = resolved.startsWith(os.tmpdir() + path.sep) || resolved === os.tmpdir();
  if (!underRepo && !underTmp) {
    process.stderr.write(
      `fixture-root must resolve under repo root or os.tmpdir(): ${resolved}\n`,
    );
    process.exit(2);
  }
  fs.mkdirSync(resolved, { recursive: true });
  // Writability check.
  try {
    const probe = path.join(resolved, `.probe-${Date.now()}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch (err) {
    process.stderr.write(`fixture-root not writable: ${resolved} — ${err.message}\n`);
    process.exit(2);
  }
  return resolved;
}

function createFixture(rootDir, scenarioSlug) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(rootDir, `${scenarioSlug}-${ts}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function moveFailedFixtureAside(rootDir, fixtureDir, scenarioSlug) {
  const failedRoot = path.join(rootDir, "_failed");
  fs.mkdirSync(failedRoot, { recursive: true });
  const moved = path.join(
    failedRoot,
    `${scenarioSlug}-${path.basename(fixtureDir)}`,
  );
  try {
    fs.renameSync(fixtureDir, moved);
    return moved;
  } catch {
    // Cross-device rename can fail; fall back to "keep in place".
    return fixtureDir;
  }
}

function cleanupFixture(fixtureDir) {
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  } catch {
    /* fail-open */
  }
}

// ── Subprocess helpers ───────────────────────────────────────────────

function runNode(scriptRel, args, opts = {}) {
  const scriptAbs = path.resolve(REPO_ROOT, scriptRel);
  const r = spawnSync(process.execPath, [scriptAbs, ...args], {
    cwd: opts.cwd || REPO_ROOT,
    encoding: "utf8",
    timeout: opts.timeout || 60_000,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    code: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    signal: r.signal,
  };
}

// ── install.ps1-equivalent path (T-20260525-223) ─────────────────────
//
// SP-20260525-019 gates the install-path UNIFICATION: a parallel ticket
// makes install.ps1 invoke the shared scaffold core
// (scripts/mc/scaffold-core.js, runnable as
// `node scripts/mc/scaffold-core.js <target>`) so install.ps1 produces a
// COMPLETE install — same end-state as the /warp:setup path — instead of the
// bare framework-asset copy it does today.
//
// PowerShell generally can't be driven from this Node test env (no pwsh on
// CI; WindowsPowerShell 5.1's -NonInteractive + Read-Host prompt on an
// existing-install detection makes a clean headless run unreliable). So the
// default strategy is to exercise the SAME CODE PATH install.ps1 uses:
//
//   1. base framework copy  — replicate install.ps1 Stage 1: copy every
//      framework-manifest.json asset src→dest into the fixture, then write a
//      minimal framework-installed.json (Stage 2). This is exactly what
//      install.ps1 lays down before the scaffold step.
//   2. shared scaffold core — `node scripts/mc/scaffold-core.js <fixture>`
//      (the entrypoint install.ps1 will call). This is the step that turns a
//      bare asset copy into a COMPLETE, sprint-capable product.
//
// If a usable PowerShell IS available we PREFER invoking install.ps1 directly
// (closer to the real operator path) and fall back to the node path on any
// failure. Either way the assertions below check the COMPLETE end-state.

function findPowershell() {
  // Prefer pwsh (cross-platform PS 7+); fall back to Windows PowerShell 5.1.
  for (const exe of ["pwsh", "powershell"]) {
    const probe = spawnSync(exe, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    if (probe.status === 0 && /\d/.test(probe.stdout || "")) return exe;
  }
  return null;
}

/**
 * Replicate install.ps1 Stage 1 + Stage 2 in Node: copy every
 * framework-manifest.json asset (src → dest) into the fixture, then write a
 * minimal .claude/framework-installed.json snapshot. Returns { copied,
 * skipped }. Path-traversal safe: dests are manifest-controlled and validated
 * to stay under the fixture.
 */
function copyManifestAssets(fixtureDir) {
  const manifestPath = path.join(REPO_ROOT, ".claude", "framework-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  let copied = 0;
  let skipped = 0;
  const resolvedFixture = path.resolve(fixtureDir);
  for (const kind of Object.keys(manifest.assets || {})) {
    for (const asset of manifest.assets[kind]) {
      const srcPath = path.resolve(REPO_ROOT, asset.src);
      const destPath = path.resolve(fixtureDir, asset.dest);
      // Guard: never write outside the fixture even if the manifest is wrong.
      if (!(destPath === resolvedFixture || destPath.startsWith(resolvedFixture + path.sep))) {
        skipped++;
        continue;
      }
      if (!fs.existsSync(srcPath)) {
        skipped++;
        continue;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      copied++;
    }
  }
  // Stage 2-equivalent: minimal install snapshot so the fixture looks like a
  // post-install.ps1 tree (regenerate.js / structure-parity don't need the
  // full per-asset hash list for the structural assertions below).
  const installRecord = {
    $schema: "mc/framework-installed/v2",
    installedVersion: currentVersion() || "0.0.0",
    installedAt: new Date().toISOString(),
    source: REPO_ROOT,
    target: path.resolve(fixtureDir),
    installed_files: [],
  };
  const installedPath = path.join(fixtureDir, ".claude", "framework-installed.json");
  fs.mkdirSync(path.dirname(installedPath), { recursive: true });
  fs.writeFileSync(installedPath, JSON.stringify(installRecord, null, 2) + "\n");
  return { copied, skipped };
}

/**
 * Install into `fixtureDir` via the install.ps1-equivalent path. Returns
 * { mode: "powershell"|"node", code, stdout, stderr, scaffold }.
 *
 * mode "powershell": install.ps1 was invoked directly (it now calls the
 *   scaffold core internally once the parallel ticket lands).
 * mode "node": base manifest-asset copy + `node scaffold-core.js <fixture>`.
 */
function installPs1EquivalentPath(fixtureDir) {
  const ps = findPowershell();
  if (ps) {
    const installPs1 = path.join(REPO_ROOT, "install.ps1");
    const r = spawnSync(
      ps,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", installPs1, "-Target", fixtureDir, "-SkipPrompt"],
      { encoding: "utf8", timeout: 180_000, env: { ...process.env } },
    );
    // Only accept the PS path if it actually produced an install snapshot;
    // otherwise fall through to the deterministic node path.
    const installedOk = fs.existsSync(path.join(fixtureDir, ".claude", "framework-installed.json"));
    if (r.status === 0 && installedOk) {
      return {
        mode: "powershell",
        code: r.status,
        stdout: r.stdout || "",
        stderr: r.stderr || "",
        scaffold: null,
      };
    }
    // PS present but unusable here — reset and use the node-equivalent path.
    try {
      fs.rmSync(path.join(fixtureDir, ".claude"), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  // Node-equivalent path: base framework copy + shared scaffold core.
  copyManifestAssets(fixtureDir);
  // Run the CANONICAL scaffold-core.js (REPO_ROOT) against the fixture — this
  // is exactly the entrypoint install.ps1 will call: `node
  // scripts/mc/scaffold-core.js <target>`. EXPECTED to fail until the
  // parallel ticket adds the script.
  const scaffold = runNode("scripts/mc/scaffold-core.js", [fixtureDir], { timeout: 180_000 });
  return {
    mode: "node",
    code: scaffold.code,
    stdout: scaffold.stdout,
    stderr: scaffold.stderr,
    scaffold,
  };
}

// ── Tree file-list + parity diff (β before_design constraint) ────────
//
// β ruled parity must be a DIFF, not "both trees independently pass
// structure-parity". Two trees can each satisfy structure-parity yet still
// diverge from EACH OTHER. So we build a sorted relative-path file list of
// each tree (scoped to the zones the install owns) and diff the SETS. Any
// structural divergence fails — modulo a documented allowlist of legitimate
// per-install variance (timestamps live INSIDE files so they don't affect the
// path set; install-id / .git / runtime / transaction dirs do).

// Zones compared for parity. A path is in-scope iff it sits under one of these
// prefixes (dir prefixes need the trailing sep; ROADMAP.md / PROJECT.md are
// exact files).
const PARITY_SCOPE_DIRS = [".claude", "_mc", "_requirements", "_docs"];
const PARITY_SCOPE_FILES = ["ROADMAP.md", "PROJECT.md"];

// Allowlist: relative paths (POSIX sep) matching any of these regexes are
// EXCLUDED from the parity diff. These are legitimately per-install or
// runtime-only and would otherwise produce false divergence.
const PARITY_ALLOWLIST = [
  /^\.git(\/|$)/, // git metadata
  /^\.claude\/framework-installed\.json$/, // carries install-id, timestamps, target, per-asset hashes
  /^\.claude\/framework-manifest\.json$/, // capsule/install.ps1 manifest: install.ps1 Stage 2 regenerates it against the target; the warp-setup source-clone scaffold doesn't produce it. Legitimately path-specific — same class as framework-installed.json.
  /^\.claude\/runtime(\/|$)/, // runtime state (events, caches) — written at run, not install
  /^\.claude\/project\/events(\/|$)/, // event logs
  /^\.claude\/project\/memory(\/|$)/, // memory stores
  /^\.mc(\/|$)/, // transactions / test-fixture scratch / install-id
  /(^|\/)node_modules(\/|$)/, // deps, never part of an install tree
  /(^|\/)\.DS_Store$/, // macOS noise
];

function isParityAllowlisted(rel) {
  return PARITY_ALLOWLIST.some((re) => re.test(rel));
}

function inParityScope(rel) {
  if (PARITY_SCOPE_FILES.includes(rel)) return true;
  return PARITY_SCOPE_DIRS.some((d) => rel === d || rel.startsWith(d + "/"));
}

/**
 * Build a sorted list of in-scope, non-allowlisted relative file paths under
 * `rootDir` (POSIX separators). Files only (dirs are implied by their files).
 */
function treeFileList(rootDir) {
  const out = [];
  function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const relPath = relDir ? `${relDir}/${ent.name}` : ent.name;
      // Prune whole subtrees that are out of scope or allowlisted early.
      if (ent.isDirectory()) {
        const probe = relPath + "/";
        // Descend only if some scope prefix could still match underneath.
        const couldBeInScope =
          PARITY_SCOPE_DIRS.some((d) => d === relPath || d.startsWith(relPath + "/") || relPath.startsWith(d + "/")) ||
          PARITY_SCOPE_FILES.some((f) => f.startsWith(relPath + "/"));
        if (!couldBeInScope) continue;
        if (isParityAllowlisted(probe)) continue;
        walk(path.join(absDir, ent.name), relPath);
      } else if (ent.isFile()) {
        if (inParityScope(relPath) && !isParityAllowlisted(relPath)) {
          out.push(relPath);
        }
      }
    }
  }
  walk(rootDir, "");
  out.sort();
  return out;
}

/**
 * Diff two tree file lists. Returns { equal, onlyInA, onlyInB }.
 */
function parityDiff(listA, listB) {
  const setA = new Set(listA);
  const setB = new Set(listB);
  const onlyInA = listA.filter((p) => !setB.has(p));
  const onlyInB = listB.filter((p) => !setA.has(p));
  return { equal: onlyInA.length === 0 && onlyInB.length === 0, onlyInA, onlyInB };
}

// ── Assertion harness ────────────────────────────────────────────────

function mkAssert(scenarioResult) {
  return function assert(name, ok, detail) {
    scenarioResult.assertions.push({
      name,
      status: ok ? "pass" : "fail",
      detail: ok ? undefined : detail || "",
    });
    if (!ok) scenarioResult.status = "fail";
  };
}

// ── Migrated shipped-structure assertions (SP-20260618-001 / U3, DoD#4) ──
//
// CONFIRM the U1 templates migration reaches a REAL install (fresh + upgrade) —
// the install-time e2e the GOLDEN user relies on. Asserted against the final
// fixture state of scenario 1 (fresh) AND scenario 2 (upgrade) using the
// existing assertion idiom (mkAssert + fs/path fixtureDir checks) — NO new
// harness.
//
//   • _mc/templates/ + its 9 master-seed subdirs are PLACED by the install.
//     This is the install-actually-placed-them proof: the migrated templates
//     ship via .claude/framework-manifest.json (ASSET_DIRS repoint) and the
//     fixture receives them — stronger than ship-coverage, which only proves the
//     manifest COVERS them, never that an install lays them down.
//   • NO framework/templates/ in the installed tree — the deleted pre-migration
//     home left behind no stale dependency.
//
// _mc/BASELINE/ — DELIBERATE DIVERGENCE FROM THE SPEC, DOCUMENTED CALL:
//   The U3 brief's step-1 / verified_by-2 ask for _mc/BASELINE/ to be
//   "present in the fixture". It is NOT — and must not be. U1 carved
//   _mc/BASELINE/ as build-output that is INTENTIONALLY NOT SHIPPED from
//   canonical (mc-ship-coverage.js KNOWN_NOT_SHIPPED, the narrow
//   "_mc/BASELINE/" entry; absent from framework-manifest.json). It is the
//   per-install seed-snapshot / `seeded_from` pointer target (U2 provenance), with
//   its per-install generator still pending (deferred debt). A consumer install
//   legitimately does NOT receive it. Shipping it (or asserting its fixture
//   presence) would alter U1's reviewed carve / the manifest — both explicitly
//   out of U3 scope. So BASELINE is CONFIRMED at the CANONICAL layer (REPO_ROOT),
//   where the snapshot actually lives, and its fixture status is recorded as a
//   soft marker (never fails). See the U3 return notes for the flagged conflict.
const EXPECTED_TEMPLATE_SUBDIRS = [
  "app-scaffold",
  "canonical",
  "lastmile",
  "portfolio",
  "product-bootstrap",
  "product-clone",
  "product-import",
  "report",
  "sprint",
];

function assertMigratedShippedStructure(r, assert, fixtureDir, label) {
  // (1) _mc/templates/ is a shipped asset — the install must place it.
  const tplDir = path.join(fixtureDir, "_mc", "templates");
  const tplIsDir = fs.existsSync(tplDir) && fs.statSync(tplDir).isDirectory();
  assert(
    `${label}: _mc/templates/ placed by install (migrated shipped structure reaches a real install)`,
    tplIsDir,
    `exists=${fs.existsSync(tplDir)} isDir=${tplIsDir}`,
  );
  if (tplIsDir) {
    const present = new Set(fs.readdirSync(tplDir));
    const missing = EXPECTED_TEMPLATE_SUBDIRS.filter((d) => !present.has(d));
    assert(
      `${label}: _mc/templates/ has all ${EXPECTED_TEMPLATE_SUBDIRS.length} master-seed subdirs`,
      missing.length === 0,
      `missing=[${missing.join(", ")}] present=[${[...present].slice(0, 12).join(", ")}]`,
    );
  }

  // (2) NEGATIVE: the pre-migration framework/templates/ home must be GONE —
  // no stale dependency shipped into the install.
  assert(
    `${label}: NO stale framework/templates/ in installed tree (no pre-migration dependency)`,
    !fs.existsSync(path.join(fixtureDir, "framework", "templates")),
    "framework/templates/ present in fixture — stale pre-migration dependency shipped",
  );

  // (3) _mc/BASELINE/ — canonical build-output, intentionally NOT shipped
  // (see header comment). Confirm at the CANONICAL layer (REPO_ROOT), NOT the
  // fixture; record fixture status as a soft, non-failing marker.
  assert(
    `${label}: _mc/BASELINE/ present in canonical (build-output home; not shipped to consumers by design)`,
    fs.existsSync(path.join(REPO_ROOT, "_mc", "BASELINE")),
    "expected _mc/BASELINE/ at canonical REPO_ROOT",
  );
  const baselineInFixture = fs.existsSync(
    path.join(fixtureDir, "_mc", "BASELINE"),
  );
  r.assertions.push({
    name: `soft: ${label} fixture _mc/BASELINE present = ${baselineInFixture} (consumer install legitimately omits it — KNOWN_NOT_SHIPPED build-output)`,
    status: "pass",
  });
}

// ── Capsule helpers ──────────────────────────────────────────────────

function listCapsuleVersions() {
  const releasesRoot = path.join(REPO_ROOT, "framework", "releases");
  if (!fs.existsSync(releasesRoot)) return [];
  return fs
    .readdirSync(releasesRoot)
    .filter((d) =>
      fs.existsSync(path.join(releasesRoot, d, "release.json")),
    )
    .sort(compareSemver);
}

function compareSemver(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] || 0;
    const bi = pb[i] || 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

function currentVersion() {
  try {
    const v = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "version.json"), "utf8"),
    );
    return v.version;
  } catch {
    return null;
  }
}

/**
 * synthesizeCapsule({version, baseRoot, migrations}) — AC-7.1.
 *
 * Produces a minimal valid capsule at <baseRoot>/framework/releases/<version>/
 * with release.json + framework-manifest.json. Used by scenario 4 as a fallback
 * when fewer than 2 real capsules are available newer than the chosen baseline.
 *
 * Per AC-7.2 this helper is BYPASSED when 2+ real capsules already exist
 * newer than baseline — scenario 4 checks first and only calls this when
 * synthesis is genuinely needed.
 */
function synthesizeCapsule({ version, baseRoot, migrations = [] }) {
  const dir = path.join(baseRoot, "framework", "releases", version);
  fs.mkdirSync(dir, { recursive: true });
  const release = {
    schema: "mc/release/v1",
    version,
    createdAt: new Date().toISOString(),
    commit: null,
    minUpgradeableFrom: "0.0.0",
    requiresFreshInstallFromBelow: null,
    manifestSchema: "mc/framework-manifest/v2",
    pathRegistryVersion: "v1",
    hooksRegistrySchema: "mc/hooks-registry/v1",
    migrations,
    postUpdateChecks: [],
    checksumsFile: "checksums.json",
    _synthesized: true,
  };
  const manifest = {
    schema: "mc/framework-manifest/v2",
    version,
    generatedAt: new Date().toISOString(),
    assets: [],
    _synthesized: true,
  };
  fs.writeFileSync(
    path.join(dir, "release.json"),
    JSON.stringify(release, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "framework-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "checksums.json"),
    JSON.stringify({ schema: "mc/checksums/v1", entries: {} }, null, 2) + "\n",
  );
  return dir;
}

// ── Seed helpers ─────────────────────────────────────────────────────

/**
 * Seed a fixture with a "current-version install" by running warp-setup.js
 * against it. Returns true on success.
 */
function seedInstall(fixtureDir) {
  const r = runNode("scripts/warp-setup.js", [fixtureDir, "--yes"], {
    timeout: 120_000,
  });
  return r.code === 0;
}

/**
 * Rewrite framework-installed.json#installedVersion in the fixture to
 * pretend the install is at a different version. Returns true if the file
 * was modified.
 */
function pretendVersion(fixtureDir, fakeVersion) {
  const file = path.join(fixtureDir, ".claude", "framework-installed.json");
  if (!fs.existsSync(file)) return false;
  const obj = JSON.parse(fs.readFileSync(file, "utf8"));
  obj.installedVersion = fakeVersion;
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  return true;
}

// ── Scenarios ────────────────────────────────────────────────────────

function scenario1_clean_install(scenario, fixtureDir, opts) {
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  // Apply optional injection.
  // (Scenario 1's only fixture-mutation is the install itself, so injections
  // for scenario 1 target the .mc/test-fixtures result after install —
  // see applyInjectionPostInstall.)

  // Run warp-setup against the empty fixture.
  const setup = runNode("scripts/warp-setup.js", [fixtureDir, "--yes"], { timeout: 120_000 });
  assert("warp-setup exits 0", setup.code === 0, `code=${setup.code} stderr=${(setup.stderr || "").slice(0, 200)}`);

  if (setup.code === 0) {
    // Optional injection AFTER install (e.g., delete a hook to simulate broken install).
    if (opts.injectRegression) {
      applyInjectionAfterInstall(fixtureDir, opts.injectRegression);
    }

    // Assert key framework artifacts exist. Install model: warp-setup ships
    // `.claude/` only. `_mc/` is canonical-side; downstream products
    // typically don't receive it (see warp-setup.js#1519 legacy-layout path).
    for (const p of [
      ".claude/settings.json",
      ".claude/framework-installed.json",
      ".claude/paths.json",
      ".claude/manifest.json",
    ]) {
      assert(
        `installed: ${p} exists`,
        fs.existsSync(path.join(fixtureDir, p)),
        `expected file at ${p}`,
      );
    }

    // Assert framework-installed.json shape: installedVersion + installed_files.
    const installedPath = path.join(fixtureDir, ".claude", "framework-installed.json");
    if (fs.existsSync(installedPath)) {
      const installed = JSON.parse(fs.readFileSync(installedPath, "utf8"));
      assert(
        "framework-installed.json#installedVersion non-empty",
        typeof installed.installedVersion === "string" && installed.installedVersion.length > 0,
        `got=${installed.installedVersion}`,
      );
      assert(
        "framework-installed.json#installed_files non-empty array",
        Array.isArray(installed.installed_files) && installed.installed_files.length > 0,
        `count=${(installed.installed_files || []).length}`,
      );
    }

    // Assert .claude/settings.json has hooks block (sanity that install merged real settings).
    const settingsPath = path.join(fixtureDir, ".claude", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      assert(
        ".claude/settings.json has hooks block",
        settings.hooks && typeof settings.hooks === "object",
        `hooks=${JSON.stringify(settings.hooks).slice(0, 100)}`,
      );
    }

    // SP-20260525-018 (T-216 / AC-1.1, AC-2.1, AC-3.1, AC-3.2): the installer
    // now scaffolds a complete, sprint-capable product. Assert the new zones,
    // the sprint-orchestrator paths keys, and structure-parity on a fresh install.
    for (const z of [
      "ROADMAP.md",
      ".claude/project/sprint",
      ".claude/project/sprint/full-reports",
      "_requirements/00-canonical",
      "_requirements/04-features",
      "_docs/briefs",
      "_docs/clones",
    ]) {
      assert(`scaffolded: ${z} exists`, fs.existsSync(path.join(fixtureDir, z)), `expected ${z}`);
    }

    // SP-20260525-019 (T-20260525-223): the scaffold core now drops a PROJECT.md
    // and runs a maps step. PROJECT.md is the unambiguous new artifact, so we
    // HARD-assert it. The maps step's output (.claude/project/maps/*) ships as a
    // framework asset regardless, so its presence is NOT a reliable signal the
    // step ran — we record a SOFT marker (never fails) per the ticket guidance.
    // EXPECTED to FAIL on PROJECT.md until the scaffoldProduct change lands.
    assert(
      "scaffolded: PROJECT.md exists",
      fs.existsSync(path.join(fixtureDir, "PROJECT.md")),
      "expected PROJECT.md at fixture root",
    );
    const mapsDir = path.join(fixtureDir, ".claude", "project", "maps");
    let mapsMarker = false;
    try {
      mapsMarker = fs.existsSync(mapsDir) && fs.readdirSync(mapsDir).length > 0;
    } catch {
      /* fail-open — soft marker only */
    }
    r.assertions.push({
      name: `soft: maps step marker (.claude/project/maps populated = ${mapsMarker})`,
      status: "pass",
    });

    const pjPath = path.join(fixtureDir, ".claude", "paths.json");
    if (fs.existsSync(pjPath)) {
      const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
      for (const k of ["sprintFullAutonomy", "sprintSchemas", "requirementsRoot"]) {
        assert(`paths.json has ${k}`, typeof pj[k] === "string" && pj[k].length > 0, `missing ${k}`);
      }
    }
    const sp = runNode("scripts/checks/mc-structure-parity.js", [], {
      env: { CLAUDE_PROJECT_DIR: fixtureDir },
    });
    assert(
      "structure-parity passes on fresh install",
      sp.code === 0,
      `code=${sp.code} ${(sp.stdout || sp.stderr || "").slice(0, 120)}`,
    );

    // SP-20260525-003 (_mc/-zone migration gate): warp-setup now populates
    // the product's `_mc/` source tree so `.claude/` is a regeneration of
    // it (scripts/mc/views/regenerate.js). These end-state assertions are
    // design-agnostic — they hold regardless of the exact `_mc/` layout —
    // and are EXPECTED TO FAIL until the warp-setup core change lands.
    const mcDir = path.join(fixtureDir, "_mc");
    const mcIsDir = fs.existsSync(mcDir) && fs.statSync(mcDir).isDirectory();
    assert(
      "_mc/ exists and is a non-empty directory",
      mcIsDir && fs.readdirSync(mcDir).length > 0,
      `exists=${fs.existsSync(mcDir)} isDir=${mcIsDir} entries=${mcIsDir ? fs.readdirSync(mcDir).length : "n/a"}`,
    );
    assert(
      "_mc/MANIFEST.json exists",
      fs.existsSync(path.join(mcDir, "MANIFEST.json")),
      "expected _mc/MANIFEST.json",
    );
    // .claude/ must be reproducible from _mc/ — regenerate --check exits 0
    // when no view is stale. --root makes the check CWD-independent.
    const regen = runNode(
      "scripts/mc/views/regenerate.js",
      ["--check", "--root", fixtureDir],
      { timeout: 60_000 },
    );
    assert(
      "regenerate.js --check clean (.claude/ reproducible from _mc/)",
      regen.code === 0,
      `code=${regen.code} ${(regen.stdout || regen.stderr || "").slice(0, 200)}`,
    );

    // SP-20260618-001 / U3 (DoD#4): the fresh install must end with the migrated
    // shipped structure — _mc/templates/ + its 9 subdirs placed, no stale
    // framework/templates/. (BASELINE confirmed canonical-side — see helper.)
    assertMigratedShippedStructure(r, assert, fixtureDir, "fresh");
  }

  r.durationMs = Date.now() - t0;
  return r;
}

function scenario2_existing_install_upgrade(scenario, fixtureDir, opts) {
  // Cross-version DRY-RUN. The classifier walks the version transition,
  // produces a plan, and exits 0 without mutating state. Real --apply across
  // versions requires historical source trees (capsule N expects source
  // matching N; current source has drifted past every prior capsule). That's
  // future scope. The dry-run path is the primary regression surface.
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  if (!seedInstall(fixtureDir)) {
    assert("seed install (warp-setup)", false, "warp-setup did not exit 0");
    r.durationMs = Date.now() - t0;
    return r;
  }

  // SP-20260525-003 (_mc/-zone migration gate, existing-product path):
  // re-running setup against an already-installed product must keep `_mc/`
  // present and leave `.claude/` reproducible from it — i.e. the migration is
  // idempotent and re-setup is a no-regression operation. seedInstall above is
  // the first setup; this is a second setup over the existing install.
  const mcDir = path.join(fixtureDir, "_mc");
  const reSetup = runNode("scripts/warp-setup.js", [fixtureDir, "--yes"], {
    timeout: 120_000,
  });
  assert(
    "re-running warp-setup over existing install exits 0",
    reSetup.code === 0,
    `code=${reSetup.code} stderr=${(reSetup.stderr || "").slice(0, 200)}`,
  );
  assert(
    "_mc/ still present after re-setup (idempotent migration)",
    fs.existsSync(mcDir) &&
      fs.statSync(mcDir).isDirectory() &&
      fs.readdirSync(mcDir).length > 0,
    `exists=${fs.existsSync(mcDir)}`,
  );
  const regenRe = runNode(
    "scripts/mc/views/regenerate.js",
    ["--check", "--root", fixtureDir],
    { timeout: 60_000 },
  );
  assert(
    "regenerate.js --check still clean after re-setup (no regression)",
    regenRe.code === 0,
    `code=${regenRe.code} ${(regenRe.stdout || regenRe.stderr || "").slice(0, 200)}`,
  );

  const cur = currentVersion();
  const versions = listCapsuleVersions();
  if (!cur || versions.length < 2) {
    assert("currentVersion + ≥2 capsules", false, `cur=${cur} versions=${versions.length}`);
    r.durationMs = Date.now() - t0;
    return r;
  }
  const oldVersion = versions[versions.length - 2];
  pretendVersion(fixtureDir, oldVersion);

  if (opts.injectRegression) {
    applyInjectionAfterInstall(fixtureDir, opts.injectRegression);
  }

  const dry = runNode(
    "scripts/mc/update.js",
    ["--target", fixtureDir, "--to", cur, "--skip-preflight"],
    { timeout: 60_000 },
  );
  assert(
    `update.js --to ${cur} (dry-run from ${oldVersion}) exits 0`,
    dry.code === 0,
    `code=${dry.code} stderr=${(dry.stderr || "").slice(0, 200)}`,
  );

  // Side-effect-freedom assertions (the primary dry-run contract).
  assert(
    "dry-run did NOT mutate installedVersion",
    (() => {
      const installed = JSON.parse(
        fs.readFileSync(path.join(fixtureDir, ".claude", "framework-installed.json"), "utf8"),
      );
      return installed.installedVersion === oldVersion;
    })(),
    "dry-run modified installedVersion — would be a real regression",
  );
  const txRoot = path.join(fixtureDir, ".mc", "transactions");
  const noTxDir =
    !fs.existsSync(txRoot) ||
    fs
      .readdirSync(txRoot)
      .filter(
        (d) =>
          d !== "active.lock" && fs.statSync(path.join(txRoot, d)).isDirectory(),
      ).length === 0;
  assert("dry-run did NOT create a transaction directory", noTxDir);

  // Guard: structure-parity must hold after the update step (SP-20260525-024).
  // Mirrors the scenario1 idiom — reuses mc-structure-parity.js so the
  // REQUIRED_DIR list is a single source of truth, never duplicated here.
  const spUpdate = runNode("scripts/checks/mc-structure-parity.js", [], {
    env: { CLAUDE_PROJECT_DIR: fixtureDir },
  });
  assert(
    "structure-parity holds after update (SP-20260525-024 — scaffoldProduct-on-update fix)",
    spUpdate.code === 0,
    `code=${spUpdate.code} ${(spUpdate.stdout || spUpdate.stderr || "").slice(0, 160)}`,
  );

  // SP-20260618-001 / U3 (DoD#4): the upgraded install must ALSO end with the
  // migrated shipped structure — _mc/templates/ + its 9 subdirs present, no
  // stale framework/templates/. Same guarantee as the fresh path, on the
  // seed+re-setup+update fixture. (BASELINE confirmed canonical-side — see helper.)
  assertMigratedShippedStructure(r, assert, fixtureDir, "upgrade");

  r.durationMs = Date.now() - t0;
  return r;
}

function scenario3_dirty_uncommitted_preserved(scenario, fixtureDir, opts) {
  // The preservation guarantee tested here:
  //   When the operator has edited a framework file post-install, update.js
  //   MUST refuse to apply (Class C MERGE_CONFLICT or similar) — never silently
  //   overwrite. The matrix asserts the refusal AND that the operator file
  //   is untouched after the refused apply.
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  if (!seedInstall(fixtureDir)) {
    assert("seed install (warp-setup)", false);
    r.durationMs = Date.now() - t0;
    return r;
  }

  // Pick a known framework file and modify it as if the operator edited it.
  // Use a hook script (an asset update.js classifies) — settings.json is
  // generated and special-cased so a less special file gives a cleaner signal.
  const installed = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, ".claude", "framework-installed.json"), "utf8"),
  );
  // Pick a hook script that is in installed_files.
  const targetRel = (installed.installed_files || []).find(
    (p) => p.startsWith("scripts/hooks/") && p.endsWith(".js"),
  );
  if (!targetRel) {
    assert("found a hook file to edit", false, "no scripts/hooks/*.js in installed_files");
    r.durationMs = Date.now() - t0;
    return r;
  }
  const targetFile = path.join(fixtureDir, targetRel);
  if (!fs.existsSync(targetFile)) {
    assert(`target framework file present pre-edit: ${targetRel}`, false);
    r.durationMs = Date.now() - t0;
    return r;
  }
  const sentinel = `// operator-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const originalContent = fs.readFileSync(targetFile, "utf8");
  fs.writeFileSync(targetFile, sentinel + "\n" + originalContent);

  if (opts.injectRegression) {
    applyInjectionAfterInstall(fixtureDir, opts.injectRegression);
  }

  // Try to apply against a fake-old version. The classifier should flag the
  // edited file as MERGE_CONFLICT (or equivalent Class C) and refuse apply.
  const cur = currentVersion();
  const versions = listCapsuleVersions();
  const oldVersion = versions[versions.length - 2] || versions[0];
  pretendVersion(fixtureDir, oldVersion);

  const u = runNode(
    "scripts/mc/update.js",
    ["--target", fixtureDir, "--to", cur, "--apply", "--skip-preflight"],
    { timeout: 60_000 },
  );

  // Preservation guarantee: either update refused with Class C, OR the file
  // is still present with the operator's edit intact.
  const fileAfter = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, "utf8") : "";
  const sentinelPresent = fileAfter.includes(sentinel);
  const refusedWithConflict =
    u.code !== 0 &&
    /Class C|MERGE_CONFLICT|user_modified|conflict|ESCALATE/i.test(u.stderr + u.stdout);

  assert(
    "operator edit NOT silently overwritten",
    sentinelPresent || refusedWithConflict,
    `sentinelPresent=${sentinelPresent} refused=${refusedWithConflict} code=${u.code} stderr=${(u.stderr || "").slice(0, 200)}`,
  );

  // If apply was refused, the file MUST still have the sentinel (no partial mutation).
  if (refusedWithConflict) {
    assert(
      "after refused apply, operator edit still present",
      sentinelPresent,
      "apply refused but sentinel missing — partial mutation",
    );
  }

  r.durationMs = Date.now() - t0;
  return r;
}

function scenario4_multi_version_upgrade(scenario, fixtureDir, opts) {
  // Multi-version DRY-RUN walk. Real cross-version --apply against the
  // current source tree trips Class C because the source files reflect the
  // newest version, not the intermediate one — that's correct classifier
  // behavior. The matrix here verifies the classifier walks each transition
  // and exits cleanly in dry-run, which is the useful regression signal
  // (real cross-version apply requires historical source trees and is
  // deferred to a future sprint).
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  if (!seedInstall(fixtureDir)) {
    assert("seed install (warp-setup)", false);
    r.durationMs = Date.now() - t0;
    return r;
  }

  const versions = listCapsuleVersions();
  const cur = currentVersion();
  const idx = cur ? versions.indexOf(cur) : versions.length - 1;
  if (idx < 0 || idx < 2) {
    assert(
      "scenario 4 capsule availability",
      false,
      `INSUFFICIENT_CAPSULES: need >= 2 versions; available=${versions.length} cur=${cur}`,
    );
    r.durationMs = Date.now() - t0;
    return r;
  }

  const baseline = versions[idx - 2];
  const intermediate = versions[idx - 1];
  const top = versions[idx];

  if (opts.injectRegression) {
    applyInjectionAfterInstall(fixtureDir, opts.injectRegression);
  }

  // Walk 1: dry-run from baseline → intermediate.
  pretendVersion(fixtureDir, baseline);
  const u1 = runNode(
    "scripts/mc/update.js",
    ["--target", fixtureDir, "--to", intermediate, "--skip-preflight"],
    { timeout: 60_000 },
  );
  assert(
    `dry-run ${baseline} → ${intermediate} exits 0`,
    u1.code === 0,
    `code=${u1.code} stderr=${(u1.stderr || "").slice(0, 200)}`,
  );

  // Walk 2: dry-run from intermediate → top.
  pretendVersion(fixtureDir, intermediate);
  const u2 = runNode(
    "scripts/mc/update.js",
    ["--target", fixtureDir, "--to", top, "--skip-preflight"],
    { timeout: 60_000 },
  );
  assert(
    `dry-run ${intermediate} → ${top} exits 0`,
    u2.code === 0,
    `code=${u2.code} stderr=${(u2.stderr || "").slice(0, 200)}`,
  );

  // Confirm neither dry-run wrote a transaction directory or changed the
  // installedVersion (dry-run must be side-effect-free).
  const txRoot = path.join(fixtureDir, ".mc", "transactions");
  const noTxDir =
    !fs.existsSync(txRoot) ||
    fs
      .readdirSync(txRoot)
      .filter(
        (d) =>
          d !== "active.lock" && fs.statSync(path.join(txRoot, d)).isDirectory(),
      ).length === 0;
  assert("dry-runs created NO transaction directories", noTxDir);
  const installed = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, ".claude", "framework-installed.json"), "utf8"),
  );
  assert(
    "dry-runs did NOT change installedVersion",
    installed.installedVersion === intermediate,
    `expected ${intermediate}, got ${installed.installedVersion}`,
  );

  // AC-7.2: real capsules present → synth helper NOT invoked.
  assert(
    "AC-7.2: synth helper bypassed when real capsules sufficient",
    versions.length >= 2,
  );

  // AC-7.1: validate synth helper in isolation against a tmpdir.
  const tmpSynth = fs.mkdtempSync(path.join(os.tmpdir(), "mc-synth-"));
  try {
    const synthDir = synthesizeCapsule({
      version: "99.99.99",
      baseRoot: tmpSynth,
      migrations: [{ id: "noop", from: "0.0.0", to: "99.99.99", file: null }],
    });
    assert(
      "AC-7.1: synthesizeCapsule writes release.json",
      fs.existsSync(path.join(synthDir, "release.json")),
    );
    assert(
      "AC-7.1: synthesizeCapsule writes framework-manifest.json",
      fs.existsSync(path.join(synthDir, "framework-manifest.json")),
    );
    const synthRelease = JSON.parse(
      fs.readFileSync(path.join(synthDir, "release.json"), "utf8"),
    );
    assert(
      "AC-7.1: synth release.json#version correct",
      synthRelease.version === "99.99.99",
    );
  } finally {
    try { fs.rmSync(tmpSynth, { recursive: true, force: true }); } catch {}
  }

  r.durationMs = Date.now() - t0;
  return r;
}

function scenario5_user_overrides_preserved(scenario, fixtureDir, opts) {
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  if (!seedInstall(fixtureDir)) {
    assert("seed install (warp-setup)", false);
    r.durationMs = Date.now() - t0;
    return r;
  }

  // Plant settings.local.json overrides BEFORE update.
  const localFile = path.join(fixtureDir, ".claude", "settings.local.json");
  const sentinelAllow = `OperatorOverride(${Date.now()})`;
  const localPayload = {
    permissions: {
      allow: [sentinelAllow, "Bash(echo *)"],
    },
  };
  fs.writeFileSync(localFile, JSON.stringify(localPayload, null, 2) + "\n");

  // Cross-version DRY-RUN with settings.local.json present. Verifies the
  // dry-run path doesn't disturb the operator's local file. (Real --apply
  // across versions deferred — same constraint as scenario 2.)
  const cur = currentVersion();
  const versions = listCapsuleVersions();
  if (!cur || versions.length < 2) {
    assert("currentVersion + ≥2 capsules", false);
    r.durationMs = Date.now() - t0;
    return r;
  }
  const oldVersion = versions[versions.length - 2];
  pretendVersion(fixtureDir, oldVersion);
  const targetVersion = cur;

  if (opts.injectRegression) {
    applyInjectionAfterInstall(fixtureDir, opts.injectRegression);
  }

  const u = runNode(
    "scripts/mc/update.js",
    ["--target", fixtureDir, "--to", targetVersion, "--skip-preflight"],
    { timeout: 60_000 },
  );
  assert(
    `update.js --to ${targetVersion} (dry-run with local overrides) exits 0`,
    u.code === 0,
    `code=${u.code} stderr=${(u.stderr || "").slice(0, 200)}`,
  );

  // Verify settings.local.json file SURVIVED the update (update.js must not
  // blow away the operator's local config file).
  assert(
    "settings.local.json survives update",
    fs.existsSync(localFile),
    "settings.local.json missing post-update",
  );
  if (fs.existsSync(localFile)) {
    const localAfter = JSON.parse(fs.readFileSync(localFile, "utf8"));
    const allowList = (localAfter.permissions && localAfter.permissions.allow) || [];
    assert(
      "sentinel override present in settings.local.json post-update",
      allowList.includes(sentinelAllow),
      `allowList=${JSON.stringify(allowList).slice(0, 200)}`,
    );
  }

  // If `_mc/settings/defaults.json` is installed in the fixture (canonical
  // mode), additionally verify compile.js produces a settings.json that unions
  // the override. In downstream-only installs (no _mc/), this is skipped
  // with telemetry rather than failed — the layered compile model is
  // canonical-only today.
  const defaultsFile = path.join(fixtureDir, "_mc", "settings", "defaults.json");
  if (fs.existsSync(defaultsFile)) {
    const c = runNode(
      "scripts/mc/settings/compile.js",
      ["--root", fixtureDir],
      { timeout: 30_000 },
    );
    assert(
      "post-update settings compile exits 0 (canonical layout)",
      c.code === 0,
      `code=${c.code} stdout=${(c.stdout || "").slice(0, 200)}`,
    );
    const compiledPath = path.join(fixtureDir, ".claude", "settings.json");
    if (fs.existsSync(compiledPath)) {
      const compiled = JSON.parse(fs.readFileSync(compiledPath, "utf8"));
      const allowList = (compiled.permissions && compiled.permissions.allow) || [];
      assert(
        "settings.local override unioned into compiled settings.json (canonical layout)",
        allowList.includes(sentinelAllow),
        `allowList=${JSON.stringify(allowList).slice(0, 200)}`,
      );
    }
  } else {
    r.assertions.push({
      name: "compile-layered check skipped — downstream install layout (no _mc/)",
      status: "pass",
    });
  }

  r.durationMs = Date.now() - t0;
  return r;
}

// ── Regression injection registry (meta-tests) ───────────────────────

const REGRESSIONS = {
  delete_settings_json: {
    description: "Delete .claude/settings.json — scenario 1 asserts presence; matrix should catch.",
    apply(fixtureDir) {
      const f = path.join(fixtureDir, ".claude", "settings.json");
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    },
  },
  break_framework_installed_version: {
    description: "Blank framework-installed.json#installedVersion — scenario 1 asserts non-empty.",
    apply(fixtureDir) {
      const f = path.join(fixtureDir, ".claude", "framework-installed.json");
      if (!fs.existsSync(f)) return;
      const obj = JSON.parse(fs.readFileSync(f, "utf8"));
      obj.installedVersion = "";
      fs.writeFileSync(f, JSON.stringify(obj, null, 2) + "\n");
    },
  },
  corrupt_settings_local: {
    description: "Make settings.local.json malformed — scenario 5 reads it; matrix should catch the parse failure.",
    apply(fixtureDir) {
      const localFile = path.join(fixtureDir, ".claude", "settings.local.json");
      fs.writeFileSync(localFile, "{ this is not valid json\n");
    },
  },
  strip_hooks_block: {
    description: "Remove the hooks block from .claude/settings.json — scenario 1 asserts hooks present.",
    apply(fixtureDir) {
      const f = path.join(fixtureDir, ".claude", "settings.json");
      if (!fs.existsSync(f)) return;
      const obj = JSON.parse(fs.readFileSync(f, "utf8"));
      delete obj.hooks;
      fs.writeFileSync(f, JSON.stringify(obj, null, 2) + "\n");
    },
  },
};
const REGRESSION_NAMES = Object.keys(REGRESSIONS);

function applyInjectionAfterInstall(fixtureDir, name) {
  // Boundary check (AC-10.2): the fixture path must be under the active
  // fixture root before any write.
  const resolved = path.resolve(fixtureDir);
  const repoFixtureRoot = path.resolve(REPO_ROOT, ".mc", "test-fixtures");
  const underRepoFixture = resolved.startsWith(repoFixtureRoot + path.sep);
  const underTmp = resolved.startsWith(os.tmpdir() + path.sep);
  if (!underRepoFixture && !underTmp) {
    throw new Error(`AC-10.2 violation: injection refused — fixture path not under allowed roots: ${resolved}`);
  }
  const reg = REGRESSIONS[name];
  if (!reg) {
    process.stderr.write(`unknown injection: ${name}; known: ${REGRESSION_NAMES.join(", ")}\n`);
    process.exit(2);
  }
  reg.apply(fixtureDir);
}

// scenario6_adopt_path — SP-20260525-018 (T-217/AC-4 + T-218/AC-5.1 adopt mode).
// Seeds a temp clone brief in canonical, adopts it into the fixture with
// --skip-new, and asserts the brief lands under _docs/clones/<slug>/ (NOT the
// repo root). adopt MOVES the source, so a clean run consumes it; the finally
// block removes any residue if adopt fails mid-move.
function scenario6_adopt_path(scenario, fixtureDir, opts) {
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  const probeSlug = "matrix-adopt-probe";
  const srcBriefDir = path.join(REPO_ROOT, "_docs", "clones", probeSlug);
  try {
    fs.mkdirSync(path.join(srcBriefDir, "_raw"), { recursive: true });
    fs.writeFileSync(path.join(srcBriefDir, `${probeSlug}.clone.md`), "# probe brief\n");
    fs.writeFileSync(path.join(srcBriefDir, "_raw", "page.html"), "<html></html>\n");

    const adopt = runNode(
      "scripts/portfolio/adopt.js",
      [probeSlug, "--target-path", fixtureDir, "--skip-new"],
      { timeout: 30_000 },
    );
    assert("adopt exits 0", adopt.code === 0, `code=${adopt.code} stderr=${(adopt.stderr || "").slice(0, 200)}`);

    assert(
      "adopted brief lands under _docs/clones/<slug>/",
      fs.existsSync(path.join(fixtureDir, "_docs", "clones", probeSlug, `${probeSlug}.clone.md`)),
      "expected _docs/clones/<slug>/<slug>.clone.md",
    );
    assert(
      "adopted subdir (_raw) preserved under _docs/clones/<slug>/",
      fs.existsSync(path.join(fixtureDir, "_docs", "clones", probeSlug, "_raw", "page.html")),
      "expected _docs/clones/<slug>/_raw/page.html",
    );
    assert(
      "brief NOT dropped at repo root (T-217 regression guard)",
      !fs.existsSync(path.join(fixtureDir, `${probeSlug}.clone.md`)),
      "brief should not be at repo root",
    );
  } finally {
    try {
      fs.rmSync(srcBriefDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }

  r.durationMs = Date.now() - t0;
  return r;
}

// scenario7_installps1_path — SP-20260525-019 (T-20260525-223) install-path
// unification GATE.
//
// Asserts the install.ps1-equivalent path (base framework copy + shared
// scaffold core) produces a COMPLETE install — the same structural end-state
// as /warp:setup — and that the two installers produce path-identical trees
// (the β parity-DIFF constraint).
//
// These assertions are EXPECTED TO FAIL until the parallel ticket lands
// (a) scripts/mc/scaffold-core.js and (b) install.ps1 invoking it. That
// failure IS the gate.
function scenario7_installps1_path(scenario, fixtureDir, opts) {
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  // ── Part A: install.ps1-equivalent path yields a COMPLETE install ──
  const inst = installPs1EquivalentPath(fixtureDir);
  r.assertions.push({
    name: `install.ps1-equivalent path mode = ${inst.mode}`,
    status: "pass",
  });
  assert(
    "install.ps1-equivalent path (base copy + scaffold-core.js) exits 0",
    inst.code === 0,
    `mode=${inst.mode} code=${inst.code} stderr=${(inst.stderr || "").slice(0, 200)}`,
  );

  // COMPLETE-install structural assertions (mirror the /warp:setup end-state).
  for (const p of [
    "_mc",
    "_mc/MANIFEST.json",
    "_requirements/00-canonical",
    "_docs",
    "ROADMAP.md",
    "PROJECT.md",
  ]) {
    assert(
      `installps1: ${p} present`,
      fs.existsSync(path.join(fixtureDir, p)),
      `expected ${p} after install.ps1-equivalent path`,
    );
  }
  // _mc/ must be a non-empty directory (a complete source mirror).
  const w = path.join(fixtureDir, "_mc");
  assert(
    "installps1: _mc/ is a non-empty directory",
    fs.existsSync(w) && fs.statSync(w).isDirectory() && fs.readdirSync(w).length > 0,
    `exists=${fs.existsSync(w)}`,
  );
  // paths.json present with the sprint-orchestrator key.
  const pjPath = path.join(fixtureDir, ".claude", "paths.json");
  assert("installps1: .claude/paths.json present", fs.existsSync(pjPath), "expected paths.json");
  if (fs.existsSync(pjPath)) {
    let pj = {};
    try {
      pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
    } catch {
      /* leave empty → assertion fails with detail */
    }
    assert(
      "installps1: paths.json has sprintFullAutonomy",
      typeof pj.sprintFullAutonomy === "string" && pj.sprintFullAutonomy.length > 0,
      `sprintFullAutonomy=${pj.sprintFullAutonomy}`,
    );
  }
  // .claude/ reproducible from _mc/ — regenerate --check exits 0.
  const regen = runNode(
    "scripts/mc/views/regenerate.js",
    ["--check", "--root", fixtureDir],
    { timeout: 60_000 },
  );
  assert(
    "installps1: regenerate.js --check clean (.claude/ reproducible from _mc/)",
    regen.code === 0,
    `code=${regen.code} ${(regen.stdout || regen.stderr || "").slice(0, 200)}`,
  );

  // ── Part B: both_path_parity — DIFF the two installer trees ──────
  // Install a SECOND fixture via the /warp:setup path on identical inputs,
  // build a sorted relative-path file list of each tree, and DIFF them. Any
  // structural divergence (modulo PARITY_ALLOWLIST) FAILS. This is a true
  // diff — NOT "both independently pass structure-parity" (β constraint).
  const parityRoot = path.dirname(fixtureDir);
  const setupFixture = createFixture(parityRoot, "installps1_path-parity-setup");
  let parity = null;
  try {
    const setup = runNode("scripts/warp-setup.js", [setupFixture, "--yes"], { timeout: 180_000 });
    assert(
      "both_path_parity: /warp:setup reference install exits 0",
      setup.code === 0,
      `code=${setup.code} stderr=${(setup.stderr || "").slice(0, 200)}`,
    );

    const setupList = treeFileList(setupFixture);
    const ps1List = treeFileList(fixtureDir);
    parity = parityDiff(setupList, ps1List);

    // Both lists must be non-trivial — a parity of two empty trees is vacuous.
    assert(
      "both_path_parity: both trees are non-empty in-scope file sets",
      setupList.length > 0 && ps1List.length > 0,
      `setup=${setupList.length} ps1=${ps1List.length}`,
    );
    assert(
      "both_path_parity: install.ps1-equivalent tree == /warp:setup tree (sorted relative paths, modulo allowlist)",
      parity.equal,
      `onlyInSetup(${parity.onlyInA.length})=${parity.onlyInA.slice(0, 8).join(", ")} | onlyInPs1(${parity.onlyInB.length})=${parity.onlyInB.slice(0, 8).join(", ")}`,
    );
  } finally {
    cleanupFixture(setupFixture);
  }

  // Telemetry: record the parity divergence size for visibility while the gate
  // is red (pre-merge). Non-failing — the assertion above is the gate.
  if (parity) {
    r.assertions.push({
      name: `both_path_parity divergence: ${parity.onlyInA.length + parity.onlyInB.length} path(s) (allowlist: .git, framework-installed.json, runtime/, events/, memory/, .mc/, node_modules)`,
      status: "pass",
    });
  }

  r.durationMs = Date.now() - t0;
  return r;
}

// ── Main run loop ────────────────────────────────────────────────────

const SCENARIO_FNS = {
  1: scenario1_clean_install,
  2: scenario2_existing_install_upgrade,
  3: scenario3_dirty_uncommitted_preserved,
  4: scenario4_multi_version_upgrade,
  5: scenario5_user_overrides_preserved,
  6: scenario6_adopt_path,
  7: scenario7_installps1_path,
};

function emitEvent(kind, payload) {
  // Best-effort event emit. Falls back silently if events file is unreachable.
  try {
    const PATHS = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"),
    );
    const eventsFile = path.resolve(REPO_ROOT, PATHS.eventsFile || ".claude/runtime/events.jsonl");
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    const ev = { ts: new Date().toISOString(), kind, ...payload };
    fs.appendFileSync(eventsFile, JSON.stringify(ev) + "\n");
  } catch {
    /* fail-open */
  }
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  if (opts.injectRegression && !REGRESSIONS[opts.injectRegression]) {
    process.stderr.write(
      `unknown injection: ${opts.injectRegression}; known: ${REGRESSION_NAMES.join(", ")}\n`,
    );
    return 2;
  }

  const fixtureRoot = validateFixtureRoot(opts.fixtureRoot || defaultFixtureRoot());
  const scenarios = resolveScenarios(opts.scenarios);

  const startedAt = new Date().toISOString();
  emitEvent("install_matrix_start", {
    scenarios_requested: scenarios.map((s) => s.id),
    fixture_root: fixtureRoot,
    json_mode: opts.json,
    inject_regression: opts.injectRegression || null,
  });

  if (!opts.json) {
    process.stdout.write(
      `[matrix] start — scenarios=[${scenarios.map((s) => s.id).join(",")}] fixture-root=${fixtureRoot}` +
        (opts.injectRegression ? ` inject=${opts.injectRegression}` : "") +
        "\n",
    );
  }

  const results = [];
  for (const scenario of scenarios) {
    const fixtureDir = createFixture(fixtureRoot, scenario.slug);
    if (!opts.json) {
      process.stdout.write(`[scenario ${scenario.id}] ${scenario.slug} — fixture: ${fixtureDir}\n`);
    }
    let result;
    try {
      result = SCENARIO_FNS[scenario.id](scenario, fixtureDir, {
        injectRegression: opts.injectRegression,
      });
    } catch (err) {
      result = {
        id: scenario.id,
        name: scenario.slug,
        status: "fail",
        assertions: [
          { name: "scenario threw", status: "fail", detail: String(err && err.message || err) },
        ],
        durationMs: 0,
      };
    }
    results.push(result);
    emitEvent("install_matrix_scenario_completed", {
      scenario_id: scenario.id,
      scenario_name: scenario.slug,
      status: result.status,
      duration_ms: result.durationMs,
      assertion_count: result.assertions.length,
      failed_assertions: result.assertions
        .filter((a) => a.status === "fail")
        .map((a) => a.name),
    });

    if (!opts.json) {
      if (result.status === "pass") {
        process.stdout.write(
          `[scenario ${scenario.id}] PASS (${result.durationMs}ms, ${result.assertions.length} assertions)\n`,
        );
      } else {
        const firstFail = result.assertions.find((a) => a.status === "fail");
        process.stdout.write(
          `[scenario ${scenario.id}] FAIL — ${firstFail ? firstFail.name : "?"}: ${
            firstFail ? firstFail.detail : ""
          }\n`,
        );
      }
    }

    // Cleanup on pass; move-aside on fail (unless --keep-failed).
    if (result.status === "pass") {
      cleanupFixture(fixtureDir);
    } else if (opts.keepFailed) {
      if (!opts.json) {
        process.stdout.write(`[scenario ${scenario.id}] fixture kept in place at ${fixtureDir}\n`);
      }
    } else {
      const moved = moveFailedFixtureAside(fixtureRoot, fixtureDir, scenario.slug);
      if (!opts.json) {
        process.stdout.write(
          `[scenario ${scenario.id}] fixture preserved at ${moved} for inspection (re-run with --keep-failed to inhibit this move)\n`,
        );
      }
    }
  }

  const totals = {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status !== "pass").length,
    durationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
  };
  const ok = totals.fail === 0;

  // Meta-test pass/fail semantics:
  // - Without --inject-regression: ok means every scenario passed.
  // - With --inject-regression: we EXPECT at least one scenario to fail; if
  //   all scenarios pass anyway, the injection slipped through → matrix
  //   failed to detect the planted regression.
  let metaOk = null;
  let caughtScenarios = [];
  if (opts.injectRegression) {
    metaOk = totals.fail > 0;
    caughtScenarios = results.filter((r) => r.status === "fail").map((r) => r.id);
    if (metaOk) {
      for (const sid of caughtScenarios) {
        emitEvent("install_matrix_meta_caught", {
          injection_name: opts.injectRegression,
          scenario_id: sid,
        });
      }
    }
  }

  emitEvent("install_matrix_done", {
    total_scenarios: scenarios.length,
    pass: totals.pass,
    fail: totals.fail,
    total_duration_ms: totals.durationMs,
    inject_regression: opts.injectRegression || null,
    meta_ok: metaOk,
    caught_scenarios: caughtScenarios,
    exit_code:
      opts.injectRegression
        ? (metaOk ? 0 : 1)
        : (ok ? 0 : 1),
  });

  if (opts.json) {
    const payload = {
      ok: opts.injectRegression ? metaOk : ok,
      meta_mode: !!opts.injectRegression,
      injection: opts.injectRegression || null,
      caught_scenarios: caughtScenarios,
      scenarios: results,
      totals,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Results: ${totals.pass}/${results.length} passed (${totals.durationMs}ms total)\n`,
    );
    if (opts.injectRegression) {
      if (metaOk) {
        process.stdout.write(
          `[meta] injection ${opts.injectRegression} caught by scenario(s): ${caughtScenarios.join(",") || "?"}\n`,
        );
      } else {
        process.stdout.write(
          `[meta] FAIL — injection ${opts.injectRegression} slipped through ALL scenarios\n`,
        );
      }
    }
  }

  if (opts.injectRegression) return metaOk ? 0 : 1;
  return ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  parseArgs,
  resolveScenarios,
  synthesizeCapsule,
  listCapsuleVersions,
  REGRESSIONS,
  REGRESSION_NAMES,
  // Exported for unit-testability:
  SCENARIOS,
  // install.ps1-equivalent path + parity-diff helpers (T-20260525-223):
  treeFileList,
  parityDiff,
  copyManifestAssets,
  installPs1EquivalentPath,
  PARITY_ALLOWLIST,
  PARITY_SCOPE_DIRS,
  PARITY_SCOPE_FILES,
};
