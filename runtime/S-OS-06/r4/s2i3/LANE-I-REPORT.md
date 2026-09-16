# S-OS-06 r4 — Lane I (I2 → I3 → I4) REPORT

Author: backend-builder (dispatched worker), I4 re-dispatch, 2026-09-16.
Branch `s-os-06/s2i-capture`, base `669aadc1ab7dc03d74f5b95cb613a5573f4e54a6`.
Everything below comes from committed files on this branch. I label each claim as MEASURED (a run
produced it), READ (I checked the code or data by reading it), or INFERENCE (my reasoning, with its basis).

**STATUS: the report is COMPLETE for the I4 brief. The LANE is NOT complete against its spec (§6).**
Five falsifiers are green. F3 is **RED as an unconditional claim** and green only with one named env var
unset. The sprint's own falsifier test file is 8/9 RED against the committed runner. I11 was not done.

---

## 0. Contamination: the plain answer

**Yes. `WARPOS_DISPATCH_BACKGROUND=1`, set by the conductor in the I3 dispatch env, contaminated two of the
results I3 produced: the first two F3 runs.** It did not contaminate F1, F2, F4, F5 or F6 (reasons below).

- MEASURED: `env-toggle.summary.json` records `ambientValue: "1"` in the I3 process. The other WARPOS_/MC_
  vars present were `MC_ACTOR_KIND, MC_BOUND_ROLE, WARPOS_ACTOR_KIND, WARPOS_BOUND_ROLE`.
- **Contaminated:** `stability-committed-quiet10.summary.json` and `stability-committed-load6.summary.json`.
  Their headline, "20/23 entries equal the register every pass", describes the register **in the conductor's
  env**. It is not a property of the register itself. Those two files do not record the var because the field
  was added afterwards (the diff committed in `e5995b03`). They ran in the same I3 process as env-toggle, where
  the var was `"1"`. That dating is INFERENCE from that ordering.
- **Not contaminated, F1/F2 (`swap-experiment`):** none of the 8 swapped files is one of the 3 env-sensitive
  entries. The fidelity arm matched the register 8/8 in the same env, and both arms of each comparison shared
  that env.
- **Not contaminated, F4/F5/F6 (`probe-f456`):** F6 depends on git, not on env. F4 checks the reporter flag
  and a NODE_OPTIONS edge case. F5's idempotence verdict is a property of the normalizer. Its input set of 781
  real raw lines came from a var=1 run, so it includes the deprecation lines. That changes what went in, not
  the verdict.
- Not affected: `falsifier-file-at-e23fb60a.tap`. MEASURED: 0 occurrences of `DEPRECATION` in it.
- **This is the conductor's error to record, not the lane's.** The conductor set the var. Its effect was
  found, isolated with a single-variable toggle and re-measured with the var unset (§3). The corrected runs
  are `*-envctl.summary.json`.
- For the record, my own I4 Bash shell has the var unset. I ran no measurements in I4.

---

## 1. Commits on this lane

| Commit | Lane | What |
|---|---|---|
| `e23fb60a` | I2→I3 | Preserved the predecessor's uncommitted runner + register rewrite and `s2i2/` as-is, without evaluating it |
| `533d0879` | I3 | F1+F2 run (`swap-experiment.*`). Sprint falsifier file measured 8/9 RED (`falsifier-file-at-e23fb60a.tap`). Pre-rewrite runner extracted (`run-tests.132a2222.js`) |
| `bdea84c9` | I3 | F4/F5/F6 probes (`probe-f456.*`). F3 vs the committed register (`stability-committed.js`, quiet10, load6). `env-toggle.*`. `platform-scan.js` |
| `e5995b03` | I4 | On-disk residue committed as-is: env capture + ordering-by-pass in `stability-committed.js`, and `stability-committed-quiet10-envctl.summary.json` |
| `cbf4a41c` | I4 | Report stub + `stability-committed-load4-envctl.summary.json` (written by an orphan, see §8) |
| (this commit) | I4 | This report |

READ: `git diff --stat e23fb60a HEAD -- scripts tests` is empty. **No lane-I3/I4 commit changed the runner or
the register.** Everything after `e23fb60a` is evidence only.

---

## 2. The six falsifiers (spec: `brief-s2i2-capture-corrected.md`, multiset ruling β `2d7f5b83` row 479)

Every measurement below was on **win32, node 24.16.0, reporter tap, one 32-logical-CPU machine**. Evidence
paths are relative to `runtime/S-OS-06/r4/s2i3/`.

| # | Falsifier | State | Evidence |
|---|---|---|---|
| F1 | The 7 degenerate entries become distinguishing: a different sub-case failing FLIPS the lock | **GREEN** | `swap-experiment.summary.json` |
| F2 | The control entry distinguishes sub-cases | **GREEN** | `swap-experiment.summary.json` (row `tests/mc/dispatch-readiness.test.js`) |
| F3 | Multiset stability 23/23 across repeated passes | **RED unconditionally; GREEN only with `WARPOS_DISPATCH_BACKGROUND` unset** | `stability-committed-{quiet10,load6}.summary.json` (var=1), `stability-committed-{quiet10,load4}-envctl.summary.json` (unset), `env-toggle.summary.json` |
| F4 | TAP pinned | **GREEN** | `probe-f456.summary.json` (7/7 F4 checks) |
| F5 | The fixed-point check refuses a non-fixed-point stored line | **GREEN** | `probe-f456.summary.json` (13/13 F5 checks) |
| F6 | `basePath` absent / present-and-correct / present-but-not-a-rename behave as specified | **GREEN** | `probe-f456.summary.json` (12/12 F6 checks) |

### F1: what was run (MEASURED, 1 run, var=1, none of these files are env-sensitive)
- 7 degenerate entries: provider-smoke, S-LC-06 coverage-gate-caller, S-LC-06 mode-profile, S-PF-03
  admin-surface, S-PF-04 founders-checklist, SP-20260611-002 coverage-gate-scan-live-cli, SP-20260611-002
  coverage-gate-scan-source.
- For each: a temporary non-`.test.js` copy with one injected swap. A registered-failing sub-case is forced to
  PASS and a passing one is forced to FAIL, so the failing count is unchanged. The copy runs through the
  committed `runNodeTest` (TAP) + `captureCauseLines`. Copies were deleted in `finally`, and git status is
  clean.
- Fidelity (the unmodified copy) matched the register multiset **8/8**. Swap exit/fail count were [1,1] on all
  8, so `countSummaryUnchanged` is 8/8. **The multiset lock flipped 8/8.** Rebuilding the lock from keyword
  lines only (the s2a P2 approach) was **blind in 7/7** degenerate entries. This shows the old grain could not
  tell them apart and the new one can.
- Population: one swap per entry, one run. This proves the lock *can* tell those two sub-cases apart. It does
  not prove it tells *every* pair apart. The declared ceilings (`CEILINGS` in `scripts/checks/run-tests.js`)
  list the known collisions.

### F2: control (MEASURED)
- `tests/mc/dispatch-readiness.test.js` (92 stored lines). Swap = `KNOWN_DANGLING_REFS is empty by default`
  forced PASS, `exit code: green → 0` forced FAIL. Fidelity matched the register, and **the lock flipped.**
- Note on the entry list: `swap-experiment.js` labels provider-smoke "degenerate + CONTROL" and
  dispatch-readiness "CONTROL (the order-flapping one)". F2 is the dispatch-readiness row. Provider-smoke's row
  also flipped.

### F4: TAP pinned (MEASURED, 7/7)
`nodeTestArgs` pins `--test-reporter=tap`. Every node spawn in `run-tests.js` goes through it (static check).
`runNodeTest` has exactly 3 call sites plus its definition. RED HALF: the pre-rewrite runner (`132a2222`)
passed no reporter flag. A real quarantined run emits the `TAP version 13` header. The register refuses an
entry whose `observedOn.reporter` is `spec`. Edge case: ambient `NODE_OPTIONS=--test-reporter=spec` gives
exit 1 with 0 observed lines and no multiset match. That fails closed; it is not a false green.

### F5: fixed point (MEASURED, 13/13)
- The committed register loads, so every stored line is a fixed point in canonical order.
- These planted lines are each REFUSED: a leading reporter marker, a leading info marker, a double internal
  space, a trailing space, a backslash separator, an escaped hash, a timing value, an absolute repo root, a
  tab, out-of-canonical-order lines, and a drop-class line.
- The normalizer is idempotent over 781 real raw TAP comment lines (23 entries, 1 pass, var=1 env) plus
  200,000 fuzz strings, with 0 counterexamples.

### F6: basePath (MEASURED, 12/12)
- Exactly 5 entries carry `basePath`, all `tests/mc/*` renamed from `tests/warpos/*`. All 23 real entries pass
  the base-identity check (18 absent = identical, 5 present and correct).
- These are refused: absent on a renamed entry (NOT AT BASE); present but not a rename, both the
  another-file's-source case and the still-unrenamed case; basePath naming a file absent at base; basePath
  equal to file; a different base on the real register.
- These are accepted: absent on a non-renamed entry, and present-and-correct.
- RED HALF: a single-path pathspec reports `A`; the pair-limited pathspec reports `R`.
- The real-register base assertion does not apply to fixture registers.

---

## 3. F3 in full: the register's lock depends on the environment

### What was measured
| Run (file) | Env var | Mode | Passes × entries | Entries equal to register every pass | Order-flapping entries |
|---|---|---|---|---|---|
| `stability-committed-quiet10.summary.json` | `1` (inferred, §0) | quiet | 10 × 23 = 230 | **20/23** (200/230 obs) | dispatch-readiness (2 orderings) |
| `stability-committed-load6.summary.json` | `1` (inferred, §0) | load, 32 burners | 6 × 23 = 138 | **20/23** (120/138 obs) | dispatch-readiness (2 orderings) |
| `stability-committed-quiet10-envctl.summary.json` | `<unset>` (recorded) | quiet | 10 × 23 = 230 | **23/23** (230/230 obs) | dispatch-readiness (4 orderings, by pass `[1,2,2,2,2,2,3,1,4,1]`) |
| `stability-committed-load4-envctl.summary.json` | `<unset>` (recorded) | load, 32 burners | 4 × 23 = 92 | **23/23** (92/92 obs) | none observed in 4 passes |
| `env-toggle.summary.json` | toggled | quiet | 2 passes × 3 entries per arm | unset: 3/3 equal both passes. `=1`: 3/3 differ both passes | n/a |

Every observation in all runs had exit 1 and a fail count equal to the register's.

Each run compares every pass **to the register**. This is not pass-to-pass comparison.

### The 3 entries, and what flips
The var does **not** change any test's pass/fail outcome. MEASURED: the failing sub-assertion names, their
`status=` values and the file fail count (1) are the same in both arms. **What flips is the text of the
captured cause lines.** The code under test prints a deprecation warning to stderr at process start:

> `[mc] DEPRECATION: WARPOS_DISPATCH_BACKGROUND is set but MC_DISPATCH_BACKGROUND is not — using WARPOS_DISPATCH_BACKGROUND for now. Rename it to MC_DISPATCH_BACKGROUND; legacy WARPOS_* names stop being read in mc@2.1.0. (One warning per process.)`

The tests embed a child's stderr in their own failure messages. With var=1, this warning becomes the first line
of that stderr. With the var set, each run below had exactly one distinct diff from the register, identical on
every pass (10/10 quiet, 6/6 load):

1. **`tests/regression/SP-20260611-001/epsilon-spawn-grace.test.js`** (51 stored lines): observed-only +1, the
   deprecation line itself as its own cause line. Register-only 0.
2. **`tests/regression/SP-20260611-001/review-fallback-shape.test.js`** (27 stored lines): observed-only 16,
   register-only 9.
   - In all 8 `FAIL …` lines, `stderr=<real first line>` becomes `stderr=<deprecation line>`.
   - The displaced real first lines (`[dispatch-claude] dispatch-contract VIOLATION …` ×5 and
     `[dispatch-shape] review-fallback: sanctioned lane …` ×3) move to separate lines.
   - The register's `stdout={"ok":true,…}` line now appears attached to a displaced stderr line instead.
   - The real content is still captured, but moved.
3. **`tests/regression/SP-20260616-001/wrapper-door.test.js`** (16 stored lines): observed-only 1,
   register-only 1.
   - `FAIL sanctioned --review-fallback + MC_SHAPE_DOOR=enforce → exit 0 (lane not bricked) — status=1 stderr=…`
     changes from `[dispatch-claude] dispatch-contract VIOLATION: shape 'subprocess-claude' is not allowed for
     role 'backend-reviewer' …` to the deprecation line, cut off by the test at `(O`.
   - **The real cause text is gone from the capture entirely.** MEASURED: the register has 1 line containing
     `dispatch-contract VIOLATION`, and 0 such lines remain in the var=1 observation.

### Mechanism (READ)
`scripts/checks/run-tests.js` `childEnv()` passes `{ ...process.env }` to quarantined children and deletes only
`NODE_TEST_CONTEXT` (line ~148). So whatever env the runner's parent has reaches the code under test. The
register records `observedOn` as `{platform, nodeMajor, reporter}` only. It does not record the capture env.

### What this means for trusting the register
1. **Under the measured conditions, the register is accurate *for the env it was captured in*.** With the var
   unset it matched 23/23 every pass: 230/230 quiet and 92/92 under load. It is **not independent of the
   environment**, and nothing in the register or in `CEILINGS` says so. The seven declared ceilings cover
   escaping, separators, test names, synthesized shapes, the temp mask, benign churn and order. **None is an
   ambient-env ceiling.** Its closest relative, "BENIGN OUTPUT CHURN BREAKS A LOCK", covers the effect but not
   the cause.
2. **Direction today is fail-closed, not a false green.** READ: a multiset mismatch pushes a `CAUSE-LOCK:`
   violation (line ~808). `quarantineOk = violations.length === 0`, and `main` returns 1 when that is false.
   So running the gate in a dispatched-worker shell with var=1 gives **exit 1 with 3 CAUSE-LOCK violations**:
   a **false RED** caused by env, not by a regression. I verified this path by reading the code. I did **not**
   run `run-tests.js` end-to-end with var=1. `cannot-assess` beyond the code reading.
3. **A real false-green risk exists if the register is ever re-captured in the conductor's env.** INFERENCE,
   from item 3 of "The 3 entries" above. Under var=1, wrapper-door's capture contains no copy of its real cause
   text. A register captured there would store the deprecation line in its place. That register could not
   detect a change to the real `dispatch-contract VIOLATION` message, because the message would be truncated
   away both times. It would then fail closed in a clean env such as CI. Re-capture env therefore has to be
   controlled, and today nothing controls it.
4. **Time dependency (INFERENCE, from the warning's own text):** the warning says legacy `WARPOS_*` names stop
   being read in `mc@2.1.0`. After that change, var=1 would stop producing the warning, and the code's behavior
   under that name may change too. So the env sensitivity is tied to a version.
5. **Population of the env finding:**
   - ONE variable was toggled (`WARPOS_DISPATCH_BACKGROUND`): 3 entries × 2 passes × 2 arms, plus 10 quiet
     and 6 load passes over all 23 entries in the var=1 env.
   - `MC_ACTOR_KIND`, `MC_BOUND_ROLE`, `WARPOS_ACTOR_KIND` and `WARPOS_BOUND_ROLE` were present and **constant
     in both arms**, so their effect is `cannot-assess`.
   - No other legacy `WARPOS_*` var was tried.
   - "Only these 3 entries are env-sensitive" is established for this one var only. It is not a statement
     about env in general.
6. READ: `.github/workflows/**` contains no `WARPOS_DISPATCH_BACKGROUND`. I did not check whether CI's
   ambient env sets any other WARPOS_/MC_ var.

---

## 4. The 6-pass vs 3-pass evidence (and I3's runs), with populations

| Run | Runner / register | Compared to | Passes × entries | Multiset | Ordered sequence | Env var |
|---|---|---|---|---|---|---|
| `s2i/stability-6.summary.json` (lane I first dispatch) | WIP runner at that time | passes to EACH OTHER (plus `passesEqualToRegister` vs the WIP register of the time) | 6 × 23 = 138 | identical across passes 23/23 | 22/23. dispatch-readiness had **3 distinct sequences** | not recorded |
| `s2i2/observe-register-3.summary.json` (I2 predecessor, 09:28Z) | the runner/register later committed as-is at `e23fb60a` | the REGISTER | 3 × 23 = 69 | equals register every pass 23/23 | 23/23. **no flapping observed** | not recorded |
| I3/I4 runs (§3 table) | committed at `e23fb60a` (unchanged since) | the REGISTER | 10+6+10+4 passes × 23 | 23/23 unset. 20/23 var=1 | dispatch-readiness flapped in 3 of 4 runs (2, 2, 4 orderings). No flap in load4 | recorded for the envctl runs only |

All runs: win32, node 24.16.0, tap, same 32-CPU machine, same base `669aadc1`, one reporter.

**Where they agree:** the multiset. Every run whose env matched the register's capture env saw 23/23
multiset equality: 6, 3, 10 and 4 passes. **Where they disagree:** order.
- The 6-pass saw dispatch-readiness take 3 orderings. The 3-pass saw none.
- I3/I4 saw 2, 2 and 4 orderings, and 1 (no flap) in the 4-pass load run.
- **The 3-pass "no flapping" is an absence over 3 passes × 1 flapping-capable entry, on one machine. It is
  not evidence that order is stable.** The 6-pass, and three of my four runs, *observed* flapping. A seen
  presence beats a thin absence.
- The load4 absence (4 passes) is also thin. The quiet10-envctl run shows the flap is intermittent: pass
  1 → ordering 1, passes 2–6 → 2, 7 → 3, 8 → 1, 9 → 4, 10 → 1.
- This does not affect the lock, because order is deliberately not locked (β row 479). It does mean the 3-pass
  must not be quoted as "order stable".

**Which is better evidence, by question:**
- **Order:** the 6-pass plus I3/I4.
- **Register equality:** I3/I4's runs are better than both earlier ones. They are larger (230 + 92 unset
  observations vs 69), they compare to the committed register rather than pass-to-pass, they include CPU load,
  and they record the env.
- **Env caveat on the 3-pass:** its 23/23 is consistent with a capture env where the var was unset. Neither
  earlier run recorded env, so that is INFERENCE.

**Absence claims in this report, with population:**
- "3 env-sensitive entries": 1 var toggled; 23 entries over 16 full passes with var=1 (10 quiet + 6 load)
  and 14 full passes unset (10 quiet + 4 load), plus 2 toggle passes per arm on the 3 entries.
- "no order flap under load": 4 passes × 23.
- "0 idempotence counterexamples": 781 real lines + 200,000 fuzz strings.
- "0 DEPRECATION in falsifier tap": 1 run.

All on win32, node 24.16.0, tap.

---

## 5. Other probe results (from `probe-f456.summary.json`, beyond F4–F6)

- **I5 PASS:** the register records `basePath` as rename provenance.
- **I6 PASS:** read by eye, no sentence claims the register IS under freeze.
- **I7 PASS:** `$format` no longer declares a temp substitution the code does not perform.
- **I7 reported FAIL, but this is a PROBE DEFECT, not a register defect.** The probe matched `/fails at base/`
  case-sensitively. The register's `$policy` says `The policy says FAILS AT BASE, not fails IDENTICALLY at
  base: the codemod rewrote text inside SP-20260616-001/wrapper-door's own cause line (WARPOS_SHAPE_DOOR
  became MC_SHAPE_DOOR)…`. Read by eye, the claim is "fails at base", as the spec requires. The probe total was
  36 pass / 1 fail; the corrected total is 37/0 on content.
- **I10 PASS:** stored cause lines are not capped anywhere in capture or load.
- **Declared normalizer and ceilings (READ):** `NORMALIZER_DECLARATION`, `DROP_CLASS_DECLARATION` and
  `CEILINGS` in `scripts/checks/run-tests.js` (around lines 32–115). The register must equal them (line ~456).
  The ceilings are NON-INJECTIVE ESCAPE, SEPARATOR COLLAPSE, TEST NAMES ARE METADATA, SYNTHESIZED-SHAPE
  COLLISION, TEMP MASK, BENIGN OUTPUT CHURN BREAKS A LOCK and ORDER IS NOT LOCKED. The non-injective escape is
  stated as a ceiling, as I7 requires. The ORDER ceiling cites "3 orderings in 6 passes". I4's quiet10-envctl
  run saw 4 in 10, which is consistent (it adds data and contradicts nothing). **Missing ceiling: ambient env
  (§3).**
- `platform-scan.js` (I3) scans stored lines for platform- or machine-shaped content. Its output was printed
  to the reaped stdout and **was never saved to a file. Result: `cannot-assess`.**

---

## 6. Does the work on disk implement the spec?

**Partly.**
- F1, F2, F4, F5, F6 and I5/I6/I7/I10 are evidenced green on the committed runner and register.
- **Not done or not green:**
  - **F3** holds only with the env var unset (§3), and the ambient-env ceiling is undeclared.
  - **I11 is not done.** The sprint falsifier file `tests/regression/S-OS-06/falsify-quarantine-runner.test.js`
    was run against the committed runner. MEASURED, 1 run: **1 pass / 8 fail**
    (`falsifier-file-at-e23fb60a.tap`). Cases (a)–(h) fail and (i) "the real tests/quarantine.json is never
    touched" passes. The recorded cause is that the runner refuses the old fixture contract as malformed. The
    I11 red-then-green, and the added inverse case (an unstamped entry is REFUSED), do not exist.
- **Scope conflict, flagged and not resolved:** I11 in `brief-s2i2-capture-corrected.md` authorizes editing
  the falsifier file. The same brief's out-of-scope list says "the two sprint-authored test files (a later
  lane)", and I3 treated this file as outside the lane. I did not edit it. The conductor has to decide which
  lane owns I11.

---

## 7. Refused / not done, and why

- **Did not start new measurements in I4.** The I4 brief forbids new investigations. Everything above comes
  from files that were already committed, plus read-only code and data checks.
- **Did not run the full `run-tests.js` with var=1.** The fail-closed claim in §3 rests on reading the code.
  Running it would be a new measurement.
- **Did not toggle the other 4 WARPOS_/MC_ vars.** That would be a new investigation, so their effect is
  `cannot-assess`.
- **Did not re-capture the register, add an env ceiling, or scrub env in `childEnv()`.** Any of these changes
  the runner or register. That is a spec/β decision (hermetic child env vs a declared ceiling vs a controlled
  capture env), not a builder's call inside a report-only re-dispatch.
- **Did not edit the falsifier file** (§6 scope conflict).
- Did not touch `partition-loader.js`, `.github/workflows/**`, `.claude/settings.json` or the manifests.

---

## 8. Orphan note (MEASURED timestamps; the reap time itself is INFERENCE)

- `stability-committed-load4-envctl.summary.json` has mtime **13:51:21 PDT** (`at` 20:51:21Z,
  `elapsedMs` 226053, so it started about 13:47:35, right when the quiet10-envctl summary was written).
- The I4 wrapper (`dispatch-claude.js backend-builder … brief-s2i4-finish.md`, PID 42812) was created at
  **13:51:01 PDT**. So this file was written about 20 s after I4 started, by a grandchild of the reaped I3
  dispatch that outlived the reap (ED-039/RI-004 class).
- At 13:51:49 no matching node process and no `-e for(;;){}` burner was running. The script's `finally` kills
  its burners, and it completed normally.
- The file is well formed and records its own env, and the run finished all 4 passes. **I accept it as
  evidence**, with the label that it was produced by an orphan.
- The I3 reap as described in the I4 brief (`builder_timeout_reap`, 1200162 ms, stdout 0 B) is consistent with
  I3's first commit at 13:27:21 and this orphan activity. I did not read the dispatch completion record.
