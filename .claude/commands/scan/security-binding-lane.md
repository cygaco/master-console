---
description: The security-binding-lane enforcer — the security BINDING verdict must resolve to a verifiable provider, never agy, while served-model proof is open, plus catalog↔providers alias-inclusive DEFAULT_PROVIDER consistency. Blocking in /scan:full.
---

# /scan:security-binding-lane — Security binding verdict stays verifiable

The named enforcer for the security-binding and alias-consistency invariants. ADR-0031 requires the security-reviewer/redteam
**binding verdict** to resolve to a VERIFIABLE provider (openai|claude), never the unverifiable `agy`
lane, while served-model proof is open. The invariant otherwise rests only on agy being
blocked-advisory. This is its enforcer.

## What it does

Runs `node scripts/checks/security-binding-lane.js` (`--json`). **Two teeth**, reusing the runtime's OWN
functions so the check can't drift from behavior (assert-only — NO source
mutation, which would trip model-chain drift):

- **Tooth-A, enforced WHILE served-model proof is open** — the PANEL BINDING invariant (not
  `DEFAULT_PROVIDER ∈ {openai,claude}`):
  - **P1** `servedModelUnverifiableFromRecord("antigravity") === true` — the choke-point forcing an agy
    record un-attestable → BLOCKED_ON_OPERATOR, never a binding PASS.
  - **P2** the `panel-2family` FLOOR requires ≥2 verifiable families (agy not a required lane; `binding:false`).
  - **P3** `passesOf("security-reviewer")` has ≥1 verifiable (openai|claude) pass — a lane that CAN bind.
- **Tooth-B** — alias-inclusive DEFAULT_PROVIDER consistency (the gap model-chain's
  registry-NAME-only drift loop misses): `catalog-raw[redteam] === providers-raw[redteam]` AND
  `getProviderForRole(redteam) === getProviderForRole(security-reviewer)` (redteam is a 1-hop alias — it
  can never resolve to a divergent provider).

Plus a **single-pass creep-back guard** (defense-in-depth): RED if any non-test file references the
`dispatch-agent.js` transport + a security-reviewer/redteam role, UNLESS audited-allowlisted. Conservative-
by-construction (fail-closed on unrecognized callers); the allowlist is typed — `reference-only` entries are
content-qualified (a reference-only file that GAINS the spawn-args caller shape is FLAGGED, not file-wide
hidden), and a `tracked-caller` is suppressed ONLY while served-model proof is open (FLAGGED once it closes
— the mechanical re-open trigger). Catches literal/dynamic/bound-first/multi-line/template-literal forms;
exact-path exclusion (a spoof at `scripts/evil/dispatch-review.js` is scanned). Findings name the invariant, <!-- doc-ref-ignore: scripts/evil/dispatch-review.js is an adversarial ILLUSTRATION (the spoof path the creep-back guard is described as scanning), not a real dependency -->
the offending key, and the fix.

**HONEST CEILING.** This is a BEST-EFFORT STATIC scan,
NOT a complete guard. Its FUNDAMENTAL residual (the AST ceiling): a **dynamically-constructed** `dispatch-agent.js`
path or role string, a bound-first/multi-line caller **inside a reference-only file**, or a caller **outside
`scripts/`** (a `.claude` hook / `.md` skill that shells the transport) are NOT statically detectable. The
STRUCTURAL close is a **dispatch-time guard** that refuses a single-pass security-reviewer binding at the
runtime choke-point. The **PRIMARY** defense is the panel binding invariant
(P1∧P2∧P3, above), which is ground-truth-verified; the creep-back guard is defense-in-depth over a latent path that stays safe
while agy is blocked-advisory; the mechanical re-open trigger flags the tracked callers once served-model proof closes. Do NOT read the creep-back guard
as a complete single-pass guard.

### Served-model-proof setting (fail-closed)

The served-model-proof state is a product setting in the shipped support matrix
(`.claude/kernel/support-matrix.json`, row `agy-antigravity`): `served_model_proven` plus
`served_model_evidence_ref`. **Fail-closed:** an absent or unreadable matrix, no agy row, a
`served_model_proven` that is not exactly `true`, or a missing/empty evidence ref → **not proven →
strict-enforce** (exit 1 on a finding, NOT a suite-crashing exit 2). Tooth-A relaxes ONLY on
`served_model_proven: true` with a non-empty `served_model_evidence_ref`. A fresh install ships
`false`; a project that has proven the served model sets its own value. Relaxing does NOT authorize agy
binding — the panel gate still governs.

### Known limit (documented not fixed)

P1 is **name-specific** — `servedModelUnverifiableFromRecord` keys on `provider === "antigravity"`. A NEW
unverifiable provider, or an agy rename, would pass P1 green while the invariant ("no unverifiable provider
binds") is violated. A regression-lock comment marks the call site. Out of scope here; a property-based
un-verifiability check is the future close.

**Exit:** 0 clean · 1 findings · 2 fail-closed (the reuse modules cannot load; an absent or unreadable
support matrix resolves to strict-enforce).

Bite-test: `node scripts/checks/security-binding-lane.test.js` (incl. the setting absent / false / true and
the fail-closed vectors — true without evidence, non-boolean values, a proven other row, a missing row or
matrix).

## When to run

After any edit to the security-reviewer/redteam provider chain, the panel-2family floor, the
redteam alias, or when served-model-proof state changes. Part of `/scan:full`.
