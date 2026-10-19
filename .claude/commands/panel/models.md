---
description: Open the model router — the Dispatch Console GUI (role → provider → model → effort). A thin /panel:* forwarder to the canonical /models:router opener — ZERO duplicated logic.
user-invocable: true
namespace: panel
reads: [framework/panel-registry.json, .claude/commands/models/router.md]
---

# /panel:models — forward to the model router / Dispatch Console

Thin forwarder. The panel registry (`framework/panel-registry.json`) row `models` names the
canonical opener; this skill carries **zero** duplicated logic — it delegates:

**Invoke `/models:router`** — the canonical Dispatch Console GUI.

All routing/catalog logic lives in `/models:router`; `/panel:models` is only the unified
`panel:` entry verb for it. See `/panel:list` for every panel.
