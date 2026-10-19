#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { logEvent } = require("./lib/logger");

const ESCAPE_KEYWORDS = [
  "ESCALATE:",
  "irreversible",
  "delete all",
  "drop table",
  "push to remote",
  "publish",
  "credential",
  "secret",
  "password",
  "api key",
  "sign up",
  "purchase",
];

const SPEND_PATTERN = /\$\d+/;

const RELEASE_CONTEXT_KEYWORDS = [
  "release",
  "rl-",
  "deploy",
  "ship",
  "rollback",
  "/sprint:release",
  "production deploy",
  "production approval",
];

const BETA_CONSULTATION_WINDOW_MS = 30 * 60 * 1000;

function isReleaseContext(text) {
  const lower = (text || "").toLowerCase();
  return RELEASE_CONTEXT_KEYWORDS.some((kw) => lower.includes(kw));
}

function hasRecentReleaseBetaConsultation() {
  try {
    const projectDir =
      process.env.CLAUDE_PROJECT_DIR ||
      path.resolve(__dirname, "..", "..", "..");
    let betaEventsRel = ".claude/agents/president/_system/beta/events.jsonl";
    try {
      const pj = JSON.parse(
        fs.readFileSync(path.join(projectDir, ".claude", "paths.json"), "utf8"),
      );
      if (pj.betaEvents) betaEventsRel = pj.betaEvents;
    } catch {
    }
    const eventsPath = path.join(projectDir, betaEventsRel);
    if (!fs.existsSync(eventsPath)) return false;
    const raw = fs.readFileSync(eventsPath, "utf8");
    const lines = raw.trim().split(/\r?\n/).filter(Boolean);
    const cutoff = Date.now() - BETA_CONSULTATION_WINDOW_MS;
    for (let i = lines.length - 1; i >= 0; i--) {
      let row;
      try {
        row = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      const ts = Date.parse(row.ts || "");
      if (!Number.isFinite(ts)) continue;
      if (ts < cutoff) break;
      const data = row.data || {};
      const text = (
        (data.question || "") +
        " " +
        (data.answer || "") +
        " " +
        (data.topic_tags || []).join(" ")
      ).toLowerCase();
      if (
        RELEASE_CONTEXT_KEYWORDS.some((kw) => text.includes(kw)) ||
        (data.phase || "").toLowerCase() === "release"
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function isAdhocActive() {
  try {
    const adhocDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "teams",
      "adhoc",
    );
    if (!fs.existsSync(adhocDir)) return false;

    const hbPath = path.join(adhocDir, "heartbeat.json");
    const sidPath = path.join(
      process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", ".."),
      ".claude",
      "runtime",
      ".session-id",
    );

    if (fs.existsSync(hbPath) && fs.existsSync(sidPath)) {
      const hb = JSON.parse(fs.readFileSync(hbPath, "utf8"));
      const currentSid = fs.readFileSync(sidPath, "utf8").trim();
      return hb.sessionId === currentSid;
    }

    if (!fs.existsSync(hbPath)) return true;

    return false;
  } catch {
    return false;
  }
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    try {
      if (!isAdhocActive()) {
        process.exit(0);
        return;
      }

      const event = JSON.parse(input);
      const questions = event.tool_input?.questions || [];
      const question = Array.isArray(questions)
        ? questions.map((q) => q.question || "").join(" ")
        : event.tool_input?.question || "";
      const questionLower = question.toLowerCase();

      const hasEscape = ESCAPE_KEYWORDS.some(
        (kw) =>
          question.includes(kw) || questionLower.includes(kw.toLowerCase()),
      );
      const hasSpend = SPEND_PATTERN.test(question);

      if (hasEscape || hasSpend) {
        logEvent(
          "audit",
          "system",
          "beta-gate-pass",
          question.slice(0, 80),
          hasEscape ? "escape-keyword" : "spend-signal",
        );
        process.exit(0);
        return;
      }

      if (isReleaseContext(question)) {
        if (!hasRecentReleaseBetaConsultation()) {
          logEvent(
            "block",
            "system",
            "beta-gate-release-blocked",
            question.slice(0, 80),
            "No release-context Beta event in last 30min",
          );
          const result = {
            decision: "block",
            reason:
              "[beta-gate] Release-context question detected with no recent Beta consultation. " +
              "Required: SendMessage(to: 'Beta (β)', message: 'Release pre-flight for <sprint/RL-id>. <context>. Verdict?'). " +
              "Beta event must mention 'release', 'deploy', 'ship', 'rollback', or 'RL-' (last 30min). " +
              "If Beta returns ESCALATE, prefix the AskUserQuestion text with 'ESCALATE:' to pass through. " +
              "See .claude/commands/sprint/release.md Step 0 and CLAUDE.md §'β consultation protocol'.",
          };
          process.stdout.write(JSON.stringify(result));
          process.exit(0);
          return;
        }
        logEvent(
          "audit",
          "system",
          "beta-gate-release-pass",
          question.slice(0, 80),
          "recent-beta-release-consultation",
        );
        process.exit(0);
        return;
      }

      const target =
        (question && question.slice(0, 80)) ||
        (event.tool_input
          ? `[no question text — tool_input keys: ${Object.keys(event.tool_input).join(",")}]`
          : "[no tool_input]");
      logEvent(
        "block",
        "system",
        "beta-gate-blocked",
        target,
        "Alex β not consulted",
      );
      const result = {
        decision: "block",
        reason:
          "[beta-gate] Consult Alex β before asking the user. " +
          "Route: SendMessage(to: 'Beta (β)', message: '<your question>'). " +
          "If Alex β returns ESCALATE, prefix with 'ESCALATE:' to pass through. " +
          "See CLAUDE.md.",
      };
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    } catch {
      process.exit(0);
    }
  });
}

main();
