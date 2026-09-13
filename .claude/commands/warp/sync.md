---
description: "Legacy alias for /warp:update that forwards to the canonical update flow so older references and muscle memory keep working until mc@1.0.0; superseded by /warp:update."
user-invocable: true
tags: [mc, sync, deprecated]
---

# /warp:sync — DEPRECATED, use /warp:update

This skill is a wrapper that forwards to `/warp:update`. The canonical entry point is **/warp:update**.

## Why the rename

Phase 4 split the original `/warp:sync` operation into two clearer commands:

- **`/warp:update`** — pull MC canonical → this project (the inbound direction; what `/warp:sync` always did).
- **`/warp:promote`** — push this project's framework changes → MC canonical (the outbound direction; new in 0.1.0).

Calling `/warp:sync` will execute `/warp:update` with all arguments preserved, plus a one-line deprecation notice. The behavior is identical — only the canonical name changed.

## Migration

If your habit is `/warp:sync` to "fetch and apply": that's exactly what `/warp:update` does by default. No flag changes required.

If you want to push outgoing changes: that was never `/warp:sync`'s job. You want `/warp:promote`.

## Removal

This alias is scheduled for removal at `mc@1.0.0`. Update any docs, READMEs, scripts, or skill references that still call `/warp:sync`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/warp:update $ARGUMENTS
```

If `/warp:update` is not yet present in the install (older MC clone), fall back to the prior `/warp:sync` body — but warn loudly that the install needs `/warp:update` migration `004-rename-warp-sync-to-update`.
