# BUILD BRIEF — S-OS-06 r4, lane K3 RESUME: run the property adjudication

WORKTREE: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-s2k-properties`
**RESUME on branch `s-os-06/s2k-properties`.**

## Corrected header — three things the previous brief said are now out of date

The previous dispatch (`brief-s2k2-resume.md`) died with the orchestrating session, exit 4, producing no
report. Before you start, three corrections, each verified by the conductor against the tree you are on:

1. **Your instrument is further along than that brief said.** It described the instrument as still being
   built. In fact the inventory is COMMITTED and MEASURED at `4efce2ff`: **2085 allow-listed, 1666 with an
   occurrence.** Instruments live at `runtime/S-OS-06/r4/lane-k/` (`inventory-k.js`, `inventory-k.out.json`,
   `js-context-k.js`). Start from the measured inventory. Your job is the ADJUDICATION, not the instrument.

2. **Lane G's handoff file EXISTS.** The previous brief said "if lane G has written
   `runtime/S-OS-06/r4/join-authored-for-K.json`, adjudicate from it; if not, say so." It is present on your
   worktree, 26,644 bytes. Adjudicate the 21 authored members from it.

3. **The concurrent-deletion premise is now FALSE.** That brief warned another lane was concurrently deleting
   roughly thirty legacy-named files and told you to hedge your population accordingly. **That lane is
   BLOCKED and deleted nothing.** Lane J Part 2 stopped on a CI-binding it could not remove without an
   operator-only workflow edit. No files are being deleted underneath you. Measure the population as it is.
   There is still a REMOVED-vs-FIXED distinction to respect if anything is removed later, but nothing is in
   flight right now.

**Your head is `56a16fc1`** — the ε-reconciled sprint head with ten lanes merged, brought onto your branch.
State it as the head you measured at.

## Your specification

`runtime/S-OS-06/r4/STOP-CONDITION.md` on this branch, section 1 as restated, plus **section 7b**: the
round's own measurement artifacts are RECORDS, they stay INSIDE the swept population, and the frame must
STATE their contribution rather than excluding them by path.

Backing rulings: ledger rows 476 (`4a6d8c30`) and 477 (`9c4b7e18`).

## Deliver THREE SETS with counts and per-file reasons

1. **A-admitted** — *rewriting the legacy literal would break the file's own function.* Verbatim AND test-pinned.
2. **B-admitted** — *rewriting would falsify a record of something that happened.* Verbatim.
3. **RESIDUE** — paths the partition allow-lists that NEITHER property admits. **This is the fix population.**

Partition class is EVIDENCE for B, never the test. A class-3 or class-4 file can hold a LIVE reference: a
planning document telling a reader to run a legacy-named command is an INSTRUCTION, not a record.

β's stated expectation, recorded so your result can CONTRADICT it: residue zero for dreams, reports, archive
and decision records; **non-zero for the planning directory**. Report disagreement rather than bending to it.

## The regression-suite guard is mandatory and PER FILE

A test whose assertion has the legacy literal as its **SUBJECT** qualifies under A. A test that merely carries
a legacy identifier **of its own** is LIVE and goes in the residue to be RENAMED. **Emit the per-file
breakdown before admitting any member** — "roughly 161" is a count without its set.

Note: ten lanes just merged, several adding new files under `tests/regression/S-OS-06/`. Your regression-
directory population is therefore LARGER than the 168 the earlier brief quoted. Re-derive it at `56a16fc1`
rather than trusting that number.

## Two you do NOT settle

- The **provenance document** is B's strongest member but its disposition is **PROVISIONAL** on an operator
  decision. Record it provisional, not settled.
- The single **continuous-integration hit**: IDENTIFY it and report what it is. Do not adjudicate, do not
  edit. If it sits under the workflows directory any change is operator-run.

## Out of scope

All fixes and renames. The codemod, the runner, the oracles. `.github/**`. Manifest regeneration.
Do not touch `.claude/settings.json`.

## TIME BOX

**100 minutes from your start record.** Budget so you ALWAYS emit the sets — a partial adjudication with its
population honestly stated beats a complete one nobody receives. Mark unreached scopes `cannot-assess` and
name them; do not invent coverage.

## Report

The three sets with counts and per-file reasons, the regression-directory breakdown re-derived at your head,
the residue as the fix population, the 21 authored members adjudicated from lane G's file, the identified
continuous-integration file, and the head you measured at.
**If a premise here is false, prove it and STOP.**
