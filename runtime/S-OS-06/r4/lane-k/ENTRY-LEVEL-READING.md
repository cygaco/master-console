# S-OS-06 r4 lane K — ENTRY-LEVEL reading of the contested population (ε, 2026-09-16)

**Measured head `a5c64c89`.** Produced by running lane K's own committed instrument
(`runtime/S-OS-06/r4/lane-k/inventory-k.js`) in a clean detached worktree, so it did not race the resumed
lane. Raw output: `inventory-summary.md`; full per-file data: `inventory.json`.

**This is an ENTRY-LEVEL reading, not the per-file adjudication.** It does not discharge lane K. Three entries
below are explicitly marked as requiring per-file work, and β has refused a bundled admission three times.

## Population reconciliation (holds)

```
tracked 4424 · allow-listed 2084 == withOccurrence 1666 + noOccurrence 418 · binary 0 · unreadable 0
```

| Bucket | Occurrences |
|---|---|
| Already historical under the list-form rule | 22408 |
| **CONTESTED** | **2766** |
| compat (being removed by the alias lane) | 70 |

The contested figure moved from the earlier 2610 because the tree changed under it — the round's own artifacts
entered, and the alias lane is removing files. Per `STOP-CONDITION.md` § 7b that is expected, and the
certifying frame states the head rather than excluding anything by path.

## Entry-level reading against the two properties

**PROPERTY A — rewriting the legacy literal would break the file's own function.** Each of these fails
mechanically if the token is rewritten: the codemod stops finding legacy tokens, the register stops recording
which occurrences carry them, the alias map's old side is destroyed.

| Entry | Occurrences | Reading |
|---|---|---|
| `scripts/open-source/rename-mc.occurrences.json` | 978 | A |
| `scripts/open-source/rename-mc.denylist.json` | 691 | A |
| `scripts/open-source/rename-mc.js` | 112 | A |
| `scripts/open-source/mc-alias-map.json` | 73 | A |

**Subtotal A ≈ 1854 of 2766 (67%).**

**PROPERTY B — rewriting would falsify a record of something that happened.**

| Entry | Occurrences | Reading |
|---|---|---|
| `.claude/dreams/**` | 92 | B |
| `_reports/**` | 87 | B |
| `.claude/project/sprint/**` (contested remainder) | 34 | B |
| `_archive/**` | 29 | B for content; **two filenames rename** per the clear-the-live-surface ruling |
| architecture decision records | 22 | B |
| `docs/PROVENANCE.md` | 22 | B, **PROVISIONAL** on the operator decision |

**Subtotal B ≈ 286**, of which the provenance document's 22 are provisional.

## THREE entries that are NOT settled here

**`_planning/**` — 387 occurrences, 58 of 84 files.** β predicted the residue would be non-zero exactly here,
because planning documents are the genre most likely to carry forward-looking INSTRUCTIONS using legacy names,
and an instruction is not a record. **Per-file adjudication required.** Whatever fails property B is a live fix.

**`tests/regression/S-OS-06/**` — 168 occurrences, 14 of 35 files.** The guard applies: a test whose assertion
has the literal as its SUBJECT qualifies under A; a test that merely carries a legacy identifier of its own is
LIVE and gets renamed. **Per-file, with the breakdown emitted before any member is admitted.** β has refused
this bundle three times and the earlier "roughly 161" was a count without its set.

**`.github/**` — 1 occurrence.** Identify it. Unruled by β pending identification, and if it sits under the
workflows directory any change is operator-run because the classifier auto-denies edits there.

## Not adjudicated because they are being REMOVED

`.claude/commands/warp/*.md` (70) and the check shims (70 compat, 0 root occurrences) are deleted by the alias
lane. They are accounted **REMOVED**, a disposition distinct from FIXED, and their count is emitted separately
so the close does not imply occurrences were repaired.

## What this reading does NOT do

It does not read individual lines. Entry-level admission is evidence toward the property, and for the four
instrument entries the function test is decisive at entry grain because the file's whole purpose is the
mapping. For everything else, and unconditionally for the three entries above, the per-file reading stands.
