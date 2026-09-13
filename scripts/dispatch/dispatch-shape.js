#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * dispatch-shape.js — the LIVE dispatch-shape RESOLVER (PLAN §16/§17 north star).
 *
 * PLAN §14 north star: "every unit of work — skill OR agent — matched to the right
 * SHAPE; the wrong shape self-detecting; the chosen shape PROVEN." The substrate
 * existed (the dispatch-contract keystone classifies roles via `classForRole`;
 * `skillExecution` classifies skills fail-closed) — but there was NO single function
 * the orchestrator consults to ask "given THIS unit, what shape?", and nothing
 * applied the decision rule to an AD-HOC unit (the common case: Alpha deciding how
 * to dispatch some piece of work that isn't a pre-registered role/skill). That gap
 * is exactly why the wrong shape kept getting chosen by hand. This is that function.
 *
 * THE DECISION RULE (verbatim, PLAN §17 lines 29–34 — "decision rule (per unit)"):
 *   1. INLINE if it's light OR needs the live conversation.
 *   2. else SUBPROCESS (Claude via dispatch-claude, or cross-provider via
 *      dispatch-agent) if it RUNS headless (§13.6) AND pays+stays-good (§13.7).
 *   3. API only when no CLI exists for the capability.
 *   4. IN-PROCESS Agent tool only for small Claude returns that genuinely need
 *      orchestrator context (research/Plan/β); never for build-chain.
 *   5. CROSS-PROVIDER whenever the unit is independent review (no-verdict-on-own-work).
 *
 * THE SHAPE MENU (5 shapes — must match dispatch-contract.json `shapes`):
 *   inline · in-process-agent · subprocess-claude · subprocess-cross-provider · api
 *
 * resolveShape(unit) → { shape, proven, reason, source, unit }
 *   unit = { kind: "agent"|"skill"|"adhoc", id?, signals?: {...} }
 *   - kind "agent": delegate to the dispatch-contract (classForRole → allowed_shapes).
 *   - kind "skill": delegate to skillExecution — FAIL-CLOSED: a `subprocess` skill
 *     is only resolved to subprocess when subprocess_verified===true (the §13.7 proof);
 *     otherwise it resolves INLINE (the never-trust-an-unproven-subprocess rule).
 *   - kind "adhoc" (or an unknown id): apply the decision rule from `signals` + the
 *     research criteria matrix (PLAN §16 / the o3 report's decision framework).
 *
 * `proven` answers the north star's 3rd clause: is the chosen shape EARNED? A
 * subprocess skill is proven only with subprocess_verified; an adhoc subprocess is
 * NOT proven until it has a §13.6 ping + §13.7 measurement (so the resolver tells the
 * caller "subprocess is right IN PRINCIPLE, but run the skill inline until it's
 * proven" — never a silent unproven subprocess).
 *
 * shapeMismatch(actualShape, unit) → null | finding. The self-DETECTION half: compares
 * an actual dispatch's shape to what resolveShape would pick. A mismatch is the
 * "wrong shape" the north star says must be self-detecting (wire into route-guard /
 * the dispatch wrappers).
 *
 * Zero runtime deps; reuses scripts/dispatch/dispatch-contract.js. Fail-OPEN to a
 * conservative INLINE recommendation on any contract-read error (inline is always the
 * safe shape — it never spawns, never leaks, never fakes a proof).
 */

const path = require("path");

const SHAPES = new Set([
  "inline",
  "in-process-agent",
  "subprocess-claude",
  "subprocess-skill",
  "subprocess-cross-provider",
  "api",
]);

let CONTRACT = null;
function contract() {
  if (CONTRACT) return CONTRACT;
  try {
    CONTRACT = require(path.join(__dirname, "dispatch-contract.js"));
  } catch {
    CONTRACT = null;
  }
  return CONTRACT;
}

function res(shape, proven, reason, source, unit) {
  return { shape, proven: !!proven, reason, source, unit };
}

// ── Agent (role) → the contract is the authority ─────────────────────────────
function resolveAgent(id, signals) {
  const c = contract();
  if (!c || typeof c.contractForRole !== "function") {
    return res("inline", false, `no dispatch-contract available — fail-open to inline for role '${id}'`, "fail-open", { kind: "agent", id });
  }
  let block;
  try {
    block = c.contractForRole(id);
  } catch (e) {
    return res("inline", false, `contract read failed for '${id}' (${e.message}) — fail-open to inline`, "fail-open", { kind: "agent", id });
  }
  const allowed = (block && block.allowed_shapes) || [];
  // The contract pins each class to a single canonical shape (face=inline,
  // build_chain_worker=subprocess-claude, cross_provider_reviewer=
  // subprocess-cross-provider, claude_pinned_reviewer/manager=in-process-agent).
  // The decision-rule invariants are already encoded as forbidden_shapes there;
  // we surface the FIRST allowed shape as the canonical pick.
  if (allowed.length) {
    const shape = allowed[0];
    return res(shape, true, `role '${id}' is contract class with allowed_shapes=[${allowed.join(", ")}]`, "contract", { kind: "agent", id });
  }
  // Unknown role (not in the role-registry, so classForRole returned null) → before
  // falling to a SIGNAL-LESS ad-hoc resolution (which picks "no distinguishing signal
  // → inline" even for a REAL subprocess builder — the W2 "fix-first" resolver weakness:
  // it once picked 'inline' for a real subprocess builder), derive the distinguishing
  // signal from the role-id NAME. This mirrors W0's truthful-builder-advisory approach
  // ('builder'→build_chain_worker for unknown ids). A build-chain worker (…builder/…fixer)
  // is NEVER inline (Rule 4); an independent reviewer/redteam needs model diversity
  // (Rule 5). The pick is labeled source="unknown-role-name-heuristic" so it is auditable
  // + distinguishable from a registry/contract classification. (Known roles never reach
  // here — they resolve via the contract above.)
  const lname = String(id || "").toLowerCase();
  if (/(^|[-_])(builder|fixer)([-_]|$)/.test(lname)) {
    return res("subprocess-claude", true, `unknown role '${id}' — id name indicates a build-chain worker → subprocess-claude (Rule 4: build-chain is NEVER in-process; name-heuristic, not a registry match)`, "unknown-role-name-heuristic", { kind: "agent", id });
  }
  if (/(^|[-_])(reviewer|redteam)([-_]|$)/.test(lname)) {
    return res("subprocess-cross-provider", true, `unknown role '${id}' — id name indicates an independent reviewer → cross-provider subprocess (Rule 5: no-verdict-on-own-work; name-heuristic, not a registry match)`, "unknown-role-name-heuristic", { kind: "agent", id });
  }
  // No name signal either → treat as ad-hoc using its signals (inline is the safe default).
  return resolveAdhoc({ ...(signals || {}), _unknownRole: id });
}

// ── Skill → skillExecution, fail-closed on the earn-it proof ─────────────────
function resolveSkill(id, signals) {
  const c = contract();
  if (!c || typeof c.skillExecution !== "function") {
    return res("inline", false, `no dispatch-contract available — fail-open to inline for skill '${id}'`, "fail-open", { kind: "skill", id });
  }
  let exec;
  try {
    exec = c.skillExecution(id);
  } catch (e) {
    return res("inline", false, `skillExecution failed for '${id}' (${e.message}) — fail-open to inline`, "fail-open", { kind: "skill", id });
  }
  // skillExecution may return a string ("inline"/"subprocess"/"inline-required") or an
  // object. NOTE the real contract object shape: { execution, verified, source } — the
  // earned flag is `verified`, NOT `subprocess_verified` (dispatch-contract.js
  // skillExecution line 194). Read BOTH so a proven skill is honored regardless of which
  // field a caller/contract version uses (the field-name bug the T-270 gauntlet found:
  // reading only `subprocess_verified` routed every PROVEN subprocess skill back to inline).
  const execution = typeof exec === "string" ? exec : (exec && exec.execution) || "inline";
  const verified =
    typeof exec === "object" && exec
      ? exec.verified === true || exec.subprocess_verified === true
      : undefined;
  // The contract PRE-DOWNGRADES an unverified subprocess to execution:"inline" with
  // source "unverified-subprocess-falls-back-to-inline". That is STILL an unproven unit —
  // it must NOT be reported proven:true (the second bug the gauntlet found: a downgraded
  // unproven skill claimed proven:true, hiding that it's an un-earned subprocess).
  const downgradedUnproven =
    typeof exec === "object" && exec && /unverified-subprocess/.test(String(exec.source || ""));

  if (execution === "inline" || execution === "inline-required") {
    if (downgradedUnproven) {
      return res("inline", false, `skill '${id}' is a SUBPROCESS CANDIDATE the contract downgraded to inline (NOT yet earned §13.6+§13.7) — run inline until stamped (fail-closed)`, "skill-registry-failclosed", { kind: "skill", id });
    }
    return res("inline", true, `skill '${id}' is ${execution}${execution === "inline-required" ? " (needs the live conversation — §13.5)" : ""}`, "skill-registry", { kind: "skill", id });
  }
  if (execution === "subprocess") {
    // The earn-it gate: a subprocess skill routes subprocess ONLY when proven
    // (§13.6 ran headless + §13.7 pays+good → subprocess_verified:true). The
    // contract's own reader already downgrades unverified→inline; we make the
    // DECISION explicit + carry the `proven` signal so the caller never silently
    // runs an unproven subprocess.
    if (verified === true) {
      return res("subprocess-skill", true, `skill '${id}' is subprocess + verified (earned §13.6+§13.7)`, "skill-registry", { kind: "skill", id });
    }
    return res("inline", false, `skill '${id}' is a SUBPROCESS CANDIDATE but NOT yet earned (verified=${verified}) — run inline until §13.6 ping + §13.7 measurement stamp it (fail-closed)`, "skill-registry-failclosed", { kind: "skill", id });
  }
  // Unknown execution → fall back to the decision rule.
  return resolveAdhoc({ ...(signals || {}), _skill: id });
}

// ── Ad-hoc unit → the decision rule + research criteria matrix ────────────────
// signals (all optional booleans unless noted):
//   light                 — trivial work (formatting, a quick lookup)
//   needsLiveConversation — output is derived from THIS conversation (e.g. a handoff)
//   independentReview     — an independent verdict on work (no-verdict-on-own-work)
//   buildChain            — edits a repo / is a builder|fixer (must isolate)
//   noCLIcapability       — capability has NO CLI (deep-research / GPT-Pro)
//   smallClaudeReturnNeedsContext — research/Plan/β with a SMALL return that needs
//                           orchestrator context (the only sanctioned in-process lane)
//   headlessCapable       — can run with no live conversation (eligible for subprocess)
//   provenSubprocess      — a §13.6+§13.7 proof already exists for this unit
function resolveAdhoc(signals) {
  const s = signals || {};
  const unit = { kind: "adhoc", signals: s };

  // Rule 3 — API only when no CLI exists (availability ≠ authorization; §N-2).
  if (s.noCLIcapability) {
    return res("api", true, "no CLI exists for this capability → API (the only sanctioned API case)", "decision-rule", unit);
  }
  // Rule 5 — independent review → cross-provider (model diversity, no self-grading).
  if (s.independentReview) {
    return res("subprocess-cross-provider", true, "independent review → cross-provider subprocess (no-verdict-on-own-work invariant)", "decision-rule", unit);
  }
  // Rule 4 — build-chain is NEVER in-process; it is subprocess-claude (isolated).
  if (s.buildChain) {
    return res("subprocess-claude", true, "build-chain (edits a repo) → subprocess-claude, isolated worktree (NEVER in-process)", "decision-rule", unit);
  }
  // Rule 1 — inline if light OR needs the live conversation.
  if (s.light || s.needsLiveConversation) {
    return res("inline", true, s.needsLiveConversation ? "needs the live conversation → inline" : "light work → inline", "decision-rule", unit);
  }
  // Rule 4 — in-process ONLY for a small Claude return that needs orchestrator
  // context (research / Plan / β). This is the one sanctioned in-process lane.
  if (s.smallClaudeReturnNeedsContext) {
    return res("in-process-agent", true, "small Claude return that needs orchestrator context (research/Plan/β) → in-process Agent tool", "decision-rule", unit);
  }
  // Rule 2 — else SUBPROCESS if it runs headless AND is proven. Heavy/headless
  // work is subprocess IN PRINCIPLE, but NOT proven until §13.6+§13.7 — so we pick
  // subprocess-claude but mark proven=false unless a proof exists: the caller must
  // run it inline (or earn it) until then. Never a silent unproven subprocess.
  if (s.headlessCapable) {
    if (s.provenSubprocess) {
      return res("subprocess-claude", true, "heavy + headless + proven (§13.6+§13.7) → subprocess-claude", "decision-rule", unit);
    }
    return res("inline", false, "heavy + headless → subprocess is the RIGHT shape in principle, but UNPROVEN (no §13.6 ping + §13.7 measurement) → run inline until earned (fail-closed)", "decision-rule-failclosed", unit);
  }
  // Default — when nothing distinguishes it, inline is the safe shape.
  return res("inline", true, "no distinguishing signal → inline (the safe default; it never spawns, leaks, or fakes a proof)", "decision-rule-default", unit);
}

// ── Public: resolve any unit ─────────────────────────────────────────────────
function resolveShape(unit) {
  const u = unit || {};
  const kind = u.kind || (u.id ? "agent" : "adhoc");
  if (kind === "agent") return resolveAgent(u.id, u.signals);
  if (kind === "skill") return resolveSkill(u.id, u.signals);
  return resolveAdhoc(u.signals);
}

// ── Public: self-detection — is the ACTUAL shape the right one? ───────────────
function shapeMismatch(actualShape, unit) {
  const want = resolveShape(unit);
  if (!SHAPES.has(actualShape)) {
    return { mismatch: true, actual: actualShape, expected: want.shape, reason: `'${actualShape}' is not a known dispatch shape`, expectedReason: want.reason };
  }
  if (actualShape === want.shape) return null;
  // TWO severity=high cases (dangerous mismatches the north star targets):
  //   1. UNPROVEN unit dispatched as any subprocess shape — an unproven subprocess
  //      may hang, leak, or fake a proof (the fail-closed rule violation).
  //   2. subprocess-claude unit (build-chain role) dispatched as in-process-agent —
  //      violates worktree isolation: the builder runs inside the orchestrator's
  //      context and can touch files it must not (§2(iii) failure; G2 guardrail).
  // FIX (W2 gauntlet HIGH-1): a FAIL-OPEN resolution (source "fail-open" — the dispatch-contract
  // was unavailable/unreadable) carries proven:false as "UNKNOWN", not "genuinely unproven". It
  // must NOT count as the dangerous unproven-subprocess case, else a transient contract-read
  // failure would make the ENFORCE door REFUSE every real subprocess dispatch (a self-inflicted
  // outage — the opposite of fail-open). The earn-it FAIL-CLOSED cases (source "...-failclosed")
  // are a REAL unproven verdict and DO stay high-severity.
  const unprovenSubprocess =
    !want.proven && want.source !== "fail-open" && /^subprocess/.test(actualShape);
  const buildChainInProcess = want.shape === "subprocess-claude" && actualShape === "in-process-agent";
  return {
    mismatch: true,
    actual: actualShape,
    expected: want.shape,
    proven: want.proven,
    source: want.source,
    reason: `dispatched as '${actualShape}' but the resolver picks '${want.shape}'`,
    expectedReason: want.reason,
    severity: (unprovenSubprocess || buildChainInProcess) ? "high" : "medium",
  };
}

// ── Public: the SHAPE DOOR — the per-wrapper enforce gate (W2-core, SP-20260616-001) ──
// The ONE shared gate every dispatch entry point consults at spawn, so the
// report→enforce ramp + kill-switch + fail-open live in ONE place instead of being
// copy-pasted into 4 callers. Shipped report-only, then RAMPED per-wrapper: the 3 agent
// wrappers (dispatch-agent/dispatch-claude/epsilon CLAUDE_RAW) now pass enforceDefault:true and
// ENFORCE by default (W2/N2 flip, 2026-06-16, dual-lane gauntlet-green); dispatch-skill stays
// reportOnlyPin'd (ED-057 earn-it). The global env still overrides both ways (fleet kill /
// fleet enforce); a per-wrapper env=report force-reports just that wrapper.
//
// This is THE shape-enforce authority for self-detection (β#2): the wrappers'
// historical inline `MC_DISPATCH_CONTRACT_ENFORCE === "block"` shape check is
// folded in here as a DEPRECATED back-compat alias (so a CI/fixture/harness that set
// the old var keeps getting shape-refusal — the anthropic→claude rename bug class).
// The separate contract-CONSULT block keeps its OWN toggle; this gate governs only the
// shape-resolver self-detection.
//
// Toggles (read from `env`, injected for testability):
//   MC_SHAPE_DOOR        = report | enforce   (per-process; default report)
//   MC_DISABLE_SHAPE_DOOR = 1|true|yes        (KILL-SWITCH; forces report, beats enforce)
//   MC_DISPATCH_CONTRACT_ENFORCE = block      (DEPRECATED alias → enforce, back-compat)
//
// Branch order is EXPLICIT (β#3 — never an implicit catch-all; the W1 breaker-TTL lesson):
//   (1) kill-switch / report-only-pin  → force report+proceed
//   (2) resolver throws                → fail-OPEN proceed (reason "resolver-threw-fail-open")
//   (3) no mismatch OR opts.sanctioned → proceed (sanctioned suppresses the advisory; β#1)
//   (4) enforce AND severity==="high"  → REFUSE (the caller exits 2 with a named reason)
//   (5) otherwise (report, or non-high)→ advisory proceed
//
// opts:
//   sanctioned   {boolean} — the SANCTIONED-LANE VERDICT (dispatch-claude fallbackSanctioned;
//                            NEVER the bare --review-fallback flag — β#1 preserves FIX-A3).
//   reportOnlyPin {boolean} — pin this wrapper to report regardless of the door mode. Used by
//                            dispatch-skill: the resolver routes {kind:skill} to `inline` (skills
//                            are not earned-subprocess), so an enforce gate would false-refuse
//                            EVERY skill dispatch until the resolver gains a `subprocess-skill`
//                            shape (logged enforcement-debt). Pin keeps the advisory, never refuses.
//   enforceDefault {boolean} — the per-wrapper ENFORCE flip (W2/N2): this wrapper enforces by
//                            DEFAULT when the global MC_SHAPE_DOOR env is unset, so wrappers
//                            ramp one at a time. A global MC_SHAPE_DOOR=report (or the
//                            kill-switch / pin) still overrides it back to report.
//
// Returns { action:"proceed"|"refuse", mode, severity, suppressed, reason, mismatch }.
function shapeDoor(actualShape, unit, env, opts) {
  const e = env || process.env;
  const o = opts || {};
  const killed = /^(1|true|yes)$/i.test(String(mcEnv.readEnv("DISABLE_SHAPE_DOOR", e) || ""));
  const pinned = o.reportOnlyPin === true;
  const legacyBlock = String(mcEnv.readEnv("DISPATCH_CONTRACT_ENFORCE", e) || "") === "block";
  // W2 per-wrapper ENFORCE ramp (N2): a wrapper opts into enforce as its DEFAULT via
  // opts.enforceDefault (the persistent, committed per-wrapper flip), so wrappers ramp ONE
  // AT A TIME, lowest-blast first — instead of a single global all-or-nothing switch. The
  // global env still wins both ways so an operator keeps a fleet-wide override + kill:
  //   MC_DISABLE_SHAPE_DOOR / reportOnlyPin  → force report (ultimate escapes, beat all)
  //   MC_SHAPE_DOOR=enforce (or legacy block) → force enforce fleet-wide
  //   MC_SHAPE_DOOR=report                    → force report fleet-wide (kills the flip)
  //   else (env unset)                            → the wrapper's enforceDefault decides
  const globalRaw = String(mcEnv.readEnv("SHAPE_DOOR", e) || "").toLowerCase(); // "" = unset
  const wrapperEnforce = o.enforceDefault === true;
  // (1) kill-switch / pin checked FIRST — they beat enforce unconditionally (safe side).
  // FIX (W2 gauntlet HIGH-2): an EXPLICIT MC_SHAPE_DOOR=report is the operator's fleet kill
  // and must beat the legacy MC_DISPATCH_CONTRACT_ENFORCE=block alias — so it is checked
  // BEFORE enforce/legacyBlock (a stale legacy env must never override an explicit report kill).
  let mode;
  if (killed || pinned) mode = "report";
  else if (globalRaw === "report") mode = "report";
  else if (globalRaw === "enforce" || legacyBlock) mode = "enforce";
  else mode = wrapperEnforce ? "enforce" : "report";
  // (2) resolver fault → fail-OPEN. A self-detection gate must never break a working dispatch.
  let mm;
  try {
    mm = shapeMismatch(actualShape, unit);
  } catch (err) {
    return { action: "proceed", mode, severity: null, suppressed: false, reason: `resolver-threw-fail-open (${err && err.message})`, mismatch: null };
  }
  // (3) right shape → proceed; sanctioned lane → proceed + suppress the advisory (β#1).
  if (!mm || !mm.mismatch) {
    return { action: "proceed", mode, severity: null, suppressed: false, reason: "shape matches resolver", mismatch: null };
  }
  if (o.sanctioned === true) {
    return { action: "proceed", mode, severity: mm.severity || null, suppressed: true, reason: "sanctioned lane — shape mismatch is intentional + registered (advisory suppressed)", mismatch: mm };
  }
  // (4) enforce + high-severity → REFUSE (caller exits 2). (5) else → advisory proceed.
  if (mode === "enforce" && mm.severity === "high") {
    return { action: "refuse", mode, severity: "high", suppressed: false, reason: `shape-door REFUSE: ${mm.reason} (${mm.expectedReason || "wrong wrapper"})`, mismatch: mm };
  }
  return { action: "proceed", mode, severity: mm.severity || null, suppressed: false, reason: `advisory (${mode}): ${mm.reason}`, mismatch: mm };
}

// ── Public: the PARALLELISM AXIS (S-LC-06 / PLAN §8.7) ───────────────────────
// The self-detection family extends from "is THIS unit's shape right?" (shapeMismatch)
// to "is this BATCH dispatched with the right PARALLELISM?". Two advisory findings,
// REPORT-ONLY this sprint (no block):
//
//   UNDER-dispatch — safe-parallel work run SERIALLY. A batch whose units are
//     pairwise DISJOINT (no shared file/worktree) but arranged serially could fan
//     out. Surfaced so the orchestrator parallelizes by default (the operator's
//     standing "default to parallel when the primitive exists").
//   OVER-dispatch — two units targeting the SAME file/worktree dispatched in
//     PARALLEL → collision risk (two builders racing one file / one worktree).
//
// A "unit" = { id, files?: string[], worktree?: string }. The batch plan =
//   { units: [...], arrangement: "parallel" | "serial" }.
// Resource scope of a unit = its files ∪ (worktree as a pseudo-resource). Two
// units OVERLAP iff they share any file or the same worktree.
//
// FAIL-OPEN: any detector error → [] (no finding), NEVER throws. An advisory axis
// must never break a dispatch; a missing/garbled plan simply yields no advice.
function _resourcesOf(unit) {
  const set = new Set();
  if (unit && Array.isArray(unit.files)) {
    for (const f of unit.files) if (typeof f === "string" && f) set.add("file:" + f);
  }
  if (unit && typeof unit.worktree === "string" && unit.worktree) set.add("wt:" + unit.worktree);
  return set;
}

function _overlap(a, b) {
  for (const r of a) if (b.has(r)) return r;
  return null;
}

function parallelismFindings(plan) {
  try {
    const p = plan || {};
    const units = Array.isArray(p.units) ? p.units.filter((u) => u && (u.id != null)) : [];
    if (units.length < 2) return []; // parallelism only meaningful for ≥2 units
    const arrangement = p.arrangement === "parallel" ? "parallel" : "serial";
    const findings = [];
    const resources = units.map(_resourcesOf);

    // Pairwise overlap scan → both the collision pairs and the disjoint graph.
    const collisions = [];
    // Union-Find over units to count independent (disjoint) groups.
    const parent = units.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; };
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const shared = _overlap(resources[i], resources[j]);
        if (shared) {
          collisions.push({ a: units[i].id, b: units[j].id, resource: shared });
          union(i, j);
        }
      }
    }

    if (arrangement === "parallel" && collisions.length) {
      // OVER-dispatch: parallel units sharing a resource → collision risk.
      findings.push({
        axis: "parallelism",
        kind: "over-dispatch",
        severity: "high",
        advisory: true,
        arrangement,
        collisions,
        reason: `${collisions.length} unit-pair(s) target the SAME file/worktree but are dispatched in parallel — collision risk (two units racing one resource). Serialize the colliding pairs or split their scope.`,
      });
    }

    if (arrangement === "serial") {
      // UNDER-dispatch: serial batch that partitions into ≥2 disjoint groups → safe
      // to parallelize the independent lanes.
      const groups = new Set(units.map((_, i) => find(i)));
      if (groups.size >= 2) {
        // Map each disjoint group to its unit ids for the advice payload.
        const byRoot = new Map();
        units.forEach((u, i) => {
          const r = find(i);
          if (!byRoot.has(r)) byRoot.set(r, []);
          byRoot.get(r).push(u.id);
        });
        findings.push({
          axis: "parallelism",
          kind: "under-dispatch",
          severity: "low",
          advisory: true,
          arrangement,
          lanes: [...byRoot.values()],
          reason: `${groups.size} disjoint unit-group(s) are dispatched serially but share NO file/worktree — safe to fan out into ${groups.size} parallel lanes (default-to-parallel).`,
        });
      }
    }

    return findings;
  } catch {
    // FAIL-OPEN: an advisory axis must never throw or block a dispatch.
    return [];
  }
}

module.exports = { resolveShape, shapeMismatch, shapeDoor, resolveAgent, resolveSkill, resolveAdhoc, parallelismFindings, SHAPES };

// ── CLI: `node dispatch-shape.js --agent backend-builder` etc. ────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help")) {
    process.stdout.write(
      "usage:\n" +
        "  dispatch-shape.js --agent <role>\n" +
        "  dispatch-shape.js --skill <ns:skill>\n" +
        "  dispatch-shape.js --adhoc <signal>[,<signal>...]   (e.g. --adhoc independentReview)\n",
    );
    process.exit(argv.length ? 0 : 2);
  }
  let unit;
  const i = argv.indexOf("--agent");
  const j = argv.indexOf("--skill");
  const k = argv.indexOf("--adhoc");
  if (i !== -1) unit = { kind: "agent", id: argv[i + 1] };
  else if (j !== -1) unit = { kind: "skill", id: argv[j + 1] };
  else if (k !== -1) {
    const signals = {};
    (argv[k + 1] || "").split(",").filter(Boolean).forEach((s) => (signals[s] = true));
    unit = { kind: "adhoc", signals };
  } else {
    process.stderr.write("need --agent|--skill|--adhoc\n");
    process.exit(2);
  }
  const r = resolveShape(unit);
  process.stdout.write(
    `shape: ${r.shape}\nproven: ${r.proven}\nsource: ${r.source}\nreason: ${r.reason}\n`,
  );
  process.exit(0);
}
