# Alex Agent System

> Router and table of contents for the multi-agent build system.
> For the full operational specification, see [agent-system.md](.claude/agents/_system/agent-system.md).

---

## Entering-agent preamble

New here? Read this block first, then act. It is single-sourced from `.claude/project/reference/entry-preamble.md` and hash-parity-checked by `scripts/checks/entry-preamble-parity.js` (edit the canonical source, not this copy). Per-executor entrypoints: `CODEX.md` (Codex/GPT), `ANTIGRAVITY.md` (Antigravity/`agy`; the Gemini family routes through `agy`).

<!-- MC:ENTERING-AGENT-PREAMBLE:BEGIN v1 -->
**What this repo is.** MC is a framework for running an autonomous AI software company. Work is delivered by mode-selected *faces* of a single operator persona, plus departmental agents (Product, Engineering, Growth). Identity, the autonomy ceilings, and the full operating doctrine live in `CLAUDE.md` — this preamble asserts none of them; it points you there.

**Read order — once, then act.**
1. `DUMP.md` (repo root, local) — the session handoff: next action, in-flight state, verbatim payloads. Read once, then execute.
2. `TRACKER.md` (repo root, created by `/trackers:init`) — the ENFORCED source of truth. It OUTRANKS `DUMP.md`, this preamble, and your own assumptions. Validate with `node scripts/trackers/validate.js` (must exit 0) before AND after meaningful work; on any disagreement, the tracker wins.
3. `CLAUDE.md` (repo root) — the operating doctrine: autonomy, dispatch, and policy/enforcement + refactor/rename hygiene. Its RULES apply to every executor; the harness-specific mechanics may not.

**Dispatch is CLI-first.** Agent dispatch runs through the CLI wrappers — `node scripts/dispatch-claude.js <role> <prompt-file> -w` for build-chain Claude roles, `node scripts/dispatch-agent.js <role> <prompt-file>` for cross-provider reviewers. CLI is mandatory; a provider API is used ONLY where there is no CLI equivalent. Cross-provider review diversity is required, and a binding FAIL cannot be overridden.

**Guards, gates, and output destinations.** The repo's guarantees are enforced: the `refs/heads/main` reference-transaction fence (every write to main goes through the broker), `/scan:full`, and the release gates. Name a policy's enforcer when one exists; write a debt row only when asked. Write per-run output under `runtime/`, never a manifest-tracked project dir. Orchestrators hold envelopes, not content — heavy work goes to a subprocess that writes its full output to a file and returns a short envelope. Regenerate the manifests once per landing (`npm run manifests`).

**For identity, authority, and the complete rules, read `CLAUDE.md`.**
<!-- MC:ENTERING-AGENT-PREAMBLE:END -->

---

## Agent Team — Alex (the President) and his faces

**Alex is the President** — one identity, shown in different faces by mode. ("Alex" = name; "President" = role.)

| Face | Symbol | What Alex is doing | Spec |
|-------|--------|------|------|
| α | α | Running it — architect, orchestrator | [alpha.md](.claude/agents/president/alpha.md) |
| β | β | Checking it — independent judgment, read-only | [beta.md](.claude/agents/president/beta.md) |
| γ | γ | Delivering — adhoc build (single features) | [gamma.md](.claude/agents/president/gamma.md) |
| δ | δ | Delivering — oneshot build (skeleton runs) | [delta.md](.claude/agents/president/delta.md) |
| ε | ε | Delivering — sprint (full lifecycle) | [epsilon.md](.claude/agents/president/epsilon.md) |

The **departments** (Product, Engineering, Growth — Quality under Product) report to Alex; they are not Alex. Full org: [AGENT-STRUCTURE.md](AGENT-STRUCTURE.md).

## Build Agents

Specs are mode-agnostic and organized by department/pod; role → spec routing comes from the keystone [_org/role-registry.json](.claude/agents/_org/role-registry.json).

| Agent | Role | Spec / Home |
|-------|------|-------------|
| **Builder** | Code writer (scoped, isolated worktree) | [frontend](.claude/agents/engineering/frontend/builder.md) · [backend](.claude/agents/engineering/backend/builder.md) · [security](.claude/agents/engineering/security/builder.md) |
| **Reviewer** | Code quality (Check-7 + holdout-fixture) | [frontend](.claude/agents/engineering/frontend/reviewer.md) · [backend](.claude/agents/engineering/backend/reviewer.md) |
| **QA-Reviewer** | Traceability + integrity + 13 failure-mode personas (absorbs Req-Reviewer, Compliance, QA) | [qa-reviewer](.claude/agents/product/quality/qa-reviewer.md) |
| **Security-Reviewer** | Security scanner — OWASP, injection, attack-chain, prompt-injection (replaces Red Team) | [security-reviewer](.claude/agents/engineering/security/reviewer.md) |
| **Fixer** | Bug fixer (scoped, from structured Fix Brief) | [frontend](.claude/agents/engineering/frontend/fixer.md) · [backend](.claude/agents/engineering/backend/fixer.md) · [security](.claude/agents/engineering/security/fixer.md) |
| **Ops-Analyst** | Cross-cycle pattern analysis, environment evolution (was Learner) | [ops-analyst](.claude/agents/president/ops-analyst.md) |
| **Skeleton-Builder** | Regenerates skeleton stub files from current spec (was Stub-Scaffold) | [skeleton-builder](.claude/agents/engineering/skeleton-builder.md) |
| **Test-Runner** | Headless Playwright E2E test runner | [test-runner](.claude/agents/product/quality/test-runner.md) |
| **Visual-Review** | Visual UI review via Playwright MCP browser | [visual-review](.claude/agents/product/quality/visual-review.md) |

## Build Modes

| Mode | Purpose | Protocol |
|------|---------|----------|
| **Adhoc** | Single feature builds | [protocol.md](.claude/agents/president/_system/adhoc/protocol.md) |
| **Oneshot** | Full skeleton builds | [protocol.md](.claude/agents/president/_system/oneshot/protocol.md) |
| **Sprint** | Full lifecycle (plan→design→build→gauntlet→release→retro) | [epsilon-runtime.js](scripts/sprint/epsilon-runtime.js) |

**Adhoc team** (α + β + γ) is the default for development. **Oneshot** is a standalone Delta session (no team — Delta IS the session). **Sprint** is Epsilon conducting the full lifecycle via the registry-driven runtime. **Solo** (Alpha alone) is rare.

## Dispatch Topology & Model Spread

The roster runs a **provider-by-department** model spread (ADR-0016). The single source of truth for every role's provider·model·effort·fallback is the keystone [_org/role-registry.json](.claude/agents/_org/role-registry.json); routers and enforcers read from there.

**Golden rule — CLI is mandatory for all agent dispatch.** API is allowed ONLY for capabilities with no CLI equivalent (e.g. deep-research). API availability never implies API dispatch.

**Provider → CLI wiring**

| Provider id | CLI | Invocation | Auth |
|---|---|---|---|
| `openai` | `codex` | `codex exec --sandbox workspace-write -c model_reasoning_effort=<lvl> -m <model> -` (prompt on stdin) | metered API key |
| `antigravity` | `agy` | `agy --model <DISPLAY-name> --print-timeout <dur> -p '<prompt>'` (prompt on the `-p` argv value, NOT stdin — `agy` has no stdin `-`; bounded ~32KB by CreateProcess) | self-auth (`~/.gemini/antigravity-cli`) |
| `claude` | `claude` | `claude -p [--agent <role>] [--model <model>]` | harness session |

The individual-tier `gemini` CLI is **sunset** — all Gemini routes through Antigravity `agy`.

**Model catalog**

| Family | Models | Use |
|---|---|---|
| OpenAI (`codex`) | `gpt-6.1-sol` (coding flagship — the GPT pins) · `gpt-6-astra` (most capable, $10/$50) · `gpt-6.1-terra` (fast/efficient) · `gpt-6-luna` (cheap) · `gpt-5.6-sol/terra/luna` (still served; the security GPT hunter stays on `gpt-5.6-sol`) | Product + Growth judgment/authoring; the security GPT lane. Never the bare `gpt-5.6` alias (400s + silently degrades). |
| Anthropic (`claude`) | `claude-opus-5-5` (shipped default for every judgment role incl. α and the Director of Engineering; conductors/leads/reviewers/hunter; the `opus` alias; API default effort is medium, so pins carry explicit effort) · `claude-sonnet-5-5` (builders/fixers/legwork) · `claude-fable-5-2` (opt-in top tier via the `spend-more-on-claude` preset; can bill to usage credits on some plans) · `claude-haiku-5-5` (option) | Engineering; in-process judgment. Legacy but still served: `claude-fable-5-1`, `claude-fable-5`, `claude-opus-5`, `claude-opus-4-8` (provider-fallback deep_fallback), `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`. |
| Gemini via Antigravity (`agy`) | `gemini-4-argon-high` = agy `"Gemini 4 Argon (High)"` (thinking always-on; our dispatch passes no `--effort` — it was proven MODEL-GATED on Gemini 3.1 Pro and is unprobed on Argon; see ANTIGRAVITY.md §2) · `gemini-3.8-flash` (option). agy no longer serves `"Gemini 3.1 Pro (High)"`. | Security Gemini hunter lane · Growth research-lead. |

**Effort ladder:** `low · medium · high · xhigh · max · ultra`. `max` + `ultra` are for `sol`/`terra` only (`luna` caps at `max`). **Authors** (design/product/copy/conversion leads, qa-reviewer) run `xhigh`; **overseers/judges** (Directors, β, security judge, marketing-lead) run `high`. `ultra` = fans out parallel subagents (Cabinet, Ops-Analyst); `max` = maximum time on the single hardest indivisible problem (the Claude security-hunter lane).

**Per-department spread** (GPT = Product + Growth · Claude = Engineering · Security = 3-lab panel):

| Department | Role | Model @ effort | Route | Fallback |
|---|---|---|---|---|
| President | α President (run) | `claude-opus-5-5` @ high (Fable 5.2 opt-in) | the harness session (`/model`) | — |
| President | β Check (judgment) | `gpt-6.1-sol` @ high | **on-demand CLI consult per phase boundary** (NOT an in-process teammate) | `claude-opus-4-8` |
| President | γ / δ / ε conductors | `claude-opus-5-5` @ xhigh | in-process / standalone | — |
| President | ζ Cabinet · η Ops-Analyst | `gpt-6.1-sol` @ xhigh | CLI | `claude-opus-4-8` |
| Product | Director-of-Product | `gpt-6.1-sol` @ high | CLI consult | `claude-opus-4-8` |
| Product | Product-Lead | `gpt-6.1-sol` @ xhigh | CLI consult | `claude-opus-4-8` |
| Product | Design-Lead | `gpt-6.1-sol` @ xhigh | CLI consult | `claude-opus-4-8` |
| Product | **Quality-Lead** | `claude-opus-5-5` @ high | **in-process — Claude-pinned carve-out** (Agent-tool fan-out) | — |
| Product | qa-reviewer | `claude-opus-5-5` @ xhigh | in-process (Claude reviewer class) | — |
| Product | design-quality · visual-review | `claude-opus-5-5` @ high | Agent tool (Claude-pinned: visual judgment / Playwright-MCP) | — |
| Product | test-runner | `claude-sonnet-5-5` @ medium | CLI | — |
| Engineering | Director-of-Engineering | `claude-opus-5-5` @ high (Fable 5.2 opt-in) | in-process orchestrator | — |
| Engineering | frontend / backend / security leads | `claude-opus-5-5` @ high | in-process | — |
| Engineering | all builders + fixers | `claude-sonnet-5-5` @ high | CLI, isolated worktree | — |
| Engineering | frontend / backend reviewers | `claude-opus-5-5` @ high | in-process (Claude reviewer class) | — |
| Security | security-lead | `claude-opus-5-5` @ high | in-process (coordination) | — |
| Security | planner + final judge | `claude-opus-5-5` @ high | in-process | — |
| Security | hunter · Gemini lane | `gemini-4-argon-high` | CLI `agy` | **diversity-loss → fails CLOSED** |
| Security | hunter · GPT lane | `gpt-5.6-sol` @ xhigh | CLI | **diversity-loss → fails CLOSED** |
| Security | hunter · Claude lane | `claude-opus-5-5` @ max | in-process (Agent tool + `record-inprocess`) | — |
| Growth | Director-of-Growth | `gpt-6.1-sol` @ high | CLI consult | `claude-opus-4-8` |
| Growth | copy-lead · conversion-lead | `gpt-6.1-sol` @ xhigh | CLI consult | `claude-opus-4-8` |
| Growth | marketing-lead | `gpt-6.1-sol` @ high | CLI consult | `claude-opus-4-8` |
| Growth | research-lead | `gemini-4-argon-high` | CLI `agy` consult | `claude-opus-4-8` |

**Fallback policy (with teeth):** required **iff** `provider !== "claude"`; must differ from primary (claude→claude rejected); every OpenAI/Antigravity role → `fallback: claude` resolving to an explicit `claude-opus-4-8`. Outage-only, logged to the provider trace, alert on chronic fire. **Security fails CLOSED on lab-diversity loss** — a hunter falling back to Claude collapses the cross-lab guarantee → re-run or BLOCK.

**Topology doctrine (context economy):** the orchestrator holds **envelopes, not content**. Heavy/verbose work → CLI subprocess (isolated context; writes full output to a file; returns a ≤8-line envelope). Light small-return judgment → in-process Agent tool (**Claude-only** — the harness Agent tool cannot summon a GPT/Gemini role; an agent has the Agent tool iff its spec lists it — the sprint conductor does, ADR-0014). **Carve-out rule:** Claude-pin any role whose function requires Agent-tool fan-out (Quality-Lead, design-quality, visual-review, the security Claude judge/hunter); provider-spread only leaf/synthesis roles.

**Greek call-signs = the President's office ONLY**. The five faces keep their letters (α β γ δ ε); `cabinet` = **ζ** and `ops-analyst` = **η** (office residents). Department roles carry no Greek letter — leads and directors are named by role, not glyph.

**Enforcers:** `scan:model-chain` (provider/model/effort policy), `scan:greek-office-parity` (glyph ⟺ office-membership bijection), `scan:dispatch-routing-parity`, `scan:provider-agent-tool-parity` (no `provider != claude` role carries Agent-tool reachability), `security-pass-count` (the 3-lab panel fired all lanes).

## Key Documents

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | Framework config, identity pointer, memory system |
| [PROJECT.md](PROJECT.md) | Project-specific context (product, architecture, env) |
| [agent-system.md](.claude/agents/_system/agent-system.md) | Full operational specification |
| [manifest.json](.claude/manifest.json) | MC identity card — project metadata, features, phases, providers |
| [paths.json](.claude/paths.json) | Centralized path registry — all hooks/scripts read paths from here |
| [_guides/AUTH_RUNBOOK.md](_guides/AUTH_RUNBOOK.md) | Passwordless-Supabase auth execution runbook — agent-drivable, with 🔴 operator vs 🤖 agent steps fenced |
| [_knowledge/design/INPUT_COMPOSER_PATTERN.md](_knowledge/design/INPUT_COMPOSER_PATTERN.md) | Reusable ChatGPT-style bottom-composer pattern + glossary (design-lead / design-quality / frontend-builder) |

## Dispatch Templates (by department)

| Directory | Purpose |
|-----------|---------|
| [president/](.claude/agents/president/) | The 5 Alex faces (α/β/γ/δ/ε) + `_system/` policy, ADRs, mode protocols |
| [engineering/](.claude/agents/engineering/) | Frontend/backend/security pods — builder, reviewer, fixer, leads, director |
| [product/](.claude/agents/product/) | Product + Quality (qa-reviewer, design-quality, visual-review, test-runner), leads, director |
| [growth/](.claude/agents/growth/) | Growth dept — research, copy, conversion, marketing leads, director |
| [_org/](.claude/agents/_org/) | Keystone `role-registry.json` — the role ↔ spec source of truth |

## Hard Rules (all agents)

1. **Stay in your lane.** Do not exceed your role's authority.
2. **Do not modify files outside your scope.** Your task defines which files you may touch.
3. **Do not communicate with the user.** Report to your orchestrator (Gamma or Alpha) only.
4. **Do not fix forward.** If your change breaks the build and you cannot fix it within scope, revert and report.
5. **Three attempts maximum.** If you fail 3 times on the same issue, stop and report.
6. **Cross-provider diversity required.** Reviewers run on a different lab than the builder they review (Engineering builds on Claude → code-quality reviews on GPT; the security panel spans Gemini + GPT + Claude). The security panel **fails CLOSED** if it loses a lab to fallback — see Dispatch Topology & Model Spread.
7. **Decision authority.** Class A/B/C taxonomy, escalation red lines, and scoring rubric live at `paths.decisionPolicy`. Current product stage at `paths.currentStage`. Apply both before requesting a user decision.

## Review Protocol

Every builder output runs one parallel review round (two at most) whose binding verdicts come from three review scopes. Only a hold-class finding fails a unit; the rest are known-issues rows, and personal content, the security read before anything goes public, and passing tests are never deferred (`paths.decisionPolicy` § Review and hold rules):
1. **Code-quality reviewer** — the pod's `frontend`/`backend-reviewer` on a **cross-lab** GPT model (`gpt-5.6-sol`) vs the Claude builder: Check-7 (7A–7G) + holdout-fixture + CWD/branch pre-check. Code-quality ONLY.
2. **QA-Reviewer** — one role (`gpt-5.6-terra`) carrying three scopes: **traceability** (the 6 req-reviewer checks), **integrity** (compliance — COPY exact-match, hallucinated-dep, 5 violation types), and **functional** (13 failure-mode personas). Absorbs the former Req-Reviewer + Compliance + QA agents.
3. **Security-Reviewer** — the **3-lab panel** (replaces Red Team): `claude-fable-5` planner+judge over three hunter lanes (Gemini via `agy` → GPT → Claude@max), OWASP + injection + attack-chain-correlator + prompt-injection-prober, all-deterministic scan mode. **Fails CLOSED on lab-diversity loss.**

## Reading Order

1. **CLAUDE.md** — framework config, identity pointer
2. **AGENTS.md** (this file) — router to all agent docs
3. **PROJECT.md** — project-specific context
4. **alpha.md / beta.md / gamma.md / delta.md / epsilon.md** — individual agent identities
5. **_system/agent-system.md** — detailed operational spec
6. **president/_system/{mode}/protocol.md** — mode-specific orchestration
7. **.claude/manifest.json** — project metadata, features, agent providers
8. **.claude/paths.json** — centralized path registry
