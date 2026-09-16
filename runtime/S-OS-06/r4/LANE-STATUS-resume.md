# S-OS-06 r4 — LANE STATUS at resume (ε, 2026-09-16)

Reconciled by ε against the worktrees themselves, not against the resume brief. Every `ahead` below was
re-measured with `git -C <wt> rev-list --count b84a3e46..HEAD`. All 12 counts matched α's table exactly.

Sprint branch `open-source/S-OS-06` @ `b84a3e46`, 6 ahead of `origin/open-source/S-OS-06`, merge-base with
`origin/main` = `669aadc1` (clean ff available; landing is operator-only).

## 1. Orphan-dispatch adjudication (the three `started` rows with no completion)

Verified in `.claude/runtime/dispatch-completions.jsonl`; exactly three, at the timestamps α named:

| dispatch_id | started | disposition |
|---|---|---|
| `d-mu3w3puo-839b5b83` | 09:19:59.904Z | no completion record |
| `d-mu3w6tkk-416b55b7` | 09:22:24.692Z | no completion record |
| `d-mu3wbn4u-92325704` | 09:26:09.631Z | no completion record |

**None is still running.** Live-process sweep (`Win32_Process`, name `node.exe`/`claude.exe`) shows only
Adobe CC, the Codex desktop app, and this session's own `claude.exe` (PID 26616, started after the death).
No `dispatch-claude.js` grandchild survives. The worktrees are safe to dispatch into — no revive-race.

## 2. Lane table

`ahead` = commits ahead of `b84a3e46`. `dirty` = uncommitted files in the lane worktree.

| Lane | Branch | ahead | dirty | State | Merge this round? |
|---|---|---|---|---|---|
| B/J-1 codemod | `s-os-06/s2b-codemod` | 5 | 5 (untracked instruments) | Part 1 DONE incl. B2 removal-history teeth (`43f9e007`) + B4 rework (`92865fee`, β `8e5f3a02`). Part 2 alias-drop BLOCKED | **YES — first** |
| D histproof | `s-os-06/s2d-histproof` | 1 | 0 | DONE | YES |
| E linux | `s-os-06/s2e-linux` | 2 | 0 | STOPPED, premise false; evidence inlined | YES (evidence) |
| H hermeticity | `s-os-06/s2h-hermeticity` | 2 | 0 | H1 DONE (β `7d3e9f51`); H2 STOPPED vacuous; H3 = ED-435 | YES (H1 + report) |
| Oracle stage 1 | `s-os-06/r4-oracle` | 2 | 0 | DONE — 514 candidates / 737 tokens / 4426 files | YES (before G) |
| G join | `s-os-06/s2g-join` | 6 | 0 | G4+G5 DONE — 22 rewrite = 16 restored + 5 deferred + 1 held; 21 authored → K | YES (after oracle) |
| C warp | `s-os-06/s2c-warp` | 4 | 3 (untracked instruments) | MEASURED — 3339 violations (613 uncontested + 2726 contested); no fix | YES (measurement) |
| F measure | `s-os-06/s2f-measure` | 1 | 0 | MEASURED — record-trust-exit downstream of reporter-dependent capture; fix waits on I | YES (measurement) |
| A comparator | `s-os-06/s2a-comparator` | 1 | 0 | STOPPED on false premises; 7 measured findings | YES (evidence) |
| CI platform | `s-os-06/r4-ci` | 2 | 3 (untracked instruments) | STOPPED — five false premises before T1–T6; adds a T7 control-baseline test | YES, flagged (see §4) |
| **I capture** | `s-os-06/s2i-capture` | 3 | **2 tracked + 1 untracked dir** | **Work on disk, unadjudicated — see §3** | NO — resume first |
| K properties | `s-os-06/s2k-properties` | 3 | 0 | Inventory MEASURED (2085 allow-listed, 1666 with occurrence); per-file adjudication NOT done | NO — dispatch first |

## 3. Lane I — the died dispatch finished its measurement; it just never got to speak

This is the one place where α's reconstruction is incomplete, and it changes the plan.

`dispatch-s2i2.out` is 0 bytes, so at the ledger lane I reads as a dead dispatch that produced nothing.
It is not. The worktree carries **1,233 uncommitted lines**:

```
scripts/checks/run-tests.js | 721 +++++++++---
tests/quarantine.json       | 668 +++++++++++-
```

plus `runtime/S-OS-06/r4/s2i2/` (`build-register.js`, `observe-register.js`, and a 7,925-byte
`observe-register-3.summary.json`).

The summary is stamped `2026-09-16T09:28:11.514Z` — roughly one minute before the session died. Its
headline fields, over 23 entries and 3 passes at base `669aadc1` on win32/tap:

| field | value |
|---|---|
| `multisetEqualsRegisterEveryPass` | 23 of 23 |
| `orderedSequenceStableAcrossPasses` | 23 of 23 |
| `orderFlappingEntries` | `[]` |

### CORRECTION — my first read of this was wrong, and the older evidence is the better evidence

I initially reported that this run's empty `orderFlappingEntries` left the order-flap premise unsupported.
That was a true statement about a 3-pass run and a misleading headline. I then read the PRIOR six-pass
measurement, `runtime/S-OS-06/r4/s2i/stability-6.summary.json`, which the corrected brief explicitly says
is already measured and must not be re-measured. It records, for the control entry
`tests/mc/dispatch-readiness.test.js`:

| field | value |
|---|---|
| `seqIdenticalAllPasses` | `false` |
| `distinctSequences` | **3** |
| `multisetIdenticalAllPasses` | `true` |

with a `dispatchReadinessOrderings` array holding all three distinct orderings.

**The order flap is real and confirmed.** My 3-pass run simply failed to catch it, which is the expected
behaviour of a thin sample against a probabilistic flap — 3 passes is not a falsifier for this, and the
empty array was my sample's silence, not the system's stability.

What the two runs actually agree on is the thing that matters: **the multiset holds in both.** Six passes
say `multisetIdenticalAllPasses: true`; three passes say 23 of 23. That is nine passes of corroboration for
β's multiset ruling (`2d7f5b83`), and zero evidence against it. β's ruling stands, better supported than
before, and falsifier 3 in the corrected brief ("23 of 23 under the multiset") is the one the evidence
speaks to.

**The remaining caution, which I am not resolving myself.** The builder never authored a finding — the
0-byte out-file means no first-person verdict exists. A fresh spawn cannot honestly author what the dead one
concluded, and I will not write lane I's conclusion on its behalf.

So lane I gets **one RESUME dispatch, not a rebuild** — commit the work that already exists, author its own
finding against the corrected multiset spec, and state explicitly whether 3 passes discharges the
order-flap premise or whether that premise survives as a named residual with the measurement attached.
Re-running from scratch would discard 1,233 lines of completed work to re-derive the same numbers.

## 4. Gate risks I am carrying into the merge

- **CI lane adds a test.** `8a14e420` is a real T7 control-baseline test, not a doc. Merging it puts a new
  test in front of the local gates. If it is red, that is the lane's own finding surfacing, not a
  regression I introduced — I will report it as such rather than quarantine it.
- **Untracked instrument files** (`runtime/S-OS-06/fixture-product/`, `rename-occurrences.full.json`,
  `rename-plan.json`) appear in four worktrees AND in the sprint root. They are generated, untracked, and
  I am not committing them blind.
- **Dirty tracked files in root** — `.claude/settings.json` and `scripts/open-source/rename-mc.occurrences.json`.
  α flagged both as unattributed. I am not committing either; they stay out of every merge commit.
- **Oracle lane hit a permission wall.** `dispatch-oracle.out` records `reaped:true`,
  `reason:"builder_timeout_reap"`, with stderr naming a blocked `Write(.claude/manifest.json)` allow-rule.
  Its 2 commits landed anyway. Manifest regeneration is a close-step requirement, so that wall will be hit
  again at close and is likely an operator-gated action.

## 5. Proposed merge order

Dependency-first, and it satisfies β row-478 (`6e2a91f4`) structurally rather than by care: lane B's
removal-history teeth land FIRST, so no alias-retirement removal-only amendment can possibly precede them.
Lane J Part 2 (the only alias-drop work) is blocked and merges nothing this round, so the constraint is
doubly satisfied.

1. **B** (teeth first — row-478)
2. **D**
3. **E**
4. **H**
5. **Oracle stage 1** (before G: G carried the stage-1 instrument bytes byte-identical at `deb0be10`; merging
   oracle first avoids a duplicate-add conflict)
6. **G**
7. **C**
8. **F**
9. **A**, then **CI** (evidence + the flagged T7 test, last so a red gate is attributable)

Local gates after the merges, each run as its own command with its real exit code read (never piped through
`tail` in a `&&` chain): framework-purity, leak-gate, privacy, cutover-completeness, record-trust-exit,
codemod dry-run.

## 6. Dispatches this round

| Lane | Action | Why |
|---|---|---|
| I | ONE **resume** dispatch | Corrected spec exists (β `2d7f5b83`); work is on disk; must author its own finding |
| K | ONE dispatch | Per-file adjudication over `_planning/**` (387), `tests/regression/S-OS-06/**` (168), 1 `.github/**`, 21 authored join members |
| J Part 2 | **ROUTED, not run** | Needs the α Class B scope ruling AND an operator-only `leak-gate.yml` L36 edit |

Named residuals, each carrying its measurement rather than a fix: CI lane (five false premises), A
(7 findings), E (clean-checkout hermeticity, not CI-platform), H2 (vacuous on a bare host), H3 (ED-435),
F's fix (sequenced after I).

---

# PART 2 — Lane I and lane K outcomes (ε, after the resume dispatches)

## The dispatch lesson, recorded because it cost a full cycle

Both lanes were first re-dispatched with a **100-minute time box inherited from an earlier ratified brief.**
The wrapper hard-kills at 20 minutes. Both died at exactly 1200162 ms and 1200364 ms,
`reason: builder_timeout_reap`, **stdout 0 bytes**. Their WORK survived on disk; their REPORTS did not,
because the reports existed only in stdout.

Re-dispatched narrowed, ordered to **commit first and write the report TO A FILE second**, both finished in
**394 s and 338 s** with `ok=true`, real stdout, and committed reports. Same builders, same work, same models.
The difference was the brief.

Two rules follow, and they are now conductor defaults:
1. Never write a time box larger than the wrapper bound. If the work needs more, SPLIT it.
2. Order every build-chain builder to commit, then write its report to a named file, then analyse.
   A committed report survives a reap. stdout does not.

## Lane K — COMPLETE, merged at `b7f5517b`

| Set | Files | Occurrences |
|---|---:|---:|
| A (instrument) | 35 | 2520 |
| B (record) | 1437 | 23854 |
| **RESIDUE (the fix population)** | **206** | **1013** |
| cannot-assess | 5 | 5 |
| CI hit, identified but unruled | 1 | 1 |
| REMOVED | 0 | 0 |

Self-reconciling: 1684 adjudicated equals 1684 with-occurrence. Counted its own round artifacts INSIDE the
swept population per section 7b rather than excluding them by path.

**It contradicts β's recorded expectation in two places and says so plainly** rather than bending to fit:
a live README describing the present repository by the legacy brand, and an ADR whose mitigations and
reversal-plan sections are OPERATIVE instructions naming legacy-prefixed variables, not records. Both
contradictions are with β for ruling.

## Lane I — report COMPLETE, lane NOT complete, HELD OUT of the merge

Five falsifiers green (F1, F2, F4, F5, F6). **F3 is RED as an unconditional claim.**

The register's cause-line lock is **environment-dependent, and nothing declares it.** Mechanism, read from
the code: the runner passes the full ambient environment to the quarantined children it captures, deleting
only one variable. Any ambient variable that makes the code under test write to stderr displaces the
captured cause text. Measured: one variable set → 3 of 23 entries diverge every pass (10 quiet + 6 load);
unset → 23 of 23 match (230 quiet + 92 load observations).

For one test the real cause text is **absent from the capture entirely**, replaced by a deprecation line.
A register re-captured in that environment could never detect a change to the assertion it exists to lock.
Today the direction is fail-closed (a false RED, not a false green), but **re-capture environment is
uncontrolled.** None of the seven declared ceilings is an ambient-environment ceiling.

**The variable was set by ME, the conductor, when dispatching the lane.** Recorded as conductor error.
The lane isolated it with a single-variable toggle and re-measured with it unset, which is why the mechanism
is known and not merely the symptom.

Also open on lane I:
- **I11 not done**, and the corrected brief contradicts itself: it authorizes editing the falsifier file AND
  lists that file as out-of-scope. The builder refused to pick and flagged it. With β.
- The sprint's own falsifier file measures **1 pass / 8 fail** against the committed runner.
- An **orphan grandchild of the reaped dispatch** wrote one summary file ~20 s after the next dispatch
  started (ED-039/RI-004 class). The builder accepted it as evidence and labelled it as orphan-produced.

**Why held:** lane I's only substantive payload is the 1233-line runner and register rewrite; everything
else on the branch is evidence. Merging would put a runner on the branch whose own falsifier file is 8/9 red
and whose remedy is exactly what β is being asked to rule on.

## Gate state at `b7f5517b` (clean detached worktree, not the root)

| gate | rc |
|---|---|
| framework-purity | 0 |
| leak-gate | 0 |
| cutover-completeness | 0 |
| record-trust-exit | 0 |
| privacy | 0 |
| npm test | 0 — 377 files, 1225 tests, 1222 pass, 0 fail, quarantine 23/23 still failing as expected |

Platform caveat, not glossed: measured on win32; CI runs Linux, and lane E's finding is that its failures are
clean-checkout hermeticity defects. This licenses "green at this head from a clean checkout on this
platform", NOT "CI will be green".

---

# PART 3 — Lane J and lane I5 outcomes, and two rulings outstanding

## Lane J — HELD on a governance contradiction. REMOVED = 0.

β `c7a4e2b9` / α r-03a overruled the conductor's defer-as-a-unit proposal. Blocked-ness is **PER MEMBER**:
the live-consumer break is demonstrated for ONE of the sixteen shims and undemonstrated for fifteen.
Deferring all sixteen was "one list answering two questions"; for the fifteen the same words would be
"a warrant in compat costume". **The conductor assembled that bag and β was right to refuse it.**

The builder then did the work per member and hit a genuine contradiction between two governing decisions:

| Form | B2 teeth (`cutover-completeness`, F8) |
|---|---|
| α r-03a as written — shim delete + alias-map retire + partition rows in ONE commit | **exit 1.** A post-freeze partition removal must be its OWN warranted amendment commit, never folded into a gate-fixing commit. That was the only problem; marker and all 15 removal records passed. |
| Split — a code commit, then a partition-only amendment commit | **exit 0, zero problems.** |

**Both rulings cannot hold**, and no ordering makes every commit green — only the head. Code-first gives 15
stale-member errors; partition-first leaves live legacy files with no register row. β row-478 ordered the
teeth to land FIRST precisely so a retirement would be checked by them, and they have now checked a ruling
made after them. The builder did not guess. **Awaiting α.**

**15 of 15 per-member consumer checks PASS**, run BEFORE any removal, method stated per member. Fourteen are
referenced only by the alias map, partition rows and closed-sprint prose. The fifteenth (structure-parity)
has a genuinely executable consumer in old release capsules' post-update checks; the builder read the update
code, showed a missing script yields *degraded* not *failed*, and cited a precedent deletion. Characterized,
not waved away.

**Landing-mechanics warning MEASURED AND NOT REPRODUCED.** The report warned a merge commit would recreate
the rejected form because F8 judges a merge by first-parent diff, and said plainly it had NOT tested that.
The conductor tested it: merging the green split into the sprint head yields `cutover-completeness` rc=0,
`framework-purity` rc=0, `leak-gate` rc=0. Probe branch `eps-mergecase-probe` @ `b054b9ac`, not for landing.
An untested warning is a hypothesis; three minutes of measurement retired it.

**The owed oracle-(ii) measurement is ANSWERED on that same tree:** `violations=0`, residue 0, over 23597
occurrences in 4457 files, exit 0. **The retained filename does NOT create a violation, so section 5.1's
zero IS satisfiable with the deferral applied** — no section-1 amendment, no trigger-keyed residual slot.
Caveat: β later narrowed sequencing to spend no oracle measurement until the lane I remedy lands. This run
predates that line reaching me; it stands for the tree measured and **must be re-run on the final head**.

**Carried correction:** β verified the quarantine register already carries per-entry `expiry`/`expiryVersion`/
`filedUnder` with a case enforcing expiry at runtime. The deferred shim's per-entry expiry must COPY that
shape rather than the invented one lane J built — which also gives the deferred member a falsifier.

## Lane I5 — fixture diagnosis COMPLETE; a runner defect and a vacuous falsifier

β `a5e2c418` removed the licence to edit eight assertions: the signature (only the non-spawning case passes)
is a SHARED FIXTURE defect, not eight reversals. Correct, and the shared cause was in the helper — three
layers, all construction: missing register header fields, outdated entry format, and a fixture repo that
never committed so no base commit existed. Construction-only fix, nine case bodies proven byte-identical by
comparison: **1/9 → 6/9**.

**β's prediction was CONTRADICTED**, as β invited. Predicted: helper explains 7 of 8, only (b) genuine.
Measured: helper explains **5 of 8**; **(b) is not a contract flip**; **(e) is the genuine one**.

**(b) and (h) share a RUNNER defect.** The diagnostic parser expects YAML keys two spaces deeper than the
marker; node 24's reporter emits them at the SAME indent. No key matches, the authored error value is never
captured, the observed cause set is EMPTY, and the runner reports vacuity before reaching either case's
branch. Proven by a mutant matrix over temp mirrors: fixture-alone cannot fix it, runner-alone cannot fix it,
only both together with assertions byte-unchanged.

**β's own falsifier (f) is PASSING VACUOUSLY.** Green on the committed state — but neutralizing the multiset
lock (f) names leaves it GREEN. It passes through the vacuity branch the parser defect creates, so today it
would not detect removal of the guard it exists to protect. With the parser fixed it fails alone, so the
assertion is sound and only its environment is not. **β's insistence that each falsifier be demonstrated
red-then-green INDIVIDUALLY, never absorbed into a suite green, is what caught this.** (g) discharged.
(h) red for the parser cause, not its own. Side finding: **no case covers the vacuity branch itself.**

**A false green was available and DECLINED.** Rewriting the failing dummy to emit its cause as a comment line
would turn (b) and (h) green. The builder refused: it routes around a dead capture path the runner claims to
have.

**Scope limit, not upgraded:** effect on the REAL register was checked STATICALLY. No real entry imports the
node test module and their comparison lines arrive as TAP comments, so a parser fix is not expected to change
it. Re-running all 23 under a fixed parser is **cannot-assess**.

## Outstanding — nothing further can land without these

| Ruling | Owner | Blocks |
|---|---|---|
| Same-commit vs partition-only-commit retirement form | α | lane J landing (green split is built) |
| Ambient-environment remedy; does F3 red block the stop-condition | β | lane I landing |
| Runner diagnostic-parser key-indent fix | β/α | (b), (h), and falsifier (f)'s non-vacuity |
| Case (e) assertion literal (the one genuine contract flip) | β/α | (e) |
| Lane K's two measured contradictions of β's residue expectation | β | lane K's sets being final |
| CI green on the final head | **operator only** | section 5.5 — no agent in this session can close it |
