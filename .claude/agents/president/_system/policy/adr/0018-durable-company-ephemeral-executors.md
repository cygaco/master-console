# ADR 0018 — Durable Company, Ephemeral Executors

**Date:** 2026-07-18
**Status:** accepted
**Class:** B (architectural impact)

---

## Decision

MC's DURABLE state — RoleSpec, StateCard, SprintRoom, the WorkOrder/ResultEnvelope ledger,
DecisionRecords, event streams, trackers, handoffs, the Founder Panel store — IS the company. Live
model runtimes (Claude sessions, Codex runs, Gemini/Antigravity runs, reviewers, builders, fixers,
lane pods, live conductors) are EPHEMERAL, LEASED EXECUTORS of that state, never the state itself.
Killing a live agent must lose convenience only, never truth.

## Context

The previous architecture leaned toward persistent live agent teams as the seat of truth. In
practice, live agents stall, lose wake events, inherit wrong model settings, miss completion
records, or die without usable liveness evidence. Doogle (the predecessor project) exposed stale
worktrees, false liveness signals, tiny fake-green prompts, missing completion/death records,
tracker drift, and founder-launch gaps — all symptoms of the same mistake: treating live model
processes as the durable company.

MC already runs this way de facto (trackers, event logs, the dispatch ledger, decision records
all persist independent of any one session), but the doctrine had never been ratified. Phase 0 of
the MC 1.0 kernel work (SP-20260718-001) needs this ADR as its Top-Level Runtime Contract's
foundation: the contract's trust boundary (CORE-2) and role-binding precedence (CORE-1/CORE-3) both
presuppose that "the company" is durable on-disk state a provider-neutral trusted layer can reason
about — not whichever model happens to be running.

The desired jobs remain valid and are NOT what this ADR changes:

- Alpha as the smartest top-level architect and orchestrator.
- Beta as a judgment/decision system that approximates the operator's preferences.
- Epsilon/Gamma/Delta as mode conductors.
- Workers and reviewers as a company-like execution hierarchy.
- Model routing that moves work to Codex/Gemini/Claude/Antigravity intelligently.

## Options considered

1. **Option A — Durable state, ephemeral executors (chosen):** persist RoleSpec/StateCard/SprintRoom/
   ledgers/trackers/handoffs; treat every live model process as a leased, killable executor bound to
   that state by a role-identity triple (`role_id`/`provider`/`runtime`).
2. **Option B — Persistent live agent teams as the source of truth:** keep long-running in-process
   teammates as the durable seat of company state (closer to the pre-existing, unratified posture).
3. **Option C — Fully stateless, no persistence at all:** re-derive everything from chat/session
   context each run; no durable ledgers or trackers.

## Decision criteria

| Criterion | A: Durable state / ephemeral executors | B: Persistent live teams | C: Fully stateless |
|---|---|---|---|
| Reliability (survives a stalled/killed/reaped agent) | high | low | medium |
| Provider portability (any AI can sit at top-level) | high | low | low |
| False-green detectability | high (state is inspectable, provider-independent) | low (truth lives inside a live, opaque session) | low (nothing to inspect) |
| Token/context efficiency | high (scoped per WorkOrder) | low | medium |
| Migration cost from current MC | low (already de-facto true) | high (would require UNDOING existing ledger/tracker infra) | high (would require DELETING existing ledger/tracker infra) |

## Why this option won

Option A won because it is already the de-facto architecture (trackers, event logs, the dispatch
ledger, and decision records already persist independent of any session) — ratifying it costs
nothing and closes a real gap (an unratified but load-bearing assumption). Option B was rejected
because Doogle's own failure modes (stale worktrees, false liveness, missing completion records,
tracker drift) are DIRECT consequences of trusting a live process as truth; Option C was rejected
because a stateless company cannot detect false-green claims, cannot resume across sessions, and
cannot be provider-portable (every session would re-derive company state from whatever the current
model remembers, which is exactly the "chat memory" failure mode the plan's DoD (H-1) rules out).

## Risks

- More schemas and validators are required (RoleSpec, WorkOrder, ResultEnvelope, role-binding
  precedence) than a chat-memory-only posture would need.
- Some existing Claude-specific assumptions must be refactored to be provider-neutral (in progress —
  RATIFIED-PLAN Phase 2).
- The first implementation phase (kernel contract + trust boundary) is schema-heavy and less
  visually exciting than feature work — risk of the doctrine being treated as "done" once ratified
  even though its enforcement mechanism (Phase 4's trusted adapter) doesn't exist yet.
- Top-level portability requires a neutral Master Console or wrapper if the top-level AI is not
  Claude Code (packet-16's Level-3 runtime, not yet built for any helm).

## Mitigations

- The schema surface is being built incrementally and SEEDED, not all at once: this Phase-0 kernel
  work ships the minimal WorkOrder field set (D5) and role-binding precedence (D3) as seeds; the full
  WorkOrder/ResultEnvelope suite is explicitly Phase 3 (tracked: ED-217).
- Claude-specific refactors are RATIFIED-PLAN Phase 2's explicit scope (identity + host portability);
  this ADR does not claim they are done, only that the target architecture requires them.
- The "ratified but not yet enforced" risk is closed by making the gap NAMED, dated debt rather than
  silent: CORE-2 (provider-independent trusted layer) is registered non-waivable in the Top-Level
  Runtime Contract (§7) with its enforcement mechanism tracked as ED-215 (Phase-4 trusted adapter),
  never silently assumed complete.
- Master Console (Level 3) stays an explicitly-named long-term target (packet-16), not a Phase-0 or
  Phase-1 claim.

## Reversal plan

Reversing this decision means re-adopting Option B (persistent live teams as the seat of truth) or
Option C (fully stateless). The cost would be high: it would require dismantling the existing
tracker/event/ledger infrastructure this ADR ratifies as load-bearing, and reintroducing exactly the
failure modes (stale liveness, false-green claims, tracker drift) that motivated this ADR in the
first place. The signal that would trigger reversal: durable state itself becoming the unreliable
layer (e.g., the tracker/ledger infrastructure proving less trustworthy than a live session) — no
such signal exists today; the opposite has been observed (Doogle's live-session failures, not
ledger failures, drove this ADR).

## Policy appendix (packet-03, folded)

### Persistence policy

Live agents may persist only under LEASES — never as the seat of truth:

```text
one_shot: one WorkOrder, expires at ResultEnvelope
wave:     several related WorkOrders in one lane, checkpoint after each
phase:    conductor/reviewer/security/research role for one sprint phase
session:  top-level Alpha session, writes a handoff on end
```

Killing a live agent under any of these leases must lose convenience only, never truth. (RATIFIED-PLAN
H-2 flags this schema for later hardening — owner, TTL, renewal, atomic acquisition, fencing tokens —
at Phase 3, RATIFIED-PLAN G3.4; this ADR ratifies the FOUR lease kinds, not the hardened mechanics.)

### Reaper policy

Never reap a worker on process absence alone. A reaper must weigh ALL of:

- started event
- lease state
- heartbeat
- output growth
- ledger updates
- branch commits
- provider status
- elapsed time
- hard timeout
- ping/nudge attempts

(Ten signals total, per packet-03's original eight plus MC's live `hard timeout` and
`ping/nudge attempts` practice — process absence is deliberately NOT on this list as a sole trigger.)

### Role identity

Role identity is a provider-neutral TRIPLE, never a provider-specific identity string:

```text
role_id:  frontend-builder
provider: openai | claude | gemini | antigravity | future
runtime:  codex-cli | claude-code | gemini-cli | agy | api | wrapper
```

Provider and runtime can change without rewriting the role identity itself — this is the concrete
mechanism behind CORE-1/CORE-3's provider-neutral role-binding precedence (Top-Level Runtime
Contract §3) and D4's support-matrix rows.

### Non-decision

This ADR does not ban live Claude teams or in-process subagents (α/β/γ/δ/ε and the roster remain
exactly as specced). It demotes them from durable architecture to tactical runtime options — the
company's memory does not end when a contractor leaves.

## References

- `.claude/kernel/top-level-runtime-contract.md` (D1) — CORE-1/CORE-2/CORE-3 (§7) directly implement
  this ADR's durable-state/ephemeral-executor split.
- `.claude/kernel/role-binding.json` (D3) — the role-identity triple's binding precedence.
- `_planning/mc-1.0-plan/packet-original/03-ADR-DURABLE-COMPANY-EPHEMERAL-EXECUTORS.md` — the
  original packet source this ADR ratifies (folded, not verbatim-adopted — see decision criteria).
- `_planning/mc-1.0-plan/RATIFIED-PLAN.md` § Phase 0 — the ratifying plan.
- ADR-0017 (`0017-retention-contain-via-archive-over-atomic-delete.md`) — CORE-4's sibling ratification
  (archive-not-delete is durable-state discipline applied to logs specifically).
