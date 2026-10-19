---
description: Lightweight kickoff — verify ready-state and hand off to Delta. Does NOT run setup or destructive work; that's /oneshot:preflight's job.
user-invocable: true
---

# /oneshot:start — Kickoff a Oneshot Run

The thin "everything is ready, now go" command. Verifies the world is in a launchable state and hands control to Delta.

**This skill does NOT run setup.** No branch creation, no gut, no store mutation. Setup is the job of `/oneshot:preflight` (with `--setup-only` or full mode), and it should happen BEFORE you call this. If the world isn't ready, this skill aborts with a pointer to what's missing.

## Usage

`/oneshot:start` — that's it. No flags. The skill is intentionally surface-thin.

If you want to run audit verification before launching, run `/oneshot:preflight --audit-only` separately first, then `/oneshot:start`. Coupling them would defeat the purpose of this skill.

## Procedure

### Step 1: Verify launchable state

Run these checks in parallel, all read-only. Each must pass.

| Check | What | Fail action |
|---|---|---|
| **A. Mode** | Read `.claude/runtime/mode.json`. Must be `mode: "oneshot"`. | Abort with: "Mode is `<X>`. Run `/mode:oneshot` first." |
| **B. Branch** | `git branch --show-current` matches `^skeleton-test\d+$`. | Abort with: "Not on a skeleton branch. Run `/oneshot:preflight --setup-only` first." |
| **C. Working tree** | `git status --porcelain` clean (modulo runtime telemetry whitelist — same list as `/oneshot:preflight` Step 2.1). | Abort with: "Uncommitted changes. Commit/stash first." |
| **D. Store exists** | `.claude/agents/president/_system/oneshot/store.json` present. | Abort with: "Oneshot store missing." |
| **E. Store ready for run** | All non-foundation features in store have `status: "not_started"`. | Abort with: "Store not reset for new run. Run `/oneshot:preflight --setup-only` first." |
| **F. Run number current** | `.claude/runtime/run.json` `runNumber` matches the current branch's N. | Abort with: "Run number out of sync. Run `node scripts/sync-run-number.js --manual`." |
| **G. Manifest features in store** | Every `manifest.build.features[].id` (phase ≥ 1) has a corresponding `store.features[<id>]` entry. **Exemption: phase=0 features.** Manifest's unified `foundation` is a product-level abstraction; store enumerates 10 granular `foundation-*` build-orchestration sub-units. Both are valid at different layers. For phase=0, instead verify `manifest.fileOwnership.foundation` files are each owned by some `foundation-*` store entry's `files[]`. | Abort with: "Manifest features missing from store: <list>. Add entries before launch." |
| **H. validate-gates ↔ manifest** | Nothing to compare: `scripts/validate-gates.js` reads phase 0 from the store's granular foundation-* units and every other phase from the manifest (`build.features[].phase`), the same split as G. | — |
| **I. Provider smoke** | Runs `node scripts/mc/provider-smoke.js --per-role --exit-on-yellow`: resolves the provider and model of each role in its per-role list the way real dispatch does and pings the non-Claude ones. Pass = exit 0 (all green). **Why this matters:** it verifies that each provider is actually reachable instead of assuming it is not. | Abort with: "Provider X unreachable. Either install the CLI, set `OPENAI_FLAGSHIP_MODEL` / `GEMINI_MODEL` env override to a working model, or update `manifest.agentProviders` to fall back to claude (and document the deviation in retro)." |

If any check fails, STOP. Surface the precise failure + the recommended fix command.

### Step 2: Hand off to Delta

If all checks pass, emit the launch state:

```
✓ Mode: oneshot
✓ Branch: skeleton-testN
✓ Tree: clean
✓ Store: M features at not_started (foundation done)
✓ Run number: N
✓ Manifest ↔ store: aligned

Handing off to Delta.
```

Then read `.claude/agents/president/delta.md` and execute its startup procedure. Begin from wherever `store.json` indicates (`heartbeat.status`, `runLog`, current phase).

From this point, Alpha is no longer the orchestrator. Delta is. Alpha's doctrine (reasoning engine, Beta consultation) does NOT apply during the oneshot run.

## Why this skill is thin

Mode-switch, setup, audit and Delta handoff are kept out of one entry point because they are different concerns:

- **Setup** is destructive and stateful — it creates a branch, guts code, resets the store. Doing it inside `/oneshot:start` would make the skill non-idempotent and risky to re-run.
- **Audit** is verification — read-only checks of correctness. Has its own failure modes that are worth surfacing separately.
- **Launch** is just "GO" — Delta takes over.

Splitting them lets you:
- Run setup once, audit several times during prep, launch when satisfied
- Skip setup entirely if you've prepared the branch by hand
- Re-launch (after a halt) without re-doing destructive setup
- Keep the launch step diff-able and auditable on its own

## Recommended workflow

```
1. /oneshot:preflight              # full: setup + audit, creates skeleton-testN+1
   (or, if you want surgical control:)
   /oneshot:preflight --setup-only # destructive only, no audit
   /oneshot:preflight --audit-only # later, when you want to verify

2. /oneshot:start                  # the GO command — runs Delta
```

Or, if all your prep is already done from a previous session/branch operation:

```
/oneshot:start                     # just verify + go
```

## Rules

- **Never push.** Same as everything else.
- **Never run setup.** If world isn't ready, abort. Setup is `/oneshot:preflight`'s domain.
- **Idempotent.** Safe to call repeatedly; if Delta is already running, no-op.
- **Halts on first failed check.** Each check has a precise next-step pointer.

## Failure modes + recovery

| Failure | Recovery |
|---|---|
| Mode != oneshot | `/mode:oneshot` first |
| Not on skeleton branch | `/oneshot:preflight --setup-only` to create skeleton-testN+1 |
| Tree dirty | Commit or stash |
| Store missing | Initialize from template, or run `/oneshot:preflight --setup-only` |
| Store features not reset | `node scripts/oneshot-store-reset.js <branch>` directly, OR re-run `/oneshot:preflight --setup-only` |
| Run number out of sync | `node scripts/sync-run-number.js --manual` |
| Manifest features missing from store | Manually add the entry to `store.features` (with status:not_started + files[] from PRD §13), then re-run |
| Delta handoff stalls | Inspect store.json heartbeat; manually advance per delta.md |

## Companion skills

- `/oneshot:preflight` — does the actual prep work (setup + audit modes)
- `/oneshot:retro` — post-run reflection
- `/oneshot:improve` — when retro reveals a preflight gap
- `/mode:oneshot` — the mode-switch primitive
- `/mode:adhoc` — single-feature iteration team mode (different flow)
- `/mode:solo` — Alpha-direct mode (rare, quick one-offs)
