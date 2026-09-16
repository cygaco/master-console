# S-OS-06 r4 stage 2, lane F: MEASUREMENT of the two sprint-authored test files (no fixes)

Builder: backend-builder, branch `s-os-06/s2f-measure`, cut from `132a2222`. Measured 2026-09-16.
**No product, runner, register or test file was changed.** This commit carries evidence only.
Method copied from lane E (`runtime/S-OS-06/r4/s2e/premise-findings.md` on `s-os-06/s2e-linux`): a controlled
environment matrix, every run stated with its environment, the CI run as the reference observation.

## Verdict

| File | The variable that reproduces the CI failure | Not the variable (shown) |
|---|---|---|
| `falsify-quarantine-runner.test.js` (b), (h) | **The reporter used by the runner's grandchild `node --test <quarantined file>`.** `run-tests.js:181` passes no `--test-reporter`, so the reporter is the Node major's piped default: Node 22 gives TAP, which fails; Node 24 gives spec, which passes. | OS (win32 reproduces Linux CI exactly); the OUTER test reporter; clean-checkout state; host tooling on PATH; the home dir; `CLAUDE_PROJECT_DIR` |
| `record-trust-exit-runs.test.js` | **Only the same variable, through one path:** enforcer item 1 runs `falsify-quarantine-runner.test.js` as a fixture. Node 22 gives 4/5 items, with the only FAIL being that fixture's (b)+(h). Deleting only that fixture file gives exit 0 on Node 22. | clean-checkout state; host tooling on PATH; the home dir; `CLAUDE_PROJECT_DIR`; checkout location (fresh temp clone vs the nested worktree). Items 2-5 are PASS in every environment, CI included. |

**F2, the cascade question: the claim HOLDS, but through a narrower path than stated.** `record-trust-exit-runs` failing
in CI is entirely downstream of the runner's reporter-dependent capture. The path is:

`run-tests.js` capture (no pinned reporter, and the first predicate match under TAP is the synthetic `not ok N - <test name>` line)
→ CAUSE-LOCK false-red on the falsifier's own dummy fixture (b), with (h) masked by it
→ enforcer item 1 FAIL → enforcer exit 1 → `record-trust-exit-runs` FAIL.

The path does **not** run through the real register (`tests/quarantine.json`) or its 15 CI violations. The
enforcer never reads that register. Re-harvesting or re-registering quarantine entries would therefore not turn
this file green. Only a change to the runner's capture or reporter behaviour does. The sequencing constraint is
real and does not dissolve, but it is a dependency on the **runner change**, not on the register work.

**Premise correction ("both files get FIXED"):** in every environment measured, **neither test file has a defect
of its own.** (b) and (h) are a true positive: they correctly detect that the runner cannot absolve a genuinely
failing, correctly registered quarantined file when the piped reporter is TAP. `record-trust-exit-runs` correctly
reports the enforcer's red. Without editing either file, forcing the grandchild reporter to spec on Node 22 turns
the falsifier 9/9 green (F-D), and the enforcer is green whenever the falsifier is (R-A, R-C, R-D, R-F, R-G). The fix
for both belongs in `scripts/checks/run-tests.js`, which is the capture lane's scope, not this lane's.

**F3, ownership:** this measurement implies **no edit** to `falsify-quarantine-runner.test.js`. Nothing to STOP on.
(A forward-looking caveat that is NOT measured here: the r4 CI lane's F3 found that its planned T2/T3/T5 runner
contract would make case (b) unsatisfiable on every platform. If that contract lands without the fixture change
the capture lane is authorized to make, this cascade would carry the red into `record-trust-exit-runs` on every
platform, Windows included.)

## The controlled environment

- Tree: `132a2222` for every run. `git diff cf11478c 132a2222` over `scripts/checks/run-tests.js`,
  `scripts/checks/record-trust-exit.js`, `tests/regression/S-OS-06/`, `scripts/open-source/` and
  `tests/quarantine.json` is **empty**, so CI run 34909939581 (on `cf11478c`) exercised the same code.
- OS: win32 (Windows 11), Git 2.54.0.windows.1.
- Node 24: v24.16.0 (the host install).
- Node 22: **v22.23.2, the exact version CI used** (CI log: `Found in cache @ /opt/hostedtoolcache/node/22.23.2/x64`,
  `node: v22.23.2`). This is the official nodejs.org `node-v22.23.2-win-x64.zip`, SHA256
  `1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97`, matching `SHASUMS256.txt` (that file itself was not
  GPG-verified). It was extracted to `<TEMP>` and deleted after use.
- Unless a row says otherwise, `CLAUDE_PROJECT_DIR` and `NODE_OPTIONS` were **unset** for the run (`env -u`). The
  operator session exports `CLAUDE_PROJECT_DIR=<main-checkout>`, so it is controlled explicitly.
- Checkout state:
  - The falsifier runs were in this worktree. Its only ignored entries are 5 harness session files under `.claude/`;
    there are no registers and no `runtime/**/*.out`.
  - The `record-trust-exit-runs` runs R-A to R-E and R-G were each in their **own fresh `git clone`** of this
    worktree @ `132a2222`, with 0 ignored entries. Item 4 of the enforcer rewrites a tracked ledger, so each run needed a fresh clone.
  - R-F and R-H ran in this worktree. The files they wrote were restored afterwards, and `git status` was verified clean.
- Reporter levers:
  - `NODE_OPTIONS=--test-reporter=<x>` is inherited by the runner's grandchild `node --test`, which has no CLI
    reporter. It sets the grandchild's reporter without an edit.
  - It is **incompatible** with a CLI `--test-reporter` in the same process: `NODE_OPTIONS=tap` plus CLI `spec` throws
    `ERR_INVALID_ARG_VALUE`, and `NODE_OPTIONS=tap` plus CLI `tap` emits no `# tests` line. Enforcer item 1 passes
    `--test-reporter=tap` on its CLI, so this lever was used only on the falsifier alone, never on the enforcer.
  - For the enforcer, the Node major was the lever, and ablation was the counterfactual.
- Stripped host: every PATH dir holding codex, agy or claude was removed, and HOME and USERPROFILE were set to an
  empty temp dir. For R-D/R-E, codex, agy and claude were verified absent, and git was present. For F-H/F-I, codex was
  still reachable through the npm-global dir (agy and claude absent). The falsifier outcome did not move either way.
- Standalone, not inside the full `npm test` batch. CI's own observation shows items 2-5 PASS under the full batch's
  concurrency, and the r4 CI lane's T7 local full run (Node 24, clean worktree) did not list this file among local
  primary failures. So concurrency is not the variable. It was not re-measured here.

## File 1: `tests/regression/S-OS-06/falsify-quarantine-runner.test.js`

### Controlled experiment (raw output in Appendix A)

| Run | Node | Grandchild reporter (how set) | Outer reporter | Other env | Exit | (b) | (h) | others |
|---|---|---|---|---|---|---|---|---|
| F-A | 24 | spec (default) | spec (default) | none | **0** | ok | ok | 7/7 ok |
| F-B | 24 | **TAP** (`NODE_OPTIONS`) | TAP | none | **1** | **not ok** | **not ok** | 7/7 ok |
| F-C | 22 | **TAP** (default, = CI) | TAP | none | **1** | **not ok** | **not ok** | 7/7 ok |
| F-D | 22 | **spec** (`NODE_OPTIONS`) | spec | none | **0** | ok | ok | 7/7 ok |
| F-E | 24 | spec (default) | **TAP (CLI, as enforcer item 1)** | none | 0 | ok | ok | 7/7 ok |
| F-F | 22 | TAP (default) | **spec (CLI)** | none | 1 | not ok | not ok | 7/7 ok |
| F-G | 24 | spec | spec | `CLAUDE_PROJECT_DIR=<main-checkout>` | 0 | ok | ok | 7/7 ok |
| F-H | 24 | spec | spec | PATH stripped + HOME empty | 0 | ok | ok | 7/7 ok |
| F-I | 22 | TAP | TAP | PATH stripped + HOME empty | 1 | not ok | not ok | 7/7 ok |
| F-J | 22 | TAP | TAP | `CLAUDE_PROJECT_DIR=<main-checkout>` | 1 | not ok | not ok | 7/7 ok |

How to read the table:
- F-B and F-D cross the two candidate variables. On Node 24, TAP alone reproduces the failure. On Node 22, spec
  alone heals it. **The variable is the grandchild reporter, not the Node major itself.**
- F-E and F-F show the outer reporter is irrelevant.
- F-G through F-J show the clean-checkout and host variables are irrelevant.
- Every failing run prints CI's exact `observed:   not ok 1 - dummy rotted`.

### Mechanism (reproduced, with an instrument rather than inference)

The dummy's raw output was taken under each Node's default piped reporter. The runner's own predicate was then
applied to it, copied verbatim from `run-tests.js:214` (the probe confirmed the regex is still verbatim at HEAD).
Every matching line is listed in order:

```text
node v24.16.0 default piped reporter, first line: "✖ dummy rotted (0.6923ms)", exit 1
  FIRST L15: AssertionError [ERR_ASSERTION]: dummy rot: still failing
node v22.23.2 default piped reporter, first line: "TAP version 13", exit 1
  FIRST L3: not ok 1 - dummy rotted
        L15: name: 'AssertionError'
```

- Under spec, the first match contains the registered `dummy rot: still failing`, so CAUSE-LOCK is satisfied.
- Under TAP, the first match is the reporter-synthesized test-name line. The registered text lives only in the YAML
  `error: |-` block body (`    dummy rot: still failing`), and **no predicate alternative matches that line**.
- **(b):** the observed line ≠ the registered text, so there is a CAUSE-LOCK violation and the runner exits 1 where (b) asserts 0.
- **(h):** the runner does exit non-zero, but through CAUSE-LOCK, which sits before EXPIRED in the `else if` chain
  (`run-tests.js:342-349`). The EXPIRED line (h) asserts is never reached. So **(h) is masked by the same cause, not
  a second defect.**

### What the fix would be (described, NOT made; owner: the capture lane, `scripts/checks/run-tests.js`)

1. **Pin the reporter** in `runNodeTest` (`--test-reporter=spec`) so capture grain stops following the Node major.
   F-D is the environment-level stand-in for this: Node 22 plus a spec grandchild gives 9/9 with no edit to either test
   file. Measured only on win32. The spec layout on Linux Node 22 needs its first CI run to confirm.
2. **Skipping the synthetic line alone is NOT sufficient under TAP.** Per the instrument, the next match is
   `name: 'AssertionError'`, which still does not contain the cause. A TAP-grain fix would have to read the YAML
   `error:` block.
3. No change is needed in `falsify-quarantine-runner.test.js` for the defect measured here.

## File 2: `tests/regression/S-OS-06/record-trust-exit-runs.test.js`

### CI reference (run 34909939581, ubuntu, Node 22.23.2, `cf11478c`)

```text
not ok 176 - record-trust-exit runs under npm test: a real exit code 0 on the clean tree
  duration_ms: 16842.268955
  location: '/home/runner/work/master-console/master-console/tests/regression/S-OS-06/record-trust-exit-runs.test.js:24:1'
  error: |-
    record-trust-exit exited 1
    FAIL [1 fixtures] falsify-quarantine-runner.test.js: exit 1, fail=2, cancelled=0: not ok 2 - QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits 0 | not ok 8 - QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> non-zero
    PASS [2 guard] 0 un-routed partition readers; 3 consumers require scripts/open-source/partition-loader.js
    PASS [3 deny-list] scripts/open-source/rename-mc.denylist.json exists and carries its $question header (...)
    PASS [4 dry-run] dry-run exit 0; unclassified=0; unpinned-unrewritten-underived=0; derived set within the 5 generated views (...)
    PASS [5 category-delta] per-category delta == 0 for all 6 categories the categorizer owns; uncomputable=0; (...)
    record-trust-exit: FAIL (4/5 items pass)
```

Item 1 names only the failing fixtures (`record-trust-exit.js:303-304`), so in CI **every other `falsify-*`
fixture passed**. The single failing element was the falsifier's (b)+(h).

### Controlled experiment (raw output in Appendix B)

| Run | Node | Checkout | Other env | Exit | Enforcer result |
|---|---|---|---|---|---|
| R-A | 24 | fresh clone | none | **0** | PASS (5/5) |
| R-B | 22 | fresh clone | none | **1** | **FAIL (4/5)**: item 1 = falsifier (b)+(h) only, **byte-identical to CI's item lines** |
| R-C | 22 | fresh clone, **falsifier file deleted (ablation)** | none | **0** | PASS (5/5) |
| R-G | 24 | fresh clone, falsifier file deleted (ablation) | none | 0 | PASS (5/5) |
| R-D | 24 | fresh clone | PATH stripped + HOME empty | 0 | PASS (5/5) |
| R-E | 22 | fresh clone | PATH stripped + HOME empty | 1 | FAIL (4/5), same single item-1 fixture |
| R-F | 24 | this nested worktree | `CLAUDE_PROJECT_DIR=<main-checkout>` | 0 | PASS (5/5) |
| R-H | 22 | this nested worktree | `CLAUDE_PROJECT_DIR=<main-checkout>` | 1 | FAIL (4/5), same single item-1 fixture |

- R-B reproduces CI on win32.
- **R-C is the counterfactual.** In CI's Node, removing only the falsifier file (it is not in `REQUIRED_FALSIFIERS`, so
  the fixture set stays structurally complete) turns the file green.
- R-D/R-E and R-F/R-H show that host tooling, the home dir, `CLAUDE_PROJECT_DIR` and checkout location do not move the outcome.
- Unlike lane E's E3, this enforcer has no host-provider dependence.

### What the fix would be

**None in this file.** It goes green when `falsify-quarantine-runner.test.js` does, and that happens through the runner
change above. Quarantining it is barred by the register's policy anyway. It is also unnecessary: the file carries no
defect of its own in any environment measured.

## Incidental (not causes of either failure; noted only)

1. **Under TAP, case (f) passes without discriminating.** CAUSE-LOCK fires on TAP whatever the registration is, so (f)
   being green in CI does not show the lock working. Its discriminating control is (b), which is the case that fails.
2. **Running the enforcer mutates the checkout.** On a fresh clone @ `132a2222` (both Node majors), item 4's dry-run:
   - rewrites the tracked `scripts/open-source/rename-mc.occurrences.json`, with `pinned` going from 316 to 320 and new
     `TRACKER.md` line-7 rows;
   - leaves `runtime/S-OS-06/rename-plan.json` and `runtime/S-OS-06/rename-occurrences.full.json` as **untracked and not
     ignored** (`git check-ignore` matches neither).

   So the committed ledger at HEAD is stale against the tree, and `npm test` is not read-only on the checkout. This is the
   same 320-vs-316 drift the r4 CI lane's T7 saw locally in `record-trust-exit.test.js:111` ("committed ledger
   unchanged"). That is a different file, not in this lane. In CI that test failed earlier, at `:115` on the exit code,
   which is this same cascade. Whether the ledger assertion would also fail in CI was not measured.

## Process disclosure

- Clones, the Node 22 zip and its extraction, the dummy and the probe scripts all lived under `<TEMP>/sos06-s2f/`,
  outside the repo. They were deleted after the final verification.
- R-F and R-H ran in this worktree. Each rewrote the tracked ledger and created the two untracked `runtime/S-OS-06/`
  files. Both were restored with `git checkout --` plus removal of the two new files (neither existed before). `git
  status` was verified empty before this evidence file was written.
- In this document, local absolute paths are replaced by `<TEMP>`, `<worktree>` and `<main-checkout>`, and the PATH dump is
  summarised. The raw `.out` files are gitignored (`runtime/**/*.out`), and a tracked copy would trip the tracked-transients
  leak-gate step, so they are inlined below instead.

---

## Appendix A: falsifier matrix, verbatim (paths redacted)

```text
=== FALSIFIER MATRIX @ 132a2222, win32, cwd=worktree, CLAUDE_PROJECT_DIR unset unless stated, NODE_OPTIONS unset unless stated
--- F-A node24 default | node v24.16.0 | env: (none) | args: --test
    exit=0
    ✔ QUARANTINE-RUNNER (a): a quarantined test that PASSES makes the runner exit non-zero
    ✔ QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits 0
    ✔ QUARANTINE-RUNNER (c): a quarantined file that is listed but MISSING makes the runner exit non-zero
    ✔ QUARANTINE-RUNNER (d) control: the same failing test NOT quarantined makes the runner exit non-zero
    ✔ QUARANTINE-RUNNER (e): a malformed quarantine artifact fails closed
    ✔ QUARANTINE-RUNNER (f) CAUSE-LOCK (β): a quarantined file failing with a DIFFERENT assertion than regi
    ✔ QUARANTINE-RUNNER (g) EMPTY-SUBJECT floor (β): discovery below $floor is a FAILURE, not a pass
    ✔ QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> non-
    ✔ QUARANTINE-RUNNER: the real tests/quarantine.json is never touched
--- F-B node24 grandchild forced TAP | node v24.16.0 | env: NODE_OPTIONS=--test-reporter=tap | args: --test
    exit=1
    ok 1 - QUARANTINE-RUNNER (a): a quarantined test that PASSES makes the runner exit non-zero
    not ok 2 - QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits
    ok 3 - QUARANTINE-RUNNER (c): a quarantined file that is listed but MISSING makes the runner exit non-zero
    ok 4 - QUARANTINE-RUNNER (d) control: the same failing test NOT quarantined makes the runner exit non-zero
    ok 5 - QUARANTINE-RUNNER (e): a malformed quarantine artifact fails closed
    ok 6 - QUARANTINE-RUNNER (f) CAUSE-LOCK (β): a quarantined file failing with a DIFFERENT assertion than r
    ok 7 - QUARANTINE-RUNNER (g) EMPTY-SUBJECT floor (β): discovery below $floor is a FAILURE, not a pass
    not ok 8 - QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry
    ok 9 - QUARANTINE-RUNNER: the real tests/quarantine.json is never touched
          3         observed:   not ok 1 - dummy rotted
--- F-C node22 default (CI) | node v22.23.2 | env: (none) | args: --test
    exit=1
    ok 1 - QUARANTINE-RUNNER (a): a quarantined test that PASSES makes the runner exit non-zero
    not ok 2 - QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits
    ok 3 - QUARANTINE-RUNNER (c): a quarantined file that is listed but MISSING makes the runner exit non-zero
    ok 4 - QUARANTINE-RUNNER (d) control: the same failing test NOT quarantined makes the runner exit non-zero
    ok 5 - QUARANTINE-RUNNER (e): a malformed quarantine artifact fails closed
    ok 6 - QUARANTINE-RUNNER (f) CAUSE-LOCK (β): a quarantined file failing with a DIFFERENT assertion than r
    ok 7 - QUARANTINE-RUNNER (g) EMPTY-SUBJECT floor (β): discovery below $floor is a FAILURE, not a pass
    not ok 8 - QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry
    ok 9 - QUARANTINE-RUNNER: the real tests/quarantine.json is never touched
          3         observed:   not ok 1 - dummy rotted
--- F-D node22 grandchild forced SPEC | node v22.23.2 | env: NODE_OPTIONS=--test-reporter=spec | args: --test
    exit=0
    ✔ QUARANTINE-RUNNER (a): a quarantined test that PASSES makes the runner exit non-zero
    ✔ QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits 0
    ✔ QUARANTINE-RUNNER (c): a quarantined file that is listed but MISSING makes the runner exit non-zero
    ✔ QUARANTINE-RUNNER (d) control: the same failing test NOT quarantined makes the runner exit non-zero
    ✔ QUARANTINE-RUNNER (e): a malformed quarantine artifact fails closed
    ✔ QUARANTINE-RUNNER (f) CAUSE-LOCK (β): a quarantined file failing with a DIFFERENT assertion than regi
    ✔ QUARANTINE-RUNNER (g) EMPTY-SUBJECT floor (β): discovery below $floor is a FAILURE, not a pass
    ✔ QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> non-
    ✔ QUARANTINE-RUNNER: the real tests/quarantine.json is never touched
--- F-E node24 outer CLI tap (as enforcer item 1) | node v24.16.0 | env: (none) | args: --test --test-reporter=tap
    exit=0
    ok 1 - QUARANTINE-RUNNER (a): a quarantined test that PASSES makes the runner exit non-zero
    ok 2 - QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits 0
    ok 3 - QUARANTINE-RUNNER (c): a quarantined file that is listed but MISSING makes the runner exit non-zero
    ok 4 - QUARANTINE-RUNNER (d) control: the same failing test NOT quarantined makes the runner exit non-zero
    ok 5 - QUARANTINE-RUNNER (e): a malformed quarantine artifact fails closed
    ok 6 - QUARANTINE-RUNNER (f) CAUSE-LOCK (β): a quarantined file failing with a DIFFERENT assertion than r
    ok 7 - QUARANTINE-RUNNER (g) EMPTY-SUBJECT floor (β): discovery below $floor is a FAILURE, not a pass
    ok 8 - QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> n
    ok 9 - QUARANTINE-RUNNER: the real tests/quarantine.json is never touched
--- F-F node22 outer CLI spec | node v22.23.2 | env: (none) | args: --test --test-reporter=spec
    exit=1
    ✔ QUARANTINE-RUNNER (a): a quarantined test that PASSES makes the runner exit non-zero
    ✖ QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits 0
    ✔ QUARANTINE-RUNNER (c): a quarantined file that is listed but MISSING makes the runner exit non-zero
    ✔ QUARANTINE-RUNNER (d) control: the same failing test NOT quarantined makes the runner exit non-zero
    ✔ QUARANTINE-RUNNER (e): a malformed quarantine artifact fails closed
    ✔ QUARANTINE-RUNNER (f) CAUSE-LOCK (β): a quarantined file failing with a DIFFERENT assertion than regi
    ✔ QUARANTINE-RUNNER (g) EMPTY-SUBJECT floor (β): discovery below $floor is a FAILURE, not a pass
    ✖ QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> non-
    ✔ QUARANTINE-RUNNER: the real tests/quarantine.json is never touched
    ✖ QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits 0
    ✖ QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> non-
          2       observed:   not ok 1 - dummy rotted
--- F-G node24 CLAUDE_PROJECT_DIR=main checkout | node v24.16.0 | env: CLAUDE_PROJECT_DIR=<main-checkout> | args: --test
    exit=0
    ✔ QUARANTINE-RUNNER (a) … (h), and "the real tests/quarantine.json is never touched" — all 9 ✔ (identical to F-A)
--- F-H node24 PATH stripped + HOME empty | node v24.16.0 | env: PATH=<stripped of codex,agy,claude dirs> HOME=USERPROFILE=<TEMP>/sos06-s2f/emptyhome | args: --test
    exit=0
    ✔ QUARANTINE-RUNNER (a) … (h), and "the real tests/quarantine.json is never touched" — all 9 ✔ (identical to F-A)
--- F-I node22 PATH stripped + HOME empty | node v22.23.2 | env: PATH=<stripped of codex,agy,claude dirs> HOME=USERPROFILE=<TEMP>/sos06-s2f/emptyhome | args: --test
    exit=1
    ok 1 (a) · not ok 2 (b) · ok 3 (c) · ok 4 (d) · ok 5 (e) · ok 6 (f) · ok 7 (g) · not ok 8 (h) · ok 9 (real quarantine untouched)
          3         observed:   not ok 1 - dummy rotted
--- F-J node22 CLAUDE_PROJECT_DIR=main checkout | node v22.23.2 | env: CLAUDE_PROJECT_DIR=<main-checkout> | args: --test
    exit=1
    ok 1 (a) · not ok 2 (b) · ok 3 (c) · ok 4 (d) · ok 5 (e) · ok 6 (f) · ok 7 (g) · not ok 8 (h) · ok 9 (real quarantine untouched)
          3         observed:   not ok 1 - dummy rotted
```

(F-G to F-J are collapsed to one line per run because their per-test lines are identical to F-A or F-C. The
`observed:` counts are 3 under an outer TAP reporter because (h)'s runner output prints twice, once as `error` and once as `actual`.)

## Appendix B: `record-trust-exit-runs` matrix, verbatim (paths redacted; item lines cut at 330 chars)

```text
--- R-A | node v24.16.0 | dir=clone (<TEMP>/sos06-s2f/clone-R-A) @ 132a2222 | ignored-entries-before=0 | extra env:   | R-A wall=16s
    exit=0
    ℹ fail 0
    ℹ pass 1
    ✔ record-trust-exit runs under npm test: a real exit code 0 on the clean tree
    tracked files modified by the run:  M scripts/open-source/rename-mc.occurrences.json
--- R-B | node v22.23.2 | dir=clone (<TEMP>/sos06-s2f/clone-R-B) @ 132a2222 | ignored-entries-before=0 | extra env:   | R-B wall=21s
    exit=1
    # fail 1
    # pass 0
    not ok 1 - record-trust-exit runs under npm test: a real exit code 0 on the clean tree
    FAIL [1 fixtures] falsify-quarantine-runner.test.js: exit 1, fail=2, cancelled=0: not ok 2 - QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits 0 | not ok 8 - QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> non-zero
    PASS [2 guard] 0 un-routed partition readers; 3 consumers require scripts/open-source/partition-loader.js
    PASS [3 deny-list] scripts/open-source/rename-mc.denylist.json exists and carries its $question header ("What must NOT be rewritten by scripts/open-source/rename-mc.js. This is ...")
    PASS [4 dry-run] dry-run exit 0; unclassified=0; unpinned-unrewritten-underived=0; derived set within the 5 generated views at their resolved paths (215 derived occurrences in 3 view(s); 2 regenerated clean [.claude/paths.json, scripts/hooks/lib/paths.generated.js]); refusedRenames=0 (stdout and the fresh runtime/S-OS-06/ren
    PASS [5 category-delta] per-category delta == 0 for all 6 categories the categorizer owns; uncomputable=0; paths-registry=0 [categorized 0 = pinned 0 + transformed 0]; env=0 [categorized 103 = pinned 103 + transformed 0]; skill-namespace=0 [categorized 4 = pinned 4 + transformed 0]; dir=0 [categorized 12 = pinned 12 + transf
    record-trust-exit: FAIL (4/5 items pass)
    tracked files modified by the run:  M scripts/open-source/rename-mc.occurrences.json
--- R-C | node v22.23.2 | dir=ablate (<TEMP>/sos06-s2f/clone-R-C) @ 132a2222 | ignored-entries-before=0 | extra env:   | R-C wall=22s
    exit=0
    # fail 0
    # pass 1
    ok 1 - record-trust-exit runs under npm test: a real exit code 0 on the clean tree
    tracked files modified by the run:  M scripts/open-source/rename-mc.occurrences.json  D tests/regression/S-OS-06/falsify-quarantine-runner.test.js
--- R-D | node v24.16.0 | dir=clone (<TEMP>/sos06-s2f/clone-R-D) @ 132a2222 | ignored-entries-before=0 | extra env: PATH=<stripped: codex,agy,claude,npm-global removed> HOME=USERPROFILE=<TEMP>/sos06-s2f/emptyhome  | R-D wall=18s
    exit=0
    ℹ fail 0
    ℹ pass 1
    ✔ record-trust-exit runs under npm test: a real exit code 0 on the clean tree
    tracked files modified by the run:  M scripts/open-source/rename-mc.occurrences.json
--- R-E | node v22.23.2 | dir=clone (<TEMP>/sos06-s2f/clone-R-E) @ 132a2222 | ignored-entries-before=0 | extra env: PATH=<stripped: codex,agy,claude,npm-global removed> HOME=USERPROFILE=<TEMP>/sos06-s2f/emptyhome  | R-E wall=21s
    exit=1
    # fail 1
    # pass 0
    not ok 1 - record-trust-exit runs under npm test: a real exit code 0 on the clean tree
    FAIL [1 fixtures] falsify-quarantine-runner.test.js: exit 1, fail=2, cancelled=0: not ok 2 - QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits 0 | not ok 8 - QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> non-zero
    PASS [2 guard] (identical to R-B)
    PASS [3 deny-list] (identical to R-B)
    PASS [4 dry-run] (identical to R-B)
    PASS [5 category-delta] (identical to R-B)
    record-trust-exit: FAIL (4/5 items pass)
    tracked files modified by the run:  M scripts/open-source/rename-mc.occurrences.json
--- R-G | node v24.16.0 | dir=ablate (<TEMP>/sos06-s2f/clone-R-G) @ 132a2222 | ignored-entries-before=0 | extra env:   | R-G wall=18s
    exit=0
    ℹ fail 0
    ℹ pass 1
    ✔ record-trust-exit runs under npm test: a real exit code 0 on the clean tree
    tracked files modified by the run:  M scripts/open-source/rename-mc.occurrences.json  D tests/regression/S-OS-06/falsify-quarantine-runner.test.js
--- R-F | node v24.16.0 | dir=worktree (<worktree>) @ 132a2222 | ignored-entries-before=5 | extra env: CLAUDE_PROJECT_DIR=<main-checkout>  | R-F wall=10s
    exit=0
    ℹ fail 0
    ℹ pass 1
    ✔ record-trust-exit runs under npm test: a real exit code 0 on the clean tree
    tracked files modified by the run:  M scripts/open-source/rename-mc.occurrences.json
--- R-H | node v22.23.2 | dir=worktree (<worktree>) @ 132a2222 | ignored-entries-before=5 | extra env: CLAUDE_PROJECT_DIR=<main-checkout>  | R-H wall=11s
    exit=1
    # fail 1
    # pass 0
    not ok 1 - record-trust-exit runs under npm test: a real exit code 0 on the clean tree
    FAIL [1 fixtures] falsify-quarantine-runner.test.js: exit 1, fail=2, cancelled=0: not ok 2 - QUARANTINE-RUNNER (b): a genuinely failing quarantined test is subtracted and the runner exits 0 | not ok 8 - QUARANTINE-RUNNER (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> non-zero
    PASS [2 guard] (identical to R-B)
    PASS [3 deny-list] (identical to R-B)
    PASS [4 dry-run] (identical to R-B)
    PASS [5 category-delta] (identical to R-B)
    record-trust-exit: FAIL (4/5 items pass)
    tracked files modified by the run:  M scripts/open-source/rename-mc.occurrences.json
```

## Appendix C: raw reporter output of the falsifier's FAILING dummy (from its source, run standalone)

```text
=== node v24.16.0, piped, no --test-reporter (spec) ===
✖ dummy rotted (0.7203ms)
ℹ tests 1 / ℹ pass 0 / ℹ fail 1 / ...
✖ failing tests:
test at still-fails.test.js:3:1
✖ dummy rotted (0.7203ms)
  AssertionError [ERR_ASSERTION]: dummy rot: still failing
  1 !== 2
      at TestContext.<anonymous> (<TEMP>/sos06-s2f/dummy/still-fails.test.js:3:37)
exit=1

=== node v22.23.2, piped, no --test-reporter (TAP) ===
TAP version 13
# Subtest: dummy rotted
not ok 1 - dummy rotted
  ---
  duration_ms: 0.8187
  type: 'test'
  location: '<TEMP>\\sos06-s2f\\dummy\\still-fails.test.js:3:1'
  failureType: 'testCodeFailure'
  error: |-
    dummy rot: still failing

    1 !== 2

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  ...
```
