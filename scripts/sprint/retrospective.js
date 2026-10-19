#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const {
  ensureDir,
  readText,
  readYamlMaybe,
  writeYaml,
  writeText,
  render,
  nowIso,
  yamlDump,
} = require("./fs");

const SCHEMA_ID = "mc/sprint/sprint-retrospective/v1";
const WRITER_VERSION = "1.0.0";
const RETRO_DIR_NAME = "retrospective";

function parseArgs(argv) {
  const out = {
    sprint: null,
    synthesis: null,
    noSynth: false,
    force: false,
    reviewOnly: false,
    noPlanContract: false,
    retrySynth: false,
    signedOffBy: "alpha",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sprint") out.sprint = argv[++i] || null;
    else if (a === "--synthesis") out.synthesis = argv[++i] || null;
    else if (a === "--no-synth") out.noSynth = true;
    else if (a === "--force") out.force = true;
    else if (a === "--review-only") out.reviewOnly = true;
    else if (a === "--no-plan-contract") out.noPlanContract = true;
    else if (a === "--retry-synth") out.retrySynth = true;
    else if (a === "--signed-off-by") out.signedOffBy = argv[++i] || "alpha";
  }
  return out;
}

function retroDir(sprintId) {
  return path.join(SPRINT.history, sprintId);
}
function retroYamlPath(sprintId) {
  return path.join(retroDir(sprintId), "retro.yaml");
}
function retroMdPath(sprintId) {
  return path.join(retroDir(sprintId), "retro.md");
}
function historyYamlPath(sprintId) {
  return path.join(retroDir(sprintId), "sprint-history.yaml");
}
function templatesDir() {
  return path.join(SPRINT.templates, RETRO_DIR_NAME);
}

function resolveSprintId(argSprint) {
  if (argSprint) return argSprint;
  const reg = readYamlMaybe(SPRINT.activeRegistry);
  if (reg && reg.primary) return reg.primary;
  return null;
}

function sprintEntry(sprintId) {
  const reg = readYamlMaybe(SPRINT.activeRegistry);
  if (!reg || !Array.isArray(reg.sprints)) return null;
  return reg.sprints.find((s) => s.id === sprintId) || null;
}

function loadPlanContract(sprintCurrent) {
  if (!sprintCurrent || !sprintCurrent.plan_contract) return null;
  const pcPath = path.isAbsolute(sprintCurrent.plan_contract)
    ? sprintCurrent.plan_contract
    : path.join(SPRINT.PROJECT, sprintCurrent.plan_contract);
  return readYamlMaybe(pcPath);
}

function loadTicketsByBucket(sprintCurrent) {
  if (!sprintCurrent || !sprintCurrent.tickets) return {};
  return sprintCurrent.tickets;
}

function loadAllTickets(sprintId) {
  const out = [];
  if (!fs.existsSync(SPRINT.tickets)) return out;
  for (const f of fs.readdirSync(SPRINT.tickets)) {
    if (!f.endsWith(".yaml")) continue;
    const t = readYamlMaybe(path.join(SPRINT.tickets, f));
    if (t && t.sprint === sprintId) out.push(t);
  }
  return out;
}

function loadIssuesForSprint(sprintId) {
  const out = [];
  if (!fs.existsSync(SPRINT.issues)) return out;
  for (const f of fs.readdirSync(SPRINT.issues)) {
    if (!f.endsWith(".yaml")) continue;
    const issue = readYamlMaybe(path.join(SPRINT.issues, f));
    if (issue && issue.sprint === sprintId) out.push(issue);
  }
  return out;
}

function loadDecisionsForSprint(sprintId) {
  const out = [];
  if (!fs.existsSync(SPRINT.decisions)) return out;
  for (const f of fs.readdirSync(SPRINT.decisions)) {
    if (!f.endsWith(".yaml")) continue;
    const dec = readYamlMaybe(path.join(SPRINT.decisions, f));
    if (dec && dec.sprint === sprintId) out.push(dec);
  }
  return out;
}

function loadCheckpointsForSprint(sprintId) {
  const out = [];
  if (!fs.existsSync(SPRINT.checkpoints)) return out;
  const re = new RegExp(`^${sprintId}-\\d{4}\\.yaml$`);
  for (const f of fs.readdirSync(SPRINT.checkpoints)) {
    if (!re.test(f)) continue;
    out.push(f);
  }
  return out.sort();
}

function loadReleaseRecordForSprint(sprintId) {
  if (!fs.existsSync(SPRINT.releases)) return null;
  let latest = null;
  for (const f of fs.readdirSync(SPRINT.releases)) {
    if (!f.endsWith(".yaml")) continue;
    const r = readYamlMaybe(path.join(SPRINT.releases, f));
    if (r && r.sprint === sprintId) {
      if (
        !latest ||
        new Date(r.updated_at || 0).getTime() >
          new Date(latest.updated_at || 0).getTime()
      ) {
        latest = r;
      }
    }
  }
  return latest;
}

function loadHistoryForSprint(sprintId) {
  const p = historyYamlPath(sprintId);
  return readYamlMaybe(p);
}

function buildSkeletonRetro(ctx) {
  const now = nowIso();
  const planContract = ctx.planContract;
  const release = ctx.release;
  const history = ctx.history;
  const tickets = ctx.allTickets;

  const ticketsCompleted = tickets
    .filter((t) => t.status === "done" || t.status === "released")
    .map((t) => t.id);
  const ticketsDeferred = tickets
    .filter((t) => t.status === "deferred")
    .map((t) => t.id);
  const ticketsAbandoned = tickets
    .filter((t) => t.status === "abandoned")
    .map((t) => t.id);
  const ticketsReopened = (history && history.tickets_reopened) || [];

  const issuesEncountered = ctx.issues.map((i) => ({
    issue_id: i.id || "<unknown>",
    title: i.title || "<TO FILL>",
    disposition: i.status === "resolved" ? "fixed" : i.status || "open",
    linked_ticket: (i.linked_tickets && i.linked_tickets[0]) || "",
  }));

  const betaDecisionsReviewed = ctx.decisions
    .filter((d) => d.kind === "beta" || (d.actor && d.actor === "beta"))
    .map((d) => ({
      decision: d.title || d.id || "<TO FILL>",
      verdict: d.verdict || "unknown",
      outcome: d.outcome || "<TO FILL>",
    }));

  const plannedVariant =
    planContract && planContract.scope && planContract.scope_variants
      ? "recommended"
      : "unknown";

  return {
    schema: SCHEMA_ID,
    sprint_id: ctx.sprintId,
    plan_contract_id: planContract ? planContract.id : null,
    synthesis_mode: "skeleton",
    summary: "<TO FILL>",
    outcomes_shipped: [
      {
        outcome: "<TO FILL>",
        evidence: [],
        planned: true,
      },
    ],
    outcomes_missed: [
      {
        outcome: "<TO FILL>",
        reason: "<TO FILL>",
        disposition: "unknown",
      },
    ],
    plan_quality_actual: {
      predicted_status:
        (planContract &&
          planContract.plan_quality &&
          planContract.plan_quality.status) ||
        "<unknown — no evidence in tracker>",
      actual_status: "<TO FILL>",
      predicted_confidence:
        (planContract &&
          planContract.plan_quality &&
          planContract.plan_quality.confidence) ||
        "<unknown — no evidence in tracker>",
      evidence_gaps_predicted:
        (planContract &&
          planContract.plan_quality &&
          planContract.plan_quality.evidence_gaps) ||
        [],
      evidence_gaps_actual: [],
      notes: "<TO FILL>",
    },
    scope_variant_actual: {
      planned_variant: plannedVariant,
      actual_variant: "unknown",
      adhered: false,
      drift_notes: "<TO FILL>",
    },
    surprises: [],
    friction_points: [
      {
        friction: "<TO FILL>",
        category: "other",
        evidence: [],
        severity: "low",
      },
    ],
    action_items: [
      {
        action: "<TO FILL>",
        owner: "alpha",
        due_by: "<TO FILL>",
        linked_friction: "",
      },
    ],
    tickets_completed: ticketsCompleted,
    tickets_deferred: ticketsDeferred,
    tickets_abandoned: ticketsAbandoned,
    tickets_reopened: ticketsReopened,
    issues_encountered: issuesEncountered,
    beta_decisions_reviewed: betaDecisionsReviewed,
    key_tradeoffs: (history && history.key_tradeoffs) || [],
    learning_candidates: [],
    release_record_ref: release ? release.id : null,
    synthesis_metadata: {
      model_class: "",
      provider: "",
      model_id: "",
      duration_ms: 0,
      output_chars: 0,
      fallback_reason: ctx.fallbackReason || null,
    },
    signed_off_by: ctx.signedOffBy,
    signed_off_at: now,
    retro_metadata: {
      synthesized_at: now,
      writer_version: WRITER_VERSION,
      history_record: history ? historyYamlPath(ctx.sprintId) : "",
      force_overwrite: Boolean(ctx.force),
    },
    created_at: now,
    updated_at: now,
  };
}

function mergeSynthesis(skeleton, synthesis) {
  if (!synthesis || typeof synthesis !== "object") return skeleton;
  const merged = { ...skeleton };
  const allowed = [
    "summary",
    "outcomes_shipped",
    "outcomes_missed",
    "plan_quality_actual",
    "scope_variant_actual",
    "surprises",
    "friction_points",
    "action_items",
    "key_tradeoffs",
    "learning_candidates",
    "beta_decisions_reviewed",
    "synthesis_metadata",
  ];
  for (const k of allowed) {
    if (synthesis[k] !== undefined) merged[k] = synthesis[k];
  }
  merged.synthesis_mode = "llm";
  if (synthesis.synthesis_metadata) {
    merged.synthesis_metadata = {
      ...merged.synthesis_metadata,
      ...synthesis.synthesis_metadata,
    };
  }
  return merged;
}

function renderYaml(retro) {
  const tmplPath = path.join(templatesDir(), "retro.yaml.tmpl");
  const tmpl = readText(tmplPath);
  if (!tmpl) {
    return yamlDump(retro, 0) + "\n";
  }
  const keyOrder = extractKeyOrder(tmpl);
  return emitYamlInOrder(retro, keyOrder);
}

function extractKeyOrder(tmpl) {
  const order = [];
  for (const raw of tmpl.split(/\r?\n/)) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*):/.exec(raw);
    if (m) order.push(m[1]);
  }
  return order;
}

function emitYamlInOrder(retro, order) {
  const lines = [];
  for (const k of order) {
    if (!(k in retro)) continue;
    const v = retro[k];
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        lines.push(yamlDump(v, 2));
      }
    } else if (v && typeof v === "object") {
      if (Object.keys(v).length === 0) {
        lines.push(`${k}: {}`);
      } else {
        lines.push(`${k}:`);
        lines.push(yamlDump(v, 2));
      }
    } else if (v === null) {
      lines.push(`${k}: null`);
    } else if (typeof v === "boolean" || typeof v === "number") {
      lines.push(`${k}: ${String(v)}`);
    } else {
      lines.push(`${k}: ${quoteScalar(String(v))}`);
    }
  }
  return lines.join("\n") + "\n";
}

function quoteScalar(s) {
  if (s === "") return '""';
  if (s.includes("\n")) {
    const indented = s
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    return `|\n${indented}`;
  }
  return JSON.stringify(s);
}

function bullets(arr, picker) {
  if (!Array.isArray(arr) || arr.length === 0) return "_None._";
  return arr.map((x) => `- ${picker(x)}`).join("\n");
}

function renderMd(retro, sprintTitle) {
  const tmplPath = path.join(templatesDir(), "retro.md.tmpl");
  const tmpl = readText(tmplPath);
  if (!tmpl) {
    return `# Sprint Retrospective — ${sprintTitle}\n\n(${retro.synthesis_mode} retro)\n`;
  }
  const meta = retro.synthesis_metadata || {};
  const data = {
    sprint_title: sprintTitle || retro.sprint_id,
    sprint_id: retro.sprint_id,
    plan_contract_id: retro.plan_contract_id || "(none)",
    synthesis_mode: retro.synthesis_mode,
    synthesized_at:
      (retro.retro_metadata && retro.retro_metadata.synthesized_at) ||
      retro.created_at,
    signed_off_by: retro.signed_off_by,
    signed_off_at: retro.signed_off_at,
    summary: retro.summary || "_(none)_",
    outcomes_shipped_md: bullets(
      retro.outcomes_shipped,
      (o) =>
        `${o.outcome}${o.evidence && o.evidence.length ? ` _(evidence: ${o.evidence.join(", ")})_` : ""}`,
    ),
    outcomes_missed_md: bullets(
      retro.outcomes_missed,
      (o) =>
        `${o.outcome} — ${o.disposition || "unknown"}${o.reason ? ` (${o.reason})` : ""}`,
    ),
    plan_quality_predicted_status:
      retro.plan_quality_actual.predicted_status || "—",
    plan_quality_actual_status: retro.plan_quality_actual.actual_status || "—",
    plan_quality_predicted_confidence:
      retro.plan_quality_actual.predicted_confidence || "—",
    plan_quality_notes: retro.plan_quality_actual.notes || "",
    scope_planned_variant:
      retro.scope_variant_actual.planned_variant || "unknown",
    scope_actual_variant:
      retro.scope_variant_actual.actual_variant || "unknown",
    scope_adhered: String(retro.scope_variant_actual.adhered),
    scope_drift_notes: retro.scope_variant_actual.drift_notes || "",
    surprises_md: bullets(
      retro.surprises,
      (s) => `${s.surprise}${s.impact ? ` — impact: ${s.impact}` : ""}`,
    ),
    friction_points_md: bullets(
      retro.friction_points,
      (f) =>
        `**[${f.severity || "low"} / ${f.category || "other"}]** ${f.friction}`,
    ),
    action_items_md: bullets(
      retro.action_items,
      (a) =>
        `${a.action}${a.owner ? ` _(owner: ${a.owner})_` : ""}${a.due_by ? ` _(due: ${a.due_by})_` : ""}`,
    ),
    tickets_completed_md: bullets(retro.tickets_completed, (t) => `\`${t}\``),
    tickets_deferred_md: bullets(retro.tickets_deferred, (t) => `\`${t}\``),
    tickets_abandoned_md: bullets(retro.tickets_abandoned, (t) => `\`${t}\``),
    tickets_reopened_md: bullets(retro.tickets_reopened, (t) => `\`${t}\``),
    issues_encountered_md: bullets(
      retro.issues_encountered,
      (i) => `\`${i.issue_id}\` — ${i.title} _(${i.disposition})_`,
    ),
    beta_decisions_reviewed_md: bullets(
      retro.beta_decisions_reviewed,
      (b) => `**${b.verdict}** — ${b.decision} → ${b.outcome}`,
    ),
    key_tradeoffs_md: bullets(retro.key_tradeoffs, (t) => t),
    learning_candidates_md: bullets(
      retro.learning_candidates,
      (l) =>
        `${l.learning}${l.evidence && l.evidence.length ? ` _(evidence: ${l.evidence.join(", ")})_` : ""}`,
    ),
    goal_verification_status_md: renderGoalVerificationStatus(retro.sprint_id),
    history_record_path:
      (retro.retro_metadata && retro.retro_metadata.history_record) ||
      "(no sprint-history.yaml)",
    release_record_ref: retro.release_record_ref || "(no release record)",
    synthesis_model_id:
      meta.model_id || (retro.synthesis_mode === "skeleton" ? "n/a" : "—"),
  };
  return render(tmpl, data);
}

function renderGoalVerificationStatus(sprintId) {
  try {
    const { checkSprint } = require("./check-ac-coverage");
    const report = checkSprint(sprintId);
    if (!report) return "_(no audit available)_";
    if (report.error) return `_(audit error: ${report.error})_`;
    if (!report.gate_applicable) {
      return `_(Plan Contract has no goal_verification block — gate not applicable; informational only)_`;
    }
    const lines = [];
    lines.push(
      `- **Executable:** ${report.executable}`,
      `- **Not applicable:** ${report.not_applicable}`,
      `- **Missing:** ${report.missing}`,
      `- **Total ACs:** ${report.total_acs}`,
    );
    if (report.missing > 0) {
      lines.push(``, `**Missing ACs:**`);
      for (const d of report.details || []) {
        if (d.state === "missing") {
          lines.push(
            `- \`${d.ac}\` (line ${d.line}; ${d.evidence || "no verified_by line"})`,
          );
        }
      }
    }
    return lines.join("\n");
  } catch (err) {
    return `_(audit skipped: ${err.message})_`;
  }
}

function validateRetro(retro) {
  const { loadSchemas, validate } = require("./validate");
  const { schemas, errors: schemaErrors } = loadSchemas();
  if (schemaErrors.length) {
    return { ok: false, errors: schemaErrors };
  }
  const schema = schemas[SCHEMA_ID];
  if (!schema) {
    return { ok: false, errors: [`schema not loaded: ${SCHEMA_ID}`] };
  }
  const errs = [];
  validate(retro, schema, schema, "$", errs);
  return { ok: errs.length === 0, errors: errs };
}

function flipStatusToRetrospected(sprintId) {
  const reg = readYamlMaybe(SPRINT.activeRegistry);
  if (!reg || !Array.isArray(reg.sprints)) {
    return { changed: false, from: null, to: null, reason: "no_registry" };
  }
  const entry = reg.sprints.find((s) => s.id === sprintId);
  if (!entry) {
    return { changed: false, from: null, to: null, reason: "not_in_registry" };
  }
  const from = entry.status;
  if (from === "retrospected") {
    entry.updated_at = nowIso();
    reg.updated_at = nowIso();
    writeYaml(SPRINT.activeRegistry, reg);
    return { changed: false, from, to: from, reason: "already_retrospected" };
  }
  entry.status = "retrospected";
  entry.updated_at = nowIso();
  reg.updated_at = nowIso();
  writeYaml(SPRINT.activeRegistry, reg);
  return { changed: true, from, to: "retrospected", reason: "ok" };
}

function emitEvent(eventName, fields) {
  try {
    const { logEvent } = require("../hooks/lib/logger");
    logEvent(
      "audit",
      "sprint",
      eventName,
      fields.sprint_id || "",
      JSON.stringify(fields),
    );
  } catch {
  }
}

function writeAtomic(filePath, body) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, filePath);
}

function copyC2(sprintId, status) {
  return (
    `Sprint \`${sprintId}\` is in state \`${status}\`. ` +
    "`/sprint:retrospective` requires the sprint to be `closed` or " +
    "`abandoned`. Finish `/sprint:release` first, or invoke " +
    `\`/sprint:retrospective\` against a different sprint via \`--sprint <SP-id>\`.\n`
  );
}
function copyC3(sprintId, pcPath) {
  return (
    `No Plan Contract found for sprint \`${sprintId}\`. The retro needs ` +
    `the Plan Contract to compare predictions vs reality. Expected at ` +
    `\`${pcPath || "<unknown>"}\`. Re-run \`/sprint:plan --sprint ${sprintId}\` ` +
    "to recreate it, or pass `--no-plan-contract` to write a retro without " +
    "the plan-quality section.\n"
  );
}
function copyC5(sprintId, retroPath) {
  return (
    `Retro already exists for \`${sprintId}\` at \`${retroPath}\`. ` +
    "Pass `--force` to overwrite, or `--review-only` to print the existing " +
    "retro without regenerating.\n"
  );
}
function copyC6(sprintId) {
  return (
    `Unknown sprint \`${sprintId}\`. Not found in active-sprints registry ` +
    "or sprint history. Run `/sprint:status` to list active sprints, " +
    "or check `paths.sprintHistory/` for archived ids.\n"
  );
}
function copyC4(sprintId, yamlPath, mdPath, fromStatus, mode, actionsN) {
  return (
    `Retrospective written for \`${sprintId}\`.\n` +
    `  YAML: \`${yamlPath}\`\n` +
    `  MD:   \`${mdPath}\`\n` +
    `Sprint status: ${fromStatus || "(unchanged)"} → retrospected.\n` +
    `Synthesis: \`${mode}\`. Action items: \`${actionsN}\`.\n` +
    `Next: review \`${mdPath}\` and amend any synthesized sections.\n`
  );
}
function copyC7(reason) {
  return (
    `Synthesis call failed: \`${reason}\`. Falling back to skeleton-only ` +
    "retro. Re-run with `--retry-synth` after fixing the upstream issue, " +
    "or fill the retro by hand.\n"
  );
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.synthesis && !args.noSynth && !args.reviewOnly) {
    process.stderr.write(
      "retrospective.js: no --synthesis <file> provided and --no-synth not set; " +
        "defaulting to skeleton mode. To get LLM-synthesized retro, invoke via " +
        "/sprint:retrospective skill OR generate synthesis JSON first.\n",
    );
  }

  if (args.reviewOnly && args.force) {
    process.stderr.write(
      "bad usage: --review-only and --force are mutually exclusive\n",
    );
    return 2;
  }

  const sprintId = resolveSprintId(args.sprint);
  if (!sprintId) {
    process.stderr.write(
      "bad usage: --sprint <SP-id> required (no primary in active-sprints registry)\n",
    );
    return 2;
  }

  if (!/^(?:SP-[0-9]{8}-[0-9]{3,4}|S-[A-Z0-9]+-[0-9]{2,3})$/.test(sprintId)) {
    process.stderr.write(`bad usage: malformed sprint id: ${sprintId}\n`);
    return 2;
  }

  const entry = sprintEntry(sprintId);
  const histDir = retroDir(sprintId);
  const historyExists = fs.existsSync(histDir);
  if (!entry && !historyExists) {
    process.stderr.write(copyC6(sprintId));
    return 1;
  }

  mcEnv.setEnv("SPRINT_ID", sprintId);

  if (args.reviewOnly) {
    const existing = readYamlMaybe(retroYamlPath(sprintId));
    if (!existing) {
      process.stderr.write(
        `no existing retro for ${sprintId} at ${retroYamlPath(sprintId)}\n`,
      );
      return 1;
    }
    process.stdout.write(yamlDump(existing, 0) + "\n");
    return 0;
  }

  if (fs.existsSync(retroYamlPath(sprintId)) && !args.force) {
    process.stderr.write(copyC5(sprintId, retroYamlPath(sprintId)));
    return 4;
  }

  if (args.retrySynth) {
    const existing = readYamlMaybe(retroYamlPath(sprintId));
    if (!existing || existing.synthesis_mode !== "skeleton") {
      process.stderr.write(
        `no skeleton retro to retry-synth on for ${sprintId}; ` +
          `use \`/sprint:retrospective --sprint ${sprintId}\` instead\n`,
      );
      return 1;
    }
    args.force = true;
  }

  let currentStatus = entry ? entry.status : null;
  if (
    entry &&
    !["closed", "abandoned", "retrospected"].includes(currentStatus)
  ) {
    emitEvent("retro_status_transition_blocked", {
      sprint_id: sprintId,
      current_status: currentStatus,
      attempted_by: args.signedOffBy,
    });
    process.stderr.write(copyC2(sprintId, currentStatus));
    return 3;
  }

  const perSprint = SPRINT.forSprint(sprintId);
  const sprintCurrent = readYamlMaybe(perSprint.current);

  const planContract = loadPlanContract(sprintCurrent);
  if (!planContract && !args.noPlanContract) {
    const expectedPath =
      sprintCurrent && sprintCurrent.plan_contract
        ? sprintCurrent.plan_contract
        : `${SPRINT.planContracts}/PC-?.yaml`;
    process.stderr.write(copyC3(sprintId, expectedPath));
    return 2;
  }

  const allTickets = loadAllTickets(sprintId);
  const issues = loadIssuesForSprint(sprintId);
  const decisions = loadDecisionsForSprint(sprintId);
  const checkpoints = loadCheckpointsForSprint(sprintId);
  const release = loadReleaseRecordForSprint(sprintId);
  const history = loadHistoryForSprint(sprintId);

  emitEvent("retro_started", {
    sprint_id: sprintId,
    mode: args.noSynth ? "skeleton" : "synth",
    triggered_by: args.signedOffBy,
    force: args.force,
    review_only: false,
  });

  let synthesis = null;
  let fallbackReason = null;
  if (args.synthesis) {
    try {
      const raw = fs.readFileSync(args.synthesis, "utf8");
      synthesis = JSON.parse(raw);
    } catch (err) {
      fallbackReason = `cannot load --synthesis: ${err.message}`;
      process.stderr.write(copyC7(fallbackReason));
      synthesis = null;
    }
  }

  const skeleton = buildSkeletonRetro({
    sprintId,
    planContract,
    release,
    history,
    allTickets,
    issues,
    decisions,
    signedOffBy: args.signedOffBy,
    force: args.force,
    fallbackReason,
  });

  let retro = skeleton;
  if (!args.noSynth && synthesis) {
    retro = mergeSynthesis(skeleton, synthesis);
  } else if (!args.noSynth && !synthesis && !args.synthesis) {
    retro.synthesis_mode = "skeleton";
  } else if (args.noSynth) {
    retro.synthesis_mode = "skeleton";
  }

  emitEvent("retro_synthesized", {
    sprint_id: sprintId,
    synthesis_status: synthesis
      ? "ok"
      : fallbackReason
        ? "failed_falling_back_to_skeleton"
        : "skipped_no_synth_flag",
    model: (synthesis && synthesis.synthesis_metadata?.model_id) || "",
    duration_ms: synthesis?.synthesis_metadata?.duration_ms || 0,
    output_chars: JSON.stringify(synthesis || {}).length,
  });

  const v = validateRetro(retro);
  if (!v.ok) {
    ensureDir(retroDir(sprintId));
    const partial = retroYamlPath(sprintId) + ".partial";
    fs.writeFileSync(partial, renderYaml(retro), "utf8");
    process.stderr.write(
      `retro failed schema validation (${v.errors.length} error(s)):\n`,
    );
    for (const e of v.errors) process.stderr.write(`  ${e}\n`);
    process.stderr.write(`partial retro at: ${partial}\n`);
    return 1;
  }

  const yamlBody = renderYaml(retro);
  const mdBody = renderMd(retro, sprintCurrent && sprintCurrent.title);
  writeAtomic(retroYamlPath(sprintId), yamlBody);
  writeAtomic(retroMdPath(sprintId), mdBody);

  const flip = flipStatusToRetrospected(sprintId);

  try {
    const ledger = require("./ledger");
    const closedAt =
      retro.signed_off_at || retro.completed_at || new Date().toISOString();
    const lr = ledger.updateSprintRow({
      id: sprintId,
      status: "retrospected",
      closedAt,
    });
    if (lr.written) {
      process.stdout.write(
        `roadmap: ROADMAP.md row updated ${sprintId} → retrospected\n`,
      );
    } else if (lr.reason !== "already-present") {
      process.stderr.write(`roadmap: skipped (${lr.reason})\n`);
    }
  } catch (err) {
    process.stderr.write(`roadmap: skipped (${err.message})\n`);
  }

  emitEvent("retro_signed_off", {
    sprint_id: sprintId,
    plan_contract_id: retro.plan_contract_id || "",
    retro_path: retroYamlPath(sprintId),
    action_items_count: (retro.action_items || []).length,
    friction_points_count: (retro.friction_points || []).length,
    status_transition_from: flip.from,
    status_transition_to: flip.to,
    signed_off_by: retro.signed_off_by,
    signed_off_at: retro.signed_off_at,
  });

  try {
    const { execSync } = require("child_process");
    const checkpointScript = path.join(
      SPRINT.PROJECT,
      "scripts",
      "sprint",
      "checkpoint.js",
    );
    execSync(
      `node "${checkpointScript}" --sprint ${sprintId} ` +
        `--phase retrospective --command /sprint:retrospective ` +
        `--status completed ` +
        `--last-completed-step "retro_written" ` +
        `--next-action "review retro.md and amend synthesized sections" ` +
        `--resume-command "/sprint:retrospective --sprint ${sprintId} --review-only" ` +
        `--resume-notes "Retro written for ${sprintId}. Status flipped: ${flip.from} -> ${flip.to}." ` +
        `--safe-to-continue true`,
      { stdio: "ignore" },
    );
  } catch {
  }

  process.stdout.write(
    copyC4(
      sprintId,
      retroYamlPath(sprintId),
      retroMdPath(sprintId),
      flip.from || (entry && entry.status) || "(no registry entry)",
      retro.synthesis_mode,
      (retro.action_items || []).length,
    ),
  );
  try {
    const { recordTrace } = require("./routing");
    const result = recordTrace({
      phase: "retrospective",
      artifact_id: `retro:${sprintId}`,
      artifact_path: retroYamlPath(sprintId),
      sprint: sprintId,
      model: mcEnv.readEnv("RECORDING_MODEL") || "claude:claude-opus-4-8",
      recorded_by: "/sprint:retrospective",
      allow_single_vendor: true,
      auto_override: true,
      notes: `synthesis_mode=${retro.synthesis_mode}`,
    });
    if (!result.ok) {
      process.stderr.write(`routing-trace: ${result.message}\n`);
    }
  } catch (err) {
    process.stderr.write(`routing-trace: skipped (${err.message})\n`);
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  buildSkeletonRetro,
  mergeSynthesis,
  renderYaml,
  renderMd,
  validateRetro,
  flipStatusToRetrospected,
};
