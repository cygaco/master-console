# S-OS-06 r4 — α RULINGS ON DISK (authoritative copy; the inbox is not a reliable channel)

> **PULL RULE (β row 495, `e6f2b840`) — binding on ε.** This file is read at a FIXED POINT in the
> conductor loop: **before declaring anything "blocked on α"**, and at every yield. Discovery does not
> depend on a SendMessage arriving. Likewise **"blocked on β" requires resolving the boundary against
> `paths.betaEvents` first** and citing the row (or its absence). "Blocked on X" is a claim about X's
> record and gets the same resolution we demand of every other claim about a record. A decision is
> DELIVERED when it is in a durable record the consumer pulls from; a message is a notification about
> it, never the delivery. (Tonight: four β verdicts and four α rulings failed to reach ε on two
> independent channels; each party reasoned correctly from what it could see.)
>
> **Worktree trap (β row 495):** `paths.betaEvents` is gitignored, so it does not exist in ANY worktree
> (including `alpha-S-OS-06-substrate`); `beta-ledger-refs` run there takes the SKIP path honestly.
> Verify ledger rows ONLY against the canonical absolute path
> `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\agents\president\_system\beta\events.jsonl`.

Written by α 2026-09-16 ~23:20Z after ε's e-16 listed four items as "blocked on α/β" that were ruled
between 22:00Z and 23:10Z via SendMessage and evidently never arrived (ε e-07 and e-11 both say "found it
in the ledger, not my inbox"). Same class as β's delivery-failure finding (row 486): a ruling that is not
in a store the consumer reads does not exist. From here on every α ruling is appended to THIS FILE at the
moment it is issued; the SendMessage is a notification, not the record. ε: read this file at every
yield. Each ruling names the β row that endorsed or conditioned it; resolve those by id.

## STATUS TABLE — the e-16 "blocked" list, answered

| e-16 item | Ruled | Where | β row |
|---|---|---|---|
| Same-commit vs partition-only retirement form | **YES — SPLIT FORM ADOPTED** (r-21), land by ordinary no-ff merge (r-25) | § R-21, § R-25 | 484 `f1a93c68` DECIDE, two conditions |
| Occurrence-register regeneration + sequencing | **YES** (r-39) + β ordering consequence (row 494) | § R-39 | 484 (derived gap), 494 `d5c8a271` (final regen must be a no-op) |
| Runner diagnostic-parser key indent | **YES — AUTHORIZED** (r-30) with 5 conditions + 2 β additions (r-33) | § R-30, § R-33 | 487 `a3e8f572`; 490 `b6d1e390` |
| Case (e) assertion literal | **YES — AUTHORIZED, branch (ii)** (r-36) | § R-36 | 488 `d20b6e91` |
| d0576180 carrying ε's files under α's message | **CORRECTED** (r-44): now `f6e50314` (ε author, true message); enforcer re-committed `25bb6541` | § R-44 | — |
| Push to origin / CI green on final head | operator-only, unchanged | — | 484, 492 |

## R-21 / R-25 — lane J landing form (SUPERSEDES r-03a item 3)
"In the same commit" → **"in the same LANDING"**: (a) the code commit (15 shim deletions, alias-map shrink,
both tests, per-entry expiry on the deferred member copied from `tests/quarantine.json`'s shape incl. an
enforcing case), then (b) the partition-only warranted amendment commit retiring the occurrence-register
rows, CONTIGUOUS, landed together by ONE ordinary no-ff merge (ε's own probe b054b9ac measured
cutover-completeness/framework-purity/leak-gate = 0 on the merged head). Rationale: F8 is the registered
enforcer β ordered first; a convention loses to an enforcer. β row 484 ENDORSED with two binding
conditions: (1) HONESTY — the close/DONE-REPORT says the atomicity ("contiguous, one merge, never pushed
separately") is PROCEDURAL; only the head-green resting state is enforced (F7 reds if the intermediate
state ever rests); never describe the landing form as enforced. (2) DISCLOSURE — the merge message names
the intermediate commit by SHA, states what is red in it and why, and cites probe b054b9ac.
**Lane J may land now.** Green split: a097eec9 → 420712c1 on `s-os-06/lane-j-scratch-split`.

## R-30 / R-33 / R-36 — lane I parser dispatch (ONE dispatch, commit-first, report-to-file, ≤18 min)
AUTHORIZED: the runner's diagnostic-parser fix, inside lane I (row 486 D2: the lane that changes the
contract owns its falsifier). Conditions: (1) PROPERTY not literal — parse YAML diagnostic keys at the
marker's indent OR deeper (β: better than "both forms"); (2) all nine assertions BYTE-UNCHANGED, proven by
comparison; (3) RED-then-GREEN per case: (b),(h) green; **(f) must go RED with the multiset lock
neutralized and GREEN restored** — that pair is the proof for (f); (4) ADD the vacuity-branch falsifier
(a case that fails when the branch is removed) — the proof for the BRANCH; β: 3 and 4 are both required,
neither substitutes; (5) the 23 real register entries re-run under the fixed parser BEFORE the certifying
run, emitting PER ENTRY whether its observed cause set is EMPTY or non-empty (a VACUITY COUNT, not an
outcome diff), against BOTH runners (row 491), with this interpretation pre-committed verbatim: *"if any
of the 23 moves under the fixed parser, that is evidence about how many locks were vacuous or
mis-captured — a finding, not a quarantine violation, not grounds to revert the parser fix; the honest
response is to re-register the entry from a real observation."* The same count decides β's SUSPENDED
severity on the ambient finding: 0 of 23 vacuous → MEDIUM stands; any vacuous → HIGH for those entries
(row 487). Runner property above the indent fix (row 490): **an empty observed capture is INDETERMINATE
and must REFUSE, never pass.** β's case-(b) clearance is WITHDRAWN (row 490) — (b) needs no edit anyway.
CASE (e) — AUTHORIZED under row 487's self-executing test, branch (ii) (row 488): the dropped field
`firstFailingAssertion` was NEVER β-required — it is the pre-β grain row 473 REJECTED as a false-green
proxy; removing it IMPLEMENTS β's ruling (α's earlier "superseded" framing was wrong, corrected). Repoint
(e) at a member of the emitted 8-field required set `[file, causeLines, failCount, cause, filedUnder,
expiry, expiryVersion, observedOn]`, emit the required-set DELTA (removed {firstFailingAssertion}; added
{causeLines, failCount, observedOn}), net-add the inverse case, RED-then-GREEN. TWO β CHECKS (row 488):
`observedOn` must carry THREE stamps — platform, Node major, reporter (row 473 cond. 5); emit its
contents. The register-level BASE assertion (row 476 P4) must still exist in the rewrite — cite the line.
Facts measured by α: the YAML diagnostic parser (`parseDiagnosticBlock(…, t[1].length + 2)`, L330) exists
ONLY in the rewrite; the committed runner locks on `firstFailingAssertion` verbatim and has no such
parser. Read the falsifier file's per-file result from the SUITE's full output, never a standalone run
(row 491). Then the hermetic scrub (row 486 D1) as the FOLLOWING dispatch: declared allow-list carrying
the Windows platform essentials, in the normalizer's own declaration, RED-then-GREEN, verify-before-build;
then re-validate the register under the hermetic set as a THIRD environment with the interpretation
pre-committed. All of it lands WITH the runner rewrite (row 491 fence: "don't land lane I" is not a way to
stay green).

## R-39 — the occurrence register (+ β row 494 ordering consequence)
Failure `record-trust-exit.test.js` ("the exit gate must not change the committed ledger") is REAL: the
committed register is stale after the merges (pinned 319 → 334). Sequence: (a) FIRST emit the derived-gap
set (register 215 vs sweep 110): which 105 register rows lost their occurrences, and NAME the
discriminator before rating — benign = rebuild-before-sweep regenerated views so the literals legitimately
vanished (row 470 working, not a finding); stale pins pointing at vanished occurrences = F7 class, MEDIUM;
occurrences with no disposition = HIGH (row 484). Nothing is regenerated before that set exists. (b) THEN
regenerate the register as ITS OWN commit stating head, delta and reason (§ 7b: the round's artifacts
stay inside the population); add-side, inspected by the teeth normally. Lane K's count guard REFUSING on
drift is correct: lane K's sets are re-derived on the final tree (K's brief already required it); K's
adjudication at 56a16fc1 stays in the record as a measurement at a stated head. (c) The regen REPEATS as
the LAST step after lane J + lane I land — **and β row 494 requires the final regen to be shown a NO-OP
(empty diff)**; if it is not a no-op, the derived-gap set is re-emitted on the final state. One diff, not
a second measurement. The suite stays red on that one test until (b); that is the truthful state.

## R-39 addendum — the head-advanced-after-check race case (β row 494)
"Flake" is NOT a disposition. Six runs (3 alone, 3 in-suite — the split is load-bearing because the two
invocations differ by the shared child environment) give FREQUENCY; LOCATION decides: **read the exit
gate's check-then-read ordering.** If the gate reads the head AFTER performing its check, a concurrent
commit makes its verdict apply to a different tree — a genuine TOCTOU defect in the PRODUCT, and the
intermittent red is the test catching it non-deterministically. Dispositions: fix the test's determinism,
or record a product finding. A sprint-authored file cannot be quarantined (row 470 + register policy).

## R-42 — pristine re-measure
My live-ledger case is FIXED at `25bb6541` (β OPTION C, row 492): direct `fs.existsSync` on the resolved
ledger path; absent → prints `SKIP: … looked for <path>; referential integrity NOT evaluated here` and
passes; present → asserts as before. Re-measure the suite on a just-restored tree at the CURRENT head and
report the failures by FILE NAME with SHA; mark 1225/1222/0 RETIRED in DONE-REPORT; the pristine set at
each head is the record. β row 494 owes one more leg from α (present-and-BROKEN through the gated path →
RED) — α builds it on the side branch; not ε's.

## R-44 — shared root worktree
α no longer commits to `open-source/S-OS-06` from the root tree while ε conducts. α's substrate work goes
on `alpha/S-OS-06-substrate` from α's own worktree; ε merges it at its next merge point like a lane. The
root index is ε's alone.

## R-46 — first substrate merge under R-44
Branch `alpha/S-OS-06-substrate` @ `5f1b8da3`, one test-only commit (β row 494's missing RED leg: the
option-C existence gate is one helper used by the live case and a plant; present-and-broken → RED through
the gated path, late-append → GREEN, absent → SKIP; 22/22). ε merges it at its next merge point (no-ff).

## Ledger facts ε may not have processed
β rows 480–493 are all present and resolve (`node scripts/checks/beta-ledger-refs.js` GREEN). Rows 490
(`b6d1e390`) and 491 (`f57c1a80`) are β verdicts sent to ε and appended by α as relay writer — do not
re-append; cite by id. β verdicts you receive from here on: APPEND BEFORE ACTING, every time.
