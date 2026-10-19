---
description: Tail the events log — last N events with timestamp, type, and message.
user-invocable: true
namespace: events
reads: [paths.eventsFile]
writes: []
says:
  - tail the events
  - show recent events
  - last events
  - events tail
---

# /events:tail

Print the last N events from `paths.eventsFile`. Default N = 20.

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/events/cli.js tail
  -n <count>            count (default 20)
  --source <file>       override events file (fixture testing)
```

## Output

Plain text, one event per line:

```
<ts>  <type>  <message>
```

## Exit codes

- `0` success (including empty events file — empty-state hint goes to stderr)
- `1` events file missing/unreadable
- `2` usage error

## Empty-state behavior

If `paths.eventsFile` is empty, prints to stderr:

```
events log is empty — start the system and try again
```

…and exits 0.

## Example

```bash
$ node scripts/events/cli.js tail -n 2 --source tests/fixtures/events/happy.jsonl
YYYY-MM-DDT00:02:00Z  tool_result  ok
YYYY-MM-DDT00:03:00Z  prompt  goodbye
```

## Implementation

Run:

```bash
node scripts/events/cli.js tail $ARGUMENTS
```

See: `tests/transcripts/events-tail.md` for captured-output verification.
