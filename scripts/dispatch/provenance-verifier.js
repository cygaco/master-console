"use strict";
const HUNTER_ROLE = "security_claude_hunter";
const IN_PROCESS_SHAPE = "in-process-agent";
const SUBPROCESS_CLAUDE_SHAPE = "subprocess-claude";
const CROSS_PROVIDER_SHAPE = "subprocess-cross-provider";
const PANEL_ROLE = "security-reviewer";

const RECOGNIZED_PROFILES = Object.freeze(["panel-3lab", "panel-2family"]);

function assertRecognizedProfile(profileName) {
  if (!RECOGNIZED_PROFILES.includes(profileName)) {
    throw new Error(
      `provenance-verifier: unrecognized panel profile ${JSON.stringify(profileName)} — recognized profiles are ` +
        `[${RECOGNIZED_PROFILES.join(", ")}]. A typo'd/unknown/absent profile FAILS CLOSED; it must ` +
        `never default to the floor contract.`,
    );
  }
}

function isHunterRecord(r) {
  return !!r && r.provider === "claude" && r.shape === IN_PROCESS_SHAPE && r.role === HUNTER_ROLE;
}

function isSanctionedHunterLane(laneId, lane) {
  return !!lane && laneId === "claude" && lane.provider === "claude" && lane.shape === IN_PROCESS_SHAPE;
}

function claudeLaneContract(profileName) {
  assertRecognizedProfile(profileName);
  if (profileName === "panel-3lab") return { shape: IN_PROCESS_SHAPE, role: HUNTER_ROLE, isHunter: true };
  return { shape: SUBPROCESS_CLAUDE_SHAPE, role: PANEL_ROLE, isHunter: false };
}

function laneContract(profileName, provider) {
  assertRecognizedProfile(profileName);
  if (provider === "claude") return claudeLaneContract(profileName);
  return { shape: CROSS_PROVIDER_SHAPE, role: PANEL_ROLE, isHunter: false };
}

function recordMatchesLane(r, contract, provider) {
  if (!r) return false;
  if (contract.isHunter) return isHunterRecord(r);
  return r.provider === provider && r.shape === contract.shape && r.role === contract.role;
}

function servedModelUnverifiableFromRecord(provider) {
  return provider === "antigravity";
}

const { readGitHead } = require("./git-head");

module.exports = {
  HUNTER_ROLE,
  IN_PROCESS_SHAPE,
  SUBPROCESS_CLAUDE_SHAPE,
  CROSS_PROVIDER_SHAPE,
  PANEL_ROLE,
  RECOGNIZED_PROFILES,
  assertRecognizedProfile,
  isHunterRecord,
  isSanctionedHunterLane,
  claudeLaneContract,
  laneContract,
  recordMatchesLane,
  servedModelUnverifiableFromRecord,
  readGitHead,
};
