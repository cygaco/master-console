---
description: Pre-run preflight — branch creation + skeleton gut + 7-pass verification audit. Default = full setup+gut+audit. Args control surgical access.
user-invocable: true
---

# /oneshot:preflight — Pre-Run Setup + Verification

Single entry point for everything you need before kicking off `/mode:oneshot`.

**Default invocation runs the full flow:** create new skeleton branch → gut feature code to stubs → reset oneshot store → run all 7 verification passes → report ready/blocked.

**Surgical access is preserved via flags.**

## Usage

| Invocation | Behavior |
|------------|----------|
| `/oneshot:preflight` | **Full flow.** Setup (new branch + gut) THEN audit (all 7 passes). Use this before `/mode:oneshot`. |
| `/oneshot:preflight --audit-only` | **Read-only.** Skips setup. Runs all 7 passes against the current branch. Safe to call any time. |
| `/oneshot:preflight --setup-only` | **Destructive only.** New branch + gut + store reset. Skips the 6 non-gut audit passes. (Pass 7 still runs because that's the gut.) |
| `/oneshot:preflight --pass N` | **Single audit pass** (N=1..7). Read-only. Use for targeted re-check after a fix. Skips setup. |
| `/oneshot:preflight --no-commit` | When combined with setup, skip the auto-commit at end of gut. Leaves repo dirty for inspection. |

`$ARGUMENTS` parses as space-separated flags. Unknown flags → abort with usage.

---

## Mode 1 — Full flow (default)

Run **all** of Mode 2 (Setup), then **all** of Mode 3 (Audit).

If setup fails → STOP. Do NOT proceed to audit on a half-set-up branch.

If audit reports BLOCKING errors → REPORT but do not auto-rollback the setup. The user decides whether to fix-forward or `git checkout` back.

---

## Mode 2 — Setup (`--setup-only` or part of full flow)

Destructive. Creates a new skeleton branch, regenerates feature files as stubs, resets the oneshot store, verifies build.

### Step 2.1: Pre-flight guards

Before anything destructive:

1. **Tree must be free of pending USER work.** Run `git status --porcelain`. Filter out runtime telemetry that auto-churns on every hook fire — the following are expected to be modified mid-session and are NOT pending user work:
   - `.claude/.agent-result-hashes.json`, `.claude/.last-checkpoint`, `.claude/.session-checkpoint.json`
   - `.claude/project/events/*.jsonl`
   - `.claude/runtime/.topology-snapshot.json`, `.claude/runtime/handoff.md`, `.claude/runtime/logs/**`
   - `.claude/settings.local.json`
   - `.claude/scheduled_tasks.lock`
   - Untracked: `.claude/agents/president/_system/oneshot/store.json.prev-run-backup.json`, `.claude/agents/store.json`

   If anything OUTSIDE that list is modified or untracked, stop and tell the user to commit/stash. If the only modifications are telemetry, snapshot-commit them with `chore: session telemetry snapshot before /oneshot:preflight` and proceed.
2. **Confirm current branch is a skeleton branch.** Run `git branch --show-current`; expect `skeleton-test<N>`. If on master or a feature branch, warn and confirm — branching off master skips infrastructure that landed on prior skeleton branches and was never merged back.
3. **Confirm oneshot store exists.** `.claude/agents/president/_system/oneshot/store.json` must be present. If missing, abort with instructions to initialize the store first.

If any guard fails, report what's blocking and stop.

### Step 2.2: Pick the next skeleton branch name

```bash
LAST_N=$(git branch -a --format='%(refname:short)' | sed -n 's#^\(origin/\)\?skeleton-test\([0-9]\+\)$#\2#p' | sort -n | tail -1)
NEXT_N=$(( ${LAST_N:-0} + 1 ))
NEW_BRANCH="skeleton-test${NEXT_N}"
```

If the computed branch name already exists (local or remote), abort.

### Step 2.3: Branch off CURRENT (not master)

```bash
git checkout -b "$NEW_BRANCH"
```

**Why off current:** skeleton-test* branches accumulate per-run infrastructure improvements that are never merged back to master. Branching off master would lose every framework improvement made since the last merge.

### Step 2.3.5: Sync CLAUDE_RUN_NUMBER

After branch checkout, refresh the run-number canonical state so hooks, skills, and Delta see the new run number without restarting Claude Code:

```bash
node scripts/sync-run-number.js --manual
```

This updates:
- `.claude/runtime/run.json` (canonical source — read by hooks/skills/Delta as `require('./.claude/runtime/run.json').runNumber`)
- `.claude/settings.json` → `env.CLAUDE_RUN_NUMBER` (mirrored for shell subprocesses)

The same script also runs automatically on SessionStart, so a fresh Claude Code launch always has the right run number. Manual call here covers the in-session branch-switch case. Non-skeleton branches (master, feature/*) preserve the last known run number — the env var is NOT cleared.

### Step 2.4: Run the gut (Pass 7 with `--gut` semantics)

Inline the gut pass below — same logic as Mode 3 Pass 7 but with the destructive `--gut` flag set.

In order:

1. **Identify non-stubs** (Pass 7.1–7.3 below) and **regenerate** them as standard skeleton stubs (<25 lines components, 501 routes, throwing libs with preserved type exports). Update `store.knownStubs`.
2. **Auto-sync Pass 7.8** — for each feature with a store↔PRD file-list mismatch, patch `store.features[<feature>].files` to match PRD Section 13. Emit a log entry listing adds + removes.
3. **Auto-scaffold Pass 7.9 drift** — for each stub file flagged by Pass 7.9 as signature-drifted, dispatch the `stub-scaffold` sub-agent via Bash:
   ```bash
   PROMPT=$(mktemp)
   cat > "$PROMPT" <<'EOF'
   feature: <feature-name>
   file: <stub-path>
   drift-report: <Pass 7.9 diff for this file>

   You are the stub-scaffold sub-agent. Follow `.claude/agents/engineering/skeleton-builder.md`. Regenerate the stub file at the given path using the CURRENT spec signatures from the feature's PRD + INPUTS.md + src/lib/types.ts. Output ONLY the new file content.
   EOF
   RESULT=$(node "$CLAUDE_PROJECT_DIR/scripts/dispatch-claude.js" stub-scaffold "$PROMPT" --model sonnet)
   ```
4. **Reset oneshot feature statuses:**
   ```bash
   node scripts/oneshot-store-reset.js "$NEW_BRANCH"
   ```
   Resets `status`, `owner`, `fixAttempts`, `note`, `finalScore` for every non-foundation feature; resets `cycle=0`, clears `consecutiveFailures` + `totalFailures`, sets `circuitBreaker="CLOSED"`; refreshes `heartbeat` to `{ agent: "delta", status: "initializing", timestamp: now }`; updates `runLog.branch` + `runLog.startedAt`. Backs up the prior store to `store.json.prev-run-backup.json`.
5. **Final build** — `npm run build`, confirm clean. If build fails → report and STOP. Do NOT commit.
6. **Commit the gut** (unless `--no-commit`):
   ```bash
   git add -A
   git commit -m "preflight(gut): ${NEW_BRANCH} ready for build"
   ```

### Step 2.5: Setup report

```
✓ Branch: skeleton-testN (off skeleton-testN-1 @ <sha>)
✓ Stubs: <M> files regenerated
✓ Store: <K> non-foundation features reset to not_started
✓ Build: npm run build passed
✓ Heartbeat: delta / initializing
```

If `--setup-only`, stop here. Otherwise continue to Mode 3.

---

## Mode 3 — Audit (`--audit-only`, `--pass N`, or part of full flow)

Read-only verification. 8 passes (1-2 are paired, so 7 distinct sections). If `$ARGUMENTS` includes `--pass N`, run ONLY that pass. Otherwise run all.

For each pass, collect findings as a JSON array. After all requested passes complete, present a summary table: pass, total errors, total warnings, total info.

### Pass 1-2: Spec Consistency & Coverage

Delegate to `/scan:requirements static`.

This runs the static spec checks: consistency (R-series) and coverage. See `.claude/commands/scan/requirements.md` for the full check list.

**Freshness Gate addendum:** in addition to the static checks, run:

```bash
node scripts/requirements/graph-build.js --check
node scripts/requirements/gate.js
```

The first verifies `_requirements/_index/requirements.graph.json` is current with the spec content; exit 1 if stale. The second is the Freshness Gate (`scripts/requirements/gate.js`): it fails closed (exit 2) on a missing graph when feature specs exist, unresolved Class C RCOs, or stale_pending_review requirements without RCO coverage. Both must pass before the preflight is considered green. If only the Freshness Gate is yellow (exit 1 — unmapped staged code, or no feature specs and no graph yet), surface as warnings and let the operator decide.

### Pass 3: Agent Buildability

Delegate to `/scan:architecture internal` — runs its buildability checks.

### Pass 4: Environment Readiness

Delegate to `/scan:environment ready` — runs environment checks E1-E14.

### Pass 5: Run Transition

**Agent type:** Explore

**Prompt for agent:**

You are a run transition auditor for the current project. Your job is to verify that the previous run was properly closed out and the system is ready for a new run. Be exhaustive.

Resolve the project name from `.claude/manifest.json` → `project.name` and use it in output messages.

#### Files to Read

- `.claude/agents/store.json` (the build system state — resolve via `paths.store`)
- Retro directory (resolve via `manifest.projectPaths.retro`; fall back to `.claude/project/retros/` or skip if neither exists)
- For the LATEST retro folder: `RETRO.md`, `BUGS.md`, `LEARNINGS.md`, `HYGIENE.md`, and any other `.md` files
- `.claude/agents/president/_system/oneshot/protocol.md` (verify it references the latest HYGIENE)
- `.claude/manifest.json` (canonical `fileOwnership.foundation`) and `.claude/agents/president/_system/oneshot/store.json` (canonical per-feature `features[<name>].files`) — oneshot uses these to enforce ownership.

#### Checks

- **5.1 Previous Run Closure** — store.json runLog.finalStatus is "completed" or "halted" (not null). If halted: haltReason populated. startedAt populated. Flag null finalStatus as ERROR.
- **5.2 Retro Completeness** — Latest retro folder has: RETRO.md, BUGS.md, LEARNINGS.md, HYGIENE.md (all non-empty or explicitly "no bugs found").
- **5.3 Bug Dataset Populated** — Every BUGS.md bug has a store.bugDataset entry with populated prevention. Flag missing bugs or empty prevention.
- **5.4 HYGIENE Rule Numbering** — Sequential across all retro folders, no gaps or duplicates.
- **5.5 Oneshot Protocol References Latest HYGIENE** — `.claude/agents/president/_system/oneshot/protocol.md` points to the latest retro folder's HYGIENE.md.
- **5.6 Store.json Schema Alignment** — AGENT-SYSTEM §6 Store interface matches actual store.json field-by-field (evolution[], heartbeat, compliance, snapshots, knownStubs, feature entries).
- **5.7 Feature Status Reset** — If new run: all features at "not_started". WARN if still showing previous run state.
- **5.8 Skeleton State** — If branch contains "skeleton": sample 5 feature files, verify SKELETON markers.
- **5.9 [planning-only] Section Stripping** — Sample 3 PRDs for `[planning-only]` markers. Flag if found.
- **5.10 Action Items from Previous Retro** — Check latest RETRO.md "Action Items" section. Flag unresolved items as WARN.

#### Output Format

JSON array of `{check, severity, message, evidence?}` items.

### Pass 6: Agent Architecture Completeness

Delegate to `/scan:architecture internal` — runs its architecture completeness checks (including the agentic flow audit).

Note: Pass 3 and Pass 6 both delegate to `/scan:architecture internal`, which runs its full internal check list (see `.claude/commands/scan/architecture.md`).

### Pass 7: Skeleton State Verification

**Agent type:** General-purpose (runs commands)

**Prompt for agent:**

You are a skeleton state auditor. Verify that ALL feature-owned files are proper skeleton stubs, and that ALL foundation files are intact. **In Mode 3 (audit), this is read-only — flag drift but do not modify.** The `--gut` semantics live in Mode 2 (Setup).

#### Canonical ownership sources

- `.claude/manifest.json` → `fileOwnership.foundation` — canonical foundation list (must be INTACT).
- `.claude/agents/president/_system/oneshot/store.json` → `features[<name>].files` — canonical per-feature file scope (must be STUBS).

#### Checks

- **7.1 Feature Components Are Stubs** — Each feature-owned component: <30 lines, SKELETON marker, correct export name, compiles.
- **7.2 Feature API Routes Are Stubs** — Each feature-owned route: <15 lines, returns 501 or SKELETON marker, correct HTTP exports.
- **7.3 Feature Lib Files Are Stubs** — Functions throw "SKELETON: not implemented" or return minimal defaults. Type/interface exports preserved (NOT stubbed).
- **7.4 Foundation Files Are Intact** — >50 lines, no SKELETON markers, real implementations.
- **7.5 Build Verification** — `npm run build` passes clean.
- **7.6 store.json knownStubs Alignment** — Every knownStubs file is actually a stub. Every stub file is in knownStubs.
- **7.7 Foundation-guard heartbeat** — if this run will edit any file in `manifest.fileOwnership.foundation`, verify `.claude/agents/store.json` exists and contains `heartbeat.agent` in {alpha, gamma, boss, lead}. If absent or wrong agent, create with `{"heartbeat": {"agent": "alpha", "status": "preflight", "timestamp": "<ISO>"}}` or abort if the current agent is not authorized. Severity: WARN.
- **7.8 Store ↔ PRD file-list coherence** — For each feature, read `_requirements/04-features/<feature-dir>/PRD.md` Section 13 (Implementation Map) and diff the listed files against `store.features[<feature>].files`. Report any files present in PRD but missing from store (MISSING) or vice versa (ORPHAN). Severity: WARN.
- **7.9 Stub signature drift** — For each stubbed file, extract exported type signatures and diff against the types referenced in the current PRD + INPUTS.md + foundation types in `src/lib/types.ts`. Flag mismatches as INFO/WARN.

### Pass 8: Cross-Layer Seams

Delegate to `/scan:architecture seams` — runs the S-series checks that verify cross-layer integrity:

- **S1** Specs → foundation types (every type/field reference in PRD/INPUTS/STORIES exists in `src/lib/types.ts`). Severity: ERROR.
- **S2-S6** Stories ↔ prompts/validation/architecture coherence.
- **S7-S10** Skills ↔ hooks integrity (skill claims an enforcement; verify backing hook exists).
- **S11-S13** Reference docs / agent `.system/` files / cross-session inbox wiring.
- **Production baseline addendum:** run `node scripts/checks/production-baseline.js`. Treat failures as production-readiness blockers for production-bound generated apps.

Example: the backend PRD added a field (say `activeTicketId`) to the shared session type; if foundation type wasn't updated to match, builder would write `session.activeTicketId = ...` and `npm run build` would fail mid-run, halting Delta. Pass 8 catches this BEFORE the build starts.

### After All Passes

1. **Summary table** — Pass number, name, error count, warning count, info count.
2. **Blocking errors** — List all ERROR-severity findings.
3. **Decision** — "PREFLIGHT PASSED — ready for agent run" (0 errors) or "PREFLIGHT BLOCKED — N errors must be fixed".

---

## When NOT to use

- You want a partial reset, e.g. only one feature reverted. This skill is whole-project gut.
- You're mid-build and just want to reset a single feature's status. Edit the store directly.
- You haven't committed or stashed local changes. Setup mode will refuse to proceed with a dirty tree.

## Rules

- **Never push.** This skill only operates locally. Pushing is the user's call per CLAUDE.md autonomy table.
- **Never force.** If the target branch name already exists, abort.
- **Never edit foundation.** The gut already respects foundation via `manifest.fileOwnership.foundation`.
- **One skeleton branch per setup invocation.** Don't attempt to recover from a half-run by re-running; clean up manually first.
- **Audit is idempotent and read-only.** Safe to call repeatedly.

## Failure modes + recovery

| Failure | Recovery |
|---|---|
| Dirty working tree | `git status`, then commit / stash / restore as appropriate, then re-run |
| `skeleton-testN` already exists | `git branch -D skeleton-testN` (if local leftover) or pick a higher N explicitly |
| Build fails after gut | Repo is in intermediate state on new branch. Investigate the stub regeneration or Pass 7.9 scaffold output. Once fixed, manually `git add -A && git commit` with appropriate message |
| Pass 7.9 `stub-scaffold` dispatch fails | The gut pass reports which file failed; generate the stub manually or skip 7.9 and re-run |
| Audit reports BLOCKING errors | Read the JSON findings; fix root causes; re-run with `--pass N` for targeted re-check |

## Companion skills

- `/oneshot:improve` — when audit reveals a gap that should become a future check
- `/oneshot:start` — wraps this skill + mode switch + Delta handoff in a single kickoff
- `/oneshot:retro` — post-run retrospective (after the build completes or halts)
