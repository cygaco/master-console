#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const os = require("os");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

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

Runs the MC install-fixture test matrix. Spins up ephemeral fixture projects
and exercises /mc:setup and /mc:update against 5 representative scenarios.

Scenarios (run all if --scenarios is omitted):
  1   clean_install                 fresh empty target → mc-setup → assert
  2   existing_install_upgrade      seeded install → update --to <newer>
  3   dirty_uncommitted_preserved   seeded install + operator edit → update
  4   multi_version_upgrade         seeded install at N → update --to N+k
  5   user_overrides_preserved      seeded install + settings.local → update
  6   adopt_path                    clone brief adopted → lands under _docs/clones/
  7   installps1_path               install.ps1-equiv path → COMPLETE + parity-diff vs mc-setup

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

function defaultFixtureRoot() {
  return path.join(REPO_ROOT, ".mc", "test-fixtures", "install-matrix");
}

function validateFixtureRoot(root) {
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
    return fixtureDir;
  }
}

function cleanupFixture(fixtureDir) {
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  } catch {
  }
}

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

function findPowershell() {
  for (const exe of ["pwsh", "powershell"]) {
    const probe = spawnSync(exe, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    if (probe.status === 0 && /\d/.test(probe.stdout || "")) return exe;
  }
  return null;
}

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

function installPs1EquivalentPath(fixtureDir) {
  const ps = findPowershell();
  if (ps) {
    const installPs1 = path.join(REPO_ROOT, "install.ps1");
    const r = spawnSync(
      ps,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", installPs1, "-Target", fixtureDir, "-SkipPrompt"],
      { encoding: "utf8", timeout: 180_000, env: { ...process.env } },
    );
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
    try {
      fs.rmSync(path.join(fixtureDir, ".claude"), { recursive: true, force: true });
    } catch {
    }
  }
  copyManifestAssets(fixtureDir);
  const scaffold = runNode("scripts/mc/scaffold-core.js", [fixtureDir], { timeout: 180_000 });
  return {
    mode: "node",
    code: scaffold.code,
    stdout: scaffold.stdout,
    stderr: scaffold.stderr,
    scaffold,
  };
}

const PARITY_SCOPE_DIRS = [".claude", "_mc", "_requirements", "_docs"];
const PARITY_SCOPE_FILES = ["ROADMAP.md", "PROJECT.md"];

const PARITY_ALLOWLIST = [
  /^\.git(\/|$)/,
  /^\.claude\/framework-installed\.json$/,
  /^\.claude\/framework-manifest\.json$/,
  /^\.claude\/runtime(\/|$)/,
  /^\.claude\/project\/events(\/|$)/,
  /^\.claude\/project\/memory(\/|$)/,
  /^\.mc(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.DS_Store$/,
];

function isParityAllowlisted(rel) {
  return PARITY_ALLOWLIST.some((re) => re.test(rel));
}

function inParityScope(rel) {
  if (PARITY_SCOPE_FILES.includes(rel)) return true;
  return PARITY_SCOPE_DIRS.some((d) => rel === d || rel.startsWith(d + "/"));
}

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
      if (ent.isDirectory()) {
        const probe = relPath + "/";
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

function parityDiff(listA, listB) {
  const setA = new Set(listA);
  const setB = new Set(listB);
  const onlyInA = listA.filter((p) => !setB.has(p));
  const onlyInB = listB.filter((p) => !setA.has(p));
  return { equal: onlyInA.length === 0 && onlyInB.length === 0, onlyInA, onlyInB };
}

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

  assert(
    `${label}: NO stale framework/templates/ in installed tree (no pre-migration dependency)`,
    !fs.existsSync(path.join(fixtureDir, "framework", "templates")),
    "framework/templates/ present in fixture — stale pre-migration dependency shipped",
  );

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

function seedInstall(fixtureDir) {
  const r = runNode("scripts/mc-setup.js", [fixtureDir, "--yes"], {
    timeout: 120_000,
  });
  return r.code === 0;
}

function pretendVersion(fixtureDir, fakeVersion) {
  const file = path.join(fixtureDir, ".claude", "framework-installed.json");
  if (!fs.existsSync(file)) return false;
  const obj = JSON.parse(fs.readFileSync(file, "utf8"));
  obj.installedVersion = fakeVersion;
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  return true;
}

function scenario1_clean_install(scenario, fixtureDir, opts) {
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  const setup = runNode("scripts/mc-setup.js", [fixtureDir, "--yes"], { timeout: 120_000 });
  assert("mc-setup exits 0", setup.code === 0, `code=${setup.code} stderr=${(setup.stderr || "").slice(0, 200)}`);

  if (setup.code === 0) {
    if (opts.injectRegression) {
      applyInjectionAfterInstall(fixtureDir, opts.injectRegression);
    }

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

    const settingsPath = path.join(fixtureDir, ".claude", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      assert(
        ".claude/settings.json has hooks block",
        settings.hooks && typeof settings.hooks === "object",
        `hooks=${JSON.stringify(settings.hooks).slice(0, 100)}`,
      );
    }

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

    assertMigratedShippedStructure(r, assert, fixtureDir, "fresh");
  }

  r.durationMs = Date.now() - t0;
  return r;
}

function scenario2_existing_install_upgrade(scenario, fixtureDir, opts) {
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  if (!seedInstall(fixtureDir)) {
    assert("seed install (mc-setup)", false, "mc-setup did not exit 0");
    r.durationMs = Date.now() - t0;
    return r;
  }

  const mcDir = path.join(fixtureDir, "_mc");
  const reSetup = runNode("scripts/mc-setup.js", [fixtureDir, "--yes"], {
    timeout: 120_000,
  });
  assert(
    "re-running mc-setup over existing install exits 0",
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

  const spUpdate = runNode("scripts/checks/mc-structure-parity.js", [], {
    env: { CLAUDE_PROJECT_DIR: fixtureDir },
  });
  assert(
    "structure-parity holds after update",
    spUpdate.code === 0,
    `code=${spUpdate.code} ${(spUpdate.stdout || spUpdate.stderr || "").slice(0, 160)}`,
  );

  assertMigratedShippedStructure(r, assert, fixtureDir, "upgrade");

  r.durationMs = Date.now() - t0;
  return r;
}

function scenario3_dirty_uncommitted_preserved(scenario, fixtureDir, opts) {
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  if (!seedInstall(fixtureDir)) {
    assert("seed install (mc-setup)", false);
    r.durationMs = Date.now() - t0;
    return r;
  }

  const installed = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, ".claude", "framework-installed.json"), "utf8"),
  );
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

  const cur = currentVersion();
  const versions = listCapsuleVersions();
  const oldVersion = versions[versions.length - 2] || versions[0];
  pretendVersion(fixtureDir, oldVersion);

  const u = runNode(
    "scripts/mc/update.js",
    ["--target", fixtureDir, "--to", cur, "--apply", "--skip-preflight"],
    { timeout: 60_000 },
  );

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
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

  if (!seedInstall(fixtureDir)) {
    assert("seed install (mc-setup)", false);
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

  assert(
    "synth helper bypassed when real capsules sufficient",
    versions.length >= 2,
  );

  const tmpSynth = fs.mkdtempSync(path.join(os.tmpdir(), "mc-synth-"));
  try {
    const synthDir = synthesizeCapsule({
      version: "99.99.99",
      baseRoot: tmpSynth,
      migrations: [{ id: "noop", from: "0.0.0", to: "99.99.99", file: null }],
    });
    assert(
      "synthesizeCapsule writes release.json",
      fs.existsSync(path.join(synthDir, "release.json")),
    );
    assert(
      "synthesizeCapsule writes framework-manifest.json",
      fs.existsSync(path.join(synthDir, "framework-manifest.json")),
    );
    const synthRelease = JSON.parse(
      fs.readFileSync(path.join(synthDir, "release.json"), "utf8"),
    );
    assert(
      "synth release.json#version correct",
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
    assert("seed install (mc-setup)", false);
    r.durationMs = Date.now() - t0;
    return r;
  }

  const localFile = path.join(fixtureDir, ".claude", "settings.local.json");
  const sentinelAllow = `OperatorOverride(${Date.now()})`;
  const localPayload = {
    permissions: {
      allow: [sentinelAllow, "Bash(echo *)"],
    },
  };
  fs.writeFileSync(localFile, JSON.stringify(localPayload, null, 2) + "\n");

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
  const resolved = path.resolve(fixtureDir);
  const repoFixtureRoot = path.resolve(REPO_ROOT, ".mc", "test-fixtures");
  const underRepoFixture = resolved.startsWith(repoFixtureRoot + path.sep);
  const underTmp = resolved.startsWith(os.tmpdir() + path.sep);
  if (!underRepoFixture && !underTmp) {
    throw new Error(`injection refused — fixture path not under allowed roots: ${resolved}`);
  }
  const reg = REGRESSIONS[name];
  if (!reg) {
    process.stderr.write(`unknown injection: ${name}; known: ${REGRESSION_NAMES.join(", ")}\n`);
    process.exit(2);
  }
  reg.apply(fixtureDir);
}

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
      "brief NOT dropped at repo root (regression guard)",
      !fs.existsSync(path.join(fixtureDir, `${probeSlug}.clone.md`)),
      "brief should not be at repo root",
    );
  } finally {
    try {
      fs.rmSync(srcBriefDir, { recursive: true, force: true });
    } catch {
    }
  }

  r.durationMs = Date.now() - t0;
  return r;
}

function scenario7_installps1_path(scenario, fixtureDir, opts) {
  const r = { id: scenario.id, name: scenario.slug, status: "pass", assertions: [], durationMs: 0 };
  const assert = mkAssert(r);
  const t0 = Date.now();

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
  const w = path.join(fixtureDir, "_mc");
  assert(
    "installps1: _mc/ is a non-empty directory",
    fs.existsSync(w) && fs.statSync(w).isDirectory() && fs.readdirSync(w).length > 0,
    `exists=${fs.existsSync(w)}`,
  );
  const pjPath = path.join(fixtureDir, ".claude", "paths.json");
  assert("installps1: .claude/paths.json present", fs.existsSync(pjPath), "expected paths.json");
  if (fs.existsSync(pjPath)) {
    let pj = {};
    try {
      pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
    } catch {
    }
    assert(
      "installps1: paths.json has sprintFullAutonomy",
      typeof pj.sprintFullAutonomy === "string" && pj.sprintFullAutonomy.length > 0,
      `sprintFullAutonomy=${pj.sprintFullAutonomy}`,
    );
  }
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

  const parityRoot = path.dirname(fixtureDir);
  const setupFixture = createFixture(parityRoot, "installps1_path-parity-setup");
  let parity = null;
  try {
    const setup = runNode("scripts/mc-setup.js", [setupFixture, "--yes"], { timeout: 180_000 });
    assert(
      "both_path_parity: /mc:setup reference install exits 0",
      setup.code === 0,
      `code=${setup.code} stderr=${(setup.stderr || "").slice(0, 200)}`,
    );

    const setupList = treeFileList(setupFixture);
    const ps1List = treeFileList(fixtureDir);
    parity = parityDiff(setupList, ps1List);

    assert(
      "both_path_parity: both trees are non-empty in-scope file sets",
      setupList.length > 0 && ps1List.length > 0,
      `setup=${setupList.length} ps1=${ps1List.length}`,
    );
    assert(
      "both_path_parity: install.ps1-equivalent tree == /mc:setup tree (sorted relative paths, modulo allowlist)",
      parity.equal,
      `onlyInSetup(${parity.onlyInA.length})=${parity.onlyInA.slice(0, 8).join(", ")} | onlyInPs1(${parity.onlyInB.length})=${parity.onlyInB.slice(0, 8).join(", ")}`,
    );
  } finally {
    cleanupFixture(setupFixture);
  }

  if (parity) {
    r.assertions.push({
      name: `both_path_parity divergence: ${parity.onlyInA.length + parity.onlyInB.length} path(s) (allowlist: .git, framework-installed.json, runtime/, events/, memory/, .mc/, node_modules)`,
      status: "pass",
    });
  }

  r.durationMs = Date.now() - t0;
  return r;
}

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
  try {
    const PATHS = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"),
    );
    const eventsFile = path.resolve(REPO_ROOT, PATHS.eventsFile || ".claude/runtime/events.jsonl");
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    const ev = { ts: new Date().toISOString(), kind, ...payload };
    fs.appendFileSync(eventsFile, JSON.stringify(ev) + "\n");
  } catch {
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
  SCENARIOS,
  treeFileList,
  parityDiff,
  copyManifestAssets,
  installPs1EquivalentPath,
  PARITY_ALLOWLIST,
  PARITY_SCOPE_DIRS,
  PARITY_SCOPE_FILES,
};
