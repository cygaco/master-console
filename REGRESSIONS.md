# REGRESSIONS.md

> Regressions where a newer MC version dropped or broke behavior that an earlier version (or an earlier downstream fix) had. Logged per operator directive 2026-06-07. Distinct from `recurring-issues.jsonl` (system-bug instances) and the bug dataset: this file is specifically "X worked before version N, N broke it."
>
> Format per entry: ID · date found · severity · the regression · which version introduced it · which version/commit fixed it · root-cause class · enforcer.

---

## R-001 — `/portfolio:new` installer drops sibling-source resolution (consumer Create dead)

- **Found:** 2026-06-07 (reported from masterconsole, a downstream consumer)
- **Severity:** high (blocks the core "Create a new project" flow on every consumer)
- **Regression:** When a CONSUMER product (e.g. the Master Console cockpit) drives the engine to create a new project, `scripts/portfolio/new-lib.js#_installWarpOS` ran `WARPOS_ROOT/install.ps1` directly. A consumer is not a valid install *source* (it has no `.claude/framework-manifest.json`), so `install.ps1` correctly refuses with `Source repo missing required file: .claude\framework-manifest.json` — and Create cannot find an engine to install from.
- **Introduced in:** 0.15.2 — its WI-50 fix absorbed "use install.ps1 + fail-loud" from masterconsole's earlier local fix but **dropped the sibling-source resolution** (`_resolveInstallerRoot → ../MC`) that the masterconsole-local fix had. 3rd installer-class round (prior: WI-50 silent-no-op `0d77a1f`; WI-50 install.ps1 source check).
- **Fixed in:** commit `0edda7a` (on `main`, 2026-06-07) — added `_resolveInstallerRoot`: use the running root if it satisfies install.ps1's source contract, else fall back to a sibling canonical clone (`../MC`, `../mc`); fail loud otherwise. Canonical resolves to itself (no regression). To ship downstream in the next release (0.15.3).
- **Root-cause class:** contractless productization / partial absorption of a downstream fix across a version convergence (a downstream local fix was never fully upstreamed, so the next canonical version re-introduced the gap). Also logged as recurring-issue **RI-005**.
- **Enforcer:** `scripts/portfolio/new-lib.test.js` (12 tests incl. the exact consumer→sibling resolution case). Deeper structural fix (stop partial-absorption of downstream fixes) tracked under the contractless-productization roadmap thread.
