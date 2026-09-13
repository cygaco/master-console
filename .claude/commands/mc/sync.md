---
description: "Legacy alias for /mc:update that forwards to the canonical update flow so older references and muscle memory keep working until mc@1.0.0; superseded by /mc:update."
user-invocable: true
tags: [mc, sync, deprecated]
---

# /mc:sync — DEPRECATED, use /mc:update

This skill is a wrapper that forwards to `/mc:update`. The canonical entry point is **/mc:update**.

## Why the rename

Phase 4 split the original `/mc:sync` operation into two clearer commands:

- **`/mc:update`** — pull MC canonical → this project (the inbound direction; what `/mc:sync` always did).
- **`/warp:promote`** — push this project's framework changes → MC canonical (the outbound direction; new in 0.1.0).

Calling `/mc:sync` will execute `/mc:update` with all arguments preserved, plus a one-line deprecation notice. The behavior is identical — only the canonical name changed.

## Migration

If your habit is `/mc:sync` to "fetch and apply": that's exactly what `/mc:update` does by default. No flag changes required.

If you want to push outgoing changes: that was never `/mc:sync`'s job. You want `/warp:promote`.

## Removal

This alias is scheduled for removal at `mc@1.0.0`. Update any docs, READMEs, scripts, or skill references that still call `/mc:sync`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/mc:update $ARGUMENTS
```

If `/mc:update` is not yet present in the install (older MC clone), fall back to the prior `/mc:sync` body — but warn loudly that the install needs `/mc:update` migration `004-rename-warp-sync-to-update`.
