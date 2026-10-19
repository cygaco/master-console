
const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./paths");

const REGISTRY_FILE = path.join(
  PROJECT,
  ".claude",
  "agents",
  "_org",
  "mode-lifecycle.json",
);

const FALLBACK = {
  solo: { roster: [], requires_team: false },
  adhoc: { roster: ["alpha", "beta", "gamma"], requires_team: true },
  oneshot: { roster: ["delta"], requires_team: false },
  sprint: { roster: ["alpha", "epsilon", "beta"], requires_team: true },
};

function loadModes(registryPath = REGISTRY_FILE) {
  try {
    const doc = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    if (doc && doc.modes && typeof doc.modes === "object") return doc.modes;
  } catch {
  }
  return null;
}

function isWellFormedEntry(e) {
  return (
    !!e &&
    typeof e === "object" &&
    !Array.isArray(e) &&
    Array.isArray(e.roster) &&
    e.roster.every((r) => typeof r === "string") &&
    typeof e.requires_team === "boolean"
  );
}

function modeEntry(mode, registryPath = REGISTRY_FILE) {
  const m = String(mode || "").toLowerCase();
  const modes = loadModes(registryPath);
  if (modes && isWellFormedEntry(modes[m])) return modes[m];
  return FALLBACK[m] || null;
}

function roster(mode, registryPath = REGISTRY_FILE) {
  const e = modeEntry(mode, registryPath);
  return e && Array.isArray(e.roster) ? e.roster.slice() : [];
}

function faces(mode, registryPath = REGISTRY_FILE) {
  return roster(mode, registryPath).filter(
    (r) => String(r).toLowerCase() !== "alpha",
  );
}

function requiresTeam(mode, registryPath = REGISTRY_FILE) {
  const e = modeEntry(mode, registryPath);
  return !!(e && e.requires_team);
}

function allFaces(registryPath = REGISTRY_FILE) {
  const modeKeys = Object.keys(FALLBACK);
  const set = new Set();
  for (const m of modeKeys) {
    for (const r of roster(m, registryPath)) {
      const id = String(r).toLowerCase();
      if (id !== "alpha") set.add(id);
    }
  }
  return set;
}

module.exports = {
  REGISTRY_FILE,
  FALLBACK,
  loadModes,
  modeEntry,
  roster,
  faces,
  requiresTeam,
  allFaces,
};
