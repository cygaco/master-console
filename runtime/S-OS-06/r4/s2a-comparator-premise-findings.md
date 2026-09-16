# S-OS-06 r4 stage 2 lane A (quarantine comparator): false premises, builder STOPPED

Author: backend-builder (dispatched), 2026-09-16. Worktree `s-os-06/s2a-comparator`, cut from `46bbee50`.
The brief says: "If a premise here is false, prove it and STOP." **Seven premises are false or incomplete.**
Four of them block the build as specified. `scripts/checks/run-tests.js`, `tests/quarantine.json` and
`tests/regression/S-OS-06/falsify-quarantine-runner.test.js` are **unchanged**. This file is the only commit.

Every claim below was measured on this machine: win32, node v24.16.0, `CLAUDE_PROJECT_DIR` unset, forced
`--test-reporter=tap`. Scratch scripts and raw TAP captures are in `$TEMP/s2a/` (not tracked). "Prototype" means
a throwaway extractor in `$TEMP/s2a/proto/`. It reads TAP comment lines only, skips `# Subtest:` and YAML blocks,
applies the repaired predicate, and normalizes: unescape, then `\`→`/`, then `<repo>`/`<tmp>`, then drop timings,
then collapse whitespace, then strip leading markers. It is evidence, not a proposal to ship.

---

## BLOCKING

### P1: A7 "Registration verifies the test EXISTS … at that base": 5 of 23 entries do not exist at `669aadc1`

`git cat-file -e 669aadc1:<file>` fails for all five `tests/mc/*` entries. S-OS-06's own codemod renamed them
(`7021ff55` "T3 part 1: codemod --apply (458 renames, warpos->mc live surface)"):

```
R095 tests/warpos/dispatch-readiness.test.js        tests/mc/dispatch-readiness.test.js       (CONTROL)
R099 tests/warpos/lib/provider-autofix.unit.test.js tests/mc/lib/provider-autofix.unit.test.js (bucket C)
R098 tests/warpos/lib/provider-rca.unit.test.js     tests/mc/lib/provider-rca.unit.test.js     (bucket C)
R099 tests/warpos/product-bootstrap.unit.test.js    tests/mc/product-bootstrap.unit.test.js    (bucket C)
R098 tests/warpos/provider-smoke.unit.test.js       tests/mc/provider-smoke.unit.test.js       (CONTROL)
```

If existence is checked by path, 2 of the 8 controls and 3 of the 4 separator entries are REFUSED. Then the lane
exit criterion (controls still "still failing") cannot be reached. Following renames needs a design choice, and no
ruling covers it. One mechanical fact matters for that choice: git detects the rename only when BOTH paths are in
the pathspec. `git diff -M --name-status 669aadc1 HEAD -- tests/mc/dispatch-readiness.test.js` prints
`A tests/mc/dispatch-readiness.test.js`. Adding the base path prints `R095`. A subtree diff (`-- tests scripts`,
0.03 s) finds all 5.

Options (not chosen):
- (a) An explicit `basePath` register field, verified by a pair-limited `git diff -M` that must print `R`. It is
  visible in the artifact, like `base`.
- (b) An automatic subtree rename map with no new field. It depends on git's default 50% similarity threshold and
  rename limit, both of which would have to be declared.

Both fail closed on a miss.

**At base, all 23 files DO fail** (exit 1, run in a clean `git read-tree` + `checkout-index` of `669aadc1` with
the renamed base path for the five). So "FAILS at base" holds, but only once identity follows the rename.

### P2: A3 "repair both word-boundary faults" does not make the cause visible. In 7 of 23 entries the ordered set degenerates to a count line

Direct evaluation. `REP` = `/(^|\s)(not ok|FAIL(?:ED)?|✖)(?!\w)|Error\b|AssertionError/`:

```
old=false repaired=true  "S-LC-06/coverage-gate-caller fixture-test: 7/8 passed, 1 FAILED"
old=false repaired=false "  - auditLedger: a clean backed+proof ledger has 0 gaps: expected PASS, got {"ok":false}"
old=false repaired=false "  - mode_profiles.sprint.alpha_only_shapes === ['in-process-agent'] (ED-041): Expected values to be strictly deep-equal:"
old=false repaired=false "  - real-scaffold-admin-surface-passes: Expected values to be strictly deep-equal:"
old=false repaired=false "  - AC-3.2: corrupt catalog → exit 1 (not 2): exit=0 stderr="
old=false repaired=true  "✖ name (1ms)"
```

The diagnosis's corrections block lists the `- auditLedger:` line as one the predicate "cannot see". That miss is
NOT a word-boundary fault. The line carries no keyword, so no boundary repair reaches it. Under the repaired
predicate, the whole locked set for these entries is a pass/fail COUNT summary that names no sub-case:

| entry | locked set under the repaired predicate |
|---|---|
| `tests/mc/provider-smoke.unit.test.js` (**CONTROL**) | `FAIL — 7 of 68 cases failed:` |
| `S-LC-06/coverage-gate-caller` | `S-LC-06/coverage-gate-caller fixture-test: 7/8 passed, 1 FAILED` |
| `S-LC-06/mode-profile` | `S-LC-06/mode-profile fixture-test: 10/11 passed, 1 FAILED` |
| `S-PF-03/admin-surface` | `S-PF-03 admin surface: 11 passed, 3 FAILED` |
| `S-PF-04/founders-checklist` | `S-PF-04 founders checklist: 5 passed, 1 FAILED` |
| `SP-20260611-002/coverage-gate-scan-live-cli` | `SP-002-FIX1-G3a/…: 4/7 passed, 3 FAILED` |
| `SP-20260611-002/coverage-gate-scan-source` | `SP-002-WS-G3a/…: 4/6 passed, 2 FAILED` |

In each of these, a DIFFERENT sub-case failing with the same count yields an identical ordered set. That is the
false green β's ordered-set ruling (row 473 §2) exists to prevent. It would ship reading as fixed.

Needs a ruling on capture breadth. Options, not chosen:
- (a) A declared "failure block" rule: the detail lines under a matching line.
- (b) All test-authored comment lines, minus a declared drop class (stack frames, `Node.js vN`,
  `node:internal/...:L:C`). Stronger, but more node-major variance.
- (c) Accept summary-grain locks with a per-entry disclosure field.

### P3: node:test-native failures have NO capturable cause line under TAP, and the falsifier's dummy is one

The falsifier's `FAILING` dummy under TAP (full relevant output):

```
# Subtest: dummy rotted
not ok 1 - dummy rotted
  ---
  ...
  error: |-
    dummy rot: still failing

    1 !== 2

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  ...
```

There is no comment line. The only non-synthesized cause text is inside the YAML diagnostic `error:` value.
- **If YAML diagnostic lines count as reporter-synthesized** (they are the reporter's rendering), the dummy's set is
  EMPTY. The entry is refused as an empty capture, so case (b) cannot return to exit 0 through an
  `entry()`/`withRepo` edit alone, which is A11 condition 1. Also, NO node:test-native failure could ever be
  quarantined.
- **If YAML lines are scanned by the keyword predicate**, the set is `name: 'AssertionError'`. The message
  `dummy rot: still failing` has no keyword and is invisible. A different assertion in the same test would read
  identical.

A correct capture needs a structured rule for the `error` field of each `not ok` diagnostic block. That field uses
two escaping regimes that differ from comment lines, as measured with a probe below: block scalar `|-` with raw
content (a real tab and a single `\`), and a quoted form for single-line values (e.g.
`location: 'C:\\Users\\...'`). No ruling covers either regime.

### P4: A7 "a visible register amendment under `checkFreeze`": `tests/quarantine.json` is not under any freeze

`checkFreeze` (`scripts/open-source/partition-loader.js:955`) reads only `DENYLIST_PATH` =
`scripts/open-source/rename-mc.denylist.json` (:56) and its occurrences ledger (:57), marked
`partition-amendment:`. No script references `tests/quarantine.json` except `run-tests.js`, the falsifier and the
two manifests. The runner's own assertion that the real register's base equals `669aadc1` can be built, but
"changing it is a visible amendment under checkFreeze" has no mechanism. It would need either an extension of
`partition-loader.js`, which is S-OS-06's open-source loader and is touched by other r4 lanes, or a new freeze for
the register. Needs a ruling on which, and on lane ownership, before anyone edits `partition-loader.js`.

---

## NOT BLOCKING, but required inputs to whoever builds this (measured)

### P5: the normalizer must cover a random `fs.mkdtemp` suffix, or `wrapper-mode-binding` cannot lock

Prototype, 3 consecutive runs at head plus 1 at base. **22 of 23 entries give byte-identical ordered sets on
every run, and order never flapped.** The one exception differs only in the 6-character mkdtemp suffix inside its
`AssertionError` line:

```
run 0: ... open '<tmp>/SP-20260611-002-T321-mode-QWLkmu/.claude/agents/_org/role-registry.json'
run 1: ... open '<tmp>/SP-20260611-002-T321-mode-sN9RdY/...'
run 2: ... open '<tmp>/SP-20260611-002-T321-mode-sBH2jn/...'
base : ... open '<tmp>/SP-20260611-002-T321-mode-jnOVSv/...'
```

It needs a declared transform: the temp dir → `<tmp>`, plus a mask on the mkdtemp suffix of the first segment under
`<tmp>/`. **Pre-existing `$format` dishonesty (A10):** `$format` says "the OS temp dir <tmp>", but `run-tests.js`
never substituted the temp dir. `normalizeFailure` at :219-226 has no tmp step.

Separately, `$format` repeats its v2 clause three times verbatim (`tests/quarantine.json:4`).

### P6: A2 "unescape TAP": node 24's TAP escape is NOT injective, so unescape is only a partial inverse

Probe (`$TEMP/s2a/esc/esc.test.js`, `node --test --test-reporter=tap`):

```
source  "OUT1 back\slash hash# tab<TAB>X cr<CR>Y ..."   ->  # OUT1 back\\slash hash\# tab\\tX cr\\rY ...
source  "OUT2 literal-backslash-t \t and \n and \\ and \#"  ->  # OUT2 literal-backslash-t \\t and \\n and \\\\ and \\\#
```

A real TAB and a literal backslash-`t` both emit `\\t`. The declarable decode is a single left-to-right scan:
`\\`→`\`, `\#`→`#`. Control-character escapes stay as two characters. It applies to comment and test-name lines
only, not to YAML values (see P3). Only then does the separator step `\`→`/` run (β's ordering trap holds).

### P7: `$policy` "identically on the pre-sprint base 669aadc1" is false for `wrapper-door`

At base, 21 of 23 ordered sets are identical to head, after root substitution with the base tree as `<repo>`. One
differs by the mkdtemp suffix (P5). `SP-20260616-001/wrapper-door` differs because the codemod rewrote text INSIDE
its cause line:

```
head: FAIL sanctioned --review-fallback + MC_SHAPE_DOOR=enforce → exit 0 (lane not bricked) — ...
base: FAIL sanctioned --review-fallback + WARPOS_SHAPE_DOOR=enforce → exit 0 (lane not bricked) — ...
```

So any base check can require "fails" (exit ≠ 0), which holds for all 23. It cannot require "the same cause set"
unless it maps the codemod.

### Idempotence note for the symmetric-equality design (A4/A5)

If the register stores normalized text and both sides pass through the normalizer, the normalizer must be
idempotent. Stripping a single leading `# ` is not idempotent. `SP-20260518-008/hooks-and-diagnostics` prints
`\# 12 passed, 1 failed` under TAP. That becomes `# 12 passed, 1 failed` after one pass and `12 passed, 1 failed`
after two. A declaration that works:
1. unescape
2. `\`→`/`
3. root, then tmp
4. drop timings
5. collapse whitespace
6. strip ALL leading `(?:ℹ|#)(?: |$)` tokens (the `counts()` alternation)

After that, the loader can refuse any stored line that is not a fixed point of the normalizer.

---

## Quarantine tallies and control group: before = after (nothing was changed)

This tree's `scripts/` and `tests/` equal the r4-ci baseline tree: `git diff --stat ab2d7466 46bbee50 -- scripts tests`
is empty. The r4-ci `ci-control-baseline.md` therefore stands unchanged for this lane:
- **LOCAL** (spec reporter): 23 entries / 23 still failing / 0 unexpectedly passed / 0 missing / 0 unobserved.
- **CI** (TAP): 23 / 8 / 0 / 0 / 0, with 15 CAUSE-LOCK.
- **The 8 controls:** unchanged in both.

A confirming local run of the unmodified runner on this worktree is recorded below.

**Confirming run on this worktree:** `env -u CLAUDE_PROJECT_DIR node scripts/checks/run-tests.js` on the unmodified
runner. Real exit code 1, captured with `$?` and not piped.

```
run-tests: FAIL — primary: 374 file(s) in 2 batch(es), exit 1 (tests 1194, pass 1188, fail 3, cancelled 0,
skipped 3, todo 0) · quarantine: 23 entries, 23 still failing, 0 unexpectedly passed, 0 missing/undiscovered,
0 unobserved
```

- **QUARANTINE VIOLATION lines:** 0.
- **All 8 controls:** "still fails (exit 1)", each with the same captured line as the baseline.
- **Primary failures:** the same 3 the baseline recorded: `record-trust-exit.test.js` GREEN,
  `roadmap-board-failsoft`, `roadmap-board-render`.

**Side effect, disclosed:** the full suite REWROTE the tracked `scripts/open-source/rename-mc.occurrences.json`
(`pinned` 316→320, from a new `TRACKER.md:7` evidence-tag row). It also left untracked
`runtime/S-OS-06/{fixture-product/,rename-occurrences.full.json,rename-plan.json}`. This builder reverted and
removed all of them; the worktree was clean before the run. The ledger rewrite is the same drift the baseline
attributes to `record-trust-exit GREEN`. It belongs to that lane and is not touched here.

## Refused / not done

Nothing was registered, re-captured or edited. A1–A13 were not built. A12 sequencing puts the normalizer
declaration first, and that declaration depends on the P2/P3 capture rulings. A13 re-registration depends on P1
(base identity for 5 entries) and P4 (the freeze). `record-trust-exit-runs.test.js` and `.github/workflows/**` were
not touched.
