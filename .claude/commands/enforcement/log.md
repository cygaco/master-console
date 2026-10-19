---
description: Record a policy/convention that has no automated enforcer — appends to paths.enforcementDebt
says:
  - log enforcement debt
  - log an ed
  - this has no enforcer
  - enforcement log
says-args: free-text
says-confirm: always
---

# /enforcement:log — Log Aspirational Policy

Record a rule, convention, contract, or invariant that exists in writing but has no mechanism that detects violations. Closes the aspirational-vs-enforced gap at write-time so the pattern stops repeating one sprint at a time.

## When to use

Invoke this any time you write or notice a policy that says "X must always (or never) happen" — in a skill body, doc, hook spec, agent prompt, CLAUDE.md, ADR, PRD, agent contract — and you can't name a mechanism that makes a violation self-detecting.

Enforcers are mechanism-agnostic. A valid enforcer is *anything* that produces a loud signal on violation:
- Hook (pre/post-tool, pre/post-commit)
- Test (unit, integration, regression, fixture)
- Schema validator (JSON-schema, YAML, types)
- CI check (gate, lint, build refusal)
- Agent contract clause (compliance/reviewer rule)
- Script that exits non-zero
- Telemetry signal someone actually reads
- Release gate

## Input

`$ARGUMENTS` — natural-language description. The skill parses it for:

- `policy` *(required)* — one-line summary of what should always (or never) happen
- `source` *(required)* — where the policy lives (file path, skill name, doc heading, ADR id)
- `missing_enforcer` — kind of mechanism that would fit best (hook, test, schema, ci-check, agent-contract, release-gate, telemetry-read, none-yet-decided)
- `candidate_enforcers` — list of mechanisms that could close the gap (free-form strings)
- `severity` — `low` | `medium` | `high` (default: `medium`)
- `note` — free-form context, related learning IDs, links

If any required field is missing from the natural-language input, ask once for the minimum (`policy` + `source`).

## Steps

1. Resolve `paths.enforcementDebt` (`.claude/project/memory/enforcement-debt.jsonl`). If the file does not exist, create it empty.
2. Get the next id by running `node scripts/enforcement/next-ed-id.js` (prints `ED-NNN` = the true max existing ED id + 1, malformed-line-safe). Do **NOT** count lines — append-only closure/amendment rows inflate the line count above the id count, so line-count minting re-issues a live id. The genesis-keyed `scripts/enforcement/ed-dup-id-lint.js` (in `/scan:full`) is the backstop if a collision slips in anyway.
3. Build the record. Required keys: `id`, `ts` (ISO 8601 UTC), `policy`, `source`, `severity`, `status: "open"`. Optional: `missing_enforcer`, `candidate_enforcers` (array), `note`.
4. Append the JSON record as a single line to `paths.enforcementDebt`.
5. Echo back: `Logged ED-NNN. Policy: <short summary>. Severity: <s>. Status: open.`

## Status taxonomy

- `open` — debt is live; no enforcer ships yet.
- `enforced` — a mechanism now detects violations. Resolve via direct JSONL edit: change `status` to `enforced` and add `enforced_by` (reference to the enforcer — hook path, test name, agent rule, etc.) + `enforced_at` (ISO date).
- `retired` — the policy itself was retired; no longer load-bearing. Set `status: "retired"` and add `retired_reason`.

## Anti-patterns

- **Don't auto-promote.** Logging debt is not approval to ship without an enforcer. It's a record that you noticed. The right next move is still to enforce; logging just stops the gap from disappearing.
- **Don't log noise.** Style preferences, formatting, taste calls — not policies. A policy has a violation case that produces a real bad outcome (lost work, drift, broken consumer, silent regression). If the worst case is "code looks slightly different," skip.
- **Don't enumerate exhaustively.** Better to log the 5 highest-severity gaps and act on them than to log 50 and act on none.
- **A comment stating the invariant is not an enforcer of it.** "These two sites must share one transform" written as a code comment detects nothing. If you catch yourself writing the invariant into prose next to the code, either make the divergence self-detecting (one shared call site, a test that fails on the fork) or log the debt here — those are the only two honest endings.
- **A "clean" enforcer that enumerated zero candidates must report UNKNOWN.** Zero findings over zero inputs is not a pass.

## Before you accept an enforcer as closing the debt

Three failure modes that make an enforcer look green while the gap stays open. Check each before flipping `status: "enforced"`:

1. **Coverage derived from a shape predicate must REFUSE near-misses, not skip them.** A regex/AST match over the artifact it protects silently narrows the population it judges, and the gate then reports success over the narrowed set. Pair every derived-coverage enforcer with a committed near-miss mutation battery (variant dashes/colons/indent/spacing/casing) that goes RED when the predicate narrows. Watching the enforcer catch one real case is confirmation, not coverage (the full discipline is `paths.reference`/`reasoning-frameworks.md` § *Confirmation is not coverage*).
2. **A text-matching enforcer cannot tell a violation from a description of one.** Prose written ABOUT the banned pattern trips the ban — including the doc explaining the enforcer and this ledger entry. Document the trap in the scanner's OWN header so the next author meets it in the code rather than at a red gate.
3. **State the enforcer's coverage at the grain it actually has.** "Covers the two scripts" over a letter-level sample is a false coverage claim in the debt record itself. Name the enumerated unit; never a count.

## Related

- `/enforcement:list` — view the ledger, filter by severity/status/source
- CLAUDE.md § Policy & Enforcement Hygiene — the rule this skill operationalizes
