<!-- requirement-format-legacy -->
# PRD — Rebrand identifier layer: Master Console slug mc, mc@2.0.0 with one-release aliases + downstream migration

**Sprint:** `S-OS-06`
**Plan Contract:** `PC-20260913-0090`
**Status:** draft
**Documentation scale:** `m`

## Outcome

Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

## Context

### Original Request

> Confirmed: the identifier slug is `mc`. Start S-OS-06 (identifier layer, mc@2.0.0) as a real sprint via /mode:sprint then /sprint:full. Land only when CI is green. Anything needing a push to main, give me the command to run.

### Interpreted Intent

Apply the confirmed `mc` slug across every LIVE identifier surface of the engine — scripts, skills (warp:* -> mc:*, scan:warpos-* -> scan:mc-*), hooks/agents/settings, the paths registry values, the _warpos/ and .warpos/ directory names, WARPOS_* environment variables, tests, schemas, package.json name, and live docs/prose — while cutting the version to 2.0.0 (mc@2.0.0). Ship one-release deprecated aliases and read-both compat so existing installs and the 8 downstream products keep working through the transition, plus a migrations/1.2.0-to-2.0.0/ bundle proven on a fixture product. Historical records (retros, ADR bodies, PROVENANCE, CHANGELOG entries < 2.0.0, sprint history, learnings, warpos@ tags, runtime/**) stay verbatim so the prior-art evidence the whole open-source epic protects is not falsified.

### Current Behavior

The engine ships as `warpos` 1.2.0: 2,469 tracked files carry 28,618 'warpos' occurrences; 533 tracked paths have 'warpos' in the name; 104 WARPOS_* env vars; 19 warpos paths-registry lines; skills namespaced warp:* and scan:warpos-*; on-disk _warpos/ and .warpos/ dirs; package.json name warpos. S-OS-05 already renamed the GitHub repo to cygaco/master-console and landed the brand layer; the identifier layer is untouched. gate G5 (/scan:cutover-completeness) and framework-purity currently allow 'warpos' everywhere.

### Desired Behavior

Every LIVE surface uses `mc`: scripts/skills/hooks/agents/settings, paths registry values, _mc/ and .mc/ dirs, MC_* env, tests/schemas, package.json name mc version 2.0.0, live docs/prose. One-release deprecated aliases + read-both compat keep warp:*, WARPOS_*, _warpos/, .warpos/ and the warpos-*.js check scripts working with a deprecation warning. A migrations/1.2.0-to-2.0.0/ bundle upgrades the 8 downstream products with no manual step, proven on a fixture. /scan:cutover-completeness is green; framework-purity fails on 'warpos' in LIVE dirs while allow-listing historical dirs. Historical records stay verbatim. npm test + npm run leak-gate green; both manifests regenerated last; the warpos-tracked-transients workflow step still passes via the alias shim.

## Requirements

> Use existing requirement ID conventions enforced by
> `scripts/hooks/requirement-format-guard.js`. PRDs in `_requirements/`
> use `R-N` ids — sprint-scope PRDs that link to a feature in
> `_requirements/04-features/<feature>/PRD.md` should reuse those ids,
> not invent new ones.
>
> This list is generated from `plan_contract.requirement_areas` (N items → R-1..R-N).
> A sprint with >3 requirement areas will have more than 3 entries here — trace.md
> and granular-stories.md reference the same R-1..R-N set (single-source, T-298).

- `R-1` — R-1 codemod engine + inventory: an idempotent scripts/open-source/rename-mc.js with --dry-run (writes runtime/S-OS-06/rename-plan.json: path renames via git mv + content rules per category — env, skill namespace, dirs, paths keys, identifiers, prose) and --apply, plus a committed rule ledger and per-category before/after counts
- `R-2` — R-2 one-release aliases + read-both compat: warp:* -> deprecated-alias skills pointing at mc:*; scan:warpos-* -> scan:mc-* alias skills; warpos-*.js check scripts -> shims requiring mc-*.js (incl. the workflow-referenced warpos-tracked-transients.js); an env helper reading MC_X then WARPOS_X with a one-time deprecation warning; _warpos//.warpos/ fallback read; a role-aliases-style skill-id map
- `R-3` — R-3 paths registry rename: /paths:rename per key, scripts/paths/build.js regen, and a verify step that the renamed keys survive in the generated views (source-vs-generated + rename-both-layers rule)
- `R-4` — R-4 downstream migration: migrations/1.2.0-to-2.0.0/ renaming _warpos/->_mc/, .warpos/->.mc/, WARPOS.md->MC.md and rewriting settings/hook wiring for the 8 downstream products, proven on a fixture product copied from _warpos/BASELINE (Pantry Pilot) into runtime/S-OS-06/fixture-product/ (gate G5)
- `R-5` — R-5 gates + version + manifests: npm test green, npm run leak-gate green, /scan:cutover-completeness green, framework-purity fails on 'warpos' in LIVE dirs (historical dirs allow-listed), readme-drift green, package.json + manifests bumped to 2.0.0, CHANGELOG [2.0.0] entry, and BOTH manifests regenerated LAST (fm -> installed -> _mc) before each commit

## Non-Goals

- Rewriting historical records (retros, ADR bodies, PROVENANCE, CHANGELOG < 2.0.0, sprint history, learnings, runtime/**, warpos@ tags) to say 'mc' — they stay verbatim.

## Affected Surfaces

| Surface | Evidence Level |
|---|---|
| scripts/** (533 tracked paths carry 'warpos' in the name; ~1,300 occurrences under scripts/warpos, 511 under scripts/checks) | verified_from_repo |

## External Service Dependencies

See `.claude/project/sprint/external-services/` for ESD records.

## Approval Boundaries

See Plan Contract `approval_boundaries`.

## Linked Artifacts

- Plan Contract: `.claude/project/sprint/plan-contracts/PC-20260913-0090.yaml`
- High-level stories: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\high-level-stories.md`
- Granular stories: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\granular-stories.md`
- COPY: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\copy.md`
- INPUTS: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\inputs.md`
- TRACE: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\trace.md`
- Acceptance criteria: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\acceptance-criteria.md`
- QA plan: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\qa-plan.md`
- Redteam plan: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\redteam-plan.md`
- Release plan: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\release-plan.md`
