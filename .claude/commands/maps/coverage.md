---
description: Maps-suite self-inventory — asserts every /maps:* skill is registered in /maps:all, no dangling registry refs, no orphan map files, and surfaces stale maps. The /maps analog of /scan:scan-coverage.
---

# /maps:coverage — Does the maps suite inventory itself?

The `/maps:*` suite + the on-disk map files drift from the `/maps:all` registry over time: a new `/maps:<x>` skill or a new generated map file lands but `/maps:all` never lists it, so coverage/staleness silently rots. This is the maps suite **auditing itself** — the direct analog of `/scan:scan-coverage`.

## Run

```bash
node scripts/checks/maps-coverage.js                 # human-readable
node scripts/checks/maps-coverage.js --json          # machine-readable
node scripts/checks/maps-coverage.js --stale-days 14 # adjust the staleness threshold (default 7)
```

## What it asserts (fail-closed)

1. **UNREGISTERED-SKILL** — every `/maps:<x>` skill is referenced by `/maps:all` **or** on the allowlist (`scripts/checks/maps-coverage.allowlist.json`) with a reason.
2. **DANGLING-REGISTRY** — every `/maps:<x>` that `/maps:all` references resolves to a real skill file.
3. **ORPHAN-MAP-FILE** — every persisted map file in `.claude/project/maps/` has a matching `/maps:<x>` generator **or** is allowlisted (manual registries + inventory snapshots are allowlisted with reasons).
4. **Allowlist hygiene** — no stale/reasonless exclusions.
5. **WARN (non-blocking)** — generated maps older than the staleness threshold → run `/maps:<x> --refresh` or `/maps:all --regenerate`.

Exit `0` clean (warnings don't block) · `1` blocking findings · `2` setup error (**fail-closed**) · `3` not initialized: no generated map file yet (e.g. a fresh clone of the framework repo before any map has been generated), so coverage is UNKNOWN, never reported as a pass.

## Relationship to `/maps:all`

`/maps:all` *renders* the registry + staleness table (the human view). `/maps:coverage` *enforces* that the registry, the `/maps:*` skills, and the on-disk maps stay in sync — so the registry can't silently drift from what exists. Run it after adding/removing a `/maps:<x>` skill or a map file. Wired into `/maps:all` (and runnable inside `/scan:full` via the governance tier if desired).

## Reference

- Engine: `scripts/checks/maps-coverage.js` (pure `evaluate()` + bite-test `maps-coverage.test.js`)
- Allowlist: `scripts/checks/maps-coverage.allowlist.json`
- Sibling: `/scan:scan-coverage` (the scan-suite analog)
