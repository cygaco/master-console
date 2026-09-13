---
description: "[deprecated alias → /commit:land] Commit locally then push — superseded by /commit:land, which also merges the branch into the default branch."
---

# /commit:both — deprecated alias

`/commit:both` has been **renamed to [`/commit:land`](land.md)**, which does everything
`/commit:both` did (commit + push the working branch) **and** completes the merge into the
repo's default integration branch.

Run **`/commit:land`** instead — it is the canonical name. This alias forwards there and
will be removed at `mc@1.0.0`.

(Matches the `/warp:sync` → `/warp:update` deprecation-alias precedent.)
