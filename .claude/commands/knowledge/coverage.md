---
description: Fail-closed enforcer for the _knowledge/ layer (the company "brain", ADR-0007) — asserts the domain registry is fresh, every LIBRARY consumer is grounded by a marker block backed by a record, every STORE has its contract README + a producer reference, the design index hasn't drifted, and there are no orphan/phantom records or markers. The /knowledge analog of /guides:coverage and /scan:scan-coverage.
---

# /knowledge:coverage — Enforce the knowledge layer is contract-complete + wired

The standing backstop for the `_knowledge/` layer. It refuses the **"contract defined but not applied"** drift class — a domain that declares consumers no spec grounds in, a marker block no ledger record backs, a record whose marker vanished, a store with no contract README, or a design index that drifted from the files on disk. It is the `/knowledge` analog of `/guides:coverage` (guide library) and `/scan:scan-coverage` / `/maps:coverage` (suite self-inventory).

## Input

`$ARGUMENTS`:
- `--json` — machine-readable output (for `/scan:full` or CI consumption).

## What it checks (fail-closed — any gap ⇒ exit 1)

Runs `node scripts/checks/knowledge-coverage.js`. The `_knowledge/` layer has **two kinds** of domain, enforced asymmetrically:

- **library** (e.g. `design`) — framework training-reference files grounded into each consumer's spec via a `<!-- knowledge:<domain> role:<role> -->` marker block, recorded in the integration ledger.
- **store** (e.g. `audience`, `copy`) — a per-product runtime data store, enforced by its contract README + a producer-spec reference (no marker block — the data is drawn at runtime, not baked into a prompt).

The invariants:

1. **Registry fresh** — `_knowledge/registry.json` matches the per-domain `_knowledge/<domain>/_domain.json` declarations (no hand-edits, no missed rebuild via `scripts/knowledge/registry.js`).
2. **Domains valid** — every `_domain.json` has a valid `kind` (`library`|`store`) and a `producer`/`consumers[]` that are real roles in `paths.orgRoleRegistry`.
3. **Library consumers wired** — every `consumers[]` role has both (a) an `active` integration record in `.claude/project/maps/knowledge-integration.jsonl` AND (b) a live `<!-- knowledge:<domain> role:<role> -->` marker in **its own** agent spec.
4. **Library index fresh** — the domain's internal index (e.g. `_knowledge/design/registry.json`) exists, its entry count equals the on-disk artifact count, and every indexed guide path resolves (no silent drift of the rich index).
5. **Store contract wired** — the contract README exists AND the producer's spec references the store path `_knowledge/<domain>`.
6. **No phantom record** — every active library record's marker is actually present in its spec.
7. **No orphan record** — every record names a domain in the registry and a role that is a consumer (library) or the producer (store) of it.
8. **No orphan marker** — every `knowledge:<domain> role:<role>` marker in the agent specs has a backing active record.

## Exit codes

- `0` — all green (registry fresh, every library consumer wired, every store contracted, no drift, no orphans).
- `1` — at least one gap (printed per-invariant with the offending domain/role/file).
- `2` — runner error (registry lib unreadable, role-registry unreadable, etc.). **Fail-closed: a runner error is NOT a pass**.

The marker/record reconciliation (invariants 3/6/7/8) lives in a pure `evaluate()` covered by `scripts/checks/knowledge-coverage.test.js` (fires each gap class on a synthetic fixture) — an enforcer with no negative test is a false-green waiting to happen.

## How it fits

```
scripts/knowledge/registry.js  → (re)builds _knowledge/registry.json from the _domain.json files
/knowledge:integrate           → grounds each consumer (library marker block / store ref) + records it
/knowledge:coverage            → THIS — proves the whole chain is complete + honest
```

Run it after `/knowledge:integrate`, and any time you touch `_knowledge/`, a `_domain.json`, or a consumer spec's marker block. Green is the done-gate for the knowledge layer. Also delegated by `/scan:full` (Knowledge-layer integrity) as a direct script invocation.

## Reuses / does not duplicate
- `scripts/checks/knowledge-coverage.js` — the enforcer engine.
- `scripts/knowledge/registry.js` — the shared `_domain.json` parser / registry I/O / role-set validation.
- Sibling enforcers: `/guides:coverage`, `/scan:scan-coverage`, `/maps:coverage` (same self-inventory pattern, different surface).

## Anti-patterns
- Don't treat a `2` (runner error) as a pass — investigate it.
- Don't "fix" a failure by hand-editing `registry.json` or the jsonl — re-run `scripts/knowledge/registry.js` / `/knowledge:integrate` so the source of truth (the `_domain.json` files + real placements) drives the index.
