#!/usr/bin/env node
"use strict";
/**
 * portfolio-coverage.js — S-OS-06 gate G5 (DoD line 8): classify EVERY portfolio-registry product against the
 * 1.2.0 -> 2.0.0 migration chain and write the coverage record LOCALLY.
 *
 *   node scripts/open-source/portfolio-coverage.js [--out <path>] [--json]
 *
 * Disposition per product, from its RECORDED registry version (no product repository is opened or migrated):
 *   migrates    the loader chain (scripts/mc/migrations-loader.js#listMigrationsBetween) from that version to 2.0.0
 *               includes every migrations/1.2.0-to-2.0.0/ step
 *   at-target   the recorded version is already >= 2.0.0 (nothing to migrate)
 *   not-live    no chain reaches the migration, or the version is absent / not semver — recorded WITH its registry
 *               line (local paths + remote URLs redacted) so a later registry change makes the record stale
 *
 * LEAK BOUNDARY: the record names the operator's private portfolio products. It is written to a GITIGNORED path
 * (default runtime/S-OS-06/portfolio-coverage.json, see the S-OS-06 entry in .gitignore) and is never committed.
 * This generator REFUSES to write inside the repository to any path git would track (git check-ignore, fail-closed).
 *
 * Registry: scripts/portfolio/registry.js#registryPath — the HOME read-both resolution (~/.mc/portfolio.json, else an
 * existing legacy registry; the MC_ override wins). No registry on this machine -> nothing is written and the reason
 * is printed: downstream-product coverage is not applicable there. A registry that lists ZERO products is refused
 * (exit 1) — a zero-product record would be a vacuous coverage claim.
 *
 * Exit: 0 written, or not applicable (no registry) · 1 refused (tracked output path / zero products) · 2 error.
 * Enforcer: tests/regression/S-OS-06/migration.test.js test 6 (re-derives every disposition independently).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const loader = require("../mc/migrations-loader.js");
const registry = require("../portfolio/registry.js");
const { LEGACY_PREFIX } = require("../hooks/lib/mc-env.js");

const SCHEMA_ID = "mc/portfolio-coverage/v1";
const FROM_VERSION = "1.2.0";
const TARGET_VERSION = "2.0.0";
const MIGRATION_DIR = `migrations/${FROM_VERSION}-to-${TARGET_VERSION}/`;
const DEFAULT_OUT_REL = "runtime/S-OS-06/portfolio-coverage.json";
// The registry's pre-rename version field, derived from the one legacy prefix in mc-env (no second legacy literal).
const LEGACY_VERSION_KEY = `${LEGACY_PREFIX.slice(0, -1).toLowerCase()}_version`;
const REDACTED_KEYS = new Set(["repo_path", "github_url"]);

const toPosix = (p) => String(p).split(path.sep).join("/");

function parseSemver(v) {
  const m = typeof v === "string" ? v.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The product's recorded framework version (current field first, then the pre-rename field), or null. */
function recordedVersion(entry) {
  return (entry && (entry.mc_version || entry[LEGACY_VERSION_KEY])) || null;
}

/** A registry entry as a stable one-line record: keys sorted, local paths / remote URLs redacted. */
function registryLine(entry) {
  const out = {};
  for (const k of Object.keys(entry).sort()) out[k] = REDACTED_KEYS.has(k) && entry[k] != null ? "<redacted>" : entry[k];
  return JSON.stringify(out);
}

/** The migration's own step files, repo-relative posix. */
function migrationSteps(root = REPO_ROOT) {
  return loader.listMigrations(FROM_VERSION, TARGET_VERSION).map((f) => toPosix(path.relative(root, f)));
}

/** One product's disposition. */
function classifyProduct(entry, { root = REPO_ROOT, steps = migrationSteps(root) } = {}) {
  const version = recordedVersion(entry);
  if (!parseSemver(version)) {
    return { disposition: "not-live", version, reason: "registry version is absent or not semver — no migration chain can be walked", registryLine: registryLine(entry) };
  }
  if (compareSemver(version, TARGET_VERSION) >= 0) {
    return { disposition: "at-target", version, reason: `recorded version ${version} is already >= ${TARGET_VERSION}` };
  }
  const chain = loader.listMigrationsBetween(version, TARGET_VERSION).map((f) => toPosix(path.relative(root, f)));
  if (steps.length > 0 && steps.every((f) => chain.includes(f))) {
    return { disposition: "migrates", version, reason: `the loader chain from ${version} reaches ${MIGRATION_DIR}`, chain };
  }
  return {
    disposition: "not-live",
    version,
    reason: `no migration chain from ${version} reaches ${MIGRATION_DIR} (chain walked ${chain.length} step file(s))`,
    registryLine: registryLine(entry),
  };
}

function displayPath(p) {
  const home = os.homedir();
  return home && path.resolve(p).startsWith(path.resolve(home) + path.sep) ? `~/${toPosix(path.relative(home, p))}` : toPosix(p);
}

/**
 * Read the registry and classify every product. -> { present: false, registryPath } when no registry exists, else the
 * coverage record { schema, present: true, registry, migration, counts, products }.
 */
function buildCoverage({ registryPath = registry.registryPath(), root = REPO_ROOT } = {}) {
  if (!fs.existsSync(registryPath)) return { present: false, registryPath: displayPath(registryPath) };
  const doc = JSON.parse(fs.readFileSync(registryPath, "utf8").replace(/^﻿/, ""));
  const steps = migrationSteps(root);
  const products = {};
  const counts = { products: 0, migrates: 0, "at-target": 0, "not-live": 0 };
  for (const slug of Object.keys((doc && doc.products) || {}).sort()) {
    const rec = classifyProduct(doc.products[slug], { root, steps });
    products[slug] = rec;
    counts.products += 1;
    counts[rec.disposition] += 1;
  }
  return {
    schema: SCHEMA_ID,
    present: true,
    $leakBoundary: "names private portfolio products — gitignored, never committed",
    registry: displayPath(registryPath),
    migration: MIGRATION_DIR,
    migrationSteps: steps,
    counts,
    products,
  };
}

/** True iff git would never track `outAbs` in `root` (outside the repository, or ignored). Fail-closed on git errors. */
function outputIsUntrackable(outAbs, root = REPO_ROOT) {
  const rel = path.relative(root, outAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return true;
  const r = spawnSync("git", ["-C", root, "check-ignore", "-q", "--", toPosix(rel)], { encoding: "utf8" });
  return r.status === 0;
}

/**
 * Build the coverage and write it to `out`. -> { written, reason, coverage, out }.
 * Not applicable (no registry) and refusals write nothing.
 */
function writeCoverage({ registryPath, out = path.join(REPO_ROOT, ...DEFAULT_OUT_REL.split("/")), root = REPO_ROOT } = {}) {
  const outAbs = path.resolve(out);
  const coverage = buildCoverage({ registryPath: registryPath === undefined ? registry.registryPath() : registryPath, root });
  if (!coverage.present) {
    return { written: false, refused: false, out: outAbs, coverage, reason: `no portfolio registry on this machine (${coverage.registryPath}) — downstream-product coverage not applicable here` };
  }
  if (coverage.counts.products === 0) {
    return { written: false, refused: true, out: outAbs, coverage, reason: `the portfolio registry (${coverage.registry}) lists zero products — a zero-product coverage record would be vacuous` };
  }
  if (!outputIsUntrackable(outAbs, root)) {
    return { written: false, refused: true, out: outAbs, coverage, reason: `${toPosix(path.relative(root, outAbs))} is not gitignored — the coverage record names private products and must never be committable` };
  }
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(coverage, null, 2) + "\n");
  return { written: true, refused: false, out: outAbs, coverage, reason: "written" };
}

function main(argv) {
  const i = argv.indexOf("--out");
  const out = i === -1 ? undefined : argv[i + 1];
  if (i !== -1 && !out) {
    process.stderr.write("usage: node scripts/open-source/portfolio-coverage.js [--out <path>] [--json]\n");
    return 2;
  }
  let r;
  try {
    r = writeCoverage(out ? { out } : {});
  } catch (e) {
    process.stderr.write(`portfolio-coverage: error: ${e.message}\n`);
    return 2;
  }
  const c = r.coverage.counts;
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ written: r.written, refused: r.refused, reason: r.reason, counts: c || null }) + "\n");
  } else if (r.written) {
    process.stdout.write(`portfolio-coverage: ${c.products} product(s) classified — migrates=${c.migrates} at-target=${c["at-target"]} not-live=${c["not-live"]} -> ${displayPath(r.out)} (gitignored)\n`);
  } else {
    process.stdout.write(`portfolio-coverage: ${r.refused ? "REFUSED" : "NOT APPLICABLE"}: ${r.reason}\n`);
  }
  return r.refused ? 1 : 0;
}

module.exports = {
  SCHEMA_ID,
  MIGRATION_DIR,
  DEFAULT_OUT_REL,
  recordedVersion,
  registryLine,
  classifyProduct,
  buildCoverage,
  outputIsUntrackable,
  writeCoverage,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
