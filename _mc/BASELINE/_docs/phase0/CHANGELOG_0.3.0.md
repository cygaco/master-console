# MC 0.3.0 — Phase 0 (Framework Reliability)

Released: 2026-05-11. Prior: 0.2.2.

This release lands the Phase 0 framework reliability prerequisites
required before Sprint Workflow v0.1. It's safety + observability +
upstream propagation plumbing — no new build features.

## Highlights

- **Dispatch route guard** stops raw `codex exec` / `gemini -p` /
  `cat foo | claude -p` calls from Bash before they re-trigger
  Windows-stdin and binding-gap failures.
- **Dispatch telemetry** — concurrency locks now carry JSON metadata
  (dispatch_id, role, provider, model, prompt_bytes, cmdline_checksum).
  Completion records land in `dispatch-completions.jsonl`. Silent
  zero-byte deaths are persisted to `dispatch-deaths.jsonl`. Eager
  dead-PID pruning runs at session-start and from
  `node scripts/dispatch/prune-dead-locks.js`.
- **`/mc:flag` + `/warp:promote-flags`** — repo-local
  `mc-to-update.md` ledger plus a drain engine. Safe in product
  installs and the canonical MC clone.
- **Provider health** — classification helper distinguishes `ok`,
  `cli_missing`, `auth_missing`, `auth_source_mismatch`,
  `model_not_found`, `quota_exhausted`, `free_tier_limit_zero`,
  `stale_cli_registry`, `trusted_directory_required`,
  `provider_timeout`, `unknown_error`. `/mc:health` and
  `/mc:setup` consume it.
- **Gemini hardening** — opt-in `--skip-trust` via
  `WARPOS_GEMINI_TRUST_BYPASS=1`. Smart-context emits a one-shot
  warning when `GEMINI_API_KEY` is set AND Gemini settings declare
  `auth.selectedType: oauth-personal` (secret not leaked).
- **Agent dispatch guide** at `paths.agentDispatchGuide` is loaded by
  Gamma + Delta and referenced from session-start every cold boot.
- **Framework manifest guard hygiene** — canonical vs product detection,
  warn-only for product installs with gitignored `.claude/`, accurate
  PowerShell+bash bypass message, repo-local
  `.mc/manifest-guard-disable` sentinel.
- **Roadmap pollution prevention** — framework backlog renamed to
  `WARPOS_ROADMAP.md`; canonical `ROADMAP.md` becomes the product
  scaffold; `promote.js` excludes both.
- **dispatch-agent mode-aware resolution** — `WARPOS_MODE` env honoured;
  oneshot inferred from store; orchestrator roles still go to 00-alex.
- **Requirement write-time linter** — Edit/Write hook on
  `_requirements/**/PRD.md|STORIES.md|HL-STORIES.md|CROSS-STANDARDS.md`
  reuses `scripts/requirements/config.js#ID_PATTERNS`. Warn-only;
  strict via env or marker.
- **Adhoc team lifecycle** — stale-team classification checklist, no
  auto-claim STARTUP DIRECTIVE, 24h freshness marker, primitive-limits
  doc.

## Files added

- `scripts/hooks/dispatch-route-guard.js`
- `scripts/hooks/requirement-format-guard.js`
- `scripts/hooks/lib/provider-health.js`
- `scripts/dispatch/prune-dead-locks.js`
- `scripts/mc/flag.js`
- `scripts/mc/promote-flags.js`
- `scripts/mc/provider-health-check.js`
- `scripts/mc/generate-roadmap-scaffold.js`
- `scripts/phase0-verify.js`
- `scripts/test-dispatch-route-guard.js`
- `scripts/test-dispatch-telemetry.js`
- `scripts/test-provider-health.js`
- `scripts/test-warp-flag.js`
- `scripts/test-manifest-guard-product.js`
- `scripts/test-dispatch-agent-resolution.js`
- `scripts/test-requirement-format-guard.js`
- `.claude/commands/mc/flag.md`
- `.claude/commands/warp/promote-flags.md`
- `.claude/project/reference/agent-dispatch-guide.md`
- `.claude/agents/00-alex/.system/policy/provider-fallback.json`
- `_docs/phase0/FINDINGS.md`
- `_docs/phase0/IMPLEMENTATION_PLAN.md`
- `_docs/phase0/FINAL_REPORT.md`
- `_docs/phase0/CHANGELOG_0.3.0.md`
- `_docs/phase0/adhoc-primitive-limits.md`
- `WARPOS_ROADMAP.md`

## Files modified

- `version.json` — 0.2.2 → 0.3.0
- `.claude/paths.json` — new keys
- `.claude/settings.json` — register two new PreToolUse hooks
- `scripts/dispatch-agent.js` — telemetry + mode-aware resolution
- `scripts/hooks/lib/concurrency-lock.js` — JSON lock metadata, dead-PID prune
- `scripts/hooks/lib/providers.js` — stderr capture, Gemini `--skip-trust`
- `scripts/hooks/framework-manifest-guard.js` — canonical/product detection
- `scripts/hooks/merge-guard.js` — dropped blanket codex/gemini allowlist
- `scripts/hooks/smart-context.js` — Gemini auth-source mismatch nudge
- `scripts/hooks/session-start.js` — dispatch guide ref, team marker, prune
- `scripts/mc/promote.js` — ROADMAP exclusions
- `scripts/path-lint.js` and `scripts/paths/gate.js` — `WARPOS_ROADMAP.md`
- `.claude/agents/00-alex/gamma.md` — dispatch-guide read directive
- `.claude/agents/00-alex/delta.md` — dispatch-guide read directive
- `.claude/commands/mc/health.md` — new sections 11 (provider) + 12 (locks)
- `.claude/commands/mc/setup.md` — Phase 2.5 (dispatch + provider sanity)
- `.claude/commands/mode/adhoc.md` — lifecycle guardrails
- `ROADMAP.md` — clean product scaffold (framework backlog moved to WARPOS_ROADMAP.md)
- `_requirements/09-integrations/PROVIDER/03-google-gemini.md` — known field issues + trust + auth-source

## Behaviour changes that consumers should know

1. `git commit` with framework-manifest changes in a product repo with
   gitignored `.claude/` now WARNS instead of BLOCKING. Set
   `WARPOS_MANIFEST_GUARD=off` or touch `.warpos/manifest-guard-disable`
   to bypass entirely. Canonical clone still blocks.
2. Raw `codex exec` / `gemini -p` / `cat foo | claude -p` from Bash are
   now blocked. Use `node scripts/dispatch-agent.js <role> <prompt>` or
   the documented `claude -p --agent <role>` fallback.
3. `ROADMAP.md` in canonical now contains a clean product scaffold. The
   framework backlog moved to `WARPOS_ROADMAP.md`. Bookmarks may break.
4. New writeable artifacts: `.claude/runtime/dispatch-completions.jsonl`,
   `.claude/runtime/dispatch-deaths.jsonl`,
   `.claude/runtime/.team-marker`. All under `.claude/runtime/` so
   downstream gitignore patterns already cover them.

## Verification

`node scripts/phase0-verify.js` runs every Phase 0 fixture/unit test plus
9 grep-style consistency checks. As of release: 7/7 tests + 9/9 checks
green.

## Migration

No migration required. Backwards-compatible lock file format. Existing
hooks unchanged in behaviour. New hooks fail-open on parse errors.
