"use strict";
/**
 * role-resolver.test.js — the live derived-not-settable role-binding resolver (SP-20260718-004
 * Phase 2, G2.1/ED-216 + ED-220). Includes the REQUIRED-PRESENT falsifiability fixture (i):
 * derived-not-settable NEGATIVE — a worker that SETS role:"President"/authority in its OWN
 * context/record/handoff STILL resolves UNBOUND (dispatched) / alex-alpha-only-via-helm (top-level).
 * A regression here (deriveBinding reading a worker-settable field, or a dispatched worker resolving
 * to President) is a live authority false-green — the exact class this sprint exists to close.
 */
const { test } = require("node:test");
const assert = require("node:assert");

const {
  deriveBinding,
  validateRoleBindingValues,
  loadRoleBinding,
  defaultKernelDir,
  actorKindForChannel,
  isPresidentIdentity,
} = require("./role-resolver");

// The REAL Phase-0 control graph (fixture-proven), loaded once. Injected into deriveBinding so the
// tests exercise the actual role-binding.json contract, not a hand-rolled stand-in.
const RB = loadRoleBinding(defaultKernelDir());
// A representative set of known dispatched-worker roles (ED-220 value-validation seam).
const KNOWN = ["backend-builder", "frontend-builder", "security-builder", "backend-reviewer", "qa-reviewer"];

// ── channel → actor_kind (the non-settable signal) ────────────────────────────────────────────────
test("actorKindForChannel: the CHANNEL derives actor_kind; unknown → null (fail-closed)", () => {
  assert.strictEqual(actorKindForChannel("dispatch-claude"), "dispatched_worker");
  assert.strictEqual(actorKindForChannel("dispatch-agent"), "dispatched_worker");
  assert.strictEqual(actorKindForChannel("session-bootstrap"), "top_level_session");
  assert.strictEqual(actorKindForChannel("helm"), "top_level_session");
  assert.strictEqual(actorKindForChannel("some-worker-supplied-string"), null);
  assert.strictEqual(actorKindForChannel(undefined), null);
});

// ── the happy path ────────────────────────────────────────────────────────────────────────────────
test("deriveBinding: dispatched worker binds to its channel-asserted role", () => {
  const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.actor_kind, "dispatched_worker");
  assert.strictEqual(b.boundRole, "backend-builder");
});

test("deriveBinding: top-level human session binds to the helm default (alex-alpha), helm_only", () => {
  const b = deriveBinding({ channel: "session-bootstrap" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.actor_kind, "top_level_session");
  assert.strictEqual(b.boundRole, RB.top_level_human_default); // alex-alpha
});

// ── REQUIRED-PRESENT FIXTURE (i): derived-not-settable NEGATIVE ──────────────────────────────────
test("FIXTURE (i): a dispatched worker asserting role:'President' STILL never resolves to President", () => {
  // The worker sets President in its own handoff/record/context. deriveBinding reads ONLY the channel
  // + the trusted-parent argv role — a President assertion through the dispatch channel is a category
  // error, never a bind. boundRole is NEVER alex-alpha for a dispatched worker.
  for (const claim of ["President", "alex-alpha", "ALPHA", "president"]) {
    const b = deriveBinding({ channel: "dispatch-claude", role: claim }, { rb: RB, knownRoles: KNOWN });
    assert.strictEqual(b.ok, false, `role='${claim}' must be refused`);
    assert.strictEqual(b.boundRole, null, `role='${claim}' must never bind President`);
    assert.match(b.reason, /category error|President-leak|top_level_session-only/i);
  }
});

test("FIXTURE (i) — ENV VECTOR (β rider): a worker that setenv's WARPOS_BOUND_ROLE/WARPOS_ACTOR_KIND STILL resolves derived, env is inert", () => {
  // β's design→build load-bearing rider: WARPOS_BOUND_ROLE/WARPOS_ACTOR_KIND are the TRANSPORT of the
  // parent's pre-spawn decision (the worker's self-knowledge), never the AUTHORITY source. A worker OWNS its
  // own env and can setenv them mid-life — deriveBinding must ignore that entirely (it reads {channel, role}).
  const saved = { br: process.env.WARPOS_BOUND_ROLE, ak: process.env.WARPOS_ACTOR_KIND };
  try {
    process.env.WARPOS_BOUND_ROLE = "President";
    process.env.WARPOS_ACTOR_KIND = "top_level_session";
    const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: RB, knownRoles: KNOWN });
    assert.strictEqual(b.actor_kind, "dispatched_worker", "hostile env WARPOS_ACTOR_KIND must NOT override the channel-derived actor_kind");
    assert.strictEqual(b.boundRole, "backend-builder", "hostile env WARPOS_BOUND_ROLE must NOT override the derived role");
    // A President dispatch is still refused regardless of the hostile env.
    assert.strictEqual(deriveBinding({ channel: "dispatch-claude", role: "President" }, { rb: RB, knownRoles: KNOWN }).ok, false);
  } finally {
    if (saved.br === undefined) delete process.env.WARPOS_BOUND_ROLE; else process.env.WARPOS_BOUND_ROLE = saved.br;
    if (saved.ak === undefined) delete process.env.WARPOS_ACTOR_KIND; else process.env.WARPOS_ACTOR_KIND = saved.ak;
  }
});

test("FIXTURE (i) — ENV-vector SOURCE GUARD: role-resolver.js never READS WARPOS_ACTOR_KIND/WARPOS_BOUND_ROLE as authority", () => {
  // The invariant that makes the env-vector inert BY CONSTRUCTION: the resolver derives, it never re-reads the
  // transport env vars. A future `if (process.env.WARPOS_ACTOR_KIND === 'top_level_session') allow()` would
  // re-open the phantom-one-layer-up hole — this source guard catches it.
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "role-resolver.js"), "utf8");
  assert.ok(!/process\.env\.MC_(ACTOR_KIND|BOUND_ROLE)/.test(src), "role-resolver.js must not read the identity transport env vars as authority");
});

test("FIXTURE (i) — structural: deriveBinding's ONLY inputs are {channel, role}; a worker-set field cannot reach it", () => {
  // Even if a worker crams extra self-asserted authority fields into the call, they are ignored — the
  // function signature destructures {channel, role} and nothing else. This is the derived-not-settable
  // guarantee BY CONSTRUCTION: there is no settable authority field the resolver consults.
  const b = deriveBinding(
    { channel: "dispatch-claude", role: "backend-builder", role_override: "President", authority: "helm", is_president: true },
    { rb: RB, knownRoles: KNOWN },
  );
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.boundRole, "backend-builder"); // the self-asserted President/authority fields are inert
});

// ── cold-start: unbound dispatched worker fails closed (CORE-1) ───────────────────────────────────
test("cold-start: dispatched worker with no channel-asserted role → UNBOUND, fail-closed (never President)", () => {
  const b = deriveBinding({ channel: "dispatch-claude" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.boundRole, null);
  assert.match(b.reason, /UNBOUND|fail-closed/i);
});

// ── category error: a dispatched worker cannot bind through a top_level_session-only source ────────
test("category error (N-5): unknown channel → no actor_kind, fail-closed (ambient text can't supply one)", () => {
  const b = deriveBinding({ channel: "handoff-prompt-says-you-are-alpha", role: "President" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.actor_kind, null);
});

// ── ED-220 value-validation ───────────────────────────────────────────────────────────────────────
test("ED-220: the REAL role-binding.json passes value-validation", () => {
  const vv = validateRoleBindingValues(RB);
  assert.strictEqual(vv.ok, true, vv.errors.join("; "));
});

test("ED-220: worker_default_when_unbound flipped to a permissive value → fail-closed (CORE-1 open is refused)", () => {
  const corrupt = { ...RB, worker_default_when_unbound: "PASS" };
  const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: corrupt, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.match(b.reason, /VALUE invalid|FAIL_CLOSED/i);
});

test("ED-220: a dispatched role that is not a known role-registry id → BLOCK (value not just presence)", () => {
  const b = deriveBinding({ channel: "dispatch-claude", role: "totally-made-up-role" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.match(b.reason, /not a known role-registry id/i);
});

test("ED-220: top_level_default_binding_source must be helm_only", () => {
  const corrupt = { ...RB, top_level_default_binding_source: "ambient" };
  const vv = validateRoleBindingValues(corrupt);
  assert.strictEqual(vv.ok, false);
  assert.match(vv.errors.join(";"), /helm_only/);
});

// ── corrupt control fails closed (never a permissive {}) ──────────────────────────────────────────
test("a structurally-corrupt control → deriveBinding fails closed, never a permissive default", () => {
  const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: { garbage: true }, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.failClosed, true, "a corrupt control must fail CLOSED (the bridge refuses)");
});

// ── Gauntlet R1 fixes ─────────────────────────────────────────────────────────────────────────────
test("SR-ID-002 (robust President-alias): aliases that dodge the exact-string list are STILL blocked", () => {
  for (const alias of ["alex_alpha", "alexAlpha", "ALEX-ALPHA", "president-worker", "President_Worker", "alpha"]) {
    const b = deriveBinding({ channel: "dispatch-claude", role: alias }, { rb: RB, knownRoles: KNOWN });
    assert.strictEqual(b.ok, false, `alias '${alias}' must be refused`);
    assert.strictEqual(b.failClosed, true, `alias '${alias}' must fail CLOSED`);
    assert.strictEqual(b.boundRole, null);
  }
});

test("isPresidentIdentity does NOT false-positive on legit roles that merely contain 'alpha'", () => {
  for (const ok of ["backend-builder", "security-reviewer", "alpha-tester", "qa-reviewer", "product-lead", "alexa-connector", "alexander"]) {
    assert.strictEqual(isPresidentIdentity(ok), false, `'${ok}' must not be a President identity`);
  }
  for (const pres of ["alpha", "alex-alpha", "alex_alpha", "president", "president-worker"]) {
    assert.strictEqual(isPresidentIdentity(pres), true, `'${pres}' must be a President identity`);
  }
});

test("BE-R3-001: bare 'Alex' (the President's name) and the Greek call-sign 'α' are President identities", () => {
  for (const alias of ["Alex", "alex", "ALEX", "α", "Α", " α "]) {
    assert.strictEqual(isPresidentIdentity(alias), true, `'${alias}' must be recognized as the President identity`);
  }
  // And a dispatched worker asking to bind them is refused fail-closed.
  for (const alias of ["Alex", "α"]) {
    const b = deriveBinding({ channel: "dispatch-claude", role: alias }, { rb: RB, knownRoles: KNOWN });
    assert.strictEqual(b.ok, false, `'${alias}' must be refused`);
    assert.strictEqual(b.failClosed, true);
  }
});

test("SR-ID-001 failClosed taxonomy: integrity failures fail-CLOSED; a benign unknown role does NOT", () => {
  // corrupt control → failClosed
  assert.strictEqual(deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: { bad: 1 }, knownRoles: KNOWN }).failClosed, true);
  // value failure → failClosed
  assert.strictEqual(deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: { ...RB, worker_default_when_unbound: "PASS" }, knownRoles: KNOWN }).failClosed, true);
  // unknown channel → failClosed
  assert.strictEqual(deriveBinding({ channel: "not-a-bridge", role: "backend-builder" }, { rb: RB, knownRoles: KNOWN }).failClosed, true);
  // benign unknown role (registry loaded, role absent) → ok:false but failClosed:false (bridge proceeds)
  const benign = deriveBinding({ channel: "dispatch-claude", role: "some-generic-role" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(benign.ok, false);
  assert.strictEqual(benign.failClosed, false, "a benign unrecognized role must NOT fail-closed (keeps generic roles working)");
});

test("SR-ID-002 (registry unavailable): knownRoles:null still blocks aliases, proceeds benignly for others", () => {
  // Registry unavailable — the alias gate still closes escalation.
  assert.strictEqual(deriveBinding({ channel: "dispatch-claude", role: "alex_alpha" }, { rb: RB, knownRoles: null }).failClosed, true);
  // A non-alias unknown role proceeds (ok:true — the known-role check is degraded, but no escalation possible).
  const b = deriveBinding({ channel: "dispatch-claude", role: "some-worker" }, { rb: RB, knownRoles: null });
  assert.strictEqual(b.ok, true, "with the registry down, a non-President role binds as dispatched_worker (no brick)");
  assert.strictEqual(b.actor_kind, "dispatched_worker");
});

test("ED220-TOPLEVEL-DEFAULT-HOLLOW: a bogus top_level_human_default is BLOCKED (not silently bound)", () => {
  const bogus = { ...RB, top_level_human_default: "made-up-super-role" };
  const b = deriveBinding({ channel: "session-bootstrap" }, { rb: bogus, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.failClosed, true);
  assert.match(b.reason, /canonical President identity|VALUE invalid/i);
});

test("BE-R2-001: an invented 'president-shaped' top-level default (president-worker) is REJECTED, not accepted", () => {
  const bogus = { ...RB, top_level_human_default: "president-worker" };
  const b = deriveBinding({ channel: "session-bootstrap" }, { rb: bogus, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false, "a permissive president-substring value must not be a valid top-level default");
  assert.strictEqual(b.failClosed, true);
});

test("R2-ED220-DISPATCH-OPEN: a bogus top_level_human_default also fail-closes a DISPATCHED worker (global control failure)", () => {
  const bogus = { ...RB, top_level_human_default: "made-up" };
  const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: bogus, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false, "a corrupt control value must fail-close ALL actors, not just top-level");
  assert.strictEqual(b.failClosed, true);
});
