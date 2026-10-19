const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const REGISTRY_FILE = path.join(ROOT, "framework", "paths.registry.json");

function loadRegistry(rootOverride) {
  const file = rootOverride
    ? path.join(rootOverride, "framework", "paths.registry.json")
    : REGISTRY_FILE;
  if (!fs.existsSync(file)) {
    throw new Error(`paths registry not found at ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function buildPathsJson(registry) {
  const out = {
    $schema: "mc/paths/v" + registry.version,
    version: registry.version,
  };
  for (const [key, entry] of Object.entries(registry.paths)) {
    if (entry.removedIn) continue;
    out[key] = entry.path;
  }
  return out;
}

function readMCVersion(rootOverride) {
  const file = rootOverride
    ? path.join(rootOverride, "version.json")
    : path.join(ROOT, "version.json");
  if (!fs.existsSync(file)) {
    throw new Error(`version.json not found at ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = {
  loadRegistry,
  buildPathsJson,
  readMCVersion,
};
