#!/usr/bin/env node
/**
 * scripts/turbo/apply.js — /turbo skill mutator.
 *
 * Grants scoped, time-bounded autonomy that lets routine builder loops run
 * without per-call confirmations. Hybrid mechanism:
 *
 *   1. Additively merges curated entries into `.claude/settings.json#permissions.allow`
 *      so the harness classifier auto-allows the listed patterns.
 *   2. Writes `paths.runtime/authorization.json` (schema mc/auth/v1) so the
 *      project-side PreToolUse hook `scripts/hooks/authorization-gate.js` can
 *      short-circuit downstream guards for the matching scope.
 *
 * Always snapshots `.claude/settings.json` to `paths.runtime/settings-pre-turbo.json`
 * BEFORE the first mutation in a session — `--off` restores from snapshot. Subsequent
 * applies in the same session are merged into the live settings.json without re-
 * snapshotting (otherwise we'd snapshot a turbo-flavoured settings as "pre-turbo").
 *
 * CLI:
 *   node scripts/turbo/apply.js --scope <csv|all> [--ttl <Nm|Nh>] [--reason "<text>"]
 *   node scripts/turbo/apply.js --off
 *   node scripts/turbo/apply.js --status
 *
 * Scope vocabulary:
 *   push-to-main      git push origin main (NOT default; opt-in only)
 *   manifest-edit     Edit/Write .claude/manifest.json
 *   destructive-git   git rm --cached <path>, git reset --hard <ref>
 *   node-e-fs         node -e "...fs.writeFileSync..." / fs.appendFileSync
 *   write-jsonl       Write to any *.jsonl (events, decisions, memory tails)
 *   worktree-ops      git worktree add/remove/prune/move
 *
 * Default scope (when --scope is omitted): manifest-edit,write-jsonl,worktree-ops
 *   (node-e-fs is NOT default — the Claude Code auto-mode classifier hard-denies
 *    "arbitrary code" Bash, so a default --turbo apply that granted it would fail
 *    on first use. node-e-fs remains an explicit opt-in token: --scope ...,node-e-fs)
 *
 * Safety floor (NEVER authorized, even with --scope all):
 *   - git push --force to main
 *   - delete branches matching backup/* or pre-*
 *   - signups/purchases of services
 *   - API spend >= $5 total per session
 *   - Beta consultation ESCALATE returns
 *   - delete tracked uncommitted user work
 *
 * Fail-closed on settings.json write failure. Fail-open on logger errors.
 */

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");

// ── Load PATHS registry (with safe fallback) ───────────────
const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
let PATHS = {};
try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
  );
  PATHS = Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => k !== "version" && k !== "$schema")
      .map(([k, v]) => [k, path.join(PROJECT, v)]),
  );
} catch {
  /* registry optional; fall through to hardcoded defaults below */
}
const SETTINGS_PATH =
  PATHS.settings || path.join(PROJECT, ".claude", "settings.json");
const RUNTIME_DIR = PATHS.runtime || path.join(PROJECT, ".claude", "runtime");
const SNAPSHOT_PATH = path.join(RUNTIME_DIR, "settings-pre-turbo.json");
const AUTH_PATH = path.join(RUNTIME_DIR, "authorization.json");

// Logger is best-effort — never block on logging failure.
let logEvent = null;
try {
  ({ logEvent } = require(
    path.join(PROJECT, "scripts", "hooks", "lib", "logger.js"),
  ));
} catch {
  /* logger optional */
}
function logAudit(action, target, detail, meta) {
  if (!logEvent) return;
  try {
    logEvent("audit", "turbo", action, target || "", detail || "", meta);
  } catch {
    /* swallow */
  }
}

// ── Scope vocabulary + curated permissions ──────────────────
//
// Each scope maps to an array of `permissions.allow` patterns that match the
// harness-classifier's syntax. These are additively merged into settings.json.
// The hook authorization-gate.js inspects the SAME scope vocabulary on the
// project-hook side.
const KNOWN_SCOPES = new Set([
  "push-to-main",
  "manifest-edit",
  "destructive-git",
  "node-e-fs",
  "write-jsonl",
  "worktree-ops",
]);

const SCOPE_PERMISSIONS = {
  "manifest-edit": [
    "Edit(.claude/manifest.json)",
    "Write(.claude/manifest.json)",
  ],
  "write-jsonl": [
    "Write(.claude/project/events/**.jsonl)",
    "Write(.claude/project/memory/**.jsonl)",
    "Write(.claude/project/decisions/**.jsonl)",
    "Write(.claude/runtime/**.jsonl)",
  ],
  "node-e-fs": [
    "Bash(node -e *fs.writeFileSync*)",
    "Bash(node -e *fs.appendFileSync*)",
    "Bash(node -e *fs.mkdirSync*)",
  ],
  "destructive-git": [
    "Bash(git rm --cached *)",
    "Bash(git reset --hard *)",
    "Bash(git restore *)",
  ],
  "worktree-ops": [
    "Bash(git worktree add *)",
    "Bash(git worktree remove *)",
    "Bash(git worktree prune *)",
    "Bash(git worktree move *)",
  ],
  "push-to-main": [
    "Bash(git push origin main)",
    "Bash(git push origin HEAD:main)",
  ],
};

// node-e-fs is intentionally excluded from the default: the Claude Code
// auto-mode classifier hard-denies "arbitrary code" Bash, so a default apply
// that granted it would fail on first use. It stays an explicit opt-in token.
const DEFAULT_SCOPES = ["manifest-edit", "write-jsonl", "worktree-ops"];
// Scopes whose Bash patterns the auto-mode classifier hard-denies as
// "arbitrary code" — skipped (with a logged note) when running under auto-mode,
// even if explicitly requested, rather than failing the whole apply.
const AUTO_MODE_DENIED_SCOPES = new Set(["node-e-fs"]);
const DEFAULT_TTL_MIN = 60;

// ── CLI parse ──────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    mode: "apply",
    scopes: null,
    ttl: null,
    reason: null,
    spendCeiling: null,
    attest: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--off") out.mode = "off";
    else if (a === "--status") out.mode = "status";
    else if (a === "--scope") out.scopes = String(argv[++i] || "").trim();
    else if (a === "--ttl") out.ttl = String(argv[++i] || "").trim();
    else if (a === "--reason") out.reason = String(argv[++i] || "").trim();
    // Operator-raised per-session spend ceiling (USD). Framework default is $100
    // (scripts/turbo/spend-ledger.js#FRAMEWORK_DEFAULT_CEILING_USD); when set, it
    // is stamped into authorization.json as `spend_ceiling_usd` and read by the
    // ledger as the runtime override. Omitted → ledger uses the framework default.
    else if (a === "--spend-ceiling") out.spendCeiling = String(argv[++i] || "").trim();
    // Fresh operator provenance for a WIDENING re-apply (AC-3.1/3.2). A same-session
    // re-apply that broadens scope / raises ceiling / extends TTL is refused unless
    // it carries a fresh `--attest "<operator note>"`. The attestation is recorded
    // per grant in authorization.json#provenance[]. A first apply or a NON-widening
    // re-apply (narrowing/equal) does NOT require it.
    else if (a === "--attest") out.attest = String(argv[++i] || "").trim();
  }
  return out;
}

// Parse an operator-supplied spend ceiling. Returns a positive number, or null
// (omitted / invalid → the ledger falls back to the framework default $100).
function parseSpendCeiling(s) {
  if (s == null || s === "") return null;
  const n = parseFloat(String(s).replace(/^\$/, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// ── Monotonic-or-attested re-apply (AC-3.1/3.2) ────────────
// A re-apply is "widening" when it adds a scope not already granted, raises the
// spend ceiling, or extends the expiry beyond the prior grant's. Widening is the
// privilege-escalation direction and is refused UNLESS it carries fresh recorded
// operator provenance (--attest). A first apply (no prior auth) is never a
// widening — there is nothing to widen from. A narrowing/equal re-apply (subset
// of scopes, same-or-lower ceiling, same-or-shorter expiry) is always allowed.
//
// `prior`  = parsed prior authorization.json (or null on first apply).
// `next`   = { scopes, ceilingUsd|null, expiresAtMs }.
// Returns { widening:boolean, reasons:string[] } describing each widening axis.
function diffWidening(prior, next) {
  const reasons = [];
  if (!prior || typeof prior !== "object") {
    return { widening: false, reasons }; // first apply — nothing to widen
  }
  // 1. New scope(s) not previously granted.
  const priorScopes = new Set(
    Array.isArray(prior.scopes) ? prior.scopes : [],
  );
  const addedScopes = (next.scopes || []).filter((s) => !priorScopes.has(s));
  if (addedScopes.length) {
    reasons.push(`scopes +[${addedScopes.join(", ")}]`);
  }
  // 2. Raised spend ceiling. The effective prior ceiling is the stamped override
  //    if present, else the framework default; a `next` ceiling strictly above it
  //    is a widening. A null/omitted next ceiling does NOT widen (keeps prior).
  if (typeof next.ceilingUsd === "number" && Number.isFinite(next.ceilingUsd)) {
    const priorCeiling =
      typeof prior.spend_ceiling_usd === "number" &&
      Number.isFinite(prior.spend_ceiling_usd) &&
      prior.spend_ceiling_usd > 0
        ? prior.spend_ceiling_usd
        : FRAMEWORK_DEFAULT_CEILING_USD;
    if (next.ceilingUsd > priorCeiling) {
      reasons.push(`spend_ceiling $${priorCeiling}→$${next.ceilingUsd}`);
    }
  }
  // 3. Extended expiry window beyond the prior grant's expiry.
  const priorExpMs = prior.expires_at
    ? new Date(prior.expires_at).getTime()
    : NaN;
  if (
    Number.isFinite(priorExpMs) &&
    Number.isFinite(next.expiresAtMs) &&
    next.expiresAtMs > priorExpMs
  ) {
    reasons.push("ttl extends expiry");
  }
  return { widening: reasons.length > 0, reasons };
}

// Framework default ceiling — kept in sync with spend-ledger.js's source default.
// Used by diffWidening to detect a ceiling raise above the prior effective ceiling.
const FRAMEWORK_DEFAULT_CEILING_USD = 100;

// ── TTL parsing: "60m", "2h", "90", number-as-minutes ──────
function parseTtlMinutes(s) {
  if (!s) return DEFAULT_TTL_MIN;
  const m = String(s)
    .trim()
    .match(/^(\d+)\s*([mh]?)$/i);
  if (!m) return DEFAULT_TTL_MIN;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || "m").toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_MIN;
  if (unit === "h") return n * 60;
  return n;
}

// ── Scope normalization + safety-floor enforcement ─────────
// opts.autoMode: when true, scopes the auto-mode classifier hard-denies
// (AUTO_MODE_DENIED_SCOPES) are dropped with a logged note rather than left in
// to fail the apply on first use — even if explicitly requested or via `all`.
function normalizeScopes(input, opts = {}) {
  let accepted;
  if (!input) {
    accepted = DEFAULT_SCOPES.slice();
  } else if (input === "all") {
    accepted = Array.from(KNOWN_SCOPES);
  } else {
    const raw = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    accepted = [];
    for (const s of raw) {
      if (KNOWN_SCOPES.has(s)) {
        accepted.push(s);
      } else {
        process.stderr.write(
          `[turbo] WARN: dropped unknown scope "${s}" (vocab: ${Array.from(
            KNOWN_SCOPES,
          ).join(", ")})\n`,
        );
      }
    }
  }
  accepted = Array.from(new Set(accepted));

  if (opts.autoMode) {
    const denied = accepted.filter((s) => AUTO_MODE_DENIED_SCOPES.has(s));
    if (denied.length) {
      accepted = accepted.filter((s) => !AUTO_MODE_DENIED_SCOPES.has(s));
      process.stderr.write(
        `[turbo] NOTE: dropped auto-mode-denied scope(s) "${denied.join(
          ", ",
        )}" — the Claude Code classifier hard-denies arbitrary-code Bash, so ` +
          `granting it would fail on first use. Re-run without auto-mode (or set\n` +
          `WARPOS_AUTO_MODE=0) to opt in.\n`,
      );
    }
  }
  return accepted;
}

// Safety floor — even with --scope all, these are NEVER bypassable. The
// authorization-gate hook ALSO enforces the floor (defence in depth).
const SAFETY_FLOOR = [
  "git push --force to main",
  "delete branches matching backup/* or pre-*",
  "signups / purchases of services",
  "API spend >= $5 total per session",
  "Beta consultation ESCALATE returns",
  "delete tracked uncommitted user work",
];

// ── settings.json mutate ───────────────────────────────────
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch (e) {
    throw new Error(`failed to read ${SETTINGS_PATH}: ${e.message}`);
  }
}

function writeSettings(obj) {
  const tmp = SETTINGS_PATH + ".turbo.tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, SETTINGS_PATH);
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function snapshotIfFresh(currentSettings) {
  // Snapshot only on FIRST apply of the session — detected by absence of
  // authorization.json. Subsequent applies in the same session merge without
  // re-snapshotting (otherwise we'd snapshot a turbo-flavoured settings).
  ensureDir(RUNTIME_DIR);
  if (fs.existsSync(AUTH_PATH)) return false; // already in a turbo session
  fs.writeFileSync(
    SNAPSHOT_PATH,
    JSON.stringify(currentSettings, null, 2) + "\n",
    "utf8",
  );
  return true;
}

function mergePermissions(settings, scopes) {
  if (!settings.permissions || typeof settings.permissions !== "object") {
    settings.permissions = {};
  }
  if (!Array.isArray(settings.permissions.allow)) {
    settings.permissions.allow = [];
  }
  const existing = new Set(settings.permissions.allow);
  let added = 0;
  for (const s of scopes) {
    const patterns = SCOPE_PERMISSIONS[s] || [];
    for (const p of patterns) {
      if (!existing.has(p)) {
        settings.permissions.allow.push(p);
        existing.add(p);
        added++;
      }
    }
  }
  return added;
}

// ── Authorization state file ───────────────────────────────
// `opts.prior`     — the parsed prior authorization.json (or null on first apply).
//                    Used to PRESERVE the session anchor + granted_at across a
//                    same-session re-apply (AC-3.2/3.3): granted_at and the spend
//                    window must not reset when the operator re-grants mid-session.
// `opts.attest`    — fresh operator provenance string for a widening re-apply
//                    (AC-3.1). Appended to authorization.json#provenance[].
// `opts.authPath`  — fixture seam: write target (defaults to the live AUTH_PATH).
//                    Self-lockout tests (AC-3.5) inject a THROWAWAY path here so a
//                    test NEVER writes the live auth.json.
function writeAuthorization(scopes, ttlMin, reason, spendCeilingUsd, opts = {}) {
  const prior = opts.prior || null;
  const targetPath = opts.authPath || AUTH_PATH;
  const dir = path.dirname(targetPath);
  ensureDir(dir);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMin * 60 * 1000);
  // SESSION ANCHOR (AC-3.3): the spend window anchors to a persisted SESSION START
  // that survives re-applies — NOT granted_at (which every apply resets). On the
  // first apply of a session there is no prior anchor, so the session starts now;
  // a re-apply PRESERVES the prior anchor so prior same-session paid calls stay
  // counted. granted_at still records the latest grant time for the status view.
  const sessionStart =
    (prior && typeof prior.session_started_at === "string"
      ? prior.session_started_at
      : null) ||
    // Legacy auth lacking the new field: anchor to its granted_at so an in-flight
    // pre-upgrade session keeps its window (self-lockout-safe back-compat).
    (prior && typeof prior.granted_at === "string"
      ? prior.granted_at
      : null) ||
    now.toISOString();
  const auth = {
    schema: "mc/auth/v1",
    scopes,
    ttl_min: ttlMin,
    granted_at: now.toISOString(),
    session_started_at: sessionStart,
    expires_at: expires.toISOString(),
    reason: reason || "",
    snapshot_path: path.relative(PROJECT, SNAPSHOT_PATH).replace(/\\/g, "/"),
    safety_floor: SAFETY_FLOOR,
  };
  // Operator-raised per-session spend ceiling (P-058 source-vs-instance): only
  // stamped when explicitly provided. Absent → the ledger uses the framework
  // default ($100). NEVER bakes a per-session instance value as the default.
  if (typeof spendCeilingUsd === "number" && Number.isFinite(spendCeilingUsd) && spendCeilingUsd > 0) {
    auth.spend_ceiling_usd = spendCeilingUsd;
  }
  // PROVENANCE (AC-3.1/3.2): carry forward any prior attestations and append the
  // fresh one for this (widening) re-grant, so the authorization record holds an
  // auditable trail of every operator-attested widening.
  const provenance = Array.isArray(prior && prior.provenance)
    ? prior.provenance.slice()
    : [];
  if (opts.attest) {
    provenance.push({ attested_at: now.toISOString(), note: opts.attest });
  }
  if (provenance.length) auth.provenance = provenance;
  const tmp = targetPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(auth, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, targetPath);
  return auth;
}

function readAuthorization() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
  } catch {
    return null;
  }
}

// ── Status output ──────────────────────────────────────────
function ttlRemainingMin(auth) {
  if (!auth || !auth.expires_at) return 0;
  const ms = new Date(auth.expires_at).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 60000));
}

function countBypassEvents(grantedIso) {
  // Best-effort: tail events.jsonl, count "auth-bypass" entries since granted_at.
  try {
    const eventsFile =
      PATHS.eventsFile ||
      path.join(PROJECT, ".claude", "project", "events", "events.jsonl");
    if (!fs.existsSync(eventsFile)) return 0;
    const raw = fs.readFileSync(eventsFile, "utf8");
    if (!raw) return 0;
    const since = new Date(grantedIso).getTime();
    let count = 0;
    const lines = raw.split("\n");
    // Scan from the tail backwards — bypass events are recent
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      if (!line.includes("auth-bypass")) continue;
      try {
        const ev = JSON.parse(line);
        if (new Date(ev.ts).getTime() < since) break; // past window
        if (
          (ev.data && ev.data.action === "auth-bypass") ||
          (ev.data && ev.data.type === "auth-bypass")
        ) {
          count++;
        }
      } catch {
        /* skip malformed */
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function renderStatus() {
  const auth = readAuthorization();
  if (!auth) {
    return [
      "/turbo --status",
      "",
      "  status:      INACTIVE",
      "  scopes:      (none)",
      "",
      "SAFETY FLOOR (never bypassed, even with --scope all):",
      ...SAFETY_FLOOR.map((s) => `  - ${s}`),
      "",
      'To activate: /turbo --scope manifest-edit,write-jsonl --ttl 60m --reason "<text>"',
    ].join("\n");
  }
  const remain = ttlRemainingMin(auth);
  const expired = remain === 0;
  const bypasses = countBypassEvents(auth.granted_at);
  return [
    "/turbo --status",
    "",
    `  status:        ${expired ? "EXPIRED (run /turbo --off to clean up)" : "ACTIVE"}`,
    `  scopes:        ${(auth.scopes || []).join(", ")}`,
    `  ttl_min:       ${auth.ttl_min}`,
    `  ttl_remaining: ${remain} min`,
    `  granted_at:    ${auth.granted_at}`,
    `  session_start: ${auth.session_started_at || auth.granted_at}`,
    `  expires_at:    ${auth.expires_at}`,
    `  reason:        ${auth.reason || "(none)"}`,
    `  spend_ceiling: ${typeof auth.spend_ceiling_usd === "number" ? "$" + auth.spend_ceiling_usd + " (operator-raised)" : "$100 (framework default)"}`,
    `  provenance:    ${Array.isArray(auth.provenance) && auth.provenance.length ? auth.provenance.length + " attestation(s)" : "(none — no widening re-grants)"}`,
    `  snapshot:      ${auth.snapshot_path}`,
    `  bypasses:      ${bypasses} since granted_at`,
    "",
    "SAFETY FLOOR (never bypassed, even with --scope all):",
    ...SAFETY_FLOOR.map((s) => `  - ${s}`),
  ].join("\n");
}

// ── Off: restore snapshot + delete auth file ───────────────
function offTurbo() {
  let restored = false;
  if (fs.existsSync(SNAPSHOT_PATH)) {
    try {
      const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
      writeSettings(snap);
      restored = true;
    } catch (e) {
      process.stderr.write(
        `[turbo] WARN: snapshot at ${SNAPSHOT_PATH} unreadable: ${e.message}\n`,
      );
    }
  }
  if (fs.existsSync(AUTH_PATH)) {
    try {
      fs.unlinkSync(AUTH_PATH);
    } catch {
      /* best-effort */
    }
  }
  logAudit(
    "turbo-off",
    SETTINGS_PATH,
    restored ? "snapshot restored" : "no snapshot to restore",
  );
  return restored;
}

// ── Main ───────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "status") {
    process.stdout.write(renderStatus() + "\n");
    return 0;
  }

  if (args.mode === "off") {
    const restored = offTurbo();
    process.stdout.write(
      restored
        ? "[turbo] OFF — settings.json restored from snapshot, authorization.json deleted.\n"
        : "[turbo] OFF — no snapshot found; authorization.json deleted (if present).\n",
    );
    return 0;
  }

  // mode === "apply"
  // Auto-mode signal: the harness sets WARPOS_AUTO_MODE=1 in unattended runs.
  // When set, classifier-hard-denied scopes (node-e-fs) are dropped with a note
  // instead of failing the apply. Absent/0 = honor explicit opt-in as before.
  const autoMode = /^(1|true|yes)$/i.test(
    String(mcEnv.readEnv("AUTO_MODE") || ""),
  );
  const scopes = normalizeScopes(args.scopes, { autoMode });
  if (scopes.length === 0) {
    process.stderr.write(
      "[turbo] ERROR: no valid scopes provided. Vocab: " +
        Array.from(KNOWN_SCOPES).join(", ") +
        "\n",
    );
    return 2;
  }
  const ttlMin = parseTtlMinutes(args.ttl);
  const reason = args.reason || "";
  const spendCeilingUsd = parseSpendCeiling(args.spendCeiling);

  // MONOTONIC-OR-ATTESTED (AC-3.1/3.2): a same-session re-apply that WIDENS the
  // grant (adds scope / raises ceiling / extends expiry) is refused UNLESS it
  // carries fresh operator provenance (--attest). This governs FUTURE applies
  // only — it never rewrites the existing on-disk auth, so an in-flight session's
  // current authorization is untouched by landing this change (AC-3.5).
  const prior = readAuthorization();
  const nextExpiresAtMs = Date.now() + ttlMin * 60 * 1000;
  const { widening, reasons } = diffWidening(prior, {
    scopes,
    ceilingUsd: spendCeilingUsd,
    expiresAtMs: nextExpiresAtMs,
  });
  if (widening && !args.attest) {
    process.stderr.write(
      `[turbo] REFUSED: this re-apply WIDENS the active grant (${reasons.join(
        "; ",
      )}) without operator provenance.\n` +
        `  A widening re-grant requires a fresh attestation. Re-run with:\n` +
        `    /turbo --scope ... --attest "<operator note: who authorized this widening, why>"\n` +
        `  (A narrowing or equal re-apply needs no attestation.)\n`,
    );
    logAudit(
      "turbo-widen-refused",
      AUTH_PATH,
      `widening without provenance: ${reasons.join("|")}`,
      { scopes, reasons, ttl_min: ttlMin, spend_ceiling_usd: spendCeilingUsd },
    );
    return 4;
  }

  let settings;
  try {
    settings = readSettings();
  } catch (e) {
    process.stderr.write(`[turbo] FATAL: ${e.message}\n`);
    return 3;
  }

  const snapshotTaken = snapshotIfFresh(settings);
  const added = mergePermissions(settings, scopes);

  try {
    writeSettings(settings);
  } catch (e) {
    process.stderr.write(`[turbo] FATAL: write settings.json: ${e.message}\n`);
    return 3;
  }

  const auth = writeAuthorization(scopes, ttlMin, reason, spendCeilingUsd, {
    prior,
    attest: widening ? args.attest : null,
  });

  logAudit(
    "turbo-on",
    SETTINGS_PATH,
    `scopes=${scopes.join("|")} ttl_min=${ttlMin} added_perms=${added} snapshot=${snapshotTaken}`,
    { scopes, ttl_min: ttlMin, reason, spend_ceiling_usd: spendCeilingUsd },
  );

  process.stdout.write(
    [
      `[turbo] ON`,
      `  scopes:        ${scopes.join(", ")}`,
      `  ttl_min:       ${ttlMin}`,
      `  granted_at:    ${auth.granted_at}`,
      `  expires_at:    ${auth.expires_at}`,
      `  reason:        ${reason || "(none)"}`,
      `  spend_ceiling: ${spendCeilingUsd != null ? "$" + spendCeilingUsd + " (operator-raised)" : "$100 (framework default)"}`,
      `  permissions:   +${added} entries (additive merge)`,
      `  snapshot:      ${snapshotTaken ? "taken (first apply this session)" : "skipped (already in turbo session)"}`,
      "",
      "Safety floor (NEVER bypassed):",
      ...SAFETY_FLOOR.map((s) => `  - ${s}`),
      "",
      "Revoke with: /turbo --off",
    ].join("\n") + "\n",
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  KNOWN_SCOPES,
  SCOPE_PERMISSIONS,
  DEFAULT_SCOPES,
  AUTO_MODE_DENIED_SCOPES,
  DEFAULT_TTL_MIN,
  FRAMEWORK_DEFAULT_CEILING_USD,
  SAFETY_FLOOR,
  parseArgs,
  parseTtlMinutes,
  parseSpendCeiling,
  normalizeScopes,
  diffWidening,
  readAuthorization,
  writeAuthorization,
};
