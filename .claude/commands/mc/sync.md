---
description: "Legacy alias for /mc:update that forwards to the canonical update flow so older references keep working; superseded by /mc:update."
user-invocable: true
tags: [mc, sync, deprecated]
---

# /mc:sync — DEPRECATED, use /mc:update

This skill is a wrapper that forwards to `/mc:update`. The canonical entry point is **/mc:update**.

## Why the rename

`/mc:sync` is now named `/mc:update`:

- **`/mc:update`** — pull MC canonical → this project (the inbound direction; what `/mc:sync` always did).

Calling `/mc:sync` will execute `/mc:update` with all arguments preserved, plus a one-line deprecation notice. The behavior is identical — only the canonical name changed.

## Migration

If your habit is `/mc:sync` to "fetch and apply": that's exactly what `/mc:update` does by default. No flag changes required.

If you want to push outgoing changes: that was never `/mc:sync`'s job, and MC has no command for it.

## Removal

This alias is scheduled for removal in a future release. Update any docs, READMEs, scripts, or skill references that still call `/mc:sync`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/mc:update $ARGUMENTS
```

If `/mc:update` is not yet present in the install (older MC clone), fall back to the prior `/mc:sync` body — but warn loudly that the install needs `/mc:update`.
