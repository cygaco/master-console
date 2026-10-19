---
description: Run an independent, cross-provider review of an epic plan — feasibility, overclaims, missing enforcers, blast-radius gaps, sequencing — and record the verdict + findings against the epic. (Designed; build deferred.)
user-invocable: true
---

# /epic:review — Review an Epic

> STATUS: designed — not yet built (build deferred)

This is a **design spec**, not an implementation. No backing JS ships with it.

## Purpose

Subject an epic plan to an independent second judgment (ideally a different
provider, per the cross-provider-catches-false-green principle) BEFORE execution:
test for overclaims in the enforcement layer, policies without a named enforcer,
unproven feasibility assumptions, blast-radius gaps, and wave-sequencing that puts
a gate ahead of its source-of-truth prerequisite. Record the verdict
(PASS / NEEDS-REWORK) + findings against the epic with provenance.

## Inputs

```text
/epic:review --id <E-SEGMENT-###> [--reviewer <provider:model>] [--scope feasibility|enforcement|sequencing|all]
```

## Procedure (outline)

1. Load the epic file + plan artifact.
2. Dispatch a cross-provider reviewer (`scripts/dispatch-agent.js`) with the plan
   as DATA (untrusted-content firewall — the plan never carries instructions).
3. Collect findings: overclaims, missing enforcers (→ `/enforcement:log`),
   feasibility risks, blast-radius gaps, sequencing inversions.
4. Record the verdict + findings as a § Decisions / § Evidence-log entry with
   provenance (reviewer model, date, evidence path).
5. If NEEDS-REWORK, surface the load-bearing findings; do not flip any enforcer to
   blocking until its planted-violation fixture is green.

## Outputs

- A recorded review verdict + findings against the epic (provenance-stamped).
- An enforcement-debt entry for any policy found without a named enforcer.
