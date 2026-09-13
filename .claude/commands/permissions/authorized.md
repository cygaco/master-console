---
description: Operator authorization — durably allow a blocked action by adding a scoped permissions.allow rule from a growing catalog of cases, then recompiles settings so it takes effect this session.
user-invocable: true
---

# /permissions:authorized — Operator Authorization

When the harness auto-mode classifier (or a project guard) blocks an action **you, the operator, want to permit**, this skill records a durable, scoped `permissions.allow` rule so the action is pre-authorized going forward — then recompiles settings so the harness honors it immediately. It is catalog-driven and **grows as new blocked cases appear**: each time we hit one, add a row to the Catalog below.

Invoking this skill **is** the authorization. It does not re-prompt; it states exactly what it grants and writes it.

## Input

`<case-name>` | `"<command-or-pattern>"` | `--list` | (no arg → infer from the most recent blocked action this session)

- **case-name** — a named row from the Catalog (e.g. `portfolio-scaffold`).
- **"command-or-pattern"** — a raw command prefix (`node scripts/foo.js`) or tool/glob (`Write(.claude/runtime/**)`); the skill derives a scoped rule.
- **`--list`** — print the Catalog + current `permissions.allow`; change nothing.

## Mechanism (how authorization works in this project)

Three-layer settings model (see `scripts/mc/settings/compile.js`):

| Layer | File | Role |
|---|---|---|
| 1 — defaults | `_mc/settings/defaults.json` | framework defaults (do not edit per-project) |
| 2 — local | `.claude/settings.local.json` | **operator overrides — edit THIS** |
| 3 — compiled | `paths.settings` (`.claude/settings.json`) | GENERATED (defaults ∪ local) — never hand-edit |

So a durable grant = add the rule to **Layer 2**, then **recompile** to regenerate Layer 3. A matching `permissions.allow` entry causes the harness to allow the tool call without re-classifying it.

**Pattern syntax** (match the existing entries' style — space-glob, not `:*`):
`Bash(<prefix> *)` · `Write(<glob>)` · `Edit(<glob>)` · `Read(<glob>)` · or a bare tool name (`Edit`).

## Safety floor — this skill REFUSES to encode these

Per CLAUDE.md `## Autonomy` and the `/turbo` floor, these stay operator-manual and are **never** written as an allow rule:

- Force-push to the default branch
- Deleting `backup/*` or `pre-*` branches
- Service signups / purchases
- API spend ≥ $5 in a session

Everything else is fair game — this skill is meant to authorize *pretty much anything* outside that floor.

## Catalog

| Case | Grants (`permissions.allow`) | Why it's blocked by default |
|---|---|---|
| `portfolio-scaffold` | `Bash(node scripts/portfolio/new.js *)` · `Bash(node scripts/portfolio/adopt.js *)` · `Bash(gh repo create *)` | `/portfolio:new --from-brief` scaffolds a **private** sibling repo and `gh repo create … --push`. The auto-mode classifier flags the push to a brand-new repo as data-exfiltration. Repos are always `--private` (DEC-008). |

> Add a row here whenever a new blocked case is authorized. Keep the `Grants` column to the **narrowest** pattern that unblocks the case.

## Procedure

### Step 1 — Resolve the request to allow-rule(s)
- `--list`: print the Catalog and the current `permissions.allow` from `.claude/settings.local.json`; **stop**.
- Catalog case name → use that row's `Grants`.
- Raw command (`node scripts/foo.js`) → derive `Bash(node scripts/foo.js *)`. Tool+glob (`runtime/**`) → derive `Write(runtime/**)`, etc.
- No arg → inspect the most recent blocked tool call this session, derive the rule, and **state your inference** before writing.

Echo the exact entries you will add.

### Step 2 — Safety-floor check
If any derived entry would authorize a floored action (above), **do not write it**. Tell the operator to run that action themselves with the `!` prefix (runs as them, not the agent) and skip that entry. Non-floored entries continue.

### Step 3 — Write to `.claude/settings.local.json` (durable)
Read the file, add each new entry to `permissions.allow`, **skip duplicates**, write back as 2-space JSON. This is the operator override layer that survives future recompiles.

### Step 4 — Recompile (make it live)
```bash
node scripts/mc/settings/compile.js
```
Expect `compile OK → …`. If it reports a conflict (exit 1 — e.g. the same string in `deny`), resolve before proceeding. Recompile regenerates `paths.settings` as defaults ∪ local, so the new rule is active for the harness immediately.

**Hook ADDED/DROPPED integrity diff — required before you trust the recompile.** A recompile can
**silently drop hooks that are live in `paths.settings` but missing from Layer 1**
(`_mc/settings/defaults.json`) — pre-existing drift, not something this skill introduced. Diff
the recompiled hook list against the committed one and fix any defaults drift FIRST:

```bash
git show HEAD:.claude/settings.json | grep -o 'scripts/hooks/[a-z0-9-]*\.js' | sort -u > before.hooks
grep -o 'scripts/hooks/[a-z0-9-]*\.js' .claude/settings.json | sort -u > after.hooks
comm -23 before.hooks after.hooks    # DROPPED — must be empty
comm -13 before.hooks after.hooks    # ADDED   — must be only what you intended
```

Any line from the first `comm` means Layer 1 is missing a live hook — add it to `defaults.json` and
recompile again before proceeding. (Write the two scratch files under your scratchpad dir, not the
repo.) Precedent (`L-2026-06-06-settings-recompile-integrity-check`): a
naive recompile would have dropped two live security hooks (`settings-edit-guard.js` PreToolUse and
`untrusted-content-firewall.js` PostToolUse) that existed only in the compiled layer.

### Step 5 — Verify + report
Confirm the new entries appear in `permissions.allow` of the compiled `paths.settings`. Report what was authorized and the revoke path (below).

### Step 6 — Retry (if asked)
If the operator wanted the blocked action done, retry it now.

## Revoke

Remove the line(s) from `.claude/settings.local.json` → `node scripts/mc/settings/compile.js`. Or `git restore .claude/settings.local.json .claude/settings.json`.

## Honest limitation

Like `/turbo`, some harness heuristics are richer than allow rules. A `permissions.allow` entry **usually** clears the block, but a non-overridable harness safety floor can persist. If it does, run the command yourself with the `!` prefix — that executes as you, sidestepping the agent-side classifier entirely.

## Related

- `/turbo` — time-boxed (TTL) batch authorization via the same `permissions.allow` lever + `authorization-gate.js` hook. Session-scoped; this skill is the **durable, named** counterpart.
- `/update-config` — general `settings.json` / permissions editor.
- `/fewer-permission-prompts` — transcript-mined long-term allowlist tuning.
