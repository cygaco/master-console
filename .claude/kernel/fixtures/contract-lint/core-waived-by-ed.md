# Core-Waived-By-ED Fixture

## §7 — A CORE invariant that has been (incorrectly) given an ED escape hatch

#### P7.1 — CORE-1: unbound dispatch fails closed

**core_id:** CORE-1
**waivable:** false

This block is tagged as a CORE invariant (core_id + waivable:false) but its trailer is a `Deferred:`
ED reference instead of `Core: non-waivable`. A real, existing ED is cited so the ONLY
violation this fixture exercises is the CORE-waived-by-ED content rule — not a missing-ED or
unresolvable-ref structural failure. This must fail as a POLICY violation (exit 1), distinct from the
structural exit-2 cases (malformed / unresolvable-ref / missing-ed).

Deferred: ED-999060 @ Phase-1-exit
