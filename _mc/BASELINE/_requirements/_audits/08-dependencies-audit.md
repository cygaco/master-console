# Dependencies Audit Report

**Date:** 2026-03-30
**Framework:** Next.js 16.2.1 | React 19.2.3 | TypeScript 5.9.3
**Dependencies:** 14 runtime + 8 dev

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 3 |
| HIGH | 0 |
| MEDIUM | 1 |
| LOW | 3 |

## Agent Risk Assessment

Zero npm audit vulnerabilities — security posture is clean. Three unused packages (@stripe/stripe-js, @vercel/analytics, pdfjs-dist) add ~1.4MB bundle bloat and attack surface for no benefit. All licenses are permissive (MIT/Apache-2.0). Framework versions match CLAUDE.md spec.

## Findings

### Unused Dependencies (Remove)

| # | Severity | Package | Evidence | Fix |
|---|---|---|---|---|
| 1 | CRITICAL | @stripe/stripe-js (8.11.0) | 0 imports in src/ — Stripe server SDK used instead | `npm uninstall @stripe/stripe-js` (saves ~50KB gzipped) |
| 2 | CRITICAL | @vercel/analytics (2.0.1) | 0 imports in src/ — no analytics implemented | `npm uninstall @vercel/analytics` (saves ~15KB gzipped) |
| 3 | CRITICAL | pdfjs-dist (5.5.207) | 0 imports in src/ — only jspdf (generation) used, not viewing | `npm uninstall pdfjs-dist` (saves ~300KB gzipped) |

### Version Status

| # | Severity | Package | Current | Latest | Fix |
|---|---|---|---|---|---|
| 4 | LOW | react + react-dom | 19.2.3 | 19.2.4 | Patch update: `npm update react react-dom` |
| 5 | LOW | stripe | 20.4.1 | 21.0.1 | Major — evaluate changelog before upgrading |
| 6 | LOW | lucide-react | 0.577.0 | 1.7.0 | Major — only 3 imports; evaluate necessity |
| 7 | MEDIUM | CLAUDE.md says "16.2.0" but actual is 16.2.1 | Minor semver drift | Update CLAUDE.md to reflect actual |

### Security & Licenses

| Check | Status |
|---|---|
| npm audit | 0 vulnerabilities |
| GPL/AGPL licenses | None (jszip is dual MIT/GPL, using MIT) |
| Peer dependency conflicts | None |
| Duplicate packages | None |
| JWT/crypto | Web Crypto API (no external lib) |
| Security-critical packages current | @upstash/redis, @upstash/ratelimit both current |

## Top 5 Actions Before Next Run

1. **Remove @stripe/stripe-js** — unused, adds bundle bloat (1 finding)
2. **Remove @vercel/analytics** — unused, no analytics implemented (1 finding)
3. **Remove pdfjs-dist** — unused, largest unnecessary dependency at ~1.3MB (1 finding)
4. **Update react + react-dom to 19.2.4** — safe patch update (1 finding)
5. **Evaluate stripe 21.0.1 upgrade** — check changelog for breaking changes (1 finding)
