#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CLAUDE_PREFIX = ".claude/";
const MC_PREFIX = "_mc/";

function isFrameworkViewDest(dest) {
  if (!dest || !dest.startsWith(CLAUDE_PREFIX)) return null;
  if (dest.startsWith(".claude/commands/") && dest.endsWith(".md")) return dest;
  if (dest.startsWith(".claude/project/reference/")) return dest;
  if (dest.startsWith(".claude/kernel/")) return dest;
  if (dest.startsWith(".claude/schemas/")) return dest;
  if (
    dest.startsWith(".claude/agents/") &&
    dest.endsWith(".md") &&
    !dest.includes("/_system/policy/decision-policy.md")
  ) {
    return dest;
  }
  if (
    dest.startsWith(".claude/agents/") &&
    dest.includes("/_system/") &&
    (dest.endsWith(".json") || dest.endsWith(".schema.json"))
  ) {
    return dest;
  }
  if (/^\.claude\/agents\/_(org|principles|evals)\//.test(dest)) return dest;
  return null;
}

function destToMirrorRel(dest) {
  return MC_PREFIX + dest.slice(CLAUDE_PREFIX.length);
}

function sha256OfFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sha256OfBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function copyIfChanged(srcAbs, destAbs) {
  if (!fs.existsSync(srcAbs)) return "missing_source";
  const srcBuf = fs.readFileSync(srcAbs);
  if (fs.existsSync(destAbs)) {
    try {
      if (sha256OfFile(destAbs) === sha256OfBuffer(srcBuf)) return "unchanged";
    } catch {
    }
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.writeFileSync(destAbs, srcBuf);
  return "copied";
}

function populateSource(opts) {
  const targetRoot = path.resolve(opts.targetRoot);
  const mcRoot = path.resolve(opts.mcRoot);

  if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
    return { ok: false, code: 2, error: `target not a directory: ${targetRoot}` };
  }
  if (!fs.existsSync(mcRoot) || !fs.statSync(mcRoot).isDirectory()) {
    return { ok: false, code: 2, error: `mc root not a directory: ${mcRoot}` };
  }

  let shipManifest = opts.shipManifest;
  if (!shipManifest) {
    const mp = path.join(mcRoot, ".claude", "framework-manifest.json");
    try {
      shipManifest = JSON.parse(fs.readFileSync(mp, "utf8"));
    } catch (e) {
      return { ok: false, code: 2, error: `cannot read framework-manifest: ${e.message}` };
    }
  }

  const result = {
    ok: true,
    code: 0,
    copied: [],
    unchanged: [],
    missingSource: [],
    failed: [],
  };

  const seenMirror = new Set();
  for (const entries of Object.values(shipManifest.assets || {})) {
    for (const entry of entries) {
      const dest = entry.dest;
      if (!isFrameworkViewDest(dest)) continue;
      const mirrorRel = destToMirrorRel(dest);
      if (seenMirror.has(mirrorRel)) continue;
      seenMirror.add(mirrorRel);
      const srcAbs = path.join(mcRoot, entry.src || dest);
      const destAbs = path.join(targetRoot, mirrorRel);
      try {
        const verdict = copyIfChanged(srcAbs, destAbs);
        if (verdict === "copied") result.copied.push(mirrorRel);
        else if (verdict === "unchanged") result.unchanged.push(mirrorRel);
        else result.missingSource.push({ mirror: mirrorRel, src: entry.src || dest });
      } catch (err) {
        result.failed.push({ mirror: mirrorRel, reason: err.message });
      }
    }
  }

  const settingsRel = "_mc/settings/defaults.json";
  const settingsSrc = path.join(mcRoot, settingsRel);
  if (fs.existsSync(settingsSrc)) {
    const settingsDest = path.join(targetRoot, settingsRel);
    try {
      const verdict = copyIfChanged(settingsSrc, settingsDest);
      if (verdict === "copied") result.copied.push(settingsRel);
      else if (verdict === "unchanged") result.unchanged.push(settingsRel);
    } catch (err) {
      result.failed.push({ mirror: settingsRel, reason: err.message });
    }
  }

  result.mirroredCount = result.copied.length + result.unchanged.length;
  if (result.failed.length > 0) {
    result.ok = false;
    result.code = 1;
  }
  return result;
}

function parseArgs(argv) {
  const out = { target: null, mc: null, json: false, quiet: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--target") out.target = argv[++i];
    else if (a === "--mc") out.mc = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--quiet") out.quiet = true;
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.target) {
    process.stdout.write(
      `scripts/mc/views/populate-source.js — mirror framework source into a product's _mc/\n\n` +
        `Usage:\n  node scripts/mc/views/populate-source.js --target <product-root> [--mc <clone>] [--json] [--quiet]\n\n` +
        `--mc defaults to the clone this script lives in.\n`,
    );
    return opts.help ? 0 : 2;
  }
  const mcRoot = opts.mc || path.resolve(__dirname, "..", "..", "..");
  const r = populateSource({ targetRoot: opts.target, mcRoot });
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else if (!r.ok && r.code === 2) {
    process.stderr.write(`populate-source failed: ${r.error}\n`);
  } else if (!opts.quiet) {
    process.stdout.write(
      `populate-source: ${r.copied.length} copied, ${r.unchanged.length} unchanged, ` +
        `${r.missingSource.length} missing-source, ${r.failed.length} failed ` +
        `(mirror total: ${r.mirroredCount})\n`,
    );
    if (r.failed.length) {
      for (const f of r.failed.slice(0, 10)) {
        process.stderr.write(`  FAIL ${f.mirror}: ${f.reason}\n`);
      }
    }
  }
  return r.code || 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  populateSource,
  isFrameworkViewDest,
  destToMirrorRel,
};
