
const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./paths");
const mcEnv = require("./mc-env");

let _cache = null;

function loadConfig() {
  if (_cache) return _cache;
  const configPath = path.join(PROJECT, ".claude", "manifest.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    _cache = JSON.parse(raw);
    return _cache;
  } catch {
    return {
      project: { name: "unknown" },
      features: [],
      phases: [],
      fileOwnership: { foundation: [], features: {} },
      providers: {},
      paths: {},
      buildCommands: {},
      featureIdToDir: {},
    };
  }
}

function getProjectName() {
  return loadConfig().project?.name || "unknown";
}

function getFeatures() {
  return loadConfig().build?.features || loadConfig().features || [];
}

function getFeatureIds() {
  return getFeatures().map((f) => f.id);
}

function getDeps() {
  const deps = {};
  for (const f of getFeatures()) {
    deps[f.id] = f.dependencies || [];
  }
  return deps;
}

function getFoundationFiles() {
  return loadConfig().fileOwnership?.foundation || [];
}

function getFileOwnership() {
  return loadConfig().fileOwnership?.features || {};
}

function getProviders() {
  return loadConfig().providers || {};
}

function getPaths() {
  return loadConfig().paths || {};
}

function getBuildCommands() {
  return loadConfig().buildCommands || {};
}

function getPhases() {
  return loadConfig().build?.phases || loadConfig().phases || [];
}

function getFeatureIdToDir() {
  return (
    loadConfig().build?.featureIdToDir || loadConfig().featureIdToDir || {}
  );
}

function getAgentName() {
  return (
    loadConfig().agents?.team?.name || loadConfig().agentTeam?.name || "alex"
  );
}

function getAgentDir() {
  return path.join(PROJECT, ".claude", "agents", getAgentName());
}

function getAgentTeam() {
  return (
    loadConfig().agents?.team ||
    loadConfig().agentTeam || { name: "alex", identity: "Alex", agents: {} }
  );
}

function getProjectPaths() {
  return loadConfig().projectPaths || {};
}

function getProjectStack() {
  const cfg = loadConfig();
  const stack = cfg.project?.techStack;
  return Array.isArray(stack)
    ? stack.join(" + ")
    : cfg.project?.framework || "";
}

function getMcProduct() {
  const cfg = loadConfig();
  return (
    cfg.project?.slug ||
    cfg.mcProduct ||
    cfg.warpProduct ||
    getProjectName().toLowerCase()
  );
}

const OPERATOR_CONTRACT_STRICTNESS = new Set(["off", "advisory", "strict", "pedantic"]);
const OPERATOR_CONTRACT_DEFAULTS = Object.freeze({
  enabled: true,
  strictness: "strict",
  maxLinesBeforeHeader: 5,
  allowIdentifiers: false,
  extraCommandPrefixes: [],
});

function getOperatorContract() {
  const out = { ...OPERATOR_CONTRACT_DEFAULTS };
  let block = null;
  try {
    block = loadConfig().mc && loadConfig().mc.operatorContract;
  } catch {
    block = null;
  }
  if (block && typeof block === "object") {
    if (typeof block.enabled === "boolean") out.enabled = block.enabled;
    if (typeof block.strictness === "string" && OPERATOR_CONTRACT_STRICTNESS.has(block.strictness)) {
      out.strictness = block.strictness;
    }
    if (typeof block.maxLinesBeforeHeader === "number" && block.maxLinesBeforeHeader > 0) {
      out.maxLinesBeforeHeader = block.maxLinesBeforeHeader;
    }
    if (typeof block.allowIdentifiers === "boolean") out.allowIdentifiers = block.allowIdentifiers;
    if (Array.isArray(block.extraCommandPrefixes)) {
      out.extraCommandPrefixes = block.extraCommandPrefixes.filter((p) => typeof p === "string");
    }
  }

  const envEnabled = mcEnv.readEnv("OPERATOR_CONTRACT_ENABLED");
  if (envEnabled === "0" || envEnabled === "false") out.enabled = false;
  if (envEnabled === "1" || envEnabled === "true") out.enabled = true;

  const envStrictness = mcEnv.readEnv("OPERATOR_CONTRACT");
  if (typeof envStrictness === "string" && OPERATOR_CONTRACT_STRICTNESS.has(envStrictness)) {
    out.strictness = envStrictness;
    if (envStrictness === "off") out.enabled = false;
  }

  return out;
}

const EVENT_CONTRACT_PREFIX_DEFAULT = "app";

function getEventContractPrefix() {
  let value = null;
  try {
    value = loadConfig().mc && loadConfig().mc.eventContractPrefix;
  } catch {
    value = null;
  }
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return EVENT_CONTRACT_PREFIX_DEFAULT;
}

function clearCache() {
  _cache = null;
}

module.exports = {
  loadConfig,
  getProjectName,
  getFeatures,
  getFeatureIds,
  getDeps,
  getFoundationFiles,
  getFileOwnership,
  getProviders,
  getPaths,
  getBuildCommands,
  getPhases,
  getFeatureIdToDir,
  getAgentName,
  getAgentDir,
  getAgentTeam,
  getProjectPaths,
  getProjectStack,
  getMcProduct,
  getOperatorContract,
  OPERATOR_CONTRACT_STRICTNESS,
  getEventContractPrefix,
  EVENT_CONTRACT_PREFIX_DEFAULT,
  clearCache,
};
