# S-OS-06 r4 — Lane I (I2/I3/I4) REPORT — STATUS: IN PROGRESS (stub, committed before analysis)

Author: backend-builder (dispatched worker), I4 re-dispatch, 2026-09-16 ~13:52 PDT.
Branch `s-os-06/s2i-capture`. Prior dispatch I3 was reaped at the 20-min wrapper bound
(`builder_timeout_reap`, stdout 0 bytes). This file is the durable report; stdout is not.

## Commits on this lane
- `e23fb60a` I2 — preserve predecessor's uncommitted capture-rewrite work, as-is, unevaluated
- `533d0879` I3 — falsifiers 1+2 RUN; sprint falsifier file measured 8/9 RED at e23fb60a
- `bdea84c9` I3 — F4/F5/F6 probes RUN; F3 vs committed register ENVIRONMENT-SENSITIVE
- `e5995b03` I4 step 1 — on-disk residue committed as-is
- (this commit) I4 step 2 — this stub + orphan-written `stability-committed-load4-envctl.summary.json`

## Orphan note (observed, I4)
`stability-committed-load4-envctl.summary.json` has mtime 13:51:21 PDT. The I4 dispatch process
(`dispatch-claude.js`, PID 42812) was created 13:51:01. So this file was written ~20 s AFTER I4
started, by a grandchild of the reaped I3 dispatch that survived the reap (ED-039/RI-004 class).
No matching node process was running at 13:51:49. It is committed as-is and is evaluated below
only if the evaluation section says so.

## Falsifiers — TO BE FILLED from the committed evidence (sections follow)
