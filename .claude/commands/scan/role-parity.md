---
description: The one check that owns role parity across the org map, the dispatch catalog, and team-guard — fail-closed enforcer so repartitioning agents by domain can't silently drift the registry.
---

# /scan:role-parity — Org-map ↔ dispatch-registry parity

The single source-of-truth check for the role universe, per the
rule **"one manifest/check owns role parity"** (repartitioning by domain creates registry
drift otherwise). It is the **enforcer-first** guard:
as each new role is declared/built, this keeps the org map, the
dispatch catalog, and the team-guard gate in sync.

## What it does

Reads three sources **live** (never hardcoded copies):
- `.claude/agents/_org/org-map.json` — the role universe (domains → directors/
  leads/specialists/builders; gauntlets; routing).
- `scripts/dispatch/catalog.js#ROLES` — the dispatch role registry (required).
- `scripts/hooks/team-guard.js` `GAMMA_ONLY_TYPES` — the build-chain gate (statically
  parsed — team-guard runs on `require`, so it is never required).

REJECTS (exit 1), never lints, when ANY:
1. an org-map domain role marked **built** (`agent` != null) names an agent that doesn't
   resolve to a real spec under `.claude/agents/`;
2. a gauntlet member (`gauntlets.*.members[]`) isn't a real dispatch role (∉ catalog ROLES);
3. a `routing.*.owner_role` isn't defined in the org map (∉ domain roles ∪ gauntlet
   authorities ∪ `enforcer`);
4. a **doer** role in the dispatch catalog (not orchestrator/system) is **ungoverned** —
   not a gauntlet member, not an org-map domain role, and not on the explicit TRANSITIONAL
   allowlist (the drift this check exists to catch);
5. an org-map built build-chain doer role is absent from `GAMMA_ONLY_TYPES` (α could
   dispatch it directly — a gate hole).

Internal error → exit 2 (fail-closed — a scan that errors must never read as pass).

```
node scripts/checks/role-parity-scan.js [--json]
```

## On a finding

- **Ungoverned doer role (#4)** → add the role to a gauntlet or a domain in `org-map.json`,
  or (if mid-migration) to the documented `TRANSITIONAL` allowlist in the scan with a note.
- **Built agent doesn't resolve (#1)** → either the agent spec is missing (build it) or the
  org map prematurely set `agent` (set it back to `null` = pending).
- **Gate hole (#5)** → add the built build-chain role to `team-guard.js` `GAMMA_ONLY_TYPES`.
- **Undefined owner_role (#3) / ghost gauntlet member (#2)** → fix the typo or define the role.

## Pairs with

- `scripts/checks/role-parity.test.js` — the bite-test proving the scan rejects each class.
- `scripts/checks/dispatch-routing-parity.js` — the sibling check on role→**provider**
  routing (this check owns the role→**domain/governance** universe).
- `scripts/checks/domain-routing-scan.js` — validates artifact `owner_domain` routing.
