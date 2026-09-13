---
description: Verify version + schema-label coherence — product version agrees across ALL manifests (incl. the ones version-quorum misses) and every schema family carries a single consistent version label. Catches the 0.10.0→0.11.0 lag + paths-v4-on-v5-content drift classes.
---

# /scan:version-coherence

The enforcer born from the 2026-05-30 version audit, which found two drift classes **no existing gate caught**:

1. **Product-version lag** — `.claude/manifest.json#warpos.version` stayed `0.10.0` after the `0.11.0` release, because `/scan:warpos-version-quorum` only checks 4 sources (version.json, framework-manifest, framework-installed, install.ps1 header) — **not** `manifest.warpos.version` or install.ps1's `$Script:WARPOS_VERSION` fallback constant.
2. **Schema-label divergence** — `paths.json` carried v5 *content* (`_requirements/` + 6 root keys) but a **v4 label** (`framework/paths.registry.json#version` was never bumped), and a stale `framework-manifest/v1` fallback lingered while everything else was v2.

## What it checks

- **A. Product-version quorum (extended):** `version.json#version` (truth) === `.claude/manifest.json#warpos.version` === `.claude/framework-manifest.json#version` === `.claude/framework-installed.json#installedVersion` === `install.ps1 $Script:WARPOS_VERSION`.
- **B. Schema-label coherence (authoritative declarations):** the paths family (`framework/paths.registry.json#version` → derived `mc/paths/vN` === `.claude/paths.json#$schema` === `schemas/paths.schema.json#$id`+`const` === `version.json#pathRegistrySchema` === `framework-installed#pathRegistryVersion`); and `version.json#frameworkManifestSchema` === `.claude/framework-manifest.json#$schema`.
- **C. Broad sweep:** any `mc/<family>/vN` schema family carrying >1 distinct version across operational tracked files (excludes migrations/, fixtures/, release capsules, test files, the accept-list validator, and docs — which legitimately name historical versions).

`status: green` — all agree. `status: red` — drift found; each finding names the file + the disagreeing values.

```bash
node scripts/checks/version-coherence.js [--json]
```

Wired into `/scan:full` Tier 3 **and** `scripts/mc/release-gates.js` (`version_coherence` gate — RED blocks a release). The release engine (`release-canonical.js`) now bumps `manifest.mc.version` + install.ps1's constant so a release can't re-introduce the lag. Pairs with `/scan:mc-version-quorum` (the narrower 4-source check this supersets).
