"use strict";

const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");
const { workOrderDigest, TERMINAL_STATES } = require("./workorder-schema");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function stableDigest(obj) {
  const keys = Object.keys(obj || {}).sort();
  const canonical = {};
  for (const k of keys) canonical[k] = obj[k] === undefined ? null : obj[k];
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function resolveTreeHash(ref, opts = {}) {
  if (typeof ref !== "string" || !ref) return null;
  const cwd = opts.gitRoot || PROJECT_ROOT;
  try {
    const r = spawnSync("git", ["rev-parse", "--verify", `${ref}^{tree}`], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    if (!r || r.status !== 0) return null;
    const out = String(r.stdout || "").trim();
    return /^[0-9a-f]{40}$/i.test(out) ? out.toLowerCase() : null;
  } catch {
    return null;
  }
}

function resolveCommitSha(ref, opts = {}) {
  if (typeof ref !== "string" || !ref) return null;
  const cwd = opts.gitRoot || PROJECT_ROOT;
  try {
    const r = spawnSync("git", ["rev-parse", "--verify", ref], { cwd, encoding: "utf8", windowsHide: true });
    if (!r || r.status !== 0) return null;
    const out = String(r.stdout || "").trim();
    return /^[0-9a-f]{7,40}$/i.test(out) ? out.toLowerCase() : null;
  } catch {
    return null;
  }
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

function validateCommitIdentity(record) {
  if (!record || typeof record !== "object") return false;
  const b = record.base_commit;
  const r = record.result_commit;
  return typeof b === "string" && FULL_SHA_RE.test(b) && typeof r === "string" && FULL_SHA_RE.test(r);
}

function isFullSha(x) {
  return typeof x === "string" && FULL_SHA_RE.test(x);
}

function defaultIsAncestor(base, candidate, opts = {}) {
  if (typeof base !== "string" || !base || typeof candidate !== "string" || !candidate) return false;
  const cwd = opts.gitRoot || PROJECT_ROOT;
  try {
    const r = spawnSync("git", ["merge-base", "--is-ancestor", base, candidate], { cwd, encoding: "utf8", windowsHide: true });
    return !!r && r.status === 0;
  } catch {
    return false;
  }
}

function verifyFencingToken(spId, token, leaseRoot) {
  let lease;
  try {
    lease = require("./conductor-lease");
  } catch {
    return false;
  }
  if (!lease || typeof lease.verifyToken !== "function") return false;
  try {
    return lease.verifyToken(spId, token, { root: leaseRoot }) === true;
  } catch {
    return false;
  }
}

function produce(input = {}) {
  const wo = input.workorder;
  const workorder_digest =
    typeof wo === "string" && wo
      ? wo
      : wo && typeof wo === "object"
        ? wo.workorder_digest || workOrderDigest(wo)
        : "";
  const terminal_state =
    input.terminal_state || (wo && typeof wo === "object" ? wo.terminal_state : "") || "";

  const record = {
    schema_version: "acceptance-record/v1",
    produced_by: "trusted-verifier",
    produced_at: Date.now(),
    workorder_digest,
    base_commit: typeof input.base_commit === "string" ? input.base_commit : input.base_commit,
    result_tree_hash: input.result_tree_hash || "",
    result_commit: typeof input.result_commit === "string" ? input.result_commit : input.result_commit,
    target_ref: input.target_ref || "",
    terminal_state,
    check_suite_version: typeof input.check_suite_version === "string" ? input.check_suite_version : (input.check_suite_version || ""),
    checker_digests: input.checker_digests && typeof input.checker_digests === "object" ? input.checker_digests : {},
    policy_digest: input.policy_digest || "",
    evidence_digests: input.evidence_digests && typeof input.evidence_digests === "object" ? input.evidence_digests : {},
    route: input.route != null ? input.route : null,
    fallback: input.fallback === true,
    lease_fencing_token: input.lease_fencing_token != null ? input.lease_fencing_token : null,
    integration_receipt: null,
  };
  if (!validateCommitIdentity(record)) {
    throw new TypeError(
      "acceptance-record.produce: base_commit and result_commit MUST both be immutable full 40-hex commit SHAs " +
        ` — got base_commit=${JSON.stringify(record.base_commit)}, result_commit=${JSON.stringify(record.result_commit)}. ` +
        "The trusted verifier must pass resolved commit SHAs.",
    );
  }
  record.record_digest = stableDigest(record);
  return record;
}

const TEST_BASE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TEST_CAND_SHA = "cccccccccccccccccccccccccccccccccccccccc";
function produceForTest(overrides = {}) {
  const workorder = {
    schema_version: "workorder-min/v1",
    correlation_id: "corr-acceptance-positive-companion",
    role: "backend-builder",
    provider: "claude",
    model: "opus",
    base_commit: TEST_BASE_SHA,
    result_tree_hash: "tree-OK",
    allowed_capabilities: ["build"],
    allowed_paths: ["scripts/"],
    retry_lineage: [],
    evidence_refs: ["ev-1"],
    terminal_state: "success",
  };
  const input = {
    workorder,
    base_commit: TEST_BASE_SHA,
    result_tree_hash: "tree-OK",
    result_commit: TEST_CAND_SHA,
    target_ref: "refs/heads/integration",
    check_suite_version: "check-suite/v1-test",
    checker_digests: { lint: "digest-lint", tests: "digest-tests" },
    policy_digest: "policy-OK",
    evidence_digests: { "ev-1": "digest-ev-1" },
    route: "claude:opus",
    fallback: false,
    lease_fencing_token: null,
  };
  return produce({ ...input, ...overrides });
}

function forgeInvalidRecordForTest(overrides = {}) {
  const forged = Object.assign({}, produceForTest(), overrides);
  if (validateCommitIdentity(forged)) {
    throw new TypeError(
      "forgeInvalidRecordForTest MUST produce a record that FAILS validateCommitIdentity (construction " +
        "invariant) — pass a schema-invalidating override (e.g. result_commit:'' / a mutable ref / a non-SHA). " +
        "For a VALID fixture use produceForTest.",
    );
  }
  return Object.freeze(forged);
}

function authorizesIntegration(record, targetRef, opts = {}) {
  if (!record || typeof record !== "object") return false;
  if (typeof targetRef !== "string" || !targetRef) return false;

  if (record.target_ref !== targetRef) return false;

  if (record.terminal_state !== "success" || !TERMINAL_STATES.includes(record.terminal_state)) return false;

  if (!record.result_tree_hash || !record.workorder_digest) return false;
  if (!validateCommitIdentity(record)) return false;
  const _isDigestMap = (o) =>
    o && typeof o === "object" && !Array.isArray(o) &&
    Object.keys(o).length > 0 &&
    Object.values(o).every((v) => typeof v === "string" && v.trim().length > 0);
  if (!_isDigestMap(record.checker_digests)) return false;
  if (typeof record.policy_digest !== "string" || !record.policy_digest.trim()) return false;
  if (!_isDigestMap(record.evidence_digests)) return false;
  if (typeof record.check_suite_version !== "string" || !record.check_suite_version.trim()) return false;

  if (!isFullSha(opts.integrationHead)) return false;
  if (record.base_commit !== opts.integrationHead) return false;

  if (opts.spId == null || opts.leaseRoot == null) return false;
  if (record.lease_fencing_token == null) return false;
  if (!verifyFencingToken(opts.spId, record.lease_fencing_token, opts.leaseRoot)) return false;

  const resolveCommit = typeof opts.commitResolver === "function" ? opts.commitResolver : resolveCommitSha;
  for (const callerRef of [opts.resultRef, opts.newHead]) {
    if (callerRef != null && String(callerRef) !== "") {
      const sha = resolveCommit(String(callerRef), opts);
      if (!sha || String(sha).toLowerCase() !== String(record.result_commit).toLowerCase()) return false;
    }
  }

  const resolveTree = typeof opts.treeResolver === "function" ? opts.treeResolver : resolveTreeHash;
  const actualTree = resolveTree(record.result_commit, opts);
  if (!actualTree || String(actualTree).toLowerCase() !== String(record.result_tree_hash).toLowerCase()) return false;

  const isAncestor = typeof opts.ancestryResolver === "function" ? opts.ancestryResolver : defaultIsAncestor;
  if (isAncestor(record.base_commit, record.result_commit, opts) !== true) return false;

  return true;
}

function commitIntegration(record, targetRef, opts = {}) {
  if (!record || typeof record !== "object") return { ok: false, reason: "invalid-record" };
  if (typeof targetRef !== "string" || !targetRef) return { ok: false, reason: "invalid-target" };
  if (record.target_ref !== targetRef) return { ok: false, reason: "target-mismatch" };
  if (!validateCommitIdentity(record)) return { ok: false, reason: "invalid-commit-identity" };
  if (opts.expectedHead == null) return { ok: false, reason: "missing-expected-head" };

  if (!isFullSha(opts.expectedHead)) return { ok: false, reason: "expected-head-not-sha" };
  if (opts.expectedHead !== record.base_commit) return { ok: false, reason: "expected-head-base-mismatch" };

  if (opts.spId != null && opts.leaseRoot != null) {
    if (!verifyFencingToken(opts.spId, record.lease_fencing_token, opts.leaseRoot)) {
      return { ok: false, reason: "superseded-lease" };
    }
  }

  if (opts.performRefUpdate === true) {
    if (!isFullSha(opts.newHead)) return { ok: false, reason: "missing-new-head-for-ref-update" };
    if (String(opts.newHead).toLowerCase() !== String(record.result_commit).toLowerCase()) {
      return { ok: false, reason: "new-head-not-bound-candidate" };
    }
  }

  const authzOpts = { ...opts, newHead: undefined, integrationHead: opts.integrationHead != null ? opts.integrationHead : opts.expectedHead };
  if (!authorizesIntegration(record, targetRef, authzOpts)) return { ok: false, reason: "not-authorized" };

  const liveHead = opts.liveHead !== undefined ? opts.liveHead : resolveCommitSha(targetRef, opts);
  if (liveHead == null) return { ok: false, reason: "unresolvable-live-head" };
  if (!isFullSha(liveHead)) return { ok: false, reason: "live-head-not-sha" };
  if (liveHead !== opts.expectedHead) return { ok: false, reason: "validation-to-merge-race" };

  if (opts.performRefUpdate === true) {
    const resolveTree = typeof opts.treeResolver === "function" ? opts.treeResolver : resolveTreeHash;
    const newTree = resolveTree(opts.newHead, opts);
    if (!newTree || String(newTree).toLowerCase() !== String(record.result_tree_hash).toLowerCase()) {
      return { ok: false, reason: "new-head-tree-mismatch" };
    }
    const cwd = opts.gitRoot || PROJECT_ROOT;
    try {
      const r = spawnSync("git", ["update-ref", targetRef, opts.newHead, opts.expectedHead], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
      });
      if (!r || r.status !== 0) return { ok: false, reason: "ref-update-refused" };
    } catch {
      return { ok: false, reason: "ref-update-error" };
    }
  }

  const receipt = {
    target_ref: targetRef,
    committed_head: opts.performRefUpdate === true ? opts.newHead : opts.expectedHead,
    committed_at: Date.now(),
    record_digest: record.record_digest || null,
  };
  return { ok: true, receipt };
}

module.exports = {
  produce,
  produceForTest,
  forgeInvalidRecordForTest,
  authorizesIntegration,
  commitIntegration,
  resolveTreeHash,
  resolveCommitSha,
  defaultIsAncestor,
  validateCommitIdentity,
  stableDigest,
  TEST_BASE_SHA,
  TEST_CAND_SHA,
};
