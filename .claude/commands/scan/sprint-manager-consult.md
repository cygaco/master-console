---
description: Audits manager-consult coverage across /sprint:full runs — asserts the design-quality authority was consulted on every UI/app-design/web-design-touching sprint
---

# /scan:sprint-manager-consult

Audits the **manager-consult coverage** required by ADR-0007. The named cross-domain design authority (`design-quality`) is wired into both build modes — adhoc (`.claude/agents/president/gamma.md` → "Design authority gate") and oneshot (`.claude/agents/president/_system/oneshot/protocol.md` Step 4 d.1). A wired gate that is silently **skipped** on a UI-touching sprint is invisible: nothing records that the design authority was ever consulted. This check closes that gap.

For every audited `/sprint:full` run (dated, and not before an optional `--since` cutoff) that shows a **design-touch signal**, it asserts a `manager_consult` event for `design-quality` exists in `paths.eventsFile` (events.jsonl) over the run — else it FAILs, listing the sprint.

## What it detects

Two finding types, each with shape `{ sprint_id, manager, evidence, finding_type }`. The first is **blocking** (drives the exit code); the second is **report-only** (surfaced, never flips the exit code).

1. **`missing_design_consult`** (BLOCKING) — a sprint shows a **design-touch signal** but has **no** `manager_consult` record for `design-quality`. The design-touch signal is established **independently** of the design-quality consult (so the check is not circular):
   - a `manager_consult` event for a design-domain manager **other than** `design-quality` — `visual-review` / `design-lead` / `design-review` (the multimodal review that runs on the same UI-diff condition), **or**
   - an explicit `ui_touched: true` field on any `sprint_full_*` event.

   Presence of UI work is proven by the independent marker; absence of the `design-quality` consult is the finding — exactly parallel to `/scan:sprint-beta-honesty`'s (`phase_started` ⇒ independent signal; consult-absence ⇒ finding).

2. **`missing_product_lead_authoring`** (REPORT-ONLY) — a sprint **produced a plan/design artifact** (emitted a `sprint_full_phase_started`/`_completed` event whose `phase` is exactly `plan` or `design`) but has **no** backing `ok:true` `product-lead` authorship dispatch record correlated by `sprint_id`. This enforces the routing (requirement authoring goes to `product-lead`, not α-self-authored). The in-scope signal is a **plan/design PHASE event** (a whitelist match on `phase ∈ {plan, design}`, NOT a loose substring — `replan`/`design-review` do not widen scope), established **independently** of the authorship record (so the check is not circular). Because solo/adhoc one-offs never invoke `/sprint:full`'s plan/design phases, they never emit these events and are **structurally carved out** — the solo exemption is *not* inferred from record-absence. It has no cutoff by default; a project can set one (the check's `AUTHORING_EXEMPT_BEFORE` constant, reported as `authoringCutoff`) to exempt its earlier backlog. This finding is **report-only** (returned on the separate `advisoryFindings` channel; the exit code keys on the blocking `findings` only) — the flip-to-blocking ramp is **operator-gated** and never self-promoted.

A `design-quality` consult of **any** verdict (`APPROVE` / `REJECT` / `MISSING` / `INVESTIGATE`) satisfies `missing_design_consult` coverage — the question is "did the authority run", not "what did it decide". (Whether a run shipped despite a `REJECT` is a different enforcer's concern — that override is owned by `/scan:adhoc-fail-override` on the adhoc side.) Likewise a `product-lead` authorship record of any kind satisfies `missing_product_lead_authoring`.

## Where the consult records come from

The `manager_consult` events are emitted by `scripts/checks/design-quality-gate.js` on **every** invocation (the gate's wiring in both modes passes `--mode <adhoc|oneshot> --unit <name>`). The logger routes them to `cat: "manager_consult"` with a fan-out file at `paths.events/manager-consult.jsonl`. Shape: `{ manager: "design-quality", mode, unit, verdict, lane2Mode, ts }`.

## Date-cutoff (legacy exempt)

By default **no sprint is exempt by date**. A project whose older runs predate the design-quality wiring can pass `--since <ISO-date>`: sprints whose start date is **before** it are then **exempt** — their runs predate the mechanism and flagging them would be false positives.

If a sprint's start date cannot be determined from `paths.sprintSprints/<id>/current.yaml` or `paths.sprintActiveRegistry`, the sprint is **exempted** (fail-safe). Synthetic/test sprints (prefix `SP-J`) are exempt from the live audit.

## Graceful empty

If no applicable (dated, design-touching, and not before an optional cutoff) sprints exist — the expected state until the first real UI `/sprint:full` run — the check exits `0`:

```
OK   [sprint-manager-consult] no applicable design-touching sprints in window (cutoff <date or none>) — nothing to audit
```

An empty events file or a dataset of only non-UI / legacy / synthetic sprints all produce this clean outcome.

## Invocation

```bash
node scripts/checks/sprint-manager-consult.js [--json] [--since <ISO-date>] [--telemetry-only-before <ISO-date>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | off | Emit machine-readable JSON instead of human text |
| `--since <ISO-date>` | none | Set a legacy-exempt cutoff date (sprints before it are exempt) |
| `--telemetry-only-before <ISO-date>` | none | Sprints started before it pass on a `manager_consult` telemetry record alone; from it on (and always, by default) a backing `ok:true` dispatch record is also required |

**Exit codes:** `0` = clean (no **blocking** findings, or no applicable sprints); `1` = one or more **blocking** `missing_design_consult` findings; `2` = usage error (bad/missing `--since` or `--telemetry-only-before`, fail-closed). The report-only `missing_product_lead_authoring` advisories **never** affect the exit code — they surface in `--json` (`advisoryFindings`) and as a stderr `INFO` block, and the flip-to-blocking ramp is operator-gated.

`missing_product_lead_authoring` has its own optional cutoff — the check's `AUTHORING_EXEMPT_BEFORE` constant, reported as `authoringCutoff` (null by default) — independent of the `missing_design_consult` `--since` cutoff. When one is set, sprints before it are exempt.

## JSON output shape

```json
{
  "ok": false,
  "applicable": 1,
  "checked": 1,
  "findings": [
    {
      "sprint_id": "SP-...",
      "manager": "design-quality",
      "evidence": "sprint shows a design-touch signal (visual-review manager_consult) but no manager_consult record for 'design-quality' was found for this sprint",
      "finding_type": "missing_design_consult"
    }
  ],
  "totalFindings": 1,
  "advisoryFindings": [
    {
      "sprint_id": "SP-...",
      "manager": "product-lead",
      "evidence": "sprint produced a plan/design artifact (sprint_full_phase_started:plan) but no backing ok:true 'product-lead' authorship dispatch record correlated by sprint_id was found (product-lead authoring required; report-only ramp)",
      "finding_type": "missing_product_lead_authoring"
    }
  ],
  "totalAdvisory": 1,
  "cutoff": null,
  "authoringCutoff": null,
  "undatedExempt": 0,
  "malformedLines": 0
}
```

> `ok` reflects the **blocking** `findings` only — a run with `totalAdvisory > 0` but `totalFindings == 0` still reports `"ok": true` and exits `0`.

## See also

- ADR-0007 (agent-system org rewrite; see `.claude/agents/president/_system/policy/adr/INDEX.md`) — the org rewrite whose manager-consult routing + telemetry this closes
- `scripts/checks/design-quality-gate.js` — the two-lane design authority gate that emits the `manager_consult` telemetry
- `.claude/agents/president/gamma.md` → "Design authority gate" — the adhoc caller
- `.claude/agents/president/_system/oneshot/protocol.md` Step 4 d.1 — the oneshot caller
- `/scan:sprint-beta-honesty` — the sibling coverage enforcer this check's structure clones
- `scripts/checks/test-sprint-manager-consult.js` — fixture-driven tests (run `node scripts/checks/test-sprint-manager-consult.js`)
