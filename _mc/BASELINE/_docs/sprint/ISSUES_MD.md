# Sprint v0.1 — Issues Ledger Integration

Sprint v0.1 introduces a per-project `issues.md` at the repo root,
paired with structured per-issue YAML files under
`paths.sprintIssues`. Both are kept in sync by
`scripts/sprint/issue.js`.

`issues.md` is the human-readable inbox. The YAML files are the
machine-readable companion.

## What `issues.md` is

- A human-readable lightweight bug ledger.
- Sections: Open, In Progress, Fixed / Verified, Deferred / Abandoned.
- One block per issue, with the issue id, title, status, severity,
  discovered-at, sprint, related ticket, expected/actual.
- The canonical companion is `.claude/project/sprint/issues/<I-id>.yaml`.

## What `issues.md` is NOT

- It is NOT the SYSTEM-level recurring-issues store. That remains at
  `paths.recurringIssuesFile` (`.claude/project/memory/recurring-issues.jsonl`)
  and is owned by `/issues:log`, `/issues:list`, `/issues:resolve`,
  `/scan:issues`.
- It is NOT a Jira clone.
- It is NOT the source of truth — the YAML files are.

## Distinction summary

| Store | Path | Owner | Scope | Updater |
|---|---|---|---|---|
| Recurring (SYSTEM) | `paths.recurringIssuesFile` (jsonl) | runtime | MC framework / hooks / skills / .claude / scripts | `/issues:log`, `/issues:resolve` |
| Sprint (PRODUCT) | `paths.sprintIssues/<I-id>.yaml` | runtime | per-project product bugs/regressions/QA | `scripts/sprint/issue.js` |
| Sprint ledger (PRODUCT) | `paths.sprintIssuesLedger` (`issues.md`) | project | human-readable mirror of sprint issues | `scripts/sprint/issue.js` |

## Lifecycle

```
Problem discovered
  → scripts/sprint/issue.js create     (writes .yaml + appends to issues.md)
  → status: open
  → fix_attempts grow as work happens
  → status: in_progress | fixed | verified | deferred | abandoned | duplicate | superseded
                              | waiting_on_human | waiting_on_external_service
  → optionally: scripts/sprint/issue.js promote --to-ticket-type bug
                (mints a ticket linked to the issue; issue.promoted_to_ticket recorded)
  → ticket runs through /sprint:execute
  → ticket completes
  → issue.resolution + issue.resolution_date set
```

## Adding an issue

```bash
node scripts/sprint/issue.js create \
  --title "Signup redirect fails for SSO users" \
  --severity high \
  --source qa_finding \
  --expected "User lands on /dashboard after SSO callback" \
  --actual "User lands on /signup with 'Already signed in' banner" \
  --related-ticket T-20260511-001
```

This:
- Writes `.claude/project/sprint/issues/I-20260511-001.yaml`.
- Appends a block to `issues.md` under "Open".
- Sets `issues_md_block: "issues.md#i-20260511-001"`.

## Promoting an issue to a ticket

```bash
node scripts/sprint/issue.js promote \
  --id I-20260511-001 \
  --to-ticket-type bug
```

This prints the `node scripts/sprint/ticket.js create ...` command to
run. The reason it doesn't shell out automatically: each ticket
creation needs explicit linking (requirements, story, AC) that the
operator chooses.

After running the printed command, set the issue's status:

```bash
node scripts/sprint/issue.js update --id I-20260511-001 --status in_progress
```

## 3-attempt rule

`scripts/sprint/issue.js update --add-fix-attempt "<approach>"` records
each attempt. On the 3rd failed attempt the script prints a warning to
stderr.

Resolution: either mark the issue `deferred` / `abandoned`, or
escalate via `/fix:deep`. Don't brute-force a 4th attempt.

## Keeping `issues.md` honest

If an issue YAML's status changes, also re-emit its `issues.md` block:

```bash
node scripts/sprint/issue.js appendmd --id I-20260511-001
```

(Sprint v0.1's appendmd appends rather than replaces. If a downstream
project wants in-place mirroring, that's a follow-up enhancement.)

## What goes in `issues.md` vs the YAML

| Field | YAML | issues.md |
|---|---|---|
| id, title | yes | yes |
| status, severity | yes | yes |
| source, discovered_at | yes | yes |
| sprint, related ticket | yes | yes |
| expected, actual | yes | yes |
| steps_to_reproduce | yes | no |
| fix_attempts | yes | no |
| files_touched | yes | no |
| resolution | yes | no (until status:verified) |

`issues.md` carries the human-readable summary; the YAML carries the
full state.

## See also

- `schemas/sprint/issue.schema.json`
- `scripts/sprint/issue.js`
- `paths.sprintReference`
- `paths.recurringIssuesFile` documentation (`/issues:log` skill)
