"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * scripts/dispatch/provider-breaker.js — TTL'd circuit breaker for quota-dead providers.
 *
 * Problem: when a provider (gemini, openai) hits a quota window, every subsequent
 * dispatch RE-BURNS it. classifyQuotaFailure returns {kind:"quota_exhausted",
 * recoverable:true} and runProvider logs it, but nothing REMEMBERS the provider is
 * down — so the next dispatch tries it again (6 reviewer prompts × 3 retries = 18
 * re-burns into a known-dead window, per T-20260610-306 telemetry audit).
 *
 * Design (β-ratified):
 *   - markDown(provider, opts)   — write/merge a TTL'd entry into provider-down.json
 *   - isDown(provider)           — true iff entry exists AND Date.now() < entry.until
 *   - clear(provider)            — remove an entry (recovery path)
 *   - computeUntil(p, errText, nowMs) — derive TTL epoch ms from hint or 30m default
 *
 * PRIMARY SAFETY PROPERTY — FAIL-OPEN:
 *   Every function in this module is wrapped in try/catch. Any error (file
 *   unreadable, corrupt JSON, write failure, parse error) is SWALLOWED and the
 *   safe default is returned: isDown→false, markDown→no-op, computeUntil→nowMs+30m.
 *   A broken breaker MUST NEVER block a healthy provider.
 *
 * State store: .claude/runtime/provider-down.json (gitignored runtime state).
 * Test seam:   MC_PROVIDER_DOWN_FILE env var overrides the resolved path.
 *
 * SP-20260610-007 / T-20260610-306 (G5)
 */

const fs = require("fs");
const path = require("path");

// ── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — clamp absurd parsed values

// ── Path resolution ────────────────────────────────────────────────────────
/**
 * Resolve the path to provider-down.json.
 * MC_PROVIDER_DOWN_FILE overrides the default (test seam).
 */
function resolveFilePath() {
  if (mcEnv.readEnv("PROVIDER_DOWN_FILE")) {
    return mcEnv.readEnv("PROVIDER_DOWN_FILE");
  }
  // Default: .claude/runtime/provider-down.json
  // Resolve from __dirname so it's cwd-independent.
  const projectRoot = path.resolve(__dirname, "../../..");
  return path.join(projectRoot, ".claude", "runtime", "provider-down.json");
}

// ── Internal helpers ───────────────────────────────────────────────────────
/**
 * Read and parse the provider-down file.
 * Returns {} on any error (fail-open: missing / unreadable / corrupt JSON).
 */
function readState() {
  try {
    const raw = fs.readFileSync(resolveFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {}; // fail-open
  }
}

/**
 * Write state atomically (temp-file + rename). Swallows all errors (fail-open).
 */
function writeState(state) {
  try {
    const filePath = resolveFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + ".tmp." + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  } catch {
    // Fail-open: write failure must NOT propagate
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute the TTL epoch ms for a provider that just hit a quota failure.
 *
 * Attempts to parse a reset/retry hint from errText:
 *   - "resets after Xh" / "resets in Xm"       (gemini-style)
 *   - "retry after Ns" / "retry-after: N"        (HTTP Retry-After)
 *   - "retry in Xs"                               (RESOURCE_EXHAUSTED body)
 *
 * EXPLICIT parse-fail branch (β-ratified):
 *   If a hint token IS present in errText but is MALFORMED / unparseable /
 *   outside a sane range → fall through to DEFAULT_TTL_MS (30m).
 *   NOT infinite (that strands a recovered provider).
 *   NOT 0 (that makes the breaker vacuous).
 *   This is an explicit else/fallthrough — not an implicit catch-all.
 *
 * Clamps absurd parsed values (> 24h or ≤ 0) to DEFAULT_TTL_MS.
 *
 * FAIL-OPEN: any unexpected error returns nowMs + DEFAULT_TTL_MS (never throws).
 *
 * @param {string} _provider  - provider name (reserved for per-provider overrides)
 * @param {string} errText    - error text from the failed dispatch
 * @param {number} nowMs      - current epoch ms (injectable for deterministic tests)
 * @returns {number} epoch ms when the provider should be tried again
 */
function computeUntil(_provider, errText, nowMs) {
  try {
    const text = String(errText || "");
    const safeNow = typeof nowMs === "number" ? nowMs : Date.now();

    // Patterns that may carry a reset/retry duration hint.
    // Group 1 = numeric value, Group 2 = unit (optional, defaults to seconds).
    const hintPatterns = [
      // "resets after 1h" / "resets in 2h" / "reset after 30m"
      /reset(?:s)?\s+(?:after|in)\s+(\d+(?:\.\d+)?)\s*(h(?:r|ours?)?|m(?:in|inutes?)?|s(?:ec|econds?)?)?/i,
      // "retry in 30s" / "retry in 5m"
      /retry\s+in\s+(\d+(?:\.\d+)?)\s*(h(?:r|ours?)?|m(?:in|inutes?)?|s(?:ec|econds?)?)?/i,
      // "retry after 60s" / "retry-after: 120" / "retry after 120"
      /retry[\s-]?after[:\s]+(\d+(?:\.\d+)?)\s*(h(?:r|ours?)?|m(?:in|inutes?)?|s(?:ec|econds?)?)?/i,
    ];

    let hintFound = false;
    let parsedMs = null;

    for (const pattern of hintPatterns) {
      const m = text.match(pattern);
      if (!m) continue;

      hintFound = true;
      const value = parseFloat(m[1]);
      const rawUnit = (m[2] || "").toLowerCase();

      // Value must be a finite positive number
      if (!isFinite(value) || value <= 0) {
        // Malformed value — explicit parse-fail branch: parsedMs stays null
        break;
      }

      // Resolve unit; no unit or unknown unit → treat as seconds
      let durationMs;
      if (rawUnit.startsWith("h")) {
        durationMs = value * 60 * 60 * 1000;
      } else if (rawUnit.startsWith("m")) {
        durationMs = value * 60 * 1000;
      } else {
        durationMs = value * 1000; // seconds (default when unit absent or "s")
      }

      // Clamp absurd values — explicit branch, not implicit catch
      if (durationMs <= 0 || durationMs > MAX_TTL_MS) {
        // Out-of-range → explicit parse-fail fallthrough to DEFAULT_TTL_MS
        parsedMs = null;
      } else {
        parsedMs = durationMs;
      }
      break;
    }

    // EXPLICIT parse-fail fallthrough (β requirement):
    //   - hintFound=true, parsedMs=null  → hint present but malformed/clamped → DEFAULT
    //   - hintFound=false                → no hint in errText              → DEFAULT
    //   - hintFound=true, parsedMs set   → valid parsed hint                → use it
    if (parsedMs !== null) {
      return safeNow + parsedMs;
    }
    // Both "no hint" and "malformed hint" fall here — DEFAULT_TTL_MS
    return safeNow + DEFAULT_TTL_MS;
  } catch {
    // Fail-open: unexpected error → default
    const safeNow = typeof nowMs === "number" ? nowMs : Date.now();
    return safeNow + DEFAULT_TTL_MS;
  }
}

/**
 * Mark a provider as circuit-broken until the given epoch ms.
 * FAIL-OPEN: any error is swallowed — never throws.
 *
 * @param {string} provider                        - e.g. "gemini", "openai"
 * @param {{ kind: string, untilMs: number, evidence?: string }} opts
 */
function markDown(provider, { kind, untilMs, evidence } = {}) {
  try {
    if (!provider || typeof provider !== "string") return; // sanity guard
    const state = readState();
    state[provider] = {
      kind: kind || "quota_exhausted",
      until: typeof untilMs === "number" ? untilMs : Date.now() + DEFAULT_TTL_MS,
      evidence: evidence ? String(evidence).slice(0, 200) : undefined,
      marked_at: Date.now(),
    };
    writeState(state);
  } catch {
    // Fail-open: markDown MUST NOT throw
  }
}

/**
 * Check whether a provider is currently circuit-broken.
 * FAIL-OPEN: any error returns false (provider treated as available).
 *
 * Returns true  iff an entry exists AND Date.now() < entry.until (within TTL).
 * Returns false for expired entries (provider may have recovered).
 *
 * @param {string} provider
 * @returns {boolean}
 */
function isDown(provider) {
  try {
    if (!provider || typeof provider !== "string") return false;
    const state = readState();
    const entry = state[provider];
    if (!entry || typeof entry.until !== "number") return false;
    // Within TTL → down. Expired → NOT down (provider may have recovered).
    return Date.now() < entry.until;
  } catch {
    return false; // Fail-open: error → provider available
  }
}

/**
 * Remove a circuit-breaker entry (recovery path). FAIL-OPEN: any error swallowed.
 *
 * @param {string} provider
 */
function clear(provider) {
  try {
    if (!provider || typeof provider !== "string") return;
    const state = readState();
    if (Object.prototype.hasOwnProperty.call(state, provider)) {
      delete state[provider];
      writeState(state);
    }
  } catch {
    // Fail-open
  }
}

module.exports = { markDown, isDown, clear, computeUntil, DEFAULT_TTL_MS };
