#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function resolveRoot() {
  const anchor = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchor, ".claude"))) return anchor;
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (envRoot && fs.existsSync(path.join(envRoot, ".claude"))) return envRoot;
  return anchor;
}

const ROOT = resolveRoot();
const NAME = "conformance-matrix";

const KERNEL_DIR = path.join(ROOT, ".claude", "kernel");
const SUPPORT_MATRIX_PATH = path.join(KERNEL_DIR, "support-matrix.json");
const FIXTURES_DIR = path.join(KERNEL_DIR, "fixtures");
const MANIFEST_PATH = path.join(FIXTURES_DIR, "manifest.json");

const CORE2_LIVE_MODULE_REL = "scripts/dispatch/trusted-controller.js";

const EXCLUDED_GATE_DIRS = new Set(["contract-lint", "conformance-matrix-selftest"]);

const REQUIRED_CORE_IDS = ["CORE-1", "CORE-2", "CORE-3", "CORE-4"];

const UNAVAILABLE_STATUSES = new Set(["down", "not-verified"]);
const VALID_STATUSES = new Set(["supported", ...UNAVAILABLE_STATUSES]);

const { evaluateRoleBinding, loadRoleBinding, validateRoleBinding } = require("../dispatch/role-resolver");

const GATE_EVALUATORS = {
  "role-binding": (input, ctx) => evaluateRoleBinding(input, (ctx && ctx.roleBinding) || {}),

  "trust-boundary": (input) => {
    if (input.attempted_action === "integrate_to_main" && !input.actor_is_trusted_layer) {
      return { outcome: "BLOCK", reason: "only the provider-independent trusted layer may integrate to main" };
    }
    return { outcome: "PASS", reason: "actor is the trusted layer or is not attempting a boundary power" };
  },

  retention: (input) => {
    if (input.attempted_disposition === "archive") {
      return { outcome: "PASS", reason: "over-cap sink moved to archive, raw history preserved" };
    }
    return { outcome: "BLOCK", reason: "any disposition other than 'archive' is refused (never delete)" };
  },

  "support-matrix": (input, ctx) => {
    const row = ctx.supportMatrix && ctx.supportMatrix.rows && ctx.supportMatrix.rows[input.helm];
    if (!row) return { outcome: "BLOCK", reason: `unknown helm '${input.helm}' (fail-closed)` };
    if (UNAVAILABLE_STATUSES.has(row.status) && row.required) {
      return { outcome: "BLOCK", reason: `required helm '${input.helm}' resolves ${row.status} (evidence_ref: ${row.evidence_ref})` };
    }
    if (row.status === "supported" && row.proven) {
      return { outcome: "PASS", reason: `helm '${input.helm}' is supported + proven` };
    }
    return { outcome: "BLOCK", reason: `helm '${input.helm}' is neither supported+proven nor a required lane that is down or not-verified (fail-closed on ambiguity)` };
  },

  "dispatch-honesty": (input) => {
    const re = input.result_envelope || {};
    const empty = (arr) => !Array.isArray(arr) || arr.length === 0;
    if (re.status === "passed" && empty(re.files_changed) && empty(re.commits) && empty(re.tests_run) && empty(re.evidence_paths)) {
      return { outcome: "BLOCK", reason: "status:passed claimed with zero files/commits/tests/evidence (false-green)" };
    }
    return { outcome: "PASS", reason: "the envelope carries corroborating evidence for its claimed status" };
  },

  tracker: (input) => {
    if (input.tracker_claim === "done" && input.disk_evidence === "absent" && input.git_evidence === "absent") {
      return { outcome: "BLOCK", reason: "tracker claims done with no corroborating disk/git evidence (drift)" };
    }
    return { outcome: "PASS", reason: "tracker claim is corroborated by disk/git evidence" };
  },

  worktree: (input) => {
    if (input.base_is_ancestor_of_head === false) {
      return { outcome: "BLOCK", reason: "declared base commit is not an ancestor of the integration head (stale base)" };
    }
    return { outcome: "PASS", reason: "declared base commit is fresh against the integration head" };
  },

  workorder: (input) => {
    if (input.role_kind === "feature-build" && input.prompt_bytes < input.floor_bytes) {
      return { outcome: "BLOCK", reason: `prompt_bytes ${input.prompt_bytes} below floor_bytes ${input.floor_bytes}` };
    }
    return { outcome: "PASS", reason: "prompt meets the size floor (or role is not feature-build)" };
  },

  "dispatch-review": (input) => {
    if (input.builder_provider && input.builder_provider === input.reviewer_provider) {
      return { outcome: "BLOCK", reason: "reviewer provider matches builder provider (same-family self-review refused)" };
    }
    return { outcome: "PASS", reason: "reviewer is a different provider family from the builder" };
  },
};

function validateSupportMatrix(matrix, supportMatrixPath) {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    const err = new Error(`support matrix ${supportMatrixPath} is not a JSON object`);
    err.code = "SUPPORT_MATRIX_SHAPE_ERROR";
    throw err;
  }
  if (!matrix.rows || typeof matrix.rows !== "object" || Array.isArray(matrix.rows)) {
    const err = new Error(
      `support matrix ${supportMatrixPath} missing/invalid 'rows' (must be an object keyed by helm)`,
    );
    err.code = "SUPPORT_MATRIX_SHAPE_ERROR";
    throw err;
  }
  for (const [helm, row] of Object.entries(matrix.rows)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      const err = new Error(`support matrix row '${helm}' is not a JSON object`);
      err.code = "SUPPORT_MATRIX_ROW_SHAPE_ERROR";
      throw err;
    }
    if (typeof row.status !== "string" || !row.status) {
      const err = new Error(`support matrix row '${helm}' missing/invalid 'status' (string)`);
      err.code = "SUPPORT_MATRIX_ROW_SHAPE_ERROR";
      throw err;
    }
    if (!VALID_STATUSES.has(row.status)) {
      const err = new Error(
        `support matrix row '${helm}' has unknown 'status' ${JSON.stringify(row.status)} (must be one of ${[...VALID_STATUSES].join("/")})`,
      );
      err.code = "SUPPORT_MATRIX_ROW_SHAPE_ERROR";
      throw err;
    }
    if (typeof row.required !== "boolean") {
      const err = new Error(`support matrix row '${helm}' missing/invalid 'required' (boolean)`);
      err.code = "SUPPORT_MATRIX_ROW_SHAPE_ERROR";
      throw err;
    }
    if (typeof row.proven !== "boolean") {
      const err = new Error(`support matrix row '${helm}' missing/invalid 'proven' (boolean)`);
      err.code = "SUPPORT_MATRIX_ROW_SHAPE_ERROR";
      throw err;
    }
    if (typeof row.evidence_ref !== "string" || !row.evidence_ref) {
      const err = new Error(`support matrix row '${helm}' missing/invalid 'evidence_ref' (string)`);
      err.code = "SUPPORT_MATRIX_ROW_SHAPE_ERROR";
      throw err;
    }
  }
  return matrix;
}

function loadSupportMatrix(supportMatrixPath) {
  const text = fs.readFileSync(supportMatrixPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const err = new Error(`support matrix ${supportMatrixPath} is not valid JSON: ${(e && e.message) || e}`);
    err.code = "SUPPORT_MATRIX_PARSE_ERROR";
    throw err;
  }
  return validateSupportMatrix(parsed, supportMatrixPath);
}

const REQUIRED_INPUT_FIELDS = {
  "role-binding": [{ field: "actor_kind", type: "string" }],
  "trust-boundary": [
    { field: "attempted_action", type: "string" },
    { field: "actor_is_trusted_layer", type: "boolean" },
  ],
  retention: [{ field: "attempted_disposition", type: "string" }],
  "support-matrix": [{ field: "helm", type: "string" }],
  "dispatch-honesty": [{ field: "result_envelope", type: "object" }],
  tracker: [
    { field: "tracker_claim", type: "string" },
    { field: "disk_evidence", type: "string" },
    { field: "git_evidence", type: "string" },
  ],
  worktree: [{ field: "base_is_ancestor_of_head", type: "boolean" }],
  workorder: [
    { field: "role_kind", type: "string" },
    { field: "prompt_bytes", type: "number" },
    { field: "floor_bytes", type: "number" },
  ],
  "dispatch-review": [
    { field: "builder_provider", type: "string" },
    { field: "reviewer_provider", type: "string" },
  ],
};

function validateGateInputShape(gate, input) {
  const schema = REQUIRED_INPUT_FIELDS[gate];
  if (!schema) return null;
  for (const req of schema) {
    if (!Object.prototype.hasOwnProperty.call(input, req.field)) {
      return `missing required input field '${req.field}' for gate '${gate}'`;
    }
    const val = input[req.field];
    if (req.type === "string" && (typeof val !== "string" || !val)) {
      return `input field '${req.field}' for gate '${gate}' must be a non-empty string`;
    }
    if (req.type === "boolean" && typeof val !== "boolean") {
      return `input field '${req.field}' for gate '${gate}' must be a boolean`;
    }
    if (req.type === "number" && typeof val !== "number") {
      return `input field '${req.field}' for gate '${gate}' must be a number`;
    }
    if (req.type === "object" && (typeof val !== "object" || val === null || Array.isArray(val))) {
      return `input field '${req.field}' for gate '${gate}' must be a JSON object`;
    }
  }
  return null;
}

const VALID_OUTCOMES = new Set(["PASS", "BLOCK"]);

function loadFixtures(fixturesDir) {
  const fixtures = [];
  let gateDirs;
  try {
    gateDirs = fs.readdirSync(fixturesDir, { withFileTypes: true });
  } catch (e) {
    const err = new Error(`fixtures dir unreadable: ${(e && e.message) || e}`);
    err.code = "FIXTURES_DIR_UNREADABLE";
    throw err;
  }
  for (const entry of gateDirs) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED_GATE_DIRS.has(entry.name)) continue;
    const gateDir = path.join(fixturesDir, entry.name);
    const files = fs.readdirSync(gateDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const full = path.join(gateDir, file);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      } catch (e) {
        const err = new Error(`malformed fixture ${full}: ${(e && e.message) || e}`);
        err.code = "FIXTURE_PARSE_ERROR";
        throw err;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        const err = new Error(`fixture ${full} is not a JSON object`);
        err.code = "FIXTURE_SHAPE_ERROR";
        throw err;
      }
      if (typeof parsed.id !== "string" || !parsed.id) {
        const err = new Error(`fixture ${full} missing required field 'id'`);
        err.code = "FIXTURE_SHAPE_ERROR";
        throw err;
      }
      if (typeof parsed.gate !== "string" || !parsed.gate) {
        const err = new Error(`fixture ${full} missing required field 'gate'`);
        err.code = "FIXTURE_SHAPE_ERROR";
        throw err;
      }
      if (!Object.prototype.hasOwnProperty.call(GATE_EVALUATORS, parsed.gate)) {
        const err = new Error(`fixture ${full} names unknown gate '${parsed.gate}' (no evaluator registered)`);
        err.code = "FIXTURE_UNKNOWN_GATE";
        throw err;
      }
      if (!parsed.input || typeof parsed.input !== "object" || Array.isArray(parsed.input)) {
        const err = new Error(`fixture ${full} missing/invalid 'input' (must be a JSON object)`);
        err.code = "FIXTURE_SHAPE_ERROR";
        throw err;
      }
      const gateInputError = validateGateInputShape(parsed.gate, parsed.input);
      if (gateInputError) {
        const err = new Error(`fixture ${full}: ${gateInputError}`);
        err.code = "FIXTURE_GATE_INPUT_SHAPE_ERROR";
        throw err;
      }
      if (
        !parsed.expect ||
        typeof parsed.expect.outcome !== "string" ||
        !VALID_OUTCOMES.has(parsed.expect.outcome)
      ) {
        const err = new Error(
          `fixture ${full} missing/invalid 'expect.outcome' (must be one of ${[...VALID_OUTCOMES].join("/")})`,
        );
        err.code = "FIXTURE_SHAPE_ERROR";
        throw err;
      }
      fixtures.push({ ...parsed, _file: path.relative(ROOT, full).replace(/\\/g, "/") });
    }
  }
  return fixtures;
}

function evaluate({ fixtures, supportMatrix, roleBinding }) {
  const ctx = { supportMatrix, roleBinding };
  const results = [];
  const mismatches = [];
  for (const fx of fixtures) {
    const evaluator = GATE_EVALUATORS[fx.gate];
    if (!evaluator) {
      const err = new Error(
        `fixture ${fx.id || fx._file || "<unknown>"} names unknown gate '${fx.gate}' (no evaluator registered) — cannot be decided, fail-closed`,
      );
      err.code = "FIXTURE_UNKNOWN_GATE";
      throw err;
    }
    const computed = evaluator(fx.input || {}, ctx);
    const pass = computed.outcome === fx.expect.outcome;
    const r = {
      id: fx.id,
      gate: fx.gate,
      file: fx._file,
      pass,
      computed: computed.outcome,
      computedReason: computed.reason,
      expected: fx.expect.outcome,
    };
    results.push(r);
    if (!pass) mismatches.push(r);
  }

  const requiredDownLanes = [];
  const rows = (supportMatrix && supportMatrix.rows) || {};
  for (const [helm, row] of Object.entries(rows)) {
    if (row && row.required && UNAVAILABLE_STATUSES.has(row.status)) {
      requiredDownLanes.push({ helm, status: row.status, evidence_ref: row.evidence_ref });
    }
  }

  return { results, mismatches, requiredDownLanes };
}

function evaluateCoverage({ fixtures, supportMatrix }) {
  const coreCoverage = {};
  for (const id of REQUIRED_CORE_IDS) coreCoverage[id] = 0;
  const cellCoverage = {};
  const rows = (supportMatrix && supportMatrix.rows) || {};
  for (const helm of Object.keys(rows)) cellCoverage[helm] = 0;

  for (const fx of fixtures) {
    if (fx.bound_core && Object.prototype.hasOwnProperty.call(coreCoverage, fx.bound_core)) {
      coreCoverage[fx.bound_core] += 1;
    }
    if (fx.bound_matrix_cell && Object.prototype.hasOwnProperty.call(cellCoverage, fx.bound_matrix_cell)) {
      cellCoverage[fx.bound_matrix_cell] += 1;
    }
  }

  const gaps = [];
  for (const [id, count] of Object.entries(coreCoverage)) {
    if (count === 0) gaps.push({ kind: "core", id });
  }
  for (const [cell, count] of Object.entries(cellCoverage)) {
    if (count === 0) gaps.push({ kind: "matrix_cell", id: cell });
  }
  return { ok: gaps.length === 0, coreCoverage, cellCoverage, gaps };
}

function evaluateCore2Live({ fixtures, rootDir } = {}) {
  const root = rootDir || ROOT;
  const relevant = (fixtures || []).filter((fx) => fx.gate === "trust-boundary" && fx.bound_core === "CORE-2" && fx.report_only === false);
  if (relevant.length === 0) {
    return { ok: true, checked: 0, violations: [] };
  }
  const violations = [];
  const modAbs = path.join(root, CORE2_LIVE_MODULE_REL);
  if (!fs.existsSync(modAbs)) {
    violations.push(`CORE-2 live adapter module missing: ${CORE2_LIVE_MODULE_REL} (report_only:false flipped with no live mechanism behind it)`);
  } else {
    let mod;
    try {
      delete require.cache[require.resolve(modAbs)];
      // eslint-disable-next-line global-require, import/no-dynamic-require
      mod = require(modAbs);
    } catch (e) {
      violations.push(`CORE-2 live adapter module failed to load: ${CORE2_LIVE_MODULE_REL}: ${(e && e.message) || e}`);
      mod = null;
    }
    if (mod && typeof mod.integrate !== "function") {
      violations.push(`CORE-2 live adapter module ${CORE2_LIVE_MODULE_REL} does not export integrate() — the sole entrypoint`);
    }
  }
  return { ok: violations.length === 0, checked: relevant.length, violations };
}

function flipGate(res, opts = {}) {
  const scope = opts && opts.scope === "core2" ? "core2" : "full";
  const blockers = [];
  if (!res || typeof res.fixtureCount !== "number" || res.fixtureCount === 0)
    blockers.push("zero conformance fixtures executed — cannot certify a binding flip on an empty suite (fail-closed)");
  for (const m of res.mismatches || [])
    blockers.push(`fixture mismatch ${m.id} (${m.gate}): expected ${m.expected}, computed ${m.computed} — flipping would RED this fixture`);
  if (scope !== "core2") {
    for (const d of res.requiredDownLanes || [])
      blockers.push(`required lane ${d.helm} resolves ${d.status || "down"} (${d.evidence_ref}) — flipping the default to binding would RED this lane`);
  }
  if (res && res.core2Live && res.core2Live.ok === false) {
    for (const v of res.core2Live.violations || [])
      blockers.push(`CORE-2 live-adapter check failed: ${v}`);
  }
  return { authorized: blockers.length === 0, blockers, scope };
}

function run(opts) {
  opts = opts || {};
  const kernelDir = opts.kernelDir || KERNEL_DIR;
  const supportMatrixPath = opts.supportMatrixPath || SUPPORT_MATRIX_PATH;
  const fixturesDir = opts.fixturesDir || FIXTURES_DIR;

  const supportMatrix = loadSupportMatrix(supportMatrixPath);
  const roleBinding = loadRoleBinding(kernelDir);
  const fixtures = loadFixtures(fixturesDir);

  const { results, mismatches, requiredDownLanes } = evaluate({ fixtures, supportMatrix, roleBinding });
  const coverage = evaluateCoverage({ fixtures, supportMatrix });
  const core2Live = evaluateCore2Live({ fixtures, rootDir: opts.rootDir || ROOT });

  let manifestCount;
  try {
    manifestCount = JSON.parse(fs.readFileSync(opts.manifestPath || MANIFEST_PATH, "utf8")).count;
  } catch {
    manifestCount = undefined;
  }

  return { results, mismatches, requiredDownLanes, coverage, core2Live, fixtureCount: fixtures.length, manifestCount };
}

module.exports = {
  evaluate,
  evaluateCoverage,
  evaluateCore2Live,
  flipGate,
  loadFixtures,
  loadSupportMatrix,
  loadRoleBinding,
  validateRoleBinding,
  run,
  GATE_EVALUATORS,
  CORE2_LIVE_MODULE_REL,
  UNAVAILABLE_STATUSES,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const JSON_OUT = argv.includes("--json");
  const ENFORCE = argv.includes("--enforce");
  const COVERAGE = argv.includes("--coverage");
  const FLIP_GATE = argv.includes("--flip-gate");
  const scopeArg = argv.find((a) => a.startsWith("--scope="));
  const SCOPE = scopeArg ? scopeArg.slice("--scope=".length) : undefined;

  let res;
  try {
    res = run();
  } catch (e) {
    const msg = (e && e.message) || e;
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: String(msg) }));
    else console.error(`[${NAME}] runner error (fail-closed): ${msg}`);
    process.exit(2);
  }

  if (FLIP_GATE) {
    const gate = flipGate(res, { scope: SCOPE });
    if (JSON_OUT) {
      console.log(JSON.stringify({ check: NAME, mode: "flip-gate", scope: gate.scope, authorized: gate.authorized, blockers: gate.blockers }));
    } else if (gate.authorized) {
      console.log(
        `OK   [${NAME}] --flip-gate${gate.scope === "core2" ? " --scope=core2" : ""}: all ${res.fixtureCount} conformance fixtures green` +
          `${gate.scope === "core2" ? " (CORE-2 slice: unrelated down/not-verified required lanes excluded)" : " + no down/not-verified required lane"} — ` +
          `the binding flip is AUTHORIZED (safe to make the default binding).`,
      );
    } else {
      console.error(
        `REFUSED [${NAME}] --flip-gate${gate.scope === "core2" ? " --scope=core2" : ""}: the binding flip is BLOCKED (never flip a default red) — ${gate.blockers.length} blocker(s):`,
      );
      for (const b of gate.blockers) console.error(`  - ${b}`);
    }
    process.exit(gate.authorized ? 0 : 1);
  }

  if (COVERAGE) {
    const { coverage } = res;
    if (JSON_OUT) {
      console.log(JSON.stringify({ check: NAME, mode: "coverage", ...coverage }));
    } else if (coverage.ok) {
      console.log(`OK   [${NAME}] --coverage: every CORE invariant + in-kernel matrix cell has >=1 bound fixture`);
    } else {
      console.error(`FAIL [${NAME}] --coverage: ${coverage.gaps.length} uncovered:`);
      for (const g of coverage.gaps) console.error(`  - ${g.kind}: ${g.id}`);
    }
    process.exit(coverage.ok ? 0 : 1);
  }

  const hasMismatch = res.mismatches.length > 0;
  const hasRequiredDown = res.requiredDownLanes.length > 0;
  const hasCore2LiveFail = !!(res.core2Live && res.core2Live.ok === false);
  const binding = ENFORCE && (hasMismatch || hasRequiredDown || hasCore2LiveFail);

  if (JSON_OUT) {
    console.log(
      JSON.stringify({
        check: NAME,
        mode: ENFORCE ? "enforce" : "report-only",
        fixtureCount: res.fixtureCount,
        manifestCount: res.manifestCount,
        mismatches: res.mismatches,
        requiredDownLanes: res.requiredDownLanes,
        core2Live: res.core2Live,
      }),
    );
  } else {
    console.log(
      `[${NAME}] ${ENFORCE ? "ENFORCE" : "REPORT-ONLY"} — ${res.fixtureCount} fixture(s) executed, ` +
        `${res.mismatches.length} mismatch(es), ${res.requiredDownLanes.length} down/not-verified required lane(s), ` +
        `CORE-2 live-adapter ${res.core2Live && res.core2Live.checked ? (res.core2Live.ok ? "OK" : "FAILED") : "not-flipped"}`,
    );
    for (const m of res.mismatches) {
      console.error(`  - MISMATCH ${m.id} (${m.gate}): expected ${m.expected}, computed ${m.computed}`);
    }
    for (const d of res.requiredDownLanes) {
      console.error(`  - REQUIRED-${String(d.status || "down").toUpperCase()} ${d.helm}: ${d.evidence_ref}`);
    }
    if (hasCore2LiveFail) {
      for (const v of res.core2Live.violations) console.error(`  - CORE-2-LIVE-ADAPTER-FAIL: ${v}`);
    }
    if (!ENFORCE && (hasMismatch || hasRequiredDown || hasCore2LiveFail)) {
      console.error(`[${NAME}] report-only — re-run with --enforce to make this a blocking gate.`);
    }
    if (res.fixtureCount === 0) {
      console.error(`[${NAME}] WARNING: zero fixtures executed.`);
    }
  }

  process.exit(ENFORCE ? (binding ? 1 : 0) : 0);
}
