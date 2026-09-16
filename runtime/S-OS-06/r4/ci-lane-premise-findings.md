# S-OS-06 r4 CI-PLATFORM lane — false premises found before build (builder STOPPED)

Author: backend-builder (dispatched), 2026-09-16, worktree `s-os-06/r4-ci` @ `8a14e420`.
The brief says: "If you find a premise in this brief that is FALSE, say so with the evidence and stop rather
than building on it." Five premises are false. `scripts/checks/run-tests.js` and `tests/quarantine.json` are
**unchanged**. Only T7 (control baseline) is done: `ci-control-baseline.md`.

Evidence sources:
- **CI**: `gh run view 34909939581 --log` (leak-gate on `cf11478c`, ubuntu, node 22). "log N" means line N of that output.
- **LOCAL**: this worktree on win32 with node v24.16.0 and `CLAUDE_PROJECT_DIR` unset. Raw outputs are on disk under `$TEMP/sos06ci/` and `ci-control-baseline.raw.out`.

---

## F1 — "The 6 empty-capture entries CANNOT be fixed from Windows; harvest them from a real Linux CI run": FALSE, and the harvest would register a vacuous lock

For all 6, **CI's observation is the TAP reporter's synthetic file-result line, which holds the file's own path and no cause**:

```
log 9976   observed:   not ok 1 - tests/regression/S-LC-06/coverage-gate-caller.test.js
log 9979   observed:   not ok 1 - tests/regression/S-LC-06/mode-profile.test.js
log 9982   observed:   not ok 1 - tests/regression/S-PF-03/admin-surface.test.js
log 9985   observed:   not ok 1 - tests/regression/S-PF-04/founders-checklist.test.js
log 10000  observed:   not ok 1 - tests/regression/SP-20260611-002/coverage-gate-scan-live-cli.test.js
log 10003  observed:   not ok 1 - tests/regression/SP-20260611-002/coverage-gate-scan-source.test.js
```

After T1 strips `not ok <N> - `, the "assertion" is just the filename. Harvesting it gives a lock that
matches **any** failure of that file. T3 as written would accept it, because it is not the placeholder string.

The real cause lines exist **on both platforms**. The capture predicate misses them. Local runs:

```
coverage-gate-caller: "S-LC-06/coverage-gate-caller fixture-test: 7/8 passed, 1 FAILED"
                      "  - auditLedger: a clean backed+proof ledger has 0 gaps: expected PASS, got {"ok":false}"
mode-profile:         "S-LC-06/mode-profile fixture-test: 10/11 passed, 1 FAILED"
                      "  - mode_profiles.sprint.alpha_only_shapes === ['in-process-agent'] (ED-041): Expected values to be strictly deep-equal:"
admin-surface:        "S-PF-03 admin surface: 11 passed, 3 FAILED"
                      "  - real-scaffold-admin-surface-passes: Expected values to be strictly deep-equal:"
```

The predicate `/(^|\s)(not ok|FAIL|✖)\b|Error\b|AssertionError/` has two word-boundary defects:
- `FAIL\b` cannot match `FAILED`.
- `✖\b` can never match the spec reporter's `✖ ` (✖ and space are both non-word characters).

Checked with node: the predicate tests `false` on `✖ name (1ms)`, on `...7/8 passed, 1 FAILED` and on `- auditLedger: ...`.
- **Spec reporter (Node 24 default when piped):** nothing in the whole output matches. The local baseline run captured `(no failure line captured)` for exactly these 6 files (`ci-control-baseline.raw.out`).
- **TAP reporter:** the first match is the synthetic `not ok 1 - <file>`.

**Windows reproduces CI exactly once the reporter matches.** `node --test --test-reporter=tap tests/regression/S-LC-06/coverage-gate-caller.test.js` on win32 captures
`not ok 1 - tests\\regression\\S-LC-06\\coverage-gate-caller.test.js`. That is the CI line, with TAP's escaped backslashes. The variable is the reporter, not Linux.

## F2 — "The 5 truncation + 4 separator entries should start matching once T1 and T2 land": FALSE

Under T2 plus T3, **mechanism resolves 0 of the 15, and all 23 entries go REFUSED, including the 8 controls**:
- **No hash exists.** No entry in `tests/quarantine.json` has one, and T3 refuses hashless entries.
- **The hash can't be derived from the register.** The 5 B registrations are 240-char truncations. For example, `review-fallback-shape` ends mid-token at `...is not in lane 'review_fall` (quarantine.json:136), while the full line is about 370 chars (`undiagnosed-5-windows.out`). A hash of the FULL assertion cannot be computed from a truncated prefix.
- **No CI log has the full assertion either.** Quarantined files run with `tee: false` (run-tests.js:326), and only the 240-char `firstFailureLine` is printed (:215, :344, :352). To harvest from CI, a runner change that prints the full normalized assertion and its hash must first land and run in CI.

So the control group cannot read "still failing" after T2/T3 without re-observing all 23 entries.

A side note on the diagnosis: its claim that the C registrations name a stale `00-alex` layout is also false. The tests hardcode that path (`provider-autofix.unit.test.js:55`, `provider-rca.unit.test.js:46`, `docs-and-skill-bodies.test.js:67`), and CI observed `00-alex` too (log 9967/9970/9988). C really is marker plus separator only.

## F3 — T2/T3/T5 can land without editing `tests/regression/**`: FALSE

`tests/regression/S-OS-06/falsify-quarantine-runner.test.js` case **(b)** (lines 114-122) asserts three things about a stub entry with **no hash, no observation environment, in a fresh `git init` repo with no `669aadc1`**:
- the runner exits **0**;
- it prints `1 still failing`;
- it prints `run-tests: PASS`.

T2 (hashless entries fail closed), T3 (refuse entries without hash or environment) and T5 (refuse files absent at `669aadc1`) **each independently** make (b) impossible. No runner design satisfies both (b) and the brief.

Cases (a), (c), (f) and (h) survive only if a refusal is reported alongside the existing MISSING / UNEXPECTEDLY PASSED / CAUSE-LOCK / EXPIRED checks and does not pre-empt them.

This file is in the primary glob, and it is item 1 of `record-trust-exit` (P4). Today it passes locally. Landing T2/T3/T5 would turn it red on **every** platform. The lane exit criterion (runner exits 0) would then be unreachable without editing the file, and the brief forbids that edit. The file also belongs to the lane that owns P4, so two lanes would be editing it.

## F4 — the diagnosis's primary enumeration (Part 2) is incomplete

CI's 7 primary failures, each with its source file taken from its `location:`:

| log | file | test |
|---|---|---|
| 7497 | `S-LC-10/provider-tier-check.test.js` | file-level |
| 8010 | `S-OS-06/falsify-quarantine-runner.test.js` | **(b)** |
| 8092 | `S-OS-06/falsify-quarantine-runner.test.js` | **(h)** |
| 8606 | `S-OS-06/record-trust-exit-runs.test.js:24` | runs under npm test |
| 8639 | `S-OS-06/record-trust-exit.test.js:111` | GREEN (a different file from P4) |
| 9538 | `SP-20260615-001/roadmap-board-failsoft.test.js` | file-level |
| 9570 | `SP-20260615-001/roadmap-board-render.test.js` | file-level |

The P-table lists 4 files. It omits the falsifier (2 of the 7) and conflates two record-trust-exit files.

The falsifier's CI failure is again the reporter grain (log 8036-8038):
```
observed:   not ok 1 - dummy rotted
registered: dummy rot: still failing
```
For a node:test-native assertion, TAP's first match is the **test-name** line. Spec's first match is the **assertion-message** line (in the "failing tests" summary, because `✖\b` never matches). Marker stripping gives `dummy rotted` against `...dummy rot: still failing`. **That is different content, not a marker difference.** So T1's premise, that stripping reporter markers makes the lock reporter-invariant, holds only when the first captured line is console output printed before the reporter's result line (true for the 8 controls, 5 B and 4 C). It does not hold for node:test-native failures or for the 6 A files.

## F5 — T7 "commit `ci-control-baseline.out`" would redden CI

`runtime/**/*.out` is gitignored (`.gitignore:238`). A tracked copy also fails the leak-gate `tracked-transients` step (`mc-tracked-transients.js:78`: `^runtime\/.*\.(jsonl|log|diff|err|out)$`, ED-417, empty allowlist). I wrote the `.out` at the named path (on disk) and committed identical content as `ci-control-baseline.md`.

---

## The real variable: Node's piped default reporter, not the OS

| where | node | piped default reporter | evidence |
|---|---|---|---|
| CI | 22 (`leak-gate.yml:23`) | TAP | log 666 `TAP version 13`; `# ` markers on every captured console line |
| local | v24.16.0 | spec | piped `node --test` output has no `TAP version 13` and no `# ` marker |

`run-tests.js:181` spawns `node --test` without `--test-reporter`, so the capture grain depends on the Node major. `tests/quarantine.json` `$policy` names node v24.16.0; the oracle runs node 22.
TAP also escapes backslashes in comment and name lines (`tests\\regression\\...`), so a separator transform that only maps `\` to `/` turns a Windows TAP observation into `//`.

## Rulings needed before the build (proposal, NOT built)

1. **Pin the reporter** in `runNodeTest` for quarantine runs (`--test-reporter=spec` or `tap`). This removes the Node-major variable by construction. It is runner-internal, with no workflow edit. The spec layout on node 22 vs 24 still needs a check on the first CI run.
2. **Capture predicate:**
   - Never capture reporter-synthesized lines (`not ok N - <name>`, `✖ <name> (<ms>)`, `# Subtest:`, `test at <loc>`, `'test failed'`).
   - Fix the `FAIL\b` / `✖\b` boundary defects.
   - Decide whether the lock covers the first cause line or the ordered set of cause lines.
3. **Refuse vacuous registrations:** a normalized assertion that is only the file's own path, or only a test name, carries no cause (a T3 addition).
4. **Falsifier edit authorization.** `falsify-quarantine-runner.test.js` (b) must move to the new contract: a stamped stub entry plus a fixture base commit. That in turn needs a ruling on how fixtures supply a base other than `669aadc1` without opening a bypass that `npm test` could use. It must also be sequenced with the lane that owns P4.
5. **Provenance admissibility (T4).** Once the reporter is pinned, is a local observation stamped with platform, node version and reporter (no CI run id) admissible? If not, every one of the 23 registrations needs a CI round-trip, and that first needs the runner to print the full normalized assertion and its hash per quarantined file in the CI log.

Once 1 and 2 land, all 23 entries become re-observable from Windows. Whether each hashes identically on Linux is an empirical question for the first CI run. It is not claimed here.
