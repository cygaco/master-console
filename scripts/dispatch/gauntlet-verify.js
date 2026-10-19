#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");
const { normalizeRole } = require("../hooks/lib/role-aliases");
const { verifyRecord } = require("./attest-signing");

const FUTURE_SKEW_ALLOWANCE_MS = 24 * 60 * 60 * 1000;

function defaultCompletionsFile() {
  return (
    PATHS.dispatchCompletionsFile ||
    path.join(PATHS.runtime, "dispatch-completions.jsonl")
  );
}

function toMs(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function isProvidedBound(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "number") return true;
  return String(v).trim() !== "";
}

function recordCompletedMs(rec) {
  return toMs(rec.completed_at) ?? toMs(rec.started_at);
}

function isWellFormedOkRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (typeof rec.role !== "string" || !rec.role.trim()) return false;
  // liveness-verified: shape-only typed-success predicate; origin-proof SIGNATURE verification is applied in
  if (rec.ok !== true) return false;
  if (typeof rec.provider !== "string" || !rec.provider.trim()) return false;
  const t = toMs(rec.completed_at) ?? toMs(rec.started_at);
  if (t === null) return false;
  return true;
}

function readCompletions(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { records: [], malformed: 0, malformedLineIndices: [], recordLineIndices: [], missing: true };
  }
  const records = [];
  const recordLineIndices = [];
  const malformedLineIndices = [];
  let malformed = 0;
  let lineIdx = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { lineIdx++; continue; }
    try {
      records.push(JSON.parse(trimmed));
      recordLineIndices.push(lineIdx);
    } catch {
      malformedLineIndices.push(lineIdx);
      malformed++;
    }
    lineIdx++;
  }
  return { records, malformed, malformedLineIndices, recordLineIndices, missing: false };
}

function verifyGauntlet(args = {}) {
  const runId = args.runId || "(unlabeled)";

  for (const [name, val] of [["since", args.since], ["until", args.until]]) {
    if (isProvidedBound(val) && toMs(val) === null) {
      throw new Error(
        `verifyGauntlet: unparseable window (${name}=${JSON.stringify(val)}) — refusing ` +
        "(whole-ledger scan is forbidden); pass valid ISO timestamps or epoch ms",
      );
    }
  }

  const sprintId = args.sprintId ? String(args.sprintId).trim() : null;
  const allowFailed = !!args.allowFailed;
  const strictFallback = !!args.strictFallback;
  const requireSignature = args.requireSignature === true;

  const rolesIn = Array.isArray(args.roles) ? args.roles : [];
  const seen = new Set();
  const roles = [];
  for (const r of rolesIn) {
    const canon = normalizeRole(String(r).trim());
    if (!canon || seen.has(canon)) continue;
    seen.add(canon);
    roles.push(canon);
  }

  if (roles.length === 0) {
    const sinceMs0 = toMs(args.since);
    const untilMs0 = toMs(args.until);
    return {
      ok: false,
      runId,
      sprintId: sprintId || undefined,
      window: { sinceMs: sinceMs0, untilMs: untilMs0 },
      completionsFile: null,
      ledgerMissing: false,
      malformedLines: 0,
      malformedTainted: false,
      considered: 0,
      roles: [],
      missingRoles: [],
      noRolesRequested: true,
    };
  }

  const sinceMs = toMs(args.since);
  const untilMs = toMs(args.until);
  const hasWindow = sinceMs !== null || untilMs !== null;

  let records;
  let malformed = 0;
  let malformedLineIndices = [];
  let recordLineIndices = [];
  let ledgerMissing = false;
  let completionsFile = null;
  if (Array.isArray(args.records)) {
    records = args.records;
  } else {
    completionsFile = args.completionsFile || defaultCompletionsFile();
    const read = readCompletions(completionsFile);
    records = read.records;
    malformed = read.malformed;
    malformedLineIndices = read.malformedLineIndices || [];
    recordLineIndices = read.recordLineIndices || [];
    ledgerMissing = read.missing;
  }

  const nowMs = Date.now();
  const effectiveUntilMs = untilMs ?? (hasWindow ? nowMs + FUTURE_SKEW_ALLOWANCE_MS : null);
  const hardCeilingMs = nowMs + FUTURE_SKEW_ALLOWANCE_MS;

  const inWindow = (rec) => {
    if (sprintId && rec.sprint_id !== undefined && rec.sprint_id !== sprintId) return false;
    if (sprintId && rec.sprint_id === undefined && sinceMs === null && untilMs === null) return false;
    const t = recordCompletedMs(rec);
    if (sinceMs === null && untilMs === null) return true;
    if (t === null) return false;
    if (sinceMs !== null && t < sinceMs) return false;
    if (effectiveUntilMs !== null && t > effectiveUntilMs) return false;
    if (t > hardCeilingMs) return false;
    return true;
  };
  const considered = records.filter(inWindow);

  let filemalformedTainted = false;
  if (malformed > 0) {
    if (!hasWindow) {
      filemalformedTainted = true;
    } else {
      const inWindowLineIdxs = [];
      for (let i = 0; i < records.length; i++) {
        if (inWindow(records[i]) && i < recordLineIndices.length) {
          inWindowLineIdxs.push(recordLineIndices[i]);
        }
      }
      if (inWindowLineIdxs.length === 0) {
        filemalformedTainted = true;
      } else {
        const firstInWindowIdx = Math.min(...inWindowLineIdxs);
        const lastInWindowIdx  = Math.max(...inWindowLineIdxs);
        void lastInWindowIdx;
        filemalformedTainted = malformedLineIndices.some((idx) => idx >= firstInWindowIdx - 1);
      }
    }
  }

  const byRole = new Map();
  for (const rec of considered) {
    const canon = normalizeRole(rec.role);
    if (!canon) continue;
    if (!byRole.has(canon)) byRole.set(canon, []);
    byRole.get(canon).push(rec);
  }

  let illTypedTaint = false;

  const roleResults = roles.map((role) => {
    const recs = byRole.get(role) || [];
    let status;
    let record = null;
    let wellFormed = null;

    if (recs.length === 0) {
      status = "no-record";
    } else {
      const sigOk = (r) => !requireSignature || verifyRecord(r);
      const okRec = recs.find((r) => r.ok === true && !r.fallback && isWellFormedOkRecord(r) && sigOk(r));
      const fbRec = recs.find((r) => r.ok === true && r.fallback && isWellFormedOkRecord(r) && sigOk(r));
      const illTypedRec = recs.find((r) => r.ok === true && !isWellFormedOkRecord(r));
      const unsignedRec = requireSignature
        ? recs.find((r) => r.ok === true && isWellFormedOkRecord(r) && !verifyRecord(r))
        : null;
      const failRec = recs.find((r) => r.ok !== true);

      if (okRec) {
        status = "ran";
        record = okRec;
        wellFormed = true;
      } else if (fbRec) {
        status = "fell-back";
        record = fbRec;
        wellFormed = true;
      } else if (unsignedRec) {
        status = "unsigned";
        record = unsignedRec;
        wellFormed = false;
        illTypedTaint = true;
      } else if (illTypedRec) {
        status = "ill-typed";
        record = illTypedRec;
        wellFormed = false;
        illTypedTaint = true;
      } else {
        status = "failed";
        record = failRec || recs[recs.length - 1];
        wellFormed = null;
      }
    }

    let satisfied;
    if (status === "ran") satisfied = true;
    else if (status === "fell-back") satisfied = !strictFallback;
    else if (status === "failed") satisfied = false;
    else satisfied = false;

    return { role, status, satisfied, record, count: recs.length, wellFormed };
  });

  const missingRoles = roleResults
    .filter((r) => !r.satisfied)
    .map((r) => r.role);

  const malformedTainted = filemalformedTainted || illTypedTaint;

  return {
    ok: missingRoles.length === 0 && !malformedTainted,
    runId,
    sprintId: sprintId || undefined,
    window: { sinceMs, untilMs },
    completionsFile,
    ledgerMissing,
    malformedLines: malformed,
    malformedTainted,
    considered: considered.length,
    roles: roleResults,
    missingRoles,
  };
}

module.exports = {
  verifyGauntlet,
  readCompletions,
  defaultCompletionsFile,
  isWellFormedOkRecord,
};

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);

    function getFlag(name) {
      const i = argv.indexOf(`--${name}`);
      if (i === -1) return undefined;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return true;
      return next;
    }

    if (argv.includes("--help") || argv.includes("-h")) {
      process.stdout.write(
        [
          "gauntlet-verify — verify each gauntlet role produced a well-formed completion record.",
          "",
          "typed-success enforcer: absence of an ok:true well-formed record for a required",
          "role IS the death signal. Malformed/ill-typed/no-record all fail-CLOSED.",
          "Never trust orchestrator narration; trust the ledger.",
          "",
          "Unbounded whole-ledger verification is REFUSED.",
          "Pass --sprint <id> or a time window (--since/--until) to correlate records to the",
          "current sprint/run. A historic ok:true must never green a never-ran lane.",
          "",
          "Usage:",
          "  node scripts/dispatch/gauntlet-verify.js --run <id> --roles a,b,c \\",
          "    [--sprint <sprint-id>] [--since <iso|ms>] [--until <iso|ms>] \\",
          "    [--completions <path>] [--allow-failed] [--strict-fallback] [--json]",
          "",
          "Exit: 0 = all roles have a well-formed record; 1 = no-record/ill-typed/malformed-tainted; 2 = usage/internal error.",
          "",
          "Flags:",
          "  --sprint <id>       Sprint correlation: records with a non-matching sprint_id are excluded.",
          "                      Records without sprint_id fall through to time-window correlation.",
          "                      Required when --since/--until are not provided.",
          "  --allow-failed      Accepted for backward compat; no longer greens a pure-failed role.",
          "                      A role whose only record is ok:false is never satisfied regardless of this flag.",
          "  --strict-fallback   Fail when any role only fell back to Claude (default: fell-back counts as ran).",
          "  --no-require-sig    Disable origin-proof signature verification. Default is ON — a",
          "                      forged UNSIGNED ok:true record is fail-closed as 'unsigned'. Escape for",
          "                      transition/debug only; also MC_GAUNTLET_REQUIRE_SIG=0.",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }

    const runId = getFlag("run") || getFlag("run-id");
    const sprintIdArg = getFlag("sprint");
    const rolesArg = getFlag("roles");
    const since = getFlag("since");
    const until = getFlag("until");
    const completionsFile = getFlag("completions");
    const jsonMode = argv.includes("--json");
    const allowFailed = argv.includes("--allow-failed");
    const strictFallback = argv.includes("--strict-fallback");
    const requireSignature =
      !argv.includes("--no-require-sig") && mcEnv.readEnv("GAUNTLET_REQUIRE_SIG") !== "0";

    if (!rolesArg || rolesArg === true) {
      process.stderr.write(
        "Usage error: --roles <comma,separated,list> is required. See --help.\n",
      );
      process.exit(2);
    }
    const roles = String(rolesArg)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (roles.length === 0) {
      process.stderr.write("Usage error: --roles resolved to an empty list.\n");
      process.exit(2);
    }

    const hasSprintCorrelation = sprintIdArg && sprintIdArg !== true;
    const hasWindow = (since !== undefined && since !== true) || (until !== undefined && until !== true);
    if (!hasSprintCorrelation && !hasWindow) {
      process.stderr.write(
        "Usage error: gauntlet-verify requires --sprint <id> or a time window " +
        "(--since and/or --until) to prevent a historic ok:true record from satisfying " +
        "a never-ran lane. Unbounded whole-ledger verification is refused.\n",
      );
      process.exit(2);
    }
    for (const [flagName, flagVal] of [["--since", since], ["--until", until]]) {
      if (flagVal !== undefined && flagVal !== true && toMs(flagVal) === null) {
        process.stderr.write(
          `Usage error: ${flagName} value "${flagVal}" is not a parseable timestamp ` +
          "(ISO 8601 or epoch ms). Refusing — an unparseable window would silently widen " +
          "to an unbounded whole-ledger scan.\n",
        );
        process.exit(2);
      }
    }

    const result = verifyGauntlet({
      runId: runId && runId !== true ? runId : undefined,
      sprintId: hasSprintCorrelation ? String(sprintIdArg) : undefined,
      roles,
      since: since === true ? undefined : since,
      until: until === true ? undefined : until,
      completionsFile:
        completionsFile && completionsFile !== true ? completionsFile : undefined,
      allowFailed,
      strictFallback,
      requireSignature,
    });

    if (jsonMode) {
      process.stdout.write(JSON.stringify(result) + "\n");
    } else {
      const SEP = "─".repeat(60);
      const lines = [];
      lines.push(
        `Gauntlet verification — run ${result.runId} — ${result.ok ? "PASS" : "FAIL"}`,
      );
      lines.push(SEP);
      if (result.ledgerMissing) {
        lines.push(
          `  (!) completions ledger not found: ${result.completionsFile}`,
        );
        lines.push(
          "      No dispatch ever recorded — every role reads as no-record.",
        );
      }
      if (result.malformedTainted) {
        lines.push(
          `  (!) MALFORMED-TAINTED: ${result.malformedLines} unparseable ledger line(s) found; ` +
          `the ledger is not trustworthy (typed-success: fail-CLOSED).`,
        );
      } else if (result.malformedLines > 0) {
        lines.push(
          `  (i) skipped ${result.malformedLines} malformed ledger line(s) (no window active — lenient)`,
        );
      }
      for (const r of result.roles) {
        const icon =
          r.status === "ran"
            ? "ok"
            : r.status === "fell-back"
              ? "fb"
              : r.status === "failed"
                ? "xx"
                : r.status === "ill-typed"
                  ? "~~"
                  : r.status === "unsigned"
                    ? "$$"
                    : "!!";
        const role = String(r.role).padEnd(12);
        const status = String(r.status).padEnd(10);
        let detail = "";
        if (r.status === "ill-typed" && r.record) {
          const provider = r.record.provider || "(missing)";
          const ts = r.record.completed_at || r.record.started_at || "(no timestamp)";
          detail = `ok:true but ILL-TYPED — provider=${provider}, ts=${ts} — NOT a valid success`;
        } else if (r.status === "unsigned" && r.record) {
          const provider = r.record.provider || "?";
          detail = `ok:true well-formed but UNSIGNED/forged — no valid origin-proof signature (provider=${provider}) — NOT trusted (fail-closed)`;
        } else if (r.record) {
          const provider = r.record.provider || "?";
          const model = r.record.model || "?";
          detail = `${provider}/${model}`;
          if (r.count > 1) detail += ` (${r.count} records)`;
        } else {
          detail = "NO COMPLETION RECORD — silent death or never dispatched";
        }
        lines.push(`  ${icon}  ${role} ${status} ${detail}`.trimEnd());
      }
      lines.push(SEP);
      lines.push(`  considered ${result.considered} record(s) in window`);
      if (result.ok) {
        lines.push("  All required gauntlet roles produced a well-formed completion record.");
      } else {
        if (result.missingRoles.length > 0) {
          lines.push(
            `  MISSING/UNSATISFIED: ${result.missingRoles.join(", ")} — do NOT trust "all passed". Re-dispatch these roles.`,
          );
        }
        if (result.malformedTainted) {
          lines.push(
            "  LEDGER TAINTED by malformed/ill-typed records — re-inspect ledger before trusting any result.",
          );
        }
      }
      process.stdout.write(lines.join("\n") + "\n");
    }

    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    process.stderr.write(
      `[gauntlet-verify] internal error: ${err && err.message ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }
}
