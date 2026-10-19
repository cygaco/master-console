---
description: Fail-closed enforcer for the _guides/ library — asserts every guide is anchored, the registry is fresh, every anchor is wired live into the bootstrap pipeline, and there are no orphan records or markers. The /guides analog of /scan:scan-coverage and /maps:coverage.
---

# /guides:coverage — Enforce the guide library is contract-complete + wired

The standing backstop for the guide suite. It refuses the **"contract defined but not applied"** drift class (for example, a guide-anchor contract that no guide carries, with no registry and nothing wired). It is the `/guides` analog of `/scan:scan-coverage` (skill self-inventory) and `/maps:coverage` (map self-inventory).

## Input

`$ARGUMENTS`:
- `--json` — machine-readable output (for `/scan:full` or CI consumption).

## What it checks (fail-closed — any gap ⇒ exit 1)

Runs `node scripts/checks/guides-coverage.js`. The invariants:

1. **Registry fresh** — `_guides/registry.json` matches current guide frontmatter (no hand-edits, no missed rebuild).
2. **Every guide anchored** — every `_guides/*.md` (except the README index) carries valid contract frontmatter: `guide`, `anchor` (in the namespace), `shape` (walkthrough|checklist|notice), `timing` (project-start|at-module|at-gate|reference), `lead_time`.
3. **Every anchor wired** — every guide with `anchor != none` has an `active` record in `.claude/project/maps/guide-integration.jsonl`.
4. **No phantom records** — every active record's `guide-anchor` marker is actually present in its target bootstrap file (a record can't claim an integration that was removed).
5. **No orphan records** — every record names a guide that exists in the registry.
6. **No orphan markers** — every `guide-anchor` marker in `.claude/commands/bootstrap/*.md` has a backing active record.

## Exit codes

- `0` — all green (every guide anchored, registry fresh, every anchor wired, no orphans).
- `1` — at least one gap (printed per-invariant with the offending guide/file).
- `2` — runner error (registry lib unreadable, etc.). **Fail-closed: a runner error is NOT a pass** — the standard hardening for enforcers, which must never report a false green.

## How it fits

```
/guides:write      → authors a guide + its anchor frontmatter
/guides:organize   → backfills/validates anchors across the library + rebuilds the registry
/guides:integrate  → wires each anchor into spinup/lastmile + records it
/guides:coverage   → THIS — proves the whole chain is complete + honest
```

Run it after `organize` + `integrate`, and any time you touch `_guides/` or the bootstrap pipeline. Green is the done-gate for the guide suite.

## Reuses / does not duplicate
- `scripts/checks/guides-coverage.js` — the enforcer engine.
- `scripts/guides/registry.js` — shared frontmatter parser + registry I/O.
- Sibling enforcers: `/scan:scan-coverage`, `/maps:coverage` (same self-inventory pattern, different surface).

## Anti-patterns
- Don't treat a `2` (runner error) as a pass — investigate it.
- Don't "fix" a failure by hand-editing `registry.json` or the jsonl — re-run `/guides:organize` / `/guides:integrate` so the source of truth (frontmatter + real placements) drives the index.
