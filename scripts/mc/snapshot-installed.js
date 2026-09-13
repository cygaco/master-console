#!/usr/bin/env node
/**
 * snapshot-installed.js - writes .claude/framework-installed.json for the
 * source repository itself without running the fresh installer over the tree.
 *
 * The installer writes this file for downstream projects. The MC dev repo
 * also needs a snapshot so /warp:update can classify local assets against the
 * current baseline instead of treating every framework file as local-only.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
// SP-20260514-001 R-1 / T-20260514-071 — full 64-char sha256, LF-normalized
// for text assets and raw for binary. Matches the semantics
// generate-framework-manifest.js writes to the capsule.
const cHash = require("./lib/content-hash");

const ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_FILE = path.join(ROOT, ".claude", "framework-manifest.json");
const OUT_FILE = path.join(ROOT, ".claude", "framework-installed.json");
const INSTALLED_FILE = OUT_FILE; // alias: framework-installed.json is both in/out

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file, dest) {
  if (cHash.isTextAsset(dest || file)) {
    return cHash.contentHash(file, { text: true });
  }
  return cHash.rawHash(file);
}

function flattenAssets(manifest) {
  const out = [];
  for (const [kind, assets] of Object.entries(manifest.assets || {})) {
    for (const asset of assets || [])
      out.push({ ...asset, kind: asset.kind || kind });
  }
  return out;
}

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function buildSnapshot() {
  const manifest = readJson(MANIFEST_FILE);
  const installedAssets = [];
  for (const asset of flattenAssets(manifest)) {
    const abs = path.join(ROOT, asset.dest || asset.src);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const hash = sha256File(abs, asset.dest || asset.src);
    installedAssets.push({
      id: asset.id,
      kind: asset.kind,
      dest: asset.dest || asset.src,
      owner: asset.owner || "framework",
      mergeStrategy:
        asset.mergeStrategy || asset.merge || "replace_if_unmodified",
      installedHash: hash,
      currentHashAtInstall: hash,
      introducedIn: asset.introducedIn || manifest.version || "0.0.0",
    });
  }

  return {
    $schema: "mc/framework-installed/v2",
    installedVersion: manifest.version,
    installedCommit: gitCommit(),
    installedAt: new Date().toISOString(),
    source: "self",
    target: ".",
    // Derive from the actual paths.json being snapshotted (build.js stamps it
    // from framework/paths.registry.json#version) — never hardcode, or it drifts
    // from the schema like the v4-while-content-is-v5 bug (fixed 2026-05-30).
    pathRegistryVersion: (() => {
      try {
        return (
          (readJson(path.join(ROOT, ".claude", "paths.json"))["$schema"] || "")
            .split("/")
            .pop() || "v5"
        );
      } catch {
        return "v5";
      }
    })(),
    manifestSchema: manifest.$schema || "mc/framework-manifest/v2",
    assets: installedAssets,
    generated: (manifest.generated_files || []).map((f) => f.dest),
  };
}

/**
 * G5.2 — consumer-side re-baseline.
 *
 * A consumer install has `.claude/framework-installed.json` (written by the
 * installer) but typically does NOT have `.claude/framework-manifest.json`
 * (the full asset manifest is a dev-repo artifact; consumers receive the
 * capsule + installed snapshot, not the source manifest). Without the
 * manifest, buildSnapshot() can't run and the old code exit(2)'d — leaving a
 * consumer with legitimate framework drift unable to re-baseline so that
 * /warp:update's preflight (manifest-honesty gate) would pass.
 *
 * This re-hashes every asset already listed in framework-installed.json
 * against the current on-disk bytes, using the SAME content-hash semantics
 * the honesty check uses (contentHash{text:true} for text assets by
 * extension, rawHash otherwise — see sha256File above), and rewrites
 * installedHash + currentHashAtInstall in place. Assets whose file is missing
 * on disk are left untouched (their absence is a real finding the honesty
 * check should still surface). Returns a summary for the CLI.
 */
function rebaselineFromInstalled() {
  const installed = readJson(INSTALLED_FILE);
  const assets = Array.isArray(installed.assets) ? installed.assets : [];
  let rehashed = 0;
  let missing = 0;
  let unchanged = 0;
  for (const a of assets) {
    const rel = a.dest || a.src;
    if (!rel) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      missing++;
      continue;
    }
    const hash = sha256File(abs, rel);
    if (a.installedHash === hash) {
      unchanged++;
    } else {
      rehashed++;
    }
    a.installedHash = hash;
    a.currentHashAtInstall = hash;
  }
  // Record that this snapshot was reconciled against local drift, so the
  // provenance is auditable (distinct from a clean install snapshot).
  installed.rebaselinedAt = new Date().toISOString();
  installed.rebaselineSource = "local-disk (--reconcile-baseline)";
  return { installed, rehashed, missing, unchanged, total: assets.length };
}

function main() {
  const check = process.argv.includes("--check");
  if (!fs.existsSync(MANIFEST_FILE)) {
    // Consumer fallback (G5.2): no source manifest, but an installed snapshot
    // exists → re-hash assets in place against disk instead of failing.
    if (fs.existsSync(INSTALLED_FILE)) {
      if (check) {
        // --check is a "is the snapshot fresh?" probe. Without a manifest we
        // can't compare asset COUNT to source; report ok if the file parses
        // and carries the expected schema. Re-baseline is the write path.
        try {
          const existing = readJson(INSTALLED_FILE);
          const ok =
            existing.$schema === "mc/framework-installed/v2" &&
            Array.isArray(existing.assets);
          if (!ok) {
            console.error(
              "snapshot-installed: installed snapshot malformed (no manifest to validate against)",
            );
            process.exit(1);
          }
          console.log(
            `snapshot-installed: ok (consumer; ${existing.assets.length} assets; no manifest — cannot verify staleness)`,
          );
          process.exit(0);
        } catch (e) {
          console.error(
            `snapshot-installed: failed to read installed snapshot: ${e.message}`,
          );
          process.exit(1);
        }
      }
      const r = rebaselineFromInstalled();
      fs.writeFileSync(
        INSTALLED_FILE,
        JSON.stringify(r.installed, null, 2) + "\n",
        "utf8",
      );
      console.log(
        `snapshot-installed: re-baselined consumer snapshot in place (${r.rehashed} hash(es) updated, ${r.unchanged} unchanged, ${r.missing} missing on disk, ${r.total} total). No framework-manifest.json — used framework-installed.json#assets[].`,
      );
      process.exit(0);
    }
    console.error(
      "snapshot-installed: missing .claude/framework-manifest.json (and no .claude/framework-installed.json to re-baseline from)",
    );
    process.exit(2);
  }
  const snapshot = buildSnapshot();
  const body = JSON.stringify(snapshot, null, 2) + "\n";

  if (check) {
    if (!fs.existsSync(OUT_FILE)) {
      console.error(
        "snapshot-installed: .claude/framework-installed.json missing",
      );
      process.exit(1);
    }
    const existing = readJson(OUT_FILE);
    const ok =
      existing.$schema === "mc/framework-installed/v2" &&
      existing.installedVersion === snapshot.installedVersion &&
      Array.isArray(existing.assets) &&
      existing.assets.length === snapshot.assets.length;
    if (!ok) {
      console.error(
        "snapshot-installed: installed snapshot is stale or malformed",
      );
      process.exit(1);
    }
    console.log(`snapshot-installed: ok (${existing.assets.length} assets)`);
    process.exit(0);
  }

  fs.writeFileSync(OUT_FILE, body, "utf8");
  console.log(
    `snapshot-installed: wrote .claude/framework-installed.json (${snapshot.assets.length} assets)`,
  );
}

main();
