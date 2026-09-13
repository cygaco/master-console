/**
 * update.js — /mc:update engine. Apply or dry-run a release capsule against
 * a local install.
 *
 * Cross-repo aware:
 *   --source <path>   canonical MC repo (where the capsule lives)
 *   --target <path>   the install to be updated (where writes land)
 *   --to <version>    capsule version (e.g. 0.1.2)
 *
 * If --source/--target are omitted, both default to REPO_ROOT (the repo where
 * update.js itself lives), which is the legacy "self-update" mode used by
 * release-gate fixtures.
 *
 * Algorithm:
 *   1. Read installed snapshot from <target>/.claude/framework-installed.json
 *   2. Read source release capsule from <source>/framework/releases/<to>/release.json
 *   3. Classify each asset into one of 12 categories.
 *   4. dry-run: print plan + exit.
 *      apply  : write transaction record, copy files, run migrations,
 *               execute post-update checks, update installed snapshot.
 *
 * Pre-0.1.2 update.js had four broken behaviours that this rewrite fixes:
 *   - sourceTreeRoot was resolved as `..`/`..` from the capsule, landing at
 *     mc/ (not the repo root) and making every cross-repo apply load
 *     from the wrong source tree.
 *   - migrations listed in release.json were never executed; only counted.
 *   - postUpdateChecks were never executed; only counted.
 *   - MERGE_SAFE was a fiction: any local-customized file with mergeStrategy
 *     three_way_markdown got overwritten by upstream and reported as
 *     "merged."
 *   - No transaction/rollback. An interrupted apply left no breadcrumbs.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { printHumanReport } = require("./report-format");
const migrationsLoader = require("./migrations-loader");
// SP-20260513-005 tri-pillar — wired into run() at T-20260513-062.
// Preflight refuses to apply when any of 10 gates blocks; transaction wraps
// the apply + migrations in a snapshot/lock/rollback envelope; postflight
// runs 5 diagnostic checks (incl. provider-smoke via registerExternalCheck).
const preflightModule = require("./preflight");
const transactionModule = require("./transaction");
const postflightModule = require("./postflight");
// SP-20260514-001 R-1 — single content-hash surface. contentHash() is
// LF-normalized for text assets (extension allowlist) and raw for binary;
// rawHash() is unconditional raw; hashMatches() is prefix-tolerant for
// 0.6.x truncated-sha256 capsule back-compat. Closes the CRLF false-positive
// bug class at the source. T-20260514-068 owns the module.
const cHash = require("./lib/content-hash");
// SP-20260514-001 R-5 / T-20260514-076 — new event kinds wired into the
// classifier (content-hash-mismatch lf_only/real_drift, ownership-
// transitioned).
const updateEvents = require("./lib/update-events");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Strip a leading UTF-8 BOM (U+FEFF) before JSON.parse. PowerShell-written /
// fresh-migration JSON files carry a BOM that makes raw JSON.parse throw or
// misclassify; mirror the inline fix at scripts/mc/repo-role.js:113.
const stripBom = (s) => (typeof s === "string" ? s.replace(/^﻿/, "") : s);

function sha256File(filePath) {
  // contentHash returns the LF-normalized sha256 for text assets and raw
  // sha256 for binary. Path-based call infers text/binary from extension.
  if (!fs.existsSync(filePath)) return null;
  return cHash.contentHash(filePath);
}

// LF normalization is now intrinsic to contentHash for text assets; this
// shim stays for backward-compat with existing callsites and explicit
// "force text-mode" intent at the classifier boundary.
function sha256FileLfNormalized(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return cHash.contentHash(filePath, { text: true });
}

// True iff `hashLong` (full or any length) starts with `hashShort`.
// Tolerates the 0.6.x capsule's 12-char truncation in
// framework-manifest.json#assets[].sha256 during the un-truncation transition.
const hashMatches = cHash.hashMatches;

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(stripBom(fs.readFileSync(file, "utf8")));
  } catch {
    return fallback;
  }
}

/**
 * Resolve the MC source-tree root from a capsule directory.
 *
 * Walk up from the capsule looking for a dir that has version.json + .claude
 * + mc/. This is robust to capsule location moves and avoids the brittle
 * `..`/`..` two-level assumption that landed at mc/, not the repo root.
 */
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

// 0.4.1: when sourceRoot doesn't have the target capsule, try to discover
// a canonical MC clone via the same walk release-canonical.js uses:
// sibling ../master-console (post-rename, 2026-09-12), sibling ../MC, sibling ../mc, manifest.json#mc.source.
// Returns an absolute path to the canonical, or null if nothing usable.
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
    /* manifest optional */
  }
  // Also try the framework-installed.json's recorded source path.
  try {
    const fi = path.join(targetRoot, ".claude", "framework-installed.json");
    if (fs.existsSync(fi)) {
      const j = JSON.parse(stripBom(fs.readFileSync(fi, "utf8")));
      if (j && j.source && !/^https?:\/\//.test(j.source)) {
        tries.push(path.resolve(j.source));
      }
    }
  } catch {
    /* optional */
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
  // Verify checksums match before trusting the capsule.
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

/**
 * Classify each asset in the target manifest against installed state.
 *
 * 0.1.2: a customized local file with mergeStrategy three_way_markdown is
 * classified MERGE_CONFLICT, not MERGE_SAFE. The previous classification
 * pretended a real merge would happen; the apply path then copied upstream
 * over local and reported success. Until a real three-way merger lands,
 * MERGE_SAFE is reserved for files that genuinely don't need a merge.
 */
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

    // SP-20260514-001 R-3 / T-20260514-073 — framework_template ownership
    // transition. Decision-ledger 2026-05-14 (Alpha-resolved Class C per
    // no-pause directive, Beta-recommended): automatic on any non-whitespace
    // edit. contentHash is already LF-normalized for text, so a mismatch
    // here means a real edit (not just CRLF↔LF).
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
      // No consumer edits — treat as a regular framework asset; falls through.
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
      // targetSha from capsule manifest is intentionally truncated to 12 chars
      // by generate-framework-manifest.js; localSha is full 64. Prefix match.
      category = "UPDATE_SAFE";
      reason = "Already at target version (sha matches).";
    } else if (
      targetSha &&
      hashMatches(sha256FileLfNormalized(localPath), targetSha)
    ) {
      // Windows autocrlf=true smudges working tree CRLF after the capsule
      // manifest was hashed against LF. Text-file content is equivalent;
      // classify as UPDATE_SAFE and let apply rewrite from canonical source.
      category = "UPDATE_SAFE";
      reason =
        "Already at target version (sha matches under LF normalization).";
      // T-076: surface LF-only mismatches as diagnostic events. Should be
      // rare with content-hash already LF-normalizing — if it stays non-zero,
      // some caller is bypassing the central hash module.
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
      // installedHash may be truncated 12-char (if propagated from a.sha256
      // by older apply runs) or full 64-char (if computed locally). Prefix
      // match handles both.
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
      // Same LF/CRLF tolerance applied to the installed-snapshot branch.
      category = "UPDATE_SAFE";
      reason =
        "Local matches installed snapshot under LF normalization → upstream change is safe to apply.";
    } else {
      // Local has been customized
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
        // three_way_markdown / replace_if_unmodified / anything else with a
        // dirty local file ⇒ human review. We do NOT pretend a merge happened.
        category = "MERGE_CONFLICT";
        reason = `Local customized, mergeStrategy=${mergeStrategy} — three-way merge not implemented; requires human review.`;
        // T-076: real drift means the local content genuinely diverges from
        // the capsule (not an LF artifact). Worth a dedicated event so we
        // can count how many MERGE_CONFLICTs are real vs noise.
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

  // Detect installed assets the new capsule no longer ships
  for (const [dest, rec] of installedAssets) {
    if (!targetAssets.has(dest)) {
      const localPath = path.join(root, dest);
      const localExists = fs.existsSync(localPath);
      const localSha = localExists ? sha256File(localPath) : null;
      let category = "DELETE_SAFE";
      let reason =
        "Removed in target version, local matches installed (safe to delete).";
      if (!localExists) {
        category = "DELETE_SAFE";
        reason = "Already gone locally.";
      } else if (
        rec.installedHash &&
        localSha &&
        !cHash.hashMatches(localSha, rec.installedHash)
      ) {
        // SP-20260514-001 R-3 / T-20260514-073 — files that were
        // framework_template are now project_owned once edited; if the
        // framework restructure drops the template path, the consumer
        // edit must SURVIVE. DELETE_SAFE, not DELETE_CONFLICT.
        if (
          rec.owner === "framework_template" ||
          rec.owner === "project_owned"
        ) {
          category = "DELETE_SAFE";
          reason =
            "Removed in target version; local was project_owned (or transitioned from framework_template) — preserve in place, do not delete.";
        } else {
          category = "DELETE_CONFLICT";
          reason =
            "Removed in target but local differs from installed snapshot — preserve.";
        }
      }
      decisions.push({
        id: rec.id || dest,
        dest,
        kind: rec.kind || "unknown",
        owner: rec.owner || "framework",
        category,
        reason,
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
  // Map 12 categories → A/B/C decision class (Phase 4K wiring)
  const map = {
    ADD_SAFE: "A",
    UPDATE_SAFE: "A",
    DELETE_SAFE: "A",
    GENERATED_REBUILD: "A",
    MERGE_SAFE: "B",
    RENAME_SAFE: "B",
    MIGRATION_REQUIRED: "B",
    LOCAL_ONLY: "A", // no-op
    LOCAL_CUSTOMIZED: "A", // no-op
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

// ── Transaction helpers ──────────────────────────────────
//
// The old stub (writeTransactionPlan + backupFile + newTransactionId) was
// replaced at T-20260513-062 by scripts/mc/transaction.js, which owns
// header/plan/snapshot/capsule writes, pre-state sha256 + backup capture,
// the active.lock guard (R-32), atomic snapshot hashing (R-31), the fast
// preflight subset re-run (R-33), and rollback. The legacy backupFile()
// helper used during apply is preserved below since applyUpdateDecisions
// captures per-file backups during the apply loop (in addition to the
// pre-apply snapshot taken by beginTransaction).

function backupFile(targetRoot, txDir, relPath) {
  const abs = path.join(targetRoot, relPath);
  if (!fs.existsSync(abs)) return null;
  const dest = path.join(txDir, "backup", relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
  return dest;
}

// ── Apply ────────────────────────────────────────────────

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
    merge_conflicts_held: 0,
    skipped_no_op: 0,
    errors: 0,
    backups: 0,
  };
  const errors = [];
  // SP-20260524-003 — per-file status reporting.
  //
  // Each entry: { dest, status, category, [reason] }. Status is the
  // operator-facing label:
  //   added       — new file, ADD_SAFE path executed
  //   repaired    — existing file overwritten with upstream content (real diff)
  //   unchanged   — existing file already matched upstream byte-for-byte
  //   conflict    — MERGE_CONFLICT held; operator must resolve
  //   deleted     — DELETE_SAFE confirmed and removed
  //   delete_skipped — DELETE_SAFE not confirmed; left in place
  //   local_only  — file outside framework ownership; untouched
  //   local_customized — operator-customized; keep_local strategy
  //   delete_conflict — was installed but locally missing; needs review
  //   skipped     — fallthrough (unknown category)
  //   error       — apply hit an error on this file (see errors[])
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
          // Detect "already at target" — local + source byte-identical →
          // no write needed; report as `unchanged`.
          if (
            d.category === "UPDATE_SAFE" &&
            fs.existsSync(dstAbs) &&
            cHash.contentHash(srcAbs) === cHash.contentHash(dstAbs)
          ) {
            counts.unchanged += 1;
            perFile.push({ dest: d.dest, status: "unchanged", category: d.category });
            break;
          }
          // Backup before overwrite (only if a local file actually exists).
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
            // existedBefore ≈ true for UPDATE_SAFE; if a file vanished between
            // classify and apply, ADD-style copy is still a `repaired` semantic
            // (the operator state moved from "absent" to "matches upstream").
            perFile.push({ dest: d.dest, status: "repaired", category: d.category });
          }
          break;
        }
        case "MERGE_CONFLICT": {
          // Held — surface in report, do not write.
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
            // Was supposed to be deleted but already gone — treat as no-op.
            counts.skipped_no_op += 1;
            perFile.push({ dest: d.dest, status: "unchanged", category: d.category });
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
        // T-20260514-071: always persist the locally-computed full 64-char
        // sha256. With T-070 in effect, capsule a.sha256 is also 64-char on
        // 0.7.0+; fallback to a.sha256 only when local file is genuinely
        // missing (best-effort). Back-compat read remains via hashMatches.
        installedHash: localHash || a.sha256,
        currentHashAtInstall: localHash,
        introducedIn: a.introducedIn || version,
      });
    }
  }
  // SP-20260524-004 — versioned migrations.
  //
  // Compose migrationsApplied: prior list (or []) + newlyApplied from this
  // run, deduped + sorted for stable diff. Migrations that ran but failed
  // are NOT recorded — re-running update will retry them.
  const priorApplied = (prior && Array.isArray(prior.migrationsApplied))
    ? prior.migrationsApplied
    : [];
  const newApplied = (migrationsResult && Array.isArray(migrationsResult.newlyApplied))
    ? migrationsResult.newlyApplied
    : [];
  const migrationsApplied = Array.from(new Set([...priorApplied, ...newApplied])).sort();

  // SP-20260524-004 — userModified tracking.
  //
  // Capture paths the classifier flagged as operator-modified: MERGE_CONFLICT
  // (real local edit) + LOCAL_CUSTOMIZED (keep_local strategy). LOCAL_ONLY is
  // operator-only territory and explicitly NOT tracked as a framework-managed
  // user-modification — framework simply doesn't own those paths.
  //
  // Preserves prior userModified entries: once a file is marked, only an
  // explicit "operator reset" path (future sprint — possibly via a
  // /warp:reset-customization CLI) removes it. This makes the field
  // monotonic across update runs.
  const priorUserModified = (prior && Array.isArray(prior.userModified))
    ? prior.userModified
    : [];
  const newlyUserModified = Array.isArray(decisions)
    ? decisions
        .filter((d) => d.category === "MERGE_CONFLICT" || d.category === "LOCAL_CUSTOMIZED")
        .map((d) => d.dest)
    : [];
  const userModified = Array.from(new Set([...priorUserModified, ...newlyUserModified])).sort();

  // (b) ED-264: derive pathRegistryVersion from the target's (freshly-applied) version.json#pathRegistrySchema
  // — the SAME source of truth fresh-install uses (fresh writes "v5"). Was a hardcoded "v4" literal that went
  // stale and diverged from a fresh-N install (GATE-B 3c parity).
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
      // PRESERVE-BY-DESIGN (bundle-3 / ED-264): store.json is listed as installer-generated, but its
      // CONTENT is mutable RUNTIME BUILD-STATE (features/tasks/cycle/circuitBreaker/heartbeat/runLog —
      // no version field). update must NEVER regenerate it (that WIPES live state); it is created once at
      // fresh install (scaffold-core#writeAgentStore, if-not-exists) and PRESERVED thereafter. A future
      // "regenerate every generated file on update" implementer MUST exclude store.json. Its membership in
      // this list is a mild mislabel (no readers of this field today) — reclassification tracked in ED-264.
      ".claude/agents/store.json",
      // GATE-B 3c (β (a) ruling): match fresh-install.ps1's generated[] list EXACTLY (it lists
      // framework-installed.json as its 5th entry). The framework-installed.json structured comparator now
      // byte-checks the `generated` field, so update's snapshot must carry the same 5 entries or the
      // framework-owned-field compare REDs on `generated` (fresh 5 vs update 4).
      ".claude/framework-installed.json",
    ],
    applyCounts: applyResult.counts,
    migrationsApplied,
    userModified,
  };
}

// ── Migration runner ─────────────────────────────────────
//
// release.json may list migration ids/files. We resolve them through
// migrations-loader.js#applyAll(from, to, ctx). ctx is set so migrations
// know which target tree to mutate. If a migration throws, we mark it
// failed and stop (subsequent migrations are listed but not run).
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
    // SP-20260524-004 — pass alreadyApplied set so versioned migrations skip
    // ids that already ran against this install (typically resuming after a
    // mid-chain failure, or running update across a chain that overlaps with
    // a prior interrupted run).
    const log = await migrationsLoader.applyAll(fromVersion, toVersion, {
      targetRoot,
      alreadyApplied: alreadyApplied instanceof Set ? alreadyApplied : new Set(),
    });
    const skipped = log.filter((e) => e.skipped).length;
    const ran = log.length - skipped;
    const failed = log.filter((e) => e.result && e.result.ok === false).length;
    // New migrations applied successfully this run (ids only). Caller persists
    // these into framework-installed.json#migrationsApplied.
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

// ── Post-update check runner ─────────────────────────────
//
// release.json#postUpdateChecks is an array of shell-style strings ("node
// scripts/X.js [args...]"). We run each in targetRoot. Status mapping:
//   exit 0 → passed
//   exit non-zero → failed
//   absent / parse-error → degraded
function runPostUpdateChecks(checks, targetRoot) {
  const out = [];
  for (const check of checks || []) {
    if (typeof check !== "string" || !check.trim()) {
      out.push({ check, status: "degraded", reason: "empty/invalid entry" });
      continue;
    }
    // Only support `node <script.js> [args...]` — anything else is degraded.
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

// ── Generated-artifact regeneration (G5.10a) ─────────────
//
// owner=generated assets (.claude/paths.json, settings.json, the hook wiring,
// path-lint rules, schemas, PATH_KEYS.md, etc.) classify as GENERATED_REBUILD.
// The apply loop copies the canonical *snapshot* of these files — but that
// snapshot is the source repo's generated output at release-build time, which
// can be stale against the target's just-applied generator INPUTS
// (framework/paths.registry.json, _mc/ hook sources). The post-update
// checks (paths/build.js --check, etc.) then fail on "stale paths.json".
//
// The fix: after the file copies land, RUN the generators in the target so the
// generated artifacts are derived from the target's own (freshly-updated)
// sources. Only runs when at least one GENERATED_REBUILD decision is present
// (no generated assets touched → nothing to regenerate). Each generator is
// best-effort: a missing script (older target) or non-zero exit is recorded
// but does not fail the update — the post-update --check gate is the
// authority on whether the result is acceptable. Returns a per-generator log.
function runGenerators(targetRoot, decisions) {
  // ALWAYS regenerate the generated set on --apply (bundle-3 / ED-264 class-fix). The prior gate (run
  // ONLY when a GENERATED_REBUILD decision was present) MISSED the case where a generator's SOURCE
  // changed but its OUTPUT was not itself a GENERATED_REBUILD decision — leaving paths.json (and
  // settings.json) STALE against the target's freshly-applied sources. Concretely: a frozen N-1 capsule
  // ships a paths.json carrying a since-removedIn key; the update never regenerated it -> 3c
  // non-convergence vs a fresh-N install. paths/build.js + hooks/build.js are IDEMPOTENT against the
  // target's sources, so an unconditional run CONVERGES every generated file (this makes the
  // settings.json "converges" property REAL, not incidental). Only reached on --apply (the dry-run path
  // returns before the finalization), so dry-run semantics are preserved. Per-generator failure stays a
  // WARN — the post-update --check gate is the authority on acceptability.
  const generatedRebuilds = Array.isArray(decisions)
    ? decisions.filter((d) => d.category === "GENERATED_REBUILD").length
    : 0;
  // Ordered: paths first (settings/hooks may reference path keys), then hooks.
  const generators = [
    "scripts/paths/build.js",
    "scripts/hooks/build.js",
    // (a1) ED-264 / GATE-B 3c: regenerate framework-manifest.json IN-TARGET, symmetric with fresh-install
    // (install.ps1 runs the target's generate-framework-manifest.js against the installed tree — it does
    // NOT copy the capsule snapshot; a copy's asset-sha list diverges from the regen's). Runs LAST so it
    // hashes the freshly-regenerated paths.json/settings.json/hook artifacts.
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

// ── Auto-create dirs for newly-introduced path keys (G5.10c) ─
//
// A release that introduces a new directory-kind path key (e.g. a new
// runtime/state dir) must have that dir present afterward, or the
// path-resolution post-check / first feature use trips on a missing path. The
// fresh installer creates these; update did not. After apply (paths.json is
// freshly regenerated), read the target's paths.registry.json and mkdir every
// kind=dir key whose introducedIn === the version we just applied. Scoped to
// NEWLY-introduced keys so we never fabricate dirs the operator deleted on
// purpose from older releases (those are runtime/generated and lazily
// recreated by their owners). Best-effort; returns the created list.
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
      /* best-effort */
    }
  }
  return { created };
}

async function run(opts) {
  const target = opts.to;
  const apply = !!opts.apply;
  const dryRun = !!opts.dryRun || !apply;

  // Resolve source/target roots. Defaults to self-update against REPO_ROOT.
  let sourceRoot = opts.source ? path.resolve(opts.source) : REPO_ROOT;
  const targetRoot = opts.target ? path.resolve(opts.target) : REPO_ROOT;

  // 0.4.1: if --source wasn't passed AND the target capsule isn't in the
  // local REPO_ROOT, walk sibling clones / manifest hint to find a canonical
  // that has it. This makes `/mc:update --to <v>` work in product repos
  // that have a sibling MC clone without forcing the user to remember
  // --source. Honours --no-discover to disable.
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

  // ── G5.2 consumer re-baseline (apply-only; before classify + preflight) ──
  //
  // --reconcile-baseline (alias --accept-local-drift): a consumer with
  // legitimate local framework edits is otherwise blocked by (a) the
  // manifest-honesty preflight gate (installedHash ≠ on-disk hash) and (b) a
  // wall of MERGE_CONFLICT classifications. This re-hashes the target's
  // framework-installed.json#assets[] against current disk bytes IN PLACE,
  // accepting local state as the new baseline. Runs the TARGET's own
  // snapshot-installed.js (self-targets via __dirname/../..), falling back to
  // the source copy for the self-update case. We re-read `installed` after, so
  // classify() and the snapshot below all see the reconciled baseline.
  //
  // Mutates disk → apply-mode only. Fail-closed: if the operator asked to
  // reconcile and it errors, refuse to proceed (a silent skip would leave a
  // stale baseline and defeat the intent). No-op in dry-run.
  if (opts.reconcileBaseline && apply) {
    const targetSnap = path.join(
      targetRoot,
      "scripts",
      "mc",
      "snapshot-installed.js",
    );
    const snapScript = fs.existsSync(targetSnap)
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
    // Re-read so downstream classify/snapshot see the reconciled hashes.
    installed = readJSON(installedFile, installed);
  }

  const capsule = loadCapsule(sourceRoot, target);
  if (capsule.release.version !== target) {
    throw new Error(
      `Capsule version mismatch: requested ${target}, capsule says ${capsule.release.version}`,
    );
  }

  // Resolve sourceTreeRoot via the robust walk (capsule → repo root).
  // Honours an explicit override for unusual layouts.
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

  // ── Apply ────────────────────────────────────────────────
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

  // ── SP-005 Preflight (T-20260513-062) ───────────────────
  //
  // Run 10 gates BEFORE any file touches. Red on any gate (after override
  // consideration) refuses apply. Yellow with matching override accepted is
  // re-interpreted as green but logs overrideUsed=true. Skipped only with
  // --force-fresh which is its own gate-1 override.
  let preflightReport = null;
  if (!opts.skipPreflight) {
    // Fail-fast by default (stops at the first red — cheapest happy path).
    // --diagnostic / --all-red runs every gate up front so the operator sees
    // the complete picture in one pass without a block first.
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
      // G5.11 — enumerate EVERY red gate with its remediation, not just the
      // first. If the initial pass was fail-fast (stopped at the first red),
      // re-run once in allRed mode so the operator-facing block lists all
      // blockers + fixes in a single message. Fail-fast remains the default
      // execution behavior; only the message is made complete.
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
          // If the diagnostic re-run throws, fall back to the fail-fast report.
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
        // Return the COMPLETE report (every gate evaluated) so JSON consumers
        // and the postflight summary see all reds, not just the first.
        preflight: fullReport,
      };
    }
  }

  // ── SP-005 Transaction begin (T-20260513-062) ───────────
  //
  // beginTransaction writes header/plan/snapshot/capsule, copies pre-apply
  // backups, takes active.lock (R-32), re-runs fast preflight subset (R-33),
  // hashes the snapshot (R-31). --no-transaction skips the wrapper for
  // legacy compatibility but DOES still write a minimal txDir for the
  // existing report/result.json contract.
  let txId, txDir;
  if (opts.noTransaction) {
    // Legacy path: synthesize a txId + dir without the snapshot envelope.
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    txId = `${ts}-warp-update-${path.basename(targetRoot)}-notx`;
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
        // R-33 fast-preflight already implicitly covered by the outer
        // preflight pass above; skip if operator explicitly opted out of
        // preflight too.
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

  // ── Apply + migrations, wrapped in try/catch for rollback ─
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

    // Run migrations as part of the wrapped phase — a failed migration must
    // also roll back the file copies.
    // SP-20260524-004 — pass the set of migration ids previously applied
    // against this install so versioned migrations can skip them. Source of
    // truth is framework-installed.json#migrationsApplied; an empty/absent
    // field falls through to "nothing applied" (correct legacy behavior).
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
    // ── Rollback ──
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
        // Rollback itself failed — surface both errors.
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

  // ── GATE-B 3c (RC1, caught at the 1.1.0 mint): materialize the applied
  // capsule's own metadata. A fresh-N install carries
  // framework/releases/<to>/{checksums,framework-manifest}.json on disk, but a
  // capsule structurally cannot list its own manifest + checksums, so the
  // apply loop never delivers them — upgraded trees then diverge from fresh
  // (onlyInFreshN). Copy them from the source tree so the in-target regens
  // below see the same file-set fresh install does. FAIL-CLOSED: a missing
  // source file is a broken release layout — throw, never skip (a silent skip
  // reintroduces the divergence undetected). Idempotent: plain overwrite copy.
  for (const capsuleMetaFile of ["checksums.json", "framework-manifest.json"]) {
    const srcMeta = path.join(sourceTreeRoot, "framework", "releases", target, capsuleMetaFile);
    const dstMeta = path.join(targetRoot, "framework", "releases", target, capsuleMetaFile);
    if (!fs.existsSync(srcMeta)) {
      throw new Error(
        `mc:update: capsule metadata missing at ${srcMeta} — broken release layout (GATE-B 3c fail-closed)`,
      );
    }
    fs.mkdirSync(path.dirname(dstMeta), { recursive: true });
    fs.copyFileSync(srcMeta, dstMeta);
  }

  // ── G5.10a Regenerate owner=generated artifacts ─────────
  //
  // Run the generators against the target so .claude/paths.json, settings.json,
  // the hook wiring, lint rules, schemas, and PATH_KEYS.md are derived from the
  // target's freshly-applied SOURCES — not the source repo's stale snapshot
  // that the copy loop just laid down. Without this, postUpdateChecks fail on
  // "stale paths.json/settings.json". Best-effort; the --check gate is the
  // authority. Runs after apply, before scaffold + post-update checks.
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

  // G5.10c — materialize any directory introduced by THIS release so the
  // path-resolution post-check and first feature use don't trip on it.
  // Diagnostics go to stderr so --json stdout stays parseable.
  const newDirsResult = createNewlyIntroducedDirs(targetRoot, target);
  if (newDirsResult.created.length > 0) {
    process.stderr.write(
      `mc:update: created ${newDirsResult.created.length} newly-introduced dir(s): ${newDirsResult.created.join(", ")}\n`,
    );
  }

  // SP-20260525-024 (downstream content-gap fix; OPEN_ADR — changes update
  // semantics): /mc:update must also scaffold the structure-parity skeleton
  // (_requirements/* zones, _docs/), ROADMAP.md, PROJECT.md, and the paths.json
  // registry backfill that fresh-install creates. These are DELIBERATELY absent
  // from the framework manifest (the capsule ships engine assets only;
  // _requirements/_docs are excluded to avoid leaking MC's own product
  // canon — generate-framework-manifest.js:164). Without this, consumers never
  // receive the skeleton/ROADMAP/PROJECT on update — they only got them on a
  // fresh install. scaffoldProduct is idempotent (skip-if-present; never
  // clobbers operator paths.json values) + fail-open. Runs BEFORE the
  // post-update checks so structure-parity sees the freshly-scaffolded dirs.
  // Diagnostics to stderr so --json stdout stays parseable (the run result is
  // the only thing on stdout in --json mode).
  const scaffoldLog = (...a) =>
    process.stderr.write(`mc:update: scaffold — ${a.filter(Boolean).join(" ")}\n`);
  try {
    const scaffoldCore = require("./scaffold-core");
    if (scaffoldCore && typeof scaffoldCore.scaffoldProduct === "function") {
      scaffoldCore.scaffoldProduct({
        target: targetRoot,
        mcRoot: sourceTreeRoot,
        // scaffold-core's log signature is (status, message); accept any arity.
        log: scaffoldLog,
      });
    }
  } catch (err) {
    console.warn(
      `mc:update: scaffold-core skipped (${err.message}) — structure skeleton/ROADMAP/PROJECT may be incomplete.`,
    );
  }

  // Restamp the project manifest's framework-managed mc.version to the update TARGET — symmetric
  // with fresh-install stamping. scaffoldProduct above does blocks A+B+C but NOT the manifest, which is
  // a project-owned identity card written once at install; without this its mc.version stays at the
  // install-era version while version.json advances (scan:install version-match FAIL). Pass `target`
  // explicitly so the restamp is independent of __dirname/version.json resolution.
  try {
    const sc = require("./scaffold-core");
    if (sc && typeof sc.writeProductManifest === "function") {
      sc.writeProductManifest({ target: targetRoot, mcVersion: target, log: scaffoldLog });
    }
  } catch (err) {
    console.warn(`mc:update: manifest mc.version restamp skipped (${err.message}).`);
  }

  // (a1) ED-264 / GATE-B 3c: framework-manifest.json is reconverged by generate-framework-manifest.js in
  // runGenerators above (IN-TARGET regen, symmetric with fresh-install's install.ps1 — a capsule-snapshot
  // COPY diverges from fresh's regenerated asset-sha list).

  // SP-20260525-024: also refresh the _mc/ framework SOURCE mirror on update,
  // not just fresh install. populateWarposMirror is content-addressed + idempotent
  // and is explicitly "the migration path for existing products" (scaffold-core.js)
  // — without it, consumers on the old root-copy model never gain _mc/, and
  // regenerate.js stays inert there. Fail-open; separate try so a mirror error
  // can't undo the scaffold above.
  try {
    const scaffoldCore = require("./scaffold-core");
    if (scaffoldCore && typeof scaffoldCore.populateWarposMirror === "function") {
      scaffoldCore.populateWarposMirror({
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

  // (a2 → EXPANSION: ED-264 / GATE-B 3c SYSTEMIC reconvergence): REGENERATE _mc/MANIFEST.json in-target
  // instead of hand-patching only mcVersion. The prior surgical patch fixed the version FIELD but left the
  // per-asset sha256/installedSha LIST STALE — it carried the N-1 capsule's manifest, NOT the freshly-mirrored
  // on-disk _mc/ sources populateWarposMirror just laid down (GATE-B 3c ground truth: identical _mc/
  // source files, divergent MANIFEST sha lists → the hand-patch never recomputed them). A fresh-N install builds
  // this manifest by running scripts/mc/manifest/build.js against the target
  // (scaffold-core#regenerateWarposManifest, invoked from its CLI); running the SAME function here makes the
  // upgraded MANIFEST byte-symmetric with fresh. Both design cautions: PRODUCT-mode (--source-prefix _mc —
  // the classifier path fresh exercises, install-matrix-tested) and mcVersion read from the TARGET's own
  // version.json (manifest/build.js default; never a passed-in literal that can drift). mcRoot=targetRoot →
  // the reconvergence loads the freshly-applied target's own build.js (IN-TARGET, consistent with runGenerators),
  // and manifest/build.js output is deterministic on (--root, --source-prefix), so the identical copy is
  // symmetric-with-fresh. Must run AFTER populateWarposMirror (mirror source must exist first). Fail-open — the
  // post-update --check gate is the authority on acceptability.
  try {
    const sc = require("./scaffold-core");
    if (sc && typeof sc.regenerateWarposManifest === "function") {
      sc.regenerateWarposManifest({
        target: targetRoot,
        mcRoot: targetRoot,
        log: scaffoldLog,
      });
    }
  } catch (err) {
    console.warn(`mc:update: _mc/MANIFEST regeneration skipped (${err.message}).`);
  }

  // Run per-capsule post-update checks (release.json#postUpdateChecks).
  // These coexist with SP-005 postflight: capsule-declared checks fire
  // first, then the framework-side postflight composer below.
  const postUpdateResults = runPostUpdateChecks(
    capsule.release.postUpdateChecks || [],
    targetRoot,
  );

  // SP-20260523-002: If the target now has the three-layer source-of-truth
  // (`_mc/settings/defaults.json` — typically copied in during this
  // very apply pass via the framework manifest), regenerate the effective
  // `.claude/settings.json` from layered sources. Older targets without
  // defaults.json keep whatever update.js wrote directly. Fail-open.
  try {
    const settingsDefaultsFile = path.join(targetRoot, "_mc/settings/defaults.json");
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

  // Write updated installed snapshot before commit so the manifest is
  // visible to postflight (manifest-honesty would otherwise see stale state).
  // SP-20260524-004 — also pass migrationsResult + decisions so the snapshot
  // captures migrationsApplied[] (versioned migrations) + userModified[]
  // (operator-modified file tracking).
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

  // ── SP-005 Transaction commit (T-20260513-062) ──────────
  if (!opts.noTransaction) {
    transactionModule.commitTransaction(txDir, {
      apply: applyResult,
      migrations: migrationsResult,
      postUpdateChecks: postUpdateResults,
      applyDurationMs,
    });
  } else {
    // Legacy path: write our own result.json so downstream consumers still
    // see a finalized record.
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

  // Always write the human-facing ROLLBACK.md (transaction.js doesn't, by
  // design — it owns the JSON envelope, this stays as the prose copy).
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

  // ── SP-005 Postflight (T-20260513-062) ──────────────────
  //
  // Runs 5 composed checks: manifest-honesty, path-resolution,
  // applied-migrations, provider-smoke (external), /mc:health rollup.
  // Diagnostic — does NOT roll back. Operator action surfaces in the
  // returned report. Honour --skip-postflight + --strict-postflight.
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
      // Postflight should never throw — but if it does, capture it and
      // continue rather than masking a successful commit.
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

  // Strict postflight: a red in postflight makes the overall update fail
  // even though apply + commit succeeded. Operator opt-in only.
  const strictBlock =
    !!opts.strictPostflight &&
    postflightReport &&
    postflightReport.redCount > 0;

  const postCheckFailed = postUpdateResults.some((c) => c.status === "failed");

  // Update overall ok with migration + post-check results
  const allOk =
    applyResult.ok &&
    migrationsResult.status !== "failed" &&
    !postCheckFailed &&
    !strictBlock;

  // G5.10b — honest outcome labeling. We are PAST commit here: the transaction
  // committed, framework-installed.json was updated, the files are on disk. If
  // ok is false at this point it is NOT a rollback — apply + migrations
  // succeeded and only a POST-update check (capsule postUpdateChecks or, under
  // --strict-postflight, a postflight red) failed. Distinguish that from a
  // real failure so the CLI doesn't print "Update failed." (which implies a
  // rollback that did NOT happen). The auto-rollback paths above return their
  // own "APPLY ROLLED BACK" errors and never reach here.
  const committedButPostCheckFailed = !allOk; // (apply/migration already ok)
  const outcome = allOk
    ? "committed"
    : "committed-with-postcheck-warnings";

  return {
    ok: allOk,
    // `committed` is true whenever we reached this return — the files landed
    // and the install version moved, regardless of post-check verdict. Callers
    // use it to phrase messaging honestly.
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

// ── Manual rollback CLI handler ──────────────────────────────────
//
// Companion to the auto-rollback inside run() (which fires on any apply or
// migration error). The operator surface exists because:
//   - ROLLBACK.md inside every txDir already advertises this command.
//   - Postflight red with --strict-postflight surfaces the txId but doesn't
//     auto-rollback (postflight is diagnostic by contract).
//
// Usage:
//   node scripts/mc/update.js --rollback <txId>
//   node scripts/mc/update.js --rollback=<txId>
//   node scripts/mc/update.js --rollback <txId> --target <install-path>
//   node scripts/mc/update.js --rollback <txId> --json
//
// Exit codes:
//   0  — full rollback (no partial, no error)
//   1  — partial rollback (some entries restored, some failed)
//   4  — txDir not found / invalid txId
//   5  — rollback threw (e.g. snapshot hash mismatch — R-31)
function runRollbackCli(txId, opts) {
  // paths.mcTransactionsDir = .mc/transactions (relative to target).
  const targetRoot = opts.target ? path.resolve(opts.target) : REPO_ROOT;
  const txDir = path.join(targetRoot, ".mc", "transactions", txId);
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
  // Refuse to rollback a txDir that was created with --no-transaction (it has
  // no snapshot envelope; rollbackTransaction would fail with a worse error).
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

/**
 * /mc:update --status — manifest validator wired as a per-file table.
 *
 * SP-20260522-005 / T-20260523-195. Read-only diagnostic: spawns
 * scripts/mc/manifest/validate.js --json, renders the findings as a
 * table grouped by class (drift / missing / unmanifested / user_modified
 * / schema_violation), reports ownerCounts, and exits 0 when clean / 1
 * when any finding present (mirrors validate --strict semantics for
 * scripting).
 *
 * Flags honored: --target <dir> (default: REPO_ROOT), --json (pass through
 * validator JSON), --strict (override: even soft user_modified findings
 * → exit 1).
 */
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
    // Fall back to canonical script if target install lacks it.
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
  // --status exits 1 if ANY findings present (not just strict-class findings).
  // The --strict flag changes the validator's per-finding severity, not the
  // top-level exit policy. /mc:update --status is a maintainer diagnostic:
  // "anything to look at?" → non-zero answer wakes up CI.
  const findingsForExit = parsed.findings || {};
  const totalFindingsForExit = Object.values(findingsForExit).reduce(
    (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
    0,
  );
  if (opts.json) {
    // Pass through validator JSON augmented with mode tag.
    console.log(JSON.stringify({ mode: "status", ...parsed }, null, 2));
    process.exit(totalFindingsForExit === 0 ? 0 : 1);
  }
  // Human-readable per-file table.
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
      // Items may be strings (paths) or objects with path/detail.
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
  // Support both --rollback <txId> (positional) and --rollback=<txId>.
  const getEqOrPositional = (flag) => {
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
      if (args[i] === flag) return args[i + 1] || null;
    }
    return null;
  };
  // ── Early branch: --status ──
  // Read-only validator wrapper. Renders manifest validate.js --json as a
  // per-file table. Honours --target / --json / --strict. Never falls
  // through to the update flow.
  if (args.includes("--status")) {
    runStatusCli({
      target: get("--target"),
      json: args.includes("--json"),
      strict: args.includes("--strict"),
    });
    return;
  }
  // ── Early branch: --rollback <txId> ──
  // Runs the manual rollback handler, never falls through to the normal
  // update flow. Honours --target and --json; ignores --to/--apply/etc.
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
    return; // unreachable — runRollbackCli always exits — but keeps lint honest.
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
    // Legacy: --source-root pointed at the source tree directly. Kept for
    // back-compat. Prefer --source.
    sourceRoot: get("--source-root"),
    // SP-005 tri-pillar flags (T-20260513-062):
    // --force-fresh           Preflight: accept yellow on install-baseline (treat as fresh install)
    // --allow-stale           Preflight: accept yellow on staleness
    // --allow-version-drift   Preflight: accept yellow on version-quorum
    // --skip-preflight        Bypass the preflight composer entirely (NOT recommended)
    // --no-transaction        Skip the transaction wrapper (legacy compatibility)
    // --skip-postflight       Skip the postflight composer (suppresses 5 diagnostic checks)
    // --strict-postflight     Treat any postflight red as a non-zero exit
    forceFresh: args.includes("--force-fresh"),
    allowStale: args.includes("--allow-stale"),
    allowVersionDrift: args.includes("--allow-version-drift"),
    skipPreflight: args.includes("--skip-preflight"),
    noTransaction: args.includes("--no-transaction"),
    skipPostflight: args.includes("--skip-postflight"),
    strictPostflight: args.includes("--strict-postflight"),
    // G5.2 — re-hash the target's installed baseline against current disk
    // before preflight, so a consumer with legitimate framework drift can
    // update. --accept-local-drift is the operator-intent alias.
    reconcileBaseline:
      args.includes("--reconcile-baseline") ||
      args.includes("--accept-local-drift"),
    // G5.11 — evaluate every preflight gate in one pass (no fail-fast stop)
    // so a block message lists all reds up front. --all-red is the alias used
    // by preflight.js's own CLI.
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
        // SP-20260721-001 D-4 INC-3 (BC-16 lying-diagnostic fix) — the --json
        // path used to `return` here with NO exit code, so a !r.ok run
        // (ESCALATE / PREFLIGHT BLOCKED / any error) silently exited 0. Honor
        // the SAME failure semantics the non-json path already uses below
        // (exits 1 on !r.ok whether or not committed) — never a clean pass on
        // a failed/blocked run.
        if (!r.ok) {
          process.exit(1);
        }
        return;
      }
      // G5.10b — honest failure vs. committed-with-warnings.
      //
      // A true failure (preflight block, Class C escalation, apply/migration
      // rollback) carries r.error AND r.committed is falsy → print the error
      // and exit. A result that COMMITTED but had a post-update check fail
      // (r.committed === true, r.ok === false) is NOT a rollback: the files
      // landed and the version moved. Print the normal summary with a clear
      // "committed with post-check warnings" banner and exit 1 at the end —
      // never the misleading bare "Update failed."
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
          `Apply: added=${ac.added} repaired=${ac.updated} unchanged=${ac.unchanged || 0} conflict=${ac.merge_conflicts_held} deleted=${ac.deleted} (skipped=${ac.deletes_skipped}) backups=${ac.backups} no-op=${ac.skipped_no_op} errors=${ac.errors}`,
        );
        // SP-20260524-003 — per-file status. Print top 20 non-unchanged entries
        // by default; --verbose-files prints all. Truncation honest.
        const perFile = r.apply.perFile || [];
        const verboseFiles = process.argv.includes("--verbose-files");
        const interesting = perFile.filter((p) => p.status !== "unchanged");
        const shown = verboseFiles ? perFile : interesting.slice(0, 20);
        if (shown.length > 0) {
          console.log("");
          console.log("Per-file:");
          for (const p of shown) {
            const tag = p.status.toUpperCase().padEnd(16);
            console.log(`  ${tag} ${p.dest}${p.error ? "  [" + p.error + "]" : ""}`);
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
        // SP-005 preflight summary
        if (r.preflight) {
          console.log(
            `Preflight: ${r.preflight.greenCount}/${r.preflight.gateCount} GREEN, ${r.preflight.redCount} RED, ${r.preflight.yellowCount} YELLOW, ${r.preflight.degradedCount} DEGRADED`,
          );
        }
        // SP-005 postflight summary
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
      // G5.10b — a committed-with-postcheck-warnings result still exits
      // non-zero (the post-check verdict matters for CI/scripting) but only
      // after the honest summary above, never via the bare "Update failed."
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
  findRepoRootFromCapsule,
  discoverCanonical,
  loadCapsule,
  runStatusCli,
};
