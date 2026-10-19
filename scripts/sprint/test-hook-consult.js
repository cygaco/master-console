#!/usr/bin/env node
"use strict";

const { emitStepConsults, emitDesignTouch } = require("./hook-consult");

let passes = 0;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function capture() {
  const events = [];
  const fn = (cat, data, opts) => events.push({ cat, data, opts });
  return { events, fn };
}

console.log("emitStepConsults — gauntlet(FE,high):");
{
  const { events, fn } = capture();
  const roles = emitStepConsults("gauntlet", { unit_types: ["frontend"], max_risk: "high" }, "SP-x", fn);
  ok("returns the gauntlet agent-set", roles.includes("qa-reviewer") && roles.includes("design-quality"), roles.join(","));
  ok("one manager_consult emitted per agent", events.length === roles.length && events.every((e) => e.cat === "manager_consult"), `events=${events.length} roles=${roles.length}`);
  ok("records carry manager + verdict='consulted' + phase", events.every((e) => e.data.manager && e.data.verdict === "consulted" && e.data.phase === "gauntlet"));
  ok("sprint_id tagged via opts", events.every((e) => e.opts.sprint_id === "SP-x"));
  ok("design-quality consult present", events.some((e) => e.data.manager === "design-quality"));
  ok("hook_mode carried (block/advisory)", events.every((e) => ["block", "advisory"].includes(e.data.hook_mode)));
}

console.log("\nemitStepConsults — gauntlet(BE,low):");
{
  const { events, fn } = capture();
  emitStepConsults("gauntlet", { unit_types: ["backend"], max_risk: "low" }, "SP-y", fn);
  ok("no design-quality consult for a non-UI sprint", !events.some((e) => e.data.manager === "design-quality"));
  ok("qa-reviewer + security-reviewer still fire (always-on)", events.some((e) => e.data.manager === "qa-reviewer") && events.some((e) => e.data.manager === "security-reviewer"));
  ok("backend-reviewer fires, frontend-reviewer does not", events.some((e) => e.data.manager === "backend-reviewer") && !events.some((e) => e.data.manager === "frontend-reviewer"));
}

console.log("\nemitStepConsults — plan (any comp):");
{
  const { events, fn } = capture();
  const roles = emitStepConsults("plan", {}, "SP-z", fn);
  ok("plan always emits director-of-product + product-lead", roles.includes("director-of-product") && roles.includes("product-lead"), roles.join(","));
  ok("emissions match returned roles", events.length === roles.length);
}

console.log("\nemitDesignTouch:");
{
  const { events, fn } = capture();
  const ui = emitDesignTouch({ unit_types: ["frontend"] }, "SP-x", fn);
  ok("UI composition → fires ui_touched on a sprint_full_* event", ui === true && events.length === 1 && events[0].data.ui_touched === true && /^sprint_full/.test(events[0].data.kind), JSON.stringify(events));
  const cap2 = capture();
  const ui2 = emitDesignTouch({ unit_types: ["backend"] }, "SP-y", cap2.fn);
  ok("non-UI composition → no ui_touched", ui2 === false && cap2.events.length === 0);
}

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
