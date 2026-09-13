#!/usr/bin/env node
"use strict";
/**
 * security-binding-lane (SP-20260720-003 D2) — closes ED-244 + RI-008.
 *
 * ED-244: ADR-0031 point-2 requires the security-reviewer/redteam BINDING verdict to resolve to a
 * VERIFIABLE provider (openai|claude), never the unverifiable agy lane, while ED-230 (served-model proof)
 * is open. There was NO enforcer of this — the invariant held only because agy is blocked-advisory. DoE +
 * β confirmed the CORRECT invariant is the PANEL BINDING invariant (NOT DEFAULT_PROVIDER ∈ {openai,claude},
 * which would fight ADR-0031 point-3 + trip model-chain drift + miss the multi-pass path). While ED-230 is
 * open, assert (reusing the runtime's OWN functions so the check can't drift from behavior):
 *   P1: servedModelUnverifiableFromRecord("antigravity") === true  (the choke-point that forces an agy
 *       record un-attestable → BLOCKED_ON_OPERATOR, never a binding PASS).
 *   P2: the panel-2family FLOOR requires ≥2 verifiable families (agy NOT a required lane; binding:false).
 *   P3: passesOf("security-reviewer") contains ≥1 verifiable (openai|claude) pass — a lane that CAN bind.
 *
 * RI-008: catalog↔providers DEFAULT_PROVIDER consistency INCLUDING the redteam ALIAS key — the gap
 * model-chain's registry-NAME-only drift loop misses. Tooth-B:
 *   (1) catalog-raw[redteam] === providers-raw[redteam]  (raw-map agreement; future-drift teeth).
 *   (2) getProviderForRole(redteam) === getProviderForRole(security-reviewer)  (redteam is a 1-hop alias;
 *       normalization must keep them identical, so redteam can never resolve to a divergent provider).
 *
 * AC-14 creep-back guard: RED if any NON-TEST, non-panel caller routes security-reviewer as a single-pass
 * binding dispatch (bypassing dispatch-review's panel gate) — makes "no such caller today" DURABLE.
 *
 * BLOCKING in scan:full. Exit: 0 clean · 1 findings · 2 fail-closed (unparseable INJECTED input only —
 * an absent/unreadable CANONICAL ledger resolves to STRICT-ENFORCE, not exit 2, per QL).
 */

const fs = require("fs");
const path = require("path");

const NAME = "security-binding-lane";
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const VERIFIABLE = new Set(["openai", "claude"]);
const SCRIPTS_DIR = path.join(ROOT, "scripts");

// ── real dependency wiring (injectable in tests) ─────────────────────────────────
function realDeps() {
  const pv = require("../dispatch/provenance-verifier");
  const rr = require("../dispatch/registry-roles");
  const panelLanes = require("../dispatch/panel-lanes");
  const providers = require("../hooks/lib/providers");
  const catalog = require("../dispatch/catalog");
  const { PATHS } = require("../hooks/lib/paths");
  return {
    // AC-13 KNOWN-LIMIT (regression-lock): servedModelUnverifiableFromRecord is NAME-SPECIFIC — it keys on
    // provider === "antigravity" (provenance-verifier). A NEW unverifiable provider, or an agy rename, would
    // pass P1 GREEN while the invariant ("no unverifiable provider binds") is violated. Documented in the .md;
    // out of scope to fix here. Do NOT let this call drift to a name-list that silently omits a new provider.
    servedModelUnverifiableFromRecord: pv.servedModelUnverifiableFromRecord,
    passesOf: rr.passesOf,
    panel2family: () => {
      const m = panelLanes.loadManifest();
      const prof = (m.profiles || {})["panel-2family"] || {};
      const lanes = panelLanes.requiredLanes(m, "panel-2family");
      return { binding: prof.binding, min_families: prof.min_families, lanes };
    },
    getProviderForRole: providers.getProviderForRole,
    // Tooth-B(1) compares the INDEPENDENT raw LITERAL maps (catalog HARDCODES redteam=openai; providers'
    // literal spreads SCRAPPED_PROVIDER_ALIASES) — NOT the DERIVED maps, which BOTH resolve the redteam alias
    // from the shared SCRAPPED_PROVIDER_ALIASES and so can never diverge (a production tautology — gauntlet-caught).
    // The literal maps are exported per the SP-20260720-003 gauntlet fix (α-gated additive export). The fallback
    // to the derived map keeps the check running pre-export — tautological until the export lands (named residual).
    providersRaw: providers.LITERAL_DEFAULT_AGENT_PROVIDERS || providers.DEFAULT_AGENT_PROVIDERS || {},
    catalogRaw: catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE || catalog.DEFAULT_PROVIDER_PER_ROLE || {},
    // Whether the two INDEPENDENT literal maps are actually exported. Tooth-B(1) FAILS CLOSED when they are
    // not (falling back to the tautological derived maps is not a real check — gauntlet R-2). Undefined in
    // tests (which inject the maps directly to exercise the comparison logic); only production sets it.
    literalsExported: !!(providers.LITERAL_DEFAULT_AGENT_PROVIDERS && catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE),
    enforcementDebtPath: PATHS.enforcementDebt,
  };
}

// ── ED-230 record-trust gate (fail-closed + closure-receipt) ─────────────────────
/**
 * Is ED-230 OPEN? FAIL-CLOSED: an unreadable/missing/empty ledger, no ED-230 record, a malformed record,
 * or a status:"closed" WITHOUT a non-empty closure receipt → OPEN (strict enforcement). Relax (open:false)
 * ONLY on the LAST-write-wins ED-230 record with status "closed" AND a non-empty closure_receipt/closed_ts.
 */
function ed230IsOpen(ledgerText) {
  if (typeof ledgerText !== "string" || ledgerText.trim() === "") {
    return { open: true, reason: "ledger absent/empty → assume OPEN (fail-closed)" };
  }
  let last = null;
  for (const line of ledgerText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try {
      rec = JSON.parse(t);
    } catch {
      // fail-closed: a malformed ledger line is a corruption signal → strict. It must NOT be silently
      // skipped (a malformed trailing line after a valid `closed` record would otherwise leave the close
      // effective — the gauntlet-caught fail-open). Any unparseable line forces OPEN.
      return { open: true, reason: "malformed ledger line (unparseable) → assume OPEN (fail-closed)" };
    }
    // A line that PARSES but is not a plain-object record (null, array, string, number, boolean) is also
    // malformed → fail-closed strict (gauntlet R-4: a `true`/`[]`/`null`/string line after a valid close must
    // not leave the close effective; the id check alone would silently skip it).
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      return { open: true, reason: "malformed ledger record (non-object) → assume OPEN (fail-closed)" };
    }
    if (rec.id === "ED-230") last = rec; // LAST-write-wins (append-only JSONL)
  }
  if (!last) return { open: true, reason: "no ED-230 record in a non-empty ledger → assume OPEN (fail-closed)" };
  const closed = last.status === "closed";
  const receiptRaw = last.closure_receipt != null ? last.closure_receipt : last.closed_ts;
  // require a NON-EMPTY STRING receipt — reject {}, [], true, 0, null and EVERY non-string truthy value
  // (a spoofable receipt type must never relax a security gate — gauntlet-caught).
  const hasReceipt = typeof receiptRaw === "string" && receiptRaw.trim() !== "";
  if (closed && hasReceipt) return { open: false, reason: "ED-230 status=closed WITH a closure receipt → relaxed" };
  return {
    open: true,
    reason: closed ? "ED-230 status=closed but receipt-less/empty → stay strict" : `ED-230 status=${last.status || "(none)"} → OPEN`,
  };
}

// ── AC-14 single-pass creep-back guard ────────────────────────────────────────────
/**
 * RED if any NON-TEST, non-panel-path caller routes security-reviewer as a single-pass binding dispatch
 * (a `dispatch-agent(.js)? security-reviewer` invocation that would resolve getProviderForRole=antigravity,
 * bypassing dispatch-review's panel gate). Injectable `files` ({ [relPath]: content }) for tests; default
 * walks scripts/ excluding *.test.js, dispatch-review.js (the SANCTIONED multi-pass path), and this file.
 */
// CONSERVATIVE-BY-CONSTRUCTION (gauntlet R-1→R-2: a regex SIGNAL is fundamentally bypassable — a literal
// `dispatch-agent … security-reviewer` missed delta's dynamic dispatch; a spawn-array signal then missed the
// bound-first form `const a = path.join(…,"dispatch-agent.js"); spawn([a, role])` and multi-line arrays. Both
// reviewers converged on "fail closed on UNRECOGNIZED callers"). So the guard is an ALLOWLIST-of-shape, not a
// denylist-of-pattern: any non-test file that references the dispatch-agent.js SUBPROCESS SCRIPT (.js) AND a
// security-reviewer/redteam role is a POTENTIAL single-pass caller → flagged, UNLESS it is on the audited
// allowlist (a documented-safe reference OR a tracked real caller). A NEW co-occurrence fails closed (RED)
// until triaged — this closes the bypass class no regex could (bound-first/multi-line all reference both terms).
// RESIDUAL (named): static co-occurrence cannot distinguish a reference from a live dispatch, nor catch a caller
// that constructs the "dispatch-agent.js" string dynamically (the AST ceiling). The STRUCTURAL close is a
// dispatch-time guard that refuses a single-pass security-reviewer binding — tracked as a follow-up ED.
const REFERENCES_DISPATCH_AGENT_RE = /dispatch-agent\.js/;
// Match the role in single-, double-, OR template-literal (backtick) form (gauntlet R-3: a template-literal
// `security-reviewer` caller bypassed the quote-only regex).
const SECURITY_ROLE_RE = /[`'"](?:security-reviewer|redteam)[`'"]/;
// The audited allowlist, SPLIT BY TYPE (gauntlet R-3):
//   - "reference-only": never a caller (a role name in check logic, a comment, or a require() module import)
//     → ALWAYS suppressed.
//   - "tracked-caller-ed230-gated": a real single-pass caller (delta) suppressed ONLY WHILE ED-230 is OPEN.
//     When ED-230 CLOSES (agy activation), it is FLAGGED again — the re-open trigger fires MECHANICALLY (not
//     just in a comment): the exposure goes live exactly when Tooth-A stops enforcing, so the guard must too.
const CREEP_BACK_ALLOWLIST = {
  "scripts/delta-final-gauntlet.js": {
    type: "tracked-caller-ed230-gated",
    reason:
      "TRACKED CALLER — delta oneshot gauntlet single-passes security-reviewer via dispatch-agent (dynamic ROLES " +
      "list). LATENT ED-244: binding-on-agy WHEN agy goes live. Suppressed + SAFE WHILE ED-230 is OPEN (agy " +
      "blocked-advisory reaps + delta-aggregate treats a dispatch-failed lane as non-pass). RE-OPEN TRIGGER " +
      "(mechanical): when ED-230 CLOSES / agy activates, this stops suppressing → delta is FLAGGED until it routes " +
      "security-reviewer through dispatch-review's panel. Follow-up ED. SP-20260720-003 gauntlet.",
  },
  "scripts/checks/model-chain.js": { type: "reference-only", reason: "names 'security-reviewer' as a role in check logic (MAX_ALLOWED_ROLES) + 'dispatch-agent' in comments; not a dispatch." },
  "scripts/dispatch/gauntlet-verify.js": { type: "reference-only", reason: "a comment naming the dispatch-agent.js completion ledger it READS; not a dispatch." },
  "scripts/hooks/dispatch-route-guard.js": { type: "reference-only", reason: "the ROUTING GUARD names the canonical `node scripts/dispatch-agent.js` route it ENFORCES; the enforcer, not a caller." },
  "scripts/hooks/lib/providers.js": { type: "reference-only", reason: "the transport lib names security-reviewer in provider-config comments; runProvider is the transport, not a single-pass security dispatch." },
  "scripts/mc/provider-smoke.js": { type: "reference-only", reason: "require()s dispatch-agent.js as a MODULE for getRoleModel (a ping smoke test); not a spawn of dispatch-agent.js with security-reviewer." },
};
// The caller SHAPE: dispatch-agent.js inside a spawn-args ARRAY literal. Used to CONTENT-QUALIFY the
// reference-only allowlist (gauntlet R-4: a file-wide suppress would hide a future real caller ADDED to a
// reference-only file). A reference-only file is suppressed ONLY while it does NOT contain this shape; if it
// gains the shape it is FLAGGED. (Residual: a bound-first/multi-line caller in a reference-only file is the
// named AST ceiling — the structural close is a dispatch-time guard.)
const CALLER_SHAPE_RE = /\[[^\]\n]*dispatch-agent\.js/;
function singlePassBindingCallers({ files, ed230Open = true } = {}) {
  const src = files || walkScriptsForCallers();
  const hits = [];
  for (const [rel, content] of Object.entries(src)) {
    if (typeof content !== "string") continue;
    const relN = rel.replace(/\\/g, "/");
    const allow = CREEP_BACK_ALLOWLIST[relN];
    if (allow) {
      // reference-only: suppressed ONLY while it stays a pure reference (no spawn-args caller SHAPE). If a
      // reference-only file GAINS the caller shape it fell through → FLAGGED (content-qualified, not file-wide).
      if (allow.type === "reference-only" && !CALLER_SHAPE_RE.test(content)) continue;
      // tracked-caller: suppressed ONLY while ED-230 is open; once closed → fall through → FLAG (re-open trigger)
      if (allow.type === "tracked-caller-ed230-gated" && ed230Open) continue;
    }
    if (REFERENCES_DISPATCH_AGENT_RE.test(content) && SECURITY_ROLE_RE.test(content)) hits.push(relN);
  }
  return hits;
}
// EXACT repo-relative sanctioned MECHANISMS excluded from the CALLER scan (gauntlet R-3: a suffix match
// `dispatch-review.js$` let a spoof at scripts/anything/dispatch-review.js be skipped — exclude only the EXACT
// canonical paths, so a spoof elsewhere IS scanned). These are dispatch mechanisms being invoked, not invokers:
// dispatch-agent.js is the single-pass TRANSPORT itself (references its own name + role tokens), dispatch-review.js
// is the sanctioned multi-pass PANEL, and this file is the guard itself.
const WALK_EXACT_EXCLUDE = new Set([
  "scripts/dispatch-agent.js",
  "scripts/dispatch-review.js",
  "scripts/checks/security-binding-lane.js",
]);
// A *.test.js or test-*.js file ANYWHERE is legitimately a test, not a live caller.
const WALK_TEST_EXCLUDE = /(\.test\.js$)|((^|\/)test-[^/]*\.js$)/;
/** Whether a repo-relative (forward-slash) path is excluded from the caller scan. Exported so the exact-path
 *  exclusion is regression-testable (a spoof at scripts/evil/dispatch-review.js must NOT be excluded). */
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
          /* skip unreadable */
        }
      }
    }
  };
  walk(SCRIPTS_DIR);
  return out;
}

// ── the core (PURE given its seams) ───────────────────────────────────────────────
/**
 * @param {object} opts { deps, ledgerText, files }
 * @returns {{ errors:string[], ed230:{open,reason} }}
 */
function evaluateSecurityBindingLane({ deps = realDeps(), ledgerText, files } = {}) {
  const errors = [];
  const ed230 = ed230IsOpen(ledgerText);

  // ── Tooth-A (ED-244) — only enforced WHILE ED-230 is open ──
  if (ed230.open) {
    // P1
    let p1;
    try {
      p1 = deps.servedModelUnverifiableFromRecord("antigravity") === true;
    } catch (e) {
      p1 = false;
    }
    if (!p1) {
      errors.push(
        `${NAME}: BINDING-LANE (P1) — the agy (antigravity) served-model is NOT forced un-attestable ` +
          `(servedModelUnverifiableFromRecord("antigravity") !== true) while ED-230 is open. An agy lane could ` +
          `then carry the binding security verdict — the exact unverifiable-binding risk ADR-0031 point-2 forbids. ` +
          `FIX: the binding verdict must resolve to a verifiable lane (openai|claude); keep agy un-attestable until ED-230 closes.`,
      );
    }
    // P2
    try {
      const p2 = deps.panel2family();
      const lanes = p2.lanes || [];
      const verifiableLanes = lanes.filter((l) => VERIFIABLE.has(l.provider));
      const distinctFamilies = new Set(verifiableLanes.map((l) => l.provider));
      // binding must be EXACTLY the boolean false — a truthy non-boolean (string "true", 1) that panelStatus
      // would coerce to binding:true must NOT read clean (gauntlet R-4: `=== true` missed a string "true").
      if (p2.binding !== false) {
        errors.push(`${NAME}: BINDING-LANE (P2) — panel-2family is the degraded FLOOR and must be binding:false (boolean); found ${JSON.stringify(p2.binding)}. FIX: the floor must be binding:false and never the sole binding contract.`);
      }
      // Every required floor lane must be VERIFIABLE (openai|claude — a gemini/unknown lane is NOT), AND the
      // floor must require ≥2 DISTINCT verifiable families. min_families must be a NUMBER (a string "2" that
      // coerces past `< 2` must NOT pass — gauntlet R-4). gauntlet-caught (qa: non-agy ≠ verifiable + type bug).
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
    // P3
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

  // ── Tooth-B (RI-008) — alias-inclusive DEFAULT_PROVIDER consistency (always checked) ──
  const catR = deps.catalogRaw || {};
  const provR = deps.providersRaw || {};
  if (deps.literalsExported === false) {
    // FAIL-CLOSED (gauntlet R-2): the two INDEPENDENT raw literal maps are not exported, so Tooth-B(1) fell
    // back to the DERIVED maps — which both resolve the redteam alias from the shared SCRAPPED_PROVIDER_ALIASES
    // and can NEVER diverge (a tautology, no teeth). Refuse to read green on a check that cannot verify.
    errors.push(
      `${NAME}: ALIAS-CONSISTENCY (RI-008.1) — the independent raw LITERAL maps are NOT exported ` +
        `(catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE / providers.LITERAL_DEFAULT_AGENT_PROVIDERS), so Tooth-B(1) ` +
        `cannot compare independent sources (the derived maps are tautological — both from SCRAPPED_PROVIDER_ALIASES). ` +
        `FAIL-CLOSED. FIX: export the two literal maps (additive, α-gated) so Tooth-B(1) verifies real agreement.`,
    );
  } else if (catR.redteam !== provR.redteam) {
    errors.push(
      `${NAME}: ALIAS-CONSISTENCY (RI-008.1) — the raw LITERAL DEFAULT_PROVIDER maps disagree on the redteam alias: ` +
        `catalog="${catR.redteam}" vs providers="${provR.redteam}". model-chain's registry-NAME-only drift loop ` +
        `misses alias keys. FIX: reconcile the redteam literal so catalog-literal and providers-literal agree.`,
    );
  }
  try {
    const a = deps.getProviderForRole("redteam");
    const b = deps.getProviderForRole("security-reviewer");
    if (a !== b) {
      errors.push(
        `${NAME}: ALIAS-CONSISTENCY (RI-008.2) — getProviderForRole("redteam")="${a}" ≠ ` +
          `getProviderForRole("security-reviewer")="${b}". redteam is a 1-hop alias and MUST normalize to ` +
          `security-reviewer's provider (so it can never resolve to a divergent, possibly-unverifiable lane). ` +
          `FIX: restore the redteam→security-reviewer normalization before the provider lookup.`,
      );
    }
  } catch (e) {
    errors.push(`${NAME}: ALIAS-CONSISTENCY (RI-008.2) — getProviderForRole failed: ${e.message}.`);
  }

  // ── AC-14 creep-back guard (ed230.open gates the tracked-caller suppression: delta is FLAGGED once ED-230 closes) ──
  const callers = singlePassBindingCallers({ files, ed230Open: ed230.open });
  for (const c of callers) {
    errors.push(
      `${NAME}: SINGLE-PASS CREEP-BACK — non-test caller "${c}" routes security-reviewer as a single-pass ` +
        `dispatch (dispatch-agent … security-reviewer), bypassing dispatch-review's panel gate → the binding ` +
        `verdict could resolve getProviderForRole=antigravity directly. FIX: route security-reviewer through ` +
        `dispatch-review.js (multi-pass panel gate), never a single-pass dispatch-agent binding call.`,
    );
  }

  return { errors, ed230 };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────
function main(argv) {
  const json = argv.includes("--json");
  // Read the CANONICAL ledger. QL FAIL-MODE: absent/unreadable ledger → ed230IsOpen returns OPEN (strict),
  // NOT exit 2. Exit 2 is reserved for genuinely unparseable INJECTED test input (never reached via the CLI).
  let ledgerText = "";
  let deps;
  try {
    deps = realDeps();
  } catch (e) {
    process.stderr.write(`${NAME}: FAIL-CLOSED — reuse modules unavailable: ${e.message}\n`);
    return 2;
  }
  try {
    ledgerText = fs.readFileSync(deps.enforcementDebtPath, "utf8");
  } catch {
    ledgerText = ""; // absent canonical ledger → OPEN → strict (fail-closed, not exit 2)
  }

  const { errors, ed230 } = evaluateSecurityBindingLane({ deps, ledgerText });
  if (json) {
    process.stdout.write(JSON.stringify({ name: NAME, ok: errors.length === 0, ed230, errors }, null, 2) + "\n");
  } else if (errors.length === 0) {
    process.stdout.write(`${NAME}: OK — security binding lane verifiable (${ed230.reason}); redteam alias consistent; no single-pass creep-back.\n`);
  } else {
    process.stdout.write(`${NAME}: ${errors.length} finding(s) [${ed230.reason}]:\n${errors.map((e) => "  - " + e).join("\n")}\n`);
  }
  return errors.length === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  NAME,
  VERIFIABLE,
  ed230IsOpen,
  singlePassBindingCallers,
  isWalkExcluded,
  CREEP_BACK_ALLOWLIST,
  evaluateSecurityBindingLane,
  realDeps,
};
