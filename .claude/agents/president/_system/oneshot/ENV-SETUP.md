# Environment Variables — Plain English Guide

Every env var the shipped app scaffold names in its `.env.local.example` (`_mc/templates/app-scaffold`), what it
does, and what happens if you skip it. Copy the file to `.env.local` (`.env*.local` is gitignored) and fill in
what your product needs. A product adds its own keys as its features need them.

---

## App

### `NEXT_PUBLIC_APP_NAME`

**What it does:** The public app name, safe to expose to the browser. The scaffold sets it to the product slug.

---

## Analytics (optional)

### `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST`

**What they do:** The key turns on the scaffold's PostHog telemetry sink, which sends events through the page's
`window.posthog` client. The host is named for that client's setup; the scaffold does not read it.

**If the key is missing:** The telemetry seam no-ops: events are tracked through the same calls, but nothing is sent.

---

## Admin gate

The `/admin` pages are gated to founder emails. In production the gate requires a signed admin session cookie.

### `ADMIN_FOUNDER_EMAILS`

**What it does:** The allowlist of founder emails that may open the admin pages.

### `ADMIN_SESSION_SECRET`

**What it does:** Signs the admin session cookie. Use a high-entropy value (at least 32 random bytes, e.g.
`openssl rand -base64 32`); a weak or guessable secret defeats the gate.

**If missing:** No admin session can be signed or verified, so the signed-cookie path stays closed.

### `ADMIN_SESSION_COOKIE`

**What it does:** The admin session cookie's name. Defaults to `mc_admin_session`.

### `ADMIN_SESSION_VERSION`

**What it does:** A revocation lever. Bump it to invalidate every issued admin session at once (for example
after a suspected leak). Defaults to `1`. Sessions also expire after 7 days.

### `ADMIN_DEV_EMAIL`

**What it does:** Outside production only, treats this email as the signed-in admin so you can work on the
admin pages locally. Ignored in production.

---

## Auth — Supabase, passwordless

### `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**What they do:** Configure the Supabase auth seam (the sign-in page, the auth callback and the session
middleware). The anon key is the dashboard "publishable" key and is safe in the client.

**If missing:** The auth seam no-ops: the client factories return null, and the app still builds and runs.

### `SUPABASE_SERVICE_ROLE_KEY`

The dashboard "secret" key. Server-only. Named for the product's own server code; the scaffold does not read it.

### `SUPABASE_ACCESS_TOKEN`

A Supabase Management API token. Never commit it. The scaffold does not read it.

### `SUPABASE_DB_URL`

**What it does:** Puts `npm run verify:auth` into live mode, where it proves the password hard-block trigger
is installed in the database.

**If missing:** The verifier runs in static mode: it checks the migration's definition and, by design,
exits non-zero, because a valid definition is not proof of installation.

### `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET`, `RESEND_API_KEY`

Named for the auth provider setup (Google sign-in, email delivery). The scaffold does not read them.

---

## Voice input (optional)

### `NEXT_PUBLIC_TRANSCRIBE_URL`

**What it does:** Names the endpoint to pass to the input composer's `transcribeUrl` prop when voice input is
enabled; the scaffold code does not read the variable itself. This is a documented seam only: the transcription route itself is product-owned and not shipped by the scaffold.
With voice off (the default), the composer uses the browser's Web Speech API and needs no server.

**Before you enable it:** the endpoint receives an unauthenticated POST, so your route must enforce rate
limiting, a provider-spend cap and a body-size and audio-duration cap, and must fail closed. The scaffold's
`.env.local.example` spells this out.
