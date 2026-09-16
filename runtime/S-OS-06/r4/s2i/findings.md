# S-OS-06 r4 lane I (structured capture rewrite): FALSE PREMISE, builder STOPPED

Author: backend-builder (dispatched), 2026-09-16. Worktree `s-os-06/s2i-capture`, cut from `132a2222`.
Start record 08:58:33Z. Stopped at about 09:16Z, inside the 100-minute box. **This is a false-premise stop, not a
time-box stop.** The pre-committed degraded fallback was therefore NOT taken (see §5).

Spec read in full: β `4a6d8c30` (ledger row 476) `answer`, `beta_self_corrections`, `non_blocking_inputs_ruled`;
row 473 (`2f8d4b17`), the ordered-set ruling this lane inherits; lane A's brief (A1-A13); and
`S-OS-06-s2a-comparator/runtime/S-OS-06/r4/s2a-comparator-premise-findings.md`.

Every measurement: win32 (Windows 11), node v24.16.0, `CLAUDE_PROJECT_DIR` unset, `--test-reporter=tap`, each
quarantined file run ALONE and SEQUENTIALLY through the rewrite's own `runNodeTest` + `captureCauseLines`
(the same code path the gate would use).

---

## 1. The false premise: under I1's breadth the ORDER of the CONTROL entry's cause lines flaps

I8 falsifier 3 says: "the stability result must still hold: 22 of 23 byte-identical across repeated runs,
**order not flapping**". Row 473 §2 locks the **ORDERED** set. Row 476 P2 (I1) widens capture to **all
test-authored comment lines**. For the control entry `tests/mc/dispatch-readiness.test.js`, those three cannot
hold at once.

### Mechanism (read at source)

- `tests/mc/dispatch-readiness.test.js:39` and `:43` write every sub-case line (`ok …` / `FAIL …`) to **stdout**.
- `:790-791` write the failure summary (`FAIL — N of M cases failed:` and `- <case>`) to **stderr**. `:792` then
  calls `process.exit(1)`.
- node's test runner receives the child's stdout and stderr on separate pipes. The TAP reporter renders BOTH as
  `# <line>`, so TAP **erases which stream a line came from**. The order between the last stdout chunk and the
  stderr chunk depends on pipe scheduling.

### Measurement (6 sequential passes, all 23 entries; `stability-6.summary.json` in this directory)

| property across 6 passes | entries stable |
|---|---|
| normalized ORDERED sequence identical | **22 / 23** (the flapping one is `dispatch-readiness`, a CONTROL) |
| normalized sequence identical when order is ignored (sorted, duplicates kept) | **23 / 23** |
| raw TAP comment lines identical (pre-normalization) | 21 / 23 (`dispatch-readiness` order; `wrapper-mode-binding` mkdtemp suffix) |
| raw TAP comment lines identical when order is ignored | 22 / 23 (`wrapper-mode-binding` mkdtemp suffix only) |

`dispatch-readiness` produced **3 distinct orderings in 6 passes** (pass 1 / passes 2-5 / pass 6). The content is
identical in every pass. Only the position of the 2 stderr lines among the last 4 stdout lines moves:

```
pass 1    : … install.sh → caught | FAIL — 1 of 79 cases failed: | - KNOWN_DANGLING_REFS … | .mjs … | scripts/ …
passes 2-5: … install.sh → caught | .mjs … | scripts/ … | FAIL — 1 of 79 cases failed: | - KNOWN_DANGLING_REFS …
pass 6    : … install.sh → caught | .mjs … | FAIL — 1 of 79 cases failed: | - KNOWN_DANGLING_REFS … | scripts/ …
```

The two registration observations (two more runs) also disagreed with each other, at indexes 88 and 90. The
register written from one observation matched **1 of the 6** stability passes. An ordered lock on this CONTROL
would therefore fire a false CAUSE-LOCK on most runs, with no change to the test. That is the false-red flood A12
warns trains a gate into noise, and it would land on the control group.

### Why the earlier "order never flapped" result did not see it

Lane A's prototype used the keyword predicate. For this file it captured the stdout `FAIL  KNOWN_DANGLING_REFS…`
line (index ~29, far from the race) and the two stderr summary lines. The racing stdout lines are the last
`ok FIX5…` lines, and the keyword predicate never captured them. So that result was true for that capture and does
not transfer to I1's breadth. It is the same failure mode as before: a measurement's scope is part of the
measurement.

### Why I stopped instead of choosing

Resolving this means choosing the lock's grain, and that is a ruling. Row 473 §2 says ORDERED, and I8.3 says
"order not flapping". Picking the order-free lock myself would reconcile a ruling conflict silently.

## 2. Options for the ruling (none chosen)

- **(A) Order-free lock: the sorted sequence, duplicates kept.** Measured 23/23 stable over 6 passes. It still
  distinguishes sub-cases, because a different sub-case changes CONTENT. That covers the purpose row 473 §2 gave
  (a changed SECOND cause behind an unchanged first line), and it covers all 7 degenerate entries and the control.
  Cost: a pure reordering of identical lines is not detected, and that goes in the declaration as a ceiling
  ("ORDER IS NOT LOCKED: TAP erases stream identity, so cross-stream order is not observable"). The change to the
  WIP is small: sort both sides before equality, and refuse a stored `causeLines` that is not in canonical order
  (so the fixed-point property also covers order). **Builder's recommendation, for β to rule on.**
- **(B) Ordered lock per stream, with stream identity recovered.** Add a second reporter (a small custom reporter
  module that records `test:stdout` / `test:stderr` events with their stream to a file) beside the pinned TAP
  reporter. This keeps order within each stream, which is deterministic. Cost: a new mechanism the TAP-pin ruling
  did not contemplate, more code, and a second artifact per quarantined run.
- **(C) Keep the ordered lock as ruled.** The control fails its lock about 5 runs in 6, so it cannot be "fixed
  properly". This contradicts the brief's own fallback clause ("the control entry EXCLUDED from the degraded set
  and fixed properly regardless").

## 3. What was built, and where it is (nothing lands; HEAD's scripts/ and tests/ equal 132a2222)

- `456105c9`: A12 step 1 (register re-captured with the new fields, legacy field kept).
  **Reverted by `1a24e8d9`**, because under the unchanged runner that register's `$format`/`$policy` would
  describe comparisons the runner does not perform. That is I7's declared-versus-actual defect, and HEAD should
  not carry it. `git diff 132a2222 HEAD -- scripts tests` is empty.
- `wip/run-tests.js.wip`: the full structured rewrite (826 lines). It is preserved as a non-executable artifact so
  the next dispatch resumes instead of rebuilding. It contains:
  - TAP pinned for the primary run and every quarantined run (`nodeTestArgs`).
  - The I1 capture: all TAP comment lines, minus `# Subtest:` lines and the run summary after the top-level plan
    (both synthesized).
  - The I2 structured YAML parse: the `error` value is decoded from its block scalar (`|-`) or from its
    `util.inspect` literal (`'…'`, `"…"`, `` `…` ``), and captured only when node unwraps an author error. The
    runner-composed values (`test failed` on the process wrapper that carries `exitCode`, and `N subtest(s)
    failed` outside node's unwrap set) are container.
  - The declared normalizer with a repeatable marker strip.
  - The drop class stated as shapes.
  - Vacuity as a property; the fixed-point refusal (I3).
  - `base` and the real-register expected-base refusal. It is a runner check and says it is not freeze coverage.
  - `basePath` via a pair-limited `git diff -M50%` that must print R (the threshold is declared).
  - `observedOn` stamps, with the reporter pinned to tap.
  - Unknown-field refusal; a truncated capture counts as unobserved.
  - Full cause-line printing, with observed and registered shown side by side.
  - `--verify-base` (materialize base via read-tree + checkout-index; require the file to FAIL there; report
    whether the base lines equal the register, informational only).
- `wip/quarantine.json.wip`: all 23 entries re-captured from a REAL sequential observation under that code.
  Every entry exits 1, every observed fail count equals the registered count, no capture is vacuous, and every
  line is a fixed point. `basePath` is set on the 5 renamed entries. `$policy` reads "fails at base" and records
  why "identically" cannot hold (the codemod rewrote `WARPOS_SHAPE_DOOR` → `MC_SHAPE_DOOR` inside wrapper-door's
  own cause line). `$format` makes no freeze claim. `$ciInterpretation` is pre-committed. The
  `dispatch-readiness` order in this file is ONE of the three observed orders.
- `wip/tap-yaml-regimes-probe.test.js.wip`: the probe used to read node's YAML error regimes.

## 4. I8 falsifier state: NONE is green. No falsifier test file was written.

| # | falsifier | state |
|---|---|---|
| 1 | the 7 degenerate entries become distinguishing | **not run**. By inspection of the WIP register, all 7 now carry per-sub-case lines. For example provider-smoke has 8 lines, coverage-gate-caller carries `- auditLedger: … got {"ok":false}`, and mode-profile carries its deep-equal diff. No flip test was executed. |
| 2 | the control entry distinguishes sub-cases | **not run**. The lines are present (provider-smoke CONTROL: the 7 sub-case lines), but see #3: the other control, dispatch-readiness, cannot hold an ORDERED lock. |
| 3 | stability 22/23, order not flapping | **FALSE PREMISE under I1** (§1). Measured: ordered 22/23 with the flap on a CONTROL; order-free 23/23. |
| 4 | TAP pinned | built in WIP; not falsified |
| 5 | fixed-point check refuses a non-fixed-point line | built in WIP; not falsified |
| 6 | basePath absent / present-and-correct / present-but-not-a-rename | built in WIP; not falsified |

## 5. Degraded versus structured: neither

The fallback clause triggers on the time box ("not green by then"). This stop is the false-premise exit, which the
brief ranks separately ("prove it and STOP"). The degraded form would not avoid the ruling either: it requires the
control "fixed properly regardless", and fixing `dispatch-readiness` properly needs the order question answered.

## 6. The declared normalizer (as built in the WIP) and its stated ceilings

- 0 input: every captured line enters in TAP comment rendering. A YAML `error` value is decoded from its scalar
  and re-rendered with node's own `tapEscape` (mirrored exactly), so both regimes share one normalizer.
- 1 unescape: a single left-to-right scan, `\\`→`\` and `\#`→`#`.
- 2 separators: every RUN of backslashes → one `/`. It runs after unescape (the ordering trap).
- 3 roots: repo root → `<repo>`, THEN the temp dir → `<tmp>` (path-boundary guarded), then the mkdtemp 6-char suffix
  of the first segment under `<tmp>/` → `XXXXXX`.
- 4 timings: `(N ms)` deleted, repeated.
- 5 whitespace: collapsed and trimmed.
- 6 markers: ALL leading `ℹ`/`#` marker tokens stripped, repeated.
- 7 after the six steps: empty lines dropped, then the drop class, then comparison of the sequence by equality.

Drop class (shapes): the V8 stack-frame shape (including a trailing ` {`), the runtime banner
`Node.js vX.Y.Z`, and a bare `node:<builtin>[:<line>[:<col>]]` location together with the one-source-line +
caret excerpt V8 prints under it.

Ceilings, stated in the declaration and not as footnotes:
- NON-INJECTIVE ESCAPE: a real tab and a literal `\t` render identically, which is a lock collision.
- SEPARATOR COLLAPSE: backslash count, and `\` versus `/`, are not distinguished.
- TEST NAMES ARE METADATA: they are not captured.
- SYNTHESIZED-SHAPE COLLISION: an author line printed as `Subtest: x`, or after the top-level plan, is not
  captured.
- TEMP MASK over-reach: any first segment under `<tmp>` of 6 or more alphanumerics is masked.
- BENIGN OUTPUT CHURN BREAKS A LOCK: intended, and fail-closed.
- If β rules (A), add: ORDER IS NOT LOCKED.

## 7. Measured facts the next dispatch needs (all premises checked; these are TRUE)

1. **None of the 23 real entries has a node-native `error` value.** All 23 are custom harnesses. node wraps each in
   the process-level block `failureType: 'testCodeFailure'`, `exitCode: 1`, `error: 'test failed'`, which is
   runner-composed. So every real lock comes from comment lines. I2 matters for the falsifier dummy and for future
   entries, and the dummy's capture under the WIP is `["dummy rot: still failing", "1 !== 2"]`.
2. **node emits three single-line YAML literal forms**, not one. It uses `'…'`, switches to `"…"` when the value
   contains `'`, and to a backtick form when it contains both. Also: block scalars indent by key-indent+2, a
   blank line inside a block is rendered as indentation-only (not empty), and nested subtests shift everything by
   4.
3. **Separator step must collapse backslash RUNS.** `requireStack` paths are inspect-escaped inside a comment line
   (`\\\\` in TAP). After unescape they are `\\`, and a one-for-one `\`→`/` leaves `C://Users//…`, which the root
   substitution cannot match. That would leave an absolute, machine-specific path in the lock.
4. **The drop class must cover `node:<builtin>:<line>`, not only `node:internal/`.** `SP-20260518-007/docs-and-skill-bodies`
   prints `node:fs:441` + `return binding.readFileUtf8(…)` + `^`, which is node's own source and varies by node
   version.
5. **Predicted CI variance, pre-committed now:** `errno: -4058` (the win32 ENOENT) in docs-and-skill-bodies (linux
   prints -2). Under the pre-committed interpretation that is a finding about the normalizer.
6. **CI can verify base identity:** `.github/workflows/leak-gate.yml:19` uses `fetch-depth: 0`, so `669aadc1` is
   present. The WIP refuses, and does not skip, when the base commit is absent.
7. **Registration timing:** all 23 run alone sequentially in about 9 s total, so `--verify-base` is cheap enough
   for registration.

## 8. Scope conflict to settle before re-dispatch

This lane's brief puts "the two sprint-authored test files" out of scope. Lane F's brief (F3) says "the capture
lane is authorized to change that file's FIXTURE CONSTRUCTION helpers". I did not touch
`falsify-quarantine-runner.test.js`. Under the WIP contract, cases (b), (e) and (f) need changes:
- (b): helpers can carry it (`withRepo` commits and writes `base` = its own commit; `entry()` gets `causeLines` +
  `observedOn`).
- (e): asserts `missing a non-empty "firstFailingAssertion"`, and the renamed field moves that assertion.
- (f): passes `{ firstFailingAssertion: … }` at the call site.

So (e) and (f) cannot be carried by helpers alone. An assertion or call-site edit is needed and must be disclosed
(A11.1).

## 9. Refused / not done

- Did not choose between §2's options (it is a ruling).
- Did not start a second attempt.
- Did not take the degraded fallback (§5).
- Did not touch `scripts/open-source/partition-loader.js`, the two sprint-authored test files,
  `.github/workflows/**`, or the manifests.
- Did not write `paths.enforcementDebt`. The freeze-extension debt is drafted here for α to file, because a
  lane-branch append to a shared register is a merge-crossing hazard:
  > ED (draft): `tests/quarantine.json` is under no freeze. `checkFreeze` (`scripts/open-source/partition-loader.js`)
  > covers only the codemod deny-list and its occurrence ledger. The register's `base` field is enforced only by
  > run-tests.js's own real-register equality check, and a change is visible only in a diff/review. Extending
  > freeze coverage to the register needs `partition-loader.js`, which another r4 lane owns and which is the
  > open-source loader. **Lane-ownership note:** do not edit it from the capture lane; sequence after that lane
  > lands.
- No full `npm test` was run. HEAD's runner and register equal `132a2222`, so lane A's recorded baseline stands
  unchanged (LOCAL 23/23/0/0/0; CI 23/8/0/0/0 with 15 CAUSE-LOCK; the 8 controls unchanged).
