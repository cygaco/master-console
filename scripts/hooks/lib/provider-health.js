
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

  if (opts.probe === "list") {
    let probeCmd;
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
            : null;
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
