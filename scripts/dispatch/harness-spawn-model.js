#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const path = require("path");

const HARNESS_FACE_MODEL = mcEnv.readEnv("HARNESS_FACE_MODEL") || "claude-opus-4-8";
const HARNESS_WORKER_MODEL = mcEnv.readEnv("HARNESS_WORKER_MODEL") || "claude-sonnet-5";

const TIER_CLAUDE_MODEL = Object.freeze({
  face: HARNESS_FACE_MODEL,
  director: HARNESS_FACE_MODEL,
  lead: HARNESS_FACE_MODEL,
  worker: HARNESS_WORKER_MODEL,
  tool: HARNESS_WORKER_MODEL,
});

function loadRolesSafe() {
  try {
    return require("./registry-roles").loadRoles();
  } catch {
    return {};
  }
}

function harnessSpawnModel(role, roles) {
  const r = (roles || loadRolesSafe())[role];

  if (!r || typeof r !== "object") {
    return {
      role,
      model: HARNESS_FACE_MODEL,
      source: "default-unknown-role",
      coerced_from: null,
      reason: `unknown role '${role}' — defaulting to the face-tier Claude model (the Agent-tool channel is Claude-only)`,
    };
  }

  if (r.provider === "claude" && r.model) {
    return {
      role,
      model: r.model,
      source: r.claude_pinned === true ? "claude-pinned" : "claude-native",
      coerced_from: null,
      reason: "role is native-Claude — its own model is a valid Agent-tool model (channel unchanged)",
    };
  }

  const tier = String(r.tier || "").toLowerCase();
  const model = TIER_CLAUDE_MODEL[tier] || HARNESS_FACE_MODEL;
  return {
    role,
    model,
    source: "tier-coerced",
    coerced_from: r.provider || null,
    reason: `non-Claude registry pin (${r.provider || "unknown"}) coerced to a Claude model by tier '${tier || "?"}' — the Agent-tool channel is Claude-only`,
  };
}

function isClaudeModel(model) {
  return typeof model === "string" && /^claude-/.test(model);
}

function main(argv) {
  const role = argv.find((a) => !a.startsWith("--"));
  const json = argv.includes("--json");
  if (!role) {
    process.stderr.write("usage: harness-spawn-model.js <role> [--json]\n");
    return 2;
  }
  const out = harnessSpawnModel(role);
  if (json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    process.stdout.write(`${out.role} → ${out.model}  (${out.source})  ${out.reason}\n`);
  }
  return isClaudeModel(out.model) ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  harnessSpawnModel,
  isClaudeModel,
  HARNESS_FACE_MODEL,
  HARNESS_WORKER_MODEL,
  TIER_CLAUDE_MODEL,
};
