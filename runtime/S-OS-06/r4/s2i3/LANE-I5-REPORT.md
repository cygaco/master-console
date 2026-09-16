# LANE-I5 REPORT: S-OS-06 r4, lane I5 (finding the shared fixture cause)

STATUS: COMPLETE. Written 2026-09-16, about 14:31 PDT (started 14:24:41). Branch `s-os-06/s2i-capture`.
Scope: β a5e2c418 (DECIDE, Class B). I did not edit any assertion. I did not touch the runner, the register, workflows, manifests, settings or partition-loader.

## 0. Premise check: all premises held

- `tests/regression/S-OS-06/falsify-quarantine-runner.test.js` has 9 cases. (b) is at L114 and the ninth is at L186. The ninth never spawns the runner and was the only case passing: baseline 1/9, `/tmp/i5-before.txt`.
- `entry()` is at L46 and `withRepo()` is at L60, both at the pre-edit commit `e9e5cd8a`.
- The real `tests/quarantine.json` has 23 entries. All 23 carry `filedUnder`, `expiry` and `expiryVersion`. Measured with `node -e`: 23/23.

## 1. The shared cause, with evidence

**Yes, the cause is in the helper, as β guessed. It has three layers, and all of them are fixture construction.** The rewritten runner rejects every register the helper builds in `loadQuarantine()`, before a single test runs. Every case that reaches the runner exits 1 with `run-tests: FAIL — quarantine artifact … is malformed:` (baseline output):

1. **Header fields missing** (register level, every case):
   - `"base" must be a full 40-hex commit id` (run-tests.js L450)
   - `"$normalizer"`, `"$dropClass"` and `"$ceilings"` must equal the runner's declarations (L454-456)
2. **Entry format outdated** (every `entry()`-built entry):
   - `has an unknown field "firstFailingAssertion"` (L464)
   - `needs an "observedOn" stamp` (L474-476)
   - `is missing a non-empty "causeLines" array` (L482)
3. **No base commit in the fixture repo.** `withRepo` ran `git init` and `git add -A` but never committed. The runner requires `base^{commit}` to exist (L692) and every entry file to exist at base (L523-533). This layer was hidden behind layer 1 and shows up once `base` is supplied.

(d) and (g) build no `entry()` objects, and they still failed on layer 1 alone. That confirms the header layer is shared by all 8.

## 2. What I changed (fixture construction only), commit `6191c672`

In `tests/regression/S-OS-06/falsify-quarantine-runner.test.js`:
- `const RUNNER_DECL = require(RUNNER)`. The fixture imports the runner's own `NORMALIZER_DECLARATION`, `DROP_CLASS_DECLARATION`, `CEILINGS` and `currentStamp`, so it has no copy of them that could drift. The module's `require.main` guard keeps `main()` from running.
- `entry()` still builds the same object. It then turns the old `firstFailingAssertion` into `causeLines: [that string]`, adds `observedOn: currentStamp()` when missing, and deletes the old key. That means the override at L161 in case (f) still reaches the register unchanged.
- New `fixtureCommit(dir)` commits the fixture's test files under a fixture identity, with `--no-verify`, no gpgsign and `--allow-empty`, and returns HEAD.
- `withRepo()` runs init, add, commit (which becomes the base), then writes the register, then runs add again. For object registers only, it fills in `$floor` (as before), `base`, `$normalizer`, `$dropClass` and `$ceilings` when a case hasn't set them. Raw-string registers, like the malformed-JSON half of case (e), are written verbatim.

**Proof the case bodies are unchanged:** from `const realBefore` to the end of the file (all 9 `test(...)` blocks) is byte-identical to HEAD~ (`cmp` exit 0; sha256 prefix `2417e243b9bcfceb`).

## 3. Re-run per case (real runner, committed fixture)

`node --test tests/regression/S-OS-06/falsify-quarantine-runner.test.js` went from **1/9 to 6/9**. The temp-mirror identity control `M0_identity` gives the same 6/9.

| case | before | after | remaining cause |
|---|---|---|---|
| (a) passing quarantined → non-zero | ✖ | ✔ | none |
| (b) failing quarantined subtracted → exit 0 | ✖ | **✖** | runner capture defect (§4.1) + incomplete registered multiset |
| (c) missing quarantined → non-zero | ✖ | ✔ | none |
| (d) control not quarantined → exit 1 | ✖ | ✔ | none |
| (e) malformed artifact fails closed | ✖ | **✖** | first half (bad JSON) ✔; second half is an **assertion-literal** contract change (§4.2) |
| (f) CAUSE-LOCK → non-zero | ✖ | ✔ **for the wrong reason** | fires on the vacuity branch, not the multiset lock (§5) |
| (g) floor → non-zero | ✖ | ✔ | none; red-then-green discharged (§5) |
| (h) version expiry → non-zero | ✖ | **✖** | same capture defect as (b) (§4.1) |
| real register untouched | ✔ | ✔ | none |

## 4. Survivors: what each one needs

### 4.1 (b) and (h) share a SECOND cause, in the runner

**What I measured:** the runner's capture of the dummy's authored assertion message returns **`[]`**. `captureCauseLines` on node 24.16.0 TAP output: `status 1`, lines `[]`, testNames `["dummy rotted"]`. The observed multiset is empty, so it is vacuous, and the runner reports `CAUSE-LOCK: … the observed cause lines are vacuous` **before** it ever reaches the still-failing branch (b) or the EXPIRED branch (h).

**Why:** `parseDiagnosticBlock()` (run-tests.js L278) expects YAML keys at `keyInd = ind + 2`. Node 24's TAP reporter puts them at the **same** indent as `---`:
- top level: `  ---` / `  failureType: 'testCodeFailure'` / `  error: |-`
- nested: `      ---` / `      failureType: …`

So the parser never matches a key, `error` stays null, and the authored `error` value is never captured. The runner's own header (L26-28) says that value is captured. As a direct probe, shifting the YAML block right by 2 makes the same parser capture `["nested rot msg","1 !== 2","dummy rot: still failing","1 !== 2"]`.

**Test for real defect vs stale assumption.** All runs use temp mirrors: a copied test file, a copied or mutated runner, and a copied register. The worktree runner was never modified. Outputs are in `runtime/S-OS-06/r4/s2i3/i5-mutants/`.

| config | runner change | test-file change (mirror only) | b | h |
|---|---|---|---|---|
| M0_identity | none | none | ✖ | ✖ |
| X7_asis_fulltest | none | registered multiset = measured `["1 !== 2","dummy rot: still failing"]` | ✖ | ✖ |
| M_parser_keyInd | `keyInd = ind` | none | ✖ (multiset mismatch: extra `1 !== 2`) | ✖ |
| **X2_parser_fulltest** | `keyInd = ind` | full measured multiset | **✔** | **✔** |

- A fixture change alone can't make (b) or (h) green (X7). A runner change alone can't either (M_parser). Only both together (X2) turn them green, with the assertions byte-unchanged.
- (b) and (h) are therefore **not contract flips.** Their assertions hold as written once the capture works.
- The single-line `causeLines` I carried over from `firstFailingAssertion` also wouldn't match a working capture, because node puts `1 !== 2` into the error value.

**What (b) and (h) each need (authorization required, not done):**
- (i) A runner fix to `parseDiagnosticBlock`'s key indent. That file is out of my file scope, and it's a runner-behaviour change.
- (ii) The fixture's default registered multiset set to the measured full multiset. That is a register-content decision inside the fixture.

The only fixture-only alternative is to rewrite the FAILING dummy so it prints its cause as a comment line. **I refused that:** it would turn (b) and (h) green by routing around a dead capture path the runner claims to have.

**Effect on the real register (checked statically, not measured):** 0 of the 23 real entries import `node:test`. Their `!==` lines, in 5 entries, come in through TAP **comment** lines. I confirmed this for `wrapper-mode-binding.test.js`: `# 1 !== 0` is a comment line, not YAML. A whole-file failure's YAML block carries `exitCode`, which `authored` excludes (L304). So a parser fix is *not expected* to change the real register. Re-running all 23 under a fixed parser was out of scope (no re-capture) and outside the time box: **cannot-assess, measured**.

### 4.2 (e) second half: a genuine contract change in an assertion literal

- The fieldless entry `{ file }` still fails closed. The non-zero status assertion passes.
- The message assertion at the old L155 (`/missing a non-empty "firstFailingAssertion"/`) looks for a field the runner removed from `ENTRY_FIELDS_REQUIRED` (L118). The runner now says `missing a non-empty "causeLines" array`.
- It stays red in every one of the 14 mutant and mirror configs. No fixture change can fix it without the fixture writing the expected text, which would be tampering.
- **Needs per-case authorization for an assertion change**, e.g. the regex becomes `/missing a non-empty "causeLines"/`. I did NOT make it.

## 5. β's own falsifiers (f), (g), (h): red-then-green, each run separately

Method: a temp mirror with one guard in the runner neutralized (`sed` to `if (false)`, 1-3 changed lines, diff-counted), then the whole file run under it. Case results are read per case.

**(g) EMPTY-SUBJECT floor: DISCHARGED on the committed state.** M0 (real copy): g ✔. M_floor (floor check removed): **g ✖**, and no other case changes state.

**(f) CAUSE-LOCK: NOT DISCHARGED on the committed state.**
- M0: f ✔.
- M_multiset (multiset lock removed): **f still ✔**.
- M_vacuous (vacuity branch removed): **f still ✔**.
- Only M_vacuous_and_multiset (both removed) turns f ✖.

Right now (f) goes green through the vacuity branch that §4.1 causes, so removing the multiset lock it names goes undetected. In the X2 world (parser fixed + full multiset): X3 (multiset lock removed) gives **f ✖ alone**, and X6 (vacuity removed) gives f ✔. So (f) does test its property, but only once §4.1 is fixed.

**(h) per-entry version EXPIRY: NOT DISCHARGED on the committed state** (red for the §4.1 cause, not its own).
- X1 (vacuity + multiset + expiry removed): h ✖, versus M_vacuous_and_multiset: h ✔.
- In the X2 world: X4 (expiry removed) gives **h ✖ alone**, and X2 gives h ✔.
- So its assertion does test expiry, but only after the §4.1 fix.

In the X2 world, X5 (floor removed) gives **g ✖ alone**, which confirms (g) there as well.

Side finding: X6 shows **no case covers the vacuity branch itself**. Removing it changes no result in the X2 world. That's a missing falsifier, not something I acted on.

## 6. β's prediction versus what I measured

β predicted: *"One helper defect explains seven of the eight; only (b) is a genuine contract flip."* **That was contradicted.**

| cause | cases |
|---|---|
| helper defect alone (§1), fixed by fixture construction | **5 of 8**: (a) (c) (d) (g), plus (f) green for the wrong reason, so 4 properly discharged |
| helper defect + runner capture defect (§4.1), not contract flips | **2 of 8**: (b) and (h) |
| helper defect + a genuine contract flip (assertion literal) | **1 of 8**: (e), second half |

- The one genuine contract flip is **(e), not (b)**.
- **(b) is not a contract flip.** Its assertions pass byte-unchanged once the capture parser works and the fixture registers the measured multiset (X2).
- The helper defect is present in all 8, but it is the *whole* cause in only 5.

## 7. What I refused or left alone

- I made no assertion edit in any case. That includes (e), and I did not fold anything into (b)'s clearance.
- I did not change the runner. The `keyInd` fix exists only in temp mirrors and was never written to the worktree: `git status` is clean apart from this report and the mutant outputs.
- I did not rewrite the FAILING dummy to route around the dead capture path (§4.1).
- I didn't touch the F3 ambient-env remedy, re-capture the register, or touch workflows, manifests, settings or partition-loader.
- **cannot-assess:** a measured run of the 23 real entries under a parser-fixed runner (§4.1), and whether `keyInd = ind + 2` was correct for some earlier node major. I only measured node 24.16.0, which matches the register's `observedOn.nodeMajor`.

## Artifacts

- Commits `e9e5cd8a` (stub) and `6191c672` (fixture fix); this report and `i5-mutants/*.txt` are committed after them.
- `runtime/S-OS-06/r4/s2i3/i5-mutants/`: 14 raw `node --test` outputs (M0_identity, M_floor, M_multiset, M_vacuous, M_vacuous_and_multiset, M_expiry, M_parser_keyInd, X1-X7).
