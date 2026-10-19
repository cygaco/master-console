# Main-write broker seams A–E

Code comments in the trusted layer name its connection points by letter: Seam A, B, D and E appear in the
code, and Seam C completes the set. The trusted layer is the part of MC that alone may integrate work into a
protected ref (`refs/heads/main`). Each seam is one interface between two of its components. The trust
boundary these seams implement, and its honest limits, are stated in
`.claude/kernel/top-level-runtime-contract.md` §1 (P1.2).

## Seam A — controller → acceptance record

`scripts/dispatch/trusted-controller.js` builds the AcceptanceRecord through
`scripts/dispatch/acceptance-record.js` (`produce`) over commit and tree hashes it computed itself, checks
it (`authorizesIntegration`), and writes the integration into the protected ref (`commitIntegration`, an
atomic `git update-ref <ref> <new> <expected>`). It never adopts a caller's self-reported verdict. The
controller's other sanctioned writes are its brokered transport entrypoints (`integrateBranchMerge`,
`integrateReleaseCommit`), which go through its fenced ref updater (`fencedRefUpdate`).

## Seam B — controller → pinned check bundle

The controller loads the pinned checker bundle through `scripts/dispatch/pinned-checker-bundle.js` and runs
its frozen check suite against the candidate in a fresh, nonce-bound run outside the working tree. It never
requires the check-lib source directly. This pinned run is the authoritative gate.

## Seam C — helm-runner → controller

`scripts/dispatch/helm-runner.js` reaches integration only through the controller's `integrate()`, never
through `produce`, `authorizesIntegration` or `commitIntegration` directly.

## Seam D — one check-lib, three consumers

`scripts/dispatch/check-lib/` is the single check library:

- consumer a: the Claude Code hook `scripts/hooks/check-lib-prevention.js` requires it;
- consumer b: the git pre-commit hook `scripts/hooks/pre-commit-check-lib.js` requires it for fast,
  non-authoritative local feedback — `git commit --no-verify` skips it, which is harmless because it decides nothing;
- consumer c: the controller uses the pinned copy, through Seam B.

`scripts/checks/check-lib-single-source.js` looks for functions or variables named after the library's checks
in the JavaScript under `scripts/` and `.claude/` (outside the library, minus its named exemptions) and fails if
it finds one.

## Seam E — the sole-route fence

`scripts/hooks/protected-ref-transaction.js` is a git `reference-transaction` hook, installed by
`scripts/install-git-hooks.sh`. It refuses any write to a protected ref that does not carry the controller's
current fencing token, which the controller sets only around its own writes (`commitIntegration` and the
fenced ref updater). It covers update-ref, merge, push and fast-forward, and `--no-verify` does not bypass
it. `scripts/checks/main-write-broker-completeness.js` scans `scripts/**` and `.claude/commands/**` for
main-write call sites and asserts that each one it recognizes is brokered, migrated or allowlisted (a static
scan with named blind spots); its first green run is the trigger for arming the fence.

Outside the fence's promise, because each needs local shell access and intent: a `core.hooksPath` redirect,
deleting the hook, writing `.git/refs` directly, and forging the fencing token.
