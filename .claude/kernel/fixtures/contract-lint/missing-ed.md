# Missing-ED Fixture

## §1 — A single policy block deferring to a nonexistent ED

#### P1.1 — A block deferring to an ED that was never logged

This block exists purely to exercise contract-lint's ledger cross-check. The ED it cites has never
been written to `.claude/project/memory/enforcement-debt.jsonl`.

Deferred: ED-999999 @ Phase-9-exit
