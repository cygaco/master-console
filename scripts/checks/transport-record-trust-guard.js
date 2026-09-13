#!/usr/bin/env node
"use strict";
/**
 * transport-record-trust-guard.js — the RECORD-TRUST STRUCTURAL GUARD for the brokered transport
 * (SP-20260721-001 D-4 INC-1, unit SEC-1; the design-phase gate over scripts/dispatch/trusted-controller.js).
 *
 * WHAT IT PROTECTS: the three record-trust invariants that make the transport's fenced CAS trustworthy.
 * Each is a STRUCTURAL property of the source — checkable without running it, and therefore checkable
 * BEFORE a regression can land:
 *
 *   G1  THE FENCE TOKEN IS NEVER CALLER-ASSERTED. The token handed to `withControllerFence` is resolved
 *       FRESH from the lease store via `defaultLeaseTokenResolver` (or the sanctioned `*ForTest` seam).
 *       A caller-supplied `leaseToken` / `base_commit` / `expectedHead` / `anchor` / `candidateRoot` must
 *       be UNPASSABLE: `TRANSPORT_OPT_KEYS` is the frozen allowlist and none of those keys may appear in
 *       it. (A docstring is not a boundary; the allowlist is.)
 *
 *   G2  EXACTLY TWO SANCTIONED FENCE CALL SITES, and `withControllerFence` is the SOLE env-setting site.
 *       As built, those two are:
 *         • `integrateInternal`        — the UNIT path (acceptance-record-bound commitIntegration CAS)
 *         • `fencedRefUpdateInternal`  — the TRANSPORT path (the merge/release update-ref CAS)
 *       A THIRD call site is a VIOLATION: it would mean some new code can raise the fence around a write
 *       nobody reviewed. NOTE (build-reality, not assumption): this guard asserts TWO because BE-1 landed
 *       the transport path as a second sanctioned site. The transport CAS is a direct `git update-ref` in
 *       `defaultRefUpdater` rather than `commitIntegration` BY DESIGN — a merge/release write has no
 *       AcceptanceRecord, and fabricating one would be the false-green genesis the design refuses.
 *
 *   G3  THE FROZEN SKIP ALLOWANCE IS NOT WIDENED. `TRANSPORT_SKIP_ALLOWED` pins EXACTLY ONE
 *       name→reason pair: `false-green-envelope` → `no-envelope-in-context`. That single skip is honest
 *       (a transport write genuinely has no ResultEnvelope, so an envelope-shape tripwire has nothing to
 *       inspect). ANY additional entry, any changed reason, or an unfrozen table turns the pinned suite
 *       into a dead gate one skip at a time. Widening is flagged here as a visible, reviewable finding.
 *       HOUSING (e5cd99b6, 2026-07-23, β DECIDE B/0.90 precommit-skip-alignment): the frozen literal was
 *       RE-HOUSED out of the controller into `scripts/dispatch/transport-skip-allowlist.js` so the
 *       non-authoritative pre-commit hook binds to the SAME single source. The guard therefore accepts
 *       exactly two shapes and no other: the literal INLINE in the controller, or the controller binding
 *       `TRANSPORT_SKIP_ALLOWED` via `require()` to THAT pinned module — in which case the frozen literal
 *       is checked THERE. A require re-pointed at any other module, a dangling require, or an unfrozen
 *       table in the housing module is a G3 finding (a moved definition must not become an unguarded one).
 *
 * RELATIONSHIP TO THE FALSIFIERS: this guard proves the SHAPE of the source (no third fence site, no
 * caller-reachable token, no widened skip). The falsifiers prove the BEHAVIOR (a forged token is refused,
 * a caller anchor is ignored, a failing tree cannot land). Shape + behavior; neither substitutes.
 *
 * USAGE: node scripts/checks/transport-record-trust-guard.js [--json]
 * EXIT:  0 = all invariants hold · 1 = a record-trust violation · 2 = could-not-run (FAIL-CLOSED).
 */
const fs = require("fs");
const path = require("path");

function resolveRoot() {
  const anchor = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchor, ".claude"))) return anchor;
  return process.env.CLAUDE_PROJECT_DIR || anchor;
}
const ROOT = resolveRoot();
const CONTROLLER_REL = "scripts/dispatch/trusted-controller.js";
/** The ONE sanctioned housing for the re-housed skip allowance (see G3 HOUSING above). */
const SKIP_ALLOWLIST_REL = "scripts/dispatch/transport-skip-allowlist.js";

/** The EXACT sanctioned fence call sites, by enclosing function. A third is a violation. */
const SANCTIONED_FENCE_CALLERS = Object.freeze(["integrateInternal", "fencedRefUpdateInternal"]);
const EXPECTED_FENCE_CALL_SITES = SANCTIONED_FENCE_CALLERS.length; // 2

/** Keys that must NEVER be readable from caller `opts` (each would re-open a closed trust hole). */
const FORBIDDEN_OPT_KEYS = Object.freeze(["leaseToken", "base_commit", "expectedHead", "anchor", "candidateRoot"]);

/** The FROZEN skip allowance, mirrored here so a source-side widening shows up as a guard finding. */
const PINNED_SKIP_ALLOWANCE = Object.freeze({ "false-green-envelope": "no-envelope-in-context" });

/** Strip line comments / block comments so a DOC MENTION of a call is never counted as a call. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

/** Which top-level `function NAME(` encloses a given index. */
function enclosingFunction(src, index) {
  const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let name = null;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > index) break;
    name = m[1];
  }
  return name;
}

const SKIP_LITERAL_RE = /const\s+TRANSPORT_SKIP_ALLOWED\s*=\s*Object\.freeze\(\s*\{([^}]*)\}/;
const SKIP_REQUIRE_RE = /const\s+\{\s*TRANSPORT_SKIP_ALLOWED\s*\}\s*=\s*require\(\s*["'`]([^"'`]+)["'`]\s*\)/;

/**
 * Where does the controller get TRANSPORT_SKIP_ALLOWED from, and what is the frozen literal there?
 * Returns { source, literal, violation }:
 *   source    — repo-relative file that DEFINES the literal (the controller, or the pinned housing module)
 *   literal   — the RegExp match of the frozen literal in that file (comment-stripped), or null
 *   violation — a G3 finding when the binding itself is untrustworthy (re-pointed / dangling require)
 */
function locateSkipAllowance(root, controllerSrc) {
  const inline = controllerSrc.match(SKIP_LITERAL_RE);
  if (inline) return { source: CONTROLLER_REL, literal: inline, violation: null };

  const req = controllerSrc.match(SKIP_REQUIRE_RE);
  if (!req) return { source: CONTROLLER_REL, literal: null, violation: null };

  // Resolve the require target the way Node would (relative to the controller's directory), then
  // express it repo-relative so it can be compared to the ONE pinned housing.
  const controllerDir = path.dirname(path.join(root, CONTROLLER_REL));
  let target = path.resolve(controllerDir, req[1]);
  if (!/\.(c|m)?js$/.test(target)) target += ".js";
  const rel = path.relative(root, target).split(path.sep).join("/");
  if (rel !== SKIP_ALLOWLIST_REL) {
    return {
      source: rel,
      literal: null,
      violation: `G3: TRANSPORT_SKIP_ALLOWED is required from \`${req[1]}\` (=> ${rel}), not the pinned housing ${SKIP_ALLOWLIST_REL} — a re-pointed allowance is an unreviewed allowance`,
    };
  }
  if (!fs.existsSync(target)) {
    return {
      source: rel,
      literal: null,
      violation: `G3: the skip-allowance housing ${SKIP_ALLOWLIST_REL} is MISSING — the controller's require would throw and the allowance cannot be verified (FAIL-CLOSED)`,
    };
  }
  const housingSrc = stripComments(fs.readFileSync(target, "utf8"));
  return { source: rel, literal: housingSrc.match(SKIP_LITERAL_RE), violation: null };
}

function check(root = ROOT) {
  const abs = path.join(root, CONTROLLER_REL);
  if (!fs.existsSync(abs)) {
    const e = new Error(`${CONTROLLER_REL} not found — the guard cannot run (FAIL-CLOSED)`);
    e.failClosed = true;
    throw e;
  }
  const raw = fs.readFileSync(abs, "utf8");
  const src = stripComments(raw);
  const violations = [];
  const observed = {};

  // ── G2a — EXACTLY the sanctioned fence CALL sites (definition + export are not calls). ────────────────
  const callSites = [];
  const callRe = /withControllerFence\s*\(/g;
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const before = src.slice(Math.max(0, m.index - 40), m.index);
    if (/function\s+$/.test(before)) continue; // the definition
    callSites.push({ index: m.index, line: src.slice(0, m.index).split(/\n/).length, fn: enclosingFunction(src, m.index) });
  }
  observed.fence_call_sites = callSites.map((c) => ({ line: c.line, in: c.fn }));

  if (callSites.length !== EXPECTED_FENCE_CALL_SITES) {
    violations.push(
      `G2: expected EXACTLY ${EXPECTED_FENCE_CALL_SITES} withControllerFence call site(s) ` +
        `(${SANCTIONED_FENCE_CALLERS.join(" + ")}), found ${callSites.length} ` +
        `[${observed.fence_call_sites.map((c) => `L${c.line} in ${c.in}`).join(", ")}] — ` +
        `a new fence site raises the fence around a write nobody reviewed`,
    );
  }
  for (const c of callSites) {
    if (!SANCTIONED_FENCE_CALLERS.includes(c.fn)) {
      violations.push(`G2: withControllerFence called at L${c.line} from UNSANCTIONED function \`${c.fn}\` (sanctioned: ${SANCTIONED_FENCE_CALLERS.join(", ")})`);
    }
  }

  // ── G2b — withControllerFence is the SOLE fence-env-setting site. ─────────────────────────────────────
  const envAssign = [...src.matchAll(/process\.env\s*\[\s*reftxn\.(FENCE_[A-Z_]+)\s*\]\s*=/g)];
  const fnStart = src.indexOf("function withControllerFence");
  const fnEnd = fnStart >= 0 ? src.indexOf("\nfunction ", fnStart + 1) : -1;
  observed.fence_env_assignments = envAssign.length;
  for (const a of envAssign) {
    const inside = fnStart >= 0 && a.index > fnStart && (fnEnd < 0 || a.index < fnEnd);
    if (!inside) {
      violations.push(
        `G2: a fence env var (${a[1]}) is assigned at L${src.slice(0, a.index).split(/\n/).length}, OUTSIDE withControllerFence — ` +
          `the fence must have exactly one env-setting site (scoped set + finally-restore)`,
      );
    }
  }
  if (!/finally\s*\{/.test(src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined))) {
    violations.push("G2: withControllerFence does not restore the prior env in a `finally` — the fence could leak past its scope");
  }

  // ── G1 — the token is never caller-asserted. ──────────────────────────────────────────────────────────
  const optKeysMatch = src.match(/const\s+TRANSPORT_OPT_KEYS\s*=\s*Object\.freeze\(\s*\[([^\]]*)\]/);
  if (!optKeysMatch) {
    violations.push("G1: TRANSPORT_OPT_KEYS is missing or is not an Object.freeze([...]) allowlist — caller opts would be unbounded");
  } else {
    const keys = [...optKeysMatch[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    observed.transport_opt_keys = keys;
    for (const forbidden of FORBIDDEN_OPT_KEYS) {
      if (keys.includes(forbidden)) {
        violations.push(`G1: TRANSPORT_OPT_KEYS admits \`${forbidden}\` — a caller could assert it and influence a trust decision`);
      }
    }
  }
  if (!/function\s+sanitizeTransportOpts/.test(src)) {
    violations.push("G1: sanitizeTransportOpts is absent — nothing narrows caller opts to the frozen allowlist");
  }
  // Both public entrypoints + the choke-point must sanitize on the way in. The window is bounded to the
  // function's OWN body (up to the first line-start `}`) — a fixed character window spills into the NEXT
  // function, so a de-sanitized entrypoint would be laundered by its `*ForTest` sibling's call.
  for (const entry of ["fencedRefUpdate", "integrateBranchMerge", "integrateReleaseCommit"]) {
    const re = new RegExp(String.raw`function\s+${entry}\s*\([^)]*\)\s*\{([\s\S]*?)\n\}`);
    const m2 = re.exec(src);
    if (!m2) {
      violations.push(`G1: public entrypoint \`${entry}\` not found — the transport's caller-facing boundary is missing`);
    } else if (!/sanitizeTransportOpts\(/.test(m2[1])) {
      violations.push(`G1: public entrypoint \`${entry}\` does not route its opts through sanitizeTransportOpts — caller keys would reach a trust decision`);
    }
  }
  // The token must be resolved from the lease store, not read off `o`/`opts`/`input`.
  if (!/leaseTokenResolver[\s\S]{0,200}?defaultLeaseTokenResolver/.test(src)) {
    violations.push("G1: the lease-token seam does not default to defaultLeaseTokenResolver");
  }
  const callerTokenRead = /\b(?:o|opts|input)\.leaseToken\b/.exec(src);
  if (callerTokenRead) {
    violations.push(`G1: a caller-supplied leaseToken is READ at L${src.slice(0, callerTokenRead.index).split(/\n/).length} — the token must come only from the lease store`);
  }
  if (!/function\s+defaultLeaseTokenResolver[\s\S]{0,400}?lease\.status\(/.test(src)) {
    violations.push("G1: defaultLeaseTokenResolver does not read the CURRENT holder from the lease store (lease.status)");
  }

  // ── G3 — the frozen skip allowance is exactly the pinned pair. ────────────────────────────────────────
  // The literal may live INLINE in the controller or in the ONE pinned housing module it `require`s
  // (re-housed by e5cd99b6). Either way it must be an Object.freeze({...}) literal, and it must be the
  // pinned pair. A require pointing anywhere else is a finding: the definition moved, the guard follows.
  const housing = locateSkipAllowance(root, src);
  observed.transport_skip_allowed_source = housing.source;
  if (housing.violation) violations.push(housing.violation);
  const skipMatch = housing.literal;
  if (!housing.violation && !skipMatch) {
    violations.push(
      `G3: TRANSPORT_SKIP_ALLOWED is missing or not Object.freeze({...}) in ${housing.source} — an unfrozen skip table can be widened silently`,
    );
  } else if (skipMatch) {
    const pairs = {};
    for (const p of skipMatch[1].matchAll(/["'`]([^"'`]+)["'`]\s*:\s*["'`]([^"'`]+)["'`]/g)) pairs[p[1]] = p[2];
    observed.transport_skip_allowed = pairs;
    const names = Object.keys(pairs);
    const expectedNames = Object.keys(PINNED_SKIP_ALLOWANCE);
    for (const n of names) {
      if (!expectedNames.includes(n)) {
        violations.push(`G3: TRANSPORT_SKIP_ALLOWED WIDENED — unpinned skip \`${n}\` (=> "${pairs[n]}"). Each added skip turns the pinned suite further into a dead gate.`);
      } else if (pairs[n] !== PINNED_SKIP_ALLOWANCE[n]) {
        violations.push(`G3: TRANSPORT_SKIP_ALLOWED reason drift on \`${n}\`: "${pairs[n]}" != pinned "${PINNED_SKIP_ALLOWANCE[n]}"`);
      }
    }
    for (const n of expectedNames) {
      if (!names.includes(n)) violations.push(`G3: the pinned allowance \`${n}\` is GONE — the transport would refuse its own legitimate envelope-less run`);
    }
  }
  // The reconciler must honor the pin by NAME+REASON, not tolerate skips generally.
  if (!/hasOwnProperty\.call\(TRANSPORT_SKIP_ALLOWED,\s*name\)\s*&&\s*r\.reason\s*===\s*TRANSPORT_SKIP_ALLOWED\[name\]/.test(src)) {
    violations.push("G3: reconcileTransportSuite does not gate skips on the EXACT name+reason pin — a skip tolerated by name alone is a dead gate");
  }

  return { ok: violations.length === 0, violations, observed, file: CONTROLLER_REL };
}

function main(argv) {
  const json = argv.includes("--json");
  let res;
  try {
    res = check(ROOT);
  } catch (e) {
    if (json) console.log(JSON.stringify({ ok: false, error: e.message, exit: 2 }, null, 2));
    else console.error(`transport-record-trust-guard: FAIL-CLOSED — ${e.message}`);
    return 2;
  }
  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return res.ok ? 0 : 1;
  }
  console.log(`transport-record-trust-guard — ${CONTROLLER_REL}`);
  console.log(`  fence call sites: ${res.observed.fence_call_sites.map((c) => `L${c.line} in ${c.in}`).join(" · ")}`);
  console.log(`  TRANSPORT_OPT_KEYS: [${(res.observed.transport_opt_keys || []).join(", ")}]`);
  console.log(`  TRANSPORT_SKIP_ALLOWED: ${JSON.stringify(res.observed.transport_skip_allowed || {})} (defined in ${res.observed.transport_skip_allowed_source})`);
  if (res.ok) {
    console.log("\nOK — fence token is lease-store-resolved, fence sites are exactly the 2 sanctioned ones, skip allowance un-widened.");
    return 0;
  }
  console.error(`\nFAIL — ${res.violations.length} record-trust violation(s):\n`);
  for (const v of res.violations) console.error(`  • ${v}`);
  return 1;
}

module.exports = { check, SANCTIONED_FENCE_CALLERS, FORBIDDEN_OPT_KEYS, PINNED_SKIP_ALLOWANCE, CONTROLLER_REL, SKIP_ALLOWLIST_REL };

if (require.main === module) process.exit(main(process.argv.slice(2)));
