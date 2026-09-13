# Tooling Audit Report

**Date:** 2026-03-30
**Scripts:** 10 main + 13 hooks (all present)
**Configs:** 6 checked (tsconfig, next.config, playwright, postcss, package.json, .env.local.example)

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 4 |
| LOW | 0 |

## Agent Risk Assessment

Tooling is production-ready. All 3 linters pass clean (344 stories, 0 errors). Build passes. TypeScript strict mode enabled. Security headers comprehensive. One HIGH: `NEXT_PUBLIC_APP_URL` is required for OAuth but undocumented — OAuth callbacks will fail silently without it.

## Findings

| # | Severity | Finding | Location | Fix |
|---|---|---|---|---|
| 1 | HIGH | `NEXT_PUBLIC_APP_URL` used in OAuth callbacks but missing from .env.local.example and CLAUDE.md | OAuth routes + .env config | Add to .env.local.example with description |
| 2 | MEDIUM | `ADMIN_SECRET` used by /api/usage/grant but undocumented | .env.local.example | Add to env example |
| 3 | MEDIUM | Stripe fallback price ID names (STARTER/PRO) undocumented — differ from primary names (PLUS/FAMILY) | stripe/checkout route | Document fallbacks or use primary names only |
| 4 | MEDIUM | /protected/prompts/ directory exists but is empty — intended prompt isolation not implemented | protected/prompts/ | Populate or remove |
| 5 | MEDIUM | Playwright browsers not installed note missing from docs | playwright.config.ts | Add `npx playwright install` to CLAUDE.md dev setup |

### Passing Checks

- All 14 package.json scripts reference real files and execute correctly
- All 3 lint scripts (PRDs, HL stories, granular stories) pass with 0 errors
- tsconfig.json: strict mode, correct paths, React 19 compatible
- next.config.ts: comprehensive security headers (CSP, HSTS, X-Frame-Options, etc.)
- playwright.config.ts: correct test dir, parallel execution, CI retries
- postcss.config.mjs: minimal, correct for Tailwind v4
- `npm run build` passes clean (22 routes, 0 TS errors)

## Top 5 Actions Before Next Run

1. **Document NEXT_PUBLIC_APP_URL** in .env.local.example and CLAUDE.md — blocks OAuth (1 finding)
2. **Document ADMIN_SECRET** in .env.local.example (1 finding)
3. **Standardize Stripe price ID names** — document or eliminate fallback names (1 finding)
4. **Decide on /protected/prompts/** — populate or remove empty directory (1 finding)
5. **Add Playwright install note** to CLAUDE.md Dev Commands section (1 finding)
