# Deprecation and Removal Policy

No shipped MC capability may disappear without a deprecation path.

## Applies To

- Agents
- Skills and slash commands
- Hooks
- Path keys
- Requirements
- Patterns
- Generated files
- Release capsule fields
- Public scripts

## Lifecycle

| Stage | Requirement |
|---|---|
| Active | Normal support. |
| Deprecated | Replacement named, migration path documented, warnings emitted where practical. |
| Sunset pending | Removal version and date recorded. Migration script exists if files or schemas move. |
| Removed | Manifest marks `removedIn`; release notes name the removal and rollback path. |

## Minimum Deprecation Record

Each deprecation must include:

- Stable ID
- Type
- Current owner
- Replacement or reason no replacement exists
- First deprecated version
- Earliest removal version
- Migration script or manual migration instructions
- User-visible warning text if applicable
- Rollback path

## Command

`/mc:deprecate <id>` writes a guarded deprecation proposal. The command is backed by `scripts/mc/deprecate.js`.
