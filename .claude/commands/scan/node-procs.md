---
description: Read-only diagnostic — list Node processes on the host with PID, start-time, working-set KB, and command.
user-invocable: true
namespace: check
reads: []
writes: []
---

# /scan:node-procs

Read-only diagnostic (Hook & Process Hygiene).
Lists every Node process currently running on the host with:

- **PID**
- **START** (start-time / elapsed time, platform-dependent)
- **WS-KB** (working-set KB)
- **COMMAND** (truncated to 120 chars)

Sorted by start-time ascending. Diagnostic only — **NEVER modifies state.**
By design: no `--kill-orphans` flag
in v1 (kill flow belongs in a separate ops skill).

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/check/node-procs.js
  --json   machine output (JSON array, no summary line)
```

## Output

Prose default:

```
PID        START         WS-KB     COMMAND
12345      00:01:23        45000   node scripts/hooks/format.js
67890      00:00:42        12000   node scripts/sprint/test-plan-honors-registry-primary.js
# 2 node procs
```

JSON: array of `{ pid, start, ws_kb, command }`.

## Empty-state behavior

No Node procs detected → `# 0 node procs` line; exit 0.

## Implementation

```bash
node scripts/check/node-procs.js $ARGUMENTS
```

## Platform notes

- **Windows:** uses `tasklist /FO CSV /FI "IMAGENAME eq node.exe"`. The
  CSV parsing is best-effort; locale-dependent column headers may produce
  unexpected output on non-en-US Windows installs.
- **POSIX:** uses `ps -e -o pid,etime,rss,comm,args` filtered to entries
  whose `comm` or `args` contains `node`.

## When to use

- You suspect leaked Node processes (the leak class that the
  `scripts/hooks/format.js` ETIMEDOUT cleanup closes).
- You want a snapshot of session-side Node activity (which agents, which
  hooks, which long-running scripts are alive).
- Diagnosing RAM pressure during a long sprint run.

## When NOT to use

- Killing orphaned processes — this skill does not have that flag in v1.
  Use platform tooling (`taskkill /F /PID …` on Windows, `kill -9 …` on
  POSIX) and consider whether the orphan path itself needs a fix.

## Notes

- v1 does NOT auto-register `/scan:node-procs` in `/scan:full`. Run
  ad-hoc.
- The diagnostic surface is read-only — no environment changes, no
  configuration writes.
