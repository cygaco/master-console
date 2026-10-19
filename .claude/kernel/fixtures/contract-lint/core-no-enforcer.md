# Core-No-Enforcer Fixture

## §7 — A CORE invariant with no enforcer named (aspirational)

#### P7.1 — CORE-1: unbound dispatch fails closed (no enforcer named)

**core_id:** CORE-1
**waivable:** false

This block is correctly tagged as a CORE invariant (core_id + waivable:false) and correctly uses the
`Core: non-waivable` trailer (not waived) -- but it names NO `Enforcer:` ref at all. A
non-waivable invariant with nothing enforcing its substance is an aspirational
false-green in a BINDING register; this must fail as a POLICY violation (exit 1), distinct from
core-waived (which flags the WRONG trailer kind) and from the structural exit-2 cases.

Core: non-waivable
