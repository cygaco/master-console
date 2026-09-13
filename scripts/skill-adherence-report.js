#!/usr/bin/env node

/**
 * skill-adherence-report.js — Compute adherence rate for the
 * skill-suggested-vs-invoked event type.
 *
 * Adherence = invoked ∩ suggested ÷ suggested, filtered to
 * `invocation_path: "ranker"` (per AC-6.5 SP-20260513-003).
 *
 * Usage:
 *   node scripts/skill-adherence-report.js              # last 7 days, table
 *   node scripts/skill-adherence-report.js --since 1d   # last 24 hours
 *   node scripts/skill-adherence-report.js --json       # raw JSON
 *
 * Designed for consumption by /scan:patterns and post-ship monitoring.
 */

"use strict";
const mcEnv = require("./hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");

const PROJECT =
  process.env.CLAUDE_PROJECT_DIR ||
  mcEnv.readEnv("PROJECT_DIR") ||
  process.cwd();

const PATHS = JSON.parse(
  fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
);

const EVENTS_FILE = path.join(
  PROJECT,
  PATHS.eventsFile || ".claude/project/events/events.jsonl",
);

// ── Window parser ───────────────────────────────────────

function parseSince(arg) {
  const m = String(arg || "7d").match(/^(\d+)([dhm])$/);
  if (!m) return 7 * 86400000;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === "d") return n * 86400000;
  if (unit === "h") return n * 3600000;
  if (unit === "m") return n * 60000;
  return 7 * 86400000;
}

// ── Main ────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const sinceIdx = args.indexOf("--since");
  const window = parseSince(sinceIdx !== -1 ? args[sinceIdx + 1] : "7d");
  const cutoff = Date.now() - window;

  if (!fs.existsSync(EVENTS_FILE)) {
    console.error(
      "[skill-adherence-report] events file not found:",
      EVENTS_FILE,
    );
    process.exit(0);
  }

  const lines = fs.readFileSync(EVENTS_FILE, "utf8").split("\n");

  // Map keyed by `${prompt_hash}|${skill_id}` →
  //   { suggested: bool, invoked_by: "ranker"|"agent-tool"|"user-slash"|null, ts: ms }
  const pairs = new Map();
  let suggestedCount = 0;
  let invokedRankerCount = 0;
  let invokedAgentToolCount = 0;
  let invokedUserSlashCount = 0;

  for (const line of lines) {
    if (!line) continue;
    if (!line.includes('"skill-suggested-vs-invoked"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = new Date(entry.ts).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const d = entry.data || {};
    if (d.type !== "skill-suggested-vs-invoked") continue;
    const key = `${d.prompt_hash || ""}|${d.skill_id || ""}`;
    let p = pairs.get(key);
    if (!p) {
      p = { suggested: false, invoked_by: null, suggested_score: null };
      pairs.set(key, p);
    }
    if (d.phase === "suggested") {
      p.suggested = true;
      p.suggested_score = d.score ?? null;
      suggestedCount++;
    } else if (d.phase === "invoked") {
      // Only the first invocation of a given (prompt_hash, skill_id) counts.
      if (!p.invoked_by) p.invoked_by = d.invocation_path || "agent-tool";
      if (p.invoked_by === "ranker") invokedRankerCount++;
      else if (p.invoked_by === "user-slash") invokedUserSlashCount++;
      else invokedAgentToolCount++;
    }
  }

  // Per AC-6.5: adherence_rate = invoked / suggested,
  // counted in events (not unique pairs), filtered to invocation_path=ranker.
  const adherence_rate =
    suggestedCount > 0 ? invokedRankerCount / suggestedCount : 0;

  const report = {
    window_ms: window,
    cutoff_iso: new Date(cutoff).toISOString(),
    suggested_count: suggestedCount,
    invoked_count_ranker: invokedRankerCount,
    invoked_count_agent_tool: invokedAgentToolCount,
    invoked_count_user_slash: invokedUserSlashCount,
    adherence_rate: Number(adherence_rate.toFixed(4)),
    note: "Adherence = invoked(ranker) / suggested. user-slash excluded by design (not organic).",
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  console.log(`Skill adherence — window=${args[sinceIdx + 1] || "7d"}`);
  console.log(`  suggested:           ${suggestedCount}`);
  console.log(`  invoked (ranker):    ${invokedRankerCount}`);
  console.log(`  invoked (agent-tool):${invokedAgentToolCount}`);
  console.log(
    `  invoked (user-slash):${invokedUserSlashCount}  [excluded from rate]`,
  );
  console.log(`  adherence_rate:      ${(adherence_rate * 100).toFixed(2)}%`);
}

main();
