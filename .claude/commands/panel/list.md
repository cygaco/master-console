---
description: List every registered panel — the one discoverable entry for "show me a panel". Enumerates framework/panel-registry.json (name, description, run_context, opener) so you don't have to remember which namespace each panel lives under.
user-invocable: true
namespace: panel
reads: [framework/panel-registry.json, scripts/panel/list.js]
---

# /panel:list — enumerate the available panels

The unified discovery surface for the `panel:` verb. Thin skill — it shells the backing
enumerator, which reads the SINGLE source of truth (`framework/panel-registry.json`) and lists
every panel with its description, run-context, and the canonical opener it forwards to:

```bash
node scripts/panel/list.js
```

Add `--json` for a machine-readable list. Each listed panel is openable as `/panel:<name>`
(e.g. `/panel:readiness`, `/panel:models`, `/panel:admin`, `/panel:roadmap`) — a thin forwarder
to that panel's canonical opener. Adding a panel is a single row in the registry; this enumerator
and the forwarders both read it, so the list never drifts from reality.

If the registry is missing or malformed, this fails **soft** — a clear "panel registry unavailable"
message and a non-zero exit, never a stack trace.
