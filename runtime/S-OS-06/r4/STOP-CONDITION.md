# S-OS-06 r4 — STOP CONDITION, restated under the raised disposition bar

**Written and committed BEFORE the certifying oracle run.** β ruling `9a1e5f60-72d4-4c3b-8e59-0d63b8f14a72`
(betaEvents row 471) made this blocking: the r4 stop condition was pre-committed against the OLD disposition
set, where a warranted live occurrence PASSES. Under the operator's raised bar a live occurrence may not be
warranted at all, so the same occurrence is now a violation. **A zero measured against the old predicate
certifies a bar nobody is using.** Measuring the wrong predicate and getting a clean zero is precisely the
failure this sprint exists to study.

Authorities: operator directive 2026-09-16 ~08:00Z (relayed by α); β rows 470 `6d4a2f18`, 471 `9a1e5f60`,
472 `4f7b2c93`, 473 `2f8d4b17`.

---

## 1. The disposition set (TIGHTENED)

A legacy-slug or legacy-lab occurrence on a **LIVE surface** — code, skills, hooks, configs, docs, filenames,
paths, env names, live ROADMAP sections — **gets FIXED. It may not be warranted.**

### RESTATED AS PROPERTIES — β verdict ids `4a6d8c30` (row 476) and `9c4b7e18` (row 477)

The first version of this section was a LIST of surviving classes. β refused it, and the refusal was earned:
the occupancy oracle fail-closed 2610 occurrences the partition already allow-lists but the list did not
admit. **Adding rows until that number falls is the enumeration failure recurring inside its own correction.**
So section 1 now states PROPERTIES, and the partition's existing classes are RECONCILED against them.

There are **TWO** properties, deliberately kept apart, because the literal is load-bearing for two different
reasons and the dispositions differ.

**PROPERTY A — INSTRUMENT.** *Rewriting the legacy literal would break the file's own function.*
Disposition: **verbatim AND test-pinned.**
It is a per-file, mechanically checkable FUNCTION test, never a role list — "the rename instrument, its
registers, its falsifiers" enumerates three roles and the fourth arrives next week. Apply the test: rewrite the
token in the codemod and it stops finding legacy tokens; in the occurrence register and it no longer records
which occurrences carry it; on the old side of the alias map and the mapping is destroyed. This is the same
invariant as `migrations/**` — historical-literal-in-live-code is a function test, not a location one.

**PROPERTY B — RECORD.** *Rewriting would falsify a record of something that happened.*
Disposition: **verbatim.**
**Partition class is EVIDENCE for this property, never the test itself.** β refused "historical-record by
partition class" twice for the same reason: class membership is a LOCATION test, and a class-3 or class-4 file
can hold a LIVE reference. A planning document telling a reader to run a legacy-named command is an
INSTRUCTION, not a record, and location would absolve precisely what the operator's bar targets.

### The GUARD, so property A does not swallow the live suite

`tests/regression` is the **LIVE** suite, adjudicated **PER FILE** (β at r3b, and twice since):

- a test whose assertion has the legacy literal as its **SUBJECT** is a falsifier and QUALIFIES;
- a test that merely carries a legacy identifier **of its own** is LIVE and gets RENAMED.

A property written loosely enough to swallow that directory re-opens the bundle β has now refused three times.
**"Roughly 161" is a count without its set** — the per-file breakdown is emitted BEFORE any member is admitted.

### RECONCILIATION — compute the difference, do not list the members

Derive section 1's admitted set by APPLYING the properties to the partition's existing classes, then **EMIT THE
DIFFERENCE**: paths the partition allow-lists that neither property admits.

- **Zero** means section 1 covers the partition.
- **Non-zero members are adjudicated INDIVIDUALLY**, and they are the FIX population — not an argument about
  the property.

β's stated expectation, recorded so the result can contradict it: the residue should be **zero** for dreams,
reports, archive and the decision records, and **non-zero for `_planning/**`**, because planning documents are
the genre most likely to carry forward-looking instructions using legacy names.

### Evidence for the properties (NOT the test — these are the classes the properties should reproduce)

| Class | Which property, and why |
|---|---|
| The 37 legacy version tags, kept forever | B — prior-art record; 2026-09-02 decision and the epic success criterion |
| The single README brand-history line | B — records what the project was called |
| `migrations/**` | A — rewriting the literal breaks the migration's function (β r1 hole 3) |
| `framework/releases/**` capsules | B — checksum-pinned records of what shipped |
| CHANGELOG, tracker, sprint and epic history bodies | B |
| `runtime/**` records | B — per-run artifacts |
| The codemod, its registers, the alias map | A — the instrument cannot find what it may not name |
| Alias shims with a per-entry expiry in the compat register | Neither; a time-boxed compat seam, and see § 9 |

**PROVISIONAL MEMBER.** The provenance document is property B's strongest member — its occurrences are the
point of the file. It is also the artifact most exposed if the operator rules for the maximal reading of "this
was never WarpOS", so **its disposition is provisional on that Class C** and must be recorded as provisional
rather than settled.

**PROPERTY D is UNRULED.** The single hit under the continuous-integration directory is not adjudicated until
it is identified. If it sits under the workflows directory, any change is **operator-run** with the exact lines
handed over, because the classifier auto-denies edits there.

### A THIRD disposition, which is not a warrant: REMOVED

β (row 478): deleting a file that carries legacy branding is a legitimate disposition and it is **NOT the same
act as repairing an occurrence**. The removed count is **emitted separately** in every tally and in the close,
or the report implies occurrences were repaired when the files were deleted.

β 9a1e5f60 notes this is not a concession invented tonight: S-OS-06's own H-1 at
`.claude/project/sprint/requirements/S-OS-06/high-level-stories.md:10` already scopes the sprint to no
dangling legacy identifier outside evidence tags, the one brand-history line, CHANGELOG history and alias
shims. The historical set preserved here is the story's own.

**Warrant rule is MECHANICAL (β 9a1e5f60):** cost of fixing is NEVER a reason for a warrant. If fixing would
break a live consumer, that goes in the compat register **with a per-entry expiry**, never as a permanent
warrant. No new permanent escape class is minted in this round.

### AMENDMENT 1 — computed disposition `forthcoming-release-self-reference` (β verdict id `8e5f3a02`, row 474)

Section 1 gains ONE computed disposition: an occurrence whose version equals **the tree's own declared
version**, decided by COMPUTATION against `package.json`, **never by registration**.

β declared this a LOOSENING and showed its work because β is the party that recommended this round:
the oracle's predicate is a proxy for "does this sentence falsely claim a tag exists", and for a tree naming
the version it is becoming the proxy diverges from its own purpose — those sentences are TRUE. It is closed by
computation, which is stronger than registration: no list, no enumeration, no member addable by hand. **Its
members are EMITTED** with their count, or it is not auditable. It is **not an absolution**: the post-land
re-run must show every one resolving to a real tag.

β also ran the conflict backwards: had ε proposed treating those occurrences as violations requiring the
sentences rewritten, β would have refused that too, because a tree whose documents may not say which release
it is has been made unable to describe itself. The verdict holds in both directions.

**Window:** this lands inside the amendment window because it precedes any certifying run, and it must be
committed BEFORE the first certifying run, not alongside it. This commit is that.

### AMENDMENT 2 — ORDERING: the cross-lab tag-reality join runs BEFORE the historical slice is dispositioned

β re-read its own r3-plan R4 and corrected a relay of it: R4 ruled that evidence-tag and brand-history are
SUB-KINDS of pinned with their own sub-counts. **It ruled STRUCTURE, not MEMBERSHIP.**

**The qualifying test for `pinned:evidence-tag` is TAG REALITY, never the file's partition class.** A legacy-lab
token naming a real legacy tag pins as evidence. A current-lab token naming no current-lab tag, where the
legacy tag of that version exists, is a codemod falsification and gets **RESTORED** — regardless of the file it
sits in. 418 of the 514 candidates sit in class-3/class-4 historical files, and trackers and epics are exactly
where version references live, so that is where the falsifications will be. **A falsified sentence sitting in a
historical file is not historical evidence.** It is a false sentence the codemod wrote into a historical file,
and the slice holds both kinds with nothing in their location to tell them apart.

If any part of the historical slice has already been dispositioned, that ordering is **unwound before the
certifying run**, not after: a pin written before the join is a pin whose warrant was never tested.

## 2. Scope re-expansion (new occurrence class, must be oracle-covered)

The residual α ruled out of scope on 2026-09-13 is **back in scope for live surfaces**: `warp:promote` /
`warp:init` tokens, `scripts/warp-setup.js` and other `warp-*` filenames, and any legacy token in a live
surface regardless of whether it matches the earlier grammar. Rename or remove, with one-release alias
treatment where a consumer could depend on the name.

The alias skills under `.claude/commands/warp/` are ratified compat expiring at 2.1.0: they are REGISTERED in
the compat register with that expiry, not deleted.

β 9a1e5f60 ruling 2: a coverage map written before this scope change is **stale on arrival**. The map is
therefore rewritten after it and committed separately (`oracle-coverage-map.md`).

## 3. The predicates the certifying run must use

**Oracle (i) — nonexistent-tag claims.** Inverted, no context test: every grammar-G token whose version is
absent from the tag list is a candidate; every unwarranted candidate is a violation. Grammar G is
case-insensitive on the lab and admits semver, partial, glob, placeholder, interpolation and unparsed version
forms. Warrants are per-occurrence, never per-file or per-directory. REFUSES if the legacy-lab tag list is
empty on both the local and remote method (β R5).

**Oracle (ii) — occurrence-grain slug sweep, compat lines included.** Every occurrence holds exactly one of
the five dispositions (`rewritten`, `pinned`, `derived`, `compat`, `historical-allow-listed`), with `pinned:*`
sub-counts beneath pinned — **and under the raised bar, `pinned` and `compat` no longer discharge an
occurrence on a LIVE surface.** Only the section 1 classes do. An occurrence absolved by an inline boolean
rather than a registered artifact is a violation (the `changelog-historical` case, β 6d4a2f18).

**Oracle (iii) — category delta at occurrence grain over all lines.** `categorized == pinned + transformed +
delta` with `delta == 0` and `uncomputable == 0`.

**All three** emit the population reconciliation
`eligible == scanned + binary + unreadable + oversized + generated + write-protected`, every term with a
STATED RULE, `unreadable` zero or REFUSE. Generated views are rebuilt before the sweep. Every printed zero
ships its emitted set and its denominator — β named this the only form of a count that is not an unbounded
exhaustiveness claim.

## 4. What counts as an ORACLE-COVERED class

Coverage is decided by whether a finding contradicts a PROPERTY an oracle guarantees, never by matching it
against a list of classes anyone can think of. The properties live in `oracle-coverage-map.md`, committed
before the reviewer is dispatched, with its sha cited in the r4 release consult.

**Arguably-in-class is IN-class** (β 6d4a2f18 Q3): fail-closed at adjudication, because the party drawing the
map benefits from "outside". β's authority here is asymmetric by its own ruling: it may rule a finding
IN-class, and may NOT rule a CONTESTED finding out-of-class; a contested out-of-class call goes to the
operator with both readings stated.

## 5. The stop condition itself

r4 closes when ALL of the following hold on the FINAL head:

1. Oracles (i), (ii) and (iii) each print **zero violations with their population reconciliation and
   denominator**, against the predicates in section 3 and the disposition set in section 1.
2. Each oracle's green is part of a three-part triple: **green control on the unmutated tree with the scanned
   population emitted beside the zero, RED on a planted violation sited where the OLD predicate was blind and
   provably inside the swept population, then revert and re-observe green** (β 6d4a2f18 Q5).
3. The security review raises no finding in a class an oracle covers (section 4).
4. Backend review PASS.
5. **CI green on the final head** — a separate and independent gate, the frozen landing precondition from
   β r1 (row 463). Neither gate extends the other.
6. β's r4 gauntlet→release verdict logged to `paths.betaEvents`.

A finding genuinely outside every property is a **named, measured residual** recorded with the population
that was searched — never a cycle extension.

### 5.1 CLOSED — the path-name grain fork: the named residual is the ONLY admissible branch (β `c2e58f40`, α R-122)

The fork was whether to AMEND item 1 above so it admits the one retained occurrence, or to report that
occurrence as a named measured residual. β `c2e58f40` (2026-09-17T03:40Z, shutdown addendum) closes it:
the **amendment is FORBIDDEN** by the fence `9a1e5f60` — no new permanent escape class this round; a
live-consumer break goes to the compat register with a per-entry expiry, never a warrant. **The residual is
the branch.** No β re-consult is owed on this fork (the row says so).

**HONESTY CONDITION — binding on the DONE-REPORT, verbatim.** A named residual is **NOT** item 1 satisfied,
and the close says so in those words. The close reports:

> zero violations except one named occurrence, with its trigger and the population searched

and **never** reports a bare "zero". The trigger is named as the operator's `leak-gate.yml` L36 edit, and the
population searched is printed beside the figure.

**Measured basis** (at `43af93e9`, the head at which the fork was adjudicated): content grain, oracle two —
0 violations / 25,571 occurrences / 4,598 files; path-name grain `legacy_slug_path` 0; dispositions pinned 5 /
derived 0 / compat 15 / historical 70 / live-unallowed 0. The deferred member's own filename is **compat**
(check-shims, expiring 2.1.0), and β `f1a93c68` holds that compat does **not** discharge a live surface —
which is exactly why the occurrence is retained and named rather than dispositioned away. Per section 7b the
certifying run re-measures on the head that actually lands and names that head beside every figure; this
paragraph records the basis of the ruling, not the certifying figures.

**RETRACTION — ε e-10.** ε's earlier "no amendment needed" was reached on the **content grain only** and did
not address the path-name grain the fork turns on. ε **retracts e-10** in this close record. The zero it
relied on was correct for the population it searched and was reported as covering more than it did.

## 6. OPEN, and the certifying run may not be cited until it is ruled

**The forthcoming-release-tag class is UNRESOLVED.** Stage 1 measured 514 oracle (i) candidates, of which 243
are `mc` at major version ≥ 2 while zero `mc` tags exist, because `mc@2.0.0` is the tag the operator mints
after the land. These are forward references to a tag that is *supposed* not to exist yet. They are not a
historical class, so section 1 does not admit them, and they are not false claims either.

α's expected shape is a per-occurrence PROPERTY — lab is `mc`, version equals the package version, no such
tag exists, and the CHANGELOG carries an unreleased section for it — registered per occurrence and **expiring
the moment the tag exists**, at which point the oracle flips to REQUIRING the tag. That is put to β as consult
`eb21df65-520c-45bc-8e69-c82c4aad0eea` and is **not adopted here**.

Until β rules, a certifying run is a measurement only. **No zero from this round may be cited as closing the
stop condition while section 6 is open.**

### RESOLVED — β verdict id `8e5f3a02-4c71-4d96-b183-2a90f6e4c517` (ledger row 474)

β ruled the 514 into six treatments, and **most of it is computable rather than warrantable**. β named the
discriminator for form rules: *a form rule is admissible when the form makes the claim UNCHECKABLE, never when
checking is merely WORK.*

| Slice | Treatment |
|---|---|
| Placeholder and empty versions | Rule-warrantable, property-keyed, occurrence-grain |
| Globs | **NOT warranted — COMPUTED.** Expand against that lab's tag list; satisfied iff it matches ≥1 real tag. Only the zero-matching residue is warranted, and that warrant is then checkable |
| Interpolations | Warrantable **with the ceiling printed in the oracle's own output** — a template can still render to a false claim, which is outside this instrument. A ceiling that lives only in a consult is not a ceiling |
| Unparsed | **No rule. Read individually.** Refuse-never-skip; a rule over four is where the fifth hides |
| Version == tree's declared version | **Computed, zero warrants** (Amendment 1 above) |
| Version beyond the tree | **FIX THE SENTENCE.** It uses the TAG form to mean the RELEASE; write the bare version. Live-surface work, so the tightened bar says fix, not warrant |
| Current-lab tokens below the tree major | **NOT a warrant question.** Cross-lab join; hits are r3 falsifications and get RESTORED (Amendment 2) |

**β refused the bundled form-rule bag.** Warranting every glob would have buried the fact that some globs match
nothing and are very likely further falsifications.

**PRE-COMMITTED CIRCULARITY FENCE, written before results.** Every forward warrant records the minting event it
depends on. After the tag is minted, oracle (i) is re-run and every forward warrant must then resolve to a real
tag. **That is a RELEASE CRITERION for the 2.0.0 ceremony, NOT a gate on the land** — the tag cannot exist
before the land, and a criterion satisfiable in neither order is not a criterion.

**Section 6 is therefore CLOSED**, and a certifying run may now be cited — subject to section 8.

## 7b. THE MEASUREMENT ARTIFACTS ARE INSIDE THE SWEPT POPULATION — stated, never excluded by path

A second contamination channel surfaced during stage 2: oracle (i)'s candidate count rose from 514 to 517
because **the round's own artifacts entered the tree**. The oracles were built so that a printout cannot seed
the next run's population — the grammar is printed with its separator escaped, and lab and version are stored
apart. That defence covers the printed grammar. It does not cover committed artifacts.

**Ruling (α, applying § 1's record property).** The round's artifacts under `runtime/S-OS-06/r4/**` — join
member sets, oracle printouts, measurement records — legitimately carry legacy tokens **as measurement
records**. Rewriting them would falsify the record of what was measured, so they qualify under the RECORD
property and lane K adjudicates them as records.

**The consequence for the certifying run is a framing requirement, not an exclusion.** The population frame
must **state that the measurement artifacts are inside the swept population and how many occurrences they
contribute.** They are NOT excluded by path.

The reason excluding them would be wrong: a path-based exclusion is exactly the location test β has refused
three times, and it would let the round quietly shrink its own denominator to flatter its own zero. Stating
the contribution keeps the zero auditable. A reader can then see that the number includes the round's own
paperwork and by how much.

**This also means the denominator moves** as artifacts are added and as the alias drop removes roughly thirty
files. Every certifying figure is measured on **the tree that actually lands**, and the head is named beside
it. A zero measured across a tree that changed under it is a zero about a different tree.

## 8. AMENDED ON THE EVIDENCE — gap 1 CLOSED, gap 2 a named measured residual (α R-121)

**Provenance of this amendment, stated plainly — two stages, in order.**

*Stage 1 (as landed at `950d22c9`).* It rested on α's ruling R-121 ALONE. R-121 directs ε to cite "this ruling
and β's row", but no β row for § 8 existed at that time: canonical `paths.betaEvents` held 523 rows, newest
`a5c3e761` dated 2026-09-17T10:30Z, with no row dated 2026-09-18 and no reply to ε's direct query. ε declined
to cite a row id it had not read. **ε landed the commit anyway rather than stall the operator's declared final
session — a call ε had previously said belonged to α, taken by ε and disclosed, not silently.**

*Stage 2 (this addendum).* β has since ruled: **`7d3a91c5-2e6b-4f08-9a71-c4e0b2f38d61` (DECIDE, class B, 0.90)**,
relayed to ε directly by β. **That row is NOT YET in canonical `paths.betaEvents`** — re-measured at the time of
writing: 523 rows, `7d3a91c5` returns zero matches. It is cited here as *relayed-by-β, pending append*, never as
a recorded row: a staged row is not a recorded ruling. β's conditions are applied here in full (items 1–3), per
R-121's own "amended by an addendum — not reopened". The evidence below was verified by ε at source,
independently of either ruling.

**Evidence citation rule for the close (β `7d3a91c5` item 3).** The two oracle self-tests are cited BY NAME with
their own exit codes — `runtime/S-OS-06/r4/oracles/self-test.js` and
`runtime/S-OS-06/r4/oracles/cross-lab-join.self-test.js`. **`npm test` is NOT § 8 evidence and must never be
cited as such**: `scripts/checks/run-tests.js:9` expands `scripts/**/*.test.js` + `tests/**/*.test.js`, and both
self-tests live under `runtime/`, so a PASS there says nothing about T1, T2, or the `(iii)` case.

β read the oracle self-test at source and named two gaps, both originally owed before any citable run
(β verdict id `8e5f3a02`). The ORIGINAL statement is retained verbatim, because an amendment that deletes
what it amends hides its own effect:

> 1. **Oracle (i) has no GREEN control.** Oracles (ii) and (iii) each demonstrate a clean control beside their
>    RED; (i) demonstrates detection and refusal only and **has never been shown capable of printing zero**. An
>    oracle that has only ever printed non-zero is unproven in the same way one that has only ever printed zero
>    is. Demonstrate (i) green on a fixture, or its eventual zero means nothing.
> 2. **No case covers the newly computed class or the cross-lab join.** Both are owed with Amendment 1 and
>    Amendment 2, each with its RED and its control.

### GAP 1 (§ 8.1) — SATISFIED at `73b36112`. The § 8 text is STALE thereafter.

**Corrected per β `7d3a91c5` item 1.** An earlier revision of this section said the premise was "FALSE". That
was wrong and is retracted: § 8.1 was **TRUE when written** at `132a2222` and stopped being true **19 minutes
later** at `73b36112`, when the control was actually built. **A requirement met by work is not a requirement
that was never owed** — the earlier wording erased the work that satisfied it. § 8.1 is SATISFIED, and the
§ 8 text is merely stale from `73b36112` onward.

Oracle (i) **already has** a GREEN control with the full three-part triple, added as case **T1** in
`runtime/S-OS-06/r4/oracles/cross-lab-join.self-test.js` at commit **`73b36112`**: green on the unmutated
fixture *with the scanned population printed beside the zero* → RED on a planted nonexistent-tag claim →
revert → green re-observed. The case carries its own non-vacuity assertion ("the control must contain a real
G token, or its zero is vacuous") and asserts `exit 0 — oracle (i) CAN print zero`, which is exactly the
capability gap 1 said had never been demonstrated.

**§ 8.1 was stale text, not an open gap.** ε verified this at source rather than inheriting it: the commit was
opened and the T1 case read directly. Reported at `26e0eded` (the § 8 REPORT).

### GAP 2 (§ 8.2) — UNSATISFIABLE WITH THE CURRENT INSTRUMENTS. Named measured residual + `ED-442`.

> **§ 8.2 is UNSATISFIABLE with the current instruments — specifically oracle (i) and the cross-lab join.
> It is NOT satisfied, and § 8 is NOT satisfied. This is a named measured residual, not a discharge.**

Scope of that claim, stated exactly (β `7d3a91c5` item 2): it is a statement about **oracle (i) and the
cross-lab tag-reality join**, the two instruments § 8.2 names. It is **not** a claim that no instrument
anywhere can represent these classes, and it is not a claim about the wider oracle set — oracles (i), (ii)
and (iii) each retain their own triple.

Gap 2 cannot be discharged as written, because **neither amended class exists in any instrument** — there is
nothing for a case to assert against. Proven by probe (`section8/section8-gap-proof.probe.js`, exit 0,
committed at `e2277623`):

- **Amendment 1 (the computed class).** `oracle-i-tag-claims.js` sets `candidate: !exists` and carries no
  disposition field, so the self-reference token and the beyond-tree token have **identical decided fields**.
  No RED/GREEN pair can tell the class apart. The only discharge path is a per-occurrence **warrant** — the
  very mechanism Amendment 1 exists to replace ("never by registration"). A case here could only test a
  warrant, and a warrant is the thing the amendment abolishes.
- **Amendment 2 (the ordering).** The ordering has **no instrument**. Seeding an ordering violation (a codemod
  falsification in a class-4 historical file) turns **no instrument RED**; worse, it makes the certifying
  oracle (i) print a **clean zero** (`violations=0 code=0`, warrant bound=1) while the join independently
  reports `members=1`. Nothing intersects warrants with join members. That is a **fail-open on precisely the
  hazard Amendment 2 was written against**, and it means the ordering is procedural only.

Per operator directive 1 (final session; a named honest residual beats an in-round instrument build), the
instrument is **NOT built in-round**. Gap 2 is carried as a named measured residual with its population and
measured consequence stated, and logged as **`ED-442`** (high, open) with candidate enforcers named.

**Consequence for the stop condition, stated plainly:** § 8 is **NOT fully discharged**. Gap 1 is closed; gap 2
is a residual, and a residual is not satisfaction. The DONE-REPORT reports § 8 in these terms — never as
"§ 8 closed".

**Credit.** The builder's refusal-with-evidence (the eighth of the round) was correct conduct: it refused to
close the gap by adding cases, and produced the proof that no case *could* be written.

### CLOSE CHECKLIST delta

Item 5 ("§ 8's two gaps: oracle (i) demonstrated GREEN on a fixture; cases covering the computed class and the
cross-lab join, each with its RED and its control — `8e5f3a02`") is AMENDED: the oracle (i) GREEN half is
**satisfied** at `73b36112`; the two-cases half is **replaced** by the named residual + `ED-442`. Item 5 no
longer blocks a citable certifying run, and the DONE-REPORT states that it was amended rather than met.

## 7. Fence (β 9a1e5f60, narrow and non-negotiable)

Nothing that **deletes a `warpos@*` tag or rewrites pre-tag history on the published remote** runs before the
operator rules. Those are one-way and they are the receipts the epic's own success criterion depends on.
Everything else proceeds at full speed. This fences one class; it does not pause the round.
