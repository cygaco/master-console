# MC Roadmap

Post-MVP work. Items grouped by phase.

---

## Phase 1 — Ship-week hardening (2026-04-17 target)

### Path System (Command 1 from session 2026-04-16)
The paths.json registry is the single source of truth for dir/file locations. Current state: 37 keys. Goal: every `.claude/*`, `scripts/hooks/*`, and shared file referenced by skills/hooks/agents resolves via `paths.json`, never hardcoded.

- [x] Expand `paths.json` from 20 → 37 keys (add eventsFile, learningsFile, tracesFile, systemsFile, judgmentModel, judgmentRecommendations, betaEvents, lexicon, pathsLib, loggerLib, betaSourceData, toolsFile, requirementsFile, requirementsStagedFile, hookLib, patterns, requirements)
- [x] Update `lib/paths.js` fallback to match
- [x] Update `warp-setup.js` to emit the expanded paths.json at install time
- [x] Install `path-guard.js` hook — warns (optionally blocks with `PATH_GUARD_STRICT=1`) when stale paths are written to skills/agents/hooks
- [ ] **Follow-up:** migrate the remaining ~80 skill references that write paths as prose literals (e.g. "Write to `.claude/project/memory/learnings.jsonl`") to reference `PATHS.learningsFile` semantically — partial; ongoing per-skill work
- [x] **Follow-up:** `/paths:validate` skill — shipped as `/paths:doctor` (commands/paths/doctor.md)
- [x] **Follow-up:** `/paths:add` skill — interactive helper (commands/paths/add.md)

### Events & Logging
Current: `logger.js` abstracts appends to `events.jsonl`; `memory-guard.js` blocks direct writes. Smart-context reads events for context injection.

- [x] memory-guard fixed to not block `2>&1` fd redirects (false positive blocked read commands)
- [x] **Follow-up:** dedicated `/events:tail`, `/events:query` skills — c15514b (Phase A1)
- [ ] **Follow-up:** events retention policy — partial. `skill-usage.jsonl` carries its own 5MB lazy-rotation in `scripts/hooks/skill-counter.js` (bccddc2). `events.jsonl` retention is NOT yet executable — `/sleep:deep` lists rotation as a manual phase but does not automate it. Lifting this to a deterministic, threshold-driven hook is the remaining work.
- [x] **Follow-up:** structured query language for events.jsonl — `/events:query` supports `--type`, `--since`, `--until`, `--grep`, `--json` (c15514b)

### Installer — Created vs Assumed model
Current: 13-step install. 8 items are CREATED (paths, manifest, store, memory, settings, dirs), 5 items are ASSUMED (agents, skills, hooks, reference, CLAUDE.md copied verbatim).

- [x] `warp-setup.js` generates paths.json v3 with all keys (CREATED)
- [x] Registers the 31 real hooks (not phantom ones)
- [x] MC repo no longer ships a committed `paths.json` — clients get one built by the installer
- [x] **Phase 1 ship blocker:** `.gitignore` mutation — implemented in `scripts/warp-setup.js` (idempotent block between markers)
- [x] **Interview phase** — `scripts/warp-setup.js#ask` collects project name, pitch, main branch, MC source, ANTHROPIC_API_KEY
- [ ] **Tool-detected hook bundles** — partial. Hooks register unconditionally today; tooling-aware skipping happens *inside* hook bodies via `command -v <tool>` self-check. Promoting this to a registry-level `requires` field is deferred.
- [ ] **Requirements pre-fill** — deferred. `/warp:init` not yet authoring CORE_BRIEF/PRODUCT_MODEL/GLOSSARY/USER_COHORTS.
- [x] **Parameterize `/warp:*` repo URLs** — `/mc:check`, `/mc:update`, `/warp:promote` read `manifest.mc.source`
- [x] **Parameterize project name** — manifest.project.name flows to skills/docs
- [ ] **Install-test harness** — deferred. `warp-setup.js --dry-run` on tmp dir not yet implemented.
- [x] **`/mc:update` skill** — `.claude/commands/mc/update.md`
- [x] **`/mc:uninstall` skill** — `.claude/commands/mc/uninstall.md`

### Gaps from the Created vs Assumed audit

Items that are currently NEITHER created NOR assumed (just missing):
- `.gitignore` runtime exclusions — **leak risk**
- Main branch name — assumed "main" everywhere
- Project name — used basename, no override
- Git remote URL — hardcoded in `/mc:sync`
- `.env.example` template
- Environment flavor selection (minimal / full / security-heavy bundles)

---

## Phase 2 — Skills & systems

### Cross-provider agent diversity (high priority)

**Problem:** all review and security agents currently run on Claude (same model that generates the code under review). Same-model review is blind to shared failure modes. Per Alex β decision 2026-04-16: "having the same model review its own work is not good."

**Solution:** route review-layer agents through OpenAI CLI (`codex`), security orchestration through Gemini CLI. Uses the existing `store.compliance` CLI-bridge pattern, generalized.

Target model mapping:

| Agent | Provider | Model | Rationale |
|---|---|---|---|
| alpha, beta, gamma, delta | Claude | sonnet (or inherit) | Orchestration, judgment continuity — keep Claude |
| builder (×2), fixer (×2) | Claude | sonnet | Code generation — Claude is tuned here |
| **evaluator (×2)** | **OpenAI** | **gpt-5.4** | Deep review with different lens; 1M context fits spec+code+fixtures |
| **compliance (×2)** | **OpenAI** | **gpt-5.4** | Adversarial integrity — flagship, not mini |
| **auditor (oneshot)** | **OpenAI** | **gpt-5.4-mini** | Cross-cycle pattern synthesis; many small inputs |
| **qa (×2)** | **OpenAI** | **gpt-5.4-mini** | 13 failure-mode personas × volume |
| **redteam (×2)** | **Gemini** | **gemini-2.5-flash** | 11 attack-chain personas — different adversarial training corpus |

Implementation:
- [x] Extend `manifest.providers` — DEFAULT_PROVIDERS in `scripts/hooks/lib/providers.js`; manifest opts in
- [x] Add `manifest.agentProviders` mapping role → provider
- [x] `scripts/hooks/lib/providers.js` — wraps `execSync` calls to `codex` / `gemini`
- [x] γ/δ dispatch reads `agentProviders[<role>]` via `scripts/dispatch-agent.js`
- [x] `/scan:environment` verifies `codex` and `gemini` CLIs
- [x] Fallback: CLI missing → fallback signal returned; orchestrator uses Claude
- [x] Per-agent prompts in .md
- [x] Response parsing adapter — `parseProviderJson`, `validateAgentOutput` in dispatch-agent.js

Effort: ~6 hours. First post-ship week.

### Token usage optimization (deferred per user directive)

Not a ship blocker. Once cross-provider is live:
- [ ] Track per-agent token usage in events log — category `provider-call`
- [ ] Per-provider cost dashboard (estimate from token counts)
- [ ] Prompt compression for GPT/Gemini — the Claude-tuned prompts are often verbose; condense for cross-provider
- [ ] Cache the "system/identity" portion of review prompts where provider supports it (OpenAI prompt caching, Gemini context caching)
- [ ] Tiered fallback: gpt-5.4 → gpt-5.4-mini → claude if primary times out or rate-limits
- [ ] Per-agent model override via env var (`MC_EVALUATOR_MODEL=gpt-5.4-mini`) for cost-sensitive users

### Missing skills identified in audit
- [x] `/scan:system` — `commands/scan/system.md`
- [x] `/scan:privacy` — `commands/scan/privacy.md` (78bce2c, Phase A4)
- [x] `/scan:install` — `commands/scan/install.md` (78bce2c, Phase A4)
- [x] `/scan:hooks` — covered by `/hooks:test`
- [x] `/mc:doctor` — `commands/mc/doctor.md`
- [x] `/mc:update` — see Installer section above
- [x] `/mc:uninstall` — `commands/mc/uninstall.md`
- [x] `/agents:list` + `/agents:test` — c15514b (Phase A1)
- [x] `/paths:validate` (as `/paths:doctor`) + `/paths:add` — see Path System above
- [x] `/linters:run` — `commands/linters/run.md` (fc6494d, Phase A3)
- [x] `/manifest:show`, `/manifest:validate`, `/manifest:migrate` — e4df99c (Phase A2)
- [x] `/docs:catalog` — `commands/docs/catalog.md` (fc6494d, Phase A3)

### Existing skill follow-ups
- [ ] `/research:deep` — 728 lines, likely untested, model versions stale. Either validate end-to-end OR deprecate in favor of `/research:simple`
- [ ] `/research:simple` — add synthesis phase (merge reports → SYNTHESIS.md)
- [ ] `/sleep:deep` — operationalize vague phases (1c dedup algorithm, 1e pattern threshold, 4 REM dream templates)
- [ ] `/ui:review` — genericized (no longer hardcodes a product name); add parameterized design-system path support
- [ ] `/retro:code`, `/retro:full` — remove stale "retro directory" manifest.json references; either hard-code `.claude/project/retros/` or make optional
- [ ] `/mc:sync` — add fallback if `../MC/version.json` doesn't exist (git tags / commit hash)
- [ ] `/warp:init` — parameterize GitHub URL (hardcodes `cygaco/MC.git`)

### Namespace reorganization
- [ ] Merge `/retro:context` + `/retro:code` into `/retro:full` as modes (not separate skills)
- [ ] Merge `/fav:list` + `/fav:search` into `/fav` with args
- [ ] Consider moving `/hooks:friction` analysis into `/scan:patterns propose`

---

## Phase 3 — Product-as-product

Treat MC itself as a product-in-MC with its own `_requirements/04-features/`:
- [x] Write PRDs for installer, session-lifecycle, paths-resolution, hook-pipeline — c871ff9 (Phase C). Each folder = PRD/STORIES/CONTRACTS/TRACE with snapshot frontmatter and citation anchors. Drift detector: `node scripts/check-prd-anchors.js _requirements/04-features/<folder>/`.
- [ ] Spec the Alex agent team as a feature with stories — deferred follow-up
- [x] Run `/preflight:run` against MC itself — converted from recurring goal to concrete artifact in `runtime/notes/mc-self-preflight-2026-05-02.md` (Phase D). Recurring variant left as `/schedule` candidate.
- [ ] Run `/qa:audit` and `/redteam:full` on MC — deferred; better suited to scheduled routine than one-shot

---

## Phase 4 — Observability & UX

- [ ] `agent-dashboard.js` turned into a real browser UI (currently CLI-style) — **deferred to separate workstream.** This is productized work, not roadmap work; tracked outside the roadmap doc.
- [x] Skills get a usage counter — bccddc2 (Phase B). `scripts/hooks/skill-counter.js` on UserPromptSubmit appends to `paths.skillUsageFile`. `/skills:cleanup` Phase 2c reads it.
- [x] `/mc:tour` version 2 — `commands/mc/tour.md` (interactive walkthrough)
- [x] `USER_GUIDE.md` → split into tutorial + reference — sections §1–§10 structured

---

## Notes

- All changes must ship to both `jobhunter-app` and `MC` during co-development. Use `/hooks:sync` pattern (extended to skills too).
- Privacy audit required before every public push. `/scan:privacy` should be the gate.
- Main branch must stay shippable at all times. Exploratory work happens on feature branches. (This is §2 of `USER_GUIDE.md` — the #1 newbie trap.)
