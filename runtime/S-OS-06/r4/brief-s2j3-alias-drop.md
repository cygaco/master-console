# BUILD BRIEF — S-OS-06 r4, lane J Part 2 (REVISED): the alias drop, PER MEMBER

WORKTREE: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-s2b-codemod`
**RESUME on branch `s-os-06/s2b-codemod`, now at `12f80eb5`** (the ε-reconciled sprint head is merged in).

## The ruling that unblocks you, and how it differs from your last brief

Your predecessor dispatch STOPPED Part 2 and was RIGHT to. It proved, with three runs and matching hashes,
that one shim cannot be removed without an operator-only workflow edit. That refusal produced this ruling.

**α ruling r-03a (superseding r-03) adopts β verdict `c7a4e2b9-3f81-4d6a-9e05-8b21fc6d5a73` IN FULL.**
The decisive correction — and it overrules what the conductor proposed:

> **Blocked-ness is PER MEMBER, not per unit.** The live-consumer break is demonstrated for ONE of the
> sixteen and undemonstrated for the other fifteen. Deferring all sixteen as a unit is "one list answering
> two questions". For the fifteen, the same deferral words would be "a warrant in compat costume".

So: **drop the 15. Defer exactly 1.**

## Facts the conductor VERIFIED before writing this brief — you may rely on them, but re-check if cheap

- `scripts/checks/` holds **16** legacy-prefixed `*.js` check scripts (excluding tests), and **all 16 have a
  `mc-*.js` twin already on disk.** Measured by listing, not inferred.
- `scripts/checks/leak-gate.js` `GATES` (lines ~32–38) names **exactly ONE** of them:
  the tracked-transients gate. The other four gates name non-legacy scripts.
- `scripts/open-source/mc-alias-map.json` carries only **top-level** `introducedIn: "2.0.0"` and
  `removeIn: "2.1.0"` (lines 4–5). **There is no per-entry expiry field.** You will be adding one.

## Your work, in order

**1. COMMIT nothing yet — but FIRST write your report file and commit it:**
`runtime/S-OS-06/r4/lane-j/LANE-J-REPORT.md`, stub is fine. Commit it before you start. A committed report
survives a reap; stdout does not. Your predecessor's report reached the conductor only because a wrapper
happened to capture it.

**2. PER-MEMBER consumer check on each of the 15, BEFORE removing any of them.**
β's rule cuts both ways: "undemonstrated" is not "proven absent". For each of the 15, establish whether a
live consumer breaks on its removal. If you find one, that member becomes blocked **by the same evidence
standard applied to the first**: name the consumer that breaks, and show the repair is out of session reach.
Do not remove a member whose consumer you have not checked. Report the check per member.

**3. Remove the members that pass the check.** For each removal, in the SAME commit:
- delete the shim,
- retire its `mc-alias-map.json` entry,
- **retire its occurrence-register rows** (α r-03a: "occurrence rows retire in the same commit").

`tests/regression/S-OS-06/alias-map.test.js` asserts every alias exists, so the map entries and the files
must move together or that test goes red. That test was added as a row-478 prerequisite; keep it green.

**4. DEFER exactly one member: the tracked-transients shim.** Do NOT delete it and do NOT edit
`.github/workflows/**` — that edit is operator-only and has been classifier-denied. Instead:
- add a **PER-ENTRY expiry field** to its `mc-alias-map.json` entry, keyed to the NAMED TRIGGER
  (the operator's leak-gate workflow line-36 edit). Per-entry, not the top-level `removeIn`.
- β is explicit that this is distinguishable from a shim-in-a-warrant ONLY because a live consumer break is
  demonstrated and the expiry is per-entry and trigger-keyed. Write it that way.

**5. Accounting: REMOVED is a SEPARATE count from FIXED.** Do not fold removals into the fix population.
Your before-state printout is already on this branch at
`runtime/S-OS-06/r4/oracle-iv.before-alias-drop.set.json` (288 KB, preserved). Produce the after-state and
report REMOVED explicitly.

**6. The removal-history teeth (B2, commit `43f9e007`) are on this branch and they are the point.**
β row-478 ordered teeth-first precisely so this retirement would be checked by them. Run them against your
retirement and report what they say. If they reject your retirement, that is a real finding — report it,
do not work around it.

## Out of scope — route, do not do

- `.github/workflows/**`. Operator-only, classifier-denied. Naming it in a report is fine; editing is not.
- **Manifest regeneration.** It is a close step the conductor owns, and it must happen LAST.
- **The post-drop oracle re-measure.** A separate dispatch will run oracle (ii) on your resulting tree.
  β has flagged that if oracle (ii) counts the retained filename, section 5.1's zero is unsatisfiable as
  written. That is not yours to resolve; just leave the tree measurable.
- `.claude/settings.json`. `partition-loader.js`.

## TIME BOX — 18 minutes

The dispatch wrapper hard-kills at 20 minutes regardless of what any brief says. Budget to **always** emit
your report. Commit incrementally: a partial removal that is committed and honestly reported beats a
complete one that dies in a buffer. Mark anything unreached `cannot-assess` and name it.

## Report

Per-member consumer check for all 15 with its result; what you removed and what each removal retired;
the deferred member with its per-entry trigger-keyed expiry; REMOVED count separate from FIXED; what the
removal-history teeth said; and anything you refused.

**If a premise here is false, prove it and STOP.** Your predecessor's refusal is why this ruling exists.
