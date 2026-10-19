"use strict";

const crypto = require("crypto");

const TERMINAL_STATES = Object.freeze(["success", "partial", "blocked", "failed", "cancelled"]);

const FAILURE_REASON_CLASSES = Object.freeze([
  "timeout",
  "quota_exhausted",
  "provider_unavailable",
  "model_unavailable",
  "auth_missing",
  "worktree_base_stale",
]);

const DIGEST_FIELDS = Object.freeze([
  "allowed_capabilities",
  "allowed_paths",
  "base_commit",
  "correlation_id",
  "model",
  "provider",
  "result_tree_hash",
  "role",
  "schema_version",
]);

const REQUIRED_STRING_FIELDS = Object.freeze([
  "schema_version",
  "correlation_id",
  "role",
  "provider",
  "model",
  "base_commit",
  "result_tree_hash",
]);

const REQUIRED_STRING_ARRAY_FIELDS = Object.freeze(["allowed_capabilities", "allowed_paths"]);
const REQUIRED_ARRAY_FIELDS = Object.freeze(["retry_lineage", "evidence_refs"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validate(workorder) {
  if (!workorder || typeof workorder !== "object" || Array.isArray(workorder)) {
    return { ok: false, errors: ["workorder must be a non-null, non-array object"] };
  }
  const wo = workorder;
  const errors = [];

  for (const f of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(wo[f])) {
      errors.push(`missing/invalid required field: '${f}' (expected a non-empty string)`);
    }
  }
  for (const f of REQUIRED_STRING_ARRAY_FIELDS) {
    if (!isStringArray(wo[f])) {
      errors.push(`missing/invalid required field: '${f}' (expected string[])`);
    }
  }
  for (const f of REQUIRED_ARRAY_FIELDS) {
    if (!Array.isArray(wo[f])) {
      errors.push(`missing/invalid required field: '${f}' (expected an array)`);
    }
  }

  const terminalState = wo.terminal_state;
  const validTerminal = TERMINAL_STATES.includes(terminalState);
  if (!validTerminal) {
    errors.push(
      `terminal_state must be one of: ${TERMINAL_STATES.join(", ")} (got: ${JSON.stringify(terminalState)})`,
    );
  }

  const failureReason = wo.failure_reason;
  const hasFailureReason = failureReason !== undefined && failureReason !== null;
  if (hasFailureReason && !FAILURE_REASON_CLASSES.includes(failureReason)) {
    errors.push(
      `failure_reason must be one of the CLASS taxonomy: ${FAILURE_REASON_CLASSES.join(", ")} (got: ${JSON.stringify(failureReason)})`,
    );
  }
  if (validTerminal) {
    if (terminalState === "success" && hasFailureReason) {
      errors.push("failure_reason must be ABSENT when terminal_state is 'success' (a success has no failure cause)");
    } else if (terminalState !== "success" && !hasFailureReason) {
      errors.push(
        `failure_reason is REQUIRED when terminal_state is '${terminalState}' (one of: ${FAILURE_REASON_CLASSES.join(", ")})`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function workOrderDigest(workorder) {
  const wo = workorder && typeof workorder === "object" && !Array.isArray(workorder) ? workorder : {};
  const canonical = {};
  for (const f of DIGEST_FIELDS) {
    canonical[f] = wo[f] === undefined ? null : wo[f];
  }
  const json = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(json).digest("hex");
}

module.exports = {
  TERMINAL_STATES,
  FAILURE_REASON_CLASSES,
  DIGEST_FIELDS,
  validate,
  workOrderDigest,
};
