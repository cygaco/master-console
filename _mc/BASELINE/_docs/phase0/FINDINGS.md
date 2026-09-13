# Phase 0 Findings — MC Framework Reliability

Inspection date: 2026-05-11. Branch: `main`. Version: `0.2.2`.

This is the compact pre-implementation findings note required by the Phase 0
prompt. Each workstream below records: what already exists in the repo, what
is missing, the proposed file-level scope, whether tests are required, and
known primitive limits we cannot fix here.

## A. /mc:flag and /warp:promote drain workflow

- `/warp:promote` exists at `.claude/commands/warp/promote.md` and the engine
  lives at `scripts/mc/promote.js`. **Its scope is source → canonical
  framework-file propagation**, not a flag-ledger drain. The two concerns
  share a name but not an implementation.
- **No `/mc:flag` command** exists.
- **No `mc-to-update.md` ledger convention** is documented anywhere in
  the repo. Recent issue logs reference flagged items but no ledger file.

Scope:
- New `.claude/commands/mc/flag.md` (skill doc).
- New `scripts/mc/flag.js` (engine — append entries to repo-local
  `mc-to-update.md`).
- Extend `.claude/commands/warp/promote.md` with a documented drain
  contract; add `scripts/mc/promote-flags.js` (engine — read open
  flags, group by category, mark `promoted`/`blocked`/`deferred`, write
  promotion report under `.mc/promote-reports/`).
- New `.mc/promote-reports/` and `mc-promoted-archive.md` (created
  on first drain, gitignored where appropriate).

Tests: lightweight Node CLI test for flag append + drain mark.
Primitive limits: none.

## B. Dispatch route guard

- Canonical safe path: `node scripts/dispatch-agent.js <role> <prompt-file>`
  (confirmed in `scripts/dispatch-agent.js` and Gamma/Delta specs).
- Gamma and Delta already document the canonical dispatch pattern, but their
  bash snippets use `claude -p --model sonnet --agent <role>` directly for
  the **Claude-provider** path. This is *acceptable* because `claude` is the
  harness CLI and Claude-as-claude is the existing fallback contract — but
  raw `codex exec ...` / `gemini ... -p` / `cat file | codex exec` from any
  Bash call site is the failure mode we must block.
- There is **no `PreToolUse` Bash hook that scans for raw cross-provider CLI
  prompt invocation**. `merge-guard.js` allowlists `codex` and `gemini` as
  generally permitted commands (lines 73-74), which currently lets every
  raw invocation through.
- `scripts/hooks/lib/providers.js` shells out via `execSync` and is the
  *only* sanctioned dispatch path.

Scope:
- New `scripts/hooks/dispatch-route-guard.js` (PreToolUse on `Bash`). Blocks
  raw `codex exec`, `gemini ... -p` / `gemini -p`, `cat …| codex|gemini`,
  AND `claude -p` *when invoked outside the agreed fallback paths*.
  Allowlist: `codex --version`, `gemini --version`, `gemini --help`,
  `claude --version`, `node scripts/dispatch-agent.js`,
  `claude -p --agent <role>` (the documented fallback), and provider health
  probes (env `WARPOS_PROVIDER_PROBE=1`).
- Register the new hook in `.claude/settings.json` under `PreToolUse` /
  matcher `Bash`.
- Update `.claude/agents/00-alex/gamma.md` and `delta.md` to add the
  forbidden-pattern rule and the mandatory dispatch-guide read.
- Update `scripts/hooks/merge-guard.js` to drop `codex `/`gemini ` from
  its blanket allowlist so the new guard fires first.

Tests: small fixture-style tests for the guard's pattern matcher; existing
`scripts/test-merge-guard-cd-prefix.js` is the pattern to follow.
Primitive limits: none.

## C. Dispatch telemetry, dead-lock pruning, silent-death log

- `scripts/hooks/lib/concurrency-lock.js` already implements per-provider
  slot locks under `.claude/runtime/dispatch-locks/<provider>/`. **Lock
  content today is only `"<pid> <ts>\n"`** — no role, provider, model,
  prompt_bytes, cmdline_checksum, dispatch_id, cwd.
- Pruning is **lazy only** — happens inside `tryAcquireOnce`. There is
  **no eager prune at session-start** and no prune surfaced in
  `/mc:health` or `/mc:setup`.
- **No completion marker** is written after a dispatch.
- **No silent-death log**. The dispatch wrapper captures stdout via
  `execSync` but never persists a death record for empty-output exits.
- `runProvider` uses `stdio: ["pipe", "pipe", "pipe"]` — stderr is captured
  but only surfaced inside the catch block's `err.message`. There's no
  durable record of stderr for post-mortem.

Scope:
- Augment `concurrency-lock.js`: lock body becomes JSON with the metadata
  the spec calls for. Backward-compatible — keep filename naming.
- Augment `dispatch-agent.js`: emit a completion record + a JSONL line to
  `.claude/runtime/dispatch-deaths.jsonl` on silent zero-byte death or
  abnormal exit. Capture stderr-bytes and the last stderr/stdout mtimes.
- New `scripts/dispatch/prune-dead-locks.js` (eager prune; surface via
  `/mc:health`).
- Update `/mc:health` and `/mc:setup` skills to run the eager pruner.

Tests: extend `scripts/test-concurrency-lock.js` to assert lock metadata
shape; new `scripts/test-dispatch-deaths.js` to assert death record on
empty-stdout subprocess.
Primitive limits: none.

## D. Agent dispatch guide auto-load

- **No `agent-dispatch-guide.md` exists** anywhere in the repo (verified
  via filename search across `.claude/`, `_docs/`, and root).
- Gamma/Delta dispatch rules currently live inside each agent's own
  frontmatter body. Session-start hook does not reference a guide.

Scope:
- New `.claude/project/reference/agent-dispatch-guide.md` (compact
  canonical doc covering the canonical wrapper, forbidden raw patterns,
  fallback contract, stdin/binding-gap reason).
- New `paths.agentDispatchGuide` key in `.claude/paths.json`.
- Update `.claude/agents/00-alex/gamma.md` and `delta.md` to require
  reading the guide before any orchestrator dispatch.
- Update `scripts/hooks/session-start.js` to append a compact
  "MANDATORY REFERENCE" block to `additionalContext` pointing at
  `paths.agentDispatchGuide` (one line, not the full guide).

Tests: a grep-style check that Gamma + Delta specs and session-start
context reference the guide.
Primitive limits: none.

## E. Provider health, Gemini hardening, setup sanity

- `providerAvailable()` in `providers.js` already calls `<cli> --version`
  with a 30s timeout — basic CLI presence works.
- `modelAvailable()` probes `gemini models list` once per 12 min. **No
  classification of quota-exhausted, free-tier-limit-zero, auth-source-
  mismatch, trusted-directory-required, or stale-cli-registry** — every
  failure surfaces as a generic "model not available" optimistic-true.
- Gemini CLI invocation is `gemini -m {model} -p` with `-o json` for JSON
  envelope. **No `--skip-trust` flag** is passed.
- **No `GEMINI_API_KEY` vs OAuth-personal mismatch warning** anywhere.
- `/mc:health` step 10 only reports "codex/gemini installed yes/no". No
  active probe.
- Existing redteam→gemini 75KB prompt safety fallback proves the fallback
  pattern (`dispatch-agent.js` lines 162-183). No general provider-fallback
  policy file.
- `_requirements/09-integrations/PROVIDER/03-google-gemini.md` is
  referenced in `scripts/dispatch/catalog.js` comment as the exclusion
  rationale for `gemini-2.5-pro`. The doc may or may not exist; will
  verify and create/update as needed in implementation.
- **ROADMAP.md backlog item** confirms `gemini-3.1-flash` and
  `gemini-3.1-flash-lite` in `catalog.js` return 404 from
  `v1beta` — already known field issue to surface in this workstream.

Scope:
- New `scripts/hooks/lib/provider-health.js` — classification helper
  returning `{ status, reason, suggestion }` for an ok/cli_missing/
  auth_missing/auth_source_mismatch/model_not_found/quota_exhausted/
  free_tier_limit_zero/stale_cli_registry/trusted_directory_required/
  provider_timeout/unknown_error states.
- New `scripts/mc/provider-health-check.js` CLI invoked by
  `/mc:health` and `/mc:setup`.
- Update `providers.js` Gemini invocation to pass `--skip-trust` when the
  trusted-directory bypass is required (gated by env or detected from
  CLI error output).
- New `paths.providerFallbackPolicy` → `.claude/agents/00-alex/.system/policy/provider-fallback.json`
  with documented chain syntax. Scaffold + docs only this phase.
- Update `smart-context.js` to warn once per session when
  `GEMINI_API_KEY` is set AND Gemini settings indicate `oauth-personal`
  (without leaking the secret value).
- Resolve or remove the dead reference in
  `scripts/dispatch/catalog.js` to `_requirements/09-integrations/PROVIDER/03-google-gemini.md`.

Tests: unit test for the classification helper; manual checklist for
`/mc:health` output.
Primitive limits: actual provider response details depend on installed
CLI versions; we cannot guarantee classification when the CLI changes its
error vocabulary.

## F. dispatch-agent.js mode-aware spec resolution

- `findAgentSpec(role)` in `scripts/dispatch-agent.js` (lines 52-90) walks
  `.claude/agents/` in arbitrary DFS order and picks the first matching
  `<role>.md` or `orchestrator.md`. The walk is non-deterministic w.r.t.
  mode.
- `.claude/agents/` has three mode subdirs: `00-alex`, `01-adhoc`,
  `02-oneshot`. Roles like `builder`, `reviewer`, `qa` exist in both
  `01-adhoc/` and `02-oneshot/` with subtly different specs.
- Current run mode marker: `.claude/agents/store.json` carries oneshot
  state; adhoc team state lives in built-in team primitives that are
  largely outside the repo. The simplest mode signal we can read is the
  presence of `.claude/agents/02-oneshot/.system/store.json#status` or
  `.claude/agents/store.json#mode`.

Scope:
- Update `dispatch-agent.js` to honour an optional `WARPOS_MODE` env var
  (`oneshot` | `adhoc`) when present; otherwise check
  `02-oneshot/.system/store.json#status === "running"` to infer oneshot;
  default `adhoc`. Resolution order: explicit env → mode-specific subdir
  → `00-alex` → first match.
- Document in the agent-dispatch-guide.

Tests: unit test asserting resolution order for an overlapping role.
Primitive limits: none.

## G. Framework manifest guard product-repo hygiene

- `scripts/hooks/framework-manifest-guard.js` activates whenever
  `.claude/framework-manifest.json` exists. In product installs the file
  *does* exist (copied during install) so the guard fires there too. If
  product `.claude/` is gitignored the user gets a message that names a
  file they cannot stage.
- Bypass message currently says: `Set WARPOS_MANIFEST_GUARD=off to bypass.`
  PreToolUse hooks read env from the harness, not from Bash-inline `VAR=v
  cmd`, so the message is misleading on Windows/PowerShell.
- No `.mc/manifest-guard-disable` sentinel exists.

Scope:
- Detect canonical-vs-product via two signals:
  1. Presence of `version.json` + `install.ps1` at repo root **and**
     `.claude/framework-manifest.json` not in `.gitignore` → canonical.
  2. Otherwise → product. (Cross-check: product installs always have
     `.claude/framework-installed.json`.)
- In product mode with `.claude/` gitignored: skip the staged-manifest
  requirement; instead verify the on-disk manifest exists and is fresh
  (mtime newer than the staged tracked files). Warn on stale, do not
  block.
- Add repo-local `.mc/manifest-guard-disable` sentinel support;
  document whether it should be gitignored (gitignored — it's a local
  escape hatch).
- Rewrite the bypass message: PowerShell + bash forms; explain
  harness-vs-bash env propagation.
- Log every bypass via `lib/logger`.

Tests: synthetic event JSON fed via stdin (existing
`scripts/test-merge-guard-rm.js` pattern).
Primitive limits: none in-repo; bash-inline env propagation is a Claude
Code harness behaviour we document rather than fix.

## H. Roadmap template pollution prevention

- `ROADMAP.md` at MC canonical root is framework content (Phase
  backlog). It is **not** in `framework-manifest.json`, so the installer
  does **not** copy it (verified — grep across installer found no `ROADMAP`
  references in copy paths).
- However, the framework backlog content is currently in a file named
  `ROADMAP.md` at the canonical root — a fresh product user who copies
  the MC clone (rather than running the installer) would inherit it.
  And future framework-roadmap promotion via `/warp:promote` is a
  conceivable footgun because `_requirements/` and `_docs/` ARE promoted.
- Product repos do not get an out-of-the-box product `ROADMAP.md`
  scaffold from the installer today.

Scope:
- Rename canonical `ROADMAP.md` → `WARPOS_ROADMAP.md` (framework backlog
  is now namespaced). Leave `ROADMAP.md` slot empty in canonical for
  product use.
- Add a clean product `ROADMAP.md` scaffold to the installer's
  `generated_files` set (only created if absent — never overwrites).
- Update `scripts/mc/promote.js` `EXCLUDE_PREFIXES`/explicit excludes
  to never propagate either `ROADMAP.md` or `WARPOS_ROADMAP.md` to
  downstream targets.
- Update references in `path-lint.js`, `scripts/paths/gate.js`, and any
  doc that names `ROADMAP.md` to also accept `WARPOS_ROADMAP.md`.

Tests: a check script that fails if installer's generated list would
overwrite an existing `ROADMAP.md`.
Primitive limits: none.

## I. Minimal adhoc team lifecycle safety

- `.claude/commands/mode/adhoc.md` exists. The teammate roster references
  the built-in Claude Code team primitives (TeamCreate, SendMessage,
  maxTurns). **These primitives are not repo-accessible** — they live in
  the harness.
- Existing `scripts/hooks/team-guard.js` enforces team membership but
  does not detect stale teams.
- No `.claude/agents/store.json#mode` field today; adhoc team state lives
  in harness session state.

Scope:
- Update `.claude/commands/mode/adhoc.md` with explicit stale-team
  classification (fresh / stale / defunct / unknown) and a checklist for
  manual reuse-vs-rebuild decisions.
- Add a one-line `claim_on_startup: false` directive to every teammate
  spawn prompt in `adhoc.md`.
- Add a session-start nudge: if `.claude/runtime/.team-marker` exists and
  is older than 24h, print a warning suggesting `/mode:adhoc` recreate.
  (Marker is best-effort because we cannot read harness team state.)
- Document the harness-primitive limit explicitly in the adhoc doc.

Tests: smoke check that adhoc.md contains the new sections.
Primitive limits: TeamCreate / SendMessage / maxTurns reap behaviour all
live in built-in primitives — we document and add prompt-level
guardrails but cannot enforce.

## J. Requirement write-time linting foundation

- Existing linters: `scripts/lint-prds.js`, `scripts/lint-stories.js`,
  `scripts/lint-hl-stories.js`. They are **invoked manually or by
  `/linters:run`** — not on Edit/Write of requirement files.
- `scripts/requirements/config.js` exports `ID_PATTERNS` for
  `granularStory`, `highLevelStory`, `crossStandard`, `reqStandard` —
  this is the canonical regex source.
- `scripts/hooks/merge-guard.js` runs `git merge` checks but does not
  invoke requirement linters.
- The Phase 0 prompt notes downstream consumers caught format issues at
  merge that were too late.

Scope:
- New `scripts/hooks/requirement-format-guard.js` PreToolUse on
  `Edit|Write` for paths matching `_requirements/**/PRD.md`,
  `_requirements/**/STORIES.md`, `_requirements/**/HL-STORIES.md`,
  `_requirements/_shared/CROSS-STANDARDS.md`.
- Hook uses `config.js#ID_PATTERNS` as the source of truth (no new
  regexes). Validates new IDs being added in the diff.
- Warn-only by default; block when `REQUIREMENT_GUARD_STRICT=1` or when
  a file contains `<!-- requirement-format-strict -->`.
- Register hook in `.claude/settings.json` under `PreToolUse` /
  `Edit|Write`.
- Add legacy/grandfather notes: existing `S-1` style IDs in older specs
  are NOT auto-rewritten. The guard only checks newly-added lines, not
  pre-existing content.

Tests: unit-style fixture file with valid + invalid IDs, asserting
classify output.
Primitive limits: none.

## K. Docs, tests, validation, version/capsule

- Version is `0.2.2`. Next release bump is part of this phase.
- Capsule generator: `scripts/mc/release-build.js`. It snapshots the
  current `framework-manifest.json` and version. Need to ensure the new
  guards/scripts are tracked.
- `_docs/phase0/` directory will host findings + plan + final report.
- No changelog file exists at repo root; release notes live in
  per-version capsule outputs and `version.json#notes`.

Scope:
- Write `_docs/phase0/IMPLEMENTATION_PLAN.md` (next step).
- Write `_docs/phase0/FINAL_REPORT.md` after implementation.
- Update `.claude/framework-manifest.json` after new hooks/skills are
  added (regenerator script handles this).
- Bump `version.json` to `0.3.0` and write capsule via
  `release-build.js`.
- Add `_docs/phase0/CHANGELOG_0.3.0.md` for the bump notes.

## Summary table

| Workstream | Repo-accessible? | Tests required? | Notes |
|---|---|---|---|
| A — flag/promote drain | yes | smoke | new files only |
| B — dispatch-route guard | yes | yes | new hook + spec edits + settings reg |
| C — telemetry & death log | yes | yes | augment locks + new prune CLI |
| D — dispatch guide auto-load | yes | grep-check | new doc + spec/session-start edits |
| E — provider health | mostly | yes | classification + scaffolded fallback |
| F — mode-aware specs | yes | unit | small dispatch-agent change |
| G — manifest guard hygiene | yes | smoke | hook detection + bypass msg |
| H — roadmap pollution | yes | smoke | rename + installer scaffold |
| I — adhoc lifecycle | partial | grep-check | docs only; primitives are out of repo |
| J — requirement write-time lint | yes | unit | new hook reuses existing config |
| K — docs/tests/version | yes | manual | bump 0.2.2 → 0.3.0 |

End of findings.
