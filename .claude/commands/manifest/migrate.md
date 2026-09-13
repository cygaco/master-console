---
description: Migrate the manifest to a target MC version. Dry-run by default; --apply to write.
user-invocable: true
namespace: manifest
reads: [paths.manifest]
writes: [paths.manifest]
migrates:
  from: ">=0.1.0"
  to: "<=0.1.4"
---

# /manifest:migrate

Apply a chain of one-step migrations to bring the manifest from the current `mc.version` to a target.

## Semantics (frozen contract)

- **Read-only / dry-run by default.** Pass `--apply` to mutate.
- **Idempotency:** if current == target, exits 0 with `already at target <ver> — no-op`.
- **Backup:** on `--apply`, writes `.claude/manifest.<from>-<timestamp>.bak.json` before any mutation.
- **Downgrade refused:** if current > target, exits 1 with `downgrade refused: current X > target Y`. Never silently accepts.
- **Unsupported from:** if no migration path exists from current to target, exits 1 with `no migration path from X to Y`.
- **Dry-run output:** unified diff against current.

## Supported range

`from: 0.1.0+`, `to: <= 0.1.4` (current MIGRATIONS table). Adding a new step requires a new entry in `scripts/manifest/cli.js`.

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/manifest/cli.js migrate
  --to <ver>            target semver (required)
  --apply               actually write (default is dry-run)
  --source <file>       override manifest source (fixture testing)
```

## Output

Dry-run:
```
# DRY RUN — would migrate <from> → <to> via <n> step(s)
# pass --apply to write
<unified diff>
```

Apply:
```
MIGRATED <from> → <to> (<n> step(s))
backup: <relative path>
```

## Exit codes

- `0` success (or no-op when already at target)
- `1` manifest missing, downgrade refused, or no migration path
- `2` usage error (missing/invalid `--to`)

## Examples

Idempotency:
```bash
$ node scripts/manifest/cli.js migrate --to 0.1.4 --source tests/fixtures/manifest-migrate/already-at-target.json
already at target 0.1.4 — no-op
```

Downgrade refused:
```bash
$ node scripts/manifest/cli.js migrate --to 0.1.0 --source tests/fixtures/manifest-migrate/downgrade-target-0.1.0.json
downgrade refused: current 0.1.4 > target 0.1.0
```

Dry-run:
```bash
$ node scripts/manifest/cli.js migrate --to 0.1.4 --source tests/fixtures/manifest-migrate/from-0.1.0.json
# DRY RUN — would migrate 0.1.0 → 0.1.4 via 4 step(s)
...
-    "version": "0.1.0",
+    "version": "0.1.4",
```

## Implementation

```bash
node scripts/manifest/cli.js migrate $ARGUMENTS
```

See: `tests/transcripts/manifest-migrate.md` (covers all four fixture cases).
