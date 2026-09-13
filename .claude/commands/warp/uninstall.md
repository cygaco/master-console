---
description: Completely remove MC from a project — restores pre-install state from backup
user-invocable: true
---

# /warp:uninstall — Remove MC

Clean, full, reversible removal. Use when you want to start fresh, when MC is mis-installed, or when a client decides not to use it. Restores the project to its pre-install state using the backup `/warp:setup` created at install time.

## What it removes

- `.claude/` directory (every agent, skill, hook, memory store, map, reference doc)
- `scripts/hooks/` directory (if MC created it)
- `scripts/dispatch-agent.js`, `scripts/warp-setup.js`, `scripts/path-lint.js`, `scripts/tools/` (MC-owned scripts)
- `AGENTS.md` (if MC created it)
- The `# >>> MC runtime >>>` managed block in `.gitignore`
- MC-specific entries in `.claude/settings.json` (permissions, hooks, env vars)
- Optionally: the `../MC/` clone (with `--remove-clone`)

## What it restores

From `.mc-backup/<latest-timestamp>/`:
- `CLAUDE.md` → restored to pre-install content
- `.gitignore` → restored (without the managed block)
- `scripts/hooks/` → restored if the user had one before install
- Any other file the installer would have touched

## What it leaves alone

- Your source code (`src/`, `app/`, `pages/`, etc.) — never touched
- `package.json`, `tsconfig.json`, any non-MC config
- `_requirements/` (if it contains user-authored specs — prompts before deleting)
- `patterns/` (same treatment as requirements)
- Your git history — nothing is force-deleted from git

## Procedure

### Step 1 — Confirm this is a MC install

Check for `.claude/manifest.json` with `mc.installed: true`.

If not found: "No MC install detected here. Nothing to uninstall." Stop.

**Also read `.claude/framework-installed.json`** if present — this is the authoritative list of every asset the installer placed. If present, uninstall walks THIS list (exhaustive); if absent, falls back to recursive directory deletion (older installs predating the manifest).

If no backup in `.mc-backup/`: warn the user — "No pre-install backup found. Uninstall will still work but won't restore your original CLAUDE.md. Proceed anyway? (y/n)"

### Step 2 — Announce what will happen

Read `manifest.json` to determine install timestamp and MC version. Then print:

```
You are about to uninstall MC from <project-name>.

Installed:     <ISO date from manifest>
MC commit: <from manifest.mc.source + version.json>
Backup found:  .mc-backup/<timestamp>/  (files: <count>)

This will:
  ✗ Delete .claude/
  ✗ Delete scripts/hooks/
  ✗ Delete MC-owned scripts in scripts/
  ✗ Delete AGENTS.md
  ✗ Strip the managed block from .gitignore
  ✗ Remove MC entries from .claude/settings.json

This will restore from .mc-backup/<timestamp>/:
  ✓ CLAUDE.md  → original content
  ✓ .gitignore → original content
  ✓ <other backed-up files>

Your source code, package.json, and git history are untouched.

With --remove-clone, ../MC/ will also be deleted (git history stays on GitHub).

Type "yes" to proceed, anything else to cancel.
```

Wait for explicit `yes`. Anything else → stop.

### Step 3 — Check for unsaved work

Before touching anything, check:
- `git status` in the project → warn if uncommitted changes include MC-adjacent files
- `.claude/runtime/handoffs/` → count unsaved handoffs
- `.claude/project/memory/learnings.jsonl` → count entries (data loss if user wants to keep learnings for later)

If any of these have content:
```
Heads up:
  - Uncommitted changes in <N> MC files — commit or stash first
  - <M> learnings in learnings.jsonl will be deleted
  - <K> handoffs in .claude/runtime/handoffs/ will be deleted

Want to export memory/learnings before proceeding? (y/n)
```

If yes, copy `paths.learningsFile`, `paths.tracesFile`, `paths.eventsFile`, and `paths.handoffs/` to `.mc-backup/<timestamp>/pre-uninstall-data/` before deleting.

### Step 4 — Remove MC files

In this exact order (least-destructive first):

1. Restore `CLAUDE.md` from backup (overwrite the current one)
2. Restore `.gitignore` from backup (or strip managed block if no backup)
3. **If `.claude/framework-installed.json` exists** — walk `installed_files` and `generated_files`, delete each one. This is the exhaustive path; it removes exactly what the installer placed, no more, no less.
4. **If no snapshot exists** (older install) — fall back to the pre-snapshot procedure:
   - Delete `.claude/` directory recursively
   - Delete `scripts/hooks/` (restore from backup if a pre-install version existed)
   - Delete MC-owned top-level scripts: `dispatch-agent.js`, `warp-setup.js`, `path-lint.js`, `generate-maps.js`, `generate-framework-manifest.js`, `tools/`
   - Delete `AGENTS.md` (restore from backup if user had their own)
5. After file deletion, clean up empty parent dirs left behind (e.g. if `.claude/project/` only contained MC assets, `rmdir` it).

### Step 5 — Strip settings.json

If `.claude/settings.json` somehow persisted (user had their own outside MC), strip only the MC-added entries:
- Remove env vars: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
- Remove permissions added by install (cross-reference with install log)
- Remove hook entries pointing to `scripts/hooks/` paths

Since `.claude/` is deleted in Step 4, settings.json usually goes with it. This step matters only if the user had a non-MC `.claude/settings.json` that survived.

### Step 6 — Handle the clone

If `--remove-clone` flag set OR `--interactive` and user confirms:
```bash
# Move first (safer than rm), user can recover if they change their mind
mv ../MC ../MC.uninstalled-<timestamp>
```

Then: "Moved `../MC` to `../MC.uninstalled-<timestamp>`. Delete it manually when ready: `rm -rf ../MC.uninstalled-*`."

If no flag: leave `../MC/` alone. Explain: "Your `../MC/` clone is untouched. You can reuse it for `/warp:setup` in another project, or delete it manually."

### Step 7 — Confirm completion

Print:

```
MC uninstalled from <project-name>.

Restored:
  ✓ CLAUDE.md — your pre-install content
  ✓ .gitignore — without MC managed block
  ✓ <any other backed-up files>

Removed:
  ✗ .claude/ — gone
  ✗ scripts/hooks/ — <gone | restored from backup>
  ✗ AGENTS.md — <gone | restored from backup>
  ✗ MC-owned scripts — gone

Backup preserved at: .mc-backup/<timestamp>/
  Safe to delete once you're confident you don't want to reinstall.

If you want to REINSTALL: run `/warp:setup` again.
If you want to reinstall in ANOTHER project: your ../MC/ clone <is still here | has been moved to ../MC.uninstalled-*>.

Your project is back to its pre-MC state.
```

### Step 8 — Offer to commit

```
Git status shows <N> changes from the uninstall (CLAUDE.md, .gitignore, etc.).

Commit with: git add -A && git commit -m "chore: uninstall MC"

Want me to stage + commit for you? (y/n)
```

If yes, stage all changed files and commit with that message.

## Flags

- `--remove-clone` — also delete `../MC/` (moves to `../MC.uninstalled-<ts>`)
- `--keep-backup` — don't delete `.mc-backup/` (default behavior anyway; this is explicit)
- `--export-memory` — copy learnings/traces/events to backup before deleting
- `--yes` — skip interactive confirmations (dangerous — use only in scripts)

## Related

- `/warp:setup` — install (or reinstall after uninstall)
- `/warp:health` — verify MC state before deciding to uninstall
- `/warp:sync` — pull latest updates (non-destructive alternative to uninstall+reinstall)

## Why this exists

- Clients may decide MC isn't for them — they deserve a clean exit
- Testing the install requires a clean starting state every time
- Bad installs are common; uninstall gives a quick reset button
- Upgrade path: for major version jumps, uninstall-then-reinstall is cleaner than `/warp:sync`
