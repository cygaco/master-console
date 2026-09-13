# Record-Trust Gate — design-phase doctrine for records that gate irreversible actions

> Promoted 2026-07-18/19 from learning #130 (threshold crossed: the structural guard was
> DISCOVERED by the gauntlet, not designed up-front, 3× across SP-002/003/004). The gate
> itself is DESIGNED and wired as a blocking design→build exit in
> `.claude/project/sprint/sprints/SP-20260718-005/plan.md` (SHARP-1..3). This doc is the
> reusable doctrine a FUTURE sprint's design phase reads; ε points here at the design→build
> boundary. Doctrine + pointers only — the enforcement home is the SP-005 plan's binding gate,
> not a new hook (see the Enforcer section).

## The pattern this closes

Any feature where a **reader trusts a record or field to gate an irreversible action**
(dispatch, integration acceptance, merge/close, lease acquisition) is a record-trust surface.
Three sprints in a row (SP-002/003/004) spent **multi-round gauntlets discovering** the choke-point
and the kill-the-seam guard that the DESIGN should have named — SP-004 alone spent 6 rounds finding
readers (the `scripts/` root, sibling paths) that the round-by-round hunt hadn't reached. The
threshold is crossed: this is now a **binding design-phase gate**, not a gauntlet discovery.

## The gate (apply at DESIGN, before build)

For every path where a reader trusts a record/field to gate an irreversible action:

1. **Name the SINGLE choke-point** + a **STRUCTURAL guard that FAILS any new, un-routed reader**
   (the verified-liveness-read / provenance-verifier pattern —
   `scripts/dispatch/provenance-verifier.js`, `scripts/checks/liveness-read-choke-point.js`).
2. **Enumerate + PARTITION the whole surface by session-scope (SP-005 SHARP-1).** SAME-SESSION
   artifacts (WorkOrder/dispatch validators) can use per-session HMAC. CROSS-SESSION artifacts
   (AcceptanceRecord, the lease/fencing-token, the do-not-reopen ledger) CANNOT — per-session HMAC
   can't verify another session's claim (the R3 cross-session false-RED). Cross-session artifacts use
   the ED-232 mechanism OR an atomic-FS primitive (leases: O_EXCL / atomic rename + a monotonic
   fencing token), NEVER per-session signing.
3. **Ship adversarial fail-open FALSIFIER fixtures BEFORE build** — forged / unsigned / stale-base /
   self-asserted-success records MUST block, as REQUIRED-PRESENT named test files.
4. **The gate needs a NAMED ENFORCER (SP-005 SHARP-3) — else it is a hollow ladder rung.** Wire it
   into the design→build EXIT as a BLOCKING checklist: each enumerated path names its choke-point AND
   its required-present falsifier fixtures EXIST and fail-closed. A missing falsifier BLOCKS build-entry.

## Companion doctrine (same session, same failure family)

**Record-forgery is MISTAKE-class, not attacker-only — check the company's OWN incident history
before dispositioning a trust gap (learning #123).** The 2026-06 faked-ε (plausible `ok:true`
records, no spawn — `[[feedback_never_claim_done_without_proof]]`) made record-forgery
*mistake-reachable*, which set the fix bar: ED-231 HMAC origin-proof became MANDATORY, not
dispositionable. **Rule:** a mistake-reachable false-green MUST close; an attacker-only-within-a-NAMED-ceiling
gap may be dispositioned honestly (the same-UID filesystem ceiling is named honestly — no local scheme
beats an adversary who edits the attestor).

**False-REDs get the SAME honesty treatment as false-greens (learning #131).** An enforcer that reds
correct behavior erodes trust in the gate exactly like a green on broken behavior — both are accuracy
failures. Fix the CLAIM/mechanism; never tolerate "red but we know it's fine." Cross-session exemptions
must be **CODE-allowlisted with a structural reason + a stale-exemption self-policing belt**, NEVER a
settable per-record marker (a content-refusal rider can silently drop real reviews — a security hole).
Prefer structural binds over content refusal. Landed in `scripts/checks/liveness-read-choke-point.js`.

**Pre-declare the terminal condition BEFORE the final gauntlet round fires (learning #128).** Declare
it up front: PASS → proceed; prose-only findings → one-pass fix + close under the honest ceiling; new
substance → a real fix cycle. This ends adversarial convergence loops honestly — preventing both the
grind (R7s chasing undecidable completeness) and the shortcut (closing over real findings). Prose-completeness
is as undecidable as detector-completeness; "substance-proven-closed + claims-honest-to-scan" is a legitimate
binding-clear. Used 3× this session (SP-003 gpt#5, SP-004 R6, SP-003 park terminal).

**The exit-0-that-lies class, and why its instance COUNT is itself a finding (2026-07-30).** Five
independent instances landed in ONE session, each shaped as a tool returning success over a world it did
not achieve: a placeholder changelog shipped at tag; a plan writer authoring a contract against the WRONG
sprint at exit 0; ENOBUFS surfacing could-not-run as an opaque FAIL (ED-313); capsule checksums claiming
placeholder bytes after the fill; and an ED row's own fail-closed-by-construction claim with no living
enforcer. **Rule:** when one class produces several instances inside a single arc, stop treating them as
incidents — name it that arc's dominant failure mode and screen every REMAINING deliverable against it
before shipping. The screen must include your OWN prior reports: the fifth instance was a claim about the
fix for the first four. Prevention, proven five times: fail-closed checks plus artifact-first verification
of every claim. (ED-313/318/319/325/326/329.)

**A gate keyed on a CLOSED enumeration needs its escape CONSTRUCTED, not assumed away (2026-07-30).** The
false-green/false-RED pair above covers gates that LIE; this covers gates that are SILENT — a real outcome
landing in no named bucket and therefore PASSING. β constructed the escape against her own terminal: under
the v1 phrasing, a successful apply that leaves a working file behind AND REPORTS IT HONESTLY was neither
transaction-honesty (the report is true) nor byte-fidelity (no existing content changed), and would have
slipped the terminal entirely. The fix was DEFINITIONAL, not procedural — non-existence is a byte value, so
an entry that appears or disappears unbidden IS byte-fidelity. **Rule:** for every closed class-set (finding
classes, severity families, ship/no-ship buckets) construct the outcome that fits none of them before
ratifying it; and prefer tightening a definition over adding a class, because any class outside the named
set is itself an escape hatch and widening the taxonomy requires the terminal RE-RATIFIED rather than
silently re-scoped. (`.claude/agents/president/_system/policy/adr/0040-finding-class-boundaries-bf-th-no-relabelling.md` §B3.)

**An ARMED check reports on its SUBJECT, not on itself — three check-honesty rules (2026-08).**
(1) Before trusting a `NO_DATA` or a green, verify the **subject's emitter is even reachable**: the
AP-1 stream's entire recorded history turned out to be its own smoke-test fixtures — the production
path had never run once, and the check was green about nothing. (2) **An enforcer with no OBSERVED
red state is enforcement debt wearing a green badge** — run the mutant before believing the gate.
(3) **Verify the mutant hits the RIGHT lever**: run the plant first and learn which rule actually
trips, because a wrong-lever mutant is FALSE reassurance, not weak reassurance. Same family as the
false-green/false-RED pair above: this one covers gates that are *pointed at the wrong world*.

**Guards must cover EVERY input channel, or fail-closed on the ones they don't (2026-08).** A
mismatch guard wired only to the SUPPORTED channel structurally cannot catch the unsupported one:
`plan.js`'s sanity WARN fired only on `--sprint` disagreement, so a `payload.sprint` caller got
exit 0, a success line, and a contract written against the WRONG sprint — and the authoring tool
validated nothing it produced. Enumerate a guard's input channels at design time; any channel the
guard cannot read must be refused, not silently accepted. (Enforcer class: ED-358.)

**Citation verification is TWO passes, and pass 1 passing is not verification (2026-08).**
Pass 1 = the cited paths RESOLVE. Pass 2 = **read the contents against the claimed role**. Pass 1
cleared all five port citations in one review; pass 2 found that one cited file was a MC install
gate that would have made the product refuse every stranger repo, and that a bare basename matched
three unrelated wrong files. Pass 2 is the verification; pass 1 is only its prerequisite. (Companion
to ED-362 — a read-scope-limited lane's finding must be checked against the full file.)

**Completion claims are records too — don't rationalize "done" to hit 100% (2026-06/2026-08).**
When a DoD item is genuinely unmet (a hard enforcement hook vs a procedural consult), hold the
epic at an honest ~95% Active and SURFACE the choice — build it, or govern it as tracked debt —
rather than silently reclassifying to complete. The enforcement-debt pattern is a legitimate
interim; the spec's DoD is still the completion bar. And for an item that **cannot** close under
delivery pressure, **split it**: an ungated half that closes now, plus a gated half that names its
external blocker — then state the weaker half's LIMITS rather than softening them (e.g. fixtures
recorded as unable to surface real stack shapes, repo size, or odd git states). An unclosable DoD
item under pressure is how fudged evidence enters a record. Pairs with
`[[feedback_never_claim_done_without_proof]]`.

## Related — the regex-guard ceiling

The structural guards above are today regex-based and share an undecidable residual (broadening the
regex traded 26 false positives in SP-004). The cross-cutting fix — a shared AST/dataflow guard lib
(acorn/babel) vs per-sprint re-derivation — is tracked as **enforcement debt** (learning #134), an
α-ruled OPEN_ADR when a Phase touches it. Deferred defense-in-depth, not urgent.

## Enforcer

The gate's enforcement home is **already designed**: the SP-20260718-005 plan's design→build EXIT
checklist (SHARP-3). This doc does NOT add a new hook — it is the reusable doctrine pointer. The
open work is verifying the gate actually FIRES at SP-005 design (per learning #130's own note) and,
longer term, generalizing the SP-005 blocking checklist into a mode-agnostic design-phase enforcer so
every sprint's design→build exit runs it — tracked as enforcement debt.
