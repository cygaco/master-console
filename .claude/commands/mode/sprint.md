---
description: Enter sprint mode — ε (Alex Epsilon) conducts the full sprint lifecycle (plan→design→build→gauntlet→release→retro) via the registry-driven runtime, with REAL agent dispatch.
---

# /mode:sprint — Sprint Mode

Enter sprint mode. The active face is **ε (Alex Epsilon)** — the sprint deliver-face. ε
conducts the full lifecycle (**plan → design → build → gauntlet → release → retro**) by
reading the declarative hook-point registry: at each step it resolves the matched agent-set
under the sprint's composition, derives each role's dispatch route from the role-registry
keystone (ADR-0008), and **really dispatches** them — a real completion record per agent on
the canonical ledger `gauntlet-verify` reads (ADR-0009). Adding an agent to a sprint = adding
a registry row; ε is never edited.

> Sibling of `/mode:adhoc` (α+β+γ, single features) and `/mode:oneshot` (δ, skeleton builds).
> Sprint mode is for roadmap-sequenced, full-lifecycle work across all the manager + worker roles.

## The sprint team — persistent core + on-demand roster

Sprint mode runs a small **persistent coordination team** (spawned on mode entry, exactly
like adhoc's α+β+γ) plus an **on-demand hook-point roster** that ε dispatches per phase.

**Persistent team (the standing core — these three are always present):**
- **α (Alpha)** — lead / orchestrator (the session).
- **ε (Epsilon)** — the sprint **conductor and dispatch controller**: reads the hook-point
  registry, resolves each step's agent-set, derives each role's route from the role-registry
  keystone, and really dispatches. (ε is to sprint mode what γ is to adhoc mode.)
- **β (Beta)** — process judgment, consulted at the four phase boundaries
  (plan→design, design→build, gauntlet→release, release→retro).

**On-demand roster (NOT persistent — ε dispatches each at its registry hook-point, per
`.claude/agents/_org/sprint-hook-points.json`):**

| Step | Roles ε dispatches |
|---|---|
| plan | director-of-product, product-lead |
| design | product-lead, director-of-engineering, design-lead, quality-lead, copy-lead |
| build | frontend-builder, backend-builder, security-builder |
| gauntlet | frontend-reviewer, backend-reviewer, qa-reviewer, security-reviewer, visual-review, design-quality |
| release | qa-reviewer |
| retro | learner |

The **Director of Product** (and every other director / lead / builder / reviewer) is
**domain judgment at its hook-point, not a standing member** — directors give domain
judgment, β gives process judgment, and ε never replaces them. Adding or removing one of
these is a single registry row in `sprint-hook-points.json`; the persistent team never changes.

## What's REAL — both dispatch halves (honest scope — ADR-0009 Mitigation #4)

- **CLI-routable roles — REAL via the node runtime:** ε dispatches build-chain **builders**
  (`dispatch-claude.js`), cross-provider **reviewers** (`dispatch-agent.js` → GPT/Gemini), and
  claude-raw tools (`claude -p --agent`). The completion record reflects the **real** spawn
  outcome (a reap = 0-byte-on-exit-0 → `ok:false`); `recordAgentDispatch` refuses to write
  without a real boolean outcome (the fake-green guard). Proven: real `gpt-5.5` + `gemini-3.1-pro-preview`
  dispatches through ε wrote real completion records (315s / 107s wall-clock, real output bytes).
- **In-process roster — REAL via the ε conductor + the Agent tool (Increment B; ADR-0014):** managers/leads/directors
  (`claude-agent`) and the Claude-pinned `design-quality`/`visual-review` (`agent-tool`) CANNOT be
  spawned by a node process — only the harness Agent tool can. That tool is a **per-spec capability**:
  ε's spec lists `Agent`, so **the ε conductor — top-level OR teammate-spawned — dispatches the roster
  directly** (ADR-0014 retired the ED-041 "α-only" doctrine; ED-041 was a per-spec misstatement —
  a Claude subagent HAS `Agent` iff its spec grants it, which ε/γ/δ/α/β do). ε dispatches them via
  `Agent(subagent_type: <role>)` + a `scopeContract`, captures the returned envelope to a file, and
  records with `record-inprocess --evidence <file>` — whose `ok` is **derived from the real Agent-return
  bytes** (0-byte = reap → `ok:false`; no evidence = REFUSE, no record). A node script still can't call
  Agent — the runtime returns `spawned:false, reason:requires-orchestrator`, handing the spawn to the
  **ε-agent** (not α-only). **No-cascade invariant:** a summoned roster consult must NOT dispatch the
  build chain — ε is the sole builder-dispatcher; the spawn-hand stays with the conductor. Proven:
  a real `product-lead` Agent-tool spawn → evidence-bound record (`via:epsilon-agent`, 514 real bytes
  + `evidence_sha`).

### The in-process conduct loop (the ε conductor — top-level OR teammate)

> **Who may call the Agent tool (ADR-0014):** the in-process-roster dispatch below uses the harness
> Agent tool, which is a **per-spec capability** — a Claude subagent has `Agent` iff its agent-definition
> lists it (ε/γ/δ/α/β do; `general-purpose`/`*` does not). ε's spec lists `Agent`, so **the ε conductor
> dispatches the roster directly in ANY spawn context — top-level OR teammate-spawned ε alike.** ADR-0014
> retired the old "α-only" framing (ED-041 was a per-spec misstatement); `mode_profiles.sprint.alpha_only_shapes`
> is now `[]` — NO shape is α-only. Each roster spawn supplies a `scopeContract` (enforced by
> `scope-contract-guard`). **No-cascade invariant:** a summoned roster consult must NOT dispatch the
> build chain or cascade further — ε is the sole builder-dispatcher; the spawn-hand stays with the
> conductor. The loop below is therefore run by the ε conductor.

For each plan entry whose route is `claude-agent` / `agent-tool` (the ε runtime returns these as
`spawned:false, reason:requires-orchestrator` — a node process cannot call Agent, so the runtime hands
the spawn to the **ε-agent**, which spawns them via the Agent tool):

1. Dispatch via the harness Agent tool: `Agent(subagent_type: <role>, prompt: <step prompt>)`.
2. Capture the agent's returned envelope to a file (e.g. `.claude/runtime/epsilon-prompts/<sprint>-<step>-<role>.return.txt`).
3. Write the completion record:
   ```bash
   node scripts/sprint/epsilon-runtime.js record-inprocess \
     --sprint <id> --role <role> --step <step> --evidence <file> [--elapsed-ms <n>]
   ```

NEVER write the record without the Agent's real return — `record-inprocess` REFUSES on missing
evidence and records `ok:false` on a 0-byte return. The record is the same `ok:true` liveness
`gauntlet-verify` reads (absence = the lane silently died), so an in-process reviewer lane is
gated exactly like a CLI reviewer lane.

## Inputs

`/mode:sprint [--turbo [--scope <csv>|all] [--ttl <duration>] [--reason "<text>"]]`

### Default turbo scope

`manifest-edit,write-jsonl,worktree-ops` — config edits, jsonl audit writes, and worktree
operations for builder dispatch. No `push-to-main`, no `destructive-git`. TTL = 60m. (`push-to-main`
is opt-in only, per CLAUDE.md autonomy.)

## ⛔ Mode-init ≠ authorization — STOP after setup

Entering sprint mode is **plumbing only**: run the setup steps below (marker, team,
turbo), give the "Sprint mode active — what should we work on?" confirmation, then
**STOP and await an explicit in-session task.** Do **NOT** chain into a sprint — not
`/sprint:full`, not the ε runtime, not a build, not "continue" — even when a prior
session's handoff / `DUMP.md` / `TRACKER.md` says to continue or names a forward plan.
An inherited "continue" is **context, not a command**: the first state-changing action
after a bare `/mode:sprint` needs an explicit operator instruction given **this**
session. Running a sprint (Step 3) is a **separate, task-triggered action**, never a
consequence of mode entry. **The team spawn (Steps 1.5/1.75) IS part of *setup*, not
"the work" — bring α+ε+β up on entry; NEVER defer it. Deferring the team while
"waiting for the task" is exactly what makes the persistent team look like it "never
comes up" (witnessed 2026-06-06: the team was deferred, then the operator had to ask
"where's the team?").** (ROADMAP: "Mode-entry must NOT trigger autonomous work",
REPORTED-2026-06-06 → addressed; enforced mechanically by the `scripts/mode-set.js`
fresh-entry posture banner, behaviorally by this section + α/CLAUDE.md doctrine.)

## Procedure

> Steps 1–2.5 + 4 + 6 are **mode entry** and end at the Step 5 confirmation. Step 3
> ("Run the sprint") is **out of band** — it runs ONLY when the operator gives an
> explicit task this session, not as part of entering the mode.

### Step 1: Write mode marker

Run the canonical mode-set CLI (validates the transition and writes the v2 marker schema):

```bash
node scripts/mode-set.js sprint --by alpha
```

If the prior mode has an `activeBuild` or a different `lockOwner`, the CLI refuses and prints
why — halt the active build first, or pass `--force` (logs the override).

### Step 1.5: Verify team readiness + reconcile any existing team

Confirm the persistent-team specs exist:
- `.claude/agents/president/beta.md` (β)
- `.claude/agents/president/epsilon.md` (ε)
- `.claude/agents/president/alpha.md` (α)

Then reconcile any existing team (avoid the `-N` accretion bug, W-21): run the read-only
probe `node scripts/checks/adhoc-team-hygiene.js`. If a same-named member from a dead session
exists, `SendMessage {type:"shutdown_request"}` it **before** spawning. Cleanup =
`shutdown_request`, NEVER edit `config.json`. Classify fresh / stale / defunct exactly as
`/mode:adhoc` Step 1.75 does; when in doubt, recreate.

**Prerequisite (none — flag phased out):** As of Claude Code v2.1.178 (2026-06-15) the
experimental agent-teams flag (`env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) is being phased out
and is **no longer required**. Teams are now implicit + session-scoped: each teammate is spawned
via the `Agent` tool (`run_in_background: true`) and the harness auto-creates the session team;
`SendMessage` is built-in. Back-compat: on older Claude Code builds the flag may still gate the
legacy team panel — `/mc:health` §3.5 reports it as informational only.

### Step 1.75: Spawn the persistent team (ε + β) as named background subagents

**Concrete tool calls — execute directly, do not wrap in prompt-style language:**

1. There is **no separate team-create call** anymore — the team is implicit. The FIRST spawned
   named background subagent (item 2) implicitly creates the session team. Use a stable
   project-prefixed `name` convention for each teammate (e.g. `Epsilon`, `Beta`, or
   `mc-Epsilon`) so members are addressable AND distinguishable from sibling-project
   sessions in `~/.claude/teams/`.

2. Spawn ε + β as in-process teammates **in parallel** (single message, two Agent calls).
   `name` is the addressable handle (required). `team_name` is OPTIONAL back-compat metadata —
   the harness still accepts it and writes the `members[]` config, but it is no longer the
   session-team identity: as of v2.1.178 the team is the IMPLICIT session-scoped team (named
   `session-<uuid>`) the first named spawn creates, and project scoping is by member `cwd`. Pass
   `team_name` only as a human-readable label.
   **The `name` MUST be a plain alphanumeric
   token** — the harness now enforces `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` and REJECTS the old
   parens+unicode forms (`Epsilon (ε)`, `Beta (β)`); use plain `Epsilon` / `Beta`
   (L-2026-06-09-team-name-regex-rejects-parens-unicode). Each gets a STARTUP DIRECTIVE: acknowledge
   readiness via `SendMessage(to:"team-lead")`, then go idle, do NOT auto-claim tasks.

   ```
   Agent(subagent_type: "epsilon", team_name: "<project>-sprint", name: "Epsilon",
     run_in_background: true,
     prompt: "STARTUP DIRECTIVE — SendMessage readiness to \"team-lead\", then go idle; do NOT claim tasks.\nYou are Alex ε, the sprint conductor joining <project>-sprint as \"Epsilon\".\nLoad: .claude/agents/president/epsilon.md + scripts/sprint/epsilon-runtime.js + .claude/agents/_org/sprint-hook-points.json.\nSendMessage(to:\"team-lead\", summary:\"Epsilon online\", message:\"ε online — ready to conduct.\")\nGo idle.")

   Agent(subagent_type: "beta", team_name: "<project>-sprint", name: "Beta",
     run_in_background: true,
     prompt: "STARTUP DIRECTIVE — SendMessage readiness to \"team-lead\", then go idle; do NOT claim tasks.\nYou are Alex β joining <project>-sprint as \"Beta\".\nLoad: .claude/agents/president/beta.md + .claude/agents/president/_system/policy/decision-policy.md.\nSendMessage(to:\"team-lead\", summary:\"Beta online\", message:\"β online — ready for boundary consultation.\")\nGo idle.")
   ```

3. **Confirm readiness BEFORE proceeding — a spawned team is not a live team until it
   acknowledges.** Wait for BOTH `SendMessage(to:"team-lead")` readiness pings (ε + β)
   before Step 2 / before any boundary consult. A consult sent to a teammate that hasn't
   finished starting up is MISSED, and the teammate then goes idle without answering
   (witnessed 2026-06-06: β consulted pre-readiness sat idle until nudged). Recovery:
   **idle ≠ dead** — re-send a `SendMessage` to wake an idle teammate; if a spawn returns
   but NO readiness ping ever arrives, the teammate was likely reaped (RI-004-class) —
   re-spawn it. Do NOT reach a boundary consult (or `/sprint:full`) until both pings are in.

4. **Once the team is live, suspect DELIVERY before suspecting the VERDICT.** Teammate messages
   batch and cross; a verdict that looks missing is far more often a crossing than a refusal.
   ~19 crossings caused zero damage on 2026-07-30 because four cheap mechanisms were in place —
   keep all four:
   - **Key every ask to its round** (`r13`, `GATE-B r2`). A late answer then self-files against
     the round it belongs to instead of arriving as an orphan nobody can place.
   - **Cite the `msg_id`** of every ruling you rely on, so "β ruled X" is checkable rather than
     remembered.
   - **Only an UNANSWERED KEYED ASK is a legitimate block signal.** Silence on an unkeyed
     question is not a block — re-ask it keyed before halting anything on it.
   - **When re-asked, the judge names the `msg_id`s it already issued**, which turns a stall
     into a one-step diagnosis. Twice on 2026-07-30 a release stalled on a ruling that ALREADY
     EXISTED; both recovered in one exchange because the ask was keyed.

**Layer 1 (persistent team):** α (lead) + ε (conductor) + β (judgment) — members in
`~/.claude/teams/<project>-sprint/config.json`, addressable by name via SendMessage.
**Layer 2 (ε's hook-point roster):** directors / leads / builders / reviewers / learner —
dispatched ephemerally by ε per the hook-point registry; NOT team members, they exit on return.

### Step 2: Set mode context

Acknowledge the mode switch:

```
MODE: sprint
Team: α (lead) + ε (conductor/dispatch) + β (judgment) — persistent; directors/leads on-demand at hook-points
Conductor: ε (Alex Epsilon) — the sprint deliver-face
Lifecycle: plan → design → build → gauntlet → release → retro (registry-driven)
Dispatch: REAL — CLI routes via the node runtime (builders + cross-provider reviewers); in-process roster (managers/leads/design-quality) via ε-the-agent + the Agent tool (record-inprocess)
β: consulted at the four phase boundaries (plan→design, design→build, gauntlet→release, release→retro)
```

### Step 2.5: Start-of-work — consult TRACKER.md

Before running the sprint (substantial long-running work), read `TRACKER.md` (spec §7.2 / §28.1) and determine whether this sprint belongs to an **active** epic/sprint, a **planned** one, **untracked** work, or a **new** epic/sprint that must be created. Confirm the relevant epic/sprint's current state, next action, blockers, and that its `/trackers/` file exists; create a missing tracker file before starting. The sprint must not begin from memory alone; meaningful work outside a tracked epic/sprint is recorded in `UNTRACKED_WORK.md` (§7.9). (This is the tracker-consult step only — it does not alter the α+ε+β persistent-team setup in Steps 1.5/1.75.)

### Step 3 (separate action — runs ONLY on an explicit in-session task, NOT on mode entry): Run the sprint

> **Gate:** do not reach this step as part of entering the mode. Mode entry ends at the
> Step 5 confirmation. Run a sprint only when the operator gives an explicit request in
> this session. A handoff/`DUMP.md`/`TRACKER.md` "continue" does NOT satisfy this gate.

**How the team is engaged during `/sprint:full` (read this — it's why the team can look "absent"):**
`/sprint:full` runs as a **node subprocess that CANNOT reach the in-process team** —
`SendMessage`/`Agent` are harness-only (`scripts/sprint/full.js`: *"a spawnSync-d node
subprocess cannot reach the in-process SendMessage/…"*). So β is consulted by **halt-and-bridge**,
not by the script talking to β: the orchestrator HALTS with `beta_consult_pending` at each phase
boundary, **Alpha** relays the consult to the live β teammate, captures the verdict, and resumes
with `--beta-verdict <V> --beta-message "<…>"`. Therefore the persistent team must already be UP
(Steps 1.5/1.75, readiness confirmed) **before** `/sprint:full` reaches a boundary — `/sprint:full`
**cannot bring the team up itself.** If β isn't up when the halt fires, there is nothing to consult
and the run stalls — that is the "the team isn't there" symptom. (`/sprint:full` does not spawn,
check, or wake the team; Alpha owns team liveness across the node seam.)

Sprint mode is driven by **`/sprint:full`** (the orchestrator that chains the five phases under a
bounded autonomy preset) — it invokes the ε runtime for dispatch:

```bash
/sprint:full "<request>" [--autonomy conservative|moderate|aggressive] [--mode adhoc|solo]
```

Or drive the ε runtime directly:

```bash
node scripts/sprint/epsilon-runtime.js plan    --sprint <SP-id> [--json]   # resolve the per-step dispatch plan
node scripts/sprint/epsilon-runtime.js conduct --sprint <SP-id> --dispatch # conduct + REALLY dispatch (CLI routes)
node scripts/sprint/epsilon-runtime.js record-inprocess --sprint <SP-id> --role <r> --step <s> --evidence <file>  # record an in-process Agent-tool spawn
```

### Step 4: Update heartbeat (if store exists)

If `.claude/agents/store.json` exists and has a heartbeat, update:
```json
{ "agent": "epsilon", "workstream": "sprint" }
```

### Step 5: Confirm

Report: "Sprint mode active. ε conducts the lifecycle; CLI-routable agents dispatch for real via
the node runtime, the in-process roster dispatches via ε-the-agent + the Agent tool (evidence-bound
`record-inprocess`). Run `/sprint:full \"<request>\"` to start a sprint."

### Step 6 (only when `--turbo` is passed): Apply turbo authorization

After `scripts/mode-set.js sprint` exits 0, if the operator passed `--turbo`, invoke
`scripts/turbo/apply.js` with the per-mode default scope merged with operator-supplied args
(operator args win on every overlap):

```bash
node scripts/turbo/apply.js --scope manifest-edit,write-jsonl,worktree-ops --ttl 60m --reason "entered via /mode:sprint --turbo"
```

## Recovery

- If `mode-set` succeeded but `turbo apply` failed: mode is active without turbo. Re-run `/turbo` manually.
- If a sprint is mid-flight, `/sprint:full --resume` continues it; the mode marker is independent of sprint progress.

## Reference

- Conductor spec: `.claude/agents/president/epsilon.md`
- Runtime: `scripts/sprint/epsilon-runtime.js` (+ `epsilon-runtime.test.js`)
- Orchestrator: `/sprint:full` (`scripts/sprint/full.js`)
- ADR: `0009-epsilon-sprint-runtime.md` (Mitigation #4 = real dispatch — both the CLI-route + in-process increments)
