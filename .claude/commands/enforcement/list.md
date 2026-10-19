---
description: List open enforcement-debt entries — policies/conventions without an automated enforcer
says:
  - list enforcement debt
  - show open eds
  - what's unenforced
  - enforcement list
says-confirm: always
---

# /enforcement:list — View Enforcement Debt

Read the enforcement-debt ledger and display entries, sorted by severity then age. Helps you see which aspirational policies are still aspirational so they don't quietly accumulate forever.

## Input

`$ARGUMENTS` — optional filters (any combination):

- `--status open|enforced|retired|all` (default: `open`)
- `--severity low|medium|high|all` (default: `all`)
- `--source <substring>` — case-insensitive substring match against the `source` field

## Steps

1. Resolve `paths.enforcementDebt` (`.claude/project/memory/enforcement-debt.jsonl`). If missing or empty, print `No enforcement debt logged.` and stop.
2. Parse each JSONL line into an entry. Skip and warn on malformed lines (don't fail the whole list).
3. Apply filters from `$ARGUMENTS`.
4. Sort: `severity` desc (high → medium → low), then `ts` ascending (oldest first — oldest debt is loudest).
5. Display as a compact table:

   ```
   ID      SEV     STATUS  SOURCE                              POLICY
   ED-NNN  high    open    CLAUDE.md § Decision Authority      β consultation required before AskUserQuestion
   …
   ```

   Truncate `policy` and `source` to ~50 chars in the table; show full text for any entry with a `note` below the table.

6. Summary line: `<N> open · <H> high · <M> medium · <L> low`.

## Output extensions (optional)

- `--json` — dump filtered entries as a JSON array, one object per entry, no table.
- `--candidates` — for each entry, list its `candidate_enforcers` underneath. Helps when sizing the next prevention pass.

## Related

- `/enforcement:log` — append a new entry
- CLAUDE.md § Policy & Enforcement Hygiene — the rule this skill enforces visibility over
