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

## 7. Fence (β 9a1e5f60, narrow and non-negotiable)

Nothing that **deletes a `warpos@*` tag or rewrites pre-tag history on the published remote** runs before the
operator rules. Those are one-way and they are the receipts the epic's own success criterion depends on.
Everything else proceeds at full speed. This fences one class; it does not pause the round.
