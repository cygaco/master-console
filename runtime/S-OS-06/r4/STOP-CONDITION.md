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

The ONLY warrants that survive on any surface are the ratified HISTORICAL classes:

| Warrant class | Basis |
|---|---|
| The 37 `warpos@*` tags, kept forever | 2026-09-02 decision; prior-art evidence; epic success criterion |
| The single README brand-history line "Master Console (formerly WarpOS)" | S-OS-06 H-1 |
| `migrations/**` historical-literal-in-live-code | β r1 hole 3 |
| `framework/releases/**` capsules | β r1, checksum-pinned |
| CHANGELOG history, tracker / sprint / epic history bodies | S-OS-06 H-1 |
| `runtime/**` records | per-run artifacts |
| Alias shims **with a per-entry expiry in the compat register** | β r3b |

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

## 8. OWED BEFORE THE CERTIFYING RUN (β verdict id `8e5f3a02`, self-test reading)

β read the oracle self-test at source and named two gaps. Both are owed before any citable run:

1. **Oracle (i) has no GREEN control.** Oracles (ii) and (iii) each demonstrate a clean control beside their
   RED; (i) demonstrates detection and refusal only and **has never been shown capable of printing zero**. An
   oracle that has only ever printed non-zero is unproven in the same way one that has only ever printed zero
   is. Demonstrate (i) green on a fixture, or its eventual zero means nothing.
2. **No case covers the newly computed class or the cross-lab join.** Both are owed with Amendment 1 and
   Amendment 2, each with its RED and its control.

## 7. Fence (β 9a1e5f60, narrow and non-negotiable)

Nothing that **deletes a `warpos@*` tag or rewrites pre-tag history on the published remote** runs before the
operator rules. Those are one-way and they are the receipts the epic's own success criterion depends on.
Everything else proceeds at full speed. This fences one class; it does not pause the round.
