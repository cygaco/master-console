"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const lease = require("./conductor-lease");

const ROOT = path.resolve(__dirname, "..", "..");

const FALLBACK_LOG_REL = path.join("runtime", "broker-dogfood", "dogfood-fallbacks.jsonl");
const FALLBACK_SCHEMA = "dogfood-fallback/1";

const SECURITY_REASONS = Object.freeze([
  "new-head-unresolvable",
  "new-head-not-a-commit",
  "live-head-unresolvable",
  "new-head-equals-live-head",
  "new-head-not-descendant-of-live-head",
  "head-binding-refused",
  "head-binding-error",
  "merge-first-parent-not-live-head",
  "release-parent-not-live-head",
  "result-tree-mutated-mid-run",
  "pinned-suite-failed",
  "incomplete-bundle-manifest",
  "bundle-pin-mismatch",
  "bundle-lineage-mismatch",
  "bundle-lineage-unresolvable",
  "pinned-node-inside-candidate",
  "pinned-checklib-inside-candidate",
  "empty-expected-check-set",
  "malformed-run-nonce",
  "malformed-check-result",
  "unknown-check-result",
  "stale-check-result",
  "duplicate-check-result",
  "missing-required-check",
  "check-failed",
  "check-timed-out",
  "required-check-skipped",
  "lease-not-held",
  "ref-update-refused",
  "fallback-unrecordable",
  "bundle-load-failed",
  "result-tree-materialize-failed",
]);

const USAGE_REASONS = Object.freeze([
  "invalid-target-ref",
  "merge-commit-unresolvable",
  "merge-parents-unresolvable",
  "merge-commit-not-a-two-parent-merge",
  "release-commit-unresolvable",
  "release-parents-unresolvable",
  "release-commit-not-single-parent",
  "branch-unresolvable",
  "already-merged",
  "merge-conflict",
  "nothing-to-commit",
  "target-ref-unresolvable",
]);

const OPERATIONAL_REASONS = Object.freeze([
  "ref-update-error",
  "no-pinned-bundle-configured",
  "broker-module-unavailable",
  "broker-threw",
  "merge-tree-unsupported",
]);

const REASON_CLASS = Object.freeze(
  Object.fromEntries([
    ...SECURITY_REASONS.map((r) => [r, "security"]),
    ...USAGE_REASONS.map((r) => [r, "usage"]),
    ...OPERATIONAL_REASONS.map((r) => [r, "operational"]),
  ]),
);

function classifyRefusal(reason) {
  if (typeof reason !== "string" || !reason) return "security";
  return REASON_CLASS[reason] || "security";
}

function fallbackAllowed(reason) {
  return classifyRefusal(reason) === "operational";
}

function defaultLogPath(root) {
  return path.join(root || ROOT, FALLBACK_LOG_REL);
}

function readFallbacks(logPath) {
  let raw;
  try {
    raw = fs.readFileSync(logPath, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { _malformed: true, raw: l };
      }
    });
}

function fallbackCount(logPath) {
  return readFallbacks(logPath).length;
}

function readFallbacksSafe(logPath) {
  try {
    return { rows: readFallbacks(logPath), unreadable: false };
  } catch {
    return { rows: null, unreadable: true };
  }
}

function fallbackCountSafe(logPath) {
  const safe = readFallbacksSafe(logPath);
  return { count: safe.unreadable ? null : safe.rows.length, unreadable: safe.unreadable };
}

function recordFallback(entry, opts = {}) {
  const logPath = opts.logPath || defaultLogPath(opts.root);
  let prior;
  try {
    prior = fallbackCount(logPath);
  } catch (e) {
    return { ok: false, count: null, record: null, logPath, error: `ledger-unreadable: ${e.message}`, event_mirrored: false };
  }
  const record = {
    schema: FALLBACK_SCHEMA,
    seq: prior + 1,
    ts: new Date(typeof opts.now === "number" ? opts.now : Date.now()).toISOString(),
    sprint: "SP-00000000-000",
    unit: "brokered-transport",
    ...entry,
  };
  const line = `${JSON.stringify(record)}\n`;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line, "utf8");
  } catch (e) {
    return { ok: false, count: prior, record, logPath, error: e.message, event_mirrored: false };
  }

  let mirrored = false;
  if (opts.eventsPath) {
    try {
      fs.mkdirSync(path.dirname(opts.eventsPath), { recursive: true });
      fs.appendFileSync(opts.eventsPath, `${JSON.stringify({ type: "broker-dogfood-fallback", ...record })}\n`, "utf8");
      mirrored = true;
    } catch {
      mirrored = false;
    }
  }

  let derived;
  try {
    derived = fallbackCount(logPath);
  } catch {
    derived = prior + 1;
  }
  return { ok: true, count: derived, record, logPath, event_mirrored: mirrored };
}

function resolveEventsPath() {
  try {
    const { PATHS } = require("../hooks/lib/paths");
    return PATHS && PATHS.eventsFile ? PATHS.eventsFile : null;
  } catch {
    return null;
  }
}

function fallbackBanner(record, count, logPath) {
  const bar = "═".repeat(94);
  return [
    "",
    bar,
    `  ⚠  DOGFOOD FALLBACK #${count} — THE BROKERED TRANSPORT WAS **NOT** EXERCISED FOR THIS WRITE`,
    bar,
    `  transport      : ${record.transport}`,
    `  target_ref     : ${record.target_ref}`,
    `  broker reason  : ${record.reason} (${record.classification})`,
    record.detail ? `  detail         : ${String(record.detail).slice(0, 300)}` : null,
    `  route taken    : ${record.fallback_route} (ORDINARY, un-brokered)`,
    `  ledger         : ${logPath}`,
    `  running count  : ${count}`,
    "",
    "  This write does NOT count as transport mileage. The honest bar at flip time is ZERO fallbacks,",
    "  or every one individually explained from the ledger above. Do not report the transport as",
    '  "proven in production" while this count is non-zero and unexplained.',
    bar,
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function refusalBanner(transport, reason, classification, detail) {
  const bar = classification === "security" ? "█".repeat(94) : "─".repeat(94);
  const head =
    classification === "security"
      ? "  ⛔ BROKER REFUSED (SECURITY) — NO FALLBACK. The ordinary route is NOT an option here."
      : "  ✖ BROKER REFUSED (USAGE) — the call is malformed. Fix the call; no fallback.";
  return ["", bar, head, bar, `  transport : ${transport}`, `  reason    : ${reason}`, detail ? `  detail    : ${String(detail).slice(0, 300)}` : null, bar, ""]
    .filter((l) => l !== null)
    .join("\n");
}

function git(args, cwd, env) {
  const r = spawnSync("git", args, {
    cwd: cwd || ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return {
    ok: !!r && r.status === 0,
    status: r ? r.status : null,
    stdout: String((r && r.stdout) || "").trim(),
    stderr: String((r && r.stderr) || (r && r.error && r.error.message) || "").trim(),
  };
}

function gitRead(args, cwd) {
  const r = git(args, cwd);
  return r.ok ? r.stdout : null;
}

function resolveRef(ref, cwd) {
  const out = gitRead(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
  return out ? out.toLowerCase() : null;
}

function currentBranchRef(cwd) {
  return gitRead(["symbolic-ref", "-q", "HEAD"], cwd);
}

function leaseReleaseWarning(spId, detail) {
  const bar = "═".repeat(94);
  return [
    "",
    bar,
    `  ⚠  LEASE RELEASE FAILED — the conductor lease for ${spId} may be ORPHANED`,
    `     ${detail}`,
    "     A later conductor may be blocked until it is cleared. Investigate before the next run.",
    bar,
    "",
  ].join("\n");
}

function ensureLease(spId, leaseRoot, api = lease) {
  const noop = () => ({ ok: true, released: false });
  if (!spId) return { ok: false, state: "no-sp-id", release: noop };
  let acquired = null;
  try {
    acquired = api.acquire(spId, { root: leaseRoot, sessionId: `broker-dogfood-${process.pid}` });
  } catch (e) {
    return { ok: false, state: "acquire-threw", detail: e.message, release: noop };
  }
  if (acquired && acquired.ok) {
    return {
      ok: true,
      state: "acquired",
      token: acquired.token,
      release: () => {
        let r;
        try {
          r = api.release(spId, { root: leaseRoot, token: acquired.token });
        } catch (e) {
          const err = `lease release threw: ${e.message}`;
          process.stderr.write(leaseReleaseWarning(spId, err));
          return { ok: false, released: false, error: err };
        }
        if (r && r.ok === false) {
          const err = `lease release refused: ${r.reason || "unknown"}`;
          process.stderr.write(leaseReleaseWarning(spId, err));
          return { ok: false, released: false, error: err };
        }
        return { ok: true, released: true };
      },
    };
  }
  if (acquired && acquired.reason === "held") {
    return { ok: true, state: "pre-existing", token: null, release: noop };
  }
  return { ok: false, state: (acquired && acquired.reason) || "unavailable", release: noop };
}

function loadBroker(injected) {
  if (injected) return { ok: true, broker: injected };
  try {
    return { ok: true, broker: require("./trusted-controller") };
  } catch (e) {
    return { ok: false, reason: "broker-module-unavailable", detail: e.message };
  }
}

function resolveBundleConfig(opts = {}, env = process.env) {
  const manifest = opts.bundleManifestPath || mcEnv.readEnv("PINNED_BUNDLE_MANIFEST", env) || null;
  const bundleRoot = opts.bundleRoot || mcEnv.readEnv("PINNED_BUNDLE_ROOT", env) || (manifest ? path.dirname(manifest) : null);
  if (!manifest) return { ok: false, reason: "no-pinned-bundle-configured", detail: "set --bundle-manifest or MC_PINNED_BUNDLE_MANIFEST (a PROMOTED, out-of-tree bundle)" };
  if (!fs.existsSync(manifest)) return { ok: false, reason: "bundle-load-failed", detail: `configured bundle manifest is missing or unstatable: ${manifest}` };
  return { ok: true, bundleManifestPath: manifest, bundleRoot };
}

function ordinaryLand(args = {}) {
  const { gitRoot, targetRef, newHead, expectedHead, branch, message, kind } = args;
  const onTarget = currentBranchRef(gitRoot) === targetRef;
  if (kind === "branch-merge" && onTarget && branch) {
    const r = git(["merge", "--no-ff", "-m", message || `merge ${branch}`, branch], gitRoot);
    return r.ok ? { ok: true, route: "git merge --no-ff" } : { ok: false, route: "git merge --no-ff", reason: "ordinary-merge-failed", detail: r.stderr };
  }
  if (!newHead) {
    return { ok: false, route: "git update-ref", reason: "ordinary-update-ref-failed", detail: "no commit object to land (newHead is null)" };
  }
  const r = git(["update-ref", targetRef, newHead, expectedHead], gitRoot);
  return r.ok ? { ok: true, route: "git update-ref" } : { ok: false, route: "git update-ref", reason: "ordinary-update-ref-failed", detail: r.stderr };
}

function attemptFallback(ctx = {}) {
  const { reason, detail, transport, targetRef, gitRoot, newHead, expectedHead, branch, message, logPath, eventsPath, now } = ctx;
  const classification = classifyRefusal(reason);
  if (classification !== "operational") {
    return { ok: false, route: "none", refused: true, classification, reason };
  }
  if (ctx.allowFallback === false) {
    return { ok: false, route: "none", refused: true, classification, reason: "fallback-disabled-by-flag", broker_reason: reason };
  }

  const kind = transport;
  const draft = {
      transport,
      target_ref: targetRef,
      reason,
      classification,
      detail: detail || null,
      new_head: newHead || null,
      previous_head: expectedHead || null,
      source_branch: branch || null,
      fallback_route: kind === "branch-merge" && currentBranchRef(gitRoot) === targetRef && branch ? "git merge --no-ff" : "git update-ref",
      actor: ctx.actor || "alpha-merge-hand",
      cwd: gitRoot || ROOT,
  };

  if (ctx.dryRun === true) {
    const dryLogPath = logPath || defaultLogPath(ctx.root);
    let currentCount;
    try {
      currentCount = fallbackCount(dryLogPath);
    } catch (e) {
      return { ok: false, route: "none", refused: true, classification: "security", reason: "fallback-unrecordable", detail: `ledger-unreadable: ${e.message}`, broker_reason: reason, dry_run: true };
    }
    const projected = currentCount + 1;
    const preview = { schema: FALLBACK_SCHEMA, seq: projected, ts: null, dry_run: true, ...draft };
    const dryBanner = fallbackBanner({ ...preview, transport: `${preview.transport} (DRY RUN — nothing written)` }, projected, dryLogPath);
    if (ctx.emit !== false) process.stderr.write(`${dryBanner}\n`);
    return {
      ok: true,
      route: "dry-run",
      performed: false,
      recorded: false,
      record: preview,
      count: currentCount,
      projected_count: projected,
      banner: dryBanner,
    };
  }

  const rec = recordFallback(draft, { logPath, eventsPath, now, root: ctx.root });

  if (!rec.ok) {
    return { ok: false, route: "none", refused: true, classification: "security", reason: "fallback-unrecordable", detail: rec.error, broker_reason: reason };
  }

  const banner = fallbackBanner(rec.record, rec.count, rec.logPath);
  if (ctx.emit !== false) process.stderr.write(`${banner}\n`);

  const landed = ordinaryLand({ gitRoot, targetRef, newHead, expectedHead, branch, message, kind });
  return {
    ok: landed.ok,
    route: landed.route,
    reason: landed.reason,
    detail: landed.detail,
    record: rec.record,
    count: rec.count,
    banner,
    performed: true,
  };
}

function report(logPath) {
  const p = logPath || defaultLogPath();
  const { rows, unreadable } = readFallbacksSafe(p);
  if (unreadable) {
    const bar = "═".repeat(94);
    const text = [
      "brokered-transport dogfood fallback ledger",
      `  ledger : ${p}`,
      bar,
      "  ⛔ LEDGER UNREADABLE — the fallback count CANNOT be certified.",
      "  Do NOT argue the Seam E flip from dogfood mileage until this ledger reads cleanly.",
      bar,
    ].join("\n");
    return { count: null, rows: null, unreadable: true, error: "ledger present but unreadable", text };
  }
  const lines = [];
  lines.push("brokered-transport dogfood fallback ledger");
  lines.push(`  ledger : ${p}`);
  lines.push(`  count  : ${rows.length}`);
  if (rows.length === 0) {
    lines.push("");
    lines.push("  ✔ ZERO fallbacks — every dogfooded write went through the brokered transport.");
  } else {
    lines.push("");
    for (const r of rows) {
      if (r._malformed) {
        lines.push(`  #? MALFORMED LEDGER LINE (counted, unparseable): ${String(r.raw).slice(0, 160)}`);
        continue;
      }
      lines.push(`  #${r.seq} ${r.ts} ${r.transport} -> ${r.target_ref}`);
      lines.push(`       reason: ${r.reason} (${r.classification}) via ${r.fallback_route}`);
      if (r.detail) lines.push(`       detail: ${String(r.detail).slice(0, 200)}`);
    }
    lines.push("");
    lines.push(`  ⚠ ${rows.length} fallback(s). Each must be individually EXPLAINED before the transport is`);
    lines.push("    described as proven, and before the Seam E fence flip is argued from dogfood mileage.");
  }
  return { count: rows.length, rows, text: lines.join("\n") };
}

module.exports = {
  ROOT,
  FALLBACK_LOG_REL,
  FALLBACK_SCHEMA,
  SECURITY_REASONS,
  USAGE_REASONS,
  OPERATIONAL_REASONS,
  REASON_CLASS,
  classifyRefusal,
  fallbackAllowed,
  defaultLogPath,
  readFallbacks,
  readFallbacksSafe,
  fallbackCount,
  fallbackCountSafe,
  recordFallback,
  resolveEventsPath,
  fallbackBanner,
  refusalBanner,
  git,
  gitRead,
  resolveRef,
  currentBranchRef,
  ensureLease,
  loadBroker,
  resolveBundleConfig,
  ordinaryLand,
  attemptFallback,
  report,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--log");
  const p = idx >= 0 ? argv[idx + 1] : undefined;
  const r = report(p);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ count: r.count, rows: r.rows, unreadable: r.unreadable || false, log: p || defaultLogPath() }, null, 2));
  } else {
    console.log(r.text);
  }
  process.exit(r.unreadable ? 1 : 0);
}
