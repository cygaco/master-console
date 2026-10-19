#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const BASELINE_PREFIX = "_mc/BASELINE";

const PROVENANCE_FILE = ".provenance.json";
const PROVENANCE_SCHEMA = "mc/seed-provenance/v1";

const stripBom = (s) => (typeof s === "string" ? s.replace(/^﻿/, "") : s);

function resolveMcVersion({ mcVersion, mcRoot, targetRoot }) {
  if (mcVersion && typeof mcVersion === "string") return mcVersion;
  for (const root of [mcRoot, targetRoot]) {
    if (!root) continue;
    try {
      const vj = JSON.parse(
        stripBom(fs.readFileSync(path.join(root, "version.json"), "utf8")),
      );
      if (vj && typeof vj.version === "string" && vj.version) return vj.version;
    } catch {
    }
  }
  return "0.0.0";
}

function normalizeZone(zone) {
  return String(zone).replace(/\\/g, "/").replace(/\/+$/, "");
}

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

function deepestExistingAncestor(p) {
  let cur = path.resolve(p);
  let parent = path.dirname(cur);
  while (cur !== parent) {
    if (fs.existsSync(cur)) return cur;
    cur = parent;
    parent = path.dirname(cur);
  }
  return cur;
}

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

function defaultZones() {
  try {
    const core = require("../scaffold-core");
    if (Array.isArray(core.SKELETON_DIRS)) return core.SKELETON_DIRS;
  } catch {
  }
  return [];
}

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
  const version = resolveMcVersion({
    mcVersion: opts.mcVersion,
    mcRoot,
    targetRoot,
  });
  result.version = version;

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

    const rejectReason = zoneRejectReason(zoneRel, allowedZones);
    if (rejectReason) {
      result.failed.push({ zone: zoneRel, reason: rejectReason });
      continue;
    }

    const markerAbs = path.join(targetRoot, zoneRel, PROVENANCE_FILE);
    const markerDir = path.dirname(markerAbs);

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
        if (current === expected) {
          result.unchanged.push(zoneRel);
          continue;
        }
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
  resolveMcVersion,
  expectedMarker,
  normalizeZone,
  BASELINE_PREFIX,
  PROVENANCE_FILE,
};
