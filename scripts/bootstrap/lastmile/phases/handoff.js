"use strict";

const { detectRepoState } = require("../lib/detect");
const { scoreReadiness } = require("../lib/score");
const { recommendStack } = require("../lib/profiles");
const { GATES } = require("../lib/approval-gates");
const audit = require("./audit");
const render = require("../lib/render");

module.exports = {
  name: "handoff",
  async run(ctx) {
    const state = detectRepoState(ctx.repoRoot);
    const score = scoreReadiness(state);
    const rec = recommendStack(ctx.profile, state);
    const mods = audit.loadModules();
    const gates = Array.from(new Set(mods.flatMap((m) => m.plan(state, rec.profile).gates || [])));
    const gateList =
      GATES.filter((g) => gates.includes(g.id))
        .map((g) => `- **${g.action}** — ${g.requires}`)
        .join("\n") || "- (none surfaced yet)";
    const body = [
      `## Launch-Readiness: ${score.composite}/100 — profile "${rec.profile}"`,
      score.sensitiveEscalation ? `\n> ⚠ SENSITIVE DATA — legal/security review required before launch.\n` : "",
      `\n### Pending human-approval gates (operator must clear)\n\n${gateList}`,
      `\n### Top gaps\n\n${score.gaps.slice(0, 10).map((g) => `- ${g.dim}: ${g.gap}`).join("\n") || "- none"}`,
      `\n### Artifacts\n\nSee \`_docs/last-mile/\` (gap-report, launch-plan, monetization-plan, conversion-funnel, security-privacy-checklist, platform-deployment-plan, analytics-event-plan) plus the injected ROADMAP/sprint entries.`,
      `\n### How to continue\n\n- \`/bootstrap:lastmile --resume\` — continue the pipeline.\n- \`/bootstrap:lastmile --phase audit\` — recompute the score after changes.\n- \`/bootstrap:lastmile --phase execute\` — dispatch the implementation sprints.`,
    ]
      .filter(Boolean)
      .join("\n");
    const content = render.fillTemplate("last-mile-handoff", {
      title: "Last-Mile Handoff",
      generated_at: render.nowIso(),
      summary: `Launch-readiness ${score.composite}/100; ${gates.length} approval gate(s) pending.`,
      body,
    });
    const f = render.writeAt(ctx, "last-mile-handoff.md", content);
    ctx.log(`handoff written: ${f || "(dry-run)"}`);
    return { ok: true, status: "done", message: "handoff complete", data: { composite: score.composite, gates, handoff: f } };
  },
};
