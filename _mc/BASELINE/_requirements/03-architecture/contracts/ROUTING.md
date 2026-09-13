<!-- generated 2026-04-30 by Phase 3G — keep `id` and section names stable, edit content freely -->
# Contract: ROUTING

- **id:** ROUTING
- **owner:** backend
- **introducedIn:** 2026-04-30
- **status:** active
- **version:** 2.0.0
- **changeType:** major
- **used by:** auth, backend, frontend, extension

> **2.0.0 (breaking, 2026-05-04):** shape rewritten from generic `Route` TS interface to product-specific Vercel / Next.js rewrite config — reflects actual Pantry Pilot routing surface promoted into canonical at v0.2.0. Consumers that depended on the framework-template `Route` interface must adopt the rewrite-config shape.

## 1. Shape

```json
// Vercel / Next.js rewrite configuration shape
{
  "source": "/api/:path*",
  "destination": "https://pantrypilot-backend.fly.dev/api/:path*",
  "headers": [
    { "key": "X-Forwarded-Host", "value": "pantrypilot.example" }
  ]
}
```

## 2. Producers

- `next.config.ts` (Next.js rewrites config)
- `vercel.json` (Vercel routing fallback)
- `fly.toml` (Fly.io ingress setup)

## 3. Consumers

- `src/lib/api.ts` (frontend fetch client utilizing relative `/api` paths)
- `extension/background.js` (browser extension API calls)

## 4. Breaking changes

- Removing the rewrite that bridges Next.js App Router and the Fly.io backend
- Dropping CORS configuration on Fly.io that expects `X-Forwarded-Host`
- Changing the destination domain before the final production cutover is complete
- Stripping query parameters or trailing slashes during the rewrite phase

## 5. Required tests

- Network-level E2E routing verification: frontend → proxy → backend
- Proper forwarding of apex `__Host-` cookies across the proxy boundary
- HTTP status code passthrough (proxy doesn't swallow 4xx / 5xx)

## 6. Drift gate

- `next.config.ts`
- `vercel.json`
- `fly.toml`

## 7. Versioning and compatibility

- Patch: label or documentation change only.
- Minor: additive route with safe default navigation.
- Major: rewrite, destination domain, CORS, cookie forwarding, or extension API route semantics change.
- On any version bump, notify: auth, backend, frontend, extension.
