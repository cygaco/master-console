# S-OS-06 r4 stage 2, lane E — PREMISE FALSE, STOPPED before any code change

Builder: backend-builder, branch `s-os-06/s2e-linux`, cut from `46bbee50`. Measured 2026-09-16.
**No product or test file was changed.** This commit carries evidence only.

## The false premise

The brief treats E1/E2/E3 as **"CI-only"** failures that **"book as CI-platform"**, with the variable being
**"the Node major and its default piped reporter"** (diagnosis correction C1).

For all three files that is false. **Every one fails on this machine, on Node 24, on win32, with the spec
reporter**, in a clean checkout (this worktree), with CI's exact tallies and failing assertion names. Swapping
the Node major (22 vs 24) or the reporter (TAP vs spec) changes nothing. The outcome follows only
**state the operator's main checkout has and a clean checkout does not**:

| File | Variable that reproduces it | Not the variable (shown) |
|---|---|---|
| E1 `roadmap-board-failsoft` | presence of the gitignored `.claude/project/memory/enforcement-debt.jsonl` + `recurring-issues.jsonl` | Node 22 and 24; TAP and spec; win32 |
| E2 `roadmap-board-render` | same two gitignored files | same |
| E3 `provider-tier-check` | host provider state: the `codex` + `agy` CLIs on PATH, **or** their auth files under the home dir (`~/.codex/auth.json`, `~/.gemini/oauth_creds.json`). Either one missing is enough | Node 22 and 24; win32 |

`primary-4-windows.out` ("all PASS on this machine") is true only of the operator's **main** checkout, which
has the gitignored registers and the installed, authenticated provider CLIs. It is not a clean-checkout
measurement.

## Evidence (raw outputs reproduced verbatim in the Appendix; `runtime/**/*.out|*.log` are gitignored, so they are inlined rather than force-added)

- `ci-34909939581-excerpt.log` is the relevant CI lines, fetched with `gh run view 34909939581 --log-failed`.
- `e1e2-controlled-repro-before.out`: same worktree, Node 24, win32. Registers absent gives E1 9/15 and E2 5/6
  under both the spec reporter and forced TAP. Registers copied in gives 15/15 and 6/6 under both reporters.
  Removing them again gives 9/15.
- `e3-controlled-repro-before.out` + `e3-repro.js`: Node 24, win32. Host as-is gives 22/0 and engine exit 0.
  Stripping codex/agy from PATH, emptying the home dir, or both gives **21 passed, 1 failed** (the CI tally,
  same assertion), with engine `--enforce` exit **2**.
- `node22-matrix-before.out` covers the reverse direction on the official nodejs.org v22.23.2 win-x64 zip
  (SHA256 verified against SHASUMS256.txt, deleted after use). Its `node --test` piped default is `TAP version 13`,
  the same as CI. E1/E2 with registers absent give 9/15 and 5/6; present gives 15/15 and 6/6. E3 host as-is gives
  22/0; stripped gives 21/1.
- `e3-local-fail-shape.out` shows the local failure text. It matches the CI line exactly: `Command failed: node
  …provider-tier-check.js --json --enforce --config-path <tmp>/cfg.json`, with **no stderr trailer**, then the
  stack at `provider-tier-check.test.js:294:15`. An empty trailer means a clean non-zero exit, not a crash.
  The engine writes nothing to stderr on its `tier_short` path. CI's log does not print the exit status value
  itself. Exit 2 is the reproduced value, not one read from CI.

## Causes (reproduced, not inferred)

**E1.** `makeFixtureRoot()` copies the five sources from ROOT `if (fs.existsSync(srcFile))`. The two open-gaps
registers are `owner: runtime` in `framework/paths.registry.json` and gitignored by `.gitignore:22`
(`.claude/project/memory/`, since 2026-04-15). In any clean checkout the "clean" fixture therefore has no
registers. `parseGaps()` then correctly returns `section unavailable` under the file's own B4 contract, which
the same test asserts in its passing B4 case. So the six failures are the `Open gaps` section degrading in
every fixture. **The product is right. The test's "clean fixture" silently depends on runtime-owned state.**

**E2.** The test runs the generator against the REAL repo and asserts `/enforcement-debt\.jsonl/`. That
provenance line is emitted only on the healthy gaps path (`roadmap.js` ~line 853). With the registers absent,
the section reads `open-gaps registers not found (enforcement-debt + recurring-issues absent)`, which has no
`.jsonl`. Same root cause as E1.

**E3.** `buildReport()` grades ALL `KNOWN_PROVIDERS = ["claude","openai","antigravity"]`, not just the providers
in the config. The fixture config selects only `claude: t3`. `openai` and `antigravity` default to
`selected_tier: t1`. On a host without codex/agy (or their auth files), each is T1-down, so `tier_short`. That is
AC-6.1 by design: "T1 down for any selected tier… NEVER unknown". `verdict_summary` becomes `tier_short` and
`--enforce` exits 2. Claude's own row IS `unknown-self-attested`, as the test intends. **The assertion under
test is correct, but a different provider trips the gate.** The test encodes "openai and antigravity are
reachable on this host".

## Why STOP rather than fix

1. **Booking.** These are not CI-platform failures. They are clean-checkout / host-hermeticity defects that
   predate the sprint. The tests were authored 2026-06-09 (S-LC-10, `64da2392`) and 2026-06-14 (SP-20260615-001,
   `7faa1728`). `npm test` was first wired into CI by S-OS-04/05 (2026-09-12), which is why they first showed as
   "CI". They also fail in **every `.claude/worktrees/*` checkout on this machine**. `oracle-coverage-map.md` says
   "an ambiguous lane assignment books as r4 with disclosure, never as CI". Re-booking is the conductor's call.
2. **E2 and E3 need a contract decision a builder should not make silently:**
   - **E2:** AC-R4a says the render test runs "against the REAL repo". A hermetic fix (a synthesized fixture
     root via the generator's `--root` seam) changes what the acceptance test proves. Keeping it on the real
     repo means asserting provenance of runtime-owned files a clean clone never has.
   - **E3:** there is no hermetic way to drive the CLI assertion. No flag or config value excludes a provider
     (`validTier` admits only t1|t2|t3), and the host's codex/agy state cannot be forced *present*. Every fix
     is one of three things. (a) A new product seam, such as `--provider` scoping or grading only
     config-listed providers, which adds CLI surface. (b) A change to AC-6.1 so unselected providers don't gate
     `--enforce`. (c) A move to an in-process `main()` with a signals seam, which loses the real-exit-code proof
     unless done carefully. All three are contract changes.
3. **E1 alone has an obvious test-only fix:** the fixture writes its own minimal registers instead of copying
   runtime state. The B4-missing and EISDIR cases already delete or replace them, so the guard survives. It is
   the same root cause as E2 and should be decided with E2, not ahead of it.

## Recommended re-brief (for the conductor, not adopted here)

- Re-book E1/E2/E3 as **r4 with disclosure: pre-existing test hermeticity**, not CI-platform.
- E1: fixture synthesizes the registers (test-only; name the removed environment assumption; show the B4
  and EISDIR guards still red when planted).
- E2: rule on AC-R4a. Either a hermetic `--root` fixture with the read-only snapshot proof moved onto the
  fixture sources, or a real-repo render that asserts provenance only for sources a clean checkout carries.
- E3: rule between product seam (a), contract change (b), or in-process exit seam (c).
- Re-measure P4 (`record-trust-exit-runs`) for the same host/runtime-state dependence before assuming it
  cascades from Part 1. I did not measure it (out of scope for this lane).

## Incidental (not causes, noted only)

- `roadmap.js` `parseGaps` docstring says "Each register is tolerated absent (-> count 0)". The code, the B4
  contract and the test all say absent means `section unavailable`. The docstring is stale.
- `roadmap.js` hardcodes the register literals instead of `paths.enforcementDebt` /
  `paths.recurringIssuesFile`. They resolve identically today.

## Process disclosure

I first wrote the experiment artifacts, including the 134 MB Node 22 download, under the **main checkout's**
`runtime/S-OS-06/r4/s2e/`. That tree is not gitignored. I deleted all of it, main checkout included, and moved
the text evidence here. I also temporarily copied the two registers into this worktree's gitignored
`.claude/project/memory/`, then removed them (directory verified empty). The main checkout's registers were
only read.

---

## Appendix: raw evidence, verbatim

### `e1e2-controlled-repro-before.out`

```text
=== CONTROLLED EXPERIMENT (node v24.16.0, win32, same worktree @ 46bbee50)
--- A: registers ABSENT (clean checkout state), spec reporter, direct run
E1 exit=1 roadmap-board-failsoft: 9/15 pass
E2 exit=1 roadmap-board-render: 5/6 pass
--- B: registers ABSENT, forced TAP reporter via node --test
E1 exit=1 # pass 0 # fail 1 
E2 exit=1 # pass 0 # fail 1 
--- C: registers PRESENT (copied from operator checkout), forced TAP reporter
E1 exit=0 # pass 1 # fail 0  # roadmap-board-failsoft: 15/15 pass
E2 exit=0 # pass 1 # fail 0  # roadmap-board-render: 6/6 pass
--- D: registers PRESENT, spec reporter, direct run
E1 exit=0 roadmap-board-failsoft: 15/15 pass
E2 exit=0 roadmap-board-render: 6/6 pass
--- E: registers REMOVED again
E1 exit=1 roadmap-board-failsoft: 9/15 pass
```

### `e3-controlled-repro-before.out`

```text
node v24.16.0 win32 worktree=C:/Users/Vlad/Desktop/Claude/Projects/WarpOS/.claude/worktrees/S-OS-06-s2e-linux

--- host-as-is
  engine --enforce exit=0  unknown-self-attested | claude:t1=true/harness/sel=t3/unknown-self-attested openai:t1=true/key/sel=t1/tier_met antigravity:t1=true/oauth/sel=t1/tier_met
  test exit=0  S-LC-10 provider-tier-check: 22 passed, 0 failed

--- path-stripped
  engine --enforce exit=2  tier_short | claude:t1=true/harness/sel=t3/unknown-self-attested openai:t1=false/key/sel=t1/tier_short antigravity:t1=false/oauth/sel=t1/tier_short
  test exit=1  FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0) || S-LC-10 provider-tier-check: 21 passed, 1 failed

--- home-empty
  engine --enforce exit=2  tier_short | claude:t1=true/harness/sel=t3/unknown-self-attested openai:t1=false/none/sel=t1/tier_short antigravity:t1=false/none/sel=t1/tier_short
  test exit=1  FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0) || S-LC-10 provider-tier-check: 21 passed, 1 failed

--- both
  engine --enforce exit=2  tier_short | claude:t1=true/harness/sel=t3/unknown-self-attested openai:t1=false/none/sel=t1/tier_short antigravity:t1=false/none/sel=t1/tier_short
  test exit=1  FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0) || S-LC-10 provider-tier-check: 21 passed, 1 failed
```

### `node22-matrix-before.out`

```text
=== NODE 22 REVERSE-DIRECTION MATRIX — node on PATH: v22.23.2, win32, worktree @ 46bbee50
--- E1/E2, registers ABSENT, node 22 --test (default piped reporter)
E1 exit=1 reporter-first-line=[TAP version 13] roadmap-board-failsoft: 9/15 pass
E2 exit=1 reporter-first-line=[TAP version 13] roadmap-board-render: 5/6 pass
--- E1/E2, registers PRESENT, node 22 --test (default piped reporter)
E1 exit=0 reporter-first-line=[TAP version 13] roadmap-board-failsoft: 15/15 pass
E2 exit=0 reporter-first-line=[TAP version 13] roadmap-board-render: 6/6 pass
--- E3 under node 22 (engine + test children also node 22 via PATH prefix inside script)
node v22.23.2 win32 worktree=C:/Users/Vlad/Desktop/Claude/Projects/WarpOS/.claude/worktrees/S-OS-06-s2e-linux

--- host-as-is
  engine --enforce exit=0  unknown-self-attested | claude:t1=true/harness/sel=t3/unknown-self-attested openai:t1=true/key/sel=t1/tier_met antigravity:t1=true/oauth/sel=t1/tier_met
  test exit=0  S-LC-10 provider-tier-check: 22 passed, 0 failed

--- path-stripped
  engine --enforce exit=2  tier_short | claude:t1=true/harness/sel=t3/unknown-self-attested openai:t1=false/key/sel=t1/tier_short antigravity:t1=false/oauth/sel=t1/tier_short
  test exit=1  FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0) || S-LC-10 provider-tier-check: 21 passed, 1 failed

--- home-empty
  engine --enforce exit=2  tier_short | claude:t1=true/harness/sel=t3/unknown-self-attested openai:t1=false/none/sel=t1/tier_short antigravity:t1=false/none/sel=t1/tier_short
  test exit=1  FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0) || S-LC-10 provider-tier-check: 21 passed, 1 failed

--- both
  engine --enforce exit=2  tier_short | claude:t1=true/harness/sel=t3/unknown-self-attested openai:t1=false/none/sel=t1/tier_short antigravity:t1=false/none/sel=t1/tier_short
  test exit=1  FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0) || S-LC-10 provider-tier-check: 21 passed, 1 failed
```

### `e3-local-fail-shape.out`

```text
FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0)
      Error: Command failed: node C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-s2e-linux\scripts\mc\provider-tier-check.js --json --enforce --config-path C:\Users\Vlad\AppData\Local\Temp\slc10-enf-Vxjq9k\cfg.json
    at genericNodeError (node:internal/errors:985:15)
    at wrappedFn (node:internal/errors:539:14)
    at checkExecSyncError (node:child_process:925:11)
    at execFileSync (node:child_process:961:15)
    at C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-s2e-linux\tests\regression\S-LC-10\provider-tier-check.test.js:294:15
```

### `ci-34909939581-excerpt.log`

```text
# Excerpt of CI run 34909939581 (leak-gate, test suite step), fetched via 'gh run view 34909939581 --log-failed' 2026-09-16. Timestamps/job prefix trimmed.
## E3 provider-tier-check (log lines 7420-7502)
:15.5328905Z ok 13 - tests/regression/S-LC-07/scan-turbo-spend.test.js
:15.5329822Z   ---
:15.5330181Z   duration_ms: 178.140403
:15.5330605Z   type: 'test'
:15.5330971Z   ...
:15.5331760Z #   ok  PLANTED: a plan missing enforcer/proof/blast-radius is FLAGGED (report-only)
:15.5333206Z #   ok  a well-formed plan (all three present) produces NO finding
:15.5334231Z #   ok  a partial plan (missing only blast-radius) is flagged with exactly that gap
:15.5335095Z #   ok  a mixed tree flags only the omitting doc
:15.5335939Z #   ok  README.md inside the dir is excluded from plan-doc scanning
:15.5337086Z #   ok  FAIL-OPEN: a missing _planning/epics/ dir → 0 docs, 0 gaps, ok
:15.5337992Z #   ok  CLI: a planted violation is REPORT-ONLY (exit 0)
:15.5339049Z #   ok  CLI: --json emits a parseable envelope with the gap
:15.5339737Z #   ok  CLI: a missing epics/ dir is fail-open (exit 0)
:15.5340380Z # S-LC-08 planning-principles: 9 passed, 0 failed
:15.5341140Z # Subtest: tests/regression/S-LC-08/planning-principles.test.js
:15.5341942Z ok 14 - tests/regression/S-LC-08/planning-principles.test.js
:15.5342753Z   ---
:15.5343064Z   duration_ms: 186.650317
:15.5343382Z   type: 'test'
:15.5343663Z   ...
:15.5344554Z # S-LC-09/design-10-build-2 fixture-test: 4/4 passed (incl. 2 planted-violation/fail-closed assertion(s))
:15.5345638Z # Subtest: tests/regression/S-LC-09/design-10-build-2.test.js
:15.5346361Z ok 15 - tests/regression/S-LC-09/design-10-build-2.test.js
:15.5346864Z   ---
:15.5347157Z   duration_ms: 50.031696
:15.5347791Z   type: 'test'
:15.5348106Z   ...
:15.5348911Z # S-LC-09/epic-fold fixture-test: 6/6 passed (incl. 1 planted-violation/fail-closed assertion(s))
:15.5349894Z # Subtest: tests/regression/S-LC-09/epic-fold.test.js
:15.5350577Z ok 16 - tests/regression/S-LC-09/epic-fold.test.js
:15.5351060Z   ---
:15.5351367Z   duration_ms: 202.153716
:15.5351743Z   type: 'test'
:15.5352049Z   ...
:15.5353087Z # S-LC-09/epic-plan fixture-test: 6/6 passed (incl. 2 planted-violation/fail-closed assertion(s))
:15.5354223Z # Subtest: tests/regression/S-LC-09/epic-plan.test.js
:15.5414568Z ok 17 - tests/regression/S-LC-09/epic-plan.test.js
:15.5417879Z   ---
:15.5418525Z   duration_ms: 184.025819
:15.5419121Z   type: 'test'
:15.5419666Z   ...
:15.5420899Z #   ok  T1: CLI+auth absent → effective none, selected t1 → tier_short
:15.5422807Z #   ok  T1: CLI+auth present but no paid funding signal → effective t1, selected t1 → tier_met (verified)
:15.5424625Z #   ok  T2: key NAME present → effective t2; selected t2 → tier_met
:15.5425959Z #   ok  T2: selected t2 but no key + no oauth → tier_short (value-free confident)
:15.5427187Z #   ok  T2: paid OAuth login alone funds T2 even with no raw key
:15.5428558Z #   ok  T3: attested sub meets floor → effective t3, selected t3 → tier_met (self-attested)
:15.5430153Z #   ok  T3 PLANTED UNDER-TIER: attested sub below floor → blocks the selected t3 (tier_short)
:15.5431997Z #   ok  Claude is NOT auto-ok at T3: harness reaches only T1 without a key/attestation
:15.5433911Z #   ok  Self-attest fallback: selected t3, no sub/probe → unknown-self-attested, never blocks
:15.5435194Z #   ok  Blanket attested_tier=t3 satisfies a selected t3 (self-attested, exit 0)
:15.5436509Z #   ok  Config floor drives the verdict: pro-attested is t3_short under max_5x, t3_met under pro
:15.5438774Z #   ok  VALUE-FREE: a planted secret in env is never emitted — only the key NAME/label
:15.5440167Z #   ok  PLANTED: the engine has NO dispatch/token-spend path (infer-from-dispatch impossible)
:15.5441404Z #   ok  PLANTED: the opt-in --probe is a non-spending stub that never confirms a tier
:15.5442890Z #   ok  Fail-open: a garbage config file → framework defaults, no throw
:15.5444243Z #   ok  Fail-open: an absent config → framework defaults (greenfield), default selected = t1
:15.5445506Z #   ok  CLI: default check exits 0 (report-only) on the real tree
:15.5446747Z # FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0)
:15.5449013Z #       Error: Command failed: node /home/runner/work/master-console/master-console/scripts/mc/provider-tier-check.js --json --enforce --config-path /tmp/slc10-enf-dj2546/cfg.json
:15.5450806Z #     at genericNodeError (node:internal/errors:983:15)
:15.5451740Z #     at wrappedFn (node:internal/errors:537:14)
:15.5452923Z #     at checkExecSyncError (node:child_process:916:11)
:15.5453804Z #     at execFileSync (node:child_process:952:15)
:15.5455242Z #     at /home/runner/work/master-console/master-console/tests/regression/S-LC-10/provider-tier-check.test.js:294:15
:15.5457151Z #     at ok (/home/runner/work/master-console/master-console/tests/regression/S-LC-10/provider-tier-check.test.js:35:5)
:15.5459235Z #     at Object.<anonymous> (/home/runner/work/master-console/master-console/tests/regression/S-LC-10/provider-tier-check.test.js:285:1)
:15.5460856Z #     at Module._compile (node:internal/modules/cjs/loader:1781:14)
:15.5461887Z #     at Object..js (node:internal/modules/cjs/loader:1913:10)
:15.5463156Z #     at Module.load (node:internal/modules/cjs/loader:1505:32)
:15.5464225Z #   ok  CONFIRM-CLASS: a no-flag check call does NOT write the config
:15.5465749Z #   ok  CONFIRM-CLASS: a no-flag invocation against a temp path writes nothing
:15.5467080Z #   ok  CONFIRM-CLASS: --set-tier (explicit flag) DOES write the config to the temp path
:15.5468446Z #   ok  CONFIRM-CLASS: --set-tier with an invalid tier is rejected (exit 2, no write)
:15.5469540Z # S-LC-10 provider-tier-check: 21 passed, 1 failed
:15.5470563Z # Subtest: tests/regression/S-LC-10/provider-tier-check.test.js
:15.5471667Z not ok 18 - tests/regression/S-LC-10/provider-tier-check.test.js
:15.5472693Z   ---
:15.5473262Z   duration_ms: 528.664048
:15.5473867Z   type: 'test'
:15.5474970Z   location: '/home/runner/work/master-console/master-console/tests/regression/S-LC-10/provider-tier-check.test.js:1:1'
:15.5479382Z   failureType: 'testCodeFailure'
## E1 roadmap-board-failsoft + E2 roadmap-board-render (log lines 9536-9580)
:44.4279623Z # roadmap-board-failsoft: 9/15 pass
:44.4280505Z # Subtest: tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js
:44.4281582Z not ok 115 - tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js
:44.4282264Z   ---
:44.4282912Z   duration_ms: 245.307644
:44.4283345Z   type: 'test'
:44.4284445Z   location: '/home/runner/work/master-console/master-console/tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js:1:1'
:44.4285624Z   failureType: 'testCodeFailure'
:44.4286117Z   exitCode: 1
:44.4286472Z   signal: ~
:44.4286848Z   error: 'test failed'
:44.4287265Z   code: 'ERR_TEST_FAILURE'
:44.4287645Z   ...
:44.4288466Z #   ok  source contains NO fs write/append/rename/truncate call at all (board is read-only)
:44.4289800Z #   ok  source destructures no write-capable fs verb (catches `const { writeFileSync } = fs`)
:44.4291141Z #   ok  source only ever reads (readFileSync / existsSync / statSync are the only fs verbs)
:44.4292305Z #   ok  no write-back path references a source filename next to a write verb
:44.4293939Z #   ok  public surface exposes no mutate/reorder/mark-done verb (confirm-class is out of scope)
:44.4294910Z # roadmap-board-readonly: 5/5 pass
:44.4295834Z # Subtest: tests/regression/SP-20260615-001/roadmap-board-readonly.test.js
:44.4296984Z ok 116 - tests/regression/SP-20260615-001/roadmap-board-readonly.test.js
:44.4297669Z   ---
:44.4298049Z   duration_ms: 53.310689
:44.4298489Z   type: 'test'
:44.4298847Z   ...
:44.4299339Z #   ok  board renders the NEXT ACTION section
:44.4300134Z #   ok  board renders the Ranked next (Prioritized) section
:44.4300890Z #   ok  board renders the In flight section
:44.4301947Z #   ok  board renders the Open gaps / blockers section
:44.4303140Z # FAIL  board cites all four live sources
:44.4303794Z #       no enforcement-debt provenance
:44.4304698Z #   ok  READ-ONLY: no source file content/mtime/size changed across the run
:44.4305518Z # roadmap-board-render: 5/6 pass
:44.4306649Z # Subtest: tests/regression/SP-20260615-001/roadmap-board-render.test.js
:44.4307685Z not ok 117 - tests/regression/SP-20260615-001/roadmap-board-render.test.js
:44.4308375Z   ---
:44.4308748Z   duration_ms: 158.703501
:44.4309196Z   type: 'test'
:44.4310291Z   location: '/home/runner/work/master-console/master-console/tests/regression/SP-20260615-001/roadmap-board-render.test.js:1:1'
:44.4311429Z   failureType: 'testCodeFailure'
:44.4311911Z   exitCode: 1
:44.4312279Z   signal: ~
:44.4312919Z   error: 'test failed'
:44.4313334Z   code: 'ERR_TEST_FAILURE'
:44.4313746Z   ...
```
