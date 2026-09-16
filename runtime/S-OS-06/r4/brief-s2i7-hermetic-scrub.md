# BUILD BRIEF — S-OS-06 r4, lane I7: the HERMETIC SCRUB of the child environment

WORKTREE: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-s2i-capture`
**RESUME on branch `s-os-06/s2i-capture`.** Your I5 and I6 work is the basis for this and is not reopened.

## The ruling

**β row 486 (`b3f81d47`), DECIDE.** The ambient-environment capture defect is remedied by **the hermetic
scrub**. Two alternatives were considered and REFUSED, and you should know why so you do not drift back
toward them:
- **A declared ceiling: REFUSED.** "Any ambient variable that makes the code print to stderr" is an OPEN SET,
  not a ceiling. Disclosure-instead-of-repair was already refused at row 476.
- **Controlling the capture environment: REFUSED.** It is a convention with no enforcer.

Only the scrub makes the capture a property of the **CODE** rather than of the **MACHINE**.

## β's scope correction, which makes this bigger than it looked

The exposure is **NOT** limited to the quarantine re-runs. `childEnv()` is used for the **MAIN spawn** as
well, so ambient environment reaches **every test child** and the exposure is **the whole suite**. Scope your
work to that, not to the quarantine path alone.

## DIRECTION, NOT SPECIFICATION — verify before you build

β was explicit that this is direction and that it has not read `childEnv`'s callers beyond two sites:

- **An empty environment WILL break spawn on Windows.** So this must be a **declared ALLOW-LIST carrying the
  platform essentials**, not an empty set.
- **Write the allow-list into the normalizer's own declaration**, where a reader of the declaration sees it.
  Not buried in a helper.
- **RED-then-GREEN.**
- **If the allow-list cannot carry it, COME BACK rather than forcing it.** Stopping with a measured reason is
  the expected outcome if the platform will not cooperate. Do not ship something that half-works.

## The second half, which is NOT already done

Your I6 count established 0 of 23 empty under the fixed runner in the CURRENT ambient environment. That is a
different question from this one. **The hermetic set is a THIRD environment.** So:

**Re-validate all 23 register entries under the hermetic environment** and report per entry.

**PRE-COMMITTED INTERPRETATION — written here BEFORE the run, verbatim, so it cannot be adjusted afterward:**
> *"A mismatch under the hermetic set is a FINDING ABOUT THE SCRUB, not a quarantine violation to be waved
> through. If entries move, the scrub changed what the code under test emits, and that is information about
> the register's environment-dependence, not evidence that the tests rotted."*

Report the count and the per-entry result without regard to which answer would be convenient.

## Lane J does not dissolve this

Lane J has now LANDED and removed 15 shims, which may remove today's deprecation-warning writer. β ruled in
advance that **a dissolved cost is not a waived requirement** — the next stderr writer will be something
else. The scrub is owed regardless of whether the current corrupting writer still exists. Do not conclude
"no longer reproducible, therefore done."

## Out of scope — one of these is a real finding you must NOT act on

- **The COUNT-LOCK.** You named it in I6: it runs only when a failing-test count was observed, so an
  unobservable count is skipped SILENTLY rather than refused — the same shape as the cause-capture defect.
  **You were right to leave it alone and you must leave it alone again.** It has been routed to β for its own
  ruling. Do not widen your scope into it.
- `.github/workflows/**`, manifest regeneration, `.claude/settings.json`, `partition-loader.js`, the
  occurrence register, and re-registering any of the 6 entries that were vacuous on the COMMITTED runner
  (the branch register already carries non-empty multisets for all 6).

## ORDER

0. Write `runtime/S-OS-06/r4/s2i3/LANE-I7-REPORT.md` as a stub and **COMMIT it FIRST**.
1. **Verify first:** enumerate every caller of `childEnv()`, and determine empirically what the minimum
   Windows spawn set is. Report both before changing anything.
2. Build the declared allow-list into the normalizer's declaration. RED-then-GREEN.
3. Re-validate the 23 entries under the hermetic set; emit the per-entry result and the count.

## TIME BOX — 18 minutes

The wrapper hard-kills at 20 minutes regardless of any brief. If you cannot reach step 3, do steps 1 and 2
and say so. If step 1 shows the allow-list cannot carry Windows, STOP at step 1 and report that — β
pre-authorized that outcome and it is not a failure.

## Report

Every `childEnv()` caller. The measured minimum Windows spawn set. The declared allow-list and where a reader
finds it. RED-then-GREEN evidence. The 23-entry re-validation under the hermetic set with its count.
Anything refused.

**If a premise here is false, prove it and STOP.** Five refusals this round have each produced a real finding.
