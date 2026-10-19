#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "provenance-invariants";
const CONSUMERS = ["scripts/checks/cert-attest.js", "scripts/dispatch-review.js", "scripts/dispatch/panel-lanes.js"];
const VERIFIER = "provenance-verifier";
const SERVED_MODEL_READERS = ["scripts/checks/cert-attest.js", "scripts/dispatch-review.js"];
const SERVED_MODEL_CHOKEPOINT = "servedModelUnverifiableFromRecord";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function stripComments(src) {
  return src.replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "");
}

const HUNTER_ROLE_VALUE = `["']security_claude_hunter["']`;
const SHAPE_VALUE = `["']in-process-agent["']`;
function hasLocalIdentityDecision(code) {
  const c = stripComments(code);
  return (
    new RegExp(HUNTER_ROLE_VALUE).test(c) ||
    /\bHUNTER_ROLE\b/.test(c) ||
    new RegExp(`(===|!==)\\s*${SHAPE_VALUE}`).test(c) ||
    new RegExp(`${SHAPE_VALUE}\\s*(===|!==)`).test(c) ||
    new RegExp(`=\\s*${SHAPE_VALUE}\\s*[;,)]`).test(c)
  );
}
function readsRecordRoleForDecision(code) {
  const c = stripComments(code);
  return (
    /\.role\s*\)?\s*(===|!==|==|!=)/.test(c) ||
    /(===|!==|==|!=)\s*\(?\s*[A-Za-z_$][\w$.[\]"']*\.role\b/.test(c) ||
    /\[\s*["']role["']\s*\]\s*\)?\s*(===|!==|==|!=)/.test(c) ||
    /(===|!==|==|!=)\s*\(?\s*[A-Za-z_$][\w$.[\]"']*\[\s*["']role["']\s*\]/.test(c) ||
    /Object\.is\(\s*[^)]*(\.role\b|\[\s*["']role["']\s*\])/.test(c) ||
    /switch\s*\(\s*[^)]*(\.role\b|\[\s*["']role["']\s*\])/.test(c) ||
    /(?:const|let|var)\s+\{[^}]*\brole\b[^}]*\}\s*=\s*[A-Za-z_$]/.test(c) ||
    /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\(?\s*[A-Za-z_$][\w$.[\]]*\.role\b/.test(c)
  );
}
function importsVerifier(code) {
  return new RegExp(`require\\([^)]*${VERIFIER}[^)]*\\)`).test(code);
}
function invokesServedModelChokePoint(code) {
  return new RegExp(`${SERVED_MODEL_CHOKEPOINT}\\s*\\(`).test(stripComments(code));
}
function hasInlineAgyRecordProviderCheck(code) {
  const c = stripComments(code);
  return (
    /\.provider\s*(===|!==|==|!=)\s*["']antigravity["']/.test(c) ||
    /["']antigravity["']\s*(===|!==|==|!=)\s*[A-Za-z_$][\w$.[\]"']*\.provider\b/.test(c)
  );
}
function gitHeadTokenValidated(src) {
  const packed = /function readPackedRef[\s\S]*?\n}/.exec(src);
  const readHead = /function readGitHead[\s\S]*?\n}/.exec(src);
  const packedOk = !!packed && /\[0-9a-f\]\{7,40\}/.test(packed[0]);
  const looseOk = !!readHead && (readHead[0].match(/\[0-9a-f\]\{7,40\}/g) || []).length >= 2;
  return packedOk && looseOk;
}

function run() {
  const violations = [];
  for (const f of CONSUMERS) {
    let src;
    try { src = read(f); } catch (e) { violations.push({ inv: "CONSUMER", file: f, msg: `unreadable (fail-closed): ${e.message}`, fatal: true }); continue; }
    if (!importsVerifier(src)) violations.push({ inv: "DELEGATE", file: f, msg: `does not import the ${VERIFIER} choke-point — it must consume the shared identity predicates, not re-implement them` });
    if (hasLocalIdentityDecision(src)) violations.push({ inv: "NO-LOCAL-IDENTITY", file: f, msg: "re-implements a lane/hunter-identity DECISION — compares/assigns an identity VALUE ('security_claude_hunter' or 'in-process-agent') outside the verifier. Delegate to provenance-verifier.isHunterRecord/recordMatchesLane; identity is derived from the channel (shape) + contract (role), NEVER a per-record field" });
    if (readsRecordRoleForDecision(src)) violations.push({ inv: "NO-RECORD-ROLE-DECISION", file: f, msg: "reads a record's .role field for an identity DECISION (member/computed/destructure/alias) outside the verifier — a COMPLETE hunter-identity decision requires the record's role, and honest consumers delegate to provenance-verifier.isHunterRecord/recordMatchesLane. This catches the value-reconstruction evasion (role assembled at runtime via join/concat/char-codes) that a value-only detector misses. A fully-computed field scan that never names .role is the honest static ceiling — defended by the live binding-evidence layer, not this guard." });
  }
  for (const f of SERVED_MODEL_READERS) {
    let src;
    try { src = read(f); } catch (e) { violations.push({ inv: "SERVED-MODEL-READER", file: f, msg: `unreadable (fail-closed): ${e.message}`, fatal: true }); continue; }
    if (!invokesServedModelChokePoint(src)) violations.push({ inv: "SERVED-MODEL-CHOKEPOINT", file: f, msg: `a served-model ledger reader that does not invoke pv.${SERVED_MODEL_CHOKEPOINT} — the agy served-model fail-close MUST route through the ONE choke-point, never an inline check` });
    if (hasInlineAgyRecordProviderCheck(src)) violations.push({ inv: "NO-INLINE-AGY-SERVED-MODEL", file: f, msg: `re-implements the agy served-model fail-close as an inline record/lane '.provider === "antigravity"' check — delegate to pv.${SERVED_MODEL_CHOKEPOINT}. The raw-CLI evaluator (providerId PARAM, not a record's .provider) is exempt by construction` });
  }
  let gh;
  try { gh = read("scripts/dispatch/git-head.js"); } catch (e) { violations.push({ inv: "GIT-HEAD-SHA", file: "scripts/dispatch/git-head.js", msg: `unreadable (fail-closed): ${e.message}`, fatal: true }); }
  if (gh && !gitHeadTokenValidated(gh)) violations.push({ inv: "GIT-HEAD-SHA", file: "scripts/dispatch/git-head.js", msg: "a ref-read path returns a token without hex-SHA validation" });
  return violations;
}

if (require.main === module) {
  const json = process.argv.includes("--json");
  let violations;
  try { violations = run(); } catch (e) { process.stderr.write(`FAIL [${NAME}] fail-closed: ${e.message}\n`); process.exit(2); }
  const fatal = violations.some((v) => v.fatal);
  if (json) process.stdout.write(JSON.stringify({ check: NAME, ok: violations.length === 0, violations }, null, 2) + "\n");
  else if (violations.length === 0) process.stdout.write(`OK   [${NAME}] all ${CONSUMERS.length} lane-identity consumers (${CONSUMERS.map((f) => f.split("/").pop()).join(", ")}) delegate identity to the provenance-verifier choke-point; no STATIC identity re-implementation (value-named), no consumer read of a record's .role for a decision, no settable-label identity; git-head SHA-validates every ref-read. HONEST CEILING: a fully-computed runtime obfuscator (never naming the value or .role) is not statically decidable — defended by the live same-run binding-evidence layer (ADR-0024), NOT this static guard\n`);
  else process.stderr.write(`FAIL [${NAME}] ${violations.length} drift(s):\n${violations.map((v) => `  - [${v.inv}] ${v.file}: ${v.msg}`).join("\n")}\n`);
  process.exit(violations.length === 0 ? 0 : fatal ? 2 : 1);
}

module.exports = { run, NAME, hasLocalIdentityDecision, readsRecordRoleForDecision, importsVerifier, gitHeadTokenValidated, invokesServedModelChokePoint, hasInlineAgyRecordProviderCheck };
