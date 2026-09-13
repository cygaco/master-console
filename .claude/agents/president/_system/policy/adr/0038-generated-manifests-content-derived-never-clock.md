# ADR-0038 — Generated manifests are content-derived, never clock/mtime-derived

- **Status:** Accepted (2026-07-23, 1.1.0 mint session)
- **Class:** B (β DECIDE B/0.90, msg_id `6d1119ab-0b96-4f16-b007-a1e48027f23c`, boundary `GATE-B-fix-pair`)
- **Enforcement:** debt logged as ED-278 (build-output lint candidate) — see `paths.enforcementDebt`

## Context

The 1.1.0 mint's first real GATE-B `upgrade_current_to_new` run went RED. One of the two
root causes: `scripts/hooks/hook-manifest.json#updatedAt` was derived from the registry
file's **fs mtime** (`build.js`). An upgrade regenerates the manifest **in-target** at
apply time, while a fresh install **copies it verbatim** — identical sources, divergent
bytes (`updatedAt` only), and the divergence cascades into every sha-rollup that hashes
the file (`.claude/framework-manifest.json` `hook` rollup, `_mc/MANIFEST.json`).
The mtime choice was itself a half-fix for the earlier `Date.now()` flap — the original
intent was already determinism; mtime kept the output fs-state-dependent.

A second producer of the same file (`scripts/hooks/test.js --write-manifest`) still
stamped wall-clock `new Date()`.

## Decision

**Any committed generated artifact must be byte-deterministic on its sources alone:**
a field like `updatedAt` must be **content-derived** (e.g. `sha256:<16-hex>` of the
source file), never `Date.now()`, never fs mtime, never any machine/wall-clock state.
Invariant: **regen == verbatim-copy** whenever sources match — on any machine, at any
time. This is what makes upgrade-vs-fresh parity (GATE-B 3c) provable instead of
normalized-around.

Applied 2026-07-23: `scripts/hooks/build.js` (primary producer) and
`scripts/hooks/test.js` (legacy `--write-manifest` producer) both stamp
`sha256:` + first 16 hex of the source's sha256.

## Consequences

- `--check` cannot flap (same property the mtime fix wanted), and GATE-B 3c hook
  divergence is structurally impossible while sources match.
- `updatedAt` loses wall-clock meaning. Audit: no semantic consumer existed (producers
  + the generated file only). Git history remains the "when".
- Gate-side normalization for this class is rejected on principle: the manifest hashes
  raw bytes, so only **source-byte convergence** is honest — normalizing would hide
  real divergence (false-green class).

## Enforcer (named, per Policy & Enforcement Hygiene)

Candidate: a build-output lint that greps generator scripts writing committed artifacts
for `Date.now()` / `new Date(` / `statSync(...).mtime` feeding a serialized field.
Until built: **ED-278** in `paths.enforcementDebt`.
