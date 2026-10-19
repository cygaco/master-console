"use strict";

const { detectRepoState } = require("../lib/detect");
const { recommendStack } = require("../lib/profiles");
const { GATES } = require("../lib/approval-gates");
const audit = require("./audit");

module.exports = {
  name: "execute",
  async run(ctx) {
    const state = detectRepoState(ctx.repoRoot);
    const rec = recommendStack(ctx.profile, state);
    const mods = audit.loadModules();
    const gates = Array.from(new Set(mods.flatMap((m) => m.plan(state, rec.profile).gates || [])));
    const gateDetail = GATES.filter((g) => gates.includes(g.id)).map((g) => `   - ${g.action} (${g.requires})`);
    const prompt = [
      "Execute / dispatch the last-mile implementation sprints:",
      "1) Run /sprint:execute for each minted sprint that is SAFE (reversible, no human-approval gate).",
      "2) HALT and recommend (never self-authorize) at each human-approval gate present in this product:",
      ...(gateDetail.length ? gateDetail : ["   - (none surfaced)"]),
      "3) Repair loops: if a readiness check fails, mint a targeted fix sprint rather than papering over it.",
      "4) Use diff-model review (/redteam:full, /research:*) for monetization, security, launch-readiness, and compliance.",
    ].join("\n");
    return {
      ok: false,
      status: "needs_orchestration",
      message: "implementation dispatch is an LLM-orchestrated step",
      orchestration_prompt: prompt,
      data: { gates },
    };
  },
};
