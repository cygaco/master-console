#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./lib/paths");
const { getSessionId, query } = require("./lib/logger");
const {
  logSkillInvoked,
  hashPrompt,
  TELEMETRY_DISABLED,
} = require("./lib/skill-telemetry");

function readStdinJson() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(buf));
      } catch {
        resolve(null);
      }
    });
    if (process.stdin.isTTY) resolve(null);
  });
}

function extractSlug(event) {
  if (!event || !event.tool_input) return null;
  const ti = event.tool_input;
  if (typeof ti.command === "string") {
    const m = ti.command.match(
      /^\/([A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z][A-Za-z0-9_-]*)?)/,
    );
    if (m) return m[1];
  }
  if (typeof ti.skill === "string") {
    return ti.skill.replace(/^\//, "");
  }
  if (typeof ti.name === "string") {
    return ti.name.replace(/^\//, "");
  }
  return null;
}

function recentUserPrompt(sessionId) {
  try {
    const rows = query({ cat: "prompt", session: sessionId, limit: 1 });
    if (!rows || rows.length === 0) return null;
    return rows[rows.length - 1];
  } catch {
    return null;
  }
}

function stripSystemTagsLocal(text) {
  return String(text || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .trim();
}

function isUserSlashFor(slug, recentPromptRow) {
  if (!recentPromptRow || !recentPromptRow.data) return false;
  const d = recentPromptRow.data;
  if (!d.is_slash) return false;
  const stripped = stripSystemTagsLocal(d.raw || d.stripped || "");
  if (!stripped.startsWith("/")) return false;
  const re = new RegExp(
    "^/" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\b|[ \\t])",
  );
  return re.test(stripped);
}

function findMatchingSuggestion(skillId, sessionId, promptHash) {
  try {
    const rows = query({ cat: "audit", session: sessionId, limit: 200 });
    if (!rows || rows.length === 0) return null;
    let match = null;
    let bestTurnOffset = null;
    let promptsSeen = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!r || !r.data) continue;
      if (r.cat === "prompt") {
        promptsSeen++;
        continue;
      }
      const d = r.data;
      if (
        d.type === "skill-suggested-vs-invoked" &&
        d.phase === "suggested" &&
        d.skill_id === skillId
      ) {
        if (promptHash && d.prompt_hash === promptHash) {
          return { row: r, turn_offset: 0 };
        }
        if (!match) {
          match = r;
          bestTurnOffset = promptsSeen;
        }
      }
    }
    if (match) return { row: match, turn_offset: bestTurnOffset || 0 };
    return null;
  } catch {
    return null;
  }
}

(async () => {
  try {
    if (TELEMETRY_DISABLED) process.exit(0);
    const event = await readStdinJson();
    if (!event) process.exit(0);
    const toolName = event.tool_name || event.tool || "";
    const slug = extractSlug(event);
    if (!slug) process.exit(0);

    const sid = getSessionId();
    const recent = recentUserPrompt(sid);
    const promptText =
      recent && recent.data
        ? stripSystemTagsLocal(recent.data.raw || recent.data.stripped || "")
        : "";
    const promptHash = hashPrompt(promptText);

    let invocation_path = "agent-tool";
    let turn_offset = 0;

    if (isUserSlashFor(slug, recent)) {
      invocation_path = "user-slash";
      turn_offset = 0;
    } else {
      const suggestion =
        findMatchingSuggestion(`skill:${slug}`, sid, promptHash) ||
        findMatchingSuggestion(slug, sid, promptHash);
      if (suggestion) {
        invocation_path = "ranker";
        turn_offset = suggestion.turn_offset;
      }
    }

    logSkillInvoked({
      skill_id: `skill:${slug}`,
      prompt_hash: promptHash,
      turn_offset,
      invocation_path,
    });

    process.exit(0);
  } catch {
    process.exit(0);
  }
})();
