# Per-Sprint Exhaustive Test-Suite System — Convention & Enforcer

The per-sprint discipline for the 0.17.0 **Per-Sprint Exhaustive Test-Suite System**: every MC sprint keeps the regression-seed suite green and grows it with the framework. This doc is the **named enforcer** for that convention (CLAUDE.md § Policy & Enforcement Hygiene).

## The convention

Every MC sprint MUST:

1. **Keep the regression-seed suite green** — `node scripts/testsuite/run.js` exits 0, modulo documented `gap` / `n/a` / `manual` classes (those are backlog, not failures).
2. **Add a detector for any newly-recurring bug class** — a class that recurs **≥2 times** OR gets an `/issues:log` entry becomes, *in the same sprint*: a new row in `_requirements/07-testing/recurring-bug-classes.json` **plus a real runnable detector**. The seed grows **monotonically** with the framework — classes are added, never silently dropped.

The suite is the executable form of the ROADMAP regression seed. It is the framework's standing answer to "did we re-break a thing we already fixed?"

## Where it's mandatory

| Repo role (`manifest.repoRole`) | Enforcement |
|---|---|
| `canonical` / `framework` | **Mandatory.** A regression in a covered class blocks release. |
| `product` (or missing field) | **Opt-in.** `enforce.js` no-ops — consumer-only detectors (`n/a` in canonical) would falsely fail a product install. |

Role is resolved by `scripts/testsuite/role.js` (interim stub — see caveat below).

## The pieces

| Piece | Path | Role |
|---|---|---|
| Runner | `scripts/testsuite/run.js` | Executes each class's detector; reports per-class result + catch-rate. `--json` / `--quiet`. Exits 1 on regression. |
| Registry | `_requirements/07-testing/recurring-bug-classes.json` | The 26 recurring bug classes as an executable registry. |
| Enforcer | `scripts/testsuite/enforce.js` | Role-aware pass/fail wrapper around the runner. The thing CI / the release gate call. |
| Role stub | `scripts/testsuite/role.js` | `isCanonical()` / `roleLabel()`. **Interim** — see caveat. |
| Release gate | `scripts/mc/release-gates.js#regression_seed` | The named enforcer at release time (canonical-only). |
| Skill | `/scan:regressions` (`.claude/commands/scan/regressions.md`) | Human-facing run of the suite. |
| Aggregate | `/scan:full` Tier 3 | Folds the suite into the full scan. |

> **Interim-resolver caveat.** `role.js` reads `.claude/manifest.json#repoRole` directly. It is a stand-in for the still-open **shared repo-role resolver** (0.17.0 open item) — a single source of truth that `role.js`, `run.js`, and `enforce.js` would all consume. The gap is tracked in `paths.enforcementDebt` (ED-009). Replace `role.js`'s body when the resolver lands; keep its surface stable.

## The enforcer

`scripts/testsuite/enforce.js` spawns `run.js --json`, then:

- **Product repo** → prints an opt-in no-op line, exits 0.
- **Canonical/framework** → exits **1** if any covered class shows a **NEW** regression (mirrors `run.js`'s own `regressions` filter, minus known-baseline reds — see below), else exits 0 with a one-line green summary.
- `--strict` → additionally exits **1** on any **incoherent** registry row (`status !== "gap"` but no runnable `detector.run` array — claims coverage with nothing to run) **and** on any **stale baseline marker** (see below).
- `--json` → emits `{enforced, role, regressions, baselineReds[], staleBaseline[], incoherent[], exit, childStatus}`.
- Exit **2** = runner error — *never* a clean pass. This covers: `run.js` produced no parseable output; `run.js` exited with a status other than 0/1 (e.g. 2 = registry load error) even if it emitted JSON; or the verdict is structurally malformed (no `results[]` array, or `summary.regressions > 0` with an empty `results[]`). An enforcer that turns a runner error into a green is the worst failure mode; these guards keep it fail-closed.

### Known-baseline reds (tracked debt, not blocking)

A registry class may carry `"baseline": "red"` — a *known, accepted, pre-existing* failure (e.g. older sprints that predate a policy). The enforcer **reports** these but does **not** block release on them; it blocks only on **new** reds (a class that should be green going red). This implements the "don't increase the pre-existing reds" contract.

> **Stale-marker guard (anti-false-green).** A `baseline:"red"` marker is *audited debt, not a permanent mute*. When a baseline-marked class is **no longer failing**, its marker is **stale** — leaving it in place would silently suppress any *future* regression of that class. `enforce.js` surfaces every stale marker (a warning in default mode; **blocking under `--strict`**). When a class's debt is paid, **remove its `baseline` marker** in the same change, so the class becomes release-blocking again. Clearing the debt and keeping the marker is the failure this guard prevents.

Wired into `scripts/mc/release-gates.js` as the `regression_seed` gate (the last gate, canonical-only): enforce.js status 0 → green, 1 → RED (new covered-class regression), 2 → RED (runner errored). In product repos the gate skips-as-green so product releases are never blocked by a framework-only suite — **except** when `.claude/manifest.json` exists but is unreadable (a likely-canonical checkout with a corrupt manifest), which the gate surfaces as **MANUAL** rather than a silent green, so a human verifies the manifest before release.

> **Honesty, not suppression.** When canonical has *new* open regressions, the gate goes RED and stays RED. The suite reflects reality; do not hack `run.js` or the registry to hide an open regression, and do not park a live regression behind a `baseline` marker. Fix the class, or document it as `gap` / `n/a` / `manual` — and only baseline-mark genuinely pre-existing, owned debt.

## Result / status semantics

Mirrors `/scan:regressions`:

| Mark | Meaning |
|---|---|
| `PASS` | detector ran green — the class is held closed |
| `FAIL` | detector red = possible regression in a covered class → exit 1 |
| `n/a` | consumer-only detector, N/A in canonical (role-aware; interim until the shared repo-role resolver lands) |
| `gap` | no detector yet — the suite's build backlog |
| `man` | manual / orchestrated detector (e.g. `scan:references`) — not auto-run |

`gap` / `man` / `n/a` never fail the run — they are reported as backlog.

## Adding a detector

When a bug class recurs (≥2× or an `/issues:log` entry), add a row to `_requirements/07-testing/recurring-bug-classes.json#classes[]`:

```json
{
  "id": "BC-27",
  "name": "Short human name for the class",
  "category": "distribution | cross-platform | refactor-hygiene | policy | hooks | sprint | memory | provider | downstream | spec",
  "status": "covered | partial | gap",
  "detector": {
    "type": "script | guard-test | manual | none",
    "run": ["scripts/checks/your-detector.js", "--flag"],
    "expect_canonical": "pass | na",
    "notes": "What it asserts; any interim caveat."
  }
}
```

Rules:

- A new class with `status` other than `gap` MUST have a non-null `detector.run` (else `enforce.js --strict` flags it incoherent).
- `expect_canonical: "na"` for consumer-only detectors (resolve a capsule, check an update path) that don't apply in the canonical source.
- `detector.run` is a Node argv array run via `process.execPath`; exit 0 = class held closed, non-zero = possible regression.
- Land the row **and** the detector in the **same sprint** as the bug fix.

## Cross-references

- ROADMAP.md § *Mandatory regression seed* (the seed this suite executes)
- `/scan:regressions` — `.claude/commands/scan/regressions.md`
- `/sprint:full` autonomy — `_docs/sprint/AUTONOMY.md`
- Enforcement debt for the interim role stub — `paths.enforcementDebt` (ED-009)
