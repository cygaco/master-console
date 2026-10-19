#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const { readYamlMaybe } = require("./fs");
const { AC_CATEGORIES } = require("./ac-categories");
const { cutoffFor, isLegacyDate } = require("../dispatch/legacy-cutoff");

function parseArgs(argv) {
  const out = {
    sprint: null,
    json: false,
    help: false,
    categories: false,
    file: null,
    enforce: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sprint") out.sprint = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--categories") out.categories = true;
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--enforce") out.enforce = true;
  }
  return out;
}

const HELP = `check-ac-coverage — read-only audit of AC coverage on two axes.

Axis 1 (default) — per-AC verified_by: linkage:
  node scripts/sprint/check-ac-coverage.js [--sprint <SP-id>] [--json]

Axis 2 (--categories) — the 20 enforcement-criteria categories:
  node scripts/sprint/check-ac-coverage.js --categories [--sprint <SP-id>] [--json]
  node scripts/sprint/check-ac-coverage.js --categories --file <plan|epic|AC artifact>
    Report-only ramp: a plan missing categories is FLAGGED (exit 0), NOT blocked.
    --enforce   exit non-zero when a category is uncovered (off by default).
    Fail-open: an unreadable/absent artifact reports nothing and exits 0 clean.
    Single source for the category list: scripts/sprint/ac-categories.js.

Exit: 0 = clean OR no goal_verification gate OR report-only categories,
      1 = missing linkage (axis 1) / uncovered category under --enforce (axis 2),
      2 = usage error.
`;

const placeholderRegex = /\{\{|<test-file>|<test-name>/;
const acRegex = /\bAC-\d+(?:\.\d+)+\b/;

function classifyVerifiedByRest(rest) {
  if (/^not_applicable\b/i.test(rest)) {
    const justMatch = rest.match(/^not_applicable\s*(?:—|--|-)?\s*(.*)$/i);
    const j2 = justMatch ? justMatch[1].trim() : "";
    if (!j2) {
      return { state: "missing", evidence: "not_applicable-empty-justification" };
    }
    return { state: "not_applicable", evidence: j2 };
  }
  if (/^\S+::\S+/.test(rest)) {
    return { state: "executable", evidence: rest };
  }
  return { state: "missing", evidence: `unrecognized: ${rest}` };
}

function analyzeFile(acMarkdown) {
  const lines = acMarkdown.split(/\r?\n/);
  const details = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(acRegex);
    if (!m) continue;
    let state = "missing";
    let evidence = null;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const cand = lines[j];
      if (/^\s*$/.test(cand)) continue;
      if (acRegex.test(cand)) break;
      const linkMatch = cand.match(/verified_by\s*:\s*(.+?)\s*$/i);
      if (!linkMatch) continue;
      const rest = linkMatch[1];
      if (placeholderRegex.test(cand)) {
        state = "missing";
        evidence = "placeholder";
        break;
      }
      const c = classifyVerifiedByRest(rest);
      state = c.state;
      evidence = c.evidence;
      break;
    }
    details.push({
      ac: m[0],
      line: i + 1,
      state,
      evidence,
    });
  }
  return details;
}

const proofPlaceholderRegex = /\{\{|<test-file>|<test-name>|<proof>|<fill/i;

function normalizeLine(s) {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function isStubProof(v) {
  if (!v) return true;
  if (proofPlaceholderRegex.test(v)) return true;
  if (
    /^(todo|tbd|t\.?b\.?d\.?|pending|fixme|wip|n\/a|na|xxx|\.\.\.|placeholder|stub|none|fill[\s-]?me|fill in)\b/i.test(
      v,
    )
  ) {
    return true;
  }
  return false;
}

function chunkHasProof(chunk) {
  const vb = chunk.match(/verified_by\s*:\s*([^\n]+)/i);
  if (vb) {
    const rest = vb[1].trim();
    if (!proofPlaceholderRegex.test(rest) && !placeholderRegex.test(rest)) {
      const c = classifyVerifiedByRest(rest);
      if (c.state === "executable" || c.state === "not_applicable") return true;
    }
  }
  let pm = chunk.match(/\bproof\s*:\s*([^\n]+)/i);
  if (!pm) pm = chunk.match(/\bproven by\b\s*[:\-—]*\s*([^\n]+)/i);
  if (pm) {
    const v = pm[1].trim().replace(/[*_`]+\s*$/, "").trim();
    if (v && !isStubProof(v)) return true;
  }
  return false;
}

function checkCategoryCoverage(acMarkdown, categories = AC_CATEGORIES) {
  const text = typeof acMarkdown === "string" ? acMarkdown : "";
  const lines = text.split(/\r?\n/);
  const norm = lines.map(normalizeLine);
  const normCats = categories.map((c) => normalizeLine(c));

  const details = categories.map((cat, ci) => {
    const ncat = normCats[ci];
    let nameLine = -1;
    for (let i = 0; i < norm.length; i++) {
      if (norm[i].includes(ncat)) {
        nameLine = i;
        break;
      }
    }
    if (nameLine === -1) {
      return { category: cat, state: "missing", line: null };
    }
    const windowLines = [lines[nameLine]];
    for (let j = nameLine + 1; j < Math.min(nameLine + 5, lines.length); j++) {
      if (/^\s*#{1,6}\s/.test(lines[j])) break;
      const namesOther = normCats.some(
        (other, oi) => oi !== ci && norm[j].includes(other),
      );
      if (namesOther) break;
      windowLines.push(lines[j]);
    }
    const proven = chunkHasProof(windowLines.join("\n"));
    return {
      category: cat,
      state: proven ? "covered" : "named_no_proof",
      line: nameLine + 1,
    };
  });

  const missing = details.filter((d) => d.state === "missing").map((d) => d.category);
  const namedNoProof = details
    .filter((d) => d.state === "named_no_proof")
    .map((d) => d.category);
  const covered = details.filter((d) => d.state === "covered");
  const uncovered = details.filter((d) => d.state !== "covered").map((d) => d.category);

  return {
    total: categories.length,
    covered: covered.length,
    missing,
    named_no_proof: namedNoProof,
    uncovered,
    findings: uncovered,
    ok: uncovered.length === 0,
    complete: uncovered.length === 0,
    details,
  };
}

function resolveAcPath(sprintId) {
  try {
    const per =
      typeof SPRINT.forSprint === "function" ? SPRINT.forSprint(sprintId) : null;
    if (!per || !per.current || !fs.existsSync(per.current)) return null;
    const current = readYamlMaybe(per.current);
    if (!current) return null;
    const acRel =
      current.requirements && current.requirements.acceptance_criteria;
    if (!acRel) return null;
    return path.resolve(SPRINT.PROJECT, acRel);
  } catch {
    return null;
  }
}

function sprintIsoDate(sprintId) {
  const m = typeof sprintId === "string" && sprintId.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function categoryTargets(args) {
  if (args.file) {
    return [
      {
        label: args.file,
        path: path.resolve(SPRINT.PROJECT, args.file),
        named: true,
        date: null,
      },
    ];
  }
  const ids = args.sprint
    ? [args.sprint]
    : activeSprintIds().length
      ? activeSprintIds()
      : [SPRINT.active && SPRINT.active()].filter(Boolean);
  const targets = [];
  for (const id of ids) {
    const acPath = resolveAcPath(id);
    if (acPath) {
      targets.push({
        label: id,
        path: acPath,
        named: true,
        date: sprintIsoDate(id),
        exists: fs.existsSync(acPath),
      });
    }
  }
  return targets;
}

function renderCategoryProse(r) {
  if (r.error) {
    if (r.enforceError) {
      return `ac-coverage (categories) — ${r.label}: FAIL (NAMED artifact unreadable: ${r.error} — fail-CLOSED under --enforce)`;
    }
    const why = r.legacyExempt ? "legacy-exempt, historic" : "fail-open";
    return `ac-coverage (categories) — ${r.label}: SKIP (${r.error}; ${why})`;
  }
  const lines = [];
  if (r.legacyExempt && Array.isArray(r.uncovered) && r.uncovered.length) {
    lines.push(
      `ac-coverage (categories) — ${r.label}: ${r.covered}/${r.total} covered (LEGACY-EXEMPT — historic, gaps are INFO not blocking)`,
    );
    return lines.join("\n");
  }
  lines.push(
    `ac-coverage (categories) — ${r.label}: ${r.covered}/${r.total} covered, ${r.missing.length} missing, ${r.named_no_proof.length} named-but-unproven`,
  );
  if (r.uncovered.length) {
    lines.push(
      `  FLAGGED (report-only) — ${r.uncovered.length} category(ies) need AC + proof:`,
    );
    for (const cat of r.missing) {
      lines.push(`    - ${cat} (not named in the artifact)`);
    }
    for (const cat of r.named_no_proof) {
      lines.push(`    - ${cat} (named, but no proof/verified_by)`);
    }
  }
  return lines.join("\n");
}

function runCategoryMode(args, inject = {}) {
  const targets = inject.targets || categoryTargets(args);
  const cutoff = cutoffFor("check-ac-coverage");
  const reports = targets.map((t) => {
    const legacyExempt = isLegacyDate(t.date, cutoff);
    let md;
    try {
      md = fs.readFileSync(t.path, "utf8");
    } catch (e) {
      const enforceError = Boolean(t.named) && !legacyExempt;
      return {
        label: t.label,
        error: "unreadable",
        named: Boolean(t.named),
        legacyExempt,
        enforceError,
        ok: !(args.enforce && enforceError),
        errorDetail: String((e && e.message) || e),
        total: AC_CATEGORIES.length,
        covered: 0,
        missing: [],
        named_no_proof: [],
        uncovered: [],
      };
    }
    return { label: t.label, legacyExempt, named: Boolean(t.named), ...checkCategoryCoverage(md) };
  });

  if (args.json) {
    process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
  } else {
    if (!reports.length) {
      process.stdout.write(
        "ac-coverage (categories) — no AC artifact to audit (greenfield: fail-open, exit 0)\n",
      );
    }
    for (const r of reports) process.stdout.write(renderCategoryProse(r) + "\n");
    process.stdout.write(
      `\nmode: report-only (${args.enforce ? "--enforce: exit non-zero on gaps + unreadable NAMED artifacts" : "default: gaps are FLAGGED, exit 0"}) · cutoff: ${cutoff} · single source: scripts/sprint/ac-categories.js (${AC_CATEGORIES.length} categories)\n`,
    );
  }

  const anyGap = reports.some(
    (r) => !r.error && !r.legacyExempt && Array.isArray(r.uncovered) && r.uncovered.length > 0,
  );
  const anyEnforceError = reports.some((r) => r.enforceError);
  return args.enforce && (anyGap || anyEnforceError) ? 1 : 0;
}

function checkSprint(sprintId) {
  const entry =
    typeof SPRINT.entry === "function" ? SPRINT.entry(sprintId) : null;
  if (!entry && sprintId) {
    return {
      sprint_id: sprintId,
      error: `unknown sprint id ${sprintId} in active-sprints.yaml`,
    };
  }
  const per =
    typeof SPRINT.forSprint === "function" ? SPRINT.forSprint(sprintId) : null;
  if (!per || !per.current) {
    return { sprint_id: sprintId, error: "no per-sprint current.yaml" };
  }
  const current = readYamlMaybe(per.current);
  if (!current) {
    return { sprint_id: sprintId, error: "current.yaml unreadable" };
  }
  const plan = current.plan_contract
    ? readYamlMaybe(path.resolve(SPRINT.PROJECT, current.plan_contract))
    : null;
  const gv = plan && plan.goal_verification;
  const acRel =
    current.requirements && current.requirements.acceptance_criteria;
  if (!acRel) {
    return {
      sprint_id: sprintId,
      gate_applicable: Boolean(gv),
      error: "no acceptance-criteria.md linked from current sprint",
    };
  }
  const acPath = path.resolve(SPRINT.PROJECT, acRel);
  if (!fs.existsSync(acPath)) {
    return {
      sprint_id: sprintId,
      gate_applicable: Boolean(gv),
      error: `acceptance-criteria.md missing at ${acPath}`,
    };
  }
  const details = analyzeFile(fs.readFileSync(acPath, "utf8"));
  const exec = details.filter((d) => d.state === "executable").length;
  const na = details.filter((d) => d.state === "not_applicable").length;
  const missing = details.filter((d) => d.state === "missing").length;
  return {
    sprint_id: sprintId,
    title: current.title,
    gate_applicable: Boolean(gv),
    goal_verification_reproduction: gv ? gv.reproduction : null,
    acceptance_criteria_path: acRel,
    total_acs: details.length,
    executable: exec,
    not_applicable: na,
    missing,
    details,
  };
}

function activeSprintIds() {
  try {
    const reg = readYamlMaybe(SPRINT.activeRegistry);
    if (!reg || !Array.isArray(reg.sprints)) return [];
    return reg.sprints
      .filter(
        (s) =>
          s &&
          s.status !== "closed" &&
          s.status !== "abandoned" &&
          s.status !== "retrospected",
      )
      .map((s) => s.id);
  } catch {
    return [];
  }
}

function renderProse(report) {
  const lines = [];
  if (report.error) {
    lines.push(
      `ac-coverage — sprint ${report.sprint_id}: ERROR ${report.error}`,
    );
    return lines.join("\n");
  }
  lines.push(
    `ac-coverage — sprint ${report.sprint_id}: ${report.executable} executable, ${report.not_applicable} not_applicable, ${report.missing} missing  (total: ${report.total_acs})`,
  );
  if (!report.gate_applicable) {
    lines.push(
      `  note: plan_contract has no goal_verification block — gate is not applicable; report is informational.`,
    );
  }
  if (report.missing > 0) {
    lines.push(`  missing ACs:`);
    for (const d of report.details) {
      if (d.state === "missing") {
        lines.push(
          `    - ${d.ac} (line ${d.line}; ${d.evidence || "no verified_by line"})`,
        );
      }
    }
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.categories) {
    return runCategoryMode(args);
  }
  const sprintIds = args.sprint
    ? [args.sprint]
    : (() => {
        if (
          typeof SPRINT.active === "function" &&
          SPRINT.active() &&
          typeof activeSprintIds === "function"
        ) {
          const ids = activeSprintIds();
          return ids.length ? ids : [SPRINT.active()];
        }
        return [SPRINT.active && SPRINT.active()].filter(Boolean);
      })();
  if (sprintIds.length === 0) {
    process.stderr.write("no active sprints to audit\n");
    return 1;
  }
  const reports = sprintIds.map(checkSprint);
  if (args.json) {
    process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
  } else {
    for (const r of reports) {
      process.stdout.write(renderProse(r) + "\n");
    }
  }
  const bad = reports.some(
    (r) => !r.error && r.gate_applicable && r.missing > 0,
  );
  return bad ? 1 : 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  checkSprint,
  analyzeFile,
  parseArgs,
  classifyVerifiedByRest,
  checkCategoryCoverage,
  chunkHasProof,
  isStubProof,
  resolveAcPath,
  runCategoryMode,
  categoryTargets,
  sprintIsoDate,
  AC_CATEGORIES,
};
