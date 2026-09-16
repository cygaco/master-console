# S-OS-06 r4 — ORACLE COVERAGE MAP (pre-registered by ε, REWRITTEN 2026-09-16 after the scope change)

**Status: PRE-REGISTERED. This file must be COMMITTED before the security reviewer is dispatched, and its
commit sha cited in the r4 gauntlet→release consult.** β ruling `6d4a2f18-9c37-4be0-a5d1-3f82e7c40b96`
(betaEvents row 470), Q3.

> **REWRITE NOTE.** The first draft of this file was written BEFORE the operator's raised disposition bar and
> the scope re-expansion. β ruling `9a1e5f60` (row 471) ruled that a map written before that change is **stale
> on arrival**, because the re-expanded scope is a new occurrence class and a class no oracle covers is an
> unmeasured population — the exact condition the r4 escalation existed to end. This version is written after
> the change. It must be read with `STOP-CONDITION.md`, which carries the tightened disposition set: on a LIVE
> surface only the ratified historical classes may carry a warrant at all.
>
> **Property added by the rewrite: ORACLE (iv) below.** Without it, `warp:promote` / `warp:init` tokens and
> `warp-*` filenames in live surfaces would be back in scope with no oracle guaranteeing anything about them.

## Why this file exists

The r4 stop condition turns on whether a security finding falls in a class an oracle covers. If ε decides
that after seeing the finding, ε grades its own round and every inconvenient finding becomes "outside".
Pre-registering removes that degree of freedom: the map is fixed before the evidence arrives.

## Form: PROPERTIES, not lists

β corrected the obvious first draft of this file. A coverage map written as a list of finding classes I can
think of is the SAME enumeration defect one layer up, relocated to the adjudication layer. So each oracle
below states a **property it guarantees over a named population**, and coverage is decided by asking whether
a finding contradicts that property — not by matching the finding against a list.

## Adjudication rules (binding, from β Q3)

1. **Arguably-in-class is IN-class.** Fail-closed at adjudication, because the party drawing the map
   benefits from "outside".
2. **β's authority here is deliberately ASYMMETRIC**, because β recommended this round and would otherwise
   judge its own recommendation. β MAY rule a finding IN-class, which extends the work and runs against its
   interest. β MAY NOT rule a CONTESTED finding OUT-of-class. A contested out-of-class call goes to the
   OPERATOR with both readings stated. Uncontested out-of-class calls β rules normally.
3. A finding genuinely outside every property below is a **named, measured residual** — never a cycle
   extension. It must be recorded with the population that was searched, not as a bare count.

---

## ORACLE (i) — nonexistent-tag claims

**Property guaranteed.** For every token in the scanned population matching grammar G, the version named by
that token exists in the tag list, OR that occurrence carries its own registered non-assertion warrant.
The default is violation; absence of classification is failure, not pass.

**Population.** All tracked text files in the scanned set, with the set's size emitted beside the result.

**Grammar G.** Case-insensitive lab prefix; semver, partial-version and glob version forms admitted. G is
emitted with every result, because a zero without its grammar is a bare count.

**Explicitly NOT covered by this property** (and therefore residual territory, subject to rule 1 above):
- A false tag claim expressed with NO token matching G at all — for example a purely prose assertion that a
  release was tagged, naming no `prefix@version` token. This is the honest ceiling: no oracle over English
  prose is total. It is disclosed here rather than discovered later.
- The CORRECTNESS of a registered warrant's reasoning. The oracle verifies a warrant EXISTS per occurrence;
  it does not verify the warrant's claim is true. A wrong-but-present warrant is in residual territory.

**Fail-closed condition.** If the reference tag list is itself empty, the oracle REFUSES rather than
reporting zero, because a tag-less worktree cannot certify. Remote listing is the second method (β R5).

---

## ORACLE (ii) — case-insensitive occurrence-grain slug sweep

**Property guaranteed.** Every legacy-slug occurrence in the swept population, matched case-insensitively
and counted per occurrence rather than per line, holds exactly one of the five dispositions
(`rewritten`, `pinned`, `derived`, `compat`, `historical-allow-listed`), or has been removed. No occurrence
holds two dispositions. `pinned:*` sub-kinds are emitted as sub-counts beneath `pinned`, not as separate
dispositions.

**Population.** Emitted as a reconciliation, not asserted as a class:

```
eligible == scanned + binary + unreadable + oversized + generated + write-protected
```

Every term is emitted. `unreadable` must be zero or the oracle REFUSES, because an unreadable file
contributes zero occurrences and is otherwise indistinguishable from a clean one.

**Precondition.** Generated views are rebuilt BEFORE the sweep, so that `derived` is a claim about
regenerated bytes rather than stale ones, and `derived-without-pinned-source == 0` is asserted.

**Explicitly NOT covered:**
- Slug occurrences in files excluded by a stated rule (binary, oversized, write-protected). These are
  excluded by rule and COUNTED, so a finding there is measurable residual rather than an invisible gap.
- Semantic correctness of a disposition choice. The oracle verifies exactly-one-disposition, not that the
  chosen disposition is the right one.

---

## ORACLE (iii) — category delta at occurrence grain

**Property guaranteed.** Over every line in the swept population INCLUDING compat lines, computed per
occurrence, `categorized == pinned + transformed + delta` with `delta == 0` and `uncomputable == 0`.

**Population.** The same reconciliation as oracle (ii), emitted with the result.

**Explicitly NOT covered:**
- A transform that is registered, applied, and WRONG. The delta proves accounting closure, not that the
  rewritten text is correct.
- Categories outside the set the categorizer owns. `uncomputable` is emitted rather than silently zero, so
  this is measurable residual.

---

---

## ORACLE (iv) — legacy-token occupancy of LIVE surfaces (ADDED BY THE REWRITE)

**Why it exists.** The operator's directive put `warp:promote` / `warp:init` tokens, `scripts/warp-setup.js`
and other `warp-*` filenames back in scope for live surfaces, and tightened the bar so a live occurrence may
not be warranted at all. Oracles (i)–(iii) are keyed to the legacy SLUG and to `lab@version` tokens; none of
them guarantees anything about a `warp:`-prefixed command token or a `warp-`-prefixed filename. Without this
property that class is unmeasured.

**Property guaranteed.** No LIVE surface contains a legacy-project token in any of its occupancy forms —
file and directory NAME, path segment, command or skill namespace, environment-variable name, or identifier
in code — except where the occurrence is covered by a ratified historical class from `STOP-CONDITION.md`
section 1, or is a registered alias shim carrying a per-entry EXPIRY in the compat register.

**Population.** Every tracked path classified LIVE, reconciled the same way as (ii) and (iii): eligible equals
scanned plus each stated exclusion term, `unreadable` zero or REFUSE. The population is over PATHS as well as
CONTENTS, because a filename is an occurrence this round must catch and a content-only sweep cannot see it.

**Grain.** Per occurrence, and per path for the name forms. A directory whose name carries the token counts
once per path, not once per file beneath it, and the count is emitted either way.

**Explicitly NOT covered:**
- A legacy token inside a value that is DATA rather than a surface — for example a recorded historical string
  inside a `runtime/**` log. Those are a ratified historical class and are excluded by rule and counted.
- Semantic equivalents that carry no legacy token, such as a renamed command that still behaves like the old
  one. This oracle measures occupancy, not behaviour.
- Whether an alias shim's expiry is the RIGHT date. It verifies an expiry exists and is registered.

**Fail-closed condition.** If the LIVE classification cannot be resolved for a tracked path, the oracle
REFUSES rather than treating the path as non-live. An unclassifiable path must not fall out of the population
silently — that is the `rename-mc.js:656-658` fail-open shape β named at the sweep grain.

---

## Cross-cutting: what NO oracle covers

Stated here so it cannot be discovered as a convenient surprise:

1. **Correctness of any registered warrant or disposition.** All three oracles verify presence and
   accounting closure. None verifies that a human's stated reason is true.
2. **Prose claims carrying no matching token.** Oracle (i)'s ceiling, above.
3. **Behaviour of the codemod's output at runtime.** The oracles measure the tree, not the product of
   running the rewrite.
4. **Anything in the CI-platform lane.** That lane has its own oracle, `scripts/checks/run-tests.js`
   exiting 0 under Linux semantics, and its own gate (the frozen CI-green landing precondition from β r1,
   row 463). A CI finding is not an r4 security finding and does not interact with this map. NOTE the one
   intersection β named: `record-trust-exit` is r4 gate surface, so an ambiguous lane assignment books as
   **r4 with disclosure**, never as CI.

## Falsifier obligation attached to every property above

Per β Q5, a green from any oracle is only admissible as part of a three-part triple run on the final head:
green control on the unmutated tree **with the scanned population emitted beside the zero**, red on a
planted violation sited where the OLD predicate was blind and provably inside the swept population, then
revert and re-observe green. A bare green is not evidence.
