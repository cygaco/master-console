# MC — Lexicon

Terms as we use them. Not industry definitions — ours.

---

**Convention** — A rule that exists only because everyone agrees to follow it. No mechanism prevents violation. Relies on discipline, not enforcement. Example: "events.jsonl is append-only" — true only because the logger calls appendFileSync, not because anything blocks a Write call.

**Enforcement** — A rule backed by a mechanism that actively prevents violation. The rule holds even when the actor doesn't know about it, disagrees with it, or is a rogue agent. Example: gate-check.js blocks builder agents from editing files outside their ownership scope — the hook rejects the tool call, not a comment in a doc.

**Applied** — A change that modifies existing behavior by integrating into the current structure. The change becomes part of the thing it touches. Cannot be reverted by removing a single block. Example: refactoring a component's state management — the new pattern replaces the old one throughout. Contrast with "appended."

**Appended** — A change that adds new content alongside existing content without modifying it. The change is additive and self-contained. Can be reverted by removing the added block. Example: adding a new entry to learnings.jsonl — removing the line reverts the change completely. Contrast with "applied."

**DECIDE** — Alex β's response when it can answer as the user would with >= 0.7 confidence. Alex α treats this as the user's answer and proceeds without asking the real user. Logged to `paths.betaEvents`.

**ESCALATE** — Alex β's response when a call crosses one of the three operator triggers (a new public surface, spend of $5 or more, an irreversible action; `paths.decisionPolicy` § Escalation red lines). Alex α asks the operator once, as a `⚠️ DECISION NEEDED` with one recommendation.

**Red Line** — A decision domain where Alex β must always ESCALATE regardless of confidence. Product UX, spec semantics, money, doctrine changes. These are domains where the user's taste cannot be modeled from patterns alone.

**Judgment Model** — The persona document (`judgement-model.md`) that encodes the user's decision patterns, principles, and delegation preferences. Not a personality simulation — a decision-pattern reference. Each principle has WHAT, WHY, GENERALIZE, and EXAMPLE.

**Precedent** — A prior Alex β decision logged in `paths.betaEvents`. When a new question matches a precedent's domain and context, Alex β should follow it unless material context differs. Precedent reduces drift and improves consistency.

**Calibration** — A correction from the user after Alex β made a wrong DECIDE. The correction updates the persona doc's Corrections Log and decreases confidence on that topic. Three corrections on the same topic moves it to Anti-Patterns.

**Goal language** — When the user frames intent as an outcome ("new users should finish setup in one sitting") rather than a directive ("put setup on a single page"). Goals reveal the WHY behind decisions. Alex β should recognize goal-framing, translate goals into concrete actions, and log the goal as evidence for the underlying principle. Contrast with directive language ("do X").

**Directive language** — When the user specifies an exact action ("put setup on a single page", "remove the sort menu"). Directives specify WHAT to do. When both a goal and a directive are present, validate that the directive serves the goal.

**DIRECTIVE** — Alex β's proactive command to Alex α. Unlike DECIDE (reactive answer), DIRECTIVE tells α what to do next without being asked. Includes an ACTION (what to do) and a TRIGGER (completion condition). Confidence threshold: 0.75+. Below that, use DECIDE or ESCALATE instead.

**Workstream** — One of two operational modes: `"team"` (α + β + γ active) or `"solo"` (α with γ protocol internalized). Only one workstream is active at a time. Stored in `store.heartbeat.workstream`. Cannot switch mid-cycle.

**Team Mode** — The workstream where α, β, and γ are all active. α creates specs, γ builds, β commands. User interacts only with α.

**Solo Mode** — The workstream where α internalizes γ's mechanical protocol and runs the entire build pipeline alone. No β or γ subagents spawned. α uses `heartbeat.agent: "boss"` for hook compatibility.

**Pseudoname** — Human-readable name for each agent: Alex Alpha (α), Alex Beta (β), Alex Gamma (γ). All interchangeable with the Greek-letter form.

**GAMMA_RESULT** — Structured result format γ returns to α after completing a scoped build task. Contains: scope, status, features completed/failed, gate checks, a human_report block, halt reason, and next recommendation.

**Context every turn** — The principle that every prompt receives enriched context automatically, without the user or agent having to request it. Implemented by `smart-context.js` (prompt pipeline hook), which injects relevant learnings, reasoning history, system state, and cross-session inbox into `additionalContext` on every turn. The agent never operates context-free — even cold starts get memory-informed context. Contrast with on-demand context, where agents must explicitly query for what they need.

---

## Skill Use

Vocabulary of the plain-language layer. See `CLAUDE.md#skill-use` for the agent-facing rule.

**Plain words** — Asking for what a skill does in your own words, without typing its slash command. The model starts the skill that fits with the Skill tool and takes its arguments from the message. Contrast with manual invocation, where the user types `/skill:name` explicitly (that always runs).

**Skill map** — The compact list of skills added once per session by `scripts/hooks/plain-session.js` (at most 2,000 tokens), built from the project's, the user's and enabled plugins' command and skill files. No phrase lists: routing reads each skill's name, description, `when_to_use` and `argument-hint`.

**Per-message line** — At most one short line `scripts/hooks/plain-prompt.js` adds to a message: the skill the user named without its slash, or up to three confident candidates. Otherwise nothing.

**Deny class ("~")** — A skill that deletes, deploys or spends, or whose frontmatter carries `confirm-first`, `ask-first` or `disable-model-invocation` (one word list and one flag list, in `scripts/hooks/lib/plain/risk.js`). Routing never offers one; the model gives the person the command to type. The Skill-tool guard, `scripts/hooks/plain-guard.js`, refuses a model-started one and stays on when routing is off.

**Miss log** — The local log in `paths.plainState` of what routing suggested for a message against the skill that actually ran. A skill that ran without being suggested is a miss; the message becomes a learned phrase for that skill. `/plain` reports the per-message line figures from it.
