"use strict";

const { detectRepoState } = require("../lib/detect");
const { recommendStack } = require("../lib/profiles");
const render = require("../lib/render");
const { loadModules, MODULE_NAMES } = (() => {
  const a = require("./audit");
  return { loadModules: a.loadModules, MODULE_NAMES: undefined };
})();

const ARTIFACT_BY_MODULE = {
  payments: "monetization-plan",
  website: "conversion-funnel",
  security: "security-privacy-checklist",
  deployment: "platform-deployment-plan",
  analytics: "analytics-event-plan",
};

function moduleSection(title, p) {
  const list = (arr) => (arr && arr.length ? arr.map((s) => `- ${s}`).join("\n") : "- (none)");
  return [
    `### ${title}`,
    `\n${p.summary}`,
    `\n**Steps**\n${list(p.steps)}`,
    p.envVars && p.envVars.length ? `\n**Env vars**: ${p.envVars.join(", ")}` : "",
    p.gates && p.gates.length ? `\n**Approval gates**: ${p.gates.join(", ")}` : "",
    p.tests && p.tests.length ? `\n**Tests**\n${list(p.tests)}` : "",
    p.risks && p.risks.length ? `\n**Risks**\n${list(p.risks)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function stackDriftSection(events) {
  if (!events || !events.length) return "";
  const rows = events
    .map(
      (e) =>
        `- \`stack_drift\`: layer=${e.layer}; declared=${e.declared}; detected=${e.detected}; severity=${e.severity}; action=${e.action}`,
    )
    .join("\n");
  return `\n## Stack Drift Events\n\n${rows}`;
}

module.exports = {
  name: "plan",
  ARTIFACT_BY_MODULE,
  async run(ctx) {
    const state = detectRepoState(ctx.repoRoot);
    const rec = recommendStack(ctx.profile, state);
    let mods = loadModules();
    if (ctx.module) mods = mods.filter((m) => m.name === ctx.module);
    if (!mods.length) return { ok: false, status: "failed", message: `unknown --module "${ctx.module}"` };

    const plans = mods.map((m) => ({ name: m.name, title: m.title, plan: m.plan(state, rec.profile) }));
    const gates = Array.from(new Set(plans.flatMap((p) => p.plan.gates || [])));
    const artifacts = [];

    for (const { name, title, plan } of plans) {
      const basename = ARTIFACT_BY_MODULE[name];
      if (!basename) continue;
      const content = render.fillTemplate(basename, {
        title,
        generated_at: render.nowIso(),
        summary: plan.summary,
        body: moduleSection(title, plan),
      });
      const f = render.writeDoc(ctx, basename, content);
      if (f) artifacts.push(f);
    }

    const launchBody = [
      `## Launch Plan — profile "${rec.profile}"`,
      `\n${rec.rationale}`,
      `\n**Recommended stack**: ` +
        Object.entries(rec.stack)
          .map(([k, v]) => `${k}=${v}`)
          .join(", "),
      rec.declaredStack && rec.declaredStack.length
        ? `\n**Declared stack source**: ${rec.declaredStack.join(", ")}`
        : "",
      gates.length ? `\n**Human-approval gates before launch**: ${gates.join(", ")}` : "",
      stackDriftSection(rec.stackDrift),
      `\n## Modules\n`,
      ...plans.map((p) => moduleSection(p.title, p.plan)),
      `\n## Do not overbuild\n\nShortest *safe* path to a paid launch wins. Anything beyond the gaps above is deferred unless a named, evidence-backed need justifies it.`,
    ]
      .filter(Boolean)
      .join("\n");
    const launchContent = render.fillTemplate("launch-plan", {
      title: "Last-Mile Launch Plan",
      generated_at: render.nowIso(),
      summary: `Profile "${rec.profile}"; ${plans.length} module(s); ${gates.length} approval gate(s).`,
      body: launchBody,
    });
    const launchPlan = render.writeDoc(ctx, "launch-plan", launchContent);
    if (launchPlan) artifacts.push(launchPlan);

    ctx.log(`plan complete — ${plans.length} module(s), ${gates.length} gate(s), ${artifacts.length} artifact(s)`);
    return {
      ok: true,
      status: "done",
      message: `plan complete — ${artifacts.length} artifact(s)`,
      data: { profile: rec.profile, stack: rec.stack, declared_stack: rec.declaredStack || [], stack_drift: rec.stackDrift || [], gates, modules: plans.map((p) => p.name), artifacts },
    };
  },
};
