#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { readYamlMaybe, writeYaml } = require("./fs");

const full = require("./full");

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

const SPRINT = require("./paths");
const REGISTRY = SPRINT.activeRegistry;

function readRegistry() {
  return readYamlMaybe(REGISTRY);
}

function writeRegistry(reg) {
  writeYaml(REGISTRY, reg);
}

function withTestRegistry(setup, fn) {
  const original = fs.readFileSync(REGISTRY, "utf8");
  try {
    setup();
    return fn();
  } finally {
    fs.writeFileSync(REGISTRY, original, "utf8");
  }
}

function injectSyntheticSprint(id, status) {
  const reg = readRegistry();
  reg.sprints = reg.sprints.filter((s) => s.id !== id);
  reg.sprints.push({
    id,
    title: `SYNTHETIC test sprint for status-lag-fix tests`,
    status,
    lane: { type: "default", value: null, isolation_notes: "" },
    layout: "per_sprint_subdir",
    pointer: `.claude/project/sprint/sprints/${id}`,
    created_at: "2030-01-01T00:00:00.000Z",
    updated_at: "2030-01-01T00:00:00.000Z",
  });
  writeRegistry(reg);
}

function syntheticSprintStatus(id) {
  const reg = readRegistry();
  const entry = reg.sprints.find((s) => s.id === id);
  return entry ? entry.status : null;
}

const SYNTH_ID = "SP-99999999-TEST";

withTestRegistry(
  () => injectSyntheticSprint(SYNTH_ID, "planning"),
  () => {
    const r = full.flipActiveSprintsStatusForRetro(SYNTH_ID);
    ok("planning → closed: changed=true", r.changed === true, JSON.stringify(r));
    ok("planning → closed: from=planning", r.from === "planning");
    ok("planning → closed: to=closed", r.to === "closed");
    ok(
      "planning → closed: registry reflects closed",
      syntheticSprintStatus(SYNTH_ID) === "closed",
    );
  },
);

withTestRegistry(
  () => injectSyntheticSprint(SYNTH_ID, "releasing"),
  () => {
    const r = full.flipActiveSprintsStatusForRetro(SYNTH_ID);
    ok("releasing → closed: changed=true", r.changed === true);
    ok("releasing → closed: to=closed", r.to === "closed");
  },
);

withTestRegistry(
  () => injectSyntheticSprint(SYNTH_ID, "closed"),
  () => {
    const r = full.flipActiveSprintsStatusForRetro(SYNTH_ID);
    ok("closed: changed=false", r.changed === false);
    ok("closed: reason=already_terminal", r.reason === "already_terminal");
    ok(
      "closed: registry unchanged",
      syntheticSprintStatus(SYNTH_ID) === "closed",
    );
  },
);

withTestRegistry(
  () => injectSyntheticSprint(SYNTH_ID, "retrospected"),
  () => {
    const r = full.flipActiveSprintsStatusForRetro(SYNTH_ID);
    ok("retrospected: changed=false", r.changed === false);
    ok(
      "retrospected: registry unchanged",
      syntheticSprintStatus(SYNTH_ID) === "retrospected",
    );
  },
);

withTestRegistry(
  () => injectSyntheticSprint(SYNTH_ID, "abandoned"),
  () => {
    const r = full.flipActiveSprintsStatusForRetro(SYNTH_ID);
    ok("abandoned: changed=false", r.changed === false);
    ok(
      "abandoned: registry unchanged",
      syntheticSprintStatus(SYNTH_ID) === "abandoned",
    );
  },
);

{
  const r = full.flipActiveSprintsStatusForRetro("SP-NEVER-EXISTED");
  ok(
    "absent id: reason=not_in_registry",
    r.reason === "not_in_registry",
    JSON.stringify(r),
  );
}

{
  let threw = false;
  try {
    full.flipActiveSprintsStatusForRetro(null);
  } catch (e) {
    threw = true;
  }
  ok("null sprint id does not throw", !threw);
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
