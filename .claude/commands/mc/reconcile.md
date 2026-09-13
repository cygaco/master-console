---
description: Reconcile downstream-flagged MC gaps into canonical — discover every product's MC.md, verify each gap @current, get a cross-provider root-cause lens, triage, drive the fixes, and record resolution canonical-side.
---

# /mc:reconcile — Absorb downstream gap registers into canonical

The canonical-side consumer of [`/mc:flag`](flag.md). Run from the **MC canonical
repo**. Every registered portfolio product accumulates a root `MC.md` of
framework/tooling gaps found while building on the framework. This skill pulls all of
them up, separates *what's still real* from *what's already fixed*, finds the **deeper
root cause** behind the surface gaps, fixes what's safe, and roadmaps the rest — then
records the resolution **on the canonical side only**.

This skill is the codified form of the manual reconciliation run on 2026-05-26.

## Inputs

`$ARGUMENTS` — optional: `--product <slug>` (limit to one product) · `--verify-only`
(stop after the verify pass — produce the triaged gap list, build nothing) ·
`--no-consult` (skip the cross-provider consult) · `--fix <cluster>` (drive only one
cluster).

## Hard invariants

- **Verify-canonical-first (load-bearing).** Never build a fix before confirming the gap
  still reproduces in canonical@current. Downstream registers reflect the MC version
  *installed there* (often several releases behind), so a large fraction are already
  fixed upstream. Building those is pure waste (MC **ED-008**). Every gap gets a
  REPRODUCES / FIXED / PARTIAL verdict with `file:line` evidence **before** it earns a
  fix.
- **Never modify a downstream repo.** Sync is one-way (canonical → product); products are
  read-only here. Do **not** edit any product's `MC.md`, code, or git — even to mark
  a gap "fixed upstream." Resolution is recorded **canonical-side**; the register updates
  itself downstream on that product's next `/mc:update` + local re-check, or in the
  product's own session. (Operator rule: MC-only — never touch other projects.)
- **Framework-layer only.** Reconcile framework/tooling gaps. Product bugs that leaked
  into a register get noted and left for the product.
- **Every policy names an enforcer.** A fix that's "recommend X" without a hook / test /
  check / gate / `/enforcement:log` entry just re-opens later (CLAUDE.md § Policy &
  Enforcement Hygiene).

## Procedure

### Phase 1 — Discover
Read the portfolio registry at `~/.mc/portfolio.json` (the real registry the portfolio
scripts use — `scripts/portfolio/registry.js#registryPath()`; note `portfolioRegistry (removed paths key)`
historically pointed elsewhere). For each product `repo_path`, read (read-only):
- the root `MC.md` (the primary register),
- known siblings: `.claude/runtime/notes/mc-issues-found.md`, any `mc-*.md` gap
  files. (Ignore dead relics like `WARPOS_NEXT_STEPS.md`.)
Record each product's installed MC version (for the staleness lens). If a product's
`MC.md` is not a gap register (e.g. repurposed as a positioning doc), note the
collision and skip it.

### Phase 2 — Consolidate & dedupe
Merge all entries into one list keyed by **root cause**, not by per-product id. The same
gap recurs across products (e.g. product `"type":"module"` breaking CJS scripts; sprint
`--resume` regressing to boot). Tag each consolidated gap with **which products reported
it** and **at which versions** — a gap reported by N products at versions ≤ current is
higher-priority and more likely real.

### Phase 3 — Verify @current (the gate)
For each consolidated gap, verify whether it still reproduces in canonical@current.
Fan out **parallel read-only agents** (one per subsystem cluster — dispatch, sprint,
guards/hooks, install/scaffold, paths/capsule/update) that inspect the real files and
return per-gap **REPRODUCES / FIXED / PARTIAL + `file:line`**. **Drop every FIXED gap.**
The output of this phase is the *verified-open* list — the only thing worth fixing.

### Phase 4 — Cross-provider root-cause lens (the other eyes)
Unless `--no-consult`: dispatch the **`advisor`** role (freeform, non-Claude — routes to
openai/gpt-5.5) via the canonical bridge:
```bash
node scripts/dispatch-agent.js advisor <prompt-file>
```
Hand it the verified-open list + your own root-cause hypothesis and ask: *what is the
single deeper cause behind these surface gaps, and what systemic fix would prevent the
whole class?* Run a parallel internal `/fix:deep`-style root-cause pass yourself. Common
meta-causes this register class keeps surfacing (pressure-test, don't assume):
- canonical is validated **as a fully-exercised install**, so the *consumer / fresh-install
  contract* is never dogfooded the way downstream hits it;
- **two-manifest drift** (authoring source vs shipping snapshot) → "downstream always missing";
- **aspirational-vs-enforced** (policies with no enforcer);
- **fail-open / silent success** (hooks swallow errors, phases report "scaffolded" while
  writing nothing, provider smoke false-green, phantom dispatch);
- **canonical-only guards run unconditionally in consumer repos** (no repo-role awareness).
Synthesize both lenses into a stated root cause + a systemic-fix recommendation (usually a
new enforcer or a clean-room consumer-simulation in the dev/release loop).

### Phase 5 — Triage
Sort the verified-open gaps into:
- **fix-now** — surgical, safe, reversible (most are one-block fixes the register already specifies);
- **sprint-worthy** — bigger but bounded → mint a sprint;
- **roadmap** — redesigns / breakage-bearing → `/roadmap:add` (and an `## ALERTS` entry if a fix would itself cause breakage);
- **enforcement-debt** — a policy with no enforcer → `/enforcement:log`.
Weight by severity × (reported-by-N products) × leverage × safety.

### Phase 6 — Drive the fixes
Dispatch **parallel builders** for the disjoint code fixes (foreground-synchronous
`dispatch-agent.js` or harness Agent — never detached-background-poll: that's the phantom
class). Alpha authors the skill/agent/doc/manifest changes directly (canonical source =
`.claude/**`, self-referential in `_mc/MANIFEST.json`). Honor the autonomy table;
consult **β** for Class-B/C calls. Keep file ownership disjoint to parallelize safely.

### Phase 7 — Verify & gauntlet
Run the `/check` suite (`/scan:full`) + a reviewer/qa gauntlet on risky changes.
**Verify from telemetry, not narration**: a gauntlet role counts as run only with an
`ok:true` record in `dispatch-completions.jsonl` (`scripts/dispatch/gauntlet-verify.js`).
Regenerate every derived artifact touched (views, paths, hooks, both manifests) and
confirm fresh.

### Phase 8 — Record resolution (canonical-side only)
Record what was fixed/deferred in canonical: `/issues:log` (or resolve) for recurring-issue
entries, `/enforcement:log` for the policy gaps, `ROADMAP.md` for deferred work, and a
`/mc:reconcile` report under the reconcile-report path (`.claude/project/reports/`) listing every
consolidated gap → verdict → disposition. **Do not** write back to any downstream
`MC.md`.

### Phase 9 — Report
Summarize: gaps discovered (by product), verified-open vs already-fixed counts, the
root-cause synthesis (both lenses), fixed-now / sprinted / roadmapped / enforcement-debt
dispositions, and the follow-up commands. If the fixes warrant a release, point at
`/mc:release`.

## Notes
- The verify pass (Phase 3) is the difference between this skill and a naive "do everything
  the registers say." Skipping it re-incurs ED-008.
- Sibling: [`/mc:flag`](flag.md) — the downstream producer this skill consumes.
- Pairs with `/scan:mc-staleness` (which installs are behind) and `/portfolio:status`.
