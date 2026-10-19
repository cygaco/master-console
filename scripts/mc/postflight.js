
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const events = require("./lib/update-events");

const externalChecks = [];

function registerExternalCheck(spec) {
  if (!spec || typeof spec !== "object") return false;
  if (typeof spec.name !== "string" || !spec.name.trim()) return false;
  if (typeof spec.resolvePath !== "string" || !spec.resolvePath.trim())
    return false;
  const existing = externalChecks.findIndex((s) => s.name === spec.name);
  const normalized = {
    name: spec.name,
    resolvePath: spec.resolvePath,
    required: !!spec.required,
    degradedReason: spec.degradedReason || `${spec.name} skill not yet shipped`,
  };
  if (existing >= 0) externalChecks[existing] = normalized;
  else externalChecks.push(normalized);
  return true;
}

function listExternalChecks() {
  return externalChecks.slice();
}

function clearExternalChecks() {
  externalChecks.length = 0;
}

function resolvePathsKey(targetRoot, key) {
  const file = path.join(targetRoot, ".claude", "paths.json");
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const k = key.startsWith("paths.") ? key.slice("paths.".length) : key;
    const rel = raw[k];
    if (!rel) return null;
    return path.isAbsolute(rel) ? rel : path.join(targetRoot, rel);
  } catch {
    return null;
  }
}

function runNodeCheck(scriptAbs, args, cwd) {
  const r = spawnSync(process.execPath, [scriptAbs, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  });
  return r;
}

function runBuiltinCheck(name, targetRoot) {
  const start = Date.now();
  const scriptMap = {
    "manifest-honesty": "scripts/checks/mc-manifest-honesty.js",
    "path-resolution": "scripts/checks/mc-path-resolution.js",
    "applied-migrations": "scripts/checks/mc-applied-migrations.js",
  };
  const rel = scriptMap[name];
  if (!rel) {
    return {
      name,
      status: "degraded",
      reason: `unknown built-in check: ${name}`,
      durationMs: Date.now() - start,
      evidence: {},
    };
  }
  const candidates = [
    path.join(__dirname, "..", "..", rel),
    path.join(targetRoot, rel),
  ];
  let scriptAbs = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      scriptAbs = c;
      break;
    }
  }
  if (!scriptAbs) {
    return {
      name,
      status: "degraded",
      reason: `script not found: ${rel}`,
      durationMs: Date.now() - start,
      evidence: { searched: candidates },
    };
  }
  const r = runNodeCheck(scriptAbs, ["--json"], targetRoot);
  const status = r.status === 0 ? "green" : "red";
  let evidence = {};
  let reason = `exit code ${r.status}`;
  try {
    const parsed = JSON.parse(r.stdout || "{}");
    evidence = parsed;
    if (parsed.reason) reason = parsed.reason;
  } catch {
    evidence = {
      stdout: (r.stdout || "").slice(0, 4096),
      stderr: (r.stderr || "").slice(0, 4096),
    };
  }
  return {
    name,
    status,
    reason,
    durationMs: Date.now() - start,
    evidence,
  };
}

function runWarpHealthRollup(targetRoot) {
  const start = Date.now();
  const candidates = [
    path.join(__dirname, "..", "check", "mc-health.js"),
    path.join(targetRoot, "scripts", "check", "mc-health.js"),
    path.join(__dirname, "..", "..", "scripts", "check", "mc-health.js"),
  ];
  let scriptAbs = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      scriptAbs = c;
      break;
    }
  }
  if (!scriptAbs) {
    return {
      name: "mc-health",
      status: "degraded",
      reason: "/mc:health rollup script not present yet",
      durationMs: Date.now() - start,
      evidence: { searched: candidates },
    };
  }
  const r = runNodeCheck(scriptAbs, ["--json"], targetRoot);
  return {
    name: "mc-health",
    status: r.status === 0 ? "green" : "red",
    reason: `exit code ${r.status}`,
    durationMs: Date.now() - start,
    evidence: {
      stdout: (r.stdout || "").slice(0, 4096),
      stderr: (r.stderr || "").slice(0, 4096),
    },
  };
}

function runExternalCheck(spec, targetRoot) {
  const start = Date.now();
  const resolved = resolvePathsKey(targetRoot, spec.resolvePath);
  if (!resolved || !fs.existsSync(resolved)) {
    return {
      name: spec.name,
      status: spec.required ? "red" : "degraded",
      reason: spec.required
        ? `required external check '${spec.name}' not registered (paths.${spec.resolvePath} unresolved)`
        : spec.degradedReason,
      durationMs: Date.now() - start,
      evidence: { resolvePath: spec.resolvePath, resolved: resolved || null },
    };
  }
  const r = runNodeCheck(resolved, ["--json"], targetRoot);
  let evidence = {};
  try {
    evidence = JSON.parse(r.stdout || "{}");
  } catch {
    evidence = { stdout: (r.stdout || "").slice(0, 4096) };
  }
  return {
    name: spec.name,
    status: r.status === 0 ? "green" : "red",
    reason: `exit code ${r.status}`,
    durationMs: Date.now() - start,
    evidence,
  };
}

function runPostflight(opts) {
  const startedAt = Date.now();
  const { targetRoot, txId, txDir } = opts;

  if (!targetRoot) throw new Error("runPostflight: targetRoot required");

  const checks = [];

  checks.push(runBuiltinCheck("manifest-honesty", targetRoot));
  checks.push(runBuiltinCheck("path-resolution", targetRoot));
  checks.push(runBuiltinCheck("applied-migrations", targetRoot));
  for (const spec of externalChecks) {
    checks.push(runExternalCheck(spec, targetRoot));
  }
  if (externalChecks.length === 0) {
    checks.push({
      name: "provider-smoke",
      status: "degraded",
      reason: "provider-smoke skill not yet shipped",
      durationMs: 0,
      evidence: {
        note: "primitive ready; provider-smoke has not registered yet",
      },
    });
  }
  checks.push(runWarpHealthRollup(targetRoot));

  const summary = { green: 0, yellow: 0, red: 0, degraded: 0 };
  for (const c of checks) {
    if (c.status === "green") summary.green += 1;
    else if (c.status === "yellow") summary.yellow += 1;
    else if (c.status === "red") summary.red += 1;
    else summary.degraded += 1;
  }

  const ok = summary.red === 0;
  let operatorAction = "green-light";
  if (summary.red >= 2) operatorAction = "rollback-recommended";
  else if (summary.red > 0 || summary.yellow > 0)
    operatorAction = "review-then-decide";

  for (const c of checks) {
    events.emitPostflightCheck(targetRoot, {
      txId,
      check: c.name,
      status: c.status,
      reason: c.reason,
      durationMs: c.durationMs,
      evidence: c.evidence,
    });
  }

  let evidencePath = null;
  if (txDir) {
    try {
      const evDir = path.join(txDir, "evidence");
      fs.mkdirSync(evDir, { recursive: true });
      evidencePath = path.join(evDir, "postflight.json");
      const pkg = {
        $schema: "mc/update-evidence/v1",
        txId,
        completedAt: new Date().toISOString(),
        checks,
        summary,
        operatorAction,
      };
      fs.writeFileSync(evidencePath, JSON.stringify(pkg, null, 2) + "\n");
    } catch (e) {
      try {
        const errLog = path.join(txDir, "evidence", "postflight.error.log");
        fs.mkdirSync(path.dirname(errLog), { recursive: true });
        fs.writeFileSync(errLog, `${new Date().toISOString()} ${e.message}\n`);
      } catch {
      }
    }
  }

  events.emitPostflight(targetRoot, {
    txId,
    ok,
    checkCount: checks.length,
    greenCount: summary.green,
    yellowCount: summary.yellow,
    redCount: summary.red,
    degradedCount: summary.degraded,
    operatorAction,
    evidencePath,
    durationMs: Date.now() - startedAt,
  });

  return {
    ok,
    checkCount: checks.length,
    redCount: summary.red,
    yellowCount: summary.yellow,
    greenCount: summary.green,
    degradedCount: summary.degraded,
    checks,
    evidencePath,
    operatorAction,
    summary,
  };
}

registerExternalCheck({
  name: "provider-smoke",
  resolvePath: "paths.providerSmokeSkill",
  required: false,
  degradedReason:
    "provider-smoke orchestrator not resolvable from paths.providerSmokeSkill",
});

module.exports = {
  runPostflight,
  registerExternalCheck,
  listExternalChecks,
  clearExternalChecks,
  resolvePathsKey,
  runBuiltinCheck,
  runExternalCheck,
};
