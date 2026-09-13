# Data Contracts

When a user edits a field anywhere in the app, that edit must reach every feature that uses it. This doc defines how that works and how to verify it.

## The problem

A field is editable in the UI. The user changes it. But downstream — when a grocery list gets generated, a catalog search runs, or a prompt goes to Claude — the old value is used, or the new value is never read at all, because nobody wired it up.

This has two failure modes:

1. **No pipe** — the consuming feature never reads the field from the session. The wire was never built. The edit is dead on arrival.
2. **Stale pipe** — the consuming feature read the field once (e.g., on page load) and cached it. The user edits it later, but the cached copy is what gets used.

## Rules

1. **Every consumer must have a wire.** If a field is editable and its data contract table says "consumed by X", then X's code must explicitly read that field from the session and include it in its payload/output. If the wire doesn't exist, it's a bug — not a future task. An editable field with no downstream consumer is dead UI.

2. **Always read at call time.** When building a feature that consumes user data, read the current session value when the API call or prompt is assembled. Never snapshot fields into component state that could go stale between edits and usage.

3. **Document the wire.** If a prompt payload includes any of these fields, the prompt template's contract must list which session fields it reads. This makes missing wires auditable.

4. **Wire ownership belongs to the consumer.** The builder of a consuming feature (e.g., list generation) is responsible for reading the fields it needs from the session. The builder of the producing screen (e.g., Direction) is only responsible for saving the field to the session correctly.

5. **Post-build wire check.** After all builders complete, the evaluator must verify every wire listed in every contract table across the app. For each row: grep the consumer's code for an explicit read of the session field. If the read doesn't exist, flag it as a bug. No wire = broken feature, not a future task.

## Where contract tables live

Each feature spec that produces editable fields includes a "Downstream data contracts" section with a table mapping fields to consumers. These are the current locations:

- [onboarding/INPUTS.md](../05-features/onboarding/INPUTS.md) — all onboarding screens (Recipes, Direction, Meal Types, Budget, Store, Quick Check, Dealbreakers, Profile Review)
- [auth/INPUTS.md](../05-features/auth/INPUTS.md) — sign up, sign in, OAuth
- [catalog-research/INPUTS.md](../05-features/catalog-research/INPUTS.md) — query editor, analysis, theme locking
- [deep-dive-qa/INPUTS.md](../05-features/deep-dive-qa/INPUTS.md) — mining Q&A answers
- [ingredient-curation/INPUTS.md](../05-features/ingredient-curation/INPUTS.md) — ingredient include/exclude, priorities, custom exclusions
- [list-generation/INPUTS.md](../05-features/list-generation/INPUTS.md) — theme selection, inline editing, download
- [recipe-cards/INPUTS.md](../05-features/recipe-cards/INPUTS.md) — card selection, swap answer editing, export
- [subscription-tiers/INPUTS.md](../05-features/subscription-tiers/INPUTS.md) — plan selection, upgrade flow
- [auto-cart/INPUTS.md](../05-features/auto-cart/INPUTS.md) — list selection, cart mode, extension setup, heuristics
- [profile/INPUTS.md](../05-features/profile/INPUTS.md) — post-onboarding profile editing

**Features with no user inputs (no INPUTS.md needed):**
- `readiness` — pure calculation/display, no user input
- `shell` — navigation and layout only
- `test-kitchen` — dev tools (not user-facing)
- `extension` — covered by auto-cart INPUTS.md

All contract tables follow the same format:

| Field(s) | Consumed by |
|---|---|
| Field name | Feature that reads this field and what it does with it |

## How to verify (evaluator checklist)

For each row in every contract table:

1. Identify the session field name (e.g., `session.preferences.mealTypes`)
2. Identify the consumer (e.g., "catalog search queries — Recipe Index API `meal_type` param")
3. Grep the consumer's code for an explicit read of that session field
4. If found: wire exists, pass
5. If not found: flag as bug — "Field X is edited on [screen] but never read by [consumer]"

This check runs after all builders complete, before the build is considered done.
