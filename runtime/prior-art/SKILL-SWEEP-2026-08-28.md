# WarpOS Skill Sweep — prior art vs Anthropic & OpenAI, per skill and per capability family

**Compiled:** 2026-08-28 · **Revision:** v2 · **Repo:** `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS`
**Companion to:** `runtime/prior-art/PRIOR-ART-EVIDENCE-2026-08-28.md` (read that first — this document
inherits its frame and its honesty standard).
**Machine-readable:** `runtime/prior-art/skill-sweep.json` (schema `warpos.skill-sweep/2`)

> **v2 restructure (operator priority):** the **PRIMARY** comparison is against **Anthropic**
> (Claude Code / Claude API / claude.ai) and **OpenAI** (Codex CLI + cloud + app / ChatGPT / Agents
> SDK / Responses API). Google and the rest of the industry are a **secondary "also" axis**, kept
> because they change what is safe to say in public, but they no longer drive the headline verdict.
> Both axes are reported for all 35 families; v1's single blended verdict is gone.

---

## 0. What this is, and the frame it inherits

This sweep inventories **all 237 skill files** under `.claude/commands/**/*.md` (230 live + 7
deprecated aliases), dates each from git, clusters them into **35 capability families**, and asks per
family: *did Anthropic or OpenAI ship the equivalent **procedure** earlier?*

Four constraints apply unchanged, and stating them is what makes the surviving claims credible:

1. **This repo's history begins 2026-03-02.** Anything a vendor shipped before that is vendor-first.
2. **The substrate is vendor-first by construction.** A WarpOS skill *is* a Claude Code slash command
   / Agent Skill (2025-10-16). A WarpOS hook *is* a Claude Code hook (2025-06-30). A WarpOS agent spec
   *is* a Claude Code subagent (2025-07-24). No priority is claimed on any of it.
3. **45 of the 237 skills first land at `cd37d410` (2026-04-12)** — the origin-product extraction commit.
   They arrived fully formed, so they were built *earlier*, in a private repo, and those dates **are
   not provable here**. Honest label: *"≤2026-04-12, built earlier in the origin product, unprovable in this repo."*
4. **Git dates are author-supplied and the commits are unsigned.**

## 1. Verdict vocabulary

| Verdict | Meaning |
|---|---|
| **WARPOS-FIRST** | WarpOS landed the procedure before the closest Anthropic *or* OpenAI analog. Margin stated. |
| **VENDOR-FIRST** | Anthropic or OpenAI shipped it first. |
| **NO-VENDOR-ANALOG** | Neither vendor ships anything comparable. Uncontested on the primary axis — but usually **vacuous**, because the vendors never entered that category. The secondary column carries the real answer. |
| **INCONCLUSIVE** | A vendor analog exists but the date is unpinned, the job is materially different, or the family splits. |
| **N/A-COMPOSITE** | A WarpOS-internal composition over vendor primitives, with no external analog because no external system has the structure being checked. Not a priority claim. |

## 2. Headline

| PRIMARY (vs Anthropic + OpenAI) | Families | Skills | | *ALSO* (widest field) | Families | Skills |
|---|---|---|---|---|---|---|
| **VENDOR-FIRST** | 17 | 108 | | *THEY-WERE-FIRST* | 31 | 206 |
| **NO-VENDOR-ANALOG** | 9 | 66 | | *WARPOS-FIRST* | 2 | 11 |
| **INCONCLUSIVE** | 4 | 25 | | *INCONCLUSIVE* | 1 | 2 |
| **WARPOS-FIRST** | **4** | **20** | | *N/A-COMPOSITE* | 1 | 18 |
| **N/A-COMPOSITE** | 1 | 18 | | | | |
| **Total** | **35** | **237** | | **Total** | **35** | **237** |

### The four WarpOS-first families, in confidence order

1. **`cross-session-inbox`** (2 skills, 2026-04-12) — **+117 d vs Anthropic.** *New finding in this
   pass.* Anthropic shipped cross-session `SendMessage` / `ListAgents` on **2026-08-07**; Agent Teams
   messaging (2026-02-05) is *in*-session and dies with the team. OpenAI has no inter-session
   messaging at all. This is now the **cleanest** primary-axis claim in the sweep — cleaner than
   dreaming, because no vendor announcement precedes it and the margin is four months rather than
   three weeks.
2. **`sleep-dream`** (2 skills, 2026-04-12) — **+24 d vs Anthropic Dreaming** (2026-05-06), +4 d on
   the public pre-announcement tag `warpos@0.1.4` (2026-05-02), and the cycle had *run in production*
   twice (2026-04-22, 2026-04-25). OpenAI: no analog. The flagship — but see the pre-emption note below.
3. **`sprint-lifecycle`** (13 skills, keystone 2026-05-11) — **+17 d vs Claude Code Dynamic Workflows**
   (2026-05-28 announce / 2026-06-02 research preview), +71 d vs Codex multi-agent V2 (2026-07-21).
   Weakened by a real layer difference and by a contestable judgement call about the Agents SDK's
   `handoffs` primitive (2025-03-11) — read §4 before quoting it.
4. **`karpathy-autoresearch`** (3 skills, 2026-04-18) — **+18 d vs Anthropic Outcomes** (2026-05-06),
   on a loose analogy. Weakest of the four.

### What to actually say in public

- **Lead with `cross-session-inbox` and `sleep-dream`.** Both are clean on the primary axis.
- **Pre-empt the secondary axis yourself.** `sleep-dream` is **−356 d behind Letta** (sleep-time
  compute, 2025-04-21) and `karpathy` is ~20 months behind Sakana's AI Scientist (2024-08). An
  audience that finds those first discounts everything else.
- **Do not dress up the 9 NO-VENDOR-ANALOG families as wins.** Growth copy, roadmaps, admin panels,
  issue registers, architecture maps, product portfolios and idea→app on-ramps are categories
  Anthropic and OpenAI simply never entered. "First" there is true and worthless, and each one has a
  4–19 year-old analog elsewhere (Jasper, Productboard, Retool, Sentry, dependency-cruiser,
  Backstage, Lovable).
- **The two genuinely uncontested-on-both-axes families are `enforcement-debt` and `paths-registry`** —
  narrow, unglamorous, and the only places where nothing earlier was found anywhere.
- **86% of skills still inherit a not-first verdict** on the widest field. The defensible claim
  remains compositional.

---

## 3. Family summary — PRIMARY axis (Anthropic + OpenAI)

Sorted by primary verdict, then WarpOS first-landing. "Keystone" is the skill that best represents
the family's capability; family first-landing can be earlier via a peripheral member (see §5).

| Family | # | WarpOS keystone (date) | Anthropic analog | date | OpenAI analog | date | **PRIMARY** | Margin |
|---|---|---|---|---|---|---|---|---|
| **cross-session-inbox**<br><sub>Cross-session broadcast inbox between sessions of the same assistant</sub> | 2 | `/session:write`<br>**2026-04-12** | **Cross-session `SendMessage` and `ListAgents`** — messaging between separate Claude Code sessions | 2026-08-07 | *none found* — Codex threads are local to a workspace; 0.147.0 persistent conversation sections (2026-08-07) and the `codex agents` dashboard (2026-08-20) are session listing, not inter-session messaging | — | **WARPOS-FIRST** | +117 d vs Anthropic; uncontested vs OpenAI |
| **sleep-dream**<br><sub>Sleep / dream memory consolidation</sub> | 2 | `/sleep:deep`<br>**2026-04-12** | **Dreaming** — agent memory consolidation for Managed Agents, announced at Code with Claude SF | 2026-05-06 | *none found* — no memory-consolidation or idle-time-reorganization feature in Codex or ChatGPT | — | **WARPOS-FIRST** | +24 d vs Anthropic; uncontested vs OpenAI |
| **sprint-lifecycle**<br><sub>Registry-driven sprint lifecycle (plan→design→build→gauntlet→release→retro)</sub> | 13 | `/sprint:plan, /sprint:design, /sprint:execute, /sprint:release`<br>**2026-05-11** | **Dynamic Workflows** — `agent()` / `parallel()` / `pipeline()` deterministic JS orchestration, task-specific multi-agent harnesses | 2026-05-28 (announce) / 2026-06-02 (research preview) | **Multi-agent orchestration V2** (CLI 0.145.0); Agents SDK handoffs (2025-03-11) are agent delegation, not a lifecycle | 2026-07-21 | **WARPOS-FIRST** | +17 d vs Anthropic (conservative); +71 d vs OpenAI |
| **karpathy-autoresearch**<br><sub>Closed-loop optimization of the agent's own artifacts</sub> | 3 | `/karpathy:run`<br>**2026-04-18** | **Outcomes** / capability curves for Managed Agents (goal definition, not self-modifying artifact optimization) | 2026-05-06 | *none found* — no closed-loop agent-artifact optimization product | — | **WARPOS-FIRST** | +18 d vs Anthropic; uncontested vs OpenAI |
| **beta-judgment**<br><sub>Independent second-opinion judge (β) + mining its precedent</sub> | 3 | `/beta:mine`<br>**2026-04-12** | `/security-review`; `/code-review`; Agent Skills as review packages — review, not decision arbitration | 2025-08-06 / 2025-10-16 | Codex GA **review tools**; PR review | 2025-10-06 / 2026-04-16 | **INCONCLUSIVE** | — |
| **system-health-scans**<br><sub>Aggregate system health — run every scan, linters, environment readiness</sub> | 4 | `/scan:full`<br>**2026-04-16** | `/doctor` — installation and configuration diagnostic; `claude plugin eval` | 2025 (present since early Claude Code) / 2026 | *none found* — no aggregate project-health suite | — | **INCONCLUSIVE** | — |
| **model-routing-dispatch**<br><sub>Role→provider→model→effort routing + dispatch console</sub> | 8 | `/models:router`<br>**2026-06-01** | **Fallback model chains** (within-provider failover) + per-agent cost attribution | ~2026-06 — exact day still unconfirmed | **Multi-agent V2 with configurable subagent models** (CLI 0.145.0); explicit effort settings | 2026-07-21 | **INCONCLUSIVE** | Anthropic date unpinned (~2026-06 vs WarpOS 2026-06-01); WarpOS +50 d vs OpenAI |
| **admin-panels-cockpit**<br><sub>Founder admin-panel dev-harness + GUI cockpit panels</sub> | 10 | `/admin:preview`<br>**2026-06-13** | Desktop **multi-session workspace** with terminal + file editor; **Agent View** (running / blocked / finished sessions) | 2026-04-14 / 2026-05-11 | Codex app (macOS 2026-02-02, Windows 2026-03-04); `codex agents` interactive dashboard | 2026-02-02 / 2026-08-20 | **INCONCLUSIVE** | vendor cockpits predate /panel:* by 33–131 d; nothing on either side matches /admin:* |
| **docs-maps-discovery-reporting**<br><sub>System discovery, relationship maps, reference integrity, ELI5 reports</sub> | 18 | `/maps:all`<br>**2026-04-12** | *none found* — no architecture-map or reference-integrity generation feature | — | *none found* | — | **NO-VENDOR-ANALOG** | uncontested vs both vendors — but vacuously so |
| **enforcement-debt**<br><sub>Enforcement-debt ledger — every policy names its enforcer or logs the gap</sub> | 5 | `/enforcement:log`<br>**2026-04-12** | `claude plugin eval` evaluates PLUGINS, not unenforced policy — closest surface, wrong object | 2026 (undated in the changelog) | *none found* | — | **NO-VENDOR-ANALOG** | uncontested vs both vendors |
| **issue-register**<br><sub>Recurring system-issue register + cross-run pattern intelligence</sub> | 6 | `/issues:log`<br>**2026-04-12** | *none found* — no recurring-issue register in Claude Code | — | *none found* | — | **NO-VENDOR-ANALOG** | uncontested vs both vendors — but vacuously so |
| **ui-design-review**<br><sub>Design-system compliance review of rendered UI</sub> | 2 | `/ui:review`<br>**2026-04-15** | *none found* as a first-party feature — browser-driven visual review is a community pattern over Playwright MCP | — | *none found* — Codex app **artifact previews** (2026-04-16) render output, they do not audit design-system compliance | — | **NO-VENDOR-ANALOG** | uncontested vs both vendors — but vacuously so |
| **growth-marketing**<br><sub>Growth + marketing content: angles, message brief, advertorial, landing page, ad images/video, LinkedIn/Contra posts</sub> | 10 | `/growth:message-brief`<br>**2026-05-01** | *none found* — no marketing-copy or ad-creative product surface | — | *none found* as a product feature (general-purpose ChatGPT/DALL·E generation is not a marketing workflow) | — | **NO-VENDOR-ANALOG** | uncontested vs both vendors — but vacuously so |
| **paths-registry**<br><sub>Centralized path registry — source→generated, guard hook, rename/convert tooling</sub> | 6 | `/paths:doctor`<br>**2026-05-01** | *none found* | — | *none found* | — | **NO-VENDOR-ANALOG** | uncontested vs both vendors |
| **roadmap**<br><sub>Roadmap create/prioritize/predict-next with a product-persona lens</sub> | 8 | `/roadmap:create`<br>**2026-05-19** | *none found* — no roadmap/prioritization product surface | — | *none found* | — | **NO-VENDOR-ANALOG** | uncontested vs both vendors — but vacuously so |
| **portfolio-multiproduct**<br><sub>Operating N product repos from one framework (register/list/open/run/sync/status/spinup)</sub> | 8 | `/portfolio:new`<br>**2026-05-22** | *none found* — Agent View (2026-05-11) lists SESSIONS, not products; multi-session workspace (2026-04-14) is one repo | — | *none found* — `codex agents` dashboard (2026-08-20) is agent listing, not a product registry | — | **NO-VENDOR-ANALOG** | uncontested vs both vendors — but vacuously so |
| **bootstrap-onramp**<br><sub>Idea → on-screen → monetizable (spinup, lastmile)</sub> | 3 | `/bootstrap:spinup`<br>**2026-05-25** | *none found* — Claude Code builds apps; it ships no idea→on-screen→monetizable on-ramp procedure | — | *none found* — same | — | **NO-VENDOR-ANALOG** | uncontested vs both vendors — but vacuously so |
| **warpos-distribution-integrity**<br><sub>WarpOS ship/install/capsule/migration integrity scans</sub> | 18 | `/scan:warpos-manifest-honesty`<br>**2026-05-04** | n/a — these assert properties of WarpOS's own four-layer distribution | — | n/a | — | **N/A-COMPOSITE** | — |
| **warp-distribution**<br><sub>Framework distribution: setup/update/release/uninstall/doctor/flag/reconcile</sub> | 20 | `/warp:update`<br>**2026-03-19** | **Plugins & marketplaces** — formal distribution system for commands, agents, hooks and skills | 2025-10-31 | Codex **Plugins** (installable bundles of Skills + integrations); **Agent Plugins publishing and marketplaces** (CLI 0.146.0) | 2026-03-25 / 2026-07-29 | **VENDOR-FIRST** | −139 d (Anthropic plugins); WarpOS beat Codex plugins by 6 d |
| **reasoning-frameworks**<br><sub>Classify-then-solve reasoning + graded fix quality</sub> | 6 | `/reasoning:run`<br>**2026-04-12** | **Extended thinking** with a configurable thinking budget; Plan Mode subagent | 2025-02-24 / 2025-10-27 | GPT-5 `reasoning_effort`; o-series reasoning models | 2025-08-07 | **VENDOR-FIRST** | ~−14 mo (Anthropic) |
| **commit-land**<br><sub>Commit / push / land (merge to default branch)</sub> | 4 | `/commit:land`<br>**2026-04-12** | Claude Code has edited files, run commands and used Git since the research preview | 2025-02-24 | Codex CLI reads, modifies and executes code in a project directory with git integration | 2025-04-16 | **VENDOR-FIRST** | ~−13.5 mo (Anthropic) |
| **skills-meta**<br><sub>Skills about skills — create/edit/delete/cleanup, author-with-eval-pack, coverage self-inventory</sub> | 9 | `/skills:create`<br>**2026-04-12** | Custom slash commands (2025); **Agent Skills** (`SKILL.md`), open-standard 2025-12-18; `/skill-doctor`; `claude plugin eval` | 2025-10-16 | **Codex Agent Skills** — reusable instruction packages for CLI and IDE; custom prompts (markdown → slash commands, undated, now deprecated in favour of Skills) | 2025-12-19 | **VENDOR-FIRST** | −178 d (Anthropic Agent Skills) |
| **memory-learning**<br><sub>Memory stores + scored learnings lifecycle</sub> | 7 | `/learn:deep`<br>**2026-04-12** | **memory tool + context editing** (API/Bedrock/Vertex); **Auto Memory / MEMORY.md** in Claude Code | 2025-09-29 / 2026-02-26 | Codex **project memories** (CLI 0.145.0); Codex app **memories** | 2026-07-21 / 2026-04-16 | **VENDOR-FIRST** | −45 d (Anthropic auto memory) — Anthropic settles it; WarpOS was ~100 d ahead of OpenAI |
| **hooks-mgmt**<br><sub>Hook authoring, disable/enable, test, friction measurement</sub> | 5 | `/hooks:add`<br>**2026-04-12** | **Hooks** — event-driven control around actions (v1.0.38) | 2025-06-30 | Codex **async hooks** (CLI 0.145.0); the Codex hooks doc page carries no release date | 2026-07-21 | **VENDOR-FIRST** | −287 d (Anthropic hooks) |
| **modes-teams**<br><sub>Build modes + named agent faces / teams</sub> | 6 | `/mode:adhoc`<br>**2026-04-12** | **Agent Teams** (research preview, with Opus 4.6) — coordinating multiple independent sessions | 2026-02-05 | Codex **subagents** (explorer / worker / default, up to six concurrent); **multi-agent V2** with configurable subagent models | 2026-03-16 / 2026-07-21 | **VENDOR-FIRST** | −66 d (Anthropic Agent Teams) |
| **oneshot-build**<br><sub>Standalone autonomous skeleton build (preflight→run→retro)</sub> | 4 | `/oneshot:start`<br>**2026-04-12** | **GitHub Actions for background tasks** at Claude Code GA | 2025-05-22 | **Codex Cloud** research preview — hosted agent runs each task in a remote container | 2025-05-16 | **VENDOR-FIRST** | ~−11 mo (both vendors, within a week of each other) |
| **qa-redteam-security**<br><sub>QA persona audits, red-team personas, privacy/secrets/ingest-firewall scans</sub> | 8 | `/redteam:full`<br>**2026-04-15** | **`/security-review`** slash command + GitHub Action; **Claude Code Security** limited research preview | 2025-08-06 / 2026-02-20 | Codex GA **review tools**; **Codex Security** research preview | 2025-10-06 / 2026-03-06 | **VENDOR-FIRST** | −252 d (Anthropic /security-review) |
| **research**<br><sub>Deep research — multi-round, multi-provider</sub> | 2 | `/research:deep`<br>**2026-04-12** | **Research** — multi-agent research system (orchestrator + parallel subagent searchers) | 2025-04 | **Deep research** in ChatGPT (and later the deep-research API models WarpOS actually calls) | 2025-02-02 | **VENDOR-FIRST** | ~−14 mo (OpenAI deep research) |
| **session-state-handoff**<br><sub>Session checkpoint, resume, handoff, prescriptive DUMP</sub> | 8 | `/session:handoff`<br>**2026-04-12** | **Checkpoints + `/rewind`** (Claude Code v2.0); Desktop **session handoff** | 2025-09-29 / 2026-02-20 | Codex CLI 0.145.0 **paginated thread history**; 0.146.0 **session names + thread pinning** | 2026-07-21 / 2026-07-29 | **VENDOR-FIRST** | ~−6.5 mo (Anthropic checkpoints/rewind) |
| **agent-roster**<br><sub>Agent-spec roster, smoke-dispatch, role-parity enforcement</sub> | 5 | `/agents:list`<br>**2026-05-04** | **Custom Subagents** via `/agents` | 2025-07-24 | Codex **subagents**; `codex agents` interactive dashboard (CLI 0.149.0) | 2026-03-16 / 2026-08-20 | **VENDOR-FIRST** | −284 d (Anthropic subagents) |
| **events-telemetry**<br><sub>Append-only event ledger + query/tail</sub> | 2 | `/events:query`<br>**2026-05-04** | *no first-party agent-trace ledger found* for Claude Code beyond OTel export | — | **Agents SDK built-in tracing** — traces and spans over agent runs | 2025-03-11 | **VENDOR-FIRST** | ~−14 mo (OpenAI Agents SDK tracing) |
| **permissions-turbo**<br><sub>Session-scoped permission pre-authorization + spend ceiling</sub> | 4 | `/session:turbo`<br>**2026-05-13** | **Auto mode** — classifier screens tool calls before execution (preview → GA) | 2026-03-24 → 2026-07-10 | Codex **approval modes** (CLI rebuild); **writes approval mode**; auto-approve after review | 2025-09-15 / 2026-07-09 / 2026-08-07 | **VENDOR-FIRST** | ~−8 mo (OpenAI approval modes); −50 d (Anthropic auto mode) |
| **guides-knowledge**<br><sub>Author guides / knowledge domains and WIRE them into named consumers</sub> | 6 | `/guides:integrate`<br>**2026-05-31** | `CLAUDE.md` + `@`-file imports as the static instruction layer; **Agent Skills** as the packaged delivery shape | 2025-02-24 / 2025-10-16 | `AGENTS.md` (shipped with Codex CLI, 32 KiB cap); **Codex Agent Skills** | 2025-04-16 / 2025-12-19 | **VENDOR-FIRST** | ~−15 mo (Anthropic CLAUDE.md/imports) |
| **enforced-trackers**<br><sub>Validator-enforced tracker system (34 sections, 20 checks, hook-gated)</sub> | 2 | `/trackers:validate`<br>**2026-06-05** | Agent Teams **shared task list**; `/goal` persistent completion conditions | 2026-02-05 / 2026-05-11 | *none found* — no validator-enforced project tracker | — | **VENDOR-FIRST** | −120 d (Anthropic) |
| **epic-tracking**<br><sub>Epic lifecycle — plan/start/fold/split/link/review/acceptance/close</sub> | 10 | `/epic:plan`<br>**2026-06-09** | Agent Teams **shared task list**; `/goal` — persistent completion conditions | 2026-02-05 / 2026-05-11 | *none found* — Codex ships task lists in-CLI (2025-09-15) but no epic/ticket lifecycle | 2025-09-15 | **VENDOR-FIRST** | −124 d (Anthropic shared task list) |

### 3.2 Family summary — SECONDARY axis (Google + any company, widest field)

Kept because it changes what is safe to say in public. Where PRIMARY and *ALSO* disagree, the *ALSO*
column is the one an adversarial reader will find first.

| Family | **PRIMARY** (Anthropic/OpenAI) | Closest Google / industry analog | Their date | *ALSO* (widest field) | Margin |
|---|---|---|---|---|---|
| **cross-session-inbox** | WARPOS-FIRST | **LangChain Agent Inbox** (human-in-the-loop UX for ambient agents) · **A2A protocol** (cross-vendor agent discovery) ([src](https://www.langchain.com/blog/introducing-ambient-agents)) | 2025-01-14 · 2025-04 | *INCONCLUSIVE* | — |
| **sleep-dream** | WARPOS-FIRST | **Letta — sleep-time compute** (background agent reorganizes another agent's memory during idle) ([src](https://www.letta.com/blog/sleep-time-compute/)) | 2025-04-21 | *THEY-WERE-FIRST* | −356 d vs Letta sleep-time compute (2025-04-21) |
| **sprint-lifecycle** | WARPOS-FIRST | **Google ADK workflow agents** (Sequential/Parallel/Loop) · **CrewAI Flows** · LangGraph ([src](https://google.github.io/adk-docs/agents/workflow-agents/)) | 2025-04 · 2024-mid · 2024 | *THEY-WERE-FIRST* | ~−14 mo |
| **karpathy-autoresearch** | WARPOS-FIRST | **Sakana AI Scientist** · **DeepMind AlphaEvolve** · **ShinkaEvolve** · DSPy optimizers ([src](https://arxiv.org/abs/2408.06292)) | 2024-08 · 2025-05 · 2025-09 · 2023-late | *THEY-WERE-FIRST* | ~−20 mo (but +18 d vs Anthropic only) |
| **beta-judgment** | INCONCLUSIVE | **LLM-as-a-judge** (MT-Bench et al.) · **Aider architect/editor** two-model split ([src](https://arxiv.org/abs/2306.05685)) | 2023 · 2024 | *THEY-WERE-FIRST* | ~−2 yr |
| **system-health-scans** | INCONCLUSIVE | **SonarQube** · **ESLint** · architecture **fitness functions** (Building Evolutionary Architectures) · **Danger.js** ([src](https://www.thoughtworks.com/insights/books/building-evolutionary-architectures)) | 2007 · 2013 · 2017 · 2016 | *THEY-WERE-FIRST* | ~−9 to −19 yr |
| **model-routing-dispatch** | INCONCLUSIVE | **OpenRouter** · **LiteLLM proxy** · Portkey ([src](https://openrouter.ai/)) | 2023 | *THEY-WERE-FIRST* | ~−3 yr |
| **admin-panels-cockpit** | INCONCLUSIVE | **Retool** · **Appsmith** (internal admin-panel builders) ([src](https://research.contrary.com/company/retool)) | 2017 · 2019-07-01 | *THEY-WERE-FIRST* | ~−7 yr |
| **docs-maps-discovery-reporting** | NO-VENDOR-ANALOG | **dependency-cruiser** · **ArchUnit** · **Structurizr/C4** · **SonarQube** · **Backstage** catalog ([src](https://github.com/sverweij/dependency-cruiser)) | 2016 · 2017 · 2016 · 2007 · 2020 | *THEY-WERE-FIRST* | ~−9 yr |
| **enforcement-debt** | NO-VENDOR-ANALOG | SonarQube tech-debt register · ADR logs · architecture fitness functions — none tracks POLICY WITHOUT AN ENFORCER ([src](https://www.sonarsource.com/)) | 2007 · 2017 | *WARPOS-FIRST* | uncontested — no analog found in any product |
| **issue-register** | NO-VENDOR-ANALOG | **Sentry** issue grouping + automatic regression state · AI Issue Grouping GA ([src](https://www.apmdigest.com/sentry-adds-new-features-issue-grouping-issue-summary-and-anomaly-detection)) | 2008 onward · 2025-02 | *THEY-WERE-FIRST* | ~−17 yr on the concept |
| **ui-design-review** | NO-VENDOR-ANALOG | **Applitools Eyes** · **Percy** · **Chromatic** (purpose-built for design-system consumer impact); Percy AI Visual Review Agent ([src](https://percy.io/blog/visual-regression-testing-tools)) | 2013 · 2016 · 2017 · 2025-late | *THEY-WERE-FIRST* | ~−9 yr |
| **growth-marketing** | NO-VENDOR-ANALOG | **Copy.ai** · **Jasper** (as Conversion.ai) · **AdCreative.ai** (ad images, later product video) ([src](https://research.contrary.com/company/jasper)) | 2020-07 · 2021-01 · 2021-11 | *THEY-WERE-FIRST* | ~−4.5 yr |
| **paths-registry** | NO-VENDOR-ANALOG | none found in any product (nearest genre: tsconfig path aliases, Bazel labels — neither is a generated single-source registry with a write-time literal guard) | — | *WARPOS-FIRST* | uncontested — no analog found |
| **roadmap** | NO-VENDOR-ANALOG | **Productboard** · **Jira Product Discovery** (GA) · Aha! ([src](https://techcrunch.com/2023/02/09/atlassians-jira-product-discovery-is-now-generally-available)) | 2014 · 2023-02-09 | *THEY-WERE-FIRST* | ~−3 yr |
| **portfolio-multiproduct** | NO-VENDOR-ANALOG | **Backstage** software templates + golden paths · **Nx** generators · **cruft**/**Copier** propagation ([src](https://backstage.io/docs/features/software-templates/)) | 2020-03 · 2020 · 2020 | *THEY-WERE-FIRST* | ~−6 yr on scaffolding + propagation |
| **bootstrap-onramp** | NO-VENDOR-ANALOG | **v0** (Vercel) · **Lovable** · **Replit Agent** · **Bolt.new** ([src](https://altar.io/lovable-vs-bolt-vs-v0-vs-replit-vs-base44/)) | 2023 · 2023 · 2024-09 · 2024-10 | *THEY-WERE-FIRST* | ~−1.5 yr |
| **warpos-distribution-integrity** | N/A-COMPOSITE | **cruft** / **Copier** template-drift detection · Terraform drift detection · Backstage catalog validation ([src](https://github.com/cruft/cruft)) | 2020 · 2016 | *N/A-COMPOSITE* | — |
| **warp-distribution** | VENDOR-FIRST | **Cookiecutter** · **Yeoman** · **Copier** / **cruft** (update an already-generated project from its template) ([src](https://www.cookiecutter.io/article-post/compare-cookiecutter-to-yeoman)) | 2013 · 2012 · 2020 | *THEY-WERE-FIRST* | −168 d vs plugins; ~−6 yr vs scaffolders |
| **reasoning-frameworks** | VENDOR-FIRST | Cynefin (1999) · 5 Whys / TRIZ · Gemini thinking budgets (2025-04-17) · GPT-5 reasoning_effort (2025-08-07) ([src](https://hbr.org/2007/11/a-leaders-framework-for-decision-making)) | 1999 onward | *THEY-WERE-FIRST* | ~−15 mo (model layer); decades (the frameworks themselves) |
| **commit-land** | VENDOR-FIRST | **aider** auto-commits with AI-generated messages · **aicommits** ([src](https://github.com/aider-ai/aider)) | 2023-04 · 2023 | *THEY-WERE-FIRST* | ~−1 yr |
| **skills-meta** | VENDOR-FIRST | **Cursor Rules** · **promptfoo** · **DSPy** · **LangSmith evals** · Anthropic **prompt improver** ([src](https://www.promptfoo.dev/)) | 2024 · 2023 · 2023-late · 2023 · 2024-11 | *THEY-WERE-FIRST* | ~−1 to −3 yr |
| **memory-learning** | VENDOR-FIRST | **MemGPT** (tiered agent memory) · **Cursor Memories** 1.0 · **Windsurf Wave 1 memories** ([src](https://research.contrary.com/company/letta)) | 2023-10 · 2025-06-04 · 2025-01 | *THEY-WERE-FIRST* | ~−2.5 yr |
| **hooks-mgmt** | VENDOR-FIRST | git hooks (1990s) · Husky/lint-staged · **Codex hooks** (near-copy of the Claude hook vocabulary; docs carry no date) ([src](https://learn.chatgpt.com/docs/hooks)) | decades | *THEY-WERE-FIRST* | −262 d |
| **modes-teams** | VENDOR-FIRST | **MetaGPT** ("first AI software company": PM/architect/engineer/QA roles) · AutoGen · CrewAI · LangGraph ([src](https://arxiv.org/abs/2308.00352)) | 2023-08 · 2023-09-25 · 2023-10 · 2024-01-08 | *THEY-WERE-FIRST* | ~−2.7 yr |
| **oneshot-build** | VENDOR-FIRST | **Devin** · **Cursor Background Agent** (0.50→GA 1.0) · GitHub Copilot coding agent ([src](https://www.cognition.ai/blog/introducing-devin)) | 2024-03-12 · 2025-05-15 · 2025-05 | *THEY-WERE-FIRST* | ~−2 yr |
| **qa-redteam-security** | VENDOR-FIRST | **garak** (NVIDIA) · **PyRIT** (Microsoft) · **promptfoo redteam** ([src](https://github.com/NVIDIA/garak)) | 2023-06-13 · 2024-02-22 · 2023 | *THEY-WERE-FIRST* | ~−2.8 yr |
| **research** | VENDOR-FIRST | **Gemini Deep Research** · **Perplexity Deep Research** ([src](https://blog.google/products/gemini/google-gemini-deep-research/)) | 2024-12-11 · 2025-02-14 | *THEY-WERE-FIRST* | ~−16 mo |
| **session-state-handoff** | VENDOR-FIRST | **Cline Memory Bank** · **Gemini CLI checkpointing** · Roo Code ([src](https://docs.cline.bot/prompting/cline-memory-bank)) | 2025-early · 2025-06 | *THEY-WERE-FIRST* | ~−10 mo |
| **agent-roster** | VENDOR-FIRST | CrewAI agent definitions · AutoGen agent configs ([src](https://github.com/crewAIInc/crewAI)) | 2023-10 | *THEY-WERE-FIRST* | ~−9 mo |
| **events-telemetry** | VENDOR-FIRST | **LangSmith** · **Langfuse** agent tracing ([src](https://www.langchain.com/langsmith)) | 2023 · 2024-07 | *THEY-WERE-FIRST* | ~−3 yr |
| **permissions-turbo** | VENDOR-FIRST | **OpenAI Agents SDK guardrails** · usage limits ([src](https://openai.com/index/new-tools-for-building-agents/)) | 2025-03-11 | *THEY-WERE-FIRST* | −50 d vs auto mode; ~−14 mo vs guardrails |
| **guides-knowledge** | VENDOR-FIRST | **Cursor @Docs** indexing · **Devin Knowledge** · **Backstage TechDocs** ([src](https://cursor.com/docs/agent/tools/search)) | 2024-late · 2024–25 · 2020 | *THEY-WERE-FIRST* | ~−1.5 yr on doc-into-agent-context |
| **enforced-trackers** | VENDOR-FIRST | **Linear** · **Jira** · **Danger.js** (PR-time policy assertions) ([src](https://danger.systems/js/)) | 2020-06 · 2002 · 2016 | *THEY-WERE-FIRST* | ~−6 yr |
| **epic-tracking** | VENDOR-FIRST | **Linear** (exited private beta) · **Jira** · Shortcut ([src](https://linear.app/)) | 2020-06 · 2002 · 2014 | *THEY-WERE-FIRST* | ~−6 yr |

---

## 4. Family detail — both axes, with the honest caveat

Grouped by PRIMARY verdict, then by WarpOS first-landing. Every vendor date carries a source link;
the consolidated date reference is §7.

### PRIMARY: WARPOS-FIRST

#### `cross-session-inbox` — Cross-session broadcast inbox between sessions of the same assistant

2 skills · keystone `/session:write` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/session:read`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Cross-session `SendMessage` and `ListAgents`** — messaging between separate Claude Code sessions ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2026-08-07 | WARPOS-FIRST | **+117 d** |
| **OpenAI** | *none found* — Codex threads are local to a workspace; 0.147.0 persistent conversation sections (2026-08-07) and the `codex agents` dashboard (2026-08-20) are session listing, not inter-session messaging ([src](https://www.scriptbyai.com/codex-timeline/)) | — | NO-ANALOG | — |
| *also — Google / any company* | **LangChain Agent Inbox** (human-in-the-loop UX for ambient agents) · **A2A protocol** (cross-vendor agent discovery) ([src](https://www.langchain.com/blog/introducing-ambient-agents)) | 2025-01-14 · 2025-04 | *INCONCLUSIVE* | — |

**PRIMARY VERDICT: WARPOS-FIRST** — +117 d vs Anthropic; uncontested vs OpenAI

NEW FINDING THIS PASS, and the cleanest non-dreaming primary. Agent Teams (2026-02-05) messaging is IN-session and dies with the team; Anthropic did not ship messaging BETWEEN sessions until 2026-08-07. WarpOS `/session:write` → `/session:read` is a durable file-backed board that the same operator's later sessions read, landed 2026-04-12. Honest caveats: (a) it is a file convention plus two skills, not a transport — Anthropic's is a real cross-process channel with liveness; (b) 2026-04-12 is the extraction commit, so the true date is earlier and unprovable; (c) the secondary axis is not clean — LangChain's Agent Inbox (2025-01-14) is earlier, though it is a HUMAN approval inbox rather than agent-to-agent.

*Secondary-axis note:* Different job in every direction. Agent Inbox is a HUMAN inbox for approving agent actions; A2A is inter-vendor RPC; Agent Teams messaging dies with the session. WarpOS /session:write → /session:read is a durable, file-backed board that the same assistant's LATER sessions read. Landed 2026-04-12 — after Agent Inbox, before Agent Teams messaging. No exact analog found; no priority claimed.

#### `sleep-dream` — Sleep / dream memory consolidation

2 skills · keystone `/sleep:deep` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/sleep:deep`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Dreaming** — agent memory consolidation for Managed Agents, announced at Code with Claude SF ([src](https://www.infoq.com/news/2026/05/code-with-claude/)) | 2026-05-06 | WARPOS-FIRST | +24 d (+4 d on the public tag warpos@0.1.4, 2026-05-02) |
| **OpenAI** | *none found* — no memory-consolidation or idle-time-reorganization feature in Codex or ChatGPT | — | NO-ANALOG | — |
| *also — Google / any company* | **Letta — sleep-time compute** (background agent reorganizes another agent's memory during idle) ([src](https://www.letta.com/blog/sleep-time-compute/)) | 2025-04-21 | *THEY-WERE-FIRST* | −356 d vs Letta sleep-time compute (2025-04-21) |

**PRIMARY VERDICT: WARPOS-FIRST** — +24 d vs Anthropic; uncontested vs OpenAI

The flagship. Corroborated by executed-run artifacts (scripts/sleep-20260422-*.js, one-off-sleep-2026-04-25.js) — the cycle RAN twice before the Anthropic announcement. Anthropic's is managed infrastructure emitting a reviewable diff; WarpOS's is a prompt-and-script procedure over a scored learnings.jsonl. Same problem, different layer. `/dream` was never changelogged (PRIOR-ART §2.3b).

*Secondary-axis note:* Vendor-scoped only. Reused verbatim from PRIOR-ART-EVIDENCE §2 / §6.1. Corroborated by executed-run artifacts scripts/sleep-20260422-*.js and one-off-sleep-2026-04-25.js — the cycle RAN before the Anthropic announcement.

#### `sprint-lifecycle` — Registry-driven sprint lifecycle (plan→design→build→gauntlet→release→retro)

13 skills · keystone `/sprint:plan, /sprint:design, /sprint:execute, /sprint:release` **2026-05-11** · family first-landing `bf438de7` 2026-04-16 (via `/scan:requirements`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Dynamic Workflows** — `agent()` / `parallel()` / `pipeline()` deterministic JS orchestration, task-specific multi-agent harnesses ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2026-05-28 (announce) / 2026-06-02 (research preview) | WARPOS-FIRST | +17 d (conservative, vs the announce date) / +22 d (vs research preview) |
| **OpenAI** | **Multi-agent orchestration V2** (CLI 0.145.0); Agents SDK handoffs (2025-03-11) are agent delegation, not a lifecycle ([src](https://www.scriptbyai.com/codex-timeline/)) | 2026-07-21 | WARPOS-FIRST | +71 d |
| *also — Google / any company* | **Google ADK workflow agents** (Sequential/Parallel/Loop) · **CrewAI Flows** · LangGraph ([src](https://google.github.io/adk-docs/agents/workflow-agents/)) | 2025-04 · 2024-mid · 2024 | *THEY-WERE-FIRST* | ~−14 mo |

**PRIMARY VERDICT: WARPOS-FIRST** — +17 d vs Anthropic (conservative); +71 d vs OpenAI

HONEST CAVEATS, and they are heavy. (a) Date basis: the `/sprint:*` keystone skills landed 2026-05-11; the family's earliest member (`/scan:requirements`) is 2026-04-16. (b) Different layer: Anthropic's is a JS orchestration API, WarpOS's is a markdown-skill lifecycle driven by a hook-point registry — same genre (declarative multi-agent workflow with phases and gates), different substrate. (c) The Agents SDK's handoffs primitive is 2025-03-11 and is arguably the real vendor ancestor, which would make this VENDOR-FIRST by 14 months; I judged handoffs to be agent delegation rather than a lifecycle, and that judgement is contestable. (d) The secondary axis kills it: Google ADK workflow agents, 2025-04. Do not lead with this one.

*Secondary-axis note:* Reused from PRIOR-ART §7.2 rows 7a–7c. Sub-note: the pre-committed release rule minted by an in-team judge BEFORE results exist is preregistration (arXiv:2606.11217 ports it to agents explicitly), and the mutant/falsifier gauntlet is mutation testing (concept 1971, mainstream via pitest) — both already named in PRIOR-ART §7.4 as taken.

#### `karpathy-autoresearch` — Closed-loop optimization of the agent's own artifacts

3 skills · keystone `/karpathy:run` **2026-04-18** · family first-landing `38d771bf` 2026-04-18 (via `/karpathy:integrate`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Outcomes** / capability curves for Managed Agents (goal definition, not self-modifying artifact optimization) ([src](https://www.infoq.com/news/2026/05/code-with-claude/)) | 2026-05-06 | WARPOS-FIRST | +18 d (loose analogy) |
| **OpenAI** | *none found* — no closed-loop agent-artifact optimization product | — | NO-ANALOG | — |
| *also — Google / any company* | **Sakana AI Scientist** · **DeepMind AlphaEvolve** · **ShinkaEvolve** · DSPy optimizers ([src](https://arxiv.org/abs/2408.06292)) | 2024-08 · 2025-05 · 2025-09 · 2023-late | *THEY-WERE-FIRST* | ~−20 mo (but +18 d vs Anthropic only) |

**PRIMARY VERDICT: WARPOS-FIRST** — +18 d vs Anthropic; uncontested vs OpenAI

Weakest of the four WarpOS-first primaries: Outcomes is goal-definition for managed agents, not optimization of an editable artifact against a scalar metric in an isolated worktree. Call it a loose analogy and say so. The secondary axis kills it outright (Sakana 2024-08).

*Secondary-axis note:* Reused from PRIOR-ART §3.1 / §6.11. Vendor-scoped it is WarpOS-first by 18 days; industry-scoped Sakana beats it by ~20 months.

### PRIMARY: INCONCLUSIVE

#### `beta-judgment` — Independent second-opinion judge (β) + mining its precedent

3 skills · keystone `/beta:mine` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/beta:mine`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | `/security-review`; `/code-review`; Agent Skills as review packages — review, not decision arbitration ([src](https://claude.com/blog/automate-security-reviews-with-claude-code)) | 2025-08-06 / 2025-10-16 | INCONCLUSIVE | different job |
| **OpenAI** | Codex GA **review tools**; PR review ([src](https://www.scriptbyai.com/codex-timeline/)) | 2025-10-06 / 2026-04-16 | INCONCLUSIVE | different job |
| *also — Google / any company* | **LLM-as-a-judge** (MT-Bench et al.) · **Aider architect/editor** two-model split ([src](https://arxiv.org/abs/2306.05685)) | 2023 · 2024 | *THEY-WERE-FIRST* | ~−2 yr |

**PRIMARY VERDICT: INCONCLUSIVE** — —

Both vendors ship code REVIEW earlier than WarpOS. Neither ships an in-team judge that returns DECIDE / DIRECTIVE / ESCALATE on a decision and whose verdict is logged with a citable msg_id. The capability is earlier; the job is different. No priority claimed either way.

*Secondary-axis note:* Reused from PRIOR-ART §6.14. Sub-note: /beta:mine + /beta:integrate (mine the operator's own decision history, then write it back into the judge's model) is closer to preference learning than to LLM-as-judge; no dated product analog found — INCONCLUSIVE at skill level.

#### `system-health-scans` — Aggregate system health — run every scan, linters, environment readiness

4 skills · keystone `/scan:full` **2026-04-16** · family first-landing `d39661a8` 2026-04-16 (via `/check:all`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | `/doctor` — installation and configuration diagnostic; `claude plugin eval` ([src](https://code.claude.com/docs/en/changelog)) | 2025 (present since early Claude Code) / 2026 | INCONCLUSIVE | different job |
| **OpenAI** | *none found* — no aggregate project-health suite | — | NO-ANALOG | — |
| *also — Google / any company* | **SonarQube** · **ESLint** · architecture **fitness functions** (Building Evolutionary Architectures) · **Danger.js** ([src](https://www.thoughtworks.com/insights/books/building-evolutionary-architectures)) | 2007 · 2013 · 2017 · 2016 | *THEY-WERE-FIRST* | ~−9 to −19 yr |

**PRIMARY VERDICT: INCONCLUSIVE** — —

`/doctor` diagnoses the TOOL's installation; `/scan:full` runs ~46 assertions over the PROJECT's architecture, governance and distribution integrity. Same shape, different object, so no clean comparison. Secondary axis has the real ancestor: architecture fitness functions (Ford/Parsons/Kua, 2017), SonarQube (2007), Danger.js (2016).

*Secondary-axis note:* /scan:full is a fitness-function suite by another name. The concept — automated, continuously-run assertions that protect architectural characteristics — is Ford/Parsons/Kua, 2017.

#### `model-routing-dispatch` — Role→provider→model→effort routing + dispatch console

8 skills · keystone `/models:router` **2026-06-01** · family first-landing `7be21c64` 2026-05-18 (via `/scan:node-procs`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Fallback model chains** (within-provider failover) + per-agent cost attribution ([src](https://www.sitepoint.com/claude-code-june-2026-10-new-features-devs-need-to-know/)) | ~2026-06 — exact day still unconfirmed | INCONCLUSIVE | needs an exact vendor date |
| **OpenAI** | **Multi-agent V2 with configurable subagent models** (CLI 0.145.0); explicit effort settings ([src](https://www.scriptbyai.com/codex-timeline/)) | 2026-07-21 | WARPOS-FIRST | +50 d |
| *also — Google / any company* | **OpenRouter** · **LiteLLM proxy** · Portkey ([src](https://openrouter.ai/)) | 2023 | *THEY-WERE-FIRST* | ~−3 yr |

**PRIMARY VERDICT: INCONCLUSIVE** — Anthropic date unpinned (~2026-06 vs WarpOS 2026-06-01); WarpOS +50 d vs OpenAI

Unchanged from PRIOR-ART #6 — this is the one verdict that a single pinned Anthropic date would flip in either direction, and it is the top open item on this axis. WarpOS's console is role→provider→model→effort ACROSS vendors; Anthropic's chain is within-provider.

*Secondary-axis note:* Reused from PRIOR-ART §6.9 / §7.2 row 7p. The one uncontested piece — cross-VENDOR CLI dispatch (scripts/dispatch-agent.js, 2026-04-16) — is a script, not a skill, so it sits outside this sweep's inventory.

#### `admin-panels-cockpit` — Founder admin-panel dev-harness + GUI cockpit panels

10 skills · keystone `/admin:preview` **2026-06-13** · family first-landing `fa36772f` 2026-06-13 (via `/cockpit:readiness`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | Desktop **multi-session workspace** with terminal + file editor; **Agent View** (running / blocked / finished sessions) ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2026-04-14 / 2026-05-11 | VENDOR-FIRST | −33 d (for the /panel:* half only) |
| **OpenAI** | Codex app (macOS 2026-02-02, Windows 2026-03-04); `codex agents` interactive dashboard ([src](https://www.scriptbyai.com/codex-timeline/)) | 2026-02-02 / 2026-08-20 | VENDOR-FIRST | −131 d (agent cockpit only) |
| *also — Google / any company* | **Retool** · **Appsmith** (internal admin-panel builders) ([src](https://research.contrary.com/company/retool)) | 2017 · 2019-07-01 | *THEY-WERE-FIRST* | ~−7 yr |

**PRIMARY VERDICT: INCONCLUSIVE** — vendor cockpits predate /panel:* by 33–131 d; nothing on either side matches /admin:*

The family splits. The `/panel:*` GUI boards (roadmap, models, readiness) are the same genre as Anthropic's Agent View and the Codex app, both earlier. The `/admin:*` harness is a different job entirely — it BOOTS the product's own already-built `/admin` route in a throwaway Next instance and seeds warm-start data into it — and no vendor ships that. Split verdict, so INCONCLUSIVE for the family. Secondary axis for the panel half: Retool 2017, Appsmith 2019.

*Secondary-axis note:* Caveat on the analogy: Retool/Appsmith BUILD admin panels; /admin:preview BOOTS the product's own already-built /admin route in a throwaway Next instance and seeds warm-start data into it. Different job, same territory. The /panel:* GUI boards (roadmap, models, readiness) are Retool's genre outright.

### PRIMARY: NO-VENDOR-ANALOG

#### `docs-maps-discovery-reporting` — System discovery, relationship maps, reference integrity, ELI5 reports

18 skills · keystone `/maps:all` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/maps:all`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | *none found* — no architecture-map or reference-integrity generation feature | — | NO-ANALOG | — |
| **OpenAI** | *none found* | — | NO-ANALOG | — |
| *also — Google / any company* | **dependency-cruiser** · **ArchUnit** · **Structurizr/C4** · **SonarQube** · **Backstage** catalog ([src](https://github.com/sverweij/dependency-cruiser)) | 2016 · 2017 · 2016 · 2007 · 2020 | *THEY-WERE-FIRST* | ~−9 yr |

**PRIMARY VERDICT: NO-VENDOR-ANALOG** — uncontested vs both vendors — but vacuously so

Secondary axis settles it: generating architecture/dependency/coverage maps from a live source of truth and failing on broken references is dependency-cruiser (2016), ArchUnit (2017), Structurizr/C4 (2016) and the Backstage catalog (2020). `/discover:orphaned` and `/report` had no analog found on any axis.

*Secondary-axis note:* Generating architecture/dependency/coverage maps from a live source of truth and failing on broken references is dependency-cruiser + ArchUnit + Backstage territory, all years earlier. Sub-notes with no analog found: /discover:orphaned (sweep NEXT.md, runtime notes, branches, untracked files, TODOs for ABANDONED work) and /report (ELI5, tl;dr-first, watch-outs-always reporting for a non-technical operator).

#### `enforcement-debt` — Enforcement-debt ledger — every policy names its enforcer or logs the gap

5 skills · keystone `/enforcement:log` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/maps:enforcements`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | `claude plugin eval` evaluates PLUGINS, not unenforced policy — closest surface, wrong object ([src](https://code.claude.com/docs/en/changelog)) | 2026 (undated in the changelog) | NO-ANALOG | — |
| **OpenAI** | *none found* | — | NO-ANALOG | — |
| *also — Google / any company* | SonarQube tech-debt register · ADR logs · architecture fitness functions — none tracks POLICY WITHOUT AN ENFORCER ([src](https://www.sonarsource.com/)) | 2007 · 2017 | *WARPOS-FIRST* | uncontested — no analog found in any product |

**PRIMARY VERDICT: NO-VENDOR-ANALOG** — uncontested vs both vendors

Unlike the other NO-VENDOR-ANALOG families, this one is ALSO uncontested on the secondary axis: SonarQube tech-debt registers track code and ADR logs track decisions, but nothing found tracks a policy that exists without a mechanism to detect its violation. The strongest non-dreaming case in the sweep, and still narrow.

*Secondary-axis note:* Reused from PRIOR-ART §3.1 / §6.17. Strongest non-dreaming case, and narrow: the artifact is a ledger of rules that exist WITHOUT a mechanism that detects violation, surfaced at /enforcement:list and folded into /scan:full. Tech-debt registers track code; ADR logs track decisions; neither tracks the enforcement gap itself.

#### `issue-register` — Recurring system-issue register + cross-run pattern intelligence

6 skills · keystone `/issues:log` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/scan:patterns`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | *none found* — no recurring-issue register in Claude Code | — | NO-ANALOG | — |
| **OpenAI** | *none found* | — | NO-ANALOG | — |
| *also — Google / any company* | **Sentry** issue grouping + automatic regression state · AI Issue Grouping GA ([src](https://www.apmdigest.com/sentry-adds-new-features-issue-grouping-issue-summary-and-anomaly-detection)) | 2008 onward · 2025-02 | *THEY-WERE-FIRST* | ~−17 yr on the concept |

**PRIMARY VERDICT: NO-VENDOR-ANALOG** — uncontested vs both vendors — but vacuously so

Secondary axis settles it: Sentry's automatic regression state (a resolved issue reappearing in a later release is reopened and marked a regression) is exactly `/issues:resolve` + `/scan:regressions`, and predates it by many years.

*Secondary-axis note:* Sentry's regression state (a resolved issue reappearing in a later release is auto-reopened and marked a regression) is exactly /issues:resolve + /scan:regressions, years earlier. Sub-note: /scan:patterns (diagnose a recurring pattern, then PROPOSE the automation that would prevent it) is closer to the enforcement-debt family — INCONCLUSIVE at skill level.

#### `ui-design-review` — Design-system compliance review of rendered UI

2 skills · keystone `/ui:review` **2026-04-15** · family first-landing `655775f2` 2026-04-15 (via `/ui:review`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | *none found* as a first-party feature — browser-driven visual review is a community pattern over Playwright MCP | — | NO-ANALOG | — |
| **OpenAI** | *none found* — Codex app **artifact previews** (2026-04-16) render output, they do not audit design-system compliance ([src](https://www.scriptbyai.com/codex-timeline/)) | — | NO-ANALOG | — |
| *also — Google / any company* | **Applitools Eyes** · **Percy** · **Chromatic** (purpose-built for design-system consumer impact); Percy AI Visual Review Agent ([src](https://percy.io/blog/visual-regression-testing-tools)) | 2013 · 2016 · 2017 · 2025-late | *THEY-WERE-FIRST* | ~−9 yr |

**PRIMARY VERDICT: NO-VENDOR-ANALOG** — uncontested vs both vendors — but vacuously so

Secondary axis settles it: Chromatic has been the design-system compliance tool since 2017, Percy since 2016, Applitools since 2013, and Percy shipped an AI Visual Review Agent in late 2025. WarpOS's method differs (LLM reasoning against design-system DOCS rather than pixel-diffing a baseline) but the job is nine years old.

*Secondary-axis note:* WarpOS's is LLM reasoning against the project's design-system DOCS rather than pixel-diffing a baseline — a real methodological difference — but Chromatic has been the design-system compliance tool since 2017 and Percy shipped an AI review agent in late 2025, before WarpOS's 2026-04-15.

#### `growth-marketing` — Growth + marketing content: angles, message brief, advertorial, landing page, ad images/video, LinkedIn/Contra posts

10 skills · keystone `/growth:message-brief` **2026-05-01** · family first-landing `6779f6e6` 2026-05-01 (via `/content:contra`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | *none found* — no marketing-copy or ad-creative product surface | — | NO-ANALOG | — |
| **OpenAI** | *none found* as a product feature (general-purpose ChatGPT/DALL·E generation is not a marketing workflow) | — | NO-ANALOG | — |
| *also — Google / any company* | **Copy.ai** · **Jasper** (as Conversion.ai) · **AdCreative.ai** (ad images, later product video) ([src](https://research.contrary.com/company/jasper)) | 2020-07 · 2021-01 · 2021-11 | *THEY-WERE-FIRST* | ~−4.5 yr |

**PRIMARY VERDICT: NO-VENDOR-ANALOG** — uncontested vs both vendors — but vacuously so

Neither vendor competes here. The secondary axis is brutal and is the real answer: Copy.ai 2020-07, Jasper (as Conversion.ai — whose ORIGINAL product was Facebook/Google ad copy) 2021-01, AdCreative.ai (conversion-scored ad images from a URL scan) 2021-11. WarpOS lands 4–5 years later. Never claim anything here.

*Secondary-axis note:* Jasper's ORIGINAL product was literally Facebook/Google ad copy from templates (Jan 2021). AdCreative.ai shipped conversion-scored ad images from a URL scan in Nov 2021 and product-video generation in Dec 2024. The WarpOS versions (2026-05-01 → 2026-05-30) land 4–5 years later. Nothing here is close.

#### `paths-registry` — Centralized path registry — source→generated, guard hook, rename/convert tooling

6 skills · keystone `/paths:doctor` **2026-05-01** · family first-landing `6779f6e6` 2026-05-01 (via `/paths:add`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | *none found* | — | NO-ANALOG | — |
| **OpenAI** | *none found* | — | NO-ANALOG | — |
| *also — Google / any company* | none found in any product (nearest genre: tsconfig path aliases, Bazel labels — neither is a generated single-source registry with a write-time literal guard) | — | *WARPOS-FIRST* | uncontested — no analog found |

**PRIMARY VERDICT: NO-VENDOR-ANALOG** — uncontested vs both vendors

Also uncontested on the secondary axis (nothing found in any product). Self-deflated by its own authors as config hygiene, not a product category. The nearest genres — tsconfig path aliases, Bazel labels — are neither generated from a single source registry nor guarded at write-time against literal drift.

*Secondary-axis note:* Reused verbatim from PRIOR-ART §6.16, including its own deflation: this is config hygiene, not a product category. Six skills (add/convert/coverage/doctor/explain/rename) wrap it.

#### `roadmap` — Roadmap create/prioritize/predict-next with a product-persona lens

8 skills · keystone `/roadmap:create` **2026-05-19** · family first-landing `91d38d39` 2026-05-19 (via `/roadmap:add`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | *none found* — no roadmap/prioritization product surface | — | NO-ANALOG | — |
| **OpenAI** | *none found* | — | NO-ANALOG | — |
| *also — Google / any company* | **Productboard** · **Jira Product Discovery** (GA) · Aha! ([src](https://techcrunch.com/2023/02/09/atlassians-jira-product-discovery-is-now-generally-available)) | 2014 · 2023-02-09 | *THEY-WERE-FIRST* | ~−3 yr |

**PRIMARY VERDICT: NO-VENDOR-ANALOG** — uncontested vs both vendors — but vacuously so

Neither vendor competes here, so "WarpOS first" would be true and worthless. The real answer is on the secondary axis: Productboard (2014) and Jira Product Discovery (GA 2023-02-09) both ship AI opportunity ranking years earlier.

*Secondary-axis note:* /roadmap:ideas (12 predictions across 4 evidence lenses) and /roadmap:next (the single highest-leverage entry) are AI opportunity suggestion — Productboard's Spark AI and Jira Product Discovery both do this earlier, though not with a role-registry-selected persona.

#### `portfolio-multiproduct` — Operating N product repos from one framework (register/list/open/run/sync/status/spinup)

8 skills · keystone `/portfolio:new` **2026-05-22** · family first-landing `0b043681` 2026-05-22 (via `/portfolio:list`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | *none found* — Agent View (2026-05-11) lists SESSIONS, not products; multi-session workspace (2026-04-14) is one repo | — | NO-ANALOG | — |
| **OpenAI** | *none found* — `codex agents` dashboard (2026-08-20) is agent listing, not a product registry | — | NO-ANALOG | — |
| *also — Google / any company* | **Backstage** software templates + golden paths · **Nx** generators · **cruft**/**Copier** propagation ([src](https://backstage.io/docs/features/software-templates/)) | 2020-03 · 2020 · 2020 | *THEY-WERE-FIRST* | ~−6 yr on scaffolding + propagation |

**PRIMARY VERDICT: NO-VENDOR-ANALOG** — uncontested vs both vendors — but vacuously so

Secondary axis: Backstage has owned "scaffold a service from a golden-path template and keep a registry of them" since 2020-03. `/portfolio:run` (run a skill against another product's repo in a fresh subprocess, never retargeting the current session) is a session-isolation contract with no analog found on any axis.

*Secondary-axis note:* Backstage has owned "scaffold a new service from a golden-path template and keep a registry of them" since 2020. Sub-note: /portfolio:run (execute a skill against ANOTHER product's repo in a fresh Claude subprocess, never retargeting the current session) is a session-isolation contract with no analog found — INCONCLUSIVE at skill level.

#### `bootstrap-onramp` — Idea → on-screen → monetizable (spinup, lastmile)

3 skills · keystone `/bootstrap:spinup` **2026-05-25** · family first-landing `0e79641a` 2026-05-25 (via `/bootstrap:lastmile`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | *none found* — Claude Code builds apps; it ships no idea→on-screen→monetizable on-ramp procedure | — | NO-ANALOG | — |
| **OpenAI** | *none found* — same | — | NO-ANALOG | — |
| *also — Google / any company* | **v0** (Vercel) · **Lovable** · **Replit Agent** · **Bolt.new** ([src](https://altar.io/lovable-vs-bolt-vs-v0-vs-replit-vs-base44/)) | 2023 · 2023 · 2024-09 · 2024-10 | *THEY-WERE-FIRST* | ~−1.5 yr |

**PRIMARY VERDICT: NO-VENDOR-ANALOG** — uncontested vs both vendors — but vacuously so

Secondary axis: prompt→running app is exactly v0 (2023), Lovable (2023), Replit Agent (2024-09) and Bolt.new (2024-10). `/bootstrap:lastmile` (prototype → MONETIZABLE: readiness audit, launch plan, store/SSO day-zero prerequisites, human-gated production actions) is the half those tools skip, and no dated analog was found for it.

*Secondary-axis note:* prompt→running app is exactly Lovable/Bolt/v0/Replit, all earlier. Sub-note: /bootstrap:lastmile (prototype → MONETIZABLE: readiness audit, launch plan, store/SSO day-zero prerequisites, human-gated production actions) is the half those tools skip — no dated analog found for the last-mile-to-revenue procedure specifically.

### PRIMARY: N/A-COMPOSITE

#### `warpos-distribution-integrity` — WarpOS ship/install/capsule/migration integrity scans

18 skills · keystone `/scan:warpos-manifest-honesty` **2026-05-04** · family first-landing `38adbda2` 2026-05-04 (via `/scan:warpos-applied-migrations`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | n/a — these assert properties of WarpOS's own four-layer distribution | — | N/A | — |
| **OpenAI** | n/a | — | N/A | — |
| *also — Google / any company* | **cruft** / **Copier** template-drift detection · Terraform drift detection · Backstage catalog validation ([src](https://github.com/cruft/cruft)) | 2020 · 2016 | *N/A-COMPOSITE* | — |

**PRIMARY VERDICT: N/A-COMPOSITE** — —

18 skills asserting manifest honesty, migration presence, capsule resolvability, version quorum, tracked transients and layer diff across framework source → generated views → installed capsule → downstream product. No vendor analog exists because no vendor product has this layer topology. The generic pattern — detect drift between a template and its instantiations — is cruft/Copier (2020) on the secondary axis.

*Secondary-axis note:* These 18 skills assert properties of WarpOS's OWN layered distribution (framework source → generated views → installed capsule → downstream product): manifest honesty, migration presence, capsule resolvability, version quorum, tracked transients, layer diff. No external analog exists because no external product has this layer topology. The generic pattern they instantiate — detect drift between a template and its instantiations — is cruft/Copier (2020) and Terraform drift (2016).

### PRIMARY: VENDOR-FIRST

#### `warp-distribution` — Framework distribution: setup/update/release/uninstall/doctor/flag/reconcile

20 skills · keystone `/warp:update` **2026-03-19** · family first-landing `c7db0a2b` 2026-03-19 (via `/warp:check`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Plugins & marketplaces** — formal distribution system for commands, agents, hooks and skills ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2025-10-31 | VENDOR-FIRST | −139 d |
| **OpenAI** | Codex **Plugins** (installable bundles of Skills + integrations); **Agent Plugins publishing and marketplaces** (CLI 0.146.0) ([src](https://www.scriptbyai.com/codex-timeline/)) | 2026-03-25 / 2026-07-29 | WARPOS-FIRST | +6 d |
| *also — Google / any company* | **Cookiecutter** · **Yeoman** · **Copier** / **cruft** (update an already-generated project from its template) ([src](https://www.cookiecutter.io/article-post/compare-cookiecutter-to-yeoman)) | 2013 · 2012 · 2020 | *THEY-WERE-FIRST* | −168 d vs plugins; ~−6 yr vs scaffolders |

**PRIMARY VERDICT: VENDOR-FIRST** — −139 d (Anthropic plugins); WarpOS beat Codex plugins by 6 d

Anthropic settles it. The 6-day margin over Codex Plugins is real but not worth claiming — Anthropic had already defined the category five months earlier. `/warp:flag` → `/warp:reconcile` (a downstream product filing a structured gap upstream) has no vendor analog on either side.

*Secondary-axis note:* Reused from PRIOR-ART §1 #17. Sub-note: /warp:flag → /warp:reconcile (a DOWNSTREAM product files a structured gap against the framework, which the framework then verifies and fixes upstream) is a bidirectional template↔instance feedback channel; Copier/cruft push updates downstream but have no upstream gap channel. That pair is INCONCLUSIVE, not obviously taken.

#### `reasoning-frameworks` — Classify-then-solve reasoning + graded fix quality

6 skills · keystone `/reasoning:run` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/fix:deep`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Extended thinking** with a configurable thinking budget; Plan Mode subagent ([src](https://www.anthropic.com/news/claude-3-7-sonnet)) | 2025-02-24 / 2025-10-27 | VENDOR-FIRST | ~−14 mo |
| **OpenAI** | GPT-5 `reasoning_effort`; o-series reasoning models ([src](https://openai.com/index/introducing-gpt-5/)) | 2025-08-07 | VENDOR-FIRST | ~−8 mo |
| *also — Google / any company* | Cynefin (1999) · 5 Whys / TRIZ · Gemini thinking budgets (2025-04-17) · GPT-5 reasoning_effort (2025-08-07) ([src](https://hbr.org/2007/11/a-leaders-framework-for-decision-making)) | 1999 onward | *THEY-WERE-FIRST* | ~−15 mo (model layer); decades (the frameworks themselves) |

**PRIMARY VERDICT: VENDOR-FIRST** — ~−14 mo (Anthropic)

Effort/thinking control is a MODEL-level knob both vendors shipped first. WarpOS's contribution is a router (problem class → framework) plus a 0–4 fix-quality score logged per episode; no dated analog was found for that pairing, but every part of it is older.

*Secondary-axis note:* The frameworks are borrowed by design. What is unusual is pairing a router (problem class → framework) with a 0–4 fix-quality score logged per episode to paths.tracesFile — no dated analog found for the pairing, but every part is older.

#### `commit-land` — Commit / push / land (merge to default branch)

4 skills · keystone `/commit:land` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/commit:both`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | Claude Code has edited files, run commands and used Git since the research preview ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2025-02-24 | VENDOR-FIRST | ~−13.5 mo |
| **OpenAI** | Codex CLI reads, modifies and executes code in a project directory with git integration ([src](https://www.scriptbyai.com/codex-timeline/)) | 2025-04-16 | VENDOR-FIRST | ~−12 mo |
| *also — Google / any company* | **aider** auto-commits with AI-generated messages · **aicommits** ([src](https://github.com/aider-ai/aider)) | 2023-04 · 2023 | *THEY-WERE-FIRST* | ~−1 yr |

**PRIMARY VERDICT: VENDOR-FIRST** — ~−13.5 mo (Anthropic)

Both vendors' agents committed code before WarpOS existed; aider (2023-04) beats both on the secondary axis. `/commit:land`'s branch→push→merge-to-default composition is a convenience wrapper, not a capability.

*Secondary-axis note:* aider has auto-committed every AI edit with a generated message since April 2023.

#### `skills-meta` — Skills about skills — create/edit/delete/cleanup, author-with-eval-pack, coverage self-inventory

9 skills · keystone `/skills:create` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/maps:skills`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | Custom slash commands (2025); **Agent Skills** (`SKILL.md`), open-standard 2025-12-18; `/skill-doctor`; `claude plugin eval` ([src](https://venturebeat.com/ai/anthropic-launches-enterprise-agent-skills-and-opens-the-standard)) | 2025-10-16 | VENDOR-FIRST | −178 d |
| **OpenAI** | **Codex Agent Skills** — reusable instruction packages for CLI and IDE; custom prompts (markdown → slash commands, undated, now deprecated in favour of Skills) ([src](https://www.scriptbyai.com/codex-timeline/)) | 2025-12-19 | VENDOR-FIRST | −114 d |
| *also — Google / any company* | **Cursor Rules** · **promptfoo** · **DSPy** · **LangSmith evals** · Anthropic **prompt improver** ([src](https://www.promptfoo.dev/)) | 2024 · 2023 · 2023-late · 2023 · 2024-11 | *THEY-WERE-FIRST* | ~−1 to −3 yr |

**PRIMARY VERDICT: VENDOR-FIRST** — −178 d (Anthropic Agent Skills)

Vendor-first by construction. `/etc:author` + `/etc:eval` (author a prompt artifact WITH a sibling eval-pack, emit a validated decision_record) is the interesting sub-case; the nearest vendor surface is `claude plugin eval` (2026, undated) and `/skill-doctor`, and the secondary axis has promptfoo (2023) and DSPy (2023) earlier. `/scan:scan-coverage` is N/A-COMPOSITE.

*Secondary-axis note:* /etc:author + /etc:eval (2026-05-30) author a prompt artifact TOGETHER WITH a sibling eval-pack and emit a validated decision_record — promptfoo (2023) and DSPy (2023) own the author-then-evaluate loop earlier. Sub-note: /scan:scan-coverage (an aggregator asserting every member skill is either delegated or explicitly excluded WITH A REASON) is N/A-COMPOSITE — it kills the dir↔aggregator drift class and has no external analog.

#### `memory-learning` — Memory stores + scored learnings lifecycle

7 skills · keystone `/learn:deep` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/fav:list`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **memory tool + context editing** (API/Bedrock/Vertex); **Auto Memory / MEMORY.md** in Claude Code ([src](https://www.anthropic.com/news/context-management)) | 2025-09-29 / 2026-02-26 | VENDOR-FIRST | −6.5 mo (API) / −45 d (Claude Code) |
| **OpenAI** | Codex **project memories** (CLI 0.145.0); Codex app **memories** ([src](https://www.scriptbyai.com/codex-timeline/)) | 2026-07-21 / 2026-04-16 | WARPOS-FIRST | +100 d vs Codex project memories; +4 d vs Codex app memories |
| *also — Google / any company* | **MemGPT** (tiered agent memory) · **Cursor Memories** 1.0 · **Windsurf Wave 1 memories** ([src](https://research.contrary.com/company/letta)) | 2023-10 · 2025-06-04 · 2025-01 | *THEY-WERE-FIRST* | ~−2.5 yr |

**PRIMARY VERDICT: VENDOR-FIRST** — −45 d (Anthropic auto memory) — Anthropic settles it; WarpOS was ~100 d ahead of OpenAI

WarpOS's scored `pending_validation`→`effective` promotion with time-decay is a materially different design from Auto Memory, but it landed later, so no claim. Worth recording: on the OpenAI axis alone WarpOS was ahead — Codex had no project memories until 2026-07-21.

*Secondary-axis note:* Reused from PRIOR-ART §6.2/6.3. Sub-note: /memory:verify (2026-07-25) — verifying auto-memory entries against code/disk/git ground truth and deleting contradicted ones — had NO analog found; but it is a consequence of vendor auto-memory existing, so it cannot predate it.

#### `hooks-mgmt` — Hook authoring, disable/enable, test, friction measurement

5 skills · keystone `/hooks:add` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/hooks:add`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Hooks** — event-driven control around actions (v1.0.38) ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2025-06-30 | VENDOR-FIRST | −287 d |
| **OpenAI** | Codex **async hooks** (CLI 0.145.0); the Codex hooks doc page carries no release date ([src](https://learn.chatgpt.com/docs/hooks)) | 2026-07-21 | WARPOS-FIRST | +100 d |
| *also — Google / any company* | git hooks (1990s) · Husky/lint-staged · **Codex hooks** (near-copy of the Claude hook vocabulary; docs carry no date) ([src](https://learn.chatgpt.com/docs/hooks)) | decades | *THEY-WERE-FIRST* | −262 d |

**PRIMARY VERDICT: VENDOR-FIRST** — −287 d (Anthropic hooks)

Vendor-first by construction — WarpOS hooks ARE Claude Code hooks. Worth recording for completeness: Codex's hook vocabulary is a near-copy of Anthropic's and its async hooks did not ship until 2026-07-21, ~100 days after WarpOS's hook-management skills — but that comparison is meaningless given the substrate. `/hooks:friction` had no analog on either vendor.

*Secondary-axis note:* WarpOS hooks ARE Claude Code hooks — vendor-first by construction, stated plainly in PRIOR-ART §0. Sub-note: /hooks:friction (measure what a hook costs the operator in interruptions, then act on it) had no analog found.

#### `modes-teams` — Build modes + named agent faces / teams

6 skills · keystone `/mode:adhoc` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/mode:adhoc`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Agent Teams** (research preview, with Opus 4.6) — coordinating multiple independent sessions ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2026-02-05 | VENDOR-FIRST | −66 d |
| **OpenAI** | Codex **subagents** (explorer / worker / default, up to six concurrent); **multi-agent V2** with configurable subagent models ([src](https://www.scriptbyai.com/codex-timeline/)) | 2026-03-16 / 2026-07-21 | VENDOR-FIRST | −27 d |
| *also — Google / any company* | **MetaGPT** ("first AI software company": PM/architect/engineer/QA roles) · AutoGen · CrewAI · LangGraph ([src](https://arxiv.org/abs/2308.00352)) | 2023-08 · 2023-09-25 · 2023-10 · 2024-01-08 | *THEY-WERE-FIRST* | ~−2.7 yr |

**PRIMARY VERDICT: VENDOR-FIRST** — −66 d (Anthropic Agent Teams)

Reused from PRIOR-ART §1 #11. WarpOS's named-face org model (α/β/γ/δ/ε + departments) is a different design from Agent Teams, but it landed later.

*Secondary-axis note:* Reused from PRIOR-ART §6.6/6.7.

#### `oneshot-build` — Standalone autonomous skeleton build (preflight→run→retro)

4 skills · keystone `/oneshot:start` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/oneshot:improve`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **GitHub Actions for background tasks** at Claude Code GA ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2025-05-22 | VENDOR-FIRST | ~−11 mo |
| **OpenAI** | **Codex Cloud** research preview — hosted agent runs each task in a remote container ([src](https://www.scriptbyai.com/codex-timeline/)) | 2025-05-16 | VENDOR-FIRST | ~−11 mo |
| *also — Google / any company* | **Devin** · **Cursor Background Agent** (0.50→GA 1.0) · GitHub Copilot coding agent ([src](https://www.cognition.ai/blog/introducing-devin)) | 2024-03-12 · 2025-05-15 · 2025-05 | *THEY-WERE-FIRST* | ~−2 yr |

**PRIMARY VERDICT: VENDOR-FIRST** — ~−11 mo (both vendors, within a week of each other)

Autonomous long-running builds were shipped by both vendors in May 2025.

*Secondary-axis note:* Reused from PRIOR-ART §6.13. Sub-note: /oneshot:improve — the preflight suite editing ITS OWN check skills from gaps found during runs — is a self-modification loop; its nearest analog is the karpathy family, itself THEY-WERE-FIRST.

#### `qa-redteam-security` — QA persona audits, red-team personas, privacy/secrets/ingest-firewall scans

8 skills · keystone `/redteam:full` **2026-04-15** · family first-landing `cd37d410` 2026-04-12 (via `/qa:audit`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **`/security-review`** slash command + GitHub Action; **Claude Code Security** limited research preview ([src](https://claude.com/blog/automate-security-reviews-with-claude-code)) | 2025-08-06 / 2026-02-20 | VENDOR-FIRST | −252 d |
| **OpenAI** | Codex GA **review tools**; **Codex Security** research preview ([src](https://www.scriptbyai.com/codex-timeline/)) | 2025-10-06 / 2026-03-06 | VENDOR-FIRST | −191 d |
| *also — Google / any company* | **garak** (NVIDIA) · **PyRIT** (Microsoft) · **promptfoo redteam** ([src](https://github.com/NVIDIA/garak)) | 2023-06-13 · 2024-02-22 · 2023 | *THEY-WERE-FIRST* | ~−2.8 yr |

**PRIMARY VERDICT: VENDOR-FIRST** — −252 d (Anthropic /security-review)

Both vendors shipped agentic security review before WarpOS. `/scan:security-binding-lane` (assert a reviewer's FAIL is structurally un-overridable by the lead that dispatched it) is a governance property with no vendor analog — but that is one skill, not the family.

*Secondary-axis note:* Reused from PRIOR-ART §6.10. Sub-note: /scan:security-binding-lane (assert the security reviewer's FAIL verdict is structurally un-overridable by the lead that dispatched it) is a governance property, not a scanner — no analog found.

#### `research` — Deep research — multi-round, multi-provider

2 skills · keystone `/research:deep` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/research:deep`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Research** — multi-agent research system (orchestrator + parallel subagent searchers) ([src](https://www.anthropic.com/engineering/multi-agent-research-system)) | 2025-04 | VENDOR-FIRST | ~−12 mo |
| **OpenAI** | **Deep research** in ChatGPT (and later the deep-research API models WarpOS actually calls) ([src](https://openai.com/index/introducing-deep-research/)) | 2025-02-02 | VENDOR-FIRST | ~−14 mo |
| *also — Google / any company* | **Gemini Deep Research** · **Perplexity Deep Research** ([src](https://blog.google/products/gemini/google-gemini-deep-research/)) | 2024-12-11 · 2025-02-14 | *THEY-WERE-FIRST* | ~−16 mo |

**PRIMARY VERDICT: VENDOR-FIRST** — ~−14 mo (OpenAI deep research)

`/research:deep` literally CALLS OpenAI's and Google's deep-research APIs — it is a consumer of the vendor feature, which makes the priority question moot. The only unclaimed part is the parallel multi-provider fan-out and merge, which no single vendor ships; that composition is N/A-COMPOSITE, not a first.

*Secondary-axis note:* Reused from PRIOR-ART §6.5; the operator's own framing ("we came after; our deep research pipeline is like Perplexity") sets this. Sub-note: running OpenAI DR + Gemini DR + Claude multi-round search IN PARALLEL and merging is a fan-out no single vendor ships — that composition is N/A-COMPOSITE, the capability is not.

#### `session-state-handoff` — Session checkpoint, resume, handoff, prescriptive DUMP

8 skills · keystone `/session:handoff` **2026-04-12** · family first-landing `cd37d410` 2026-04-12 (via `/session:checkpoint`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Checkpoints + `/rewind`** (Claude Code v2.0); Desktop **session handoff** ([src](https://code.claude.com/docs/en/checkpointing)) | 2025-09-29 / 2026-02-20 | VENDOR-FIRST | ~−6.5 mo |
| **OpenAI** | Codex CLI 0.145.0 **paginated thread history**; 0.146.0 **session names + thread pinning** ([src](https://www.scriptbyai.com/codex-timeline/)) | 2026-07-21 / 2026-07-29 | WARPOS-FIRST | +100 d |
| *also — Google / any company* | **Cline Memory Bank** · **Gemini CLI checkpointing** · Roo Code ([src](https://docs.cline.bot/prompting/cline-memory-bank)) | 2025-early · 2025-06 | *THEY-WERE-FIRST* | ~−10 mo |

**PRIMARY VERDICT: VENDOR-FIRST** — ~−6.5 mo (Anthropic checkpoints/rewind)

Anthropic settles it. `/session:dump` (2026-05-18) is still distinct — it carries explicit ANTI-instructions and fences past session progression as context-not-command — and no analog was found for that contract on either vendor. But the family capability is vendor-first.

*Secondary-axis note:* Reused from PRIOR-ART §6.15 / 7l. Sub-note: /session:dump (2026-05-18) writes a handoff carrying explicit ANTI-instructions and past session progression fenced as context-not-command — a guard against a fresh session re-executing the log. No analog found for the anti-instruction contract; the handoff-file genre itself is older.

#### `agent-roster` — Agent-spec roster, smoke-dispatch, role-parity enforcement

5 skills · keystone `/agents:list` **2026-05-04** · family first-landing `38adbda2` 2026-05-04 (via `/agents:list`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Custom Subagents** via `/agents` ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2025-07-24 | VENDOR-FIRST | −284 d |
| **OpenAI** | Codex **subagents**; `codex agents` interactive dashboard (CLI 0.149.0) ([src](https://www.scriptbyai.com/codex-timeline/)) | 2026-03-16 / 2026-08-20 | VENDOR-FIRST | −49 d |
| *also — Google / any company* | CrewAI agent definitions · AutoGen agent configs ([src](https://github.com/crewAIInc/crewAI)) | 2023-10 | *THEY-WERE-FIRST* | ~−9 mo |

**PRIMARY VERDICT: VENDOR-FIRST** — −284 d (Anthropic subagents)

WarpOS agent specs ARE Claude Code subagents. `/scan:role-parity` and `/scan:greek-office-parity` are fail-closed bijection enforcers over that primitive with no vendor analog — N/A-COMPOSITE at skill level.

*Secondary-axis note:* Sub-note: /scan:role-parity and /scan:greek-office-parity are fail-closed BIJECTION enforcers (a role exists in the org map IFF it exists in the dispatch catalog IFF team-guard knows it; a Greek call-sign IFF President's-office membership). No analog found — those two are N/A-COMPOSITE over vendor subagent primitives.

#### `events-telemetry` — Append-only event ledger + query/tail

2 skills · keystone `/events:query` **2026-05-04** · family first-landing `38adbda2` 2026-05-04 (via `/events:query`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | *no first-party agent-trace ledger found* for Claude Code beyond OTel export | — | NO-ANALOG | — |
| **OpenAI** | **Agents SDK built-in tracing** — traces and spans over agent runs ([src](https://openai.com/index/new-tools-for-building-agents/)) | 2025-03-11 | VENDOR-FIRST | ~−14 mo |
| *also — Google / any company* | **LangSmith** · **Langfuse** agent tracing ([src](https://www.langchain.com/langsmith)) | 2023 · 2024-07 | *THEY-WERE-FIRST* | ~−3 yr |

**PRIMARY VERDICT: VENDOR-FIRST** — ~−14 mo (OpenAI Agents SDK tracing)

OpenAI settles this one on its own — a rare family where the OpenAI axis is decisive and the Anthropic axis is empty. Secondary: LangSmith 2023, Langfuse 2024-07.

*Secondary-axis note:* Reused from PRIOR-ART §7.2 row 7m.

#### `permissions-turbo` — Session-scoped permission pre-authorization + spend ceiling

4 skills · keystone `/session:turbo` **2026-05-13** · family first-landing `4c3bc3f9` 2026-05-13 (via `/turbo`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | **Auto mode** — classifier screens tool calls before execution (preview → GA) ([src](https://www.anthropic.com/engineering/claude-code-auto-mode)) | 2026-03-24 → 2026-07-10 | VENDOR-FIRST | −50 d |
| **OpenAI** | Codex **approval modes** (CLI rebuild); **writes approval mode**; auto-approve after review ([src](https://www.scriptbyai.com/codex-timeline/)) | 2025-09-15 / 2026-07-09 / 2026-08-07 | VENDOR-FIRST | ~−8 mo |
| *also — Google / any company* | **OpenAI Agents SDK guardrails** · usage limits ([src](https://openai.com/index/new-tools-for-building-agents/)) | 2025-03-11 | *THEY-WERE-FIRST* | −50 d vs auto mode; ~−14 mo vs guardrails |

**PRIMARY VERDICT: VENDOR-FIRST** — ~−8 mo (OpenAI approval modes); −50 d (Anthropic auto mode)

Both vendors shipped permission pre-authorization first. WarpOS adds a TTL grant with snapshot/restore and a real cross-provider spend ceiling (`/scan:turbo-spend`) — no vendor analog found for the spend-ceiling assertion specifically, but the family is vendor-first.

*Secondary-axis note:* Reused from PRIOR-ART §1 #12 / §7.2 row 7o.

#### `guides-knowledge` — Author guides / knowledge domains and WIRE them into named consumers

6 skills · keystone `/guides:integrate` **2026-05-31** · family first-landing `6ad63316` 2026-05-31 (via `/guides:coverage`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | `CLAUDE.md` + `@`-file imports as the static instruction layer; **Agent Skills** as the packaged delivery shape ([src](https://venturebeat.com/ai/anthropic-launches-enterprise-agent-skills-and-opens-the-standard)) | 2025-02-24 / 2025-10-16 | VENDOR-FIRST | ~−15 mo on doc-as-agent-context |
| **OpenAI** | `AGENTS.md` (shipped with Codex CLI, 32 KiB cap); **Codex Agent Skills** ([src](https://www.scriptbyai.com/codex-timeline/)) | 2025-04-16 / 2025-12-19 | VENDOR-FIRST | ~−13 mo |
| *also — Google / any company* | **Cursor @Docs** indexing · **Devin Knowledge** · **Backstage TechDocs** ([src](https://cursor.com/docs/agent/tools/search)) | 2024-late · 2024–25 · 2020 | *THEY-WERE-FIRST* | ~−1.5 yr on doc-into-agent-context |

**PRIMARY VERDICT: VENDOR-FIRST** — ~−15 mo (Anthropic CLAUDE.md/imports)

IMPORTANT SPLIT. Doc-as-agent-context is vendor-first on both sides and not close. But every vendor and industry analog found INDEXES or IMPORTS a doc; `/guides:integrate` and `/knowledge:integrate` PLACE it — at a declared anchor inside named consumer agent specs, in a declared shape, idempotently, read-before-write, recording every placement in a JSONL ledger. No analog was found for deterministic ledgered doc→consumer-spec wiring on any axis. Those two skills carry a NO-VENDOR-ANALOG skill-level verdict inside a VENDOR-FIRST family.

*Secondary-axis note:* IMPORTANT SUB-CASE: every analog INDEXES docs for retrieval. /guides:integrate and /knowledge:integrate do something else — place a doc at a DECLARED ANCHOR inside specific consumer agent specs in a declared SHAPE, idempotently, with read-before-write conflict detection, recording every placement in a JSONL ledger (guide-integration.jsonl / knowledge-integration.jsonl). No analog found for deterministic, ledgered doc→consumer-spec wiring. Those two skills are WARPOS-FIRST (uncontested, niche); the family is not.

#### `enforced-trackers` — Validator-enforced tracker system (34 sections, 20 checks, hook-gated)

2 skills · keystone `/trackers:validate` **2026-06-05** · family first-landing `e386d70a` 2026-06-05 (via `/trackers:validate`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | Agent Teams **shared task list**; `/goal` persistent completion conditions ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2026-02-05 / 2026-05-11 | VENDOR-FIRST | −120 d / −25 d |
| **OpenAI** | *none found* — no validator-enforced project tracker | — | NO-ANALOG | — |
| *also — Google / any company* | **Linear** · **Jira** · **Danger.js** (PR-time policy assertions) ([src](https://danger.systems/js/)) | 2020-06 · 2002 · 2016 | *THEY-WERE-FIRST* | ~−6 yr |

**PRIMARY VERDICT: VENDOR-FIRST** — −120 d (Anthropic)

The tracker CONTENT is vendor-first. The enforcement shape — a markdown tracker fail-closed validated by 20 checks in a pre-commit hook — has no vendor analog; that is Danger.js's genre (2016) on the secondary axis.

*Secondary-axis note:* The tracker CONTENT is Linear/Jira territory. The distinct part — a MARKDOWN tracker fail-closed validated (no blank section, no broken link, every §8 term defined) by a pre-commit hook — is Danger.js's genre applied to a doc, and Danger.js is 2016.

#### `epic-tracking` — Epic lifecycle — plan/start/fold/split/link/review/acceptance/close

10 skills · keystone `/epic:plan` **2026-06-09** · family first-landing `b4f26ab8` 2026-06-09 (via `/epic:acceptance`)

| Axis | Their feature | Their date | Verdict | Margin |
|---|---|---|---|---|
| **Anthropic** | Agent Teams **shared task list**; `/goal` — persistent completion conditions ([src](https://www.scriptbyai.com/claude-code-timeline/)) | 2026-02-05 / 2026-05-11 | VENDOR-FIRST | −124 d / −29 d |
| **OpenAI** | *none found* — Codex ships task lists in-CLI (2025-09-15) but no epic/ticket lifecycle ([src](https://www.scriptbyai.com/codex-timeline/)) | 2025-09-15 | VENDOR-FIRST | ~−9 mo (task lists only; no epic analog) |
| *also — Google / any company* | **Linear** (exited private beta) · **Jira** · Shortcut ([src](https://linear.app/)) | 2020-06 · 2002 · 2014 | *THEY-WERE-FIRST* | ~−6 yr |

**PRIMARY VERDICT: VENDOR-FIRST** — −124 d (Anthropic shared task list)

The operator's own framing ("our ticket system is like Linear") already settles the secondary axis; the vendor axis agrees. `/epic:fold`'s 14-class taxonomy + refuse-to-silently-overwrite contract has no vendor analog.

*Secondary-axis note:* Reused from PRIOR-ART §6.4; the operator's own framing ("our ticket system is like Linear") sets this verdict. Sub-note: /epic:fold — classify an incoming item against a 14-class taxonomy and REFUSE to silently overwrite a stable commitment (flag + provenance change-log instead) — is a conflict-detection contract with no product analog found.

---

## 5. Skills with no external analog found

Skills whose specific procedure matched nothing found in a real search — on either axis. Read with §9
limit 8 in hand: a single-pass search is weak evidence of absence. Nineteen of 237.

| Skill | First landed | Family PRIMARY | What was searched | Outcome |
|---|---|---|---|---|
| `/beta:integrate` | `e0f25200` · 2026-04-16 | INCONCLUSIVE | judgment-model update from mined precedent, constitutional feedback loops | INCONCLUSIVE at skill level — writes mined precedent back into the judgment model; no dated product analog found. |
| `/beta:mine` | `cd37d410` · 2026-04-12 | INCONCLUSIVE | LLM-as-a-judge, preference learning from user decisions, agent decision mining | INCONCLUSIVE at skill level — mining the operator's own decision history to update a judge; closer to preference learning than LLM-as-judge, no dated product analog found. |
| `/discover:orphaned` | `6779f6e6` · 2026-05-01 | NO-VENDOR-ANALOG | abandoned work detection, stale branch/TODO sweep, forgotten task discovery | No analog found — sweeps NEXT.md, runtime notes, branches, untracked files, TODOs, plans for ABANDONED work. |
| `/guides:integrate` | `6ad63316` · 2026-05-31 | VENDOR-FIRST | docs into agent context (CLAUDE.md imports, AGENTS.md, Agent Skills, Cursor @Docs, Devin Knowledge, Backstage TechDocs), prompt-fragment injection, idempotent doc placement ledgers | WARPOS-FIRST (uncontested, niche) — deterministic, idempotent, ledgered doc→consumer-agent-spec placement at a declared anchor. Every vendor analog INDEXES docs instead. |
| `/hooks:friction` | `cd37d410` · 2026-04-12 | VENDOR-FIRST | developer-friction measurement, hook interruption cost, pre-commit friction telemetry | No analog found — measures what a hook costs the operator in interruptions and acts on it. |
| `/knowledge:integrate` | `af1fe400` · 2026-06-05 | VENDOR-FIRST | knowledge-domain wiring into agent specs, RAG-vs-placement, consumer-spec injection ledgers | WARPOS-FIRST (uncontested, niche) — same placement-ledger contract for LIBRARY/STORE knowledge domains. |
| `/memory:verify` | `d6e158d2` · 2026-07-25 | VENDOR-FIRST | auto-memory verification, memory ground-truth checking, stale agent memory correction (Anthropic auto memory 2026-02-26; Codex project memories 2026-07-21) | No analog found for verifying an agent's own auto-memory against code/disk/git ground truth — but it presupposes vendor auto-memory (2026-02), so no priority. |
| `/portfolio:run` | `0b043681` · 2026-05-22 | NO-VENDOR-ANALOG | cross-repo agent invocation, multi-repo agent session isolation, Backstage/Nx multi-project ops | INCONCLUSIVE — run a skill against another product repo in a fresh subprocess, never retargeting the current session. No analog found. |
| `/report` | `dda80fec` · 2026-05-31 | NO-VENDOR-ANALOG | ELI5 engineering reports, non-technical stakeholder status generation | No analog found — ELI5, tl;dr-first, watch-outs-always reporting aimed at a non-technical operator. |
| `/scan:greek-office-parity` | `a2ee350c` · 2026-07-16 | VENDOR-FIRST | naming-convention bijection enforcers, identity-scheme validators | N/A-COMPOSITE — naming bijection enforcer (Greek call-sign IFF President's-office membership). No external analog. |
| `/scan:patterns` | `cd37d410` · 2026-04-12 | NO-VENDOR-ANALOG | cross-run failure pattern mining, automation proposal from incident history | INCONCLUSIVE at skill level — diagnoses a recurring pattern then PROPOSES the preventing automation; behaves like the enforcement-debt family. |
| `/scan:role-parity` | `c3219d6d` · 2026-05-30 | VENDOR-FIRST | role registry parity, agent catalog drift detection, org-map bijection enforcement | N/A-COMPOSITE — fail-closed role bijection across org map, dispatch catalog, and team-guard. No external analog. |
| `/scan:scan-coverage` | `ada42901` · 2026-05-31 | VENDOR-FIRST | aggregator/member drift, check-suite self-inventory, lint-rule coverage assertions | N/A-COMPOSITE — aggregator self-inventory; every member skill delegated or excluded WITH A REASON. No external analog. |
| `/scan:security-binding-lane` | `7f14911b` · 2026-07-20 | VENDOR-FIRST | binding reviewer verdicts, un-overridable security gates, approval-authority governance | No analog found — asserts a reviewer FAIL is structurally un-overridable by the dispatching lead (governance, not scanning). |
| `/session:dump` | `c305b555` · 2026-05-18 | VENDOR-FIRST | AI session handoff format, Claude Code desktop session handoff (2026-02-20), Cline Memory Bank, anti-instruction / context-not-command handoff contracts | Distinct: carries explicit ANTI-instructions and fences past session progression as context-not-command. No analog found for the anti-instruction contract. |
| `/session:read` | `cd37d410` · 2026-04-12 | WARPOS-FIRST | cross-session agent messaging, agent inbox, A2A, Agent Teams messaging, Anthropic cross-session SendMessage/ListAgents (2026-08-07), Codex threads | Core of the INCONCLUSIVE cross-session-inbox case. |
| `/session:write` | `cd37d410` · 2026-04-12 | WARPOS-FIRST | same as /session:read | Core of the INCONCLUSIVE cross-session-inbox case. |
| `/warp:flag` | `b3a5ab06` · 2026-05-11 | VENDOR-FIRST | template drift feedback, cruft/Copier upstream channels, downstream-to-upstream gap reporting | INCONCLUSIVE — upstream gap channel from a downstream product back to the framework; cruft/Copier propagate downstream only. |
| `/warp:reconcile` | `03cf48cd` · 2026-05-26 | VENDOR-FIRST | same as /warp:flag | INCONCLUSIVE — consumer side of the same upstream gap channel. |

---

## 6. Full per-skill table

237 rows, alphabetical. Both verdicts are inherited from the family; the last column fires only where
the skill is materially different from its family.

| Skill | Purpose | First landed | Family | **PRIMARY** | *also* | Skill-level note |
|---|---|---|---|---|---|---|
| `/admin:guides` | Open the in-app founder admin panel's guides sub-route in a browser, against a PRODUCT's running Next app (never WarpOS  | `f273f672` · 2026-06-14 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/admin:preview` | Open/preview a PRODUCT's in-app founder admin panel in the browser. Scaffolds (or reuses) a fixed throwaway Next instanc | `f273f672` · 2026-06-14 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/admin:readiness` | Open the in-app founder admin panel's launch-readiness sub-route in a browser, against a PRODUCT's running Next app (nev | `f273f672` · 2026-06-14 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/admin:seed` | Seed warm-start data (founder-allowlist session, sample events, FOUNDERS_CHECKLIST.md) into the live admin-preview insta | `f273f672` · 2026-06-14 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/agents:list` | Enumerate every agent spec by mode and role. | `38adbda2` · 2026-05-04 | agent-roster | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/agents:test` | Smoke-dispatch one agent role (or all non-claude roles) with a tiny ping prompt. | `38adbda2` · 2026-05-04 | agent-roster | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/beta:integrate` | Apply validated recommendations from beta mining into the judgment model | `e0f25200` · 2026-04-16 | beta-judgment | **INCONCLUSIVE** | *THEY-WERE-FIRST* | INCONCLUSIVE at skill level — writes mined precedent back into the judgment model; no dated product analog found. |
| `/beta:mine` | Mine patterns from user behavior — prompts, decisions, skill chains, evolution cycles | `cd37d410` · 2026-04-12 | beta-judgment | **INCONCLUSIVE** | *THEY-WERE-FIRST* | INCONCLUSIVE at skill level — mining the operator's own decision history to update a judge; closer to preference learning than LLM-as-judge, no dated product analog found. |
| `/bootstrap:lastmile` | Prototype → monetizable product. Drives the 'last mile': readiness audit → launch plan → roadmap/sprint injection → guid | `0e79641a` · 2026-05-25 | bootstrap-onramp | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* | No dated analog found for the prototype→monetizable last-mile procedure; the prompt→app half is Lovable/Bolt/v0/Replit territory. |
| `/bootstrap:ponder` | Exploratory pondering of a project — surface tensions, patterns, JTBD drift, and one forcing question | `91d38d39` · 2026-05-19 | reasoning-frameworks | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/bootstrap:spinup` | From 'just WarpOS' to something on screen — one in-project command: setup (deterministic create+scaffold+intake) → canon | `fbdb523d` · 2026-05-25 | bootstrap-onramp | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/check:all` **[deprecated alias → /scan:full]** | [deprecated alias → /scan:full] Run every scan in parallel — a full system scan. Superseded by /scan:full in the check:→ | `d39661a8` · 2026-04-16 | system-health-scans | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/check:framework-purity` **[deprecated alias → /scan:framework-purity]** | [deprecated alias → /scan:framework-purity] Refuse product-content leaks in canonical. Superseded by /scan:framework-pur | `74f26fa2` · 2026-05-22 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/check:framework-views-fresh` **[deprecated alias → /scan:framework-views-fresh]** | [deprecated alias → /scan:framework-views-fresh] Verify .claude views are byte-identical regenerations of _warpos source | `74f26fa2` · 2026-05-22 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/check:install` **[deprecated alias → /scan:install]** | [deprecated alias → /scan:install] Verify a fresh WarpOS install. Superseded by /scan:install in the check:→scan: namesp | `38adbda2` · 2026-05-04 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/cockpit:readiness` | The launch-readiness cockpit — show how close every registered product is to launch (composite %, blocked items, owner-a | `fa36772f` · 2026-06-13 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/commit:both` **[deprecated alias → /commit:land]** | [deprecated alias → /commit:land] Commit locally then push — superseded by /commit:land, which also merges the branch in | `cd37d410` · 2026-04-12 | commit-land | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/commit:land` | Land the working branch — commit locally, push the branch, then merge it into the repo's default branch and push that to | `03cf48cd` · 2026-05-26 | commit-land | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/commit:local` | Stage and commit changes locally — smart message, no push | `cd37d410` · 2026-04-12 | commit-land | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/commit:remote` | Push current branch to remote — with safety checks | `cd37d410` · 2026-04-12 | commit-land | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/content:contra` | Create a Contra portfolio post with carousel images — write copy, design slides, render PNGs | `6779f6e6` · 2026-05-01 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/content:linkedin` | Create a LinkedIn post with carousel images — write copy, design slides, render PNGs | `6779f6e6` · 2026-05-01 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/discover:orphaned` | Discover orphaned work — find every deferred, forgotten, or abandoned task across NEXT.md, runtime notes, branches, untr | `6779f6e6` · 2026-05-01 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* | No analog found — sweeps NEXT.md, runtime notes, branches, untracked files, TODOs, plans for ABANDONED work. |
| `/discover:systems` | Multi-angle system discovery — find every system in a project by intersecting 6 discovery lenses, surface what's declare | `7544061f` · 2026-04-17 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/docs:catalog` | Enumerate reference docs under _docs/ and paths.reference, with title/size/mtime. | `38adbda2` · 2026-05-04 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/enforcement:list` | List open enforcement-debt entries — policies/conventions without an automated enforcer | `91d38d39` · 2026-05-19 | enforcement-debt | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/enforcement:log` | Record a policy/convention that has no automated enforcer — appends to paths.enforcementDebt | `91d38d39` · 2026-05-19 | enforcement-debt | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/enforcement:sweep` | Find UNFILED debt — deferral comments, prompt suppressions, skipped tests, unenforced-policy claims, review residuals —  | `4a3a3c59` · 2026-07-28 | enforcement-debt | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/epic:acceptance` | Manage an epic's acceptance criteria — ensure all 20 AC categories are present, each names its proof, and report AC cove | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/epic:close` | Close a completed epic — verify every DoD item is satisfied + evidenced, fill the Completion record, set state to Comple | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/epic:fold` | Fold new information, constraints, bugs, or scope into an EXISTING epic intelligently — classify the item against the 14 | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* | No product analog found for the 14-class taxonomy + refuse-to-silently-overwrite-a-stable-commitment contract. |
| `/epic:link` | Establish and verify an epic's linkages — its companion plan artifact, ROADMAP § Epics entry, TRACKER header, child spri | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/epic:plan` | Turn a messy plain-language epic request into a durable, validate-shape epic tracker file plus a companion plan artifact | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/epic:repair` | Detect and repair a drifted or malformed epic file — missing §-sections, blank required sections, broken links, percent/ | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/epic:review` | Run an independent, cross-provider review of an epic plan — feasibility, overclaims, missing enforcers, blast-radius gap | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/epic:split` | Split an over-large epic into two or more coherent epics — partition scope/sprints/DoD/AC, preserve provenance and depen | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/epic:start` | Transition a planned epic into active execution — mint its first wave of sprints, set state to Active, and stand up the  | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/epic:status` | Report an epic's true, evidence-based status — percent completion, sprint roll-up, DoD progress, blockers, and tracker/r | `b4f26ab8` · 2026-06-09 | epic-tracking | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/etc:author` | Author or refine a skill/prompt in standard format, producing a sibling eval-pack for evaluation | `a5f7a824` · 2026-05-30 | skills-meta | **VENDOR-FIRST** | *THEY-WERE-FIRST* | Authors a prompt artifact together with a sibling eval-pack; promptfoo (2023) / DSPy (2023) own the author-then-evaluate loop earlier. |
| `/etc:eval` | Evaluate a skill or prompt artifact against its eval-pack, emitting a validated decision_record | `a5f7a824` · 2026-05-30 | skills-meta | **VENDOR-FIRST** | *THEY-WERE-FIRST* | Emits a validated decision_record against the eval-pack; promptfoo/DSPy earlier. |
| `/events:query` | Query the events log by type, time range, or regex match. | `38adbda2` · 2026-05-04 | events-telemetry | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/events:tail` | Tail the events log — last N events with timestamp, type, and message. | `38adbda2` · 2026-05-04 | events-telemetry | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/fav:list` | Browse all saved favorite moments, grouped by category | `cd37d410` · 2026-04-12 | memory-learning | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/fav:search` | Search saved favorite moments by keyword across category, title, and notes — find one specific moment you remember savin | `cd37d410` · 2026-04-12 | memory-learning | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/fix:deep` | Deep fix — Full diagnostic with automatic framework selection, 5 solutions, root cause analysis, and prevention | `cd37d410` · 2026-04-12 | reasoning-frameworks | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/fix:fast` | Quick fix — Direct Investigation, no formal framework. Read error, find cause, fix it, verify. | `cd37d410` · 2026-04-12 | reasoning-frameworks | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/growth:ad-images` | Turn an angle into native-ad image prompts (scene-first, no text/logo/product, --ar) and render them via Higgsfield (hea | `70e9d273` · 2026-05-30 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/growth:ad-video` | Turn an angle into a video ad (swipe→script→storyboard→image-to-video) and generate it via Higgsfield (headless API; gat | `70e9d273` · 2026-05-30 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/growth:advertorial` | Write a long-form advertorial (pre-sell editorial) from a message brief — research → foundational docs → swipe → write → | `70e9d273` · 2026-05-30 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/growth:angles` | Mine untapped marketing angles from real customer voice (Amazon/Reddit/forums) — ≥3 evidence-backed alternates. Reuses r | `70e9d273` · 2026-05-30 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/growth:iterate` | Iterate a winning creative/message against a conversion/engagement scalar — thin wrapper over karpathy:run + parallel va | `70e9d273` · 2026-05-30 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/growth:landing-page` | Build a converting landing page from a conversion brief — conversion-hierarchy, scaffold component library, mobile-first | `70e9d273` · 2026-05-30 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/growth:message-brief` | Distill the single winning message (the spine artifact) from an audience dossier + angles — contrast + depth, market pro | `70e9d273` · 2026-05-30 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/growth:product-finder` | Find validated high-margin products for paid traffic — EQ-scored (Product×Ads×Funnel×LTV), SCALE/TEST/SKIP, with margin  | `70e9d273` · 2026-05-30 | growth-marketing | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/guides:coverage` | Fail-closed enforcer for the _guides/ library — asserts every guide is anchored, the registry is fresh, every anchor is  | `6ad63316` · 2026-05-31 | guides-knowledge | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/guides:integrate` | Wire each _guides/ guide into the bootstrap pipeline (spinup/lastmile) at its declared anchor in its declared shape, and | `6ad63316` · 2026-05-31 | guides-knowledge | **VENDOR-FIRST** | *THEY-WERE-FIRST* | WARPOS-FIRST (uncontested, niche) — deterministic, idempotent, ledgered doc→consumer-agent-spec placement at a declared anchor. Every vendor analog INDEXES docs instead. |
| `/guides:organize` | Audit and restructure the _guides/ launch-guide library — backfill the guide-anchor contract onto every guide, (re)gener | `6ad63316` · 2026-05-31 | guides-knowledge | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/guides:write` | Author a launch guide into _guides/ — grounded in an external brand-building methodology (paid course, not redistributed) + the existing guides, in the right | `67b32c57` · 2026-05-31 | guides-knowledge | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/hooks:add` | Design and create a new hook from a description | `cd37d410` · 2026-04-12 | hooks-mgmt | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/hooks:disable` | Temporarily disable a hook by moving it from settings.json into a `_disabled_hooks` section, with a one-step path to re- | `cd37d410` · 2026-04-12 | hooks-mgmt | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/hooks:friction` | Analyze friction points — find patterns that suggest missing hooks | `cd37d410` · 2026-04-12 | hooks-mgmt | **VENDOR-FIRST** | *THEY-WERE-FIRST* | No analog found — measures what a hook costs the operator in interruptions and acts on it. |
| `/hooks:test` | Test all hooks with synthetic payloads and measure execution time | `cd37d410` · 2026-04-12 | hooks-mgmt | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/issues:list` | List recurring system issues — bugs/regressions in the agent framework, hooks, skills, .claude/, scripts/ | `6779f6e6` · 2026-05-01 | issue-register | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/issues:log` | Record a new instance of a recurring system issue — appends to recurring-issues.jsonl, dedupes by title overlap | `6779f6e6` · 2026-05-01 | issue-register | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/issues:resolve` | Mark a recurring system issue resolved with a permanent fix summary | `6779f6e6` · 2026-05-01 | issue-register | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/karpathy:integrate` | Review a completed /karpathy:run and merge its winning artifact(s) into main — only command that touches the live codeba | `38d771bf` · 2026-04-18 | karpathy-autoresearch | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/karpathy:run` | Karpathy autoresearch loop — plan a closed-loop experiment, review, then run autonomously in an isolated worktree. Optim | `38d771bf` · 2026-04-18 | karpathy-autoresearch | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/karpathy:status` | Read-only status dashboard for an active or completed /karpathy:run. Shows score curve, flag counts, cost burn, and stop | `38d771bf` · 2026-04-18 | karpathy-autoresearch | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/knowledge:coverage` | Fail-closed enforcer for the _knowledge/ layer (the company "brain", ADR-0007) — asserts the domain registry is fresh, e | `af1fe400` · 2026-06-05 | guides-knowledge | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/knowledge:integrate` | Wire each _knowledge/ domain into its consumers in its declared shape — LIBRARY domains via a knowledge-marker block in  | `af1fe400` · 2026-06-05 | guides-knowledge | **VENDOR-FIRST** | *THEY-WERE-FIRST* | WARPOS-FIRST (uncontested, niche) — same placement-ledger contract for LIBRARY/STORE knowledge domains. |
| `/learn:deep` | Deep learning — extracts from conversation + event log + retro/report files (oneshot retros, sprint retros, _reports) in | `6779f6e6` · 2026-05-01 | memory-learning | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/learn:ingest` | Ingest external knowledge from files, links, or YouTube videos and apply learnings to the system | `cd37d410` · 2026-04-12 | memory-learning | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/learn:integrate` | Learning integrator — promote validated high-score learnings into actual system enforcement (hooks, rules, skills, agent | `6779f6e6` · 2026-05-01 | memory-learning | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/linters:run` | Run every project linter (path-lint, lint-*, npm lint:*) and aggregate pass/fail. | `38adbda2` · 2026-05-04 | system-health-scans | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/manifest:migrate` | Migrate the manifest to a target WarpOS version. Dry-run by default; --apply to write. | `38adbda2` · 2026-05-04 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/manifest:show` | Print .claude/manifest.json (pretty by default, --json for compact). | `38adbda2` · 2026-05-04 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/manifest:validate` | Validate the current .claude/manifest.json against the v1 manifest schema and report any drift, missing fields, or schem | `38adbda2` · 2026-05-04 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/maps:all` | Registry of all maps — shows every map, its source, last updated, and staleness | `cd37d410` · 2026-04-12 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/maps:architecture` | App structure — routes, components, libs, how they connect | `cd37d410` · 2026-04-12 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/maps:coverage` | Maps-suite self-inventory — asserts every /maps:* skill is registered in /maps:all, no dangling registry refs, no orphan | `16cab8cb` · 2026-05-31 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/maps:enforcements` | Enforcement coverage — hooks, gates, gap analysis, open/closed gaps | `cd37d410` · 2026-04-12 | enforcement-debt | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/maps:hooks` | Hook wiring diagram — events, matchers, scripts, execution order | `cd37d410` · 2026-04-12 | hooks-mgmt | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/maps:memory` | Memory store relationships — who reads/writes each store, entry counts | `cd37d410` · 2026-04-12 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/maps:skills` | Skill dependency graph — namespaces, cross-references, data flow | `cd37d410` · 2026-04-12 | skills-meta | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/maps:steps` | Regenerate step tables in canonical docs from _requirements/00-canonical/STEPS.json — closes the last loop in the step-r | `b7a63fc5` · 2026-04-20 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/maps:systems` | Render the systems manifest as a dependency graph — visualize which systems depend on which, their status, and their cat | `cd37d410` · 2026-04-12 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/maps:tools` | Tool registry — skills, hooks, external CLIs, API services, npm scripts, platform tools | `cd37d410` · 2026-04-12 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/memory:verify` | Verify & correct auto-memory against ground truth (code/disk/git/TRACKER) — flags stale/wrong/contradicted entries, corr | `d6e158d2` · 2026-07-25 | memory-learning | **VENDOR-FIRST** | *THEY-WERE-FIRST* | No analog found for verifying an agent's own auto-memory against code/disk/git ground truth — but it presupposes vendor auto-memory (2026-02), so no priority. |
| `/mode:adhoc` | Enter adhoc team mode — Alpha + Beta + Gamma for collaborative feature development | `cd37d410` · 2026-04-12 | modes-teams | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/mode:oneshot` | Initiate a oneshot build — launch Delta as standalone orchestrator for full skeleton runs | `cd37d410` · 2026-04-12 | modes-teams | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/mode:solo` | Enter solo mode — just Alpha and the user, no agent team | `cd37d410` · 2026-04-12 | modes-teams | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/mode:sprint` | Enter sprint mode — ε (Alex Epsilon) conducts the full sprint lifecycle (plan→design→build→gauntlet→release→retro) via t | `4bfb3c44` · 2026-06-05 | modes-teams | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/models:check` | Audit configured dispatch models against the latest vendor catalogs — flag drift, deprecations, and dead ("ghost") ids.  | `fcaaa242` · 2026-06-01 | model-routing-dispatch | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/models:route` | Route a specific command/role to a specific model — thin, validated wrapper over the Dispatch Console (provider/model/ef | `fcaaa242` · 2026-06-01 | model-routing-dispatch | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/models:router` | Open the model router panel — ensure the catalog carries all the latest model options, then launch the Dispatch Console  | `fcaaa242` · 2026-06-01 | model-routing-dispatch | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/models:update` | Update the dispatch catalog to the latest models — re-ingest vendor docs, migrate deprecated/shut-down ids, add new opti | `fcaaa242` · 2026-06-01 | model-routing-dispatch | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/oneshot:improve` | Update preflight passes based on gaps discovered during runs. Modifies the check skills themselves. | `cd37d410` · 2026-04-12 | oneshot-build | **VENDOR-FIRST** | *THEY-WERE-FIRST* | Self-modification loop: the preflight suite edits its own check skills from gaps found during runs. |
| `/oneshot:preflight` | Pre-run preflight — branch creation + skeleton gut + 7-pass verification audit. Default = full setup+gut+audit. Args con | `6779f6e6` · 2026-05-01 | oneshot-build | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/oneshot:retro` | Post-run retrospective — context + git log + code diffs + cross-run analysis, all 9 categories. Default = full. Args con | `6779f6e6` · 2026-05-01 | oneshot-build | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/oneshot:start` | Lightweight kickoff — verify ready-state and hand off to Delta. Does NOT run setup or destructive work; that's /oneshot: | `6779f6e6` · 2026-05-01 | oneshot-build | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/panel:admin` | Open a product's in-app founder admin panel in the browser (run-in-product, never WarpOS itself). A thin /panel:* forwar | `e319c405` · 2026-06-14 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/panel:list` | List every registered panel — the one discoverable entry for "show me a panel". Enumerates framework/panel-registry.json | `e319c405` · 2026-06-14 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/panel:models` | Open the model router — the Dispatch Console GUI (role → provider → model → effort). A thin /panel:* forwarder to the ca | `e319c405` · 2026-06-14 | model-routing-dispatch | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/panel:readiness` | Open the cross-product launch-readiness board. A thin /panel:* forwarder to the canonical /cockpit:readiness opener — ca | `e319c405` · 2026-06-14 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/panel:roadmap` | Open the roadmap "what's next" panel in your BROWSER — an interactive visual board of active sprints, the prioritized ro | `e319c405` · 2026-06-14 | roadmap | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/paths:add` | Guided flow for adding a paths registry key. | `6779f6e6` · 2026-05-01 | paths-registry | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/paths:convert` | Guided flow for converting hardcoded literals to paths.* tokens. | `6779f6e6` · 2026-05-01 | paths-registry | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/paths:coverage` | Report on documentation coverage for the paths registry — which path keys are documented in PATH_KEYS.md and which are m | `6779f6e6` · 2026-05-01 | paths-registry | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/paths:doctor` | Validate path registry, generated artifacts, and path lint rules. | `6779f6e6` · 2026-05-01 | paths-registry | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/paths:explain` | Explain one paths registry key — show its resolved on-disk path, owner, kind, deprecation status, and human-readable doc | `6779f6e6` · 2026-05-01 | paths-registry | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/paths:rename` | Guided flow for renaming a paths registry key. | `6779f6e6` · 2026-05-01 | paths-registry | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/permissions:authorized` | Operator authorization — durably allow a blocked action by adding a scoped permissions.allow rule from a growing catalog | `1f6c9501` · 2026-05-24 | permissions-turbo | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/playbook:add` | Append a play to the Playbook (.claude/project/reference/playbook.md) — a named, example-anchored operating principle. P | `9eeb23fe` · 2026-05-29 | memory-learning | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/portfolio:list` | List all registered portfolio products — slug, path, WarpOS version, last commit, dirty count, current sprint. | `0b043681` · 2026-05-22 | portfolio-multiproduct | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/portfolio:new` | Scaffold a new product repo (sibling to WarpOS) with the framework installed and committed, then register it — local-onl | `0b043681` · 2026-05-22 | portfolio-multiproduct | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/portfolio:open` | Open a registered portfolio product — print its path and a cd hint, or spawn a new terminal window with --spawn. | `0b043681` · 2026-05-22 | portfolio-multiproduct | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/portfolio:register` | Register an existing local repo as a portfolio product in ~/.warpos/portfolio.json. | `0b043681` · 2026-05-22 | portfolio-multiproduct | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/portfolio:run` | Run a skill against another portfolio product in a fresh Claude subprocess — never retargets the current session. | `0b043681` · 2026-05-22 | portfolio-multiproduct | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* | INCONCLUSIVE — run a skill against another product repo in a fresh subprocess, never retargeting the current session. No analog found. |
| `/portfolio:spinup` | From WarpOS, run the idea→on-screen on-ramp against a registered product: dispatches /bootstrap:spinup into the product' | `0e90018e` · 2026-05-25 | portfolio-multiproduct | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/portfolio:status` | Portfolio dashboard — per-product WarpOS version, last commit, dirty count, current sprint, GitHub remote (parallel, 5s  | `0b043681` · 2026-05-22 | portfolio-multiproduct | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/portfolio:sync` | Run /warp:update across every registered portfolio product sequentially. No fail-fast — failures captured in the final s | `0b043681` · 2026-05-22 | portfolio-multiproduct | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/qa:audit` | Active full-codebase QA audit — systematically walks all 7 failure-mode personas | `cd37d410` · 2026-04-12 | qa-redteam-security | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/qa:check` | Passive QA scan on recent git diff changes — checks for 7 failure-mode signatures | `cd37d410` · 2026-04-12 | qa-redteam-security | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/reasoning:log` | Log a reasoning episode — record what framework was used, why, and what happened | `cd37d410` · 2026-04-12 | reasoning-frameworks | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/reasoning:run` | Reason through a problem or decision — auto-detects quick triage vs deep deliberation | `cd37d410` · 2026-04-12 | reasoning-frameworks | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/reasoning:score` | Score fix quality (0-4) and retroactively reclassify old fixes when new evidence appears | `cd37d410` · 2026-04-12 | reasoning-frameworks | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/redteam:full` | Full red team audit — 11 personas across deterministic scanning + LLM reasoning. Finds auth bypasses, prompt injection,  | `655775f2` · 2026-04-15 | qa-redteam-security | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/redteam:scan` | Quick red team scan — deterministic tools only (deps, routes, CVEs, secrets, config). Fast, no LLM reasoning. | `655775f2` · 2026-04-15 | qa-redteam-security | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/report` | File an ELI5 report (sprint  | `dda80fec` · 2026-05-31 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* | No analog found — ELI5, tl;dr-first, watch-outs-always reporting aimed at a non-technical operator. |
| `/research:deep` | Real deep research — Gemini Thinking writes the brief, then OpenAI Deep Research API + Gemini Deep Research API + Claude | `cd37d410` · 2026-04-12 | research | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/research:simple` | Deep research pipeline — queries Claude, ChatGPT (Codex), and Gemini in parallel, saves reports, synthesizes, and applie | `cd37d410` · 2026-04-12 | research | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/roadmap:add` | Append a new entry to ROADMAP.md — picks section, formats consistently, preserves existing content | `91d38d39` · 2026-05-19 | roadmap | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/roadmap:cleanup` | Audit ROADMAP.md — detect completed items, stale entries, duplicates, hidden urgencies; propose a cleanup plan | `91d38d39` · 2026-05-19 | roadmap | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/roadmap:create` | Bootstrap a product ROADMAP.md from the inputs a project actually has — prefers _requirements/00-canonical/* + a Directo | `0e90018e` · 2026-05-25 | roadmap | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/roadmap:ideas` | Predict candidate roadmap entries across four evidence lenses (3 each = 12 ideas) — whole-roadmap, last-3-shipped, last- | `7b13ae97` · 2026-05-29 | roadmap | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/roadmap:next` | The 1-idea alternative to /roadmap:ideas — the single highest-leverage next roadmap entry (the role-appropriate product  | `7b13ae97` · 2026-05-29 | roadmap | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/roadmap:prioritize` | Role-aware roadmap prioritization — runs /roadmap:cleanup first, then consults the Product Lead (single-product) or Dire | `dad1aed6` · 2026-05-29 | roadmap | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:ac-coverage` | Read-only audit of acceptance-criteria.md verified_by:- linkage across active sprints. | `2ecb4603` · 2026-05-18 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:adhoc-fail-override` | Reject an adhoc dispatcher that overrode a binding reviewer FAIL — verdict-content check (the blind spot gauntlet-verify | `855318eb` · 2026-06-04 | modes-teams | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:adhoc-team-hygiene` | Read-only probe for adhoc-team accretion — flags teams whose members carry a -N de-dup suffix or a stale leadSessionId ( | `03cf48cd` · 2026-05-26 | modes-teams | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:admin-suite-coverage` | Coverage + freshness enforcer for the admin:* dev-tooling suite — each admin skill resolves, every admin-panel registry  | `f273f672` · 2026-06-14 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/scan:architecture` | Architecture integrity — do the layers connect? agent system, cross-layer seams, documentation health | `bf438de7` · 2026-04-16 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:coherence` | Run the WarpOS system coherence graph across 15 drift types. | `6779f6e6` · 2026-05-01 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:cutover-completeness` | ED-026 cutover gate — greps the IMPERATIVE layer + keystone registries for RAW deleted-old-tree literals (00-alex/01-adh | `146108f1` · 2026-06-05 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:design-system` | Design system compliance check - scans UI code for raw colors, raw primitives, missing design docs, and component-librar | `6779f6e6` · 2026-05-01 | ui-design-review | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:dispatch-routing-parity` | Assert the role→provider routing tables agree across providers.js, catalog.js, and the dispatch guide — fails if any rol | `03cf48cd` · 2026-05-26 | model-routing-dispatch | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/scan:docker-secrets` | Dockerfile → .dockerignore secret-exposure check — flags secret files (.env, *.pem, credentials) that a broad COPY . / A | `ac566028` · 2026-06-02 | qa-redteam-security | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:environment` | Environment readiness and tooling quality — fast go/no-go or deep audit | `bf438de7` · 2026-04-16 | system-health-scans | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/scan:etc-harness` | Audit the /etc authoring+eval harness — fail-closed enforcer that rejects an invented authoring format (root etc.md, non | `e53550ad` · 2026-05-30 | skills-meta | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:framework-purity` | Refuse product-content leaks in canonical — scans for client slugs, maintainer abs paths, root-level _requirements/_docs | `74f26fa2` · 2026-05-22 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:framework-views-fresh` | Verify .claude/commands and .claude/agents are byte-identical regenerations of their _warpos/ sources — fails if any vie | `74f26fa2` · 2026-05-22 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:full` | Run every scan in parallel — a full system scan across project health, governance, and WarpOS distribution integrity — m | `d39661a8` · 2026-04-16 | system-health-scans | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/scan:greek-office-parity` | The naming bijection enforcer (operator directive 2026-07-16; ADR-0016) — a role carries a Greek call-sign IFF it is a P | `a2ee350c` · 2026-07-16 | agent-roster | **VENDOR-FIRST** | *THEY-WERE-FIRST* | N/A-COMPOSITE — naming bijection enforcer (Greek call-sign IFF President's-office membership). No external analog. |
| `/scan:ingest-firewall` | Audit the ingest stores (_docs/research, _docs/imports, _docs/briefs, _docs/clones) for un-firewalled prompt-injection — | `7e2834d8` · 2026-05-30 | qa-redteam-security | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:install` | Verify a fresh WarpOS install — manifest, paths, agents, hooks, version, settings. | `38adbda2` · 2026-05-04 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:issues` | Pattern-mine events.jsonl for repeat audit-block signatures — surface candidates for /issues:log | `6779f6e6` · 2026-05-01 | issue-register | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:meta-lockstep` | The meta-lockstep enforcer (SP-20260720-003 D1) — couples a scan's cross-provider SCOPE FILTER to the class_derivation r | `7f14911b` · 2026-07-20 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:model-chain` | The named enforcer (ED-058) for the role-registry model/effort CHAIN. Since DISPATCH.md (2026-07-12, ADR-0016) it enforc | `21848be5` · 2026-06-16 | model-routing-dispatch | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/scan:node-procs` | Read-only diagnostic — list Node processes on the host with PID, start-time, working-set KB, and command. | `7be21c64` · 2026-05-18 | model-routing-dispatch | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/scan:panel-registry-coverage` | Coverage enforcer for the panel-registry (the /panel:* suite) — every `panels` row is well-shaped ({name, opener, descri | `e319c405` · 2026-06-14 | admin-panels-cockpit | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/scan:patterns` | Cross-run intelligence and automation proposals — diagnose recurring patterns or propose prevention | `cd37d410` · 2026-04-12 | issue-register | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* | INCONCLUSIVE at skill level — diagnoses a recurring pattern then PROPOSES the preventing automation; behaves like the enforcement-debt family. |
| `/scan:planning-principles` | Report-only plan-lint — flags any plan artifact under _planning/epics/** (optionally _planning/plans/**) that omits a pr | `ba7bea81` · 2026-06-09 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:privacy` | Pre-publish scan for personal data — credentials, emails, homedir paths, runtime files tracked by git. | `38adbda2` · 2026-05-04 | qa-redteam-security | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:provider-agent-tool-parity` | The DISPATCH.md §9 carve-out enforcer — a `provider != claude` role must NOT carry Agent-tool reachability (tools:["Agen | `98da5df3` · 2026-07-16 | agent-roster | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:references` | Cross-file reference integrity — broken links, orphans, stale SPEC_GRAPH edges | `bf438de7` · 2026-04-16 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:regressions` | Run the regression-seed suite — the 26 recurring bug classes from the 0.17.0 spec, made runnable. Reports per-class pass | `cfc9264b` · 2026-05-29 | issue-register | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:requirements` | Specification consistency, coverage, and drift — static audit, change-driven propagation check, or pending-drift review | `bf438de7` · 2026-04-16 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:roadmap-trace` | Assert every done/retrospected/released sprint has BOTH a Sprints-table ledger row AND a Shipped narrative entry in ROAD | `74aa59f0` · 2026-05-25 | roadmap | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:role-parity` | The one check that owns role parity across the org map, the dispatch catalog, and team-guard — fail-closed enforcer (S1. | `c3219d6d` · 2026-05-30 | agent-roster | **VENDOR-FIRST** | *THEY-WERE-FIRST* | N/A-COMPOSITE — fail-closed role bijection across org map, dispatch catalog, and team-guard. No external analog. |
| `/scan:scaffold-coverage` | Verify the WarpOS app scaffold (Next+Tailwind v4+shadcn/ui+Radix+Lucide) is complete and coherent — fail-closed enforcer | `d5e2ce6a` · 2026-05-30 | bootstrap-onramp | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:scan-coverage` | Scan-suite self-inventory — asserts every /scan:* skill is delegated by /scan:full or explicitly excluded (with a reason | `ada42901` · 2026-05-31 | skills-meta | **VENDOR-FIRST** | *THEY-WERE-FIRST* | N/A-COMPOSITE — aggregator self-inventory; every member skill delegated or excluded WITH A REASON. No external analog. |
| `/scan:security-binding-lane` | The security-binding-lane enforcer (SP-20260720-003 D2) — closes ED-244 (the security BINDING verdict must resolve to a  | `7f14911b` · 2026-07-20 | qa-redteam-security | **VENDOR-FIRST** | *THEY-WERE-FIRST* | No analog found — asserts a reviewer FAIL is structurally un-overridable by the dispatching lead (governance, not scanning). |
| `/scan:skill-hook-coverage` | Bidirectional coverage of the skill hook-point registry — REVERSE (registry coherent vs role-registry) + FORWARD (every  | `f574a7e6` · 2026-06-05 | enforcement-debt | **NO-VENDOR-ANALOG** | *WARPOS-FIRST* |  |
| `/scan:sprint-beta-honesty` | Audits Beta consultation honesty across post-cutoff /sprint:full runs (missing consults, placeholder verdicts, ESCALATE- | `e888eceb` · 2026-05-24 | beta-judgment | **INCONCLUSIVE** | *THEY-WERE-FIRST* |  |
| `/scan:sprint-hook-coverage` | Bidirectional coverage of the sprint hook-point registry — FORWARD (every matched block-row has a manager_consult record | `2e859d76` · 2026-06-04 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:sprint-manager-consult` | Audits manager-consult coverage across post-cutoff /sprint:full runs — asserts the design-quality authority was consulte | `855318eb` · 2026-06-04 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:system` | System inventory — enumerate every active WarpOS system, diff against manifest, report drift and gaps | `bdaf4031` · 2026-04-16 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:timeline` | Reconstruct a build timeline from transaction, event, and provider logs. | `6779f6e6` · 2026-05-01 | docs-maps-discovery-reporting | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/scan:turbo-spend` | Report the turbo session's REAL cross-provider API spend against the operator-set ceiling (framework default $100, runti | `97c0be44` · 2026-06-09 | permissions-turbo | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:version-coherence` | Verify version + schema-label coherence — product version agrees across ALL manifests (incl. the ones version-quorum mis | `ed866510` · 2026-05-30 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/scan:warpos-applied-migrations` | Detect already-applied WarpOS migration scripts left on disk in consumer projects | `38adbda2` · 2026-05-04 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-capsule-resolvable` | Verify the capsule for /warp:update --to <v> is resolvable from REPO_ROOT, sibling clones, manifest.warpos.source, or fr | `40f4e818` · 2026-05-13 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-install-baseline` | Verify a WarpOS install baseline exists (.claude/framework-installed.json present, installedVersion ≠ 0.0.0) before /war | `40f4e818` · 2026-05-13 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-layer-diff` | Read-only product-vs-dev-tooling layer diff — lists which framework-owned paths SHIP to consumer products (product layer | `caaf7707` · 2026-05-31 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-manifest-coverage` | Verify every on-disk path is enumerated in _warpos/MANIFEST.json — catches "added framework content, forgot to register" | `3f8e58b0` · 2026-05-22 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-manifest-honesty` | Verify framework-installed.json reflects actual disk state (no missing files, no hash drift) | `38adbda2` · 2026-05-04 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-migration-coverage` | Verify every breaking change in a WarpOS release ships with a corresponding migration script under framework/migrations  | `38adbda2` · 2026-05-04 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-migration-presence` | Verify every migration listed in capsule release.json#migrations[] exists in the source tree before /warp:update may app | `40f4e818` · 2026-05-13 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-path-resolution` | Verify every paths.json key points to an existing path (skip generated/ephemeral keys) | `38adbda2` · 2026-05-04 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-ship-coverage` | Verify every framework-owned path under the consumer-essential roots is actually shipped (enumerated in framework-manife | `a812f2e6` · 2026-05-30 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-staleness` | Detect drift between the installed WarpOS version on disk and the latest canonical version, flagging installs that have  | `38adbda2` · 2026-05-04 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-structure-parity` | Verify installed framework has the structural skeleton dirs canonical declares | `38adbda2` · 2026-05-04 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-tracked-transients` | Catch transient state accidentally committed (.warpos/, qa-*.png, runtime/qa-*/, etc.) | `38adbda2` · 2026-05-04 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/scan:warpos-version-quorum` | Verify version.json, .claude/framework-manifest.json, .claude/framework-installed.json, and install.ps1 header agree on  | `40f4e818` · 2026-05-13 | warpos-distribution-integrity | **N/A-COMPOSITE** | *N/A-COMPOSITE* |  |
| `/session:checkpoint` | Force an immediate session checkpoint save — captures conversation context and tool activity that git alone cannot recov | `cd37d410` · 2026-04-12 | session-state-handoff | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/session:dump` | Write a prescriptive handoff to DUMP.md at project root — context, session progression (as fenced context, not instructi | `c305b555` · 2026-05-18 | session-state-handoff | **VENDOR-FIRST** | *THEY-WERE-FIRST* | Distinct: carries explicit ANTI-instructions and fences past session progression as context-not-command. No analog found for the anti-instruction contract. |
| `/session:end` | Full session wrap-up — cognitive maintenance (learn/mine/sleep → integrate learnings + β recs) → reconcile + validate TR | `bf894984` · 2026-06-01 | session-state-handoff | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/session:handoff` | Generate a rich AI-analyzed handoff document (replaces /handoff) | `cd37d410` · 2026-04-12 | session-state-handoff | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/session:history` | Browse past session handoff summaries from the handoffs directory — useful for tracking what happened in a prior session | `cd37d410` · 2026-04-12 | session-state-handoff | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/session:read` | Read the cross-session inbox — see what other Alex sessions have been doing | `cd37d410` · 2026-04-12 | cross-session-inbox | **WARPOS-FIRST** | *INCONCLUSIVE* | Core of the INCONCLUSIVE cross-session-inbox case. |
| `/session:recap` | Catch up on the last N turns of this session — what you asked, what I did, what's still pending | `6779f6e6` · 2026-05-01 | session-state-handoff | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/session:resume` | Pick up the previous session and KEEP GOING — load the handoff, re-establish mode + team + turbo, and start executing th | `cd37d410` · 2026-04-12 | session-state-handoff | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/session:takenotes` | Append a timestamped note to a per-topic file under runtime/notes/ | `8faa4d26` · 2026-04-21 | session-state-handoff | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/session:turbo` | Session speed mode — pre-authorize a batch of high-impact actions (permissions.allow) AND switch the build cadence to fa | `56c71f63` · 2026-05-25 | permissions-turbo | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/session:write` | Post a message to the cross-session inbox so other Alex sessions can see it. Default is fully automatic — no arguments n | `cd37d410` · 2026-04-12 | cross-session-inbox | **WARPOS-FIRST** | *INCONCLUSIVE* | Core of the INCONCLUSIVE cross-session-inbox case. |
| `/skills:cleanup` | Audit all skills for dead weight, duplicates, broken references, and namespace issues — then clean up | `cd37d410` · 2026-04-12 | skills-meta | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/skills:create` | Create a new skill from a description — supports simple, multi-phase, and parallel workflows | `cd37d410` · 2026-04-12 | skills-meta | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/skills:delete` | Remove a skill from .claude/commands with a backup, so it can be restored if the deletion turns out to be premature. | `cd37d410` · 2026-04-12 | skills-meta | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/skills:edit` | Edit the body or frontmatter of an existing skill under .claude/commands — guided flow that preserves frontmatter contra | `cd37d410` · 2026-04-12 | skills-meta | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/sleep:deep` | Full sleep cycle — all 6 phases: NREM consolidation, cleanup, replay, REM dreaming, repair, growth (~15-30 min) | `cd37d410` · 2026-04-12 | sleep-dream | **WARPOS-FIRST** | *THEY-WERE-FIRST* | The flagship case. Ran in production 2026-04-22 and 2026-04-25, both before the 2026-05-06 Anthropic announcement. |
| `/sleep:quick` | Light nap — NREM consolidation + glymphatic cleanup only (~5 min) | `cd37d410` · 2026-04-12 | sleep-dream | **WARPOS-FIRST** | *THEY-WERE-FIRST* | Same lineage as /sleep:deep (NREM consolidation + glymphatic cleanup only). |
| `/sprint:cost-gate` | Toggle the /sprint:full cost-estimate halt on or off — turn off the heuristic spend gate when an operator spend posture  | `7c7b4950` · 2026-05-30 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/sprint:design` | Turn an approved Plan Contract into PRD, stories, COPY, INPUTS, TRACE, acceptance criteria, QA, red-team, release plan — | `d460de4b` · 2026-05-11 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/sprint:execute` | Execute the sprint via Ralph-style plan/act/test/review/record/checkpoint loops per ticket, with crash-safe progress, is | `d460de4b` · 2026-05-11 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/sprint:full` | Single-invocation execution of the full sprint pipeline (plan→design→execute→release-prep→retro) under a bounded autonom | `dc6b3c73` · 2026-05-18 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/sprint:plan` | Turn a brief plain-language request into a structured sprint plan and durable Plan Contract. Evidence-labeled, approval- | `d460de4b` · 2026-05-11 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/sprint:release` | Prepare and execute a sprint release — final checks, approval, deploy gate, release notes, rollback prep, retrospective  | `d460de4b` · 2026-05-11 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/sprint:retrospective` | Synthesize a post-sprint retrospective from tracker artifacts — outcomes, friction, action items. Idempotent, fail-open, | `40f4e818` · 2026-05-13 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/sprint:status` | Read-only status view of every live sprint — shows id, lane, status, phase, last checkpoint, and the resume command for  | `92c0cece` · 2026-05-12 | sprint-lifecycle | **WARPOS-FIRST** | *THEY-WERE-FIRST* |  |
| `/trackers:init` | Initialize the enforced tracker system in a repo — scaffold a validator-GREEN tracker structure. Creates the /trackers/  | `50683a29` · 2026-06-06 | enforced-trackers | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/trackers:validate` | Fail-closed validator for the enforced tracker system (agentic_os_tracker_system_improvements.md §28.7). Asserts TRACKER | `e386d70a` · 2026-06-05 | enforced-trackers | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/turbo` **[deprecated alias → /session:turbo]** | [alias → /session:turbo] Pre-authorize a session batch of high-impact actions via permissions.allow entries. Removes the | `4c3bc3f9` · 2026-05-13 | permissions-turbo | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/ui:review` | Design system compliance audit — read-only check of components against the project's design-system docs | `655775f2` · 2026-04-15 | ui-design-review | **NO-VENDOR-ANALOG** | *THEY-WERE-FIRST* |  |
| `/warp:check` | Compare your WarpOS installation against the latest version — find stale, new, and missing items | `c7db0a2b` · 2026-03-19 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:deprecate` | Create a guarded WarpOS deprecation proposal for an agent, skill, hook, path, requirement, pattern, or generated file. | `6779f6e6` · 2026-05-01 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:diff` | Diff canonical WarpOS against an installed product — version/staleness, framework-file drift (stale vs locally-modified) | `d5d653c6` · 2026-05-29 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:doctor` | Unified WarpOS diagnostic — runs every health check in one place. Like /warp:health but full-coverage. | `6779f6e6` · 2026-05-01 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:flag` | Flag a WarpOS framework/tooling gap from a downstream product — append a structured, canonical-consumable entry to this  | `b3a5ab06` · 2026-05-11 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* | INCONCLUSIVE — upstream gap channel from a downstream product back to the framework; cruft/Copier propagate downstream only. |
| `/warp:health` | Verify WarpOS installation — checks every system, reports green/yellow/red with plain-English fixes | `655775f2` · 2026-04-15 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:md` | Tune CLAUDE.md with project-specific context — refresh the auto-generated project block from PROJECT.md, _requirements,  | `0e90018e` · 2026-05-25 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:reconcile` | Reconcile downstream-flagged WarpOS gaps into canonical — discover every product's WARPOS.md, verify each gap @current,  | `03cf48cd` · 2026-05-26 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* | INCONCLUSIVE — consumer side of the same upstream gap channel. |
| `/warp:release` | Drive a full WarpOS release of the canonical clone from this product repo — promote, bump, regen, build capsule, run gat | `6779f6e6` · 2026-05-01 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:setup` | Set up WarpOS end-to-end — clone, install, merge CLAUDE.md, restart, verify. Safe to re-run; auto-detects and completes  | `e44b78ad` · 2026-04-17 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:sync` **[deprecated alias → /warp:update]** | Legacy alias for /warp:update that forwards to the canonical update flow so older references and muscle memory keep work | `afd31592` · 2026-03-19 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:tour` | Guided introduction to WarpOS — explains everything in simple language, no jargon | `655775f2` · 2026-04-15 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:uninstall` | Completely remove WarpOS from a project — restores pre-install state from backup | `e44b78ad` · 2026-04-17 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |
| `/warp:update` | Update WarpOS in this project to a target release. Default = latest. Default mode = dry-run; pass --apply to execute. | `6779f6e6` · 2026-05-01 | warp-distribution | **VENDOR-FIRST** | *THEY-WERE-FIRST* |  |

---

## 7. Vendor date reference

Every date used on the primary axis, in one place. Anchored on two third-party timelines
(**secondary sources** — flagged as a limit below) cross-checked against first-party pages wherever
those exist.

### Anthropic

| Feature | Date | Source |
|---|---|---|
| Claude Code research preview | 2025-02-24 | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| Extended thinking (configurable thinking budget) | 2025-02-24 | [anthropic.com](https://www.anthropic.com/news/claude-3-7-sonnet) |
| Research — multi-agent orchestrator + parallel searchers | 2025-04 | [anthropic.com/engineering](https://www.anthropic.com/engineering/multi-agent-research-system) |
| Claude Code GA · IDE · GitHub Actions background tasks | 2025-05-22 | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| **Hooks** | **2025-06-30** | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| **Subagents (`/agents`)** | **2025-07-24** | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| **`/security-review`** + GitHub Action | **2025-08-06** | [claude.com/blog](https://claude.com/blog/automate-security-reviews-with-claude-code) |
| **Checkpoints + `/rewind`** (Claude Code v2.0) | **2025-09-29** | [docs](https://code.claude.com/docs/en/checkpointing) |
| Memory tool + context editing (API / Bedrock / Vertex) | 2025-09-29 | [anthropic.com](https://www.anthropic.com/news/context-management) |
| **Agent Skills** (`SKILL.md`); open standard 2025-12-18 | **2025-10-16** | [VentureBeat](https://venturebeat.com/ai/anthropic-launches-enterprise-agent-skills-and-opens-the-standard) |
| Plan Mode subagent | 2025-10-27 | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| **Plugins & marketplaces** | **2025-10-31** | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| **Agent Teams** (research preview, Opus 4.6) | **2026-02-05** | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| Desktop session handoff · PR review; Claude Code Security preview | 2026-02-20 | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| **Auto memory** | **2026-02-26** | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| Auto Mode preview → GA | 2026-03-24 → 2026-07-10 | [anthropic.com/engineering](https://www.anthropic.com/engineering/claude-code-auto-mode) |
| Routines — scheduled / API / GitHub-event automation | 2026-04-14 | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| **Dreaming** + **Outcomes** (Managed Agents, Code with Claude SF) | **2026-05-06** | [InfoQ](https://www.infoq.com/news/2026/05/code-with-claude/) |
| Agent View + `/goal` | 2026-05-11 | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| **Dynamic workflows** | **2026-05-28** announce / **2026-06-02** research preview | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| Sessions get isolated git worktrees | 2026-08-04 | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| **Cross-session `SendMessage` + `ListAgents`** | **2026-08-07** | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |
| Subagent forking default | 2026-08-13 | [timeline](https://www.scriptbyai.com/claude-code-timeline/) |

### OpenAI

| Feature | Date | Source |
|---|---|---|
| **Deep research** (ChatGPT) | **2025-02-02** | [openai.com](https://openai.com/index/introducing-deep-research/) |
| **Agents SDK** — handoffs, guardrails, tracing; Responses API | **2025-03-11** | [openai.com](https://openai.com/index/new-tools-for-building-agents/) |
| **Codex CLI** (open-source local coding agent) | **2025-04-16** | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| **Codex Cloud** research preview (codex-1) | **2025-05-16** | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| Codex CLI rebuild — images, task lists, web search, MCP, approval modes | 2025-09-15 | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| Codex GA — review tools, Slack, TypeScript SDK, GitHub Action | 2025-10-06 | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| **Codex Agent Skills** (reusable instruction packages) | **2025-12-19** | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| Codex app (macOS) — parallel agents, worktrees, reviews | 2026-02-02 | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| Codex Security research preview | 2026-03-06 | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| **Codex subagents** (explorer / worker / default, ≤6 concurrent) | **2026-03-16** | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| **Codex Plugins** (bundles of Skills + integrations) | **2026-03-25** | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| Codex app — chats, computer use, automations, memories, PR review | 2026-04-16 | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| **CLI 0.145.0** — async hooks/MCP, thread history, **project memories**, **multi-agent V2** | **2026-07-21** | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| CLI 0.146.0 — session names, thread pinning, plugin publishing + marketplaces | 2026-07-29 | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| CLI 0.147.0 — persistent conversation sections, auto-approve after review | 2026-08-07 | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| CLI 0.149.0 — interactive `codex agents` dashboard | 2026-08-20 | [timeline](https://www.scriptbyai.com/codex-timeline/) |
| Custom prompts (markdown → slash commands) | undated in docs; deprecated in favour of Skills | [developers.openai.com](https://developers.openai.com/codex/custom-prompts) |
| Codex hooks doc page | no release date on the page; async hooks land 2026-07-21 | [learn.chatgpt.com](https://learn.chatgpt.com/docs/hooks) |

---

## 8. Methodology

**Inventory.** `find .claude/commands -name '*.md'` → 237 files. Skill key = path with `/` → `:`.
Purpose = frontmatter `description` (truncated to 120 chars in §6; full text in the JSON). 7 files
carry a deprecated-alias description and are labelled as such; they still count because they remain
resolvable commands.

**Dating.** Per file: `git log --diff-filter=A --follow --format='%h %ad' --date=short -- <path> | tail -1`.
`--follow` matters — a 2026-04-15 refactor moved `framework/commands/**` → `.claude/commands/**`, and
the 2026-05-28 `check:` → `scan:` rename (SP-20260528-001) moved 40+ scan skills. Dates are **first
landing of the procedure**, not first landing at the current path.

**Keystone vs family first-landing.** Both are reported. A family's earliest member is sometimes a
peripheral scan skill that predates the capability itself — `sprint-lifecycle` first lands 2026-04-16
via `/scan:requirements`, but the `/sprint:*` keystones are 2026-05-11. Margins are computed from the
**keystone**, which is the conservative choice wherever the keystone is later.

**Clustering.** 35 families assigned by a deterministic first-match rule list, asserting every one of
the 237 skills lands in exactly one family. Families are capability-shaped, not namespace-shaped: the
46 `/scan:*` skills are distributed across 9 families by what they actually check.

**Research.** 21 web actions total. This revision spent its budget on the vendor axis first, as
instructed: both official-adjacent timelines fetched in full, plus first-party confirmations for
`/security-review`, checkpoints/rewind, the Agents SDK, Codex CLI/cloud/subagents, and Codex custom
prompts. The v1 pass had already sourced the industry axis (13 actions) — growth-copy tools, admin
panel builders, idea→app builders, visual-regression tools, AI commit tooling, roadmap products,
architecture governance, docs-into-agent-context, prompt-eval frameworks, issue regression detection,
scaffolding/template propagation, and cross-session agent messaging.

**Verdicts.** Assigned per family on **both** axes, then inherited by every skill in the family.
Where a skill is materially different from its family, a skill-level note fires and §5 lists it.

---

## 9. Limits — read before quoting any number here

1. **Vendor dates rest on two third-party timelines.** `scriptbyai.com/claude-code-timeline` and
   `/codex-timeline` are the densest dated sources available and they agree with every first-party
   page checked against them — but they are secondary sources, and a public claim should be re-anchored
   on first-party announcements. The **highest-value next action** on this axis is confirming
   **2026-08-07 for cross-session `SendMessage`/`ListAgents`** from the official changelog, because
   the strongest primary-axis claim in this document rests on it.
2. **The official Claude Code changelog is useless for first-launch dates.** `code.claude.com/docs/en/changelog`
   only exposes recent versions (2.1.22x+, August 2026) — fetching it returns August-2026 first-mention
   dates for hooks, subagents, plugins and skills, which are wrong by a year. Do not use it this way.
3. **The 45 extraction-commit skills are undated in the way that matters.** They landed complete on
   2026-04-12 from a private repo, so every date for them is a *ceiling*. Establishing the origin-product
   pre-history would widen several margins — including `cross-session-inbox` and `sleep-dream` — and it
   needs an explicit operator decision (memory rule `feedback_warpos_only_no_cross_project`).
4. **Author-supplied, unsigned git dates.** The GitHub-side repo-creation timestamp
   (2026-03-02T19:53:12Z) and the public tag `warpos@0.1.4` (2026-05-02) are the only non-author-supplied
   anchors, and they only bound the sleep case.
5. **Two vendor dates remain soft.** Claude Code fallback model chains (~2026-06, exact day unconfirmed)
   — this single date is what keeps `model-routing-dispatch` INCONCLUSIVE and would flip it either way.
   And the first-party Dreaming announcement page (`anthropic.com/news/code-with-claude-2026` 404s, and
   `anthropic.com` is blocked by the browser extension's domain permissions), so Dreaming's date rests
   on InfoQ plus secondary outlets.
6. **`sprint-lifecycle` carries a contestable judgement.** I treated the OpenAI Agents SDK's `handoffs`
   primitive (2025-03-11) as agent *delegation* rather than a *lifecycle*, which is what keeps the
   family WARPOS-FIRST. Judge it the other way and it becomes VENDOR-FIRST by ~14 months. The verdict
   is flagged in §4 and should not be quoted without that caveat.
7. **"No vendor analog" ≠ "no analog exists."** Nine families are uncontested only because Anthropic
   and OpenAI never entered those categories. Every one has an earlier analog elsewhere. Treat
   NO-VENDOR-ANALOG as a category-boundary fact, not a priority claim.
8. **"No analog found" ≠ "no analog exists," generally.** §5 lists what was searched per skill. A
   single-pass search by one agent is weak evidence of absence, especially for internal tooling that
   companies never publish.
9. **This sweep covers skills only.** Several strong candidates in the companion document are
   *scripts*, not skills — cross-provider CLI dispatch (`scripts/dispatch-agent.js`, 2026-04-16), the
   dispatch-route guard, the completion ledger, the orphan reaper, the brokered protected-ref land.
   Out of scope here by construction.
10. **The honest headline is unchanged.** On the primary axis: 4 of 35 families are WarpOS-first, 17
    are vendor-first, 9 are in categories the vendors never entered. On the widest field, 206 of 237
    skills are not-first. The defensible claim is the composition and the speed of integration, plus
    two clean timing datapoints (`cross-session-inbox`, `sleep-dream`) and two uncontested-but-narrow
    procedures (`enforcement-debt`, `paths-registry`).
