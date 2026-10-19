"use strict";
const mcEnv = require("../hooks/lib/mc-env");
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

const RB = loadRoleBinding(defaultKernelDir());
const KNOWN = ["backend-builder", "frontend-builder", "security-builder", "backend-reviewer", "qa-reviewer"];

test("actorKindForChannel: the CHANNEL derives actor_kind; unknown → null (fail-closed)", () => {
  assert.strictEqual(actorKindForChannel("dispatch-claude"), "dispatched_worker");
  assert.strictEqual(actorKindForChannel("dispatch-agent"), "dispatched_worker");
  assert.strictEqual(actorKindForChannel("session-bootstrap"), "top_level_session");
  assert.strictEqual(actorKindForChannel("helm"), "top_level_session");
  assert.strictEqual(actorKindForChannel("some-worker-supplied-string"), null);
  assert.strictEqual(actorKindForChannel(undefined), null);
});

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
  assert.strictEqual(b.boundRole, RB.top_level_human_default);
});

test("FIXTURE (i): a dispatched worker asserting role:'President' STILL never resolves to President", () => {
  for (const claim of ["President", "alex-alpha", "ALPHA", "president"]) {
    const b = deriveBinding({ channel: "dispatch-claude", role: claim }, { rb: RB, knownRoles: KNOWN });
    assert.strictEqual(b.ok, false, `role='${claim}' must be refused`);
    assert.strictEqual(b.boundRole, null, `role='${claim}' must never bind President`);
    assert.match(b.reason, /category error|President-leak|top_level_session-only/i);
  }
});

test("FIXTURE (i) — ENV VECTOR: a worker that setenv's MC_BOUND_ROLE/MC_ACTOR_KIND STILL resolves derived, env is inert", () => {
  const saved = { br: mcEnv.readEnv("BOUND_ROLE"), ak: mcEnv.readEnv("ACTOR_KIND") };
  try {
    mcEnv.setEnv("BOUND_ROLE", "President");
    mcEnv.setEnv("ACTOR_KIND", "top_level_session");
    const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: RB, knownRoles: KNOWN });
    assert.strictEqual(b.actor_kind, "dispatched_worker", "hostile env MC_ACTOR_KIND must NOT override the channel-derived actor_kind");
    assert.strictEqual(b.boundRole, "backend-builder", "hostile env MC_BOUND_ROLE must NOT override the derived role");
    assert.strictEqual(deriveBinding({ channel: "dispatch-claude", role: "President" }, { rb: RB, knownRoles: KNOWN }).ok, false);
  } finally {
    if (saved.br === undefined) mcEnv.unsetEnv("BOUND_ROLE"); else mcEnv.setEnv("BOUND_ROLE", saved.br);
    if (saved.ak === undefined) mcEnv.unsetEnv("ACTOR_KIND"); else mcEnv.setEnv("ACTOR_KIND", saved.ak);
  }
});

test("FIXTURE (i) — ENV-vector SOURCE GUARD: role-resolver.js never READS MC_ACTOR_KIND/MC_BOUND_ROLE as authority", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "role-resolver.js"), "utf8");
  assert.ok(!/process\.env\.MC_(ACTOR_KIND|BOUND_ROLE)/.test(src), "role-resolver.js must not read the identity transport env vars as authority");
});

test("FIXTURE (i) — structural: deriveBinding's ONLY inputs are {channel, role}; a worker-set field cannot reach it", () => {
  const b = deriveBinding(
    { channel: "dispatch-claude", role: "backend-builder", role_override: "President", authority: "helm", is_president: true },
    { rb: RB, knownRoles: KNOWN },
  );
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.boundRole, "backend-builder");
});

test("cold-start: dispatched worker with no channel-asserted role → UNBOUND, fail-closed (never President)", () => {
  const b = deriveBinding({ channel: "dispatch-claude" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.boundRole, null);
  assert.match(b.reason, /UNBOUND|fail-closed/i);
});

test("category error: unknown channel → no actor_kind, fail-closed (ambient text can't supply one)", () => {
  const b = deriveBinding({ channel: "handoff-prompt-says-you-are-alpha", role: "President" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.actor_kind, null);
});

test("the REAL role-binding.json passes value-validation", () => {
  const vv = validateRoleBindingValues(RB);
  assert.strictEqual(vv.ok, true, vv.errors.join("; "));
});

test("worker_default_when_unbound flipped to a permissive value → fail-closed (CORE-1 open is refused)", () => {
  const corrupt = { ...RB, worker_default_when_unbound: "PASS" };
  const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: corrupt, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.match(b.reason, /VALUE invalid|FAIL_CLOSED/i);
});

test("a dispatched role that is not a known role-registry id → BLOCK (value not just presence)", () => {
  const b = deriveBinding({ channel: "dispatch-claude", role: "totally-made-up-role" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.match(b.reason, /not a known role-registry id/i);
});

test("top_level_default_binding_source must be helm_only", () => {
  const corrupt = { ...RB, top_level_default_binding_source: "ambient" };
  const vv = validateRoleBindingValues(corrupt);
  assert.strictEqual(vv.ok, false);
  assert.match(vv.errors.join(";"), /helm_only/);
});

test("a structurally-corrupt control → deriveBinding fails closed, never a permissive default", () => {
  const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: { garbage: true }, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.failClosed, true, "a corrupt control must fail CLOSED (the bridge refuses)");
});

test("robust President-alias: aliases that dodge the exact-string list are STILL blocked", () => {
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

test("bare 'Alex' (the President's name) and the Greek call-sign 'α' are President identities", () => {
  for (const alias of ["Alex", "alex", "ALEX", "α", "Α", " α "]) {
    assert.strictEqual(isPresidentIdentity(alias), true, `'${alias}' must be recognized as the President identity`);
  }
  for (const alias of ["Alex", "α"]) {
    const b = deriveBinding({ channel: "dispatch-claude", role: alias }, { rb: RB, knownRoles: KNOWN });
    assert.strictEqual(b.ok, false, `'${alias}' must be refused`);
    assert.strictEqual(b.failClosed, true);
  }
});

test("failClosed taxonomy: integrity failures fail-CLOSED; a benign unknown role does NOT", () => {
  assert.strictEqual(deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: { bad: 1 }, knownRoles: KNOWN }).failClosed, true);
  assert.strictEqual(deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: { ...RB, worker_default_when_unbound: "PASS" }, knownRoles: KNOWN }).failClosed, true);
  assert.strictEqual(deriveBinding({ channel: "not-a-bridge", role: "backend-builder" }, { rb: RB, knownRoles: KNOWN }).failClosed, true);
  const benign = deriveBinding({ channel: "dispatch-claude", role: "some-generic-role" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(benign.ok, false);
  assert.strictEqual(benign.failClosed, false, "a benign unrecognized role must NOT fail-closed (keeps generic roles working)");
});

test("registry unavailable: knownRoles:null still blocks aliases, proceeds benignly for others", () => {
  assert.strictEqual(deriveBinding({ channel: "dispatch-claude", role: "alex_alpha" }, { rb: RB, knownRoles: null }).failClosed, true);
  const b = deriveBinding({ channel: "dispatch-claude", role: "some-worker" }, { rb: RB, knownRoles: null });
  assert.strictEqual(b.ok, true, "with the registry down, a non-President role binds as dispatched_worker (no brick)");
  assert.strictEqual(b.actor_kind, "dispatched_worker");
});

test("a bogus top_level_human_default is BLOCKED (not silently bound)", () => {
  const bogus = { ...RB, top_level_human_default: "made-up-super-role" };
  const b = deriveBinding({ channel: "session-bootstrap" }, { rb: bogus, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.failClosed, true);
  assert.match(b.reason, /canonical President identity|VALUE invalid/i);
});

test("an invented 'president-shaped' top-level default (president-worker) is REJECTED, not accepted", () => {
  const bogus = { ...RB, top_level_human_default: "president-worker" };
  const b = deriveBinding({ channel: "session-bootstrap" }, { rb: bogus, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false, "a permissive president-substring value must not be a valid top-level default");
  assert.strictEqual(b.failClosed, true);
});

test("a bogus top_level_human_default also fail-closes a DISPATCHED worker (global control failure)", () => {
  const bogus = { ...RB, top_level_human_default: "made-up" };
  const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: bogus, knownRoles: KNOWN });
  assert.strictEqual(b.ok, false, "a corrupt control value must fail-close ALL actors, not just top-level");
  assert.strictEqual(b.failClosed, true);
});
