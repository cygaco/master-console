"use strict";

const { detectRepoState } = require("../lib/detect");
const { scoreReadiness } = require("../lib/score");

module.exports = {
  name: "inject",
  async run(ctx) {
    const state = detectRepoState(ctx.repoRoot);
    const score = scoreReadiness(state);
    const topGaps = score.gaps.slice(0, 8).map((g) => `${g.dim}: ${g.gap}`);
    const prompt = [
      "Inject last-mile work into the roadmap/sprint system:",
      "1) For each gap area, mint a sprint via /sprint:plan (one coherent unit per module) with acceptance criteria carrying verified_by, a QA plan, and a launch checklist.",
      "2) Add ROADMAP entries via /roadmap:add (Sprints ledger row + the milestone they feed; respect /scan:roadmap-trace).",
      "3) Gaps to convert into sprints:",
      ...topGaps.map((g) => `   - ${g}`),
      score.sensitiveEscalation
        ? "4) SENSITIVE DATA: gate the security/privacy sprint behind a legal/security review before any launch-readiness claim."
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      status: "needs_orchestration",
      message: "roadmap/sprint injection is an LLM-orchestrated step",
      orchestration_prompt: prompt,
      data: { gaps: topGaps, escalate: score.sensitiveEscalation },
    };
  },
};
