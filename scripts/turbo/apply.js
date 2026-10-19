#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

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
}
const SETTINGS_PATH =
  PATHS.settings || path.join(PROJECT, ".claude", "settings.json");
const RUNTIME_DIR = PATHS.runtime || path.join(PROJECT, ".claude", "runtime");
const SNAPSHOT_PATH = path.join(RUNTIME_DIR, "settings-pre-turbo.json");
const AUTH_PATH = path.join(RUNTIME_DIR, "authorization.json");

let logEvent = null;
try {
  ({ logEvent } = require(
    path.join(PROJECT, "scripts", "hooks", "lib", "logger.js"),
  ));
} catch {
}
function logAudit(action, target, detail, meta) {
  if (!logEvent) return;
  try {
    logEvent("audit", "turbo", action, target || "", detail || "", meta);
  } catch {
  }
}

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

const DEFAULT_SCOPES = ["manifest-edit", "write-jsonl", "worktree-ops"];
const AUTO_MODE_DENIED_SCOPES = new Set(["node-e-fs"]);
const DEFAULT_TTL_MIN = 60;

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
    else if (a === "--spend-ceiling") out.spendCeiling = String(argv[++i] || "").trim();
    else if (a === "--attest") out.attest = String(argv[++i] || "").trim();
  }
  return out;
}

function parseSpendCeiling(s) {
  if (s == null || s === "") return null;
  const n = parseFloat(String(s).replace(/^\$/, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function diffWidening(prior, next) {
  const reasons = [];
  if (!prior || typeof prior !== "object") {
    return { widening: false, reasons };
  }
  const priorScopes = new Set(
    Array.isArray(prior.scopes) ? prior.scopes : [],
  );
  const addedScopes = (next.scopes || []).filter((s) => !priorScopes.has(s));
  if (addedScopes.length) {
    reasons.push(`scopes +[${addedScopes.join(", ")}]`);
  }
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

const FRAMEWORK_DEFAULT_CEILING_USD = 100;

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
          `MC_AUTO_MODE=0) to opt in.\n`,
      );
    }
  }
  return accepted;
}

const SAFETY_FLOOR = [
  "git push --force to main",
  "delete branches matching backup/* or pre-*",
  "signups / purchases of services",
  "API spend >= $5 total per session",
  "Beta consultation ESCALATE returns",
  "delete tracked uncommitted user work",
];

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
  ensureDir(RUNTIME_DIR);
  if (fs.existsSync(AUTH_PATH)) return false;
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

function writeAuthorization(scopes, ttlMin, reason, spendCeilingUsd, opts = {}) {
  const prior = opts.prior || null;
  const targetPath = opts.authPath || AUTH_PATH;
  const dir = path.dirname(targetPath);
  ensureDir(dir);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMin * 60 * 1000);
  const sessionStart =
    (prior && typeof prior.session_started_at === "string"
      ? prior.session_started_at
      : null) ||
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
  if (typeof spendCeilingUsd === "number" && Number.isFinite(spendCeilingUsd) && spendCeilingUsd > 0) {
    auth.spend_ceiling_usd = spendCeilingUsd;
  }
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

function ttlRemainingMin(auth) {
  if (!auth || !auth.expires_at) return 0;
  const ms = new Date(auth.expires_at).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 60000));
}

function countBypassEvents(grantedIso) {
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
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      if (!line.includes("auth-bypass")) continue;
      try {
        const ev = JSON.parse(line);
        if (new Date(ev.ts).getTime() < since) break;
        if (
          (ev.data && ev.data.action === "auth-bypass") ||
          (ev.data && ev.data.type === "auth-bypass")
        ) {
          count++;
        }
      } catch {
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
    }
  }
  logAudit(
    "turbo-off",
    SETTINGS_PATH,
    restored ? "snapshot restored" : "no snapshot to restore",
  );
  return restored;
}

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
