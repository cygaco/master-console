"use strict";
/**
 * trusted-controller.js — the SOLE integration principal.
 *
 * WHAT PROBLEM THIS CLOSES: the CORE-2 trust boundary ("a provider-independent
 * trusted layer solely owns capability grants, protected mutation, verification, and integration-to-main")
 * needs a live MECHANISM. This module IS that mechanism for TWO of the four CORE-2 powers —
 * verification and integration-to-main — over the artifact-verification+integration SLICE (see the
 * honest-promise block, top-level-runtime-contract.md §1 P1.2). Capability grants and protected mutation
 * are NOT this module's job.
 *
 * ONE public entrypoint: `integrate(input, opts)`. Everything else is an internal helper exported ONLY so
 * the record-trust falsifier corpus can attack individual seams in isolation (mintRunManifest,
 * reconcileRunManifest, recomputeBoundDigests) — none of them is a second route into main.
 *
 * CONTROLLER re-derives, never adopts: `input.result_envelope` is UNTRUSTED DATA — logged/
 * hinted at most, NEVER read to decide anything. Every commit identity, tree hash, checker result, and
 * digest this module binds into the AcceptanceRecord is RE-DERIVED from real git objects and a FRESH,
 * nonce-bound pinned-bundle run — never adopted from a caller's claim.
 *
 * Sole-route = MECHANISM, ceiling NAMED: this module performs the ONLY sanctioned mutating
 * write into a protected ref (via acceptance-record.js#commitIntegration's atomic git CAS,
 * `git update-ref <ref> <new> <expected>`), and `scripts/hooks/protected-ref-transaction.js` is
 * the git-level MECHANISM that requires a current fencing token — set ONLY around this module's own
 * commitIntegration call — for any write surface (`update-ref`/merge/push/fast-forward) touching that ref.
 * NAMED-UNCOVERED, evidence-grounded, accepted out-of-scope,
 * hostile-shell: `core.hooksPath` redirect, hook deletion, a direct `.git/refs/**` filesystem write, a
 * hostile process forging the fence. Those require local shell + intent — adversarial containment,
 * explicitly OUT of this module's honest promise.
 *
 * Signature re-confirm at load (drift THROWS): `assertAcceptanceRecordContract()` runs
 * as a MODULE-LOAD side effect below — never `fn.length` (defaulted opts undercount) — asserting the exact
 * acceptance-record.js export surface PLUS a behavioral smoke (produce() throws on a non-SHA base_commit;
 * authorizesIntegration(bareEnvelope, ref) === false). A drifted signature throws before any integrate()
 * call is even reachable.
 *
 * Check-set provenance (BINDING): `mintRunManifest` derives `expected_checks`/`required_checks` FROM
 * the pinned bundle's FROZEN `CHECK_NAMES`/`REQUIRED_CHECKS` — never from `input.expected_checks`.
 * `input.expected_checks?` may ONLY additively constrain (assert `input ⊆ bundle.CHECK_NAMES`, and it may
 * mark MORE bundle-known names required-for-this-run) — it can NEVER shrink `required_checks` below the
 * bundle's own `REQUIRED_CHECKS` (a union, never a replace). `expected_checks` in the minted manifest is
 * ALWAYS the pinned bundle's full frozen `CHECK_NAMES` — `runPinnedSuite` already
 * executes that full set regardless of any caller-supplied subset, so a caller passing `[]` or a shrunk set
 * cannot vacuously pass reconcile: the pinned required checks still fire, and a real failure among them
 * still refuses integration (`check-failed`). See `caller-cannot-shrink-check-set.falsifier.test.js`.
 *
 * The controller does NOT route the CAS through safe-spawn (safe-spawn's git policy is READ-ONLY diff/
 * status/rev-parse/log) — the sanctioned mutating write lives inside acceptance-record.js#commitIntegration
 * by design.
 *
 * No external deps. Windows + POSIX safe (no shell spawns of our own; every mutating write is delegated to
 * acceptance-record.js's spawnSync array-argv call).
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const acceptanceRecord = require("./acceptance-record");
const pcb = require("./pinned-checker-bundle");
const lease = require("./conductor-lease");
const { workOrderDigest } = require("./workorder-schema");
const reftxn = require("../hooks/protected-ref-transaction");

const REQUIRED_ACCEPTANCE_EXPORTS = Object.freeze([
  "produce",
  "produceForTest",
  "forgeInvalidRecordForTest",
  "authorizesIntegration",
  "commitIntegration",
  "validateCommitIdentity",
  "resolveTreeHash",
  "resolveCommitSha",
  "defaultIsAncestor",
  "stableDigest",
]);

function assertAcceptanceRecordContract(mod) {
  const m = mod || acceptanceRecord;
  if (!m || typeof m !== "object") {
    throw new Error("trusted-controller: acceptance-record.js contract drift — module did not export an object");
  }
  const missing = REQUIRED_ACCEPTANCE_EXPORTS.filter((k) => typeof m[k] !== "function");
  if (missing.length) {
    throw new Error(
      `trusted-controller: acceptance-record.js contract drift — missing/non-function export(s): ${missing.join(", ")}`,
    );
  }

  let producedThrew = false;
  try {
    m.produce({
      workorder: "wo",
      terminal_state: "success",
      target_ref: "refs/heads/x",
      base_commit: "not-a-sha",
      result_commit: "c".repeat(40),
    });
  } catch {
    producedThrew = true;
  }
  if (!producedThrew) {
    throw new Error(
      "trusted-controller: acceptance-record.js contract drift — produce() no longer throws on a non-SHA base_commit (behavioral smoke failed)",
    );
  }

  let authz;
  try {
    authz = m.authorizesIntegration({ success: true, verdict: "accept" }, "refs/heads/main");
  } catch {
    authz = true;
  }
  if (authz !== false) {
    throw new Error(
      "trusted-controller: acceptance-record.js contract drift — authorizesIntegration(bareEnvelope, ref) did not return false (behavioral smoke failed)",
    );
  }
}

assertAcceptanceRecordContract();

function loadPinnedCheckLib(bundleManifest, opts = {}) {
  const bundleRoot = path.resolve(opts.bundleRoot || "");
  const candidateRoot = opts.candidateRoot;

  const completeness = pcb.assertBundleCompleteness(bundleManifest, { bundleRoot });
  if (!completeness.ok) {
    const err = new Error(
      `trusted-controller: pinned bundle manifest is incomplete — missing: ${completeness.missing.join(", ")} (empty/incomplete-bundle-manifest)`,
    );
    err.code = "incomplete-bundle-manifest";
    throw err;
  }

  const pre = pcb.verifyBundle(bundleManifest, { bundleRoot });
  if (!pre.ok) {
    const err = new Error("trusted-controller: pinned bundle failed verification before mint (bundle-pin-mismatch)");
    err.code = "bundle-pin-mismatch";
    throw err;
  }

  const bundleLibRoot = path.join(bundleRoot, "lib");
  if (!fs.existsSync(bundleLibRoot) || !fs.statSync(bundleLibRoot).isDirectory()) {
    const err = new Error(`trusted-controller: pinned bundle has no lib/ directory at ${bundleLibRoot} — cannot bind bundle contents to the promotion claim`);
    err.code = "bundle-lineage-unresolvable";
    throw err;
  }
  let bundleLibDigest;
  try {
    bundleLibDigest = pcb.sourceDigestOf(bundleLibRoot);
  } catch (e) {
    const err = new Error(`trusted-controller: cannot compute the pinned bundle's own lib/ content digest: ${e.message}`);
    err.code = "bundle-lineage-unresolvable";
    throw err;
  }

  const checkLibSrcRoot = opts.checkLibSrcRoot || pcb.DEFAULT_LIB_SRC;
  let freshSrcDigest;
  try {
    freshSrcDigest = pcb.sourceDigestOf(checkLibSrcRoot);
  } catch (e) {
    const err = new Error(`trusted-controller: cannot compute the live check-lib source digest for lineage verification: ${e.message}`);
    err.code = "bundle-lineage-unresolvable";
    throw err;
  }
  const pinnedSrcDigest = bundleManifest.promotion && bundleManifest.promotion.from_src_digest;

  if (!pinnedSrcDigest || pinnedSrcDigest !== bundleLibDigest) {
    const err = new Error(
      "trusted-controller: pinned bundle's OWN lib/ contents do not hash to its promotion.from_src_digest — the promotion claim is not backed by the bundle's actual bytes (self-authored/forged bundle)",
    );
    err.code = "bundle-content-lineage-mismatch";
    throw err;
  }
  if (pinnedSrcDigest !== freshSrcDigest) {
    const err = new Error(
      "trusted-controller: pinned bundle promotion.from_src_digest does not match the LIVE check-lib source (lineage — re-promote the bundle before integrating)",
    );
    err.code = "bundle-lineage-mismatch";
    throw err;
  }

  try {
    pcb.resolveExecutable(bundleManifest, "node", { candidateRoot, repoCheckLibRoot: pcb.DEFAULT_LIB_SRC });
  } catch (e) {
    e.code = e.code || "resolution-outside-candidate";
    throw e;
  }

  const pinnedIndexPath = path.join(bundleRoot, "lib", "index.js");
  let real;
  try {
    real = pcb.assertOutsideZones(pinnedIndexPath, { candidateRoot, repoCheckLibRoot: pcb.DEFAULT_LIB_SRC }, "checker-not-from-pinned-bundle");
  } catch (e) {
    e.code = e.code || "checker-not-from-pinned-bundle";
    throw e;
  }

  let pinnedIndex;
  try {
    delete require.cache[real];
    // eslint-disable-next-line global-require, import/no-dynamic-require
    pinnedIndex = require(real);
  } catch (e) {
    const err = new Error(`trusted-controller: failed to require the pinned check-lib copy: ${e.message}`);
    err.code = "pinned-index-require-failed";
    throw err;
  }

  const contract = pcb.assertCheckLibExports(pinnedIndex);
  if (!contract.ok) {
    const err = new Error(`trusted-controller: pinned check-lib export contract drift — missing: ${contract.missing.join(", ")}`);
    err.code = "check-export-missing";
    throw err;
  }

  return pinnedIndex;
}

function mintRunManifest(input, opts, ctx) {
  const bundleCheckNames = ctx.pinnedIndex.CHECK_NAMES.slice();
  const bundleRequired = ctx.pinnedIndex.REQUIRED_CHECKS.slice();

  if (!Array.isArray(bundleCheckNames) || bundleCheckNames.length === 0) {
    const err = new Error("trusted-controller: pinned bundle's CHECK_NAMES is empty — refusing to mint a vacuous run manifest");
    err.code = "empty-expected-check-set";
    throw err;
  }

  const requested = Array.isArray(input.expected_checks) ? input.expected_checks : [];
  const invalid = requested.filter((n) => !bundleCheckNames.includes(n));
  if (invalid.length) {
    const err = new Error(
      `trusted-controller: input.expected_checks names not present in the pinned bundle's CHECK_NAMES (rejected):${invalid.join(", ")}`,
    );
    err.code = "expected-checks-not-in-bundle";
    throw err;
  }

  const required = Array.from(new Set([...bundleRequired, ...requested]));

  return {
    schema_version: "run-manifest/v1",
    nonce: crypto.randomBytes(16).toString("hex"),
    minted_at: Date.now(),
    sp_id: opts.spId != null ? opts.spId : null,
    lease_fencing_token: ctx.leaseToken != null ? ctx.leaseToken : null,
    base_commit: ctx.baseCommit,
    result_commit: ctx.resultCommit,
    target_ref: ctx.targetRef,
    suite_version: ctx.pinnedIndex.SUITE_VERSION,
    bundle_digest: ctx.bundleManifest.bundle_digest,
    expected_checks: bundleCheckNames,
    required_checks: required,
  };
}

function reconcileRunManifest(runManifest, results) {
  if (
    !runManifest ||
    typeof runManifest !== "object" ||
    !Array.isArray(runManifest.expected_checks) ||
    !Array.isArray(runManifest.required_checks) ||
    typeof runManifest.nonce !== "string" ||
    !runManifest.nonce
  ) {
    return { ok: false, reason: "malformed-run-manifest" };
  }
  if (runManifest.expected_checks.length === 0) {
    return { ok: false, reason: "empty-expected-check-set" };
  }

  const expected = runManifest.expected_checks;
  const required = new Set(runManifest.required_checks);
  const resultsArr = Array.isArray(results) ? results : [];
  const byName = new Map();

  for (const r of resultsArr) {
    const shapeOk =
      r && typeof r === "object" && typeof r.name === "string" && r.name && typeof r.status === "string" && typeof r.digest === "string" && r.digest;
    if (!shapeOk) {
      return { ok: false, reason: "malformed-check-result", offending: r && r.name };
    }
    if (!expected.includes(r.name)) {
      return { ok: false, reason: "unknown-check-result", offending: r.name };
    }
    if (r.nonce !== runManifest.nonce) {
      return { ok: false, reason: "stale-check-result", offending: r.name };
    }
    if (byName.has(r.name)) {
      return { ok: false, reason: "duplicate-check-result", offending: r.name };
    }
    byName.set(r.name, r);
  }

  for (const name of expected) {
    const r = byName.get(name);
    if (!r) {
      return { ok: false, reason: "missing-required-check", offending: name };
    }
    if (r.status === "timeout") {
      return { ok: false, reason: "check-timed-out", offending: name };
    }
    if (r.status === "skipped") {
      if (required.has(name)) return { ok: false, reason: "required-check-skipped", offending: name };
      continue;
    }
    if (r.status === "fail") {
      return { ok: false, reason: "check-failed", offending: name };
    }
    if (r.status !== "pass") {
      return { ok: false, reason: "malformed-check-result", offending: name };
    }
  }

  return { ok: true };
}

function recomputeBoundDigests(args = {}) {
  const { workorder, results, evidence, policySnapshot } = args;

  const checker_digests = {};
  for (const r of Array.isArray(results) ? results : []) {
    if (r && typeof r === "object" && typeof r.name === "string" && r.name && typeof r.digest === "string" && r.digest) {
      checker_digests[r.name] = r.digest;
    }
  }

  const evidence_digests = {};
  const evidenceObj = evidence && typeof evidence === "object" ? evidence : {};
  for (const [k, v] of Object.entries(evidenceObj)) {
    evidence_digests[k] = typeof v === "string" && v ? v : acceptanceRecord.stableDigest(v == null ? { k } : v);
  }

  const workorder_digest =
    typeof workorder === "string" && workorder
      ? workorder
      : workorder && typeof workorder === "object"
        ? workorder.workorder_digest || workOrderDigest(workorder)
        : "";

  const policy_digest = acceptanceRecord.stableDigest(policySnapshot && typeof policySnapshot === "object" ? policySnapshot : {});

  return { workorder_digest, checker_digests, evidence_digests, policy_digest };
}

function materializeResultTree(resultCommit, opts = {}) {
  const gitRoot = opts.gitRoot;
  const resolveTree = typeof opts.treeResolver === "function" ? opts.treeResolver : acceptanceRecord.resolveTreeHash;
  const expectedTree = resolveTree(resultCommit, { gitRoot });
  if (!expectedTree) {
    const err = new Error(`trusted-controller: result_commit's tree hash is unresolvable — cannot materialize (${resultCommit})`);
    err.code = "result-tree-unresolvable";
    throw err;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "result-tree-materialize-"));
  const cleanup = () => {
    try {
      spawnSync("git", ["worktree", "remove", "--force", tmpDir], { cwd: gitRoot, encoding: "utf8", windowsHide: true });
    } catch {
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
    }
  };

  const add = spawnSync("git", ["worktree", "add", "--detach", "-q", tmpDir, resultCommit], {
    cwd: gitRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (!add || add.status !== 0) {
    cleanup();
    const err = new Error(
      `trusted-controller: 'git worktree add --detach' failed to materialize result_commit ${resultCommit}: ${(add && (add.stderr || add.error)) || "unknown error"}`,
    );
    err.code = "result-tree-materialize-failed";
    throw err;
  }

  const verifyResolver = typeof opts.materializedTreeResolver === "function" ? opts.materializedTreeResolver : acceptanceRecord.resolveTreeHash;
  const observedTree = verifyResolver("HEAD", { gitRoot: tmpDir });
  if (!observedTree || String(observedTree).toLowerCase() !== String(expectedTree).toLowerCase()) {
    cleanup();
    const err = new Error(`trusted-controller: materialized tree hash mismatch for result_commit ${resultCommit} (expected ${expectedTree}, observed ${observedTree})`);
    err.code = "result-tree-materialize-mismatch";
    throw err;
  }

  return { dir: tmpDir, treeHash: expectedTree, cleanup };
}

// ── Seam E fence scoping — set ONLY around this module's own commitIntegration call. ───────────────────────

function withControllerFence(spId, leaseToken, leaseRoot, fn) {
  const keys = [reftxn.FENCE_TOKEN_ENV, reftxn.FENCE_SPID_ENV, reftxn.FENCE_LEASEROOT_ENV];
  const prev = keys.map((k) => process.env[k]);
  process.env[reftxn.FENCE_TOKEN_ENV] = leaseToken != null ? String(leaseToken) : "";
  process.env[reftxn.FENCE_SPID_ENV] = spId != null ? String(spId) : "";
  process.env[reftxn.FENCE_LEASEROOT_ENV] = leaseRoot != null ? String(leaseRoot) : "";
  try {
    return fn();
  } finally {
    keys.forEach((k, i) => {
      if (prev[i] === undefined) delete process.env[k];
      else process.env[k] = prev[i];
    });
  }
}

function defaultLeaseTokenResolver(spId, leaseRoot) {
  if (spId == null) return null;
  try {
    const holder = lease.status(spId, { root: leaseRoot });
    return holder ? holder.token : null;
  } catch {
    return null;
  }
}

function stripHookComments(content) {
  return String(content || "")
    .split(/\r?\n/)
    .filter((raw) => {
      const line = raw.trim();
      return line && !line.startsWith("#");
    });
}

function extractPinnedHookInvocation(content) {
  const INVOKES = /(^|\s)(exec|source|node(\.exe)?|\.)(\s|$)|require\s*\(/;
  const PATHTOK = /["']?([^"'\s]*protected-ref-transaction\.js)["']?/;
  for (const line of stripHookComments(content)) {
    if (!INVOKES.test(line)) continue;
    const m = line.match(PATHTOK);
    if (!m) continue;
    return { line, rawPath: m[1] };
  }
  return null;
}

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function verifyActiveHookInstalled(opts = {}) {
  const gitRoot = opts.gitRoot;
  const pinnedHookSrc = opts.pinnedHookSrcPath || path.resolve(__dirname, "..", "hooks", "protected-ref-transaction.js");
  if (!fs.existsSync(pinnedHookSrc)) {
    return { ok: false, reason: "pinned-hook-source-missing", pinnedHookSrc };
  }

  let gitPathOut;
  try {
    const r = spawnSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: gitRoot, encoding: "utf8", windowsHide: true });
    if (!r || r.status !== 0) return { ok: false, reason: "hooks-dir-unresolvable" };
    gitPathOut = String(r.stdout || "").trim();
  } catch {
    return { ok: false, reason: "hooks-dir-unresolvable" };
  }
  if (!gitPathOut) return { ok: false, reason: "hooks-dir-unresolvable" };
  const hooksDir = path.isAbsolute(gitPathOut) ? gitPathOut : path.resolve(gitRoot, gitPathOut);
  const hookPath = path.join(hooksDir, "reference-transaction");

  if (!fs.existsSync(hookPath)) {
    return { ok: false, reason: "active-hook-not-installed", hooksDir, hookPath };
  }
  let content;
  try {
    content = fs.readFileSync(hookPath, "utf8");
  } catch (e) {
    return { ok: false, reason: "active-hook-unreadable", hooksDir, hookPath, detail: e.message };
  }
  const canonical = reftxn.renderReferenceTransactionHook(pinnedHookSrc);
  const contentIsCanonical = content.replace(/\r\n/g, "\n") === canonical;

  if (!contentIsCanonical) {
    const invocation = extractPinnedHookInvocation(content);
    if (!invocation) {
      return { ok: false, reason: "active-hook-not-pinned", hooksDir, hookPath, detail: "no resolvable invocation of the pinned protected-ref-transaction.js module (a name/comment is not an invocation)" };
    }
    const raw = invocation.rawPath;
    const candidates = path.isAbsolute(raw) ? [raw] : [path.resolve(hooksDir, raw), path.resolve(gitRoot || PROJECT_ROOT, raw), path.resolve(PROJECT_ROOT, raw)];
    const pinnedReal = realpathOrNull(pinnedHookSrc) || path.resolve(pinnedHookSrc);
    const matched = candidates.some((c) => {
      const real = realpathOrNull(c);
      return !!real && real === pinnedReal;
    });
    if (!matched) {
      return {
        ok: false,
        reason: "active-hook-not-pinned-module",
        hooksDir,
        hookPath,
        detail: `the active hook invokes '${raw}', which does not resolve to the pinned module ${pinnedReal}`,
      };
    }
  }
  if (process.platform !== "win32") {
    let st;
    try {
      st = fs.statSync(hookPath);
    } catch (e) {
      return { ok: false, reason: "active-hook-unreadable", hooksDir, hookPath, detail: e.message };
    }
    if ((st.mode & 0o111) === 0) {
      return { ok: false, reason: "active-hook-not-executable", hooksDir, hookPath };
    }
  }
  return { ok: true, hooksDir, hookPath };
}

const PRODUCTION_OPT_KEYS = Object.freeze(["bundleManifestPath", "bundleRoot", "candidateRoot", "spId", "leaseRoot", "gitRoot", "performRefUpdate"]);

function sanitizeOpts(opts) {
  const out = {};
  if (!opts || typeof opts !== "object") return out;
  for (const k of PRODUCTION_OPT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(opts, k)) out[k] = opts[k];
  }
  return out;
}

const REAL_SEAMS = Object.freeze({
  hookLivenessCheck: verifyActiveHookInstalled,
  materializeResultTree,
  treeResolver: null,
  materializedTreeResolver: null,
  commitResolver: null,
  ancestryResolver: null,
  leaseTokenResolver: defaultLeaseTokenResolver,
  checkLibSrcRoot: null,
  liveHead: undefined,
});

function integrate(input = {}, opts = {}) {
  return integrateInternal(input, sanitizeOpts(opts), REAL_SEAMS);
}

function integrateForTest(input = {}, opts = {}, seams = {}) {
  return integrateInternal(input, sanitizeOpts(opts), { ...REAL_SEAMS, ...(seams && typeof seams === "object" ? seams : {}) });
}

function integrateInternal(input = {}, o = {}, seams = REAL_SEAMS) {
  const gitRoot = o.gitRoot || PROJECT_ROOT;
  const resolveCommit = typeof seams.commitResolver === "function" ? seams.commitResolver : acceptanceRecord.resolveCommitSha;
  const resolveTree = typeof seams.treeResolver === "function" ? seams.treeResolver : acceptanceRecord.resolveTreeHash;

  const hookCheckFn = typeof seams.hookLivenessCheck === "function" ? seams.hookLivenessCheck : verifyActiveHookInstalled;
  const hookCheck = hookCheckFn({ gitRoot });
  if (!hookCheck.ok) {
    return { ok: false, decision: "BLOCKED", reason: hookCheck.reason || "hook-not-installed", detail: hookCheck };
  }

  const baseCommit = resolveCommit(input.base_commit, { gitRoot });
  if (!baseCommit) return { ok: false, decision: "BLOCKED", reason: "base-commit-unresolvable" };
  const resultCommit = resolveCommit(input.result_commit, { gitRoot });
  if (!resultCommit) return { ok: false, decision: "BLOCKED", reason: "result-commit-unresolvable" };
  const targetRef = typeof input.target_ref === "string" && input.target_ref ? input.target_ref : null;
  if (!targetRef) return { ok: false, decision: "BLOCKED", reason: "invalid-target-ref" };

  let bundleManifest, pinnedIndex;
  try {
    bundleManifest = pcb.loadBundleManifest(o.bundleManifestPath);
    pinnedIndex = loadPinnedCheckLib(bundleManifest, {
      bundleRoot: o.bundleRoot,
      candidateRoot: o.candidateRoot,
      checkLibSrcRoot: seams.checkLibSrcRoot || undefined,
    });
  } catch (e) {
    return { ok: false, decision: "BLOCKED", reason: e.code || "bundle-load-failed", detail: e.message };
  }

  const resolveLeaseToken = typeof seams.leaseTokenResolver === "function" ? seams.leaseTokenResolver : defaultLeaseTokenResolver;
  let leaseToken = null;
  try {
    leaseToken = resolveLeaseToken(o.spId, o.leaseRoot);
  } catch {
    leaseToken = null;
  }

  let runManifest;
  try {
    runManifest = mintRunManifest(input, o, { bundleManifest, pinnedIndex, baseCommit, resultCommit, targetRef, leaseToken });
  } catch (e) {
    return { ok: false, decision: "BLOCKED", reason: e.code || "run-manifest-mint-failed", detail: e.message };
  }

  const materializeFn = typeof seams.materializeResultTree === "function" ? seams.materializeResultTree : materializeResultTree;
  let materialized;
  try {
    materialized = materializeFn(resultCommit, { gitRoot, treeResolver: seams.treeResolver, materializedTreeResolver: seams.materializedTreeResolver });
  } catch (e) {
    return { ok: false, decision: "BLOCKED", reason: e.code || "result-tree-materialize-failed", detail: e.message, runManifest };
  }

  let pinnedResult;
  try {
    pinnedResult = pcb.runPinnedSuite(
      bundleManifest,
      { envelope: input.result_envelope, root: materialized.dir },
      { bundleRoot: o.bundleRoot, candidateRoot: o.candidateRoot || gitRoot, nonce: runManifest.nonce },
    );
    const postVerify = typeof seams.materializedTreeResolver === "function" ? seams.materializedTreeResolver : acceptanceRecord.resolveTreeHash;
    const postTree = postVerify("HEAD", { gitRoot: materialized.dir });
    if (!postTree || String(postTree).toLowerCase() !== String(materialized.treeHash).toLowerCase()) {
      return { ok: false, decision: "BLOCKED", reason: "result-tree-mutated-mid-run", runManifest };
    }
  } finally {
    materialized.cleanup();
  }
  if (!pinnedResult.ok) {
    return { ok: false, decision: "BLOCKED", reason: pinnedResult.reason || "pinned-suite-failed", runManifest };
  }

  const reconciled = reconcileRunManifest(runManifest, pinnedResult.results);
  if (!reconciled.ok) {
    return { ok: false, decision: "BLOCKED", reason: reconciled.reason, offending: reconciled.offending, runManifest };
  }

  const bound = recomputeBoundDigests({
    workorder: input.workorder,
    results: pinnedResult.results,
    evidence: (input.workorder && typeof input.workorder === "object" && input.workorder.evidence) || {},
    policySnapshot: { bundle_digest: bundleManifest.bundle_digest, suite_version: pinnedIndex.SUITE_VERSION, target_ref: targetRef },
  });

  let record;
  try {
    record = acceptanceRecord.produce({
      workorder: input.workorder,
      terminal_state: "success",
      base_commit: baseCommit,
      result_tree_hash: resolveTree(resultCommit, { gitRoot }),
      result_commit: resultCommit,
      target_ref: targetRef,
      checker_digests: bound.checker_digests,
      policy_digest: bound.policy_digest,
      evidence_digests: bound.evidence_digests,
      check_suite_version: pinnedIndex.SUITE_VERSION,
      route: input.route != null ? input.route : null,
      fallback: input.fallback === true,
      lease_fencing_token: leaseToken,
    });
  } catch (e) {
    return { ok: false, decision: "BLOCKED", reason: "produce-failed", detail: e.message, runManifest };
  }

  const authorized = acceptanceRecord.authorizesIntegration(record, targetRef, {
    integrationHead: baseCommit,
    spId: o.spId,
    leaseRoot: o.leaseRoot,
    gitRoot,
    treeResolver: seams.treeResolver,
    commitResolver: seams.commitResolver,
    ancestryResolver: seams.ancestryResolver,
  });
  if (!authorized) {
    return { ok: false, decision: "BLOCKED", reason: "not-authorized", runManifest };
  }

  const commit = withControllerFence(o.spId, leaseToken, o.leaseRoot, () =>
    acceptanceRecord.commitIntegration(record, targetRef, {
      expectedHead: baseCommit,
      newHead: resultCommit,
      performRefUpdate: o.performRefUpdate === true,
      spId: o.spId,
      leaseRoot: o.leaseRoot,
      gitRoot,
      treeResolver: seams.treeResolver,
      integrationHead: baseCommit,
      liveHead: seams.liveHead,
    }),
  );
  if (!commit.ok) {
    return { ok: false, decision: "BLOCKED", reason: commit.reason, runManifest };
  }

  return { ok: true, decision: "INTEGRATED", receipt: commit.receipt, runManifest };
}

const TRANSPORT_OPT_KEYS = Object.freeze(["bundleManifestPath", "bundleRoot", "spId", "leaseRoot", "gitRoot"]);

function sanitizeTransportOpts(opts) {
  const out = {};
  if (!opts || typeof opts !== "object") return out;
  for (const k of TRANSPORT_OPT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(opts, k)) out[k] = opts[k];
  }
  return out;
}

const { TRANSPORT_SKIP_ALLOWED } = require("./transport-skip-allowlist");

function gitRead(args, gitRoot) {
  try {
    const r = spawnSync("git", args, { cwd: gitRoot || PROJECT_ROOT, encoding: "utf8", windowsHide: true });
    if (!r || r.status !== 0) return null;
    return String(r.stdout || "").trim();
  } catch {
    return null;
  }
}

function isCommitObject(sha, gitRoot) {
  return gitRead(["cat-file", "-t", sha], gitRoot) === "commit";
}

function resolveCommitParents(sha, gitRoot) {
  if (!isCommitObject(sha, gitRoot)) return null;
  const line = gitRead(["rev-list", "--parents", "-n", "1", sha], gitRoot);
  if (!line) return null;
  const toks = line.split(/\s+/).filter(Boolean);
  if (toks.length < 1) return null;
  return toks.slice(1).map((t) => t.toLowerCase());
}

function reconcileTransportSuite(expectedChecks, results, nonce) {
  if (!Array.isArray(expectedChecks) || expectedChecks.length === 0) {
    return { ok: false, reason: "empty-expected-check-set" };
  }
  if (typeof nonce !== "string" || !nonce) return { ok: false, reason: "malformed-run-nonce" };

  const byName = new Map();
  for (const r of Array.isArray(results) ? results : []) {
    const shapeOk = r && typeof r === "object" && typeof r.name === "string" && r.name && typeof r.status === "string";
    if (!shapeOk) return { ok: false, reason: "malformed-check-result", offending: r && r.name };
    if (!expectedChecks.includes(r.name)) return { ok: false, reason: "unknown-check-result", offending: r.name };
    if (r.nonce !== nonce) return { ok: false, reason: "stale-check-result", offending: r.name };
    if (byName.has(r.name)) return { ok: false, reason: "duplicate-check-result", offending: r.name };
    byName.set(r.name, r);
  }

  for (const name of expectedChecks) {
    const r = byName.get(name);
    if (!r) return { ok: false, reason: "missing-required-check", offending: name };
    if (r.status === "pass") continue;
    if (r.status === "fail") return { ok: false, reason: "check-failed", offending: name };
    if (r.status === "timeout") return { ok: false, reason: "check-timed-out", offending: name };
    if (r.status === "skipped") {
      if (Object.prototype.hasOwnProperty.call(TRANSPORT_SKIP_ALLOWED, name) && r.reason === TRANSPORT_SKIP_ALLOWED[name]) continue;
      return { ok: false, reason: "required-check-skipped", offending: name };
    }
    return { ok: false, reason: "malformed-check-result", offending: name };
  }
  return { ok: true };
}

function defaultRefUpdater(targetRef, newHead, expectedHead, gitRoot) {
  try {
    const r = spawnSync("git", ["update-ref", targetRef, newHead, expectedHead], {
      cwd: gitRoot || PROJECT_ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
    if (!r || r.status !== 0) {
      return { ok: false, reason: "ref-update-refused", detail: (r && (r.stderr || String(r.error || ""))) || "unknown error" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "ref-update-error", detail: e.message };
  }
}

const REAL_TRANSPORT_SEAMS = Object.freeze({
  materializeResultTree,
  commitResolver: null,
  treeResolver: null,
  ancestryResolver: null,
  leaseTokenResolver: defaultLeaseTokenResolver,
  refUpdater: defaultRefUpdater,
  hookLivenessCheck: verifyActiveHookInstalled,
  checkLibSrcRoot: null,
});

function fencedRefUpdate(newHead, targetRef, opts = {}) {
  return fencedRefUpdateInternal(newHead, targetRef, sanitizeTransportOpts(opts), REAL_TRANSPORT_SEAMS, {});
}

function fencedRefUpdateForTest(newHead, targetRef, opts = {}, seams = {}, binding = {}) {
  return fencedRefUpdateInternal(
    newHead,
    targetRef,
    sanitizeTransportOpts(opts),
    { ...REAL_TRANSPORT_SEAMS, ...(seams && typeof seams === "object" ? seams : {}) },
    binding && typeof binding === "object" ? binding : {},
  );
}

function fencedRefUpdateInternal(newHead, targetRef, o = {}, seams = REAL_TRANSPORT_SEAMS, binding = {}) {
  const gitRoot = o.gitRoot || PROJECT_ROOT;
  const resolveCommit = typeof seams.commitResolver === "function" ? seams.commitResolver : acceptanceRecord.resolveCommitSha;
  const isAncestor = typeof seams.ancestryResolver === "function" ? seams.ancestryResolver : acceptanceRecord.defaultIsAncestor;
  const transport = typeof binding.transport === "string" && binding.transport ? binding.transport : "fenced-ref-update";

  if (typeof targetRef !== "string" || !targetRef) return { ok: false, decision: "BLOCKED", reason: "invalid-target-ref" };

  const head = resolveCommit(typeof newHead === "string" ? newHead : "", { gitRoot });
  if (!head) return { ok: false, decision: "BLOCKED", reason: "new-head-unresolvable" };
  if (!isCommitObject(head, gitRoot)) return { ok: false, decision: "BLOCKED", reason: "new-head-not-a-commit" };

  const expectedHead = resolveCommit(targetRef, { gitRoot });
  if (!expectedHead) return { ok: false, decision: "BLOCKED", reason: "live-head-unresolvable" };
  if (expectedHead === head) return { ok: false, decision: "BLOCKED", reason: "new-head-equals-live-head" };

  if (typeof binding.verifyAgainstHead === "function") {
    let verdict;
    try {
      verdict = binding.verifyAgainstHead(expectedHead);
    } catch (e) {
      return { ok: false, decision: "BLOCKED", reason: "head-binding-error", detail: e.message };
    }
    if (!verdict || verdict.ok !== true) {
      return { ok: false, decision: "BLOCKED", reason: (verdict && verdict.reason) || "head-binding-refused", detail: verdict && verdict.detail };
    }
  }

  if (isAncestor(expectedHead, head, { gitRoot }) !== true) {
    return { ok: false, decision: "BLOCKED", reason: "new-head-not-descendant-of-live-head" };
  }

  let bundleManifest;
  try {
    bundleManifest = pcb.loadBundleManifest(o.bundleManifestPath);
  } catch (e) {
    return { ok: false, decision: "BLOCKED", reason: e.code || "bundle-load-failed", detail: e.message };
  }

  const materializeFn = typeof seams.materializeResultTree === "function" ? seams.materializeResultTree : materializeResultTree;
  let materialized;
  try {
    materialized = materializeFn(head, { gitRoot, treeResolver: seams.treeResolver, materializedTreeResolver: seams.materializedTreeResolver });
  } catch (e) {
    return { ok: false, decision: "BLOCKED", reason: e.code || "result-tree-materialize-failed", detail: e.message };
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  let pinnedIndex, pinnedResult, suiteOutcome;
  try {
    try {
      pinnedIndex = loadPinnedCheckLib(bundleManifest, {
        bundleRoot: o.bundleRoot,
        candidateRoot: materialized.dir,
        checkLibSrcRoot: seams.checkLibSrcRoot || undefined,
      });
    } catch (e) {
      return { ok: false, decision: "BLOCKED", reason: e.code || "bundle-load-failed", detail: e.message };
    }

    pinnedResult = pcb.runPinnedSuite(
      bundleManifest,
      { root: materialized.dir },
      { bundleRoot: o.bundleRoot, candidateRoot: materialized.dir, nonce },
    );

    const postVerify = typeof seams.materializedTreeResolver === "function" ? seams.materializedTreeResolver : acceptanceRecord.resolveTreeHash;
    const postTree = postVerify("HEAD", { gitRoot: materialized.dir });
    if (!postTree || String(postTree).toLowerCase() !== String(materialized.treeHash).toLowerCase()) {
      return { ok: false, decision: "BLOCKED", reason: "result-tree-mutated-mid-run" };
    }
    if (!pinnedResult.ok) {
      return { ok: false, decision: "BLOCKED", reason: pinnedResult.reason || "pinned-suite-failed" };
    }
    suiteOutcome = reconcileTransportSuite(pinnedIndex.CHECK_NAMES.slice(), pinnedResult.results, nonce);
  } finally {
    materialized.cleanup();
  }
  if (!suiteOutcome.ok) {
    return { ok: false, decision: "BLOCKED", reason: suiteOutcome.reason, offending: suiteOutcome.offending };
  }

  const resolveLeaseToken = typeof seams.leaseTokenResolver === "function" ? seams.leaseTokenResolver : defaultLeaseTokenResolver;
  let leaseToken = null;
  try {
    leaseToken = resolveLeaseToken(o.spId, o.leaseRoot);
  } catch {
    leaseToken = null;
  }
  if (leaseToken == null || leaseToken === "") {
    return { ok: false, decision: "BLOCKED", reason: "lease-not-held" };
  }

  const updater = typeof seams.refUpdater === "function" ? seams.refUpdater : defaultRefUpdater;
  const updated = withControllerFence(o.spId, leaseToken, o.leaseRoot, () => updater(targetRef, head, expectedHead, gitRoot));
  if (!updated || updated.ok !== true) {
    return { ok: false, decision: "BLOCKED", reason: (updated && updated.reason) || "ref-update-refused", detail: updated && updated.detail };
  }

  let hookActive = null;
  try {
    const hookCheckFn = typeof seams.hookLivenessCheck === "function" ? seams.hookLivenessCheck : verifyActiveHookInstalled;
    hookActive = hookCheckFn({ gitRoot }).ok === true;
  } catch {
    hookActive = null;
  }

  return {
    ok: true,
    decision: "LANDED",
    receipt: {
      transport,
      target_ref: targetRef,
      previous_head: expectedHead,
      committed_head: head,
      committed_at: Date.now(),
      suite_version: pinnedIndex.SUITE_VERSION,
      bundle_digest: bundleManifest.bundle_digest,
      run_nonce: nonce,
      provenance: binding.provenance && typeof binding.provenance === "object" ? binding.provenance : {},
      hook_active: hookActive,
    },
  };
}

function integrateBranchMerge(input = {}, opts = {}) {
  return integrateBranchMergeInternal(input, sanitizeTransportOpts(opts), REAL_TRANSPORT_SEAMS);
}

function integrateBranchMergeForTest(input = {}, opts = {}, seams = {}) {
  return integrateBranchMergeInternal(input, sanitizeTransportOpts(opts), { ...REAL_TRANSPORT_SEAMS, ...(seams && typeof seams === "object" ? seams : {}) });
}

function integrateBranchMergeInternal(input = {}, o = {}, seams = REAL_TRANSPORT_SEAMS) {
  const gitRoot = o.gitRoot || PROJECT_ROOT;
  const resolveCommit = typeof seams.commitResolver === "function" ? seams.commitResolver : acceptanceRecord.resolveCommitSha;
  const targetRef = typeof input.target_ref === "string" && input.target_ref ? input.target_ref : null;
  if (!targetRef) return { ok: false, decision: "BLOCKED", reason: "invalid-target-ref" };

  const mergeCommit = resolveCommit(typeof input.merge_commit === "string" ? input.merge_commit : "", { gitRoot });
  if (!mergeCommit || !isCommitObject(mergeCommit, gitRoot)) return { ok: false, decision: "BLOCKED", reason: "merge-commit-unresolvable" };

  const parents = resolveCommitParents(mergeCommit, gitRoot);
  if (!parents) return { ok: false, decision: "BLOCKED", reason: "merge-parents-unresolvable" };
  if (parents.length !== 2) return { ok: false, decision: "BLOCKED", reason: "merge-commit-not-a-two-parent-merge" };

  return fencedRefUpdateInternal(mergeCommit, targetRef, o, seams, {
    transport: "branch-merge",
    verifyAgainstHead: (expectedHead) =>
      parents[0] === String(expectedHead).toLowerCase()
        ? { ok: true }
        : { ok: false, reason: "merge-first-parent-not-live-head", detail: `first parent ${parents[0]} !== live head ${expectedHead}` },
    provenance: { merge_parents: parents.slice(), source_branch_tip: parents[1] },
  });
}

function integrateReleaseCommit(input = {}, opts = {}) {
  return integrateReleaseCommitInternal(input, sanitizeTransportOpts(opts), REAL_TRANSPORT_SEAMS);
}

function integrateReleaseCommitForTest(input = {}, opts = {}, seams = {}) {
  return integrateReleaseCommitInternal(input, sanitizeTransportOpts(opts), { ...REAL_TRANSPORT_SEAMS, ...(seams && typeof seams === "object" ? seams : {}) });
}

function integrateReleaseCommitInternal(input = {}, o = {}, seams = REAL_TRANSPORT_SEAMS) {
  const gitRoot = o.gitRoot || PROJECT_ROOT;
  const resolveCommit = typeof seams.commitResolver === "function" ? seams.commitResolver : acceptanceRecord.resolveCommitSha;
  const targetRef = typeof input.target_ref === "string" && input.target_ref ? input.target_ref : null;
  if (!targetRef) return { ok: false, decision: "BLOCKED", reason: "invalid-target-ref" };

  const releaseCommit = resolveCommit(typeof input.release_commit === "string" ? input.release_commit : "", { gitRoot });
  if (!releaseCommit || !isCommitObject(releaseCommit, gitRoot)) return { ok: false, decision: "BLOCKED", reason: "release-commit-unresolvable" };

  const parents = resolveCommitParents(releaseCommit, gitRoot);
  if (!parents) return { ok: false, decision: "BLOCKED", reason: "release-parents-unresolvable" };
  if (parents.length !== 1) return { ok: false, decision: "BLOCKED", reason: "release-commit-not-single-parent" };

  return fencedRefUpdateInternal(releaseCommit, targetRef, o, seams, {
    transport: "release-commit",
    verifyAgainstHead: (expectedHead) =>
      parents[0] === String(expectedHead).toLowerCase()
        ? { ok: true }
        : { ok: false, reason: "release-parent-not-live-head", detail: `parent ${parents[0]} !== live head ${expectedHead}` },
    provenance: { parent: parents[0] },
  });
}

module.exports = {
  integrate,
  integrateForTest,
  fencedRefUpdate,
  fencedRefUpdateForTest,
  integrateBranchMerge,
  integrateBranchMergeForTest,
  integrateReleaseCommit,
  integrateReleaseCommitForTest,
  reconcileTransportSuite,
  resolveCommitParents,
  sanitizeTransportOpts,
  defaultRefUpdater,
  TRANSPORT_OPT_KEYS,
  TRANSPORT_SKIP_ALLOWED,
  PRODUCTION_OPT_KEYS,
  sanitizeOpts,
  extractPinnedHookInvocation,
  assertAcceptanceRecordContract,
  mintRunManifest,
  reconcileRunManifest,
  recomputeBoundDigests,
  loadPinnedCheckLib,
  withControllerFence,
  defaultLeaseTokenResolver,
  materializeResultTree,
  verifyActiveHookInstalled,
  REQUIRED_ACCEPTANCE_EXPORTS,
};
