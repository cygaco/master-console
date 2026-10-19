# Tech-Stack Selection Knowledge Library

> Agent-grounding references for pre-PMF stack choices. This library helps Product and Backend roles choose boring, reversible infrastructure instead of overbuilding or silently locking a product into the wrong provider.

This is not a launch guide. The founder-facing companion is `_guides/DATABASE_GUIDE.md`, `_guides/AUTH_GUIDE.md`, and `_guides/DEPLOYMENT_INFRA_GUIDE.md`.

## Consumers

| Role | How it uses this library |
|---|---|
| `product-lead` | Writes build specs that declare the stack decision, its rationale, and pivot/reversibility constraints. |
| `backend-builder` | Implements against the declared stack without adding duplicate providers or hidden lock-in. |
| `backend-reviewer` | Reviews backend code for provider drift, duplicate persistence/auth layers, and irreversible choices not justified by the spec. |

## References

| Ref | Rule IDs | Purpose |
|---|---|---|
| [BAAS_DECISION_MATRIX](BAAS_DECISION_MATRIX.md) | `STACK-BAAS-*` | Choose Supabase/Neon/Firebase/SQLite/existing stack with pre-PMF defaults. |
| [STACK_DRIFT_AND_REVERSIBILITY](STACK_DRIFT_AND_REVERSIBILITY.md) | `STACK-REV-*` | Keep the choice explicit, reversible, and single-sourced. |
| [MOBILE_DEV_LOOP_ON_WINDOWS](MOBILE_DEV_LOOP_ON_WINDOWS.md) | `STACK-WINMOB-*` | Keep mobile products testable from a Windows PC; the honest iOS-without-a-Mac path. |

## Wiring

Grounded by `<!-- knowledge:tech-stack-selection role:<role> -->` marker blocks in each consumer spec and active rows in `.claude/project/maps/knowledge-integration.jsonl`.

*Last reviewed: 2026-06.*
