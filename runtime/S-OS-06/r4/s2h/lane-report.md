# S-OS-06 r4 stage 2, lane H — the three hermeticity defects (β verdict `7d3e9f51`, betaEvents row 475)

Builder: backend-builder, branch `s-os-06/s2h-hermeticity`, cut from `132a2222`. Measured 2026-09-16.
Books as **r4 surface with disclosure**.

| Item | Outcome |
|---|---|
| H1 board tests | **DONE** in `e5fabfc7` (test files + AC-R4a amendment; no product code) |
| H2 tier check (differential) | **STOPPED. The premise is false; proof below. `provider-tier-check.test.js` is unchanged.** |
| H3 design question | **FILED** as **ED-435** in `paths.enforcementDebt` |
| H4 disclosure | In the `e5fabfc7` commit message and below |

## H4 — disclosure (the wording β ruled)

These tests were **authored in June 2026**: `roadmap-board-render` and `roadmap-board-failsoft` on 2026-06-14
(`7faa1728`, SP-20260615-001) and `provider-tier-check` on 2026-06-09 (`64da2392`, S-LC-10). They **first surfaced
when the full test suite was wired into continuous integration on 2026-09-12** (`cd07638e`, S-OS-04: the
`npm test` step in `leak-gate.yml`). They are inherited defects surfaced by this sprint's work, not defects
this sprint caused. The sprint's only edit to these files was the 2026-09-13 codemod `7021ff55`, which changed a
`scripts/warpos` path and a `warpos/` schema literal. The same failures reproduce with registers absent and pass
with them present at `132a2222`, so that edit is not causal.

## Measurement environments (every number below names one)

All runs: win32 (Windows 11), Node **v24.16.0**, each test run directly (`node <file>`). "Clean clone" means
`git clone -s` into a temp dir, then detached checkout of the named commit. `git status --ignored` reports
**0** entries, and `.claude/project/memory/` does not exist. **Neither the main checkout nor this worktree was
used for any before/after number.**

| Env | Definition |
|---|---|
| HOST-AS-IS | this machine unchanged: `codex` + `agy` on PATH (`--version` exits 0), `~/.codex/auth.json` + `~/.gemini/oauth_creds.json` present |
| BARE-HOST | PATH = node dir + `System32` + `Windows` only; `HOME`/`USERPROFILE` = an empty temp dir. Probe: no codex, no agy, no auth files (the CI-runner shape) |
| STUBBED-HOST | BARE-HOST plus a PATH dir of `codex.cmd`/`agy.cmd` shims that exit 0, plus a temp home carrying presence-only `.codex/auth.json` `{"tokens":{}}` and `.gemini/oauth_creds.json` `{"refresh_token":""}`. **Evidence only, not adopted** |

Scripts are committed beside this report: `measure.js`, `diff-probe.js`, `plant.js`. Raw outputs are in the Appendix,
with temp paths redacted to `<tmp>`.

---

## File 1: `tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js` (AC-R4c)

**Fix.** `makeFixtureRoot()` copies only the three **tracked** sources from the real tree. It now **writes** its
own two open-gaps registers (one open and one closed row each) and never copies host runtime state. The header
records the removed environment assumption. No assertion was removed or weakened.

**Before and after, clean clone:**

| Commit | HOST-AS-IS | BARE-HOST |
|---|---|---|
| before `132a2222` | exit 1, **9/15** (the 6 gaps-degrade failures) | exit 1, **9/15** |
| after `e5fabfc7` | exit 0, **15/15** | exit 0, **15/15** |
| after `e5fabfc7` + host registers planted (main-checkout shape) | exit 0, 15/15 | (not needed: this test reads no provider host state) |

**Guards still red when planted** (clean clone, HOST-AS-IS):

| Plant (in `roadmap.js`, throwaway clone) | before `132a2222` | after `e5fabfc7` |
|---|---|---|
| P1 `eisdir-swallow`: an unreadable register is read as empty | **EISDIR case PASSES** (vacuous: the fixture had no `recurring-issues.jsonl`, so the gaps section degraded as "not found" and never as EISDIR) | **EISDIR case FAILS** (14/15) |
| P2 `b4-missing-as-zero`: missing registers are read as count 0 | 3 B4 cases FAIL | the same 3 B4 cases FAIL (12/15) |

The fix gave the EISDIR guard teeth it lacked in every clean checkout. The B4 guard is unchanged.

## File 2: `tests/regression/SP-20260615-001/roadmap-board-render.test.js` (AC-R4a)

**Fix: split by source availability, per β.**

- **(a) Real repo, tracked sources.** The generator runs with no `--root`, `cwd` at the repo root, and both
  `MC_ROADMAP_ROOT` and its legacy name removed from the child env (names taken from `mc-env.envNames`, not
  hardcoded). The test asserts the four section headings. It asserts that NEXT ACTION, Ranked next and In flight
  each resolve healthy **and** carry their provenance line. It keeps the read-only snapshot over all five real
  paths, which also proves no register gets created.
- **(b) Fixture root, runtime registers.** The fixture copies the tracked three and **writes** two open and one
  closed debt row, plus one open and one resolved issue. It renders through the existing `--root` CLI seam. The
  test asserts all four sources resolve and are cited, that the gaps section shows the fixture's counts
  (**2**, **1**) and ids, and that the fixture files are read-only.

**Disclosed change beyond the literal brief: the kept real-repo assertion was TIGHTENED, because as written it
was a false green on exactly the regression class β kept it for.** The old check was
`/active-sprints\.yaml/.test(wholeOutput)`. When the generator cannot find that file, the In flight section reads
`_(section unavailable: active-sprints.yaml not found)_`, and the bare regex matches that text. Proof, probe P3:

| Plant: `roadmap.js` reads `active-sprints.yml` (path drift) | Result |
|---|---|
| before `132a2222` + host registers (main-checkout shape) | **6/6 PASS, exit 0.** The drift is not detected |
| after `e5fabfc7`, clean | 6/8, exit 1. **FAIL** `REAL tree: the three tracked sources resolve and are cited` (+ the fixture case) |
| after `e5fabfc7` + host registers | 6/8, exit 1. Same two FAILs |

The env-override removal is a second disclosed addition. It was not failing today, but a set `MC_ROADMAP_ROOT`
would have silently turned the "real tree" run into a run against another directory. Both additions are
test-only.

**Before and after, clean clone:**

| Commit | HOST-AS-IS | BARE-HOST |
|---|---|---|
| before `132a2222` | exit 1, **5/6** (FAIL `board cites all four live sources`: no enforcement-debt provenance) | exit 1, **5/6** |
| after `e5fabfc7` | exit 0, **8/8** | exit 0, **8/8** |
| after `e5fabfc7` + host registers planted | exit 0, 8/8 | (n/a, as above) |

The case count rose from 6 to 8. The single "cites" case became one real-tree case for the tracked three and one
fixture case for all four. The single read-only case became one per run.

### AC-R4a amendment (committed in `acceptance-criteria.md`, verbatim summary)

> **AMENDMENT 2026-09-16 (S-OS-06 r4 lane H; β verdict `7d3e9f51-2b84-4a06-8c95-1f60b3e74d28`, betaEvents row
> 475): the verification is SPLIT BY SOURCE AVAILABILITY. The claim above is unchanged.** (a) The three TRACKED
> sources are asserted against the REAL repo: each resolves healthy and carries its provenance line, with no
> bare-filename match. (b) The two gitignored runtime registers are asserted on a fixture root that WRITES them,
> rendered via the existing `--root` seam, with the fixture's open counts required. Read-only proof on both runs.
> **Warrant:** the test never proved the registers exist. It proved that on a machine which happens to carry
> them, the board cites them. The real-repo run was an incidental way of obtaining sources, not the claim, and a
> test that asserts a state must create that state. The product is right: absent registers read "section
> unavailable" under AC-R4c. **Provenance:** inherited. Authored 2026-06-14 (`7faa1728`); first surfaced when
> `npm test` was wired into CI on 2026-09-12 (`cd07638e`). The AC-R4c fixture gets the same correction; the AC-R4c
> text needs no change.

---

## File 3: `tests/regression/S-LC-10/provider-tier-check.test.js`: NOT CHANGED. H2 premise false, STOPPED.

**The premise tested.** β wrote: *"on a bare host both exit 2 … It still catches the regression the test exists
for: if someone made unknown-self-attested block, the two runs would diverge."* β had not read the engine, and
the brief said to verify the mechanism first.

**Why it is false (from the code).** `--enforce` exits 2 iff `verdict_summary === "tier_short"`, and that
summary is an **OR over every row** (`buildReport`). The rows are always the union of `KNOWN_PROVIDERS`
(claude, openai, antigravity) and the config keys, so a config cannot remove a provider. No config value can
make an unprovisioned known provider non-short. `effectiveTier` returns `none` when T1 is down; `validTier`
rejects `none` as a selected tier, so the lowest selectable tier is `t1`, and `none < t1` means `tier_short`.
On a bare host, openai and antigravity therefore saturate the gate at exit 2 whatever claude's row is. Claude's
row contribution is **unobservable** from the exit code there. `main()` is not exported, so no in-process route
exists without a product change.

**Proof (planted regression).** In a throwaway clone of `132a2222`, line 495 was changed so that
`verdict_summary !== "tier_met"` exits 2. That means `unknown-self-attested` now trips `--enforce`, which is
exactly the regression the test exists for. The differential used A = claude `t3` (the row under test,
`unknown-self-attested`), B = claude `t2`, and B' = claude `t1`. The controls differ **only** in claude's
selected tier, and `ANTHROPIC_API_KEY=fixture-value` as in the test.

| Engine | Env | A exit | B / B' exit | Differential (A==B==B') | Detects the regression? |
|---|---|---|---|---|---|
| unmodified | HOST-AS-IS | 0 | 0 / 0 | holds | n/a (no regression) |
| unmodified | BARE-HOST | 2 | 2 / 2 | holds | n/a |
| **planted** | HOST-AS-IS | **2** | 0 / 0 | **fails** | **yes** |
| **planted** | **BARE-HOST** | **2** | **2 / 2** | **HOLDS** | **NO: vacuous pass** |
| planted | STUBBED-HOST | 2 | 0 / 0 | fails | yes |

So the differential is hermetic in that it holds everywhere. It does **not** "still catch the regression" in the
environment CI actually runs, which is the environment that motivated the change. On a bare host it is a
tautology. Adopting it would convert a red test into a green test that cannot fail there. That is a weakening
presented as a reformulation, so per the brief I did not build it and did not reach for a CLI option, product
change or in-process seam.

For completeness, the current absolute test under the same plant exits 1 on HOST-AS-IS (it catches the plant) and
exits 1 on BARE-HOST (it was already red there, so it cannot distinguish).

**Correction to a claim in the s2e premise-findings (evidence for the re-rule, NOT adopted).** s2e said *"the
host's codex/agy state cannot be forced present"*. On win32 it can. `cliPresent` is `<cli> --version` via a
shell, and auth detection is presence-only file reads under `os.homedir()`. STUBBED-HOST (two `.cmd` shims plus
two presence-only files in a temp home) produces openai and antigravity `tier_met`, and A exits 0 on the
unmodified engine. **POSIX shims were not measured.** They would need an executable `sh` shim, and CI is
ubuntu-latest. This is a fifth option (host stubbing: test-only, no product change, no new CLI surface), and
choosing it belongs to the conductor/β, not to this lane.

**What the evidence leaves for the re-rule (not chosen here):**
1. Differential plus a host that is not saturated. That requires STUBBED-HOST, and once stubbed, the
   original absolute assertion also holds hermetically.
2. The ED-435 product question. If only configured providers were graded, the bare-host saturation disappears for
   a claude-only config and the differential (or the absolute) becomes meaningful with no stubbing. That is a
   product decision, filed and not taken.
3. The options β already ruled against (new CLI seam, AC-6.1 change, in-process `main`).

**Before and after, clean clone (unchanged file):** before `132a2222`: HOST-AS-IS 22/0 exit 0; BARE-HOST **21/1**
exit 1. After `e5fabfc7`: identical (HOST-AS-IS 22/0; BARE-HOST 21/1, same failing case).

---

## H3: filed design question, ED-435

Appended to `paths.enforcementDebt` in the **main checkout**. That ledger is gitignored runtime state that exists
only there; appending to it is not a commit. The id came from `scripts/enforcement/next-ed-id.js`. Status
`open`, severity `medium`, `missing_enforcer: none-yet-decided`. Policy text:

> UNDECIDED PRODUCT QUESTION, NOT a defect: which providers `provider-tier-check --enforce` grades. Today
> buildReport() grades the union of cfgLib.KNOWN_PROVIDERS (claude, openai, antigravity) and the config-listed
> providers. An unlisted provider falls back to selected_tier t1 (the framework default). A provider that is not
> provisioned on the host (CLI absent OR auth absent) therefore rows tier_short (AC-6.1: T1 down is never
> unknown) and exits --enforce 2. That holds even for a user who configured only one provider and never chose
> the other two. The alternative model is to grade only configured providers. Absence-means-lowest-tier is a
> coherent model, and reversing it is a product decision. It stays out of scope for the S-OS-06 rename sprint.

Its `note` records the testability coupling measured above.

**Process disclosure.** As first appended, the row carried `record_kind: "design-question"`.
`ed-dup-id-lint.js` flagged it because it treats any `record_kind` key as an update marker, so a genesis row
carrying one looks like a hidden second genesis. I removed that one key from my own row seconds after appending.
The line count was 414 before and after, so no concurrent append was lost. The lint was re-run with its exit code
read directly: **exit 0**, `OK — no genesis-duplicate ED ids`.

---

## Refused / not done / follow-ups for the join

- **No product code changed** (`roadmap.js`, `provider-tier-check.js`, config lib untouched). No
  `.github/workflows/**`. No quarantine runner or `tests/quarantine.json` edit; that register has **no entry** for
  any of these three files, so the fixed tests create no "quarantined file now passes" interaction.
- **Manifest regeneration: NOT done (out of scope). It IS needed at the join.** `_mc/MANIFEST.json` pins
  `sha256`/`installedSha` for both board test files. My edits change both hashes, so the join lane must
  regenerate or BC-02-class checks will read drift. `framework-manifest.json` has no entry for them (grep).
- Not measured: `npm test` / `scripts/checks/run-tests.js` end to end (only the three files were run directly);
  POSIX/Linux; Node 22. The s2e lane showed the cause is independent of Node major and reporter, but I did not
  re-measure that for the new tests. P4 `record-trust-exit-runs` was not measured (another lane's scope).
- Leak gate on the modified worktree before commit: `node scripts/checks/leak-gate.js` → **GREEN (exit 0)**.
  All 16 `SP-20260615-001` tests were run directly in the worktree: every one passes except
  `registry-seed-resolves` (0/1), which is already quarantined and not touched here.
- Typecheck: n/a (plain CommonJS; no TypeScript in scope).
- Incidental, not touched: the stale `parseGaps` docstring ("tolerated absent → count 0") that s2e noted.

## Appendix: raw outputs, verbatim (temp paths redacted to `<tmp>`)

### `before.out`

```text
=== BEFORE (clean clone @132a2222)
checkout=<tmp>\before
HEAD=132a2222  untracked+ignored entries=0
registers dir present=false  enforcement-debt.jsonl=false  recurring-issues.jsonl=false
node=v24.16.0 platform=win32 reporter=direct-run (node <file>)

--- HOST-AS-IS: codex-on-PATH=true agy-on-PATH=true ~/.codex/auth.json=true ~/.gemini/oauth_creds.json=true
  exit=1  roadmap-board-failsoft: 9/15 pass  [tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js]
    FAIL  clean fixture root: all four sections healthy (no false degrade)
    FAIL  malformed ROADMAP § (renamed 'Ranked do-next:' marker) degrades Ranked, rest render
    FAIL  malformed TRACKER § (no 'Current Highest-Priority Next Action' heading) degrades NEXT ACTION, rest render
    FAIL  broken active-sprints.yaml (binary/NUL garbage) degrades In flight, rest render
    FAIL  B5: malformed active-sprints.yaml ('sprints: [' unterminated) degrades In flight, rest render
    FAIL  B5: malformed active-sprints.yaml (unterminated 'primary: "oops') degrades In flight, rest render
  exit=1  roadmap-board-render: 5/6 pass  [tests/regression/SP-20260615-001/roadmap-board-render.test.js]
    FAIL  board cites all four live sources
  exit=0  S-LC-10 provider-tier-check: 22 passed, 0 failed  [tests/regression/S-LC-10/provider-tier-check.test.js]

--- BARE-HOST: codex-on-PATH=false agy-on-PATH=false ~/.codex/auth.json=false ~/.gemini/oauth_creds.json=false
  exit=1  roadmap-board-failsoft: 9/15 pass  [tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js]
    FAIL  clean fixture root: all four sections healthy (no false degrade)
    FAIL  malformed ROADMAP § (renamed 'Ranked do-next:' marker) degrades Ranked, rest render
    FAIL  malformed TRACKER § (no 'Current Highest-Priority Next Action' heading) degrades NEXT ACTION, rest render
    FAIL  broken active-sprints.yaml (binary/NUL garbage) degrades In flight, rest render
    FAIL  B5: malformed active-sprints.yaml ('sprints: [' unterminated) degrades In flight, rest render
    FAIL  B5: malformed active-sprints.yaml (unterminated 'primary: "oops') degrades In flight, rest render
  exit=1  roadmap-board-render: 5/6 pass  [tests/regression/SP-20260615-001/roadmap-board-render.test.js]
    FAIL  board cites all four live sources
  exit=1  S-LC-10 provider-tier-check: 21 passed, 1 failed  [tests/regression/S-LC-10/provider-tier-check.test.js]
    FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0)
```

### `after.out`

```text
=== AFTER (clean clone @e5fabfc7)
checkout=<tmp>\after
HEAD=e5fabfc7  untracked+ignored entries=0
registers dir present=false  enforcement-debt.jsonl=false  recurring-issues.jsonl=false
node=v24.16.0 platform=win32 reporter=direct-run (node <file>)

--- HOST-AS-IS: codex-on-PATH=true agy-on-PATH=true ~/.codex/auth.json=true ~/.gemini/oauth_creds.json=true
  exit=0  roadmap-board-failsoft: 15/15 pass  [tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js]
  exit=0  roadmap-board-render: 8/8 pass  [tests/regression/SP-20260615-001/roadmap-board-render.test.js]
  exit=0  S-LC-10 provider-tier-check: 22 passed, 0 failed  [tests/regression/S-LC-10/provider-tier-check.test.js]

--- BARE-HOST: codex-on-PATH=false agy-on-PATH=false ~/.codex/auth.json=false ~/.gemini/oauth_creds.json=false
  exit=0  roadmap-board-failsoft: 15/15 pass  [tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js]
  exit=0  roadmap-board-render: 8/8 pass  [tests/regression/SP-20260615-001/roadmap-board-render.test.js]
  exit=1  S-LC-10 provider-tier-check: 21 passed, 1 failed  [tests/regression/S-LC-10/provider-tier-check.test.js]
    FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0)
```

### `diff-unmodified.out`

```text
=== UNMODIFIED engine (clean clone @132a2222)  engine-planted-regression=false  node=v24.16.0 platform=win32
--- HOST-AS-IS
  A  claude=t3 exit=0  unknown-self-attested | claude:unknown-self-attested openai:tier_met antigravity:tier_met
  B  claude=t2 exit=0  tier_met | claude:tier_met openai:tier_met antigravity:tier_met
  B' claude=t1 exit=0  tier_met | claude:tier_met openai:tier_met antigravity:tier_met
  differential assertion (A==B, A==B') holds: true   absolute assertion (A exit 0) holds: true
--- BARE-HOST
  A  claude=t3 exit=2  tier_short | claude:unknown-self-attested openai:tier_short antigravity:tier_short
  B  claude=t2 exit=2  tier_short | claude:tier_met openai:tier_short antigravity:tier_short
  B' claude=t1 exit=2  tier_short | claude:tier_met openai:tier_short antigravity:tier_short
  differential assertion (A==B, A==B') holds: true   absolute assertion (A exit 0) holds: false
--- STUBBED-HOST
  A  claude=t3 exit=0  unknown-self-attested | claude:unknown-self-attested openai:tier_met antigravity:tier_met
  B  claude=t2 exit=0  tier_met | claude:tier_met openai:tier_met antigravity:tier_met
  B' claude=t1 exit=0  tier_met | claude:tier_met openai:tier_met antigravity:tier_met
  differential assertion (A==B, A==B') holds: true   absolute assertion (A exit 0) holds: true
```

### `diff-planted.out`

```text
=== PLANTED-REGRESSION engine (clean clone @132a2222 + 1-line plant at provider-tier-check.js:495)  engine-planted-regression=true  node=v24.16.0 platform=win32
--- HOST-AS-IS
  A  claude=t3 exit=2  unknown-self-attested | claude:unknown-self-attested openai:tier_met antigravity:tier_met
  B  claude=t2 exit=0  tier_met | claude:tier_met openai:tier_met antigravity:tier_met
  B' claude=t1 exit=0  tier_met | claude:tier_met openai:tier_met antigravity:tier_met
  differential assertion (A==B, A==B') holds: false   absolute assertion (A exit 0) holds: false
--- BARE-HOST
  A  claude=t3 exit=2  tier_short | claude:unknown-self-attested openai:tier_short antigravity:tier_short
  B  claude=t2 exit=2  tier_short | claude:tier_met openai:tier_short antigravity:tier_short
  B' claude=t1 exit=2  tier_short | claude:tier_met openai:tier_short antigravity:tier_short
  differential assertion (A==B, A==B') holds: true   absolute assertion (A exit 0) holds: false
--- STUBBED-HOST
  A  claude=t3 exit=2  unknown-self-attested | claude:unknown-self-attested openai:tier_met antigravity:tier_met
  B  claude=t2 exit=0  tier_met | claude:tier_met openai:tier_met antigravity:tier_met
  B' claude=t1 exit=0  tier_met | claude:tier_met openai:tier_met antigravity:tier_met
  differential assertion (A==B, A==B') holds: false   absolute assertion (A exit 0) holds: false
```

### `planted-absolute.out`

```text
=== PLANTED: current absolute test
checkout=<tmp>\planted
HEAD=132a2222  untracked+ignored entries=1
registers dir present=false  enforcement-debt.jsonl=false  recurring-issues.jsonl=false
node=v24.16.0 platform=win32 reporter=direct-run (node <file>)

--- HOST-AS-IS: codex-on-PATH=true agy-on-PATH=true ~/.codex/auth.json=true ~/.gemini/oauth_creds.json=true
    FAIL  clean fixture root: all four sections healthy (no false degrade)
    FAIL  malformed ROADMAP § (renamed 'Ranked do-next:' marker) degrades Ranked, rest render
    FAIL  malformed TRACKER § (no 'Current Highest-Priority Next Action' heading) degrades NEXT ACTION, rest render
    FAIL  broken active-sprints.yaml (binary/NUL garbage) degrades In flight, rest render
    FAIL  B5: malformed active-sprints.yaml ('sprints: [' unterminated) degrades In flight, rest render
    FAIL  B5: malformed active-sprints.yaml (unterminated 'primary: "oops') degrades In flight, rest render
    FAIL  board cites all four live sources
  exit=1  S-LC-10 provider-tier-check: 21 passed, 1 failed  [tests/regression/S-LC-10/provider-tier-check.test.js]
    FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0)

--- BARE-HOST: codex-on-PATH=false agy-on-PATH=false ~/.codex/auth.json=false ~/.gemini/oauth_creds.json=false
    FAIL  clean fixture root: all four sections healthy (no false degrade)
    FAIL  malformed ROADMAP § (renamed 'Ranked do-next:' marker) degrades Ranked, rest render
    FAIL  malformed TRACKER § (no 'Current Highest-Priority Next Action' heading) degrades NEXT ACTION, rest render
    FAIL  broken active-sprints.yaml (binary/NUL garbage) degrades In flight, rest render
    FAIL  B5: malformed active-sprints.yaml ('sprints: [' unterminated) degrades In flight, rest render
    FAIL  B5: malformed active-sprints.yaml (unterminated 'primary: "oops') degrades In flight, rest render
    FAIL  board cites all four live sources
  exit=1  S-LC-10 provider-tier-check: 21 passed, 1 failed  [tests/regression/S-LC-10/provider-tier-check.test.js]
    FAIL  CLI --enforce: unknown-self-attested NEVER trips the gate (fail-open exit 0)
```

### `probes.out`

```text
=== MUTATION PROBES  node=v24.16.0 platform=win32  env=HOST-AS-IS (board tests do not read provider host state)  each row = fresh clean shared clone + named plant(s)

--- [P1-before] @132a2222 plants=[eisdir-swallow] test=tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js registers-present=no
  FAIL  clean fixture root: all four sections healthy (no false degrade)
  FAIL  malformed ROADMAP § (renamed 'Ranked do-next:' marker) degrades Ranked, rest render
  FAIL  malformed TRACKER § (no 'Current Highest-Priority Next Action' heading) degrades NEXT ACTION, rest render
  FAIL  broken active-sprints.yaml (binary/NUL garbage) degrades In flight, rest render
  FAIL  B5: malformed active-sprints.yaml ('sprints: [' unterminated) degrades In flight, rest render
  FAIL  B5: malformed active-sprints.yaml (unterminated 'primary: "oops') degrades In flight, rest render
  roadmap-board-failsoft: 9/15 pass
    exit=1

--- [P1-after] @e5fabfc7 plants=[eisdir-swallow] test=tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js registers-present=no
  FAIL  unreadable open-gaps register (EISDIR) degrades Open gaps, rest render
  roadmap-board-failsoft: 14/15 pass
    exit=1

--- [P2-before] @132a2222 plants=[b4-missing-as-zero] test=tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js registers-present=no
  FAIL  B4: MISSING open-gaps registers degrade Open gaps to 'section unavailable' (not count 0)
  FAIL  all sources missing (empty root): every section degrades, board still renders, no throw
  FAIL  B4 probe: --root <nonexistent> → In-flight AND Open-gaps both 'section unavailable'
  roadmap-board-failsoft: 12/15 pass
    exit=1

--- [P2-after] @e5fabfc7 plants=[b4-missing-as-zero] test=tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js registers-present=no
  FAIL  B4: MISSING open-gaps registers degrade Open gaps to 'section unavailable' (not count 0)
  FAIL  all sources missing (empty root): every section degrades, board still renders, no throw
  FAIL  B4 probe: --root <nonexistent> → In-flight AND Open-gaps both 'section unavailable'
  roadmap-board-failsoft: 12/15 pass
    exit=1

--- [P3-before-hostregs] @132a2222 plants=[sprints-path-drift host-registers] test=tests/regression/SP-20260615-001/roadmap-board-render.test.js registers-present=yes
  roadmap-board-render: 6/6 pass
    exit=0

--- [P3-after] @e5fabfc7 plants=[sprints-path-drift] test=tests/regression/SP-20260615-001/roadmap-board-render.test.js registers-present=no
  FAIL  REAL tree: the three tracked sources resolve and are cited (TRACKER.md, ROADMAP.md, active-sprints.yaml)
  FAIL  board cites all four live sources (fixture writes the two runtime registers)
  roadmap-board-render: 6/8 pass
    exit=1

--- [P3-after-hostregs] @e5fabfc7 plants=[sprints-path-drift host-registers] test=tests/regression/SP-20260615-001/roadmap-board-render.test.js registers-present=yes
  FAIL  REAL tree: the three tracked sources resolve and are cited (TRACKER.md, ROADMAP.md, active-sprints.yaml)
  FAIL  board cites all four live sources (fixture writes the two runtime registers)
  roadmap-board-render: 6/8 pass
    exit=1

--- [REV-before-hostregs] @132a2222 plants=[host-registers] test=tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js registers-present=yes
  roadmap-board-failsoft: 15/15 pass
    exit=0

--- [REV-before-hostregs-R] @132a2222 plants=[host-registers] test=tests/regression/SP-20260615-001/roadmap-board-render.test.js registers-present=yes
  roadmap-board-render: 6/6 pass
    exit=0

--- [REV-after-hostregs] @e5fabfc7 plants=[host-registers] test=tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js registers-present=yes
  roadmap-board-failsoft: 15/15 pass
    exit=0

--- [REV-after-hostregs-R] @e5fabfc7 plants=[host-registers] test=tests/regression/SP-20260615-001/roadmap-board-render.test.js registers-present=yes
  roadmap-board-render: 8/8 pass
    exit=0
```
