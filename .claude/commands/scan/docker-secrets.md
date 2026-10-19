---
description: Dockerfile → .dockerignore secret-exposure check — flags secret files (.env, *.pem, credentials) that a broad COPY . / ADD . would bake into an image layer because .dockerignore doesn't exclude them.
---

# /scan:docker-secrets

A `docker build` ships the ENTIRE build context to the daemon. If a Dockerfile does a broad copy (`COPY . .`, `ADD . /app`) and the context holds secret files that `.dockerignore` doesn't exclude, those secrets get baked into an image layer — a classic credential leak. This read-only check catches that condition before it ships.

```bash
node scripts/checks/docker-secret-ignore.js            # scan this repo
node scripts/checks/docker-secret-ignore.js --target <path>   # scan another repo
node scripts/checks/docker-secret-ignore.js --json     # programmatic consumption
```

## What it flags

A RED finding requires ALL THREE to hold (so it never false-fires on a clean repo):

1. A Dockerfile is present, AND
2. It contains a broad `COPY .` / `COPY ./` / `ADD .` (narrow copies like `COPY package.json .` don't count), AND
3. A secret file actually exists in the build context AND is NOT excluded by `.dockerignore`.

Secret patterns: `.env`, `.env.*`, `*.pem`, `*.key`, `*.pfx`, `*.p12`, `id_rsa`/`id_ed25519`/…, `credentials`, `credentials.json`, `.npmrc`, `.netrc`, `secrets.{json,yml,toml}`, `service-account*.json`.

## Statuses

- `skipped` (green exit) — no Dockerfile. Not every project containerizes; absence is not a failure.
- `green` — Dockerfile present but no broad copy, OR broad copy with every secret already in `.dockerignore`, OR broad copy with no secret files in the context.
- `red` (exit 1) — at least one un-excluded secret would be swept into an image layer. Findings list the exact paths.
- `error` (exit 2) — fail-closed: a security check that errors must not read green.

## Remediation

Add the flagged paths (or broad globs like `*.env`, `*.pem`, `**/credentials*`) to `.dockerignore` at the repo root; create one if it's missing.

## Related

- `/scan:privacy` — pre-publish scan for personal data (emails, homedir paths, tracked runtime files).
- `/redteam:scan` — broader deterministic security sweep (deps, routes, CVEs, secrets, config).
- Hook `secret-guard` — blocks writes that contain inline secret VALUES at edit-time; this scan catches secret FILES that would ship via the Docker context.
