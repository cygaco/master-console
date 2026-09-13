/**
 * provider-health.js — classify provider/CLI status into a small set of
 * actionable states so /mc:health, /mc:setup, smart-context, and the
 * dispatch wrapper can all agree on what "broken" means.
 *
 * Phase 0 workstream E. Returns:
 *   { status, reason, suggestion, detail? }
 *
 * Status set:
 *   ok                          — CLI present, auth present (best-effort),
 *                                  default model reachable.
 *   cli_missing                 — `which/where <cli>` failed.
 *   auth_missing                — login/session not present.
 *   auth_source_mismatch        — env API key set AND CLI configured for
 *                                  an alternate auth source (Gemini OAuth
 *                                  personal vs GEMINI_API_KEY).
 *   model_not_found             — requested default model unknown to the
 *                                  CLI's bundled registry.
 *   quota_exhausted             — quota or rate limit hit.
 *   free_tier_limit_zero        — free tier reports per-day = 0.
 *   stale_cli_registry          — CLI's bundled model list is older than
 *                                  the requested model (404 from a known
 *                                  family).
 *   trusted_directory_required  — Gemini CLI refuses to run outside a
 *                                  trusted dir.
 *   provider_timeout            — health probe wall-clock exceeded.
 *   unknown_error               — anything else.
 *
 * This module never throws. Every failure path returns a status record.
 * It never writes to disk. It never prints to stdout. Callers decide how
 * to surface the result.
 */

"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_TIMEOUT_MS = 8_000;

function safeExec(cmd, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT_MS;
  try {
    const stdout = execSync(cmd, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      encoding: "utf8",
    });
    return { ok: true, stdout, stderr: "" };
  } catch (e) {
    return {
      ok: false,
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : String(e.message || e),
      timedOut: e.signal === "SIGTERM" || e.code === "ETIMEDOUT",
    };
  }
}

function cliPresent(cli) {
  const probe = safeExec(`${cli} --version`, { timeout: 6_000 });
  return probe.ok;
}

// (The SUNSET individual `gemini` CLI helpers — detectGeminiAuthSourceMismatch +
// classifyGeminiError — were removed in the 2026-07-20 deep-clean. The Gemini lab now
// runs through the `antigravity` (agy) CLI, which self-auths via its own keyring; agy
// probe failures fall through to the generic unknown_error path.)

// ── OpenAI codex helpers ───────────────────────────────────

function classifyCodexError(stderr) {
  const s = (stderr || "").toLowerCase();
  if (!s) return null;
  if (
    s.includes("not logged in") ||
    s.includes("authenticate") ||
    s.includes("login")
  ) {
    return {
      status: "auth_missing",
      reason: "codex CLI reports no authenticated session.",
      suggestion: "Run `codex login`.",
    };
  }
  if (
    s.includes("model not found") ||
    s.includes("does not exist") ||
    /404[^0-9]/.test(s)
  ) {
    return {
      status: "model_not_found",
      reason: "The requested model is unknown to your codex/OpenAI account.",
      suggestion:
        "Upgrade codex CLI or set OPENAI_FLAGSHIP_MODEL / OPENAI_MINI_MODEL to a model your account can reach.",
    };
  }
  if (s.includes("rate limit") || s.includes("quota")) {
    return {
      status: "quota_exhausted",
      reason: "codex reported rate-limit or quota error.",
      suggestion:
        "Wait, or scale down REASONING_REVIEWER / drop to mini models temporarily.",
    };
  }
  return null;
}

// ── Top-level classification ───────────────────────────────

function probeProvider(providerName, opts = {}) {
  if (!providerName) {
    return {
      provider: providerName,
      status: "unknown_error",
      reason: "no provider name",
      suggestion: "pass a known provider id",
    };
  }
  if (providerName === "claude") {
    // Claude is the harness — always considered present.
    return {
      provider: "claude",
      status: "ok",
      reason: "Claude is the harness; CLI is always available.",
      suggestion: "",
    };
  }

  const cli =
    providerName === "openai"
      ? "codex"
      : providerName === "antigravity"
        ? "agy"
        : providerName;

  if (!cliPresent(cli)) {
    return {
      provider: providerName,
      status: "cli_missing",
      reason: `Could not invoke \`${cli} --version\` — CLI absent or not on PATH.`,
      suggestion:
        providerName === "openai"
          ? "Install: npm i -g @openai/codex && codex login"
          : providerName === "antigravity"
            ? "Install the Antigravity `agy` CLI (standalone, not npm) and self-auth at ~/.gemini/antigravity-cli."
            : `Install the ${cli} CLI.`,
    };
  }

  // Optional cheap reachability check (gated by opts.probe = "list" or
  // explicit env). Default OFF to keep /mc:setup fast.
  if (opts.probe === "list") {
    let probeCmd;
    // NOTE: never `agy models` (it HANGS headless); `agy --help` is the safe reachability probe.
    if (providerName === "openai") probeCmd = "codex --help";
    else if (providerName === "antigravity") probeCmd = "agy --help";
    if (probeCmd) {
      const probe = safeExec(probeCmd, { timeout: opts.timeout || 8_000 });
      if (!probe.ok) {
        if (probe.timedOut) {
          return {
            provider: providerName,
            status: "provider_timeout",
            reason: `\`${probeCmd}\` timed out.`,
            suggestion:
              "Re-run later; if it persists, check network / VPN / CLI version.",
          };
        }
        const classified =
          providerName === "openai"
            ? classifyCodexError(probe.stderr)
            : null; // antigravity/agy → generic unknown_error (no codex misclassification)
        if (classified)
          return Object.assign({ provider: providerName }, classified);
        return {
          provider: providerName,
          status: "unknown_error",
          reason: `\`${probeCmd}\` failed.`,
          suggestion: "Inspect stderr below and re-run.",
          detail: probe.stderr.slice(0, 400),
        };
      }
    }
  }

  return {
    provider: providerName,
    status: "ok",
    reason: `${providerName} CLI present and (best-effort) configured.`,
    suggestion: "",
  };
}

function probeAll(providerList, opts = {}) {
  return providerList.map((p) => probeProvider(p, opts));
}

module.exports = {
  probeProvider,
  probeAll,
  classifyCodexError,
  cliPresent,
};
