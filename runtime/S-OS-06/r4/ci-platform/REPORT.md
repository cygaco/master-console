# S-OS-06 r4 — CI lane 1 (ci-platform) — REPORT

Branch `s-os-06/r4-ci-platform`, cut from `928f1b4c`. Worktree `.claude/worktrees/S-OS-06-ci-platform`.
**Platform stamp:** every local result below was measured on **win32/node24** (node 24.16.0, libuv 1.52.1). None of them is a linux result. The only linux data here comes from the saved CI log.

Both findings are done. The time box ran over: the register re-emission shifted the committed occurrence ledger, and that needed a regen commit (§4b).

Commits, in order:
| sha | step |
|---|---|
| 165366be | 0 — report stub, committed first |
| 8f1765e4 | 2 — Finding 2: per-platform observed floor; (n) refuses and never skips |
| 2c19e511 | 3 — Finding 1: normalizer step 7, the errno class transform, plus falsifier (o) |
| a6b9fb33 | 4 — whole-register re-observation and re-emission (its own commit) |
| eaac3430 | 4b — occurrence-ledger regen on the lane (α R-39 item c) |
| 954924f7 | 2b — (n)'s refusal prints the undeclared measurement, so the next linux CI log records the floor |

## 1. The two REDs, quoted from the CI log (linux/node22, run 35164425083)

Log: `runtime/S-OS-06/r4/ci/leak-gate-run-35164425083-head-1e06b991-failed.log` (canonical root).

**Finding 1, the errno CAUSE-LOCK**, L10002–L10023:
```
L10002 run-tests: QUARANTINE VIOLATION — CAUSE-LOCK: tests/regression/SP-20260518-007/docs-and-skill-bodies.test.js fails, but the multiset of its cause lines does not equal the registered one ...
L10003     observed but not registered (1):
L10004        1| errno: -2,
L10005     registered but not observed (1):
L10006        1| errno: -4058, Registered on win32/node24, observed on linux/node22: per the pre-committed interpretation this is a FINDING ABOUT THE NORMALIZER, not a violation to wave through.
L10009        2| code: 'ENOENT',      (observed, linux)
L10010        3| errno: -2,
L10018        3| errno: -4058,        (registered, win32)
L10023 run-tests: FAIL — primary: 379 file(s) in 2 batch(es), exit 1 (tests 1260, pass 1255, fail 3, cancelled 0, skipped 2, todo 0) · quarantine: 22 entries, 21 still failing, ...
```

**Finding 2, (n) skipped and the exit gate refused**, L7701–L7702 and L8252–L8265 (again at L8285–L8297):
```
L7702 ok 152 - QUARANTINE-RUNNER (n) OBSERVED FLOOR (β a2f74e09): an EMPTY child env on win32 is refilled with exactly the declared floor # SKIP the floor is declared as a win32 observation only
L8252 not ok 241 - record-trust-exit runs under npm test: a real exit code 0 on the clean tree
L8259     record-trust-exit exited 1
L8260     FAIL [1 fixtures] falsify-quarantine-runner.test.js: skipped=1 todo=0 — a skipped falsifier reads green while guarding nothing
L8265     record-trust-exit: FAIL (4/5 items pass)
L8285 not ok 242 - record-trust-exit GREEN: the real clean tree -> exit 0, all five items PASS, the committed ledger unchanged
```

**Linux floor in the log? No.** I searched the whole log (10,024 lines) for `floor`, `SYSTEMROOT`, `PATH=` and `refill`. The only (n) line is the SKIP at L7702, which printed no measurement. **The linux floor is declared OWED** (§2).

## 2. Finding 2 — the per-platform OBSERVED FLOOR (`scripts/checks/run-tests.js`)

**Shape:** `CHILD_ENV_OBSERVED_FLOOR` is now keyed by platform. Each entry carries `platform`, `nodeMajor`, `names`, `source`, `observedOn` and `evidence`. Only `win32` is declared (node 24, the lane-I7 measurement, unchanged). Every entry is rendered into `$normalizer` element E in sorted key order (`renderObservedFloors`).

**Refusal rule:** `observedFloorFor(platform)` is exported. It returns `{ floor }` only for an OWN entry whose platform stamp matches its key and whose nodeMajor, names, source, observedOn and evidence are all present. Anything else returns `{ refused }`. An absent entry is itself the refusal, so the rule needs no declared platform set. `__proto__`, `constructor` and `toString` also refuse.

**Case (n):** the `skip:` option is gone.
- It plants the refusal on every platform (undeclared names and inherited-property names).
- It asserts the floor for `process.platform`.
- On an undeclared platform it FAILS. The failure message carries the undeclared measurement: the sorted names an empty-env child actually received, plus node and libuv versions. It is evidence, not a declaration.
- I exercised this branch locally with `process.platform` overridden to an undeclared value (win32/node24): exit 1, `# fail 1`, `# skipped 0`, and the message carried the child's names.

**linux value: OWED. It was not observable and is not guessed.** On the next linux CI run, (n) will **FAIL**. That fails the falsify fixture, record-trust-exit item [1], and the two record-trust-exit tests (L8252/L8285 class). **CI stays RED on this item until a linux observation is declared.** That is the intended outcome. The failure message in that run's log is where the observation will come from.

## 3. Finding 1 — the named transform (normalizer step 7)

**The property:** the class is a platform-dependent numeric error code in a captured cause line. That means any `errno` property rendered with an integer value:
- the key is `errno`, bare or in matching `'`/`"` quotes, not preceded by a word character or `$`;
- then `:`, at most one space, and a decimal integer with an optional minus, not followed by a digit or `.`.

If the **running** runtime's own `util.getSystemErrorMap()` names that integer, the integer becomes `<NAME>` (`errno: -4058,` → `errno: <ENOENT>,`). An integer the running map does not name is left unchanged, so its variance fails the lock loudly instead of being masked. Two different codes keep two different names, so discrimination survives.

This rule has no list of numbers or tokens. The old step "7 after the six steps" is now "8 after the seven steps".

**Falsifier (o)** (new, in `falsify-quarantine-runner.test.js`) draws every integer from the running map, so it runs on any platform and never skips. It checks:
- all three renderings (bare, inline inspect, JSON);
- ENOENT and EACCES still differ;
- the output is a fixed point;
- unnamed integers, `myerrno`, `$errno`, `.5` and `exitCode` stay unchanged;
- step 7 is declared.

**Premise check (source `928f1b4c:tests/quarantine.json`):** exactly **one** entry has an errno line (L426 `errno: -4058,`), and its sibling is `code: 'ENOENT'` (L425). The three `code: 'MODULE_NOT_FOUND'` lines (L153/177/201) have **no** errno line beside them. So "every entry that carries an errno line also carries the symbolic form" holds with n=1, but the `MODULE_NOT_FOUND` example is not an errno sibling. This doesn't block anything, because the transform never reads the sibling line; it names the integer through the runtime's map. For the one entry, the result (`<ENOENT>`) equals its sibling code.

**Not measured here:** whether linux node22's `getSystemErrorMap()` names `-2` as `ENOENT`. win32 measurement: the map has 85 entries, `-4058` → `ENOENT`, and `-2` is not in it. The CI log shows linux putting `errno: -2` beside `code: 'ENOENT'` (L10009–10010), which is consistent but is not a measurement of the map. The next CI run is that observation.

## 4. Whole-register re-observation and re-emission (a6b9fb33)

Tool: `runtime/S-OS-06/r4/ci-platform/reemit-register.js --write`. Summary: `reemit-summary.json`. All 22 entries were re-observed ALONE on win32/node24 through the runner's own path (`runNodeTest`, pinned tap, hermetic env, `captureCauseLines`). The tool refuses to write if any entry has no exit code, passes, is truncated, has an empty capture, has a failCount mismatch or produces a non-fixed-point line.
- **refusals 0**; every failCount matched the register
- **entries changed: 1**, `SP-20260518-007/docs-and-skill-bodies`: `errno: -4058,` → `errno: <ENOENT>,`
- **header fields changed: 1**, `$normalizer` (computed over every header key, not asserted)
- declared vs actual: `$normalizer`/`$dropClass`/`$ceilings` come from the runner's exports, and run-tests validation passes (§5)
- **serialization:** one existing hand-formatted byte was normalized, `"base":"669a…"` → `"base": "669a…"` (introduced by 332f168c; value unchanged; recorded in the summary)

**4b. Occurrence ledger (eaac3430).** Adding a `$normalizer` line shifted 5 `tests/quarantine.json` rows in `scripts/open-source/rename-mc.occurrences.json` by one line. That turned record-trust-exit.test's "committed ledger unchanged" RED (win32/node24, first run-tests: exit 1, `fail 1`). I regenerated it deliberately with `rename-mc.js --dry-run` (rc 0, CLAUDE_PROJECT_DIR anchored). Only line numbers moved; no disposition count changed:
- 5 quarantine rows — **this lane**
- 22 TRACKER.md rows — **already present at base**: 85341cf8/38ad2ba6 changed TRACKER.md after the 61632076 regen, and this lane doesn't touch TRACKER.md
- 0 other rows

## 5. Verify — each its own command, real exit code, **win32/node24**

| command | exit | numbers |
|---|---|---|
| `node --test tests/regression/S-OS-06/falsify-quarantine-runner.test.js` | **0** | tests 16, pass 16, fail 0, skipped 0 (win32/node24) |
| `node scripts/checks/run-tests.js` | **0** | `run-tests: PASS — primary: 379 file(s) in 2 batch(es), exit 0 (tests 1261, pass 1258, fail 0, cancelled 0, skipped 3, todo 0) · quarantine: 22 entries, 22 still failing, 0 unexpectedly passed, 0 missing/undiscovered, 0 unobserved, 0 not verified at base` (win32/node24) |
| `node scripts/checks/record-trust-exit.js` | **0** | PASS 5/5; [1] 19 falsify fixtures, 132 tests pass, 0 fail, 0 skipped (win32/node24) |
| `node scripts/checks/framework-purity.js` | **0** | result: OK (win32/node24) |

- **Population 1261** = CI's 1260 + 1, the new falsifier case (o).
- **skipped 3** locally: all three are symlink-permission skips on this Windows user (ok 115, 565, 861), none of them (n).
- All four were re-run after the final commit 954924f7.
- After the first run-tests exposed the ledger shift (exit 1, fail 1), I restored the file the gate had mutated and fixed the shift in eaac3430.

## 6. Expected on the next linux CI run (predictions, not results)
- (n) **FAILS with the linux floor measurement in its message**. Then the falsify fixture, record-trust-exit [1] and the two record-trust-exit tests FAIL. This stays RED until the linux floor is declared from that measurement.
- The docs-and-skill-bodies CAUSE-LOCK should match **if** linux node22's system error map names `-2`. That is unmeasured; CI observes it.
- provider-tier-check (`S-LC-10`) is untouched here (a separate dispatch).

## 7. Flags for α
- **`$ciInterpretation` in `tests/quarantine.json` is now stale.** It says `errno: -4058` was "deliberately NOT normalized away". I left it as written because it is a dated pre-commitment and editing it would be a second header-field change. α should decide whether to add a post-script.
- **Ceiling candidate, not added** (to keep the header-field count at 1): an author line that literally prints `errno: <ENOENT>` collides with a symbolized one. This is the same collision class as `<repo>`/`<tmp>`, which the ceilings don't list either.
- **Untracked side-outputs of the codemod dry-run** (not committed, not mine to delete): `runtime/S-OS-06/rename-occurrences.full.json`, `runtime/S-OS-06/rename-plan.json`.
- Nothing is quarantined. No changes to `scripts/dispatch/*`, `.github/workflows/**`, manifests or `.claude/settings.json`.
