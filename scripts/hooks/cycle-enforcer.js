#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { logEvent } = require("./lib/logger");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);

    if (event.tool_name !== "Agent") {
      process.exit(0);
    }

    const prompt = event.tool_input?.prompt || "";
    let agentsDir;
    try {
      const { PATHS: _P } = require("./lib/paths");
      agentsDir = _P.agents;
    } catch {
    }
    const storePath = agentsDir
      ? path.join(agentsDir, "store.json")
      : path.resolve(__dirname, "..", "..", ".claude", "agents", "store.json");

    if (!fs.existsSync(storePath)) {
      process.exit(0);
    }

    const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    const cycleStep = store.heartbeat?.cycleStep || null;

    const isBuilder =
      /^feature:\s*\S+/m.test(prompt) &&
      !/evaluator|security|compliance|fix agent|auditor/i.test(
        prompt.substring(0, 500),
      );
    const isEvaluator = /evaluator/i.test(prompt.substring(0, 500));
    const isSecurity = /security/i.test(prompt.substring(0, 500));
    const isLead = /auditor agent/i.test(prompt.substring(0, 500));
    const isFixAgent = /fix agent/i.test(prompt.substring(0, 500));

    if (!cycleStep) {
      const features = store.features || {};
      const anyWorked = Object.values(features).some(
        (f) => f.status && f.status !== "not_started",
      );
      if (anyWorked) {
        const blockMsg =
          `heartbeat.cycleStep is null but features have work in progress. ` +
          `The Boss must set cycleStep through the full progression: ` +
          `building → builders-merged → reviewing → review-complete → fixing → ` +
          `points-done → auditor → cycle-complete. ` +
          `Set heartbeat.cycleStep before dispatching any agents.`;
        process.stderr.write(`[cycle-enforcer] BLOCKED: ${blockMsg}\n`);
        logEvent(
          "block",
          "system",
          "cycle-enforcer-null-step",
          "",
          blockMsg.slice(0, 200),
        );
        process.exit(2);
      }
    }

    if (
      isBuilder &&
      cycleStep &&
      ["reviewing", "fixing", "points", "auditor"].includes(cycleStep)
    ) {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Cannot dispatch builder during cycle step "${cycleStep}". ` +
          `Complete the current cycle (points → auditor → commit) before starting new builders.\n`,
      );
      process.exit(2);
    }

    if (isLead && cycleStep && cycleStep !== "points-done") {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Cannot dispatch Lead agent during cycle step "${cycleStep}". ` +
          `Points must be calculated first (step 7). Set heartbeat.cycleStep to "points-done".\n`,
      );
      process.exit(2);
    }

    if (isBuilder && cycleStep === "builders-merged") {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Builders are merged but gauntlet hasn't run. ` +
          `Dispatch evaluator + security + compliance first (step 4).\n`,
      );
      process.exit(2);
    }

    if (isFixAgent && cycleStep === "reviewing") {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Cannot dispatch fix agent — reviewers still running. ` +
          `Wait for ALL THREE reviewers (evaluator + security + compliance) to complete. ` +
          `Set heartbeat.cycleStep to "review-complete" after collecting all results, ` +
          `then dispatch fix agents.\n`,
      );
      process.exit(2);
    }

    if (isBuilder && cycleStep === "points-done") {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Cannot dispatch builders — Lead agent hasn't run yet. ` +
          `Points are done (step 7) but the Lead must analyze patterns and adjust ` +
          `environment (steps 8-10) before the next phase. Dispatch the Lead agent, ` +
          `then set heartbeat.cycleStep to "cycle-complete".\n`,
      );
      process.exit(2);
    }

    logEvent(
      "decision",
      "system",
      "cycle-enforcer-passed",
      "",
      `cycleStep=${cycleStep}`,
    );
    process.exit(0);
  } catch (err) {
    const errMsg = `cycle-enforcer parse error (fail-closed): ${err.message}`;
    process.stderr.write(`[cycle-enforcer] BLOCKED: ${errMsg}\n`);
    logEvent(
      "block",
      "system",
      "cycle-enforcer-error",
      "",
      errMsg.slice(0, 200),
    );
    process.exit(2);
  }
});
