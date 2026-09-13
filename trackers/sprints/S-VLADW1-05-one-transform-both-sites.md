# S-VLADW1-05 — Vlad Wave-1 ONE TRANSFORM, BOTH SITES (successor to S-VLADW1-04)

- **Status:** minted, not started — **no registry entry** (`add-sprint.js` repoints primary; mint at build authorization)
- **Minted:** 2026-08-29, at S-VLADW1-04's honest close
- **Surface:** vlad `wt/S-VLADW1-01-engine` @ **`6a105f2`** — UNMERGED, left deliberately as this sprint's starting surface
- **Predecessor ruling:** `runtime/vlad-w1/s04/gauntlet-2/ALPHA-RULING-S4-1-TO-S4-6.md` — S4-1 FAILS · S4-2(c) FAILS · S4-3/4/5/6 HOLD · **NO RELEASE, no attempt 2**
- **Predecessor adjudication:** `runtime/vlad-w1/s04/gauntlet-2/ROUND-ADJUDICATION.md`
- **β confirmation of the application:** row 316 `6e2d94af-b53c-4871-a09e-c8f107b2e35d`, `runtime/beta-consult/S-VLADW1-04-close-confirmation-6e2d94af.md` — CONFIRMED in full, **including that one of the two S4-1 failures is wording β itself recommended at row 313**. β ran the position-swap and reports the answer is the same in both directions: *"Approval is not a truth check, and β's recommendation is worth exactly nothing against the shipped bytes."*

**The class this sprint is aimed at, in β's words:** coverage asserted at a coarser granularity than the
mechanism has — "the two scripts the fold DOES cover" asserted a **script-level closure over a letter-level
sample** (`CONFUSABLE_FOLD` contains no lowercase `l`, `n`, `g` — three of `Ceiling`'s seven letters).
**Three instances: S4-1a, S4-1b, S4-1c.** Aim at the class, not the three sentences.

## Why this sprint exists, stated plainly

S-VLADW1-04's fix attempt closed every finding gauntlet-1 raised, discharged S4-2(d) twice over, held four of
six criteria, and grew the suite 339 → 366 with every mutant guarded. **It failed on the same class the
sprint pair exists to close, one layer out:** it authored **new false sentences about its own mechanisms**,
and it left one dimension of the rendered-form property implemented *beside* the shared transform rather than
*inside* it.

**The finding to carry above every process one:** those sentences were in prose the conductor reviewed and
passed, and one carried β's recommendation and α's approval. **The approval chain is not a truth check.**

## Residual groups carried VERBATIM from the ruling

1. **S4-1a** — confusable-fold calibration paragraph false: the fold is a 56-entry map (36/52 Latin skeleton letters); `l n g` etc. unmapped in both scripts; in-script homoglyphs of unmapped letters evade; the "mistake-reachable scripts closed / remainder attacker-only" framing is false because unmapped letters are reachable by the paragraph's own accident vector. Fix shape: state coverage as the letter set actually mapped (or vendor a confusables table), never as "scripts closed"; enforcer comment corrected to match.
2. **S4-1b** — "two escapes REMAIN" false: ATX-heading-prefixed (and twelve other prefix shapes) bolded lead-ins silently skipped. Fix shape: refuse-not-skip must extend to heading/list/blockquote prefixes on the LEAD-IN path (G handled block prefixes for candidates; the heading marker escapes), and the escape count must be replaced by a named class, not a number (the document's own rule: a number is a property of the day it is read).
3. **S4-2(c)** — emphasis canonicalization is not on the status-token path; `**ASSERTED** — NOT VERIFIED` plants green in Proven. Fix shape: move the emphasis fold INTO `canonicalizeClaimText` (or have `containsStatusToken` call `flattenForAssertionScan`) so both sites share one transform as G's comment already requires; near-miss battery gains emphasis-split status-token variants, controls first.
3b. **S4-1c** (re-classified per β row 316 `6e2d94af`) — the NOT-bound enumeration omits P1–P4 headings (an inverted P2 heading ships green): a coverage claim stated at a coarser granularity than the mechanism has, with an execution-proven evasion, inside a list the preamble introduces as "said plainly rather than generalised." **Third instance of the S4-1a/S4-1b class** — the successor is aimed at the CLASS with all three instances in view.
4. Security lane MEDIUM — `spawn-shim.js`'s split-secret worked example is false (fail-safe direction); qa MEDIUM — a third unnamed escape class; qa LOWs as filed.
5. **agy fallback** — the cross-family lane served on `gemini-3.1-pro-high`, not the pinned model; the record is well-formed but the pin was not honoured (ED-230 class); noted, not counted against any criterion.
6. Successor-carried from fix attempt 1 (already in the S-04 tracker): the transform's description paragraph is UNBOUND (needs the fixture builder); "unbound ≠ re-wrap is free" (header substrings pinned across wraps); the task-4 assertion message ("reviewer read") in a non-shipping test; a text-matching enforcer cannot distinguish a violation from a description of one (K and L2 both tripped it).
7. **ED-340** — remains OPEN, carried: mutant half satisfied 2026-08-10; roster half open with ED-354 as its instance. **ED-354** — OPEN (installed-roster parity; no new instance this sprint). **ED-358** — OPEN; this ruling is its second instance one layer out: a predicate/fold stated as closed over a category it only samples (S4-1a, S4-1b). New this sprint and cited: ED-360, ED-361, ED-362, ED-363; ED-257 amendment; ED-356 recurrence ×3.
8. Process residuals for the retro: three brief-premise defects (J's "zero executable uses", K's atomicity, L2's cwd — ED-363); the excerpt-window false HIGHs (ED-362, then agy's Unicode belief refuted in two commands); ε's idle-while-polling pattern (repeated; the α watchers carried the waits); ε's "clean tree" reading a mid-write tree (caught before reporting); the α/ε MC commit race (resolved by hash-naming); usage-limit risk not realised this run.

## Successor-carried items already recorded in the S-04 tracker (expanded)

1. **The transform's own description paragraph is UNBOUND.** Nothing pins `CUSTODY.md`'s description of `canonicalizeClaimText` byte-for-byte. It cannot be closed cheaply: adding a `BOUND_PARAGRAPHS` entry makes Rule 4b demand the text appear in the clean test fixture, and that fixture is built only from keys matching `^Ceiling` or `^A\d+$`, so the "clean fixture lints clean" test would go RED. Closing it needs the fixture builder in `test/custody-claim-lint.test.js` extended, with its own falsifier. Bundle K escalated rather than faked it.
2. **The count-of-surfaces exhaustiveness family is disclosed but not mechanised** (β row 314 DISCLOSE; L1's measured candidate pattern handed forward — zero hits across 15 bound paragraphs, no false positives — which does NOT overturn the ruling, whose ground was unboundedness rather than over-refusal).
3. **"Unbound" does not mean re-wrapping is free** — header substrings are pinned across wraps independently of the canonical-copy bind.
4. **A stale assertion MESSAGE in a non-shipping test** ("reviewer read" vs "human review"); cannot fail S4-1 because the file does not ship.

## Release rule — PRE-COMMITTED, β row 317 (`2f8c15e6-9d43-4a70-b1c9-84e06fa3d7b2`)

Minted 2026-08-29 at the combined plan→design / design→build boundary, **before any build result
existed**. Full text: `runtime/beta-consult/S-VLADW1-05-r1r2-release-rule-2f8c15e6.md`, and in this
sprint's own directory at `runtime/vlad-w1/s05/BETA-CONSULT-design-to-build.md`.
**Numbering is S5-n. S4-1…S4-6 do not carry and must never be mis-cited into this sprint.**

> **AMENDED by row 318 (`7b3e6d21-c48f-4e95-a012-3f9d5c07b6ea`,
> `runtime/beta-consult/S-VLADW1-05-r2-amendment-7b3e6d21.md`), before any result exists.** S5-1…S5-7
> stand; **one scope clause changes and the terminal gains an honesty sentence.**
>
> **S5-2, amended scope — replaces the scope sentence only; clauses (a)(b)(c) unchanged:**
> > S5-2 applies **in full** to every coverage claim the sprint **authors or edits**, and to **all of
> > `CUSTODY.md`**. For shipped coverage claims in files the sprint does **not** touch, the requirement
> > is **disclosure, not repair**: their un-audited status is stated, naming `src/env-scrub.js`,
> > `src/model-seam.js`, `driver/host-free-driver.js` and `src/server-entry.js` as carrying custody
> > prose no lane has read end to end.
>
> β: *"This is not 'we did not look, so it passes': the un-audited status must be STATED, and stating it
> is itself a coverage claim, so S5-2(b) governs its frame."*
>
> **TERMINAL, amended (added sentence):**
> > Whatever the outcome, the close must state the class's status honestly: **this sprint fixes three
> > known instances of a class whose size is unknown**, with the four un-audited shipped surfaces named
> > and carried to the successor. A close that reads as "the coverage-granularity class is closed" is
> > the class one layer out, in the sprint that exists to end it.
>
> Also binding from row 318: **bundle O's emission is a REQUIREMENT, not a design choice** (S5-2(a)
> demands it), and the diagnostic lanes take the four un-audited files as a **secondary objective** —
> findings there are free information for the successor and **cannot grow this sprint's scope or fire
> its gate.**

RELEASE iff ALL SEVEN hold at the qualifying close — carried verbatim:

> **S5-1 — TRUTH.** Every claim string on the shipped surface (`npm pack --dry-run`) is TRUE of the code at close, by reviewer read. **Never satisfiable by mechanism evidence — and never by an approval chain:** β's recommendation, α's approval, and a prior round's pass are not truth evidence. (Carried verbatim from row 316, written about β's own false sentence.)
>
> **S5-2 — GRANULARITY (the keystone).** Every coverage claim on the shipped surface — **including enforcer comments** — must satisfy all three: **(a)** where the mechanism has an enumerable extension (a fold map, a prefix set, a bound-paragraph key set), the claim's coverage set is **EMITTED from that data**, never hand-typed; **(b)** the claim's **frame names the unit** the mechanism enumerates (letters, prefix shapes, paragraph keys) and does not round up to a coarser noun — "scripts", "all", "the class" — nor to a count; **(c)** a **closure** claim is admissible only if the mechanism closes by a **named property** (a Unicode property, a structural invariant) or by an **emitted exhaustive extension over an explicitly stated finite domain**. Otherwise state the probed sample and refuse the closure word.
>
> **S5-3 — ONE TRANSFORM, MECHANIZED.** RF-M2 observed RED: the two comparison sites cannot silently stop sharing the transform — a comment stating an invariant is not an enforcer of it. Plus RF-M1 (removing the emphasis fold turns the R3 near-misses GREEN — **claimed over seven, not eight; strikethrough was already RED as-is**), RF-N1, RF-O1, and over-refusal preserved in both directions (`## Proven`, keyword prose, `**Status:** PROVEN` stay GREEN; the disclosed comma residual unchanged).
>
> **S5-4 — BATTERY RE-RUN BY A LANE, AGAINST THE PREDICATE AS BUILT.** Not by ε; population including every newly authored or edited paragraph; controls first. **The design battery is design evidence and does not discharge this.**
>
> **S5-5 — FALSIFIERS OBSERVED.** RF-M1, RF-M2, RF-N1, RF-O1, RF-Q1 and the atomicity observation: present, committed, each OBSERVED RED under its own mutation at close, no-op⇒FAIL guard on every mutant.
>
> **S5-6 — ATOMICITY.** Any bound paragraph edited moves with its canonical copy in the same commit; at close no shipped claim string diverges from its canonical copy.
>
> **S5-7 — RESIDUALS TRAVEL.** Every residual named in the build spec's items appears at close on the surface where its claim's reader is; an internal-only disclosure does not satisfy it for a shipped claim.

**Deliberately NOT a criterion: `falsification_attempts`** — an envelope/process artifact, not a property
of the shipped surface. **Binding as standing discipline and a DoD item.**

**ATTEMPT COUNT: ONE.** gauntlet-1 (diagnostic, NON-qualifying) → fix attempt 1 → gauntlet-2 =
**QUALIFYING**. Anchored to evidence dirs under `runtime/vlad-w1/s05/`, never an ordinal.
**No exception clause, deliberately.**

**TERMINAL:** any one of S5-1…S5-7 fails at that close → **NO RELEASE, no attempt 2**; close at honest
state, residuals named, ED-340 / ED-354 / ED-358 restated, remainder → named successor.
**α applies this verbatim — not ε, not β.**

**DISCRIMINATORS.** Re-confirmation ≠ new finding · **an INACCURATE DISCLOSURE IS A NEW FINDING, never
shielded by the residual it misdescribes** (row 316) · lane verdicts do not decide, criteria do ·
present-but-never-observed-RED fails S5-5; NO_DATA ≠ pass; `t.skip()` ≠ pass; **pass-total ≠
observation-count** — count DESCRIBED mutations · mechanism evidence and approval chains never satisfy
S5-1 or S5-2 · **NO STACKING — one defect fires ONE criterion**, routing specific-before-general: a false
sentence whose falsehood IS a granularity mismatch fires **S5-2 only**; a residual that travels but travels
inaccurately fires S5-2, not S5-7 · both reshape directions barred.

## Scope — RATIFIED `recommended` by β row 317 (DECIDE 0.89)

**`recommended`, NOT `expanded`. Do not vendor a confusables table this sprint.** β's reasoning, which
corrects the instinct rather than just the choice:

> *The lesson of S4-1a is not "the fold was too small" — it is "the sentence was too broad." A 36-of-52 map
> with a sentence naming those 36 letters is TRUE and passes; chasing a complete mechanism is the overbuild
> reflex answering a truth failure with more surface, and a vendored table has its own version and curated
> ceiling — it relocates the discipline.* If a table is vendored later, **S5-2 applies unchanged: name the
> version and the ceiling.**

**The unsafe assumption is CONFIRMED UNSAFE and answered structurally.** S4-1a/b/c do **not** exhaust the
class — the same shape is available in every `Proof scope` line, every A1–A8 paragraph, and every enforcer
header. β added no separate machinery for it: **S5-2 is scoped to EVERY coverage claim on the shipped
surface, so the sweep IS the criterion.**

## Scope (design detail — see the build spec for bundles)

- **One transform, both sites.** The emphasis fold moves INSIDE `canonicalizeClaimText`, or `containsStatusToken` routes through `flattenForAssertionScan`. G's own comment already requires this; the sprint is making the code obey it. Battery gains emphasis-split status-token variants, controls first.
- **Refuse-not-skip on the LEAD-IN path for every prefix class**, heading markers included.
- **Confusable coverage stated as the mapped letter set**, or a vendored Unicode confusables table. Never "scripts closed".
- **Escape counts replaced by named classes everywhere** — a number is a property of the day it is read.
- **Bind the description paragraph** via an extended fixture builder, with its own falsifier.
- Residual groups 1, 2, 3, 4 and 6 above.

## Standing discipline — binding on this sprint

- **Every shipped claim sentence is drafted AFTER the attack that would falsify it — including sentences β recommends and α approves.** β's own words at row 316, carried verbatim because β wrote them about its own recommendation being graded false:
  > **"approval is not a truth check, and β's recommendation is worth exactly nothing against the shipped bytes."** A `falsification_attempts` entry per shipped claim, and an entry whose `attack_run` is a description rather than something that was run is not an entry.
- **β mints a FRESH rule before any result exists.** S4-1…S4-6 do NOT carry over automatically; the predecessor's numbering must never be mis-cited into this sprint.
- **A brief may not assert "X is missing" or "X is required" without an attached grep/read proof** (ED-363), and a builder is entitled to refuse a false premise with evidence — that is a correct return, not a failed bundle.
- **A finding from a read-scope-limited lane is reconciled against the full file before it is graded** (ED-362).
- **Emission is necessary but NOT sufficient, and hand-written prose is not forbidden** (β row 317 Q2). β's own S4-1a sentence had the **data right** — Cyrillic and Greek genuinely are what the fold samples — and its **FRAME** was the falsehood. Emission fixes the data; **S5-2(b) fixes the frame.** Do not mistake an emitted number for a true sentence.
- **A sample is asymmetric evidence: it can prove a class OPEN, never CLOSED** (β row 317 Q3, encoded as S5-2(c)). The design battery's 12/12 and 3/3 prove those classes OPEN. They do not close them, and no number of probes ever will.
- **`falsification_attempts` is a DoD item and standing discipline, NOT a release criterion** (β row 317) — an envelope/process artifact rather than a property of the shipped surface. Every envelope still carries one entry per shipped or relied-on claim, and an entry whose `attack_run` is a description rather than something RUN is not an entry.
- **NO STACKING — one defect fires ONE criterion**, routed specific-before-general: a false sentence whose falsehood IS a granularity mismatch fires **S5-2 only**, and a residual that travels but travels inaccurately fires **S5-2, not S5-7**.
- **A text-matching enforcer cannot distinguish a violation from a description of one.** Prose about a banned primitive trips the ban. Two bundles hit this from opposite directions; document it in the scanner header.

## Definition of Done

- [ ] β mints a fresh, pre-committed release rule before any build result exists.
- [ ] Residual groups 1, 2, 3 closed with execution-proven falsifiers, controls first.
- [ ] Group 4's MEDIUMs dispositioned (fixed or disclosed in class form on the surface where the reader is).
- [ ] Group 6's items closed or explicitly re-carried with reasons.
- [ ] Every shipped claim sentence carries a `falsification_attempts` entry naming the attack that was RUN.
- [ ] ED-340 / ED-354 / ED-358 dispositions restated at close.
- [ ] No claim of completeness over a category the mechanism only samples (ED-358's class).
- [ ] **THE CLOSE STATES THE CLASS'S STATUS HONESTLY — verbatim, whatever the outcome** (β row 318's amended TERMINAL; placed here at MINT so it cannot be forgotten at close):
      > *this sprint fixes three known instances of a class whose size is unknown, with the four un-audited shipped surfaces named and carried to the successor*

      **A close that reads as "the coverage-granularity class is closed" is the class one layer out, in the sprint that exists to end it.** This box is checkable only by the close text itself, and it applies to a NO-RELEASE close exactly as much as to a release.
- [ ] **The four-file list resolved by a READ** of the gauntlet-2 `what_i_could_not_assess` fields before the close — β relied on ε's report for it and flagged it as unverified and load-bearing. **Done 2026-08-29 at design; see `runtime/vlad-w1/s05/ROUND-RECORD.md` for the result and the conductor's own frame correction.** Re-affirm at close.

## Decisions

- **2026-08-29 — this sprint exists rather than a fix attempt 2 on S-VLADW1-04.** β's rule pre-committed ONE attempt with **no exception clause, deliberately**; α applied it verbatim. Reopening would be reshaping a pre-committed gate after seeing the result, barred in both directions (P-094).
- **2026-08-29 — `wt/S-VLADW1-01-engine` is NOT merged.** It stays at `6a105f2` as this sprint's starting surface, because its shipped copy contains sentences proven false by execution.
