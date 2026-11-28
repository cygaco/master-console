#!/usr/bin/env node
"use strict";
const assert = require("assert");
const pv = require("./provenance-verifier");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

test("RECOGNIZED_PROFILES is exactly [panel-3lab, panel-2family] and frozen", () => {
  assert.deepEqual([...pv.RECOGNIZED_PROFILES].sort(), ["panel-2family", "panel-3lab"]);
  assert.ok(Object.isFrozen(pv.RECOGNIZED_PROFILES), "the whitelist must be immutable");
});

test("panel-3lab + claude → in-process hunter contract (BINDING)", () => {
  const c = pv.laneContract("panel-3lab", "claude");
  assert.deepEqual(c, { shape: pv.IN_PROCESS_SHAPE, role: pv.HUNTER_ROLE, isHunter: true });
});

test("panel-2family + claude → the same in-process hunter contract (one Claude lane everywhere)", () => {
  const c = pv.laneContract("panel-2family", "claude");
  assert.deepEqual(c, { shape: pv.IN_PROCESS_SHAPE, role: pv.HUNTER_ROLE, isHunter: true });
  assert.deepEqual(c, pv.laneContract("panel-3lab", "claude"));
});
test("a subprocess-claude security-reviewer record does not match the floor's claude lane", () => {
  const c = pv.laneContract("panel-2family", "claude");
  assert.equal(pv.recordMatchesLane({ provider: "claude", shape: "subprocess-claude", role: "security-reviewer" }, c, "claude"), false);
});

const H = (c) => c.repeat(64);
test("hunterPacketBound: matches only when packet digest equals expected and output_digest recomputes", () => {
  const rec = { packet_sha256: H("a"), evidence_sha: H("b"), output_digest: pv.hunterBindingDigest(H("a"), H("b")) };
  assert.equal(pv.hunterPacketBound(rec, H("a")), true);
  assert.equal(pv.hunterPacketBound(rec, H("c")), false, "other packet");
  assert.equal(pv.hunterPacketBound({ ...rec, packet_sha256: H("c") }, H("c")), false, "re-pointed packet digest breaks the bound output_digest");
  assert.equal(pv.hunterPacketBound({ ...rec, evidence_sha: H("d") }, H("a")), false, "swapped evidence");
  assert.equal(pv.hunterPacketBound({ ...rec, output_digest: "d" }, H("a")), false, "unbound output_digest");
  assert.equal(pv.hunterPacketBound(rec, null), false, "no expected digest");
  assert.equal(pv.hunterPacketBound(rec, "short"), false);
  assert.equal(pv.hunterPacketBound(null, H("a")), false);
});

const T0 = Date.parse("2000-01-01T12:00:00.000Z");
const at = (ms) => new Date(T0 + ms).toISOString();
const verify = (r) => r.sig !== false;
const hunter = (over = {}) => {
  const packet = over.packet_sha256 || H("a");
  return { role: pv.HUNTER_ROLE, provider: "claude", shape: pv.IN_PROCESS_SHAPE, ok: true, fallback: false, verdict: "pass",
    panel_run_id: "run-1", sprint_id: "sprint-a", packet_sha256: packet, evidence_sha: H("b"),
    output_digest: pv.hunterBindingDigest(packet, H("b")), completed_at: at(-1000), ...over };
};
const opts = { panelRunId: "run-1", sprintId: "sprint-a", packetSha: H("a"), verify };
const windowed = { ...opts, sinceMs: T0 - 60000, untilMs: T0 };
const verdictFor = (records, o = opts) => pv.hunterVerdictFor(records, o).verdict;
const emptyError = (over = {}) => hunter({ ok: false, verdict: "error", ...over });

const HOUR = 60 * 60 * 1000;
const cli = (ms) => ({ started_at: at(ms) });
test("hunterWindowFor: ends at the earliest start among the CLI records, in any order, and is one window long", () => {
  for (const records of [[cli(5000), cli(2000)], [cli(2000), cli(5000)]]) {
    assert.deepEqual(pv.hunterWindowFor(records, T0), { sinceMs: T0 + 2000 - HOUR, untilMs: T0 + 2000 });
  }
});
test("hunterWindowFor: with no record start to read, ends at the fallback end", () => {
  for (const records of [[], null, undefined, [{}]]) {
    assert.deepEqual(pv.hunterWindowFor(records, T0), { sinceMs: T0 - HOUR, untilMs: T0 }, JSON.stringify(records));
  }
});
test("hunterWindowFor: no end, or one start unreadable among readable ones, is a window nothing can fall in", () => {
  const pass = hunter();
  const cases = [[[], null], [[{}], undefined], [[], NaN], [[cli(0), {}], T0], [[cli(0), { started_at: "not a time" }], T0]];
  for (const [records, fallback] of cases) {
    const out = pv.hunterVerdictFor([pass], { ...opts, ...pv.hunterWindowFor(records, fallback) });
    assert.deepEqual([out.verdict, out.record], ["error", null], JSON.stringify([records, fallback]));
  }
});

test("hunterVerdictFor: no record -> error with no carrying record", () => {
  const out = pv.hunterVerdictFor([], opts);
  assert.equal(out.verdict, "error");
  assert.equal(out.record, null);
});
test("hunterVerdictFor: a single live pass -> pass; any warn -> warn", () => {
  const rec = hunter();
  const out = pv.hunterVerdictFor([rec], opts);
  assert.equal(out.verdict, "pass");
  assert.equal(out.record, rec);
  assert.equal(verdictFor([rec, hunter({ verdict: "warn" })]), "warn");
});
test("hunterVerdictFor: a live pass beside a signed not-ok error -> error, in either order", () => {
  assert.equal(verdictFor([hunter(), emptyError()]), "error");
  assert.equal(verdictFor([emptyError(), hunter()]), "error");
});
test("hunterVerdictFor: a not-live record binds even when it says pass; alone it never passes", () => {
  assert.equal(verdictFor([hunter(), hunter({ fallback: true })]), "error");
  assert.equal(verdictFor([hunter(), hunter({ ok: false })]), "error");
  assert.equal(verdictFor([hunter({ ok: false })]), "error");
});
test("hunterVerdictFor: a live pass beside a signed fail -> fail; a not-live fail is still a fail", () => {
  assert.equal(verdictFor([hunter(), hunter({ verdict: "fail" })]), "fail");
  assert.equal(verdictFor([hunter(), emptyError(), hunter({ verdict: "fail", ok: false })]), "fail");
});
test("hunterVerdictFor: another run, sprint, packet or identity, or a bad signature, neither binds nor counts", () => {
  const strays = [
    { panel_run_id: "run-2" }, { sprint_id: "sprint-b" }, { packet_sha256: H("c") }, { sig: false }, { shape: pv.SUBPROCESS_CLAUDE_SHAPE },
  ];
  for (const over of strays) {
    assert.equal(verdictFor([hunter(), hunter({ verdict: "fail", ...over })]), "pass", `must not bind: ${JSON.stringify(over)}`);
    assert.equal(verdictFor([hunter(over)]), "error", `must not count: ${JSON.stringify(over)}`);
  }
});
test("hunterVerdictFor: no run id, no packet digest or no signature check -> error", () => {
  assert.equal(verdictFor([hunter({ panel_run_id: null })], { ...opts, panelRunId: null }), "error");
  assert.equal(verdictFor([hunter({ panel_run_id: "" })], { ...opts, panelRunId: "" }), "error");
  assert.equal(verdictFor([hunter()], { ...opts, packetSha: null }), "error");
  assert.equal(verdictFor([hunter()], { ...opts, verify: undefined }), "error");
});
test("hunterVerdictFor: a live pass outside the time bounds -> error; both bounds are inclusive", () => {
  assert.equal(verdictFor([hunter({ completed_at: at(1) })], windowed), "error", "after the upper bound");
  assert.equal(verdictFor([hunter({ completed_at: at(-60001) })], windowed), "error", "before the lower bound");
  assert.equal(verdictFor([hunter({ completed_at: "not a time" })], windowed), "error");
  assert.equal(verdictFor([hunter({ completed_at: at(0) })], windowed), "pass");
  assert.equal(verdictFor([hunter({ completed_at: at(-60000) })], windowed), "pass");
});
test("hunterVerdictFor: a signed error or fail outside the window still binds a pass inside it", () => {
  assert.equal(verdictFor([hunter(), emptyError({ completed_at: at(5000) })], windowed), "error");
  assert.equal(verdictFor([hunter(), emptyError({ completed_at: at(-7200000) })], windowed), "error");
  assert.equal(verdictFor([hunter(), hunter({ verdict: "fail", completed_at: at(5000) })], windowed), "fail");
});

test("recognized profiles + a cross-provider lane → cross-provider contract", () => {
  for (const profile of ["panel-3lab", "panel-2family"]) {
    for (const provider of ["openai", "antigravity"]) {
      const c = pv.laneContract(profile, provider);
      assert.deepEqual(c, { shape: pv.CROSS_PROVIDER_SHAPE, role: pv.PANEL_ROLE, isHunter: false }, `${profile}/${provider}`);
    }
  }
});

test("claudeLaneContract resolves both recognized profiles directly", () => {
  assert.equal(pv.claudeLaneContract("panel-3lab").isHunter, true);
  assert.equal(pv.claudeLaneContract("panel-2family").isHunter, true);
});

test("a typo'd profile + claude THROWS (does NOT resolve to the floor)", () => {
  assert.throws(() => pv.laneContract("panel-2famly", "claude"), /unrecognized panel profile|fail closed/i);
  let resolved = null;
  try { resolved = pv.laneContract("panel-2famly", "claude"); } catch { }
  assert.equal(resolved, null, "a typo'd profile must never resolve to a contract");
});

test("a typo'd profile + a cross-provider lane ALSO throws (no partial false-green)", () => {
  assert.throws(() => pv.laneContract("panel-2famly", "openai"), /unrecognized panel profile/i);
  assert.throws(() => pv.laneContract("panel-3lab-typo", "antigravity"), /unrecognized panel profile/i);
});

test("an unknown profile throws", () => {
  assert.throws(() => pv.laneContract("floor", "claude"), /unrecognized panel profile/i);
  assert.throws(() => pv.laneContract("panel-4lab", "claude"), /unrecognized panel profile/i);
});

test("an absent profile (undefined/null/empty) throws", () => {
  for (const bad of [undefined, null, ""]) {
    assert.throws(() => pv.laneContract(bad, "claude"), /unrecognized panel profile/i, `laneContract(${JSON.stringify(bad)})`);
    assert.throws(() => pv.claudeLaneContract(bad), /unrecognized panel profile/i, `claudeLaneContract(${JSON.stringify(bad)})`);
  }
});

test("claudeLaneContract fails closed on a typo (exported entry is guarded too)", () => {
  assert.throws(() => pv.claudeLaneContract("panel-2famly"), /unrecognized panel profile/i);
});

test("the fail-closed error names the offending profile and the recognized set", () => {
  try {
    pv.laneContract("bogus-profile", "claude");
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(/bogus-profile/.test(e.message), "error names the offending profile");
    assert.ok(/panel-3lab/.test(e.message) && /panel-2family/.test(e.message), "error lists the recognized profiles");
  }
});

if (failures.length) {
  process.stderr.write(`FAIL [provenance-verifier.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [provenance-verifier.test] ${passed} passed (unrecognized/absent profile fails closed; recognized floor+binding still resolve)\n`);
