---
description: Toggle the /sprint:full cost-estimate halt on or off — turn off the heuristic spend gate when an operator spend posture is authorized, turn it back on to restore the guardrail. Controls only the sprint cost halt, never the hard ceilings or the real >$5 rule.
---

# /sprint:cost-gate — Toggle the sprint spend gate

`/sprint:full` halts a run when its **coarse per-phase cost heuristic**
(`PHASE_TYPICAL_SPEND_USD` in `scripts/sprint/full.js`) exceeds the preset's
`cost_estimate_threshold_usd`. That number is a guardrail, **not measured
spend**. When the operator has authorized a session spend posture (and tracks
real spend separately), the heuristic halt is pure friction. This skill toggles
it.

**Scope — read this.** This controls ONLY the `/sprint:full` cost-estimate
halt. It does **not** lift the hard ceilings (push-to-remote /
production-deploy / paid-service-signup) or the real ">= $5 ask the operator"
autonomy rule — those are enforced elsewhere and are deliberately **not**
toggleable from here.

## Usage

```
/sprint:cost-gate status      # show ON/OFF + who set it + why
/sprint:cost-gate off         # disable the heuristic halt (records reason)
/sprint:cost-gate on          # restore the guardrail
```

Maps to the engine:
```
node scripts/sprint/cost-gate.js status
node scripts/sprint/cost-gate.js off --by <who> --reason "<why>"
node scripts/sprint/cost-gate.js on  --by <who>
```

When the operator invokes this, run the matching engine command. For `off`,
always pass a `--reason` capturing the authorizing context (e.g. the operator's
session spend cap and date) so the audit trail shows why the guardrail is down
and on whose authority.

## How it works

- Persistent state: `.claude/runtime/sprint-cost-gate.json` — **absent => gate
  ON** (the safe default; the guardrail is never silently removed by a
  missing/garbled file).
- `full.js` reads the toggle via `cost-gate.js#isCostGateEnabled()` when it
  builds the cost counter; with the gate OFF, `exceeded()` always returns
  `false`, so no `cost_threshold` halt fires.
- Per-run override without touching persistent state:
  `node scripts/sprint/full.js … --cost-gate on|off`.

## When to use

- **off** — an operator-authorized spend posture is in effect for a
  multi-sprint program and the heuristic should not stop every sprint. Record
  the authorization in `--reason`.
- **on** — restore the guardrail once the authorized work is done.

## Notes

- Turning the gate off is itself logged (`set_by`, `set_at`, `reason`).
- Real spend discipline does not depend on this gate: individual paid dispatches
  still follow the `< $5` autonomy rule, and the operator's authorized session
  cap is tracked independently.
- Pairs with `/session:turbo` (session pre-authorization) — turbo widens
  *permissions*; this widens the *cost-estimate halt*. Neither touches a hard
  ceiling.
