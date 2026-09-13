# Forcing Function: Parallel npm-Package Distribution Shape

**Status:** PARKED. Captured 2026-05-19. Decision criterion below.

**Source:** `/product:ponder` session 2026-05-19 (trace RT-011 in `paths.tracesFile`), DICTIONARY.md § Forcing function.

---

## The idea

Stand up `@mc/cli` as a **parallel distribution path** alongside the current canonical-clone + capsule model. Goal is **not adoption** — it's a forcing function: building it makes "which of our current sprints would be wasted under the npm shape?" an unavoidable question.

## What it would replace if adopted

| Current | npm shape |
|---|---|
| `/mc:update` | `npm update @mc/cli` |
| `/mc:release` | `npm version && npm publish` |
| `/warp:promote` | disappears (frame: edit canonical repo, `npm publish`, downstream `npm update`) |
| Capsules + `framework-installed.json` + ghost-file detection | npm handles atomically |

## Integration paths with Claude Code

Three candidates, ranked cleanest → fallback:

1. **Plugin system.** Claude Code's Skill tool already references `plugin:skill` namespacing. If the plugin loader is mature enough, MC becomes a plugin distributed via npm; the harness loads skills/hooks/agents automatically. *Cleanest if it works.*

2. **Symlinks.** `npx mc init` symlinks `.claude/commands/` to `node_modules/@mc/cli/commands/`. **Cross-platform fragile on Windows** (needs developer mode enabled for symlink creation by non-admin users).

3. **Managed-mirror.** `npx mc sync` copies files into `.claude/commands/`, `.claude/agents/`, `scripts/hooks/`, gitignored. Looks like today's setup to Claude Code; npm runs under the hood. Works without any harness changes.

## Decision criterion when revisiting

Enumerate the current Phase 1/Phase 2 sprints and ask:

> *"Which of these would have been unnecessary under the npm shape?"*

| Answer | Implication |
|---|---|
| "Most of the recent meta-work" (release ledger, capsule presence, framework-manifest honesty, ghost cleanup, promote/release dance) | **npm has real signal.** Revisit seriously. |
| "Few of them" | **Canonical-clone is correct.** Keep going. |

## Why this is parked

Build-it-to-decide-it is itself a sprint cost. The maintainer is in a sprint-effectiveness review window where the question "is MC becoming the product?" matters more than "is there a better distribution shape?" Spend cycles only when the per-sprint meta-work overhead becomes load-bearing.

## What it does NOT decide

- Does not solve the privacy-leak class (`_requirements/00-canonical/` containing real product data) — npm just changes the distribution shape, not what's IN the package.
- Does not solve the install-honesty class — npm has its own broken-install failure modes (missing peer deps, lifecycle script errors, lockfile drift).
- Does not solve central-mode multi-product orchestration — that's a separate parked bet.

## If/when revived

Smallest viable experiment: build path (3) — managed-mirror via `npx mc sync`. Lowest risk, lets us measure "does shipping changes via npm publish + downstream sync feel better than `/warp:promote`?" without committing to plugin-loader integration.

If managed-mirror feels right, evaluate path (1) — Claude Code plugin loader — depending on what Anthropic ships in the meantime.

Path (2) symlinks is a non-starter on Windows; skip.
