#!/usr/bin/env node
/**
 * release-canonical.js — drive a full MC release of the canonical clone
 * from the product repo, without ever switching the caller's cwd into the
 * canonical repo. All canonical-side ops happen via spawnSync({cwd: canonical})
 * or `git -C <canonical> ...`.
 *
 * Why it exists: the prior release flow required the operator to cd into the
 * MC clone for bump/regen/build/gates/merge. RT-017 (2026-05-01) flagged
 * this as a real workflow gap. This script is the closer.
 *
 * Stages (default = dry-run; --apply executes):
 *   0  Locate canonical clone
 *   1  [RETIRED] Was product→canonical promote; surface purged in
 *      SP-20260522-001. Stage retained as no-op so downstream stage
 *      indices (and --resume-from values) remain stable. `--no-promote`
 *      still parses but is now redundant.
 *   2  Compute new version (patch | minor | <explicit>)
 *   3  Bump <canonical>/version.json
 *   4  Regen <canonical>/.claude/framework-manifest.json
 *   5  Create <canonical>/framework/releases/<v>/ skeleton
 *   6  Build capsule (release-build.js)
 *   7  Run release gates
 *   8  Build the release commit for release/<v> IN CANONICAL, entirely by
 *      plumbing (write-tree + commit-tree) — no ref besides release/<v>
 *      itself moves, and main is never touched by this stage.
 *   9  Land release/<v> → main THROUGH the INC-1 brokered transport
 *      (scripts/dispatch/broker-merge.js's brokerMerge(), which calls the
 *      broker's integrateBranchMerge entrypoint) + push origin main.
 *  10  Tag mc@<v> + push                                  [--no-tag skips]
 *
 * Each stage emits a receipt {stage, ok, what, where, rollback}. On failure
 * the report tells you which stages did/didn't run + how to resume.
 *
 * SP-20260721-001 D-4 INC-1 (ceremony step 1): stages 8-9 are the MIGRATED
 * main-write call-site (scripts/checks/main-write-broker-completeness.js) —
 * no raw local commit/merge/ref-move remains anywhere in this file; every
 * object is built with plumbing and the only ref-move onto main happens
 * inside the broker's own fenced compare-and-swap. This path is
 * PRE-FLIP-SAFE: with no pinned bundle promoted yet it falls back to the
 * ordinary route, LOGGED + COUNTED + SURFACED (scripts/dispatch/
 * broker-dogfood.js) — it is never gated on whether the Seam E hook is
 * installed, so it works unchanged before and after the flip.
 *
 * Usage:
 *   node scripts/mc/release-canonical.js --canonical ../MC --version patch
 *   node scripts/mc/release-canonical.js --version patch --apply
 *   node scripts/mc/release-canonical.js --canonical ../MC --version 0.2.0 --apply --no-tag
 *   node scripts/mc/release-canonical.js --resume-from 7 --apply
 *   node scripts/mc/release-canonical.js --apply --sp-id my-release \
 *     --bundle-manifest <promoted-manifest> --bundle-root <promoted-root>
 *
 * Slash entry point: /mc:release (see .claude/commands/mc/release.md).
 */

const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { brokerMerge } = require("../dispatch/broker-merge");
// 7G-002: the pre-land origin sync's brokered fast-forward reuses the SAME dogfood plumbing
// (lease/bundle/classify+fallback) broker-merge.js and broker-release-commit.js already dogfood — see
// syncMainFromOrigin()/brokerFastForwardMain() below.
const dog = require("../dispatch/broker-dogfood");

const PRODUCT_ROOT = path.resolve(__dirname, "..", "..");

// ── arg parse ─────────────────────────────────────────────

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    return argv[i + 1];
  };
  return {
    canonical: get("--canonical"),
    version: get("--version") || "patch",
    apply: argv.includes("--apply"),
    noPromote: argv.includes("--no-promote"),
    noTag: argv.includes("--no-tag"),
    resumeFrom: get("--resume-from") ? parseInt(get("--resume-from"), 10) : 0,
    json: argv.includes("--json"),
    // Threaded through to brokerMerge() (stage 9) — the INC-1 brokered land onto main. spId defaults to a
    // fixed pseudo-sprint id (not tied to any sprint ceremony) so an ad-hoc release run always holds a
    // lease without requiring the operator to be mid-sprint.
    spId: get("--sp-id") || mcEnv.readEnv("SP_ID") || "warpos-release-canonical",
    leaseRoot: get("--lease-root") || null,
    bundleManifestPath: get("--bundle-manifest") || mcEnv.readEnv("PINNED_BUNDLE_MANIFEST") || null,
    bundleRoot: get("--bundle-root") || mcEnv.readEnv("PINNED_BUNDLE_ROOT") || null,
    noBrokerFallback: argv.includes("--no-broker-fallback"),
  };
}

// ── helpers ───────────────────────────────────────────────

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

function isCanonicalLayout(p) {
  if (!p) return false;
  return (
    fs.existsSync(path.join(p, "version.json")) &&
    fs.existsSync(path.join(p, ".claude")) &&
    fs.existsSync(path.join(p, "framework"))
  );
}

function locateCanonical(opt) {
  // Order: explicit flag → sibling ../MC → manifest hint → walk up.
  const tries = [];
  if (opt) tries.push(path.resolve(opt));
  tries.push(path.resolve(PRODUCT_ROOT, "..", "MC"));
  tries.push(path.resolve(PRODUCT_ROOT, "..", "mc"));
  try {
    const manifest = readJson(
      path.join(PRODUCT_ROOT, ".claude", "manifest.json"),
    );
    const src = manifest?.mc?.source;
    if (src && !/^https?:\/\//.test(src)) tries.push(path.resolve(src));
  } catch {
    /* no manifest is fine */
  }
  for (const candidate of tries) {
    if (isCanonicalLayout(candidate)) return candidate;
  }
  return null;
}

function bumpVersion(current, mode) {
  if (/^\d+\.\d+\.\d+$/.test(mode)) return mode;
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`current version not semver: ${current}`);
  const [, maj, min, pat] = m.map(Number);
  if (mode === "patch") return `${maj}.${min}.${pat + 1}`;
  if (mode === "minor") return `${maj}.${min + 1}.0`;
  if (mode === "major") return `${maj + 1}.0.0`;
  throw new Error(`unknown --version mode: ${mode}`);
}

function runIn(cwd, cmd, args, env) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...(env || {}) },
    timeout: 300_000,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

function nodeIn(cwd, scriptRel, args) {
  return runIn(cwd, process.execPath, [scriptRel, ...(args || [])]);
}

function gitC(cwd, args) {
  return runIn(cwd, "git", ["-C", cwd, ...args]);
}

// ── stages ────────────────────────────────────────────────

const STAGE_NAMES = [
  "locate-canonical",
  "promote",
  "compute-version",
  "bump-version",
  "regen-manifest",
  "create-capsule-skeleton",
  "build-capsule",
  "run-gates",
  "commit-release-branch",
  "merge-to-main-and-push",
  "tag-and-push",
];

function receipt(stage, ok, what, where, rollback, extra) {
  return {
    stage,
    name: STAGE_NAMES[stage],
    ok,
    what,
    where,
    rollback,
    ...(extra || {}),
  };
}

// ── stage 0: locate ───────────────────────────────────────
function stageLocate(opts) {
  const canonical = locateCanonical(opts.canonical);
  if (!canonical) {
    return receipt(
      0,
      false,
      "Could not locate the canonical MC clone",
      null,
      "Pass --canonical <absolute-or-relative-path> or place a clone at ../MC",
    );
  }
  return receipt(
    0,
    true,
    `Found canonical clone`,
    canonical,
    "n/a — read-only check",
    { canonical },
  );
}

// ── stage 1: promote (RETIRED) ────────────────────────────
// The product→canonical promote surface was purged in SP-20260522-001
// (full upstream-discovery purge). This stage is preserved as a no-op
// solely so downstream stage indices and --resume-from values stay
// stable for any operator muscle memory or in-flight docs. Delete
// the stage entirely (and shift indices down) in a future cleanup
// sprint when the cost of preserving the vestigial number is higher
// than the cost of renumbering.
function stagePromote(opts, canonical) {
  return receipt(
    1,
    true,
    "Promote stage retired — canonical→product is now the only sync direction (SP-20260522-001); no-op",
    canonical,
    "n/a — no work performed",
    { skipped: true, retired: true },
  );
}

// ── stage 2: compute version ──────────────────────────────
function stageComputeVersion(opts, canonical) {
  let current;
  try {
    current = readJson(path.join(canonical, "version.json")).version;
  } catch (e) {
    return receipt(
      2,
      false,
      `Cannot read canonical version.json: ${e.message}`,
      canonical,
      "Verify <canonical>/version.json exists",
    );
  }
  let next;
  try {
    next = bumpVersion(current, opts.version);
  } catch (e) {
    return receipt(
      2,
      false,
      e.message,
      canonical,
      "Pass --version patch|minor|major|<x.y.z>",
    );
  }
  if (next === current) {
    return receipt(
      2,
      false,
      `Computed version ${next} equals current — nothing to release`,
      canonical,
      "Pass a higher --version, or skip this script if no release intended",
    );
  }
  return receipt(
    2,
    true,
    `Bumping ${current} → ${next}`,
    canonical,
    "n/a — read-only computation",
    { current, next },
  );
}

// ── stage 3: bump version.json ────────────────────────────
function stageBumpVersion(opts, canonical, current, next) {
  const file = path.join(canonical, "version.json");
  const before = readJson(file);
  const after = {
    ...before,
    version: next,
    releasedAt: new Date().toISOString().slice(0, 10),
    previousVersions: Array.from(
      new Set([...(before.previousVersions || []), current]),
    ),
    notes: `Patch / minor / major bump from ${current} (auto-generated by release-canonical.js — fill in the changelog before publishing).`,
  };
  if (!opts.apply) {
    return receipt(
      3,
      true,
      `[dry-run] Would write version.json with version=${next}`,
      file,
      "n/a — dry-run",
      { before, after },
    );
  }
  writeJson(file, after);
  // 2026-05-30: the bump must ALSO touch the version-bearing fields that neither
  // version-quorum nor the manifest regen covers — else they lag (the 0.10.0→0.11.0
  // bug: .claude/manifest.json#warpos.version + install.ps1's WARPOS_VERSION fallback
  // stayed behind). version-coherence (release-gate) now blocks on this, so the engine
  // must keep them current. Fail-open — never blocks the release.
  try {
    const mfFile = path.join(canonical, ".claude", "manifest.json");
    if (fs.existsSync(mfFile)) {
      const mf = readJson(mfFile);
      if (mf.mc && mf.mc.version && mf.mc.version !== next) {
        mf.mc.version = next;
        writeJson(mfFile, mf);
      }
    }
  } catch (e) {
    process.stderr.write(`bump: .claude/manifest.json#mc.version skip (${e.message})\n`);
  }
  try {
    const psFile = path.join(canonical, "install.ps1");
    if (fs.existsSync(psFile)) {
      const ps = fs.readFileSync(psFile, "utf8");
      const re = /(\$Script:WARPOS_VERSION\s*=\s*")[^"]+(")/;
      if (re.test(ps)) fs.writeFileSync(psFile, ps.replace(re, `$1${next}$2`));
    }
  } catch (e) {
    process.stderr.write(`bump: install.ps1 WARPOS_VERSION skip (${e.message})\n`);
  }
  // SP-20260519-001 R-2: append version row to canonical RELEASES.md ledger.
  // Fail-open: never blocks the release. Loads ledger.js from canonical so
  // its writers stay self-hosted there.
  try {
    const ledgerPath = path.join(canonical, "scripts", "sprint", "ledger.js");
    if (fs.existsSync(ledgerPath)) {
      // Use a child-process boundary so we don't carry stale module state
      // across runs against different canonical roots.
      const summary = (opts.summary && String(opts.summary).trim()) ||
        `Patch bump to ${next}. Fill in via release notes.`;
      const capsulePath = `framework/releases/${next}/release.json`;
      const ledger = require(ledgerPath);
      const lr = ledger.appendVersionRow(
        {
          version: next,
          releasedAt: after.releasedAt,
          summary,
          capsulePath,
        },
        { projectRoot: canonical },
      );
      if (lr.written) {
        process.stdout.write(
          `releases: RELEASES.md row added version ${next} (canonical)\n`,
        );
      } else if (lr.reason !== "already-present") {
        process.stderr.write(`releases: skipped (${lr.reason})\n`);
      }
    } else {
      process.stderr.write(
        `releases: skipped (ledger.js absent in canonical at ${ledgerPath})\n`,
      );
    }
  } catch (err) {
    process.stderr.write(`releases: skipped (${err.message})\n`);
  }
  return receipt(
    3,
    true,
    `Wrote version.json (${current} → ${next})`,
    file,
    `Restore prior content: write {"version":"${current}",...} back, or git -C ${canonical} checkout HEAD -- version.json`,
  );
}

// ── stage 4: regen manifest ───────────────────────────────
function stageRegenManifest(opts, canonical) {
  if (!opts.apply) {
    return receipt(
      4,
      true,
      "[dry-run] Would regen .claude/framework-manifest.json in canonical",
      canonical,
      "n/a — dry-run",
    );
  }
  const r = nodeIn(canonical, "scripts/generate-framework-manifest.js", []);
  if (!r.ok) {
    return receipt(
      4,
      false,
      `generate-framework-manifest.js failed (exit ${r.status})`,
      canonical,
      "Inspect stderr in canonical; fix and --resume-from 4",
      { stderr: r.stderr.slice(0, 500) },
    );
  }
  return receipt(
    4,
    true,
    "Regenerated .claude/framework-manifest.json",
    path.join(canonical, ".claude", "framework-manifest.json"),
    `git -C ${canonical} checkout HEAD -- .claude/framework-manifest.json`,
  );
}

// ── stage 5: capsule skeleton ─────────────────────────────
// L-2026-05-14-env-flag-existing-install-migration:
// Auto-detect migrations in migrations/<prior>-to-<version>/ so the release.json#migrations[]
// list isn't silently empty when migration files exist on disk. Previously this field defaulted
// to [] regardless of disk content — meaning a migration committed without manual release.json
// edit silently never ran. /scan:mc-migration-presence guards the inverse (listed but
// missing), but had no guard for the present-but-unlisted case.
function detectMigrationsForRelease(canonical, version) {
  const v = readJson(path.join(canonical, "version.json"));
  const migrationsDir = path.join(canonical, "migrations");
  if (!fs.existsSync(migrationsDir)) return [];
  const toVersion = version;
  // Collect every migrations/<fromPat>-to-<toVersion>/ dir (exact or wildcard fromPat).
  // release-build.js validates paths with path.resolve(capsuleDir, m.file) and
  // requires them to land inside <repo>/migrations/. capsuleDir is
  // <canonical>/framework/releases/<version>/, so m.file must be relative
  // FROM the capsule dir back to migrations/ — i.e. prefixed with `../../../`.
  // Writing repo-relative paths (`migrations/...`) would resolve to
  // <capsule>/migrations/... and trip the boundary check.
  const capsuleDir = path.join(canonical, "framework", "releases", toVersion);
  const out = [];
  for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(/^([\d.x]+)-to-(\d+\.\d+\.\d+)$/i);
    if (!m) continue;
    if (m[2] !== toVersion) continue;
    const subdir = path.join(migrationsDir, entry.name);
    for (const f of fs.readdirSync(subdir)) {
      if (!f.endsWith(".js")) continue;
      const absFile = path.join(subdir, f);
      const relFromCapsule = path
        .relative(capsuleDir, absFile)
        .replace(/\\/g, "/");
      out.push({
        id: `${entry.name}/${f.replace(/\.js$/, "")}`,
        file: relFromCapsule,
      });
    }
  }
  return out;
}

function buildSkeletonReleaseJson(canonical, version) {
  const v = readJson(path.join(canonical, "version.json"));
  return {
    schema: "mc/release/v1",
    version,
    createdAt: new Date().toISOString(),
    commit: null,
    minUpgradeableFrom: v.minUpgradeableFrom || null,
    requiresFreshInstallFromBelow: null,
    manifestSchema: v.frameworkManifestSchema || "mc/framework-manifest/v2",
    pathRegistryVersion: (v.pathRegistrySchema || "").split("/").pop() || "v4",
    hooksRegistrySchema: v.hooksRegistrySchema || "mc/hooks-registry/v1",
    migrations: detectMigrationsForRelease(canonical, version),
    // SP-20260513-002 (T-20260513-020): provider-smoke is the terminal
    // post-update check. Static literal — RT-4 disallows shell interpolation.
    // SP-005 owns the orchestration in scripts/mc/update.js; we declare
    // the entry here as a standalone CLI invocation. When SP-005 exposes
    // registerExternalCheck (scripts/mc/postflight.js), provider-smoke
    // can be migrated to register through that primitive; until then it
    // continues to ride the postUpdateChecks array.
    postUpdateChecks: [
      "node scripts/paths/build.js --check",
      "node scripts/paths/gate.js",
      "node scripts/hooks/build.js --check",
      "node scripts/hooks/test.js",
      // SP-20260525-024: structure-parity guards the downstream content-gap fix —
      // update.js now scaffolds the _requirements/* skeleton + _docs + ROADMAP +
      // PROJECT, so a consumer post-update MUST have every REQUIRED_DIR. Catches
      // a regression where the scaffold step is dropped or the skeleton drifts.
      "node scripts/checks/mc-structure-parity.js",
      "node scripts/mc/provider-smoke.js --providers claude,openai,gemini",
    ],
    checksumsFile: "checksums.json",
  };
}

function buildSkeletonChangelog(version, current) {
  return `# MC ${version} — ${new Date().toISOString().slice(0, 10)}

> Skeleton generated by scripts/mc/release-canonical.js. Replace this
> placeholder content with real release notes before tagging.

## What's new since ${current}

- (TODO: list user-visible changes)

## Breaking changes

- None (TODO: confirm)

## Schema changes

- None (TODO: confirm)

## Migrations

- None (TODO: confirm)

## Pinned commit

Captured at release-build time (recorded in release.json#commit after
scripts/mc/release-build.js runs).
`;
}

function buildSkeletonUpgradeNotes(version, current) {
  return `# Upgrade notes — ${current} → ${version}

> Skeleton generated by scripts/mc/release-canonical.js. Replace before
> tagging.

## Pre-flight

1. Tag your current state: \`git tag pre-mc-${version}-update HEAD\`.
2. Confirm clean working tree: \`git status --porcelain\` empty.

## Run the update

\`\`\`bash
node scripts/mc/update.js --to ${version} \\
  --source ../MC \\
  --target . \\
  --dry-run

node scripts/mc/update.js --to ${version} \\
  --source ../MC \\
  --target . \\
  --apply
\`\`\`

## Rollback

\`\`\`bash
git reset --hard pre-mc-${version}-update
\`\`\`

(or restore from \`.mc/transactions/<latest>/backup/\`).
`;
}

function stageCreateSkeleton(opts, canonical, current, next) {
  const dir = path.join(canonical, "framework", "releases", next);
  const release = path.join(dir, "release.json");
  const changelog = path.join(dir, "changelog.md");
  const upgrade = path.join(dir, "upgrade-notes.md");
  const wrote = [];
  const reuse = [];
  const plan = [];

  if (fs.existsSync(release)) reuse.push("release.json");
  else plan.push("release.json");
  if (fs.existsSync(changelog)) reuse.push("changelog.md");
  else plan.push("changelog.md");
  if (fs.existsSync(upgrade)) reuse.push("upgrade-notes.md");
  else plan.push("upgrade-notes.md");

  if (!opts.apply) {
    return receipt(
      5,
      true,
      `[dry-run] Would create capsule dir + ${plan.length} skeleton file(s); reuse ${reuse.length}`,
      dir,
      "n/a — dry-run",
      { plan, reuse },
    );
  }

  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(release)) {
    writeJson(release, buildSkeletonReleaseJson(canonical, next));
    wrote.push("release.json");
  }
  if (!fs.existsSync(changelog)) {
    fs.writeFileSync(changelog, buildSkeletonChangelog(next, current));
    wrote.push("changelog.md");
  }
  if (!fs.existsSync(upgrade)) {
    fs.writeFileSync(upgrade, buildSkeletonUpgradeNotes(next, current));
    wrote.push("upgrade-notes.md");
  }

  return receipt(
    5,
    true,
    `Created capsule skeleton: wrote ${wrote.length}, kept ${reuse.length}`,
    dir,
    `Remove: rm -rf ${dir} (only safe if nothing else has been built into it)`,
    { wrote, reuse },
  );
}

// ── stage 6: build capsule ────────────────────────────────
function stageBuildCapsule(opts, canonical, next) {
  if (!opts.apply) {
    return receipt(
      6,
      true,
      `[dry-run] Would run scripts/mc/release-build.js ${next} in canonical`,
      canonical,
      "n/a — dry-run",
    );
  }
  // RI-003 (pre-build): stage 5 wrote the capsule skeleton (release.json etc.)
  // under framework/releases/<v>/, which framework-manifest TRACKS — so the live
  // manifest is now stale and release-build's own freshness pre-check would refuse
  // (exit 2). Regenerate it first so release-build sees a current manifest.
  const pre = nodeIn(canonical, "scripts/generate-framework-manifest.js", []);
  if (!pre.ok) {
    return receipt(
      6,
      false,
      `pre-build framework-manifest regen failed (exit ${pre.status})`,
      canonical,
      "Run in canonical: node scripts/generate-framework-manifest.js; then --resume-from 6",
      { stderr: (pre.stderr || "").slice(0, 300) },
    );
  }
  const r = nodeIn(canonical, "scripts/mc/release-build.js", [next]);
  if (!r.ok) {
    return receipt(
      6,
      false,
      `release-build.js failed (exit ${r.status})`,
      canonical,
      "Inspect stderr; common cause: missing migration files or stale framework-manifest. Fix + --resume-from 6",
      { stderr: r.stderr.slice(0, 500), stdout: r.stdout.slice(0, 500) },
    );
  }
  // RI-003: the capsule just written lives under framework/releases/<v>/, which
  // the live framework-manifest TRACKS — so building it leaves framework-manifest,
  // the installed snapshot, and the _mc ownership manifest stale, and the
  // stage-7 gates hard-fail (BC-02 / BC-05 / framework_manifest). Regenerate all
  // three NOW, in dependency order, so the tree the gates inspect is self-consistent.
  // Order matters: _mc tracks framework-manifest + installed; framework-manifest
  // tracks installed + the capsule (NOT _mc). installed's content changes after
  // the first fm regen (fm tracks it), so fm is regenerated a second time to record
  // the settled installed snapshot before _mc is built last. We DO NOT re-run
  // release-build — that would re-snapshot fm into the capsule and re-stale it
  // (capsule self-reference loop).
  const regenSteps = [
    ["scripts/generate-framework-manifest.js", []],
    ["scripts/mc/snapshot-installed.js", []],
    ["scripts/generate-framework-manifest.js", []],
    ["scripts/mc/manifest/build.js", ["--mc-version", next]],
  ];
  for (const [script, sargs] of regenSteps) {
    const rr = nodeIn(canonical, script, sargs);
    if (!rr.ok) {
      return receipt(
        6,
        false,
        `post-capsule manifest regen failed: ${script} (exit ${rr.status})`,
        canonical,
        `Run in canonical: node ${script} ${sargs.join(" ")}; then re-run --resume-from 6`,
        { stderr: (rr.stderr || "").slice(0, 400) },
      );
    }
  }
  return receipt(
    6,
    true,
    `Built capsule ${next} + regenerated framework-manifest / installed / _mc to record it (RI-003)`,
    path.join(canonical, "framework", "releases", next),
    `git -C ${canonical} checkout HEAD -- framework/releases/${next} .claude/framework-manifest.json .claude/framework-installed.json _mc/MANIFEST.json`,
  );
}

// ── stage 7: gates ────────────────────────────────────────
function stageGates(opts, canonical) {
  // Gates are read-only; safe to run in dry-run too.
  const r = nodeIn(canonical, "scripts/mc/release-gates.js", ["--json"]);
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    /* keep raw */
  }
  // Exit code: 0=green, 1=yellow, 2=red. We block on red only.
  if (r.status === 2) {
    return receipt(
      7,
      false,
      `Release gates: ${parsed ? parsed.red : "?"} red, ${parsed ? parsed.yellow : "?"} yellow — RED blocks release`,
      canonical,
      "Inspect: node scripts/mc/release-gates.js (in canonical). Fix RED gates, then --resume-from 7",
      { gates: parsed, stdout: r.stdout.slice(0, 500) },
    );
  }
  return receipt(
    7,
    true,
    `Release gates: ${parsed ? parsed.green : "?"} green, ${parsed ? parsed.yellow : "?"} yellow, ${parsed ? parsed.red : 0} red, ${parsed ? parsed.manual || 0 : "?"} manual`,
    canonical,
    "n/a — read-only check",
    { gates: parsed },
  );
}

// ── stage 8: build the release commit (plumbing; main untouched) ──────────
// SP-20260721-001 D-4 INC-1 ceremony step 1: this stage NEVER moves refs/heads/main and never runs a
// porcelain commit — every git object is built with plumbing (write-tree + commit-tree) on top of
// canonical's CURRENT tip, and the resulting object is only reachable through the release/<v> branch
// pointer (set with `branch -f`, a non-default-branch ref move the Seam E fence does not gate — the fence
// protects main; see the ALLOWLIST/recognizer notes in main-write-broker-completeness.js). The commit is
// landed onto main only in stage 9, through the brokered transport.
function stageCommit(opts, canonical, next) {
  if (!opts.apply) {
    return receipt(
      8,
      true,
      `[dry-run] Would build a release commit on top of canonical's current tip and point release/${next} at it (plumbing; main untouched)`,
      canonical,
      "n/a — dry-run",
    );
  }
  // Pre-flight: there should be SOME staged or unstaged changes (otherwise nothing to commit).
  const status = gitC(canonical, ["status", "--porcelain"]);
  if (!status.ok) {
    return receipt(
      8,
      false,
      `git status failed: ${status.stderr.slice(0, 200)}`,
      canonical,
      "Make sure canonical is a git repo with committable HEAD",
    );
  }
  if (!status.stdout.trim()) {
    return receipt(
      8,
      false,
      "Nothing to commit in canonical — earlier stages may have produced no diff",
      canonical,
      "Verify stages 3-6 actually ran and produced diff; --resume-from 3 to redo",
    );
  }
  // Guard the assumption stage 9 relies on: the release commit's parent is canonical's CURRENT tip, which
  // stage 9 will land onto main as a real 2-parent merge. This script never switches canonical's checkout,
  // so canonical must already BE on main when a release starts.
  const onBranch = gitC(canonical, ["symbolic-ref", "-q", "HEAD"]);
  if (!onBranch.ok || onBranch.stdout.trim() !== "refs/heads/main") {
    return receipt(
      8,
      false,
      `canonical must be checked out on main to start a release (found ${onBranch.stdout.trim() || "detached HEAD"})`,
      canonical,
      "Check canonical out onto main (resolve any in-progress git state first), then --resume-from 8",
    );
  }
  const parentRes = gitC(canonical, ["rev-parse", "HEAD"]);
  if (!parentRes.ok || !/^[0-9a-f]{40}$/i.test(parentRes.stdout.trim())) {
    return receipt(8, false, `git rev-parse HEAD failed: ${(parentRes.stderr || parentRes.stdout).slice(0, 200)}`, canonical, "Verify canonical HEAD is resolvable; --resume-from 8");
  }
  const parentSha = parentRes.stdout.trim();

  // Stage exactly what the stage-7 gates verified on the working tree. The
  // 2026-05-30 fix grew an explicit allowlist (version.json, manifests, paths,
  // install.ps1, RELEASES.md, capsule), but ANY allowlist silently DROPS gate-fix
  // edits to files it does not name — e.g. framework/hooks.registry.json,
  // .claude/settings.json, framework/paths.registry.json, scripts/hooks/*.generated.js,
  // PATH_KEYS.md — re-introducing the exact false-green it was meant to kill (gates
  // pass because of fixes that never make it into the commit). Stage ALL tracked
  // modifications (`git add -u`) so the commit IS the verified tree, plus the new
  // (untracked) capsule dir. `-u` never sweeps untracked transient scratch
  // (runtime/notes/*, consult logs), so the release commit stays clean. The
  // operator's release hygiene is to enter the release with a tree whose only
  // tracked changes are release-relevant — which the gates already assume.
  const addTracked = gitC(canonical, ["add", "-u"]);
  if (!addTracked.ok) {
    return receipt(
      8,
      false,
      `git add -u failed: ${addTracked.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} reset && --resume-from 8`,
    );
  }
  const add = gitC(canonical, ["add", `framework/releases/${next}`]);
  if (!add.ok) {
    return receipt(
      8,
      false,
      `git add (capsule) failed: ${add.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} reset && --resume-from 8`,
    );
  }

  // Build the tree + commit OBJECTS via plumbing — no ref is written by either call.
  const treeRes = gitC(canonical, ["write-tree"]);
  if (!treeRes.ok || !/^[0-9a-f]{40}$/i.test(treeRes.stdout.trim())) {
    return receipt(
      8,
      false,
      `git write-tree failed: ${(treeRes.stderr || treeRes.stdout).slice(0, 200)}`,
      canonical,
      `git -C ${canonical} reset && --resume-from 8`,
    );
  }
  const treeSha = treeRes.stdout.trim();
  const branch = `release/${next}`;
  const ctRes = gitC(canonical, [
    "commit-tree",
    treeSha,
    "-p",
    parentSha,
    "-m",
    `release(mc): ${next} — built by scripts/mc/release-canonical.js`,
  ]);
  if (!ctRes.ok || !/^[0-9a-f]{40}$/i.test(ctRes.stdout.trim())) {
    return receipt(
      8,
      false,
      `git commit-tree failed: ${(ctRes.stderr || ctRes.stdout).slice(0, 200)}`,
      canonical,
      `git -C ${canonical} reset && --resume-from 8`,
    );
  }
  const releaseCommit = ctRes.stdout.trim();

  // Point release/<v> at the built object. `branch -f` moves a NON-main local ref directly, without a
  // checkout — main's tip (parentSha) is untouched by this call.
  const branchRes = gitC(canonical, ["branch", "-f", branch, releaseCommit]);
  if (!branchRes.ok) {
    return receipt(
      8,
      false,
      `git branch -f ${branch} failed: ${branchRes.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} reset && --resume-from 8`,
    );
  }

  // The staged diff is now safely reachable ONLY from release/<v> (main's tip did not move). Discard the
  // staged/working diff so canonical's checkout is clean going into stage 9 — required for the pre-flip
  // fallback route's plain merge to succeed; harmless for the brokered route, which materializes its own
  // detached worktree and never reads canonical's working tree at all.
  // 7G-001: `git reset --hard` is a probe-verified protected-ref write surface (it emits a
  // reference-transaction even when the target sha equals the current HEAD) — REFUSED post-flip on a
  // checked-out main. The intent here is WORKING-TREE-ONLY (HEAD/refs/heads/main never moved in this
  // stage — only release/<v> did), so `git restore --staged --worktree -- .` gives the identical
  // index+worktree-back-to-HEAD result (including dropping the newly-staged capsule dir, which HEAD does
  // not have) without writing to any ref at all.
  const cleanRes = gitC(canonical, ["restore", "--staged", "--worktree", "--", "."]);
  if (!cleanRes.ok) {
    return receipt(
      8,
      false,
      `post-build working-tree restore failed: ${cleanRes.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} status; manually reconcile; --resume-from 8`,
    );
  }

  return receipt(
    8,
    true,
    `Built release commit ${releaseCommit.slice(0, 8)} (parent ${parentSha.slice(0, 8)}) and pointed ${branch} at it — main untouched, landed via the broker in stage 9`,
    canonical,
    `git -C ${canonical} branch -D ${branch} (the commit is otherwise unreferenced and will be garbage-collected; main was never touched)`,
    { branch, releaseCommit, parentSha },
  );
}

/**
 * brokerFastForwardMain(gitRoot, newHead, opts) — 7G-002. Mirrors broker-merge.js's brokerMerge()/finish()
 * shape (lease -> bundle -> broker -> CAS -> classify+fallback), but for a GENERIC fast-forward of
 * refs/heads/main onto an ALREADY-EXISTING commit (origin/main's tip) — no new commit object to build. This
 * is deliberately `fencedRefUpdate` rather than `integrateReleaseCommit`: the latter requires a SINGLE-parent
 * commit whose immediate parent is the live head (a one-commit-ahead shape only), whereas an origin catch-up
 * may be N commits ahead — `fencedRefUpdate`'s ancestry check (isAncestor(liveHead, newHead)) is correct for
 * either. Pre-flip (no promoted bundle) this falls back to a plain CAS ref-update (the ordinary route in
 * broker-dogfood.js#ordinaryLand), LOGGED + COUNTED + SURFACED exactly like the other D-4 INC-1 dogfood
 * routes; post-flip the fallback route is itself refused by the Seam E hook (by design — the escape hatch
 * only ever worked pre-flip).
 */
function brokerFastForwardMain(gitRoot, newHead, opts) {
  const targetRef = "refs/heads/main";
  const spId = opts.spId || mcEnv.readEnv("SP_ID") || null;
  const held = dog.ensureLease(spId, opts.leaseRoot);
  if (!held.ok) {
    return brokerSyncFinish(
      { reason: "lease-not-held", detail: `conductor lease unavailable for ${spId || "(no --sp-id)"}: ${held.state}` },
      { gitRoot, targetRef, newHead, opts },
    );
  }
  try {
    const bundle = dog.resolveBundleConfig(opts);
    if (!bundle.ok) return brokerSyncFinish({ reason: bundle.reason, detail: bundle.detail }, { gitRoot, targetRef, newHead, opts });
    const loaded = dog.loadBroker();
    if (!loaded.ok) return brokerSyncFinish({ reason: loaded.reason, detail: loaded.detail }, { gitRoot, targetRef, newHead, opts });

    let res;
    try {
      res = loaded.broker.fencedRefUpdate(newHead, targetRef, {
        bundleManifestPath: bundle.bundleManifestPath,
        bundleRoot: bundle.bundleRoot,
        spId,
        leaseRoot: opts.leaseRoot,
        gitRoot,
      });
    } catch (e) {
      res = { ok: false, decision: "BLOCKED", reason: "broker-threw", detail: e.message };
    }
    if (res && res.ok === true) {
      return {
        ok: true,
        route: "brokered",
        decision: res.decision,
        transport: "main-sync-ff",
        target_ref: targetRef,
        new_head: newHead,
        receipt: res.receipt,
        lease: held.state,
      };
    }
    return brokerSyncFinish(res || { reason: "broker-threw", detail: "no result" }, { gitRoot, targetRef, newHead, opts });
  } finally {
    const rel = held.release();
    if (rel && rel.ok === false) {
      process.stderr.write(`  ⓘ lease cleanup did not confirm for ${spId || "(sprint)"} — see the orphan warning above.\n`);
    }
  }
}

/** brokerSyncFinish(refusal, ctx) — the ONE fallback gate for brokerFastForwardMain (mirrors
 *  broker-merge.js#finish, scoped to the plain CAS ref-update fallback route — never a merge). */
function brokerSyncFinish(refusal, ctx) {
  const reason = refusal.reason || "broker-threw";
  const classification = dog.classifyRefusal(reason);
  const expected = gitC(ctx.gitRoot, ["rev-parse", ctx.targetRef]);

  // 2nd-review blocker (anchor-pinning, β R1 class one level down): the ancestry (local main ⊂ origin/main)
  // was validated in syncMainFromOrigin BEFORE the broker refusal. This fallback re-resolves main's CURRENT
  // head as the CAS expectedHead — but a race could have moved main to a NON-ancestor of newHead (origin) in
  // between, which would make the "fast-forward" a REWIND (data loss). Re-validate that the freshly-resolved
  // head is STILL a strict ancestor of newHead before adopting it for the CAS; refuse the rewind otherwise.
  if (expected.ok) {
    const stillAncestor = gitC(ctx.gitRoot, ["merge-base", "--is-ancestor", expected.stdout.trim(), ctx.newHead]);
    if (!stillAncestor.ok) {
      const detail = `local main advanced to a NON-ancestor of the sync target between validation and CAS (main ${expected.stdout.trim().slice(0, 8)} ⊄ ${String(ctx.newHead).slice(0, 8)}) — refusing (a fast-forward here would be a rewind)`;
      process.stderr.write(`${dog.refusalBanner("main-sync-ff", "sync-head-moved-non-ancestor", classification, detail)}\n`);
      return { ok: false, decision: "BLOCKED", reason: "sync-head-moved-non-ancestor", detail };
    }
  }

  const fb = dog.attemptFallback({
    reason,
    detail: refusal.detail || null,
    transport: "main-sync-ff",
    targetRef: ctx.targetRef,
    gitRoot: ctx.gitRoot,
    newHead: ctx.newHead,
    expectedHead: expected.ok ? expected.stdout.trim() : null,
    eventsPath: dog.resolveEventsPath(),
    allowFallback: !ctx.opts.noBrokerFallback,
    dryRun: false,
    emit: true,
    actor: "release-canonical-sync",
  });

  if (fb.refused) {
    process.stderr.write(`${dog.refusalBanner("main-sync-ff", reason, fb.classification || classification, refusal.detail)}\n`);
    return {
      ok: false,
      route: "none",
      decision: "BLOCKED",
      transport: "main-sync-ff",
      reason,
      classification: fb.classification || classification,
      detail: refusal.detail || null,
      fallback_refused: fb.reason || null,
    };
  }

  return {
    ok: fb.ok,
    route: fb.route,
    decision: fb.route === "dry-run" ? "DRY-RUN-WOULD-FALL-BACK" : fb.ok ? "LANDED-BY-FALLBACK" : "FALLBACK-FAILED",
    transport: "main-sync-ff",
    broker_reason: reason,
    classification,
    fallback_record: fb.record,
    fallback_count: fb.count,
    reason: fb.reason,
    detail: fb.detail,
  };
}

/**
 * syncMainFromOrigin(opts, canonical) -> {ok, synced, detail?, brokerResult?} — 7G-002. Replaces the
 * un-brokered `git pull --ff-only origin main`. `git fetch origin main` only ever moves
 * refs/remotes/origin/main (never a protected-ref write — safe pre- and post-flip). If local main turns out
 * to be BEHIND the fetched origin/main, advancing refs/heads/main to catch up IS a main-write, so that
 * advance — and ONLY that advance — is routed through brokerFastForwardMain(). Diverged histories still
 * REFUSE outright (the same safety `pull --ff-only` gave); local-ahead/up-to-date is a no-op.
 */
function syncMainFromOrigin(opts, canonical) {
  const fetch = gitC(canonical, ["fetch", "origin", "main"]);
  if (!fetch.ok) return { ok: false, detail: `git fetch origin main failed: ${fetch.stderr.slice(0, 200)}` };

  const localRes = gitC(canonical, ["rev-parse", "refs/heads/main"]);
  const originRes = gitC(canonical, ["rev-parse", "refs/remotes/origin/main"]);
  if (!localRes.ok || !originRes.ok) {
    return { ok: false, detail: `resolving local/origin main failed: ${(localRes.stderr || originRes.stderr || "").slice(0, 200)}` };
  }
  const local = localRes.stdout.trim();
  const origin = originRes.stdout.trim();
  if (local === origin) return { ok: true, synced: false };

  // Local is already at/ahead of origin — nothing to sync (same no-op `pull --ff-only` would report).
  if (gitC(canonical, ["merge-base", "--is-ancestor", origin, local]).ok) {
    return { ok: true, synced: false };
  }
  // Neither is an ancestor of the other — diverged. Refuse rather than silently reconcile.
  if (!gitC(canonical, ["merge-base", "--is-ancestor", local, origin]).ok) {
    return { ok: false, detail: "local main and origin/main have DIVERGED — fast-forward-only sync refuses; reconcile (rebase/merge upstream) manually" };
  }

  // Local main is a strict ancestor of origin/main: the catch-up ff is a main-write. Route it through the broker.
  const res = brokerFastForwardMain(canonical, origin, opts);
  if (!res.ok) {
    return {
      ok: false,
      detail: `brokered sync ff to origin/main failed: ${res.reason || "unknown"}${res.detail ? ` (${String(res.detail).slice(0, 200)})` : ""}`,
      brokerResult: res,
    };
  }
  return { ok: true, synced: true, brokerResult: res };
}

// ── stage 9: land release/<v> onto main (brokered) + push ─────────────────
// SP-20260721-001 D-4 INC-1 ceremony step 1: every main-write in this file happens exclusively inside the
// broker's fenced compare-and-swap. The pre-land sync (syncMainFromOrigin, above) brokers a catch-up
// fast-forward through fencedRefUpdate when local main is behind origin; the land itself uses
// broker-merge.js's brokerMerge(), which builds a real 2-parent merge object with plumbing (merge-tree
// --write-tree + commit-tree — no ref is written by the build) with canonical's re-resolved LIVE main tip as
// first parent and release/<v>'s tip as second parent, then calls the broker's integrateBranchMerge
// ({merge_commit, target_ref}) entrypoint, which re-resolves main's live head itself and performs the one
// fenced ref move. Called UNCONDITIONALLY — pre-flip (no pinned bundle promoted yet) it falls back to the
// ordinary route, LOGGED + COUNTED + SURFACED in the dogfood ledger (scripts/dispatch/broker-dogfood.js);
// post-flip the same call runs the real pinned check suite over the materialized merge result. Never gated
// on whether the Seam E hook is installed.
function stageMergeAndPush(opts, canonical, next, branch) {
  if (!opts.apply) {
    return receipt(
      9,
      true,
      `[dry-run] Would land release/${next} onto main through the brokered transport (integrateBranchMerge) and push origin main`,
      canonical,
      "n/a — dry-run",
    );
  }
  // Sync local main with origin BEFORE landing, fast-forward-only (refuses rather than silently diverging).
  // 7G-002: `git pull --ff-only origin main` fast-forwards the CHECKED-OUT branch directly — an un-brokered
  // refs/heads/main write, REFUSED post-flip. syncMainFromOrigin() fetches (never a protected-ref write) and
  // routes any necessary catch-up ff through the broker.
  const sync = syncMainFromOrigin(opts, canonical);
  if (!sync.ok) {
    return receipt(
      9,
      false,
      `syncing local main from origin (fast-forward only) failed: ${sync.detail || "unknown"}`,
      canonical,
      "Reconcile canonical main with origin (rebase/merge upstream first); --resume-from 9",
      sync.brokerResult ? { brokerResult: sync.brokerResult } : {},
    );
  }

  // 2nd-review blocker: a brokered sync ff moves refs/heads/main via the fenced CAS but NEVER the
  // checked-out index/worktree (they stay at the pre-sync main). brokerMerge()'s ordinary-merge FALLBACK
  // (pre-flip / post-refusal) merges against the WORKING TREE, so it MUST see the synced content first, or
  // it merges against a stale tree.
  //
  // r3 blocker (TERMINAL): this refresh MUST NOT be gated on `sync.synced` (did THIS invocation move
  // main). A prior invocation can move main via the fenced CAS and then crash — or have its restore fail —
  // BEFORE the refresh completes; on `--resume-from 9` the sync sees local===origin, returns synced:false,
  // and a gated refresh would be skipped, leaving brokerMerge to merge against the stale pre-sync tree.
  // Because the refresh is working-tree-only (restore --source=main, no ref write) it is safe to run
  // UNCONDITIONALLY: a no-op when the tree already matches main, and it recovers the crashed-before-refresh
  // case regardless of which invocation moved the ref. Same working-tree-only shape as the post-land
  // refresh below.
  const syncRefresh = gitC(canonical, ["restore", "--source=main", "--staged", "--worktree", "--", "."]);
  if (!syncRefresh.ok) {
    return receipt(
      9,
      false,
      `refreshing the pre-land working tree up to local main failed: ${syncRefresh.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} restore --source=main --staged --worktree -- .`,
      sync.brokerResult ? { brokerResult: sync.brokerResult } : {},
    );
  }

  // 7G-004: idempotent resume. `--resume-from 9` after a land-succeeded-but-push-failed run re-enters this
  // stage; brokerMerge() itself already refuses an already-landed branch as `already-merged` (a USAGE
  // refusal — see broker-merge.js), which would otherwise regress the documented recovery. Detect that
  // SUCCESS case up front and skip straight to the (idempotent) push.
  let res;
  const alreadyLanded = gitC(canonical, ["merge-base", "--is-ancestor", branch, "refs/heads/main"]);
  if (alreadyLanded.ok) {
    res = { ok: true, route: "already-landed", decision: "ALREADY-LANDED", branch, target_ref: "refs/heads/main" };
  } else {
    res = brokerMerge(
      { branch, target_ref: "refs/heads/main" },
      {
        gitRoot: canonical,
        spId: opts.spId,
        leaseRoot: opts.leaseRoot,
        bundleManifestPath: opts.bundleManifestPath,
        bundleRoot: opts.bundleRoot,
        allowFallback: !opts.noBrokerFallback,
        actor: "release-canonical",
        emit: true,
      },
      {},
    );
  }

  if (!res.ok) {
    return receipt(
      9,
      false,
      `landing release/${next} onto main failed: ${res.reason || "unknown"}${res.detail ? ` (${String(res.detail).slice(0, 200)})` : ""}`,
      canonical,
      "Inspect the refusal above (security/usage refusals never fall back); resolve, then --resume-from 9",
      { brokerResult: res },
    );
  }

  // The ref moved; refresh the checkout if it was pointing at the branch that just moved underneath it
  // (broker-merge.js's `worktree_refresh_required` — the CAS moves the ref, never the working tree).
  // 7G-001: the refresh's INTENT is working-tree-only (main's ref already moved via the broker's fenced
  // CAS — refreshing it AGAIN with `reset --hard main` would be a second, un-brokered, REFUSED-post-flip
  // write to the very ref this stage just landed through the broker). `git restore --source=main --staged
  // --worktree -- .` pulls the index+worktree up to main's new content without touching any ref.
  if (res.worktree_refresh_required) {
    const refresh = gitC(canonical, ["restore", "--source=main", "--staged", "--worktree", "--", "."]);
    if (!refresh.ok) {
      return receipt(
        9,
        false,
        `landed release/${next} → main (${res.route}) but the post-land working-tree refresh failed: ${refresh.stderr.slice(0, 200)}`,
        canonical,
        `git -C ${canonical} restore --source=main --staged --worktree -- .`,
        { brokerResult: res },
      );
    }
  }

  const push = gitC(canonical, ["push", "origin", "main"]);
  if (!push.ok) {
    return receipt(
      9,
      false,
      `push origin main failed: ${push.stderr.slice(0, 200)}`,
      canonical,
      "Authenticate or reconcile; --resume-from 9 (merge already landed; only push pending)",
      { brokerResult: res },
    );
  }
  return receipt(
    9,
    true,
    `Landed ${branch} → main via ${res.route} (${res.decision}) and pushed origin main`,
    canonical,
    `git -C ${canonical} reset --hard origin/main~1 + git -C ${canonical} push --force-with-lease origin main (DESTRUCTIVE — only if not yet consumed downstream)`,
    { brokerResult: res },
  );
}

// ── stage 10: tag + push ──────────────────────────────────
function stageTag(opts, canonical, next) {
  if (opts.noTag) {
    return receipt(10, true, "Tag skipped (--no-tag)", canonical, "n/a", {
      skipped: true,
    });
  }
  if (!opts.apply) {
    return receipt(
      10,
      true,
      `[dry-run] Would tag mc@${next} and push to origin`,
      canonical,
      "n/a — dry-run",
    );
  }
  const tag = gitC(canonical, ["tag", `mc@${next}`]);
  if (!tag.ok) {
    return receipt(
      10,
      false,
      `git tag failed: ${tag.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} tag -d mc@${next}; --resume-from 10`,
    );
  }
  const push = gitC(canonical, ["push", "origin", `mc@${next}`]);
  if (!push.ok) {
    return receipt(
      10,
      false,
      `Tag push failed: ${push.stderr.slice(0, 200)}`,
      canonical,
      `git -C ${canonical} push origin :refs/tags/mc@${next} to remove remote tag if partial`,
    );
  }
  return receipt(
    10,
    true,
    `Tagged mc@${next} and pushed to origin`,
    canonical,
    `git -C ${canonical} push origin :refs/tags/mc@${next} && git -C ${canonical} tag -d mc@${next}`,
  );
}

// ── orchestrator ──────────────────────────────────────────

async function run(opts) {
  const receipts = [];
  let canonical = null;
  let current = null;
  let next = null;
  let branch = null;

  function shouldRun(stage) {
    return stage >= opts.resumeFrom;
  }

  // Stage 0
  if (shouldRun(0)) {
    const r0 = stageLocate(opts);
    receipts.push(r0);
    if (!r0.ok) return finalize(receipts, opts);
    canonical = r0.canonical;
  } else {
    canonical = locateCanonical(opts.canonical);
    if (!canonical) {
      receipts.push(
        receipt(
          0,
          false,
          "Cannot resume without locating canonical",
          null,
          "Re-run without --resume-from",
        ),
      );
      return finalize(receipts, opts);
    }
  }

  // Stage 1
  if (shouldRun(1)) {
    const r1 = stagePromote(opts, canonical);
    receipts.push(r1);
    if (!r1.ok) return finalize(receipts, opts);
  }

  // Stage 2
  if (shouldRun(2)) {
    const r2 = stageComputeVersion(opts, canonical);
    receipts.push(r2);
    if (!r2.ok) return finalize(receipts, opts);
    current = r2.current;
    next = r2.next;
  } else {
    // Re-derive for downstream stages
    current = readJson(path.join(canonical, "version.json")).version;
    if (/^\d+\.\d+\.\d+$/.test(opts.version)) next = opts.version;
    else
      throw new Error(
        "--resume-from past stage 2 requires explicit --version <x.y.z>",
      );
  }

  // Stage 3
  if (shouldRun(3)) {
    const r3 = stageBumpVersion(opts, canonical, current, next);
    receipts.push(r3);
    if (!r3.ok) return finalize(receipts, opts);
  }

  // Stage 4
  if (shouldRun(4)) {
    const r4 = stageRegenManifest(opts, canonical);
    receipts.push(r4);
    if (!r4.ok) return finalize(receipts, opts);
  }

  // Stage 5
  if (shouldRun(5)) {
    const r5 = stageCreateSkeleton(opts, canonical, current, next);
    receipts.push(r5);
    if (!r5.ok) return finalize(receipts, opts);
  }

  // Stage 6
  if (shouldRun(6)) {
    const r6 = stageBuildCapsule(opts, canonical, next);
    receipts.push(r6);
    if (!r6.ok) return finalize(receipts, opts);
  }

  // Stage 7
  if (shouldRun(7)) {
    const r7 = stageGates(opts, canonical);
    receipts.push(r7);
    if (!r7.ok) return finalize(receipts, opts);
  }

  // Stage 8
  branch = `release/${next}`;
  if (shouldRun(8)) {
    const r8 = stageCommit(opts, canonical, next);
    receipts.push(r8);
    if (!r8.ok) return finalize(receipts, opts);
    if (r8.branch) branch = r8.branch;
  }

  // Stage 9
  if (shouldRun(9)) {
    const r9 = stageMergeAndPush(opts, canonical, next, branch);
    receipts.push(r9);
    if (!r9.ok) return finalize(receipts, opts);
  }

  // Stage 10
  if (shouldRun(10)) {
    const r10 = stageTag(opts, canonical, next);
    receipts.push(r10);
    if (!r10.ok) return finalize(receipts, opts);
  }

  return finalize(receipts, opts, { canonical, current, next, branch });
}

function finalize(receipts, opts, ctx) {
  const allOk = receipts.every((r) => r.ok);
  return {
    ok: allOk,
    mode: opts.apply ? "apply" : "dry-run",
    receipts,
    ...(ctx || {}),
  };
}

// ── CLI ───────────────────────────────────────────────────

function printText(result) {
  console.log(
    `\nrelease-canonical — ${result.mode} — ${result.ok ? "OK" : "FAILED"}\n`,
  );
  for (const r of result.receipts) {
    const tag = r.ok ? "ok " : "FAIL";
    const skipped = r.skipped ? " (skipped)" : "";
    console.log(`  [${tag}] stage ${r.stage} ${r.name}${skipped}`);
    console.log(`         ${r.what}`);
    if (r.where) console.log(`         where: ${r.where}`);
    if (!r.ok && r.rollback) console.log(`         rollback: ${r.rollback}`);
  }
  if (!result.ok) {
    const failed = result.receipts.find((r) => !r.ok);
    console.log(`\nResume after fixing: --resume-from ${failed.stage} --apply`);
  } else if (result.mode === "dry-run") {
    console.log(`\nDry-run complete. Re-run with --apply to execute.`);
  } else {
    console.log(
      `\nReleased ${result.current} → ${result.next}. Canonical: ${result.canonical}`,
    );
  }
  console.log("");
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  run(opts)
    .then((r) => {
      if (opts.json) console.log(JSON.stringify(r, null, 2));
      else printText(r);
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(`release-canonical: ${e.message}`);
      process.exit(2);
    });
}

module.exports = { run, locateCanonical, bumpVersion };
