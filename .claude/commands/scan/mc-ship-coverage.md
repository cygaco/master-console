---
description: Verify every framework-owned path under the consumer-essential roots is actually shipped (enumerated in framework-manifest.json) — catches "framework code that ships to nobody" (the B1/E3 downstream-broken class).
---

# /scan:mc-ship-coverage

Asserts that every framework-owned path the consumer install needs is actually a shipped manifest asset — the enforcer behind the recurring "downstream is missing X" class (a framework script/skill exists in canonical but was never enumerated in `framework-manifest.json`, so `install.ps1` / `/warp:setup` never copies it). 2026-05-30 reconcile surfaced two live instances this gate now covers: `scripts/package.json` (module-scope insulation, B1) and `scripts/bootstrap/`+`scripts/canon/` backing scripts (dead-skill class, E3).

`status: green` — every consumer-essential framework-owned path is enumerated + shipped.
`status: red` — a framework-owned path under a consumer-essential root is missing from the manifest; `remediation` names the path + the ASSET_DIRS/TOP_LEVEL entry to add in `scripts/generate-framework-manifest.js`.

```bash
node scripts/checks/mc-ship-coverage.js [--json]
```

Pairs with `/scan:mc-manifest-coverage` (ownership↔shipping reconciliation) and `/scan:mc-manifest-honesty` (installed-hash drift). Run as part of `/scan:full` Tier 3 (MC distribution integrity).
