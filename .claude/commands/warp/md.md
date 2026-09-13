---
description: "Tune CLAUDE.md with project-specific context — refresh the auto-generated project block from PROJECT.md, _requirements, manifest, README, and package scripts. Framework sections are never touched."
user-invocable: true
---

# /warp:md — Tune CLAUDE.md with project context

Augment the root `CLAUDE.md` with the load-bearing project facts an agent
needs every session, while leaving **every framework section untouched**. The
project facts live in a single marker-delimited block; re-running this skill
replaces only that block.

MC ships a generic `CLAUDE.md` (Identity, Reasoning, Operational Loop,
Skill Use, Autonomy, Paths, Memory, hygiene). A consumer product needs its own
one-liner, stack, commands, and conventions surfaced in always-loaded
instructions — but must not fork or drift the framework sections. This skill is
the safe, idempotent way to keep that project block honest.

## Input

`/warp:md [stack | commands | conventions | <free-text steer>]`

- No args → refresh the **whole** project block from all sources.
- `stack` / `commands` / `conventions` → bias the refresh toward that facet
  (still writes the whole block, but spends more care on the named facet).
- free-text → a steer the author should weight (e.g. "emphasize the PWA offline
  model").

## Invariants (the contract — do not violate)

1. **Idempotent, marker-delimited.** The project block is wrapped in:
   ```
   <!-- warp:md:start (auto-generated project context — refresh via /warp:md) -->
   ... project facts ...
   <!-- warp:md:end -->
   ```
   Re-runs replace **only** the text between the markers. If the markers are
   absent, insert the block once, immediately after the `# <Title> — CLAUDE.md`
   heading's intro and BEFORE the framework sections (or at the documented
   `## Project Context` anchor if present). Never create a second block.
2. **Framework sections are sacred.** Never edit Identity, Reasoning,
   Operational Loop, Skill Use, Autonomy, Paths — Single Source of Truth,
   Memory, Refactor & Rename Hygiene, or Policy & Enforcement Hygiene. The
   project block is the ONLY region this skill may write.
3. **Facts are sourced, never invented.** Gather in priority order, stopping at
   the first source that answers each fact:
   1. `PROJECT.md` (repo root)
   2. `paths.requirementsRoot`/`00-canonical/` — CORE_BRIEF, PRODUCT_MODEL, GLOSSARY
   3. `paths.manifest` (`.claude/manifest.json`) — name, features, providers
   4. `README.md`
   5. `package.json` `scripts` (repo root **and** an app subdir like `app/`/`web/` if present)
   6. `paths.currentStage` (`.claude/project/stage/current-stage.md`)
   Every command listed MUST be verified against a real `scripts` entry. If a
   fact has no source, omit it — do not guess.
4. **Concise.** This block lives in always-loaded instructions. Keep it tight
   (a one-liner, layer note, stack+commands, conventions/gotchas, and pointers
   to depth). Link to `PROJECT.md` / `_requirements` / spec rather than inlining
   long prose.

## Procedure

1. **Locate `CLAUDE.md` + detect layer.** Read the root `CLAUDE.md`. Detect
   whether this repo is a **product** (has product source / `PROJECT.md` / app
   subdir) or **framework/tooling** (canonical MC — has `_mc/`,
   `framework/`). The project block describes the product; for canonical, the
   block is minimal (point at AGENTS.md / ROADMAP.md).
2. **Gather facts** from the priority-ordered sources above. Verify every
   command against real `package.json` `scripts`. Note the source of each fact
   (for the Step-5 trace).
3. **Compose a tight block:** one-liner · product-vs-framework layer note ·
   stack + the handful of commands that matter (build/test/lint/dev) · 2–5
   conventions or gotchas · pointers (`PROJECT.md`, `_requirements/`, spec,
   `COMMS.md` if present).
4. **Apply idempotently** between the `warp:md:start`/`warp:md:end` markers
   (insert the markers once if absent, per Invariant 1). Use Edit so the rest of
   `CLAUDE.md` is byte-untouched.
5. **Verify + report:** confirm (a) every framework section's bytes are
   unchanged, (b) the markers wrap exactly **one** block, (c) every fact traces
   to a source from Step 2. Print the diff of the project block only.

## Notes

- Reference paths via `paths.*` keys, not literals (the Paths rule in
  `CLAUDE.md`). `scripts/path-lint.js` enforces this at commit.
- This skill never edits framework sections, never pushes, and is fully
  reversible (re-run to regenerate, or revert the single block).

## Reference

- Root instructions: `CLAUDE.md`
- Sources: `PROJECT.md`, `paths.requirementsRoot`/`00-canonical`, `paths.manifest`,
  `README.md`, `package.json`, `paths.currentStage`
- Sibling skills: `/roadmap:create`, `/portfolio:spinup`
