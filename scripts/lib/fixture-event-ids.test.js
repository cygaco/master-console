"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  isStaticFixtureSprintId,
  isFixtureSprintId,
  quarantinedIdsFrom,
  excludeFixtureEvents,
} = require("./fixture-event-ids");

test("isStaticFixtureSprintId recognizes every known fixture prefix", () => {
  for (const id of [
    "SP-CLI2",
    "SP-DIFF",
    "SP-DIFFQ-1759780000000",
    "SP-FIXTURE-002",
    "SP-POISON",
    "SP-PROP2",
    "SP-SECSURF-STAGE3",
    "SP-SECSURF-SIBLING",
    "SP-FIXTURE-STRICT-1759780000000",
    "SP-FIXTURE-LENIENT-1759780000000",
    "SP-GP-DELTA-NEW",
    "SP-NO-SUCH-SPRINT-000",
    "SP-T",
    "SP-TEST-DIFFC",
    "SP-FIXTURE-005",
    "SP-FIXTURE-020",
    "SP-X",
    "SP-x",
    "SP-99999999-999",
    "SP-NONEXISTENT-hollow-test-99",
  ]) {
    assert.ok(isStaticFixtureSprintId(id), `expected fixture: ${id}`);
  }
});

test("isStaticFixtureSprintId never flags a real-convention sprint id", () => {
  for (const id of [
    "SP-20990101-001",
    "S-AB-996",
    "integrate-9.9.0-lanea",
    "S-PF-9991",
  ]) {
    assert.ok(!isStaticFixtureSprintId(id), `false positive on real-looking id: ${id}`);
  }
});

test("isStaticFixtureSprintId never flags another test file's own similarly-styled fixture id", () => {
  for (const id of [
    "SP-CLI-FINDING-991",
    "SP-TEST-MC-UITOUCH-001",
  ]) {
    assert.ok(!isStaticFixtureSprintId(id), `false positive on an unrelated file's own fixture id: ${id}`);
  }
});

test("quarantinedIdsFrom unions sprint_ids/prefixes across every events-quarantined record", () => {
  const events = [
    { data: { kind: "events-quarantined", sprint_ids: ["A-1"], prefixes: ["Z-"] } },
    { data: { kind: "events-quarantined", sprint_ids: ["A-2"] } },
    { data: { kind: "gauntlet-package-closed", sprint: "A-1" } },
  ];
  const { ids, prefixes } = quarantinedIdsFrom(events);
  assert.deepStrictEqual(Array.from(ids).sort(), ["A-1", "A-2"]);
  assert.deepStrictEqual(Array.from(prefixes), ["Z-"]);
});

test("isFixtureSprintId consults quarantine records in the given events array", () => {
  const events = [{ data: { kind: "events-quarantined", sprint_ids: ["REAL-LOOKING-ID"] } }];
  assert.ok(!isFixtureSprintId("REAL-LOOKING-ID", undefined), "no events array → static-only");
  assert.ok(isFixtureSprintId("REAL-LOOKING-ID", events), "quarantine record must be honored");
});

test("excludeFixtureEvents drops fixture-sprint rows and keeps everything else, including the marker row itself", () => {
  const events = [
    { data: { kind: "gauntlet-package-closed", sprint: "SP-CLI2" } },
    { data: { kind: "gauntlet-package-closed", sprint: "integrate-9.9.0-lanea" } },
    { data: { kind: "sprint_full_beta_consult", sprint_id: "SP-FIXTURE-005" } },
    { data: { kind: "manager_consult", sprint_id: "SP-GP-DELTA-NOBH" } },
    { data: { kind: "events-quarantined", sprint_ids: [], count: 2 } },
    { data: { type: "whatever", detail: "no sprint field at all" } },
  ];
  const kept = excludeFixtureEvents(events);
  const kinds = kept.map((e) => e.data.kind || e.data.type);
  assert.deepStrictEqual(kinds, ["gauntlet-package-closed", "events-quarantined", "whatever"]);
  assert.strictEqual(kept[0].data.sprint, "integrate-9.9.0-lanea");
});

test("excludeFixtureEvents also honors a quarantine record's dynamic prefixes", () => {
  const events = [
    { data: { kind: "events-quarantined", prefixes: ["WX-"] } },
    { data: { kind: "manager_consult", sprint_id: "WX-FIXTURE-991" } },
    { data: { kind: "manager_consult", sprint_id: "integrate-9.9.0-laneb" } },
  ];
  const kept = excludeFixtureEvents(events);
  assert.strictEqual(kept.length, 2);
  assert.ok(kept.some((e) => e.data.sprint_id === "integrate-9.9.0-laneb"));
  assert.ok(!kept.some((e) => e.data.sprint_id === "WX-FIXTURE-991"));
});

test("excludeFixtureEvents is a no-op pass-through on non-array input", () => {
  assert.strictEqual(excludeFixtureEvents(null), null);
  assert.strictEqual(excludeFixtureEvents(undefined), undefined);
});
