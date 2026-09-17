# Why the two lane-I SUITE captures are on disk but NOT tracked

Files: `i6/SUITE_run.txt` (first committed at `f74a7a3e`) and `i7/SUITE_hermetic_run.txt` (first committed at
`21ba435c`). Untracked by lane I8 (α R-73); both left on disk, byte-unchanged.

## What went wrong

`framework-purity` refused both with `promote_relic` ×2: each capture quotes a legacy-slug-prefixed ledger
identifier verbatim (4 occurrences per file). This note deliberately does not reproduce it.

This is the **third instance this round of one pattern** (STOP-CONDITION § 7b): the round's own evidence files
stay INSIDE the population the purity gate sweeps, so evidence that quotes the tokens it measures grows the
population it measures. Instance 1 was the lane C oracle (fixed at `f490592e`). Instance 2 was the lane K5 machine
output (untracked at `f6e50314`). Instance 3 is these two captures.

## Why untrack and not lane C's shape

Lane C's remedy changes an **instrument** so it never renders line text in committed output. These files are
not instrument output. They are the **raw TAP stream** that `node scripts/checks/run-tests.js` wrote while it
ran. No renderer of mine produced them, so lane C's shape has nothing to change. Editing the capture to remove
the token would leave a committed file that claims to be the measured stream but is not: that turns a relic
finding into falsified evidence. Untracking keeps the local bytes exactly as measured, and the hashes below let
anyone check them.

The measurements the lane I6/I7 reports rely on stay TRACKED and purity-clean: `i7/notok.i6.txt`,
`i7/notok.i7.txt`, `i7/per-entry-hermetic.txt`, and the reports themselves.

| file | sha256 | bytes | lines |
|---|---|---|---|
| `i6/SUITE_run.txt` | `c72c4b827052198bce0e9f5dde7ea632f2a5f1ed54c770b35ec0d904b9839100` | 843489 | 11268 |
| `i7/SUITE_hermetic_run.txt` | `67f06629d6262e33d5c3711af32835332122d148f61c8f36bc5ca9586e4c8613` | 844185 | 11275 |

Both files are still in git history at the commits above. Untracking stops them from being swept at HEAD; it does
not remove them from history.

Reproduce: `node scripts/checks/run-tests.js > <file> 2>&1` from the worktree root.

OWED (not in this unit): a capture writer that stores the TAP stream outside the swept tree, or that keeps the
text form local-only and commits only derived counts. Once one exists, suite captures can be tracked again.
