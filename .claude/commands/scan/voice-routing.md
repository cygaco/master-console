---
description: Voice-router contract health — the says: frontmatter lint plus the dictated-sentence fixture suite against the real generated catalog, and the registration-surface parity between hooks.registry.json and _mc/settings/defaults.json. Catches a malformed says: block, a phrase collision, an invented flag, a missing confirm ceiling, a stale catalog, a routing regression, or a product install silently missing the router.
---

# /scan:voice-routing — Voice Router Contract Health

Three lanes over the deterministic natural-language → skill router
the `says:` frontmatter lint, the dictated-sentence
fixture suite, and the hook registration-surface parity check. No LLM is
involved anywhere in this scan or in the router it audits.

## Run

```bash
node scripts/checks/skill-says-lint.js                  # lane 1 — says: contract lint
node scripts/checks/voice-router-fixtures.js             # lane 2 — real router vs real catalog
node scripts/checks/hook-registration-parity.js          # lane 3 — registry <-> defaults.json parity
```

Each runs as its own command with its own real exit code — never piped
through `tail`/`head` (CLAUDE.md § Tool Use: a pipeline's exit status would
mask a RED gate).

## What it asserts

**Lane 1 — `skill-says-lint.js`** (fail-closed on its own errors, exit 2):
says: phrase count (3-6), phrase shape (lowercase, 2-8 words, no
commas/colons/slashes), cross-skill phrase/slug collisions, every
`says-flags` value is in that skill's own documented flag set (no flag is
ever invented), `says-args` ∈ {none, free-text, topic}, the irreversible
ceiling (`says-confirm` must be `always` or `fuzzy-only` — never `never` — on
any skill whose SLUG matches push/remote/land/deploy/release/delete/
uninstall/authoriz/purchase/turbo/force by token prefix — `--enforce` is not
`force`; a skill whose only irreversible exposure is an EMITTABLE flag such as
`--force`/`--turbo` passes with `never` when that flag is in
`catalog.confirm_flags`, because `skill-router-core.applyFlagCeiling` caps it
at MEDIUM wherever it rides), and no alias forwarder illegally carries
`says:`. `fuzzy-only` (`mode:*` / `sprint:full` /
`session:turbo` / `turbo`): an explicit, exactly-spoken name runs HIGH; a
fuzzy match, or a confirm-first flag riding as a secondary modifier on another
skill, asks one line (MEDIUM). RAMP: the enforced scope (the migration list ∪ every
explicit `user-invocable: true` skill) is WARNED, not failed, until the project
sets an end date for the ramp (none by default) or runs the lint with
`--enforce-all` — a skill with no `says:` yet is expected pre-migration, not a
regression.

**Lane 2 — `voice-router-fixtures.js`** (fail-closed, exit 2 on a missing/
malformed catalog): runs the real `skill-router-core.js` against the real
`paths.skillCatalog` for every row of `fixtures/voice-router/sentences.jsonl`
— a skill match, its tier, its parsed flags, and its `$ARGUMENTS` (when the
row specifies one). Negative rows (approval words, a long ordinary paragraph,
a typed slash command, the `"status"` collision canary) prove the router does
**not** hijack an ordinary prompt. A row whose referenced skill is
absent from the catalog (a `CATALOG_MAX_ENTRIES` truncation edge) SKIPS with
a note instead of hard-failing.

**Lane 3 — `hook-registration-parity.js`** (fail-closed, exit 2): every
`enabled:true, owner:framework` row in `framework/hooks.registry.json` must
have a matching command, for the SAME event, in `_mc/settings/defaults.json`
— the gap that would leave a fresh Master Console install silently missing
the router. Generalizes beyond the router to every framework hook.

Exit `0` clean · `1` findings · `2` setup/parse error (**fail-closed** — none
of the three lanes may read green on their own corruption).

## When to run

- Inside `/scan:full` (Tier 2).
- After editing any skill's `says:` frontmatter, after regenerating the
  catalog, or after touching `scripts/hooks/skill-router.js` /
  `scripts/hooks/lib/skill-router-core.js`.

## Reference

- Engines: `scripts/checks/skill-says-lint.js` (+ `.test.js`),
  `scripts/checks/voice-router-fixtures.js` (+ `.test.js`),
  `scripts/checks/hook-registration-parity.js` (+ `.test.js`)
- Core: `scripts/hooks/lib/skill-router-core.js` (+ `.test.js`) — pure
  normalize/score/decide functions, no hand-maintained phrase literals
- Catalog: `scripts/generate-skill-catalog.js` (the `says*` → catalog v2
  fields, `--check` staleness mode)
- Fixtures: `fixtures/voice-router/sentences.jsonl`,
  `fixtures/hooks/skill-router/*.json`
