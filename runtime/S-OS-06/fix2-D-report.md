# S-OS-06 fix2-D — backend-fixer report (ED-434 test quarantine, Lane D)

Branch `open-source/S-OS-06-fix2-D` (worktree `.claude/worktrees/S-OS-06-fix2-D`), base `b68d5cf0`. Node v24.16.0.

## Envelope

- **Commits:** `ad444a91` (runner + falsifier) · `04206dfe` (runner BOM fix) · `95c8646e` (`tests/quarantine.json` + `package.json`) · this report
- **`node scripts/checks/run-tests.js`: exit 0**, 67 s (CI-like env: `CLAUDE_PROJECT_DIR` unset)
  - primary: 372 files, 2 batches, 1183 tests, 1180 pass, 0 fail, 3 skipped
  - quarantine: 25 entries, 25 still failing, 0 unexpectedly passed, 0 missing
- **Quarantine:** 25 files. All are verified as pre-existing rot: each fails identically on the pre-sprint base `669aadc1`.
- **Falsifier:** `falsify-quarantine-runner.test.js` passes 6/6.
  - Cases (a) passing→non-zero, (b) failing→0, (c) missing→non-zero, plus (d) primary-propagation control and (e) malformed fail-closed.
  - Mutation-proven: with the teeth disabled, (a) goes red.
- **`package.json`:** `"test": "node scripts/checks/run-tests.js"`, a one-line diff.
- **Not quarantined:**
  - Passing now: `cutover-completeness`, `framework-purity-gate`, `record-trust-exit`.
  - `doc-ref-integrity` passes in a clean checkout. It is red only when `CLAUDE_PROJECT_DIR` points at a checkout holding the untracked archive.
- **Owed by the integrator:** regenerate the manifests. `scripts/checks/run-tests.js` is new under the hash-tracked `scripts/**`, and `package.json` changed.

## Commits

| sha | stage |
|---|---|
| `ad444a91` | `scripts/checks/run-tests.js` runner + `tests/regression/S-OS-06/falsify-quarantine-runner.test.js` |
| `04206dfe` | runner: strip a BOM with `charCodeAt(0) === 0xfeff`. The Write tool had turned the `﻿` regex escape into an invisible literal U+FEFF in the source. |
| `95c8646e` | `tests/quarantine.json` (25 entries) + `package.json` `scripts.test` → the runner |
| (report commit) | this report |

## What was built

**`scripts/checks/run-tests.js`**
- **Discovery.** Uses `git ls-files -z --cached --others --exclude-standard -- scripts tests`, keeps paths matching `^(scripts|tests)/…*.test.js$`, and drops tracked files that were deleted on disk. That gives tracked files plus untracked files that are not ignored. A gitignored local file never runs; a new test runs before its first commit. No new dependency.
  - Git's repo-locating env vars (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, …) are stripped for this call.
  - 397 files are discovered: the 396 tracked before this lane, plus the new falsifier.
- **Subtraction.** Removes the `entries[].file` set from `tests/quarantine.json` (override with `--quarantine`; `--root` for fixtures). The artifact is validated fail-closed:
  - it must parse as JSON and have an `entries` array;
  - each entry needs all five fields as non-empty strings;
  - `file` must be a `scripts/**` or `tests/**` `*.test.js` path, with no `..` and no duplicates.
- **Primary run.** `node --test <remaining>` in batches of ≤12,000 argv chars. The full list is 21.4k chars, too close to the 32,767 Windows CreateProcess limit, so it runs as 2 batches. Output is streamed through. The first failing batch's exit code becomes the runner's exit code.
- **Teeth.** Each quarantined file runs **alone**, in sequence (`node --test <file>`), so interference from other files can't keep a healed test looking red. The runner exits non-zero when any of these happens:
  - `UNEXPECTEDLY PASSED`: a quarantined file exits 0;
  - `MISSING`: a listed file is not on disk;
  - `NOT DISCOVERED`: a listed file exists but git ignores it;
  - `UNOBSERVED`: a spawn error, timeout, kill or null exit.
- **Fail-closed.** Each of these is a FAILURE: a git error, a malformed artifact, zero primary files, a spawn error, a timeout (30 min per batch, 10 min per quarantined file), or a kill.
- **Env.** `NODE_TEST_CONTEXT` is stripped for children.
- **Exit code.** 0 only when the primary run is green AND every entry is valid and still failing. Otherwise it is the primary run's exit code, or 1.
- **Scope note.** The runner does not re-match `firstFailingAssertion` against live output. Several recorded lines contain volatile detail (counts, truncated JSON, temp dirs), so exact matching would make CI brittle. The field is the record; the teeth are pass or missing, per the brief.

**`tests/regression/S-OS-06/falsify-quarantine-runner.test.js`** (`FALSIFIER_ID = "QUARANTINE-RUNNER"`, unique; `record-trust-exit.js` item 1 discovers `falsify-*`, and the `record-trust-exit-runs` wrapper stayed green in the full run)
- Every case uses a temp `git init` repo with dummy tests and a stub `tests/quarantine.json`, and runs the real runner with `--root <tmp>`. A final test byte-compares the real `tests/quarantine.json` to show nothing touched it.
- (a) A passing quarantined dummy → non-zero, `UNEXPECTEDLY PASSED` names it, and the primary exit is 0, so the red comes from the teeth.
- (b) A failing quarantined dummy → exit 0, reported "still fails (exit 1)".
- (c) A listed quarantine file that is missing → non-zero, `MISSING` names it.
- (d) Control: the same failing dummy, not quarantined → exit 1 (the primary exit is propagated).
- (e) Malformed JSON, or an entry missing its fields → non-zero.
- A spawn error, timeout or kill of the runner fails the test.
- **Result:** 6/6 pass standalone (`node --test tests/regression/S-OS-06/falsify-quarantine-runner.test.js`, exit 0), and it is green inside the full runner run.
- **Mutation proof.** I disabled the teeth with `r.status === 0` → `r.status === -999`. Case (a) went RED (`pass 5 / fail 1`, exit 1). I then restored the file with `git checkout`; the tree was clean.

## Candidate verification (every candidate run standalone, `node --test <file>` from the worktree root)

Environment note: this session exports `CLAUDE_PROJECT_DIR` = the **main** checkout. So every candidate was re-run with it **unset**, which matches CI. The quarantine records the CI-like run.

**NOT quarantined — pass now (verified exit 0, CI-like env):**
- `scripts/checks/cutover-completeness.test.js` — the sprint fixed it.
- `scripts/checks/framework-purity-gate.test.js` — the sprint fixed it.
- `tests/regression/S-OS-06/record-trust-exit.test.js` — the sprint fixed it. It no longer dirties the committed ledger; the tracked tree was clean after the full run.
- `scripts/checks/doc-ref-integrity.test.js`:
  - With `CLAUDE_PROJECT_DIR` = the main checkout it FAILS (`canon has 2 broken ref(s)` in `…/beta/mined/judgement-model-recommendations-archive.md`). The scan reads the main checkout, where that gitignored untracked file exists.
  - The file is **absent** from this worktree. With `CLAUDE_PROJECT_DIR` unset it is **16/16 pass, exit 0**.
  - Confirmed: it passes in a clean checkout. **Local caveat:** a session that exports `CLAUDE_PROJECT_DIR` to a checkout holding that archive will see this file red under `npm test`. That is environment, not rot.

**Quarantined — 25 files.** Each one:
- fails standalone on this tree (CI-like env);
- fails **identically on the pre-sprint base `669aadc1`** (the `origin/main` merge-base; the S-OS-06 mint `44c19479` is its first child). I checked this in a throwaway detached worktree, since removed, with the 4 `tests/mc/*` files mapped to their pre-rename directory. The only difference: `wrapper-door`'s failing label names the pre-rename env var instead of `MC_SHAPE_DOOR`, with the same VIOLATION.

So no quarantined failure is caused by this sprint. No candidate was flagged as sprint-caused.

| # | file | cause |
|---|---|---|
| 1 | `tests/mc/dispatch-readiness.test.js` | dangling-ref-allowlist-populated |
| 2 | `tests/mc/lib/provider-autofix.unit.test.js` | adr-0007-cutover-path |
| 3 | `tests/mc/lib/provider-rca.unit.test.js` | adr-0007-cutover-path |
| 4 | `tests/mc/product-bootstrap.unit.test.js` | removed-module |
| 5 | `tests/mc/provider-smoke.unit.test.js` | provider-catalog-contract-drift |
| 6 | `tests/regression/S-LC-06/coverage-gate-caller.test.js` | coverage-ledger-contract-drift |
| 7 | `tests/regression/S-LC-06/mode-profile.test.js` | dispatch-lane-change |
| 8 | `tests/regression/S-LC-07/spend-ledger.test.js` | spend-pricing-contract-drift |
| 9 | `tests/regression/S-PF-01/scaffold-coverage-telemetry.test.js` | scaffold-template-drift |
| 10 | `tests/regression/S-PF-03/admin-surface.test.js` | scaffold-template-drift |
| 11 | `tests/regression/S-PF-04/founders-checklist.test.js` | scaffold-template-drift |
| 12 | `tests/regression/SP-20260518-007/docs-and-skill-bodies.test.js` | adr-0007-cutover-path |
| 13 | `tests/regression/SP-20260518-008/hooks-and-diagnostics.test.js` | settings-hook-order-drift |
| 14 | `tests/regression/SP-20260611-001/epsilon-spawn-grace.test.js` | dispatch-lane-change |
| 15 | `tests/regression/SP-20260611-001/review-fallback-shape.test.js` | dispatch-lane-change |
| 16 | `tests/regression/SP-20260611-001/sprint-id-correlation.test.js` | dispatch-lane-change |
| 17 | `tests/regression/SP-20260611-001/window-clamp.test.js` | dispatch-lane-change |
| 18 | `tests/regression/SP-20260611-002/coverage-gate-scan-live-cli.test.js` | coverage-gate-contract-drift |
| 19 | `tests/regression/SP-20260611-002/coverage-gate-scan-source.test.js` | coverage-gate-contract-drift |
| 20 | `tests/regression/SP-20260611-002/wrapper-mode-binding.test.js` | dispatch-lane-change |
| 21 | `tests/regression/SP-20260615-001/registry-seed-resolves.test.js` | panel-registry-opener-changed |
| 22 | `tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js` | open-gaps-register-path-drift |
| 23 | `tests/regression/SP-20260615-001/roadmap-board-render.test.js` | open-gaps-register-path-drift |
| 24 | `tests/regression/SP-20260616-001/wrapper-door.test.js` | dispatch-lane-change |
| 25 | `tests/regression/SP-20260627-001/negative-fixtures.test.js` | dispatch-lane-change |

The verbatim first failing assertion for each file is in `tests/quarantine.json`. The absolute repo root is written `<repo>` and the OS temp dir `<tmp>`, so no machine path is committed; the legacy slug does not appear.

**Cause labels.** The three canonical labels (`adr-0007-cutover-path`, `removed-module`, `dispatch-lane-change`) are backed by the failure text:
- a missing `00-alex/.system` path;
- a missing `scripts/product/bootstrap.js`;
- dispatch-contract lane/class/mode VIOLATIONs, or a `claude_pinned_reviewer` reclass.

The `*-drift` / `*-changed` labels are best-effort `<other>` descriptions read from the failure text. They are **not** root-caused; S-OS-08 owns the diagnosis.

## Runner run — full numbers

`env -u NODE_TEST_CONTEXT -u CLAUDE_PROJECT_DIR node scripts/checks/run-tests.js` → **exit 0**, 67 s:

| stage | files | tests | pass | fail | cancelled | skipped |
|---|---|---|---|---|---|---|
| primary batch 1 | 232 | 913 | 910 | 0 | 0 | 3 |
| primary batch 2 | 140 | 270 | 270 | 0 | 0 | 0 |
| **primary total** | **372** | **1183** | **1180** | **0** | **0** | **3** |
| quarantine (each file alone) | 25 | — | 0 unexpectedly passed | 25 still failing | 0 unobserved | 0 missing |

Final line: `run-tests: PASS — primary: 372 file(s) in 2 batch(es), exit 0 (tests 1183, pass 1180, fail 0, cancelled 0, skipped 3, todo 0) · quarantine: 25 entries, 25 still failing, 0 unexpectedly passed, 0 missing/undiscovered, 0 unobserved`

Afterwards the tracked tree was clean apart from my own `package.json` change, which was then committed.

## ED-434 note (append)

ED-434 intent is delivered. `npm test` now runs the FULL `scripts/**` + `tests/**` `*.test.js` glob through `scripts/checks/run-tests.js`.
- **25 pre-existing rotted files** are quarantined in `tests/quarantine.json`, each with `filedUnder: "ED-434"` and `expiry: "S-OS-08 (test-rot cleanup sprint)"`.
- The quarantine polices itself. A quarantined file that starts passing, or disappears, turns `npm test` red until its entry is removed, so the list can only shrink truthfully.
- **Enforcer:** `run-tests.js` teeth, falsified by `falsify-quarantine-runner.test.js`.
- **Expiry enforcement is behavioral.** No gate checks that S-OS-08 actually drains the list. The lead may want an enforcement-debt entry, or an S-OS-08 DoD line ("`tests/quarantine.json` entries = 0").

## Notes for the lead / integrator

1. **Manifest regen owed:** new `scripts/checks/run-tests.js` (hash-tracked `scripts/**`) + `package.json`. Run the manifest triple before landing. Not run here; it is outside scope.
2. **No build/typecheck step exists** in this repo (`package.json` has no `build` script; no TypeScript). Verification is the runner run + falsifier above.
3. **`.github/workflows/` untouched.** CI's `npm test` picks up the runner through `package.json`.
4. **Guard note.** A `node -e` script that wrote a file was blocked by the full-file-write guard. I did not work around it:
   - the teeth-disable mutation was made with the Edit tool instead;
   - `tests/quarantine.json` was produced by a script file (`runtime/S-OS-06/fix2-D-probe/gen-quarantine.js`, untracked), as the guard's message recommends, then read back in full.
5. **Tree state.** Probe logs, the base-probe/generator scripts and the full runner log are untracked under `runtime/S-OS-06/fix2-D-probe/`. Only this report is added from `runtime/`. The temporary base worktree was removed.
