# ADR-0034 — GATE-A `fresh_scaffold_all_ways`: real installs, sandbox-isolated, retirement coverage-map

- **Status:** Proposed (design-lock, SP-20260721-001 D-4 INC-2). Ratified at merge.
- **Date:** 2026-07-21
- **Sprint:** SP-20260721-001 (D-4), INC-2. Backend unit build (β design→build consult in flight).
- **Extends:** the operator's D-4 standing standard #1 ("fresh-scaffold, ALL WAYS"). Sibling to
  ADR-0006 (sealed-capsule consumer-contract gate) — both close the "downstream always missing /
  ships-but-doesn't-stand-up" class, at different layers (ADR-0006 = out-of-tree BOM isolation;
  this ADR = in-tree shipped-installer real-run isolation).

## Context

The D-4 standing standard demanded a REAL, BLOCKING release gate that runs the three shipped
scaffold paths (`/portfolio:new`, manual `/warp:setup`, the shipped `install.ps1`) for real, instead
of the two pre-existing cosmetic gates that only asserted a fixture DIRECTORY exists
(`fresh_install_fixture`, `customized_install_fixture` — `scripts/mc/release-gates.js`, never
ran an install). A gate that shells real installers 3x is also a gate that can corrupt canonical if
built carelessly — a real canonical-corruption incident earlier this session made the sandbox-isolation
property the #1 correctness requirement, ahead of the install assertions themselves.

## Decision

Ship `scripts/mc/test-scaffold-all-ways.js` (the engine) + `gate("fresh_scaffold_all_ways", ...)`
+ `gate("install_matrix", ...)` (wiring the previously-orphaned `test-install-matrix.js`) in
`scripts/mc/release-gates.js`, plus a `parentDir` test/sandbox seam on
`scripts/portfolio/new-lib.js#createProductRepo`.

### Sandbox isolation (the binding property)

Four leak vectors, each sandbox-scoped:

1. **Scaffold target** — `createProductRepo`'s new `parentDir` opt overrides
   `path.resolve(WARPOS_ROOT, "..", slug)`; the engine always passes an `os.tmpdir()` sandbox, never
   `../<slug>`.
2. **Portfolio registry** — reuses the EXISTING, already-tested `WARPOS_PORTFOLIO_REGISTRY` env seam
   (`scripts/portfolio/registry.js#registryPath()`, covered by `registry-path.test.js`) rather than
   inventing a second seam. The engine points it at a sandbox doc for Leg 1's duration, restores it,
   and asserts the REAL `~/.mc/portfolio.json` is byte-identical before/after.
3. **install.ps1 side-effects** — confirmed by inspection: every write in `install.ps1` is
   `Join-Path $Target ...`; reads from `$Source` are read-only.
4. **Git ops** — every git call in the engine is cwd-scoped to a sandbox, or is a pre-existing
   read-only `git config`/`git rev-parse` against `WARPOS_ROOT` (new-lib.js) — explicitly allowed.

**Mechanized proof (R1a):** `git status --porcelain --untracked-files=all` snapshotted before/after
the whole run; asserted byte-identical. This is a NO-DELTA proof, not absolute-clean — robust to a
legitimately-dirty dev host. Empirically confirmed during design: this snapshot form already excludes
every gitignored scratch path the engine's own telemetry/scratch writes land in (`.mc/`,
`.claude/runtime/`, `.claude/project/events/`) — a real leak (a modified tracked file, or a new
untracked NON-ignored path) is the only thing that can produce a delta.

**Pre-run guard (R1b, defense-in-depth):** before each leg, `assertSandboxTargetSafe()` refuses
(throws) any target resolving inside canonical (`REPO_ROOT`) or the real portfolio-sibling location
(`REPO_ROOT/..`), and requires it resolve under `os.tmpdir()`. Paired with the no-delta assertion —
both, not either.

### Leg 3 has no silent node-downgrade (R2)

`test-install-matrix.js#installPs1EquivalentPath` silently falls back to a node-equivalent path when
PowerShell is present but the run fails — the "gap #5 silent downgrade" this gate exists to close.
GATE-A's own Leg 3 runner (`runLeg3`) does NOT reuse that helper; it has no node-mode fallback path at
all. If PowerShell is present but the run doesn't produce a real install, that is a RED, full stop. A
host with no PowerShell marks the gate `incomplete` (severity `degraded` at the release-gates.js
wiring) — never a silent pass.

### R5 — retirement coverage-map (coverage-proven, not retired on number)

| Gate | Verdict | Why |
|---|---|---|
| `fresh_install_fixture` | **RETIRED** | Was `fs.existsSync` on `fixtures/install-empty-next-app/` only — never ran an install. Subsumed by Leg 1 (`/portfolio:new`) + Leg 3 (shipped `install.ps1`), both real installs asserting real end-state. |
| `customized_install_fixture` | **RETIRED** | Was `fs.existsSync` on `fixtures/update-from-0.0.0-customized-claude-md/` only — never touched a CLAUDE.md. Subsumed by Leg 2 (manual `/warp:setup` over a SEEDED pre-existing CLAUDE.md — real merge/survival/backup asserts). |
| `update_fixture_from_previous` | **STAYS** | Not cosmetic — loads a real `framework-installed.json` fixture and runs the `update.js` classifier. UPGRADE domain (GATE-B / INC-3), not fresh-scaffold. Retiring it on adjacency to the other two would drop real coverage GATE-A does not provide. |

### R4 — parity-diff completeness

Leg 3 (install.ps1) vs Leg 2 (manual `/warp:setup`) is a full-tree PATH-SET diff (not content), reusing
`treeFileList`/`parityDiff`/`PARITY_ALLOWLIST` from `test-install-matrix.js` verbatim rather than
re-deriving a second normalization set. That allowlist already enumerates + justifies each entry
(timestamps live inside files, not the path set; `.claude/framework-installed.json` carries a
per-install id + hashes; `.claude/framework-manifest.json` is legitimately install.ps1-only;
`.git`/`.mc`/runtime/event/memory dirs are per-install scratch).

## Consequences

- **Positive:** the D-4 standard is a real, enforced, named gate; the sandbox-isolation property is
  mechanized (not just documented); the two cosmetic gates are gone with their real intent covered;
  `test-install-matrix.js` stops being orphaned.
- **Two pre-existing, unrelated defects were surfaced (not introduced) by this build** — flagged as
  FOUNDATION-UPDATE-REQUESTs in the build's return notes, NOT fixed here (out of this unit's file
  scope):
  1. `scripts/mc/manifest/build.js`'s `_mc/MANIFEST.json` classifier currently fails with
     "43 unclassified path(s)" against canonical's OWN tree today (reproduces with zero changes from
     this build: `node scripts/mc/manifest/build.js`) — needs classification rules for newer
     `.claude/kernel/*` / workorder-schema paths.
  2. `install.ps1`'s Stage 1 asset-copy uses `Test-Path`/`Copy-Item` without `-LiteralPath`, so
     PowerShell wildcard-interprets bracket characters in asset paths (e.g. Next.js dynamic-route
     dirs like `[ref]`) and silently skips them ("Source missing... skipped") even though the file
     exists — a real install.ps1-vs-`/warp:setup` divergence the R4 parity check catches for the
     first time. This is EXACTLY the kind of real regression a wired-in real gate is supposed to
     surface (mirrors R6's "resolve what surfaces, don't dodge it" principle) — but fixing
     `install.ps1`/the manifest classifier is outside this unit's scope (`scripts/mc/
     test-scaffold-all-ways.js` + `release-gates.js` + `test-install-matrix.js` wiring +
     `new-lib.js` seam only). GATE-A will legitimately RED on Leg 3 until those are fixed — that is
     the gate doing its job, not a defect in this build.
   - **Amendment (post-design, α-ratified gate-mode option b):** the straight-RED design above was
     superseded during the ED-249 window by a REPORT-ONLY ramp (the MC report-only→enforce
     discipline). A real-install LEG failure now surfaces as `yellow` (reported, non-blocking) naming
     the ED-249 flip-trigger; a SANDBOX-ISOLATION no-delta LEAK still `red`s UNCONDITIONALLY (checked
     first, never softened). `install_matrix` shares the same ED-249 window. FLIP both to hard
     (`GATE_A_REPORT_ONLY=false`) once ED-249 resolves (build.js classifies clean) AND Leg-3 is green —
     which is ALSO a release-ceremony prerequisite (build.js drives RI-003 manifest convergence).
- **Reversibility:** additive (`parentDir` defaults to the old behavior when omitted); the two
  retired gates can be restored verbatim from git history if ever needed, though their coverage is
  fully subsumed.

## Enforcer

`scripts/mc/test-gate-wiring.js` — proves the GATES array composition itself (both new gates
present and reachable, both retired gates absent, `update_fixture_from_previous` still present), fast
and hermetic (canned `spawnSync` payloads, no real installs). `scripts/mc/
test-scaffold-all-ways.js --self-test` proves the engine's own reachability + sandbox-isolation teeth
(R7 + R1a/R1b) without running the real 3-leg install.
