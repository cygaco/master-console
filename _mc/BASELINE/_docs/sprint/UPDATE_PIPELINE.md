# /warp:update — Three-Phase Pipeline

The `/warp:update` engine runs three phases against a consumer install:

1. **Preflight** — composed gates that refuse to apply against an unsafe baseline.
2. **Transactional apply** — pre-state snapshot + atomic commit-or-rollback.
3. **Postflight** — diagnostic checks that verify the new state is sane.

This document is the operator-facing map of the pipeline. The engine lives in
`scripts/mc/update.js`; the phase modules live in
`scripts/mc/{preflight,transaction,postflight}.js`; the centralized
content-hash surface lives in `scripts/mc/lib/content-hash.js`.

## Phase 1 — Preflight

Ten gates run in fail-fast order:

| # | Gate | Override flag |
|---|---|---|
| 1 | `install-baseline` | `--operator-override install-baseline` (or legacy `--force-fresh`) |
| 2 | `capsule-resolvable` | `--operator-override capsule-resolvable` (or remediation: `--source <path>`) |
| 3 | `version-quorum` | `--operator-override version-quorum` (or legacy `--allow-version-drift`) |
| 4 | `manifest-honesty` | `--operator-override manifest-honesty` |
| 5 | `staleness` | `--operator-override staleness` (or legacy `--allow-stale`) |
| 6 | `path-resolution` | `--operator-override path-resolution` |
| 7 | `structure-parity` | `--operator-override structure-parity` |
| 8 | `applied-migrations` | `--operator-override applied-migrations` |
| 9 | `migration-presence` | `--operator-override migration-presence` |
| 10 | `tracked-transients` | `--operator-override tracked-transients` |

### `--operator-override <gate-name>` (T-20260514-072)

Replaces the four narrow legacy flags + `--skip-preflight`. The contract:

- Pass `--operator-override <gate-name>` once per gate. Repeatable.
- `--override-reason "<text>"` is **required** when any override is present.
  8 ≤ length(reason) ≤ 500 chars, trimmed.
- Unknown gate names are rejected with the full valid list.
- Every accepted override emits an `operator-override-used` event to
  `paths.eventsFile` with `{gate, reason, operator, ts, txId, gateStatusBefore}`.

JSONL injection on `--override-reason` is structurally prevented — every
write to `events.jsonl` goes through `JSON.stringify`, which escapes
control characters per the JSON spec. AC-5.4 verified by the audit-log
contract, not by ad-hoc trimming inside preflight.

Legacy narrow flags (`--allow-stale`, `--force-fresh`, `--allow-version-drift`)
remain functional for back-compat but do NOT emit the new audit event.
Prefer `--operator-override` going forward.

## Phase 2 — Transactional apply

`scripts/mc/transaction.js` wraps the apply phase:

1. Pre-apply snapshot of all files-to-be-touched, plus a transaction id.
2. Apply file writes + run migrations referenced by capsule
   `release.json#migrations[]` (NOT from the manifest's `assets[]` — see R-4).
3. On any failure: restore from snapshot, mark transaction rolled-back,
   exit non-zero with the transaction id.
4. On success: commit transaction, write a frozen evidence record.

## Phase 3 — Postflight

Five diagnostic checks (`scripts/mc/postflight.js`) — provider smoke,
path resolution, manifest honesty, structure parity, applied migrations.
The new capsule-aware applied-migrations gate (T-20260514-075) is honest
about migrations that the capsule expects to be present.

## Hash semantics — single source of truth

Every framework asset's content is now expressed by ONE canonical hash form
emitted by `scripts/mc/lib/content-hash.js` (T-20260514-068):

| Surface | Helper |
|---|---|
| Text assets (`.md .js .json .yaml .yml .ts .toml .txt`) | `contentHash(input)` — LF-normalized sha256, 64 hex chars |
| Binary assets | `rawHash(input)` — raw sha256, 64 hex chars |
| Comparison across the 0.6.x → 0.7.0 transition | `hashMatches(a, b)` — prefix-tolerant with 12-char floor |
| Text-vs-binary classification | `isTextAsset(destPath)` — extension allowlist |

The capsule's `framework-manifest.json#assets[].sha256` is now full 64-char
(T-20260514-070). Pre-0.7.0 capsules emitted a 12-char prefix; the read
path tolerates them via `hashMatches`. The consumer's
`framework-installed.json#assets[].installedHash` is also full 64-char
(T-20260514-071), upgraded on the first 0.7.0 apply.

### CRLF/LF on Windows

Windows installs with `autocrlf=true` previously hit MERGE_CONFLICT
false-positives on every text asset because the capsule hash was
computed against LF bytes but the working tree held CRLF. `contentHash`
collapses both into one hash. The Windows operator's experience matches
the Linux operator's experience.

## Asset ownership state machine (T-20260514-073)

`framework/paths.registry.json` recognizes three ownership states:

- `framework_owned` — shipped by MC, replaced on update. Local edits
  yield MERGE_CONFLICT (Class C; operator review).
- `framework_template` — shipped as scaffold. Consumer content placed here
  is expected. **On any non-whitespace edit (decision 2026-05-14, automatic
  per Beta recommendation), the asset transitions to `project_owned` and
  emits `ownership-transitioned`.**
- `project_owned` — consumer-owned. Never removed by a framework restructure.

The classifier in `update.js` honors the rule:

1. `framework_template` + no consumer edit → behaves like `framework_owned`
   (UPDATE_SAFE on framework changes; DELETE_SAFE on framework removal).
2. `framework_template` + non-whitespace consumer edit → transition to
   `project_owned`, emit event, treat as LOCAL_CUSTOMIZED on the current
   pass and as DELETE_SAFE (preserve) on future framework restructure.
3. `framework_owned` + consumer edit → MERGE_CONFLICT as before.

## Migrations are NOT installed assets (T-20260514-074, T-20260514-075)

Migration sources live at `migrations/<from>-to-<to>/` in canonical MC.
They are NOT shipped via `framework-manifest.json#assets[]`. They are
referenced only via the capsule's `release.json#migrations[]` and run
through `scripts/mc/migrations-loader.js`. The `applied-migrations`
gate is now capsule-aware: a migration dir on disk is "stale" only if it
is NOT in any capsule's migration list.

## Event surface (T-20260514-076)

| Event kind | When |
|---|---|
| `mc.update.content-hash-mismatch` | classifier finds LF-only or real-drift hash difference. `kind: lf_only` is informational; `kind: real_drift` accompanies MERGE_CONFLICT. |
| `mc.update.operator-override-used` | preflight accepts `--operator-override <gate>` against a red/yellow gate. Audit trail. |
| `mc.update.ownership-transitioned` | classifier promotes `framework_template` → `project_owned` on consumer edit. |

These three kinds join the existing TR-1..TR-6 envelope family
(`mc.update.{preflight,transaction.start,transaction.commit,transaction.rollback,postflight,evidence}`).

## Opt-in recovery tools (kept, not load-bearing)

When something goes sideways on a downstream consumer, two helpers exist:

- `scripts/mc/lf-normalize-target.js` — manually normalize line endings
  across a target tree.
- `scripts/mc/prune-installed-assets.js` — manually drop entries from
  `framework-installed.json`.

The pipeline does NOT depend on either; they are operator-driven recovery
levers, not parts of the steady-state flow.

## Cross-version replay test bench

Three smoke scripts under `scripts/mc/`:

- `test-hash-back-compat.js` — verifies `hashMatches` accepts a simulated
  12-char prefix against every framework asset's full 64-char hash.
- `test-transaction-smoke.js` — pre-existing transaction wrapper smoke.
- `lib/content-hash.js --selftest` — 22 assertions covering AC-1.1/1.2/1.3.

Run them in sequence to verify a candidate MC release before tagging:

```bash
node scripts/mc/lib/content-hash.js --selftest
node scripts/mc/test-hash-back-compat.js
node scripts/checks/mc-manifest-honesty.js
```

See `_docs/sprint/CRASH_RECOVERY.md` for resume procedures after a
mid-pipeline interruption.
