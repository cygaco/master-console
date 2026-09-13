# Fly.io — Backend Hosting

**Sources:**
- https://fly.io/docs/
- https://fly.io/docs/reference/configuration/
- https://fly.io/docs/apps/processes/

Last verified: 2026-04-28.

## What runs on Fly

The Pantry Pilot backend (`services/backend/`) — a Hono app + Graphile Worker on a single Docker image, two process groups.

## Where wired

| Site | File | Purpose |
|---|---|---|
| App config | `services/backend/fly.toml` | Process groups, VM sizing, health checks, lifecycle |
| Build image | `services/backend/docker/Dockerfile.nginx` | Nginx sidecar terminating Cloudflare AOP mTLS + Hono on localhost:3000 |
| Bare image | `services/backend/docker/Dockerfile` | Local dev / CI smoke without AOP |
| Drain handler | `services/backend/src/drain.ts` | SIGTERM handler — checkpoints in-flight Claude chains to Postgres before exit |
| CI | `.github/workflows/backend.yml` | Deploys on push to main (line 152: `flyctl deploy`) |
| CI lint | `scripts/check-fly-toml.js` | Rejects PRs that drop critical kill_timeout/kill_signal/auto_stop keys |

## Apps

| App | Purpose |
|---|---|
| `pantrypilot-backend` | Production (region: `iad`) |
| `pantrypilot-backend-staging` | Staging (currently main-only deploys per workflow line 22) |
| `pantrypilot-backend-pr-<N>` (planned) | Per-PR review apps via `.github/workflows/fly-review.yml` (user-data plan Phase 2) |

## Process groups

```toml
[processes]
  api    = "node services/backend/dist/api.js"
  worker = "node services/backend/dist/worker.js"
```

| Group | Public? | Auto-stop | Purpose |
|---|---|---|---|
| `api` | Yes (443 via Nginx mTLS) | Yes (idle) | Public HTTP — proxied by Cloudflare AOP |
| `worker` | No (Flycast only) | **No — must stay warm** | QStash pushes; stopping mid-chain orphans the job |

## Critical fly.toml keys (DO NOT DROP)

Per GS-BK-33 + PRD §8.14, the CI lint script `scripts/check-fly-toml.js` enforces these:

| Key | Value | Why |
|---|---|---|
| `kill_timeout` | `300` | SIGTERM drain handler needs time to checkpoint in-flight Claude chains |
| `kill_signal` | `"SIGTERM"` | Fly's default is SIGINT which `@hono/node-server` does not handle |
| Worker `auto_stop_machines` | `false` | Stopping mid-chain orphans the job — QStash redelivery hits cold start, retry budget exhausted |
| Worker `min_machines_running` | `1` | Must be warm for QStash pushes |

## VM sizing

| Group | Size | Memory | Why |
|---|---|---|---|
| api | shared-cpu-1x | 512mb | Hono is light |
| worker | shared-cpu-1x | 1024mb | Claude chain + grocery-list DOCX/PDF export needs headroom |

## Cloudflare AOP mTLS

- Public 443 listens via the Nginx sidecar (`docker/Dockerfile.nginx`)
- Nginx terminates the per-zone client cert handshake from Cloudflare AOP
- Plaintext proxied to Hono on localhost:3000
- Fly secrets: `CF_AOP_CERT` (per-zone custom cert, not the shared CF origin cert) + `CF_AOP_CERT_FINGERPRINT` (pinned)
- This guards against CF-bypass-CF attacks where an attacker bypasses Cloudflare and hits the origin directly

## Env vars

Non-secret in `fly.toml [env]`:
- `NODE_ENV=production`, `PORT=3000`, `WORKER_PORT=4000`
- `WEBAUTHN_RP_ID=pantrypilot.example`, `WEBAUTHN_RP_NAME="Pantry Pilot"`
- `GRAPHILE_WORKER_CONCURRENCY=5`
- `ANTHROPIC_PROMPT_CACHE_ENABLED=true`

Secret (set via `flyctl secrets set ...`):
- `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `DATABASE_URL` (Neon connection)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `CF_AOP_CERT`, `CF_AOP_CERT_FINGERPRINT`
- `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
- `RESEND_API_KEY` (planned, user-data plan)

## Deployment flow

```bash
# Manual
flyctl deploy --config services/backend/fly.toml

# CI (.github/workflows/backend.yml line 152)
flyctl deploy
```

GitHub Actions uses `FLY_API_TOKEN` secret. Deploy currently runs only on `main` push — `skeleton-test12` and other branches pass CI checks but do not auto-deploy.

## Project conventions

- **Two process groups, single image.** API and worker share build artifacts; only the entrypoint differs.
- **Nginx sidecar terminates mTLS, never Fly's `tls` handler** — we want to verify the client cert at origin.
- **Drain protocol is critical.** Test the SIGTERM path in CI smokes — kill the API mid-request and verify the in-flight Claude chain checkpoints.
- **Region: `iad` only for MVP.** Multi-region is post-MVP.

## Known issues

- `flyctl` version drift between dev machines and CI — pin in `.github/workflows/backend.yml` action.
- Worker scaling: 1 VM with concurrency=5 handles current load. Watch `graphile_worker.jobs` queue depth in Grafana.
- Cold start on api process when `auto_stop_machines=true` adds ~3s to first request after idle. Tune `min_machines_running` if it bites.

## Failure modes

| Failure | Behavior |
|---|---|
| Worker crash mid-chain | QStash redelivers; worker reads `ticket.checkpointedStep` and continues from there |
| Worker stuck > 2× expected | `cron.stuck-ticket-sweep` transitions to `failed` + emits a usage-restore ledger entry |
| API crash | Fly restarts immediately; loadbalancer drains gracefully |
| Cloudflare AOP cert rotation | Update both `CF_AOP_CERT` + `CF_AOP_CERT_FINGERPRINT` together; no double-rotation lockout |
