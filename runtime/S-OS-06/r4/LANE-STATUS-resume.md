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
