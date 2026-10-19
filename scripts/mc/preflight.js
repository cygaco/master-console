
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const events = require("./lib/update-events");

const GATES = [
  {
    name: "mc-install-baseline",
    script: "scripts/checks/mc-install-baseline.js",
    args: (o) => (o.forceFresh ? ["--force-fresh"] : []),
    overrideFlag: "forceFresh",
  },
  {
    name: "mc-capsule-resolvable",
    script: "scripts/checks/mc-capsule-resolvable.js",
    args: (o) => (o.toVersion ? ["--to", o.toVersion] : []),
    overrideFlag: null,
  },
  {
    name: "mc-version-quorum",
    script: "scripts/checks/mc-version-quorum.js",
    args: () => [],
    overrideFlag: "allowVersionDrift",
  },
  {
    name: "mc-manifest-honesty",
    script: "scripts/checks/mc-manifest-honesty.js",
    args: () => [],
    overrideFlag: null,
  },
  {
    name: "mc-staleness",
    script: "scripts/checks/mc-staleness.js",
    args: () => [],
    overrideFlag: "allowStale",
  },
  {
    name: "mc-path-resolution",
    script: "scripts/checks/mc-path-resolution.js",
    args: () => [],
    overrideFlag: null,
  },
  {
    name: "mc-structure-parity",
    script: "scripts/checks/mc-structure-parity.js",
    args: () => [],
    overrideFlag: null,
  },
  {
    name: "mc-applied-migrations",
    script: "scripts/checks/mc-applied-migrations.js",
    args: () => [],
    overrideFlag: null,
  },
  {
    name: "mc-migration-presence",
    script: "scripts/checks/mc-migration-presence.js",
    args: (o) => {
      const args = [];
      if (o.toVersion) args.push("--to", o.toVersion);
      if (o.sourceRoot) args.push("--source", o.sourceRoot);
      return args;
    },
    overrideFlag: null,
  },
  {
    name: "mc-tracked-transients",
    script: "scripts/checks/mc-tracked-transients.js",
    args: () => [],
    overrideFlag: null,
  },
];

function runGate(gate, opts, targetRoot, sourceTreeRoot) {
  const start = Date.now();
  const candidates = [
    path.join(sourceTreeRoot || targetRoot, gate.script),
    path.join(targetRoot, gate.script),
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
      name: gate.name,
      status: "degraded",
      reason: `gate script not found: ${gate.script}`,
      remediation: null,
      durationMs: Date.now() - start,
      evidence: { searched: candidates },
    };
  }
  const args = ["--target", targetRoot, "--json", ...(gate.args(opts) || [])];
  const r = spawnSync(process.execPath, [scriptAbs, ...args], {
    cwd: targetRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout || "");
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      name: gate.name,
      status: "degraded",
      reason: "malformed gate result (non-JSON)",
      remediation: null,
      durationMs: Date.now() - start,
      evidence: {
        exitCode: r.status,
        stdout: (r.stdout || "").slice(0, 4096),
        stderr: (r.stderr || "").slice(0, 4096),
      },
    };
  }
  const result = {
    name: parsed.name || gate.name,
    status: parsed.status || (r.status === 0 ? "green" : "red"),
    reason: parsed.reason || `exit code ${r.status}`,
    remediation: parsed.remediation || null,
    durationMs: parsed.durationMs || Date.now() - start,
    evidence: parsed.evidence || {},
  };
  return result;
}

const KNOWN_GATE_NAMES = new Set([
  "install-baseline",
  "capsule-resolvable",
  "version-quorum",
  "manifest-honesty",
  "staleness",
  "path-resolution",
  "structure-parity",
  "applied-migrations",
  "migration-presence",
  "tracked-transients",
]);

function shortGateName(fullName) {
  return String(fullName || "").replace(/^mc-/, "");
}

function applyOverride(gate, result, opts) {
  if (
    opts.operatorOverrides &&
    opts.operatorOverrides.has(shortGateName(gate.name)) &&
    (result.status === "red" || result.status === "yellow")
  ) {
    return {
      result: {
        ...result,
        status: "yellow",
        reason: `${result.reason} (--operator-override ${shortGateName(gate.name)} accepted; reason: ${opts.overrideReason})`,
      },
      overrideUsed: true,
      overrideKind: "operator-override",
    };
  }
  if (!gate.overrideFlag) return { result, overrideUsed: false };
  if (result.status !== "red" && result.status !== "yellow")
    return { result, overrideUsed: false };
  if (!opts[gate.overrideFlag]) return { result, overrideUsed: false };
  return {
    result: {
      ...result,
      status: "yellow",
      reason: `${result.reason} (override ${gate.overrideFlag} accepted; legacy flag — prefer --operator-override ${shortGateName(gate.name)})`,
    },
    overrideUsed: true,
    overrideKind: "legacy-flag",
  };
}

function validateOverrideReason(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8) return null;
  if (trimmed.length > 500) return null;
  return trimmed;
}

function runPreflight(opts) {
  if (!opts || !opts.targetRoot)
    throw new Error("runPreflight: targetRoot required");
  const targetRoot = path.resolve(opts.targetRoot);
  const sourceTreeRoot = path.resolve(opts.sourceTreeRoot || targetRoot);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const gateResults = [];

  for (const gate of GATES) {
    const raw = runGate(gate, opts, targetRoot, sourceTreeRoot);
    const { result, overrideUsed, overrideKind } = applyOverride(
      gate,
      raw,
      opts,
    );
    gateResults.push({ ...result, overrideUsed });
    events.emitPreflightGate(targetRoot, {
      txId: opts.txId || null,
      gate: result.name,
      status: result.status,
      reason: result.reason,
      remediation: result.remediation,
      durationMs: result.durationMs,
      evidence: result.evidence,
      overrideUsed,
    });
    if (overrideUsed && overrideKind === "operator-override") {
      events.emitOperatorOverrideUsed(targetRoot, {
        txId: opts.txId || null,
        gate: shortGateName(result.name),
        reason: opts.overrideReason || "",
        operator: opts.operator || null,
        gateStatusBefore: raw.status,
      });
    }
    if (result.status === "red" && !opts.allRed) {
      break;
    }
  }

  const summary = { green: 0, yellow: 0, red: 0, degraded: 0 };
  for (const g of gateResults) {
    if (g.status === "green") summary.green += 1;
    else if (g.status === "yellow") summary.yellow += 1;
    else if (g.status === "red") summary.red += 1;
    else summary.degraded += 1;
  }
  const ok = summary.red === 0;
  const totalDurationMs = Date.now() - startMs;
  const completedAt = new Date().toISOString();
  const report = {
    ok,
    gateCount: gateResults.length,
    greenCount: summary.green,
    yellowCount: summary.yellow,
    redCount: summary.red,
    degradedCount: summary.degraded,
    gates: gateResults,
    totalDurationMs,
    startedAt,
    completedAt,
  };

  events.emitPreflightSummary(targetRoot, {
    txId: opts.txId || null,
    ok,
    gateCount: gateResults.length,
    redCount: summary.red,
    yellowCount: summary.yellow,
    greenCount: summary.green,
    totalDurationMs,
  });

  return report;
}

function formatReport(report) {
  const lines = [];
  if (report.ok) {
    lines.push(
      `Preflight: ${report.gateCount}/${report.gateCount} gates GREEN`,
    );
  } else {
    lines.push(
      `Preflight: ${report.greenCount}/${report.gateCount} GREEN, ${report.redCount} RED, ${report.yellowCount} YELLOW, ${report.degradedCount} DEGRADED`,
    );
  }
  for (const g of report.gates) {
    const tag = g.status.toUpperCase().padEnd(8);
    lines.push(`  ${tag} ${g.name.padEnd(28)} ${g.reason || ""}`);
    if (g.status === "red" && g.remediation) {
      for (const line of g.remediation.split("\n")) {
        lines.push(`           ${line}`);
      }
    }
  }
  return lines.join("\n");
}

module.exports = {
  runPreflight,
  formatReport,
  GATES,
  KNOWN_GATE_NAMES,
  validateOverrideReason,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? null : args[i + 1];
  };
  const operatorOverrides = new Set();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--operator-override" && i + 1 < args.length) {
      operatorOverrides.add(args[i + 1]);
    }
  }
  for (const g of operatorOverrides) {
    if (!KNOWN_GATE_NAMES.has(g)) {
      process.stderr.write(
        `unknown gate "${g}" for --operator-override. Valid: ${[...KNOWN_GATE_NAMES].sort().join(", ")}\n`,
      );
      process.exit(2);
    }
  }
  const rawReason = get("--override-reason");
  let overrideReason = null;
  if (operatorOverrides.size > 0) {
    overrideReason = validateOverrideReason(rawReason);
    if (!overrideReason) {
      process.stderr.write(
        '--operator-override requires --override-reason "<text>" (8-500 chars after trim). No override applied.\n',
      );
      process.exit(2);
    }
  }
  const opts = {
    targetRoot: path.resolve(
      get("--target") || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    ),
    sourceTreeRoot: get("--source-tree")
      ? path.resolve(get("--source-tree"))
      : path.resolve(__dirname, "..", ".."),
    toVersion: get("--to"),
    sourceRoot: get("--source") ? path.resolve(get("--source")) : null,
    allowStale: args.includes("--allow-stale"),
    forceFresh: args.includes("--force-fresh"),
    allowVersionDrift: args.includes("--allow-version-drift"),
    allRed: args.includes("--all-red") || args.includes("--diagnostic"),
    operatorOverrides,
    overrideReason,
    operator: get("--operator") || null,
  };
  const report = runPreflight(opts);
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatReport(report) + "\n");
    if (operatorOverrides.size > 0) {
      process.stdout.write(
        `Operator override accepted for gate(s): ${[...operatorOverrides].join(", ")}. Reason: ${overrideReason}. Audit event(s) written to paths.eventsFile.\n`,
      );
    }
  }
  process.exit(report.ok ? 0 : 1);
}
