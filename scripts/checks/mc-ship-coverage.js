#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.argv.includes("--root")
  ? path.resolve(process.argv[process.argv.indexOf("--root") + 1])
  : process.cwd();
const JSON_OUT = process.argv.includes("--json");

const KNOWN_DANGLING_SET = new Set([]);

const KNOWN_NOT_SHIPPED = [
  { prefix: "_mc/MANIFEST.json", reason: "build-output ownership manifest, not shipped from canonical" },
  { prefix: "install.ps1", reason: "the installer itself (consumers run it, don't receive a copy via manifest)" },
  { prefix: "package.json", reason: "framework-dev metadata" },
  { prefix: "package-lock.json", reason: "framework-dev metadata" },
  { prefix: "README.md", reason: "framework-repo readme; consumers get their own scaffolded PROJECT.md/README" },
  { prefix: "CLAUDE.md", reason: "merged separately by /mc:setup CLAUDE.md merge, not a manifest asset" },
  { prefix: "version.json", reason: "shipped as version_file (separate manifest section), not an asset dir" },

  { prefix: ".gitattributes", reason: "framework-repo git config — dev-tooling, not shipped to consumers" },
  { prefix: "PROJECT.md", reason: "framework-repo project doc — dev-tooling; consumers get their own scaffolded PROJECT.md" },
  { prefix: "RELEASES.md", reason: "framework-repo release notes — dev-tooling, not shipped to consumers" },
  { prefix: "ROADMAP.md", reason: "framework-repo roadmap — dev-tooling, not shipped to consumers" },
  { prefix: "USER_GUIDE.md", reason: "framework-repo user guide — dev-tooling; consumers get per-product docs" },

  {
    match: (p) => /^scripts\/[^/]+\.js$/.test(p),
    reason: "top-level framework-dev tooling scripts (orchestrators/analyzers/dashboards) — not consumer assets",
  },

  { prefix: "scripts/arbitration/", reason: "framework-internal arbitration module — dev-tooling, not shipped" },
  { prefix: "scripts/contracts/", reason: "framework-internal contract validation module + fixtures — dev-tooling, not shipped" },
  { prefix: "scripts/etc/", reason: "framework-internal etc harness module — dev-tooling, not shipped" },
  { prefix: "scripts/growth/", reason: "framework-internal growth analytics scripts — dev-tooling, not shipped" },
  { prefix: "scripts/guides/", reason: "framework-internal guide registry scripts — dev-tooling, not shipped" },
  { prefix: "scripts/models/", reason: "framework-internal model check scripts — dev-tooling, not shipped" },
  { prefix: "scripts/scaffold/", reason: "framework-internal scaffold scripts — dev-tooling, not shipped" },
  { prefix: "scripts/testsuite/", reason: "framework-internal test suite runner — dev-tooling, not shipped" },
  { prefix: "scripts/enforcement/builder-right-size", reason: "builder prompt-size right-sizing heuristic — build-chain dispatch dev-tooling, not invoked by any shipped skill; canonical-only (covers .js + .test.js)" },

  { prefix: "scripts/install-git-hooks.sh", reason: "dev git-hooks installer, not shipped" },
  { prefix: "scripts/path-lint.rules.generated.json", reason: "generated path-lint rules, not shipped" },
];
const LOCAL_RULES_FILE = path.join(ROOT, ".claude", "project", "memory", "mc-ship-coverage.local.json");
const LOCAL_RULES = (() => {
  let raw;
  try {
    raw = fs.readFileSync(LOCAL_RULES_FILE, "utf8").replace(/^\uFEFF/, "");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    console.error("mc-ship-coverage: instance-local rules file unreadable");
    process.exit(2);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    cfg = null;
  }
  const okRule = (r) => r && typeof r.prefix === "string" && r.prefix && typeof r.reason === "string" && r.reason;
  if (!cfg || !Array.isArray(cfg.knownNotShipped) || !cfg.knownNotShipped.every(okRule)) {
    console.error("mc-ship-coverage: instance-local rules file malformed (expected { \"knownNotShipped\": [{ \"prefix\", \"reason\" }] })");
    process.exit(2);
  }
  return cfg.knownNotShipped.map((r) => ({ prefix: r.prefix, reason: `instance-local: ${r.reason}` }));
})();
if (LOCAL_RULES) KNOWN_NOT_SHIPPED.push(...LOCAL_RULES);

const MUST_SHIP_PREFIXES = [
  { prefix: "_guides/", reason: "product-facing launch guides must ship to consumer products" },
];
const MUST_NOT_SHIP_PREFIXES = [
  { prefix: "_planning/", reason: "operator planning scratch — must never ship to products" },
  { prefix: "_reports/", reason: "per-project report output — must never ship to products" },
];

function fail(msg) {
  console.error(`mc-ship-coverage: ${msg}`);
  process.exit(2);
}

function loadJson(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) fail(`missing ${rel} — run the manifest builders first`);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    fail(`invalid JSON in ${rel}: ${e.message}`);
  }
}

function shippedPathSet(fm) {
  const set = new Set();
  const addEntry = (e) => {
    if (e && typeof e === "object") {
      if (e.src) set.add(e.src);
      if (e.dest) set.add(e.dest);
    }
  };
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (v.src || v.dest) addEntry(v);
      else for (const k of Object.keys(v)) walk(v[k]);
    }
  };
  walk(fm.assets);
  for (const key of ["generated_files", "version_file", "installer_script"]) {
    if (fm[key]) walk(fm[key]);
  }
  return set;
}

function isAllowlisted(p) {
  return KNOWN_NOT_SHIPPED.find((a) => {
    if (typeof a.match === "function") return a.match(p);
    return p === a.prefix || p.startsWith(a.prefix);
  });
}

function isKnownDangling(seededFrom) {
  return KNOWN_DANGLING_SET.has(seededFrom);
}

const HARD_SIGNAL_ROOTS = [
  "framework/",
  "schemas/",
  "patterns/",
  ".claude/commands/",
  ".claude/agents/",
];
function isHardSignal(p) {
  return HARD_SIGNAL_ROOTS.some((r) => p.startsWith(r));
}

function main() {
  const own = loadJson("_mc/MANIFEST.json");
  const fm = loadJson(".claude/framework-manifest.json");
  const shipped = shippedPathSet(fm);

  const ownPaths = own.paths || {};

  const danglingAllowlisted = [];
  const danglingUnallowlisted = [];
  let danglingTotal = 0;
  for (const [, entry] of Object.entries(ownPaths)) {
    if (!entry || !entry.seeded_from) continue;
    const sf = entry.seeded_from;
    const resolvedPath = path.join(ROOT, sf);
    if (fs.existsSync(resolvedPath)) continue;
    danglingTotal++;
    if (isKnownDangling(sf)) {
      danglingAllowlisted.push(sf);
    } else {
      danglingUnallowlisted.push(sf);
    }
  }

  const hardGaps = [];
  const infoGaps = [];
  let frameworkOwned = 0;
  for (const [p, entry] of Object.entries(ownPaths)) {
    if (!entry || entry.owner !== "framework") continue;
    if (entry.kind === "dir") continue;
    frameworkOwned++;
    if (shipped.has(p)) continue;
    if (isAllowlisted(p)) continue;
    if (isHardSignal(p)) hardGaps.push(p);
    else infoGaps.push(p);
  }

  const boundaryViolations = [];
  for (const d of MUST_NOT_SHIP_PREFIXES) {
    for (const p of shipped) {
      if (p === d.prefix || p.startsWith(d.prefix)) {
        boundaryViolations.push(`must-not-ship-present: ${p} — ${d.reason}`);
      }
    }
  }
  for (const m of MUST_SHIP_PREFIXES) {
    const present = [...shipped].some(
      (p) => p === m.prefix || p.startsWith(m.prefix),
    );
    if (!present) {
      boundaryViolations.push(`must-ship-missing: ${m.prefix} — ${m.reason}`);
    }
  }

  const result = {
    ok:
      hardGaps.length === 0 &&
      boundaryViolations.length === 0 &&
      danglingUnallowlisted.length === 0 &&
      infoGaps.length === 0,
    framework_owned_paths: frameworkOwned,
    shipped_paths: shipped.size,
    allowlisted_rules: KNOWN_NOT_SHIPPED.length,
    instance_rules: LOCAL_RULES ? LOCAL_RULES.length : "none (no instance-local rules file)",
    hard_gaps: hardGaps,
    boundary_violations: boundaryViolations,
    info_gaps_count: infoGaps.length,
    info_gaps: infoGaps,
    dangling_seeds_total: danglingTotal,
    dangling_allowlisted: danglingAllowlisted.length,
    dangling_unallowlisted: danglingUnallowlisted,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.ok) {
      console.log(
        `OK   [mc-ship-coverage] every framework-owned path ships or is allowlisted (${frameworkOwned} paths scanned, 0 hard_gaps, 0 info_gaps, 0 boundary_violations); seeded_from: ${danglingTotal} dangling (KNOWN_DANGLING_SET empty; zero-tolerance).`,
      );
    } else {
      if (hardGaps.length) {
        console.error(
          `FAIL [mc-ship-coverage] ${hardGaps.length} essential-root path(s) ship to NOBODY (under framework/|schemas/|patterns/|commands|agents, not shipped, not allowlisted):`,
        );
        for (const g of hardGaps) console.error(`  - ${g}`);
        console.error(
          `Fix: add the covering dir to ASSET_DIRS in scripts/generate-framework-manifest.js, OR add a reviewed KNOWN_NOT_SHIPPED entry.`,
        );
      }
      if (infoGaps.length) {
        console.error(
          `FAIL [mc-ship-coverage] ${infoGaps.length} owner=framework path(s) are not shipped and not in KNOWN_NOT_SHIPPED (unallowlisted — every exclusion must be a conscious reviewed decision):`,
        );
        for (const g of infoGaps) console.error(`  - ${g}`);
        console.error(
          `Fix: add a reviewed KNOWN_NOT_SHIPPED entry with a reason, OR add the path to ASSET_DIRS in scripts/generate-framework-manifest.js to ship it.`,
        );
      }
      if (boundaryViolations.length) {
        console.error(
          `FAIL [mc-ship-coverage] ${boundaryViolations.length} ship-boundary violation(s):`,
        );
        for (const b of boundaryViolations) console.error(`  - ${b}`);
        console.error(
          `Fix: _guides/** must ship (ASSET_DIRS); _planning/** + _reports/** must never ship (walk-skip + absent from ASSET_DIRS).`,
        );
      }
      if (danglingUnallowlisted.length) {
        console.error(
          `FAIL [mc-ship-coverage] ${danglingUnallowlisted.length} seeded_from pointer(s) are dangling and NOT in KNOWN_DANGLING_SET (new regression — exact-match required):`,
        );
        for (const d of danglingUnallowlisted) console.error(`  - ${d}`);
        console.error(
          `Fix: either author the seed template at that path, OR add the exact seeded_from string to KNOWN_DANGLING_SET with a reason tying it to a tracked sprint.`,
        );
      }
    }
    if (danglingTotal > 0 && danglingUnallowlisted.length === 0) {
      console.log(
        `INFO [mc-ship-coverage] seeded_from: ${danglingTotal} dangling pointer(s), all ${danglingAllowlisted.length} in KNOWN_DANGLING_SET (each an EXACT-string allowlist entry tied to a tracked sprint).`,
      );
    }
  }
  process.exit(result.ok ? 0 : 1);
}

main();
