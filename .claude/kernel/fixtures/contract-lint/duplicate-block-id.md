# Duplicate-Block-Id Fixture

## §3 — Two blocks sharing the same id (P3.1 declared twice)

#### P3.1 — First declaration of P3.1

This is the FIRST block claiming the id P3.1.

Core: non-waivable

#### P3.1 — Second declaration of the SAME id

This is a SECOND, entirely different block that reuses the SAME id (P3.1) -- an ambiguous,
contradictory contract. A duplicate policy-block id must fail closed (structural, exit 2),
never read clean just because each individual block, in isolation, is well-formed.

Enforcer: scripts/checks/log-sink-caps.js
