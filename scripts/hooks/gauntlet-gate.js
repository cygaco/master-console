#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { logEvent } = require("./lib/logger");
const { getDeps } = require("./lib/project-config");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);

    if (event.tool_name !== "Agent") {
      process.exit(0);
    }

    const prompt = event.tool_input?.prompt || "";

    const featureMatch = prompt.match(/^feature:\s*(\S+)/m);
    if (!featureMatch) {
      process.exit(0);
    }

    const feature = featureMatch[1];

    // qa-reviewer, security-reviewer + the generic `reviewer`. Legacy names
    if (
      /reviewer|evaluator|redteam|security|compliance|fixer|fix agent|auditor|test|qa.*scan|qa.*analy|qa.*orchestrat/i.test(
        prompt.substring(0, 500),
      )
    ) {
      process.exit(0);
    }

    const DEPS = getDeps();

    const deps = DEPS[feature];
    if (!deps || deps.length === 0) {
      process.exit(0);
    }

    let storePath;
    try {
      const { PATHS: _P } = require("./lib/paths");
      storePath = _P.oneshotStore;
    } catch {
      storePath = path.resolve(
        __dirname,
        "..",
        "..",
        ".claude",
        "agents",
        "president",
        ".system",
        "oneshot",
        "store.json",
      );
    }

    if (!fs.existsSync(storePath)) {
      process.stderr.write(
        "[gauntlet-gate] WARN: store.json not found, allowing dispatch\n",
      );
      process.exit(0);
    }

    const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    const runLog = Array.isArray(store.runLog)
      ? store.runLog
      : store.runLog?.entries || [];

    const gatedFeatures = new Set();
    for (const entry of runLog) {
      if (entry.type === "GATE_CHECK" && entry.features) {
        for (const f of entry.features) {
          gatedFeatures.add(f);
        }
      }
    }

    for (const [name, data] of Object.entries(store.features || {})) {
      if (data.status === "skipped") {
        gatedFeatures.add(name);
        continue;
      }
      if (data.status === "done") {
        const gateEntry = runLog.find(
          (e) => e.type === "GATE_CHECK" && e.feature === name,
        );
        if (gateEntry) {
          function isDoneOrImpossible(val) {
            if (!val || typeof val !== "string") return false;
            const v = val.toLowerCase();
            return (
              v.startsWith("pass") ||
              v.startsWith("done") ||
              v.startsWith("impossible")
            );
          }

          const reviewerVerdict = gateEntry.reviewer || gateEntry.evaluator;
          const hasEval = isDoneOrImpossible(reviewerVerdict);
          const hasSecurity = isDoneOrImpossible(gateEntry.security);
          const hasCompliance = isDoneOrImpossible(gateEntry.compliance);
          const hasQA = isDoneOrImpossible(gateEntry.qa);
          const isFoundation = name.startsWith("foundation-");
          if (
            isFoundation ||
            (hasEval && hasSecurity && hasCompliance && hasQA)
          ) {
            gatedFeatures.add(name);
          } else {
            const missing = [];
            if (!hasEval)
              missing.push(
                `reviewer (got: ${JSON.stringify(reviewerVerdict)})`,
              );
            if (!hasSecurity)
              missing.push(
                `security (got: ${JSON.stringify(gateEntry.security)})`,
              );
            if (!hasCompliance)
              missing.push(
                `compliance (got: ${JSON.stringify(gateEntry.compliance)})`,
              );
            if (!hasQA)
              missing.push(`qa (got: ${JSON.stringify(gateEntry.qa)})`);
            const blockMsg =
              `[gauntlet-gate] BLOCKED: Feature "${name}" GATE_CHECK not complete: ${missing.join(", ")}. ` +
              `Each reviewer must be "pass-*", "done-*", or "impossible-{reason}". ` +
              `"skipped", "pending", "fail" are NOT accepted.`;
            process.stderr.write(blockMsg + "\n");
            logEvent(
              "block",
              "system",
              "gauntlet-gate-incomplete",
              name,
              blockMsg.slice(0, 200),
            );
            process.exit(2);
          }
        } else {
          gatedFeatures.add(name);
        }
      }
    }

    const missing = deps.filter((d) => !gatedFeatures.has(d));

    if (missing.length > 0) {
      const blockMsg = `Cannot dispatch builder for "${feature}". Dependencies missing GATE_CHECK: ${missing.join(", ")}`;
      process.stderr.write(`[gauntlet-gate] BLOCKED: ${blockMsg}\n`);
      logEvent(
        "block",
        "system",
        "gauntlet-gate-deps",
        feature,
        blockMsg.slice(0, 200),
      );
      process.exit(2);
    }

    logEvent(
      "decision",
      "system",
      "gauntlet-gate-passed",
      feature,
      `deps satisfied: ${deps.join(", ")}`,
    );
    process.exit(0);
  } catch (err) {
    const errMsg = `gauntlet-gate parse error (fail-closed): ${err.message}`;
    process.stderr.write(`[gauntlet-gate] BLOCKED: ${errMsg}\n`);
    logEvent(
      "block",
      "system",
      "gauntlet-gate-error",
      "",
      errMsg.slice(0, 200),
    );
    process.exit(2);
  }
});
