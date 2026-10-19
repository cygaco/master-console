---
description: Audit the /etc authoring+eval harness — fail-closed enforcer that rejects an invented authoring format (root etc.md, non-standard skill frontmatter) and any eval-pack or emitted decision_record that doesn't satisfy its contract. The standing backstop to the harness's own test suite.
---

# /scan:etc-harness — /etc authoring+eval harness audit

The persistent, **fail-closed** enforcement surface of the `/etc` authoring+eval
harness. The harness's own test suite (`scripts/etc/etc.test.js`) proves the
engines on dispatch; this scan is the **standing enforcer** that catches drift in the
authored artifacts already on disk — an invented authoring format, a malformed
eval-pack, or a decision_record that no longer satisfies contract v0.1.

`/etc` authors prompts/skills in the **existing skills:create format** (never a bespoke
one) and emits **structured** artifacts only — never a chain-of-thought warehouse. This
scan is the named approver that makes those two invariants self-detecting.

## What it does

Rejects (exit 1) when ANY of these hold on the built tree:
- a root `etc` command file exists directly under `.claude/commands/` (namespace convention
  violation — a subcommanded namespace must have no root file);
- any `.claude/commands/etc/*.md` lacks the standard frontmatter `description` or a
  `## Procedure` section (= an invented / non-standard authoring format);
- any eval-pack under `paths.etcEvalPacks` (`.claude/project/etc/eval-packs`) fails the
  eval-pack schema (`schemas/etc/eval-pack.schema.json`);
- any decision_record under `paths.etcDecisions` (`runtime/etc/decisions`) fails
  `scripts/contracts/validate-artifact.js` (contract v0.1).

Internal error → exit 2 (fail-closed — a scan that errors must never read as pass).

```
node scripts/checks/etc-harness-scan.js [--json]
```

## On a finding

- **Root `etc.md`** → remove it; the subcommand files (`etc/author.md`, `etc/eval.md`)
  ARE the skills (a root file blocks sub-skill detection).
- **Skill missing frontmatter / `## Procedure`** → re-author it in the skills:create
  format (`.claude/commands/skills/create.md`); do not invent a new shape.
- **Eval-pack fails schema** → fix it against `schemas/etc/eval-pack.schema.json`
  (required: `id`, `target`, `rubric` ≥1 dimension; `checks[].kind` ∈ the 6 kinds the schema defines).
- **decision_record fails the contract** → the emitting eval is the defect; a record that
  doesn't satisfy contract v0.1 must never be written. Re-run `/etc:eval` after fixing.

## Pairs with

- `scripts/etc/eval.js` + `scripts/etc/consult.js` — the eval engine (emits the records this scan validates) and the firewalled GPT-5.5 consult seam.
- `scripts/etc/etc.test.js` — the harness's own test suite (proves the engines; this scan is the standing enforcer over the artifacts).
- `scripts/contracts/validate-artifact.js` — the shared contract-v0.1 validator this scan calls on every decision_record.
- `.claude/commands/etc/author.md` + `.claude/commands/etc/eval.md` — the `/etc:author` and `/etc:eval` skills this scan keeps honest.
