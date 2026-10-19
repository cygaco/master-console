---
description: Assert the role→provider routing tables agree across providers.js, catalog.js, and the dispatch guide — fails if any role is routed inconsistently or a non-Claude role is undocumented.
---

# /scan:dispatch-routing-parity

Runs the routing-parity enforcer:

```bash
node scripts/checks/dispatch-routing-parity.js
```

Compares the role→provider map in three sources that must agree:
- `DEFAULT_AGENT_PROVIDERS` in `scripts/hooks/lib/providers.js` (source of truth),
- `DEFAULT_PROVIDER_PER_ROLE` in `scripts/dispatch/catalog.js`,
- the **Role → provider routing** table in `paths.agentDispatchGuide`.

Exits 1 on any role routed inconsistently, or any non-Claude role routed in code
but absent from the doc table. `--json` for programmatic consumption.

Closes the doc-vs-code routing-drift class. Wire into `/scan:full`.
