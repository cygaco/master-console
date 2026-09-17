# Why `control-run1..3.txt` are on disk but NOT tracked

`mc-tracked-transients` (ED-417) refuses transcript-like text over 204800 bytes under `runtime/`, and each
of these is a FULL suite transcript. Committing them turned `leak-gate` RED at `21236d26` and, downstream,
failed the suite case asserting the live tree passes the gate. The check named all three files and stated
the remedy itself.

**Nothing is lost.** `control-summary.txt` is tracked and carries what the runs actually established: three
consecutive in-suite runs at `52e4e7e4`, all exit 0, population **1260 / 1260 / 1260**, quarantine 22 of 22
still failing with none unexpectedly passing, and zero lines mentioning the migration test in any run. The
transcripts are regenerable by re-running the suite.

**This is the FOURTH instance of one pattern this round:** the round's own evidence artifacts break the gates
that measure the round. First a quarantine copy carrying a legacy identifier, then lane K5's machine output,
then lane I's two suite captures, now these three transcripts. Each was untracked or reshaped rather than
allow-listed, because an allowlist entry would make the next one invisible.

The reusable remedy is lane C's shape at `f490592e`: committed evidence carries the numbers, never the raw
stream; the raw form stays local.

ε, 2026-09-17. The check was right; nothing was bypassed or allow-listed.
