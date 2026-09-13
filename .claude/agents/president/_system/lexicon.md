# MC — Lexicon

Terms as we use them. Not industry definitions — ours.

---

**Convention** — A rule that exists only because everyone agrees to follow it. No mechanism prevents violation. Relies on discipline, not enforcement. Example: "events.jsonl is append-only" — true only because the logger calls appendFileSync, not because anything blocks a Write call.

**Enforcement** — A rule backed by a mechanism that actively prevents violation. The rule holds even when the actor doesn't know about it, disagrees with it, or is a rogue agent. Example: gate-check.js blocks builder agents from editing files outside their ownership scope — the hook rejects the tool call, not a comment in a doc.

**Applied** — A change that modifies existing behavior by integrating into the current structure. The change becomes part of the thing it touches. Cannot be reverted by removing a single block. Example: refactoring a component's state management — the new pattern replaces the old one throughout. Contrast with "appended."

**Appended** — A change that adds new content alongside existing content without modifying it. The change is additive and self-contained. Can be reverted by removing the added block. Example: adding a new entry to learnings.jsonl — removing the line reverts the change completely. Contrast with "applied."

**DECIDE** — Alex β's response when it can answer as the user would with >= 0.7 confidence. Alex α treats this as the user's answer and proceeds without asking the real user. Logged to `.system/beta/events.jsonl`.

**ESCALATE** — Alex β's response when it cannot confidently simulate the user's judgment. Alex α must ask the real user via AskUserQuestion, prefixed with "ESCALATE:" to pass the beta-gate hook. Escalation is cheap; wrong decisions are expensive.

**Red Line** — A decision domain where Alex β must always ESCALATE regardless of confidence. Product UX, spec semantics, money, doctrine changes. These are domains where the user's taste cannot be modeled from patterns alone.

**Judgment Model** — The persona document (`judgement-model.md`) that encodes the user's decision patterns, principles, and delegation preferences. Not a personality simulation — a decision-pattern reference. Each principle has WHAT, WHY, GENERALIZE, and EXAMPLE.

**Precedent** — A prior Alex β decision logged in `.system/beta/events.jsonl`. When a new question matches a precedent's domain and context, Alex β should follow it unless material context differs. Precedent reduces drift and improves consistency.

**Calibration** — A correction from the user after Alex β made a wrong DECIDE. The correction updates the persona doc's Corrections Log and decreases confidence on that topic. Three corrections on the same topic moves it to Anti-Patterns.

**Goal language** — When the user frames intent as an outcome ("users shouldn't feel overwhelmed") rather than a directive ("make it one screen"). Goals reveal the WHY behind decisions. Alex β should recognize goal-framing, translate goals into concrete actions, and log the goal as evidence for the underlying principle. Contrast with directive language ("do X").

**Directive language** — When the user specifies an exact action ("make it one screen", "kill category ranking"). Directives specify WHAT to do. When both a goal and a directive are present, validate that the directive serves the goal.

**DIRECTIVE** — Alex β's proactive command to Alex α. Unlike DECIDE (reactive answer), DIRECTIVE tells α what to do next without being asked. Includes an ACTION (what to do) and a TRIGGER (completion condition). Confidence threshold: 0.75+. Below that, use DECIDE or ESCALATE instead.

**Workstream** — One of two operational modes: `"team"` (α + β + γ active) or `"solo"` (α with γ protocol internalized). Only one workstream is active at a time. Stored in `store.heartbeat.workstream`. Cannot switch mid-cycle.

**Team Mode** — The workstream where α, β, and γ are all active. α creates specs, γ builds, β commands. User interacts only with α.

**Solo Mode** — The workstream where α internalizes γ's mechanical protocol and runs the entire build pipeline alone. No β or γ subagents spawned. α uses `heartbeat.agent: "boss"` for hook compatibility.

**Pseudoname** — Human-readable name for each agent: Alex Alpha (α), Alex Beta (β), Alex Gamma (γ). All interchangeable with the Greek-letter form.

**GAMMA_RESULT** — Structured result format γ returns to α after completing a scoped build task. Contains: scope, status, features completed/failed, gate checks, a human_report block, halt reason, and next recommendation.

**Context every turn** — The principle that every prompt receives enriched context automatically, without the user or agent having to request it. Implemented by `smart-context.js` (prompt pipeline hook), which injects relevant learnings, reasoning history, system state, and cross-session inbox into `additionalContext` on every turn. The agent never operates context-free — even cold starts get memory-informed context. Contrast with on-demand context, where agents must explicitly query for what they need.

---

## Skill Use

Vocabulary used by the Hybrid skill-use mechanism (SP-20260513-003, RT-002). See `CLAUDE.md#skill-use` for the agent-facing rule and `paths.skillCatalog` for the ranker input.

**Organic skill use** — Invoking a skill from `.claude/commands` based on prompt-matching alone, without the user typing the slash command. The signal can come from `SUGGESTED SKILLS:` in `additionalContext` (high-salience) or from the full catalog in the system-reminder (low-salience fallback). Contrast with manual invocation, where the user types `/skill:name` explicitly.

**Skill ranker** — The component inside `scripts/hooks/smart-context.js` that asks Haiku to rank the top-3 most relevant skills against the current prompt. Output is injected as `SUGGESTED SKILLS:` in `additionalContext`. Fail-open — a ranker timeout falls back to current behavior, never blocks the prompt. Gated by the `SKILL_RANKER_ENABLED` env flag so it ships dark by default; rolled out as `SKILL_RANKER_ENABLED=1` once baseline adherence has been measured.

**Skill catalog** — The compact JSON index at `paths.skillCatalog` generated by `scripts/generate-skill-catalog.js`. One entry per user-invocable skill under `paths.commands` with `{id, slug, description, tags, location}`. Auto-regenerated on Edit/Write of `.claude/commands/**` by `scripts/hooks/skill-catalog-regen.js`. Capped at `CATALOG_MAX_INPUT_TOKENS` (default 5000) so ranker input stays cheap; truncation policy is recency-then-alphabetical.

**Skill-suggested** — A skill that the ranker scored at or above the configured threshold and surfaced to the agent in this turn. Suggestion is not authorization; the agent still applies autonomy rules before invoking irreversible operations. Logged as one `skill-suggested-vs-invoked` event per surfaced skill with `phase: "suggested"`, `score`, and `rank`.

**Skill-invoked** — A slash-command-shaped tool call captured by `scripts/hooks/skill-invocation-tracker.js` on PreToolUse. Logged as a `skill-suggested-vs-invoked` event with `phase: "invoked"`, `turn_offset`, and `invocation_path` (one of `ranker`, `agent-tool`, `user-slash`). Pair these with the matching `skill-suggested` event via `prompt_hash` to compute adherence.

**Adherence rate** — The fraction of suggested skills that the agent actually invoked: `invoked ∩ suggested ÷ suggested`, computed over a rolling window (default 7 days) from the `skill-suggested-vs-invoked` event type. Adherence is filtered to `invocation_path: "ranker"` so manual slashes and unrelated agent-tool calls do not skew the rate. Drives `/scan:patterns` analysis and ranker tuning.
