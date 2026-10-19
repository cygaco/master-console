
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { STAGED_FILE } = require("./config");
const {
  resolveImpactFromFiles,
  resolveImpactFromRequirements,
} = require("./resolve-impact");
const { classify, recommend } = require("./classify-drift");

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function newId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString("hex");
  return `rco-${ts}-${rand}`;
}

function ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildRCO(base) {
  const changedFiles = base.changedFiles || [];
  const changedRequirements = base.changedRequirements || [];

  let impact;
  if (changedFiles.length) {
    impact = resolveImpactFromFiles(changedFiles);
  } else if (changedRequirements.length) {
    const r = resolveImpactFromRequirements(changedRequirements);
    impact = {
      features: r.features,
      requirements: r.requirements,
      downstreamFeatures: r.downstreamFeatures,
      sharedContractsTouched: [],
      unmappedFiles: [],
    };
  } else {
    impact = {
      features: [],
      requirements: [],
      downstreamFeatures: [],
      sharedContractsTouched: [],
      unmappedFiles: [],
    };
  }

  const rcoCore = {
    id: newId(),
    stagedAt: new Date().toISOString(),
    trigger: base.trigger || "manual",
    sourceFile: base.sourceFile || null,
    commitSha: gitHead(),
    changedFiles,
    changedRequirements,
    impactedFeatures: impact.features,
    impactedRequirements: impact.requirements,
    downstreamFeatures: impact.downstreamFeatures,
    sharedContractsTouched: impact.sharedContractsTouched,
    unmappedFiles: impact.unmappedFiles,
    summary: base.summary || "",
    diffSummary: base.diffSummary || "",
    reason: base.reason || base.trigger || "manual",
    agentSummary: base.agentSummary || "",
    status: "open",
  };

  const classifierInput = {
    ...rcoCore,
    oldString: base.oldString || "",
    newString: base.newString || "",
    diffText: base.diffText || "",
  };
  const drClass = classify(classifierInput);
  const recs = recommend(rcoCore, drClass);

  return {
    ...rcoCore,
    riskClass: drClass,
    recommendedSpecUpdate: recs.recommendedSpecUpdate,
    recommendedTestUpdate: recs.recommendedTestUpdate,
    requiresHuman: recs.requiresHuman,
  };
}

function appendRCO(rco) {
  ensureDir(STAGED_FILE);
  fs.appendFileSync(STAGED_FILE, JSON.stringify(rco) + "\n");
  return rco;
}

function stageRCO(base) {
  const rco = buildRCO(base);
  return appendRCO(rco);
}

function readAllRCOs() {
  if (!fs.existsSync(STAGED_FILE)) return [];
  const lines = fs
    .readFileSync(STAGED_FILE, "utf8")
    .split("\n")
    .filter((x) => x.trim());
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
    }
  }
  return out;
}

function backfill() {
  if (!fs.existsSync(STAGED_FILE)) return { processed: 0, mutated: 0 };
  const lines = fs.readFileSync(STAGED_FILE, "utf8").split("\n");
  let mutated = 0;
  let processed = 0;
  const out = [];
  for (const raw of lines) {
    if (!raw.trim()) {
      out.push(raw);
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      out.push(raw);
      continue;
    }
    processed += 1;
    let changed = false;
    if (!("riskClass" in entry)) {
      const inferredClass = classify({
        changedFiles: entry.changedFiles || entry.files || [],
        impactedRequirements: entry.impactedRequirements || [],
        sharedContractsTouched: entry.sharedContractsTouched || [],
        diffSummary: entry.diffSummary || entry.reason || "",
      });
      entry.riskClass = inferredClass;
      changed = true;
    }
    if (!("impactedRequirements" in entry)) {
      entry.impactedRequirements = [];
      changed = true;
    }
    if (!("impactedTests" in entry)) {
      entry.impactedTests = [];
      changed = true;
    }
    if (!("downstreamFeatures" in entry)) {
      entry.downstreamFeatures = [];
      changed = true;
    }
    if (!("requiresHuman" in entry)) {
      entry.requiresHuman = entry.riskClass === "C";
      changed = true;
    }
    if (!("recommendedSpecUpdate" in entry)) {
      entry.recommendedSpecUpdate = recommend(
        entry,
        entry.riskClass,
      ).recommendedSpecUpdate;
      changed = true;
    }
    if (!("recommendedTestUpdate" in entry)) {
      entry.recommendedTestUpdate = recommend(
        entry,
        entry.riskClass,
      ).recommendedTestUpdate;
      changed = true;
    }
    if (!("agentSummary" in entry)) {
      entry.agentSummary = "";
      changed = true;
    }
    if (!("status" in entry)) {
      entry.status = "open";
      changed = true;
    }
    if (!("schemaVersion" in entry)) {
      entry.schemaVersion = 2;
      changed = true;
    }
    if (changed) mutated += 1;
    out.push(JSON.stringify(entry));
  }
  fs.writeFileSync(
    STAGED_FILE,
    out.filter((x) => x !== "").join("\n") + (out.length ? "\n" : ""),
  );
  return { processed, mutated };
}

module.exports = {
  buildRCO,
  appendRCO,
  stageRCO,
  readAllRCOs,
  backfill,
};

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === "--backfill") {
    const r = backfill();
    console.log(
      `Backfill complete: processed=${r.processed} mutated=${r.mutated}`,
    );
  } else {
    console.error("Usage: node scripts/requirements/stage-rco.js --backfill");
    process.exit(2);
  }
}
