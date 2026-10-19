---
description: Audit configured dispatch models against the latest vendor catalogs — flag drift, deprecations, and dead ("ghost") ids. --refresh deep-ingests the live vendor docs first.
user-invocable: true
namespace: models
reads: [scripts/dispatch/catalog.js, runtime/models-research]
writes: [runtime/models-research]
---

# /models:check — are we on the latest models?

Audit the dispatch catalog (`scripts/dispatch/catalog.js`, the provider/model/effort
source of truth) against the **latest** model catalogs published by each vendor, and
report drift: deprecated/shut-down ids still in use, configured ids missing from the
current docs, and newer flagships than our defaults.

Two layers:
1. **Compare** (always) — deterministic, offline. `scripts/models/check.js` diffs the
   catalog against cached research snapshots at `runtime/models-research/<vendor>.json`.
2. **Refresh** (`--refresh`, or when snapshots are missing/stale) — deep-ingests the
   live vendor docs to rewrite those snapshots before comparing.

## Input

```
$ARGUMENTS
  --refresh              deep-ingest the live vendor docs first (see below), then compare
                         (skill-level flag; the compare engine accepts-and-ignores it)
  --json                 machine-readable output
  --max-age-days <n>     staleness threshold for snapshots (default 30; non-int → exit 2)
  --provider <id>        scope BOTH the refresh and the compare to one vendor: claude | openai | gemini
```

> `$ARGUMENTS` is forwarded verbatim to `scripts/models/check.js`, which understands
> `--json`, `--max-age-days`, `--provider`, and tolerates `--refresh` — so the compare
> step never exit-2s on the orchestration flags.

## Procedure

### 1. Refresh the research snapshots (if `--refresh`, or snapshots missing/stale)

Deep-ingest each vendor's docs — **do not rely on training knowledge or a single index
page**. For each of the three providers (run them in PARALLEL — independent), dispatch a
research agent (`Agent`, `subagent_type: general-purpose`, `run_in_background: true`) that:

- Fetches the vendor index, then **follows safe in-domain links to EACH individual
  model's detail page** (don't stop at the listing). Sources:
  - OpenAI — `https://developers.openai.com/api/docs/models/all`
  - Gemini — `https://ai.google.dev/gemini-api/docs/models` (per-model: `.../models/<id>`)
  - Claude — `https://platform.claude.com/docs/en/about-claude/models/overview`
- Extracts, **per model**: exact id, status (GA/preview/legacy/deprecated + sunset date),
  context window, max output, modalities, **dispatch-critical settings** (reasoning/
  `effort` levels for codex+claude; `thinking`/`thinking_level`/`thinkingBudget` for
  gemini — note Gemini-3 uses a string level, Gemini-2.5 an int budget), tools/caching/
  batch, knowledge cutoff, pricing, and `replaces`/`replaced_by`.
- Also emits `newest_flagship`/`newest_mini` (or `newest_opus`/`sonnet`/`haiku`),
  `deprecations[]` (with `migrate_to`), and `ghost_watch[]` (ids that 404 / shut down).
- Writes the structured result to `runtime/models-research/<vendor>.json` with a
  top-level `fetched_at` (today's date), and returns a tight summary.
- Follows ONLY official-domain links (safe). Never invents ids; marks low confidence
  when a detail page is unreachable.

Wait for all three, then continue.

### 2. Compare

```bash
node scripts/models/check.js $ARGUMENTS
```

It flags per provider: `ERROR` deprecated/shut-down id in use (must migrate) · `WARN`
configured id absent from latest docs, or snapshot missing/stale · `INFO` a newer
flagship exists than the default (keep if intentional).

### 3. Report + next step

Summarize the findings. If there are `ERROR`s, recommend `/models:update` to migrate.
If a newer flagship is flagged (`INFO`) and adopting it is a model-choice call, consult
Beta before changing a default (per the β-consultation protocol).

## Exit codes

- `0` clean (no ERROR) · `1` drift found (≥1 deprecated/shut-down id) · `2` usage/load error

## Example

```bash
$ node scripts/models/check.js
  ✓ all configured models are current — no drift, no deprecations.
0 error · 0 warn · 0 info
```

## See also

- `/models:update` — apply the latest (migrate ids, sync catalog, regen manifests)
- `/models:router` — open the model router panel (and ensure latest options are in it)
- `/models:route` — point one role at a specific model
