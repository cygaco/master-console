---
description: The named enforcer that every role resolves to a working model — every preset, every sign-in combination, both spawn channels. Blocking in /scan:full and checked in /mc:health.
---

# /scan:model-resolution — every role resolves to a working model

Each role has an ordered list of models to try (its chain) in the shipped model presets
(`.claude/agents/_org/presets/`, default `default.json`). The model picker
(`scripts/dispatch/model-resolve.js`) takes the first entry whose tool the user is signed in to; Claude
Code's in-process spawns only ever take the Claude entries. This scan proves that holds.

## What it does

Runs `node scripts/checks/model-resolution.js` (`--json` for machine output). A finding on any of:

1. **matrix** — every preset × every registry role × {all three tools, Claude + Codex, Claude + Gemini,
   Claude only} × {in-process, CLI} resolves to a model the catalog offers for that provider; an
   in-process answer is never a non-Claude model.
2. **parity** — the registry's provider/model/effort for a role equals the default preset's first entry.
3. **floor** — every chain in every preset ends on `claude-opus-5-5`, so a Claude-only user always resolves.
4. **alias** — the Agent-tool alias given for an in-process answer (`opus`/`sonnet`/`haiku`/`fable`) is the
   catalog's alias for exactly that model, or none.
5. **specs** — every role spec's frontmatter `model:`/`effort:` equals the picker's in-process answer
   (fix: `node scripts/dispatch/model-resolve.js --sync-specs`).
6. **readers** — the reader census (`scripts/checks/model-resolution.readers.json`) is complete, and only
   the model picker reads the saved sign-in answer.

Reported, never a finding: which roles run on one model family only for a Claude-only user (today: the
security reviewer — the security panel's own rule decides what happens then).

Exit 0 = all hold · 1 = findings (RED) · 2 = could not run (RED, never a pass).
Bite test: `node --test scripts/checks/model-resolution.test.js` (live-tree run + one planted RED per check).

Related: the release gate `shipped_spec_models` (`scripts/checks/shipped-spec-models.js`) — the
shipped specs must carry the product default, never a checkout's own pins.
