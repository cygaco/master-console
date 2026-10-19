---
description: Query the events log by type, time range, or regex match.
user-invocable: true
namespace: events
reads: [paths.eventsFile]
writes: []
says:
  - query the events
  - search the events
  - find events about
  - events query
says-args: free-text
---

# /events:query

Filter `paths.eventsFile` and print matching events.

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/events/cli.js query
  --type=<str>          filter by event.type
  --since=<ISO>         events with ts >= ISO
  --until=<ISO>         events with ts <= ISO
  --grep=<regex>        match against JSON-serialized event
  --source=<file>       override events file (fixture testing)
  --archive             union live events with archived raw (COMPLETE history)
  --root=<dir>          project root for the archive tier (default: cwd; with --archive)
  --json                emit one JSON per match (default text)
  --help                flag reference
```

## `--archive` — complete live + archive history

By default `query` reads only the LIVE events file. Once the compactor
(`events-compact.js`) has folded older events into the archive tier
(`.claude/runtime/archive/`), the live file holds only a bounded tail plus a
`compaction-summary` pointer. Pass `--archive` to union the live events with the
archived raw generations so `live ∪ archive` = the COMPLETE history. All existing
filters (`--type/--since/--until/--grep/--json`) apply across the union, which is
sorted by `ts` then `id`.

Reader experience: when an archived generation's raw is present in the union, the
redundant `compaction-summary` for it is suppressed (you see the raw, not the
pointer). A summary whose raw is genuinely absent (e.g. an `index_pending`
record) stays visible as a pointer.

### Fail-closed on a corrupt tier

The archive read path is STRICT about completeness — it does NOT inherit
`archive.js#readIndex`'s torn-line tolerance. If the archive index is corrupt in
any of these ways, `query --archive` FAILS CLOSED — it prints an explicit error to
stderr, exits NON-ZERO, and emits NO output (a two-phase validate-then-emit design
guarantees no partial history leaks before the corruption is discovered):

- an index line that fails `JSON.parse` (a torn/partial index line),
- an index entry whose archived generation is missing / unreadable / not a regular
  file / escapes root (dangling),
- an index file that is itself unreadable.

A torn index must never masquerade as a complete "clean" history.

### Cold-start (no archive tier yet)

On a fresh/never-archived system there is no archive index. That is NOT an error —
it is a distinct COLD branch: `query --archive` prints `no archive tier yet —
showing live events only` to stderr, returns the live events, and exits `0`. Cold
(absent) and corrupt are distinct coded paths — absent is exit 0, corrupt is
non-zero.

## Output

Plain text (default): one match per line, `<ts>  <type>  <message>`.
With `--json`: one JSON object per match.
Match count goes to stderr (`# N match(es)`).

## Exit codes

- `0` success (zero matches is success — empty filter result is not failure; a COLD
  `--archive` run with no archive tier is also `0`)
- `1` events file missing/unreadable, OR (`--archive`) a corrupt/dangling/unreadable
  archive tier (fail-closed, no partial output)
- `2` usage error

## Empty-state behavior

If `paths.eventsFile` is empty, prints to stderr `events log is empty — start the system and try again` and exits 0.

If filters match zero events, stderr says `# 0 match(es)` and exits 0.

## Example

```bash
$ node scripts/events/cli.js query --type=prompt --source tests/fixtures/events/happy.jsonl
YYYY-MM-DDT00:00:00Z  prompt  hello
YYYY-MM-DDT00:03:00Z  prompt  goodbye
```

## Implementation

Run:

```bash
node scripts/events/cli.js query $ARGUMENTS
```

See: `tests/transcripts/events-query.md` for captured-output verification.
