# Reader Discipline — query-first for the events log

> Doctrine + enforcer.
> Prime directive it serves: the events log is the raw truth (kernel **CORE-4 / P7.4**);
> reads must stay **complete** and **cheap**, and must not bypass the tier the compactor
> now maintains.

## The rule

**Query first. Full-log reads are the exception.**

To read what happened, use — in this order:

1. **Materialized state files** (`scripts/state/materialize.js` → `what-running` /
   `what-happened`). Deterministic, regenerable-from-events, cheap. Read these for
   "what is in flight" / "recent digest" questions.
2. **`events:query`** (`scripts/events/cli.js query …`) — the sanctioned query surface.
   Use `--type / --since / --until / --grep / --json` to filter, and **`--archive`** to
   union the live log with the archived tier for **complete** history. `query --archive`
   fails **closed** on a corrupt/dangling index (never a silent partial "clean" history),
   so a query answer is either complete or a loud error — never a quiet half-truth.

A **direct full-log read** — `fs.readFileSync(paths.eventsFile)`, `readJsonl(EVENTS_FILE)`,
streaming `events.jsonl` by hand — is the exception. It is permitted **only** for the
sanctioned infrastructure that *is* the read/write/rotate/compact/archive machinery.

### Why full-log reads are now the exception (not just style)

The event compactor (`scripts/events/events-compact.js`) folds old raw events into the
**archive tier** and keeps only a bounded live TAIL. A hand-rolled read of `events.jsonl`
therefore sees **only the recent tail** — it silently misses folded history and reports a
**partial** answer as if it were complete. `events:query --archive` is the only read path
that unions live ∪ archive and fails closed on incompleteness. Query-first is what keeps a
reader from mistaking "the tail" for "the history."

## Sanctioned readers (CLOSED allowlist)

Only these files may read the events log literal directly. They are the events subsystem
itself — the query surface, the logger/rotate/archive/retention machinery, the compactor,
and the materializers:

- `scripts/events/cli.js`
- `scripts/hooks/lib/logger.js`
- `scripts/hooks/lib/rotate.js`
- `scripts/hooks/lib/archive.js`
- `scripts/hooks/lib/retention.js`
- `scripts/materialize-decisions.js`
- `scripts/state/materialize.js`
- `scripts/state/materialize-core.js`
- `scripts/events/events-compact.js`
- any `*.test.js` (tests read fixtures/log directly by design)

**Everything else** should answer its question through a materialized state file or
`events:query`. If a new consumer genuinely needs raw-log access, it belongs in the events
subsystem (and the allowlist), not scattered across analytics/reporting scripts.

## The enforcer — and its honest limit

**Enforcer:** `scripts/checks/reader-discipline.js`.

It is a **sound-direction** check, not a sound-complete one. It carries the CLOSED allowlist
above and scans `scripts/**/*.js` for the realistic **hand-rolled full-log read** — a
read-call form (`readFileSync` / `readFile` / `createReadStream` / `readJsonl` / `readLines`)
whose argument references the events-file literal (`events.jsonl`, `paths.eventsFile`,
`EVENTS_FILE`). Any file **not** on the allowlist that matches is flagged with `file:line`.

Design choice: **precision over completeness** — the allowlist is exact and comments are
stripped before matching, so the check aims for **zero false positives**. It defaults to
report-only (prints findings, exits 0, matching the `log-sink-caps` idiom) and takes
`--enforce` to exit non-zero on any un-sanctioned reader.

**What it cannot soundly catch (the residual).** Full-log reads have unbounded
spellings the check cannot decide: a path computed at runtime and stored in a variable
(`const p = PATHS.eventsFile; fs.readFileSync(p)`), a read performed in a subprocess, a
re-exported `LOG_FILE` alias, or the literal built by string concatenation. Detecting all of
these is undecidable, so the residual is named here rather than
claimed as covered.
This bounded honesty is the point — a policy names its enforcer **and** its gap.
