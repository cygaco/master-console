# BUILD BRIEF — S-OS-06 r4, lane I6: the parser property, the vacuity falsifier, case (e), and the vacuity COUNT

WORKTREE: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-s2i-capture`
**RESUME on branch `s-os-06/s2i-capture`.** Your I5 diagnosis was excellent and is the basis for all of this.

## Authorizations — you may now edit the runner and case (e)

- **α r-30**: the diagnostic-parser key-indent fix is GRANTED, inside lane I's remedy scope.
- **β row 488 (`d20b6e91`)**: case (e)'s assertion literal is **AUTHORIZED** under branch (ii) of the row-487
  test. You may repoint it.
- **β row 490 (`b6d1e390`)**: parser authorization scoped; the vacuity falsifier made **REQUIRED**;
  **β WITHDREW its earlier clearance of case (b)** as mis-targeted — (b) needs no edit anyway, it goes green
  with the parser fix and assertions unchanged.
- **β row 491 (`f57c1a80`)**, **β row 486 (`b3f81d47`)**, **β row 487 (`a3e8f572`)**, **α r-32/r-33/r-35/r-36**.

## ORDER. Do these in this order; commit after each.

**0. Write `runtime/S-OS-06/r4/s2i3/LANE-I6-REPORT.md` as a stub and COMMIT it FIRST.**

**1. THE RUNNER PROPERTY, which sits ABOVE the indent fix (β row 490, α r-32):**
> **An EMPTY observed capture is INDETERMINATE and must REFUSE. It may never pass.**

If the runner cannot capture a cause, it knows nothing about whether the cause changed, and *"I could not
look"* must never render as *"it matches."* Find where that branch currently exits and **make it fail closed.**
This is the defect (f) was hiding behind, and it is the round's finding.

**2. THE PARSER FIX — fix the PROPERTY, not the literal.**
Parse YAML diagnostic keys **at the marker's indent OR deeper**, or normalize before matching.
**Do NOT pin to node 24's shape.** node 20 and node 24 layouts are two instances of ONE variance; swapping
one indent literal for another is enumeration-as-closure and β has committed that error twice this round and
says so. Accept both forms.

**3. CASE (e) — authorized, with the test already run for you.**
α measured the required-set delta (`git show`, committed runner at `6d46a818` vs your branch):
- committed: `[file, firstFailingAssertion, cause, filedUnder, expiry, expiryVersion]`
- rewrite: `[file, causeLines, failCount, cause, filedUnder, expiry, expiryVersion, observedOn]`
- **REMOVED** `{firstFailingAssertion}` · **ADDED** `{causeLines, failCount, observedOn}`

**CORRECTION you must not repeat (α r-36, correcting α r-35):** `firstFailingAssertion` was **NEVER**
β-required. It is the PRE-β lock grain, and **row 473 REJECTED it verbatim as a false-green proxy**
("lock the ordered set of cause lines, not the first line"); row 479 refined ordered → multiset. **Removing
it IMPLEMENTS β's ruling.** The earlier "superseded" framing was wrong.

So branch (ii) applies: **AUTHORIZED.** Repoint (e) at a member of the emitted 8-field set, **net-add the
inverse case**, RED-then-GREEN, everything else byte-unchanged. (e)'s PROPERTY must survive: a malformed
register still fails closed. **EMIT the required set and show it is NON-EMPTY.** Emit the DELTA, not just
the one field; if more than one field left, say so.

**4. RED-then-GREEN, per case, individually. A suite green discharges nothing.**
- (b) and (h) go GREEN under the fixed parser.
- **(f) must go RED when the multiset lock is neutralized and GREEN when restored.** That pair is the proof
  the vacuous pass is closed. This proves (f) ONLY.
- **ADD the missing falsifier for the vacuity branch itself** — a case that FAILS when the branch is removed.
  This proves the BRANCH. **Both are required; neither substitutes for the other** (α r-33).
  That "removing it changes no result once the parser is fixed" is the argument FOR the case, not against it:
  an unreachable-in-test branch can rot or be edited undetected.
- Assertions in all nine cases stay **BYTE-UNCHANGED** except (e), proven by comparison as you did in I5.

**5. THE VACUITY COUNT — on BOTH runners. This is a COUNT, not an outcome diff.**
For all 23 real register entries, **emit PER ENTRY whether its observed cause set is EMPTY or non-empty.**
Run it against **both**:
- the **committed** runner at `6d46a818`, and
- your **fixed** runner.

α measured that the committed runner has **no YAML diagnostic-block parser at all** (its lock is
`firstFailingAssertion` verbatim), so the parser-vacuity path is contained to your branch. β wants the count
run against both anyway, because there is a second candidate empty-reads-as-agreement path in the committed
runner (row 472: containment over a truncated string, guarded by the empty-capture sentinel). That is a
measurement, not a code read.

**PRE-COMMITTED INTERPRETATION — this is written BEFORE the run, verbatim, so it cannot be adjusted after:**
> *"If any of the 23 moves under the fixed parser, that is evidence about how many locks were vacuous or
> mis-captured — a finding, not a quarantine violation, not grounds to revert the parser fix; the honest
> response is to re-register the entry from a real observation."*

**Both severity outcomes are pre-committed too, so report the count without regard to which anyone wants:**
- **0 of 23 vacuous** → β's MEDIUM rating on the ambient-environment finding stands.
- **any vacuous** → a lock reported a match while matching nothing. That is a store-state falsehood and
  **HIGH** for those entries.

**6. TWO CHECKS that could fall through while attention is on the removed field (α r-36):**
- `observedOn` must carry **THREE stamps — platform, Node major, reporter** (row 473 condition 5). A single
  date does not satisfy it. **Emit its contents.**
- The **register-level BASE assertion** (row 476 P4: assert the register's base field equals the expected
  value, REFUSE otherwise) lives at **register grain**, not in the per-entry list. **Confirm the rewrite
  still asserts it and cite the line.**

## A measurement rule that applies to your own evidence (β row 491)

**Standalone green does not establish in-suite green.** In the suite the file is spawned through the runner
with the shared child environment — the very environment we know displaces captured output. When you report
the falsifier file's result, take it from the **SUITE run's own full output**, not from a standalone
invocation. The conductor already made this mistake and it is recorded.

## Out of scope

The hermetic environment scrub — that is your NEXT dispatch, not this one. `.github/workflows/**`, manifest
regeneration, `.claude/settings.json`, `partition-loader.js`, the occurrence register.

## TIME BOX — 18 minutes

The wrapper hard-kills at 20 minutes regardless of any brief. **If you cannot reach everything, do 1, 2, 4
and 5 and say plainly what you did not reach.** The runner property (1) and the vacuity count (5) are the
two that matter most; (3) and (6) can be `cannot-assess` with a named reason. Commit after each step.

## Report

The refuse-on-empty property and where it exits. The parser fix showing both indent forms accepted. Case (e)
with the required-set delta emitted and non-empty. The (f) lock pair and the vacuity-branch case, each shown
red-then-green individually. **The per-entry vacuity count for BOTH runners.** `observedOn`'s three stamps.
The base assertion's line. Anything refused.

**If a premise here is false, prove it and STOP.** Four refusals this round have each produced a real finding.
