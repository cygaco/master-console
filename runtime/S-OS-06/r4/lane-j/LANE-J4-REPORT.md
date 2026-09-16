# LANE-J4 REPORT — S-OS-06 r4 lane J4: canonical per-entry expiry on the deferred alias-map member

STATUS: DONE. Falsifier PRESENT (enforcing case shown RED-then-GREEN). Branch `s-os-06/lane-j-scratch-split`.

Commits on top of `420712c1`:
- `bcad48cc` — stub report (reap-survival)
- `44481a6c` — the fix: `scripts/open-source/mc-alias-map.json` + `tests/regression/S-OS-06/alias-map.test.js`
- (this report commit)

## 1. The canonical fields as written (`checkScripts[0]`, `scripts/checks/<legacy>-tracked-transients.js`)

```
"filedUnder":    "T-20260913-364",
"expiry":        "operator edit of .github/workflows/leak-gate.yml line 36 to invoke the mc-* check (the per-member trigger), no later than the mc@2.1.0 check-shims compat-window removal",
"expiryVersion": "2.1.0",
```
Kept verbatim as extra fields (the human record): `trigger`, `removeWhen`, `warrant`. Added `expiryVersionWarrant`.
Dropped the made-up fields `kind`, `notBefore: null` and `supersedesTopLevelRemoveIn: true`. The reason is in finding A below.

### FINDING A: `supersedesTopLevelRemoveIn: true` was contradicted by a check that already runs
- The partition (`scripts/open-source/rename-mc.denylist.json`) has a `compatWindows` entry `{surface: "check-shims", expires: "2.1.0", members: [<this shim>]}`. This shim is its only member.
- `scripts/open-source/partition-loader.js` `isCompatExpired` fails when the tree version is at or past the window's `expires` (`framework-purity`, F10). Today's cutover output: `compat clock: package.json 2.0.0`, `compat-expired=0`.
- So this member already had a version expiry of 2.1.0 that a check enforces, which contradicts the old claim that its expiry is not the top-level `removeIn`. That makes `expiryVersion` **2.1.0 a measured value, not a choice**. Any later version would contradict the partition window. Changing the window is a partition edit, which is out of scope.
- Meaning: the workflow-edit trigger is the removal event, and 2.1.0 is the enforced backstop. If the operator's `leak-gate.yml:36` edit hasn't landed by mc@2.1.0, both `framework-purity` and `alias-map.test.js` fail. The only way past is to re-justify the window through an F8 partition amendment. The deferral decision itself is not reopened.

### FINDING B: `filedUnder` is a ticket id, not an ED id
No ED id governs this deferral anywhere in the tree, and the enforcement-debt register isn't in this worktree. Rather than invent an ED number, I filed it under `T-20260913-364`, the ticket that registered the `check-shims` compat window (it appears in the denylist warrants). If the conductor wants an ED id, it is a one-string change. The test only requires a non-empty string, the same as `run-tests.js`.

## 2. The enforcing case (in `tests/regression/S-OS-06/alias-map.test.js`)
It mirrors `scripts/checks/run-tests.js` EXPIRED and `falsify-quarantine-runner.test.js` case (h): same semver grammar, same `semverGte`, same clock (`package.json#version`), same rule (tree >= expiryVersion means EXPIRED, including equal).
- **Real map:** every `checkScripts` member carries non-empty `filedUnder`/`expiry`/`expiryVersion`, `expiryVersion` is a semver, and the member is NOT expired. It fails safe if the tree version can't be read, and the member set must be non-empty so the check can't pass vacuously.
- **Cross-check:** a member's `expiryVersion` may not be later than the partition compat window that registers it. This stops the two expiry clocks from drifting apart.
- **Built-in falsifier (runs every time):** a planted entry whose `expiryVersion` equals the tree version must produce exactly one `EXPIRED:` violation. So must an `expiryVersion` of 0.0.1. Removing each of the three fields must produce a violation, and a null tree version must fail.

### RED-then-GREEN against the REAL map file (each run on its own, real exit code)
| run | state | rc | evidence |
|---|---|---|---|
| GREEN | committed `44481a6c`, real entry `expiryVersion 2.1.0`, tree 2.0.0 | **0** | tests 8 / pass 8 / fail 0 |
| RED | real map with `expiryVersion` changed to `2.0.0` (uncommitted), tree 2.0.0 | **1** | pass 7 / fail 1; `EXPIRED: scripts/checks/<legacy>-tracked-transients.js alias expired at 2.0.0 (tree 2.0.0) — remove the member or re-warrant [T-20260913-364, ...]` |
| GREEN | planted change reverted with `git checkout --`, tree 2.0.0 | **0** | tests 8 / pass 8 / fail 0 |

### REFUSED / NOT DONE
- I also tried moving the tree clock to 2.1.0 (editing `package.json` `version`) with the real entry. **The dependency-admission-guard hook refused the edit and failed safe.** I did not work around it. The run after it exited 0, but the tree was still at 2.0.0, so **that run proves nothing and is not counted.** The equal-version case is still covered by the RED row above (same comparison) and by the built-in falsifier.

## 3. Which commit, and what the teeth said
- The change is in its **own new commit `44481a6c` on top of `420712c1`**. It touches only `scripts/open-source/mc-alias-map.json` and the test, not `rename-mc.denylist.json`, and adds or removes no partition keys.
- F8 only restricts commits that add or remove partition keys (those must touch only the partition, carry the marker, and record the amendment). This commit is not a partition commit, so F8 has nothing to judge. Folding it into partition-only `420712c1` would break that commit's partition-only property. Folding it into `a097eec9` would mean rewriting history under the conductor's landing.
- What the teeth said at `44481a6c`: cutover-completeness `F8: frozen at a851490acc04; 224 amendment(s) on record; history swept: 15 post-freeze partition commit(s) — 11 adding 221 key(s), 5 removing 46 key(s), every one judged for marker + partition-only + amendment record`. That is still 15 partition commits, so mine was correctly not classed as one, and nothing was rejected. `live-unallowed=0 (compat-expired=0)`.

## 4. Gate exit codes (at `44481a6c`, each its own command)
- `node scripts/checks/cutover-completeness.js` → **rc 0**
- `node scripts/checks/framework-purity.js` → **rc 0** (`result: OK (exit 0)`)
- `node --test tests/regression/S-OS-06/alias-map.test.js` → **rc 0** (8/8)

## 5. Out of scope, untouched
`.github/workflows/**` (the trigger is an operator-only edit and was only named here), manifest regeneration (note: `scripts/open-source/mc-alias-map.json` is under `scripts/**`, so the manifest may be stale, as it already was after `a097eec9`), the occurrence register, `.claude/settings.json`, the 15 removals, and the partition.
