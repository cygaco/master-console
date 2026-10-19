# Installer File Lifecycle: Skip-vs-Ghost Tradeoff

> Reference for any installer/sync script that copies files from an upstream source into a downstream project (e.g. MC templates copied into a downstream product, framework files copied into a new project).

## The problem

Two install operations:

**Install pattern A — overwrite always:**
- Pros: downstream is always in sync with upstream
- Cons: blasts user edits

**Install pattern B — skip if exists:**
- Pros: preserves user customisation
- Cons: orphans accumulate when upstream renames or removes a file

Concrete example: a skill `init.md` → renamed to `setup.md` upstream. With pattern B, the downstream project keeps both `init.md` (now orphaned, no longer maintained upstream) AND gets the new `setup.md` (current). The skill list shows two skills doing similar things; users can't tell which is canonical.

## The fix: ship-manifest pattern

Each install writes a **ship-manifest** to the downstream project recording which files this install version owns:

```jsonc
// downstream-repo/.claude/.ship-manifest.json
{
  "installer": "mc-sync 1.4.2",
  "installed_at": "YYYY-MM-DDT00:00:00Z",
  "owned_files": [
    ".claude/agents/president/delta.md",
    ".claude/agents/president/gamma.md",
    ".claude/commands/mode/oneshot.md",
    "scripts/hooks/prompt-validator.js"
  ]
}
```

On the **next install**:

1. Read the previous `.ship-manifest.json` (if any)
2. Compute `previous_owned - current_owned` = orphan list
3. For each orphan, prompt user (or auto-delete with `--prune` flag): "Upstream removed `<file>` — delete from this repo?"
4. Apply the install (skip-or-overwrite per its own logic)
5. Write the new `.ship-manifest.json`

Result: orphans are explicitly handled, not silently accumulated.

## When this applies

- `scripts/mc-sync*.js` and similar installer scripts
- Any tool that distributes a curated set of files into target projects
- NOT for one-off scaffolds (`npx create-foo`) — those don't sync over time

## Implementation checklist

When writing or modifying an installer:

- [ ] Each install writes a `.ship-manifest.json` with `installer`, `version`, `installed_at`, `owned_files`
- [ ] On run, read the previous manifest BEFORE deciding what to copy
- [ ] Diff `previous - current` to find orphans
- [ ] Prompt user (or take a `--prune` / `--keep-orphans` flag) — never silently delete
- [ ] Renames are orphan + new pair; document them in installer release notes so users understand

## See also

- `scripts/mc/update.js` — the framework updater: it reads the installed snapshot (`.claude/framework-installed.json`) and classifies each asset the new version no longer ships: DELETE_SAFE when the local copy matches the snapshot hash and the snapshot does not list it under `userModified` (deleted, after a backup, only with `--confirm-deletes`), ORPHAN_KEPT when the user edited a project-owned or framework-template copy (never deleted, reported "kept (modified by you)") or when the snapshot records no hash for the asset (never deleted, reported "kept (cannot verify it is unmodified)"), DELETE_CONFLICT when a framework-owned local copy was edited (left in place)
