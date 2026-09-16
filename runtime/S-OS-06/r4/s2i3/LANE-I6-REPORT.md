# LANE-I6 REPORT: S-OS-06 r4, lane I6 (refuse-on-empty, parser property, case (e), vacuity count)

STATUS: COMPLETE. All six steps were reached. Started 15:01:12 and finished about 15:09 PDT on 2026-09-16. Branch `s-os-06/s2i-capture`, from `d72fa29e`.
Commits: `aa0835ca` stub · `1a28f205` runner (steps 1+2) · `95777f2c` (e) + (i) · `2a3fa5c4` vacuity count · `7c799b20` (j) + mutants · this report + suite evidence.
Everything was measured on win32 / node v24.16.0.

## 0. Premise check: one premise is PARTLY FALSE. I proved it and did not stop, because the work still stands

**The brief says:** "find where that branch currently exits and make it fail closed". That assumes an empty capture could pass.
- **On this branch** (`aa0835ca`, before I6), an empty observed capture did **not** pass. It went into `isVacuous()`, which returns true for an empty array, and exited 1 as `CAUSE-LOCK: … vacuous`. I5 measured this for the dummy, and it is the path (f) was green through.
- It failed closed, but only through the vacuity rule and the load-time non-empty rule. It was not a refusal in its own right. It also produced a *verdict* ("cause lock"), not "could not look". That verdict is exactly what turned (f) green for the wrong reason.
- **The empty-reads-as-agreement path is real, and it is in the COMMITTED runner** (`6d46a818`). §5 measures it: **6 of 23 entries.**

So the property β stated is violated in the committed runner, not on this branch. On this branch it is now a first-class refusal.

## 1. The runner property: an EMPTY observed capture is INDETERMINATE and REFUSES (`scripts/checks/run-tests.js`)

- **L818-822 (new branch, checked before vacuity):** if `observed.length === 0`, then `unobserved++`, and the violation `INDETERMINATE: <file> fails, but the observed cause capture is EMPTY — the runner could not look, which is not an observation that the cause is unchanged; refused`.
  - It exits through `quarantineOk = violations.length === 0` → `return quarantineOk ? 0 : 1` (exit 1).
- **L402, defense in depth:** `sameMultiset()` never matches when either side is empty (`a.length > 0 && b.length > 0`). No future caller can read empty as "equal".
- **Named finding, NOT changed (outside the stated property):** the COUNT-LOCK has the same shape. It runs only when a failing-test count was observed (`fc !== null && fc > e.failCount`), so an unobservable count is skipped silently. It is not refused. I left it alone because β's ruling covers the cause capture. It needs its own ruling.

## 2. The parser fix: key indent read as a PROPERTY, not a literal

- **`parseDiagnosticBlock` L283-291:** the block's key indent is the indent of its first key-shaped line at **>= the marker's indent**. The whole block is then read at that indent. There is no literal (`ind`, `ind + 2` or anything else).
- **L306-307:** a block scalar's content indent is the indent of its first content line when that is deeper than the key indent. Otherwise the old `+2` applies.
- **Both forms accepted, on REAL node 24 output** (`i6/parser-probe.txt`):
  - Real `node --test --test-reporter=tap` output of the FAILING dummy (keys AT the marker indent) → `["dummy rot: still failing","1 !== 2"]`
  - The same bytes with every diagnostic-block line shifted +2 (keys DEEPER) → `["dummy rot: still failing","1 !== 2"]`

## 3. Case (e): authorized (β row 488, branch ii)

**Required-set delta, measured with `git show`:**
- committed `6d46a818` L37 `REQUIRED_FIELDS`: `[file, firstFailingAssertion, cause, filedUnder, expiry, expiryVersion]`
- rewrite L118 `ENTRY_FIELDS_REQUIRED`: `[file, causeLines, failCount, cause, filedUnder, expiry, expiryVersion, observedOn]`, which is **NON-EMPTY (8)**
- **REMOVED `{firstFailingAssertion}`**, exactly **one** field. **ADDED `{causeLines, failCount, observedOn}`.**

**What changed in (e):**
- Its literal now points at `causeLines`, a member of the emitted set: `/missing a non-empty "causeLines"/`.
- An **INVERSE** was net-added inside (e): the same entry, built WITH its fields, must not match that message or `is malformed`.
- The property survives: the bad-JSON half and the fieldless half both still assert a non-zero exit.
- **RED-then-GREEN for (e) alone:**
  - `M_oldE` (the old literal restored, 1 line) → (e) ✖, every other case ✔.
  - `M_causeReq` (runner stops requiring `causeLines`, 1 line) → (e) ✖, every other case ✔.
  - `M0` (identity) → (e) ✔.

## 4. Red-then-green, one case at a time (one-line mutants in temp mirrors; raw outputs in `i6/mutants/`)

**Fixture helper:** the default registered multiset is now the FAILING dummy's *measured* capture, `["1 !== 2","dummy rot: still failing"]` (canonical order). A non-default `firstFailingAssertion` override, like (f)'s, still registers one line. This is fixture construction, not an assertion. It is what I5's X2 showed (b)/(h) need together with the parser.

| mutant (lines changed) | a | b | c | d | e | f | g | h | i | j | real |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M0 identity (0) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| M_multiset: multiset lock → `false` (1) | ✔ | ✔ | ✔ | ✔ | ✔ | **✖** | ✔ | ✔ | ✔ | ✔ | ✔ |
| M_indet: INDETERMINATE branch → `false` (1) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **✖** | ✔ | ✔ |
| M_vacuity: vacuity branch → `false` (1) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **✖** | ✔ |
| M_causeReq (1) | ✔ | ✔ | ✔ | ✔ | **✖** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| M_oldE (1, test file) | ✔ | ✔ | ✔ | ✔ | **✖** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| M_oldparser: key indent pinned to `ind + 2` (1) | ✔ | **✖** | ✔ | ✔ | ✔ | **✖** | ✔ | **✖** | ✔ | **✖** | ✔ |

- **(b) and (h)** are GREEN under the fixed parser and RED when the old literal returns (`M_oldparser`). Their assertions are byte-unchanged.
- **(f) is proven.** It is RED only when the multiset lock is neutralized and GREEN when the lock is restored. That closes the vacuous pass.
  - Under `M_oldparser`, (f) is now RED: the empty capture refuses as INDETERMINATE, not as a CAUSE-LOCK verdict. A dead parser can no longer turn (f) green for the wrong reason.
- **(i) INDETERMINATE (net-added), the falsifier for the refuse-on-empty branch:** the dummy is `process.exitCode = 1;`. Its measured capture is `[]`, because the whole-file block carries `exitCode` and is not authored.
  - Removing the branch turns (i) ✖ alone.
  - The detection is at **message/count level**: with the branch removed, the vacuity rule still exits 1. The *outcome* cannot flip, because a register cannot hold an empty multiset (L497 load-time rule) and L402 refuses empty equality.
- **(j) VACUITY (net-added), the falsifier for the vacuity branch itself:** the dummy's only cause line is its own test name. Its measured capture is `["vacant"]` with names `["vacant"]`, registered as `["vacant"]`, so the load-time vacuity check (file path only) accepts it.
  - Removing the branch turns (j) ✖ alone, **at OUTCOME level.** The mutant runner printed `run-tests: PASS … 1 still failing` and exited 0: the vacuous lock matched and absolved.
  - This is the branch I5 X6 showed nothing covered.
- **Byte comparison** of every `test(...)` block against `d72fa29e` (`i6/case-compare.txt`, sha256/16):
  - (a) (b) (c) (d) (f) (g) (h) and the real-register case: **BYTE-UNCHANGED**
  - (e): CHANGED (authorized)
  - (i) (j): NET-ADDED

**SUITE measurement (β row 491), not standalone:** `node scripts/checks/run-tests.js` ran through the runner with its shared child environment (`i6/SUITE_run.txt`).
- The falsifier file is **11/11 `ok`** in the suite's own output: L7726 (a) … L7774 (i), L7780 (j), L7786 (real register).
- Quarantine: `23 entries, 23 still failing, 0 unexpectedly passed, 0 missing/undiscovered, 0 unobserved, 0 not verified at base`, with 0 QUARANTINE VIOLATION lines.
- **Overall suite result: FAIL, exit 1.** The primary run had 5 failing tests in other files (none here):
  - L857 "live tree … default gate"
  - L1837 "real betaEvents corpus"
  - L8236 "record-trust-exit GREEN"
  - L10423 `roadmap-board-failsoft.test.js`
  - L10455 `roadmap-board-render.test.js`
  - **cannot-assess:** these are outside my file scope and I did not diagnose them.
- **Suite side effects (recorded in `i6/suite-side-effects.txt`, then undone):**
  - The run modified the out-of-scope `scripts/open-source/rename-mc.occurrences.json` (+50/-46).
  - It created untracked `runtime/S-OS-06/fixture-product/`, `rename-occurrences.full.json` and `rename-plan.json`.
  - The worktree was clean before the run. I ran `git restore` on the occurrence register and removed the three untracked artifacts. None were committed.
  - **Finding:** a test in the suite writes to the occurrence register.

## 5. THE VACUITY COUNT, per entry, BOTH runners (`i6/vacuity-count.{js,txt,json}`)

**The pre-committed interpretation, quoted before the run and applied unchanged:**
> *"If any of the 23 moves under the fixed parser, that is evidence about how many locks were vacuous or mis-captured — a finding, not a quarantine violation, not grounds to revert the parser fix; the honest response is to re-register the entry from a real observation."*

**Method:**
- Every observation is a real child run of the real file from the worktree root.
- **COMMITTED:** the `6d46a818` runner's own `childEnv`, its spawn shape (`node --test <file>`), and its `firstFailureLine`/`normalizeFailure`, extracted verbatim from `git show`. The lock is its `observed.includes(registered)` against the `6d46a818` register.
- **FIXED:** HEAD's exported `runNodeTest` + `captureCauseLines`, compared with multiset equality against the HEAD register.
- **PREFIX:** the `aa0835ca` capture applied to the SAME tap bytes as FIXED, so any move is caused by the parser alone.
- **Ambient environment during the count:** `MC_DISPATCH_BACKGROUND`, `WARPOS_ACTOR_KIND` and `WARPOS_BOUND_ROLE` were set. It was not scrubbed; that is the next dispatch.

| # | entry | COMMITTED observed | committed registered | committed lock | PREFIX observed (n) | FIXED observed (n) | FIXED vacuous | FIXED lock |
|---|---|---|---|---|---|---|---|---|
| 1 | tests/mc/dispatch-readiness.test.js | non-empty | real line | MATCH | non-empty (92) | non-empty (92) | no | MATCH |
| 2 | tests/mc/lib/provider-autofix.unit.test.js | non-empty | real line | MATCH | non-empty (8) | non-empty (8) | no | MATCH |
| 3 | tests/mc/lib/provider-rca.unit.test.js | non-empty | real line | MATCH | non-empty (8) | non-empty (8) | no | MATCH |
| 4 | tests/mc/product-bootstrap.unit.test.js | non-empty | real line | MATCH | non-empty (8) | non-empty (8) | no | MATCH |
| 5 | tests/mc/provider-smoke.unit.test.js | non-empty | real line | MATCH | non-empty (8) | non-empty (8) | no | MATCH |
| **6** | **tests/regression/S-LC-06/coverage-gate-caller.test.js** | **EMPTY** | **empty sentinel** | **MATCH** | non-empty (2) | non-empty (2) | no | MATCH |
| **7** | **tests/regression/S-LC-06/mode-profile.test.js** | **EMPTY** | **empty sentinel** | **MATCH** | non-empty (7) | non-empty (7) | no | MATCH |
| 8 | tests/regression/S-LC-07/spend-ledger.test.js | non-empty | real line | MATCH | non-empty (35) | non-empty (35) | no | MATCH |
| 9 | tests/regression/S-PF-01/scaffold-coverage-telemetry.test.js | non-empty | real line | MATCH | non-empty (31) | non-empty (31) | no | MATCH |
| **10** | **tests/regression/S-PF-03/admin-surface.test.js** | **EMPTY** | **empty sentinel** | **MATCH** | non-empty (9) | non-empty (9) | no | MATCH |
| **11** | **tests/regression/S-PF-04/founders-checklist.test.js** | **EMPTY** | **empty sentinel** | **MATCH** | non-empty (7) | non-empty (7) | no | MATCH |
| 12 | tests/regression/SP-20260518-007/docs-and-skill-bodies.test.js | non-empty | real line | MATCH | non-empty (7) | non-empty (7) | no | MATCH |
| 13 | tests/regression/SP-20260518-008/hooks-and-diagnostics.test.js | non-empty | real line | MATCH | non-empty (15) | non-empty (15) | no | MATCH |
| 14 | tests/regression/SP-20260611-001/epsilon-spawn-grace.test.js | non-empty | real line | MATCH | non-empty (51) | non-empty (51) | no | MATCH |
| 15 | tests/regression/SP-20260611-001/review-fallback-shape.test.js | non-empty | real line | MATCH | non-empty (27) | non-empty (27) | no | MATCH |
| 16 | tests/regression/SP-20260611-001/sprint-id-correlation.test.js | non-empty | real line | MATCH | non-empty (7) | non-empty (7) | no | MATCH |
| 17 | tests/regression/SP-20260611-001/window-clamp.test.js | non-empty | real line | MATCH | non-empty (7) | non-empty (7) | no | MATCH |
| **18** | **tests/regression/SP-20260611-002/coverage-gate-scan-live-cli.test.js** | **EMPTY** | **empty sentinel** | **MATCH** | non-empty (32) | non-empty (32) | no | MATCH |
| **19** | **tests/regression/SP-20260611-002/coverage-gate-scan-source.test.js** | **EMPTY** | **empty sentinel** | **MATCH** | non-empty (8) | non-empty (8) | no | MATCH |
| 20 | tests/regression/SP-20260611-002/wrapper-mode-binding.test.js | non-empty | real line | MATCH | non-empty (7) | non-empty (7) | no | MATCH |
| 21 | tests/regression/SP-20260615-001/registry-seed-resolves.test.js | non-empty | real line | MATCH | non-empty (7) | non-empty (7) | no | MATCH |
| 22 | tests/regression/SP-20260616-001/wrapper-door.test.js | non-empty | real line | MATCH | non-empty (16) | non-empty (16) | no | MATCH |
| 23 | tests/regression/SP-20260627-001/negative-fixtures.test.js | non-empty | real line | MATCH | non-empty (2) | non-empty (2) | no | MATCH |

**COUNT:**
- **COMMITTED runner (`6d46a818`): 6 of 23 observed EMPTY.** In all 6, the register holds the empty sentinel `(no failure line captured)`, the observed value is that same sentinel, and `observed.includes(registered)` reports **MATCH**.
  - That is the row-472 path, measured: **an empty capture read as agreement.**
  - Entries #6, #7, #10, #11, #18 and #19.
- **FIXED runner (HEAD): 0 of 23 observed empty, 0 of 23 vacuous, 23 of 23 multiset MATCH.**
- **PREFIX vs FIXED: 0 of 23 moved under the parser fix**, same counts and same lock results. The parser-vacuity path does not reach the real register.

**Severity, from the pre-committed rules:**
- **The COMMITTED runner has vacuous locks, so HIGH applies to entries #6, #7, #10, #11, #18 and #19.** On `6d46a818`, each of those locks reported a match while matching nothing. That is a store-state falsehood.
- On the branch runner (prefix and fixed) the count is 0 of 23. For the branch, β's MEDIUM rating on the ambient-environment finding stands.
- Following the interpretation, the honest response for those 6 on the committed side is re-registration from a real observation. The branch register already carries non-empty observed multisets for all 6 (2-32 lines each). I did not re-register anything.

## 6. The two checks that could have slipped

**`observedOn` carries all THREE stamps (row 473 condition 5).**
- **Enforced:** L489-494 refuses an entry unless `observedOn` is an object with a non-empty `platform` string, an integer `nodeMajor` >= 1 and a `reporter` string, and `reporter` must equal the pinned `REPORTER`.
- **Contents (measured):** all 23 entries carry exactly one distinct value, `{"platform":"win32","nodeMajor":24,"reporter":"tap"}`. That is 23 of 23 with three stamps, not a date.

**The register-level BASE assertion (row 476 P4) is still asserted, at register grain.**
- **L466:** `loadQuarantine` refuses unless `base` is a full 40-hex commit id. This is a register field, outside the per-entry list.
- **L531:** `checkRealRegisterBase` refuses when the real register's `base !== EXPECTED_REAL_BASE`. The constant is at **L70**, `669aadc1ab7dc03d74f5b95cb613a5573f4e54a6`.
- **L702:** `main()` calls it and returns 1 with `run-tests: FAIL — …`.
- The register's `base` measured `669aadc1…`, which is equal.

## 7. Refused, not reached, and out of scope

- **Not done:**
  - I did not extend INDETERMINATE to an unobserved failing-test count (`fc === null`). That is the named finding in §1 and needs its own ruling.
  - I did not re-register any entry.
  - I did not scrub the environment (next dispatch).
- **Not touched:**
  - `.github/workflows/**`, manifests, `.claude/settings.json`, `partition-loader.js`.
  - The occurrence register, apart from undoing the suite's own write to it (§4).
- **cannot-assess:**
  - The 5 primary suite failures in other files.
  - Whether the committed runner's 240-char truncation (row 472's other half) caused any mismatch. The count measured emptiness, not truncation.
  - Behaviour on any node major other than 24.
