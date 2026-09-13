#!/usr/bin/env node
/**
 * scan:mc-install-baseline — preflight gate (F-4 mitigation).
 *
 * Verifies a MC install baseline exists in the target project before
 * /warp:update may proceed. Without `--force-fresh`, the gate refuses
 * when `.claude/framework-installed.json` is missing OR
 * `installedVersion === "0.0.0"` (the silent-fallback sentinel).
 *
 * Status:
 *   green  — framework-installed.json present + installedVersion is real
 *   yellow — --force-fresh override accepted (preflight composer may
 *            interpret as green if override was opted in)
 *   red    — missing or sentinel 0.0.0 without override
 *
 * Output schema (IN-1).
 *
 * --guard-remediation MODE (C-8 / doogle WG-1 enforcer-class):
 *   A separate assertion — the "closed dispatch trap" backstop. Every script
 *   path a guard names in a USER-FACING remediation message ("Run: node
 *   scripts/X.js", "Use: …", a block() reason, a stderr instruction) must
 *   actually EXIST on disk. Otherwise a guard blocks the user and then points
 *   them at a file the install never shipped — a closed trap with no exit. This
 *   mode scans scripts/hooks/*.js, extracts remediation script paths, and fails
 *   if any is missing. It does NOT touch a target's framework-installed.json.
 *
 * --ship-coverage MODE (S-LC-12 / T-296 / class-closer):
 *   Closes the WG-1/WG-9 defect CLASS: on-disk existence (what --guard-remediation
 *   checks) is NOT the same as SHIPPED. A file can exist on canonical disk and
 *   pass --guard-remediation while being absent from .claude/framework-manifest.json
 *   — meaning it never reaches a product install. This mode asserts that every
 *   guard-mandated remediation path is present in the SHIP PAYLOAD (the manifest
 *   assets), not just on disk. Fails-closed if the manifest is missing, unparseable,
 *   or has no assets. Reuses extractRemediationPaths so the mandated-path set is
 *   always consistent with --guard-remediation.
 *
 *   Scope: guard remediation paths (paths a guard tells a user to RUN). These are
 *   paths that a guard mandates — if mandated, they must ship. Additional sources
 *   (e.g. hard-require() chains) are out of scope to avoid over-reach; the
 *   remediation set is the concrete, well-bounded signal that closes WG-1/WG-9.
 *
 * Usage:
 *   node scripts/checks/mc-install-baseline.js [--target <path>] [--force-fresh] [--json]
 *   node scripts/checks/mc-install-baseline.js --guard-remediation [--json]
 *   node scripts/checks/mc-install-baseline.js --ship-coverage [--json]
 *
 * Linked: SP-20260513-005 / S-4 / AC-S-4.2 / R-4 / C-1 / F-4 / C-8 / doogle WG-1 / S-LC-12 / T-296
 */

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

// ── C-8: guard-remediation-path existence (the "closed dispatch trap") ──
//
// Extract script paths a guard tells the USER to run, from remediation/
// user-facing surfaces only — NOT every script path in the file (a require()
// or a comment is not a trap). We scope to lines that look like guidance:
// a block()/console.error()/process.stderr.write() call, or a line carrying a
// "Run:"/"Use:"/"fix:" remediation cue. Then we pull scripts/<...>.<ext> tokens
// with a STRICT extension boundary so `.json` artifacts never match `.js`.

// Executable script extensions a guard could ask a user to RUN. Deliberately
// excludes .json/.md/.ps1xml etc. — a guard naming a data file isn't a dispatch
// trap, and .ps1/.sh ARE runnable so they stay in.
const RUNNABLE_EXT = "(?:js|cjs|mjs|ps1|sh)";
// scripts/<path>.<ext> with a trailing boundary that rejects `.json` (the `.js`
// of `.json` must not match): the char after <ext> must NOT be a word char or `.`.
const SCRIPT_PATH_RE = new RegExp(
  "scripts/[A-Za-z0-9_./-]+?\\." + RUNNABLE_EXT + "(?![A-Za-z0-9_.])",
  "g",
);
// A line is "remediation-bearing" if it emits user guidance.
const REMEDIATION_LINE_RE =
  /\bblock\s*\(|console\.error\s*\(|process\.stderr\.write\s*\(|\b(?:Run|Use|fix|Try|remediation)\b\s*:/i;

function extractRemediationPaths(source) {
  const out = new Set();
  for (const raw of source.split(/\r?\n/)) {
    if (!REMEDIATION_LINE_RE.test(raw)) continue;
    // Only pull paths that sit inside a STRING literal on this line — a bare
    // identifier path in code is not user-facing text.
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
  // WARPOS_GUARD_REMEDIATION_ROOT is a test-only seam: point the scan at a
  // throwaway tree so the RED path can be exercised hermetically without a
  // false-RED on the real guard set.
  const scanRoot = process.env.WARPOS_GUARD_REMEDIATION_ROOT
    ? path.resolve(process.env.WARPOS_GUARD_REMEDIATION_ROOT)
    : REPO_ROOT;
  const hooksDir = path.join(scanRoot, "scripts", "hooks");
  let files = [];
  try {
    files = fs
      .readdirSync(hooksDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => path.join(hooksDir, f));
  } catch (e) {
    // fail-closed: an enforcer that can't read its inputs must not read green.
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

// ── C-8 extension: ship-payload coverage (--ship-coverage / T-296 class-closer) ──
//
// SCOPE: guard remediation paths — the same set --guard-remediation checks against
// disk. These are paths a guard TELLS the user to run; a mandated path must ship.
// We do NOT reach into every require() in the tree (a require is not a ship mandate).
//
// FAIL-CLOSED rules mirror runGuardRemediationCheck:
//   - manifest file missing or unparseable → red
//   - manifest.assets absent or empty → red
//   - any mandated path not in the shipped Set → red with list
//
// The shipped Set is built from BOTH src and dest across every asset kind, so
// a file covered by either field matches. Backslashes are normalized to forward
// slashes before comparison (Windows path safety).

/**
 * Pure helper: build a Set of all shipped src/dest paths from a parsed manifest.
 * Normalizes backslashes to forward slashes.
 * Returns an empty Set if manifest.assets is absent (caller checks for fail-closed).
 *
 * @param {object} manifest - parsed .claude/framework-manifest.json
 * @returns {Set<string>}
 */
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

/**
 * Pure helper: compute ship-coverage for a given manifest + mandated path list.
 * Returns a result object consumable by emitShipCoverageResult (or test assertions).
 *
 * FAIL-CLOSED: manifest null, missing assets, or empty assets → red.
 *
 * @param {object|null} manifest - parsed manifest (or null)
 * @param {string[]} mandatedPaths - paths that must appear in the ship payload
 * @returns {{ status: "green"|"red", missing: string[], reason: string, checkedPaths: number }}
 */
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
  // Load the manifest. FAIL-CLOSED on any read/parse failure.
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

  // Collect guard-mandated remediation paths via the same scan as --guard-remediation.
  // WARPOS_GUARD_REMEDIATION_ROOT is the test-only seam (same as --guard-remediation).
  const scanRoot = process.env.WARPOS_GUARD_REMEDIATION_ROOT
    ? path.resolve(process.env.WARPOS_GUARD_REMEDIATION_ROOT)
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

  // Annotate missing entries with their source guard for better diagnostics.
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

// ── Dispatch (only when run directly; require() exposes the pure helpers) ──
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
