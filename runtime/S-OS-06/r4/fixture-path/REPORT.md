# S-OS-06 r4: fixture-path REPORT (backend-fixer, branch `s-os-06/r4-fixture-path`, cut from `1e06b991`)

Commits: `e01ca6b6` stub · `40f89e79` RED evidence + harness · `eb2f010a` **the fix** · `8036c9f8` GREEN evidence · `52e4e7e4` control script · later commits add the control results and this report.

## 1. RED under forced contention (test at `1e06b991`, unchanged)

Harness: `runtime/S-OS-06/r4/fixture-path/contention.js` (committed). Capture: `red-1e06b991-both.txt`.
(Its `head` field reads `e01ca6b6`, which is `1e06b991` plus the report stub only. The test file was byte-identical.)

- **HOLD (deterministic):** a holder process is started with its **cwd = `runtime/S-OS-06/fixture-product`**. On Windows a process cwd is an open directory handle, so the directory can't be removed or replaced. Then `node --test --test-reporter=tap tests/regression/S-OS-06/migration.test.js` runs once.
  Result: **exit 1, `# tests 1 / pass 0 / fail 1`**, dies at load:
  `Error: EPERM: operation not permitted, rename '…\runtime\S-OS-06\fixture-product.tmp-45644' -> '…\runtime\S-OS-06\fixture-product'`
  at `renameSync` ← `materializeFixture (migration.test.js:251:6)` ← module scope `(migration.test.js:257:14)`, `syscall: 'rename'`, `errno: -4048`.
- **CONCURRENT (second shape):** 4 simultaneous loads of the file, no holder. **3 of 4 died at load**:
  - 2 with the same `EPERM … rename … fixture-product.tmp-<pid> -> fixture-product`
  - 1 with `ENOENT … open '…\fixture-product\.warpos\transactions\active.lock'`, because one run's `rmrf(FIXTURE_DIR)` removed a shared fixture another run was reading. That is a second failure mode of the same shared path.
  - 1 of 4 was green (5/5).
- The old code also leaves `fixture-product.tmp-<pid>` directories behind after a failed rename. Three were left and I removed them.

## 2. The fix (`eb2f010a`, `tests/regression/S-OS-06/migration.test.js` only)

`materializeFixture()` now does three things:
1. It runs `fs.mkdirSync(runtime/S-OS-06/fixture-product, {recursive:true})`.
2. It calls `fs.mkdtempSync(<that>/run-<pid>-)`, which creates an atomic, process-unique directory.
3. It writes the seed there and checks that the directory holds exactly the seed.

It never renames and never removes a shared path. `FIXTURE_DIR` is now this run's own directory. A top-level `test.after` removes only this run's copy, so runs don't pile up.

Unchanged:
- the five cases
- `fixtureSeed()` bytes, including the `_fixture` label string that names `FIXTURE_REL`
- `compose()`

The header comment was updated to match.

**Downstream readers of the fixed path (checked before fixing):** no code reads `runtime/S-OS-06/fixture-product` (repo-wide grep). Only documents name it:
- PRD R-4
- trace TR-4
- AC-6.1
- plan-contract PC-20260913-0090
- TRACKER/epic
- lane reports

They say the fixture is copied "into runtime/S-OS-06/fixture-product/". The fix keeps that directory as the fixture's home and gives each run its own subdirectory under it, so the documents stay true and no document or contract was edited. **Stated for review:** there is now one extra path level, and the evidence copy is removed at the end of a run instead of being left in place. No reader depended on it being left.

## 3. GREEN under the SAME forced contention (at `eb2f010a`)

Same harness, same holder cwd, same 4-way concurrency. Capture: `green-fix-both.txt` (`head: eb2f010a`).
- **HOLD:** **exit 0, `# tests 5 / pass 5 / fail 0`**, no errno lines.
- **CONCURRENT:** **4 of 4 exit 0, `tests 5 / fail 0`**, no errno lines.
- Afterwards `runtime/S-OS-06/fixture-product/` is empty: every run cleaned up only its own copy.

Standalone at the fix: `node --test tests/regression/S-OS-06/migration.test.js` exit 0, tests 5 / pass 5 (`standalone.txt`).

## 4. CONTROL, not the proof: three in-suite runs at `52e4e7e4`

This is a CONTROL, not the proof; the proof is §3. Script: `control.sh`. Captures: `control-run{1,2,3}.txt` and `control-summary.txt`.

| run | runner exit | discovered | primary files | **population (`tests`)** | pass | fail | skipped | quarantine |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 401 | 379 | **1260** | 1257 | 0 | 3 | 22/22 still failing |
| 2 | 0 | 401 | 379 | **1260** | 1257 | 0 | 3 | 22/22 still failing |
| 3 | 0 | 401 | 379 | **1260** | 1257 | 0 | 3 | 22/22 still failing |

- The population is stable at **1260** across all three runs, and the discovery count is stable at 401.
- 1260 is this head's population. The 1245/1249 figures came from an earlier head, `8b3ad24b`.
- Three greens are consistent with the fix, but on their own they don't prove it (about 30% odds under the untouched bug).

**Verify (each its own command, real exit code, at the fix):**
- `node --test tests/regression/S-OS-06/migration.test.js`: **exit 0** (tests 5 / pass 5 / fail 0; `verify-migration.txt`)
- `node scripts/checks/framework-purity.js`: **exit 0** (`verify-purity.txt`)
- `node scripts/checks/cutover-completeness.js`: **exit 0** (`verify-cutover.txt`)

## 5. Second task: the last unit of 1245 vs 1249

**Which line, which counter.** `scripts/checks/run-tests.js`:
- `counts()`, **lines 668-674**: the regex at line 670, `^(?:ℹ|#) (tests|pass|fail|…) (\d+)`, keeps the last value of each counter from a batch's TAP output.
- **line 833** adds each batch into **`primaryCounts.tests`**.
- **line 928** prints it as the population.

The runner adds nothing of its own. It passes through node's own `# tests N` summary. It doesn't double-count: per batch there is one summary and `c[m[1]] = …` overwrites.

**Where the fourth unit comes from, measured.** When a file dies at load, node's test runner creates one file-level test for it (`# Subtest: <file>` then `not ok N - <file>`, `failureType: testCodeFailure`, `exitCode: 1`, `error: 'test failed'`), and **that test counts in `# tests`**.
- **Real file (RED hold capture):** a load-death reports `# tests 1`, against `# tests 5` when healthy.
- **Batch shape (`healthy.txt` / `dead.txt`):** a throwaway two-file batch in the OS temp dir. File a has 5 passing tests; file b has 5 tests and dies at load when `DIE=1`.
  - Healthy batch: **`# tests 10`**.
  - Batch where b dies: **`# tests 6 / pass 5 / fail 1`**.
  - Delta **4**: the dead file's 5 cases vanish (−5) and one file-level test is added (+1).
  - The dead file is named on two TAP lines, `# Subtest: t\\b.test.js` (line 52) and `not ok 2 - t\\b.test.js` (line 53). That is the "file-level failure prints twice".

So 1249 − 5 + 1 = **1245**, which accounts for the unit.

**Discriminator: (a) COUNTING artifact.** A load-death is tallied as one file-level test instead of its five cases. The file is discovered and run every time. In the control runs, discovery was 401/401/401 and the population 1260/1260/1260. Nothing measured points to (b).

**Ceiling:** the original 1245-run capture was not found on disk (grep of the worktree and the canonical `runtime/S-OS-06`), so the mechanism is measured on the real file standalone plus a same-mechanism synthetic batch. It was not re-measured on that historical run.

## Anything refused

Nothing refused. Out of scope and not touched:
- the runner's tallying code
- the five cases
- `.github/workflows/**`
- manifests
- the occurrence register
- `.claude/settings.json`
- the documents that name the fixture path
