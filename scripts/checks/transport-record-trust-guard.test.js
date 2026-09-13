"use strict";
/**
 * transport-record-trust-guard.test.js — BITE TEST (SP-20260721-001 D-4 INC-1, unit SEC-1).
 *
 * A structural guard that cannot be shown to FAIL on a real regression is decoration. Each test below
 * plants the specific regression the guard exists to catch — into a COPY of the real controller source —
 * and asserts the guard REDs on it, with the LIVE source asserted green as the control.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const guard = require("./transport-record-trust-guard.js");
const { check, CONTROLLER_REL, SKIP_ALLOWLIST_REL } = guard;

const REPO = path.resolve(__dirname, "..", "..");
const REAL_SRC = path.join(REPO, CONTROLLER_REL);
/** The skip allowance was RE-HOUSED here by e5cd99b6 (2026-07-23); G3 mutations target THIS file now. */
const REAL_ALLOWLIST = path.join(REPO, SKIP_ALLOWLIST_REL);

/**
 * Copy the real controller AND its skip-allowance housing into a scratch root, apply `mutate` to the text
 * of `target` (default: the controller), and run the guard there. A mutation that does not change the
 * text is a test that proves nothing, so it is asserted to have applied. `omit` drops a file from the
 * scratch root entirely (for the dangling-require bite).
 */
function checkMutated(mutate, { target = CONTROLLER_REL, omit = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trtg-"));
  for (const [rel, real] of [[CONTROLLER_REL, REAL_SRC], [SKIP_ALLOWLIST_REL, REAL_ALLOWLIST]]) {
    if (rel === omit) continue;
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const original = fs.readFileSync(real, "utf8");
    if (rel === target) {
      const mutated = mutate(original);
      assert.notStrictEqual(mutated, original, `the mutation of ${rel} must actually apply (else the test proves nothing)`);
      fs.writeFileSync(dest, mutated);
    } else {
      fs.writeFileSync(dest, original);
    }
  }
  try {
    return check(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const ALLOWLIST = { target: SKIP_ALLOWLIST_REL };
const has = (res, needle) => res.violations.some((v) => v.includes(needle));

// ── CONTROL — the live source must be green (else every RED below is meaningless) ───────────────────────

test("CONTROL — the LIVE controller satisfies every record-trust invariant", () => {
  const res = check();
  assert.strictEqual(res.ok, true, `the live controller must be green: ${res.violations.join(" | ")}`);
  assert.deepStrictEqual(
    res.observed.fence_call_sites.map((c) => c.in),
    ["integrateInternal", "fencedRefUpdateInternal"],
    "the 2 sanctioned fence sites are the unit path and the transport path",
  );
  assert.deepStrictEqual(res.observed.transport_skip_allowed, { "false-green-envelope": "no-envelope-in-context" });
  assert.strictEqual(res.observed.transport_skip_allowed_source, SKIP_ALLOWLIST_REL, "the allowance is read from its ONE pinned housing, not guessed");
});

// ── G2 — the fence-site count is the one that would let an unreviewed write in ──────────────────────────

test("G2 — a THIRD withControllerFence call site REDs", () => {
  const res = checkMutated((s) =>
    s.replace(
      "function integrateBranchMergeInternal(input = {}, o = {}, seams = REAL_TRANSPORT_SEAMS) {",
      "function integrateBranchMergeInternal(input = {}, o = {}, seams = REAL_TRANSPORT_SEAMS) {\n  withControllerFence(o.spId, o.leaseToken, o.leaseRoot, () => sneakyWrite());",
    ),
  );
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "G2: expected EXACTLY 2 withControllerFence call site"), `expected a fence-count violation, got: ${res.violations.join(" | ")}`);
});

test("G2 — a fence env var set OUTSIDE withControllerFence REDs", () => {
  const res = checkMutated((s) =>
    s.replace("function defaultRefUpdater(targetRef, newHead, expectedHead, gitRoot) {", 'function defaultRefUpdater(targetRef, newHead, expectedHead, gitRoot) {\n  process.env[reftxn.FENCE_TOKEN_ENV] = "ambient";'),
  );
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "OUTSIDE withControllerFence"), `expected an env-scope violation, got: ${res.violations.join(" | ")}`);
});

test("G2 — removing the finally-restore REDs (a leaked fence authorizes later writes ambiently)", () => {
  const res = checkMutated((s) => {
    const start = s.indexOf("function withControllerFence");
    const end = s.indexOf("\nfunction ", start + 1);
    const body = s.slice(start, end);
    return s.slice(0, start) + body.replace(/\} finally \{[\s\S]*?\n  \}/, "}") + s.slice(end);
  });
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "does not restore the prior env"), `expected a finally-restore violation, got: ${res.violations.join(" | ")}`);
});

// ── G1 — the caller-asserted-token / caller-asserted-anchor holes ───────────────────────────────────────

test("G1 — admitting `leaseToken` into TRANSPORT_OPT_KEYS REDs", () => {
  const res = checkMutated((s) =>
    s.replace(
      'const TRANSPORT_OPT_KEYS = Object.freeze(["bundleManifestPath"',
      'const TRANSPORT_OPT_KEYS = Object.freeze(["leaseToken", "bundleManifestPath"',
    ),
  );
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "admits `leaseToken`"), `expected a forbidden-opt-key violation, got: ${res.violations.join(" | ")}`);
});

test("G1 — admitting `base_commit` (a caller CAS anchor) into TRANSPORT_OPT_KEYS REDs", () => {
  const res = checkMutated((s) =>
    s.replace('const TRANSPORT_OPT_KEYS = Object.freeze(["bundleManifestPath"', 'const TRANSPORT_OPT_KEYS = Object.freeze(["base_commit", "bundleManifestPath"'),
  );
  assert.ok(has(res, "admits `base_commit`"), `expected an anchor-key violation, got: ${res.violations.join(" | ")}`);
});

test("G1 — READING a caller-supplied leaseToken REDs", () => {
  const res = checkMutated((s) => s.replace("leaseToken = resolveLeaseToken(o.spId, o.leaseRoot);", "leaseToken = o.leaseToken || resolveLeaseToken(o.spId, o.leaseRoot);"));
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "caller-supplied leaseToken is READ"), `expected a caller-token-read violation, got: ${res.violations.join(" | ")}`);
});

test("G1 — an entrypoint that stops sanitizing its opts REDs", () => {
  const res = checkMutated((s) => {
    const mutated = s.replace(
      /(function\s+integrateBranchMerge\s*\(input = \{\}, opts = \{\}\)\s*\{\s*return integrateBranchMergeInternal\(input,\s*)sanitizeTransportOpts\(opts\)/,
      "$1opts",
    );
    assert.notStrictEqual(mutated, s, "the mutation must actually apply (else the test proves nothing)");
    return mutated;
  });
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "does not route its opts through sanitizeTransportOpts"), `expected a sanitize violation, got: ${res.violations.join(" | ")}`);
});

// ── G3 — the frozen skip allowance ──────────────────────────────────────────────────────────────────────

test("G3 — WIDENING TRANSPORT_SKIP_ALLOWED with a second skip REDs", () => {
  const res = checkMutated(
    (s) =>
      s.replace(
        'const TRANSPORT_SKIP_ALLOWED = Object.freeze({ "false-green-envelope": "no-envelope-in-context" });',
        'const TRANSPORT_SKIP_ALLOWED = Object.freeze({ "false-green-envelope": "no-envelope-in-context", "no-nul-bytes": "too-slow-in-ci" });',
      ),
    ALLOWLIST,
  );
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "WIDENED"), `expected a widening violation, got: ${res.violations.join(" | ")}`);
});

test("G3 — changing the pinned skip REASON REDs (reason drift is how a pin quietly loosens)", () => {
  const res = checkMutated((s) => s.replace('"false-green-envelope": "no-envelope-in-context"', '"false-green-envelope": "any-reason-at-all"'), ALLOWLIST);
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "reason drift"), `expected a reason-drift violation, got: ${res.violations.join(" | ")}`);
});

test("G3 — UNFREEZING the housed table REDs (a mutable allowance can be widened at runtime)", () => {
  const res = checkMutated((s) => s.replace('Object.freeze({ "false-green-envelope"', '({ "false-green-envelope"'), ALLOWLIST);
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "missing or not Object.freeze"), `expected an unfrozen-table violation, got: ${res.violations.join(" | ")}`);
});

test("G3 — RE-POINTING the controller's require at an unpinned module REDs (a moved allowance is an unreviewed one)", () => {
  const res = checkMutated((s) => s.replace('require("./transport-skip-allowlist")', 'require("./transport-skip-allowlist-v2")'));
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "not the pinned housing"), `expected a re-pointed-housing violation, got: ${res.violations.join(" | ")}`);
});

test("G3 — a DANGLING require (housing file missing) REDs rather than reporting green", () => {
  const res = checkMutated((s) => s + "\n", { omit: SKIP_ALLOWLIST_REL });
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "is MISSING"), `expected a missing-housing violation, got: ${res.violations.join(" | ")}`);
});

test("G3 — the FROZEN allowance is TOLERATED, not flagged (the guard does not over-fire on the honest skip)", () => {
  const res = check();
  assert.ok(!res.violations.some((v) => v.startsWith("G3")), "the pinned, reason-bound skip is legitimate and must not be flagged");
});

test("G3 — tolerating skips by NAME alone (dropping the reason pin) REDs", () => {
  const res = checkMutated((s) =>
    s.replace(
      "if (Object.prototype.hasOwnProperty.call(TRANSPORT_SKIP_ALLOWED, name) && r.reason === TRANSPORT_SKIP_ALLOWED[name]) continue;",
      "if (Object.prototype.hasOwnProperty.call(TRANSPORT_SKIP_ALLOWED, name)) continue;",
    ),
  );
  assert.strictEqual(res.ok, false);
  assert.ok(has(res, "EXACT name+reason pin"), `expected a name+reason-pin violation, got: ${res.violations.join(" | ")}`);
});

// ── FAIL-CLOSED ─────────────────────────────────────────────────────────────────────────────────────────

test("FAIL-CLOSED — a missing controller throws rather than reporting green", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trtg-missing-"));
  assert.throws(() => check(root), /not found/, "a guard that cannot read its subject must never report OK");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a DOC MENTION of withControllerFence is not counted as a call site", () => {
  const res = checkMutated((s) => s.replace("// ── Seam E fence scoping", "// See withControllerFence( for details; withControllerFence( is mentioned twice here.\n// ── Seam E fence scoping"));
  assert.ok(!has(res, "expected EXACTLY 2"), "comments must be stripped before counting call sites");
});
