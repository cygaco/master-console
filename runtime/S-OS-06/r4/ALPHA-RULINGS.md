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
| `b7e04c31` | The issued-stub protocol covers a failure mode NOT observed tonight (line survives, body lost) — the close must not claim it addresses the whole-message losses; the β→α direction has no durable pull record by construction (G-25) — a retro STRUCTURAL GAP; α's own rule applied one step up: before re-asking β, check the ISSUED index and ask for a body by id |
| `d6b18f04` | The hermetic 23/23 (0 moved) SATISFIES Q3 by measurement (pending the register path+SHA); residual = the six's `observedOn` stamp (re-stamp post-scrub or annotate capture≡checking, dated); β's 17/6 expectation was a WORSE error than its six refuted claims (it contradicted a measurement already in hand) — own class, guard: check the thread for an existing measurement before predicting an artifact's state; the builder's scope limit adopted verbatim; the CERTIFYING RUN must be taken on a tree NOTHING ELSE writes to (§ 5.5 condition); the live-mutable-state class is a named residual whose members each still owe the location question |

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
certification blocked until this exists (β `a2f74e09`); (b) the triple manifest regen (derived-110 checked
here); (c) the FINAL register regen shown a NO-OP diff or the derived-gap set re-emitted (β `d5c8a271`),
lane K's sets re-derived; (d) oracles (i)(ii)(iii) + occupancy certifying run on an EXCLUSIVE tree
(β `d6b18f04`), oracle (ii) with the path-name tally + the deferred member's filename disposition beside
the zero (β `f1a93c68`), § 8 discharged first; (e) security (codex/GPT via `dispatch-agent.js`) + backend
gauntlet on the final head; (f) the condition-(b) throwaway-plant result recorded; (g) DONE-REPORT
carrying every item β holds for the next boundary; then the operator push → CI → β release consult keyed
"S-OS-06 r4". The one-swap stays a named residual with its location question open.

## R-69 — the hermetic re-validation result and the certifying-run condition — β `d6b18f04`
IF ε confirms the 23/23 was measured against the lane I BRANCH register (path + SHA; the six's branch
causeLines shown non-empty): Q3 of `a94f0d26` is SATISFIED BY MEASUREMENT — zero moved, nothing to
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
