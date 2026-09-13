# RFC: Central-MC Multi-Product Architecture (FROZEN)

**Status:** PARKED. Do not invest sprint cycles until a pull-forward trigger in `ROADMAP.md § Later: Platform Bets` fires.

**Date frozen:** 2026-05-21

**Sources:**
- Codex multi-product architecture consult: `.claude/runtime/consult-codex-centralized-mc.js`
- Codex multi-user/privacy consult: `.claude/runtime/consult-codex-multiuser-privacy.js`
- Codex stay-simple sanity check: `.claude/runtime/consult-codex-stay-simple.js`

---

## The original question

The maintainer asked 2026-05-21:

> "I want to be able to use MC skills etc from this project, but have that impact other projects, without mc being installed in those."

Concretely: one central MC install, N "client" repos with no `.claude/` of their own. Run `/sprint:plan` or `/portfolio:status` in the central MC session and have it operate on a client repo by absolute path. Client repos stay clean.

## Codex's verdict

**Viable-with-major-caveats. Ship as opt-in only, never as default.**

The load-bearing decision is whether MC becomes a **two-root system**:

- `FRAMEWORK_ROOT` — central MC, owns skills, agents, hooks, specs
- `TARGET_ROOT` — the client repo, gets edited but stays clean

If we keep pretending there's only one `PROJECT_ROOT`, the architecture rots immediately.

## Design sketch

**Path-key classification.** Every `paths.json` key gets reclassified into one of three buckets:

| Bucket | Resolution | Example keys |
|---|---|---|
| `framework` | relative to `FRAMEWORK_ROOT` | `commands`, `agents`, `agentSystem`, `decisionPolicy` |
| `state` | relative to `FRAMEWORK_ROOT/.claude/project/clients/<slug>/` | `events`, `memory`, `decisions`, `sprint`, `tracesFile` |
| `target` | relative to `TARGET_ROOT` | code edits, git ops, build artifacts |

**Resolver signature.**
```js
resolvePath(key, context)
// context = { frameworkRoot, targetRoot, clientSlug }
```

**Skill dispatch.** Commands take a `--target <slug>` argument or infer from session context. Body of the skill:
- Reads command/agent/hook config from `FRAMEWORK_ROOT/.claude/`
- Edits code in `TARGET_ROOT`
- Writes memory/sprint/checkpoint artifacts to `FRAMEWORK_ROOT/.claude/project/clients/<slug>/`
- Never requires `.claude/` inside `TARGET_ROOT`

**Agent dispatch.** Builders run shell/file ops with `cwd = TARGET_ROOT` while reading specs/state from `FRAMEWORK_ROOT`.

**Storage layout in central MC:**
```
MC root/
  .claude/
    commands/       <- framework (one source of truth across all clients)
    agents/         <- framework
    project/
      clients/
        client-a/
          events/
          memory/
          decisions/
          sprint/
        client-b/
          ...
```

## Hard prerequisites before any code

Per the codex multi-user/privacy consult, central-mode is **inherently sharp** because it stores client state inside the central repo. None of the following are negotiable:

1. **Strict allowlist refactor of `scripts/mc/promote.js`.** Swap "FRAMEWORK_PREFIXES + EXCLUDE_PREFIXES" for a positive allowlist that prints the exact file list and fails closed if any path is outside.
2. **Hard-deny `.claude/project/clients/**`** from promote, commit hooks, release packaging, CI. Multi-layer guards.
3. **`.gitignore` per-client state additions** at top-level.
4. **Canonical CI leak scanner** — reject diffs containing known client slugs, abs paths, private remotes, known local-state dirs.
5. **Privacy fixture test** — seed fake client data, run promote/package/release, assert zero leakage.
6. **`/scan:mc-privacy-leak` skill** — runs codex's 10-vector checklist pre-promote, refuses on any high-confidence hit.

These all live in `ROADMAP.md § Now: Privacy & Promotion Safety` independently — they're worth shipping for the per-product model too. Central-mode just makes them load-bearing instead of belt-and-suspenders.

## Why this is parked

Per the codex stay-simple consult 2026-05-21:

> "The user's bottleneck is not 'control plane architecture'; it is that MC installs and updates must become boring. Central-mode is a second-order optimization and currently a framework-sprint magnet."

**The current per-product install model is correct** for 1-3 portfolio products. It becomes noticeable at 5, hurts at 8-12 if MC changes weekly, ops problem at 15-20.

Real cost multiplier: `active_products × framework_change_frequency × install_drift × debugging_ambiguity`. Stabilize MC (Now: Install & Release Integrity sprint) and 20 installs are fine. Don't stabilize MC and 5 installs are already painful — central-mode wouldn't save that.

## Triggers to revive (in priority order)

Per codex stay-simple consult — pull this RFC forward if any of:

1. **Updating MC across products regularly costs more than 30-60 minutes/week** — measure honestly via timing a few real `/warp:update` rounds.
2. **Bugs are repeatedly caused by version drift** between product installs — track via recurring-issues.jsonl entries tagged with version-drift signature.
3. **The maintainer needs cross-product orchestration / reporting / shared memory** — observed not hypothetical (e.g., "I want to see all sprints across all products at once").
4. **New-product setup remains painful AFTER install/update reliability work ships** (Now: Install & Release Integrity sprint complete) — measured by stopwatch.

## Anti-pattern to watch

Codex was explicit: **do not build central-mode to avoid making installs robust.** Central-mode still needs install/update discipline, just with higher blast radius. If the install pain is real, fix the install — don't refactor the architecture as escape.

## If/when revived

Estimated work: multi-sprint refactor. Touches `paths.json` semantics (every consumer of `PATHS.X`), agent dispatch, hook pipeline, manifest schema, `.gitignore`, promote/release pipeline. Treat as a major-version bump.

Must ship as additive (`mc.mode = central` opt-in flag); existing per-product installs continue unchanged; commands branch on mode.

## What stays out of scope even if revived

- Remote dispatch (cross-machine). Central-mode is single-machine first.
- Multi-user shared central MC. Single-maintainer first.
- Per-client agent custom configurations. Framework agents stay framework-defined.
