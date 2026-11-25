#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const path = require("path");

const HARNESS_FACE_MODEL = mcEnv.readEnv("HARNESS_FACE_MODEL") || "claude-opus-5-5";
const HARNESS_WORKER_MODEL = mcEnv.readEnv("HARNESS_WORKER_MODEL") || "claude-sonnet-5-5";

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

function aliasOf(model) {
  try {
    return require("./model-resolve").agentAlias(model);
  } catch {
    return null;
  }
}

function tierFallback(role, r, source, why) {
  const tier = String((r && r.tier) || "").toLowerCase();
  const model = TIER_CLAUDE_MODEL[tier] || HARNESS_FACE_MODEL;
  const alias = aliasOf(model);
  return {
    role,
    model,
    effort: null,
    alias,
    spawn_model_param: alias,
    source,
    coerced_from: r && r.provider && r.provider !== "claude" ? r.provider : null,
    reason: why,
  };
}

function harnessSpawnModel(role, roles, opts) {
  const rolesMap = roles || loadRolesSafe();
  const r = rolesMap && Object.prototype.hasOwnProperty.call(rolesMap, role) ? rolesMap[role] : null;
  let res;
  try {
    res = require("./model-resolve").resolveRole(role, { ...(opts || {}), channel: "in-process" });
  } catch (e) {
    return tierFallback(role, r, "tier-fail-safe", `the resolver failed (${e.message}) — tier map used; the Agent-tool channel is Claude-only`);
  }
  const unknownToResolver = !res || (res.source === "fail-safe" && res.index === -1 && (!res.chain || res.chain.length === 0));
  if (unknownToResolver) {
    if (!r || typeof r !== "object") {
      return tierFallback(role, null, "default-unknown-role", `unknown role '${role}' — defaulting to the face-tier Claude model (the Agent-tool channel is Claude-only)`);
    }
    return tierFallback(role, r, "tier-coerced", `role '${role}' has no preset chain — tier '${String(r.tier || "?")}' mapped to a Claude model (the Agent-tool channel is Claude-only)`);
  }
  const firstProvider = res.chain && res.chain[0] ? res.chain[0].provider : null;
  const hasSpec = !!(r && typeof r.spec === "string" && r.spec);
  const sp = res.spawn || { pinned: false, model: null, effort: null };
  return {
    role,
    model: res.model,
    effort: res.effort,
    alias: res.alias,
    spawn_model_param: hasSpec ? (sp.pinned ? sp.model : null) : res.alias,
    spawn_effort_param: hasSpec ? (sp.pinned ? sp.effort : null) : res.effort,
    pinned: !!sp.pinned,
    unservable: !!sp.unservable,
    ...(sp.unservable ? { unservable_reason: sp.reason } : {}),
    ...(res.warning ? { warning: res.warning } : {}),
    source: res.source === "fail-safe" ? "fail-safe" : r && r.claude_pinned === true ? "claude-pinned" : firstProvider && firstProvider !== "claude" ? "resolver-coerced" : "resolver",
    coerced_from: firstProvider && firstProvider !== "claude" ? firstProvider : null,
    chain_index: res.index,
    reason: firstProvider && firstProvider !== "claude"
      ? `the chain starts on ${firstProvider}; the in-process channel takes its first Claude entry (entry ${res.index})`
      : `the first Claude entry of the role's chain (${res.source})`,
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
    process.stdout.write(
      `${out.role} → ${out.model}${out.effort ? "@" + out.effort : ""} [alias ${out.alias || "none"}; spawn param ${out.spawn_model_param || "none (spec frontmatter decides)"}${out.spawn_effort_param && out.spawn_model_param ? ", effort " + out.spawn_effort_param : ""}]  (${out.source})  ${out.reason}\n`,
    );
    if (out.unservable) process.stdout.write(`  CANNOT SPAWN AS PINNED: ${out.unservable_reason}\n`);
    if (out.warning) process.stdout.write(`  warning: ${out.warning}\n`);
  }
  if (out.unservable) return 3;
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
