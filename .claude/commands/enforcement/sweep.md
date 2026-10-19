---
description: Find UNFILED debt — deferral comments, prompt suppressions, skipped tests, unenforced-policy claims, review residuals — and reconcile them against the enforcement-debt ledger, filing what's missing. A comment is not a ledger entry.
---

# /enforcement:sweep — Debt-Finding Sweep

Find debt that exists only where nobody looks for it: deferral decisions living in code
comments, suppressions living in staged prompts, known limits living in review artifacts —
none of it on `paths.enforcementDebt`. Reconcile every candidate against the ledger and file
what's missing via the `/enforcement:log` discipline.

**Doctrine:** a known defect retained with its rationale only in a code comment, with nothing filed, stays invisible to planning. **A comment is not a ledger entry: comments are read by whoever is already in
the file; ledgers by whoever is deciding what to work on.**

## Input

`/enforcement:sweep [--scope <dir-csv>] [--triage-only]`

- `--scope` — limit the sweep to specific roots (default: `scripts/`, `.claude/commands/`,
  `.claude/agents/`, `schemas/`, `runtime/gauntlet-*/`).
- `--triage-only` — produce the triage report but file nothing (read-only mode).

## Procedure

### Phase 1 — Sweep the five lenses **PARALLEL**

Dispatch ONE read-only sub-agent per lens (or one agent running all five sequentially if the
session is budget-tight). Each writes candidates to `runtime/enforcement-sweep/<YYYY-MM-DD>/<lens>.jsonl`
(one JSON object per candidate: `{lens, file, symbol_or_anchor, quote, why_debt}`) and returns a
≤8-line envelope (lens · candidate count · file path). Orchestrator holds envelopes, not content.

| Lens | What to grep/read | Debt signal |
|---|---|---|
| **deferral-comments** | code + skills: `for now`, `stays as-is`, `knowingly`, `deliberately not`, `we accept`, `known limit`, `does NOT extend/cover`, `TODO`, `FIXME`, `HACK`, `punt`, `defer`, `out of scope` | a scope decision recorded where only a reader-already-in-the-file sees it |
| **prompt-suppressions** | staged/regenerated prompts (`runtime/**/*prompt*`, `.claude/runtime/epsilon-prompts/`): `do NOT re-report`, `known non-binding`, `ignore`, `suppress` | every suppression must cite a live ED or be retired — a suppression outlives its truth |
| **skipped-tests** | test files: `.skip`, `skip:`, `(skip`, `xit(`, `xdescribe(`, precondition probes that can pass vacuously | a required check that folds into green without executing |
| **unenforced-claims** | ADRs, CLAUDE.md, skill docs: `no check enforces`, `not yet built`, `nothing runs`, `silent failure mode`, `convention with` | every named-but-unbuilt enforcer needs its ED (Policy & Enforcement Hygiene) |
| **review-residuals** | gauntlet verdict payloads + fix briefs (`runtime/gauntlet-*/out/*.json`, `*brief*.md`): `residual`, `disclosed`, `known limit`, `accepted risk` | a residual named in review is filed debt or it is invisible (ADR-0039) |

Anchor candidates by **symbol + quoted anchor text**, never line numbers — lines shift on merge,
and an anchor must survive the fix it describes.

### Phase 2 — Reconcile against the ledger

For each candidate, search `paths.enforcementDebt` for a row covering it (by symbol, file, topic
keywords — try at least two phrasings before trusting a zero; the ledger is gitignored, so grep
the FILE directly, not via ripgrep-over-repo, and remember ripgrep is case-sensitive by default).
Classify:

- **TRACEABLE** — an existing ED covers it. Record the ED id next to the candidate. Done.
- **FILE** — real debt, no row. Goes to Phase 3.
- **TRIAGE** — unclear whether it is debt (stylistic TODO, stale comment, already-fixed). Park
  for the operator/α with a one-line reason each. Never file a row you cannot defend.

### Phase 3 — File what's missing

Skip under `--triage-only`. For each FILE candidate, append a row to `paths.enforcementDebt`
following the `/enforcement:log` discipline exactly:

- Read next-free `ED-###` **at write time** (concurrent writers exist — never pre-announce ids).
- Full schema: `id, ts, logged_by, severity, status, policy, source, severity_rationale,
  missing_enforcer, note, candidate_enforcers, origin, refs` — genesis rows carry NO update
  markers (`record_kind` on a fresh row is a dup-lint violation).
- Run the dup-lint after the batch; it must exit 0 before the sweep reports success.

### Phase 4 — Report

One report block: candidates per lens · TRACEABLE / FILED (with new ED ids) / TRIAGE counts ·
the triage list verbatim (it is short or it is wrong) · ledger line count + dup-lint result.
Write the full detail to `runtime/enforcement-sweep/<date>/REPORT.md`; the chat report is the
envelope. Surface the single worst find first — the sweep exists to make one invisible deferral
visible, not to inflate counts.

## Failure handling

- A lens agent that returns nothing: re-run that lens once with a widened pattern before
  trusting the zero (silent false-negatives are the norm, not the exception).
- Ledger write conflicts: re-read next-free id and retry once; on second failure, park the rows
  in the run dir and report them as UNFILED.
- Never let a sweep block a session wrap — fail-open into the triage report.

## Enforcement of this skill itself

Wired as **Phase 4.5 of the full `/session:end` chain** (skipped under `--fast`). Drift check:
`/scan:skill-hook-coverage` counts this file; if the session:end reference is ever dropped, that
scan's skill-wiring diff is the detector. Debt-of-the-debt-finder is filed like any other.

## Related

- `/enforcement:log` — files ONE known gap interactively; this skill finds the unknown ones.
- `/enforcement:list` — reads the ledger this skill reconciles against.
- `/discover:orphaned` — the sibling sweep for orphaned WORK; this one is for orphaned DEBT.
