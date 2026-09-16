# LANE-I10-REPORT — retire quarantine entry 23

Branch `s-os-06/s2i-capture`. Base HEAD `e77775f1`. Stub `4b98830f`. Retirement commit `157fc5cc`.
Dispatched role: backend-builder. Isolation checked: cwd is the linked worktree
`.claude/worktrees/S-OS-06-s2i-capture`, not the main root.

## Verdict

- **Entry 23 is retired.** The register goes from **23 to 22** entries. The runner's quarantine line is now
  clean: `22 entries, 22 still failing, 0 unexpectedly passed`.
- **The brief's premise is partly false.** It says `npm test` had exactly one failure. At this head,
  `run-tests.js` still exits 1 because of a second failure: **primary `fail 1`**, in
  `record-trust-exit GREEN`. **My edit did not cause it** (proof in §4).
- That test belongs to the occurrence register, which is out of scope. I did not touch it; see §4.

## 1. The entry retired

- The entry: `tests/regression/SP-20260627-001/negative-fixtures.test.js` (entries[22], the last one in the array).
- The premise checked first:
  - `node --test --test-reporter=tap` on that file alone exits **0**.
  - The file prints `9/9 passed (incl. 7 planted-violation/fail-closed assertion(s))`.
  - Capture: `i10-negative-fixtures-alone.tap`.
- How it was removed: the whole 17-line object was deleted. It was not blanked, not expired and not marked
  skipped. `git diff --numstat`: `0 17 tests/quarantine.json`.

## 2. The register's rules I followed

These were read from `loadQuarantine` in `scripts/checks/run-tests.js`.

- **Entry count:** nothing asserts or stores a count, so there was no count to update.
- **`$floor` (350):** this is the minimum number of test files discovery must find, not an entry count. It
  stays 350. Discovery found 401 files.
- **Declared-versus-actual checks:** `$normalizer`, `$dropClass` and `$ceilings` must equal the runner's
  declarations. They were not touched. **0 header fields changed**, compared field by field against
  `4b98830f`.
- **Per-entry rules:** these only check entries that are present (fields, canonical `causeLines`, no
  duplicate file). Removing an entry breaks none of them. The runner loaded the 22-entry register without
  complaint.
- **The other 22 entries are unchanged.** The sha256 of `JSON.stringify(entries)` after the edit is
  `fcbf3d74d2d1858987dadc1d45bc4692301f33ea05f1129abc0ead12639a88ca`. That is the same as the hash of
  `entries[0..21]` before the edit.
- **Nothing refused the edit.**
- **Left as it was:** the `$observedOnEnvironment` prose records a past measurement ("23/23 still failed" at
  21ba435c). It is a dated historical claim, not a rule the runner checks, so I did not edit it.

## 3. Verify commands (each run separately, real exit codes)

| Command | Exit | Numbers |
|---|---|---|
| `node scripts/checks/run-tests.js` | **1** | see the summary line below |
| `node --test tests/regression/S-OS-06/falsify-quarantine-runner.test.js` | **0** | tests 15, pass 15, fail 0, cancelled 0, skipped 0, todo 0 |
| `node scripts/checks/framework-purity.js` | **0** | `result: OK (exit 0)` |

Full `run-tests.js` summary line (the working tree matched `157fc5cc`):

    run-tests: discovered 401 test file(s) (floor 350); reporter pinned to tap; register base 669aadc1ab7dc03d74f5b95cb613a5573f4e54a6
    run-tests: FAIL — primary: 379 file(s) in 2 batch(es), exit 1 (tests 1260, pass 1256, fail 1, cancelled 0, skipped 3, todo 0) · quarantine: 22 entries, 22 still failing, 0 unexpectedly passed, 0 missing/undiscovered, 0 unobserved, 0 not verified at base

Checks: 401 discovered = 379 primary + 22 quarantined. 1256 pass + 1 fail + 3 skipped = 1260 tests.
Output files (`*.out` are gitignored): `i10-run-tests.out`, `i10-falsifier.out`, `i10-purity.out`.

## 4. Finding: the remaining failure has nothing to do with this lane

**The failing test:** `not ok 242 - record-trust-exit GREEN: the real clean tree -> exit 0, all five items
PASS, the committed ledger unchanged` (`tests/regression/S-OS-06/record-trust-exit.test.js:111`).

**What it asserts:** "the exit gate must not change the committed ledger". The gate's dry run regenerates
`scripts/open-source/rename-mc.occurrences.json`. The result differs from the committed copy by **+28/−22**
lines, and `pinned` goes **334 → 340**. The rewritten file is saved untracked as
`i10-ledger-as-regenerated.json`.

**Why the ledger drifts:**
- **6 pin rows are missing from the committed ledger.** All are in `tests/quarantine.json`, at lines 3, 38,
  146, 170, 194 and 218: the lane I8 O1–O6 `occurrence-pin` rows (α R-73). That is exactly the 334 → 340 gap.
- **TRACKER.md line numbers have shifted** (for example 939 → 943, 1031 → 1035). The ledger was last
  regenerated at `8b3ad24b`, and TRACKER.md has changed since then.

**Proof that my edit did not cause it:**
- Every drifted row points at a line **at or above 218** in `tests/quarantine.json`, or at TRACKER.md or
  `.claude/framework-installed.json`. I deleted lines **770–786**, which cannot move any of those lines.
- **Control run:** I put the pre-edit 23-entry register (`4b98830f:tests/quarantine.json`) back in place and
  ran `node scripts/checks/record-trust-exit.js` (exit 0, all five items PASS; output in
  `i10-record-trust-exit-PRE-edit.out`). The ledger was rewritten **identically**: numstat `28 22`, the same
  6 `tests/quarantine.json` pin rows. The drift is the same with or without my edit.
- The ledger and TRACKER.md are byte-identical between `e40dacb1`, `13f10f0d` and `e77775f1`
  (`git diff --numstat` is empty). I could not reproduce the premise's "exactly one failure" at `e40dacb1`
  from inside this lane. I did not re-run the suite at `e40dacb1`.

**What I did NOT do:**
- I did not regenerate or commit the occurrence ledger. It is explicitly out of scope, and committing it
  would turn the test green by changing what it checks against.
- Both times the test run or the control run rewrote the ledger, I put it back with
  `git checkout -- scripts/open-source/rename-mc.occurrences.json`.
- I deleted the untracked files those runs generated (`runtime/S-OS-06/fixture-product/`,
  `rename-occurrences.full.json`, `rename-plan.json`).
- The committed ledger is exactly as it was at `e77775f1`.

**Owed, by whoever owns the occurrence register:** regenerate the ledger at the sprint head so it includes
the six lane I8 pins and the current TRACKER.md line numbers. After that, `record-trust-exit GREEN` should
pass, and `run-tests.js` should exit 0 with `quarantine: 22 entries, 22 still failing, 0 unexpectedly passed`.

## Time box

The retirement itself took a few minutes. The whole lane ran somewhat over 15 minutes because I spent time
proving the second failure was not caused by the retirement. I did no further work after that.
