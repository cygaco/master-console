---
description: Open the in-app founder admin panel's guides sub-route in a browser, against a PRODUCT's running Next app (never MC itself). A thin one-row delegator to the canonical admin:preview harness with the /admin/guides sub-route.
user-invocable: true
namespace: admin
reads: [scripts/admin/preview.js, framework/admin-panel-registry.json]
writes: [.claude/runtime/admin-preview.json, runtime/admin-preview/instance/**]
---

# /admin:guides — open the founder panel's guides sub-route

Thin delegator. All boot/scaffold/ready-poll/browser-open logic lives in the
canonical keystone `scripts/admin/preview.js` (admin:preview). This opener carries
ZERO duplicated harness logic — it shells the keystone with the guides sub-route:

```bash
node scripts/admin/preview.js --route /admin/guides
```

The route arg threads straight through the delegation so the opened URL lands on
`http://localhost:<port>/admin/guides`. Run-in-product boundary: the preview
targets a PRODUCT's Next app, never MC itself — the keystone refuses the
MC canonical root as a precondition before any scaffold or boot.

See `/admin:preview` for the full harness behavior (cold-scaffold ETA, reuse-default
warm path, fail-clear preconditions, PREVIEW_URL emission for the Playwright lane).
