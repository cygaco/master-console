---
description: Open/preview a PRODUCT's in-app founder admin panel in the browser. Scaffolds (or reuses) a fixed throwaway Next instance, boots `npm run dev`, waits for the real ready line + parses the actual port, then opens `/admin`. The keystone of the admin:* dev-tooling suite — never targets MC itself.
user-invocable: true
namespace: admin
reads: [scripts/admin/preview.js, framework/admin-panel-registry.json]
writes: [.claude/runtime/admin-preview.json, runtime/admin-preview/instance/**]
---

# /admin:preview — open the in-app founder admin panel

Boots a product's founder admin panel and opens it in your browser. This is a
**dev-tooling** harness (a skill that runs a Next dev server + opens a tab), not
product code.

## What it does

`node scripts/admin/preview.js [--route <subroute>] [--force] [--instance-dir <dir>] [--json]`

1. **Refuses MC as a target FIRST.** Before any scaffold or boot it runs
   `refuseIfTargetIsMC(targetDir)` — if the resolved instance dir is the
   MC canonical tree (path match, OR a canonical signal via the shared,
   env-immune resolver `scripts/mc/repo-role.js#isCanonicalDir`:
   `_mc/MANIFEST.json` / `mc.source === "self"` / `project.slug === "mc"`
   / `version.json#name` — a consumer's own `mc:` install-record block with
   `source != "self"` is NOT a signal) it refuses with a non-zero exit and **no
   side effects**. admin:preview targets a PRODUCT app. (ED-009 single-source.)
2. **Reuse-default.** If the fixed throwaway instance
   (`runtime/admin-preview/instance/`) already has a `package.json` and you did
   not pass `--force`, it is **reused** — no re-scaffold, no second `npm install`.
   On a cold run it prints an **upfront ETA banner** (~30-90s incl. install) and
   scaffolds via the proven `scaffoldProductApp()` callable.
3. **Boots `npm run dev` (non-detached), polls the captured stdout for the ready
   line, and parses the ACTUAL port** (Next self-heals a busy port — the port is
   never hardcoded). The browser opens **only after** ready+port. A 90s timeout
   kills the child, fails clear ("dev server not ready… port busy/build error"),
   and exits non-zero — never an orphaned dev server, never open-then-hope.
4. **Writes the single instance pointer** `.claude/runtime/admin-preview.json`
   (this script is its SOLE writer; `/admin:seed` READS it only) atomically, then
   opens `http://localhost:<port>/admin`.

## Run-in-product — NEVER MC

Every admin opener targets a **product's** Next app, never MC canonical. The
default instance is a fixed throwaway product app under `runtime/`. The
`refuseIfTargetIsMC` precondition is the hard guard — do not point
`--instance-dir` at the MC root.

## Sub-routes

`/admin:readiness` and `/admin:guides` are **thin delegators** that call this same
harness with `--route /admin/readiness` (resp. `/admin/guides`). All boot/scaffold
logic lives here; the openers add zero duplication.

## Playwright-lane handoff

On a successful boot the harness prints a stable, machine-readable line:

```
PREVIEW_URL=http://localhost:<port>/admin
```

The deferred design-quality / visual-review **Playwright lane** greps this line to
target the running Next app (e.g. `playwright` navigates to the captured URL). This
sprint only **emits + documents** the handoff — the blocking design-quality flip
stays deferred / operator-gated and is NOT enabled here.
