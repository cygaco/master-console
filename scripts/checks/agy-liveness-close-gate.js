"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");

function loadVerifier() {
  try { return require(path.join(ROOT, "scripts", "dispatch", "attest-signing")).verifyRecord; }
  catch { return null; }
}

function evaluateAgyLivenessClose(record) {
  const r = record || {};
  const reasons = [];
  // liveness-verified: origin-proof (attest-signing.verifyRecord) is asserted at the read boundary
  const okTrue = r.ok === true;
  if (!okTrue) reasons.push(`ok must be true (got ${JSON.stringify(r.ok)})`);
  const providerAgy = r.provider === "antigravity";
  if (!providerAgy) reasons.push(`provider must be "antigravity" (got ${JSON.stringify(r.provider)})`);
  const toolAgy = r.tool_id === "agy";
  if (!toolAgy) reasons.push(`tool_id must be "agy" (got ${JSON.stringify(r.tool_id)})`);
  const providerFallbackClean = r.fallback === false;
  if (!providerFallbackClean) reasons.push(`fallback must be false (got ${JSON.stringify(r.fallback)})`);
  const authProven = r.auth_fallback === false;
  if (!authProven) {
    reasons.push(
      `auth_fallback must be EXACTLY false — an unauthenticated ("true") or unverifiable ("indeterminate") ` +
      `or unstamped (absent) serve cannot close (got ${JSON.stringify(r.auth_fallback)})`,
    );
  }
  const closeable = okTrue && providerAgy && toolAgy && providerFallbackClean && authProven;
  return { closeable, reasons, checks: { okTrue, providerAgy, toolAgy, providerFallbackClean, authProven } };
}

function latestVerifiedAgyRecord(completionsFile, sinceMs, verifyRecord = loadVerifier()) {
  let lines;
  try {
    lines = fs.readFileSync(completionsFile, "utf8").split("\n").filter(Boolean);
  } catch {
    return { record: null, skippedUnverified: 0 };
  }
  let best = null;
  let skippedUnverified = 0;
  const hasFloor = Number.isFinite(sinceMs) && sinceMs > 0;
  for (const ln of lines) {
    let rec;
    try { rec = JSON.parse(ln); } catch { continue; }
    if (!(rec.provider === "antigravity" && rec.tool_id === "agy")) continue;
    const ts = Date.parse(rec.completed_at || rec.started_at || "") || 0;
    if (hasFloor && ts < sinceMs) continue;
    if (!verifyRecord || !verifyRecord(rec)) { skippedUnverified++; continue; }
    if (!best || ts >= best._ts) { best = rec; best._ts = ts; }
  }
  return { record: best, skippedUnverified };
}

function resolveSinceMs(args) {
  const idx = args.indexOf("--since");
  if (idx < 0) return { ok: true, sinceMs: 0 };
  const val = args[idx + 1];
  const missing = val === undefined || String(val).startsWith("--");
  const sinceMs = missing ? NaN : Date.parse(val);
  if (!Number.isFinite(sinceMs)) {
    return { ok: false, reason: missing ? "--since is present with no value (bare flag)" : `--since "${val}" is not a valid date` };
  }
  return { ok: true, sinceMs };
}

module.exports = { evaluateAgyLivenessClose, latestVerifiedAgyRecord, resolveSinceMs };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const verifyRecord = loadVerifier();
  if (!verifyRecord) {
    console.error("agy close gate: attest-signing.verifyRecord unavailable — cannot verify origin-proof (fail-closed).");
    process.exit(2);
  }
  let record;
  const recordFile = get("--record");
  if (recordFile) {
    record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
    if (!verifyRecord(record)) {
      console.error(`agy close gate: the record at ${recordFile} FAILS origin-proof verification (unsigned/tampered/cross-session) — cannot close (fail-closed). Point --record at a SIGNED ledger record, or use the --since ledger path.`);
      process.exit(1);
    }
  } else {
    let completions = get("--completions");
    if (!completions) {
      try { completions = require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS.dispatchCompletionsFile; }
      catch { completions = path.join(".claude", "runtime", "dispatch-completions.jsonl"); }
    }
    if (!path.isAbsolute(completions)) completions = path.join(ROOT, completions);
    const sinceRes = resolveSinceMs(args);
    if (!sinceRes.ok) {
      console.error(`agy close gate: ${sinceRes.reason} — refusing (fail-closed; a bare or unparseable --since would silently admit an older record).`);
      process.exit(2);
    }
    const sinceMs = sinceRes.sinceMs;
    const found = latestVerifiedAgyRecord(completions, sinceMs, verifyRecord);
    if (!found.record) {
      const tail = found.skippedUnverified ? ` (${found.skippedUnverified} matched-but-unverified record(s) skipped — origin-proof required)` : "";
      console.error("agy close gate: NO verified antigravity record found" + (sinceMs ? ` since ${new Date(sinceMs).toISOString()}` : "") + tail + " — cannot close (fail-closed).");
      process.exit(1);
    }
    record = found.record;
  }
  const res = evaluateAgyLivenessClose(record);
  if (res.closeable) {
    console.log("agy LIVENESS close gate: PASS — signed agy record has ok:true, fallback:false, auth_fallback:false, tool_id:agy.");
    console.log("  (this gate checks liveness only, not the served model or panel-3lab — never cite a transport-clean serve as 'live'.)");
    process.exit(0);
  }
  console.error("agy LIVENESS close gate: FAIL — cannot close:");
  for (const reason of res.reasons) console.error("  - " + reason);
  process.exit(1);
}
