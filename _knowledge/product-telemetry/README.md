# Product Telemetry Knowledge Library

> Agent-grounding references for launch-stage product telemetry. These references keep analytics tied to product learning: activation, funnels, core actions, and verified chain integrity.

The founder-facing companion is `_guides/ANALYTICS_TELEMETRY_GUIDE.md`.

## Consumers

| Role | How it uses this library |
|---|---|
| `product-lead` | Defines activation and event vocabulary in build specs. |
| `qa-reviewer` | Checks traceability and integrity of telemetry against requirements and user flows. |
| `backend-reviewer` | Reviews event sink/code texture for drift, duplicate emitters, and broken exports. |

## References

| Ref | Rule IDs | Purpose |
|---|---|---|
| [PMF_EVENT_VOCABULARY](PMF_EVENT_VOCABULARY.md) | `TEL-EVT-*` | Name the minimum viable event chain for launch learning. |
| [ACTIVATION_AND_CHAIN_INTEGRITY](ACTIVATION_AND_CHAIN_INTEGRITY.md) | `TEL-CHAIN-*` | Keep activation and event transport honest end to end. |

## Wiring

Grounded by `<!-- knowledge:product-telemetry role:<role> -->` marker blocks in consumer specs and active rows in `.claude/project/maps/knowledge-integration.jsonl`.

*Last reviewed: 2026-06.*
