# Phase 0 Implementation Plan

Companion to `_docs/phase0/FINDINGS.md`. Per-workstream file-level scope
with dependencies, rollback notes, and risks. Build order follows the
Phase 0 prompt's priority list (B → C → A → E → D → G → H → F → J → I → K).

## Cross-cutting conventions

- New scripts use `paths.X` keys, not literal paths. Add to
  `.claude/paths.json` when introducing a new well-known location.
- New hooks log via `scripts/hooks/lib/logger.js`. PreToolUse hooks emit
  JSON `{decision: "block", reason}` on stdout when blocking; exit code 0
  otherwise.
- All new code must pass `scripts/path-lint.js` (markers allowed where
  needed via `<!-- path-literal-allowed: <reason> -->` or
  `// path-literal-allowed: <reason>`).
- Test scripts go under `scripts/test-*.js`; existing
  `scripts/test-concurrency-lock.js` is the model.

## Workstream B — dispatch-route guard

**Files added:**
- `scripts/hooks/dispatch-route-guard.js` — PreToolUse Bash hook.
- `scripts/test-dispatch-route-guard.js` — fixture test.

**Files modified:**
- `.claude/settings.json` — register the hook under `PreToolUse` matcher
  `Bash`, immediately after `merge-guard.js`.
- `.claude/agents/00-alex/gamma.md` — forbidden-pattern rule + mandatory
  dispatch-guide read.
- `.claude/agents/00-alex/delta.md` — same.
- `scripts/hooks/merge-guard.js` — drop blanket `codex `/`gemini ` from
  ALLOWLIST so the new guard's block decision is authoritative.

**Forbidden patterns (regex against the trimmed command body):**
- `\bcodex\s+exec\b` not preceded by `node\s+scripts/dispatch-agent\.js`
- `\bgemini\b.*\s-p\b` similarly
- `\bclaude\s+-p\b` similarly — but allow when the next non-flag arg is
  `--agent <role>` (the documented fallback path).
- `cat\s+\S+\s*\|\s*(codex|gemini|claude)\b`
- `\bcodex\s+exec\b.*\|\s*` (piping codex output is fine, codex reading
  piped stdin into prompt is fine only via dispatch-agent).

**Allowed patterns:**
- `--version`, `--help`, `models list`, `auth status` for any provider
  CLI.
- Anything inside a `runtime/.provider-tmp/` path (those are
  dispatch-agent owned).
- Env override `WARPOS_PROVIDER_PROBE=1` bypasses for one call (logged).

**Block message:**

```
[dispatch-route-guard] Direct cross-provider CLI prompt invocation is forbidden.
Pattern matched: <pattern>
Use:  node scripts/dispatch-agent.js <role> <prompt-file>
Why:  raw codex/gemini/claude -p calls re-trigger known stdin/binding
      failures (LRN-2026-04-17, LRN-2026-04-30 binding-gap).
Bypass for a one-shot health probe: set WARPOS_PROVIDER_PROBE=1.
See _docs/phase0/agent-dispatch-guide.md (or paths.agentDispatchGuide).
```

**Rollback:** delete hook file, revert settings.json entry, revert spec
edits. The guard is fail-open on parse error.

## Workstream C — dispatch telemetry, dead-lock pruning, silent-death log

**Files added:**
- `scripts/dispatch/prune-dead-locks.js` — eager pruner.
- `scripts/test-dispatch-deaths.js` — fixture test.

**Files modified:**
- `scripts/hooks/lib/concurrency-lock.js` — lock body becomes a JSON
  object; `tryAcquireOnce` writes the new shape. Reader tolerates legacy
  `"<pid> <ts>"` lock files.
- `scripts/dispatch-agent.js` — generate a `dispatch_id`, capture
  stderr-bytes, write completion record, append to
  `.claude/runtime/dispatch-deaths.jsonl` on silent zero-byte exit
  (no `result.output` AND non-zero exit AND `stderr.length === 0`).
- `scripts/hooks/lib/providers.js` — change `runProvider` to capture
  stderr into a local buffer (currently `stdio: ["pipe","pipe","pipe"]`
  swallows it inside execSync's err.stderr); also write the raw stderr
  to `runtime/.provider-tmp/<id>.stderr` when non-empty so the death log
  can reference it.
- `.claude/paths.json` — new keys: `dispatchLocks`,
  `dispatchDeathsFile`, `providerTmp`.
- `.claude/commands/warp/health.md` and `.../warp/setup.md` — call
  `node scripts/dispatch/prune-dead-locks.js` at the start.
- `scripts/hooks/session-start.js` — call the pruner once per startup
  (best-effort, fail-open).

**Lock JSON shape (new):**

```json
{
  "dispatch_id": "d-<ts>-<rand>",
  "pid": 12345,
  "role": "reviewer",
  "provider": "openai",
  "model": "gpt-5.5",
  "prompt_bytes": 42312,
  "cmdline_checksum": "sha256:<hex32>",
  "start_time": "2026-05-11T20:31:02.123Z",
  "cwd": "<abs path>"
}
```

**Death record (JSONL):**

```json
{"dispatch_id":"...","timestamp":"...","pid":...,"role":"...","provider":"...","model":"...","prompt_bytes":...,"cmdline_checksum":"...","exit_code":null,"stdout_bytes":0,"stderr_bytes":0,"last_stdout_mtime":"...","last_stderr_mtime":"...","reason":"silent_zero_byte_death"}
```

**Rollback:** legacy lock-file format is still accepted; revert
dispatch-agent + providers changes; delete new pruner.

## Workstream A — /warp:flag + /warp:promote drain

**Files added:**
- `.claude/commands/warp/flag.md` — skill doc.
- `scripts/mc/flag.js` — append engine.
- `scripts/mc/promote-flags.js` — drain engine (separate from the
  existing source→canonical promote.js — different concern, easier
  rollback).
- `.claude/commands/warp/promote-flags.md` — companion skill doc.

**Files modified:**
- `.claude/commands/warp/promote.md` — add a "See also" link to
  `/warp:promote-flags` with a one-line explanation.

**Ledger file format:**

```markdown
# MC Update Flags

<!-- managed by /warp:flag and /warp:promote-flags. Add entries via /warp:flag. -->

## 2026-05-11

### dispatch — Dispatch route guard

- Source: MC Phase 0
- Status: open
- Description: Forbid raw cross-provider CLI prompt invocation.
```

**Entry status set:** `open`, `in_progress`, `promoted`, `blocked`,
`deferred`, `needs_decision`, `duplicate`, `abandoned`.

**Archive:** `mc-promoted-archive.md` (created on first archive run,
gitignored by default — controlled by `--archive-policy`).

**Promotion report:** `.mc/promote-reports/<UTC-date>-flags.md`.

**Rollback:** delete new files / revert command-doc edits. The existing
`/warp:promote` source→canonical engine is untouched.

## Workstream E — provider health, Gemini hardening, setup sanity

**Files added:**
- `scripts/hooks/lib/provider-health.js` — classification helper.
- `scripts/mc/provider-health-check.js` — CLI invoked by
  `/warp:health` / `/warp:setup`.
- `.claude/agents/00-alex/.system/policy/provider-fallback.json` —
  scaffold + schema.
- `_requirements/09-integrations/PROVIDER/03-google-gemini.md` — fix or
  create the file `scripts/dispatch/catalog.js` already references; or,
  if it already exists, update it with the exclusion rationale.

**Files modified:**
- `scripts/hooks/lib/providers.js` — Gemini invocation: pass
  `--skip-trust` when env `WARPOS_GEMINI_TRUST_BYPASS=1` or when the CLI
  emitted a `trusted-directory` error in the prior probe (cached).
- `scripts/hooks/smart-context.js` — once-per-session warning when
  `GEMINI_API_KEY` is set AND `~/.gemini/settings.json` (or whatever
  path the gemini CLI uses on Windows) declares `oauth-personal` auth.
  Use a marker file under `.claude/runtime/` to dedupe.
- `.claude/paths.json` — new key `providerFallbackPolicy`.
- `.claude/commands/warp/health.md` — replace step 10 with structured
  provider health output.
- `.claude/commands/warp/setup.md` — call the provider-health-check at
  end of Phase 1.

**Health states (returned by helper):**
`ok`, `cli_missing`, `auth_missing`, `auth_source_mismatch`,
`model_not_found`, `quota_exhausted`, `free_tier_limit_zero`,
`stale_cli_registry`, `trusted_directory_required`,
`provider_timeout`, `unknown_error`.

**Fallback policy JSON shape (scaffold only this phase):**

```json
{
  "$schema": "mc/provider-fallback/v1",
  "version": 1,
  "policies": {
    "redteam": { "primary": "gemini:gemini-3.1-pro-preview", "fallback": "claude:claude-opus-4-7" },
    "reviewer": { "primary": "openai:gpt-5.5", "fallback": "claude:claude-sonnet-4-6" }
  },
  "on_failure": ["quota_exhausted", "model_not_found", "provider_timeout", "auth_missing"]
}
```

**Rollback:** delete added files; revert providers.js / smart-context
edits; remove new paths.json keys.

## Workstream D — agent dispatch guide auto-load

**Files added:**
- `.claude/project/reference/agent-dispatch-guide.md` — compact canonical
  doc.

**Files modified:**
- `.claude/paths.json` — new key `agentDispatchGuide`.
- `.claude/agents/00-alex/gamma.md` and `delta.md` — add a top-of-spec
  line requiring the guide be read before any orchestrator dispatch.
- `scripts/hooks/session-start.js` — append a one-paragraph "MANDATORY
  REFERENCE" block when `additionalContext` is non-empty (and even when
  empty, for fresh sessions).

**Rollback:** delete the guide; revert paths.json key + session-start +
spec edits.

## Workstream G — framework manifest guard product-repo hygiene

**Files modified:**
- `scripts/hooks/framework-manifest-guard.js`:
  - Detect canonical vs product via two signals (see findings).
  - In product mode + gitignored `.claude/`: warn instead of block when
    the manifest file is present on disk and its mtime is newer than the
    newest staged tracked file; block only when manifest is missing on
    disk.
  - Rewrite the bypass message (PowerShell + bash forms, env-propagation
    explainer).
  - Honour repo-local `.mc/manifest-guard-disable` sentinel; log the
    bypass.

**Files added:**
- `scripts/test-manifest-guard-product.js` — fixture test.

**Rollback:** revert hook file; delete sentinel if created.

## Workstream H — roadmap template pollution prevention

**Files renamed:**
- `ROADMAP.md` → `WARPOS_ROADMAP.md` (canonical-only framework backlog).

**Files added:**
- `ROADMAP.md` (new — clean product scaffold template added to the
  installer's `generated_files` so future fresh installs get a clean
  product roadmap). Add via `scripts/generate-framework-manifest.js`
  update (or directly in installer generated-files list).
- `scripts/mc/generate-roadmap-scaffold.js` — small builder.

**Files modified:**
- `scripts/mc/promote.js` — add explicit exclusion of `ROADMAP.md`
  and `WARPOS_ROADMAP.md` to `EXCLUDE_PREFIXES` (literal entries).
- `scripts/path-lint.js`, `scripts/paths/gate.js` — allow both filenames
  in the markers list.
- `_requirements/_index/` and any references that point at `ROADMAP.md`
  — update to `WARPOS_ROADMAP.md`.

**Rollback:** rename back; remove scaffold; revert exclusion list.

## Workstream F — dispatch-agent mode-aware spec resolution

**Files modified:**
- `scripts/dispatch-agent.js` — replace `findAgentSpec` walker with a
  mode-aware variant. Resolution order:
  1. `WARPOS_MODE` env (`oneshot` | `adhoc` | `solo`) → search
     `01-adhoc/<role>` or `02-oneshot/<role>` first.
  2. Inferred mode: if `.claude/agents/02-oneshot/.system/store.json#status === "running"`
     → oneshot; else adhoc.
  3. Fallback to `00-alex/<role>.md` for orchestrator roles.
  4. Fallback to first DFS match for any other role.

**Files added:**
- `scripts/test-dispatch-agent-resolution.js` — unit test for
  resolution order.

**Rollback:** revert the resolver function; the previous behaviour is
preserved at the bottom of the resolution order.

## Workstream J — requirement write-time linting foundation

**Files added:**
- `scripts/hooks/requirement-format-guard.js` — PreToolUse `Edit|Write`
  hook.
- `scripts/test-requirement-format-guard.js` — fixture test.

**Files modified:**
- `.claude/settings.json` — register the hook in the `Edit|Write`
  matcher list (insert before `dependency-admission-guard.js`).

**Behaviour:**
- Triggers only on paths matching `_requirements/**/PRD.md`,
  `_requirements/**/STORIES.md`, `_requirements/**/HL-STORIES.md`,
  `_requirements/_shared/CROSS-STANDARDS.md`.
- Reads the Edit/Write diff (the new content). Extracts newly-introduced
  IDs (lines added by the proposed edit) using
  `scripts/requirements/config.js#ID_PATTERNS`.
- Validates: granular stories use `GS-<UPPER>-<NN>`, HL stories use
  `HL-<UPPER>-<NN>`, cross-standards `CS-<NNN>`, alt form
  `REQ-<feature>-<topic>-<NNN>`.
- Warn-only by default. Strict mode via `REQUIREMENT_GUARD_STRICT=1` or
  marker `<!-- requirement-format-strict -->` in the file.
- Skip warning on grandfathered patterns (e.g. `S-1`, `S-2`) when the
  file contains `<!-- requirement-format-legacy -->`.

**Rollback:** delete the hook file; remove the settings.json entry.

## Workstream I — minimal adhoc team lifecycle safety

**Files modified:**
- `.claude/commands/mode/adhoc.md` — add sections:
  - "Before spawning a team: classify existing team state."
  - "Auto-claim suppression: every teammate prompt includes
    `claim_on_startup: false`."
  - "MaxTurns reap / dead agent: known harness limit — escalate to user
    if a SendMessage fails repeatedly to a teammate role."
  - "Tracker source of truth: feature/sprint state lives in
    `.claude/project/`, not in ephemeral team-task ownership."
- `scripts/hooks/session-start.js` — when `.claude/runtime/.team-marker`
  exists and is older than 24h, append a warning to additionalContext
  suggesting `/mode:adhoc` recreate.

**Files added:**
- `_docs/phase0/adhoc-primitive-limits.md` — explicit doc of harness
  limits we cannot fix here.

**Rollback:** revert doc + session-start edit.

## Workstream K — docs, tests, validation, version/capsule

**Files added:**
- `_docs/phase0/FINDINGS.md` (already written).
- `_docs/phase0/IMPLEMENTATION_PLAN.md` (this file).
- `_docs/phase0/FINAL_REPORT.md` — written at end of phase.
- `_docs/phase0/CHANGELOG_0.3.0.md` — release notes.
- `scripts/phase0-verify.js` — single script that runs all new tests +
  prints a green/red summary for the final report.

**Files modified:**
- `version.json` — bump to `0.3.0`, update `previousVersions`,
  `releasedAt`, `notes`.
- `.claude/framework-manifest.json` — regenerated.

## Risks

1. **Hook count is already high** (≥25 hooks in `.claude/settings.json`).
   Adding two more (dispatch-route-guard, requirement-format-guard)
   increases startup overhead. Acceptable per the prompt's priority on
   safety.
2. **Lock-file shape change** is backward-compatible (legacy
   `"<pid> <ts>"` still parses), but any external consumer reading raw
   lock content would break. None observed.
3. **Renaming ROADMAP.md** is repo-internal; could surprise contributors.
   Mitigated by `WARPOS_ROADMAP.md` being explicitly in path-lint
   markers + adding a stub `ROADMAP.md` to point readers at the new
   filename in canonical.
4. **Provider health check** depends on CLI error-vocabulary stability —
   classification may degrade if codex/gemini change message wording.
5. **dispatch-agent.js resolution change** could surface a behaviour
   difference if an existing run was implicitly depending on the
   DFS-first match.

## Rollback strategy

Each workstream's diff is independent and listed above. The umbrella
rollback is `git revert` of the squashed Phase 0 commit. Lock-file
format remains backward-compatible. No data migration required.

## Build order

Per the prompt's priority list: B → C → A → E → D → G → H → F → J → I → K.
Within each workstream: write the implementation, write the test, run
the test, run linters, then move on. Do not batch unrelated edits.

End of plan.
