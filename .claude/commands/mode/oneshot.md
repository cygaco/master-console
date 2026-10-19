---
description: Initiate a oneshot build — launch Delta as standalone orchestrator for full skeleton runs
says:
  - oneshot mode
  - start a oneshot
  - one shot build
  - enter oneshot mode
says-flags:
  turbo: --turbo
says-args: free-text
says-confirm: always
---

# /mode:oneshot — Oneshot Mode

Initiate a oneshot build. Delta (δ) takes over as the standalone orchestrator. This is NOT a team mode — Delta IS the session and manages the entire build autonomously.

## When to use

- Full skeleton builds from stubs
- Building an entire app or major subsystem from scratch
- Multi-phase runs that need state machine, cycles, and learner (cross-cycle pattern) analysis

## Inputs

`/mode:oneshot [--turbo [--scope <csv>|all] [--ttl <duration>] [--reason "<text>"]]`

Without `--turbo`, the skill behaves as before. With `--turbo` and no further args, the per-mode default scope is applied (see Default turbo scope below). The standalone `/turbo` skill remains the canonical interface for ad-hoc adjustments after mode entry.

### Default turbo scope

`manifest-edit,write-jsonl,node-e-fs,worktree-ops` — same scope set as `/mode:adhoc --turbo`, but with TTL = 4h to match a typical Delta run. No `push-to-main`, no `destructive-git`. Sibling skill: [`/turbo`](../turbo.md).

## ⛔ Mode-init ≠ authorization — STOP after setup

`/mode:oneshot` is special: it is an **explicit launch request**, not a passive mode
switch — the operator invoking it IS the instruction to run the build (with the brief
they provide). What it must NOT do is launch off an **inherited** "continue": a prior
session's handoff / `DUMP.md` / `TRACKER.md` saying "continue" or naming a forward plan
is **context, not a command**. If `/mode:oneshot` is entered without an explicit
in-session brief, do the pre-flight + marker, then **STOP and ask what to build** —
never auto-start a skeleton run from memory or a handoff alone. (The
`scripts/mode-set.js` fresh-entry posture banner fires on entry.)

## Procedure

### Step 1: Pre-flight checks

Before launching, verify:

1. **Store exists:** `.claude/agents/president/_system/oneshot/store.json` — if not, warn that a fresh store is needed
2. **Protocol exists:** `.claude/agents/president/_system/oneshot/protocol.md`
3. **Phase graph exists:** `.claude/manifest.json` has `build.phases` and `build.features` populated (this is the canonical phase graph; there is no separate task-manifest file)
4. **Skeleton stubs exist:** for each feature in `store.features`, confirm the files listed in `features[<name>].files` exist and are skeleton stubs (check against `store.knownStubs`)
5. **Foundation passes:** Run the build command from project-config to verify the skeleton compiles

If any check fails, report what's missing and stop. Do NOT launch Delta into a broken environment.

### Step 2: Write mode marker

Run the canonical mode-set CLI. Oneshot takes a lock — `lockOwner` is `delta` and `activeBuild` is the current store branch:

```bash
node scripts/mode-set.js oneshot --by alpha --lock-owner delta --active-build "$(git rev-parse --abbrev-ref HEAD)"
```

The lock blocks transitions until Delta halts and clears it (Delta writes `--lock-owner ""` on halt). If a stale lock blocks you, halt the build first or pass `--force`.

### Step 2.5: Start-of-work — consult TRACKER.md

Before handing off to Delta, read `TRACKER.md` and determine whether this skeleton build belongs to an **active** epic/sprint, a **planned** one, **untracked** work, or a **new** epic/sprint that must be created. A oneshot build is meaningful long-running work — it must not start from memory alone; if it falls outside a tracked epic/sprint, record it in `UNTRACKED_WORK.md`. This runs while still Alpha, before the Delta handoff.

### Step 3: Set mode context

Acknowledge the mode switch:

```
MODE: oneshot
Team: none — Delta runs standalone
Orchestrator: Delta (δ) — full skeleton builds
Build cycle: state machine with phases, cycles, heartbeat, learner
Alpha/Beta: NOT ACTIVE during oneshot
```

### Step 3: Transition to Delta

Alpha is now handing off to Delta. Read and execute the Delta protocol:

1. Read `.claude/agents/president/delta.md` — Delta's full identity and instructions
2. Follow Delta's startup procedure (read all oneshot/ files)
3. Begin the state machine from wherever store.json indicates

From this point forward, you ARE Delta. Alpha's doctrine (reasoning engine, session rhythms, Beta consultation) does NOT apply. Follow Delta's mechanical protocol only.

### Step 4: Execute

Run the oneshot build following `.claude/agents/president/_system/oneshot/protocol.md`.

When complete or halted, output the DELTA_RESULT as defined in delta.md.

### Step 5 (only when `--turbo` is passed, before handing off to Delta): Apply turbo authorization

If the operator passed `--turbo` on `/mode:oneshot`, invoke `scripts/turbo/apply.js` BEFORE handing off to Delta. The longer TTL (4h) is intentional — it matches a typical Delta run. Operator-supplied `--scope` / `--ttl` / `--reason` override the defaults below on every overlapping field.

```bash
node scripts/turbo/apply.js \
  --scope manifest-edit,write-jsonl,node-e-fs,worktree-ops \
  --ttl 4h \
  --reason "entered via /mode:oneshot --turbo (Delta run authorization)"
```

If the operator passed their own `--scope`/`--ttl`/`--reason`, use those values instead. The authorization is independent of Delta's lifecycle — Delta does NOT auto-extend or auto-clear it.

## Recovery

- If `mode-set` succeeded but `turbo apply` failed: mode is active without turbo. Re-run `/turbo` manually with the same args (or different ones) BEFORE Delta hands off, or accept the keyboard cadence for Delta's run.
- If turbo was already active when you ran `/mode:oneshot --turbo`: `scripts/turbo/apply.js` overwrites the prior scope/TTL with the new one (no merge). Run `/turbo --status` first if you need to preserve what's already there.
