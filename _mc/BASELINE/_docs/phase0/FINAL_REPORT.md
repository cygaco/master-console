# Phase 0 — Final Implementation Report

Date: 2026-05-11. Version bumped 0.2.2 → 0.3.0. Branch: `main`.

This is the report required by the Phase 0 prompt. It walks through
every workstream, summarizes what shipped, links the supporting
artifacts, and lists known gaps + primitive limits.

## 1. Summary of what changed

11 workstreams (A–K) plus tests, docs, and a version bump. The result
is a framework that:

- blocks raw cross-provider CLI prompt invocations before they execute,
- persists structured telemetry on every dispatch + a silent-death log,
- prunes dead-PID concurrency locks eagerly,
- carries a usable `/warp:flag` + `/warp:promote-flags` upstream flag
  drain workflow,
- classifies provider health into 11 actionable states,
- warns clearly when Gemini auth configuration is ambiguous,
- references the new agent-dispatch-guide from Gamma, Delta, and every
  cold session start,
- distinguishes canonical vs product repo and degrades the
  manifest-guard message correctly,
- keeps framework roadmap content out of downstream product
  `ROADMAP.md`,
- resolves agent specs by mode,
- lints requirement-format issues at write time, and
- ships durable guardrails for adhoc team lifecycle.

## 2. Files changed

See `_docs/phase0/CHANGELOG_0.3.0.md` for the full list. Headline counts:

- Added: 25 files.
- Modified: 19 files.
- Renamed: `ROADMAP.md` → `WARPOS_ROADMAP.md` (canonical content); a
  fresh `ROADMAP.md` now holds the product scaffold.

## 3. Findings note path

`_docs/phase0/FINDINGS.md` — written before any code changes per the
Phase 0 prompt's "inspect before changing" rule.

## 4. Implementation plan artifact path

`_docs/phase0/IMPLEMENTATION_PLAN.md` — written before any code per the
"plan artifact before code" rule. Build order followed the prompt's
priority list (B → C → A → E → D → G → H → F → J → I → K).

## 5. /warp:flag behaviour

`scripts/mc/flag.js` appends entries to
`paths.mcFlagLedger` (default `mc-to-update.md`). Categories,
statuses, source, description, optional canonical-SHA. Date headings.
No network. Skill doc at `.claude/commands/warp/flag.md`. Smoke test at
`scripts/test-warp-flag.js` (22 cases).

## 6. /warp:promote-flags drain behaviour

`scripts/mc/promote-flags.js` parses the ledger and supports:
dry-run summary by status + category; `--mark <title-substr> --to
<status>` with optional `--canonical-sha`; `--archive-promoted` to move
`promoted` entries into `paths.mcPromotedArchive` under an
`## Archived <ISO>` heading; promotion reports under
`paths.mcPromoteReports`. Skill doc at
`.claude/commands/warp/promote-flags.md`. Same smoke test covers the
end-to-end mark + archive flow.

## 7. Dispatch-route guard behaviour

`scripts/hooks/dispatch-route-guard.js` runs PreToolUse on Bash. Blocks:
`codex exec` not under the wrapper, `gemini -p` not under the wrapper,
`claude -p` without `--agent`, and `cat … | (codex|gemini|claude)`.
Allows: `--version`/`--help`/`auth status`/`models list`, the canonical
wrapper, `claude -p --agent <role>`, and `WARPOS_PROVIDER_PROBE=1`
one-shots (logged). The hook is registered in `.claude/settings.json`
ahead of `merge-guard.js`. Test: `scripts/test-dispatch-route-guard.js`
(23 cases — 15 safe, 8 forbidden).

## 8. Dispatch telemetry + death-log behaviour

`scripts/hooks/lib/concurrency-lock.js` now writes JSON lock metadata
(dispatch_id, role, provider, model, prompt_bytes, cmdline_checksum,
start_time, cwd, pid). Backward-compatible — legacy `<pid> <ts>`
parses too. `pruneDeadLocks()` walks every provider dir, removes locks
whose owning PID is dead. `scripts/dispatch/prune-dead-locks.js` is the
CLI wrapper, invoked from session-start (cold start), `/warp:health`,
and `/warp:setup`. `scripts/dispatch-agent.js` stamps a `dispatch_id`,
appends a completion record to
`paths.dispatchCompletionsFile`, and appends a death record to
`paths.dispatchDeathsFile` on silent zero-byte exit.
`scripts/hooks/lib/providers.js` switched `execSync` → `spawnSync` to
capture stderr (returned as `stderrBytes` on both ok and error paths).
Test: `scripts/test-dispatch-telemetry.js` (11 cases). Existing
`scripts/test-concurrency-lock.js` still passes.

## 9. Agent dispatch guide auto-load behaviour

`.claude/project/reference/agent-dispatch-guide.md` is the canonical
guide. `paths.agentDispatchGuide` resolves to it. Gamma's "On every
invocation" step 1 and Delta's "On startup" step 1 both require reading
it before any orchestrator dispatch.
`scripts/hooks/session-start.js` appends a compact MANDATORY REFERENCE
block to `additionalContext` on every fresh cold start.

## 10. Provider health changes

`scripts/hooks/lib/provider-health.js` exposes `probeProvider` and
`probeAll`. CLI presence check + Gemini auth-source mismatch detection
+ optional `--probe list` cheap reachability check that classifies
errors into one of 11 states. `scripts/mc/provider-health-check.js`
is the CLI used by `/warp:health` (step 11 new) and `/warp:setup` (new
Phase 2.5). Test: `scripts/test-provider-health.js` (12 cases).

## 11. Gemini-specific changes

- Opt-in `--skip-trust` via `WARPOS_GEMINI_TRUST_BYPASS=1` in
  `runProvider`.
- `provider-health.js` classifier picks up `trusted_directory_required`
  from CLI stderr.
- `scripts/hooks/smart-context.js` emits a one-shot per-session warning
  when `GEMINI_API_KEY` is set AND
  `~/.gemini/settings.json` (or platform-equivalent) declares
  `auth.selectedType: oauth-personal`. Marker file under
  `.claude/runtime/` dedupes.
- `_requirements/09-integrations/PROVIDER/03-google-gemini.md` updated
  with field-issue + auth-source + trust sections; the dead reference
  from `scripts/dispatch/catalog.js` is now resolved.

## 12. Provider fallback behaviour or scaffold

`.claude/agents/00-alex/.system/policy/provider-fallback.json` is the
scaffolded policy file with primary/fallback for every dispatched role.
`paths.providerFallbackPolicy` resolves to it. Enforcement is NOT
wired into `runProvider` this phase — the existing `fallback:true`
signal continues to drive routing — but the policy is documented and
ready for Phase 1 to consume.

## 13. Fresh install / setup health behaviour

`/warp:setup` Phase 2.5 (new) runs `prune-dead-locks.js` then
`provider-health-check.js --summary`. `/warp:health` adds section 11
(Provider Health) and section 12 (Dispatch Hygiene). Both are
fail-open — they print suggestions, they don't block setup.

## 14. Manifest guard changes

`scripts/hooks/framework-manifest-guard.js` now:

- Detects canonical (version.json + install.ps1 +
  generate-framework-manifest.js + no framework-installed.json) vs
  product (any other shape).
- In product mode where `.claude/` is gitignored: WARNs instead of
  BLOCKs if the on-disk manifest mtime is newer than the staged tracked
  edits.
- Bypass message lists PowerShell and bash forms and explains the
  Bash-inline env propagation caveat.
- Honours `.mc/manifest-guard-disable` sentinel; every bypass is
  logged.

Test: `scripts/test-manifest-guard-product.js` (9 cases including
canonical block, product warn, and sentinel bypass paths).

## 15. Roadmap template changes

- Renamed canonical `ROADMAP.md` → `WARPOS_ROADMAP.md`.
- Wrote a clean product `ROADMAP.md` scaffold at canonical root that is
  also the template downstream installs receive.
- `scripts/mc/promote.js` excludes both filenames.
- `scripts/mc/generate-roadmap-scaffold.js` is a stand-alone
  scaffold writer for any project that wants one (no-op when file
  exists).
- `scripts/path-lint.js` and `scripts/paths/gate.js` accept the new
  filename in their marker lists.

## 16. Adhoc / team lifecycle safety changes

- `/mode:adhoc` step 1.75 now classifies team state
  (fresh/stale/defunct/unknown) before spawn.
- Every teammate spawn prompt embeds the STARTUP DIRECTIVE forbidding
  auto-claim.
- `/mode:adhoc` step 6 touches `.claude/runtime/.team-marker`.
- `scripts/hooks/session-start.js` warns when the marker is >24h old.
- `_docs/phase0/adhoc-primitive-limits.md` lists every harness-bound
  behaviour we can't fix in-repo.

## 17. Requirement write-time linter changes

`scripts/hooks/requirement-format-guard.js` runs PreToolUse on
Edit/Write of `_requirements/**/PRD.md|STORIES.md|HL-STORIES.md|
CROSS-STANDARDS.md`. Uses `scripts/requirements/config.js#ID_PATTERNS`
as the only source of regex truth. Warn-only by default; strict via
env `REQUIREMENT_GUARD_STRICT=1` or marker
`<!-- requirement-format-strict -->`. Grandfathered via marker
`<!-- requirement-format-legacy -->`. Test:
`scripts/test-requirement-format-guard.js` (13 cases).

## 18. Docs updated

- `.claude/commands/warp/flag.md` (new)
- `.claude/commands/warp/promote-flags.md` (new)
- `.claude/commands/warp/health.md` (sections 11–12)
- `.claude/commands/warp/setup.md` (Phase 2.5)
- `.claude/commands/mode/adhoc.md` (steps 1.75, 2 directive, 6, limits)
- `.claude/project/reference/agent-dispatch-guide.md` (new)
- `_requirements/09-integrations/PROVIDER/03-google-gemini.md` (field
  issues + trust + auth-source)
- `_docs/phase0/FINDINGS.md`, `IMPLEMENTATION_PLAN.md`, `FINAL_REPORT.md`,
  `CHANGELOG_0.3.0.md`, `adhoc-primitive-limits.md` (new)

## 19. Tests / checks run

`node scripts/phase0-verify.js` aggregates everything:

```
Tests:  7/7 passed
  ✓ test-dispatch-route-guard.js
  ✓ test-dispatch-telemetry.js
  ✓ test-provider-health.js
  ✓ test-warp-flag.js
  ✓ test-manifest-guard-product.js
  ✓ test-dispatch-agent-resolution.js
  ✓ test-requirement-format-guard.js
Checks: 9/9 passed
  ✓ gamma references dispatch guide
  ✓ delta references dispatch guide
  ✓ session-start cites dispatch guide
  ✓ dispatch-route-guard registered in settings
  ✓ requirement-format-guard registered in settings
  ✓ paths.json carries agentDispatchGuide
  ✓ paths.json carries mcFlagLedger
  ✓ promote.js excludes ROADMAP files
  ✓ WARPOS_ROADMAP.md exists

Result: GREEN — Phase 0 ready
```

Additionally:

- `node scripts/test-concurrency-lock.js` — existing pre-Phase-0 test
  still passes after lock-format change.
- `node scripts/path-lint.js` — exits 0 (only pre-existing warnings).
- `node scripts/mc/provider-health-check.js --summary` — green on
  this developer's box.

## 20. Known gaps

- **Provider-fallback enforcement.** Policy is scaffolded but not yet
  wired into `runProvider`. The existing `fallback:true` signal still
  drives routing.
- **Stale-cli-registry detection** in `provider-health.js` is currently
  a derived inference (model_not_found + recent install hint) rather
  than a dedicated probe. Phase 1 could parse `gemini --version` and
  compare against a minimum-version table.
- **dispatch-agent.js `findAgentSpec` mode-aware resolution** prefers
  mode-specific subdirs first, then falls back across modes. Roles
  named identically in both modes will now resolve by mode rather than
  arbitrary DFS order — verify no consumer was depending on the
  arbitrary order.
- **Requirement-format-guard** only checks newly-added content in the
  edit (the `new_string` / `content` field). It does NOT scan the
  file's existing content for legacy IDs unless the user re-writes
  those lines. By design — keeps existing specs usable.

## 21. Built-in primitive limitations we could not fix in-repo

Documented in `_docs/phase0/adhoc-primitive-limits.md`:

- `TeamCreate --force-replace` does not exist; defunct team refresh is
  manual.
- `SendMessage` to a reaped teammate returns an error but does not
  auto-respawn.
- `claim_on_startup: false` is not a harness setting — we ship a
  prompt-level STARTUP DIRECTIVE in every spawn prompt.
- Team-task ownership is session-bound; durable state must live in repo
  files.

## 22. Risks

1. Two new hooks add startup overhead. Acceptable per the prompt's
   safety-first priority.
2. Lock-file format change is backward compatible, but external readers
   would have to learn JSON.
3. Renaming `ROADMAP.md` may surprise contributors — the file still
   exists at the same location with a clean scaffold + a one-line
   pointer to `WARPOS_ROADMAP.md`.
4. The provider-health probe vocabulary depends on CLI error messages;
   classification may degrade if codex/gemini change wording.

## 23. Version / capsule / changelog changes

- `version.json` bumped to 0.3.0. `previousVersions` now lists 0.2.2.
  `releasedAt: 2026-05-11`. `notes` summarizes the phase.
- Capsule build: `node scripts/mc/release-build.js 0.3.0` will
  consume the bumped manifest. `release-canonical.js` should then drive
  the canonical-repo flow.
- Changelog: `_docs/phase0/CHANGELOG_0.3.0.md` is the human-readable
  release notes file.

## 24. Recommended next step

Proceed to **Sprint Workflow v0.1**. Phase 0 closed the safety,
observability, and propagation gaps that would have made sprint
infrastructure brittle:

- `/warp:flag` is ready to capture sprint-time framework asks.
- `/warp:promote-flags` will drain those asks upstream.
- The requirement-format-guard is ready for `/sprint:design` to lean on.
- Dispatch is observable and bypass-resistant — sprint orchestrators
  will not silently die.

End of report.
