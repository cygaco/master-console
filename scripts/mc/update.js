
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { printHumanReport } = require("./report-format");
const migrationsLoader = require("./migrations-loader");
const preflightModule = require("./preflight");
const transactionModule = require("./transaction");
const postflightModule = require("./postflight");
const cHash = require("./lib/content-hash");
const updateEvents = require("./lib/update-events");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const ORPHAN_KEPT_LABEL = "kept (modified by you)";
const ORPHAN_UNVERIFIED_LABEL = "kept (cannot verify it is unmodified)";

const stripBom = (s) => (typeof s === "string" ? s.replace(/^﻿/, "") : s);

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return cHash.contentHash(filePath);
}

function sha256FileLfNormalized(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return cHash.contentHash(filePath, { text: true });
}

const hashMatches = cHash.hashMatches;

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(stripBom(fs.readFileSync(file, "utf8")));
  } catch {
    return fallback;
  }
}

function findRepoRootFromCapsule(capsuleDir) {
  let current = path.resolve(capsuleDir);
  for (let i = 0; i < 6; i++) {
    if (
      fs.existsSync(path.join(current, "version.json")) &&
      fs.existsSync(path.join(current, ".claude")) &&
      fs.existsSync(path.join(current, "framework"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    `Could not resolve MC repo root from capsule: ${capsuleDir}`,
  );
}

function discoverCanonical(targetRoot, version) {
  const tries = [];
  tries.push(path.resolve(targetRoot, "..", "master-console"));
  tries.push(path.resolve(targetRoot, "..", "MC"));
  tries.push(path.resolve(targetRoot, "..", "mc"));
  try {
    const manifestPath = path.join(targetRoot, ".claude", "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(stripBom(fs.readFileSync(manifestPath, "utf8")));
      const src = m && m.mc && m.mc.source;
      if (src && !/^https?:\/\//.test(src)) tries.push(path.resolve(src));
    }
  } catch {
  }
  try {
    const fi = path.join(targetRoot, ".claude", "framework-installed.json");
    if (fs.existsSync(fi)) {
      const j = JSON.parse(stripBom(fs.readFileSync(fi, "utf8")));
      if (j && j.source && !/^https?:\/\//.test(j.source)) {
        tries.push(path.resolve(j.source));
      }
    }
  } catch {
  }
  for (const candidate of tries) {
    if (!fs.existsSync(candidate)) continue;
    if (!fs.existsSync(path.join(candidate, "version.json"))) continue;
    if (!fs.existsSync(path.join(candidate, "framework"))) continue;
    const capsule = path.join(
      candidate,
      "framework",
      "releases",
      version,
      "release.json",
    );
    if (fs.existsSync(capsule)) return candidate;
  }
  return null;
}

function loadCapsule(sourceRoot, version) {
  const capsuleDir = path.join(sourceRoot, "framework", "releases", version);
  const releaseFile = path.join(capsuleDir, "release.json");
  const manifestFile = path.join(capsuleDir, "framework-manifest.json");
  const checksumsFile = path.join(capsuleDir, "checksums.json");
  if (!fs.existsSync(releaseFile)) {
    throw new Error(
      `Capsule ${version} missing release.json at ${releaseFile}`,
    );
  }
  if (!fs.existsSync(manifestFile)) {
    throw new Error(
      `Capsule ${version} missing framework-manifest.json snapshot`,
    );
  }
  if (fs.existsSync(checksumsFile)) {
    const checksums = JSON.parse(stripBom(fs.readFileSync(checksumsFile, "utf8")));
    const drift = [];
    for (const [file, expected] of Object.entries(checksums.entries || {})) {
      const abs = path.resolve(capsuleDir, file);
      if (!fs.existsSync(abs)) continue;
      const actual = sha256File(abs);
      if (actual !== expected) {
        drift.push({
          file,
          expected: expected.slice(0, 8),
          actual: (actual || "").slice(0, 8),
        });
      }
    }
    if (drift.length > 0) {
      throw new Error(
        `Capsule ${version} checksum drift detected (${drift.length} file(s)): ${drift
          .slice(0, 3)
          .map((d) => `${d.file}:${d.expected}≠${d.actual}`)
          .join(
            "; ",
          )}. Refuse to trust. Re-run scripts/mc/release-build.js ${version}`,
      );
    }
  } else {
    process.stderr.write(
      `[update] WARN: capsule ${version} missing checksums.json — proceeding without integrity check\n`,
    );
  }
  return {
    dir: capsuleDir,
    release: JSON.parse(stripBom(fs.readFileSync(releaseFile, "utf8"))),
    manifest: JSON.parse(stripBom(fs.readFileSync(manifestFile, "utf8"))),
  };
}

function flattenAssets(manifest) {
  const out = new Map();
  for (const kind of Object.keys(manifest.assets || {})) {
    for (const a of manifest.assets[kind]) {
      out.set(a.dest, { ...a, kind });
    }
  }
  return out;
}

function classify(installed, capsule, targetRoot) {
  const targetAssets = flattenAssets(capsule.manifest);
  const installedAssets =
    installed && installed.assets
      ? new Map((installed.assets || []).map((a) => [a.dest, a]))
      : new Map();

  const decisions = [];
  const root = targetRoot || REPO_ROOT;

  for (const [dest, asset] of targetAssets) {
    const localPath = path.join(root, dest);
    const installedRecord = installedAssets.get(dest);
    const localExists = fs.existsSync(localPath);
    const localSha = localExists ? sha256File(localPath) : null;
    const targetSha = asset.sha256 || null;

    let category = "UNKNOWN";
    let reason = "";

    if (asset.owner === "framework_template" && localExists) {
      const matches = hashMatches(localSha, targetSha);
      if (!matches) {
        updateEvents.emitOwnershipTransitioned(root, {
          txId: null,
          file: dest,
          from: "framework_template",
          to: "project_owned",
          reason: "consumer_edit_detected",
        });
        category = "LOCAL_CUSTOMIZED";
        reason =
          "owner=framework_template promoted to project_owned (consumer non-whitespace edit detected); leave as-is.";
        decisions.push({
          id: asset.id,
          dest,
          kind: asset.kind,
          owner: "project_owned",
          previousOwner: "framework_template",
          category,
          reason,
        });
        continue;
      }
    }

    if (asset.owner === "generated") {
      category = "GENERATED_REBUILD";
      reason = "Owner=generated; will be regenerated by post-update gate.";
    } else if (!localExists && !installedRecord) {
      category = "ADD_SAFE";
      reason = "New asset, not present locally and not previously installed.";
    } else if (!localExists && installedRecord) {
      category = "DELETE_CONFLICT";
      reason =
        "Was installed but file is missing — possible local delete; do not silently re-add.";
    } else if (localExists && !installedRecord) {
      category = "LOCAL_ONLY";
      reason = "Local file exists outside framework; will not be touched.";
    } else if (hashMatches(localSha, targetSha)) {
      category = "UPDATE_SAFE";
      reason = "Already at target version (sha matches).";
    } else if (
      targetSha &&
      hashMatches(sha256FileLfNormalized(localPath), targetSha)
    ) {
      category = "UPDATE_SAFE";
      reason =
        "Already at target version (sha matches under LF normalization).";
      updateEvents.emitContentHashMismatch(root, {
        txId: null,
        file: dest,
        contentHashLocal: localSha,
        rawHashLocal: cHash.rawHash(localPath),
        expectedHash: targetSha,
        kind: "lf_only",
      });
    } else if (
      installedRecord &&
      hashMatches(localSha, installedRecord.installedHash)
    ) {
      category = "UPDATE_SAFE";
      reason =
        "Local matches the version originally installed → upstream change is safe to apply.";
    } else if (
      installedRecord &&
      installedRecord.installedHash &&
      hashMatches(
        sha256FileLfNormalized(localPath),
        installedRecord.installedHash,
      )
    ) {
      category = "UPDATE_SAFE";
      reason =
        "Local matches installed snapshot under LF normalization → upstream change is safe to apply.";
    } else {
      const mergeStrategy =
        asset.mergeStrategy ||
        installedRecord?.mergeStrategy ||
        "replace_if_unmodified";
      if (mergeStrategy === "regenerate") {
        category = "GENERATED_REBUILD";
        reason =
          "Local customized but file is regenerable — overwriting with regenerated content.";
      } else if (mergeStrategy === "keep_local") {
        category = "LOCAL_CUSTOMIZED";
        reason = "Local customized, mergeStrategy=keep_local — leave as-is.";
      } else {
        category = "MERGE_CONFLICT";
        reason = `Local customized, mergeStrategy=${mergeStrategy} — three-way merge not implemented; requires human review.`;
        if (targetSha) {
          updateEvents.emitContentHashMismatch(root, {
            txId: null,
            file: dest,
            contentHashLocal: localSha,
            rawHashLocal: localExists ? cHash.rawHash(localPath) : null,
            expectedHash: targetSha,
            kind: "real_drift",
          });
        }
      }
    }

    decisions.push({
      id: asset.id,
      dest,
      kind: asset.kind,
      owner: asset.owner || "framework",
      category,
      reason,
    });
  }

  const userModified = new Set(
    installed && Array.isArray(installed.userModified)
      ? installed.userModified
      : [],
  );
  for (const [dest, rec] of installedAssets) {
    if (!targetAssets.has(dest)) {
      const localPath = path.join(root, dest);
      const localExists = fs.existsSync(localPath);
      const localSha = localExists ? sha256File(localPath) : null;
      let category = "DELETE_SAFE";
      let reason =
        "Removed in target version, local matches installed (safe to delete).";
      let keptBecause;
      if (!localExists) {
        category = "DELETE_SAFE";
        reason = "Already gone locally.";
      } else if (!rec.installedHash) {
        category = "ORPHAN_KEPT";
        reason = ORPHAN_UNVERIFIED_LABEL;
        keptBecause = "unverified";
      } else if (
        !cHash.hashMatches(localSha, rec.installedHash) ||
        userModified.has(dest)
      ) {
        if (
          rec.owner === "framework_template" ||
          rec.owner === "project_owned"
        ) {
          category = "ORPHAN_KEPT";
          reason = ORPHAN_KEPT_LABEL;
          keptBecause = "modified";
        } else {
          category = "DELETE_CONFLICT";
          reason =
            "Removed in target but modified locally (differs from the installed snapshot, or recorded as user-modified) — preserve.";
        }
      }
      decisions.push({
        id: rec.id || dest,
        dest,
        kind: rec.kind || "unknown",
        owner: rec.owner || "framework",
        category,
        reason,
        ...(keptBecause ? { keptBecause } : {}),
      });
    }
  }

  return decisions;
}

function summarize(decisions) {
  const counts = {};
  for (const d of decisions) counts[d.category] = (counts[d.category] || 0) + 1;
  return counts;
}

function planClass(decisions) {
  const map = {
    ADD_SAFE: "A",
    UPDATE_SAFE: "A",
    DELETE_SAFE: "A",
    ORPHAN_KEPT: "A",

    GENERATED_REBUILD: "A",
    MERGE_SAFE: "B",
    RENAME_SAFE: "B",
    MIGRATION_REQUIRED: "B",
    LOCAL_ONLY: "A",
    LOCAL_CUSTOMIZED: "A",
    MERGE_CONFLICT: "C",
    DELETE_CONFLICT: "C",
    RENAME_CONFLICT: "C",
  };
  const out = { A: [], B: [], C: [] };
  for (const d of decisions) {
    const cls = map[d.category] || "C";
    out[cls].push(d);
  }
  return out;
}

function backupFile(targetRoot, txDir, relPath) {
  const abs = path.join(targetRoot, relPath);
  if (!fs.existsSync(abs)) return null;
  const dest = path.join(txDir, "backup", relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
  return dest;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function flattenSourceAssets(manifest) {
  const out = new Map();
  for (const kind of Object.keys(manifest.assets || {})) {
    for (const a of manifest.assets[kind]) {
      out.set(a.dest, { ...a, kind });
    }
  }
  return out;
}

function applyUpdateDecisions(
  sourceTreeRoot,
  targetRoot,
  decisions,
  capsuleManifest,
  txDir,
  opts,
) {
  const counts = {
    added: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    deletes_skipped: 0,
    kept_modified: 0,
    kept_unverified: 0,
    merge_conflicts_held: 0,
    skipped_no_op: 0,
    errors: 0,
    backups: 0,
  };
  const errors = [];
  const perFile = [];

  const sourceAssets = flattenSourceAssets(capsuleManifest);

  for (const d of decisions) {
    const dstAbs = path.join(targetRoot, d.dest);
    try {
      switch (d.category) {
        case "ADD_SAFE":
        case "UPDATE_SAFE":
        case "GENERATED_REBUILD": {
          const asset = sourceAssets.get(d.dest);
          if (!asset) {
            counts.errors += 1;
            errors.push({
              dest: d.dest,
              error: "asset not in source manifest",
            });
            perFile.push({ dest: d.dest, status: "error", category: d.category, error: "asset not in source manifest" });
            break;
          }
          const srcAbs = path.join(sourceTreeRoot, asset.src);
          if (!fs.existsSync(srcAbs)) {
            counts.errors += 1;
            errors.push({
              dest: d.dest,
              error: `source missing: ${asset.src}`,
            });
            perFile.push({ dest: d.dest, status: "error", category: d.category, error: `source missing: ${asset.src}` });
            break;
          }
          if (
            d.category === "UPDATE_SAFE" &&
            fs.existsSync(dstAbs) &&
            cHash.contentHash(srcAbs) === cHash.contentHash(dstAbs)
          ) {
            counts.unchanged += 1;
            perFile.push({ dest: d.dest, status: "unchanged", category: d.category });
            break;
          }
          const existedBefore = fs.existsSync(dstAbs);
          if (existedBefore) {
            backupFile(targetRoot, txDir, d.dest);
            counts.backups += 1;
          }
          ensureDir(path.dirname(dstAbs));
          fs.copyFileSync(srcAbs, dstAbs);
          if (d.category === "ADD_SAFE") {
            counts.added += 1;
            perFile.push({ dest: d.dest, status: "added", category: d.category });
          } else {
            counts.updated += 1;
            perFile.push({ dest: d.dest, status: "repaired", category: d.category });
          }
          break;
        }
        case "MERGE_CONFLICT": {
          counts.merge_conflicts_held += 1;
          perFile.push({ dest: d.dest, status: "conflict", category: d.category, reason: d.reason || "" });
          break;
        }
        case "DELETE_SAFE": {
          if (!opts.confirmDeletes) {
            counts.deletes_skipped += 1;
            perFile.push({ dest: d.dest, status: "delete_skipped", category: d.category });
            break;
          }
          if (fs.existsSync(dstAbs)) {
            backupFile(targetRoot, txDir, d.dest);
            counts.backups += 1;
            fs.unlinkSync(dstAbs);
            counts.deleted += 1;
            perFile.push({ dest: d.dest, status: "deleted", category: d.category });
          } else {
            counts.skipped_no_op += 1;
            perFile.push({ dest: d.dest, status: "unchanged", category: d.category });
          }
          break;
        }
        case "ORPHAN_KEPT": {
          if (d.keptBecause === "unverified") {
            counts.kept_unverified += 1;
            perFile.push({ dest: d.dest, status: "kept_unverified", category: d.category, reason: d.reason || ORPHAN_UNVERIFIED_LABEL });
          } else {
            counts.kept_modified += 1;
            perFile.push({ dest: d.dest, status: "kept_modified", category: d.category, reason: d.reason || ORPHAN_KEPT_LABEL });
          }
          break;
        }
        case "DELETE_CONFLICT": {
          counts.skipped_no_op += 1;
          perFile.push({ dest: d.dest, status: "delete_conflict", category: d.category, reason: d.reason || "" });
          break;
        }
        case "LOCAL_ONLY":
          counts.skipped_no_op += 1;
          perFile.push({ dest: d.dest, status: "local_only", category: d.category });
          break;
        case "LOCAL_CUSTOMIZED":
          counts.skipped_no_op += 1;
          perFile.push({ dest: d.dest, status: "local_customized", category: d.category, reason: d.reason || "" });
          break;
        default:
          counts.skipped_no_op += 1;
          perFile.push({ dest: d.dest, status: "skipped", category: d.category });
      }
    } catch (e) {
      counts.errors += 1;
      errors.push({ dest: d.dest, category: d.category, error: e.message });
      perFile.push({ dest: d.dest, status: "error", category: d.category, error: e.message });
    }
  }

  return { ok: counts.errors === 0, counts, errors, perFile };
}

function buildInstalledSnapshot(
  version,
  capsule,
  applyResult,
  prior,
  targetRoot,
  migrationsResult,
  decisions,
) {
  const root = targetRoot || REPO_ROOT;
  const assets = [];
  for (const kind of Object.keys(capsule.manifest.assets || {})) {
    for (const a of capsule.manifest.assets[kind]) {
      const localPath = path.join(root, a.dest);
      const localHash = fs.existsSync(localPath) ? sha256File(localPath) : null;
      assets.push({
        id: a.id,
        kind,
        dest: a.dest,
        owner: a.owner || "framework",
        mergeStrategy: a.mergeStrategy,
        installedHash: localHash || a.sha256,
        currentHashAtInstall: localHash,
        introducedIn: a.introducedIn || version,
      });
    }
  }
  const priorApplied = (prior && Array.isArray(prior.migrationsApplied))
    ? prior.migrationsApplied
    : [];
  const newApplied = (migrationsResult && Array.isArray(migrationsResult.newlyApplied))
    ? migrationsResult.newlyApplied
    : [];
  const migrationsApplied = Array.from(new Set([...priorApplied, ...newApplied])).sort();

  const priorUserModified = (prior && Array.isArray(prior.userModified))
    ? prior.userModified
    : [];
  const newlyUserModified = Array.isArray(decisions)
    ? decisions
        .filter((d) => d.category === "MERGE_CONFLICT" || d.category === "LOCAL_CUSTOMIZED")
        .map((d) => d.dest)
    : [];
  const userModified = Array.from(new Set([...priorUserModified, ...newlyUserModified])).sort();

  const targetVersionJson = readJSON(path.join(targetRoot, "version.json"), {});
  const derivedPathRegistryVersion =
    (String(targetVersionJson.pathRegistrySchema || "").match(/v\d+$/) || [])[0] || "v5";

  return {
    $schema: "mc/framework-installed/v2",
    installedVersion: version,
    installedCommit:
      capsule.release.commit ||
      capsule.release.sourceCommit ||
      (prior && prior.installedCommit) ||
      null,
    installedAt: new Date().toISOString(),
    source: capsule.dir,
    target: root,
    pathRegistryVersion: derivedPathRegistryVersion,
    manifestSchema: "mc/framework-manifest/v2",
    assets,
    generated: [
      ".claude/paths.json",
      ".claude/manifest.json",
      ".claude/settings.json",
      ".claude/agents/store.json",
      ".claude/framework-installed.json",
    ],
    applyCounts: applyResult.counts,
    migrationsApplied,
    userModified,
  };
}

async function runMigrations(fromVersion, toVersion, targetRoot, alreadyApplied) {
  const files = migrationsLoader.listMigrations(fromVersion, toVersion);
  if (files.length === 0) {
    return {
      ran: 0,
      failed: 0,
      skipped_already_applied: 0,
      log: [],
      status: "skipped",
      reason: `no migrations directory migrations/${fromVersion}-to-${toVersion}/ exists`,
    };
  }
  try {
    const log = await migrationsLoader.applyAll(fromVersion, toVersion, {
      targetRoot,
      alreadyApplied: alreadyApplied instanceof Set ? alreadyApplied : new Set(),
    });
    const skipped = log.filter((e) => e.skipped).length;
    const ran = log.length - skipped;
    const failed = log.filter((e) => e.result && e.result.ok === false).length;
    const newlyApplied = log
      .filter((e) => !e.skipped && e.result && e.result.ok)
      .map((e) => e.migration);
    return {
      ran,
      failed,
      skipped_already_applied: skipped,
      newlyApplied,
      log,
      status: failed === 0 ? "passed" : "failed",
    };
  } catch (e) {
    return {
      ran: 0,
      failed: 1,
      skipped_already_applied: 0,
      newlyApplied: [],
      log: [{ error: e.message }],
      status: "failed",
    };
  }
}

function runPostUpdateChecks(checks, targetRoot) {
  const out = [];
  for (const check of checks || []) {
    if (typeof check !== "string" || !check.trim()) {
      out.push({ check, status: "degraded", reason: "empty/invalid entry" });
      continue;
    }
    const trimmed = check.trim();
    const m = trimmed.match(/^node\s+(\S+)(?:\s+(.*))?$/);
    if (!m) {
      out.push({
        check,
        status: "degraded",
        reason: "non-node check; cannot run automatically",
      });
      continue;
    }
    const scriptRel = m[1];
    const args = m[2] ? m[2].split(/\s+/) : [];
    const scriptAbs = path.join(targetRoot, scriptRel);
    if (!fs.existsSync(scriptAbs)) {
      out.push({
        check,
        status: "degraded",
        reason: `script missing in target: ${scriptRel}`,
      });
      continue;
    }
    const r = spawnSync(process.execPath, [scriptAbs, ...args], {
      cwd: targetRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    out.push({
      check,
      status: r.status === 0 ? "passed" : "failed",
      exitCode: r.status,
      stderr: (r.stderr || "").slice(0, 200),
    });
  }
  return out;
}

function runGenerators(targetRoot, decisions) {
  const generatedRebuilds = Array.isArray(decisions)
    ? decisions.filter((d) => d.category === "GENERATED_REBUILD").length
    : 0;
  const generators = [
    "scripts/paths/build.js",
    "scripts/hooks/build.js",
    "scripts/generate-framework-manifest.js",
  ];
  const log = [];
  for (const rel of generators) {
    const abs = path.join(targetRoot, rel);
    if (!fs.existsSync(abs)) {
      log.push({ generator: rel, status: "skipped", reason: "not present in target" });
      continue;
    }
    const r = spawnSync(process.execPath, [abs], {
      cwd: targetRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
    log.push({
      generator: rel,
      status: r.status === 0 ? "ran" : "failed",
      exitCode: r.status,
      stderr: (r.stderr || "").slice(0, 200),
    });
  }
  return { ran: true, generatedRebuilds, log };
}

function createNewlyIntroducedDirs(targetRoot, toVersion) {
  const regFile = path.join(targetRoot, "framework", "paths.registry.json");
  if (!fs.existsSync(regFile)) return { created: [], reason: "no registry" };
  let reg;
  try {
    reg = JSON.parse(stripBom(fs.readFileSync(regFile, "utf8")));
  } catch {
    return { created: [], reason: "registry unparseable" };
  }
  const created = [];
  for (const [key, entry] of Object.entries((reg && reg.paths) || {})) {
    if (!entry || entry.removedIn) continue;
    if (entry.kind !== "dir") continue;
    if (entry.introducedIn !== toVersion) continue;
    const abs = path.join(targetRoot, entry.path);
    if (fs.existsSync(abs)) continue;
    try {
      fs.mkdirSync(abs, { recursive: true });
      created.push(key);
    } catch {
    }
  }
  return { created };
}

async function run(opts) {
  const target = opts.to;
  const apply = !!opts.apply;
  const dryRun = !!opts.dryRun || !apply;

  let sourceRoot = opts.source ? path.resolve(opts.source) : REPO_ROOT;
  const targetRoot = opts.target ? path.resolve(opts.target) : REPO_ROOT;

  if (!opts.source && target && !opts.noDiscover) {
    const haveLocal = fs.existsSync(
      path.join(sourceRoot, "framework", "releases", target, "release.json"),
    );
    if (!haveLocal) {
      const discovered = discoverCanonical(targetRoot, target);
      if (discovered) {
        process.stderr.write(
          `[update] capsule ${target} not in local framework/releases/ — using canonical at ${discovered}\n`,
        );
        sourceRoot = discovered;
      }
    }
  }

  const installedFile = path.join(
    targetRoot,
    ".claude",
    "framework-installed.json",
  );
  const frameworkManifestFile = path.join(
    targetRoot,
    ".claude",
    "framework-manifest.json",
  );

  let installed = readJSON(installedFile, null);
  const currentManifest = readJSON(frameworkManifestFile, { version: "0.0.0" });
  const fromVersion =
    (installed && installed.installedVersion) ||
    currentManifest.version ||
    "0.0.0";

  if (!target) throw new Error("Missing --to <version>");

  if (opts.reconcileBaseline && apply) {
    const targetSnap = path.join(
      targetRoot,
      "scripts",
      "mc",
      "snapshot-installed.js",
    );
    const realRoot = (p) => {
      let r;
      try {
        r = fs.realpathSync.native(p);
      } catch {
        r = path.resolve(p);
      }
      return process.platform === "win32" ? r.toLowerCase() : r;
    };
    const hasTargetSnap = fs.existsSync(targetSnap);
    if (!hasTargetSnap && realRoot(targetRoot) !== realRoot(REPO_ROOT)) {
      throw new Error(
        `reconcile-baseline refused: the target ${targetRoot} has no scripts/mc/snapshot-installed.js, so its baseline cannot be reconciled in place. Nothing was changed.`,
      );
    }
    const snapScript = hasTargetSnap
      ? targetSnap
      : path.join(__dirname, "snapshot-installed.js");
    const sr = spawnSync(process.execPath, [snapScript], {
      cwd: targetRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (sr.status !== 0) {
      throw new Error(
        `RECONCILE-BASELINE FAILED (exit ${sr.status}): ${(sr.stderr || sr.stdout || "").slice(0, 400)}`,
      );
    }
    process.stderr.write(
      `[update] reconcile-baseline: ${(sr.stdout || "").trim()}\n`,
    );
    installed = readJSON(installedFile, installed);
  }

  const capsule = loadCapsule(sourceRoot, target);
  if (capsule.release.version !== target) {
    throw new Error(
      `Capsule version mismatch: requested ${target}, capsule says ${capsule.release.version}`,
    );
  }

  let sourceTreeRoot;
  if (opts.sourceRoot) {
    sourceTreeRoot = path.resolve(opts.sourceRoot);
  } else {
    sourceTreeRoot = findRepoRootFromCapsule(capsule.dir);
  }

  const decisions = classify(installed, capsule, targetRoot);
  const counts = summarize(decisions);
  const byClass = planClass(decisions);

  const report = {
    fromVersion,
    toVersion: target,
    dryRun,
    sourceRoot,
    targetRoot,
    sourceTreeRoot,
    counts,
    classCounts: {
      A: byClass.A.length,
      B: byClass.B.length,
      C: byClass.C.length,
    },
    migrations: capsule.release.migrations || [],
    postUpdateChecks: capsule.release.postUpdateChecks || [],
  };

  if (dryRun) {
    return {
      ok: true,
      mode: "dry-run",
      report,
      sample: {
        A: byClass.A.slice(0, 5).map((d) => ({
          id: d.id,
          dest: d.dest,
          category: d.category,
        })),
        B: byClass.B.slice(0, 5).map((d) => ({
          id: d.id,
          dest: d.dest,
          category: d.category,
        })),
        C: byClass.C.slice(0, 5).map((d) => ({
          id: d.id,
          dest: d.dest,
          category: d.category,
        })),
      },
    };
  }

  if (byClass.C.length > 0) {
    const offenders = byClass.C.slice(0, 10).map(
      (d) => `${d.category}: ${d.dest}`,
    );
    return {
      ok: false,
      mode: "apply",
      error: `ESCALATE: ${byClass.C.length} Class C item(s) must be resolved before --apply. Sample:\n  ${offenders.join("\n  ")}`,
      report,
    };
  }

  let preflightReport = null;
  if (!opts.skipPreflight) {
    const diagnostic = !!opts.allRed || !!opts.diagnostic;
    preflightReport = preflightModule.runPreflight({
      targetRoot,
      sourceTreeRoot,
      toVersion: target,
      sourceRoot,
      allowStale: !!opts.allowStale,
      forceFresh: !!opts.forceFresh,
      allowVersionDrift: !!opts.allowVersionDrift,
      allRed: diagnostic,
    });
    if (!preflightReport.ok) {
      let fullReport = preflightReport;
      if (!diagnostic) {
        try {
          fullReport = preflightModule.runPreflight({
            targetRoot,
            sourceTreeRoot,
            toVersion: target,
            sourceRoot,
            allowStale: !!opts.allowStale,
            forceFresh: !!opts.forceFresh,
            allowVersionDrift: !!opts.allowVersionDrift,
            allRed: true,
          });
        } catch {
          fullReport = preflightReport;
        }
      }
      const reds = fullReport.gates.filter((g) => g.status === "red");
      const lines = reds.map((g, i) => {
        const rem = g.remediation
          ? `\n      Remediation: ${g.remediation.split("\n").join("\n      ")}`
          : "\n      Remediation: (none provided by gate)";
        return `  ${i + 1}. ${g.name} — ${g.reason || "(no reason)"}${rem}`;
      });
      const error =
        `PREFLIGHT BLOCKED: ${reds.length} red gate(s) must be resolved before --apply:\n` +
        lines.join("\n") +
        `\n\n  Tip: re-run with --diagnostic (alias --all-red) to evaluate every gate in one pass. ` +
        `Per-gate overrides: --operator-override <gate> --override-reason "<text>".`;
      return {
        ok: false,
        mode: "apply",
        error,
        report,
        preflight: fullReport,
      };
    }
  }

  let txId, txDir;
  if (opts.noTransaction) {
    txId = `${transactionModule.newTransactionId(targetRoot)}-notx`;
    txDir = path.join(targetRoot, ".mc", "transactions", txId);
    fs.mkdirSync(txDir, { recursive: true });
    fs.writeFileSync(
      path.join(txDir, "header.json"),
      JSON.stringify(
        {
          kind: "mc:update",
          txId,
          fromVersion,
          toVersion: target,
          sourceRoot,
          targetRoot,
          sourceTreeRoot,
          startedAt: new Date().toISOString(),
          noTransaction: true,
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(txDir, "plan.json"),
      JSON.stringify(decisions, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(txDir, "capsule.json"),
      JSON.stringify({ dir: capsule.dir, release: capsule.release }, null, 2) +
        "\n",
    );
  } else {
    try {
      const txBegin = transactionModule.beginTransaction({
        targetRoot,
        sourceTreeRoot,
        fromVersion,
        toVersion: target,
        sourceRoot,
        decisions,
        capsule,
        allowStale: !!opts.allowStale,
        forceFresh: !!opts.forceFresh,
        allowVersionDrift: !!opts.allowVersionDrift,
        skipFastPreflight: !!opts.skipPreflight,
      });
      txId = txBegin.txId;
      txDir = txBegin.txDir;
    } catch (e) {
      return {
        ok: false,
        mode: "apply",
        error: `TRANSACTION BEGIN FAILED (${e.code || "unknown"}): ${e.message}`,
        report,
        preflight: preflightReport,
      };
    }
  }

  const applyStartedAt = Date.now();
  let applyResult;
  let migrationsResult;
  try {
    applyResult = applyUpdateDecisions(
      sourceTreeRoot,
      targetRoot,
      decisions,
      capsule.manifest,
      txDir,
      {
        confirmDeletes: !!opts.confirmDeletes,
      },
    );
    if (!applyResult.ok) {
      const firstErr = (applyResult.errors && applyResult.errors[0]) || {
        dest: "<unknown>",
        error: "apply reported errors but no detail",
      };
      throw new Error(
        `apply phase failed at ${firstErr.dest}: ${firstErr.error}`,
      );
    }

    const priorApplied = (installed && Array.isArray(installed.migrationsApplied))
      ? new Set(installed.migrationsApplied)
      : new Set();
    migrationsResult = await runMigrations(fromVersion, target, targetRoot, priorApplied);
    if (migrationsResult.status === "failed") {
      throw new Error(
        `migration phase failed: ${migrationsResult.failed} migration(s) failed during ${fromVersion}->${target}`,
      );
    }
  } catch (err) {
    if (!opts.noTransaction) {
      try {
        transactionModule.rollbackTransaction(txDir, {
          trigger: applyResult && !applyResult.ok ? "apply" : "migration",
          failedAt:
            (applyResult &&
              applyResult.errors &&
              applyResult.errors[0] &&
              applyResult.errors[0].dest) ||
            null,
          errorMessage: err.message,
        });
      } catch (rbErr) {
        return {
          ok: false,
          mode: "apply",
          error: `APPLY FAILED + ROLLBACK FAILED: ${err.message} | rollback: ${rbErr.message}`,
          report,
          preflight: preflightReport,
          transaction: txId,
          transactionDir: path.relative(targetRoot, txDir).replace(/\\/g, "/"),
        };
      }
    }
    return {
      ok: false,
      mode: "apply",
      error: `APPLY ROLLED BACK: ${err.message}`,
      report,
      preflight: preflightReport,
      apply: applyResult,
      migrations: migrationsResult,
      transaction: txId,
      transactionDir: path.relative(targetRoot, txDir).replace(/\\/g, "/"),
    };
  }
  const applyDurationMs = Date.now() - applyStartedAt;

  for (const capsuleMetaFile of ["checksums.json", "framework-manifest.json"]) {
    const srcMeta = path.join(sourceTreeRoot, "framework", "releases", target, capsuleMetaFile);
    const dstMeta = path.join(targetRoot, "framework", "releases", target, capsuleMetaFile);
    if (!fs.existsSync(srcMeta)) {
      throw new Error(
        `mc:update: capsule metadata missing at ${srcMeta} — broken release layout (upgrade-gate step 3c fail-closed)`,
      );
    }
    fs.mkdirSync(path.dirname(dstMeta), { recursive: true });
    fs.copyFileSync(srcMeta, dstMeta);
  }

  const generatorsResult = runGenerators(targetRoot, decisions);
  if (generatorsResult.ran) {
    for (const g of generatorsResult.log) {
      if (g.status === "failed") {
        console.warn(
          `mc:update: generator ${g.generator} exited ${g.exitCode} — generated artifacts may be stale. stderr: ${g.stderr}`,
        );
      }
    }
  }

  const newDirsResult = createNewlyIntroducedDirs(targetRoot, target);
  if (newDirsResult.created.length > 0) {
    process.stderr.write(
      `mc:update: created ${newDirsResult.created.length} newly-introduced dir(s): ${newDirsResult.created.join(", ")}\n`,
    );
  }

  const scaffoldLog = (...a) =>
    process.stderr.write(`mc:update: scaffold — ${a.filter(Boolean).join(" ")}\n`);
  try {
    const scaffoldCore = require("./scaffold-core");
    if (scaffoldCore && typeof scaffoldCore.scaffoldProduct === "function") {
      scaffoldCore.scaffoldProduct({
        target: targetRoot,
        mcRoot: sourceTreeRoot,
        log: scaffoldLog,
      });
    }
  } catch (err) {
    console.warn(
      `mc:update: scaffold-core skipped (${err.message}) — structure skeleton/ROADMAP/PROJECT may be incomplete.`,
    );
  }

  try {
    const sc = require("./scaffold-core");
    if (sc && typeof sc.writeProductManifest === "function") {
      sc.writeProductManifest({ target: targetRoot, mcVersion: target, log: scaffoldLog });
    }
  } catch (err) {
    console.warn(`mc:update: manifest mc.version restamp skipped (${err.message}).`);
  }

  try {
    const scaffoldCore = require("./scaffold-core");
    if (scaffoldCore && typeof scaffoldCore.populateMcMirror === "function") {
      scaffoldCore.populateMcMirror({
        target: targetRoot,
        mcRoot: sourceTreeRoot,
        shipManifest: capsule.manifest,
        log: scaffoldLog,
      });
    }
  } catch (err) {
    console.warn(
      `mc:update: _mc/ mirror skipped (${err.message}) — regenerate.js may stay inert downstream.`,
    );
  }

  try {
    const sc = require("./scaffold-core");
    if (sc && typeof sc.regenerateMcManifest === "function") {
      sc.regenerateMcManifest({
        target: targetRoot,
        mcRoot: targetRoot,
        log: scaffoldLog,
      });
    }
  } catch (err) {
    console.warn(`mc:update: _mc/MANIFEST regeneration skipped (${err.message}).`);
  }

  const postUpdateResults = runPostUpdateChecks(
    capsule.release.postUpdateChecks || [],
    targetRoot,
  );

  try {
    const settingsDefaultsFile = mcProjectPath(targetRoot, "_mc/settings/defaults.json");
    if (fs.existsSync(settingsDefaultsFile)) {
      const compileScript = path.join(__dirname, "settings", "compile.js");
      if (fs.existsSync(compileScript)) {
        const settingsLocalFile = path.join(targetRoot, ".claude/settings.local.json");
        const settingsOutFile = path.join(targetRoot, ".claude/settings.json");
        const compileArgs = [
          compileScript,
          "--defaults", settingsDefaultsFile,
          "--out", settingsOutFile,
        ];
        if (fs.existsSync(settingsLocalFile)) {
          compileArgs.push("--local", settingsLocalFile);
        }
        const { spawnSync } = require("child_process");
        const cr = spawnSync(process.execPath, compileArgs, { encoding: "utf8" });
        if (cr.status !== 0) {
          console.warn(
            `mc:update: compile.js exited ${cr.status} — settings.json may be stale. stderr: ${(cr.stderr || "").slice(0, 200)}`,
          );
        }
      }
    }
  } catch (err) {
    console.warn(`mc:update: compile.js spawn failed (${err.message}) — settings.json may be stale.`);
  }

  const newInstalled = buildInstalledSnapshot(
    target,
    capsule,
    applyResult,
    installed,
    targetRoot,
    migrationsResult,
    decisions,
  );
  fs.writeFileSync(installedFile, JSON.stringify(newInstalled, null, 2) + "\n");

  if (!opts.noTransaction) {
    transactionModule.commitTransaction(txDir, {
      apply: applyResult,
      migrations: migrationsResult,
      postUpdateChecks: postUpdateResults,
      applyDurationMs,
    });
  } else {
    fs.writeFileSync(
      path.join(txDir, "result.json"),
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          outcome: "committed-no-transaction",
          apply: applyResult,
          migrations: migrationsResult,
          postUpdateChecks: postUpdateResults,
          rollback: null,
        },
        null,
        2,
      ) + "\n",
    );
  }

  fs.writeFileSync(
    path.join(txDir, "ROLLBACK.md"),
    [
      "# Rollback instructions",
      "",
      `Transaction ${txId}.`,
      "",
      "Backups of files this update overwrote or deleted live in:",
      "",
      `    ${path.relative(targetRoot, txDir).replace(/\\/g, "/")}/backup/`,
      "",
      "Preferred automated path:",
      "",
      `    node scripts/mc/update.js --rollback ${txId}`,
      "",
      "Manual restore of a single file:",
      "",
      "    cp <transaction>/backup/<rel-path> <rel-path>",
      "",
      "Manual restore of everything:",
      "",
      "    cp -r <transaction>/backup/* .",
      "",
      "Then check `git status` and reset framework-installed.json from the prior snapshot.",
      "",
    ].join("\n"),
  );

  let postflightReport = null;
  if (!opts.skipPostflight) {
    try {
      postflightReport = postflightModule.runPostflight({
        targetRoot,
        txId,
        txDir,
        capsule: { release: capsule.release },
        strict: !!opts.strictPostflight,
      });
    } catch (pfErr) {
      postflightReport = {
        ok: false,
        checkCount: 0,
        redCount: 0,
        yellowCount: 0,
        greenCount: 0,
        degradedCount: 1,
        checks: [],
        evidencePath: null,
        operatorAction: "review-then-decide",
        error: pfErr.message,
      };
    }
  }

  const strictBlock =
    !!opts.strictPostflight &&
    postflightReport &&
    postflightReport.redCount > 0;

  const postCheckFailed = postUpdateResults.some((c) => c.status === "failed");

  const allOk =
    applyResult.ok &&
    migrationsResult.status !== "failed" &&
    !postCheckFailed &&
    !strictBlock;

  const committedButPostCheckFailed = !allOk;
  const outcome = allOk
    ? "committed"
    : "committed-with-postcheck-warnings";

  return {
    ok: allOk,
    committed: true,
    outcome,
    committedWithWarnings: committedButPostCheckFailed,
    mode: "apply",
    report,
    preflight: preflightReport,
    apply: applyResult,
    generators: generatorsResult,
    newDirs: newDirsResult,
    migrations: migrationsResult,
    postUpdateChecks: postUpdateResults,
    postflight: postflightReport,
    transaction: txId,
    transactionDir: path.relative(targetRoot, txDir).replace(/\\/g, "/"),
  };
}

function mcProjectPath(root, rel) {
  try {
    return require("../hooks/lib/mc-dirs").resolveProjectPath(root, rel);
  } catch {
    return path.join(root, rel);
  }
}

function runRollbackCli(txId, opts) {
  const targetRoot = opts.target ? path.resolve(opts.target) : REPO_ROOT;
  const txDir = mcProjectPath(targetRoot, `.mc/transactions/${txId}`);
  if (!fs.existsSync(txDir)) {
    const msg = `rollback: transaction directory not found at ${txDir}\n  txId: ${txId}\n  target: ${targetRoot}\n  hint: list available transactions with: ls ${path.join(targetRoot, ".mc", "transactions")}`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(4);
  }
  const headerFile = path.join(txDir, "header.json");
  if (!fs.existsSync(headerFile)) {
    const msg = `rollback: header.json missing in ${txDir} — transaction directory is corrupt or unrelated to /mc:update`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(4);
  }
  let header;
  try {
    header = JSON.parse(stripBom(fs.readFileSync(headerFile, "utf8")));
  } catch (e) {
    const msg = `rollback: failed to parse header.json: ${e.message}`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(4);
  }
  if (header.noTransaction) {
    const msg = `rollback: transaction ${txId} was created with --no-transaction (no snapshot envelope to roll back). Restore manually from ${path.relative(targetRoot, txDir).replace(/\\/g, "/")}/backup/`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir, header },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(4);
  }
  let result;
  try {
    result = transactionModule.rollbackTransaction(txDir, {
      trigger: "operator",
      reason: "manual-cli-rollback",
      operator:
        process.env.USER ||
        process.env.USERNAME ||
        process.env.LOGNAME ||
        "unknown",
      errorMessage: `Manual CLI rollback by operator (${process.env.USER || process.env.USERNAME || "unknown"})`,
    });
  } catch (e) {
    const msg = `rollback: rollbackTransaction threw: ${e.message}`;
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, mode: "rollback", error: msg, txId, txDir, header },
          null,
          2,
        ),
      );
    } else {
      console.error(msg);
    }
    process.exit(5);
  }
  const fullSuccess = !result.partial && !result.error;
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: fullSuccess,
          mode: "rollback",
          txId,
          txDir,
          fromVersion: header.fromVersion,
          toVersion: header.toVersion,
          restoredCount: result.restoredCount,
          unlinkedCount: result.unlinkedCount,
          partial: result.partial,
          error: result.error || null,
        },
        null,
        2,
      ),
    );
  } else {
    const status = fullSuccess ? "OK" : result.partial ? "PARTIAL" : "ERROR";
    console.log(
      `[${status}] rollback ${txId}: restored=${result.restoredCount} unlinked=${result.unlinkedCount} partial=${result.partial}`,
    );
    console.log(`  txDir:        ${txDir}`);
    console.log(
      `  fromVersion:  ${header.fromVersion} (would have been ${header.toVersion})`,
    );
    if (result.error) console.log(`  error:        ${result.error}`);
    if (!fullSuccess) {
      console.log(
        `  inspect:      ${path.join(txDir, "diagnostics.log")} and ${path.join(txDir, "result.json")}`,
      );
    }
  }
  process.exit(fullSuccess ? 0 : 1);
}

function runStatusCli(opts) {
  const targetRoot = opts.target ? path.resolve(opts.target) : REPO_ROOT;
  const validateScript = path.join(
    targetRoot,
    "scripts",
    "mc",
    "manifest",
    "validate.js",
  );
  if (!fs.existsSync(validateScript)) {
    const fallback = path.join(
      __dirname,
      "manifest",
      "validate.js",
    );
    if (!fs.existsSync(fallback)) {
      const msg = `--status: validate.js not found at ${validateScript} or ${fallback}`;
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, mode: "status", error: msg }, null, 2));
      } else {
        console.error(msg);
      }
      process.exit(2);
    }
  }
  const script = fs.existsSync(validateScript) ? validateScript : path.join(__dirname, "manifest", "validate.js");
  const validateArgs = ["--root", targetRoot, "--json"];
  if (opts.strict) validateArgs.push("--strict");
  const res = require("child_process").spawnSync(
    process.execPath,
    [script, ...validateArgs],
    { encoding: "utf8" },
  );
  if (res.error) {
    const msg = `--status: failed to spawn validate.js: ${res.error.message}`;
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, mode: "status", error: msg }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (e) {
    const msg = `--status: validate.js did not emit parseable JSON: ${e.message}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`;
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, mode: "status", error: msg }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(2);
  }
  const findingsForExit = parsed.findings || {};
  const totalFindingsForExit = Object.values(findingsForExit).reduce(
    (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
    0,
  );
  if (opts.json) {
    console.log(JSON.stringify({ mode: "status", ...parsed }, null, 2));
    process.exit(totalFindingsForExit === 0 ? 0 : 1);
  }
  console.log(`/mc:update --status — manifest validator`);
  console.log(`  manifest: ${parsed.manifestPath || "(not found)"}`);
  console.log(`  root:     ${parsed.root || targetRoot}`);
  if (typeof parsed.pathCount === "number") {
    console.log(`  paths:    ${parsed.pathCount} total`);
  }
  if (parsed.ownerCounts) {
    const oc = parsed.ownerCounts;
    console.log(
      `  owners:   framework=${oc.framework || 0} generated=${oc.generated || 0} project=${oc.project || 0} runtime=${oc.runtime || 0}` +
        (oc.other ? ` other=${oc.other}` : ""),
    );
  }
  console.log("");
  const findings = parsed.findings || {};
  const classes = ["missing", "drift", "schema_violation", "user_modified", "unmanifested"];
  let totalFindings = 0;
  for (const cls of classes) {
    const items = findings[cls] || [];
    if (items.length === 0) continue;
    totalFindings += items.length;
    console.log(`${cls.toUpperCase().padEnd(18)} (${items.length})`);
    for (const item of items.slice(0, 40)) {
      if (typeof item === "string") {
        console.log(`  ${item}`);
      } else if (item && typeof item === "object") {
        const p = item.path || item.file || JSON.stringify(item);
        const d = item.detail || item.reason || "";
        console.log(`  ${p}${d ? ` — ${d}` : ""}`);
      }
    }
    if (items.length > 40) {
      console.log(`  …and ${items.length - 40} more`);
    }
    console.log("");
  }
  if (totalFindings === 0) {
    console.log(`CLEAN — manifest matches on-disk state.`);
    process.exit(0);
  }
  console.log(`${totalFindings} finding(s). Re-run with --json for the full payload.`);
  process.exit(1);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return null;
    return args[i + 1];
  };
  const getEqOrPositional = (flag) => {
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
      if (args[i] === flag) return args[i + 1] || null;
    }
    return null;
  };
  if (args.includes("--status")) {
    runStatusCli({
      target: get("--target"),
      json: args.includes("--json"),
      strict: args.includes("--strict"),
    });
    return;
  }
  const rollbackArg = getEqOrPositional("--rollback");
  if (rollbackArg !== null) {
    if (!rollbackArg || rollbackArg.startsWith("--")) {
      console.error(
        "Usage: node scripts/mc/update.js --rollback <txId> [--target <install-path>] [--json]\n  txId is the directory name under <target>/.mc/transactions/.",
      );
      process.exit(2);
    }
    runRollbackCli(rollbackArg, {
      target: get("--target"),
      json: args.includes("--json"),
    });
    return;
  }
  const opts = {
    to: get("--to"),
    apply: args.includes("--apply"),
    dryRun: args.includes("--dry-run"),
    json: args.includes("--json"),
    confirmDeletes: args.includes("--confirm-deletes"),
    source: get("--source"),
    noDiscover: args.includes("--no-discover"),
    target: get("--target"),
    sourceRoot: get("--source-root"),
    forceFresh: args.includes("--force-fresh"),
    allowStale: args.includes("--allow-stale"),
    allowVersionDrift: args.includes("--allow-version-drift"),
    skipPreflight: args.includes("--skip-preflight"),
    noTransaction: args.includes("--no-transaction"),
    skipPostflight: args.includes("--skip-postflight"),
    strictPostflight: args.includes("--strict-postflight"),
    reconcileBaseline:
      args.includes("--reconcile-baseline") ||
      args.includes("--accept-local-drift"),
    diagnostic: args.includes("--diagnostic"),
    allRed: args.includes("--all-red"),
  };
  if (!opts.to) {
    console.error(
      "Usage: node scripts/mc/update.js --to <version> [--source <mc-repo>] [--target <install-path>] [--dry-run | --apply] [--confirm-deletes] [--force-fresh] [--allow-stale] [--allow-version-drift] [--reconcile-baseline|--accept-local-drift] [--diagnostic|--all-red] [--no-transaction] [--skip-postflight] [--strict-postflight]\n       node scripts/mc/update.js --rollback <txId> [--target <install-path>] [--json]\n       node scripts/mc/update.js --status [--target <install-path>] [--json] [--strict]",
    );
    process.exit(2);
  }
  run(opts)
    .then((r) => {
      if (opts.json) {
        console.log(JSON.stringify(r, null, 2));
        if (!r.ok) {
          process.exit(1);
        }
        return;
      }
      if (!r.ok && !r.committed) {
        console.error(r.error || "Update failed.");
        if (r.report) console.error(JSON.stringify(r.report, null, 2));
        process.exit(1);
      }
      if (!r.ok && r.committed) {
        console.warn(
          `WARNING: update COMMITTED (${r.report.fromVersion} → ${r.report.toVersion}) but one or more post-update checks failed. The files were applied and the installed version was updated — this is NOT a rollback. Review the failed checks below; re-run them after fixing, or roll back explicitly with: node scripts/mc/update.js --rollback ${r.transaction}`,
        );
      }
      console.log(
        `Update plan ${r.report.fromVersion} → ${r.report.toVersion} (${r.mode})`,
      );
      console.log(`  source:  ${r.report.sourceRoot}`);
      console.log(`  target:  ${r.report.targetRoot}`);
      console.log(`  Class A (auto):           ${r.report.classCounts.A}`);
      console.log(`  Class B (apply+review):   ${r.report.classCounts.B}`);
      console.log(`  Class C (escalate):       ${r.report.classCounts.C}`);
      console.log("  Counts by category:");
      for (const [k, v] of Object.entries(r.report.counts)) {
        console.log(`    ${k.padEnd(22)} ${v}`);
      }
      console.log(`  Migrations: ${r.report.migrations.length}`);
      console.log(`  Post-update checks: ${r.report.postUpdateChecks.length}`);
      const isApply = r.mode === "apply" && r.apply;
      const ac = isApply ? r.apply.counts : null;
      if (isApply) {
        console.log("");
        console.log(
          `Apply: added=${ac.added} repaired=${ac.updated} unchanged=${ac.unchanged || 0} conflict=${ac.merge_conflicts_held} deleted=${ac.deleted} (skipped=${ac.deletes_skipped}) kept-modified=${ac.kept_modified || 0} kept-unverified=${ac.kept_unverified || 0} backups=${ac.backups} no-op=${ac.skipped_no_op} errors=${ac.errors}`,
        );
        const perFile = r.apply.perFile || [];
        const verboseFiles = process.argv.includes("--verbose-files");
        const interesting = perFile.filter((p) => p.status !== "unchanged");
        const shown = verboseFiles ? perFile : interesting.slice(0, 20);
        if (shown.length > 0) {
          console.log("");
          console.log("Per-file:");
          for (const p of shown) {
            const tag = p.status.toUpperCase().padEnd(16);
            const note = p.error || (p.status === "kept_modified" || p.status === "kept_unverified" ? p.reason : "");
            console.log(`  ${tag} ${p.dest}${note ? "  [" + note + "]" : ""}`);
          }
          if (!verboseFiles && interesting.length > 20) {
            console.log(`  ... ${interesting.length - 20} more interesting entries (re-run with --verbose-files for full list, including ${ac.unchanged || 0} unchanged)`);
          } else if (!verboseFiles && (ac.unchanged || 0) > 0) {
            console.log(`  (${ac.unchanged} unchanged entries omitted; --verbose-files to include)`);
          }
        }
        if (r.migrations) {
          console.log(
            `Migrations: ran=${r.migrations.ran} failed=${r.migrations.failed} status=${r.migrations.status}`,
          );
        }
        if (r.postUpdateChecks && r.postUpdateChecks.length > 0) {
          const pass = r.postUpdateChecks.filter(
            (c) => c.status === "passed",
          ).length;
          const fail = r.postUpdateChecks.filter(
            (c) => c.status === "failed",
          ).length;
          const degr = r.postUpdateChecks.filter(
            (c) => c.status === "degraded",
          ).length;
          console.log(
            `Post-update checks: ${pass} passed, ${fail} failed, ${degr} degraded`,
          );
          for (const c of r.postUpdateChecks) {
            const tag = c.status.toUpperCase().padEnd(8);
            console.log(`  ${tag} ${c.check}`);
            if (c.reason) console.log(`           ${c.reason}`);
          }
        }
        if (r.transactionDir) {
          console.log(
            `Transaction: ${r.transactionDir} (rollback instructions inside)`,
          );
        }
        if (r.preflight) {
          console.log(
            `Preflight: ${r.preflight.greenCount}/${r.preflight.gateCount} GREEN, ${r.preflight.redCount} RED, ${r.preflight.yellowCount} YELLOW, ${r.preflight.degradedCount} DEGRADED`,
          );
        }
        if (r.postflight) {
          console.log(
            `Postflight: ${r.postflight.greenCount}/${r.postflight.checkCount} GREEN, ${r.postflight.redCount} RED, ${r.postflight.yellowCount} YELLOW, ${r.postflight.degradedCount} DEGRADED (operatorAction=${r.postflight.operatorAction})`,
          );
          if (r.postflight.evidencePath) {
            console.log(
              `  evidence: ${path.relative(r.report.targetRoot, r.postflight.evidencePath).replace(/\\/g, "/")}`,
            );
          }
        }
      }
      printHumanReport("mc:update", {
        verdict:
          r.report.classCounts.C > 0
            ? "Needs human decision"
            : isApply
              ? r.ok
                ? "Update applied"
                : "Update applied with failures"
              : "Dry-run plan ready",
        whatChanged: isApply
          ? `${r.report.fromVersion} → ${r.report.toVersion}; ${ac.added + ac.updated + ac.deleted} files written/removed; ${r.migrations?.ran || 0} migration(s) ran`
          : `${r.report.fromVersion} -> ${r.report.toVersion}; ${Object.keys(r.report.counts).length} categories classified`,
        why: "Classifies local framework assets against the target release capsule, runs migrations + post-update checks, writes transaction record.",
        risksRemaining:
          r.report.classCounts.C > 0
            ? `${r.report.classCounts.C} Class C item(s)`
            : isApply
              ? !r.ok
                ? "One or more migration/post-check failed — see details."
                : ac.deletes_skipped > 0
                  ? `${ac.deletes_skipped} delete(s) deferred — re-run with --confirm-deletes.`
                  : "None — verify with /mc:doctor."
              : "Run --apply to execute the plan.",
        whatWasRejected:
          r.mode === "dry-run"
            ? "No files were changed."
            : isApply
              ? ac.errors > 0
                ? `${ac.errors} write(s) failed — see error list.`
                : ac.merge_conflicts_held > 0
                  ? `${ac.merge_conflicts_held} merge-conflict(s) preserved (Class C).`
                  : "Class C items (none surfaced)."
              : "Apply path refused.",
        whatWasTested: `${r.migrations?.ran || 0}/${r.report.migrations.length} migration(s) ran, ${r.postUpdateChecks?.length || 0} post-update check(s) executed`,
        needsHumanDecision:
          r.report.classCounts.C > 0
            ? "Resolve Class C items before apply."
            : isApply
              ? r.ok
                ? "Run /mc:doctor to verify the install is healthy."
                : "Inspect transaction record + ROLLBACK.md to recover."
              : "None for dry-run.",
        recommendedNextAction: isApply
          ? r.ok
            ? "node scripts/mc/release-gates.js (or /mc:doctor)"
            : r.committed
              ? `Re-run the failed post-update check(s) after fixing; the update is applied. Roll back only if needed: node scripts/mc/update.js --rollback ${r.transaction}`
              : `Inspect ${r.transactionDir}/ and consider rollback.`
          : "Review the plan; pass --apply to execute, or /mc:doctor to verify pre-flight.",
      });
      if (!r.ok) process.exit(1);
    })
    .catch((e) => {
      console.error(`update: ${e.message}`);
      process.exit(2);
    });
}

module.exports = {
  run,
  classify,
  planClass,
  summarize,
  applyUpdateDecisions,
  findRepoRootFromCapsule,
  discoverCanonical,
  loadCapsule,
  runStatusCli,
};
