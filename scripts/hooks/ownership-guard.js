#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");
let normalizeRole = (r) => r;
try {
  ({ normalizeRole } = require("./lib/role-aliases"));
} catch {
}

let sourceDirs = ["src/", "extension/"];
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "manifest.json"), "utf8"),
  );
  if (Array.isArray(manifest.source_dirs) && manifest.source_dirs.length > 0) {
    sourceDirs = manifest.source_dirs.map((d) =>
      d.endsWith("/") ? d : d + "/",
    );
  }
} catch {
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input?.file_path || "";

    if (!filePath) {
      process.exit(0);
      return;
    }

    const rel = relPath(filePath);

    if (!sourceDirs.some((d) => rel.startsWith(d) || rel.includes("/" + d))) {
      process.exit(0);
      return;
    }

    const agentsDir = PATHS.agents || path.join(PROJECT, ".claude", "agents");
    const storePath = path.join(agentsDir, "store.json");

    if (!fs.existsSync(storePath)) {
      process.exit(0);
      return;
    }

    let store;
    try {
      store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    } catch (e) {
      process.stderr.write(
        `BLOCKED: ownership-guard could not read/parse store.json at "${storePath}" (${e && e.message ? e.message : "unknown error"}) — failing closed; file ownership could not be verified.\n`,
      );
      process.exit(2);
      return;
    }

    const heartbeat = store.heartbeat || {};
    const currentAgent = heartbeat.agent || "";
    const currentFeature = heartbeat.feature || "";

    const exemptAgents = new Set([
      "boss", "lead", "alpha", "gamma", "delta", "epsilon",
      "reviewer", "frontend-reviewer", "backend-reviewer", "qa-reviewer",
      "security-reviewer", "design-quality", "visual-review",
      "security", "fixer", "frontend-fixer", "backend-fixer", "security-fixer",
      "compliance", "evaluator", "redteam",
    ]);
    if (!currentAgent || exemptAgents.has(normalizeRole(String(currentAgent).toLowerCase()))) {
      process.exit(0);
      return;
    }

    const features = store.features || {};
    let ownerFeature = null;

    for (const [featureId, featureData] of Object.entries(features)) {
      const files = featureData.files || [];
      if (files.some((f) => rel === f || rel.endsWith("/" + f))) {
        ownerFeature = featureId;
        break;
      }
    }

    if (!ownerFeature) {
      if (sourceDirs.some((d) => rel.startsWith(d)) && currentFeature) {
        process.stderr.write(
          `[ownership-guard] WARN: "${rel}" is not in any feature's file list. ` +
            `If this is a new file for "${currentFeature}", add it to store.json features.${currentFeature}.files.\n`,
        );
      }
      process.exit(0);
      return;
    }

    if (currentFeature === ownerFeature) {
      process.exit(0);
      return;
    }

    const shared = store.sharedFiles || {};
    if (shared[rel]) {
      process.exit(0);
      return;
    }

    process.stderr.write(
      `BLOCKED: "${rel}" is owned by feature "${ownerFeature}" ` +
        `but you are building "${currentFeature}".\n` +
        `Only modify files in your own feature scope.\n`,
    );
    process.exit(2);
  } catch (e) {
    process.stderr.write(
      `BLOCKED: ownership-guard could not evaluate this edit (${e && e.message ? e.message : "unknown error"}) — failing closed; file ownership could not be verified.\n`,
    );
    process.exit(2);
  }
});
