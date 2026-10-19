#!/usr/bin/env node
"use strict";

const hookPoints = require("./hook-points");

let _log = null;
function logger() {
  if (!_log) {
    const m = require("../hooks/lib/logger");
    _log = typeof m === "function" ? m : m.log;
  }
  return _log;
}

function emitStepConsults(step, composition, sprintId, logFn) {
  const emit = logFn || logger();
  const agents = hookPoints.agentsForStep(step, composition);
  for (const row of agents) {
    emit(
      "manager_consult",
      {
        manager: row.role,
        mode: "sprint",
        unit: sprintId,
        verdict: "consulted",
        phase: step,
        hook_mode: row.mode,
      },
      { sprint_id: sprintId, actor: "alpha", source: "/sprint:full" },
    );
  }
  return agents.map((r) => r.role);
}

function emitDesignTouch(composition, sprintId, logFn) {
  const emit = logFn || logger();
  const comp = hookPoints.normalizeComposition(composition);
  const ui = comp.unit_types.has("ui") || comp.unit_types.has("frontend");
  if (ui) {
    emit(
      "audit",
      { kind: "sprint_full_design_touch", ui_touched: true, sprint_id: sprintId },
      { sprint_id: sprintId, actor: "alpha", source: "/sprint:full" },
    );
  }
  return ui;
}

module.exports = { emitStepConsults, emitDesignTouch };
