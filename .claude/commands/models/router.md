---
description: Open the model router panel — ensure the catalog carries all the latest model options, then launch the Dispatch Console GUI (browser) so you can view/edit role→provider→model→effort visually.
user-invocable: true
namespace: models
reads: [scripts/dispatch/catalog.js]
writes: []
---

# /models:router — open the model router panel

Open the **Dispatch Console panel** — the visual router for role→provider→model→effort→
fallback. First make sure the catalog carries the latest model *options* (so every current
model is selectable in the panel's dropdowns), then launch the GUI.

The panel is launched via `node scripts/dispatch.js gui` (the Dispatch Console's `gui`
subcommand; the implementation lives in `scripts/dispatch/gui.js`, which is a library —
do NOT run it directly, it has no entrypoint guard and would be a silent no-op). It's an
ephemeral, **local-only** HTTP server (bound to 127.0.0.1, random OS port, gated behind a
256-bit one-time token, lifetime tied to the CLI process) that auto-opens in your browser.
It reads the same `catalog.js` + live dispatch state and writes changes through the atomic
save+backup ring — identical semantics to `dispatch.js show/set`, just visual.

## Input

```
$ARGUMENTS  (skill-level flags — interpreted here, then mapped to the Console)
  --text          don't launch the browser GUI; print the text panel (dispatch.js show) instead
  --no-open       launch the GUI server but don't auto-open the browser — maps to `dispatch.js gui --no-open` (prints the URL)
  --skip-check    skip the "latest options" pre-check (the models:check step) and just open
```

## Procedure

1. **Ensure latest options are in the panel** (unless `--skip-check`):
   ```bash
   node scripts/models/check.js
   ```
   If it reports deprecated/shut-down ids (`ERROR`) or missing options, tell the operator
   and recommend `/models:update` — but still open the panel (it's a viewer/editor).

2. **Open the panel:**
   - Default (browser GUI) — via the Console's `gui` subcommand:
     ```bash
     node scripts/dispatch.js gui            # opens browser at a random loopback port
     node scripts/dispatch.js gui --no-open  # start server, print URL, don't auto-open
     ```
     The server prints the loopback URL and exits on tab close / SIGINT / stdin EOF.
   - `--text` (no browser — text table):
     ```bash
     node scripts/dispatch.js show
     ```

3. Report the URL (GUI) or the rendered table (text), and the one-liners for editing:
   `/models:route <role> <provider> <model> [effort]` or, in the panel, click a row.

## Notes

- **Headless / SSH / CI:** use `--text` (no browser available). The GUI is for a local
  workstation session.
- The GUI never listens on a public interface and carries no persistent route — closing
  the tab tears it down.

## Exit codes

- `0` panel opened (GUI launched or text printed) · `2` usage error

## See also

- `/models:route` — non-interactive single-role route (same backend as the panel)
- `/models:check` — what "latest options" means; run with `--refresh` to re-ingest vendor docs
- `/models:update` — migrate the catalog to the latest models
