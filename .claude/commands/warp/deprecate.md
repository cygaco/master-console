---
description: "Create a guarded MC deprecation proposal for an agent, skill, hook, path, requirement, pattern, or generated file."
user-invocable: true
---

# /warp:deprecate

Create a deprecation proposal that follows the Phase 6 removal policy. This command does not delete files.

## Usage

```bash
node scripts/mc/deprecate.js <id> --type <kind> --replacement <id-or-none> --removal-version <version> --reason "<why>"
```

Examples:

```bash
node scripts/mc/deprecate.js warp.sync --type skill --replacement warp.update --removal-version 1.0.0 --reason "Renamed to update."
node scripts/mc/deprecate.js old.path.key --type path --replacement new.path.key --removal-version 0.3.0 --reason "Path registry consolidation."
```

## Output

The engine writes a JSON proposal under `.claude/project/decisions/deprecations/`.

Each proposal includes:

- Stable ID
- Type
- Replacement
- Reason
- First deprecated version
- Earliest removal version
- Migration placeholder
- User warning placeholder
- Rollback path

## Rules

- Do not remove the target in the same step unless a migration and release note already exist.
- Path keys must also be marked in `framework/paths.registry.json` when removal actually ships.
- Shipped skills and agents need a sunset window unless the item is a security hazard.
