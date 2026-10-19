---
description: App structure — routes, components, libs, how they connect
---

# /maps:architecture — Architecture Map

Visualize the application structure: API routes, page components, library modules, and their connections.

## Input

`$ARGUMENTS` — optional flags:
- `--refresh` — re-scan src/ and rebuild the architecture map
- `--terminal` — render as ASCII art (default)
- `--file` — write to `.claude/project/maps/architecture.txt`
- `--html` — write styled HTML to `.claude/project/maps/architecture.html`

## Procedure

### Step 1: Scan directories

- `src/app/` — routes: every `page.tsx` (e.g. `/`, `/auth`, `/account`, `/admin`), route handlers (`route.ts`, e.g. `auth/callback`) and server actions (`actions.ts`)
- `src/components/` — feature components (e.g. `composer/`)
- `src/components/ui/` — atomic UI primitives (e.g. button, card, dialog, input)
- `src/hooks/` — React hooks
- `src/lib/` — core modules (e.g. `supabase/`, `telemetry/`, `admin/`, `readiness/`)
- `src/middleware.ts` — request middleware, if present

### Step 2: Map connections

- Which components import which lib modules
- Which API routes use which lib modules
- Which components each page renders
- Client → server calls (fetch calls to route handlers, server actions)

### Step 3: Render

Layered architecture:

```
┌─── Routes (src/app) ───────────────────┐
│ /  /auth  /account  /admin  ...        │
├─── Components ─────────────────────────┤
│ composer/*  ...                        │
├─── UI ─────────────────────────────────┤
│ button  card  dialog  input  ...       │
├─── Hooks + Lib ────────────────────────┤
│ hooks/*  supabase  telemetry  admin    │
├─── Server (handlers + actions) ────────┤
│ auth/callback  admin/actions  ...      │
└────────────────────────────────────────┘
```
