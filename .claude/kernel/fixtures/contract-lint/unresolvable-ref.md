# Unresolvable-Ref Fixture

## §1 — A single policy block whose Enforcer does not resolve

#### P1.1 — A block with a dangling reference

This block exists purely to exercise contract-lint's reference-resolution check. Its trailer names a
script that does not exist anywhere on disk.

Enforcer: scripts/checks/does-not-exist-xyz-fixture.js
