#!/usr/bin/env node
"use strict";
const mcEnv = require("./hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * dispatch-review.js — multi-provider review FIRING (E-DISPATCH-PERFECT-001 W1).
 *
 * The dispatch CONSUMER of a role's second_pass/third_pass. Given <role> <prompt-file>, it reads
 * registry-roles.passesOf(role) and spawns ONE reap-safe single-pass
 *   `node scripts/dispatch-agent.js <role> <prompt> --provider <p> [--model <m>]`
 * child PER PASS, IN PARALLEL. Each child runs the full normal flow (its own concurrency slot,
 * timeout, provider-stamped completion record, and reap-safety) — so N provider-stamped records
 * land on the canonical ledger that gauntlet-verify + security-pass-count read. The merged verdict
 * is ANY-FAIL-HOLDS: a security review is clean only if EVERY pass is both alive and clean.
 *
 * This is what makes second_pass/third_pass a REAL dispatch consumer, not prose (the β DECIDE 0.88
 * condition (c) for the 3-provider security review). Parallel (not serial) so each child keeps its
 * own dispatch budget — a 3-provider review's wall-clock is max(pass), never sum (no serial reap).
 *
 * A single-pass role (passesOf length 1) still works — one child, behaviour-equivalent to a direct
 * dispatch-agent call — so callers can route ALL reviewer dispatches here uniformly.
 *
 * Usage:  node scripts/dispatch-review.js <role> <prompt-file> [--domain <d>]
 * Output: a merged JSON envelope on the final stdout line:
 *   { ok, role, multipass, passes_run, lanes:[{pass,provider,model,ok,verdict}], allLanesOk, mergedVerdict }
 *   - ok          = primary-lane liveness (per-lane records are read separately by gauntlet-verify)
 *   - mergedVerdict = the security verdict the orchestrator consumes to gate/fix (any fail → "fail")
 * Exit: 0 iff EVERY lane is alive (a dead lane = the review did not fully run → exit 1).
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const registryRoles = require("./dispatch/registry-roles");

const AGENT = path.join(__dirname, "dispatch-agent.js");
const CLAUDE = path.join(__dirname, "dispatch-claude.js");
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..");

// provider-id → panel lane-id (the security 3-lab): claude→claude, openai→gpt, antigravity→agy.
const LANE_ID = { claude: "claude", antigravity: "agy", openai: "gpt" };

function parseFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

// Lane-persistence (lead-confirmed gap): dispatch-review discarded each pass's raw stdout after
// parsing the final JSON line, so a multi-pass security review's FULL per-lane findings (e.g. the
// GPT lane) were UNRECOVERABLE — the orchestrator couldn't build a complete fix brief and had to
// re-fire the lane. Same dispatch-runtime-honesty class as WG-11/13: evidence must persist. Each
// lane's raw stdout (+ stderr) is now written to runtime/reviews/<role>-<ts>/<pass>.txt (override
// with --lane-out <dir>); the merged envelope carries the paths.
function laneFileName(passKey) {
  return String(passKey || "pass").replace(/[^A-Za-z0-9._-]/g, "_") + ".txt";
}

// Persist ONE lane's raw stdout (+ stderr when non-empty) to <laneOutDir>/<pass>.txt. Best-effort —
// returns the stdout path, or null if not persisted (no dir / write error). Writes even an EMPTY
// stdout (a 0-byte file + its .stderr.txt IS the diagnostic for a dead lane). Pure enough to unit-test.
function persistLane(laneOutDir, passKey, out, err) {
  if (!laneOutDir) return null;
  try {
    fs.mkdirSync(laneOutDir, { recursive: true });
    const laneOut = path.join(laneOutDir, laneFileName(passKey));
    fs.writeFileSync(laneOut, out == null ? "" : String(out));
    if (err) fs.writeFileSync(laneOut.replace(/\.txt$/, ".stderr.txt"), String(err));
    return laneOut;
  } catch {
    return null;
  }
}

// Spawn ONE single-pass dispatch-agent child for a given provider pass. Never rejects — a spawn
// failure or unparseable output resolves to a dead lane (ok:false), so one bad pass can't crash
// the whole review (it just holds the merged verdict, which is the correct security behaviour).
function spawnPass(role, promptFile, pass, domain, laneOutDir) {
  return new Promise((resolve) => {
    // claude is the LOCAL model — dispatch-agent.js (the CROSS-PROVIDER wrapper) hard-refuses it.
    // The claude pass runs through dispatch-claude.js (the recording `claude -p --agent` wrapper);
    // gemini/openai run through dispatch-agent.js with a --provider override. (dispatch-claude.js
    // takes [--model] but NOT --domain.)
    let args;
    if (pass.provider === "claude") {
      args = [CLAUDE, role, promptFile];
      if (pass.model) args.push("--model", pass.model);
    } else {
      args = [AGENT, role, promptFile, "--provider", pass.provider];
      if (pass.model) args.push("--model", pass.model);
      if (domain) args.push("--domain", domain);
    }
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ pass, result: null, spawnError: e.message }));
    child.on("close", () => {
      // Persist the lane's RAW stdout + stderr BEFORE parsing — recoverable per-lane evidence, even
      // for a dead/empty lane. Best-effort: never let a persistence error crash the review.
      const laneOut = persistLane(laneOutDir, pass.key, out, err);
      // dispatch-agent's final stdout line is JSON.stringify(result).
      let result = null;
      const last = out.trim().split("\n").filter(Boolean).pop();
      try {
        result = last ? JSON.parse(last) : null;
      } catch {
        /* leave null — counts as a dead lane */
      }
      resolve({ pass, result, stderrBytes: Buffer.byteLength(err, "utf8"), laneOut });
    });
  });
}

// BE-CQ-001 (backend-reviewer HIGH, fail-closed ALLOWLIST): the ONLY verdict values that may read as
// alive/clean are the allowlisted set. An UNKNOWN verdict string (a hallucinated/malformed/adversarial
// value like "banana") must NEVER fall through as clean — it is "error" (unresolved binding verdict →
// BLOCKED). The old parsed-path returned parsed.verdict verbatim, so any non-{fail,error} string
// normalized to PASS (a binding false-green — verified: verdict="banana" → mergeLanes.ok=true).
const VALID_REVIEW_VERDICTS = new Set(["pass", "warn", "fail"]);
function normalizeVerdict(v) {
  const s = String(v || "").toLowerCase();
  return VALID_REVIEW_VERDICTS.has(s) ? s : "error";
}
function verdictOf(result) {
  if (!result) return "error";
  // dispatch-agent sets result.parsed; dispatch-claude returns the raw agent output in result.output
  // (no parsed) — extract the verdict from either so a claude-pass FAIL is never missed.
  // BE-CQ-001: the parsed verdict is ALLOWLISTED here (normalizeVerdict) — an unknown value → "error".
  if (result.parsed && typeof result.parsed.verdict === "string") return normalizeVerdict(result.parsed.verdict);
  const text = typeof result.output === "string" ? result.output : "";
  const m = /"verdict"\s*:\s*"(pass|warn|fail)"/i.exec(text);
  if (m) return m[1].toLowerCase();
  // HIGH-2 (W1+W2 review): a BINDING review lane that is alive but emits no parseable verdict is
  // fail-closed ("error") — NEVER an implicit PASS. A missing/garbled verdict must not green a review.
  return "error";
}

async function main() {
  const argv = process.argv.slice(2);
  const role = argv[0];
  const promptFile = argv[1];
  const domain = parseFlag(argv, "--domain");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const laneOutDir = parseFlag(argv, "--lane-out") || path.join(ROOT, "runtime", "reviews", `${role}-${ts}`);
  if (!role || !promptFile) {
    console.error(
      JSON.stringify({ ok: false, error: "Usage: node scripts/dispatch-review.js <role> <prompt-file> [--domain <d>]" }),
    );
    process.exit(2);
  }
  let passes;
  try {
    passes = registryRoles.passesOf(role);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: `cannot resolve passes for ${role}: ${e.message}` }));
    process.exit(2);
  }
  if (!passes.length) {
    console.error(JSON.stringify({ ok: false, role, error: `unknown role (no passes in registry)` }));
    process.exit(2);
  }

  // SR-011: MINT one panel_run_id before fan-out and propagate it to every child via the environment
  // (spawnPass inherits process.env). Each child's completion record is stamped with it (recordCompletion),
  // so the panel gate correlates lanes by RUN IDENTITY — not the firing-time window, which a concurrent
  // same-sprint run could satisfy (the SR-011 substitution gap). The window remains a secondary narrow.
  // BE-CQ-002 (backend-reviewer MEDIUM): RESPECT an INHERITED MC_PANEL_RUN_ID. The runner used to
  // UNCONDITIONALLY re-mint the id inside its own process, so a conductor that mints the id up-front (to
  // stamp the separately-summoned in-process hunter with the SAME id) could not correlate the hunter into
  // the panel run without an out-of-band ledger-extraction workaround. Now: inherit if set, else mint —
  // and EXPOSE the id on the merged envelope (merged.panel_run_id below) so the caller can always read it.
  const panelRunId = mcEnv.readEnv("PANEL_RUN_ID") || `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  mcEnv.setEnv("PANEL_RUN_ID", panelRunId);
  const runnerStartMs = Date.now();
  // FIRE every pass in PARALLEL — each child is an independent reap-safe single-pass dispatch.
  const settled = await Promise.all(passes.map((p) => spawnPass(role, promptFile, p, domain, laneOutDir)));
  const lanes = settled.map((s) => {
    // OBSERVED evidence (C1/SR-001): the provider/fallback the dispatch ACTUALLY returned — after the C2
    // fix the completion envelope carries the OBSERVED provider, and a quota-fallback is marked via
    // quotaFallbackFrom. The panel gate reduces over THIS, never the declared pass label — so a lane that
    // CLAIMS gpt/agy but ran on Claude (coerced/fallback) can never merge to pass. The claude pass runs
    // via dispatch-claude.js, which is claude BY CONSTRUCTION — so its observed provider is a true
    // observation, not a trusted label (the masquerade only threatens the CROSS-PROVIDER labs).
    const r = s.result || {};
    const isClaude = s.pass.provider === "claude";
    return {
      pass: s.pass.key,
      provider: s.pass.provider, // the CONTRACTED provider (declared)
      model: s.pass.model,
      ok: !s.spawnError && !!r.ok,
      verdict: verdictOf(s.result),
      laneId: LANE_ID[s.pass.provider] || s.pass.provider,
      observedProvider: isClaude ? "claude" : r.provider || null, // cross-provider: the REAL returned provider
      fallback: isClaude ? false : !!(r.fallback || r.quotaFallbackFrom),
      hasEvidence: !s.spawnError && !!s.result,
      lane_out: s.laneOut ? path.relative(ROOT, s.laneOut) : null,
    };
  });
  // D5 CLI-only panel tooth (SP-20260718-003, AC-7): a cross-provider lab (non-claude) MUST run as a
  // CLI subprocess. This runner fires every non-claude pass through dispatch-agent.js
  // (subprocess-cross-provider) and the claude pass through dispatch-claude.js (subprocess-claude) —
  // NEVER an in-process Agent-tool spawn. Assert it BEFORE merge so a future route change that resolves
  // a cross-provider lane in-process is refused, not silently merged (the D1<->D5 masquerade). The
  // sanctioned in-process claude HUNTER is summoned by ε OUTSIDE this runner, so it never appears here.
  //
  // SR-003 loader fail-CLOSED: distinguish a MISSING module (additive contract → fail-open, the negative
  // teeth live in its test) from a loader/eval THROW (the module is PRESENT but errored → BLOCK, never a
  // silent fall-through into merge). The old bare `catch {}` swallowed BOTH — a real loader error
  // false-greened.
  let panelLanes = null;
  try {
    panelLanes = require("./dispatch/panel-lanes");
  } catch (e) {
    if (panelLoaderFailClosed(role, e)) {
      console.error(JSON.stringify({ ok: false, role, error: "panel_loader_error", detail: e.message || String(e) }));
      process.exit(1);
    }
    panelLanes = null; // additive fail-open (non-security role, module genuinely absent)
  }
  if (panelLanes) {
    try {
      const observed = lanes.map((l) => ({
        laneId: l.laneId,
        provider: l.provider,
        shape: l.provider === "claude" ? "subprocess-claude" : "subprocess-cross-provider",
      }));
      const tooth = panelLanes.assertCliOnlyPanel(observed);
      if (!tooth.ok) {
        console.error(JSON.stringify({ ok: false, role, error: "panel_cli_only_violation", violations: tooth.violations }));
        process.exit(1);
      }
    } catch (e) {
      // SR-003: an EVAL error inside the tooth must BLOCK (fail-closed), never continue into merge.
      console.error(JSON.stringify({ ok: false, role, error: "panel_tooth_error", detail: e.message }));
      process.exit(1);
    }
  }

  const merged = mergeLanes(role, lanes);
  merged.lane_out_dir = path.relative(ROOT, laneOutDir);
  // BE-CQ-002: expose the panel_run_id so a conductor can correlate the in-process hunter (summoned
  // outside this runner) into the SAME panel run without an out-of-band ledger extraction.
  merged.panel_run_id = panelRunId;

  // C1 (SR-001/QA-001): for the SECURITY PANEL, the binding outcome ALSO runs the D7 panelStatus reducer
  // over the OBSERVED per-lane evidence (never the declared labels). mergeLanes alone (verdict/liveness on
  // the declared passes) let an all-Claude masquerade — a gpt/agy lane that silently ran on Claude
  // (observedProvider=claude / fallback:true) — merge to pass. The reducer marks such a lane COERCED and
  // BLOCKS. The gate can only HOLD the merged outcome, never loosen it. agy is operator-owned (ED-060):
  // the operative gating floor is panel-2family (GPT+Claude); panel-3lab is surfaced as its honest
  // BLOCKED-ON-OPERATOR binding exit (the D8 SAME-RUN attestation is the ε-conductor's panel-exit cert).
  if (panelLanes && isSecurityPanelRole(role)) {
    const panelGate = applyPanelGate(panelLanes, lanes, {
      sprintId: mcEnv.readEnv("SPRINT_ID") || null,
      sinceMs: runnerStartMs,
      panelRunId,
      requireSignature: true, // live path: a lane record must carry a valid origin-proof sig (SR-R2-002)
    });
    merged.panel = panelGate;
    if (!panelGate.floor_pass) {
      merged.ok = false;
      if (merged.verdict === "pass" || merged.verdict === "warn") merged.verdict = "error";
    }
  }

  console.log(JSON.stringify(merged));
  process.exit(merged.ok ? 0 : 1); // exit reflects the BINDING outcome (any-FAIL/dead lane/coerced-panel → non-zero)
}

function isSecurityPanelRole(role) {
  return role === "security-reviewer";
}

// QA-010: decide how a panel-lanes LOAD error is handled. For the SECURITY panel, ANY load failure —
// INCLUDING a missing module — fails CLOSED: a green security result cannot rest on an absent gate (the
// eval-fail-closed-vs-loader-fail-OPEN split, resolved at the loader boundary). For a non-security role
// the panel gate does not apply, so a genuinely-missing module fails OPEN (additive contract). A
// non-module-absent loader error (syntax/parse) ALWAYS fails closed. PURE + exported for teeth.
function panelLoaderFailClosed(role, err) {
  const moduleAbsent = err && err.code === "MODULE_NOT_FOUND" && /panel-lanes/.test(String((err && err.message) || ""));
  if (moduleAbsent && !isSecurityPanelRole(role)) return false; // additive fail-open (non-security only)
  return true; // security-reviewer + module-absent, OR any non-module-absent loader error → fail-closed
}

// Default ledger reader — the same-run completion records for a sprint (cert-attest is the single reader).
function defaultReadLedger(sprintId) {
  try {
    return require("./checks/cert-attest").readLedgerRecords(sprintId, null) || [];
  } catch {
    return [];
  }
}

// provider-id → tool-id, the SINGLE map (dispatch-agent). A lane's corroborating record must name the
// contracted EXECUTABLE (SR-010) — codex for openai, agy for antigravity, claude for claude.
function requireToolIdOf() {
  try {
    return require("./dispatch-agent").providerToolId;
  } catch {
    return (p) => ({ openai: "codex", antigravity: "agy" }[p] ?? p);
  }
}

function panelBlocked(reason) {
  const r = { status: "BLOCKED-INCONCLUSIVE", reason: `panel gate fail-closed: ${reason}` };
  return { floor_pass: false, manifest_valid: false, floor: r, binding: r };
}

// Run the D7 panelStatus reducer for BOTH profiles: panel-2family (the operative degraded floor that GATES
// today, agy operator-owned) and panel-3lab (the honest binding exit, BLOCKED-ON-OPERATOR while agy is
// down). `floor_pass` gates the runner. The gate can only HOLD (never loosen) the merged outcome.
//
// R2-B (SR-008): the manifest is VALIDATED (validatePanelManifest) before its profiles are trusted — a
// mutated/drifted manifest (required=['claude'], min_families=1) would otherwise let an all-Claude set
// pass. Any validator/loader error fails the runner CLOSED.
// R2-C (SR-009/QA-001-R2): liveness/provider/fallback are bound to the SAME-RUN LEDGER record, not the
// parsed child envelope — an envelope can claim ok:true while the ledger write failed (appendJsonl
// swallows errors). A lane with no corroborating durable record (non-null output_digest) has
// hasEvidence:false and is blocked. The verdict (a review JUDGMENT) still comes from the child output.
function applyPanelGate(panelLanes, lanes, ctx = {}) {
  const { panelStatus, STATUS, loadManifest, validatePanelManifest } = panelLanes;
  let validation;
  try {
    validation = validatePanelManifest();
  } catch (e) {
    return panelBlocked(`manifest validation threw: ${e.message}`);
  }
  if (!validation || !validation.ok) {
    return panelBlocked(`manifest INVALID: ${((validation && validation.errors) || []).join("; ")}`);
  }
  const manifest = loadManifest();

  const sprintId = ctx.sprintId || mcEnv.readEnv("SPRINT_ID") || null;
  const sinceMs = ctx.sinceMs || 0;
  const panelRunId = ctx.panelRunId || mcEnv.readEnv("PANEL_RUN_ID") || null;
  const readLedger = ctx.readLedger || defaultReadLedger;
  // SP-20260718-004 gauntlet R2 (SR-R2-002): a panel LANE record must also carry a valid origin-proof
  // signature — this liveness reader previously trusted field-only records, so a forged/edited record could
  // corroborate a lane. requireSignature default OFF in the programmatic API (preserves the panel-gate test
  // suite, which constructs unsigned fixtures); the LIVE dispatch-review call sets it TRUE.
  const requireSignature = ctx.requireSignature === true;
  const { verifyRecord } = require("./dispatch/attest-signing");
  // SR-011: correlate by RUN IDENTITY (panel_run_id) — not the firing-time window (a concurrent same-sprint
  // run could fall in the same window). The window remains a secondary narrow. If a panel_run_id was minted,
  // a record MUST carry the matching one to corroborate a lane.
  const records = (readLedger(sprintId) || []).filter((r) => {
    if (panelRunId && r.panel_run_id !== panelRunId) return false;
    if (!sinceMs) return true;
    const t = Date.parse(r.completed_at || "");
    return Number.isFinite(t) && t >= sinceMs;
  });
  const toolIdOf = requireToolIdOf();
  // Two-tier claude contract (SR-015, α-ruled — ADR-0016) resolved through the SINGLE provenance-verifier
  // choke-point (α round-6 / ED-225): the panel-2family FLOOR's claude lane is a subprocess-claude review;
  // the panel-3lab BINDING's claude lane is the in-process hunter (writer-stamped shape+role ONLY, no
  // settable via/record_via/sanctioned_lane_id). Identity is NOT re-implemented here — pv.laneContract +
  // pv.recordMatchesLane own it (the duplication was the SR-016/SR-017 root). Corroboration (SR-010:
  // durable-live-non-fallback record on the contracted executable) stays local.
  const pv = require("./dispatch/provenance-verifier");
  const buildObserved = (profileName) =>
    lanes.map((l) => {
      // R3-CRITICAL-02 (served-model fail-close via the SINGLE choke-point — the SAME predicate cert-attest's
      // attestLane uses, so this panelStatus BINDING reader and the attestPanelRun reader fail-close on ONE root,
      // not two drifting inline checks): a provider whose served model cannot be verified from a ledger record
      // (agy — no trustworthy server-origin served-model receipt, only the client-side "backend: label" echo)
      // can NEVER contribute a served-model-verified lane. A signed agy record proves LIVENESS but not the
      // served model (even served_default:true / attested_model_id=contracted-name), so it must NOT green the
      // panel-3lab BINDING. Force the lane un-attestable (no verified evidence) → panelStatus resolves it
      // operator-owned-absent (agy) → BLOCKED_ON_OPERATOR, never PASS. The FLOOR is unaffected (agy is not a
      // required floor lane). The genuine close is an authenticated served-model receipt (ED-060 / ED-230).
      if (pv.servedModelUnverifiableFromRecord(l.provider)) {
        return {
          laneId: l.laneId,
          contractedProvider: l.provider,
          observedProvider: l.observedProvider,
          fallback: true,
          alive: false,
          verdict: "error",
          hasEvidence: false,
        };
      }
      const contract = pv.laneContract(profileName, l.observedProvider);
      const rec = records.find((r) => {
        if (!pv.recordMatchesLane(r, contract, l.observedProvider)) return false; // IDENTITY from the module
        if (!(r.ok === true && r.fallback === false)) return false;
        if (requireSignature && !verifyRecord(r)) return false; // SR-R2-002: valid origin-proof sig required on the live path
        // The in-process hunter's proof is its evidence digest (no CLI cmdline); a subprocess/CLI lane needs
        // real output + a real invocation (cmdline_checksum) on the contracted executable (tool_id).
        if (contract.isHunter) return !!r.output_digest || !!r.evidence_sha;
        return !!r.output_digest && !!r.cmdline_checksum && r.tool_id === toolIdOf(l.observedProvider);
      });
      // SR-019 (ADR-0022): the panel-3lab BINDING claude lane binds its verdict to the SAME-RUN HUNTER
      // record (the `rec` found above via the choke-point identity), NEVER the floor subprocess pass's
      // l.verdict. A missing rec, or a hunter record with a missing/invalid verdict, resolves to "error"
      // → panelStatus BLOCKS at eval (a hunter-fail or hunter-absent can never read as the floor's pass).
      // The floor (isHunter:false) is unchanged: its verdict stays the subprocess/CLI child judgment.
      let verdict = l.verdict; // the review JUDGMENT from the child output (floor + CLI lanes)
      if (contract.isHunter) {
        const hv = rec && typeof rec.verdict === "string" ? rec.verdict.toLowerCase() : null;
        verdict = hv === "pass" || hv === "fail" || hv === "warn" ? hv : "error";
      }
      return {
        laneId: l.laneId,
        contractedProvider: l.provider,
        observedProvider: rec ? rec.provider : l.observedProvider,
        fallback: rec ? false : true,
        alive: !!rec,
        verdict,
        hasEvidence: !!rec,
      };
    });
  const floorProfile = { name: "panel-2family", ...manifest.profiles["panel-2family"] };
  const bindingProfile = { name: "panel-3lab", ...manifest.profiles["panel-3lab"] };
  const floor = panelStatus(floorProfile, buildObserved("panel-2family"), { agyOperatorOwned: true });
  const binding = panelStatus(bindingProfile, buildObserved("panel-3lab"), { agyOperatorOwned: true });
  return {
    floor_pass: floor.status === STATUS.PASS,
    manifest_valid: true,
    // Condition 3 (α ruling): the result records WHICH contract gated — no ambiguity about what passed.
    contract_evaluated: "panel-2family-floor",
    floor: { contract: "panel-2family-floor", claude_channel: "subprocess", status: floor.status, reason: floor.reason, families: floor.families, laneStatus: floor.laneStatus },
    binding: { contract: "panel-3lab-binding", claude_channel: "in-process-hunter", status: binding.status, reason: binding.reason, operator_blocked: binding.operator_blocked || null },
  };
}

// Merge per-lane outcomes into the binding review result. PURE (unit-testable). any-FAIL holds; a
// dead lane → "error" (the review did not fully run); else warn/pass. `ok` is the BINDING outcome —
// clean ONLY if every lane is alive AND the merged verdict is pass/warn (HIGH-1: a FAIL/error merged
// verdict can NEVER read as an ok dispatch). Output carries the reviewer-envelope shape (top-level +
// parsed `verdict`) so a verdict-gate consumer reads the MERGED verdict exactly like a single reviewer's.
function mergeLanes(role, lanes) {
  const anyFail = lanes.some((l) => l.verdict === "fail");
  // anyError = a DEAD lane (not ok) OR an ALIVE lane whose verdict is NOT an allowlisted PASS-class
  // value. BE-CQ-001 (backend-reviewer HIGH, fail-closed): the old check only caught verdict==="error",
  // so an UNKNOWN verdict string (a hallucinated/malformed "banana") merged to PASS — a binding
  // false-green (verified: verdict="banana" → ok=true). mergeLanes is called DIRECTLY (not only via
  // verdictOf), so the allowlist is enforced HERE too — anything that is not exactly pass/warn/fail
  // holds the review as "error". (A "fail" verdict IS allowlisted and is handled by anyFail above.)
  const anyError = lanes.some((l) => !l.ok || !VALID_REVIEW_VERDICTS.has(String(l.verdict || "").toLowerCase()));
  const mergedVerdict = anyFail ? "fail" : anyError ? "error" : lanes.some((l) => l.verdict === "warn") ? "warn" : "pass";
  const clean = !anyFail && !anyError; // clean iff EVERY lane is alive AND its verdict is pass/warn

  // Lane-diversity honesty (the lone-survivor bug). A binding security verdict needs ≥2 INDEPENDENT
  // labs (provider families). When lanes die and only ONE family survives, the review is fail-closed
  // (clean stays false — diversity loss HOLDS, §7), BUT the survivor's REAL verdict must be SURFACED,
  // not buried under an opaque "error" (BC-16-adjacent: a gate that lies about what it knows). These
  // additive fields let the orchestrator build a fix brief from the survivor's findings AND see the
  // below-bar flag, instead of manually re-running a clean single-provider dispatch to recover it.
  const multipass = lanes.length > 1;
  const live = lanes.filter((l) => l.ok);
  const liveFamilies = [...new Set(live.map((l) => l.provider))];
  const belowBar = multipass && liveFamilies.length < 2; // a multi-lab review that COLLAPSED to <2 families
  const survivingLanes = live.map((l) => ({ pass: l.pass, provider: l.provider, verdict: l.verdict, lane_out: l.lane_out || null }));
  // The lone survivor's verdict (exactly one family live) — preserved even when mergedVerdict="error".
  const survivingVerdict = liveFamilies.length === 1 && live.length >= 1 ? live[0].verdict : null;

  return {
    ok: clean,
    role,
    multipass,
    passes_run: lanes.length,
    lanes,
    allLanesOk: lanes.every((l) => l.ok),
    mergedVerdict,
    verdict: mergedVerdict,
    // Diversity-honesty (lone-survivor): surfaced, not buried. below_bar ⇒ a binding verdict is invalid
    // (fail-closed), but surviving_verdict carries what the lone live lane actually found.
    live_lanes: live.length,
    live_families: liveFamilies.length,
    below_bar: belowBar,
    surviving_lanes: survivingLanes,
    surviving_verdict: survivingVerdict,
    parsed: { agent: role, verdict: mergedVerdict, lanes },
  };
}

if (require.main === module) main();
module.exports = { verdictOf, mergeLanes, persistLane, laneFileName, isSecurityPanelRole, applyPanelGate, panelLoaderFailClosed };
