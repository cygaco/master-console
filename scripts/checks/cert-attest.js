#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * cert-attest.js — §7 certification-gate effective-model ATTESTATION (DISPATCH.md §7; ADR-0016).
 *
 * Dispatches a BOUNDED probe to a SPECIFIC model through the safe-spawn KERNEL and captures the
 * CLI output (stdout + stderr), then verifies the CLI's OWN self-identification of the model that
 * served — the authoritative "the reviewer actually ran on the intended model" proof β requires for
 * the Bucket-D flip GREEN. This defeats the `opts.model || provider.default_model` trap (a registry-
 * only migration that looks green while dispatch stays stale): if the CLI served the DEFAULT instead
 * of the requested `-m`, its echoed header names the default and the attestation FAILS.
 *
 * WHY A SCRIPT (not a raw shell probe): a raw `codex exec … -m <model>` from Bash is (correctly)
 * refused by the dispatch-route-guard / auto-classifier as guard-circumvention. This tool IS the
 * sanctioned path: it sets MC_PROVIDER_PROBE=1 process-INTERNALLY and spawns ONLY through
 * safeSpawnSync (shell:false, arg-allowlisted, abs-path tool, tree-kill) — never a raw shell string.
 * The operator/lead runs the plain `node scripts/checks/cert-attest.js --model <m>` top-level.
 *
 *   node scripts/checks/cert-attest.js --model gpt-5.6-sol [--provider openai] [--effort low] [--json]
 *
 * Exit: 0 ATTESTED (CLI output self-identifies the requested model; exit 0; non-empty) ·
 *       1 FAIL (mismatch / a DIFFERENT model named / dispatch error / empty output) ·
 *       2 usage / kernel unavailable (fail-closed).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "cert-attest";
// SP-20260723-002 / ADR-0037: the agy TERMINAL tell set + the run-window filter are SINGLE-SOURCED in
// scripts/dispatch/agy-auth-tells.js so the dispatch-record detector, cert-attest, and the ED-060 serve
// runbook key on ONE source (no drifting copy — the refactor-hygiene bug class). cert-attest consumes them.
const { NON_AUTH_SIGNAL, filterAgyLogToRunWindow, norm } = require("../dispatch/agy-auth-tells");
const ARTIFACT_DIR = path.join(ROOT, "runtime", "cert-attest");

// The SINGLE provenance-verifier choke-point (α round-6 / ED-225): the hunter-identity predicate + the
// PROFILE-AWARE lane contract live HERE ONLY. cert-attest + dispatch-review both consume it; neither
// re-implements a lane-identity check (the duplication was the SR-016/SR-017 root). Structural guard:
// scripts/checks/provenance-invariants.js.
const pv = require(path.join(__dirname, "..", "dispatch", "provenance-verifier"));
// ORIGIN-PROOF (ED-231 / ADR-0025): the per-session HMAC verifier. attestLane requires a VALID signature on
// every candidate record — a hand-authored record (never through the trusted writer) has no valid signature and
// is rejected, closing the forged-record live false-green. Fail-CLOSED: an unloadable module → verifyRecord is a
// stub that returns false (no record can attest), never a silent pass.
let attestSigning;
try {
  attestSigning = require(path.join(__dirname, "..", "dispatch", "attest-signing"));
} catch {
  attestSigning = { verifyRecord: () => false };
}

function loadCatalog() {
  return require(path.join(ROOT, "scripts", "dispatch", "catalog.js"));
}
function loadKernel() {
  try {
    return require(path.join(ROOT, "scripts", "dispatch", "safe-spawn.js"));
  } catch (e) {
    return { _err: e.message };
  }
}

// Provider → { toolId, argv(model,effort), stdin } for the probe. Only providers whose CLI is in the
// safe-spawn ARG_POLICY are dispatchable here; others fail-closed (add the ARG_POLICY first).
function probeShape(providerId, model, effort) {
  if (providerId === "openai") {
    const reasoning = effort ? ["-c", `model_reasoning_effort=${effort}`] : [];
    return { toolId: "codex", argv: ["exec", "--sandbox", "workspace-write", ...reasoning, "-m", model, "-"], stdin: true };
  }
  if (providerId === "antigravity") {
    // Prompt is the ARGUMENT to -p (no stdin); requires the agy ARG_POLICY in safe-spawn (task #27).
    // ED-060 slug→display: agy's `--model` resolves the DISPLAY name, not the catalog slug (a slug
    // silently defaults to CCPA → serves the WRONG model, defeating this very attestation). Translate
    // via the ONE catalog resolver (the SAME buildProviderArgv uses) so a raw slug never reaches agy.
    const agyModel = loadCatalog().agyModelName(model);
    return { toolId: "agy", argv: ["--model", agyModel, "--print-timeout", "90s", "-p", PROBE_PROMPT], stdin: false };
  }
  if (providerId === "claude") {
    return { toolId: "claude", argv: ["-p", "--model", model], stdin: true };
  }
  // The SUNSET individual `gemini` CLI probe was removed in the 2026-07-20 deep-clean —
  // the Gemini lab is attested via the `antigravity` (agy) branch above.
  return null;
}

const PROBE_PROMPT =
  "Reply with EXACTLY: PROBE OK. Do not add anything else.";

// Normalize a model id for tolerant containment matching (case/underscore/space → hyphen).
// norm — SINGLE-SOURCED in scripts/dispatch/agy-auth-tells.js (required at the top). Was a local copy
// with an identical char-class; imported so the record detector + cert-attest can never desync (the
// refactor-drift the module docstring closes — hunter MEDIUM, SP-20260723-002 fix cycle).

/**
 * ATTRIBUTION (α/β ruling 2026-07-19, directive #3): keep only the agy cli.log lines that belong to THIS
 * run's time window, so a PRIOR run's stale lines (auth-shaped / serve-label / unauth signals) in the
 * shared rotating log cannot bleed into the attestation. agy lines are prefixed
 * "[IWEF]MMDD HH:MM:SS.ffffff PID file.go:NN]" in LOCAL time. Keep lines in [startedMs - marginMs, now];
 * DROP out-of-window lines AND non-timestamped continuation lines — a dropped line can never contribute a
 * stale serve marker (favors fail-closed; agy's line format is stable so a non-parsing line is anomalous).
 * PURE + exported for the bite-test. A false-RED (dropping a genuine but skewed line) is safe (re-probe);
 * a false-GREEN (a stale serve marker leaking in) is the class this closes.
 */
// filterAgyLogToRunWindow — SINGLE-SOURCED in scripts/dispatch/agy-auth-tells.js (required at the top).
// (Was defined here; extracted SP-20260723-002 so cert-attest + the dispatch detector share ONE impl.)

/**
 * Decide the attestation from the raw CLI output + the requested model. The KEY check: the requested
 * model id must appear in the CLI's own output (its echoed header / self-id), and NO other catalog
 * model id for the same provider may appear INSTEAD. Pure + injectable for the bite-test.
 * @returns {{ attested, effective, reason, requestedSeen, otherSeen }}
 */
function evaluateAttestation({ requestedModel, providerId, output, exitOk, catalog }) {
  const out = norm(output);
  const req = norm(requestedModel);
  if (!exitOk) return { attested: false, effective: null, reason: "dispatch did not exit cleanly (non-zero / reaped / empty)" };
  if (!out) return { attested: false, effective: null, reason: "empty CLI output — nothing to attest" };
  // GATE 1 (α/β ruling 2026-07-19, NARROWED per β DIRECTIVE 0.87 — assumption-robust false-green fix):
  // hard-fail ONLY on UNAMBIGUOUS TERMINAL / keyring tells that CANNOT appear in a valid-token serve of the
  // contracted model, regardless of the (UNVERIFIED) question of whether a genuine authed run carries
  // transient startup unauth lines. The prior blanket non-sliceable set INCLUDED the AMBIGUOUS transients
  // (not-logged-in / defaulting-to / not-in-local-config) — those risk a STRUCTURAL false-RED: agy's
  // async-auth STARTUP may legitimately emit them before auth completes, so hard-failing them could make a
  // REQUIRED lane PERMANENTLY un-attestable (ED-060 stuck forever). No genuine authed serve has EVER been
  // confirmed (the 07-18-13-003Z artifact once believed genuine is ALSO an unauth false-green — its bytes
  // carry eval-mode + resolved-via-default), so betting GATE-1 on "genuine = clean log" (or its negation) is
  // unsound either way. The terminal tells below each INDEPENDENTLY catch BOTH observed false-greens
  // (19-11-56Z AND 07-18-13-003Z both carry eval-mode + resolved-via-default): eval/local-chrome = the
  // unauth-fallback mode; resolved-via-default/fallback = it served the DEFAULT not the contracted model;
  // keyring expired=true; auth-failed / unauthorized. The ambiguous transients are carried by GATE-2 (an
  // unauth serve's backend-label names the DEFAULT, not the contracted id → fails / otherSeen) + the
  // pid/time-window attribution (strips the cross-run deceptive backend-label). {narrowed terminal tells +
  // GATE-2 positive proof + attribution} closes the false-green with NO false-RED risk. ADR-0025 amendment:
  // AUTH_LINE-match != genuine auth; "genuine authed run = clean log" is an OPEN assumption resolved against
  // the FIRST real authed serve post-login — NOT enshrined as fact.
  // NON_AUTH_SIGNAL — SINGLE-SOURCED in scripts/dispatch/agy-auth-tells.js (required at the top).
  if (NON_AUTH_SIGNAL.test(out))
    return {
      attested: false,
      effective: null,
      reason:
        "served-model UNVERIFIABLE — THIS run's output carries an UNAMBIGUOUS TERMINAL default/eval/keyring signal ('resolved via default' / 'local chrome mode … eval mode' / keyring expired=true / auth-failed): agy served the DEFAULT, not the contracted model → fail-closed (α/β narrowed ruling 2026-07-19). Ambiguous startup transients (not-logged-in / defaulting) are NOT hard-failed here — they are carried by GATE-2 (default backend-label) + pid/time-window attribution — so a genuine authed serve is not false-RED'd.",
      defaultSignal: true,
    };
  // §7 HONEST-CEILING FAIL-CLOSED for ANTIGRAVITY (α-RATIFIED + β-line 2026-07-19; gauntlet R1 CONVERGENT
  // CRITICAL, both cross-provider lanes). agy CANNOT self-attest a genuine serve from its log: the ONLY
  // "serve marker" agy emits is the CLIENT-SIDE "Propagating … backend: label=<display>" echo, which agy
  // emits EVEN WHEN UNAUTHENTICATED (both the 19-11-56Z AND 07-18-13-003Z false-greens carried the requested
  // display label while serving the CCPA default). Trusting it is a residual false-green a novel unauth
  // phrase walks through (denylist GATE-1 + echo-trusting GATE-2). So NO agy log line is accepted as
  // served-model proof — cert-attest REFUSES to attest agy from its log. This is TRUST-REMOVAL: fail-closed
  // by construction, it can NEVER false-green. The genuine ED-060 proof is a REAL AUTHENTICATED dispatch-agent
  // record post-login (a real review that returned a genuine NON-default response under an authenticated
  // backend), NOT this probe. Non-agy providers (codex/claude) keep GATE-2 below — their served-model self-id
  // header is a TRUSTWORTHY CLI report, not a client echo. (ADR-0025: "the true close is upstream — agy
  // emitting a machine-readable served-model line under an authenticated backend"; that line does not exist.)
  if (providerId === "antigravity")
    return {
      attested: false,
      effective: null,
      reason:
        "§7 HONEST-CEILING (α-ratified 2026-07-19): agy cannot self-attest a genuine serve from its log — the 'backend: label' line is a CLIENT-SIDE echo agy emits even while unauthenticated (the 19-11 + 07-18 false-greens). No agy log line is trusted as served-model proof → fail-closed by construction. ED-060 closes ONLY via a real authenticated dispatch-agent record post-login, never this probe.",
      honestCeiling: true,
      servedSelfId: false, // agy's log is never a served-self-id source (the client echo is not trusted)
    };
  // Any OTHER catalog model for this provider appearing in the output = a served-a-different-model tell.
  let otherSeen = null;
  try {
    const prov = catalog.getProvider(providerId);
    for (const m of (prov && prov.models) || []) {
      const id = norm(m.id);
      if (id !== req && out.includes(id)) { otherSeen = m.id; break; }
    }
  } catch { /* catalog optional for the pure core */ }
  // GATE 2 (POSITIVE proof — β SHARP-1: fail-closed on the ABSENCE of positive proof, INDEPENDENT of GATE 1's
  // blocklist; the lead: "parse the SERVED/resolved model, never substring-match the request echo"). A bare
  // occurrence of the requested id is NOT proof it SERVED — a CLI can ECHO the request ("Model ID <req> not in
  // local config") without serving it. Require the id to appear in an AFFIRMATIVE served/resolved
  // SELF-IDENTIFICATION: a served-marker token (model / serving / resolved / using / active / loaded) bound
  // directly to the requested id — what a genuine self-id header ("model: <id>") or an authenticated agy log
  // ("Model resolved: <id>") looks like, and what a request-echo ("Model ID <id> not in local config") does
  // NOT satisfy (the "ID" + negation intervene). A provider that emits NO served self-id in verifiable output
  // (agy stdout is "PROBE OK"; the served model lives only in the --log-file folded into `output`) can attest
  // ONLY when that log AFFIRMATIVELY resolves the contracted model — an UNAUTHENTICATED agy never does, so agy
  // §7 fails-closed here (the honest ceiling until an authenticated log names the contracted model resolved).
  const reqEsc = req.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The served marker must be a HEADER colon ("model: <id>") or a genuine SERVE VERB (serving/resolved/using/
  // active/loaded) bound to the id — NOT the bare word "model", which also appears in a REQUEST echo
  // ("Requested model <id>" / "Model ID <id>"). The colon/verb distinguishes a served self-id from an echo.
  // ("resolved via default" is already GATE-1 fail-closed, so a matched "resolved" here is a genuine serve.)
  // FURTHER (qa QA-HG-001 R2): a COLON-form REQUEST echo ("Requested model: <id>" / "submitting model: <id>")
  // also carries a colon — reject a served-marker match that is in a REQUEST CONTEXT (preceded by a request/
  // submit/input word). HONEST CEILING (documented, NOT claimed closed): output-parsing cannot defeat a CLI
  // that SPOOFS a clean serve header with a novel request phrasing — that residual is undecidable-by-parsing
  // (the R6-BE-002 class), and the REAL proof is an AUTHENTICATED-BACKEND response (for agy, the operator
  // Antigravity login — ED-060). Since agy is operator-BLOCKED and its ACTUAL log fail-closes (GATE 1 + the
  // "Model ID" non-colon echo), there is no LIVE false-green today; the ceiling is tracked, not a shipped hole.
  // 2026-07-19 (authenticated-agy calibration): agy's genuine serve line is
  // "Propagating selected model override to backend: label=\"<display name>\"" — normed:
  // `backend:-label="<id>`. That backend-BIND statement is an affirmative serve marker (in the
  // default/unauth case the label would be the DEFAULT model → GATE 1 / otherSeen catch it).
  const SERVED_MARKER = new RegExp(`(model[-\\s]*:[-\\s]*|(?:serving|resolved|using|active|loaded)[-:\\s]*|backend[:\\-]+label[="'\\-]*)${reqEsc}`);
  const REQUEST_CTX = /(request|requested|requesting|submit|submitting|sending|sent|input|prompt|queued|pending|asking|asked|echo)[-\s]*$/;
  let servedSelfId = false;
  const _m = SERVED_MARKER.exec(out);
  if (_m) {
    const before = out.slice(Math.max(0, _m.index - 16), _m.index);
    servedSelfId = !REQUEST_CTX.test(before); // a marker in a request context is an echo, not a serve
  }
  if (otherSeen && !servedSelfId)
    return { attested: false, effective: otherSeen, reason: `CLI output names a DIFFERENT model "${otherSeen}" and no affirmative served self-id of the requested model — the opts.model||default trap (served the default, not the requested -m)`, otherSeen };
  if (servedSelfId)
    return { attested: true, effective: requestedModel, reason: "CLI output affirmatively self-identifies the requested model as SERVED (positive proof; no default/unauth signal)", requestedSeen: true, servedSelfId: true };
  // No affirmative served-model self-identification → INCONCLUSIVE → FAIL-CLOSED (β SHARP-1: absence of
  // positive proof is a fail, not a pass — a bare request echo is not proof). agy unauthenticated lands here.
  return { attested: false, effective: null, reason: "no AFFIRMATIVE served-model self-identification of the requested model — a bare request echo is NOT proof it served; inconclusive → fail-closed (QA-HG-001 GATE 2 / β SHARP-1 positive-proof). For agy this is the honest §7 ceiling until an authenticated log names the contracted model as resolved.", requestedSeen: out.includes(req), servedSelfId: false, otherSeen };
}

function providerForModel(catalog, model, explicit) {
  if (explicit) return catalog.normalizeProviderId(explicit);
  for (const p of catalog.PROVIDER_LIST || []) {
    if ((p.models || []).some((m) => m.id === model || (m.aliases || []).includes(model))) return p.id;
  }
  return null;
}

// ── D8: same-run panel attestation (SP-20260718-003, AC-14,15) ─────────────────
//
// attestPanelRun correlates a SAME-RUN ledger record PER REQUIRED LANE and attests the panel ONLY
// when every lane ran on its CONTRACTED provider with fallback:false + real evidence. This is the
// attestRanOnGpt discipline (beta-consult.js) generalized to the whole panel: attest on the OBSERVED
// ledger return, NEVER a wrapper claim. The load-bearing NEGATIVE (T5): a wrapper that CLAIMS agy but
// whose ledger record is provider:claude/absent does NOT attest the agy lane (a record-inprocess/
// provider:claude record satisfies ONLY the claude hunter) — so the attestation FAILS, which is what
// makes the provider-diversity claim FALSIFIABLE.

/** Read the dispatch-completions ledger, filtered to a sprint (+ optional run). Injectable path. */
function readLedgerRecords(sprintId, panelRunId, ledgerPath) {
  let file = ledgerPath;
  if (!file) {
    try { file = require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS.dispatchCompletionsFile; }
    catch { file = path.join(ROOT, ".claude", "runtime", "dispatch-completions.jsonl"); }
  }
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let r;
    try { r = JSON.parse(t); } catch { continue; }
    if (sprintId && r.sprint_id !== sprintId) continue;
    // QA-014 sweep: the panel-run IDENTITY is `panel_run_id` (SR-011 — minted by the runner, propagated to
    // every child record). The prior filter used `run_id`, which the runner never carries as the panel id
    // (recordCompletion writes run_id from MC_RUN_ID) → real runner records were DISCARDED before
    // attestation. Filter by panel_run_id so the live-read pre-filter agrees with attestLane's correlation.
    if (panelRunId != null && r.panel_run_id !== panelRunId) continue;
    out.push(r);
  }
  return out;
}

/**
 * Attest ONE required lane against the same-run ledger records. PURE. A lane is attested ONLY by a
 * record that ran on its CONTRACTED provider (observed, never claimed):
 *   - a CLI cross-provider lane (gpt/agy): provider === contracted, tool_id === contracted tool_id,
 *     shape 'subprocess-cross-provider', fallback:false, ok:true, non-null evidence digest.
 *   - the sanctioned claude hunter (in-process-agent + provider claude): a record-inprocess record
 *     (provider claude, via 'epsilon-agent' / shape in-process-agent) with evidence.
 * @returns {{ laneId, attested, observedProvider?, tool_id?, invocation_digest?, evidence_digest?, reason }}
 */
function attestLane(lane, records, opts = {}) {
  // Backward-compat: a bare string 3rd arg is the panel role (the pre-SR-004 signature).
  const { runId = null, sprintId = null, codeSha = null, profileName = "panel-2family" } =
    typeof opts === "string" ? {} : opts || {};
  // §7 HONEST-CEILING AT THE PANEL READER (R2-CRITICAL-01 — β RIDER-1 "same class, DIFFERENT reader"):
  // a lane whose provider cannot be served-model-verified from a ledger record CANNOT be attested here. The
  // predicate is the SINGLE choke-point (pv.servedModelUnverifiableFromRecord) that dispatch-review's
  // buildObserved ALSO calls — so this reader and the panelStatus BINDING reader fail-close on the SAME root,
  // and a third reader cannot reintroduce the class (R3-CRITICAL-02). For agy: a signed record proves a
  // dispatch RAN, but agy emits NO trustworthy server-origin served-model receipt (only the CLIENT-SIDE
  // "backend: label" echo that §7 refuses to trust — the 19-11 / 07-18 / 22:16 false-greens all carried the
  // correct display label while serving the CCPA default). TRUST-REMOVAL, fail-closed BY CONSTRUCTION until an
  // independently trustworthy server-origin served-model proof exists (the deferred ED-230 predicate REPLACES
  // this; ADR-0027 rider 3). Consequence (consistent with support-matrix agy=down): panel-3lab BINDING can
  // never attest while agy is down — the honest floor, never GREEN.
  if (lane && pv.servedModelUnverifiableFromRecord(lane.provider)) {
    return {
      laneId: lane.laneId,
      attested: false,
      reason:
        "§7 HONEST-CEILING at the panel reader (R2-CRITICAL-01): the antigravity lane cannot be attested from a ledger record — agy emits no trustworthy server-origin served-model receipt (only the client-side 'backend: label' echo, which §7 refuses to trust). Fail-closed by construction until the ED-230 served-model predicate lands (ADR-0027 rider 3). panel-3lab BINDING cannot attest while agy is down.",
      honestCeiling: true,
    };
  }
  // IDENTITY via the SINGLE choke-point (α round-6): the claude lane's contract is PROFILE-AWARE
  // (2family FLOOR → subprocess-claude/security-reviewer; 3lab BINDING → the in-process hunter), and the
  // hunter is identified by WRITER-STAMPED shape+role ONLY (no settable via/record_via/sanctioned_lane_id).
  // NO identity predicate is re-implemented here — provenance-verifier owns them (the duplication was the disease).
  const contract = pv.laneContract(profileName, lane.provider);
  // SAME-RUN correlation by RUN IDENTITY (SR-004/SR-011/SR-012/SR-014): a record attests a lane ONLY if it
  // belongs to THIS run+sprint. Identity is the panel_run_id the runner MINTS — NEVER run_id (a different
  // panel could match) NOR a time window. A NULL requested runId matches nothing (no historical certification).
  const sameRun = (records || []).filter(
    (r) => r.ok === true && r.fallback === false && (sprintId == null || r.sprint_id === sprintId) && runId != null && r.panel_run_id === runId,
  );
  // SR-013: the record must carry the code_sha it EXECUTED against (persisted at write-time), matching the
  // attested HEAD — never a caller-supplied SHA — AND a non-empty invocation digest (cmdline_checksum).
  const provenanceOk = (r) =>
    typeof r.code_sha === "string" && r.code_sha.length > 0 && (codeSha == null || r.code_sha === codeSha) && !!r.cmdline_checksum;
  const match = sameRun.find((r) => {
    // ORIGIN-PROOF FIRST (ED-231 / ADR-0025): a valid per-session signature proves the record came from the
    // trusted writer — a hand-authored/forged record has none → NOT attested. This is the ROOT close of the
    // forged-record live false-green; the identity + provenance checks below are necessary-but-not-sufficient.
    if (!attestSigning.verifyRecord(r)) return false;
    if (!pv.recordMatchesLane(r, contract, lane.provider)) return false; // IDENTITY (shape+role) from the module
    if (contract.isHunter) return (r.evidence_sha || r.output_digest) && provenanceOk(r);
    // A subprocess lane (cross-provider CLI, or the floor's subprocess-claude): the contracted executable
    // (tool_id) + real output + provenance.
    return r.tool_id === lane.tool_id && !!r.output_digest && provenanceOk(r);
  });
  if (!match) {
    return {
      laneId: lane.laneId,
      attested: false,
      reason: contract.isHunter
        ? "no same-run in-process HUNTER record (writer-stamped shape in-process-agent + role security_claude_hunter, with evidence + provenance)"
        : `no same-run record for ${lane.provider}/${lane.tool_id} (contract ${contract.shape}/${contract.role}, panel_run_id, fallback:false, output_digest + code_sha) — a wrapper claim is NOT proof`,
    };
  }
  return {
    laneId: lane.laneId,
    attested: true,
    observedProvider: match.provider,
    tool_id: match.tool_id || null,
    invocation_digest: match.cmdline_checksum || null, // sanitized invocation digest
    evidence_digest: match.output_digest || match.evidence_sha || null,
    reason: "same-run observed record on the contracted provider (fallback:false + evidence)",
  };
}

/**
 * Attest the whole panel run: every required lane must be same-run attested on its contracted provider.
 * Bundles invocation-digests (cmdline_checksum) + code-SHA (git HEAD) + panel-profile + evidence-digest.
 * PURE given { lanes, records }. `codeSha` is the caller's git HEAD (the live CLI reads it).
 * @param {{ runId?, sprintId, profile:{name}, lanes:Array, records:Array, codeSha? }} args
 */
function attestPanelRun({ runId, sprintId, profile, lanes, records, codeSha, role = "security-reviewer" } = {}) {
  const laneResults = (lanes || []).map((lane) => attestLane(lane, records || [], { role, runId, sprintId, codeSha, profileName: (profile && profile.name) || "panel-2family" }));
  const attestedLanes = laneResults.filter((l) => l.attested);
  const allAttested = laneResults.length > 0 && laneResults.every((l) => l.attested);
  // CODE-SHA binding (SR-004/QA-003/SR-013, AC-14): a binding attestation MUST carry the code identity it
  // certifies (read FROM each record, matched to this HEAD in attestLane). A null/absent codeSha cannot
  // bind evidence to a specific build → NOT ok.
  const codeShaBound = typeof codeSha === "string" && codeSha.length > 0;
  // RUN-IDENTITY binding (SR-012): a binding panel attestation must certify a SPECIFIC run — an omitted/
  // empty runId would certify historical same-sprint evidence, which is a false-green. NOT ok without it.
  const runBound = typeof runId === "string" && runId.length > 0;
  const ok = allAttested && codeShaBound && runBound;
  const evidenceDigest = crypto
    .createHash("sha256")
    .update(attestedLanes.map((l) => `${l.laneId}:${l.evidence_digest || ""}`).join("|"))
    .digest("hex");
  return {
    ok,
    profile: (profile && profile.name) || null,
    run_id: runId || null,
    sprint_id: sprintId || null,
    code_sha: codeSha || null,
    invocation_digests: attestedLanes.map((l) => l.invocation_digest).filter(Boolean),
    evidence_digest: evidenceDigest,
    lanes: laneResults,
    reason: !runBound
      ? "no runId supplied — a binding panel attestation must certify a SPECIFIC run (an omitted runId certifies historical evidence) → NOT ok (SR-012)"
      : !allAttested
        ? `unattested required lane(s): ${laneResults.filter((l) => !l.attested).map((l) => l.laneId).join(", ")} — attestation FAILS (a wrapper claim is not proof)`
        : !codeShaBound
          ? "every required lane attested SAME-RUN, but code_sha is absent — a binding attestation must bind to a code SHA (AC-14) → NOT ok"
          : "every required lane attested SAME-RUN on its contracted provider (fallback:false), bound to run_id + code_sha",
  };
}

/** git HEAD SHA via the safe-spawn kernel (read-only git; the model never chooses the exe). */
function gitHeadSha() {
  // QA-012: read HEAD via fs — the SAME provenance source the record WRITER (recordCompletion) uses, so
  // the attestor's HEAD and the persisted code_sha agree. A nested `git` subprocess is EPERM-blocked in
  // the CI/reviewer sandbox (which made this return null → attestPanelRunLive never ok); the fs read works.
  try {
    return require(path.join(ROOT, "scripts", "dispatch", "git-head")).readGitHead(ROOT) || null;
  } catch {
    return null;
  }
}

/** Live panel attestation: read the real ledger + manifest lanes + git HEAD, then attest. */
function attestPanelRunLive({ runId, sprintId, profileName = "panel-2family" } = {}) {
  let lanes;
  try {
    const pl = require(path.join(ROOT, "scripts", "dispatch", "panel-lanes"));
    lanes = pl.requiredLanes(pl.loadManifest(), profileName);
  } catch (e) {
    return { ok: false, reason: `panel-lanes loader failed (fail-closed): ${e.message}`, lanes: [] };
  }
  const records = readLedgerRecords(sprintId, runId);
  return attestPanelRun({ runId, sprintId, profile: { name: profileName }, lanes, records, codeSha: gitHeadSha() });
}

function mainPanel(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
  const json = argv.includes("--json");
  const sprintId = get("--sprint");
  const runId = get("--run");
  const profileName = get("--profile") || "panel-2family";
  // SR-012: --run is MANDATORY for a binding panel attestation — certifying by --sprint alone would
  // attest historical same-sprint evidence rather than the specific run being certified.
  if (!sprintId || !runId) {
    process.stderr.write("usage: cert-attest.js panel --sprint <id> --run <panel_run_id> [--profile panel-2family|panel-3lab] [--json]\n");
    return 2;
  }
  const out = attestPanelRunLive({ runId, sprintId, profileName });
  if (json) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else if (out.ok) process.stdout.write(`ATTESTED [panel] ${profileName} sprint=${sprintId} — every required lane same-run attested on its contracted provider.\n`);
  else process.stderr.write(`FAIL [panel] ${profileName} sprint=${sprintId} — ${out.reason}\n`);
  return out.ok ? 0 : 1;
}

function main(argv) {
  // D8: the panel-attestation subcommand (SP-20260718-003). `cert-attest.js panel --sprint <id> …`.
  if (argv[0] === "panel") return mainPanel(argv.slice(1));
  const get = (flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
  const json = argv.includes("--json");
  const model = get("--model");
  const effort = get("--effort") || "low"; // bounded/cheap by default — a verdict, not agentic work
  if (!model) {
    process.stderr.write("usage: cert-attest.js --model <id> [--provider <p>] [--effort <e>] [--json]\n");
    return 2;
  }
  const catalog = loadCatalog();
  const providerId = providerForModel(catalog, model, get("--provider"));
  if (!providerId) {
    process.stderr.write(`${NAME}: cannot resolve a provider for model "${model}" (pass --provider) — is it in the catalog?\n`);
    return 2;
  }
  // ED-060 slug→display (ATTESTATION layer — the layer-3 completion of the id-mapping fix). agy
  // self-identifies the SERVED model in its output by DISPLAY name ("Gemini 3.1 Pro (High)"), NOT the
  // catalog slug. So the served-model comparison (evaluateAttestation GATE-2) must run against the
  // display name — otherwise a GENUINE authenticated serve of the contracted model FALSE-REDs, because
  // the requested slug never appears in agy's serve label ("backend: label=…"; observed live 2026-07-19).
  // Same single catalog resolver the two dispatch boundaries use; non-antigravity / unmapped ids pass
  // through UNCHANGED. The probe --model arg is already display-translated by probeShape; this closes
  // the third and last site (dispatch-arg providers.js + dispatch-arg cert-attest + THIS comparison).
  const attestModel = providerId === "antigravity" ? catalog.agyModelName(model) : model;
  // Axis-5 (gauntlet R1): refuse to spawn a NON-CONTRACTED antigravity model. agyModelName passes unmapped
  // ids through, so `--provider antigravity --model "Claude Sonnet 4.6 (Thinking)"` would otherwise spawn a
  // non-contracted model (agy exposes non-Google models too). Require the model to be a catalog antigravity
  // entry — by canonical id OR its agyModelName. Fail-closed BEFORE the spawn (the safe-spawn agy ARG_POLICY
  // is a charset gate, not a contract gate — this is the contract gate).
  if (providerId === "antigravity") {
    const prov = catalog.getProvider("antigravity");
    const contracted = ((prov && prov.models) || []).some((m) => m.id === model || m.agyModelName === model);
    if (!contracted) {
      process.stderr.write(`${NAME}: "${model}" is not a contracted antigravity model (catalog entry required by id or agyModelName) — refusing to spawn a non-contracted model.\n`);
      return 2;
    }
  }
  const shape = probeShape(providerId, model, providerId === "openai" ? effort : null);
  if (!shape) {
    process.stderr.write(`${NAME}: no probe shape for provider "${providerId}"\n`);
    return 2;
  }
  const kernel = loadKernel();
  if (kernel._err || typeof kernel.safeSpawnSync !== "function") {
    process.stderr.write(`${NAME}: safe-spawn kernel unavailable (${kernel._err || "no safeSpawnSync"}) — fail-closed\n`);
    return 2;
  }

  // THIS is the sanctioned probe path — declare it to the guards process-internally.
  mcEnv.setEnv("PROVIDER_PROBE", "1");
  // (a) SP-20260718-003 / ADR-0020-amend: agy emits NO served-model id in stdout ("PROBE OK" only). The LAST
  // avenue is agy's --log-file — capture the CLI log and FOLD it into the attestation input, so IF agy records
  // the served model there, §7 concludes. If it records it NOWHERE, §7 stays honestly INCONCLUSIVE (a TRUE
  // ceiling — agy structurally does not emit the served model; recorded in the ADR-0020 amendment). This never
  // SOFTENS the fail-closed: no model id found in stdout+stderr+log ⇒ evaluateAttestation still returns FAIL.
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  // (a→2026-07-19 REVISION) DO NOT inject --log-file: passing agy a custom --log-file BREAKS its
  // keyring auth context (verified live 2026-07-19: the identical safe-spawn WITH --log-file →
  // "not logged into Antigravity" + local-default serve; WITHOUT → keyring auth + the real model
  // propagated to backend). Instead snapshot the DEFAULT CLI log pre-spawn and fold in only the
  // DELTA written during this spawn (per-read window — no stale-line false signals). Residual: a
  // CONCURRENT agy run could interleave lines into the window — probes are single-flight by
  // convention; an interleaved unauth line fails CLOSED (never green), so the residual is a
  // false-RED risk only.
  let agyDefaultLog = null;
  let agyLogPreSize = 0;
  let agyLogPrePrefix = null;
  if (providerId === "antigravity") {
    agyDefaultLog = path.join(process.env.USERPROFILE || require("os").homedir(), ".gemini", "antigravity-cli", "cli.log");
    try {
      agyLogPreSize = fs.statSync(agyDefaultLog).size;
      // Rotation detection must be CONTENT-based, not size-based: agy truncates+rewrites cli.log per
      // run, and a fresh log can grow PAST the old size (a size-only check then reads mid-file and
      // slices out the serve evidence — observed live 2026-07-19). Snapshot the first 256 bytes; a
      // changed prefix post-run = rotated → read from 0.
      const fd0 = fs.openSync(agyDefaultLog, "r");
      const pre = Buffer.alloc(Math.min(256, agyLogPreSize));
      fs.readSync(fd0, pre, 0, pre.length, 0);
      fs.closeSync(fd0);
      agyLogPrePrefix = pre.toString("utf8");
    } catch { agyLogPreSize = 0; agyLogPrePrefix = null; }
  }
  const started = Date.now();
  const spawned = kernel.safeSpawnSync(shape.toolId, shape.argv, {
    cwd: ROOT,
    env: process.env,
    input: shape.stdin ? PROBE_PROMPT : undefined,
    timeoutMs: 90_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - started;
  const stdout = spawned.stdout || "";
  const stderr = spawned.stderr || "";
  let agyLog = "";
  if (agyDefaultLog) {
    try {
      const fd = fs.openSync(agyDefaultLog, "r");
      const size = fs.fstatSync(fd).size;
      // agy ROTATES/TRUNCATES cli.log per run — detect rotation by CONTENT (the pre-spawn 256-byte
      // prefix no longer matches ⇒ this is a fresh per-run log, read from 0); only an unchanged
      // prefix means append-mode (read the delta from the pre-spawn size).
      let rotated = true;
      if (agyLogPrePrefix && size >= agyLogPrePrefix.length) {
        const chk = Buffer.alloc(agyLogPrePrefix.length);
        fs.readSync(fd, chk, 0, chk.length, 0);
        rotated = chk.toString("utf8") !== agyLogPrePrefix;
      }
      const start = rotated ? 0 : agyLogPreSize;
      const len = Math.max(0, size - start);
      if (len > 0) {
        const buf = Buffer.alloc(Math.min(len, 4 * 1024 * 1024));
        fs.readSync(fd, buf, 0, buf.length, start);
        agyLog = buf.toString("utf8");
      }
      fs.closeSync(fd);
    } catch { /* no default log — attestation stays fail-closed on absent evidence */ }
    // ATTRIBUTION (α/β ruling 2026-07-19, directive #3): bind the folded agy cli.log to THIS run's time
    // WINDOW so a PRIOR run's lines (stale auth-shaped / serve-label / unauth signals) in the shared
    // rotating log cannot bleed into this attestation — the cross-run contamination that (with the unsound
    // GATE-1 slice, now removed) produced the 19-11 false-green. Belt beyond rotation-awareness.
    agyLog = filterAgyLogToRunWindow(agyLog, started);
  }
  const combined = `${stdout}\n${stderr}\n${agyLog}`; // the served model id may land on stdout/stderr OR the CLI log
  // liveness-verified: `spawned` is a SUBPROCESS spawn result (carries .exitCode), NOT a dispatch-completion
  // ledger record — this .ok is a process-exit signal, not a forgeable liveness claim.
  const exitOk = spawned.ok === true && spawned.exitCode === 0;

  const verdict = evaluateAttestation({ requestedModel: attestModel, providerId, output: combined, exitOk, catalog });

  // Write the attestation artifact (walk-skipped runtime/). Full raw output retained for audit +
  // header-regex calibration on the first live fire.
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const ts = new Date().toISOString();
  const artifact = {
    check: NAME,
    requested_model: model,
    attested_model_id: attestModel, // ED-060: the (display-name) id agy's serve label was compared against; == requested_model for non-antigravity
    provider: providerId,
    effort: providerId === "openai" ? effort : null,
    attested: verdict.attested,
    effective_model: verdict.effective,
    reason: verdict.reason,
    exit_ok: exitOk,
    exit_code: spawned.exitCode,
    reaped: spawned.reaped || false,
    violations: spawned.violations || null,
    stdout_bytes: Buffer.byteLength(stdout, "utf8"),
    stderr_bytes: Buffer.byteLength(stderr, "utf8"),
    elapsed_ms: elapsedMs,
    ts,
    cli_output_sha256: crypto.createHash("sha256").update(combined).digest("hex"),
    cli_output_head: combined.slice(0, 2000), // header lives here; full text is the sha's witness
  };
  const file = path.join(ARTIFACT_DIR, `${norm(model)}-${ts.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2) + "\n");

  if (json) {
    process.stdout.write(JSON.stringify({ ...artifact, artifact_path: path.relative(ROOT, file) }, null, 2) + "\n");
  } else if (verdict.attested) {
    process.stdout.write(`ATTESTED [${NAME}] ${model} (${providerId}) — CLI self-identified the requested model. artifact: ${path.relative(ROOT, file)}\n`);
  } else {
    process.stderr.write(`FAIL [${NAME}] ${model} (${providerId}) — ${verdict.reason}. artifact: ${path.relative(ROOT, file)}\n`);
  }
  return verdict.attested ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = {
  evaluateAttestation,
  providerForModel,
  probeShape,
  norm,
  filterAgyLogToRunWindow,
  NAME,
  // D8 (SP-20260718-003): same-run panel attestation.
  attestLane,
  attestPanelRun,
  attestPanelRunLive,
  readLedgerRecords,
  gitHeadSha,
};
