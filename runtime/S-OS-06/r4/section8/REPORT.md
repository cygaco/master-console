# S-OS-06 r4 — STOP-CONDITION § 8 discharge — REPORT

Branch `s-os-06/r4-section8`, cut from `796e8799`. Role: backend-builder (dispatched worker). All runs `win32/node24.16.0`.
Commits: `b99f263c` (stub), `e2277623` (gap 2 proof), this report.

**Outcome: § 8 is NOT discharged, and this dispatch cannot discharge it by adding cases.** Gap 1's premise is false
at the sprint head (it is already closed). Gap 2 cannot be closed without an instrument change, which is out of scope, so
I stopped as the brief requires. **No case was added. No instrument was changed.**

---

## GAP 1 — premise FALSE at `796e8799`: oracle (i) already has a GREEN control with the perturb-RED / restore-GREEN triple

The claim that oracle (i) "has never been shown capable of printing zero" was true when § 8 was written. It stopped
being true 19 minutes later:

| Event | Commit | Time (-0700) |
|---|---|---|
| § 8 written (β `8e5f3a02` self-test reading) | `132a2222` | 2026-09-16 01:51:44 |
| T1 "ORACLE (i) GREEN CONTROL (gap 1)" added | `73b36112` | 2026-09-16 02:10:10 |
| `73b36112` is an ancestor of `796e8799` | `git merge-base --is-ancestor` → true | — |

The control lives in `runtime/S-OS-06/r4/oracles/cross-lab-join.self-test.js:56-88`, not in `self-test.js`. That is
probably why a reading of `self-test.js` alone missed it. It is the triple the round requires, and it is non-vacuous
by its own assertions:

- **GREEN** (`:62-70`): asserts `occurrences.length >= 1` ("the control must contain a real G token, or its zero is
  vacuous"), which rules out an empty population. Then `candidates == 0`, `violations == 0`, `format().code == 0`
  (so no refusal, since a refusal throws) and `VERDICT: VIOLATIONS=0`. The zero is printed beside its POPULATION
  RECONCILIATION `holds=true` and `N FILES SCANNED`.
- **perturb → RED** (`:73-78`): commits a listing transcript naming a nonexistent tag. The assertions are
  `violations.length == 1`, located in `docs/releases.md`, and `code == 1`. An oracle that always prints zero fails here.
- **restore → GREEN** (`:81-86`): `git revert`, tracked tree clean, `violations == 0`, `code == 0`, and the SAME
  `pop.terms.scanned` before and after. An oracle that never prints zero fails the first and third legs.

Observed on the final head: `✔ T1 oracle (i) GREEN control -> RED plant -> revert -> GREEN (the zero printed with its
population)`, suite 5/5, exit 0.

**Not duplicated into `self-test.js`.** A second copy would count as new coverage when it isn't.
**§ 8.1 is stale text, not an open gap.** Recording that is a ruling for α/β, not for me.

## GAP 2 — cannot be closed without changing an instrument → STOPPED

### Does `cross-lab-join.self-test.js` already cover Amendment 2? **Only the join's detection, not the ordering.**

- The join's tag-reality detection IS covered. T2 (`:90-125`) is GREEN (2 current-lab candidates, 0 members, code 0) →
  RED on a codemod-shaped rewrite (1 member, `rewrite` provenance, code 1) → revert → GREEN. T3 and T4 cover
  provenance, glob expansion and rename-with-edits.
- The ORDERING is not covered by any case in that file. Its header (`:18`) also says Amendment 1 is "NOT covered here
  (deliberately)". No case in that file puts a disposition before the join, and none puts a member in a historical-class
  file (T2 uses `docs/alias.md`, class 1).

### Why no case can be written: both classes are ABSENT from the instruments (proof: `section8/section8-gap-proof.probe.js`, exit 0)

**Amendment 1: the computed class does not exist in oracle (i).** `oracle-i-tag-claims.js` sets `candidate: !exists`,
and `violations = candidates − warrant-bound` (`:320-369`). `treeVersion` is read, but only to regenerate views
(`:273-275`). It is never compared to a token's version. Probe P1, in a fixture with `package.json` `{name: mc,
version: 2.0.0}`:

```
P1 GAP REPRODUCED: tree version 2.0.0; the self-reference token and the beyond-tree token have identical decided fields
   {"lab":"mc","labCaseCanonical":true,"form":"full-semver","exists":false,"candidate":true,"coreResolves":null,"majorRange":">=2","cls":"class-1-live"}
P1   violations=2 (both), format code=1; occurrence keys: candidate,cls,col0,coreResolves,exists,file,form,index,lab,labCaseCanonical,line,lineText,majorRange,token,version
P1   only discharge path: a per-occurrence WARRANT (registration) -> violations=1, the self-reference bound by warrant, not computed
```

A version==tree-version token and a beyond-tree token get the same decision. There is no disposition field, so no
RED/GREEN pair can tell the class apart. The only discharge path is registration, which Amendment 1 forbids ("never by
registration"). A "case" here could only test a warrant, and a warrant is the thing the amendment replaces.

**Amendment 2: the ordering has no instrument.** `measureJoin` (`cross-lab-join.js:338-342`) passes only
`{root, regenFn, remoteFn}` to oracle (i), so it never sees warrants. `bindWarrants` (`oracle-i-tag-claims.js:228-244`)
never looks at the join. Nothing intersects dispositions with join members. Probe P2 puts a codemod falsification in
the class-4 file `history/epic.md`:

```
P2 GAP REPRODUCED: codemod falsification in class-4 file history/epic.md (rewrite 57b48e05)
P2   ordering honored : oracle(i) violations=1 code=1; join members=1 code=1
P2   ordering VIOLATED: oracle(i) violations=0 code=0 (warrant bound=1); join members=1 code=1
P2   -> the seeded ordering violation turns NO instrument RED; it turns oracle (i) GREEN. Nothing intersects warrants with join members.
```

Seeding the ordering violation makes no instrument go RED, and makes the certifying oracle print a clean zero on a
falsification in the historical slice. That is the exact hazard Amendment 2 was written against. So the ordering is
procedural only. A RED/GREEN pair needs an instrument that refuses (or flags) a warrant bound to a join member. Building
one is an oracle change.

This matches the brief's escape clause: **the instruments cannot demonstrate a control for either amended class,
because neither class is implemented.** Owed, routed to α/backend-lead (not built here):
1. Oracle (i) needs the computed disposition: `lab == package.json#name ∧ version == treeVersion ∧ ¬exists`. The
   members must be emitted with their count, per the amendment. Then a case: RED = version ≠ tree version (still a
   violation), GREEN = version == tree version (computed, 0 warrants).
2. The warrant binder (or the certifying run) needs a join-member refusal. Then a case: RED = a warrant bound to a
   join member → REFUSE/non-zero; GREEN = the same fixture with the legacy token restored (not a member) → the warrant
   binds or is unneeded.

The probe is a gap proof, not coverage. It is not a node:test file, and no suite discovers it. It exits 1 if either
assertion stops holding, meaning the instrument changed and the proof needs re-reading.

---

## Verify — final head `e2277623` + this report, each its own command, `win32/node24.16.0`

| Command | Exit | Numbers |
|---|---|---|
| `node runtime/S-OS-06/r4/oracles/self-test.js` | **1** | tests 11, pass 10, fail 1 — `(iii) RED` (see finding A) |
| `node runtime/S-OS-06/r4/oracles/cross-lab-join.self-test.js` | **0** | tests 5, pass 5, fail 0 (T1 ✔) |
| `node scripts/checks/run-tests.js` | **0** | `run-tests: PASS — primary: 379 file(s) in 2 batch(es), exit 0 (tests 1261, pass 1258, fail 0, cancelled 0, skipped 3, todo 0) · quarantine: 22 entries, 22 still failing, 0 unexpectedly passed, 0 missing/undiscovered, 0 unobserved, 0 not verified at base`; discovered 401 test file(s) (floor 350) |
| `node scripts/checks/framework-purity.js` | **0** | `result: OK (exit 0)` |

The same four exits were observed on `796e8799` + stub, before the probe existed: 1 (10/11), 0 (5/5), 0 (same summary
line), 0. **Nothing I added changed any result.**

## Findings outside the brief (reported, not acted on)

**A. `self-test.js` is RED at the sprint head, before any change of mine.** The failure is `self-test.js:70`,
`r.codemodDelta.delta` is 1, expected 0 ("the codemod's whole-line compat skip must still read 0 — the gap this oracle
measures"). Inference from commit order, not re-run: `self-test.js` was written at `132c73a7` (01:12). Lane B's
`43f9e007` (01:43, "B3 compat-line occurrence grain") then changed `rename-mc.js`, so the codemod no longer skips the
line and the gap that case asserts is closed. The case is stale, and editing its claim is not a case-add, so I left it.
**Consequence:** the brief wants all four verify commands, and one of them was already non-zero on this head.

**B. Neither oracle self-test is in `npm test`.** `run-tests.js` covers `scripts/**/*.test.js` + `tests/**/*.test.js`
(`run-tests.js:9`). Both `runtime/S-OS-06/r4/oracles/*self-test.js` files are outside that population. So the
`run-tests: PASS` line says nothing about T1, T2 or the red (iii) case. A reader who cites the suite for § 8 is citing a
population that excludes it.

**C. `run-tests.js` leaves untracked, un-ignored files behind.** It writes `runtime/S-OS-06/rename-occurrences.full.json`
and `runtime/S-OS-06/rename-plan.json`, observed at 17:43:54 during my run and again on the final run. I deleted both
times, so nothing leaked into a commit. They would be staged by any `git add -A`.

## Refused

- Adding a (i) GREEN control to `self-test.js`: it would duplicate T1 (Gap 1 premise false).
- Writing an Amendment 1 or Amendment 2 "case": neither class exists in any instrument. A case would have to test a
  warrant (for Amendment 1) or invent the intersection check inside the test (for Amendment 2). Both change
  instruments, and both would look like coverage without being coverage.
- Editing the stale `(iii) RED` assertion: out of scope, and it changes what an existing case claims.
