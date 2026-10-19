# Admin Tooling Knowledge Library

> Agent-grounding references for small pre-PMF admin surfaces. The goal is a protected founder control room, not an internal enterprise product.

The founder-facing companion is `_guides/ADMIN_TOOLING_GUIDE.md`.

## Consumers

| Role | How it uses this library |
|---|---|
| `product-lead` | Scopes admin requirements to support, learning, and safety. |
| `backend-builder` | Builds server-side access checks, audit trails, and minimal admin APIs. |
| `security-reviewer` | Reviews privileged surfaces for access-control and abuse risks. |
| `qa-reviewer` | Checks traceability/integrity for admin actions, audit evidence, and normal-user denial. |

## References

| Ref | Rule IDs | Purpose |
|---|---|---|
| [PRE_PMF_ADMIN_SURFACE](PRE_PMF_ADMIN_SURFACE.md) | `ADMIN-SCOPE-*` | Keep admin useful, small, and product-stage appropriate. |
| [ADMIN_SECURITY_AND_AUDIT](ADMIN_SECURITY_AND_AUDIT.md) | `ADMIN-SEC-*` | Enforce access control, audit logging, and destructive-action guardrails. |

## Wiring

Grounded by `<!-- knowledge:admin-tooling role:<role> -->` marker blocks in consumer specs and active rows in `.claude/project/maps/knowledge-integration.jsonl`.

*Last reviewed: 2026-06.*
