---
description: Update the model table — find the new models each lab serves and swap one in, with undo. Use for "are we on the latest models", "refresh the model list", "swap us to the newest Gemini/GPT/Claude"; swaps a configured model across the shipped defaults (or one role) and undoes the last swap.
user-invocable: true
namespace: models
reads: [scripts/dispatch/catalog.js, scripts/dispatch/catalog-models.json, .claude/agents/_org/presets, .claude/agents/_org/role-registry.json, .claude/agents/_org/panel-lane-manifest.json]
writes: [scripts/dispatch/catalog-models.json, .claude/agents/_org/presets, .claude/agents/_org/role-registry.json, .claude/agents/_org/panel-lane-manifest.json, .claude/manifest.json]
---

# /models:swap — find, swap, undo

One command, `scripts/models/models.js`, three verbs.

**When to use it:** a lab serves a newer model, or retires one, and you want every place that
names the old model to move to the new one without hand-editing JSON.

**Plain requests that mean this flow:** "update the model table", "are we on the latest models",
"refresh the model list", "swap us to the newest Gemini" (or GPT, or Claude). The flow is:

1. `find` shows what is new and what is gone.
2. For a change of a DEFAULT, run one quick same-packet smoke through the old and new models
   (same small review packet, compare time and catches), then get a judge ruling on the default.
   Adding a model as an option needs neither.
3. One `swap`.
4. `undo` if a real run misbehaves.

## find — what is served now

```
node scripts/models/models.js find
```

Lists, per lab, the models its tool serves that the catalog lacks, and the configured models it no
longer serves.

## swap — replace one model with another

```
node scripts/models/models.js swap gemini-4-argon-high gemini-4-carbon-high
```

- Replaces the old model with the new one in every preset, the role registry and the panel lane
  manifest, and in the `provider_model:` line of each role spec's frontmatter (never the body), then
  syncs the role specs. That edits the **shipped defaults**.
- With `--role <role>` only that role changes, as a project-layer pin; the shipped defaults stay.
- A new model missing from the catalog is added from the lab's served list. A model the lab does not
  serve is refused and nothing is written. A swap stays within one lab.
- Takes a backup first, runs the model checks (model-resolution, model-chain, spec sync), and undoes
  itself if any check is red.
- The live check reports "ok" only when the model that answered is the new one.
- Flags: `--dry-run` (print the plan, write nothing), `--no-ping` (skip the live check),
  `--no-regen` (skip manifest regeneration). Any other flag is refused (exit 2) before anything runs.

## undo — put the last swap back

```
node scripts/models/models.js undo [<backup-id>] [--no-regen]
```

`--no-regen` skips manifest regeneration after the restore.

Restores the files from the latest swap that took effect (or `undo <backup-id>`) and re-syncs the role specs. A swap that rolled itself back is skipped. Before restoring, it saves what is there now and prints that snapshot id, so edits made after the swap are not lost.
