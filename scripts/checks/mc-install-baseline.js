#!/usr/bin/env node

const mcEnv = require("../hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");

const START = Date.now();
const NAME = "mc-install-baseline";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}
const JSON_OUT = process.argv.includes("--json");
const FORCE_FRESH = process.argv.includes("--force-fresh");
const GUARD_REMEDIATION = process.argv.includes("--guard-remediation");
const SHIP_COVERAGE = process.argv.includes("--ship-coverage");
const TARGET_ROOT = path.resolve(
  arg("--target") || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function emit(result) {
  const out = {
    name: NAME,
    status: result.status,
    reason: result.reason,
    remediation: result.remediation || null,
    durationMs: Date.now() - START,
    evidence: result.evidence || {},
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out));
  } else if (result.status === "green") {
    console.log(`OK   [${NAME}] ${result.reason}`);
  } else if (result.status === "yellow") {
    console.log(`WARN [${NAME}] ${result.reason}`);
  } else {
    console.error(`FAIL [${NAME}] ${result.reason}`);
    if (result.remediation) console.error(`     fix: ${result.remediation}`);
  }
  process.exit(result.status === "red" ? 1 : 0);
}

const RUNNABLE_EXT = "(?:js|cjs|mjs|ps1|sh)";
const SCRIPT_PATH_RE = new RegExp(
  "scripts/[A-Za-z0-9_./-]+?\\." + RUNNABLE_EXT + "(?![A-Za-z0-9_.])",
  "g",
);
const REMEDIATION_LINE_RE =
  /\bblock\s*\(|console\.error\s*\(|process\.stderr\.write\s*\(|\b(?:Run|Use|fix|Try|remediation)\b\s*:/i;

function extractRemediationPaths(source) {
  const out = new Set();
  for (const raw of source.split(/\r?\n/)) {
    if (!REMEDIATION_LINE_RE.test(raw)) continue;
    const stringRegions = raw.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) || [];
    const haystack = stringRegions.length ? stringRegions.join(" ") : raw;
    let m;
    SCRIPT_PATH_RE.lastIndex = 0;
    while ((m = SCRIPT_PATH_RE.exec(haystack)) !== null) {
      out.add(m[0]);
    }
  }
  return Array.from(out);
}

function runGuardRemediationCheck() {
  const scanRoot = mcEnv.readEnv("GUARD_REMEDIATION_ROOT")
    ? path.resolve(mcEnv.readEnv("GUARD_REMEDIATION_ROOT"))
    : REPO_ROOT;
  const hooksDir = path.join(scanRoot, "scripts", "hooks");
  let files = [];
  try {
    files = fs
      .readdirSync(hooksDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => path.join(hooksDir, f));
  } catch (e) {
    emitGuardResult({
      status: "red",
      reason: `cannot read guard dir ${hooksDir}: ${e.message}`,
      missing: [],
      checked: 0,
    });
    return;
  }

  const missing = [];
  let pathCount = 0;
  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const rel of extractRemediationPaths(src)) {
      pathCount++;
      const abs = path.join(scanRoot, rel);
      if (!fs.existsSync(abs)) {
        missing.push({
          guard: path.relative(scanRoot, file).replace(/\\/g, "/"),
          path: rel,
        });
      }
    }
  }

  if (missing.length > 0) {
    emitGuardResult({
      status: "red",
      reason: `${missing.length} guard remediation path(s) point at a file the install never shipped (closed-trap class)`,
      missing,
      checked: pathCount,
    });
    return;
  }
  emitGuardResult({
    status: "green",
    reason: `all ${pathCount} guard remediation script path(s) across ${files.length} guard(s) exist on disk`,
    missing: [],
    checked: pathCount,
  });
}

function emitGuardResult(r) {
  const out = {
    name: NAME + ":guard-remediation",
    status: r.status,
    reason: r.reason,
    missing: r.missing,
    checkedPaths: r.checked,
    durationMs: Date.now() - START,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out));
  } else if (r.status === "green") {
    console.log(`OK   [${NAME}:guard-remediation] ${r.reason}`);
  } else {
    console.error(`FAIL [${NAME}:guard-remediation] ${r.reason}`);
    for (const m of r.missing) {
      console.error(`     - ${m.guard} → ${m.path} (MISSING)`);
    }
    console.error(
      "     fix: ship the referenced script, OR correct the guard's remediation message to name a file that exists.",
    );
  }
  process.exit(r.status === "red" ? 1 : 0);
}

function runBaselineCheck() {
const file = path.join(TARGET_ROOT, ".claude", "framework-installed.json");
const exists = fs.existsSync(file);

let installedVersion = null;
let malformed = false;
if (exists) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    installedVersion = j.installedVersion || j.version || null;
  } catch {
    malformed = true;
  }
}

const hasBaseline =
  exists && !malformed && installedVersion && installedVersion !== "0.0.0";

if (hasBaseline) {
  emit({
    status: "green",
    reason: `installed baseline ${installedVersion} present at ${path.relative(TARGET_ROOT, file).replace(/\\/g, "/")}`,
    evidence: { file, installedVersion },
  });
}

if (FORCE_FRESH) {
  emit({
    status: "yellow",
    reason: `no baseline (${exists ? `sentinel ${installedVersion || "<malformed>"}` : "file missing"}) but --force-fresh override accepted`,
    evidence: {
      file,
      exists,
      installedVersion,
      malformed,
      override: "--force-fresh",
    },
    remediation:
      "Override accepted. Apply will be treated as a fresh install (massive ADD_SAFE plan expected).",
  });
}

const reason = malformed
  ? `framework-installed.json malformed (not parseable JSON)`
  : exists
    ? `framework-installed.json present but installedVersion is sentinel ${installedVersion || "(missing field)"}`
    : `framework-installed.json not found at ${path.relative(TARGET_ROOT, file).replace(/\\/g, "/")} — this project has no installed MC snapshot to update from.`;

emit({
  status: "red",
  reason,
  remediation: [
    "Run install.ps1 first (this is for upgrades, not fresh installs):",
    "  powershell -ExecutionPolicy Bypass -File <mc-repo>/install.ps1",
    "Or, if a baseline exists in git history, restore it:",
    "  git checkout <prev-commit> -- .claude/framework-installed.json",
    "Override: --force-fresh (DANGER — treats this as a fresh install, produces a massive ADD_SAFE plan)",
  ].join("\n"),
  evidence: { file, exists, installedVersion, malformed },
});
}

function shippedPathSet(manifest) {
  const set = new Set();
  if (!manifest || !manifest.assets) return set;
  function addEntry(e) {
    if (e && typeof e === "object") {
      if (e.src) set.add(e.src.split("\\").join("/"));
      if (e.dest) set.add(e.dest.split("\\").join("/"));
    }
  }
  function walk(v) {
    if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      if (v.src || v.dest) {
        addEntry(v);
      } else {
        for (const k of Object.keys(v)) walk(v[k]);
      }
    }
  }
  walk(manifest.assets);
  return set;
}

function computeShipCoverage(manifest, mandatedPaths) {
  if (
    !manifest ||
    !manifest.assets ||
    typeof manifest.assets !== "object" ||
    Object.keys(manifest.assets).length === 0
  ) {
    return {
      status: "red",
      missing: [],
      reason:
        "manifest is missing or has no assets section — enforcer cannot proceed (fail-closed)",
      checkedPaths: 0,
    };
  }
  const shipped = shippedPathSet(manifest);
  const missing = [];
  for (const p of mandatedPaths) {
    const normalized = p.split("\\").join("/");
    if (!shipped.has(normalized) && !shipped.has(p)) {
      missing.push(p);
    }
  }
  const count = mandatedPaths.length;
  if (missing.length > 0) {
    return {
      status: "red",
      missing,
      reason: `${missing.length} of ${count} mandated path(s) absent from ship payload`,
      checkedPaths: count,
    };
  }
  return {
    status: "green",
    missing: [],
    reason: `all ${count} guard-mandated path(s) present in ship payload`,
    checkedPaths: count,
  };
}

function runShipCoverageCheck() {
  const manifestPath = path.join(REPO_ROOT, ".claude", "framework-manifest.json");
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    emitShipCoverageResult({
      status: "red",
      reason: `cannot read/parse .claude/framework-manifest.json: ${e.message}`,
      missing: [],
      checkedPaths: 0,
      guardCount: 0,
    });
    return;
  }

  const scanRoot = mcEnv.readEnv("GUARD_REMEDIATION_ROOT")
    ? path.resolve(mcEnv.readEnv("GUARD_REMEDIATION_ROOT"))
    : REPO_ROOT;
  const hooksDir = path.join(scanRoot, "scripts", "hooks");
  let files = [];
  try {
    files = fs
      .readdirSync(hooksDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => path.join(hooksDir, f));
  } catch (e) {
    emitShipCoverageResult({
      status: "red",
      reason: `cannot read guard dir ${hooksDir}: ${e.message}`,
      missing: [],
      checkedPaths: 0,
      guardCount: 0,
    });
    return;
  }

  const allMandated = [];
  const byGuard = {};
  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const paths = extractRemediationPaths(src);
    if (paths.length > 0) {
      const rel = path.relative(scanRoot, file).split("\\").join("/");
      byGuard[rel] = paths;
      allMandated.push(...paths);
    }
  }

  const result = computeShipCoverage(manifest, allMandated);

  const missingWithGuard = [];
  if (result.missing.length > 0) {
    for (const [guard, paths] of Object.entries(byGuard)) {
      for (const p of paths) {
        if (result.missing.includes(p)) {
          missingWithGuard.push({ guard, path: p });
        }
      }
    }
  }

  emitShipCoverageResult({
    status: result.status,
    reason: result.reason,
    missing: missingWithGuard,
    checkedPaths: result.checkedPaths,
    guardCount: files.length,
  });
}

function emitShipCoverageResult(r) {
  const out = {
    name: NAME + ":ship-coverage",
    status: r.status,
    reason: r.reason,
    missing: r.missing,
    checkedPaths: r.checkedPaths,
    guardCount: r.guardCount || 0,
    durationMs: Date.now() - START,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out));
  } else if (r.status === "green") {
    console.log(`OK   [${NAME}:ship-coverage] ${r.reason}`);
  } else {
    console.error(`FAIL [${NAME}:ship-coverage] ${r.reason}`);
    for (const m of r.missing) {
      if (typeof m === "object" && m.guard) {
        console.error(`     - ${m.guard} → ${m.path} (MISSING-FROM-SHIP-PAYLOAD)`);
      } else {
        console.error(`     - ${m} (MISSING-FROM-SHIP-PAYLOAD)`);
      }
    }
    console.error(
      "     fix: add the referenced script to ASSET_DIRS in scripts/generate-framework-manifest.js and regenerate the manifest.",
    );
  }
  process.exit(r.status === "red" ? 1 : 0);
}

if (require.main === module) {
  if (GUARD_REMEDIATION) {
    runGuardRemediationCheck();
  } else if (SHIP_COVERAGE) {
    runShipCoverageCheck();
  } else {
    runBaselineCheck();
  }
}

module.exports = { extractRemediationPaths, shippedPathSet, computeShipCoverage };
