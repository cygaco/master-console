# Signal Channel — the pull-based accelerator for teammate rulings

**Status:** LIVE (Wave-2 #28). Additive; changes no existing dispatch/team behavior.

## The problem it solves

`SendMessage` to a **mid-work** teammate is **inbox-batched**: the message is
delivered only when that teammate next *yields* (see the auto-memory
"Teammate inbox batches, does not drop"). A conductor that idle-awaits a
ruling therefore blocks for the full round-trip — this cost **4 ruling
round-trips in one night**, minutes each.

Nothing is lost by batching; it is a *latency* problem. The signal channel is
a **pull-based accelerator** layered *beside* `SendMessage`, not a replacement:
the ruling is written to a file board the consumer can **poll** without waiting
for its own inbox to flush.

## The contract (accelerator, not replacement)

> **The sender still `SendMessage`s the ruling as before, AND posts it to the
> topic.** The consumer `wait`s on the topic instead of idle-awaiting the
> inbox. If the board is ever unavailable, the `SendMessage` path is unchanged
> and authoritative — the channel only makes the ruling arrive *sooner*.

- **Sender** (β / a Director / any teammate issuing a ruling): after deciding,
  `post` the verdict to the boundary topic **and** `SendMessage` it as usual.
- **Consumer** (the ε conductor / α at a decision point): at the boundary,
  `wait` on the topic with a timeout instead of blocking on the inbox. On
  timeout, fall back to the normal await — the channel never *removes* a path.

## CLI (`scripts/teams/signal-board.js`)

```
node scripts/teams/signal-board.js post <topic> <json|-->   [--from <who>]
node scripts/teams/signal-board.js read <topic> [--since <iso>] [--last N]
node scripts/teams/signal-board.js wait <topic> --timeout <s> [--poll <ms>] [--since <iso>]
```

- `post` writes one atomic file per signal (tmp + rename, no locks) and prints
  its path. `--` reads the payload from stdin. Set `--from`, or the
  `MC_SIGNAL_FROM` env var, to attribute the sender.
- `read` prints matching signals oldest-first as a JSON array.
- `wait` polls until a signal **newer than `--since`** (default: the moment the
  wait started) lands: **exit 0** with the signal on stdout, **exit 3** on
  timeout. Poll interval defaults to 1000 ms.

Signals live under **`paths.runtime`/signals/<topic>/** (`.claude/runtime/signals/…`,
a walk-skipped runtime dir — never committed). Each record is
`{topic, from, ts, payload}`; filenames are `<epoch-ms>-<rand>.json` so a
lexical sort is a time sort.

## Topic naming

`<sprint-id>/<boundary>` — e.g. `SP-20260716-001/design-boundary`,
`SP-20260716-001/gate`, `SP-20260716-001/release`. Topics may nest with `/`
(each segment becomes a directory). Keep topics **specific to one decision** so
a `wait` resolves on the right ruling and not an unrelated one; `.`/`..`
segments are rejected (no board escape).

## Robustness

- **BOM-safe reads.** This machine's PowerShell writes UTF-8 BOMs that break
  `JSON.parse` (documented hazard). Every read strips a leading BOM first, so a
  PowerShell-written signal still parses.
- **Fail-open.** A malformed or unreadable signal file is **skipped with a
  stderr warning**, never crashing the reader; a `wait` still resolves on the
  next well-formed signal.
- **No locks.** One file per signal + atomic rename means concurrent posters
  never collide and a reader never sees a half-written file.

## Enforcer

`scripts/teams/signal-board.test.js` is the named enforcer — a **self-testing
lib**: it exercises post→read round-trip, the `--since` filter, `--last`, the
`wait` **exit-3** timeout (via a real subprocess), malformed-file skip, and BOM
tolerance. Run `node scripts/teams/signal-board.test.js`; it prints
`OK [signal-board.test] N passed` and exits non-zero on any regression, so a
break in the channel's guarantees is self-detecting. Consumption is
self-detecting by construction (the lib's own contract is asserted); no
enforcement-debt entry is required.
