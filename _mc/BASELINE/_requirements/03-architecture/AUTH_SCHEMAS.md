# Pantry Pilot — Auth Schemas (Regen Spec)

Authentication and session management. Canonical auth primitives now live in `packages/shared/auth.ts` so legacy routes and the dedicated backend can share JWT, password, session, user, OAuth-state, cookie, origin, and scope behavior. Client-side encrypted session persistence remains in `src/lib/storage.ts`.

---

## JWT

### Payload Shape

```typescript
interface JWTPayload {
  sub: string; // User ID (UUID v4)
  iat: number; // Issued at (epoch seconds)
  exp: number; // Expires at (epoch seconds)
}
```

### Configuration

| Setting       | Value                                   |
| ------------- | --------------------------------------- |
| Algorithm     | HMAC-SHA256 (Web Crypto API)            |
| Header        | `{ alg: "HS256", typ: "JWT" }`          |
| Expiry        | 7 days (604,800 seconds)                |
| Secret source | `JWT_SECRET` env var; `JWT_SECRET_PREVIOUS` accepted for rotation |
| Min length    | 32 characters (enforced in production)  |
| Dev fallback  | Runtime-composed placeholder marker; production rejects fallback/short secrets |
| Encoding      | Base64URL (standard JWT format)         |

### Functions

- `signJWT(userId, ttlSec?)` — Creates and returns a signed JWT string
- `verifyJWT(token)` — Returns `JWTPayload | null` (null on invalid, expired, tampered, or current/previous key miss)

---

## Cookie

| Setting  | Value                    |
| -------- | ------------------------ |
| Name     | `pp_token` by default; `__Host-pp_token` when `PP_USE_HOST_COOKIE_PREFIX=true` |
| HttpOnly | `true`                   |
| Secure   | `true` in production     |
| SameSite | `Lax`                    |
| Path     | `/`                      |
| MaxAge   | 604,800 seconds (7 days) |
| Domain   | `.pantrypilot.example` by default via `PP_COOKIE_DOMAIN`; omitted in `__Host-` mode |

### Functions

- `buildAuthCookie(token, override?)` — Builds the JWT `Set-Cookie` header
- `buildClearAuthCookie(override?)` — Builds a clearing cookie for the current cookie mode
- `buildClearLegacyCookie()` — Clears the old no-domain Vercel cookie after rollback
- `parseAuthCookies(cookieHeader)` — Returns `{ current, legacy }` so legacy-only sessions can produce `AUTH_EXPIRED`

---

## Password Hashing

| Setting    | Value                                    |
| ---------- | ---------------------------------------- |
| Algorithm  | PBKDF2 (Web Crypto API)                  |
| Hash       | SHA-256                                  |
| Iterations | 100,000                                  |
| Key length | 256 bits                                 |
| Salt       | 16 random bytes (crypto.getRandomValues) |
| Output     | Base64-encoded hash + salt               |

### Functions

- `hashPassword(password)` — Returns `{ hash: string, salt: string }`
- `verifyPassword(password, storedHash, storedSalt)` — Returns `boolean`

---

## User Storage

### StoredUser Interface

```typescript
interface StoredUser {
  id: string; // UUID v4
  email: string; // Normalized (lowercase, trimmed)
  passwordHash?: string; // Optional for OAuth-only users
  passwordSalt?: string; // Optional for OAuth-only users
  oauthProviders?: string[]; // e.g. ["google", "apple"]
  tier?: UserAccount["tier"];
  usage?: UserAccount["usage"];
  createdAt: string; // ISO 8601 timestamp
}
```

### Storage Backend

- **Primary:** Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`)
- **Fallback:** In-memory `Map` (local dev without Redis)
- **Key format:** `user:{email}` (email lowercased)

### Functions

- `getUser(email)` — Returns `StoredUser | null`
- `getUserById(userId)` — Returns `StoredUser | null`
- `saveUser(user)` — Upserts user record

---

## Scope

Scopes are not embedded in JWTs. `getUserScope(userId)` reads from an authoritative admin record and caches `user` / `admin` scope for 30 seconds; `hasRequiredScope(actual, required)` performs ordered checks where `admin` satisfies `user`.

---

## Server-Side Sessions

| Setting    | Value                           |
| ---------- | ------------------------------- |
| TTL        | 30 days (2,592,000 seconds)     |
| Key format | `session:{userId}`              |
| Backend    | Same Redis / in-memory fallback |

### Functions

- `getServerSession(userId)` — Returns `Record<string, unknown> | null`
- `saveServerSession(userId, data)` — Stores session with TTL
- `clearServerSession(userId)` — Deletes session

---

## OAuth

### Supported Providers

| Provider | Env Vars                                   | UI Toggle Env                |
| -------- | ------------------------------------------ | ---------------------------- |
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `NEXT_PUBLIC_OAUTH_GOOGLE`   |
| Apple    | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`   | `NEXT_PUBLIC_OAUTH_APPLE`    |

OAuth buttons are hidden if the toggle env var is not set.

### Flow

1. **State generation:** `generateOAuthState()` returns `crypto.randomUUID()` for CSRF protection. **State tokens MUST be single-use.** After validation in the callback, delete the state from the cookie/store immediately. Reject any re-presented state token to prevent replay attacks.
2. **findOrCreateOAuthUser(email, provider):**
   - If user exists: links provider if not already linked, issues JWT
   - If user doesn't exist: creates new user (no password), calls `initFreePlanIfMissing(id)`, issues JWT
     > **Idempotency:** Free-plan quota initialization checks whether a balance already exists before crediting. This prevents double-crediting on OAuth callback retries.
   - In both cases: sets auth cookie, returns `{ id, email }`

> **Security:** OAuth callbacks MUST validate the redirect URL against ALLOWED_ORIGINS before issuing any redirect. Use `new URL(path, baseURL).href` to construct redirect URLs — never trust user-supplied redirect parameters.

### Email Normalization

All emails are lowercased and trimmed before lookup or storage.

---

## API Route Auth Patterns

### Protected Routes

Routes that require auth parse cookies with `parseAuthCookies()` and then call `verifyJWT()`:

| Route            | Auth Required | Notes                                        |
| ---------------- | ------------- | -------------------------------------------- |
| `/api/claude`    | No\*          | Rate-limited by IP; quota billing if authed  |
| `/api/recipes`   | No\*          | Rate-limited by IP                           |
| `/api/auth/*`    | Varies        | Login/register: no; logout/session: yes      |
| `/api/session`   | Yes           | Load/save/clear server session               |
| `/api/usage`     | Yes           | Quota queries                                |
| `/api/stripe/*`  | Varies        | Checkout: yes; webhook: Stripe signature     |
| `/api/extension` | No            | Public ZIP download                          |
| `/api/test`      | No            | Gated by `ENABLE_TEST_API` env               |

\*Claude and Recipes routes use quota billing when the user is authenticated, but allow anonymous usage with rate limits.

### Anti-Enumeration Rules

All auth error responses use generic messages to prevent user/account enumeration:

| Scenario                   | Response                                            | Status |
| -------------------------- | --------------------------------------------------- | ------ |
| Login — user not found     | "Invalid email or password"                         | 401    |
| Login — wrong password     | "Invalid email or password"                         | 401    |
| Login — OAuth-only account | "Invalid email or password"                         | 401    |
| Register — email exists    | "Registration failed. Please try again or sign in." | 400    |

The login route must NOT reveal whether an account exists, whether it's OAuth-only, or any other account metadata.

---

## Client-Side Session (src/lib/storage.ts)

### Encryption

| Setting    | Value                                      |
| ---------- | ------------------------------------------ |
| Algorithm  | AES-GCM (Web Crypto API)                   |
| Key source | Derived from static salt + device          |
| IV         | Random 12 bytes per encryption             |
| Storage    | `localStorage` key: `pantryPilot_session`  |

### Key Derivation and Persistence

The AES-GCM encryption key is derived via PBKDF2 from two inputs: a device fingerprint (user agent, screen size, timezone, etc.) and a random 16-byte salt stored in `localStorage` under `pantryPilot_cryptoSalt`. The salt is generated once and persists across sessions. If the salt is cleared (e.g., user clears localStorage), a new salt is generated and all previously encrypted session data becomes unreadable -- this is acceptable as sessions are ephemeral and can be re-created from server-side session storage if authenticated.

### Persistence Strategy

- **Save:** Encrypt → localStorage (always). If authenticated → POST `/api/session` (fire-and-forget)
- **Load:** Read localStorage first, then authenticated Redis. Return Redis unless local `lastUpdated` is newer.
- **Size limit:** 5MB max (server rejects larger)

### Schema Version and Step Encoding

- `schemaVersion` is currently `1` and is stamped on every save.
- `currentStep` / `maxStep` accept both shipped numeric values and future `Step` enum strings.
- The numeric-to-enum migration exists behind `STEP_MIGRATION_V2 = false`; do not enable it until routing no longer compares numeric steps.
