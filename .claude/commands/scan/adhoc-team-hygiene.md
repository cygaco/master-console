---
description: Read-only probe for adhoc-team accretion — flags teams whose members carry a -N de-dup suffix or a stale leadSessionId (the W-21 cross-session duplicate-teammate bug).
---

# /scan:adhoc-team-hygiene

Read-only probe — mutates nothing:

```bash
node scripts/checks/adhoc-team-hygiene.js   # --json for machine output
```

Scans `~/.claude/teams/*/config.json` and flags:
- members whose name carries a `-N` de-dup suffix (`Beta (β)-2`) — a prior
  same-named member was never reconciled before re-spawn;
- members whose prompt references a session id ≠ the team's current `leadSessionId`
  — cross-session drift.

Both are the **W-21** accretion signature. Exits 1 when any team is flagged.
**Reconcile via `SendMessage {type:"shutdown_request"}`, never by editing
`config.json`** (that orphans a still-running in-process agent) — see `/mode:adhoc`
Step 1.75 (reconcile-before-spawn). Surfaced in `/mc:health`.
