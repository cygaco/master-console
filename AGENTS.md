# Alex Agent System

> Router and table of contents for the multi-agent build system.
> For the full operational specification, see [agent-system.md](.claude/agents/_system/agent-system.md).

---

## Entering-agent preamble

New here? Read this block first, then act. It is single-sourced from `.claude/project/reference/entry-preamble.md` and hash-parity-checked by `scripts/checks/entry-preamble-parity.js` (edit the canonical source, not this copy). Per-executor entrypoints: `CODEX.md` (Codex/GPT), `ANTIGRAVITY.md` (Antigravity/`agy`; the Gemini family routes through `agy` — the former `GEMINI.md` tombstone was removed per the ADR-0036 removal-trigger).

<!-- WARPOS:ENTERING-AGENT-PREAMBLE:BEGIN v1 -->
**What this repo is.** WarpOS is a framework for running an autonomous AI software company. Work is delivered by mode-selected *faces* of a single operator persona, plus departmental agents (Product, Engineering, Growth). Identity, the autonomy ceilings, and the full operating doctrine live in `CLAUDE.md` — this preamble asserts none of them; it points you there.

**Read order — once, then act.**
1. `DUMP.md` (repo root, local) — the session handoff: next action, in-flight state, verbatim payloads. Read once, then execute.
2. `TRACKER.md` (repo root) — the ENFORCED source of truth. It OUTRANKS `DUMP.md`, this preamble, and your own assumptions. Validate with `node scripts/trackers/validate.js` (must exit 0) before AND after meaningful work; on any disagreement, the tracker wins.
3. `CLAUDE.md` (repo root) — the operating doctrine: autonomy, dispatch, and policy/enforcement + refactor/rename hygiene. Its RULES apply to every executor; the harness-specific mechanics may not.

**Dispatch is CLI-first.** Agent dispatch runs through the CLI wrappers — `node scripts/dispatch-claude.js <role> <prompt-file> -w` for build-chain Claude roles, `node scripts/dispatch-agent.js <role> <prompt-file>` for cross-provider reviewers. CLI is mandatory; a provider API is used ONLY where there is no CLI equivalent. Cross-provider review diversity is required, and a binding FAIL cannot be overridden.

**Guards, gates, and output destinations.** The repo's guarantees are enforced: the `refs/heads/main` reference-transaction fence (every write to main goes through the broker), `/scan:full`, and the release gates. Every policy names an enforcer or logs the debt. Write per-run output under `runtime/`, never a manifest-tracked project dir. Orchestrators hold envelopes, not content — heavy work goes to a subprocess that writes its full output to a file and returns a short envelope. Regenerate both manifests after editing any hash-tracked file.

**For identity, authority, and the complete rules, read `CLAUDE.md`.**
<!-- WARPOS:ENTERING-AGENT-PREAMBLE:END -->

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
| **Ops-Analyst** | Cross-cycle pattern analysis, environment evolution (S-7: was Learner) | [ops-analyst](.claude/agents/president/ops-analyst.md) |
| **Skeleton-Builder** | Regenerates skeleton stub files from current spec (S-7: was Stub-Scaffold) | [skeleton-builder](.claude/agents/engineering/skeleton-builder.md) |
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

The roster runs a **provider-by-department** model spread (ADR-0016 / DISPATCH.md §8, 2026-07-16). The single source of truth for every role's provider·model·effort·fallback is the keystone [_org/role-registry.json](.claude/agents/_org/role-registry.json); routers and enforcers read from there.

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
| OpenAI (`codex`) | `gpt-5.6-sol` (flagship) · `gpt-5.6-terra` (mid) · `gpt-5.6-luna` (cheap) | Product + Growth judgment/authoring; cross-lab reviewers. Never the bare `gpt-5.6` alias (400s + silently degrades). |
| Anthropic (`claude`) | `claude-fable-5` (top brain) · `claude-opus-4-8` (conductors/leads/hunters + THE fallback target) · `claude-sonnet-5` (builders/fixers/legwork) | Engineering; in-process judgment. Retired: `claude-sonnet-4-6`, any Opus < 4.8. |
| Gemini via Antigravity (`agy`) | `gemini-3.1-pro-high` (thinking always-on; our dispatch passes no `--effort` and MUST NOT — `agy` exposes `--effort` in `--help` but it is MODEL-GATED: Gemini 3.1 Pro rejects it, exit 1 `not supported for model`, effort baked into the model name; probed 2026-07-24 agy 1.1.6, ED-277 closed not-wirable; see ANTIGRAVITY.md §2 — supersedes the DISPATCH.md spec's `-preview` id) | Security Gemini hunter lane · Growth research-lead. |

**Effort ladder:** `low · medium · high · xhigh · max · ultra`. `max` + `ultra` are for `sol`/`terra` only (`luna` caps at `max`). **Authors** (design/product/copy/conversion leads, qa-reviewer) run `xhigh`; **overseers/judges** (Directors, β, security judge, marketing-lead) run `high`. `ultra` = fans out parallel subagents (Cabinet, Ops-Analyst); `max` = maximum time on the single hardest indivisible problem (the Claude security-hunter lane).

**Per-department spread** (GPT = Product + Growth · Claude = Engineering · Security = 3-lab panel):

| Department | Role | Model @ effort | Route | Fallback |
|---|---|---|---|---|
| President | α President (run) | `claude-fable-5` @ high | the harness session (`/model`) | — |
| President | β Check (judgment) | `gpt-5.6-sol` @ high | **on-demand CLI consult per phase boundary** (NOT an in-process teammate) | `claude-opus-4-8` |
| President | γ / δ / ε conductors | `claude-opus-4-8` @ xhigh | in-process / standalone | — |
| President | ζ Cabinet · η Ops-Analyst | `gpt-5.6-sol` @ ultra | CLI | `claude-opus-4-8` |
| Product | Director-of-Product | `gpt-5.6-sol` @ high | CLI consult | `claude-opus-4-8` |
| Product | Product-Lead | `gpt-5.6-terra` @ xhigh | CLI consult | `claude-opus-4-8` |
| Product | Design-Lead | `gpt-5.6-sol` @ xhigh | CLI consult | `claude-opus-4-8` |
| Product | **Quality-Lead** | `claude-opus-4-8` @ high | **in-process — Claude-pinned carve-out** (Agent-tool fan-out) | — |
| Product | qa-reviewer | `gpt-5.6-terra` @ xhigh | CLI (13 personas inline) | `claude-opus-4-8` |
| Product | design-quality · visual-review | `claude-opus-4-8` @ high | Agent tool (Claude-pinned: visual judgment / Playwright-MCP) | — |
| Product | test-runner | `claude-sonnet-5` @ medium | CLI | — |
| Engineering | Director-of-Engineering | `claude-fable-5` @ high | in-process orchestrator | — |
| Engineering | frontend / backend / security leads | `claude-opus-4-8` @ high | in-process | — |
| Engineering | all builders + fixers | `claude-sonnet-5` @ high | CLI, isolated worktree | — |
| Engineering | frontend / backend reviewers | `gpt-5.6-sol` @ high | CLI (cross-lab vs the Claude builder) | `claude-opus-4-8` |
| Security | security-lead | `claude-opus-4-8` @ high | in-process (coordination) | — |
| Security | planner + final judge | `claude-fable-5` @ high | in-process | — |
| Security | hunter · Gemini lane | `gemini-3.1-pro-high` | CLI `agy` | **diversity-loss → fails CLOSED** |
| Security | hunter · GPT lane | `gpt-5.6-sol` @ xhigh | CLI | **diversity-loss → fails CLOSED** |
| Security | hunter · Claude lane | `claude-opus-4-8` @ max | in-process (Agent tool + `record-inprocess`) | — |
| Growth | Director-of-Growth | `gpt-5.6-sol` @ high | CLI consult | `claude-opus-4-8` |
| Growth | copy-lead · conversion-lead | `gpt-5.6-terra` @ xhigh | CLI consult | `claude-opus-4-8` |
| Growth | marketing-lead | `gpt-5.6-terra` @ high | CLI consult | `claude-opus-4-8` |
| Growth | research-lead | `gemini-3.1-pro-high` | CLI `agy` consult | `claude-opus-4-8` |

**Fallback policy (with teeth):** required **iff** `provider !== "claude"`; must differ from primary (claude→claude rejected); every OpenAI/Antigravity role → `fallback: claude` resolving to an explicit `claude-opus-4-8`. Outage-only, logged to the provider trace, alert on chronic fire. **Security fails CLOSED on lab-diversity loss** — a hunter falling back to Claude collapses the cross-lab guarantee → re-run or BLOCK.

**Topology doctrine (context economy):** the orchestrator holds **envelopes, not content**. Heavy/verbose work → CLI subprocess (isolated context; writes full output to a file; returns a ≤8-line envelope). Light small-return judgment → in-process Agent tool (**Claude-only** — the harness Agent tool cannot summon a GPT/Gemini role; **top-orchestrator-only** — subagents cannot call the Agent tool). **Carve-out rule:** Claude-pin any role whose function requires Agent-tool fan-out (Quality-Lead, design-quality, visual-review, the security Claude judge/hunter); provider-spread only leaf/synthesis roles.

**Greek call-signs = the President's office ONLY** (operator directive 2026-07-16). The five faces keep their letters (α β γ δ ε); `cabinet` = **ζ** and `ops-analyst` = **η** (office residents). Every department role had its Greek letter **stripped** — leads and directors are named by role, not glyph.

**Enforcers:** `scan:model-chain` (provider/model/effort policy), `scan:greek-office-parity` (glyph ⟺ office-membership bijection), `scan:dispatch-routing-parity`, `scan:provider-agent-tool-parity` (no `provider != claude` role carries Agent-tool reachability), `security-pass-count` (the 3-lab panel fired all lanes).

## Key Documents

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | Framework config, identity pointer, memory system |
| [PROJECT.md](PROJECT.md) | Project-specific context (product, architecture, env) |
| [agent-system.md](.claude/agents/_system/agent-system.md) | Full operational specification |
| [manifest.json](.claude/manifest.json) | WarpOS identity card — project metadata, features, phases, providers |
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

Every builder output runs a parallel gauntlet whose binding verdicts come from three review scopes (the old Evaluator/Compliance/Security/QA split collapsed here):
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
