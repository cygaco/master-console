
const path = require("path");
const fs = require("fs");

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || ".");

let PATHS = {};
try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
  );
  PATHS = Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => k !== "version" && k !== "$schema")
      .map(([k, v]) => [k, path.join(PROJECT, v)]),
  );
} catch {
  try {
    PATHS = require("./paths.generated").PATHS;
  } catch {
    PATHS = LEGACY_FALLBACK_PATHS();
  }
}

try {
  const mcDirs = require("./mc-dirs");
  for (const [key, value] of Object.entries(PATHS)) {
    if (typeof value !== "string") continue;
    const rel = path.relative(PROJECT, value);
    if (!mcDirs.legacySegment(rel.split(/[\\/]+/)[0])) continue;
    PATHS[key] = mcDirs.resolveProjectPath(PROJECT, rel);
  }
} catch {
}

function LEGACY_FALLBACK_PATHS() {
  return {
    events: path.join(PROJECT, ".claude", "project", "events"),
    memory: path.join(PROJECT, ".claude", "project", "memory"),
    maps: path.join(PROJECT, ".claude", "project", "maps"),
    reference: path.join(PROJECT, ".claude", "project", "reference"),
    runtime: path.join(PROJECT, ".claude", "runtime"),
    logs: path.join(PROJECT, ".claude", "runtime", "logs"),
    handoffs: path.join(PROJECT, ".claude", "runtime", "handoffs"),
    handoffLatest: path.join(PROJECT, ".claude", "runtime", "handoff.md"),
    plans: path.join(PROJECT, ".claude", "runtime", "plans"),
    agents: path.join(PROJECT, ".claude", "agents"),
    agentSystem: path.join(PROJECT, ".claude", "agents", "president", ".system"),
    betaSystem: path.join(
      PROJECT,
      ".claude",
      "agents",
      "president",
      ".system",
      "beta",
    ),
    commands: path.join(PROJECT, ".claude", "commands"),
    content: path.join(PROJECT, ".claude", "content"),
    dreams: path.join(PROJECT, ".claude", "dreams"),
    favorites: path.join(PROJECT, ".claude", "content", "favorites"),
    hooks: path.join(PROJECT, "scripts", "hooks"),
    hookLib: path.join(PROJECT, "scripts", "hooks", "lib"),
    patterns: path.join(PROJECT, "patterns"),
    requirements: path.join(PROJECT, "requirements"),
    manifest: path.join(PROJECT, ".claude", "manifest.json"),
    settings: path.join(PROJECT, ".claude", "settings.json"),
    store: path.join(PROJECT, ".claude", "agents", "store.json"),
    oneshotStore: path.join(
      PROJECT,
      ".claude",
      "agents",
      "president",
      ".system",
      "oneshot",
      "store.json",
    ),
    eventsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "events.jsonl",
    ),
    toolsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "tools.jsonl",
    ),
    requirementsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "requirements.jsonl",
    ),
    requirementsStagedFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "requirements-staged.jsonl",
    ),
    learningsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "memory",
      "learnings.jsonl",
    ),
    tracesFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "memory",
      "traces.jsonl",
    ),
    systemsFile: path.join(
      PROJECT,
      ".claude",
      "project",
      "memory",
      "systems.jsonl",
    ),
    specGraph: path.join(
      PROJECT,
      ".claude",
      "project",
      "maps",
      "SPEC_GRAPH.json",
    ),
    judgmentModel: path.join(
      PROJECT,
      ".claude",
      "agents",
      "president",
      ".system",
      "beta",
      "judgement-model.md",
    ),
    judgmentRecommendations: path.join(
      PROJECT,
      ".claude",
      "agents",
      "president",
      ".system",
      "beta",
      "judgement-model-recommendations.md",
    ),
    betaSourceData: path.join(
      PROJECT,
      ".claude",
      "agents",
      "president",
      ".system",
      "beta",
      "mined",
      "beta-source-data.md",
    ),
    betaEvents: path.join(
      PROJECT,
      ".claude",
      "agents",
      "president",
      ".system",
      "beta",
      "events.jsonl",
    ),
    lexicon: path.join(
      PROJECT,
      ".claude",
      "agents",
      "president",
      ".system",
      "lexicon.md",
    ),
    pathsLib: path.join(PROJECT, "scripts", "hooks", "lib", "paths.js"),
    loggerLib: path.join(PROJECT, "scripts", "hooks", "lib", "logger.js"),
  };
}

function relPath(filePath) {
  if (filePath == null || typeof filePath !== "string") return "";
  const abs = path.resolve(filePath);
  const proj = path.resolve(PROJECT);
  if (abs.startsWith(proj)) {
    return abs
      .slice(proj.length)
      .replace(/^[/\\]+/, "")
      .replace(/\\/g, "/");
  }
  return abs.replace(/\\/g, "/");
}

module.exports = { PROJECT, relPath, PATHS };
