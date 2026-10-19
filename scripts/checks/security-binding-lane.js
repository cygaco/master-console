#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const NAME = "security-binding-lane";
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const VERIFIABLE = new Set(["openai", "claude"]);
const SCRIPTS_DIR = path.join(ROOT, "scripts");

function realDeps() {
  const pv = require("../dispatch/provenance-verifier");
  const rr = require("../dispatch/registry-roles");
  const panelLanes = require("../dispatch/panel-lanes");
  const providers = require("../hooks/lib/providers");
  const catalog = require("../dispatch/catalog");
  return {
    servedModelUnverifiableFromRecord: pv.servedModelUnverifiableFromRecord,
    passesOf: rr.passesOf,
    panel2family: () => {
      const m = panelLanes.loadManifest();
      const prof = (m.profiles || {})["panel-2family"] || {};
      const lanes = panelLanes.requiredLanes(m, "panel-2family");
      return { binding: prof.binding, min_families: prof.min_families, lanes };
    },
    getProviderForRole: providers.getProviderForRole,
    providersRaw: providers.LITERAL_DEFAULT_AGENT_PROVIDERS || providers.DEFAULT_AGENT_PROVIDERS || {},
    catalogRaw: catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE || catalog.DEFAULT_PROVIDER_PER_ROLE || {},
    literalsExported: !!(providers.LITERAL_DEFAULT_AGENT_PROVIDERS && catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE),
    loadSupportMatrix: panelLanes.loadSupportMatrix,
  };
}

const UNVERIFIABLE_LAB_ROW = "agy-antigravity";
function servedModelProofOpen(supportMatrix) {
  const rows = supportMatrix && typeof supportMatrix === "object" && !Array.isArray(supportMatrix) ? supportMatrix.rows : null;
  const row = rows && typeof rows === "object" && !Array.isArray(rows) ? rows[UNVERIFIABLE_LAB_ROW] : null;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { open: true, reason: `no support-matrix '${UNVERIFIABLE_LAB_ROW}' row → served-model proof not proven (strict)` };
  }
  const evidence = row.served_model_evidence_ref;
  const hasEvidence = typeof evidence === "string" && evidence.trim() !== "";
  if (row.served_model_proven === true && hasEvidence) {
    return { open: false, reason: `support-matrix ${UNVERIFIABLE_LAB_ROW} served_model_proven=true with evidence → relaxed` };
  }
  return {
    open: true,
    reason: row.served_model_proven === true
      ? `support-matrix ${UNVERIFIABLE_LAB_ROW} served_model_proven=true but no evidence ref → stay strict`
      : `support-matrix ${UNVERIFIABLE_LAB_ROW} served_model_proven=${JSON.stringify(row.served_model_proven === undefined ? "(absent)" : row.served_model_proven)} → not proven (strict)`,
  };
}

const REFERENCES_DISPATCH_AGENT_RE = /dispatch-agent\.js/;
const SECURITY_ROLE_RE = /[`'"](?:security-reviewer|redteam)[`'"]/;
const CREEP_BACK_ALLOWLIST = {
  "scripts/checks/model-chain.js": { type: "reference-only", reason: "names 'security-reviewer' as a role in check logic (MAX_ALLOWED_ROLES) + 'dispatch-agent' in comments; not a dispatch." },
  "scripts/dispatch/gauntlet-verify.js": { type: "reference-only", reason: "a comment naming the dispatch-agent.js completion ledger it READS; not a dispatch." },
  "scripts/hooks/dispatch-route-guard.js": { type: "reference-only", reason: "the ROUTING GUARD names the canonical `node scripts/dispatch-agent.js` route it ENFORCES; the enforcer, not a caller." },
  "scripts/hooks/lib/providers.js": { type: "reference-only", reason: "the transport lib names security-reviewer in provider-config comments; runProvider is the transport, not a single-pass security dispatch." },
  "scripts/mc/provider-smoke.js": { type: "reference-only", reason: "require()s dispatch-agent.js as a MODULE for getRoleModel (a ping smoke test); not a spawn of dispatch-agent.js with security-reviewer." },
  "scripts/dispatch/catalog.js": { type: "reference-only", reason: "the model catalog: its role maps key security-reviewer/redteam; data, not a dispatch." },
};
const CALLER_SHAPE_RE = /\[[^\]\n]*dispatch-agent\.js/;
function singlePassBindingCallers({ files, proofOpen = true } = {}) {
  const src = files || walkScriptsForCallers();
  const hits = [];
  for (const [rel, content] of Object.entries(src)) {
    if (typeof content !== "string") continue;
    const relN = rel.replace(/\\/g, "/");
    const allow = CREEP_BACK_ALLOWLIST[relN];
    if (allow) {
      if (allow.type === "reference-only" && !CALLER_SHAPE_RE.test(content)) continue;
      if (allow.type === "tracked-caller-proof-gated" && proofOpen) continue;
    }
    if (REFERENCES_DISPATCH_AGENT_RE.test(content) && SECURITY_ROLE_RE.test(content)) hits.push(relN);
  }
  return hits;
}
const WALK_EXACT_EXCLUDE = new Set([
  "scripts/dispatch-agent.js",
  "scripts/dispatch-review.js",
  "scripts/checks/security-binding-lane.js",
]);
const WALK_TEST_EXCLUDE = /(\.test\.js$)|((^|\/)test-[^/]*\.js$)/;
function isWalkExcluded(relN) {
  return WALK_EXACT_EXCLUDE.has(relN) || WALK_TEST_EXCLUDE.test(relN);
}
function walkScriptsForCallers() {
  const out = {};
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(full);
      } else if (e.name.endsWith(".js")) {
        const relN = path.relative(ROOT, full).replace(/\\/g, "/");
        if (isWalkExcluded(relN)) continue;
        try {
          out[relN] = fs.readFileSync(full, "utf8");
        } catch {
        }
      }
    }
  };
  walk(SCRIPTS_DIR);
  return out;
}

function evaluateSecurityBindingLane({ deps = realDeps(), supportMatrix, files } = {}) {
  const errors = [];
  const proof = servedModelProofOpen(supportMatrix);

  if (proof.open) {
    let p1;
    try {
      p1 = deps.servedModelUnverifiableFromRecord("antigravity") === true;
    } catch (e) {
      p1 = false;
    }
    if (!p1) {
      errors.push(
        `${NAME}: BINDING-LANE (P1) — the agy (antigravity) served-model is NOT forced un-attestable ` +
          `(servedModelUnverifiableFromRecord("antigravity") !== true) while served-model proof is open. An agy lane could ` +
          `then carry the binding security verdict — the exact unverifiable-binding risk ADR-0031 forbids. ` +
          `FIX: the binding verdict must resolve to a verifiable lane (openai|claude); keep agy un-attestable until served-model proof closes.`,
      );
    }
    try {
      const p2 = deps.panel2family();
      const lanes = p2.lanes || [];
      const verifiableLanes = lanes.filter((l) => VERIFIABLE.has(l.provider));
      const distinctFamilies = new Set(verifiableLanes.map((l) => l.provider));
      if (p2.binding !== false) {
        errors.push(`${NAME}: BINDING-LANE (P2) — panel-2family is the degraded FLOOR and must be binding:false (boolean); found ${JSON.stringify(p2.binding)}. FIX: the floor must be binding:false and never the sole binding contract.`);
      }
      if (typeof p2.min_families !== "number" || p2.min_families < 2 || verifiableLanes.length !== lanes.length || distinctFamilies.size < 2) {
        errors.push(
          `${NAME}: BINDING-LANE (P2) — the panel-2family floor must require ≥2 DISTINCT VERIFIABLE families ` +
            `(openai|claude; every required lane verifiable, agy not a required lane). Found required lanes ` +
            `[${lanes.map((l) => `${l.laneId}:${l.provider}`).join(", ")}], distinct-verifiable=${distinctFamilies.size}, ` +
            `min_families=${p2.min_families}. FIX: the binding floor must resolve to ≥2 distinct verifiable lanes only.`,
        );
      }
    } catch (e) {
      errors.push(`${NAME}: BINDING-LANE (P2) — could not read the panel-2family floor profile: ${e.message}. FIX: restore the panel manifest's panel-2family (non-agy, ≥2 families).`);
    }
    try {
      const passes = deps.passesOf("security-reviewer") || [];
      const verifiable = passes.filter((p) => VERIFIABLE.has(p.provider));
      if (verifiable.length < 1) {
        errors.push(
          `${NAME}: BINDING-LANE (P3) — passesOf("security-reviewer") has NO verifiable (openai|claude) pass ` +
            `[${passes.map((p) => p.provider).join(", ")}] — the binding verdict has no lane that CAN bind on a ` +
            `verifiable provider. FIX: keep a verifiable pass (the GPT/Claude passes) in the security-reviewer chain.`,
        );
      }
    } catch (e) {
      errors.push(`${NAME}: BINDING-LANE (P3) — could not read passesOf("security-reviewer"): ${e.message}.`);
    }
  }

  const catR = deps.catalogRaw || {};
  const provR = deps.providersRaw || {};
  if (deps.literalsExported === false) {
    errors.push(
      `${NAME}: ALIAS-CONSISTENCY (Tooth-B 1) — the independent raw LITERAL maps are NOT exported ` +
        `(catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE / providers.LITERAL_DEFAULT_AGENT_PROVIDERS), so Tooth-B(1) ` +
        `cannot compare independent sources (the derived maps are tautological — both from SCRAPPED_PROVIDER_ALIASES). ` +
        `FAIL-CLOSED. FIX: export the two literal maps (additive) so Tooth-B(1) verifies real agreement.`,
    );
  } else if (catR.redteam !== provR.redteam) {
    errors.push(
      `${NAME}: ALIAS-CONSISTENCY (Tooth-B 1) — the raw LITERAL DEFAULT_PROVIDER maps disagree on the redteam alias: ` +
        `catalog="${catR.redteam}" vs providers="${provR.redteam}". model-chain's registry-NAME-only drift loop ` +
        `misses alias keys. FIX: reconcile the redteam literal so catalog-literal and providers-literal agree.`,
    );
  }
  try {
    const a = deps.getProviderForRole("redteam");
    const b = deps.getProviderForRole("security-reviewer");
    if (a !== b) {
      errors.push(
        `${NAME}: ALIAS-CONSISTENCY (Tooth-B 2) — getProviderForRole("redteam")="${a}" ≠ ` +
          `getProviderForRole("security-reviewer")="${b}". redteam is a 1-hop alias and MUST normalize to ` +
          `security-reviewer's provider (so it can never resolve to a divergent, possibly-unverifiable lane). ` +
          `FIX: restore the redteam→security-reviewer normalization before the provider lookup.`,
      );
    }
  } catch (e) {
    errors.push(`${NAME}: ALIAS-CONSISTENCY (Tooth-B 2) — getProviderForRole failed: ${e.message}.`);
  }

  const callers = singlePassBindingCallers({ files, proofOpen: proof.open });
  for (const c of callers) {
    errors.push(
      `${NAME}: SINGLE-PASS CREEP-BACK — non-test caller "${c}" routes security-reviewer as a single-pass ` +
        `dispatch (dispatch-agent … security-reviewer), bypassing dispatch-review's panel gate → the binding ` +
        `verdict could resolve getProviderForRole=antigravity directly. FIX: route security-reviewer through ` +
        `dispatch-review.js (multi-pass panel gate), never a single-pass dispatch-agent binding call.`,
    );
  }

  return { errors, servedModelProof: proof };
}

function main(argv) {
  const json = argv.includes("--json");
  let supportMatrix = null;
  let deps;
  try {
    deps = realDeps();
  } catch (e) {
    process.stderr.write(`${NAME}: FAIL-CLOSED — reuse modules unavailable: ${e.message}\n`);
    return 2;
  }
  try {
    supportMatrix = deps.loadSupportMatrix();
  } catch {
    supportMatrix = null;
  }

  const { errors, servedModelProof } = evaluateSecurityBindingLane({ deps, supportMatrix });
  if (json) {
    process.stdout.write(JSON.stringify({ name: NAME, ok: errors.length === 0, servedModelProof, errors }, null, 2) + "\n");
  } else if (errors.length === 0) {
    process.stdout.write(`${NAME}: OK — security binding lane verifiable (${servedModelProof.reason}); redteam alias consistent; no single-pass creep-back.\n`);
  } else {
    process.stdout.write(`${NAME}: ${errors.length} finding(s) [${servedModelProof.reason}]:\n${errors.map((e) => "  - " + e).join("\n")}\n`);
  }
  return errors.length === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  NAME,
  VERIFIABLE,
  servedModelProofOpen,
  singlePassBindingCallers,
  isWalkExcluded,
  CREEP_BACK_ALLOWLIST,
  evaluateSecurityBindingLane,
  realDeps,
};
