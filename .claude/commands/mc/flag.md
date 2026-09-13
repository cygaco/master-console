---
description: Flag a MC framework/tooling gap from a downstream product — append a structured, canonical-consumable entry to this repo's MC.md so /mc:reconcile can verify and fix it upstream.
---

# /mc:flag — Flag a framework gap upstream

You hit a problem with the **MC framework/tooling layer** (`.claude/`, `scripts/`,
hooks, the paths registry, the dispatch bridge, the sprint pipeline, the install/update
engine) while working in a **downstream product repo**. This skill records it in this
repo's root `MC.md` — the **upstream gap register** — in a shape a canonical-side
Alex agent can verify and fix with **zero re-investigation**, then later consume via
`/mc:reconcile`.

MC sync is one-way (canonical → product); products never push code upstream. So a
downstream fix never reaches the next product. `MC.md` is the durable channel that
carries the *gap* upstream so canonical can fix it once, for everyone.

## Input

`$ARGUMENTS` — freeform description of the gap (what you were doing, the symptom).
Optional flags: `--severity H|M|L`, `--subsystem <name>`, `--id <WG-N>` (force an id),
`--product-bug` (override the layer test only if you're certain — see Step 1).

## The contract (what makes an entry canonical-consumable)

An entry that a canonical agent can act on without re-deriving carries **nine fields**.
The last one is the most important and the most often skipped.

1. **ID** — `WG-N`, stable and monotonic within this file.
2. **Severity** — `H` (blocks a subsystem/command) · `M` (friction / partial failure) · `L` (polish / latent).
3. **Subsystem** — `sprint-full` · `dispatch` · `install` · `update` · `hooks` · `paths` · `scaffold` · `guards` · …
4. **Symptom** — the **verbatim** error + what you were doing. Paste the real stack trace / CLI output; don't paraphrase it away.
5. **Root cause** — the **framework** `file:line`/function, not the product symptom site. Trace it down into `scripts/**` / `.claude/**`.
6. **Local status** — `fixed-local` · `open` · `worked-around` — the state in **THIS product** (the user's "local" = fixed within this project itself).
7. **Upstream status** — `open` · `escalated` · `fixed-canonical` — the state in **MC canonical** (the user's "upstream" = fixed in mc).
8. **Recommended upstream fix** — the concrete change in canonical. Include the patch/code when you know it (one-block diffs are gold).
9. **Verify-in-canonical hint** — *how a canonical agent confirms the gap still reproduces @current.* **This install may be stale; the gap may already be fixed upstream.** Name the file/function/check to inspect, or the command that proves it. (This is the antidote to wasted re-builds — MC ED-008: roughly half of one register's gaps were already fixed in canonical.)

## Invariants

- **Framework-layer only.** `MC.md` is for gaps in the AI operating system — **not** product bugs. Product source / API routes / specs / UI bugs belong in `issues.md` / `_requirements/00-canonical/FAILURE_STATES.md`. State the layer decision explicitly in the entry's first line.
- **Stable filename.** Always the repo-root `MC.md`. Do not repurpose it for anything else (a product-positioning doc named `MC.md` is a collision that breaks `/mc:reconcile` discovery — keep positioning elsewhere).
- **Summary table at the top** — one row per gap (`ID · Severity · Subsystem · Symptom · Local status · Upstream status`) for fast triage.
- **Append + dedupe.** Append new gaps; before adding, scan existing entries for the same root cause and **update** rather than duplicate.
- **paths.X rule.** Reference framework paths by registry key (`paths.eventsFile`, …), not brittle literals.

## Procedure

### Step 1 — Layer test (gate)
Decide: does the gap live in the framework layer (`.claude/`, `scripts/`, hooks, dispatch/sprint/update/paths machinery)? → continue. Is it product code (`src/`, API, specs, UI)? → **stop**, route it to `issues.md` / `FAILURE_STATES.md`. Only `--product-bug` overrides, and only when you're certain it's a framework gap that merely *surfaces* in product code.

### Step 2 — Locate / create `MC.md`
Open the repo-root `MC.md`. If absent, create it with: a one-line purpose, the installed MC version + source (read `version.json` / `.claude/framework-installed.json#installedVersion`), the severity legend, the local-vs-upstream status legend, and an empty summary table. If present, read the header convention + the highest existing `WG-N`.

### Step 3 — Reproduce & trace
Capture the **verbatim** symptom (Step-2 field 4). Trace into the framework to the real `file:line` root cause (field 5) — open the script/hook, don't guess. Note what you did to work around it (if anything) for the Local-status field.

### Step 4 — Classify
Assign severity + subsystem. Pick the next `WG-N` (after a dedupe scan; reuse/update an existing id if it's the same root cause).

### Step 5 — Write the entry
Append a section with all nine fields. Make field 9 (verify-in-canonical) concrete — a canonical agent should be able to run/inspect exactly what you name to decide REPRODUCES vs FIXED. Update the summary table row.

### Step 6 — Report
Print the entry id + one-line summary, and remind: **the fix happens in canonical via `/mc:reconcile`** (run from the MC repo), which discovers this `MC.md`, verifies each gap @current, triages, and drives the fix. Note once (only if `MC.md` was just created) that canonical also ships machine-queryable stores — `paths.recurringIssuesFile` (`/issues:log`) and `paths.enforcementDebt` (`/enforcement:log`) — for teams that prefer tooling over the human-readable register.

## Notes
- Keep entries **dense and specific** — a canonical agent reads dozens at once; every line should change what they verify or fix next.
- A gap that recommends a *policy* should name its **enforcer** (hook / test / check / gate) per CLAUDE.md § Policy & Enforcement Hygiene — "fix it" without an enforcer just re-opens later.
- Sibling skill: [`/mc:reconcile`](reconcile.md) — the canonical-side consumer of every `MC.md` across the portfolio.
