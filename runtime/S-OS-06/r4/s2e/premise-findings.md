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

## Evidence (all in this directory)

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
