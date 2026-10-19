#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    run(JSON.parse(input || "{}"));
  } catch {
    process.exit(0);
  }
});

function run(event) {
  if (!event || event.tool_name !== "Bash") {
    process.exit(0);
  }
  const command = (event.tool_input && event.tool_input.command) || "";
  if (!command) process.exit(0);

  const exitCode =
    (event.tool_response && (event.tool_response.exit_code ?? event.tool_response.exitCode)) ?? 0;
  if (exitCode !== 0) process.exit(0);

  let paths;
  try {
    paths = require("./lib/paths");
  } catch {
    process.exit(0);
  }
  const PROJECT = paths.PROJECT;
  const PATHS = paths.PATHS;

  const policyFile = path.join(
    PATHS.policy || path.join(PROJECT, ".claude", "agents", "president", "_system", "policy"),
    "ledger-presence.json",
  );
  if (!fs.existsSync(policyFile)) process.exit(0);

  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyFile, "utf8"));
  } catch {
    process.exit(0);
  }

  const match = (policy.watched_commands || []).find((w) =>
    command.includes(w.match),
  );
  if (!match) process.exit(0);

  let targetFile;
  let anchor;
  if (match.expected_section === "ROADMAP.md#sprints") {
    targetFile = path.join(PROJECT, "ROADMAP.md");
    anchor = policy.anchor_markers.roadmap_sprints;
  } else if (match.expected_section === "RELEASES.md#versions") {
    targetFile = path.join(PROJECT, "RELEASES.md");
    anchor = policy.anchor_markers.releases_versions;
  } else if (match.expected_section === "RELEASES.md#sprints") {
    targetFile = path.join(PROJECT, "RELEASES.md");
    anchor = policy.anchor_markers.releases_sprints;
  } else {
    process.exit(0);
  }

  let anchorMissing = false;
  if (fs.existsSync(targetFile)) {
    try {
      const text = fs.readFileSync(targetFile, "utf8");
      if (!text.includes(anchor)) anchorMissing = true;
    } catch {
    }
  } else {
    anchorMissing = true;
  }

  const eventsFile = PATHS.eventsFile;
  const lookback = policy.lookback_window_ms || 60000;
  const sinceTs = Date.now() - lookback;
  const recentLedgerWrite = scanForLedgerWrite(eventsFile, sinceTs);

  const mode = (policy.enforcement && policy.enforcement.mode) || "warn";
  const softRolloutUntil =
    policy.enforcement && policy.enforcement.soft_rollout_until;
  const softRolloutActive = softRolloutUntil
    ? Date.now() < Date.parse(softRolloutUntil)
    : false;
  const effectiveMode = softRolloutActive ? "warn" : mode;

  const reasons = [];
  if (!recentLedgerWrite) {
    reasons.push(
      `${path.basename(targetFile)} missing row for ${match.match} (no ledger.write event in last ${Math.round(lookback / 1000)}s)`,
    );
  }
  if (anchorMissing) {
    reasons.push(
      `${path.basename(targetFile)} missing anchor "${anchor}" — operator opted out silently (adversarial threat)`,
    );
  }

  if (reasons.length === 0) {
    process.exit(0);
  }

  const severity =
    anchorMissing && policy.anchor_missing_severity === "loud_warn"
      ? "LOUD WARN"
      : "warn";
  const softNote = softRolloutActive
    ? ` Soft-rollout until ${softRolloutUntil} — warn only.`
    : "";

  process.stderr.write(
    `[ledger-presence-guard] ${severity}: ${reasons.join("; ")}.${softNote}\n`,
  );

  if (effectiveMode === "block") {
    process.exit(1);
  }
  process.exit(0);
}

function scanForLedgerWrite(eventsFile, sinceTs) {
  if (!fs.existsSync(eventsFile)) return false;
  try {
    const stat = fs.statSync(eventsFile);
    const size = stat.size;
    const head = Math.max(0, size - 65536);
    const fd = fs.openSync(eventsFile, "r");
    const buf = Buffer.allocUnsafe(size - head);
    fs.readSync(fd, buf, 0, buf.length, head);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const ts = row.ts ? Date.parse(row.ts) : 0;
      if (ts < sinceTs) {
        return false;
      }
      if (
        row.data &&
        (row.data.type === "ledger.write" ||
          row.data.event === "ledger.write")
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
