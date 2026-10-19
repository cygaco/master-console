"use strict";

const FIXTURE_SPRINT_IDS = Object.freeze([
  "SP-CLI",
  "SP-CLI2",
  "SP-DIFF",
  "SP-FIXTURE-001",
  "SP-FIXTURE-002",
  "SP-POISON",
  "SP-PROP",
  "SP-PROP2",
  "SP-SECSURF-STAGE3",
  "SP-SECSURF-SIBLING",
  "SP-GP-9991",
  "SP-GP-9992",
  "SP-GP-9993",
  "SP-GP-DELTA-NEW",
  "SP-GP-DELTA-NOBH",
  "SP-GP-DELTA-PRE",
  "SP-GP-EMPTY",
  "SP-GP-EMPTYSCOPE",
  "SP-GP-FT0",
  "SP-GP-MISMATCH",
  "SP-NO-SUCH-SPRINT-000",
  "SP-T",
  "SP-FIXTURE-003",
  "SP-x",
  "SP-X",
  "SP-FIXTURE-004",
  "SP-99999999-999",
  "SP-99999999-001",
  "SP-99999999-002",
  "SP-FIXTURE-005",
  "SP-FIXTURE-006",
  "SP-FIXTURE-007",
  "SP-FIXTURE-008",
  "SP-FIXTURE-009",
  "SP-FIXTURE-010",
  "SP-FIXTURE-011",
  "SP-FIXTURE-012",
  "SP-FIXTURE-013",
  "SP-FIXTURE-014",
  "SP-FIXTURE-015",
  "SP-FIXTURE-016",
  "SP-FIXTURE-017",
  "SP-FIXTURE-018",
  "SP-FIXTURE-019",
  "SP-FIXTURE-020",
  "SP-NONEXISTENT-hollow-test-99",
  "SP-TEST",
  "SP-TEST-CONSULT-CLEAN",
  "SP-TEST-CONSULT-HALT",
  "SP-TEST-CONSULT-PLAN",
  "SP-TEST-VACUOUS",
  "SP-TEST-GAPA",
  "SP-TEST-GP",
  "SP-TEST-GP2",
  "SP-TEST-GP3",
  "SP-TEST-GP4",
  "SP-TEST-GP5",
  "SP-TEST-GP6",
  "SP-TEST-GP7",
  "SP-TEST-GP8",
  "SP-TEST-GP9",
  "SP-TEST-GP10",
  "SP-TEST-MISSING",
  "SP-TEST-DIFF",
  "SP-TEST-DIFFB",
  "SP-TEST-DIFFC",
  "SP-TEST-DIFFD",
  "SP-TEST-hollow",
]);

const FIXTURE_SPRINT_ID_PREFIXES = Object.freeze([
  "SP-DIFFQ-",
  "SP-FIXTURE-STRICT-",
  "SP-FIXTURE-LENIENT-",
  "SP-GP-",
  "SP-NO-SUCH-SPRINT-",
  "SP-NONEXISTENT-",
]);

const FIXTURE_SPRINT_ID_SET = new Set(FIXTURE_SPRINT_IDS.map((s) => s.toLowerCase()));

function matchesFixturePrefix(id, prefixes) {
  if (typeof id !== "string" || !id) return false;
  const lower = id.toLowerCase();
  for (const p of prefixes) {
    if (lower.startsWith(p.toLowerCase())) return true;
  }
  return false;
}

function isStaticFixtureSprintId(id) {
  if (typeof id !== "string" || !id) return false;
  if (FIXTURE_SPRINT_ID_SET.has(id.toLowerCase())) return true;
  return matchesFixturePrefix(id, FIXTURE_SPRINT_ID_PREFIXES);
}

function quarantinedIdsFrom(events) {
  const ids = new Set();
  const prefixes = new Set();
  if (!Array.isArray(events)) return { ids, prefixes };
  for (const rec of events) {
    if (!rec || typeof rec !== "object") continue;
    const data = rec.data;
    if (!data || data.kind !== "events-quarantined") continue;
    if (Array.isArray(data.sprint_ids)) {
      for (const id of data.sprint_ids) if (typeof id === "string") ids.add(id);
    }
    if (Array.isArray(data.prefixes)) {
      for (const p of data.prefixes) if (typeof p === "string") prefixes.add(p);
    }
  }
  return { ids, prefixes };
}

function isFixtureSprintId(id, events) {
  if (isStaticFixtureSprintId(id)) return true;
  if (!events) return false;
  const { ids, prefixes } = quarantinedIdsFrom(events);
  if (typeof id === "string" && ids.has(id)) return true;
  return matchesFixturePrefix(id, Array.from(prefixes));
}

function excludeFixtureEvents(events) {
  if (!Array.isArray(events)) return events;
  const { ids, prefixes } = quarantinedIdsFrom(events);
  const dynamicPrefixes = Array.from(prefixes);
  return events.filter((rec) => {
    if (!rec || typeof rec !== "object") return true;
    const data = rec.data || {};
    const sid = data.sprint || data.sprint_id || rec.sprint_id;
    if (typeof sid !== "string" || !sid) return true;
    if (isStaticFixtureSprintId(sid)) return false;
    if (ids.has(sid)) return false;
    if (dynamicPrefixes.length && matchesFixturePrefix(sid, dynamicPrefixes)) return false;
    return true;
  });
}

module.exports = {
  FIXTURE_SPRINT_IDS,
  FIXTURE_SPRINT_ID_PREFIXES,
  isStaticFixtureSprintId,
  isFixtureSprintId,
  quarantinedIdsFrom,
  excludeFixtureEvents,
};
