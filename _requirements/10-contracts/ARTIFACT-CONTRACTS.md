# Artifact Contracts — v0.1 (the product-studio spine)

_The durable artifact/eval spine the whole product-studio
update is built on. **v0.1 is intentionally revisable** — defects found in use
feed back into these shapes before they harden._

Machine-readable schemas: `paths.contractsSchemas` (`schemas/contracts/*.schema.json`,
`$id` = `mc/contracts/<artifact>/v0.1`).
Validator: `paths.contractsValidator` (`scripts/contracts/validate-artifact.js`).
Proof corpus: `paths.contractsFixtures` + `paths.contractsValidatorTest`.

## 1. The chain

One discipline — **research → message → creative → iterate** — encoded as a chain of
artifacts. The unit of work is a *launch*, and the chain is how a launch is produced:

```
audience_dossier ─► message_brief ─►┬─► offer_brief ─────►┐
   (research)        (THE SPINE)     ├─► conversion_brief ─┼─► design_brief ─► build_spec ─► converting_artifact
                                     │                     │                                  (ad | advertorial | landing)
                                     └─────────────────────┘
```

Derivation is encoded two ways the validator can read mechanically:
- **The spine reference** — every downstream artifact carries
  `derived_from_message_brief` (the id of the `message_brief` it derives from).
  `audience_dossier` (upstream) and `message_brief` (the spine itself) do not.
- **`contract.consumers[]`** in each schema — the DAG of who feeds whom.

## 2. The spine

`message_brief` is **the central artifact**. The winning message. Marketing owns the
**market promise** here; Product owns the **product-verifiable claim** in `offer_brief`
(the claims boundary — they must not blur). Everything converging on a launch converges
on the `message_brief`.

## 3. Precedence model (v0.1)

Each artifact declares a **global integer `precedence`** in its `contract` block
(simplest primitive a gauntlet can evaluate deterministically — higher rank wins a
same-surface conflict; v0.1 has no pairwise/per-consumer ordering).
An instance may **override** its precedence
with a numeric `precedence` field (v0.1 flexibility). Within a chain the **effective
precedence ranks must be distinct** — the validator REJECTS duplicates, because two
artifacts sharing a rank make conflict-resolution non-deterministic (the deadlock the
"declare precedence" rule exists to prevent).

| Artifact | owner_domain | precedence | consumers | required (beyond `type`,`id`) |
|---|---|---:|---|---|
| `audience_dossier` | research_insight | 20 | message_brief | segment, sources, confidence, emotional_needs |
| `message_brief` ★spine | marketing | 50 | (all downstream) | audience_ref, core_message, proof_points, market_promise |
| `offer_brief` | product | 60 | conversion_brief, build_spec | derived_from_message_brief, product_verifiable_claim, offer_terms |
| `conversion_brief` | marketing | 40 | design_brief, converting_artifact | derived_from_message_brief, conversion_hypothesis, objections_handled |
| `design_brief` | design_quality | 30 | build_spec, converting_artifact | derived_from_message_brief, visual_hierarchy, mobile_requirements |
| `build_spec` | engineering | 70 | converting_artifact | derived_from_message_brief, components, acceptance_criteria |
| `converting_artifact` | marketing | 10 | — | derived_from_message_brief, artifact_kind(ad\|advertorial\|landing), copy_ref |

Ranks are a v0.1 starting point (`build_spec` highest = what's actually built is ground
truth; `converting_artifact` lowest = downstream output, not authority). **Revisable.**

## 4. Decision record (the oneshot α/β stand-in)

`decision_record` is NOT a chain artifact (`precedence: null`, excluded from the
distinct-rank check). It is the record an **enforcer emits without a human present** —
the oneshot stand-in for α/β judgment, read by the arbitration-needed resolver. It is
**shape-compatible** with `betaEvents` (shares `decision` / `owner` / `rationale` /
`confidence`) but a **distinct schema/file** — never the betaEvents file — preserving the
oneshot clean-room invariant (enforcers must not import the α/β machinery to emit a
record). Its `arbitration_needed: true`
flag is the **fail-closed** signal: contracts conflicted or confidence was low, so a
human/β must arbitrate.

## 5. The validator (fail-closed)

`paths.contractsValidator` validates a single artifact or a chain and **REJECTS
(exit 1) — never lints** — on: unknown artifact type; missing required field; type/const
mismatch; precedence conflict (duplicate effective rank); dangling `message_brief`
reference. A clean chain exits 0. Any **internal** error (missing schema dir,
unparseable input) is fail-closed (exit 2, never 0). This is the enforcer-first invariant
in miniature, and the shape the routing enforcer + failing tests are written against.

## 6. How the routing enforcer consumes this

The org map + per-domain routing enforcer is written against THESE shapes:
`contract.owner_domain` is the domain that owns each artifact (the routing target); the
fixtures in `paths.contractsFixtures` are its ready-made valid/invalid corpus.
