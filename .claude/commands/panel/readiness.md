---
description: Open the cross-product launch-readiness board. A thin /panel:* forwarder to the canonical /cockpit:readiness opener — carries ZERO duplicated logic, just the unified `panel:` entry verb.
user-invocable: true
namespace: panel
reads: [framework/panel-registry.json, .claude/commands/cockpit/readiness.md]
---

# /panel:readiness — forward to the launch-readiness board

Thin forwarder. The panel registry (`framework/panel-registry.json`) row `readiness`
names the canonical opener; this skill carries **zero** duplicated logic — it delegates:

**Invoke `/cockpit:readiness`** — the canonical cross-product launch-readiness board.

All board logic (composite %, blocked items, owner-action work) lives in `/cockpit:readiness`;
`/panel:readiness` is only the unified `panel:` entry verb for it. See `/panel:list` for every panel.
