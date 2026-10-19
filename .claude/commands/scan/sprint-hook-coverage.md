---
description: Bidirectional coverage of the sprint hook-point registry — FORWARD (every matched block-row has a manager_consult record per /sprint:full run) + REVERSE (registry structurally coherent against role-registry)
---

# /scan:sprint-hook-coverage

The bidirectional coverage enforcer for the **sprint hook-point registry** (`.claude/agents/_org/sprint-hook-points.json`). The gap-finding mechanism (a hook point for each step, so new agents are easy to wire in and gaps are easy to find), made self-detecting on the agent↔sprint surface. Generalizes the single-manager `/scan:sprint-manager-consult` to the whole registry.

Runs `scripts/checks/sprint-hook-coverage.js`.

## The two directions

**FORWARD (per `/sprint:full` run).** For every hook-point row whose `condition` MATCHED the run's composition with `mode: "block"`, a `manager_consult` record for that role must exist over the run window — else `missing_block_agent` (a required agent declared at a step never ran). Advisory rows that matched but didn't run are reported as **info**, not findings (e.g. `design-quality`'s advisory ramp).

**REVERSE (static, registry-only).** The registry is structurally coherent — every row's `role` exists in `role-registry.json`, every `step` is a canonical lifecycle step, and no step is orphaned. Delegates to `scripts/sprint/hook-points.js` `validate()` (the same tripwire its own test asserts). A structurally-broken registry is **fail-closed (exit 2)** regardless of runs.

## Composition + records

- The run's **composition** `{ unit_types, max_risk, domains }` is derived from the sprint's ticket files (`paths.sprintTickets`) — the same source `full.js` feeds the router — via `hook-points.js#compositionFromTickets`.
- The **`manager_consult` records** are emitted by `scripts/sprint/hook-consult.js` (`emitStepConsults`), wired into `full.js`'s phase loop (`emitPhaseConsults`), one per engaged agent per step. Shape: `{ manager, mode, unit, verdict, phase, hook_mode }` with `sprint_id` on the event.

## Date-cutoff + graceful

- By default **no sprint is exempt by date**. A project whose older runs predate the `manager_consult` emitter can pass `--since <ISO>`: sprints whose start date is **before** it are then exempt (legacy — flagging them would be a false positive).
- Synthetic sprints (`SP-J*`, `SP-TEST*`), undated sprints, and sprints with no attributed `/sprint:full` run are exempt.
- **Graceful-empty:** no applicable runs → exit 0 (the registry is still validated). **Fail-closed:** a bad `--since`, or an unreadable/incoherent registry → exit 2.

## Exit codes

- `0` — registry coherent + 0 forward gaps (or nothing applicable to audit).
- `1` — ≥1 forward coverage gap (a matched block-row with no consult record).
- `2` — fail-closed (bad `--since`, unreadable/structurally-broken registry).

## Output

`--json` emits `{ ok, applicable, checked, findings[], info, totalFindings, cutoff }`. Default is a human summary; a FAIL lists the gaps.

## Bite-test

`node scripts/checks/test-sprint-hook-coverage.js` — proves forward gap detection, the exemptions (pre-cutoff when one is set / synthetic / undated / no-run), the no-cutoff defaults, advisory-as-info, and reverse coherence (the real registry passes; a broken one fails).
