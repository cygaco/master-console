#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { PROJECT, PATHS } = require("./lib/paths");
const mcEnv = require("./lib/mc-env");
const { hashPrompt, logSkillSuggested } = require("./lib/skill-telemetry");
const core = require("./lib/skill-router-core");

const BUDGET_MS = parseInt(process.env.SKILL_ROUTER_BUDGET_MS || "50", 10);
const MAX_CONTENT_TOKENS = 25;
const HIGH_TOKEN_CEILING = 12;

const MAX_STDIN_BYTES = 1024 * 1024;

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(null);
      return;
    }
    let buf = "";
    let over = false;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      if (over) return;
      buf += c;
      if (Buffer.byteLength(buf, "utf8") > MAX_STDIN_BYTES) {
        over = true;
        buf = "";
        resolve(null);
      }
    });
    process.stdin.on("end", () => {
      if (over) return;
      try {
        resolve(JSON.parse(buf));
      } catch {
        resolve(null);
      }
    });
    process.stdin.on("error", () => resolve(null));
  });
}

function stripSystemTags(text) {
  return String(text || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .trim();
}

const WH_WORDS = "who|what|when|where|why|how|which|whether|if";
const AUX_WORDS = "is|are|was|were|am|do|does|did|can|could|would|should|will|has|have|had";
const PRONOUNS = "you|we|i|it|this|that|there";
const WH_WORD_RE = new RegExp(`\\b(?:${WH_WORDS})\\b`, "i");
const AUX_FOLLOWED_BY_PRONOUN_RE = new RegExp(`\\b(?:${AUX_WORDS})\\s+(?:${PRONOUNS})\\b`, "i");
const NEGATION_RE = /\b(do not|don't|does not|doesn't|did not|didn't|without|not yet|never mind|never|no need)\b/i;

function looksInterrogativeOrNegated(stripped) {
  const t = String(stripped || "").trim();
  if (/\?/.test(t)) return true;
  if (NEGATION_RE.test(t)) return true;
  if (WH_WORD_RE.test(t)) return true;
  if (AUX_FOLLOWED_BY_PRONOUN_RE.test(t)) return true;
  return false;
}

const DISABLING_RE = /\b(disable|disabled|disabling|deactivate|deactivated)\b/i;
const SUBJECT_PAST_RE =
  /\b(?:i|we|they|he|she)\s+(?:already|just|ran|did|finished|checked|read|saw|found|used|have|had|was|were|ve)\b/i;
const NON_INITIAL_COPULA_RE = /\S+\s+(?:is|are|was|were)\b/i;
const QUESTION_LEAD_RE = new RegExp(`^\\s*(?:${WH_WORDS}|${AUX_WORDS})\\b`, "i");

function looksDeclarativeMention(stripped) {
  const t = String(stripped || "").trim();
  if (!t) return false;
  if (NEGATION_RE.test(t) || DISABLING_RE.test(t)) return true;
  if (/\balready\b/i.test(t)) return true;
  if (SUBJECT_PAST_RE.test(t)) return true;
  if (NON_INITIAL_COPULA_RE.test(t) && !QUESTION_LEAD_RE.test(t) && !/\?/.test(t)) return true;
  return false;
}

function capDeclarativeMention(decision, stripped) {
  if (!decision || decision.tier !== core.TIERS.HIGH) return decision;
  if (!looksDeclarativeMention(stripped)) return decision;
  return { ...decision, tier: core.TIERS.MEDIUM, reason: "declarative-mention" };
}

function shouldSkip(stripped, contentTokenCount) {
  if (!stripped || stripped.length < 3) return "too-short";
  if (stripped.startsWith("/")) return "slash-command";
  if (core.SKIP_WORDS.has(stripped.toLowerCase().trim())) return "approval-word";
  const withoutCode = stripped.replace(/```[\s\S]*?```/g, "").trim();
  if (stripped.includes("```") && withoutCode.length < 10) return "code-only";
  if (contentTokenCount > MAX_CONTENT_TOKENS) return "too-long";
  if (contentTokenCount > HIGH_TOKEN_CEILING && looksInterrogativeOrNegated(stripped)) {
    return "interrogative-long-prompt";
  }
  return null;
}

function catalogPath() {
  return PATHS.skillCatalog || path.join(PROJECT, ".claude", "runtime", "skill-catalog.json");
}

function safeSessionId(sid) {
  const clean = String(sid == null ? "" : sid).replace(/[^A-Za-z0-9_-]/g, "");
  return clean || "unknown";
}

function logLine(line) {
  try {
    const sid = safeSessionId(require("./lib/logger").getSessionId());
    const dir = path.join(PATHS.logs || path.join(PROJECT, ".claude", "runtime", "logs"), sid);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "skill-router.log"), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
  }
}

const REGEN_LOCK_PATH = path.join(
  PATHS.runtime || path.join(PROJECT, ".claude", "runtime"),
  "skill-catalog-regen.lock",
);
const REGEN_DEBOUNCE_MS = 30 * 1000;
const REGEN_FAIL_BACKOFF_MS = 5 * 60 * 1000;

function readRegenLock() {
  try {
    return JSON.parse(fs.readFileSync(REGEN_LOCK_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeRegenLock(data) {
  try {
    fs.mkdirSync(path.dirname(REGEN_LOCK_PATH), { recursive: true });
    fs.writeFileSync(REGEN_LOCK_PATH, JSON.stringify(data), "utf8");
  } catch {
  }
}

function shouldTriggerRegen(existing, now) {
  if (!existing) return true;
  if (existing.status === "running" && now - existing.startedAt < REGEN_DEBOUNCE_MS) {
    return false;
  }
  if (existing.status === "failed" && now - existing.failedAt < REGEN_FAIL_BACKOFF_MS) {
    return false;
  }
  return true;
}

function triggerLazyRegen() {
  try {
    const now = Date.now();
    const existing = readRegenLock();
    if (!shouldTriggerRegen(existing, now)) {
      if (existing && existing.status === "failed") {
        logLine(`REGEN_BACKOFF last_exit=${existing.exitCode}`);
      }
      return;
    }
    writeRegenLock({ status: "running", startedAt: now, pid: process.pid });
    const script = path.join(PROJECT, "scripts", "generate-skill-catalog.js");
    const child = spawn(process.execPath, [script, `--regen-lock=${REGEN_LOCK_PATH}`], {
      cwd: PROJECT,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  } catch {
  }
}

function loadCatalog() {
  const p = catalogPath();
  if (!fs.existsSync(p)) {
    logLine("CATALOG_MISSING");
    triggerLazyRegen();
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    logLine("CATALOG_PARSE_FAIL");
    return null;
  }
  if (!parsed || parsed.schema !== "mc/skill-catalog/v2" || !Array.isArray(parsed.entries)) {
    logLine(`CATALOG_SCHEMA_MISMATCH schema=${parsed && parsed.schema}`);
    return null;
  }
  return parsed;
}

function buildInvoke(ranked, flags, args, entities) {
  const parts = [`/${ranked.entry.slug}`];
  for (const f of flags) parts.push(f);
  if (entities && Number.isFinite(entities.n)) parts.push(`--n ${entities.n}`);
  if (entities && entities.ttl_minutes) parts.push(`--ttl ${entities.ttl_minutes}m`);
  if (args) parts.push(`"${String(args).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return parts.join(" ");
}

async function main() {
  const t0 = process.hrtime.bigint();

  if (mcEnv.readEnv("SKILL_ROUTER") === "0") {
    process.exit(0);
    return;
  }

  const event = await readStdin();
  if (!event) {
    process.exit(0);
    return;
  }

  const rawPrompt = event.prompt || event.tool_input?.prompt || "";
  const stripped = stripSystemTags(rawPrompt);
  const normalized = core.normalize(stripped);
  const promptHash = hashPrompt(stripped);

  const skip = shouldSkip(stripped, normalized.contentTokens.length);
  if (skip) {
    process.exit(0);
    return;
  }

  const catalog = loadCatalog();
  if (!catalog) {
    process.exit(0);
    return;
  }

  const routable = catalog.entries.filter(
    (e) => e && e.alias_of == null && e.user_invocable === true,
  );

  const ranked = [];
  for (const entry of routable) {
    const r = core.scoreEntry(normalized, entry);
    if (r.score > 0) ranked.push({ entry, score: r.score, exact: r.exact, complete: r.complete });
  }
  ranked.sort((a, b) => b.score - a.score);

  let decision = core.decide(ranked, normalized.contentTokens.length);
  decision = capDeclarativeMention(decision, stripped);
  if (!decision.tier) {
    process.exit(0);
    return;
  }

  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  if (elapsedMs > BUDGET_MS) {
    logLine(`ROUTER_BUDGET ${elapsedMs.toFixed(1)}ms`);
    process.exit(0);
    return;
  }

  const winner = ranked[0];
  const { entities } = core.parseEntities(normalized.tokens, stripped);
  const { flags, matchedSpoken, remainder } = core.parseFlags(normalized.tokens.join(" "), winner.entry);
  decision = core.applyFlagCeiling(decision, flags, catalog.confirm_flags, {
    entry: winner.entry,
    matchedSpoken,
  });

  let args = "";
  if (winner.entry.args_mode === "free-text") {
    args = remainder;
  } else if (winner.entry.args_mode === "topic") {
    args = entities.epic_id || entities.ticket || entities.sprint_id || remainder;
  }

  const shown = decision.tier === "MEDIUM" && decision.tie ? ranked.slice(0, 2) : ranked.slice(0, 1);
  const context = core.formatContext(decision, shown, (r) => buildInvoke(r, flags, args, entities));

  shown.forEach((r, idx) => {
    try {
      logSkillSuggested({
        skill_id: r.entry.id || `skill:${r.entry.slug}`,
        prompt_hash: promptHash,
        score: r.score,
        rank: idx + 1,
        actor: "skill-router",
      });
    } catch {
    }
  });

  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
      }),
    );
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch(() => process.exit(0));
}

module.exports = {
  shouldSkip,
  stripSystemTags,
  buildInvoke,
  MAX_CONTENT_TOKENS,
  HIGH_TOKEN_CEILING,
  looksInterrogativeOrNegated,
  looksDeclarativeMention,
  capDeclarativeMention,
  safeSessionId,
  MAX_STDIN_BYTES,
  shouldTriggerRegen,
  REGEN_LOCK_PATH,
};
