# Record-Trust Gate — design-phase doctrine for records that gate irreversible actions

> The gate
> itself is a blocking design→build exit, checked by `scripts/checks/record-trust-gate.js`
> against a record-trust manifest. This doc is the
> reusable doctrine a FUTURE sprint's design phase reads; ε points here at the design→build
> boundary. Doctrine + pointers only — the enforcement home is that design→build exit check,
> not a new hook (see the Enforcer section).

## The pattern this closes

Any feature where a **reader trusts a record or field to gate an irreversible action**
(dispatch, integration acceptance, merge/close, lease acquisition) is a record-trust surface.
This is a **binding design-phase gate**, not a gauntlet discovery.

## The gate (apply at DESIGN, before build)

For every path where a reader trusts a record/field to gate an irreversible action:

1. **Name the SINGLE choke-point** + a **STRUCTURAL guard that FAILS any new, un-routed reader**
   (the verified-liveness-read / provenance-verifier pattern —
   `scripts/dispatch/provenance-verifier.js`, `scripts/checks/liveness-read-choke-point.js`).
2. **Enumerate + PARTITION the whole surface by session-scope.** SAME-SESSION
   artifacts (WorkOrder/dispatch validators) can use per-session HMAC. CROSS-SESSION artifacts
   (AcceptanceRecord, the lease/fencing-token, the do-not-reopen ledger) CANNOT — per-session HMAC
   can't verify another session's claim. Cross-session artifacts use
   an atomic-FS primitive (leases: O_EXCL / atomic rename + a monotonic
   fencing token), NEVER per-session signing.
3. **Ship adversarial fail-open FALSIFIER fixtures BEFORE build** — forged / unsigned / stale-base /
   self-asserted-success records MUST block, as REQUIRED-PRESENT named test files.
4. **The gate needs a NAMED ENFORCER — else it is a hollow ladder rung.** Wire it
   into the design→build EXIT as a BLOCKING checklist: each enumerated path names its choke-point AND
   its required-present falsifier fixtures EXIST and fail-closed. A missing falsifier BLOCKS build-entry.

## Companion doctrine (same failure family)

**Record-forgery is MISTAKE-class, not attacker-only — check the company's OWN incident history
before dispositioning a trust gap.**
**Rule:** a mistake-reachable false-green MUST close; an attacker-only-within-a-NAMED-ceiling
gap may be dispositioned honestly (the same-UID filesystem ceiling is named honestly — no local scheme
beats an adversary who edits the attestor).

**False-REDs get the SAME honesty treatment as false-greens.** An enforcer that reds
correct behavior erodes trust in the gate exactly like a green on broken behavior — both are accuracy
failures. Fix the CLAIM/mechanism; never tolerate "red but we know it's fine." Cross-session exemptions
must be **CODE-allowlisted with a structural reason + a stale-exemption self-policing belt**, NEVER a
settable per-record marker (a content-refusal rider can silently drop real reviews — a security hole).
Prefer structural binds over content refusal. Enforced by `scripts/checks/liveness-read-choke-point.js`.

**Pre-declare the terminal condition BEFORE the final gauntlet round fires.** Declare
it up front: PASS → proceed; prose-only findings → one-pass fix + close under the honest ceiling; new
substance → a real fix cycle. This ends adversarial convergence loops honestly — preventing both the
grind (chasing undecidable completeness) and the shortcut (closing over real findings). Prose-completeness
is as undecidable as detector-completeness; "substance-proven-closed + claims-honest-to-scan" is a legitimate
binding-clear.

**The exit-0-that-lies class, and why its instance COUNT is itself a finding.**
**Rule:** when one class produces several instances inside a single arc, stop treating them as
incidents — name it that arc's dominant failure mode and screen every REMAINING deliverable against it
before shipping. The screen must include your OWN prior reports.
Prevention: fail-closed checks plus artifact-first verification
of every claim.

**A gate keyed on a CLOSED enumeration needs its escape CONSTRUCTED, not assumed away.** The
false-green/false-RED pair above covers gates that LIE; this covers gates that are SILENT — a real outcome
landing in no named bucket and therefore PASSING.
**Rule:** for every closed class-set (finding
classes, severity families, ship/no-ship buckets) construct the outcome that fits none of them before
ratifying it; and prefer tightening a definition over adding a class, because any class outside the named
set is itself an escape hatch and widening the taxonomy requires the terminal RE-RATIFIED rather than
silently re-scoped. (ADR-0040 (finding-class boundaries, no relabelling; see `.claude/agents/president/_system/policy/adr/INDEX.md`).)

**An ARMED check reports on its SUBJECT, not on itself — three check-honesty rules.**
(1) Before trusting a `NO_DATA` or a green, verify the **subject's emitter is even reachable**.
(2) **An enforcer with no OBSERVED
red state is enforcement debt wearing a green badge** — run the mutant before believing the gate.
(3) **Verify the mutant hits the RIGHT lever**: run the plant first and learn which rule actually
trips, because a wrong-lever mutant is FALSE reassurance, not weak reassurance. Same family as the
false-green/false-RED pair above: this one covers gates that are *pointed at the wrong world*.

**Guards must cover EVERY input channel, or fail-closed on the ones they don't.** A
mismatch guard wired only to the SUPPORTED channel structurally cannot catch the unsupported one.
Enumerate a guard's input channels at design time; any channel the
guard cannot read must be refused, not silently accepted.

**Citation verification is TWO passes, and pass 1 passing is not verification.**
Pass 1 = the cited paths RESOLVE. Pass 2 = **read the contents against the claimed role**.
Pass 2 is the verification; pass 1 is only its prerequisite.
(A read-scope-limited lane's finding must be checked against the full file.)

**Completion claims are records too — don't rationalize "done" to hit 100%.**
When a DoD item is genuinely unmet (a hard enforcement hook vs a procedural consult), hold the
epic at an honest ~95% Active and SURFACE the choice — build it, or govern it as tracked debt —
rather than silently reclassifying to complete. The enforcement-debt pattern is a legitimate
interim; the spec's DoD is still the completion bar. And for an item that **cannot** close under
delivery pressure, **split it**: an ungated half that closes now, plus a gated half that names its
external blocker — then state the weaker half's LIMITS rather than softening them (e.g. fixtures
recorded as unable to surface real stack shapes, repo size, or odd git states). An unclosable DoD
item under pressure is how fudged evidence enters a record. Pairs with the never-claim-done-without-proof rule.

## Related — the regex-guard ceiling

The structural guards above are today regex-based and share an undecidable residual.
The cross-cutting fix — a shared AST/dataflow guard lib
(acorn/babel) vs per-sprint re-derivation — is tracked as **enforcement debt**, an
OPEN_ADR when a Phase touches it. Deferred defense-in-depth, not urgent.

## Enforcer

The gate's enforcement home is **already designed**: the sprint plan's design→build EXIT
checklist. This doc does NOT add a new hook — it is the reusable doctrine pointer. The
open work is verifying the gate actually FIRES at design and,
longer term, generalizing the blocking checklist into a mode-agnostic design-phase enforcer so
every sprint's design→build exit runs it — a named residual, not yet built.
