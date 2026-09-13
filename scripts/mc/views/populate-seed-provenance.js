#!/usr/bin/env node
/**
 * scripts/mc/views/populate-seed-provenance.js — write PROVENANCE markers
 * into a product's seeded `_requirements/*` + `_docs/*` skeleton zones.
 *
 * SP-20260618-001 / U2 (seed-zone provenance).
 *
 * THE GAP THIS CLOSES: scaffold-core.js seeds the structure-parity skeleton
 * (the `_requirements/*` zones + the `_docs/` brief/clone homes) as empty dirs,
 * each carrying only a bare `.gitkeep`. A bare `.gitkeep` records NOTHING about
 * where the skeleton came from. This writer augments each seed zone with a
 * `.provenance.json` marker that records:
 *   - `seeded_from` — the framework SOURCE the zone was seeded from. U1 moved the
 *     template/baseline home under `_mc/` (`_mc/templates/...` and the
 *     `_mc/BASELINE/...` snapshot of the `_requirements/_docs` skeleton). The
 *     seed zones this writer covers are the BASELINE-snapshot zones, so their
 *     source is `_mc/BASELINE/<zone>`. This writer NEVER references the old,
 *     now-deleted framework templates location — only `_mc/`.
 *   - `framework_version` — the MC version that seeded the zone.
 *   - `seeded_by` — a "seeded by /mc:setup" note.
 *
 * SIBLING TO populate-source.js (NOT merged into it): populate-source.js mirrors
 * the framework VIEW source into `_mc/` so regenerate.js does real work — a
 * different job. Keeping provenance in its own module keeps the two concerns
 * separate (β: own-the-seam, don't fork-by-overloading).
 *
 * IDEMPOTENT / skip-if-modified (same content-addressed discipline
 * populate-source.js uses):
 *   - marker MISSING            → write it.
 *   - marker present & EQUAL    → no-op (a re-run is byte-stable).
 *   - marker present & DIFFERS  → operator-modified → LEAVE untouched (preserve).
 * The writer only ever touches `.provenance.json`; every other file in a zone
 * (operator content, the `.gitkeep`) is never read or written. The marker body
 * is a pure function of (zone, version) — no wall-clock timestamp — so two runs
 * against the same inputs are byte-identical.
 *
 * PURE FUNCTION with an injectable target root (like populateSource) so the test
 * can drive it against a throwaway fixture.
 *
 * Usage (programmatic — how scaffold-core.js calls it):
 *   const { populateSeedProvenance } = require(".../views/populate-seed-provenance.js");
 *   populateSeedProvenance({ targetRoot, mcRoot, zones, log });
 *
 * Usage (CLI — for re-seeding / debugging):
 *   node scripts/mc/views/populate-seed-provenance.js \
 *     --target <product-root> [--mc <clone>] [--json]
 *
 * Exit codes: 0 = markers written / already current; 1 = write failure;
 *             2 = CLI/IO error (bad root).
 */

"use strict";

const fs = require("fs");
const path = require("path");

// The framework SOURCE root the seed zones are seeded from. U1 relocated the
// baseline snapshot of the `_requirements/_docs` skeleton here; the writer points
// every marker at `${BASELINE_PREFIX}/<zone>`. Deliberately under `_mc/` —
// the writer must never name the old, deleted templates location.
const BASELINE_PREFIX = "_mc/BASELINE";

const PROVENANCE_FILE = ".provenance.json";
const PROVENANCE_SCHEMA = "mc/seed-provenance/v1";

// Strip a leading UTF-8 BOM (PowerShell-written / fresh-migration JSON carries
// one) before JSON.parse — mirrors the inline fix in update.js.
const stripBom = (s) => (typeof s === "string" ? s.replace(/^﻿/, "") : s);

/**
 * Resolve the MC version that is seeding the zones. Prefer an explicit
 * override, then the installing SOURCE clone's version.json (the version
 * actually being installed), then the target's own, else a safe default.
 */
function resolveWarposVersion({ mcVersion, mcRoot, targetRoot }) {
  if (mcVersion && typeof mcVersion === "string") return mcVersion;
  for (const root of [mcRoot, targetRoot]) {
    if (!root) continue;
    try {
      const vj = JSON.parse(
        stripBom(fs.readFileSync(path.join(root, "version.json"), "utf8")),
      );
      if (vj && typeof vj.version === "string" && vj.version) return vj.version;
    } catch {
      /* try the next candidate */
    }
  }
  return "0.0.0";
}

/**
 * Normalize a zone path string to a forward-slash relative dir (no trailing
 * slash). Pure — the marker body depends only on (zone, version).
 */
function normalizeZone(zone) {
  return String(zone).replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * STATIC path-traversal guard (SP-20260618-001 security fix). The exported
 * writer must honor the "only within product seed zones" contract even when
 * `opts.zones` is untrusted. A seed zone is trusted ONLY when it is a relative,
 * non-traversing member of the CANONICAL allowlist (scaffold-core.SKELETON_DIRS
 * via defaultZones()) — never validated against the caller-supplied list itself.
 *
 * `zoneRel` is already normalized (forward slashes, no trailing slash). Returns
 * a human-readable reason when the zone must be REJECTED, or null when it is
 * safe to use.
 */
function zoneRejectReason(zoneRel, allowedZones) {
  if (path.isAbsolute(zoneRel)) return "absolute path not allowed";
  if (/^[A-Za-z]:/.test(zoneRel)) return "drive-qualified path not allowed";
  if (zoneRel.startsWith("/") || zoneRel.startsWith("\\")) return "rooted path not allowed";
  if (zoneRel.split("/").some((seg) => seg === "..")) {
    return "parent-traversal ('..') segment not allowed";
  }
  if (!allowedZones.has(zoneRel)) return "not a member of the canonical seed-zone allowlist";
  return null;
}

/**
 * Walk UP from `p` to the deepest path component that actually exists, so the
 * caller can realpath it BEFORE creating any new dirs. This is the seam that
 * defeats a symlink/junction escape (e.g. an existing `_docs` junction pointing
 * outside the product tree): resolving the deepest existing ancestor reveals the
 * real location, which the caller asserts stays under the real target root —
 * refusing the write WITHOUT ever creating a directory outside the tree.
 */
function deepestExistingAncestor(p) {
  let cur = path.resolve(p);
  let parent = path.dirname(cur);
  while (cur !== parent) {
    if (fs.existsSync(cur)) return cur;
    cur = parent;
    parent = path.dirname(cur);
  }
  return cur; // filesystem root
}

/**
 * The deterministic marker body for a zone. No timestamp by design — the
 * framework_version is the temporal anchor, so a re-run is byte-stable.
 */
function expectedMarker(zoneRel, version) {
  const body = {
    $schema: PROVENANCE_SCHEMA,
    zone: zoneRel,
    seeded_from: `${BASELINE_PREFIX}/${zoneRel}`,
    framework_version: version,
    seeded_by: "/mc:setup",
    note:
      "Provenance for a MC seed zone — records the framework source this " +
      "skeleton was seeded from. Safe to edit or delete; MC will not " +
      "overwrite a modified marker.",
  };
  return JSON.stringify(body, null, 2) + "\n";
}

/**
 * Resolve the default seed-zone list — the SAME list scaffold-core.js ensures.
 * Lazy require (only when zones aren't passed in) so there is no load-time
 * circular dependency: scaffold-core.js requires THIS module lazily, inside
 * scaffoldProduct, after its own module has fully loaded.
 */
function defaultZones() {
  try {
    const core = require("../scaffold-core");
    if (Array.isArray(core.SKELETON_DIRS)) return core.SKELETON_DIRS;
  } catch {
    /* fall through */
  }
  return [];
}

/**
 * populateSeedProvenance — core entry. Writes a `.provenance.json` marker into
 * each seed zone under `targetRoot`.
 *
 * @param {object}   opts
 * @param {string}   opts.targetRoot      product root (where zones live)
 * @param {string}  [opts.mcRoot]     installing source clone (for version.json)
 * @param {string[]}[opts.zones]          seed-zone dir list; defaults to
 *                                         scaffold-core's SKELETON_DIRS
 * @param {string}  [opts.mcVersion]  explicit framework version override
 * @param {function}[opts.log]            reporter log(status, msg)
 * @returns {{ok, code, version, written, unchanged, preserved, failed}}
 */
function populateSeedProvenance(opts) {
  const targetRoot = path.resolve(opts.targetRoot);
  const mcRoot = opts.mcRoot ? path.resolve(opts.mcRoot) : null;
  const log = typeof opts.log === "function" ? opts.log : () => {};

  const result = {
    ok: true,
    code: 0,
    version: null,
    written: [],
    unchanged: [],
    preserved: [],
    failed: [],
  };

  if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
    return { ...result, ok: false, code: 2, error: `target not a directory: ${targetRoot}` };
  }

  const zones = Array.isArray(opts.zones) ? opts.zones : defaultZones();
  const version = resolveWarposVersion({
    mcVersion: opts.mcVersion,
    mcRoot,
    targetRoot,
  });
  result.version = version;

  // ── Path-traversal hardening (SP-20260618-001 security fix) ──
  // Two guards, applied per zone below, so a write can NEVER land outside the
  // product seed zones — even with untrusted opts.zones or a junction on disk:
  //   (1) STATIC  — zoneRejectReason(): reject absolute / drive-qualified /
  //       '..'-bearing zones, and any zone not in the CANONICAL allowlist
  //       (scaffold-core.SKELETON_DIRS via defaultZones()), not opts.zones.
  //   (2) REALPATH — resolve the deepest EXISTING ancestor of the marker's
  //       parent and require it to stay under the real target root, defeating a
  //       symlink/junction escape without creating any dir outside the tree.
  const allowedZones = new Set(defaultZones().map(normalizeZone).filter(Boolean));
  let realTarget;
  try {
    realTarget = fs.realpathSync(targetRoot);
  } catch {
    realTarget = targetRoot;
  }
  const underRealTarget = (p) => p === realTarget || p.startsWith(realTarget + path.sep);

  for (const rawZone of zones) {
    const zoneRel = normalizeZone(rawZone);
    if (!zoneRel) continue;

    // Guard (1): static rejection — refuse before touching the filesystem.
    const rejectReason = zoneRejectReason(zoneRel, allowedZones);
    if (rejectReason) {
      result.failed.push({ zone: zoneRel, reason: rejectReason });
      continue;
    }

    const markerAbs = path.join(targetRoot, zoneRel, PROVENANCE_FILE);
    const markerDir = path.dirname(markerAbs);

    // Guard (2): realpath the deepest existing ancestor of the marker dir and
    // require it to stay under the real target root. Catches an existing
    // junction/symlink escape BEFORE any read, mkdir, or write happens.
    let realAncestor;
    try {
      realAncestor = fs.realpathSync(deepestExistingAncestor(markerDir));
    } catch (err) {
      result.failed.push({ zone: zoneRel, reason: `realpath check failed: ${err.message}` });
      continue;
    }
    if (!underRealTarget(realAncestor)) {
      result.failed.push({ zone: zoneRel, reason: "zone escapes target root" });
      continue;
    }

    const expected = expectedMarker(zoneRel, version);
    try {
      if (fs.existsSync(markerAbs)) {
        const current = fs.readFileSync(markerAbs, "utf8");
        // Equal → idempotent no-op.
        if (current === expected) {
          result.unchanged.push(zoneRel);
          continue;
        }
        // Body differs. (a3) ED-264 / GATE-B 3c: distinguish a STALE framework_version (framework-OWNED
        // field — the marker is otherwise the PRISTINE framework default at an OLDER version, so RECONVERGE
        // it to the target version) from a genuine OPERATOR modification (preserve, never clobber). A
        // pristine older-version marker EQUALS expectedMarker(zone, <its OWN recorded framework_version>).
        // Without this, an upgrade left the .provenance framework_version stale (a "1.0.0" install stamped
        // 0.17.0 across 16 zones), classified here as "operator-modified" and preserved.
        let staleFrameworkVersionOnly = false;
        try {
          const cur = JSON.parse(current);
          if (
            cur &&
            typeof cur.framework_version === "string" &&
            current === expectedMarker(zoneRel, cur.framework_version)
          ) {
            staleFrameworkVersionOnly = true;
          }
        } catch {
          /* unparseable → treat as operator-modified (preserve) */
        }
        if (staleFrameworkVersionOnly) {
          fs.writeFileSync(markerAbs, expected);
          result.written.push(zoneRel);
        } else {
          result.preserved.push(zoneRel);
        }
        continue;
      }
      fs.mkdirSync(markerDir, { recursive: true });
      fs.writeFileSync(markerAbs, expected);
      result.written.push(zoneRel);
    } catch (err) {
      result.failed.push({ zone: zoneRel, reason: err.message });
    }
  }

  if (result.failed.length > 0) {
    result.ok = false;
    result.code = 1;
  }

  log(
    result.ok ? "ok" : "warn",
    `seed-zone provenance: ${result.written.length} written, ` +
      `${result.unchanged.length} unchanged, ${result.preserved.length} preserved ` +
      `(operator-modified)${result.failed.length ? `, ${result.failed.length} failed` : ""} @ v${version}`,
  );
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { target: null, mc: null, json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--target") out.target = argv[++i];
    else if (a === "--mc") out.mc = argv[++i];
    else if (a === "--json") out.json = true;
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.target) {
    process.stdout.write(
      "scripts/mc/views/populate-seed-provenance.js — write seed-zone provenance markers\n\n" +
        "Usage:\n  node scripts/mc/views/populate-seed-provenance.js --target <product-root> [--mc <clone>] [--json]\n\n" +
        "--mc defaults to the clone this script lives in.\n",
    );
    return opts.help ? 0 : 2;
  }
  const mcRoot = opts.mc || path.resolve(__dirname, "..", "..", "..");
  const r = populateSeedProvenance({ targetRoot: opts.target, mcRoot });
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else if (!r.ok && r.code === 2) {
    process.stderr.write(`populate-seed-provenance failed: ${r.error}\n`);
  } else {
    process.stdout.write(
      `populate-seed-provenance: ${r.written.length} written, ${r.unchanged.length} unchanged, ` +
        `${r.preserved.length} preserved, ${r.failed.length} failed (v${r.version})\n`,
    );
  }
  return r.code || 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  populateSeedProvenance,
  resolveWarposVersion,
  expectedMarker,
  normalizeZone,
  BASELINE_PREFIX,
  PROVENANCE_FILE,
};
