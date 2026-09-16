# BUILD BRIEF — S-OS-06 r4, lane J4: correct the deferred member's per-entry expiry to the CANONICAL shape

WORKTREE: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-laneJ-split`
**Branch `s-os-06/lane-j-scratch-split`, at `420712c1`.** This branch is the LANDING CANDIDATE. The conductor
merges it as soon as you are done, so keep it green.

## Why you are here

Your per-member work was right and is being landed. β and α ruled one correction before it lands.

**β (relayed at α r-12 item 4, and carried in row 486):** the per-entry expiry shape you need **already
exists** in `tests/quarantine.json` — `filedUnder` / `expiry` / `expiryVersion` on every one of its 23
entries, **with case (h) enforcing expiry at runtime**. **Copy that shape, INCLUDING the enforcing case**,
rather than inventing one. Copying it is what gives the deferred member a **falsifier**; an invented shape
has none.

## What is there now, and what is wrong with it

`scripts/open-source/mc-alias-map.json` `checkScripts[0]` currently carries a bespoke nested `expiry` object:
`{ kind, trigger, removeWhen, notBefore, supersedesTopLevelRemoveIn, warrant }`.

The CONTENT is good and well-reasoned — the named trigger, the removeWhen, the warrant citing α r-03a and
β `c7a4e2b9`. **Do not throw the content away.** What is wrong is that the SHAPE is bespoke, so **nothing
enforces it**. No test can expire it, and a field nobody reads is decoration.

The canonical shape, measured from `tests/quarantine.json`:
```
"filedUnder":     "ED-434",
"expiry":         "S-OS-08 (test-rot cleanup sprint)",
"expiryVersion":  "3.0.0"
```

## Your work, in order

**0. Write `runtime/S-OS-06/r4/lane-j/LANE-J4-REPORT.md` as a stub and COMMIT it FIRST.**

**1. Adopt the three canonical fields** on the deferred member: `filedUnder`, `expiry`, `expiryVersion`.
Keep the trigger, removeWhen and warrant as ADDITIONAL fields — the canonical three are what gets enforced,
the rest is the human record. Do not delete the reasoning.

**2. ADD THE ENFORCING CASE. This is the point of the exercise, not an extra.**
Mirror quarantine case (h): a test that **FAILS when the entry is past its expiry version**. Put it where the
alias map is already tested (`tests/regression/S-OS-06/alias-map.test.js` asserts every alias exists, and it
is a row-478 prerequisite that must stay green). Demonstrate it **RED-then-GREEN**: show it failing against a
planted past-expiry entry, then green against the real one. **A shape with no enforcing case is the same
decoration we are replacing.**

**3. Keep the landing green.** After your change run, each as its own command reading its real exit code:
`node scripts/checks/cutover-completeness.js`, `node scripts/checks/framework-purity.js`, and
`node --test tests/regression/S-OS-06/alias-map.test.js`. Report each rc. If the partition teeth reject
anything, that is a finding — report it, do not work around it.

**4. Whether your change belongs in the code commit or the partition-only commit is YOURS to determine
from the teeth, not from this brief.** The branch is deliberately two commits: `a097eec9` (code) then
`420712c1` (partition-only amendment). F8 requires a partition-key removal to be its OWN partition-only
commit. The alias map is not the partition, so a new commit on top is likely correct — but **verify with
the teeth rather than assuming**, and say which you chose and why.

## Context you should have

The conductor will land this branch by an ordinary no-fast-forward merge. That was measured clean on probe
`b054b9ac`. β attached two binding honesty conditions to the landing, which the conductor owns, not you:
the contiguity of the two commits is **PROCEDURAL, not enforced** (only the head-green resting state is
enforced), and the merge message must name the intermediate commit and what is red in it.

Nothing about the 15 removals or the deferral decision is reopened. Only the expiry shape changes.

## Out of scope

`.github/workflows/**` — the trigger is an operator-only edit and is classifier-denied; name it, never edit
it. Manifest regeneration. The occurrence register. `.claude/settings.json`. The 15 removals themselves.

## TIME BOX — 18 minutes

The wrapper hard-kills at 20 minutes regardless of any brief. Commit after each step. If you cannot reach the
enforcing case, say so plainly — the conductor needs to know the falsifier is missing before landing, because
that is the whole reason β ordered the copy.

## Report

The three canonical fields as written; the enforcing case shown RED-then-GREEN; which commit you put the
change in and what the teeth said; the three gate exit codes; anything refused.

**If a premise here is false, prove it and STOP.**
