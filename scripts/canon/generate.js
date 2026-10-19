#!/usr/bin/env node
"use strict";

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

const NEEDS_INPUT = (field) => `*needs input: ${field}*`;
const NEEDS_INPUT_RE = /\*needs input:\s*([a-zA-Z0-9_]+)\s*\*/g;

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

function pick(sections, ...keywords) {
  for (const [title, body] of Object.entries(sections)) {
    if (keywords.some((k) => title.includes(k)) && body) return body;
  }
  return "";
}

function stackFallbackRationale(layer) {
  return `Declared during product intake for the ${layer} layer; revise if implementation evidence drifts.`;
}

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
    data_model: pick(sections, "data model", "data", "model", "schema", "entities"),
    core_entities: pick(sections, "entities", "entity", "data model", "schema", "model"),
    account_types: pick(sections, "account type", "account", "user type", "plan", "tier"),
    authentication: pick(sections, "authentication", "auth", "login", "signin", "sso", "oauth"),
    permissions_roles: pick(sections, "permission", "role", "access control", "rbac", "acl"),
    data_retention: pick(sections, "retention", "privacy", "gdpr", "data retention", "deletion"),
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
  };
}

function firstNonEmpty(...vals) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

function briefExpand(data, sections) {
  const d = data;
  d.one_liner = firstNonEmpty(
    d.one_liner,
    pick(sections, "problem", "summary", "one-liner"),
  );
  d.what_it_is = firstNonEmpty(
    d.what_it_is,
    pick(sections, "solution", "product", "mvp", "what it is"),
  );
  d.vision = firstNonEmpty(d.vision, pick(sections, "vision", "wedge to full"));
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
  if (!firstNonEmpty(d.cohort_1_name) && firstNonEmpty(d.primary_audience)) {
    const firstLine = d.primary_audience.split(/\r?\n/)[0].trim();
    d.cohort_1_name = firstLine.length > 60 ? "Primary cohort" : firstLine;
  }
  d.path_1_name = firstNonEmpty(
    d.path_1_name,
    pick(sections, "golden path", "core loop", "flow"),
    d.what_it_is,
  );
  d.product_primitives = firstNonEmpty(
    d.product_primitives,
    pick(sections, "primitive", "feature", "mvp"),
  );
  return d;
}

function templateTokens(tmpl) {
  const toks = new Set();
  tmpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => (toks.add(k), _m));
  return [...toks];
}

const ALWAYS_FILLED = new Set(["product_name", "evolution_status_note"]);
function isThinDoc(tmpl, data) {
  const toks = templateTokens(tmpl).filter((t) => !ALWAYS_FILLED.has(t));
  if (toks.length === 0) return false;
  return toks.every(
    (t) => data[t] === undefined || data[t] === null || data[t] === "",
  );
}

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
  briefExpand(data, sections);

  const tmpls = {};
  const allThin = new Set();
  const thinDocs = [];
  for (const name of NARRATIVE) {
    const t = fs.readFileSync(path.join(TMPL_DIR, `${name}.md.tmpl`), "utf8");
    tmpls[`${name}.md`] = t;
    detectThin(t, data).forEach((f) => allThin.add(f));
    if (isThinDoc(t, data)) thinDocs.push(name);
  }

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
    tmpls[`${name}.json`] = render(
      fs.readFileSync(path.join(TMPL_DIR, `${name}.json.tmpl`), "utf8"),
      { ...jsonDefaults, ...data },
      { degrade: true, jsonSafe: true },
    );
  }

  const artifacts = {};
  for (const name of NARRATIVE)
    artifacts[`${name}.md`] = render(tmpls[`${name}.md`], data, { degrade: true });
  for (const name of STRUCTURED) artifacts[`${name}.json`] = tmpls[`${name}.json`];

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

  const validation = validateArtifacts(artifacts, {
    tmplDir: TMPL_DIR,
    narrative: NARRATIVE,
    structured: STRUCTURED,
  });

  const outDir = path.resolve(REPO_ROOT, args.out);
  const written = [];
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
