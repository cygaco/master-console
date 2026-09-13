---
description: Verify MC installation — checks every system, reports green/yellow/red with plain-English fixes
---

# /warp:health — Installation Health Check

Verify that MC is properly installed and all systems are functional. Reports each system as green (working), yellow (degraded), or red (broken) with clear fix instructions.

## Procedure

Run ALL checks below. For each, report the status and any fix needed.

### 1. Directory Structure
Check these directories exist:
- `.claude/` — main config directory
- `.claude/project/events/` — event log
- `.claude/project/memory/` — learnings, traces, systems
- `.claude/project/maps/` — relationship graphs
- `.claude/project/reference/` — reasoning frameworks
- `.claude/runtime/` — session state
- `.claude/agents/` — agent definitions
- `.claude/commands/` — skills (slash commands)
- `scripts/hooks/` — hook implementations
- `scripts/hooks/lib/` — shared hook libraries

If any missing: RED — "Run the MC installer again or create the directory manually."

### 2. Core Files
Check these files exist:
- `.claude/paths.json` — centralized path registry
- `.claude/manifest.json` — project configuration
- `.claude/settings.json` — hook registrations
- `CLAUDE.md` — framework identity doc

If paths.json missing: RED
If manifest.json missing: YELLOW — "Run /warp:init to generate one from your project."
If settings.json missing: RED — "Hooks won't fire without this."
If CLAUDE.md missing: YELLOW — "The system works but Alex won't have identity context."

### 3. Hooks
Read `.claude/settings.json` and verify hooks are registered for:
- `SessionStart` — at least 1 hook
- `UserPromptSubmit` — smart-context should be here
- `PreToolUse` — security and guard hooks
- `PostToolUse` — session tracker, edit watcher
- `Stop|SessionEnd|StopFailure` — session stop

For each missing lifecycle event: YELLOW — "Some automation won't work."
If no hooks at all: RED — "Hooks are the backbone. Re-run the installer."

### 3.5 Experimental agent-teams flag (legacy)
Read `.claude/settings.json` and report `settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` as **informational only**.

Why this is now legacy: as of Claude Code v2.1.178 (2026-06-15) the agent-teams tools (`TeamCreate`/`TeamDelete`) were removed and teams became implicit + session-scoped — a teammate is created by spawning a named background subagent via `Agent(run_in_background: true)`, and the harness auto-creates the session team. The `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` flag is being phased out. `/mode:adhoc` documents persistent β/γ teammates created via the `Agent` background-subagent spawn + `SendMessage` (see RT-005, L-2026-05-14-verify-claude-code-primitives-before-declaring-absent).

If the flag is ABSENT: INFO — "No longer required; teams work without it on current Claude Code (v2.1.178+)."
If the flag is PRESENT (any value): INFO — "Harmless; legacy flag, being phased out — safe to remove."

### 3.6 Adhoc team hygiene
Run `node scripts/checks/adhoc-team-hygiene.js`. Flags any `~/.claude/teams/*` whose members carry a `-N` de-dup suffix (`Beta (β)-2`) or reference a stale `leadSessionId` — the W-21 cross-session accretion bug.

If flagged: YELLOW — "Reconcile via `SendMessage {type:\"shutdown_request\"}` to each stale member (NEVER edit `config.json` — that orphans a live in-process agent), then re-spawn. See `/mode:adhoc` Step 1.75 (reconcile-before-spawn)."

### 4. Agent System
Check `.claude/agents/` has:
- `president/alpha.md` — orchestrator
- `president/beta.md` — judgment model
- `president/gamma.md` — adhoc builder
- `president/delta.md` — oneshot runner
- `president/_system/adhoc/` — adhoc mode agents
- `president/_system/oneshot/` — oneshot mode agents

If alpha.md missing: RED — "Core agent missing."
If any sub-agents missing: YELLOW — "Some build modes won't work fully."

### 5. Memory Stores
Check these files exist (can be empty):
- `.claude/project/events/events.jsonl`
- `.claude/project/memory/learnings.jsonl`
- `.claude/project/memory/traces.jsonl`

If missing: YELLOW — "Create empty files. They'll populate as you use the system."

### 6. Skills
Count `.md` files in `.claude/commands/`. Report total.
If < 10: YELLOW — "Fewer skills than expected. Check the installer ran correctly."
If 0: RED — "No skills installed."

### 7. Reference Docs
Check `.claude/project/reference/` has:
- `reasoning-frameworks.md`
- `operational-loop.md`
- `learning-lifecycle.md`

If any missing: YELLOW — "Reasoning engine will work but without documentation."

### 8. Git
Check `.git/` exists and `git status` works.
If not a git repo: YELLOW — "Builder isolation (worktrees) won't work. Run: git init"

### 9. Smart Context
Check if `ANTHROPIC_API_KEY` is set in environment or `.env.local`.
If missing: YELLOW — "Smart context (prompt enrichment) won't work. The system still functions but without automatic context injection. Set your API key in .env.local."

### 10. Optional Tools
Check for (report as informational, not blocking):
- `codex` CLI — for cross-model compliance reviews
- `gemini` CLI — for research diversity
- `yt-dlp` — for YouTube transcript ingestion

For each missing: INFO — "Optional. Install for enhanced features."

### 11. Provider Health — Dispatch Readiness (Phase 0)

Run `node scripts/mc/provider-smoke.js --per-role`.

This performs a **full dispatch-readiness sweep**: it probes each configured
provider for CLI presence + auth, AND resolves each build-chain role's
provider + model the way real dispatch does, pinging the non-Claude ones.
Report each provider as green/yellow/red, then report the per-role
reachability block that the smoke renders:

```
Per-role reachability (dispatch resolution path):
────────────────────────────────────────────────
  ok   builder     claude  (default)                claude is the harness; always reachable
  ok   reviewer    openai  gpt-5.5                  ping ok
  xx   redteam     gemini  gemini-3.1-pro-preview   model_unavailable: …
  !!   compliance  openai  gpt-5.5                  fellback: silent downgrade detected
```

Surface the per-link status (role / provider / model / status) for every role.
A LOUD per-link verdict helps the operator pinpoint whether it is the CLI,
model subscription, auth, or permissions that is broken.

**Exit-code contract (PRD R-7):**
- **Exit 2** — at least one role or provider is RED (model unavailable,
  unreachable, unresolved, or error). This is a real dispatch-readiness
  failure — a role pinned to a model unavailable on the account, a missing
  CLI, or a broken auth. A non-zero exit is a **RED health result**, NOT a
  passing one. Fix the flagged role before dispatching.
- **Exit 0** — all green, OR yellow-only (fallbacks exist; dispatch will work
  but may lose diff-model coverage). Yellow is non-blocking for now.

This replaces the old `provider-health-check.js --summary` call which always
exited 0 even on a red verdict (false-green, now fixed in 0.18.1).

States recognised — **provider-level** (per `scripts/hooks/lib/provider-health.js`):
`ok`, `cli_missing`, `auth_missing`, `auth_source_mismatch`,
`model_not_found`, `quota_exhausted`, `free_tier_limit_zero`,
`stale_cli_registry`, `trusted_directory_required`, `provider_timeout`,
`unknown_error`.

States recognised — **per-role** (per `scripts/mc/provider-smoke.js#classifyPerRole`):
`ok` (reachable), `resolved` (--no-ping: provider+model resolved, ping skipped),
`fellback` (YELLOW — ran but silently downgraded to claude, loses diff-model coverage),
`model_unavailable` (RED — model pinned in role spec is not served on this account),
`unreachable` (RED — CLI present but ping failed),
`unresolved` (RED — could not resolve provider for role),
`error` (RED — runProvider threw).

### 11.5 Dispatch Readiness — static auth-tier table (WI-04 / C-3)

Run `node scripts/checks/dispatch-readiness.js`.

This is the **static, no-token complement** to Section 11's live smoke. Before
spending a dispatch it walks every provider + every build-chain role offline and
reports a PASS/PARTIAL/FAIL table across four axes: **CLI installed?**, **model id
valid (not a ghost)?**, **effort/flags valid?**, and **auth tier (OAuth vs key vs
none)**. The auth-tier column surfaces the WI-19 axis: a gemini row showing
`oauth` means a paid login is in use; `key` means free-tier API key only (a
PARTIAL — free-tier quota risk); `none` is a FAIL (run `gemini auth login`).

Read-only and **fail-open** — exits 0 even on FAIL so it never blocks
`/warp:health`. Report each provider's verdict and any GHOST/EFFORT/auth lines.
- Provider FAIL → RED: "Fix before dispatching — see the row's reason
  (missing CLI, ghost model, or no auth)."
- Provider PARTIAL → YELLOW: "Dispatch will work but is degraded (effort
  mismatch, or gemini on a free-tier key instead of a paid OAuth login)."
- All PASS → GREEN.

When this is green, Section 11's live `--per-role` ping confirms real
reachability. (Pass `--strict` to make it exit 2 on any FAIL for a CI gate.)

### 11.6 Provider Tier Readiness — T1/T2/T3 (S-LC-10)

Run `node scripts/mc/provider-tier-check.js`.

This **layers a tier grade over** Sections 11/11.5's health stack (it reuses
`dispatch-readiness.js` + `auth-resolver.js`, never duplicating them) and answers
a question reachability alone cannot: **is each provider funded / subscribed to
the floor the operator selected?**

- **T1 — reachable**: CLI installed + auth present (the existing health checks).
- **T2 — funded/keyed**: T1, plus a value-free funding signal — an API key NAME
  present (read value-free, never the secret) OR a paid OAuth login.
- **T3 — subscribed**: T2, plus the provider's subscription tier meets the
  configured **floor** (operator-tunable, default `max_5x` for Claude). T3 is
  **value-free-undetectable** (no billing API), so it is confirmed only by
  **self-attestation** (the preferred-tier config) — never by running a paid
  call (infer-from-dispatch is rejected, §22 #3).

Claude is treated as a **fundable + sub-checked provider** (not auto-ok): it gets
T1 as the harness floor, but T2/T3 require a value-free key NAME or attestation.

Read-only and **fail-open** — the check exits 0 always. Report each provider's
verdict:
- `tier_met` → GREEN ("meets the selected tier").
- `tier_short` → YELLOW ("below the selected tier — see the row; set funding or
  lower the selected tier with `--set-tier`"). Confident (a value-free dimension).
- `unknown-self-attested` → INFO ("selected tier needs a subscription floor we
  can't detect value-free; self-attest it via `--set-tier <provider> t3 --sub
  <max_5x|pro|…>`"). Never a failure.

The preferred-tier config (`.claude/runtime/provider-tier-config.json`,
`paths.providerTierConfig`) is written ONLY behind the confirm-class
`--set-tier` / `--write` flag; this health read never mutates it.

### 12. Dispatch Hygiene (Phase 0)

Run `node scripts/dispatch/prune-dead-locks.js`. Report `scanned`/`removed_dead`
and per-provider before/after counts. Non-blocking — eager cleanup that costs
nothing when nothing is dead.

### 12.5 Orphaned Dispatch Subprocesses (E-TEAMS-MIGRATION-001)

Run `node scripts/dispatch/reap-orphans.js` (DRY-RUN — reports, kills nothing).
This detects ORPHANED MC dispatch subprocesses: a provider CLI (claude /
codex / gemini) whose `dispatch-*.js` wrapper was reaped by the harness (the
ED-039 / RI-004 reap class) and is still running with no completion record —
holding a model session + slot + memory. Distinct from §12: prune-dead-locks
clears the dead lock FILE; this finds the orphaned PROCESS.

Report `scanned` + `orphanCount` + the per-orphan `pid`/`age`/`cmd` lines. It is
**conservative by construction + fail-open** — a process is flagged ONLY when its
command line matches a MC dispatch signature AND its parent is dead/reparented
AND it is older than ~20min AND it holds no fresh concurrency lock AND it is not
this session's own tree; any ambiguity ⇒ it is SKIPPED (a missed orphan is cheap;
killing a live builder loses uncommitted work).

- `orphanCount: 0` → GREEN ("no orphaned dispatch subprocesses").
- `orphanCount > 0` → YELLOW with the offending pids: "orphaned dispatch
  subprocess(es) detected — reap with `node scripts/dispatch/reap-orphans.js
  --apply` (SIGTERM-first; tree-terminate on Windows)." The apply is a deliberate
  operator action, never automatic.

## Output Format

```
MC Health Check
═══════════════════

  ✓  Directory structure         All 10 directories present
  ✓  Core files                  paths.json, manifest.json, settings.json, CLAUDE.md
  ✓  Hooks                       6 lifecycle events registered
  ✓  Agent system                4 Alex agents + adhoc + oneshot teams
  ✓  Memory stores               3 stores ready
  ✓  Skills                      64 skills installed
  ✓  Reference docs              3 frameworks available
  ✓  Git                         Repository initialized
  !  Smart context               ANTHROPIC_API_KEY not found — set in .env.local
  ─  Optional: codex             Not installed (npm i -g @openai/codex)
  ─  Optional: gemini            Not installed
  ─  Optional: yt-dlp            Not installed

Result: HEALTHY (1 warning)
```

Use simple language. No jargon. If something is broken, tell them exactly what to do to fix it.
