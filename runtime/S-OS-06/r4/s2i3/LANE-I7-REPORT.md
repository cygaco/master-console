# LANE-I7-REPORT — S-OS-06 r4, lane I7: hermetic scrub of the child environment

Ruling: β row 486 (b3f81d47) DECIDE — hermetic scrub. Declared ceiling REFUSED; controlled capture environment REFUSED.
Commits: c6865d81 (stub, first) · ccb628e6 (steps 1-2) · this report (step 3).

## Pre-committed interpretation (verbatim, written BEFORE the run, in c6865d81)

> *"A mismatch under the hermetic set is a FINDING ABOUT THE SCRUB, not a quarantine violation to be waved
> through. If entries move, the scrub changed what the code under test emits, and that is information about
> the register's environment-dependence, not evidence that the tests rotted."*

## 1. Every childEnv() caller (scripts/checks/run-tests.js is the only definition in scope)

- `gitEnv()` → `git()` → discoverTestFiles (ls-files), base-path `cat-file -e`, rename `diff -M50%`, main's base-commit `cat-file -e`; and `materializeBase` (read-tree, checkout-index). So git runs are scrubbed too.
- `runNodeTest()` L~630 spawn, called from: the **primary batches (MAIN spawn, the whole suite)**, the `--verify-base` runs at base, and each quarantined file run alone. β's scope correction holds: the exposure was the whole suite.
- Exported `runNodeTest` is also used by `runtime/.../i6/vacuity-count.js` (a frozen measurement script, not a live caller).
- Not callers: the same-named locals in `safe-spawn.js`, `dispatch-claude.js`, `dispatch-skill.js`, `providers.js`, `portfolio/*.js`, and the private `childEnv` in `tests/regression/S-OS-06/{paths-registry,record-trust-exit}.test.js` are different functions. Out of scope, untouched.

## 2. Measured minimum Windows spawn set — β PREMISE PARTLY FALSE

Probe: `i7/spawn-min-probe.js` → `i7/spawn-min-probe.{json,txt}` (win32, node 24; parent had 81 variables, incl. MC_*, WARPOS_*, CLAUDE_*, tokens).

- **"An empty environment WILL break spawn on Windows" is FALSE as stated.** `env: {}` spawns `node -e`, `node --test` (pass 1) and `git` (version + 4 global config names) fine.
- The reason: **libuv refills 11 names from the parent** into any child whose env block lacks them: `HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR`. The same 11 show up for EMPTY, SYSTEMROOT_ONLY and PATH_ONLY. os.tmpdir and os.homedir give the same values as the parent does.
- So on Windows an "empty" scrub is not achievable. The child always gets those 11. The allow-list direction survives, for a different reason: a declaration that names fewer than those 11 would be false. I did not STOP, because this premise only decides what the list contains. It does not decide whether the scrub can be built.

## 3. The declared allow-list, and where a reader finds it

- `scripts/checks/run-tests.js`: `CHILD_ENV_ALLOWLIST` sits directly above `NORMALIZER_DECLARATION`, with its measured rationale. win32 = exactly the 11 libuv names. other = `HOME, PATH, TMPDIR` (**NOT measured on Linux**: CI will be the first measurement, and I did not touch workflows).
- **It is inside the normalizer's own declaration:** new element `E environment (hermetic, β row 486): …`, generated from the constant, so declared and actual cannot drift. The register must equal it, so `tests/quarantine.json` `$normalizer` gained that one line (text-level insert by `i7/sync-register-normalizer.js`; entries byte-identical, asserted). No entry was re-registered.
- `childEnv(source, platform)` copies only names in the list (case-insensitive) and drops everything else, including NODE_TEST_CONTEXT. Both it and CHILD_ENV_ALLOWLIST are exported.

## 4. RED-then-GREEN

The new falsifier case **(k) HERMETIC SCRUB** is in `tests/regression/S-OS-06/falsify-quarantine-runner.test.js`. A quarantined dummy writes one extra stderr line only when `MC_I7_AMBIENT_STDERR_WRITER` is set in the RUNNER's environment. It is registered with the ordinary cause multiset.
- RED (on the unchanged runner): `i7/RED-k-before-scrub.txt`, exit 1. `QUARANTINE VIOLATION — CAUSE-LOCK … does not equal the registered one`, and the observed lines include `ambient writer: this line depends on the machine`.
- GREEN (after the scrub): `i7/GREEN-k-after-scrub.txt`, exit 0, pass 1, fail 0.
- In-suite: case (k) ran inside the full-suite primary run below (tests 1196→1197).

## 5. The 23-entry re-validation under the hermetic set

Full runner `node scripts/checks/run-tests.js` with ambient MC_/WARPOS_/CLAUDE_ variables present in the parent: `i7/SUITE_hermetic_run.txt`. Per entry: `i7/per-entry-hermetic.txt`.

**COUNT: 23 of 23 still fail (exit 1) with a multiset EQUAL to the register. 0 moved, 0 CAUSE-LOCK violations, 0 unexpectedly passed, 0 unobserved.** Under the pre-committed interpretation, the scrub changed nothing that any registered entry emits in this environment. The result is not evidence that the register is environment-independent in general. It only shows that none of the 23 read a scrubbed variable in a way that shows up in their cause lines here.

| # | entry | hermetic result |
|---|---|---|
| 1 | tests/mc/dispatch-readiness.test.js | still fails, multiset equal |
| 2 | tests/mc/lib/provider-autofix.unit.test.js | still fails, multiset equal |
| 3 | tests/mc/lib/provider-rca.unit.test.js | still fails, multiset equal |
| 4 | tests/mc/product-bootstrap.unit.test.js | still fails, multiset equal |
| 5 | tests/mc/provider-smoke.unit.test.js | still fails, multiset equal |
| 6 | tests/regression/S-LC-06/coverage-gate-caller.test.js | still fails, multiset equal |
| 7 | tests/regression/S-LC-06/mode-profile.test.js | still fails, multiset equal |
| 8 | tests/regression/S-LC-07/spend-ledger.test.js | still fails, multiset equal |
| 9 | tests/regression/S-PF-01/scaffold-coverage-telemetry.test.js | still fails, multiset equal |
| 10 | tests/regression/S-PF-03/admin-surface.test.js | still fails, multiset equal |
| 11 | tests/regression/S-PF-04/founders-checklist.test.js | still fails, multiset equal |
| 12 | tests/regression/SP-20260518-007/docs-and-skill-bodies.test.js | still fails, multiset equal |
| 13 | tests/regression/SP-20260518-008/hooks-and-diagnostics.test.js | still fails, multiset equal |
| 14 | tests/regression/SP-20260611-001/epsilon-spawn-grace.test.js | still fails, multiset equal |
| 15 | tests/regression/SP-20260611-001/review-fallback-shape.test.js | still fails, multiset equal |
| 16 | tests/regression/SP-20260611-001/sprint-id-correlation.test.js | still fails, multiset equal |
| 17 | tests/regression/SP-20260611-001/window-clamp.test.js | still fails, multiset equal |
| 18 | tests/regression/SP-20260611-002/coverage-gate-scan-live-cli.test.js | still fails, multiset equal |
| 19 | tests/regression/SP-20260611-002/coverage-gate-scan-source.test.js | still fails, multiset equal |
| 20 | tests/regression/SP-20260611-002/wrapper-mode-binding.test.js | still fails, multiset equal |
| 21 | tests/regression/SP-20260615-001/registry-seed-resolves.test.js | still fails, multiset equal |
| 22 | tests/regression/SP-20260616-001/wrapper-door.test.js | still fails, multiset equal |
| 23 | tests/regression/SP-20260627-001/negative-fixtures.test.js | still fails, multiset equal |

### Primary run (MAIN spawn) under the hermetic set: a delta I did NOT attribute

- Hermetic: tests 1197, pass 1189, **fail 5**, skipped 3. The I6 ambient run: tests 1196, pass 1188, fail 5, skipped 3. The count is equal. The **set** of top-level failures differs by one swap (`i7/notok.i6.txt` vs `i7/notok.i7.txt`):
  - I6 only: `real betaEvents corpus: 0 structural findings…` (it PASSES under the hermetic run, ok 217).
  - Hermetic only: `live tree: the tracked repository passes (exit 0)` (not ok 173).
  - Common to both: roadmap-board-failsoft, roadmap-board-render, record-trust-exit GREEN (real clean tree), `live tree … default gate`.
- Both swapped tests read live tree or corpus state: the suite dirties the tree while it runs, and the betaEvents corpus changes over time. The capture did not show the failure reason for not ok 173. **I have NOT shown whether the swap comes from the scrub or from the tree state.** It is an open item for the next dispatch, not a clean result.
- Suite side effects undone as in I6: `git restore scripts/open-source/rename-mc.occurrences.json`, plus removal of the untracked `runtime/S-OS-06/{fixture-product/,rename-occurrences.full.json,rename-plan.json}`. None were committed.

## 6. Refused / out of scope

- Lane J dissolving the current writer: not treated as done. The scrub is owed and was built. Case (k) uses a synthetic writer, so it does not depend on any writer still existing.
- COUNT-LOCK silent skip: NOT touched (routed to β).
- Not touched: `.github/workflows/**`, manifest regeneration, `.claude/settings.json`, `partition-loader.js`, the occurrence register (only restored after the suite's own write), and re-registration of the 6 entries.
- The allow-list for platforms other than Windows is declared but unmeasured (I have no Linux here).
- The full falsifier file was not run on its own after the change. Its cases (a)–(k) ran in-suite inside the primary batches. The primary failures listed above do not include the falsifier file.
