# ADR-0041 — Credential custody for the Vlad engine: the PROVE / ASSERT boundary

- **Status:** ACCEPTED (2026-08-03) — α-reviewed and accepted same day (drafted by a delegated lane; the
  drafting lane did not commit). β's OPEN_ADR from `7c4e2b96` (narrow scope, see Deciders): **verified
  discharged 2026-08-03** — β clause-by-clause review against the parent verdict, discharge verdict msg_id
  `8f3a2d71-6b45-4e92-a17c-30d5c9e46b28` (DECIDE, class A, 0.92), conditional on the legal-basis sentence in
  Context, which landed the same day. Observed, not asserted.
- **Deciders:** β verdict `7c4e2b96-5d81-4a37-b0f2-91e6c58a3d74` (DECIDE, class B, 0.88, **OPEN_ADR narrow** — β
  scoped the ADR to "the credential-custody control's prove-versus-assert boundary, not the sprint as a whole");
  operator ruling 2026-08-01 (model access is SUBSCRIPTION-PRIMARY), which changed *which secret* the control
  guards and nothing else about it.
- **Sprint of origin:** S-VLADW1-01 (`trackers/sprints/S-VLADW1-01-vlad-engine-skeleton.md`), epic E-VLAD-001
  Wave-1 ENGINE. The boundary governs beyond it — see Scope.
- **Adjacent doctrine:** ADR-0039 §A2.1 condition 2 (a claim consumed as a safety guarantee must never be
  silently false) — β classed the original DoD wording as exactly this defect, arriving **pre-build**;
  ADR-0040 (no-relabelling: weaken the reported CLAIM, never the invariant; RENAME a field whose meaning
  narrows); ADR-0025 (attestation origin-proof — the precedent for **naming** a same-user trust ceiling and
  accepting it rather than engineering around it); the CLAUDE.md lib-only-fix rule (a fix living only inside a
  helper re-opens its bug the moment one caller goes around the helper).

## Context

The Vlad engine holds a secret belonging to the user and authenticates to Anthropic's endpoint with it. The
epic's Definition of Done originally obliged the product to prove *"the user's Anthropic API key never leaves
their machine — no transmit, no log, no proxy, no telemetry."* β's A1 established that this is **unachievable
as written**: the Agent SDK authenticates *with* the secret, so transmitting it is the mechanism, not a leak. A
fail-closed enforcer over that wording must either lie to pass or red-flag correct behaviour forever. The
obligation was reworded to the achievable **credential-intermediary** form and landed in all three artifacts
(sprint DoD `33024f46`, epic DoD via α's `/epic:fold` `3a8fd442`, banked planning inputs `88abeb8b`).

**The obligation's verified legal basis, carried here because a product-repo reader cannot reach the epic DoD
(β A2 re-base, 2026-07-30):** the twice-verified legal page (fetched verbatim twice, independently, 2026-07-29
— evidence `runtime/vlad-w1/w1-planning-inputs.md` §1) bars credential **intermediation** directly; the earlier
"Consumer Terms forbid credential sharing" citation was never primary-source verified and is **not relied on**.

What was *not* settled by that rewording, and is what β flagged OPEN_ADR, is the boundary itself: which
obligations a mechanical enforcer can **PROVE**, which remain **ASSERTED** posture, and how an assertion is
labeled so it is never consumed as a proof. That boundary currently lives only in sprint-contract prose. Two
things make prose an inadequate home, and they are the ADR-0040 argument in a second instance:

1. **The control ships to a different repository.** It is a product-layer control that must run on the user's
   machine, inside the sibling `vlad` product repo (registered in the HOME-anchored portfolio registry, `~/.mc/portfolio.json`) — a repo that will
   never contain MC's sprint trackers. A boundary defined only in `trackers/sprints/` does not resolve
   where the control runs.
2. **Its two strongest citations are machine-local.** β's verdict is canonical at `paths.betaEvents` line 293,
   which is gitignored (ADR-0026's class); the enforcement ledger at `paths.enforcementDebt` is likewise
   machine-local. A control whose scope is defined in unclonable artifacts has no scope — so this ADR carries
   the enforcer names in its own text rather than only citing ledger ids.

**Model-access history, referenced as struck-in-place history and NOT re-litigated here.** The 2026-07-29 ToS
NO-GO chain (claude-CLI subscription shell-out barred; API-key therefore "primary and ONLY, never a fallback")
was **superseded 2026-08-01** by the operator's SUBSCRIPTION-PRIMARY ruling: the prohibition clause bars the
DEVELOPER's credentials proxying users' requests, not a user running an agent locally on their OWN
subscription. The prior wording is preserved in place — struck, never deleted — in the epic tracker
§ Decisions, the epic plan artifact `_planning/epics/E-VLAD-001.md` (§3, §4, §6, §7, §10), and the sprint
tracker; the 2026-07-29 primary-source quotes remain accurate and are the fallback seam's justification. **This
ADR takes no position on that parse and does not reopen it.** It matters here for exactly one reason: β
required the control be designed to protect a **held secret generically** rather than "the API key", so a seam
reversal changes *which* secret is guarded, not *whether* the control works — and the 2026-08-01 ruling is the
first live exercise of that property (the guarded secret moved from the user's API key to the user's
OAuth/subscription ambient state, with the control unchanged).

## Decision — the obligation, stated once

**The product never becomes a credential intermediary.** The **HELD SECRET** — whichever the live seam carries:
the user's OAuth/subscription ambient state under the subscription-primary posture, the user's API key on the
engineered fallback seam — is used **solely** as the agent/SDK's own authentication to Anthropic's endpoint and
reaches **no other destination**: no log, no telemetry, no proxy, no third party, and no child process (env
passing is allowlist-based; ambient credential state is never inherited).

## Decision — where the PROVE / ASSERT boundary sits

The boundary is **destination enumerability**, and it is stated as a rule rather than a list so future claims
classify themselves:

> A custody claim is **PROVABLE** iff its falsifier is a finite, enumerable set of destinations or call sites
> inside the shipped artifact — something an enforcer can walk. A claim whose falsifier lives outside that
> artifact's control is **ASSERTED**, however confident we are in it. Confidence never promotes an assertion.

This is why the original wording failed: "never leaves the machine" quantifies over *every* egress including
the intended one, which is not an enumerable in-artifact set. "Reaches no destination other than the SDK's own
auth call" names a set an enforcer can walk.

### PROVEN — mechanically, fail-closed, each with its proof scope stated

Report-only does not satisfy any of these. Each is stated with the precision it actually achieves, because a
proof described more broadly than it runs is itself an ADR-0039 §A2.1 defect.

- **P1 — No held-secret-shaped value in the scanned surface.** Committed files, log-writing call sites,
  telemetry payload builders. The scan targets the UNION of every secret class any engineered seam can carry —
  API-key patterns AND OAuth/session-state patterns — unconditionally, never only the class the live seam
  happens to use. Deriving the target from a "which seam is live" reading would make a stale value narrow the
  scan silently and pass GREEN; both secrets can also be present at once, since the fallback seam is engineered
  and ready. A new seam ADDS a class; an unrecognized seam value fails closed rather than scanning nothing.
  *Proof scope: absence at the scan's precision over the surface enumerated — not absence in general.*
  *(Amendment 1: generalized from "key-shaped" — the pre-seam-flip wording enforced only the fallback seam's
  secret class.)*
- **P2 — Every child-spawn passes an explicit allowlist env excluding the held secret, AND raw
  `spawn`/`exec`/`fork` that bypasses the audited wrapper is REFUSED.** Both halves are required. A scrubbing
  wrapper alone is a convention, not a control: it re-opens the defect the moment one caller goes around it —
  the CLAUDE.md lib-only-fix class, which has already cost this project the codex-stdin re-hit 13 days after
  the fix. *Proof scope: spawn sites reachable by the enforcer's walk of the shipped tree.*
- **P3 — A runtime negative fixture: poison the ambient env with a decoy secret of EACH class P1 covers, spawn
  a child, assert the child cannot see any of them — and it goes RED when the scrub is removed.** The mutant
  proof is the point. Without it, P1 and P2 have proven only that the code *looks* right. *Proof scope: the
  paths the fixture actually exercises.* *(Amendment 1: one decoy per secret class, was "a decoy key.")*
- **P4 — No outbound request originating in the shipped tree carries the held secret, other than the SDK's own
  authenticated call to Anthropic's endpoint.** Covers the obligation's "no proxy, no third party." *Proof
  scope: outbound-request call sites reachable by the enforcer's walk of the shipped tree. What is proven is
  that the secret is not ATTACHED to a non-auth call — NOT that any destination is safe, since a destination
  may be computed at runtime.* *(Amendment 1: added — these two destinations were previously unclassified.)*

**Destination totality (Amendment 1):** every destination the obligation names now maps to a clause — log → P1,
telemetry → P1, child process → P2/P3, proxy → P4, third party → P4. Any future edit that adds a destination to
the obligation must map it to a clause (PROVEN or ASSERTED) in the same edit; re-run this totality check
whenever the obligation's destination list changes. P2 needed no generalizing and never will for this cause:
it is deny-by-default (an allowlist excludes everything not named), immune to secret-shape drift, while
pattern-match checks (P1/P3) must enumerate classes — the discriminator that predicts the next occurrence.

**Firing point (β A5, binding).** The leak would happen on the user's machine, so P1–P4 are **product-layer
controls that ship with the product and run in the user's install.** An enforcer that runs only in MC CI
proves something about our source and nothing about their runtime, and does not satisfy the DoD item. If any
part can only run in our CI, the design must say **which** part and record the gap explicitly.

### ASSERTED — attested posture, not verified, and stated in strong form

β required these be stated in strong form because a weak form invites a remedy that closes one instance while
the leak steps one over. None of them shrink with effort.

- **A1 — Dependency surface.** Any package in the tree can read `process.env` and reach the network. **No
  in-repo enforcer can bound this.** The mitigations are minimizing and reviewing the dependency surface — not
  a scanner. This is the largest residual. This residual explicitly includes **dependency-initiated network
  egress**: P4 walks outbound call sites in OUR tree only, so a package that reads the environment and makes
  its own request is outside P4's falsifier set and lands here. *(Amendment 1: widened — a seam is closed by
  widening an existing family, never by adding one.)*
- **A2 — Same-user OS access.** Another process running as the user can read the environment or a key file.
  Control and attacker share privileges, so there is **no layer-level fix** — this is not "our scanner misses
  it." Same shape as the ceiling ADR-0025 named and accepted for the attestation surface.
- **A3 — Unexercised paths.** A static scan proves shapes; a runtime probe proves the paths it runs. Neither
  proves a path nothing exercised.
- **A4 — Off-repo human leaks.** A secret pasted into a support ticket or left in shell history is out of
  scope. It warrants one line of user-facing guidance, not an enforcer.

### The labeling rule — how an assertion is marked attested-not-verified

1. **Never the same class as a proof.** An asserted item is rendered as *attested, not verified*, with its
   ceiling named in the same breath (A1–A4 above are the wording, not a summary of it). It may never share a
   status token, badge, colour, or aggregate with a proven item — collapsing them is how an assertion gets
   consumed downstream as a proof.
2. **The user-facing claim may not exceed the proven set.** No "your key never leaves your machine" in a README
   while the SDK transmits it; no implied guarantee about dependencies. β marked final user-facing wording
   **Class C — operator territory** (it is a user-trust claim); this ADR governs only what the enforcer proves.
   Draft to the proven set and route the wording to the operator.
3. **Narrowing renames (ADR-0040).** If a proven claim must later narrow, **rename the field or check** rather
   than re-documenting what the old name means. A narrowed meaning lives in a doc while the old name reaches
   every caller who already read the old one.
4. **A promotion requires a mechanism, not a judgement.** Moving an item from ASSERTED to PROVEN requires a
   named enforcer with a mutant proof, recorded as an amendment to this ADR. Increased confidence is not a
   promotion path.

## Decision — enforcer roster (per the Policy & Enforcement Hygiene rule)

Every clause above names its enforcer or files debt. **None of these exist yet** — the sibling `vlad` repo is a
fresh scaffold and no seam code may be written before the design→build gate clears — so each is named with its
planned identity and marked OWED. The names are carried here rather than only as ledger ids because
`paths.enforcementDebt` is machine-local.

| Clause | Enforcer (planned identity, product repo) | Status |
|---|---|---|
| P1 | `scripts/checks/no-held-secret-in-surface.js` — scan of committed files, log call sites, telemetry builders; non-zero exit on hit | **OWED** — ED-340 |
| P2 | `scripts/checks/spawn-env-allowlist.js` — two assertions: every audited spawn passes an explicit allowlist env; any raw `spawn`/`exec`/`fork` outside the wrapper is a REFUSAL, not a warning | **OWED** — ED-340 |
| P3 | `test/credential-custody-decoy.test.js` — runtime decoy fixture per secret class P1 covers + a mutant run that must go RED with the scrub removed | **OWED** — ED-340 |
| P4 | `scripts/checks/no-secret-on-outbound.js` — walk of outbound-request call sites; the SDK auth call is the sole permitted carrier of the held secret; non-zero exit on any other; own mutant: a planted non-auth outbound call carrying a decoy secret must go RED | **OWED** — ED-340 |
| Firing point (A5) | The four above wired into the product's own ship-time check run, not only MC CI; the wiring itself asserted by a presence check in the product's release gate | **OWED** — ED-340 |
| Labeling rule (1–3) | A receipt/README claim lint over the shipped copy: any custody claim string must map to a P-clause id | **OWED** — ED-340 |
| A1–A4 | **No enforcer exists or can exist in-repo for A1/A2** (that is the finding, not a gap to close). Enforced instead as a *presence* obligation: the four ceilings must appear verbatim in the shipped custody statement, checked by the same claim lint | **OWED** — ED-340 |

Filed as **ED-340** (one consolidated row covering the **seven** planned enforcers; closes only when ALL seven
exist in the product repo and **both** the P3 and P4 mutant runs have gone RED at least once — partial shipment
amends the row, never closes it. Amendment 1 raised the count from six and added the second mutant; a range or
count reference that silently excludes a new clause is exactly the half-applied-amendment defect).

> **TIGHTENED by Amendment 3 (2026-08-19, β `3d9a71c4`, FORWARD-ONLY) — read that amendment before closing
> this row.** "Gone RED at least once" above is satisfiable by a one-time hand-run recorded in a commit
> message, which is not re-executable by the reader asked to trust it. The closing condition is now a
> **committed, re-runnable test** in the shape AC-8.4 names. Also note the roster's A5 row says the four
> enforcers must be **wired into the product's own ship-time check run** — an enforcer that exists but is
> named in no run does not satisfy it, and that alone held this row open.

## Scope

Binding on the Vlad product's model-access seam under **either** seam, and on any future MC-family product
that holds a user's credential. It governs the prove/assert boundary and the labeling rule **only** — the
sprint's other design surfaces (the four-core MCP tool set, the quota detector's three buckets, the honest-
degradation language) are the sprint's, per β's explicitly narrow OPEN_ADR. The full obligation text remains
stated in the epic and sprint Definitions of Done; this ADR is the durable, clone-surviving home of the
boundary and the rule.

## Consequences

- **The seam ruling changes which secret is guarded, not whether the control works.** That property is now
  load-bearing rather than incidental: it is what let the 2026-08-01 subscription-primary ruling land without
  reopening the control, and it is what makes a forced flip back to the API-key fallback a seam swap.
- **Residual risks carried forward from the 2026-08-01 ruling, recorded and not softened:** the prohibition
  clause is ambiguous under the alternative parse; Anthropic's policy is explicitly in flux (the June 2026
  metering change is paused, not withdrawn); and Anthropic reserves **enforce-without-notice**. Mitigation:
  the engineered API-key fallback seam — the SOLE mitigation as of 2026-08-10 (~~the Anthropic
  clarification/approval request~~ CANCELLED by operator ruling, Amendment 2 — never to be re-proposed).
  Trigger for the flip: Anthropic closes or meters the subscription path.
- **A user-facing claim exceeding P1–P4 is a defect of this ADR's class**, regardless of how confident the
  claim's author is — including a claim about A1 (dependencies), which is the one most likely to be written
  optimistically because it feels like hygiene.
- **An enforcer that runs only in MC CI does not satisfy the DoD item**, and a design that ships one is
  incomplete rather than partially credited.
- **A1 and A2 will not be closed by future effort.** A later change claiming to have closed either in-repo
  should be read as suspect by construction and re-derived against the destination-enumerability rule before
  it is believed.
- **Report-only does not satisfy any proven clause** — the DoD says fail-closed and this ADR does not soften it.

## Provenance / resolvers

- β verdict full text (git-tracked, clone-surviving): `runtime/vlad-w1/betaevents-staged-W1-plan-to-design.md`
  — carries the CONSUMED marker; canonical row at `paths.betaEvents` line 293, msg_id
  `7c4e2b96-5d81-4a37-b0f2-91e6c58a3d74`, consult `063c75dd-36e4-4c2f-8c00-78de716a4ab0`. The ledger is
  machine-local; the tracked file is the resolver.
- Operator ruling (authoritative wording): epic tracker
  `trackers/epics/E-VLAD-001-vlad-v1-agent-mcp-cofounder.md` § Decisions first entry + Change-log fold
  `5b022ea9`. The epic outranks the sprint tracker on the ruling's wording.
- Reworded DoD: same epic § Definition of Done item 10 (α's fold `3a8fd442`); sprint
  `trackers/sprints/S-VLADW1-01-vlad-engine-skeleton.md` DoD (`33024f46`); banked inputs
  `runtime/vlad-w1/w1-planning-inputs.md` (`88abeb8b`, §1 primary-source block, corrected in place).
- Superseded model-access history, struck in place: epic plan `_planning/epics/E-VLAD-001.md` §3/§4/§6/§7/§10.
- Index row added at `paths.adrIndex` on acceptance (2026-08-03).

## Amendments

### Amendment 1 — 2026-08-03 — P1/P3 generalized to all seam secret classes; P4 added; A1 widened
- **Origin:** two candidate gaps found by director-of-engineering during the S-VLADW1-01 design run (routed by
  ε), CONFIRMED-AMEND by β verdict `c4b81e7f-25d3-4a69-9e0b-8f36a2145dce` (DECIDE, class B, 0.92) — which
  widened both beyond the report: GAP 1 extends to P3 and the roster and takes the **union-unconditional** form
  (a seam-conditional scan target is a settable-label dependency whose failure mode is GREEN — the defect class
  this ADR exists to prevent); GAP 2 splits into P4 (PROVEN at call-site scope per the boundary rule's own
  disjunct — call sites, not destinations) + the dependency-egress residual widened into A1 (a seam is closed
  by widening an existing family, never by adding one).
- **GAP 1 error attribution (β, on the record):** β's own row-293 A3 wording ("key-shaped"), written 2026-07-30
  when the API key was the only posture; the drafter transcribed faithfully; the generic-held-secret principle
  in the same verdict was the load-bearing correction that made the flip survivable.
- **P2 unchanged, and the discriminator recorded:** deny-by-default (allowlist) is immune to secret-shape
  drift; pattern-match checks (P1/P3) must enumerate classes. Shape-dependent checks silently narrow when the
  secret class changes; shape-independent ones do not.
- **Consequential edits in this amendment:** firing point and user-facing claim ceiling now read P1–P4; roster
  gained the P4 row (`no-secret-on-outbound.js`) with its own mutant; ED-340's closing condition is now seven
  enforcers + both mutants (P3 AND P4) RED at least once; Destination totality stated so the closure check is
  re-runnable.
- **Verification:** β post-landing verification against verdict `c4b81e7f` — see betaEvents; stamped by α per
  the standing lane agreement.

### Amendment 2 — 2026-08-10 — clarification-request mitigation CANCELLED by operator ruling
- Operator ruling 2026-08-10 (verbatim preserved in epic fold `f539e1e2`): the Anthropic clarification/approval
  request is **cancelled permanently** — it must never be re-surfaced to the operator or re-proposed by any
  agent at any boundary. The residual-risk RECORD stands unchanged (it is history, not an open item); the
  engineered API-key fallback seam is the **sole** mitigation. No other clause of this ADR changes.

### Amendment 3 — 2026-08-19 — ED-340's closing condition tightened to a committed re-runnable test (FORWARD-ONLY)

Authority: β verdict `3d9a71c4-6f28-4b53-8e17-2a5c0db94f61` (`paths.betaEvents` row 301, DECIDE, Class B,
confidence 0.90, `OPEN_ADR: true`), issued at the S-VLADW1-01 gauntlet boundary. Filed by ε.

**What changes.** ED-340's closing condition read that the row closes when all seven enforcers exist and
"**both** the P3 and P4 mutant runs have gone RED **at least once**". That wording is satisfiable by a
one-time hand-run recorded in a commit message. It is hereby tightened to the form AC-8.4 already
requires: **a COMMITTED, RE-RUNNABLE TEST** — specifically the shape named by
`engine/test/custody-runtime.test.js::negative-fixture-goes-red-when-scrub-removed`. A mutant observation
that cannot be re-executed by anyone who checks out the tree does not satisfy this clause.

**Why.** ADR-0041's own standing rule is that an enforcer with no observed red state is enforcement debt
wearing a green badge. A one-time observation is the *same defect one step out*: the badge is now the
commit message. It is not shipped, not re-runnable, and not visible to the reader who is asked to trust
it — so the fixture rots forever-green the moment the scrub is removed again. On S-VLADW1-01 the P3 mutant
was observed by hand on 2026-08-10 and recorded in `c8040c7b`; four months from now that record proves
nothing about the tree. P4's mutant, by contrast, IS a standing test in `custody-static.test.js`, which is
the form this amendment generalizes.

**FORWARD-ONLY — this is the load-bearing constraint on this amendment.** It names the INVARIANT, not the
live state. It does **not** retroactively invalidate any prior closure, and it must not be read as a
post-hoc goalpost move against work already judged: the P-094 rule bars goalpost moves *in both
directions*, and tightening a bar to reach a conclusion you already wanted is the same violation as
loosening one. This amendment is legitimate specifically because **AC-8.4 predates the round that
surfaced the gap** (`5313a68b`, 2026-08-03), so the bar was already written down and simply was not
reflected in ED-340's own wording. Had AC-8.4 not predated it, the correct action would have been to
close ED-340 on its wording as written and file the tighter rule for the next row.

**Status of ED-340 at the time of this amendment (recorded, not decided here).** OPEN, on two
independently dispositive grounds: (1) the ROSTER half — the A5 row requires the four enforcers be
"wired into the product's own ship-time check run", and A5 appeared in `check:custody` nowhere while its
only invoker was absent from `package.json#files`, so it never executed in a user's install; (2) the
MUTANT half — AC-8.4's named verifier did not exist. A conductor claim that the closing conditions
"look met" was made in `7fbfb43` and is **withdrawn**.

**Consequence for the labeling rule.** Clause 4 of the labeling rule already says a promotion from
ASSERTED to PROVEN requires a named enforcer with a mutant proof, and that increased confidence is not a
promotion path. This amendment adds the corollary that has been implicit and was therefore missed: **a
mutant proof that is not re-runnable is not a mutant proof for promotion purposes.** A claim may never
outlive its proof — if the standing test is removed or slips, the claim that rests on it comes down
first, in the same change.

### Amendment 4 — 2026-08-19 — the env-inheritance channel is closed by CAPTURE-THEN-SCRUB, not by enumerating call-site shapes

Authority: β verdict `9b2f60ae-3c14-4d87-a5f6-71e0c8d3b429` (`paths.betaEvents` row 302, DECIDE, Class B,
confidence 0.88, `OPEN_ADR: true`), at the S-VLADW1-01 gauntlet-r2 boundary. Filed by ε. Distinct from
Amendment 3 (the ED-340 closing-condition rider) and does not modify it.

**The problem this closes.** P2's raw-launch half is a syntactic enumeration of call-site shapes, and two
gauntlet rounds proved the enumeration is unbounded in practice. Each round widened the patterns; each
round a fresh composite got through — an interposed comment (`spawn /* c8 ignore */ (`, which defeats
every call-site matcher in all three scanners, verified 6 of 6), computed member access
(`cp['spawnSync'](`), `createRequire`, `globalThis['fetch']`. <!-- doc-ref-ignore --> The reviewing lane's conclusion, and it is
the right one: *"The individual patterns were widened; the CLASS was not. Fixing these four patterns
alone will reproduce this finding a third time."*

**Two tempting answers, both rejected, and why the rejections matter.**
- *Relabel the static scanners advisory and state the ceiling honestly.* **Rejected as scope reduction
  wearing honesty's clothes.** The DoD requires an enforcer that REFUSES a raw spawn bypassing the
  wrapper, and this ADR's own Consequences say report-only satisfies no proven clause. Being candid
  about a weakened control does not restore the obligation it dropped.
- *Hold the release for AST-based parsing.* **Rejected as deferral-shaped.** AST buys precision, not
  closure: it still does not reach a spawn inside a dependency, which is A1 and unclosable by any
  in-repo enforcer. It trades the release for an improvement that leaves the class open one layer out.

**The decision.** Stop enumerating the shapes and **remove the secret from the channel every one of them
exploits.** Every bypass — present and future — leaks by a child inheriting the parent environment. So
`model-seam.js` **captures** every `ENV_DENYLIST` value into a module-private at startup and then
**deletes** those names from `process.env`. Nothing remains to inherit, and **how a child was spawned
stops being load-bearing.** This is Amendment 1's discriminator (deny-by-default is immune to shape
drift; pattern-matching must enumerate classes) applied to call-site shape rather than secret shape.

**Capture must precede deletion.** The API_KEY fallback reads `process.env.ANTHROPIC_API_KEY` at
`buildSessionEnv` time; a blanket scrub without capture breaks the fallback seam. Ordering is not a
detail here — it is the difference between a control and an outage.

**The source fact that makes this proportionate.** Under SUBSCRIPTION mode — the live default —
`buildSessionEnv` places **no credential in the child env at all**; the credential lives in the Claude
Code CLI's login store on disk and is read by the SDK subprocess. `ANTHROPIC_API_KEY` enters a
constructed env only in the API_KEY fallback branch. So the live exposure was never engine-constructed
carriage; it was **ambient inheritance of variables the user's shell already carries** — exactly what
the scrub eliminates.

**What this amendment does NOT claim, stated because the sprint that produced it kept finding claims
that outran their controls.**
- It closes the **env inheritance** channel only. **ARGV is a separate carrier** and is not covered by
  it; a secret passed as a command-line argument passes every runtime gate unless the wrapper inspects
  args, which must land in the same change or the guarantee is overstated. argv is world-readable to
  any same-user process on Windows and via `/proc` on Linux.
- It does not bound what a **dependency** does on its own initiative. That remains A1.
- The static scanners **keep their DoD role and stay fail-closed** for the surfaces they genuinely bound
  — committed files, log call sites and telemetry builders (P1), outbound call sites (P4). The one
  honest named ceiling is **P2's raw-launch detection specifically**, bounded by syntactic enumeration.
  Name that one thing; do not demote the set.
- A comment/string-stripping tokenizer may accompany this, and it is worth having — but it **widens the
  existing matcher family; it does not close the class.** The scrub closes the class. Labelling the
  tokenizer as the closure would re-commit the defect this amendment exists to end.

**Falsifiable premise, to be verified rather than asserted.** The scrub assumes the SDK's bundled binary
needs no denylisted variable in the PARENT environment under subscription mode (`sdk.d.ts:1435-1441`
says a supplied env replaces the subprocess env entirely, which predicts yes). This must be checked with
a real subscription-mode call before any user-facing ceiling sentence is written. If the binary does need
one, the scrub is narrowed to the variables it does not need **and the narrowing is disclosed**.

**Enforcement.** The scrub's own mutant is the standing proof: remove the scrub, spawn a raw child by a
path no scanner matches, and the child must be observed seeing the secret. Per Amendment 3, that mutant
must be a committed, re-runnable test — a one-time observation does not satisfy it. Ordering is asserted
by its own standing test, because a deletion test that does not prove order would pass while anything
imported earlier still inherits.

---

#### Annotation to Amendment 4 — 2026-08-19 — the control's FIRING POINT is `src/bootstrap.js`, and its re-invoking choke-point is `auditedSpawn`

Authority: β verdict `5a1d83bc-7e46-4f92-b3c0-2d95e07a41f8` (`paths.betaEvents` row 304) condition 6, the
A5 obligation, carried forward by β `7c05e9d1-4b82-4a37-9f6e-8d3410b2ca65` (row 305) Q4. Filed by ε at the
S-VLADW1-03 build close. **This is an annotation, not a new amendment: it does not change Amendment 4's
decision, only records where the decided control actually fires and corrects one placement sentence that
implementation has overtaken.**

**Placement, corrected.** Amendment 4 says "`model-seam.js` captures ... and then deletes". That was the
implementation at the time and it is no longer where the control fires. The mechanism now lives in
`engine/src/env-scrub.js`, a **zero-import** module — a module with no imports of its own cannot have a
dependency's top-level body evaluate ahead of it. `model-seam.js` retains its own call, but it is no
longer the load-bearing site, because `model-seam.js` statically imports the SDK's transitive graph and
therefore cannot be the earliest firing point in any process that reaches it.

**The firing point.** `engine/src/bootstrap.js` is the single shared static-import surface. Each real
entry point (`src/server-entry.js`, `driver/host-free-driver.js`) statically imports **exactly one**
specifier — `bootstrap.js` — calls `initCredentialCustody()`, and only then reaches the rest of the
program by **dynamic** `import(...)`. The invariant is defined once, in one file, so the standing
regression test checks one shared shape rather than asserting two independently maintained copies stay in
step.

**The ordering claim, stated truthfully — this is the part worth reading.** The sprint that produced this
annotation shipped, in both entry headers, the sentence *"initCredentialCustody() runs before any other
module in this package's graph evaluates."* **That sentence is false**, and a gauntlet lane proved it by
executing a faithful mirror of the shipped chain: `env-scrub.js` and `bootstrap.js` are both modules in
this package's graph and both evaluate to completion first. It is the predecessor's own false
"FIRST STATEMENT" claim reproduced one hop out. The **true** statement of the property is:

> The only modules that evaluate before the scrub call are `src/env-scrub.js`, which imports nothing, and
> `src/bootstrap.js`, which does nothing but re-export it. `node:` builtins still resolve first.

The security property Amendment 4 decided is intact — nothing that could carry or observe a credential
evaluates first. **What failed was the claim, not the control**, which is precisely the PROVE/ASSERT
failure mode this ADR exists to prevent, occurring inside the amendment that closes it. Recorded here so
the next author re-derives the sentence from the code rather than inheriting a prior draft's phrasing.

**The re-invoking choke-point (row 305, Q4).** β made re-scrub-on-call conditional on naming the site that
re-invokes it, on the ground that "re-scrub-on-call without a later call site is single-shot wearing a
class label." It is named: `auditedSpawn()` in `engine/src/spawn-shim.js` re-invokes
`initCredentialCustody()` before every real launch. Semantics are **absorption, not re-capture** — a name
whose captured slot already holds a real value is never overwritten, because a naive full re-capture would
read `undefined` for already-deleted names and silently destroy the captured credential.

**Residuals of the annotated control, named rather than discovered later.**
- **Credential rotation is not covered, and fails silently.** Verified by execution: when a real value was
  captured at startup and the operator rotates the credential mid-session, the re-scrub keeps the stale
  value, deletes the new one from `process.env`, and the fallback goes on serving the stale credential
  with no error and no signal.
- **Prototype-named keys are not captured.** The snapshot is an ordinary object, so a name colliding with
  `Object.prototype` (`__proto__`, `toString`, `constructor`) is never captured and the getter returns a
  non-string. Not reachable in the shipped shape — every shipped caller passes a fixed name list — but it
  is a defect in a security primitive.
- **Worker-thread realm.** A `node:worker_threads` Worker gets a fresh module registry and its own
  `process.env` copy, so the captured state is not visible inside it.
- **Preload precedes everything.** `NODE_OPTIONS`, `--require` and `--import` evaluate before the entry's
  ESM graph. Reaching that requires control of the launch command line, which is outside the shipped
  launch shape — but it bounds "nothing can run before the scrub" and belongs in any ceiling sentence.

**Enforcement status — OPEN, and not to be read as satisfied by this annotation.** Amendment 4's standing
mutant is satisfied for `src/server-entry.js` (removing its scrub call is observed RED). It is **NOT**
satisfied for `driver/host-free-driver.js`: removing that entry's own call leaves every gate green,
because the walker asserts module **reachability** rather than call **invocation**, and the driver reaches
`env-scrub.js` three independent ways. Until the walker asserts invocation and that mutant is observed
RED, the driver entry's scrub call is **not load-bearing and no control detects its removal.** Evidence:
`runtime/vlad-w1/s03/gauntlet-1/ROUND-ADJUDICATION.md`.
