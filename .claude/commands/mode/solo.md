---
description: Enter solo mode — just Alpha and the user, no agent team
says:
  - solo mode
  - just you and me
  - no team
  - switch to solo
says-confirm: fuzzy-only
---

# /mode:solo — Solo Mode

Enter solo mode. No agent team — just Alpha working directly with the user. Simple back-and-forth iteration.

## When to use

- Quick one-off tasks
- Debugging, exploration, research
- Tasks that don't need a builder/gauntlet cycle
- When you explicitly want to work without agents

## Inputs

`/mode:solo [--turbo [--scope <csv>|all] [--ttl <duration>] [--reason "<text>"]]`

Without `--turbo`, the skill behaves as before. With `--turbo` and no further args, the per-mode default scope is applied (see Default turbo scope below). The standalone `/turbo` skill remains the canonical interface for ad-hoc adjustments after mode entry.

### Default turbo scope

`manifest-edit,write-jsonl` — config edits + jsonl audit writes. No `push-to-main`, no `destructive-git`, no `node-e-fs`. TTL = 60m. Sibling skill: [`/turbo`](../turbo.md).

## ⛔ Mode-init ≠ authorization — STOP after setup

Entering solo mode is **plumbing only**: write the marker, give the Step 3 "Solo mode
active — what do you need?" confirmation, then **STOP and await an explicit in-session
task.** Do **NOT** chain into work or "continue" a prior plan — even when a handoff /
`DUMP.md` / `TRACKER.md` says to continue or names a forward plan. An inherited
"continue" is **context, not a command**: the first state-changing action after a bare
`/mode:solo` needs an explicit operator instruction given **this** session. (Enforced
mechanically by the `scripts/mode-set.js` fresh-entry posture banner, behaviorally by
this section + α/CLAUDE.md doctrine.)

## Procedure

### Step 1: Write mode marker

Run the canonical mode-set CLI (validates the transition and writes the v2 marker schema with `enteredAt`, `enteredBy`, `allowedTransitions`, `activeBuild`, `lockOwner`):

```bash
node scripts/mode-set.js solo --by alpha
```

If the prior mode has an `activeBuild` or different `lockOwner`, the CLI will refuse and print why. Halt the active build first or pass `--force` (logs the override).

### Step 1.5: Start-of-work — consult TRACKER.md

Before substantial long-running work, read `TRACKER.md` and determine whether the work belongs to an **active** epic/sprint, a **planned** one, **untracked** work, or a **new** epic/sprint that must be created. Solo work that meaningfully changes roadmap/epic/sprint/definition/path/wiring state must not start from memory — if it falls outside a tracked epic/sprint, record it in `UNTRACKED_WORK.md`. Quick one-off tasks with no state effect skip this.

### Step 2: Set mode context

Acknowledge the mode switch:

```
MODE: solo
Team: none — just Alpha + user
Orchestrator: none
Build capability: Alpha builds directly (no gauntlet)
```

### Step 2: Update heartbeat (if store exists)

If `.claude/agents/store.json` exists and has a heartbeat, update:
```json
{ "agent": "alpha", "workstream": "solo" }
```

If no store exists, skip this step.

### Step 3: Confirm

Report: "Solo mode active. Working directly — no agents, no gauntlet. What do you need?"

### Step 4 (only when `--turbo` is passed): Apply turbo authorization

After `scripts/mode-set.js solo` exits 0, if the operator passed `--turbo`, invoke `scripts/turbo/apply.js` with the per-mode default scope merged with operator-supplied `--scope` / `--ttl` / `--reason`. Operator-supplied args win on every overlapping field.

```bash
node scripts/turbo/apply.js \
  --scope manifest-edit,write-jsonl \
  --ttl 60m \
  --reason "entered via /mode:solo --turbo"
```

If the operator passed their own `--scope`/`--ttl`/`--reason`, use those values instead of the defaults above.

## Recovery

- If `mode-set` succeeded but `turbo apply` failed: mode is active without turbo. Re-run `/turbo` manually with the same args (or different ones).
- If turbo was already active when you ran `/mode:solo --turbo`: `scripts/turbo/apply.js` overwrites the prior scope/TTL with the new one (no merge). Run `/turbo --status` first if you need to preserve what's already there.
