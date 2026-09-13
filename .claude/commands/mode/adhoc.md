---
description: Enter adhoc team mode — Alpha + Beta + Gamma for collaborative feature development
---

# /mode:adhoc — Adhoc Team Mode

Enter adhoc team mode. Creates an agent team with Alpha (lead) + Beta (judgment) + Gamma (adhoc orchestrator). This is the default mode for development.

## When to use

- Building or iterating on individual features
- After a oneshot run, for fixing and polishing
- Any development work that benefits from a build/gauntlet cycle
- The default mode — if unsure, use adhoc

## Inputs

`/mode:adhoc [--turbo [--scope <csv>|all] [--ttl <duration>] [--reason "<text>"]]`

Without `--turbo`, the skill behaves as before. With `--turbo` and no further args, the per-mode default scope is applied (see Default turbo scope below). The standalone `/turbo` skill remains the canonical interface for ad-hoc adjustments after mode entry.

### Default turbo scope

`manifest-edit,write-jsonl,worktree-ops` — config edits, jsonl audit writes, and worktree operations for builder dispatch. No `push-to-main`, no `destructive-git`. TTL = 60m. Sibling skill: [`/turbo`](../turbo.md).

> **`node-e-fs` is deliberately excluded from the default.** The auto-mode classifier hard-denies a turbo scope that auto-approves arbitrary `node -e` execution (Auto-Mode Bypass), so a default containing it fails on first use. Pass it explicitly only in a non-auto-mode session; the durable `settings.allow` already grants the common `node -e` fs writes. (`scripts/turbo/apply.js` also drops it under auto-mode.)

## ⛔ Mode-init ≠ authorization — STOP after setup

Entering adhoc mode is **plumbing only**: run the setup steps below (team, marker,
turbo), give the Step 5 "Adhoc team active — what feature are we working on?"
confirmation, then **STOP and await an explicit in-session task.** Do **NOT** chain
into work — not a build, not a γ dispatch, not "continue" — even when a prior session's
handoff / `DUMP.md` / `TRACKER.md` says to continue or names a forward plan. An
inherited "continue" is **context, not a command**: the first state-changing action
after a bare `/mode:adhoc` needs an explicit operator instruction given **this**
session. (ROADMAP: "Mode-entry must NOT trigger autonomous work", REPORTED-2026-06-06
→ addressed; enforced mechanically by the `scripts/mode-set.js` fresh-entry posture
banner, behaviorally by this section + α/CLAUDE.md doctrine.)

## Procedure

### Step 1: Verify team readiness

1. Confirm Beta agent file exists: `.claude/agents/president/beta.md`
2. Confirm Gamma agent file exists: `.claude/agents/president/gamma.md`
3. Confirm adhoc protocol exists: `.claude/agents/president/_system/adhoc/protocol.md`

If any are missing, warn and offer to continue in solo mode instead.

### Step 1.5: Write mode marker

Run the canonical mode-set CLI (validates the transition and writes the v2 marker schema):

```bash
node scripts/mode-set.js adhoc --by alpha
```

If the prior mode is `oneshot` with an `activeBuild`, the CLI refuses — halt the build first.

### Step 1.6: Start-of-work — consult TRACKER.md

Before substantial long-running work, read `TRACKER.md` (spec §7.2 / §28.1) and determine whether the feature belongs to an **active** epic/sprint, a **planned** one, **untracked** work, or a **new** epic/sprint that must be created. Do not begin meaningful build work from memory alone. Meaningful work performed outside a tracked epic/sprint is recorded in `UNTRACKED_WORK.md` (§7.9).

### Step 1.75: Classify any existing team state (Phase 0 workstream I)

Before spawning a new team, classify the current team state. The team
primitives (the Agent-spawn + SendMessage + maxTurns-reap primitives) live
in the Claude Code harness and are NOT directly inspectable from this repo — so this is
a checklist Alpha walks through with the user, not an automated probe.

Classification:

| State | Signal | Action |
|---|---|---|
| **fresh** | Team created this session, all teammates idle, no stale prompts | Reuse — go to Step 3 |
| **stale** | Team created hours ago, teammates have message backlog, prompts reference completed work | Refresh: send a "reset context" SendMessage to each teammate before continuing |
| **defunct** | Teammate(s) hit maxTurns and were reaped; SendMessage returns "agent exited" | Force-recreate: spawn fresh teammates with the same names |
| **unknown** | No clear signal | Treat as defunct — recreate is the safer default |

When in doubt, recreate. The cost of an extra spawn is far less than the
cost of dispatching a feature into a half-dead team.

**Reconcile before spawning (avoid `-N` accretion).** Before creating teammates,
run the read-only probe `node scripts/checks/adhoc-team-hygiene.js` to detect an
existing team whose members carry a `-N` suffix (`Beta (β)-2`) or a stale
`leadSessionId` — the cross-session accretion bug (W-21). If found:
`SendMessage {type:"shutdown_request"}` each stale / dead-session same-name member
**before** spawning the new generation, so the harness never mints a `-N` suffix.
Reuse any member that is live in the current session instead of re-spawning.
**Cleanup = `shutdown_request`, NEVER edit `config.json`** — deleting a member
entry orphans a still-running in-process agent (it stays addressable and
reappears). This probe is also wired into `/mc:health`.

### Step 2: Create team and spawn teammates

**Prerequisite (none — flag phased out):** As of Claude Code v2.1.178 (2026-06-15) the
experimental agent-teams flag (`env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) is being phased out
and is **no longer required**. Teams are implicit + session-scoped: each teammate spawns via
`Agent(run_in_background: true)` and `SendMessage` is built-in. Back-compat: older Claude Code
builds may still use the flag — /mc:health Section 3.5 reports it as informational only.

**Concrete tool calls — execute these directly, do not wrap them in prompt-style language:**

2.1 There is **no explicit team-create call** — the first named background subagent (Step 2.2)
implicitly creates the session team.
- Convention: prefix the teammate `name` with the project slug (`mc-adhoc`,
  `jobhunter-adhoc`, etc.) to avoid global-namespace collisions with sibling-project `adhoc`
  members in `~/.claude/teams/`.
- Clean slate: there is no `TeamDelete` tool. Teams are session-scoped, so a fresh session
  starts clean. Stale members from a dead session are reconciled via
  `SendMessage {type:"shutdown_request"}` (NEVER by editing `config.json`).

2.2 Spawn β as an in-process teammate. `name` is the addressable teammate handle (required —
plain-token regex below). `team_name` is OPTIONAL back-compat metadata: the harness still ACCEPTS
it (even though the Agent tool's documented schema doesn't list it) and records it, but it is NO
LONGER the session-team identity — as of v2.1.178 the team is the IMPLICIT session-scoped team
the harness creates on the first named spawn (named `session-<uuid>`), and project scoping is by
member **`cwd`**, not `team_name`. So pass `team_name` for a human-readable, sibling-project-distinct
label if you like; do not rely on it to identify or create the team. The harness still writes the
`members[]` config keyed by session. Validated 2026-05-14 (RT-006), re-confirmed under v2.1.178.

**The `name` MUST be a plain alphanumeric token** — the harness now enforces
`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` on the spawn `name` and REJECTS the old
parens+unicode forms (`Beta (β)`). Use plain `Beta` / `Gamma`
(L-2026-06-09-team-name-regex-rejects-parens-unicode).

```
Agent(
  subagent_type: "beta",
  team_name: "<project>-adhoc",
  name: "Beta",
  run_in_background: true,
  prompt: "STARTUP DIRECTIVE — Acknowledge readiness via SendMessage to \"team-lead\", then go idle. Do NOT claim tasks.\n\nYou are Alex β. Joining team <project>-adhoc as \"Beta\".\nLoad: .claude/agents/president/beta.md, .claude/agents/president/_system/policy/decision-policy.md, .claude/project/stage/current-stage.md\nSendMessage(to: \"team-lead\", summary: \"Beta online\", message: \"β online — ready for consultation.\")\nGo idle."
)
```

Success response:
```
Spawned successfully.
agent_id: Beta@<project>-adhoc
name: Beta
team_name: <project>-adhoc
```
The harness writes a `member` entry with `backendType: "in-process"` to
`~/.claude/teams/<project>-adhoc/config.json`.

2.3 Spawn γ the same way with `subagent_type: "gamma"`, `name: "Gamma"` (plain
token — same regex as β above),
and a parallel STARTUP DIRECTIVE prompt referencing
`.claude/agents/president/gamma.md` + `.claude/agents/president/_system/adhoc/protocol.md`.

**Run 2.2 and 2.3 in parallel** (single message, multiple Agent tool calls) —
they're independent.

**STARTUP DIRECTIVE rationale:** the only repo-accessible lever to prevent
teammates from auto-claiming pending tasks. `claim_on_startup: false` is not a
harness setting today; prompt enforcement is what we have.

**Layer 1 (this team):** Alpha (lead) + Beta (judgment) + Gamma (orchestrator) — members of the team in `~/.claude/teams/<project>-adhoc/config.json`, addressable by name via SendMessage.
**Layer 2 (Gamma's subagents):** Builder, Evaluator, Security, Compliance, QA, Fix Agent, Auditor — spawned by Gamma as ephemeral subagents per feature; NOT team members, they exit on return.

### Step 3: Set mode context

Acknowledge the mode switch:

```
MODE: adhoc
Team: α (lead) + β (teammate) + γ (teammate)
Layer 1: Agent team — shared task list, direct messaging
Layer 2: Gamma spawns builder/reviewer/security subagents as needed
Build cycle: dispatch → gauntlet (reviewer + req-reviewer + security + compliance + QA) → fix → report
```

### Step 4: Update heartbeat (if store exists)

If `.claude/agents/store.json` exists and has a heartbeat, update:
```json
{ "agent": "alpha", "workstream": "adhoc" }
```

### Step 5: Confirm

Report: "Adhoc team active. Alpha (lead) + Beta (β) + Gamma (γ). What feature are we working on?"

### Step 6: Touch the team marker (Phase 0 workstream I)

After confirmation, write a freshness marker:

```bash
date -u +%FT%TZ > .claude/runtime/.team-marker
```

`scripts/hooks/session-start.js` checks this marker on cold start. When
it is older than 24 hours, session-start emits a warning suggesting the
operator re-run `/mode:adhoc` to refresh classification.

### Step 7 (only when `--turbo` is passed): Apply turbo authorization

After all prior steps succeed, if the operator passed `--turbo`, invoke `scripts/turbo/apply.js` with the per-mode default scope merged with operator-supplied `--scope` / `--ttl` / `--reason`. Operator-supplied args win on every overlapping field.

```bash
node scripts/turbo/apply.js \
  --scope manifest-edit,write-jsonl,worktree-ops \
  --ttl 60m \
  --reason "entered via /mode:adhoc --turbo"
```

If the operator passed their own `--scope`/`--ttl`/`--reason`, use those values instead of the defaults above.

## Recovery

- If `mode-set` succeeded but `turbo apply` failed: mode is active without turbo. Re-run `/turbo` manually with the same args (or different ones).
- If turbo was already active when you ran `/mode:adhoc --turbo`: `scripts/turbo/apply.js` overwrites the prior scope/TTL with the new one (no merge). Run `/turbo --status` first if you need to preserve what's already there.

## Built-in primitive limits (honest disclosure)

Phase 0 workstream I documented several harness behaviours we cannot fix
from inside the repo:

- **`TeamCreate`/`TeamDelete` no longer exist** as of Claude Code v2.1.178 —
  teams are implicit + session-scoped. There is no team-refresh primitive:
  to "refresh a defunct team," start a fresh session (the implicit team is
  recreated clean) or re-spawn the named subagents via `Agent(run_in_background: true)`.
- **`SendMessage` IS available in the harness** — the Agent tool's spawn
  output returns a stable `agentId` and an explicit hint `Use SendMessage
  with to: <id> to continue this agent.` The remaining limitation is that
  the SendMessage **schema is not discoverable via ToolSearch keyword
  lookup** (`select:SendMessage` returns empty). Attempt the call anyway —
  it may resolve at use-time. The directive is: ToolSearch absence ≠
  harness absence; the spawn output is ground truth. (Validated
  2026-05-13: Beta agentId `ac69b6bf3df4747c3`, Gamma agentId
  `ad97643d7efe975f4` were both spawned with the hint in their output.)
- **`SendMessage` to a maxTurns-reaped teammate** returns an error string
  but does not auto-respawn. Alpha must detect the failure and re-spawn.
- **`claim_on_startup: false`** is not a harness setting — the directive in
  Step 2 is prompt-level enforcement only.
- **Team task ownership** is ephemeral. Any work that must survive a team
  reap or session restart must be tracked in durable repo state
  (`.claude/agents/store.json`, `paths.decisionLedger`, or a feature's
  `_requirements/04-features/<feature>/PRD.md`), NOT in team-task
  metadata.

See `_docs/phase0/adhoc-primitive-limits.md` for the full inventory.

## Tracker source-of-truth rule

Future sprint work (e.g. anything `/sprint:design` writes) lives in
durable repo state — `_requirements/04-features/`, `.claude/project/`,
or designated tracker files — never in team-task ownership alone. Team
tasks are a coordination layer, not a record-of-decisions layer.
