S-OS-06 r4 CI-PLATFORM lane — T7 CONTROL BASELINE (read BEFORE any change)
===========================================================================

Measured by: backend-builder (dispatched), 2026-09-16 (run completed before 08:00Z), BEFORE any edit to scripts/checks/run-tests.js
or tests/quarantine.json. No runner change was made in this lane (see ci-lane-premise-findings.md), so there
is no ci-control-after.out.

Tracked copy: runtime/S-OS-06/r4/ci-control-baseline.md (same content). This .out is gitignored
(.gitignore:238 runtime/**/*.out), and a tracked runtime/**/*.out would trip the leak-gate
"tracked-transients" CI step (scripts/checks/mc-tracked-transients.js:78, ED-417).

---------------------------------------------------------------------------
A. LOCAL observation (this worktree, unmodified runner)
---------------------------------------------------------------------------
  tree:        ab2d7466b1579dca40492a63bda815f97c2f1b73 (branch s-os-06/r4-ci)
               (cf11478c..ab2d7466 touches only TRACKER.md + one epic file: no scripts/ or tests/ change)
  platform:    win32 (Windows 11), node v24.16.0
  command:     env -u CLAUDE_PROJECT_DIR node scripts/checks/run-tests.js
  real exit:   1  (captured with $?, not piped)
  raw output:  runtime/S-OS-06/r4/ci-control-baseline.raw.out (on disk, gitignored, 332 KB)

  summary line:
    run-tests: FAIL — primary: 374 file(s) in 2 batch(es), exit 1 (tests 1194, pass 1188, fail 3, cancelled 0,
    skipped 3, todo 0) · quarantine: 23 entries, 23 still failing, 0 unexpectedly passed,
    0 missing/undiscovered, 0 unobserved

  FIVE QUARANTINE TALLIES (local):
    entries                 23
    still failing           23
    unexpectedly passed      0
    missing/undiscovered     0
    unobserved               0
    (QUARANTINE VIOLATION lines: 0 — all 23 match under the local spec reporter, including the 15 that
     violate on CI)

  local primary failures (3):
    - tests/regression/S-OS-06/record-trust-exit.test.js:111  "record-trust-exit GREEN ..." — ledger drift
      (rename-occurrences "pinned": 320 observed vs 316 committed)
    - tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js  (file-level 'test failed')
    - tests/regression/SP-20260615-001/roadmap-board-render.test.js    (file-level 'test failed')
    NOTE: the diagnosis says P1/P2 pass on Windows. In this worktree they fail. Not investigated (not this lane).

---------------------------------------------------------------------------
B. CI reference observation (the lane oracle's platform)
---------------------------------------------------------------------------
  CI run:      34909939581 (workflow leak-gate, head cf11478c741e89b6cd3d8cb0f06210d9b2a89c1b)
  platform:    ubuntu-latest, node 22 (.github/workflows/leak-gate.yml:23), piped reporter = TAP
               (log line 666 "TAP version 13")
  source:      gh run view 34909939581 --log (line numbers below are lines of that output)

  summary line (log 10011):
    run-tests: FAIL — primary: 374 file(s) in 2 batch(es), exit 1 (tests 1194, pass 1186, fail 7, cancelled 0,
    skipped 1, todo 0) · quarantine: 23 entries, 8 still failing, 0 unexpectedly passed,
    0 missing/undiscovered, 0 unobserved

  FIVE QUARANTINE TALLIES (CI):
    entries                 23
    still failing            8
    unexpectedly passed      0
    missing/undiscovered     0
    unobserved               0
    (top-level QUARANTINE VIOLATION lines: 15, all CAUSE-LOCK; 3 more are nested inside the falsifier's own
     fixture runs)

  CI primary failures (7): log 7497 provider-tier-check; 8010 falsify-quarantine-runner (b); 8092
    falsify-quarantine-runner (h); 8606 record-trust-exit-runs; 8639 record-trust-exit.test.js:111;
    9538 roadmap-board-failsoft; 9570 roadmap-board-render.

---------------------------------------------------------------------------
C. CONTROL GROUP — per-entry state of the 8 entries that are "still failing" on CI
---------------------------------------------------------------------------
Format: local = win32/node24/spec, CI = linux/node22/TAP. Text after "—" is the runner's own captured
firstFailureLine as printed.

 1. tests/mc/dispatch-readiness.test.js
    local: still failing (exit 1) — FAIL  KNOWN_DANGLING_REFS is empty by default (no pre-populated allowlist): length=33
    CI:    still failing (exit 1) — #   FAIL  KNOWN_DANGLING_REFS is empty by default (no pre-populated allowlist): length=33
 2. tests/mc/provider-smoke.unit.test.js
    local: still failing (exit 1) — FAIL — 7 of 68 cases failed:
    CI:    still failing (exit 1) — # FAIL — 7 of 68 cases failed:
 3. tests/regression/S-LC-07/spend-ledger.test.js
    local: still failing (exit 1) — FAIL  BLOCKER 1: prototype-key models price via _default — usd FINITE, not NaN
    CI:    still failing (exit 1) — # FAIL  BLOCKER 1: prototype-key models price via _default — usd FINITE, not NaN
 4. tests/regression/S-PF-01/scaffold-coverage-telemetry.test.js
    local: still failing (exit 1) — FAIL real-scaffold-telemetry-tree-passes: AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    CI:    still failing (exit 1) — # FAIL real-scaffold-telemetry-tree-passes: AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
 5. tests/regression/SP-20260518-008/hooks-and-diagnostics.test.js
    local: still failing (exit 1) — FAIL  test_settings_registers_lint_hook_output_between_path_guard_and_sprint_routing
    CI:    still failing (exit 1) — #   FAIL  test_settings_registers_lint_hook_output_between_path_guard_and_sprint_routing
 6. tests/regression/SP-20260611-001/sprint-id-correlation.test.js
    local: still failing (exit 1) — FAIL: sprint-id-match-preferred-both-checkers: matching sprint_id (window-edge) must correlate in hook-coverage
    CI:    still failing (exit 1) — #   FAIL: sprint-id-match-preferred-both-checkers: matching sprint_id (window-edge) must correlate in hook-coverage
 7. tests/regression/SP-20260611-002/wrapper-mode-binding.test.js
    local: still failing (exit 1) — FAIL  report-only-ramp-preserved-not-blocking
    CI:    still failing (exit 1) — # FAIL  report-only-ramp-preserved-not-blocking
 8. tests/regression/SP-20260615-001/registry-seed-resolves.test.js
    local: still failing (exit 1) — FAIL  four-known-panels-seeded-and-openers-resolve
    CI:    still failing (exit 1) — # FAIL  four-known-panels-seeded-and-openers-resolve

All 8 pass the current CAUSE-LOCK on CI only because each registered string is shorter than the
240-char capture window and the TAP marker is a prefix, so `observed.includes(registered)` still holds.
