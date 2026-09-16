# BUILD BRIEF — S-OS-06 r4, lane J5: route the partition read through the loader

WORKTREE: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-laneJ-split`
**Branch `s-os-06/lane-j-scratch-split`, now at `9e1c06a1`** (the landed sprint head is merged in).

## What happened, stated plainly

Your J4 enforcing case is good work and it is staying. It introduced **one real regression**, and the
project's own guard caught it within minutes of landing — which is the guard working, not a disaster.

`tests/regression/S-OS-06/alias-map.test.js` **line 133**:
```js
const partition = JSON.parse(read("scripts/open-source/rename-mc.denylist.json"));
```

That reads the partition artifact **DIRECTLY**, bypassing `scripts/open-source/partition-loader.js`.
The single-loader guard (`tests/regression/S-OS-06/partition-single-loader.test.js`) exists to make exactly
that impossible, and it now FAILS with:

```
AssertionError: un-routed partition readers: [
  { file: "tests/regression/S-OS-06/alias-map.test.js", line: 133, ... }
]
```

Attribution measured, not guessed: that line is ABSENT at `25bb6541` and present at HEAD, introduced by
commit `44481a6c`. Measured across three in-suite runs at the landed head, it fails in all three. It is
deterministic, not a flake.

## Your work

**0. Write `runtime/S-OS-06/r4/lane-j/LANE-J5-REPORT.md` as a stub and COMMIT it FIRST.**

**1. Route that read through `partition-loader.js`**, the same way the three existing sanctioned consumers
do. Read how they call it and match that shape rather than inventing a new entry point. If the loader does
not expose what your enforcing case needs, **say so and STOP** — do not widen the loader's surface to suit a
test, and do not keep the direct read.

**2. Keep your enforcing case working.** The expiry falsifier you built is the point of J4 and must survive
this change. Re-demonstrate it **RED-then-GREEN** after the reroute, the same way you did before: plant a
past-expiry version, show exactly one EXPIRED violation, revert, show green.

**3. Verify BOTH guards, each as its own command reading its real exit code:**
- `node --test tests/regression/S-OS-06/partition-single-loader.test.js` → must be rc 0 with no un-routed
  readers.
- `node --test tests/regression/S-OS-06/alias-map.test.js` → must be rc 0.
Report both numbers.

## Context you should have

The single-loader guard is the structural enforcer behind the record-trust doctrine: name ONE choke-point and
make un-routed readers fail. A test that reads the partition directly is precisely the un-routed reader the
guard is built to refuse, and it does not get an exemption for being a test. If you believe it should have
one, that is an argument to make in the report, not a change to make in the code.

## Out of scope

`partition-loader.js` itself — you are a CONSUMER of it here, not its author. `.github/workflows/**`,
manifest regeneration, the occurrence register, `.claude/settings.json`, and anything about the 15 removals
or the deferral, all of which are landed and settled.

## TIME BOX — 15 minutes

This is a small, well-located change. If it turns out not to be small, that is a finding: report what makes
it large and STOP.

## Report

The reroute as written; the enforcing case re-shown RED-then-GREEN; both guard exit codes; anything refused.

**If a premise here is false, prove it and STOP.**
