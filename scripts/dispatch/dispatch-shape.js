#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

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
  if (allowed.length) {
    const shape = allowed[0];
    return res(shape, true, `role '${id}' is contract class with allowed_shapes=[${allowed.join(", ")}]`, "contract", { kind: "agent", id });
  }
  const lname = String(id || "").toLowerCase();
  if (/(^|[-_])(builder|fixer)([-_]|$)/.test(lname)) {
    return res("subprocess-claude", true, `unknown role '${id}' — id name indicates a build-chain worker → subprocess-claude (Rule 6: build-chain is NEVER in-process; name-heuristic, not a registry match)`, "unknown-role-name-heuristic", { kind: "agent", id });
  }
  if (/(^|[-_])(reviewer|redteam)([-_]|$)/.test(lname)) {
    return res("subprocess-cross-provider", true, `unknown role '${id}' — id name indicates an independent reviewer → cross-provider subprocess (Rule 5: no-verdict-on-own-work; name-heuristic, not a registry match)`, "unknown-role-name-heuristic", { kind: "agent", id });
  }
  return resolveAdhoc({ ...(signals || {}), _unknownRole: id });
}

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
  const execution = typeof exec === "string" ? exec : (exec && exec.execution) || "inline";
  const verified =
    typeof exec === "object" && exec
      ? exec.verified === true || exec.subprocess_verified === true
      : undefined;
  const downgradedUnproven =
    typeof exec === "object" && exec && /unverified-subprocess/.test(String(exec.source || ""));

  if (execution === "inline" || execution === "inline-required") {
    if (downgradedUnproven) {
      return res("inline", false, `skill '${id}' is a SUBPROCESS CANDIDATE the contract downgraded to inline (NOT yet earned) — run inline until stamped (fail-closed)`, "skill-registry-failclosed", { kind: "skill", id });
    }
    return res("inline", true, `skill '${id}' is ${execution}${execution === "inline-required" ? " (needs the live conversation)" : ""}`, "skill-registry", { kind: "skill", id });
  }
  if (execution === "subprocess") {
    if (verified === true) {
      return res("subprocess-skill", true, `skill '${id}' is subprocess + verified (earned)`, "skill-registry", { kind: "skill", id });
    }
    return res("inline", false, `skill '${id}' is a SUBPROCESS CANDIDATE but NOT yet earned (verified=${verified}) — run inline until a ping + measurement stamp it (fail-closed)`, "skill-registry-failclosed", { kind: "skill", id });
  }
  return resolveAdhoc({ ...(signals || {}), _skill: id });
}

function resolveAdhoc(signals) {
  const s = signals || {};
  const unit = { kind: "adhoc", signals: s };

  if (s.noCLIcapability) {
    return res("api", true, "no CLI exists for this capability → API (the only sanctioned API case)", "decision-rule", unit);
  }
  if (s.independentReview) {
    return res("subprocess-cross-provider", true, "independent review → cross-provider subprocess (no-verdict-on-own-work invariant)", "decision-rule", unit);
  }
  if (s.buildChain) {
    return res("subprocess-claude", true, "build-chain (edits a repo) → subprocess-claude, isolated worktree (NEVER in-process)", "decision-rule", unit);
  }
  if (s.light || s.needsLiveConversation) {
    return res("inline", true, s.needsLiveConversation ? "needs the live conversation → inline" : "light work → inline", "decision-rule", unit);
  }
  if (s.smallClaudeReturnNeedsContext) {
    return res("in-process-agent", true, "small Claude return that needs orchestrator context (research/Plan/β) → in-process Agent tool", "decision-rule", unit);
  }
  if (s.headlessCapable) {
    if (s.provenSubprocess) {
      return res("subprocess-claude", true, "heavy + headless + proven → subprocess-claude", "decision-rule", unit);
    }
    return res("inline", false, "heavy + headless → subprocess is the RIGHT shape in principle, but UNPROVEN (no ping + measurement) → run inline until earned (fail-closed)", "decision-rule-failclosed", unit);
  }
  return res("inline", true, "no distinguishing signal → inline (the safe default; it never spawns, leaks, or fakes a proof)", "decision-rule-default", unit);
}

function resolveShape(unit) {
  const u = unit || {};
  const kind = u.kind || (u.id ? "agent" : "adhoc");
  if (kind === "agent") return resolveAgent(u.id, u.signals);
  if (kind === "skill") return resolveSkill(u.id, u.signals);
  return resolveAdhoc(u.signals);
}

function shapeMismatch(actualShape, unit) {
  const want = resolveShape(unit);
  if (!SHAPES.has(actualShape)) {
    return { mismatch: true, actual: actualShape, expected: want.shape, reason: `'${actualShape}' is not a known dispatch shape`, expectedReason: want.reason };
  }
  if (actualShape === want.shape) return null;
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

function shapeDoor(actualShape, unit, env, opts) {
  const e = env || process.env;
  const o = opts || {};
  const killed = /^(1|true|yes)$/i.test(String(mcEnv.readEnv("DISABLE_SHAPE_DOOR", e) || ""));
  const pinned = o.reportOnlyPin === true;
  const legacyBlock = String(mcEnv.readEnv("DISPATCH_CONTRACT_ENFORCE", e) || "") === "block";
  const globalRaw = String(mcEnv.readEnv("SHAPE_DOOR", e) || "").toLowerCase();
  const wrapperEnforce = o.enforceDefault === true;
  let mode;
  if (killed || pinned) mode = "report";
  else if (globalRaw === "report") mode = "report";
  else if (globalRaw === "enforce" || legacyBlock) mode = "enforce";
  else mode = wrapperEnforce ? "enforce" : "report";
  let mm;
  try {
    mm = shapeMismatch(actualShape, unit);
  } catch (err) {
    return { action: "proceed", mode, severity: null, suppressed: false, reason: `resolver-threw-fail-open (${err && err.message})`, mismatch: null };
  }
  if (!mm || !mm.mismatch) {
    return { action: "proceed", mode, severity: null, suppressed: false, reason: "shape matches resolver", mismatch: null };
  }
  if (o.sanctioned === true) {
    return { action: "proceed", mode, severity: mm.severity || null, suppressed: true, reason: "sanctioned lane — shape mismatch is intentional + registered (advisory suppressed)", mismatch: mm };
  }
  if (mode === "enforce" && mm.severity === "high") {
    return { action: "refuse", mode, severity: "high", suppressed: false, reason: `shape-door REFUSE: ${mm.reason} (${mm.expectedReason || "wrong wrapper"})`, mismatch: mm };
  }
  return { action: "proceed", mode, severity: mm.severity || null, suppressed: false, reason: `advisory (${mode}): ${mm.reason}`, mismatch: mm };
}

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
    if (units.length < 2) return [];
    const arrangement = p.arrangement === "parallel" ? "parallel" : "serial";
    const findings = [];
    const resources = units.map(_resourcesOf);

    const collisions = [];
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
      const groups = new Set(units.map((_, i) => find(i)));
      if (groups.size >= 2) {
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
    return [];
  }
}

module.exports = { resolveShape, shapeMismatch, shapeDoor, resolveAgent, resolveSkill, resolveAdhoc, parallelismFindings, SHAPES };

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
