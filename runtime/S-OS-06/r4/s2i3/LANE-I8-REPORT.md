# LANE I8 REPORT: S-OS-06 r4 lane I, completing the unit so it can land

STATUS: **COMPLETE. Items 1–5 are all done.** Base `21ba435c` on `s-os-06/s2i-capture`. Stub committed first at `6c73bde2`.

Pre-committed interpretation (from the stub, unchanged): an item counts as DONE only when its gate was re-run as its own
command and its real exit code was read.

## Commits (in order)

| commit | what |
|---|---|
| `6c73bde2` | step 0: report stub |
| `9d17fec7` | item 1 evidence: per-occurrence property probe (`i8/occurrence-property-probe.{js,json}`); quotes no line text |
| `d780206a` | **item 1: PARTITION-ONLY amendment** `partition-amendment:` (touches only `scripts/open-source/rename-mc.denylist.json`) |
| `e9b5b456` | item 2: untrack the two SUITE captures, plus a WHY note |
| `823bf72f` | item 3 step A: extract `lockVerdict()` with no behaviour change, plus a probe of the real entries' fail counts |
| `fdac6cd8` | item 3: COUNT-LOCK refuses; conjunction falsifier |
| `332f168c` | item 4: `$observedOnEnvironment` record in the register |
| `4f02e1b3` | item 5: declare the eleven-name OBSERVED FLOOR; falsifier (n) |

## 1. The six occurrences, one at a time (α R-73)

Each occurrence is pinned as `(file, matchText, anchor)`. The `basePath` pins are anchored on the `"basePath": ` key,
so each pin covers exactly its own occurrence. The property test was run once per occurrence by
`i8/occurrence-property-probe.js` and recorded in `i8/occurrence-property-probe.json`.

| # | occurrence | PROPERTY A (base identity) | PROPERTY B (provenance) |
|---|---|---|---|
| O1 | `basePath` of the dispatch-readiness entry (#0) | HOLDS: legacy path exists at base `669aadc1`; renamed path absent at base; the pair-limited `-M50%` diff reports R; the codemod rewrite equals the entry's own `file`, which the runner's schema refuses (`basePath === file`), and it is absent at base | HOLDS: records the pre-rename path, which is absent at HEAD |
| O2 | `basePath` of the provider-autofix entry (#1) | HOLDS (same four facts) | HOLDS |
| O3 | `basePath` of the provider-rca entry (#2) | HOLDS (same four facts) | HOLDS |
| O4 | `basePath` of the product-bootstrap entry (#3) | HOLDS (same four facts) | HOLDS |
| O5 | `basePath` of the provider-smoke entry (#4) | HOLDS (same four facts) | HOLDS |
| O6 | `$policy` sentence recording the codemod's rewrite inside a cause line | n/a: not a path, and no base-identity function reads it | HOLDS: after the rewrite the recorded event's two sides are identical (`X became X`), so the rewrite erases the event it documents |

**Carried by `d780206a`.** It is add-side only: 6 `occurrencePins` plus 6 `$freeze.amendments` records, one warrant each.
Amendments went from 159 to 165. Pinned count went from 278 to 284, and live-unallowed went from 6 to 0.

**Teeth inspection (F8).** On a throwaway branch I reverted the amendment, then re-applied the same pins folded into a
commit that also changed a foreign file and had no marker. `cutover-completeness` exited **1** and named both findings
("a post-freeze addition must be its OWN warranted amendment commit" and "without the 'partition-amendment:' marker").
On the real commit `d780206a` it exits **0**. The scratch branch was deleted; nothing from it landed.

## 2. The two evidence captures: UNTRACKED with a WHY note (`e9b5b456`)

Remedy chosen: **untrack**, following the K5 shape at `f6e50314`. Note: `runtime/S-OS-06/r4/s2i3/SUITE-CAPTURES-WHY-UNTRACKED.md`.

Why not lane C's shape: lane C changes an **instrument** so it never renders line text. These two files are not
instrument output. They are the **raw TAP stream** that `run-tests.js` wrote, so there is no renderer to change.
Removing the token from a raw capture would leave a committed file that claims to be the measured stream but is
not, which is falsified evidence. Untracking leaves both files on disk byte-unchanged. The note records sha256, byte
count and line count so the local copies stay checkable. The derived evidence the I6/I7 reports rely on
(`i7/notok.*.txt`, `i7/per-entry-hermetic.txt`) stays tracked and purity-clean.

**THIRD INSTANCE of one pattern this round (STOP-CONDITION § 7b):** the round's own evidence files grow the population
they measure. Instance 1 was the lane C oracle (`f490592e`); instance 2 was the lane K5 machine output (`f6e50314`);
instance 3 is these two SUITE captures. The same thing nearly happened a fourth time inside this lane: the raw RED
output for item 3 contained absolute machine paths from stack traces. It was replaced before commit with a path-free
extract (`i8/RED-lm-before-fix.txt`). OWED, outside this unit: a capture writer that keeps text forms out of the swept
tree.

## 3. COUNT-LOCK refuses, never skips (`823bf72f` then `fdac6cd8`)

- **Step A (`823bf72f`):** the per-entry decision was extracted into the exported `lockVerdict(e, {observed, testNames, fc, tv, here})`
  with **identical behaviour**: an unobserved `fc` was still skipped silently. The falsifier file on that commit ran
  12/12 green.
- **Why the plants call `lockVerdict` directly:** `node --test` always prints its `# fail N` summary unless its own
  process dies. That death lands in UNOBSERVED (status null) on POSIX but can exit with a code on win32, so an
  end-to-end plant would behave differently per platform. The existing end-to-end cases (b)(f)(i)(j)(k) run through
  `lockVerdict` and cover the wiring.
- **Real register impact, measured before the change** (`i8/real-entry-failcount-probe.json`): all 23 entries run exactly as the
  runner runs them. Result: **0 have an unobservable count** and 0 are above their registered count (every one has `fc = 1`,
  registered 1). The refusal therefore changes no real outcome today.
- **Fix:** `fc` not observed → **COUNT-UNOBSERVABLE** (refused, counted as unobserved). EMPTY capture **and** `fc` not
  observed → **NO-LOCK**, a separate, loud refusal ("EVERY lock layer is unobservable … this entry has no lock at all"). It is not folded
  into INDETERMINATE.
- **Plant form (β):** every case asserts the **exact rule list** with `deepStrictEqual`. That checks presence of the
  plant's own rule and absence of every neighbour (NO-LOCK / INDETERMINATE / COUNT-UNOBSERVABLE / CAUSE-LOCK /
  COUNT-LOCK / EXPIRED) in one assertion. Each case also carries a control:
  - (l) control: equal multiset, `fc = 1` → `[]`. Plant: `fc = null` → `["COUNT-UNOBSERVABLE"]`.
  - (m) control: EMPTY capture, `fc = 1` → `["INDETERMINATE"]` (no NO-LOCK). Plant: EMPTY capture, `fc = null` → `["NO-LOCK"]`.
- **RED then GREEN:** RED on `823bf72f`: (l) returned `[]` (the silent skip, measured), and (m) returned `["INDETERMINATE"]`
  (no conjunction lock, measured). Both controls passed in the RED run. After the fix: 2/2 GREEN, and the full file ran 14/14.
  Evidence: `i8/RED-lm-before-fix.txt`, `i8/GREEN-lm-after-fix.txt`.
- **Not done:** single-branch mutants isolating (l) from (m). The RED run was taken on code missing both behaviours.
  Not re-run end to end: the full `run-tests.js` suite over the 23 real entries. Their decision is unchanged by
  construction, because every one has an observed `fc`, and the probe above measured that.
- **Scope choice, stated:** a **vacuous** cause lock with an unobservable count yields CAUSE-LOCK (vacuous), not NO-LOCK.
  Vacuity is an observation that says nothing; it is not an unobservable layer. Both outcomes refuse.

## 4. `observedOn`: option 2, an explicit record in the register (`332f168c`)

New top-level `$observedOnEnvironment` in `tests/quarantine.json`. It states: `observedOn` describes the CAPTURE
environment (ambient, pre-scrub), including the six re-captured entries (2, 7, 9, 7, 32, 8 lines). The gate CHECKS with
the hermetic environment (element E). The two environments were **measured equal** for this register on 2026-09-16:
the lane I7 hermetic run at `21ba435c` gave 23/23 multiset equal, 0 moved. Re-capturing an entry in any other
environment voids the claim for that entry. No entry was changed, and the register still loads (23 entries).

**Why not option 1:** `observedOn` is `{platform, nodeMajor, reporter}` and has **no environment field**. A post-scrub
re-stamp is byte-identical (`win32 / 24 / tap` both times), so it would record nothing, and the register would still
not say which environment the capture came from. This is a finding about the option, not a refusal of the brief.

## 5. The eleven-name floor as declared (`4f02e1b3`)

`CHILD_ENV_OBSERVED_FLOOR` in `scripts/checks/run-tests.js`, exported:
- `platform`: `win32`
- `names`: HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR (11)
- `source`: libuv's win32 spawn (`src/win/process.c`: the required variables that `make_program_env` copies from the
  parent into a child env block that lacks them). **I identified the source by matching the name set to the
  measurement. I did not re-read libuv's source in this lane.**
- `observedOn`: win32 / node 24.16.0 / libuv 1.52.1, 2026-09-16
- `evidence`: `runtime/S-OS-06/r4/s2i3/i7/spawn-min-probe.json`

The floor is generated into `NORMALIZER_DECLARATION` element E ("OBSERVED FLOOR (win32): … refilled by the runtime,
not by this runner. Source: … Observed on … This is an implementation detail declared as an observation, not a
contract."). Element 0 of the register's `$normalizer` was synced by a text-level replace
(`i8/sync-register-normalizer-E.js`; entries untouched: true). **Enforcer:** falsifier (n) re-measures the floor on
win32 (it spawns a child with an empty env and requires exactly the declared floor names the parent has; other
platforms get an explicit skip with a reason). The same comparison against a 10-name mutant floor fails
(`i8/floor-mutant-check.txt`).

## Verification: each gate run as its own command, real exit codes

| command | exit | numbers |
|---|---|---|
| `node scripts/checks/framework-purity.js` | **0** | client_slug 0 · abs_path 0 · promote_relic 0 · legacy_slug 0 · live-unallowed 0 · pinned 284 · suppressed 22048 |
| `node scripts/checks/cutover-completeness.js` | **0** | PASS · 320 files · 57 raw hits · 0 live-stale · 57 allowlisted · live-unallowed 0 · F8 165 amendments |
| `node --test tests/regression/S-OS-06/falsify-quarantine-runner.test.js` | **0** | tests 15 · pass 15 · fail 0 · skipped 0 |

Working tree note: the two untracked SUITE captures show as `??` in `git status`. That is intentional (see the WHY note).
Do not `git add -A` them back.
