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
  return { shape: IN_PROCESS_SHAPE, role: HUNTER_ROLE, isHunter: true };
}

function hunterBindingDigest(packetSha, evidenceSha) {
  return require("crypto").createHash("sha256").update(`hunter-binding\n${String(packetSha)}\n${String(evidenceSha)}`).digest("hex");
}

function hunterPacketBound(r, expectedPacketSha) {
  if (!r || typeof expectedPacketSha !== "string" || !/^[0-9a-f]{64}$/.test(expectedPacketSha)) return false;
  if (r.packet_sha256 !== expectedPacketSha) return false;
  if (typeof r.evidence_sha !== "string" || !/^[0-9a-f]{64}$/.test(r.evidence_sha)) return false;
  return r.output_digest === hunterBindingDigest(r.packet_sha256, r.evidence_sha);
}

const HUNTER_WINDOW_MS = 60 * 60 * 1000;

function hunterWindowFor(cliRecords, fallbackUntilMs) {
  const starts = (cliRecords || []).map((r) => Date.parse((r && r.started_at) || ""));
  const readable = starts.filter(Number.isFinite);
  const untilMs = readable.length ? Math.min(...readable) : fallbackUntilMs;
  if ((readable.length && readable.length !== starts.length) || !Number.isFinite(untilMs)) {
    return { sinceMs: Infinity, untilMs: -Infinity };
  }
  return { sinceMs: untilMs - HUNTER_WINDOW_MS, untilMs };
}

function hunterVerdictFor(records, { panelRunId, sprintId, packetSha, verify, sinceMs, untilMs } = {}) {
  const out = (verdict, record, reason) => ({ verdict, record, reason });
  const bound = (records || []).filter(
    (r) =>
      !!panelRunId && typeof verify === "function" && verify(r) === true && isHunterRecord(r) &&
      r.panel_run_id === panelRunId && (sprintId == null || r.sprint_id === sprintId) && hunterPacketBound(r, packetSha),
  );
  const isLive = (r) => r.ok === true && r.fallback === false;
  const isClean = (r) => r.verdict === "pass" || r.verdict === "warn";
  const inWindow = (r) => {
    if (sinceMs == null && untilMs == null) return true;
    const t = Date.parse(r.completed_at || "");
    return Number.isFinite(t) && (sinceMs == null || t >= sinceMs) && (untilMs == null || t <= untilMs);
  };
  const carrier = bound.find((r) => isLive(r) && isClean(r) && inWindow(r)) || null;
  if (bound.some((r) => String(r.verdict).toLowerCase() === "fail")) {
    return out("fail", carrier, "a signed hunter record of this run and packet says fail");
  }
  if (bound.some((r) => !isLive(r) || !isClean(r))) {
    return out("error", carrier, "a signed hunter record of this run and packet is not a live pass or warn");
  }
  if (!carrier) return out("error", null, "no live signed hunter pass or warn for this run and packet inside the time bounds");
  const verdict = bound.some((r) => r.verdict === "warn") ? "warn" : "pass";
  return out(verdict, carrier, "every signed hunter record of this run and packet is a live pass or warn");
}

function liveOtherLabRecordFor(records, { panelRunId, verify } = {}) {
  if (!panelRunId || typeof verify !== "function") return null;
  return (
    (records || []).find(
      (r) =>
        verify(r) === true && r.panel_run_id === panelRunId && typeof r.provider === "string" && r.provider !== "claude" &&
        r.ok === true,
    ) || null
  );
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
  HUNTER_WINDOW_MS,
  hunterWindowFor,
  IN_PROCESS_SHAPE,
  SUBPROCESS_CLAUDE_SHAPE,
  CROSS_PROVIDER_SHAPE,
  PANEL_ROLE,
  RECOGNIZED_PROFILES,
  assertRecognizedProfile,
  isHunterRecord,
  isSanctionedHunterLane,
  claudeLaneContract,
  hunterBindingDigest,
  hunterPacketBound,
  hunterVerdictFor,
  liveOtherLabRecordFor,
  laneContract,
  recordMatchesLane,
  servedModelUnverifiableFromRecord,
  readGitHead,
};
