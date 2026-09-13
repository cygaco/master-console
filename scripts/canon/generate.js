#!/usr/bin/env node
"use strict";
/**
 * scripts/canon/generate.js — the canon engine (SP-20260525-022).
 *
 * Turns a product's intent (a brief from bootstrap:spinup's guided discussion,
 * or a clone doc from --clone) into the full _requirements/00-canonical/* set:
 * 8 narrative MD + 4 structured JSON, rendered from _mc/templates/canonical/*.
 *
 * Pipeline: parse intent -> map sections to template fields -> brief-EXPAND thin
 * fields from intent (WI-38; deterministic derivation BEFORE research) -> detect
 * THIN fields -> degrade any STILL-unfilled token to an explicit
 * `*needs input: <field>*` marker so a raw {{token}} NEVER ships -> (T4)
 * optionally enrich thin fields via CAPPED research (bounded by schemas/canon/
 * research-fields.schema.json) -> render -> (T5) validate -> emit.
 *
 * The zero-unfilled-token invariant (WI-38, the golden-flow gate): a generated
 * canonical set MUST contain zero raw `{{token}}`. Guaranteed STRUCTURALLY by the
 * degrade step (every unfilled token becomes a visible `*needs input:*` marker,
 * never a raw token) and ENFORCED by scripts/checks/canon-no-unfilled-tokens.js
 * (exits non-zero if any raw `{{token}}` survives) — which replaces the old
 * warning-only "thin is a warning" behavior. Brief-expand fills from intent first;
 * the marker is the honest fallback for a field with no intent source (human/LLM
 * fills it), and the assertion is the tripwire if degrade ever regresses.
 *
 * Runs PRODUCT-SIDE (invoked by bootstrap:spinup's canon phase in a product repo),
 * so generating product-titled canon there is correct — not a canonical purity
 * concern. This engine + the templates are generic (no product content).
 *
 * Usage:
 *   node scripts/canon/generate.js --intent <file.md> --product "<name>"
 *        [--out <dir>] [--research simple|deep|off] [--dry-run] [--json]
 *
 * Exit: 0 ok (may include `needs input:` markers for source-less fields — these
 *       are the honest thin signal, NOT a raw-token leak), 1 fatal (no templates /
 *       no intent / a raw {{token}} survived — the WI-38 invariant breach), 2 bad
 *       args.
 */

const fs = require("fs");
const path = require("path");
const research = require("./research");
const { validateArtifacts } = require("./validate");
const { parseStackIntent } = require("./tech-stack");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TMPL_DIR = path.join(REPO_ROOT, "_mc", "templates", "canonical");

const NARRATIVE = [
  "CORE_BRIEF",
  "USER_COHORTS",
  "GOLDEN_PATHS",
  "PRODUCT_MODEL",
  "EVOLUTION",
  "FAILURE_STATES",
  "GLOSSARY",
  "DATA_AND_ACCOUNTS",
];
const STRUCTURED = ["FIELD_REGISTRY", "PRECEDENCE", "STEPS", "WATCHED_DIRS"];

function parseArgs(argv) {
  const out = {
    intent: null,
    product: null,
    out: "_requirements/00-canonical",
    research: "off",
    researchIn: null,
    dryRun: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--intent") out.intent = argv[++i];
    else if (a === "--product") out.product = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--research") out.research = argv[++i];
    else if (a === "--research-in") out.researchIn = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
  }
  return out;
}

// The explicit "this field had no intent source" marker. A generated artifact may
// contain these (they're the honest thin signal — a human or an LLM brief-expand
// round fills them) but it must NEVER contain a raw `{{token}}` (WI-38). Greppable
// and asserted by scripts/checks/canon-no-unfilled-tokens.js.
const NEEDS_INPUT = (field) => `*needs input: ${field}*`;
// Matches an emitted needs-input marker (for thin-counting / tests).
const NEEDS_INPUT_RE = /\*needs input:\s*([a-zA-Z0-9_]+)\s*\*/g;

// {{key}} substitution.
//   degrade=false (legacy): leave an unmatched token in place (`{{token}}`).
//   degrade=true  (WI-38 default for narrative): replace an unmatched token with a
//     `*needs input: <field>*` marker so a raw {{token}} never ships.
//   degrade=true + jsonSafe=true (structured): replace with `{}` (a JSON-safe
//     empty), since a text marker would be invalid JSON.
function render(tmpl, data, opts = {}) {
  const degrade = opts.degrade === true;
  const jsonSafe = opts.jsonSafe === true;
  return tmpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) => {
    const empty = data[k] === undefined || data[k] === null || data[k] === "";
    if (!empty) return String(data[k]);
    if (!degrade) return m;
    return jsonSafe ? "{}" : NEEDS_INPUT(k);
  });
}

// Split a markdown intent into a { "section title (lowercased)": body } map.
function parseIntentSections(md) {
  const sections = {};
  const lines = md.split(/\r?\n/);
  let cur = null;
  let buf = [];
  const flush = () => {
    if (cur) sections[cur] = buf.join("\n").trim();
    buf = [];
  };
  for (const line of lines) {
    const m = /^#{1,3}\s+(.*)$/.exec(line);
    if (m) {
      flush();
      cur = m[1].replace(/^\d+\s*[—-]\s*/, "").trim().toLowerCase();
    } else if (cur) buf.push(line);
  }
  flush();
  return sections;
}

// Pull the first section whose title includes any of the keywords.
function pick(sections, ...keywords) {
  for (const [title, body] of Object.entries(sections)) {
    if (keywords.some((k) => title.includes(k)) && body) return body;
  }
  return "";
}

function stackFallbackRationale(layer) {
  return `Declared during product intake for the ${layer} layer; revise if implementation evidence drifts.`;
}

// Map intent sections -> canonical template fields. Heuristic; thin fields
// (empty) are surfaced for the research phase (T4) + validation (T5).
function buildFieldMap(product, sections) {
  const stackIntent = parseStackIntent(pick(sections, "tech stack", "stack")).stack;
  return {
    product_name: product,
    one_liner: pick(sections, "one-liner", "problem", "summary"),
    what_it_is: pick(sections, "what it is", "solution", "product", "mvp"),
    what_it_is_not: pick(sections, "not", "non-goal", "out of scope"),
    vision: pick(sections, "vision", "wedge to full"),
    core_pillars: pick(sections, "pillar", "principle", "value"),
    primary_audience: pick(sections, "audience", "user", "customer", "jtbd"),
    cohort_1_name: "",
    primary_jtbd: pick(sections, "jtbd", "job", "problem"),
    path_1_name: pick(sections, "golden path", "core loop", "flow"),
    phase_vocabulary: pick(sections, "phase", "stage"),
    product_primitives: pick(sections, "primitive", "feature", "mvp"),
    evolution_status_note:
      "Non-canonical projection — derived from intent; refine as the product evolves.",
    // DATA_AND_ACCOUNTS fields. Heuristic picks from data/model/entity/schema sections
    // for the data-shape fields and account/auth/login/user/role/permission sections
    // for the identity fields. Fields with no honest intent source are left empty so
    // the degrade step surfaces them as `*needs input:*` markers (WI-38).
    data_model: pick(sections, "data model", "data", "model", "schema", "entities"),
    core_entities: pick(sections, "entities", "entity", "data model", "schema", "model"),
    account_types: pick(sections, "account type", "account", "user type", "plan", "tier"),
    authentication: pick(sections, "authentication", "auth", "login", "signin", "sso", "oauth"),
    permissions_roles: pick(sections, "permission", "role", "access control", "rbac", "acl"),
    data_retention: pick(sections, "retention", "privacy", "gdpr", "data retention", "deletion"),
    // Tech-stack declaration fields. These deliberately come from a dedicated
    // Tech Stack section first, then explicit provider/layer sections. Generic
    // data/auth prose should not masquerade as a stack choice.
    tech_stack_framework: firstNonEmpty(
      stackIntent.framework,
      pick(sections, "framework", "frontend stack", "app stack", "runtime stack"),
    ),
    tech_stack_database: firstNonEmpty(
      stackIntent.database,
      pick(sections, "database", "persistence", "data store", "storage provider"),
    ),
    tech_stack_auth: firstNonEmpty(
      stackIntent.auth,
      pick(sections, "auth provider", "authentication provider", "identity provider"),
    ),
    tech_stack_payments: firstNonEmpty(
      stackIntent.payments,
      pick(sections, "payments", "billing", "monetization provider", "checkout provider"),
    ),
    tech_stack_hosting: firstNonEmpty(
      stackIntent.hosting,
      pick(sections, "hosting", "deployment", "deploy target", "infrastructure"),
    ),
    tech_stack_analytics: firstNonEmpty(
      stackIntent.analytics,
      pick(sections, "analytics", "telemetry provider", "event sink", "product analytics"),
    ),
    tech_stack_framework_rationale: stackFallbackRationale("framework"),
    tech_stack_database_rationale: stackFallbackRationale("database"),
    tech_stack_auth_rationale: stackFallbackRationale("auth"),
    tech_stack_payments_rationale: stackFallbackRationale("payments"),
    tech_stack_hosting_rationale: stackFallbackRationale("hosting"),
    tech_stack_analytics_rationale: stackFallbackRationale("analytics"),
    // Fields still empty here are handled by briefExpand() (intent-derived) and,
    // if still source-less, the degrade step (-> `*needs input:*` marker).
  };
}

// First non-empty value, or "".
function firstNonEmpty(...vals) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

// WI-38 brief-EXPAND (deterministic): fill thin fields from intent BEFORE research.
// Conservative — only derive a field when the intent genuinely supports it (e.g.
// reuse a related section, or compose from sections that ARE present). Never
// fabricate domain claims; a field with no honest intent source is left empty so
// the degrade step surfaces it as `*needs input:*` (and the assertion can't be
// fooled). Mutates + returns `data`.
//
// This is the ENGINE-SIDE half. A richer LLM brief-expand round is an OPTIONAL
// enrichment the orchestrator runs (same request/response handoff as research) —
// the zero-token invariant does NOT depend on it: degrade guarantees it offline.
function briefExpand(data, sections) {
  const d = data;
  // one_liner: fall back to the problem/summary if the heuristic missed it.
  d.one_liner = firstNonEmpty(
    d.one_liner,
    pick(sections, "problem", "summary", "one-liner"),
  );
  // what_it_is: solution/product/mvp.
  d.what_it_is = firstNonEmpty(
    d.what_it_is,
    pick(sections, "solution", "product", "mvp", "what it is"),
  );
  // vision: a present vision section, else compose from the one-liner (clearly
  // marked as a projection, not an asserted vision).
  d.vision = firstNonEmpty(d.vision, pick(sections, "vision", "wedge to full"));
  // primary_audience / primary_jtbd: each can stand in for the other when only
  // one is given (audience and the job-to-be-done are tightly coupled in a brief).
  d.primary_audience = firstNonEmpty(
    d.primary_audience,
    pick(sections, "audience", "user", "customer"),
    d.primary_jtbd,
  );
  d.primary_jtbd = firstNonEmpty(
    d.primary_jtbd,
    pick(sections, "jtbd", "job", "problem"),
    d.primary_audience,
  );
  // cohort_1_name: derive a name from the audience when present (e.g. the first
  // line / noun-phrase of the audience description) — not a fabricated persona.
  if (!firstNonEmpty(d.cohort_1_name) && firstNonEmpty(d.primary_audience)) {
    const firstLine = d.primary_audience.split(/\r?\n/)[0].trim();
    // Keep it short — a label, not a paragraph.
    d.cohort_1_name = firstLine.length > 60 ? "Primary cohort" : firstLine;
  }
  // path_1_name: the core loop / golden path; fall back to the solution/MVP as the
  // primary flow when no explicit path is named.
  d.path_1_name = firstNonEmpty(
    d.path_1_name,
    pick(sections, "golden path", "core loop", "flow"),
    d.what_it_is,
  );
  // product_primitives: the MVP/feature surface.
  d.product_primitives = firstNonEmpty(
    d.product_primitives,
    pick(sections, "primitive", "feature", "mvp"),
  );
  return d;
}

// Extract the {{token}} names referenced by a template.
function templateTokens(tmpl) {
  const toks = new Set();
  tmpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => (toks.add(k), _m));
  return [...toks];
}

// A doc is THIN (a research candidate) when every one of its template tokens —
// except the always-filled ones — is empty in the field map. Template-driven so
// it can't rot when a template gains/loses a field.
const ALWAYS_FILLED = new Set(["product_name", "evolution_status_note"]);
function isThinDoc(tmpl, data) {
  const toks = templateTokens(tmpl).filter((t) => !ALWAYS_FILLED.has(t));
  if (toks.length === 0) return false;
  return toks.every(
    (t) => data[t] === undefined || data[t] === null || data[t] === "",
  );
}

// Detect which template placeholders remain unfilled after the field map.
function detectThin(tmpl, data) {
  const thin = [];
  tmpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => {
    if (data[k] === undefined || data[k] === null || data[k] === "")
      thin.push(k);
    return _m;
  });
  return thin;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.intent || !args.product) {
    process.stderr.write(
      'Usage: node scripts/canon/generate.js --intent <file.md> --product "<name>" [--out <dir>] [--research simple|deep|off] [--dry-run]\n',
    );
    return 2;
  }
  if (!fs.existsSync(TMPL_DIR)) {
    process.stderr.write(
      `canon templates missing at ${TMPL_DIR} — run /mc:update.\n`,
    );
    return 1;
  }
  const intentPath = path.resolve(REPO_ROOT, args.intent);
  if (!fs.existsSync(intentPath)) {
    process.stderr.write(`intent file not found: ${intentPath}\n`);
    return 1;
  }
  const sections = parseIntentSections(fs.readFileSync(intentPath, "utf8"));
  const data = buildFieldMap(args.product, sections);
  // WI-38: brief-expand thin fields from intent BEFORE thin-detection + render, so
  // we research/degrade only what genuinely has no intent source.
  briefExpand(data, sections);

  // Load templates; gather thin fields + thin DOCS (research candidates).
  const tmpls = {};
  const allThin = new Set();
  const thinDocs = [];
  for (const name of NARRATIVE) {
    const t = fs.readFileSync(path.join(TMPL_DIR, `${name}.md.tmpl`), "utf8");
    tmpls[`${name}.md`] = t;
    detectThin(t, data).forEach((f) => allThin.add(f));
    if (isThinDoc(t, data)) thinDocs.push(name);
  }

  // Structured JSON: render the .json.tmpl, default the still-placeholder
  // product-specific tokens to empty containers so output is valid JSON.
  const jsonDefaults = {
    value_group_1_name: "values",
    value_group_1: "{}",
    enums: "{}",
    validation_rules: "{}",
    precedence_rules: "{}",
    phases: "[]",
    steps: "[]",
  };
  for (const name of STRUCTURED) {
    // jsonSafeDegrade: any token NOT covered by jsonDefaults/data degrades to a
    // JSON-safe empty container ({}), never a raw {{token}} (which would both
    // break JSON.parse AND breach the WI-38 invariant) and never a text marker
    // (which is invalid JSON). Robust if a JSON template gains a new token.
    tmpls[`${name}.json`] = render(
      fs.readFileSync(path.join(TMPL_DIR, `${name}.json.tmpl`), "utf8"),
      { ...jsonDefaults, ...data },
      { degrade: true, jsonSafe: true },
    );
  }

  // Render narrative WITH degrade (WI-38: no raw {{token}} ever ships — an
  // unfilled field becomes a `*needs input:*` marker) + carry over structured.
  const artifacts = {};
  for (const name of NARRATIVE)
    artifacts[`${name}.md`] = render(tmpls[`${name}.md`], data, { degrade: true });
  for (const name of STRUCTURED) artifacts[`${name}.json`] = tmpls[`${name}.json`];

  // T4: capped research. The engine owns the CAP (bounded query set from the
  // schema's x-fields for thin docs) + validation + cited merge; the LIVE
  // invocation is the orchestrator's job (bootstrap:spinup canon phase). When
  // --research-in is supplied we validate + merge it; otherwise we emit the
  // bounded request the orchestrator must run research:* against.
  const researchOut = {
    backend: args.research,
    request: null,
    merged: [],
    skipped_thin: [],
    rejected: [],
    warnings: [],
  };
  if (args.research !== "off" && thinDocs.length) {
    const capInfo = research.loadCapSchema();
    const querySet = research.buildResearchQuerySet(thinDocs, capInfo, args.product);
    researchOut.request = querySet;
    if (args.researchIn) {
      const findings = JSON.parse(
        fs.readFileSync(path.resolve(REPO_ROOT, args.researchIn), "utf8"),
      );
      const v = research.validateFindings(findings, capInfo);
      if (v.errors.length) {
        process.stderr.write(
          `research findings invalid:\n  ${v.errors.join("\n  ")}\n`,
        );
        return 1;
      }
      const m = research.mergeFindings(artifacts, v.valid);
      researchOut.merged = m.merged;
      researchOut.skipped_thin = v.thinDocs;
      researchOut.rejected = v.rejected;
      researchOut.warnings = v.warnings;
    }
  }

  // T5: validate the rendered artifacts. ERRORS = structural bug (exit 1);
  // THIN inputs = warnings (exit 0). β: thin is a warning, never a silent pass.
  const validation = validateArtifacts(artifacts, {
    tmplDir: TMPL_DIR,
    narrative: NARRATIVE,
    structured: STRUCTURED,
  });

  const outDir = path.resolve(REPO_ROOT, args.out);
  const written = [];
  // When research was requested but not yet supplied, drop the bounded request
  // so the orchestrator can run it and re-invoke with --research-in.
  let requestFile = null;
  if (!args.dryRun) {
    fs.mkdirSync(outDir, { recursive: true });
    if (researchOut.request && !args.researchIn) {
      requestFile = path.join(outDir, ".canon-research-request.json");
      fs.writeFileSync(requestFile, JSON.stringify(researchOut.request, null, 2) + "\n", "utf8");
    }
    if (validation.ok) {
      for (const [fname, body] of Object.entries(artifacts)) {
        fs.writeFileSync(path.join(outDir, fname), body, "utf8");
        written.push(fname);
      }
    }
  }

  // WI-38: the `*needs input:*` markers actually emitted into the narrative
  // artifacts (the honest thin signal — distinct from any raw-token leak, which
  // the assertion forbids). Counted from the rendered output, not the data map.
  const needsInput = new Set();
  for (const name of NARRATIVE) {
    const body = artifacts[`${name}.md`] || "";
    let m;
    NEEDS_INPUT_RE.lastIndex = 0;
    while ((m = NEEDS_INPUT_RE.exec(body)) !== null)
      needsInput.add(`${name}.md:${m[1]}`);
  }

  const result = {
    ok: validation.ok,
    product: args.product,
    out: args.out,
    artifacts: Object.keys(artifacts),
    thin_fields: [...allThin],
    thin_docs: thinDocs,
    needs_input: [...needsInput].sort(),
    research: researchOut,
    validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, thin: validation.thin },
    dry_run: args.dryRun,
    written,
  };
  if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else {
    if (!validation.ok) {
      process.stdout.write(
        `canon: VALIDATION FAILED for "${args.product}" — ${validation.errors.length} error(s), no artifacts written:\n  ${validation.errors.join("\n  ")}\n`,
      );
    } else {
      process.stdout.write(
        `canon: ${args.dryRun ? "dry-run" : "wrote " + written.length} artifacts (${NARRATIVE.length} MD + ${STRUCTURED.length} JSON) for "${args.product}"\n`,
      );
    }
    if (researchOut.merged.length)
      process.stdout.write(`  research: merged cited findings into ${researchOut.merged.join(", ")}\n`);
    if (requestFile)
      process.stdout.write(`  research: requested — ${researchOut.request.queries.length} bounded ${researchOut.request.backend} queries written to ${path.relative(REPO_ROOT, requestFile)}; run research:* and re-invoke with --research-in\n`);
    for (const w of researchOut.warnings) process.stdout.write(`  WARNING: ${w}\n`);
    for (const w of validation.warnings) process.stdout.write(`  WARNING: ${w}\n`);
    if (needsInput.size)
      process.stdout.write(
        `  ${needsInput.size} field(s) need input (no intent source — emitted as "needs input:" markers, NOT raw tokens): ${[...needsInput].join(", ")}${args.research === "off" ? " — fill by hand or re-run with --research simple" : ""}\n`,
      );
  }
  return validation.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());
module.exports = {
  main,
  parseArgs,
  parseIntentSections,
  buildFieldMap,
  briefExpand,
  firstNonEmpty,
  render,
  detectThin,
  templateTokens,
  isThinDoc,
  NEEDS_INPUT,
  NEEDS_INPUT_RE,
  NARRATIVE,
  STRUCTURED,
};
