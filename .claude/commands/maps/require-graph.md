---
description: Require/touchpoint graph — static require edges over scripts/**, plus paths-consumer, hook-wiring and skill-call edges, with dynamic require sites flagged unresolved. Feeds the lean gauntlet's touchpoint selector.
---

# /maps:require-graph — Touchpoint Graph

Builds `paths.requireGraph` (`.claude/project/maps/require-graph.json`): a deterministic, static dependency graph over `scripts/**` (and `tests/**` when present). No LLM, no code execution — a lexer pass over source text. Walked by `scripts/sprint/touchpoint.js` (`touchpointClosure`) so the gauntlet package selector can answer "which files does a change to X touch".

**Generated and UNTRACKED**: this file is `.gitignore`d, never committed. `/maps:all`/`scripts/regen-maps.js` still write it locally for fast repeat reads, but nothing requires it to be present — `touchpoint.js`'s own `loadOrBuildRequireGraph()` builds a fresh copy IN-PROCESS (no write) whenever the local file is absent or older than the newest `scripts/**`/`tests/**` file, so a clean checkout or CI run degrades correctly rather than reading a missing or stale map.

## Input

`$ARGUMENTS` — optional:
- `--refresh` (or `--regenerate`) — rebuild the graph (also done by `/maps:all --regenerate` and `node scripts/regen-maps.js`, step 9)
- `--check` — build in memory and print counts; exit 1 if a static `require("./…")` edge cannot be resolved
- No flags: render the counts from the existing map (build if none exists)

## Run

```bash
node scripts/maps/require-graph.js            # regenerate paths.requireGraph
node scripts/maps/require-graph.js --check    # verify, do not write
node scripts/sprint/touchpoint.js --files scripts/sprint/hook-points.js --depth 1
```

## Edge kinds

| Kind | From → To |
|---|---|
| `require` | a script → the file it statically `require`s (relative literals only) |
| `paths-consumer` | a script (`PATHS.<key>`) or skill (`paths.<key>`) → the registry path of `<key>` (dir keys end in `/`) |
| `hook-wiring` | `framework/hooks.registry.json` → each hook script it registers |
| `skill-call` | a skill → a skill it calls, or a hook script it references (from `skills.jsonl`) |
| `spec-ref` | a skill → a `scripts/**.js` path its prose names |

Dynamic requires (`require(path.join(…))`, template or variable arguments) are never guessed: each lands in `unresolved[]` as `{file, expr, line}`. A static relative require whose target does not exist lands in `missing[]`.

## Freshness

The file carries `generatedAt` and `head` (git HEAD at generation). A consumer that sees `head` behind the diff base must treat the map as stale. `/maps:all` staleness (7 days) applies.

## Fail-safe contract

A changed file the graph does not know is flagged `unmapped: true` by `touchpointClosure`; the selector escalates to FULL on it. An empty closure is never returned for an unknown file.
