---
description: Open a product's in-app founder admin panel in the browser (run-in-product, never MC itself). A thin /panel:* forwarder to the canonical admin:preview opener — ZERO duplicated logic.
user-invocable: true
namespace: panel
reads: [framework/panel-registry.json, scripts/admin/preview.js]
---

# /panel:admin — forward to the founder admin panel

Thin forwarder. The panel registry (`framework/panel-registry.json`) row `admin` names the
canonical opener; this skill carries **zero** duplicated logic — it delegates by shelling the
keystone harness:

```bash
node scripts/admin/preview.js
```

**Run-in-product boundary:** the preview targets a PRODUCT's Next app, **never** MC itself —
the keystone (`scripts/admin/preview.js`) owns that refusal as an asserted precondition. See
`/admin:preview` for full harness behavior (cold-scaffold ETA, reuse-default warm path,
fail-clear preconditions), and `/panel:list` for every panel.
