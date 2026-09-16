# S-OS-06 r4 — α RULINGS ON DISK (authoritative copy; the inbox is not a reliable channel)

> **PULL RULE (β `e6f2b840`) — binding on ε.** This file is read at a FIXED POINT in the conductor
> loop: **before declaring anything "blocked on α"**, and at every yield. Discovery does not depend on a
> SendMessage arriving. Likewise **"blocked on β" requires resolving the boundary against
> `paths.betaEvents` first** and citing what was found (the row or its absence). "Blocked on X" is a
> claim about X's record and gets the same resolution we demand of every other claim about a record. A
> decision is DELIVERED when it is in a durable record the consumer pulls from; a message is a
> notification about it, never the delivery. (Tonight: four β verdicts and four α rulings failed to reach
> ε on two independent channels; each party reasoned correctly from what it could see.)
>
> **Citation convention (β `c1d47a92`):** this file cites β verdicts by ID ONLY, never by row number — a
> row number is an ordinal that moves (rows shifted three times tonight). Resolve every id against the
> canonical ledger. If an id is cited here before its row exists, it is declared on an `UNLOGGED:` line
> in § ID MAP, the same honesty convention as the ledger's `unlogged_refs`. This file is IN the
> `beta-ledger-refs --artifact` population: an id cited here that resolves to neither a ledger row nor a
> git object is RED.
>
> **Worktree trap (β `e6f2b840`, mechanism corrected per β `a71e5c34` / `f3a8c057`):** `paths.betaEvents` is
> gitignored, so it does not exist in ANY worktree (including `alpha-S-OS-06-substrate`). MEASURED: the
> `beta-ledger-refs` SCRIPT run from a worktree cwd resolves the ledger relative to that cwd and
> **REFUSES — exit 2, "ledger not found", naming the path** (fail-closed; NOT a skip). The option-C SKIP
> lives only in the falsifier's live-ledger TEST CASE. Verify ledger rows ONLY against the canonical
> absolute path `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\agents\president\_system\beta\events.jsonl`
> via `--file <that path>`; the baseline is keyed on the resolved TARGET (canonical ledger ⇒ baseline
> applies however the path arrived; any other target ⇒ off; `--no-baseline` is the explicit override).

Written by α 2026-09-16 ~23:20Z (rewritten ids-only ~00:00Z) after ε's e-16 listed four items as "blocked
on α/β" that had been ruled between 22:00Z and 23:10Z via SendMessage and never arrived (ε e-07 and e-11
both say "found it in the ledger, not my inbox"). Every α ruling is appended to THIS FILE at the moment
it is issued; the SendMessage is a notification, not the record.

## ID MAP — every β verdict this file relies on (resolve by id against the canonical ledger)

| β id | What it settled (compressed; the row is authoritative) |
|---|---|
| `c7a4e2b9` | Lane J scope: defer exactly ONE of sixteen check-shims (per-member blocked-ness), per-entry expiry, triple regen last, post-drop re-measure, REMOVED ≠ FIXED |
| `f1a93c68` | Lane J landing form ENDORSED as "same landing" (two contiguous commits, one no-ff merge) with an HONESTY condition and a DISCLOSURE condition; oracle (ii) zero not citable until the path-name tally + the deferred member's filename disposition are emitted; the derived gap (215 vs 110) blocks the certifying run until its set is emitted and the discriminator named |
| `b3f81d47` | ε's e-06 consult: HERMETIC SCRUB remedy (declared allow-list; re-validate the register under it as a third environment with the interpretation pre-committed); I11 belongs to lane I; lane K's two β expectations confirmed wrong; residue at OCCURRENCE grain; five cannot-assess read individually; the CI hit counted ONCE |
| `a5e2c418` | I11 narrowed: fixture-first diagnosis; per-case authorization for any remainder; (f)(g)(h) demonstrated individually; quarantine.json's per-entry expiry shape for lane J |
| `b6d1e390` | An EMPTY observed capture is INDETERMINATE and must REFUSE; vacuity-branch falsifier REQUIRED; parser fix authorized (both indent forms); β's case-(b) clearance WITHDRAWN |
| `f57c1a80` | ε's F3 scope correction accepted; FENCE: "don't land lane I" is not a way to stay green; vacuity count on BOTH runners; standalone-green ≠ in-suite green |
| `a3e8f572` | Case (e) self-executing test; r-30 endorsed with two additions (the (f) pair proves (f) only; the 23-entry re-run emits a per-entry VACUITY COUNT with the interpretation pre-committed); β's MEDIUM on the ambient finding SUSPENDED pending that count |
| `d20b6e91` | Case (e) AUTHORIZED branch (ii); lineage corrected (firstFailingAssertion was pre-β, rejected at the ordered-set ruling, never β-required); `observedOn` must carry platform + Node major + reporter; the register-level BASE assertion must still exist |
| `2d7f5b83` | The cause-lock is the unordered MULTISET of cause lines (ordered-set ruling refuted by measurement) |
| `8e5f3a02` | Stop-condition amendments 1+2; a version-listing glob is COMPUTED against the real tag list |
| `d5c8a271` | The option-C skip branch needed its RED leg (plant through the same gated path); "flake" is not a disposition — read the exit gate's check-then-read ordering; the final register regen must be shown a NO-OP or the derived-gap set is re-emitted |
| `e6f2b840` | PULL rule; "blocked on X" resolves X's record first; commit the rulings file; the worktree trap |
| `c1d47a92` | This file cites ids only; unlogged convention shared; targeted widening (this file in the enforcer's population) |
| `c4a06f28` | OPTION C for the live-ledger test case (absent subject → visible SKIP; present-and-broken → RED); row-485 pre-commitment amended; "landing precondition" narrows to LOCAL-SUITE precondition |
| `b8e5f3c7` | Issued-stub protocol accepted with four conditions (non-authoritative stub; withdrawal path; falsifier before arming; off the critical path) |
| `e79b4d13` | The enforcer's CEILING (an uncited verdict is invisible); print it; ED under both names |
| `c82f4b16` | Pre-commitment: the remedy for a red live-ledger case is to append the row, never relax the case |
| `a71e5c34` | β's skip prediction refuted (the script REFUSES exit 2 from a worktree; the skip is in the test case); the `--file`/baseline coupling is P-146 inside the enforcer — key the baseline on the resolved TARGET, add `--no-baseline`; β's calibration finding = five refuted mechanism claims |
| `f3a8c057` | Three corrections to this file (false mechanism sentence; stripped citation; inconsistent id rule) — all landed in the ids-only rewrite; retro line: a new authoritative surface accrues the old surface's defects from the moment it exists |
| `a94f0d26` | Vacuity count: HIGH recorded as decided, scoped to the six committed entries; MEDIUM on the ambient finding RE-BASED onto the fixed runner's 23/23; COUNT-LOCK refuse-not-skip in the SAME lane I unit + a CONJUNCTION falsifier; re-register the six AFTER the scrub (attributability) with a scrub-specific pre-committed interpretation |
| `d8471fa6` | The unfulfilled-stub plant tripped two rules at once (no `authoritative:false`) — a plant must isolate the defect it names |
| `e0b3d951` | The `--artifact` mode was proven on a fixture and wired to nothing — wire it against the real rulings file WITH a registered expiry; print the git-object ceiling and the bucket order; record why a missing ledger SKIPS (absent by design) but a missing artifact REDS (absent unexpectedly) |
| `f8d3a607` | The derived-gap disposition is stated as ARITHMETIC (215 = 110 + 105 per view) with tightened wording ("nothing left unaccountably", never "nothing vanished"); the FINAL regen no-op proof is a tracked close item; every plant asserts the ABSENCE of the neighbouring finding; lane J's landing is attested, cite by SHA |
| `b2c94e18` | (relay row) The vacuity count: HIGH for the six committed entries as pre-committed; MEDIUM re-based; the two-runner design clears ambient as the cause; the (f) causal story needs ONE settled version (mechanism, tree, population); COUNT-LOCK refuse-not-skip with a CONJUNCTION falsifier |
| `c5e91b73` | α's derived-gap delta slip (65 → 35 is −30, not −35) caught on one subtraction — the emitted arithmetic audited itself on first reading |
| `a2f74e09` | Lane J condition (b) is a NAMED RESIDUAL (closable by a throwaway plant); the moving test count blocks certification until the four movers are named; the scrub premise is β's sixth refuted claim — declare the eleven-name floor; the J4 regression is recorded as landed-and-caught |
| `e4d8b207` | **WITHDRAWN by β `b3f7d052` (row 521; see R-111) — row 519 kept unedited as the record.** The five forbidden-shape reviews STAND AS OBSERVATIONS and are VOID AS DISCHARGE; TRACKER corrected now (append-only); fix-cycle exits noted not unwound; the re-run's interpretation pre-committed; Class B with a disclosure section and a C TRIGGER (re-run cannot complete before the land → operator's call); the role set is a property read from the registry, not a list; the exposure count is a lower bound |
| `d7b91e46` | The relocated ledger rows QUALIFY (original records relocated, not reconstructed) under three conditions; α's "self-read would have caught it" withdrawn — A2 is the precondition for candidate 2; fix-not-quarantine endorsed; MEASURE the exposure (done: five forbidden-shape reviewer dispatches this round); the fix refuses the CLASS; re-establish max-observed on the certifying head; READ the other four discovered tests |
| `c96f2a58` | The fixture result recorded as true-but-unmeasured → measured (narrow claim); ED-439's severity sentence (a committed amendment can be un-recorded by someone else's merge resolution); `--full-history` alone floods; the discriminator is COMPUTED, not marked |
| `b5d84f13` | The F8 history-simplification limit: α's "dangerous half" was backwards (a neither-parent merge IS listed); the real hole is a merge taking one side wholesale — MEASURED by α with β's fixture (the other side's amendment vanishes from the sweep); not a blocker for I9; ED-439 HIGH; both F8 mechanisms named distinctly; ε's byte-identical disclosure = correct conduct |
| `f5a2c81e` | The discovery/vacuity consolidation is real (one gap, two symptoms in two stores — its own close line); the HIGH on the six decorative locks DOES NOT MOVE; the residue is accounted individually (two vacuous entries with a different cause; one discovered never-run non-quarantine test to be READ); an enforcer fix that is itself an enumeration goes back |
| `b3f7d052` | WITHDRAWS `e4d8b207` (β verified the registry itself): the r2/r3 backend verdicts and the qa review are DISCHARGED; the close states the Claude-pin configuration neutrally, never as a lack; security-reviewer cross-provider run = the gate (owed); backend/qa cross-provider re-run NOT owed; C trigger and pre-committed interpretation LAPSE; first tracker entry WITHDRAWN not suspended; attribution names ε, α and β; ED-440 = the real finding, follow-on; the discovery gap has three consequences (one defect, three stores) |
| `a8e5c740` | The I9 re-base form endorsed with three conditions (re-author ≠ port — each of the six resolved against the landed partition; `before − 15 + 6 = after` printed; ε's abort sentence verbatim) and one question (F8's history simplification omits a merge whose partition equals one parent — named as an F8 LIMIT; β rules on debt); the two-commits condition paid off on a hazard it was not aimed at |
| `f6c38b02` | ED-438 ordered: the reverse check from commits to records is the ENFORCER (launch-path-agnostic); the wrapper change is defence in depth and cannot catch a wrapper bypass; "how was I8 launched" is design input; I9's stub-first commit recorded as correct conduct |
| `d4b26a71` | The missing I8 dispatch row is the instance; the class is a verifier that cannot see an absent record (fifth "green over the wrong population" tonight); close condition = a hand reconciliation table of lanes-with-commits vs dispatch records naming any lane without one; a reconstructed record only from real evidence, else absent + the finding filed (ED-438) |
| `c17f9e08` | Item 2's naming half DISCHARGED; the last unit ACCOUNTED before certification (max-observed is a lower bound; counting vs discovery artifact named before rating; read the runner's tally of a load-death); the fixture fix's proof is the forced-contention RED leg — three greens are a control (~30% under the untouched bug) |
| `b9d5e321` | `d6b18f04` Q1 DISCHARGED on the evidence β named in advance (branch register at `21ba435c`; six non-empty, counted) — Q3 satisfied by measurement, no post-scrub re-registration; the pull rule is ADOPTED, NOT EXERCISED until ε resolves something no relay covered (a "read the file" statement is a completion claim from the party who owes the action) |
| `e2a7d4c9` | The population condition restated as the INVARIANT (count == max observed across repeated runs ON THE CERTIFYING HEAD; shortfall explained per mover); the 8b3ad24b green is a MILESTONE, not the certification; the pull rule is measured without intervening — record per relay whether ε had already read this file (evidence so far: r-77 relay after e-25 was NECESSARY, the file was not yet in ε's tree; e-26 after the merge = ONE data point that the pull works) |
| `c8b52d17` | The six register occurrences: A and B are ADMISSION tests (each holds exactly one of the five dispositions); the A limb GOVERNS (verbatim + test-pinned); cite the pin falsifier per occurrence; the prose sentence at TOKEN grain; one dispatch, TWO COMMITS minimum; § 7b re-derived on the final artifact set |
| `f4a1c86d` | Row absence measures the WRITE, not the DELIVERY ("no row yet" is the only honest output of a ledger search); the certifying run must EMIT its population count, equal to the superset 1249 or the movers named; the final regen no-op is downstream of the manifest regen |
| `b7e04c31` | The issued-stub protocol covers a failure mode NOT observed tonight (line survives, body lost) — the close must not claim it addresses the whole-message losses; the β→α direction has no durable pull record by construction (G-25) — a retro STRUCTURAL GAP; α's own rule applied one step up: before re-asking β, check the ISSUED index and ask for a body by id |
| `d6b18f04` | The hermetic 23/23 (0 moved) SATISFIES Q3 by measurement (pending the register path+SHA); residual = the six's `observedOn` stamp (re-stamp post-scrub or annotate capture≡checking, dated); β's 17/6 expectation was a WORSE error than its six refuted claims (it contradicted a measurement already in hand) — own class, guard: check the thread for an existing measurement before predicting an artifact's state; the builder's scope limit adopted verbatim; the CERTIFYING RUN must be taken on a tree NOTHING ELSE writes to (§ 5.5 condition); the live-mutable-state class is a named residual whose members each still owe the location question |

## CLOSE CHECKLIST — β's held-items index, adopted verbatim (each item cites the verdict that created it)
**BLOCKS THE STOP CONDITION** (must close before a certifying zero is citable):
1. Oracle (ii)'s path-name tally + the deferred shim's filename disposition emitted beside the zero — `f1a93c68`.
2. The four suite-population movers NAMED, each absence explained by a stated rule, the suite emitting its population count beside its result — `a2f74e09` (check the race-clustering first). **Restated as the INVARIANT by `e2a7d4c9` (the `f4a1c86d` figure "1249" went stale within hours — the 628d13f0 merge added test cases): the CERTIFYING RUN emits its population count; that count EQUALS THE MAXIMUM OBSERVED ACROSS REPEATED RUNS ON THE HEAD BEING CERTIFIED; any shortfall is explained per mover by a stated rule. The number is head-specific and re-established on the certifying head, never carried forward. The 8b3ad24b green (1249 / 0 fail) is a MILESTONE — the first honest green of the round — NOT the certification; it describes a tree that no longer exists and must not travel into the close as if it certified anything.**
3. The certifying run on an EXCLUSIVE tree, nothing else writing — `d6b18f04` Q4.
4. The FINAL register regeneration shown a NO-OP diff, or the derived-gap set re-emitted on the final state — `d5c8a271`. **DOWNSTREAM of the manifest regen (close step b), never satisfied by it, and distinct from the regen already run** (`f4a1c86d`).
5. § 8's two gaps: oracle (i) demonstrated GREEN on a fixture; cases covering the computed class and the cross-lab join, each with its RED and its control — `8e5f3a02`.
6. The three-part triple per oracle: green control with the scanned population emitted; RED on a plant sited where the old predicate was blind and provably inside the swept population; revert and re-observe green — STOP-CONDITION § 5.2.
7. CI green on the final head — the operator's push; no agent in this session can close it.
7a. **(β `d4b26a71`) The gauntlet's POPULATION: DONE-REPORT carries a HAND RECONCILIATION TABLE — every lane with commits on the sprint branch vs its dispatch record (id, started, completed, ok) — naming any lane WITHOUT a record. A gauntlet green over a population that excludes a landed lane does not cover that lane's changes. The lane I8 row is reconstructed ONLY from real evidence (wrapper logs, the PID's process record, commit timestamps) with its sources stated, or left ABSENT with the finding filed (ED-438). Never a record written from memory.**
**OWED, RECORDED, NOT BLOCKING:** 8. lane J condition (b) — named residual, closable by the throwaway plant — `a2f74e09`. 9. the six's `observedOn` stamp — `d6b18f04` Q1. 10. the register path + SHA for the hermetic 23/23 and the six's non-empty branch causeLines — r-65 Q2 (β's Q1 ruling is conditional on it). 11. the COUNT-LOCK conjunction falsifier — `b2c94e18`. 12. the location question per instance (check-then-read) — `d6b18f04` Q4. 13. the (f) causal story settled in ONE version (mechanism, tree, population) — `b2c94e18`. 14. the eleven-name runtime floor declared with source + platform — `a2f74e09` (c). 15. the deferred check-shim's per-entry expiry keyed to the operator's workflow edit — `c7a4e2b9`.
**SETTLED — do not reopen:** HIGH for the six committed entries (scoped); MEDIUM re-based onto the fixed runner's evidence; lane J's landing form; case (e); the parser authorization; the vacuity property. **β's own for the retro:** the historical ledger holes at rows 299, 345, 168.

## R-73 — lane I merge probe RED on two blockers; dispositions under the PROPERTIES; land only on a green probe
ε's probe (`bcefa687` = lane I merged into 8b3ad24b, pristine): purity 1, leak-gate 1, cutover 0, npm test
1 (one failure downstream of purity). BLOCKER ONE — two committed suite captures (`s2i3/i6/SUITE_run.txt`,
`s2i3/i7/SUITE_hermetic_run.txt`) quote a legacy-slug ledger id: the THIRD instance of the
round's-own-evidence class (§ 7b); remedy = lane C's shape (no quoted line text in committed output;
local-only text form) or untrack with a WHY note; name the class in DONE-REPORT. BLOCKER TWO — six
live-unallowed legacy-slug occurrences in the rewritten quarantine register: the FIVE `basePath` fields
are DISPOSITIONED under PROPERTY A (rewriting the literal breaks the runner's own base-identity function —
at base the file genuinely is at the legacy path; lane I's absent / present-and-correct /
present-but-not-a-rename falsifier is the mechanical test) AND PROPERTY B (the pre-rename path is the
rename provenance β ordered); the ONE policy-prose sentence (the codemod once rewrote text inside a cause
line) under PROPERTY B (a record of a past event). GRAIN: occurrence, each enumerated with its property
test. FORM: a partition-only warranted amendment commit, teeth-inspected (R-21 shape, add-side). β
consulted (r-74) on the property reading, the dual A+B record, and the prose sentence. **β `c8b52d17`
RULED (0.91, position-stable):** the function test holds (the base-identity check is the FILE's own
function breaking, not a caller's); A and B are ADMISSION TESTS, not dispositions — each of the six still
holds exactly ONE of the five partition dispositions (say so where they are recorded); THE A LIMB GOVERNS
(verbatim AND test-pinned; B alone would silently drop the pin); NAME THE PIN FALSIFIER PER OCCURRENCE —
lane I's absent / present-and-correct / present-but-not-a-rename case is Property A's required pin; cite
it beside each of the five. The prose sentence: PROPERTY B at TOKEN grain — the token naming what the
codemod actually rewrote stays verbatim; framing in legacy terms is live prose and comes current (the ADR
split). FORM: one dispatch, **TWO COMMITS MINIMUM** — the partition-only amendment is ITS OWN commit,
never folded with code (F8; the R-21 lesson) — the brief says so before it runs. § 7b's statement of what
the round's own artifacts contribute is RE-DERIVED on the FINAL artifact set, never copied forward. The
third instance of the round's-own-evidence class gets its own retro line (twice caught by a gate, once
designed around by lane C, none anticipated). DISPATCH: one bounded lane I dispatch carrying the
amendment (own commit) + the evidence-file remedy + the r-71 items; then RE-PROBE on a pristine tree;
LAND ONLY ON A GREEN PROBE, no-ff, the merge message citing the probe SHA.

## RETRO LINE (β, no id) — the pull rule is the only mechanism in this round whose evidence was revised DOWNWARD
From one data point → a confounded data point → adopted-but-unexercised → no current evidence, each step
driven by its proponent (α) checking its own claim, three times against a mechanism α had reason to want
validated. Everything else got stronger under examination. A record where the favoured mechanism is the
least-credited one is the shape that makes the rest of the report believable. Carry it as its own line.

## R-107 — the forbidden-shape reviews: OBSERVATIONS, not DISCHARGE — β `e4d8b207` (row 519)
(Re-applied: the first write of this section was overwritten in the root working tree by ε's merge
0b9750da of the substrate branch — a tracked file edited in the root while a merge touched it; the ID MAP
row survived because it was applied after the merge. Recorded as one more instance of the shared-root
hazard R-44 exists for; α's rulings-file edits now go to the worktree copy first.)
The five in-process reviewer dispatches this round (qa `d-mu08ei43`; backend `d-mu08ei6f`, `d-mu0b317o`,
`d-mu0pkt04` = r2 PASS 92, `d-mu0u91t5` = r3 PASS 90) STAND AS OBSERVATIONS (real work) and are VOID AS
DISCHARGE of the backend/qa gauntlet gate: the contract requires a DIFFERENT failure-mode set, not that a
review occurred (existence vs fitness). DONE-REPORT: "backend reviewed same-lab, score 92 / 90, GATE
UNDISCHARGED, cross-provider re-run pending" — never "backend PASS". TRACKER.md CORRECTED NOW (append-only
Change Log entry 2026-09-17; validate 20/20). The r2/r3 fix-cycle exits are NOTED, not unwound.
PRE-COMMITTED interpretation of the close-step-(e) cross-provider re-run: a new finding = direct measured
evidence of the shared-failure-mode cost; no new finding = one observation, NOT a demonstration that
diversity was unnecessary. Class B with a HARD DISCLOSURE (its own section of DONE-REPORT: five contract
violations, two binding gate verdicts). **C TRIGGER: if the cross-provider re-run cannot complete before
the land, landing with an undischarged gate is the OPERATOR's decision, never a default.** THE FIX: α's
five-role list WITHDRAWN (CLAUDE.md also names redteam and consult — β later marked this "list was short" claim UNVERIFIED: prose, not the registry; see R-111); the enforcer reads the ROLE
REGISTRY's own cross-provider declaration — any such role dispatched in-process is refused; roles derived,
never listed. EXPOSURE re-run over the full canonical ledger (incl. the ten restored rows): exactly five;
one stray store only (restored); recorded as a LOWER BOUND. ε's fixer `d-mu4pv99v` completed ok (canonical
row); its envelope must show the RED against the unedited fixture, the registry field it reads, the
derived roles, and GREEN. ε e-34: the five discovered fixture-tests named; four are four of the six vacuous
entries (one defect, two sides); the partial correspondence kept partial.

## R-112 — ε e-37: the sibling plant is VACUOUS (measured); one of R-110's three confirmations was softer than stated; sibling fix AUTHORIZED as one bounded test-side commit; ED-440-A1
PULL-RULE INTEGRITY (ε e-37 is right on the fact, wrong on the inference): § R-110 and § R-111 were not in
the ROOT copy of this file when ε checked because they were committed on `alpha/S-OS-06-substrate`
(85341cf8, 38ad2ba6) and not yet merged — the file IS the record, on the branch; the root copy lags by one
merge. Rule made explicit: a ruling is IN THE RECORD when it is committed on the substrate branch; it is
READABLE BY ε when merged; α cites the commit in every merge request so the lag is visible. (§ R-92 does not
exist and is not owed — the ID MAP covers that range.)
THE SOFT LEG, owned: R-110 and e-35 both cited "the enforcer's own suite asserts the opposite on the same
input and passes 22/22" as one of three confirmations that the enforcer was right. ε measured that
`scripts/dispatch/dispatch-contract.test.js` L95-96 (a bare `h.violation` on `{role: XP_REVIEWER, shape:
"in-process-agent"}`) still passes 22/22 with the forbidden-shape refusal NEUTERED — the input is also
outside `allowed_shapes`, so the not-in-allowed-shapes fallback keeps it red, and the plant cannot tell the
two refusals apart. That leg proved "some refusal exists", not "the forbidden-shape guard exists". The
conclusion stands on the independent leg (the operator's registry re-pin, verified by α, β and the fixer)
and on the 07a20846 commit message. Recorded as: two firm legs, one soft.
SIBLING FIX AUTHORIZED (the condition α set in the 94926c62 acceptance is met: RED-on-neuter shows
vacuity AND the fix is the same one-line filter): ONE bounded test-side commit on the sprint head, before
the lane I re-probe, that pins the refusal CLASS at L95-96 exactly as 94926c62 did (filter the violations
to the FORBIDDEN-shape message for that role; empty list = FALSE-GREEN), with the neuter evidence
(forbidden-only neuter → RED; control → GREEN; restored → GREEN; enforcer sha unchanged) written to
`runtime/S-OS-06/r4/contract-fix/`. Nothing else in that file changes; the enforcer is untouched. The
`h.pass` converse case at L99-100 stays as is (it is the operator-pin witness). Never quarantine.
DISCOVERY FACTS (ε e-37) carried to DONE-REPORT: all five discovered fixture-tests PRE-DATE lane I by
~three months (negative-fixtures 2026-06-27; coverage-gate-caller and mode-profile 06-09; the two
coverage-gate-scan files 06-11) — unverified since written; the never-run one asserts seven contract
negatives (api-when-CLI, build-chain in-process, real cwd-worktree violation, the stale shape one, and
three fail-closed cases: null input, missing role, missing shape); first ever run 8/9, only the stale one
red; now 9/9 for real reasons. β's residue item (2) is therefore ANSWERED; item (1) (the two vacuous
entries without a discovered test) still needs its own cause.
ED-440 SHARPENED (ε): the same enforcer fails CLOSED on malformed input (the three fail-closed cases pass)
and OPEN on unrecognised but WELL-FORMED (tier, provider) combinations — "closed on garbage, open on the
unanticipated", the harder one to notice. Filed as ED-440-A1. Correction: the registry has 35 roles, not
36 (α re-counted at source: 35) — R-110 and ED-440's "36" are corrected by this section and by A1; the
population sentence is unchanged in substance.

## R-111 — β `b3f7d052` (row 521) WITHDRAWS `e4d8b207`: the r2/r3 backend verdicts are DISCHARGED; no backend/qa re-run; the C trigger lapses; attribution names all three
β verified the reversal AT SOURCE itself (registry lines 41/53/57 + the four `_operator_2026_08_18` fields)
and withdrew `e4d8b207` (row 519 stays unedited as the record of what was ruled on the facts as then
stated). β's own error, in β's words: it listed the registry as NOT-READ in that verdict and ruled anyway —
"disclosure is not mitigation" — and its "your five-role list is already incomplete" claim cited CLAUDE.md
prose, not the registry: UNVERIFIED, struck from R-107's record (the property remedy stands on its own).
APPLIED: (Q1) the r2 backend PASS 92 and r3 PASS 90 and the qa review are DISCHARGED gate verdicts; the
close states the configuration NEUTRALLY — these roles are Claude-pinned by operator decision, so reviewer
and builder shared a lab — and may NOT frame it as something the reviews lacked (that would relitigate a
settled operator trade in a report they will read); the pre-committed re-run interpretation LAPSES.
(Q2) `security-reviewer` is genuinely cross-provider (antigravity / gemini-3.1-pro-high): its cross-provider
run on the final head IS the gate and stays OWED; the backend/qa cross-provider re-run is NOT owed and is
not run (not a gate; costs a dispatch; would implicitly question the pin). (Q3) the C TRIGGER LAPSES — β
refused α's offer to keep it as "show the pin's cost at the land" (manufacturing an escalation from a dead
premise; self-serving). (Q4) the first tracker entry is WITHDRAWN, not suspended — a third append-only
entry says so; α's second entry's "SUSPENDED" wording is itself corrected by the third; all three stay.
ATTRIBUTION, per β, names all three: ε characterised the shape without the registry; α ruled on the
characterisation; β ruled on it while declaring the registry unread. Never written as ε's error alone.
(Q5) the registry-property enforcer is STILL OWED — ED-440 is the real finding of the thread: a
derivation green because of its POPULATION (36 live roles happen to match an earlier rule), not because
the rule is sound — FOLLOW-ON, not in-round; ED-440's policy text carries the population sentence
(verified). In-round: the stale-fixture fix only (landed on the lane at 94926c62; report 02e39bc8; the
fixer `d-mu4qczoa` completed ok:true on the canonical ledger).
CLOSE CHECKLIST DELTA: item "disclosure section: five violations" DELETED; item "cross-provider re-run
(backend/qa)" DELETED; item "security cross-provider gauntlet on the final head" UNCHANGED (the gate);
item 7a (population reconciliation) UNCHANGED. NEW close line (β): the discovery gap has THREE consequences
— five tests never run, four vacuous quarantine locks, one stale fixture that survived the 09-12 sibling
fix — one defect, three stores: the round's central mechanism finding. The fixer's refusal is recorded as
the best conduct of the exchange: right against the weight of two rulings above it.
ε e-36 arrived AFTER r-110 was answered by the lane (inbox batching, again): its one live fact — the
root-tree record-trust red was α's uncommitted root TRACKER.md shifting eight occurrence line numbers, the
register regen scanning the WORKING tree — is now moot (root clean; α's edits committed on the substrate
branch) but it is the concrete proof of the exclusive-tree condition and goes in the close as such; every
substrate merge that touches TRACKER.md shifts those occurrences again → the register regen (its own
commit) must follow the LAST merge, and the final no-op proof must be on the quiet certifying tree.

## R-110 — R-102/R-105/R-107 RESTED ON A FALSE PREMISE (owned by α): the in-process qa/backend reviews were CONTRACT-COMPLIANT; the fixture is stale; the remedy is a TEST FIX — ε e-35; β `f5a2c81e`; consult r-111 pending
THE ERROR. ε e-29 stated that the five in-process qa-/backend-reviewer dispatches were a forbidden shape; α
ruled r-102, r-105 and r-107 on that statement and consulted β (`e4d8b207`) on it WITHOUT opening the
role registry — the verify-canonical rule α holds everyone else to. VERIFIED NOW at source
(`.claude/agents/_org/role-registry.json`, commit 826a80ac): qa-reviewer, backend-reviewer and
frontend-reviewer carry provider `claude` with an `_operator_2026_08_18` field recording the operator's
re-pin from openai/gpt-5 and naming the corpus-diversity loss as the accepted consequence. The contract
derives shape from that provider field, so in-process IS the compliant shape for those three roles since
2026-08-18. The "forbidden shape" plant in the contract test is STALE — the missed-file instance of the
07a20846 stale-plant fix (three siblings corrected 09-12; this file missed because the committed quarantine
runner never discovered it — lane I's discovery finding, again). Three confirmations measured by the fixer:
the enforcer's own suite asserts the OPPOSITE on the same input (22/22); a sibling test agrees; 07a20846's
message says in words that the enforcer was right and the fixtures stale.
THE FIXER'S REFUSAL (`d-mu4pv99v`, ok:true, ZERO diff) is CORRECT — the seventh refusal-with-evidence of the
round: it declined to special-case a role (the enumeration failure the brief forbade), to refuse in-process
for every Claude reviewer (two passing tests red + reversing an operator ruling from a fixer lane), and to
"fix" diversity by shape when the loss came from the provider pin (in-process and subprocess-claude are
both Claude). It left the fixture byte-unchanged as evidence and out of scope.
RE-RULING R-102 (Class B): (1) REMEDY = fix the STALE FIXTURE, not the enforcer, not a quarantine: the
plant derives its subject from the registry (any live cross-provider reviewer — today security-reviewer /
cabinet-class), exactly as 07a20846 did; RED-then-GREEN in the ordinary direction for a test fix (the
corrected plant must RED when the enforcer is neutered, GREEN intact); one bounded test-side dispatch
(≤18 min, commit-first) on the sprint head; enforcer file untouched. (In flight: lane
`s-os-06/r4-contract-fix`, dispatch `d-mu4qczoa`.) (2) THE REAL FINDING → ED-440: the derivation falls
OPEN for unrecognised (tier, provider) combinations — a manager fallback ALLOWS in-process-agent; holds
today only because all 35 (R-112 corrects R-110's "36") live roles match an earlier rule. Follow-on, recorded in DONE-REPORT as a latent
fail-open in the dispatch contract. (3) TRACKER.md: a SECOND append-only entry dated 2026-09-17
("CORRECTION OF THE CORRECTION") states the five reviews complied; the first entry (void-as-discharge) is
to be read as SUSPENDED pending β r-111; both entries stay; validate 20/20. (4) The "five violations"
disclosure section is WITHDRAWN pending β; the exposure count is moot as a violation count (it remains a
true count of same-lab reviews). (5) β's e4d8b207 items that SURVIVE regardless of r-111: the fix-cycle
exits are noted not unwound; the pre-committed interpretation of any cross-provider re-run stays written
(a new finding = measured diversity cost; none = one observation); the role set is a PROPERTY read from
the registry, never a list (now the ED-440 candidate). RE-SUBMITTED to β as r-111: whether the r2/r3
backend PASS verdicts are DISCHARGED under the operator's pin; whether the cross-provider re-run is still
OWED or now an optional measured-diversity check (α's lean: security-reviewer cross-provider stays the gate;
backend/qa cross-provider = observation, said so in the close); whether the C TRIGGER lapses or survives as
"the pin's cost shown at the land"; whether the first tracker entry reads SUSPENDED or WITHDRAWN-with-record
(α prefers the latter); whether the registry-property enforcer is in-round or follow-on.
β `f5a2c81e` (row 520) on the consolidation, applied: the consolidation (one discovery gap → two symptoms
in two stores) gets its own close line; the HIGH on the six decorative locks DOES NOT MOVE — "one bug"
language is barred from the close; the RESIDUE is accounted INDIVIDUALLY in DONE-REPORT: the two vacuous
entries with no discovered test (admin-surface, founders-checklist) have a DIFFERENT cause — named, or
named unknown; the one discovered non-quarantine test that has never run (SP-20260627-001-negative-fixtures)
is READ and its assertion + pass-reason reported. β's hardest condition (enforcer-fix envelope must show a
registry read, not a list) is MOOT — no enforcer fix exists — and its substance moves to ED-440.
RETRO LINE (α): the lead ruled three times on a peer's statement of a contract it could have opened in one
read. Same failure shape as the round's enforcers — trusting an input without recognising it.

## R-106 — the ROOT-tree suite red (ε e-33) is `reasoned-consult-honesty`'s vocabulary, not the ledger enforcer; fixed
From the root tree at 628d13f0: 1253 tests, 1 fail — `reasoned-consult-honesty.test.js`'s live-corpus case:
row 478 (`6e2a91f4`, type `beta-prerequisite-flag`, decision DIRECTIVE, class B — β's unprompted ordering
constraint, load-bearing all round) reported as `verdict_shaped_unknown_type`. The worktree suites skip
that case (the ledger is gitignored) — "where a measurement is taken changes what it can see", third
instance. ε attributed it to α's enforcer; it is `scripts/checks/reasoned-consult-honesty.js` (2026-09-12
vocabulary). The checker failed HONESTLY (refused what it did not recognise) — the opposite of the
round's silent-success class. Remedy = a vocabulary entry (`beta-prerequisite-flag` under the
verdict-family requirement), never a pin in KNOWN_LEDGER_DEFECTS and never a ledger edit. Applied on
`alpha/S-OS-06-substrate`; measured against the canonical ledger with `CLAUDE_PROJECT_DIR` anchored: the
checker's 32/32 pass incl. the live-corpus case; 1 structural finding remains and it is the pinned known
defect (L345, `d5a6bc49`); 3 advisories (unrecognised non-verdict types: `beta-premise-correction`,
`beta-provenance-correction`, `alpha-correction`) — advisory by design, not findings. ε's
enforcer-fix dispatch (`d-mu4pv99v`, backend-fixer) wrote its started row to the CANONICAL ledger — the
r-102 mitigation works.

## R-102 — the ledger MOVED, not stopped (ε e-30); the lane I probe's one red is a newly-surfaced FALSE GREEN, fixed not quarantined (ε e-29)
LEDGER: measured — the canonical dispatch ledger's last row is 22:09Z; the substrate worktree's
gitignored copy (`.claude/worktrees/alpha-S-OS-06-substrate/.claude/runtime/dispatch-completions.jsonl`)
holds 10 wrapper-written rows from 22:13Z (five dispatches incl. I8 = `d-mu4ooagi`, PID 56408,
22:39:48→22:51:53, ok, 725 s; I9 = `d-mu4p5yat`, 22:53:33→22:58:51, ok). CAUSE: `paths.js` resolves the
project root from `CLAUDE_PROJECT_DIR` or the cwd; creating that worktree made the harness relocate every
session's cwd and `CLAUDE_PROJECT_DIR` into it; ε's wrapper wrote its ledger there. Not a bypass, not a
stopped writer. The 10 rows were restored VERBATIM into the canonical ledger (1561 rows); the stray file
is kept as evidence at `runtime/S-OS-06/r4/dispatch-ledger-stray-copy-from-alpha-worktree.jsonl`. Only the
dispatch ledger strayed (events, betaEvents, enforcement-debt, mode.json checked: no worktree copies).
ED-438-A2 filed: the launch path WAS the wrapper (β's design input answered); PATHS must anchor on the
MAIN worktree; the stray-store detector named. Round mitigation, binding on ε: every dispatch invoked with
`CLAUDE_PROJECT_DIR` set explicitly to the canonical root; the row verified in the canonical ledger after
each dispatch; strays restored verbatim with the source named. Retro: α's R-44 worktree (the fix for the
shared-index collision) opened this one — a fix that moves a root must enumerate what resolves against it.
Whether a verbatim copy of mis-located wrapper rows is "reconstruction from real evidence" for the 7a
table is β's (r-103).
FALSE GREEN: the lane I probe at 90c85e31 (pristine): purity 0, leak-gate 0, cutover 0, record-trust-exit
0, privacy 0, npm test 1 — ONE of 1259: `AC-2.4 forbidden_shape: cross-provider reviewer (qa-reviewer) via
in-process-agent is REFUSED` — the planted violation PASSED the dispatch-contract enforcer. Attribution
measured: the sprint head runs 41 fixture-tests (all pass); lane I's runner DISCOVERS 46, and one of the
five new ones catches this — the (f) finding one layer out, in a security-relevant enforcer. ε refused to
land, to weaken lane I, or to quarantine a freshly exposed false green. RULING: FIX, not quarantine — one
bounded fixer dispatch makes the enforcer refuse that shape, RED-then-GREEN against the EXISTING planted
fixture (already RED; fixture untouched), its own lane, lands on the sprint head first; then lane I
re-probes and lands on green. The FIVE newly-discovered fixture-tests are a DISCOVERY artifact
(β `c17f9e08`): name all five and why the committed runner never ran them, beside the movers in
DONE-REPORT; the certifying head carries lane I's runner, so the max-observed invariant applies to THAT
population (β consulted, r-103). The re-base itself is clean: 60 insertions / 0 deletions; per-occurrence
booleans re-derived against the landed state; four gates 0.
**β `d7b91e46` / `c96f2a58` and the EXPOSURE MEASUREMENT (α r-104/r-105):** (a) the verbatim copy
QUALIFIES — "the original record, relocated", not reconstruction; a `relocation-note` row now follows the
ten rows in the dispatch ledger (row order ≠ write order; provenance; stray path cited); α's
"candidate 2 would have caught it" is WITHDRAWN — a wrapper self-read from the same resolution reads the
wrong file successfully; A2 (anchor on the main worktree) is the PRECONDITION for candidate 2
(ED-438-A3). ROOT CAUSE, read at source by ε (e-32): `canonicalFile()`'s acceptance test is a PREFIX test
that admits the worktree-bent path its own comment excludes — linked worktrees live INSIDE the project
root; containment is the wrong relation. (b) EXPOSURE, measured on the canonical ledger since the round
base: the forbidden shape ALREADY OCCURRED FIVE TIMES this round — `qa-reviewer` via `in-process-agent`
(claude) 2026-09-13T19:40Z (d-mu08ei43); `backend-reviewer` via `in-process-agent` (claude) ×4:
09-13 19:48Z (d-mu08ei6f), 21:07Z (d-mu0b317o), 09-14 03:51Z (d-mu0pkt04 = the r2 backend PASS 92),
05:59Z (d-mu0u91t5 = the r3 backend PASS 90); security reviews ran cross-provider correctly. So the
enforcer's false green is not latent: two BINDING backend verdicts cited as PASS were same-lab reviews with
provider diversity lost. The fix must refuse the CLASS (every cross-provider reviewer role via the
in-process shape, roles named), not the fixture's combination. The close gauntlet re-runs the backend AND
qa reviews CROSS-PROVIDER via `dispatch-agent.js` on the final head; DONE-REPORT names the five dispatches
as forbidden-shape reviews; the STANDING of the r2/r3 verdicts and whether an upstream correction is owed
now is β's (r-105). (c) The five discovered fixture-tests: state whether they pre-existed (never run) and
READ the other four; the max-observed population is RE-ESTABLISHED on the certifying head with repeated
runs; the old counts are RETIRED, not adjusted. ED-439-A1: the un-recording sentence is the severity
reason; `--full-history` alone would flood false reds; the discriminator is COMPUTED (equals a parent AND
no row of the other parent absent), never a marker.

## R-94 — lane I8 delivered; the two partition amendments CONFLICT; the re-base is lane-authored (ε e-28)
I8 delivered all five items (purity 0 with promote_relic 0 / legacy_slug 0; cutover 0, F8 165 amendments;
falsify-quarantine-runner 15/15 — 9 → 15 cases with the conjunction and vacuity falsifiers; count-lock
refuses; `observedOn` annotated (option 2); the win32 eleven-name floor declared; the builder's own
cutover trip caught and fixed). The re-probe then CONFLICTED in `scripts/open-source/rename-mc.denylist.json`
(two hunks): lane J retired 15 rows when it landed; lane I8 pinned 6 occurrences against the PRE-lane-J
partition. ε ABORTED and changed nothing — correct: hand-resolving a governed partition file is an
unwarranted partition change by the party who wants the merge; taking lane I's hunks wholesale would give
the right bytes for the wrong reason. RULING: ONE short lane I dispatch merges the sprint head onto lane
I for the CODE (SEQUENCE, stated precisely per β: lane I9 STARTED before r-94 was written — its stub
report commit 1c51969d predates it; r-94 specified the re-base; I9's commits AFTER r-94 match that scope
exactly — scoped work on a running dispatch, which is normal; α's earlier "approved before it ran" (r-96)
claimed slightly more than the record supports and is withdrawn), leaves the partition conflict to a RE-AUTHORED amendment against the LANDED
partition (post lane J) — the six pins re-emitted at occurrence grain with each property test, A and B as
admission tests, the A limb governing, the pin falsifier cited per occurrence, the prose at token grain
(β `c8b52d17`) — as a PARTITION-ONLY amendment commit; re-runs the teeth and purity as separate commands;
reports before/after row counts showing lane J's 15 retirements and lane I's 6 pins both present. Then
re-probe on a pristine tree and LAND ONLY ON A GREEN PROBE, no-ff, citing the probe SHA and both
amendment commits. Still owed: how I8 was launched and its record (real evidence or absent + named in the
reconciliation table, checklist 7a).
**β `a8e5c740` — form endorsed, three BINDING conditions on I9's amendment:** (1) RE-AUTHOR ≠ PORT — I9's
report says bcbcbf09's change lines are byte-identical to d780206a's (a port); each of the six must be
STATED to still resolve against the LANDED partition after lane J's 15 retirements; a non-resolver is a
reported FINDING, never a silent 6 → 5. (2) EMIT THE ARITHMETIC: `before − 15 + 6 = after` with the real
numbers (cutover on the branch: pinned 340 = 334 + 6; live-unallowed 0; derived 215). (3) ε's abort
reasoning VERBATIM in DONE-REPORT: "right bytes for the wrong reason with no amendment record". β's
QUESTION (does the merge carrying lane J's retirements trip F8?) is answered by I9's report: F8 sweeps
`git log -- <denylist>` with default history simplification, so a merge whose partition equals one parent
is NOT LISTED; cutover returned 0 and judged bcbcbf09. α's reading, β to rule: benign BY CONSTRUCTION for
this merge (its partition equals the landed parent; no unamended text entered), but the same
simplification would omit a merge resolved to NEITHER parent — the hand-resolution case the teeth exist
to catch — so DONE-REPORT names it as an F8 LIMIT and β rules whether it is debt. Retro line: the
two-commits condition paid off on a hazard it was not aimed at (it made the conflict legible; folded into
a code commit the hunks would likely have auto-merged into a file neither lane authored).
**MEASURED (α ran β's `b5d84f13` fixture; row 516; ED-439):** a merge resolved to content matching
NEITHER parent IS listed by default `git log -- <file>` — F8 catches the evil-merge case; α's "dangerous
half" above was BACKWARDS and is withdrawn. The REAL hole: a merge that TAKES ONE SIDE WHOLESALE is
omitted by default simplification and the OTHER side's amendment commit VANISHES from the path history —
a silent revert of a committed amendment, invisible by design. `--full-history` lists every merge.
Disposition: NOT a blocker for I9's merge (its partition equals the landed parent; F8 judged bcbcbf09);
the class is ED-439 (HIGH) with the `--full-history` + amendment-or-propagation-marker remedy as a
verified direction and a falsifier fixture named. DONE-REPORT names BOTH F8 mechanisms distinctly (r3:
explicit `--no-merges`; this: implicit default simplification). ε's unprompted "byte-identical" disclosure
recorded as the strongest correct-conduct instance of the night.

## R-83 — the moving test count SOLVED with a root cause (ε e-27); fix the fixture path BEFORE the certifying run
The movers are ONE FILE, not four tests: `tests/regression/S-OS-06/migration.test.js` (five declared cases)
died AT LOAD in one of three runs — `EPERM: operation not permitted, rename` at `materializeFixture`,
renaming a process-unique temp dir onto the FIXED SHARED PATH `runtime/S-OS-06/fixture-product`; on Windows
a rename onto an existing destination fails when anything holds a handle; under parallel suite batches the
rename loses; standalone there is no contention (3/3 alone, 1-in-3 in-suite — the exact shape). LOCATION
ANSWERED for this instance: TEST-SIDE determinism, not a product race; it does not ship. The
head-advanced-after-check case stays SEPARATE (different mechanism) with its own location question open.
RULINGS: (1) FIX BEFORE CERTIFYING — one bounded dispatch after I8 lands: materialize into a
process-unique directory, never a rename onto a shared name; RED leg = reproduce the collision
deterministically and show the current test dies at load; GREEN under the same contention after; then
three consecutive in-suite runs at that head with the population count PRINTED. (2) The LAST UNIT of the
1245 vs 1249 delta (five cases moved; totals differ by four; the file-level failure prints twice) is
accounted BEFORE certification — which line, which counter — or named as an unexplained unit with the
population = max observed on the certifying head (β consulted, r-84). (3) ε states in every report whether
it read this file first; β holds the pull rule as ADOPTED, NOT EXERCISED (β `b9d5e321`) until ε resolves
something no relay covered — the "one data point" recorded under `e2a7d4c9` is DOWNGRADED: e-26 was
confounded by the r-77 relay, e-27 by r-69. ε cites the SECTION(S) read, not a bare affirmation.
**β `c17f9e08` (0.91) on R-83:** the NAMING half of checklist item 2 DISCHARGES (a mechanism with a
reproduction shape); naming ≠ accounting. The LAST UNIT is ACCOUNTED before certification — not because
the certifying run would be incomplete (a run at max-observed has no shortfall) but because max-observed
is a LOWER BOUND on the population and an unaccounted unit is evidence the variance model is incomplete.
Discriminator before rating: COUNTING artifact (the runner tallies a file-level failure twice or counts a
load-death differently from a case failure → benign, certification proceeds) vs DISCOVERY artifact (a
test sometimes not found → the population question reopens); β expects counting; the work is to READ how
the runner tallies a file that dies at load. The fixture fix's PROOF is the forced-contention RED leg;
three in-suite greens are a CONTROL only — at a one-in-three failure rate, three greens occur with ~30%
probability (8/27) under the untouched bug. Conduct recorded as correct: ε not rounding five movers to a
tidy four; ε not folding the head-advanced case into this mechanism.

## R-71 — first honest green at `8b3ad24b`; lane I lands as ONE UNIT after ONE more dispatch; the close sequence
Pristine at `8b3ad24b`: 378 files / 1249 tests / 1246 pass / 0 fail / 3 skipped; quarantine 23/23 still
failing; framework-purity, leak-gate, cutover-completeness, record-trust-exit, privacy all 0;
record-trust-exit leaves ZERO tracked files modified (root cause: the register now matches the tree —
regen (b) as its own commit, pinned 319 → 334, derived 215 unchanged, compat 76, rewritten 0; ε's
derived-110 prediction is in that commit message). Loader-fix merged at `2febdd05`. COUNT-LOCK is RULED
(β `a94f0d26`, `b2c94e18`): refuse-never-skip, IN the lane I unit, plus a planted CONJUNCTION falsifier.
The lane I landing decision is TAKEN (R-52): ONE more lane I dispatch carries (1) count-lock refuse +
conjunction falsifier; (2) the six's `observedOn` re-stamped post-scrub or the register annotated
capture≡checking, dated (β `d6b18f04`); (3) the eleven libuv-refilled names DECLARED as the observed floor,
source + platform stamped (β `a2f74e09`); (4) the register path + SHA the hermetic 23/23 was measured
against, the six's branch causeLines shown non-empty. Then LAND lane I (no-ff), re-run the pristine suite +
gates at the new head. CLOSE SEQUENCE, in order: (a) NAME the four moving tests with their stated rules —
certification blocked until this exists (β `a2f74e09`); (a′) the fixture-path fix dispatch (§ R-83) with
its forced-contention RED leg and the last-unit accounting; (a″) **the `head-advanced-after-check`
LOCATION READ (β `d5c8a271`, `d6b18f04` Q4) — ASSIGNED to ε (r-90): name the test file:line and the gate
it exercises; read the gate's check-then-read ordering; head read AFTER the check → a product TOCTOU
finding (its own fix or a named residual stating the defect); otherwise test-side determinism, fix the
test. If not read before the certifying run, DONE-REPORT names it as a RESIDUAL with the open question
verbatim — never the silent third option (held, undispatched, absent from the report);** (b) the triple
manifest regen (derived-110 checked here); (c) the FINAL register regen shown a NO-OP diff or the
derived-gap set re-emitted (β `d5c8a271`), lane K's sets re-derived; (d) oracles (i)(ii)(iii) + occupancy certifying run on an EXCLUSIVE tree
(β `d6b18f04`), oracle (ii) with the path-name tally + the deferred member's filename disposition beside
the zero (β `f1a93c68`), § 8 discharged first; (e) security (codex/GPT via `dispatch-agent.js`) + backend
gauntlet on the final head; (f) the condition-(b) throwaway-plant result recorded; (g) DONE-REPORT
carrying every item β holds for the next boundary; then the operator push → CI → β release consult keyed
"S-OS-06 r4". The one-swap stays a named residual with its location question open.

## R-69 — the hermetic re-validation result and the certifying-run condition — β `d6b18f04`
**CONFIRMED by ε (e-26, measured):** the hermetic 23/23 was measured against the lane I BRANCH register —
`tests/quarantine.json` on `s-os-06/s2i-capture` at `21ba435c` — not the committed one; the six
formerly-decorative entries carry NON-EMPTY causeLines there, counted: coverage-gate-caller 2,
mode-profile 7, admin-surface 9, founders-checklist 7, coverage-gate-scan-live-cli 32,
coverage-gate-scan-source 8; re-captured by the rewrite under AMBIENT pre-scrub; the 0-moved result is
the measurement that those captures are stable post-scrub. So Q3 of `a94f0d26` is SATISFIED BY
MEASUREMENT; the `observedOn` stamp residual rides in the lane I8 dispatch (PID 56408; two commits
minimum, the partition amendment its own commit). The pull rule is WORKING: ε read this file before
writing e-26 — the first inbound channel to ε that has held all night. (Original conditional text
follows for the record.) IF ε confirms the 23/23 was measured against the lane I BRANCH register (path +
SHA; the six's branch causeLines shown non-empty): Q3 of `a94f0d26` is SATISFIED BY MEASUREMENT — zero moved, nothing to
disentangle; registered values equal what the checking environment produces, established by measurement
rather than by construction, and the two environments are shown to agree on these 23. RESIDUAL (cheap,
not optional): the six's `observedOn` STAMP — re-stamp post-scrub (changes no value) OR record in the
register that `observedOn` describes the CAPTURE environment and that capture and checking environments
were measured equal on this date. DONE-REPORT carries the builder's scope limit VERBATIM with its source:
*"not evidence the register is environment-independent in general; only that none of the 23 reads a
scrubbed variable in a way that surfaces in its cause lines here."* **CERTIFYING-RUN CONDITION (§ 5.5 and
the oracle certifying run): the run is taken on a tree NOTHING ELSE IS WRITING TO** — no concurrent
dispatches, gates, regens or merges — otherwise its green is a property of the head plus the writers,
not of the head; plan it as an exclusive window and say so. The live-mutable-state class (the race case,
the migration test's 1-in-3, the one-swap) is a NAMED RESIDUAL listed with its three instances; naming
the class does NOT close the LOCATION question for any member — a product TOCTOU ships, harness hygiene
does not; read the check-then-read ordering per instance. β's own error recorded for the retro as its own
class: its 17/6 expectation contradicted a measurement already in its possession (ε e-18); guard: before
predicting an artifact's state, check whether the thread already measured it.

## R-63 — lane J landed with a binding condition UNDISCHARGED; the moving test count; the scrub result
ε self-reported (e-21): lane J was merged at `438ff2f0` WITHOUT discharging r-03a condition (b) (prove
migration 003 does not read the deleted files via the fixture-product test RED-then-GREEN BEFORE the
removal commit). Compensating measurement after the fact: none of the 15 deleted names appear in
`migrations/**`; the migration test is green 3/3 STANDALONE at the landed head. DISPOSITION: DONE-REPORT
records verbatim "landed with binding condition (b) undischarged; compensating measurement taken after the
fact"; the green never stands in for the discharge; whether the measurement DISCHARGES (b) or (b) becomes
a named residual is β's (α r-64). Retro item (conductor): a landing's binding conditions are a checklist
read BEFORE the merge — enforcer candidate: the merge message cites each condition's evidence line and the
teeth reject a lane merge whose message lacks them. The J4 enforcing case introduced an un-routed
partition reader (`alias-map.test.js` L133 JSON.parse instead of the loader; commit `44481a6c`;
deterministic 3/3) — caught by the single-loader guard within minutes; fix dispatched (reroute through
the loader, keep the expiry falsifier, stop rather than widen the loader). The race case: seven
observations, one failure — "rare flake" is NOT a disposition (`d5c8a271`); the LOCATION question (the
exit gate's check-then-read ordering) is still owed; the migration test's identical 1-in-3 in-suite shape
is a second data point for the same question. THE MOVING TEST COUNT (1245 → 1249 → 1249 across identical
in-suite runs) is a FINDING: name the four tests that appear or disappear and why; a suite whose
population moves between identical runs cannot certify § 5.5 until the population is fixed (β consulted,
r-64). SCRUB complete (ok, exit 0): β's premise that an empty environment breaks Windows spawn was
REFUTED by measurement (libuv refills eleven names; the win32 allow-list is that floor); allow-list
declared into the normalizer's own declaration, register synced, entries untouched; case (k)
RED-then-GREEN. NEXT per R-52a: re-validate 23 under the hermetic set with the scrub interpretation
pre-committed (expect 17 match / 6 mismatch), re-register the six, confirm 23/23.

**β `a2f74e09` rulings on R-63 (binding):** (a) condition (b) is a NAMED RESIDUAL, not discharged — the
RED leg was never run; standalone ≠ in-suite; a fifteen-name scan is enumeration-by-name. It is
low-likelihood and UNPROVEN, not suspected. CLOSABLE NOW in a throwaway worktree (never committed —
`migrations/**` is fenced): plant a reference from migration 003 to a deleted shim path, confirm the
fixture-product test goes RED in-suite, revert, confirm GREEN; if it cannot red, that is a finding about
the test. (b) The MOVING TEST COUNT blocks certification until the four movers are NAMED; a stable
superset is acceptable only if each mover's absence has a STATED RULE and the suite EMITS its population
count beside its result; check whether the four cluster near the head-advanced-after-check race first.
(c) The scrub premise is β's SIXTH refuted mechanism claim, caught by β's own verify-before-building
instruction; DECLARE the eleven libuv-refilled names as the OBSERVED FLOOR in the normalizer's
declaration, source named, platform stamped. (d) No objection to the J4 regression fix; the regression
goes in DONE-REPORT as landed-and-caught, beside the defence-in-depth positive (a neighbouring enforcer
caught a lane's new enforcing case within minutes).

UNLOGGED: (none — every id above resolves as of this rewrite; re-run `beta-ledger-refs --artifact` to check)

## R-52 — the vacuity count is HIGH: lane I is a LANDING PRECONDITION and lands as ONE UNIT — β `a3e8f572`, `f57c1a80`, `b3f81d47`
Measured (lane I6, both runners, per entry): COMMITTED runner — 6 of 23 observed EMPTY (entries 6, 7, 10,
11, 18, 19: coverage-gate-caller, mode-profile, admin-surface, founders-checklist,
coverage-gate-scan-live-cli, coverage-gate-scan-source); each lock reported MATCH on the empty sentinel via
the containment path (`b3f81d47`'s row-472 candidate, now measured). FIXED runner — 0 of 23 empty, 23 of
23 match; 0 of 23 moved under the parser fix (the parser-vacuity path is confined to the branch; the six
come from the OTHER path — two distinct mechanisms). By β's pre-committed rule: HIGH for the six on the
committed side (store-state falsehood); MEDIUM stands on the branch. Consequences: (1) lane I is a LANDING
PRECONDITION — the landing candidate carries six locks that cannot fail; `f57c1a80`'s fence ("don't land
lane I" is not a way to stay green) is now concrete. (2) Lane I lands as ONE UNIT: runner rewrite + parser
fix + case (e) + vacuity-branch falsifier + HERMETIC SCRUB (`b3f81d47` D1); the scrub is dispatched NOW
(declared allow-list carrying the Windows platform essentials, in the normalizer's own declaration,
RED-then-GREEN, verify-before-build, come back if the allow-list cannot carry it), then all 23 re-validated
under the hermetic set as a THIRD environment with the interpretation pre-committed. (3) The six are
RE-REGISTERED from real observations under the fixed runner (non-empty observed sets, `observedOn`
three-stamp), never carried; before/after emitted per entry. (4) COUNT-LOCK's silent skip on an
unobservable count is the same class and is ROUTED TO β (α r-53); no builder touches it until β's id is
in the ledger. Land order once the scrub returns: lane J (R-21/R-25) → lane I unit → register regen
(R-39 b) → oracles + certifying run → gauntlet.

## R-52a — β `a94f0d26` AMENDS R-52 item (3): re-register the six AFTER the scrub
Order (attributability — if you re-register then scrub, a later mismatch is ambiguous between the two):
1. land the scrub; 2. re-validate all 23 under the hermetic set — EXPECT 17 match and the six mismatch
(they still hold the sentinel; interpretable, not alarming); 3. re-register the six from THOSE
observations with `observedOn` stamping the post-scrub environment; 4. confirm 23/23 under the hermetic
set. PRE-COMMITTED INTERPRETATION for step 2 (verbatim in the brief): *"if any of the 23 moves under the
hermetic set, that is a finding about what ambient was contributing, not a quarantine violation and not
grounds to revert the scrub; the honest response is to re-register that entry from a real observation."*
The two-runner count (0 of 23 moved under the parser) is the CONTROL: after the scrub, any movement is
attributable to the scrub alone. COUNT-LOCK: refuse-never-skip, in the SAME lane I unit, plus a falsifier
for the CONJUNCTION (an entry where every layer is unobservable has no lock at all and must refuse
loudly). HIGH is scoped to the six entries on the COMMITTED side only; MEDIUM on the ambient finding is
RE-BASED onto the fixed runner's 23/23 — superseded, not corroborated; the old committed 23/23 never
appears in the close as support. Lane J LANDED at `438ff2f0` (REMOVED 15 carried separately; both β
conditions in the merge message — ATTESTED; the close cites the SHA and lets a reader resolve it).
The derived gap is BENIGN, and per β `f8d3a607` the claim is stated as ARITHMETIC, not a conclusion:
**215 = 110 + 105**, the 105 attributed per generated view — `framework-manifest.json` 90 → 45 (−45),
`framework-installed.json` 60 → 30 (−30), `_mc/MANIFEST.json` 65 → 35 (**−30**; α first printed −35 —
caught by β `c5e91b73` on one subtraction; the printed deltas summed to 110 against a gap of 105; the
totals were right and one figure was mistyped — the emission audited itself on first reading, which is
the whole argument for arithmetic over conclusions). Tightened wording (the
only defensible form; "nothing vanished" is FALSE as written and must not appear in the close): *no
occurrence left the register unaccountably; 105 derived occurrences were legitimately removed by
regenerating the views that contained them; the strict derived-without-pinned-source check is zero.*
R-39(a) SATISFIED on that emission; R-39(b) UNBLOCKED; the register regen runs twice (now, and LAST
after the triple manifest regen). CLOSE-CHECKLIST ITEM, tracked separately from the regen about to run:
the FINAL regen must be shown a NO-OP diff (`d5c8a271`), or the derived-gap set is re-emitted on the
final state. ε's pre-committed falsifier: derived lands at 110 after the manifest regen; anything else
is a finding.

## STATUS TABLE — the e-16 "blocked" list, answered

| e-16 item | Ruled | Where | β id |
|---|---|---|---|
| Same-commit vs partition-only retirement form | **YES — SPLIT FORM ADOPTED** (r-21), land by ordinary no-ff merge (r-25) | § R-21/R-25 | `f1a93c68` |
| Occurrence-register regeneration + sequencing | **YES** (r-39) + the final-regen no-op proof | § R-39 | `f1a93c68`, `d5c8a271` |
| Runner diagnostic-parser key indent | **YES — AUTHORIZED** (r-30) with 5 conditions + 2 β additions (r-33) | § R-30/R-33 | `a3e8f572`, `b6d1e390` |
| Case (e) assertion literal | **YES — AUTHORIZED, branch (ii)** (r-36) | § R-36 | `d20b6e91` |
| d0576180 carrying ε's files under α's message | **CORRECTED** (r-44): now `f6e50314` (ε author, true message); enforcer re-committed `25bb6541` | § R-44 | — |
| Push to origin / CI green on final head | operator-only, unchanged | — | `f1a93c68`, `c4a06f28` |

## R-21 / R-25 — lane J landing form (SUPERSEDES r-03a item 3) — β `f1a93c68`
"In the same commit" → **"in the same LANDING"**: (a) the code commit (15 shim deletions, alias-map shrink,
both tests, per-entry expiry on the deferred member copied from `tests/quarantine.json`'s shape incl. an
enforcing case), then (b) the partition-only warranted amendment commit retiring the occurrence-register
rows, CONTIGUOUS, landed together by ONE ordinary no-ff merge (ε's probe `b054b9ac` measured
cutover-completeness / framework-purity / leak-gate = 0 on the merged head). Rationale: F8 is the
registered enforcer β ordered first; a convention loses to an enforcer. Two binding conditions:
(1) HONESTY — the close/DONE-REPORT says the atomicity ("contiguous, one merge, never pushed separately")
is PROCEDURAL; only the head-green resting state is enforced (F7 reds if the intermediate state ever
rests); never describe the landing form as enforced. (2) DISCLOSURE — the merge message names the
intermediate commit by SHA, states what is red in it and why, and cites probe `b054b9ac`.
**Lane J may land now.** Green split: `a097eec9` → `420712c1` on `s-os-06/lane-j-scratch-split`.

## R-30 / R-33 / R-36 — lane I parser dispatch (ONE dispatch, commit-first, report-to-file, ≤18 min)
AUTHORIZED: the runner's diagnostic-parser fix, inside lane I (`b3f81d47` D2: the lane that changes the
contract owns its falsifier). Conditions: (1) PROPERTY not literal — parse YAML diagnostic keys at the
marker's indent OR deeper; (2) all nine assertions BYTE-UNCHANGED, proven by comparison; (3) RED-then-GREEN
per case: (b),(h) green; **(f) must go RED with the multiset lock neutralized and GREEN restored** — the
proof for (f); (4) ADD the vacuity-branch falsifier — the proof for the BRANCH; `a3e8f572`: 3 and 4 are
both required, neither substitutes; (5) the 23 real register entries re-run under the fixed parser
BEFORE the certifying run, emitting PER ENTRY whether its observed cause set is EMPTY or non-empty (a
VACUITY COUNT, not an outcome diff), against BOTH runners (`f57c1a80`), with this interpretation
pre-committed verbatim: *"if any of the 23 moves under the fixed parser, that is evidence about how many
locks were vacuous or mis-captured — a finding, not a quarantine violation, not grounds to revert the
parser fix; the honest response is to re-register the entry from a real observation."* The same count
decides β's SUSPENDED severity on the ambient finding (`a3e8f572`): 0 of 23 vacuous → MEDIUM stands; any
vacuous → HIGH for those entries. Runner property ABOVE the indent fix (`b6d1e390`): **an empty observed
capture is INDETERMINATE and must REFUSE, never pass.** β's case-(b) clearance is WITHDRAWN
(`b6d1e390`) — (b) needs no edit anyway.
CASE (e) — AUTHORIZED under `a3e8f572`'s self-executing test, branch (ii) (`d20b6e91`): the dropped field
`firstFailingAssertion` was NEVER β-required — it is the pre-β grain the ordered-set ruling REJECTED as a
false-green proxy; removing it IMPLEMENTS β's ruling (α's earlier "superseded" framing was wrong,
corrected). Repoint (e) at a member of the emitted 8-field required set `[file, causeLines, failCount,
cause, filedUnder, expiry, expiryVersion, observedOn]`, emit the required-set DELTA (removed
{firstFailingAssertion}; added {causeLines, failCount, observedOn}), net-add the inverse case,
RED-then-GREEN. TWO β CHECKS (`d20b6e91`): `observedOn` must carry THREE stamps — platform, Node major,
reporter — emit its contents; the register-level BASE assertion must still exist in the rewrite — cite
the line. Facts measured by α: the YAML diagnostic parser (`parseDiagnosticBlock(…, t[1].length + 2)`,
L330) exists ONLY in the rewrite; the committed runner locks on `firstFailingAssertion` verbatim and has
no such parser. Read the falsifier file's per-file result from the SUITE's full output, never a
standalone run (`f57c1a80`). Then the hermetic scrub (`b3f81d47` D1) as the FOLLOWING dispatch: declared
allow-list carrying the Windows platform essentials, in the normalizer's own declaration, RED-then-GREEN,
verify-before-build; then re-validate the register under the hermetic set as a THIRD environment with
the interpretation pre-committed. All of it lands WITH the runner rewrite (`f57c1a80` fence).

## R-39 — the occurrence register — β `f1a93c68`, `d5c8a271`
Failure `record-trust-exit.test.js` ("the exit gate must not change the committed ledger") is REAL: the
committed register is stale after the merges (pinned 319 → 334). Sequence: (a) FIRST emit the derived-gap
set (register 215 vs sweep 110): which 105 register rows lost their occurrences, and NAME the
discriminator before rating — benign = rebuild-before-sweep regenerated views so the literals legitimately
vanished (not a finding); stale pins pointing at vanished occurrences = F7 class, MEDIUM; occurrences with
no disposition = HIGH. Nothing is regenerated before that set exists. (b) THEN regenerate the register as
ITS OWN commit stating head, delta and reason (§ 7b: the round's artifacts stay inside the population);
add-side, inspected by the teeth normally. Lane K's count guard REFUSING on drift is correct: lane K's
sets are re-derived on the final tree (K's brief already required it); K's adjudication at `56a16fc1`
stays in the record as a measurement at a stated head. (c) The regen REPEATS as the LAST step after lane
J + lane I land — **and `d5c8a271` requires the final regen to be shown a NO-OP (empty diff)**; if it is
not a no-op, the derived-gap set is re-emitted on the final state. One diff, not a second measurement.
The suite stays red on that one test until (b); that is the truthful state.

## R-39 addendum — the head-advanced-after-check race case — β `d5c8a271`
"Flake" is NOT a disposition. Six runs (3 alone, 3 in-suite — the split is load-bearing because the two
invocations differ by the shared child environment) give FREQUENCY; LOCATION decides: **read the exit
gate's check-then-read ordering.** If the gate reads the head AFTER performing its check, a concurrent
commit makes its verdict apply to a different tree — a genuine TOCTOU defect in the PRODUCT, and the
intermittent red is the test catching it non-deterministically. Dispositions: fix the test's determinism,
or record a product finding. A sprint-authored file cannot be quarantined.

## R-42 — pristine re-measure
α's live-ledger case is FIXED at `25bb6541` (β `c4a06f28`): direct `fs.existsSync` on the resolved ledger
path; absent → prints `SKIP: … looked for <path>; referential integrity NOT evaluated here` and passes;
present → asserts as before. The RED leg (present-and-broken through the same gated path) is the plant at
`5f1b8da3` (β `d5c8a271`). Re-measure the suite on a just-restored tree at the CURRENT head and report the
failures by FILE NAME with SHA; mark 1225/1222/0 RETIRED in DONE-REPORT; the pristine set at each head is
the record.

## R-44 — shared root worktree
α no longer commits to `open-source/S-OS-06` from the root tree while ε conducts. α's substrate work goes
on `alpha/S-OS-06-substrate` from α's own worktree; ε merges it at its next merge point like a lane. The
root index is ε's alone.

## R-46 / R-48 — substrate merges under R-44
`alpha/S-OS-06-substrate`: `5f1b8da3` (the plant test), `f20e062d` (this file, first version), plus the
ids-only rewrite and the enforcer's `--artifact` mode (this commit). ε merges at its next merge point,
no-ff. Cannot conflict with lane work outside `scripts/checks/beta-ledger-refs*`,
`tests/regression/S-OS-06/beta-ledger-refs.test.js`, and this file.

## Ledger facts ε may not have processed
Every β id in § ID MAP resolves (`beta-ledger-refs` GREEN against the canonical path). `b6d1e390` and
`f57c1a80` are β verdicts sent to ε and appended by α as relay writer — do not re-append; cite by id. β
verdicts you receive from here on: APPEND BEFORE ACTING, every time.
