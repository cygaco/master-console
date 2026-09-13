"use strict";
/**
 * FALSIFIER: fence-token-forged-stale-injected — RECORD-TRUST TEETH (SP-20260721-001 D-4 INC-1, SEC-1).
 *
 * THE ATTACK, in three shapes — all the same lie: "I hold the conductor lease."
 *   (a) FORGED   — a non-holder invents a token and passes it, holding no lease at all.
 *   (b) STALE    — a token that WAS valid for a previous hold, replayed after that hold ended and a new
 *                  hold minted a different token (the superseded-lease / fencing-token replay).
 *   (c) INJECTED — a real lease IS held, but the caller passes a DIFFERENT token, hoping the transport
 *                  prefers the value it was handed over the value in the lease store.
 *
 * MUST HOLD (record-trust): the fence token is read ONLY from the lease store, FRESH, via
 * `defaultLeaseTokenResolver` — the CURRENT holder's token. A caller-asserted token is never read and
 * cannot even arrive (`leaseToken` is absent from the frozen `TRANSPORT_OPT_KEYS`). With no lease held,
 * the transport fails closed with `lease-not-held` and the ref never moves.
 *
 * WHY WE READ THE FENCE ENV, NOT THE RECEIPT: the fence is exactly the three scoped env vars
 * `protected-ref-transaction.js` reads to authorize a protected-ref write. Asserting on a receipt would
 * only prove what the transport SAYS. We assert on `MC_CONTROLLER_FENCE_TOKEN` as observed from
 * INSIDE the CAS — the actual value the hook would authorize against.
 */
const test = require("node:test");
const assert = require("node:assert");

const ctl = require("../trusted-controller");
const lease = require("../conductor-lease");
const reftxn = require("../../hooks/protected-ref-transaction");
const { makeTransportFixture } = require("./_lib/transport-fixtures");

const FORGED = "forged-token-not-from-the-lease-store";

// ── (c) INJECTED — a real lease is held; the caller's different token must be ignored ───────────────────

test("MUST-BLOCK (injected) — a caller-supplied leaseToken is IGNORED; the fence carries the CURRENT holder's token", (t) => {
  const fx = makeTransportFixture("token-injected");
  t.after(() => fx.cleanup());

  const merge = fx.commitTree("candidate", [fx.c1, fx.candidate], "merge candidate into main");
  let observedFenceToken = null;

  const res = ctl.integrateBranchMergeForTest(
    { merge_commit: merge, target_ref: fx.targetRef, leaseToken: FORGED },
    fx.opts({ leaseToken: FORGED }),
    {
      // Observe the fence from INSIDE the fenced region — this is what the hook would authorize against.
      refUpdater: () => {
        observedFenceToken = process.env[reftxn.FENCE_TOKEN_ENV];
        return { ok: true };
      },
    },
  );

  assert.strictEqual(res.ok, true, `the injected token must be IGNORED, not fatal — got ${res.decision}/${res.reason}`);
  // The fencing token is a monotonic number; the env carries its string form.
  assert.strictEqual(observedFenceToken, String(fx.leaseToken), "MUST: the fence carries the token read FRESH from the lease store");
  assert.notStrictEqual(observedFenceToken, FORGED, "MUST-BLOCK: a caller-injected token must NEVER reach the fence");
});

test("MUST-BLOCK (injected, structural) — `leaseToken` is UNPASSABLE through opts", () => {
  const clean = ctl.sanitizeTransportOpts({ bundleManifestPath: "m", bundleRoot: "b", gitRoot: "g", spId: "s", leaseRoot: "l", leaseToken: FORGED });
  assert.ok(!("leaseToken" in clean), "MUST-BLOCK: leaseToken must not survive sanitizeTransportOpts");
  assert.ok(!ctl.TRANSPORT_OPT_KEYS.includes("leaseToken"), "TRANSPORT_OPT_KEYS must not admit leaseToken — unpassable, not merely unread");
});

// ── (a) FORGED — no lease held at all ───────────────────────────────────────────────────────────────────

test("MUST-BLOCK (forged) — a non-holder forging a token is REFUSED with lease-not-held; the ref never moves", (t) => {
  const fx = makeTransportFixture("token-forged", { acquireLease: false });
  t.after(() => fx.cleanup());

  const merge = fx.commitTree("candidate", [fx.c1, fx.candidate], "merge candidate into main");
  const before = fx.head("refs/heads/main");
  let casInvoked = false;

  const res = ctl.integrateBranchMergeForTest({ merge_commit: merge, target_ref: fx.targetRef, leaseToken: FORGED }, fx.opts({ leaseToken: FORGED }), {
    refUpdater: () => {
      casInvoked = true;
      return { ok: true };
    },
  });

  assert.strictEqual(res.ok, false, "MUST-BLOCK: no lease held means no land, whatever token was forged");
  assert.strictEqual(res.decision, "BLOCKED");
  assert.strictEqual(res.reason, "lease-not-held", "refused for the RIGHT, machine-checkable reason");
  assert.strictEqual(casInvoked, false, "MUST-BLOCK: the CAS must never even be reached without a real lease");
  assert.strictEqual(fx.head("refs/heads/main"), before, "MUST-BLOCK: refs/heads/main must be UNCHANGED");
});

// ── (b) STALE — a superseded fencing token, replayed ────────────────────────────────────────────────────

test("MUST-BLOCK (stale) — a SUPERSEDED lease token is not replayable: the fence carries the NEW holder's token", (t) => {
  const fx = makeTransportFixture("token-stale");
  t.after(() => fx.cleanup());

  const staleToken = fx.leaseToken;
  // End the first hold and start a new one — a new hold mints a NEW fencing token.
  const rel = lease.release(fx.spId, { root: fx.leaseRoot, token: staleToken });
  assert.strictEqual(rel.ok, true, "precondition: the first hold is released");
  const fresh = lease.acquire(fx.spId, { root: fx.leaseRoot, sessionId: "successor" });
  assert.ok(fresh.token && fresh.token !== staleToken, "precondition: the new hold minted a DIFFERENT token");

  const merge = fx.commitTree("candidate", [fx.c1, fx.candidate], "merge candidate into main");
  let observedFenceToken = null;

  const res = ctl.integrateBranchMergeForTest({ merge_commit: merge, target_ref: fx.targetRef, leaseToken: staleToken }, fx.opts({ leaseToken: staleToken }), {
    refUpdater: () => {
      observedFenceToken = process.env[reftxn.FENCE_TOKEN_ENV];
      return { ok: true };
    },
  });

  assert.strictEqual(res.ok, true, `the stale token must be ignored in favour of a fresh resolve — got ${res.reason}`);
  assert.strictEqual(observedFenceToken, String(fresh.token), "MUST: the fence carries the CURRENT holder's token, resolved fresh");
  assert.notStrictEqual(observedFenceToken, String(staleToken), "MUST-BLOCK: a superseded token must never be replayed into the fence");
});

// ── The fence is scoped, and does not leak ──────────────────────────────────────────────────────────────

test("the fence env is SCOPED — set only around the CAS and restored afterwards (no ambient authorization)", (t) => {
  const fx = makeTransportFixture("token-scope");
  t.after(() => fx.cleanup());

  const before = process.env[reftxn.FENCE_TOKEN_ENV];
  let insideFence = null;

  const merge = fx.commitTree("candidate", [fx.c1, fx.candidate], "merge candidate into main");
  const res = ctl.integrateBranchMergeForTest({ merge_commit: merge, target_ref: fx.targetRef }, fx.opts(), {
    refUpdater: () => {
      insideFence = process.env[reftxn.FENCE_TOKEN_ENV];
      return { ok: true };
    },
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(insideFence, String(fx.leaseToken), "the fence IS raised around the CAS");
  assert.strictEqual(
    process.env[reftxn.FENCE_TOKEN_ENV],
    before,
    "MUST: the prior env is restored after the fenced region — an un-restored fence would leave every later write ambiently authorized",
  );
});
