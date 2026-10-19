#!/usr/bin/env node
const mcEnv = require("../hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");
const STALENESS_DAYS = 7;

function semver(v) {
  return v.split(".").map((n) => parseInt(n, 10) || 0);
}
function cmp(a, b) {
  const A = semver(a),
    B = semver(b);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
}

function findCanonicalVersionFile(installedSource) {
  if (mcEnv.readEnv("CANONICAL")) {
    return path.join(mcEnv.readEnv("CANONICAL"), "version.json");
  }
  if (!installedSource) return null;
  const m = installedSource.match(/(.*[\\/]MC)[\\/]/);
  if (m) return path.join(m[1], "version.json");
  return null;
}

function fail(reason, extra = {}) {
  const out = { ok: false, reason, ...extra };
  if (JSON_OUT) console.log(JSON.stringify(out));
  else console.error(`FAIL [mc-staleness] ${reason}`);
  process.exit(1);
}
function pass(reason, extra = {}) {
  const out = { ok: true, reason, ...extra };
  if (JSON_OUT) console.log(JSON.stringify(out));
  else console.log(`OK   [mc-staleness] ${reason}`);
  process.exit(0);
}

const installedFile = path.join(ROOT, ".claude", "framework-installed.json");
if (!fs.existsSync(installedFile))
  pass("no framework-installed.json — not a MC-installed project");
const installed = JSON.parse(fs.readFileSync(installedFile, "utf8"));
const installedVersion = installed.installedVersion;
const installedSource = installed.source;
const installedAt = installed.installedAt;

const canonicalVersionFile = findCanonicalVersionFile(installedSource);
if (!canonicalVersionFile || !fs.existsSync(canonicalVersionFile)) {
  pass(
    `installed ${installedVersion}; canonical version.json not reachable (set MC_CANONICAL to enable comparison)`,
    { installedVersion },
  );
}
const canonical = JSON.parse(fs.readFileSync(canonicalVersionFile, "utf8"));
const canonicalVersion = canonical.version;

const cmpResult = cmp(installedVersion, canonicalVersion);
if (cmpResult >= 0)
  pass(`installed ${installedVersion} >= canonical ${canonicalVersion}`, {
    installedVersion,
    canonicalVersion,
  });

const txDir = require("../hooks/lib/mc-dirs").resolveProjectPath(ROOT, ".mc/transactions");
let pendingTx = null;
if (fs.existsSync(txDir)) {
  const entries = fs.readdirSync(txDir);
  const { isUpdateTransactionId } = require("../mc/transaction");
  pendingTx = entries.find((e) => isUpdateTransactionId(e));
}
if (pendingTx)
  pass(
    `stale (installed ${installedVersion} < canonical ${canonicalVersion}) but pending update transaction in .mc/transactions/${pendingTx}`,
    { installedVersion, canonicalVersion, pendingTx },
  );

const installedDate = new Date(installedAt);
const now = new Date();
const ageDays = (now - installedDate) / 86400000;
if (ageDays < STALENESS_DAYS)
  pass(
    `stale (installed ${installedVersion} < canonical ${canonicalVersion}) but only ${ageDays.toFixed(1)}d old (threshold ${STALENESS_DAYS}d)`,
    { installedVersion, canonicalVersion, ageDays },
  );

fail(
  `installed ${installedVersion} < canonical ${canonicalVersion}, age ${ageDays.toFixed(1)}d > threshold ${STALENESS_DAYS}d, no pending /mc:update transaction. Run: /mc:update --to ${canonicalVersion} --apply`,
  { installedVersion, canonicalVersion, ageDays },
);
