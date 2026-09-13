#!/usr/bin/env node
"use strict";

// scan:panel-registry-coverage — coverage enforcer for the panel-registry (the /panel:*
// suite, SP-20260615-001, AC-R5a/b). The panel sibling of scan:admin-suite-coverage: a
// STATIC (no events) self-detecting check over the panel registry <-> opener-target surface.
//
// It mirrors the proven admin-suite-coverage shape (a PURE evaluate() over injected seams +
// a fail-closed CLI) AND repo-role-single-source's "the enforcer fails ≥2 on its OWN bad
// input" discipline. The β-3 binding asymmetry: the ENFORCER fails CLOSED on its own corrupt
// input (exit ≥2), DISTINCT from a clean pass (exit 0) and from an orphan-row finding (exit 1).
// (The R-4 roadmap GENERATOR is the opposite — it fails SOFT on its human-authored inputs.)
//
// THE CHECK (per registry `panels` row):
//
//   ROW SHAPE — every row is exactly { name, opener, description, run_context }, all four
//   non-empty strings, run_context ∈ { in_app, cli }. (No mandatory `route` — run_context,
//   not route, carries the in-app-vs-CLI distinction; AC-R1b.) A malformed row is a finding.
//
//   OPENER RESOLUTION — the opener resolves to a REAL backing target via one of the
//   RECOGNIZED_FORMS:
//     - `node <script>`  -> the <script> file must exist on disk (resolved relative to ROOT).
//     - `/<ns>:<name>`   -> resolves via `node scripts/dispatch-skill.js --resolve --skill
//                           <ns:name> --json` -> found:true.
//   Any opener carrying a shell metacharacter, or matching no recognized form, is a hard
//   finding (the admin-suite-coverage injection hardening, ported — a loose prefix match
//   false-greens `node x.js && calc`).
//
// fail-CLOSED (exit 2, BEFORE any row check): an unreadable / non-JSON registry, a wrong
// `$schema` (!= "mc/panel-registry/v1"), or a missing/non-object `panels`. A coverage
// check that reads green on its own malformed input is the bug we're preventing
// (BC-16 / enforcer-honesty).
//
// Exit contract: 0 = all rows resolve clean; 1 = one or more findings (orphan / unsafe /
// bad-shape); 2 = could-not-run (own corrupt input). Wired REPORT-ONLY into /scan:full.
//
// See .claude/commands/scan/panel-registry-coverage.md for the full spec.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_REGISTRY_FILE = path.join(ROOT, "framework", "panel-registry.json");
const DISPATCH_SKILL = path.join(ROOT, "scripts", "dispatch-skill.js");

// The schema the registry MUST carry — a mismatch is fail-closed (could-not-run), never a
// silent green (AC-R5b).
const EXPECTED_SCHEMA = "mc/panel-registry/v1";

// run_context enum (AC-R1b): the in-app-vs-CLI distinction lives here, not in a `route`.
const RUN_CONTEXTS = new Set(["in_app", "cli"]);

// The EXACT row key set (AC-R1b / R5 B3): a panel row is EXACTLY these four keys — no more,
// no less. An admin-style `route` (or any other extra key) is a hard finding, not a silent
// pass. Order-independent; compared as a set.
const ROW_KEYS = ["name", "opener", "description", "run_context"];

/**
 * isPlainObject — a real map object, NOT an array and NOT null. `typeof [] === "object"` is the
 * B1 false-green: an ARRAY `panels` passed the old `typeof === "object"` gate, then
 * Object.entries([]) is empty → 0 findings → exit 0. A registry/panels shape that is an array
 * (or any non-plain-object) is CORRUPT, never green.
 */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// RECOGNIZED_FORMS — the named extension seam (product-lead's open seam). The two opener
// forms are `node <script>` and `/<ns>:<name>`; a THIRD form is a one-line addition here
// (an { id, test, resolve } entry), not an ad-hoc branch. `resolve(opener, ctx)` returns
// { ok:true } | { ok:false, finding_type, evidence } | { skip:true, reason } — skip is the
// pre-integration tolerance carve-out (a parallel-lane script absent in THIS worktree).
const RECOGNIZED_FORMS = [
  {
    id: "node_script",
    // `node <relpath/to/script.js>` — a bare node invocation of a repo-relative script.
    // (No trailing flags: a flagged opener that is otherwise safe still must match a known
    // anchored form; the panel seed openers are flag-free. Admin's --route variant is the
    // admin registry's concern, not this one.)
    test: (opener) => /^node\s+\S+$/.test(opener),
    resolve: (opener, ctx) => {
      const rel = opener.replace(/^node\s+/, "").trim();
      // Must be a repo-relative path under scripts/ ending in .js — reject absolute paths,
      // parent-escapes, and non-.js targets outright (defense in depth beyond the metachar
      // gate).
      if (!/^scripts\/[A-Za-z0-9_\-./]+\.js$/.test(rel) || rel.includes("..")) {
        return {
          ok: false,
          finding_type: "unrecognized_opener",
          evidence: `node opener target '${rel}' is not a repo-relative 'scripts/.../<file>.js' path`,
        };
      }
      if (ctx.exists(rel)) return { ok: true };
      // Tolerance (B2 — NARROWED): a parallel-lane script (scripts/panel/*, scripts/admin/*) is
      // SKIPPED-with-note ONLY when its LANE DIR itself is ABSENT — the genuine mid-worktree
      // case where another gauntlet lane has not yet created the dir. Once the lane dir EXISTS
      // (the integrated canonical tree), an absent script is a HARD orphan finding — a
      // prefix-only skip would permanently mask the exact false-green this enforcer prevents.
      const lanePrefix = PARALLEL_LANE_PREFIXES.find((p) => rel.startsWith(p));
      if (lanePrefix && !ctx.laneDirExists(lanePrefix)) {
        return { skip: true, reason: `opener script '${rel}' absent and its lane dir '${lanePrefix}' does not yet exist (parallel lane, pre-integration)` };
      }
      return {
        ok: false,
        finding_type: "orphan_opener",
        evidence: `opener references '${rel}' which does not exist on disk`,
      };
    },
  },
  {
    id: "skill",
    // `/<ns>:<name>` (leading slash optional) — a skill id resolvable via dispatch-skill.
    test: (opener) => /^\/?[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(opener),
    resolve: (opener, ctx) => {
      const id = opener.replace(/^\//, "");
      const r = ctx.resolve(id);
      // Infrastructure failure must NOT collapse into found:false — that false-greens a
      // broken resolver as "skill unresolved" (admin-suite MEDIUM #6). Surface it.
      if (r.resolverError) {
        return {
          ok: false,
          finding_type: "resolver_error",
          evidence: `opener skill '${id}' resolver FAILED (NOT "unresolved"): ${r.resolverError.message}`,
        };
      }
      if (!r.found) {
        return {
          ok: false,
          finding_type: "orphan_opener",
          evidence: `opener skill '${id}' does not resolve (dispatch-skill --resolve returned found:false)`,
        };
      }
      return { ok: true };
    },
  },
];

// Parallel-lane script prefixes: a `node <script>` opener under one of these, absent in the
// current worktree, is SKIPPED-with-note (built by another gauntlet lane) rather than a hard
// orphan finding — so the gate is green post-build but pre-integration. The integrated tree
// must have all openers present, at which point every row is enforced (no skips).
const PARALLEL_LANE_PREFIXES = ["scripts/panel/", "scripts/admin/"];

const JSON_OUT = process.argv.includes("--json");

// ── Skill resolution via dispatch-skill --resolve ──────────────────────────────

/**
 * Resolve a skill id ("cockpit:readiness") via dispatch-skill.js --resolve --skill <id> --json.
 * Returns { found:boolean, raw } — never throws. A resolver INFRA failure (spawn error /
 * non-zero / empty / unparseable) is surfaced as { resolverError } so the caller does NOT
 * false-green a broken resolver as "skill unresolved" (admin-suite MEDIUM #6).
 */
function resolveSkill(skillId) {
  if (!fs.existsSync(DISPATCH_SKILL)) {
    return { found: false, raw: null, resolverError: { message: "scripts/dispatch-skill.js missing" } };
  }
  const res = spawnSync(
    process.execPath,
    [DISPATCH_SKILL, "--resolve", "--skill", skillId, "--json"],
    { cwd: ROOT, encoding: "utf8" },
  );
  // --resolve exits 1 when the skill is NOT found (fail-closed in dispatch-skill) — that is a
  // legitimate found:false, not an infra error. We rely on the parsed `found` field, not the
  // exit code, but a SPAWN error or empty/unparseable stdout IS an infra failure.
  if (res.error || !String(res.stdout || "").trim()) {
    return {
      found: false,
      raw: null,
      resolverError: {
        message: (res.error && res.error.message) || `resolver produced no stdout (status ${res.status})`,
        status: res.status,
        stderr: String(res.stderr || "").slice(0, 400),
      },
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(String(res.stdout).trim());
  } catch (e) {
    return { found: false, raw: null, resolverError: { message: `unparseable resolver JSON: ${e.message}` } };
  }
  return { found: !!(parsed && parsed.found), raw: parsed };
}

// ── Core compute (PURE given its inputs) ───────────────────────────────────────

/**
 * @param {object} registry              parsed panel-registry.json (already $schema-checked)
 * @param {(id:string)=>object} resolve   skill resolver (inject for tests)
 * @param {(rel:string)=>boolean} exists  file-exists predicate over repo-relative paths
 * @param {(prefix:string)=>boolean} [laneDirExists]  parallel-lane-dir-exists predicate
 *        (inject for tests; defaults to probing `exists` on the prefix). Drives the B2
 *        skip-vs-finding decision for an absent lane script.
 * @returns {{ findings:object[], skipped:object[], checked:number }}
 */
function evaluate({ registry, resolve, exists, laneDirExists: ctx_laneDirExists }) {
  const findings = [];
  const skipped = [];
  let checked = 0;

  const panels = registry && registry.panels;
  // B1: an ARRAY (or any non-plain-object) `panels` is CORRUPT SHAPE — typeof [] === "object"
  // would otherwise pass and Object.entries([]) be empty → false-green. loadRegistry already
  // fail-closes the CLI on this, but evaluate() is called directly by tests, so flag the
  // in-process precursor finding here too (a map is required).
  if (!isPlainObject(panels)) {
    findings.push({
      finding_type: "registry_no_panels",
      evidence: Array.isArray(panels)
        ? "panel-registry `panels` is an ARRAY — it must be a map object"
        : "panel-registry has no `panels` map",
    });
    return { findings, skipped, checked };
  }

  // laneDirExists(prefix) — does a parallel-lane directory (scripts/panel/, scripts/admin/)
  // exist on disk? Injectable for tests. Default: derive from `exists` by probing the prefix
  // sans trailing slash. The skip-vs-finding decision (B2) hinges on this: a missing script is
  // SKIPPED only when its LANE DIR is ABSENT (the genuine mid-worktree case); when the lane dir
  // EXISTS, an absent script is a hard orphan finding.
  const laneDirExists = ctx_laneDirExists || ((prefix) => exists(prefix.replace(/\/$/, "")));
  const ctx = { resolve, exists, laneDirExists };

  for (const [key, row] of Object.entries(panels)) {
    checked++;

    // ROW SHAPE — a row must be a plain object whose key set is EXACTLY ROW_KEYS
    // ({ name, opener, description, run_context }), all four non-empty strings. (B3: an EXTRA
    // key — esp. the admin-style `route` — is a hard finding, not a silent pass; AC-R1b binds
    // the shape as exactly those four and excludes `route`.)
    if (!isPlainObject(row)) {
      findings.push({
        finding_type: "malformed_panel_row",
        panel: key,
        evidence: `panel '${key}' must be an object { name, opener, description, run_context }`,
      });
      continue;
    }
    const badKey = ROW_KEYS.find((k) => typeof row[k] !== "string" || row[k].trim() === "");
    if (badKey) {
      findings.push({
        finding_type: "malformed_panel_row",
        panel: key,
        evidence: `panel '${key}' must be { name, opener, description, run_context } (all non-empty strings) — '${badKey}' is missing/empty/non-string`,
      });
      continue;
    }
    // EXACT key set — no extra keys (B3). `route` is the named exclusion.
    const extraKeys = Object.keys(row).filter((k) => !ROW_KEYS.includes(k));
    if (extraKeys.length) {
      findings.push({
        finding_type: "extra_row_keys",
        panel: key,
        evidence: `panel '${key}' has unexpected key(s) [${extraKeys.join(", ")}] — the row shape is EXACTLY { name, opener, description, run_context } (no 'route'; run_context carries the in-app-vs-CLI distinction)`,
      });
      continue;
    }
    if (!RUN_CONTEXTS.has(row.run_context)) {
      findings.push({
        finding_type: "bad_run_context",
        panel: key,
        evidence: `panel '${key}' run_context '${row.run_context}' is not in { in_app, cli }`,
      });
      continue;
    }

    // OPENER RESOLUTION. STRICT — reject any shell metacharacter FIRST (a loose prefix match
    // false-greens injection like `node x.js && calc`; admin-suite BLOCKER #3), then dispatch
    // to the single matching RECOGNIZED_FORM. No recognized form -> hard finding.
    const opener = row.opener.trim();
    if (/[&|;<>`$(){}\[\]\\"'*?~\n]/.test(opener)) {
      findings.push({
        finding_type: "unsafe_opener",
        panel: key,
        evidence: `panel '${key}' opener '${opener}' contains a shell metacharacter — openers must be a bare 'node scripts/.../<file>.js' or '/ns:name'`,
      });
      continue;
    }
    const form = RECOGNIZED_FORMS.find((f) => f.test(opener));
    if (!form) {
      findings.push({
        finding_type: "unrecognized_opener",
        panel: key,
        evidence: `panel '${key}' opener '${opener}' matches no recognized form (node <script> | /ns:name)`,
      });
      continue;
    }
    const res = form.resolve(opener, ctx);
    if (res.skip) {
      skipped.push({ check: "opener_resolution", panel: key, reason: res.reason });
    } else if (!res.ok) {
      findings.push({ finding_type: res.finding_type, panel: key, evidence: `panel '${key}' ${res.evidence}` });
    }
  }

  return { findings, skipped, checked };
}

// ── Registry load (fail-CLOSED) ────────────────────────────────────────────────

/**
 * loadRegistry(registryPath) -> { ok:true, registry } | { ok:false, reason }
 * Fail-CLOSED: an unreadable file, non-JSON content, a wrong $schema, or a missing/non-object
 * `panels` map all return ok:false (the caller maps that to exit 2). NEVER throws.
 */
function loadRegistry(registryPath) {
  let raw;
  try {
    raw = fs.readFileSync(registryPath, "utf8");
  } catch (e) {
    return { ok: false, reason: `cannot read panel-registry (${e.code || e.message})` };
  }
  let reg;
  try {
    reg = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `panel-registry is not valid JSON: ${e.message}` };
  }
  if (!isPlainObject(reg)) {
    return { ok: false, reason: "panel-registry is not a JSON object (array/scalar/null)" };
  }
  if (reg.$schema !== EXPECTED_SCHEMA) {
    return { ok: false, reason: `unexpected $schema: ${JSON.stringify(reg.$schema)} (expected "${EXPECTED_SCHEMA}")` };
  }
  // B1: an ARRAY `panels` (typeof [] === "object") is CORRUPT SHAPE — a panels map must be a
  // plain object. Reject arrays + any non-plain-object here so it fails CLOSED (exit ≥2),
  // distinct from a clean 0 / finding 1.
  if (!isPlainObject(reg.panels)) {
    return {
      ok: false,
      reason: Array.isArray(reg.panels)
        ? "panel-registry `panels` is an ARRAY — it must be a map object"
        : "panel-registry has no `panels` object",
    };
  }
  return { ok: true, registry: reg };
}

// ── CLI ────────────────────────────────────────────────────────────────────────

/** Parse `--registry <path>` (defaults to the canonical framework/panel-registry.json). */
function registryPathFromArgv(argv) {
  const i = argv.indexOf("--registry");
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return DEFAULT_REGISTRY_FILE;
}

function main(argv) {
  const registryPath = registryPathFromArgv(argv);

  const loaded = loadRegistry(registryPath);
  if (!loaded.ok) {
    // fail-CLOSED — could-not-run is NOT green and is DISTINCT from a finding (exit 2, not 1).
    if (JSON_OUT) {
      console.log(JSON.stringify({ ok: false, error: loaded.reason, violationCount: null, violations: [] }));
    } else {
      process.stderr.write(`ERROR [panel-registry-coverage] ${loaded.reason}\n`);
    }
    return 2;
  }

  const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
  const { findings, skipped, checked } = evaluate({ registry: loaded.registry, resolve: resolveSkill, exists });
  const ok = findings.length === 0;

  if (JSON_OUT) {
    // `violations` is the contract field (mirrors repo-role-single-source); `findings` aliased
    // for admin-suite parity. Both carry the same array.
    console.log(JSON.stringify({ ok, violationCount: findings.length, violations: findings, checked, skipped: skipped.length, skippedDetail: skipped }));
  } else if (ok) {
    const note = skipped.length ? ` (${skipped.length} skipped pending integration)` : "";
    console.log(`OK   [panel-registry-coverage] ${checked} row(s) checked, 0 findings${note}`);
  } else {
    process.stderr.write(`FAIL [panel-registry-coverage] ${findings.length} finding(s):\n`);
    for (const f of findings) process.stderr.write(`  - [${f.finding_type}]${f.panel ? ` ${f.panel}:` : ""} ${f.evidence}\n`);
    if (skipped.length) process.stderr.write(`  (${skipped.length} row(s) skipped pending integration)\n`);
  }
  return ok ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, loadRegistry, resolveSkill, RECOGNIZED_FORMS, RUN_CONTEXTS, EXPECTED_SCHEMA, PARALLEL_LANE_PREFIXES, main };
