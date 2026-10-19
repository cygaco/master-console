"use strict";

const { detectRepoState } = require("../lib/detect");
const { scoreReadiness } = require("../lib/score");
const { recommendStack } = require("../lib/profiles");
const render = require("../lib/render");

const MODULE_NAMES = ["database", "auth", "payments", "crm", "website", "deployment", "security", "analytics"];

function loadModules() {
  return MODULE_NAMES.map((n) => require(`../modules/${n}`));
}

function composeBody(data, rec) {
  const dimRows = Object.entries(data.dimensions)
    .map(([d, v]) => `| ${d} | ${v}/100 |`)
    .join("\n");
  const detRows = data.detections
    .map((m) => `| ${m.title} | ${m.status} | ${(m.evidence || []).join("; ") || "—"} |`)
    .join("\n");
  const gapLines = data.gaps.length
    ? data.gaps.map((g) => `- **${g.dim}** — ${g.gap}`).join("\n")
    : "- (no gaps detected — verify manually)";
  const checklist = data.foundersChecklist;
  const checklistLines = !checklist || !checklist.present
    ? "- FOUNDERS_CHECKLIST.md missing"
    : [
        `- Checklist state: ${checklist.completed}/${checklist.total} complete`,
        ...(checklist.open || []).map((item) => `- [ ] ${item.id} - ${item.label}`),
      ].join("\n");
  const parts = [
    `## Launch-Readiness Score: ${data.composite}/100`,
    data.escalate
      ? `\n> ⚠ **SENSITIVE DATA DETECTED** (${data.detections.find((d) => d.name === "security")?.signals?.join(", ") || "sensitive"}). Legal/security escalation is REQUIRED before any launch-readiness claim.\n`
      : "",
    `\n### Dimensions\n\n| Dimension | Score |\n|---|---|\n${dimRows}`,
    `\n### Module readiness\n\n| Module | Status | Evidence |\n|---|---|---|\n${detRows}`,
    `\n### Gaps — shortest safe path to a paid/public launch\n\n${gapLines}`,
    `\n### Founders checklist\n\n${checklistLines}`,
    rec.assumptions && rec.assumptions.length
      ? `\n### Assumptions\n\n${rec.assumptions.map((a) => `- ${a}`).join("\n")}`
      : "",
  ];
  return parts.filter(Boolean).join("\n");
}

module.exports = {
  name: "audit",
  loadModules,
  async run(ctx) {
    const state = detectRepoState(ctx.repoRoot);
    const score = scoreReadiness(state);
    const rec = recommendStack(ctx.profile, state);
    const mods = loadModules();
    const detections = mods.map((m) => ({ name: m.name, title: m.title, ...m.detect(state) }));
    const data = {
      profile: rec.profile,
      composite: score.composite,
      dimensions: score.dimensions,
      gaps: score.gaps,
      escalate: score.sensitiveEscalation,
      detections,
      assumptions: rec.assumptions,
      foundersChecklist: state.foundersChecklist,
    };
    const content = render.fillTemplate("gap-report", {
      title: "Last-Mile Gap Report",
      generated_at: render.nowIso(),
      summary: `Profile "${rec.profile}". Launch-readiness ${score.composite}/100${score.sensitiveEscalation ? " — SENSITIVE DATA escalation required" : ""}.`,
      body: composeBody(data, rec),
    });
    const gapReport = render.writeDoc(ctx, "gap-report", content);
    ctx.log(
      `launch-readiness composite=${score.composite}/100` +
        (score.sensitiveEscalation ? " (SENSITIVE — escalation required)" : ""),
    );
    return {
      ok: true,
      status: "done",
      message: `audit complete — score ${score.composite}/100, ${score.gaps.length} gap(s)`,
      data: { ...data, gapReport },
    };
  },
};
