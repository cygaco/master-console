
const fs = require("fs");
const path = require("path");

const { GRAPH_FILE, STAGED_FILE, STATUS_FILE } = require("./config");
const { runGate } = require("./gate");
const { stageRCO, readAllRCOs } = require("./stage-rco");
const { markStale, clearStale } = require("./status");
const { resolve } = require("./apply-rco");

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS ${name}`);
    pass += 1;
  } else {
    console.error(`FAIL ${name}${detail ? ": " + detail : ""}`);
    fail += 1;
  }
}

function snapshot(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function restore(file, content) {
  if (content === null) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } else {
    fs.writeFileSync(file, content);
  }
}

const stagedSnapshot = snapshot(STAGED_FILE);
const statusSnapshot = snapshot(STATUS_FILE);

try {
  const graphRaw = snapshot(GRAPH_FILE);
  check("graph_exists", graphRaw !== null);
  if (graphRaw) {
    const graph = JSON.parse(graphRaw);
    check(
      "graph_has_features",
      graph.features && Object.keys(graph.features).length > 0,
      `features=${graph.features ? Object.keys(graph.features).length : 0}`,
    );
    check(
      "graph_has_requirements",
      graph.counts && graph.counts.requirements > 0,
      `requirements=${graph.counts ? graph.counts.requirements : 0}`,
    );
    check(
      "graph_has_files_index",
      graph.files && Object.keys(graph.files).length > 0,
      `files=${graph.files ? Object.keys(graph.files).length : 0}`,
    );
    check(
      "graph_has_contracts",
      graph.contracts && Object.keys(graph.contracts).length === 6,
      `contracts=${graph.contracts ? Object.keys(graph.contracts).length : 0}`,
    );
  }

  const beforeCount = readAllRCOs().length;
  const rcoA = stageRCO({
    trigger: "test_gate",
    sourceFile: "src/lib/types.ts",
    changedFiles: ["src/lib/types.ts"],
    summary: "test: rename UserAccount.tier",
    diffSummary: "edit code refactor",
    reason: "synthetic-test",
  });
  const afterCount = readAllRCOs().length;
  check(
    "rco_appended",
    afterCount === beforeCount + 1,
    `before=${beforeCount} after=${afterCount}`,
  );
  check(
    "rco_has_riskClass",
    ["A", "B", "C"].includes(rcoA.riskClass),
    `riskClass=${rcoA.riskClass}`,
  );
  check(
    "rco_has_impactedRequirements",
    Array.isArray(rcoA.impactedRequirements) &&
      rcoA.impactedRequirements.length > 0,
    `count=${(rcoA.impactedRequirements || []).length}`,
  );

  const rcoC = stageRCO({
    trigger: "test_gate",
    sourceFile: "packages/shared/auth.ts",
    changedFiles: ["packages/shared/auth.ts"],
    summary: "test: change JWT signing algorithm",
    diffSummary: "auth jwt cookie token sessionContract",
    reason: "synthetic-test",
  });
  check(
    "contract_touch_is_class_c",
    rcoC.riskClass === "C",
    `riskClass=${rcoC.riskClass}`,
  );
  check(
    "class_c_requiresHuman",
    rcoC.requiresHuman === true,
    `requiresHuman=${rcoC.requiresHuman}`,
  );

  const summaryWithC = runGate();
  check(
    "gate_red_with_open_class_c",
    summaryWithC.red > 0,
    `red=${summaryWithC.red} yellow=${summaryWithC.yellow}`,
  );
  check(
    "gate_exit_2_with_class_c",
    !summaryWithC.ok,
    "summary.ok should be false",
  );

  resolve(rcoC.id, "applied", "test cleanup");
  resolve(rcoA.id, "dismissed", "test cleanup");
  const summaryClean = runGate();
  check(
    "gate_green_after_resolve",
    summaryClean.red === 0,
    `red=${summaryClean.red} ${JSON.stringify(summaryClean.results.filter((r) => r.severity === "red"))}`,
  );

  const graph = JSON.parse(snapshot(GRAPH_FILE));
  const sampleId = Object.keys(graph.requirements)[0];
  if (sampleId) {
    markStale([sampleId], "rco-test-orphan");
    const summaryStale = runGate();
    check(
      "gate_red_when_stale_without_rco",
      summaryStale.red > 0 ||
        summaryStale.results.some(
          (r) =>
            r.name === "stale_requirements_have_rco" && r.severity === "red",
        ),
      JSON.stringify(
        summaryStale.results.find(
          (r) => r.name === "stale_requirements_have_rco",
        ),
      ),
    );
    clearStale([sampleId], "rco-test-orphan");
  }

  console.log(`\n--- ${pass} pass, ${fail} fail ---`);
} finally {
  restore(STAGED_FILE, stagedSnapshot);
  restore(STATUS_FILE, statusSnapshot);
}

process.exit(fail === 0 ? 0 : 1);
