# ADR-0032 — Trusted enforcement adapter: the sole integration principal + CORE-2 goes live

- **Status:** Proposed (design-lock, SP-20260720-002 Phase 4). Ratified at merge by α.
- **Date:** 2026-07-20
- **Sprint:** SP-20260720-002 (MC 1.0 Phase 4 finale — trusted enforcement adapter)
- **β:** DECIDE B/0.89 at plan→design (6 binding riders, OPEN_ADR flagged); design→build consult in flight.
- **Extends:** ADR-0028 (immutable-SHA result binding), ADR-0030 (typed acceptance-record commit-identity schema), ADR-0027/0031 (agy provider strategy / legacy gemini removal — the panel-2family floor this adapter's exit proof runs on). Realizes the trust boundary DEFINED in Phase 0 (`.claude/kernel/top-level-runtime-contract.md` §1/§7, CORE-2).

## Context
Phase 0 DEFINED the trust boundary (CORE-2: a provider-independent TRUSTED layer SOLELY owns capability grants, protected mutation, verification, and integration-to-main) but shipped NO enforcement adapter — tracked as ED-215 (the CORE-2 conformance fixture ships `report_only:true`). Phase 3 shipped the sol-A2 AcceptanceRecord primitive (`acceptance-record.js`: produce/authorizesIntegration/commitIntegration with atomic git-update-ref CAS, recompute-don't-trust, ancestry, lease-fencing) — but it has no orchestrating caller. Any provider/worktree can still merge into main today.

## Decision
Ship the **trusted enforcement adapter** as the LIVE runtime block for CORE-2's **artifact-verification + integration slice ONLY** (the honest promise; capability-grants + protected-mutation stay defined/report-only). Four mechanisms:

1. **Sole integration principal (`scripts/dispatch/trusted-controller.js`).** The controller is the trusted verifier: it RE-DERIVES the verdict — the incoming ResultEnvelope is untrusted DATA, never a pre-built AcceptanceRecord; the controller runs the pinned checker bundle ITSELF and produce()s over base+tree hashes IT computed. It is the only brokered route into main (produce→authorizesIntegration→commitIntegration atomic CAS).

2. **Content-addressed pinned checker bundle (`scripts/dispatch/pinned-checker-bundle.js`).** A promoted, content-hashed bundle of the shared check library + helpers/deps/config/executable-resolution, verified BEFORE execute and re-verified AFTER (pre/post digest), run from OUTSIDE the candidate's writable domain. Nothing in the candidate tree influences which checker runs or resolves the executable.

3. **Sole-route MECHANISM (`scripts/hooks/protected-ref-transaction.js`).** A git `reference-transaction` hook on `refs/heads/main` — probe-confirmed (git 2.54) to fire on every write surface (commit/update-ref/fast-forward/merge, all phases), to ABORT a write on non-zero exit in the `prepared` phase, and to be UN-bypassable by `--no-verify`. It requires the controller's lease fencing token; an un-brokered mutation is rejected. **Honest ceiling (NAMED):** this catches MISTAKE-class un-brokered merges only. A hostile operator with local shell (core.hooksPath redirect, hook deletion, direct `.git/refs` write, forged fence) is adversarial-containment — operator-DROPPED, OUT of the honest promise.

4. **CORE-2 goes live + ED-215 closes.** Flip the `trust-boundary/trusted-layer-sole-integrator` conformance fixture `report_only:true → false` (scoped to the artifact-verification+integration slice); ED-215 closes; ED-236 H5 (the acceptance-read-choke-point lexical ceiling) is closed by the pinned external checker and recorded as adjacent.

Supporting invariants: a nonce-bound run manifest (default-deny over every expected check — 8 distinct reason codes), one shared check library require()'d by all three consumers (Claude hook / git pre-commit [non-authority] / controller-via-pinned-snapshot), a `check_suite_version` + recomputed-digest extension to the AcceptanceRecord binding, and required-present G4.1–G4.6 falsifier fixtures (see `record-trust-gate.manifest.json`).

## Consequences
- **Positive:** CORE-2 becomes a live runtime block for its honest slice; the false-green merge-into-main class is prevented by construction (record-trust gate + required-present falsifiers); the Phase-3 AcceptanceRecord primitive gets its trusted caller; the lexical acceptance-read-choke-point ceiling is definitively closed.
- **Negative / bounded:** the honest promise is artifact-acceptance + integration only — hostile-operator containment is explicitly out. The reference-transaction mechanism is local-git-specific (the honest ceiling names what it does not cover). The controller adds a required step to the integration path (mitigated: it composes existing primitives, no greenfield).
- **Reversibility:** the CORE-2 flip is one fixture line, gated by `conformance-matrix.js --flip-gate` (refuses a red flip) — revert-safe if a falsifier reddens.

## Alternatives rejected
- Lexical-guard-only (acceptance-read-choke-point): its own docstring names the ceiling — a no-op call satisfies the scan; the pinned external checker is the definitive close.
- Greenfield dispatch/merge rewrite (packet 08): rejected in the ratified plan — adapt onto the existing ledger + CAS primitive.
- Waiting for agy/panel-3lab: violates the operator 2026-07-20 defer directive; the exit proof runs on the panel-2family floor.

## Amendment 2026-07-21 — live-install deferral (beta rider R2, DECIDE B/0.90)

**Precision on "goes live":** the mechanism is BUILT + FALSIFIER-PROVEN (52 falsifier
files / 108 teeth green at merge cbf6ab4e; CORE-2 fixture flip `report_only:false`
stands, gated by `conformance-matrix.js --flip-gate`). However the Seam E
reference-transaction hook's LIVE-install on the canonical repo is **DEFERRED to D-4**:
once installed it fences EVERY `refs/heads/main` write behind the controller fence
token, and `trusted-controller.integrate()` accepts only unit-shaped inputs — there is
NO brokered transport for branch merges or release commits yet
(ED-controller-no-live-release-transport, high, open). Installing before the transport
exists forces disable-per-release, which is sole-route theater, not protection.

**Flip-trigger (recorded):** D-4 builds the brokered merge/release-commit transport as
its FIRST work item → install the hook via `scripts/install-git-hooks.sh` → verify
`.git/hooks/reference-transaction` wiring → record the flip. Until then the
mistake-class defense is carried by the falsifier suite + record-trust gate
(honest-ceiling-with-named-enabler; QA-001 documented in merge cbf6ab4e).
The unfenced-write window {Phase-4 merge cbf6ab4e, n8 merge 58545214, R5 regen commit}
is documented per beta rider R3.
