# LANE J5 REPORT — route alias-map.test.js partition read through partition-loader.js

STATUS: DONE. Both guards rc 0. The loader is unchanged. Nothing refused.

- Base: `9e1c06a1` on `s-os-06/lane-j-scratch-split`
- Stub: `63b525f2` · Fix: `b9374ad8` · This report: the commit after `b9374ad8`
- Files touched: `tests/regression/S-OS-06/alias-map.test.js` (+3/−1). No other file changed.

## Premise check (measured before any edit, at `63b525f2`)

| Command | rc | Result |
|---|---|---|
| `node --test tests/regression/S-OS-06/partition-single-loader.test.js` | **1** | exactly one offender: `tests/regression/S-OS-06/alias-map.test.js` line 133, `const partition = JSON.parse(read("scripts/open-source/rename-mc.denylist.json"));` |
| `node --test tests/regression/S-OS-06/alias-map.test.js` | 0 | 8/8 |

The premise holds. I did not re-measure the attribution to `44481a6c`, but it matches my own J4 commit, which added that case.

## The reroute, as written

```diff
 const RENAME_MC = require(path.join(ROOT, "scripts", "open-source", "rename-mc.js"));
+// The partition is consumed ONLY through its one routed loader (single-loader guard, partition-single-loader.test.js).
+const { loadPartition } = require(path.join(ROOT, "scripts", "open-source", "partition-loader.js"));
 ...
 test("alias map: a deferred member's expiryVersion does not outlive the partition compat window that registers it", () => {
-  const partition = JSON.parse(read("scripts/open-source/rename-mc.denylist.json"));
+  const partition = loadPartition({ forceReload: true });
   const windows = Array.isArray(partition.compatWindows) ? partition.compatWindows : [];
```

The shape matches existing sanctioned consumers. I did not add a new entry point:
- `require(path.join(ROOT, "scripts", "open-source", "partition-loader.js"))` + `loadPartition({ forceReload: true })`: the same form `tests/regression/S-OS-06/partition-total.test.js:18,33` and `occurrence-ledger.test.js:18,33` use (and the gates use `loader.loadPartition({ forceReload: true })`).
- `.compatWindows` was already part of the API that `buildPartition` returns (`partition-loader.js:1376`). It is the same field `scripts/checks/doc-ref-integrity.js:95` reads. **The loader already exposes what the enforcing case needs, so its surface is unchanged.**

## Enforcing case re-shown RED-then-GREEN (after the reroute)

Tree version (package.json) is `2.0.0`. The one deferred member is `scripts/checks/warpos-tracked-transients.js`, with `expiryVersion 2.1.0`. `loadPartition().compatWindows` shows it registered under `check-shims@2.1.0`. I made each plant as an uncommitted working-copy edit of `scripts/open-source/mc-alias-map.json` and reverted it with `git checkout --`. After each revert, `git diff --stat` on that file was empty.

**RED 1: past-expiry (the J4 falsifier):** `expiryVersion 2.1.0 → 1.9.0`
- `node --test tests/regression/S-OS-06/alias-map.test.js` → **rc 1**, 7 pass / **1 fail**
- Failing case: `every deferred check-script member carries filedUnder/expiry/expiryVersion and is NOT past its expiry`
- `actual:` array has **exactly 1 element**: `EXPIRED: scripts/checks/warpos-tracked-transients.js alias expired at 1.9.0 (tree 2.0.0) — remove the member or re-warrant [T-20260913-364, …]`. The output shows that string 3 times, but the other 2 are the reporter repeating it in the message and the diff. I counted the elements on the `actual:` line: 1.

**RED 2: the REROUTED case itself (added, not required by the brief):** `expiryVersion 2.1.0 → 2.2.0`
- → **rc 1**, 7 pass / **1 fail**. The failing case is `a deferred member's expiryVersion does not outlive the partition compat window that registers it`: `expiryVersion 2.2.0 outlives its enforced compat window check-shims@2.1.0`.
- This shows the rerouted read is live, not vacuous. The `check-shims@2.1.0` in that message came through `loadPartition()`.

**GREEN (reverted):** `node --test tests/regression/S-OS-06/alias-map.test.js` → **rc 0**, 8/8.

## Both guards: final, each run as its own command with its real exit code

| Command | rc | Result |
|---|---|---|
| `node --test tests/regression/S-OS-06/partition-single-loader.test.js` | **0** | 3/3 pass; `findUnroutedReaders()` → `[]` (no un-routed readers) |
| `node --test tests/regression/S-OS-06/alias-map.test.js` | **0** | 8/8 pass |

## Refused / out of scope / notes

- Nothing refused. I did not touch `partition-loader.js`, `.github/workflows/**`, the manifests, the occurrence register, `.claude/settings.json`, or the removals/deferral.
- **On an exemption for tests: I'm not arguing for one.** The guard is right to cover tests. A test that parses the artifact on its own could drift from the loader's fail-closed parsing (BOM strip, `$question` header, section-array checks), and the loader also serves this case without any change.
- I did not re-run the full S-OS-06 suite or `record-trust-exit.js`. Both guards above pass, and `record-trust-exit.js` item 2 calls the same `findUnroutedReaders()`, which now returns `[]`.
- Time: well inside the 15-minute box.
