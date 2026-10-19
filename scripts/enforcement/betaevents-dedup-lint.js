"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { duplicateKeys } = require("./dedup-util");

const VERDICT_RE = /^(DECIDE|DIRECTIVE|ESCALATE)$/;

function paths() {
  try {
    const P = require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS;
    return { betaEvents: P.betaEvents, eventsFile: P.eventsFile };
  } catch {
    return {
      betaEvents: path.join(".claude", "agents", "president", "_system", "beta", "events.jsonl"),
      eventsFile: path.join(".claude", "project", "events", "events.jsonl"),
    };
  }
}

function parseVerdictRows(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let r;
    try { r = JSON.parse(t); } catch { continue; }
    const decision = typeof r.decision === "string" ? r.decision : null;
    if (decision && VERDICT_RE.test(decision)) rows.push(r);
  }
  return rows;
}

function extractMsgIds(eventsText) {
  const set = new Set();
  const re = /"msg_id"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(String(eventsText || ""))) !== null) set.add(m[1]);
  return set;
}

const MSGID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
function realMsgId(r) {
  if (!r || typeof r.msg_id !== "string") return null;
  return MSGID_RE.test(r.msg_id) ? r.msg_id : null;
}

function analyze({ betaText, eventsText }) {
  if (betaText == null) return { skipped: true };
  const rows = parseVerdictRows(betaText);
  const dups = duplicateKeys(rows, realMsgId);
  const missingMsgId = rows.filter((r) => !realMsgId(r)).length;
  let unresolved = [];
  let resolutionSkipped = false;
  let lowConfidence = false;
  const logUnreachable = eventsText == null;
  if (logUnreachable) {
    resolutionSkipped = true;
  } else {
    const msgIds = extractMsgIds(eventsText);
    const withId = rows.map(realMsgId).filter(Boolean);
    const notFound = withId.filter((id) => !msgIds.has(id));
    const resolvedFraction = withId.length ? (withId.length - notFound.length) / withId.length : 1;
    const THRESHOLD = 0.8;
    lowConfidence = withId.length > 0 && resolvedFraction < THRESHOLD;
    unresolved = notFound;
    resolutionSkipped = lowConfidence;
  }
  return { skipped: false, dupMsgIds: dups.map((d) => d.key), missingMsgId, unresolved, resolutionSkipped, lowConfidence, logUnreachable };
}

if (require.main === module) {
  const enforce = process.argv.includes("--enforce");
  const argVal = (flag) => { const i = process.argv.indexOf(flag); return i === -1 ? null : (process.argv[i + 1] || null); };
  const { betaEvents, eventsFile } = paths();
  const betaOverride = argVal("--beta");
  const eventsOverride = argVal("--events");
  const beta = betaOverride ? path.resolve(betaOverride) : (path.isAbsolute(betaEvents) ? betaEvents : path.join(ROOT, betaEvents));
  const events = eventsOverride ? path.resolve(eventsOverride) : (path.isAbsolute(eventsFile) ? eventsFile : path.join(ROOT, eventsFile));

  let betaText = null;
  try { betaText = fs.readFileSync(beta, "utf8"); } catch { betaText = null; }
  if (betaText == null) {
    console.log("betaevents-dedup-lint: SKIP — betaEvents absent/unreadable (gitignored advisory ledger; scan-session-only). Not a fresh-clone gate.");
    process.exit(0);
  }
  let eventsText = null;
  try { eventsText = fs.readFileSync(events, "utf8"); } catch { eventsText = null; }

  const res = analyze({ betaText, eventsText });
  const blocking = enforce && (res.dupMsgIds.length > 0 || res.missingMsgId > 0 || (!res.logUnreachable && res.unresolved.length > 0));
  const showUnresolved = res.unresolved.length > 0 && (blocking || !res.resolutionSkipped);
  const lines = [];
  if (res.dupMsgIds.length) lines.push(`  DUPLICATE msg_id on >1 verdict row (a delivery logged twice): ${res.dupMsgIds.join(", ")}`);
  if (res.missingMsgId) lines.push(`  ${res.missingMsgId} verdict-shaped row(s) OMIT msg_id — a well-formed verdict must carry a resolvable msg_id${enforce ? " (BLOCKING under --enforce, independent of log reachability)" : " (advisory — β should stamp its delivery msg_id)"}.`);
  if (showUnresolved) lines.push(`  ${res.unresolved.length} msg_id(s) not resolving in the message log${res.lowConfidence ? " (LOW-confidence log — under --enforce this fails closed)" : " (advisory)"}: ${res.unresolved.join(", ")}`);
  else if (res.resolutionSkipped) lines.push(`  msg_id-resolution: SKIPPED (report-only) — ${res.logUnreachable ? "message log unreachable" : "low-confidence log (<80% resolve, likely a truncated preview)"} (fail-open advisory).`);

  if (!lines.length) {
    console.log("betaevents-dedup-lint: OK — no duplicate verdict msg_id; all msg_ids resolve.");
    process.exit(0);
  }
  console[blocking ? "error" : "log"](`betaevents-dedup-lint: ${blocking ? "FAIL" : "findings (report-only)"}:`);
  for (const l of lines) console[blocking ? "error" : "log"](l);
  process.exit(blocking ? 1 : 0);
}

module.exports = { analyze, parseVerdictRows, extractMsgIds, realMsgId };
