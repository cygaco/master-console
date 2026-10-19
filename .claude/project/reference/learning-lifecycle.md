# Learning Lifecycle

Every correction, error, or surprise is a learning. Log immediately to `learnings.jsonl`.

## Format

```json
{"ts":"ISO","intent":"category","tip":"...","conditions":{},"fix_quality":null,"status":"logged","score":0,"source":"session"}
```

## Rules

- **Status field is the lifecycle:** `"logged"` → `"validated"` → `"implemented"`
- **Never self-promote.** Only advance status with evidence (user confirmation, test pass, code enforcement).
- **Store conditions, not just outcomes.** A fix that works "for contract roles" is not one that works universally.
- **Fix quality travels with learnings.** Tag with `fix_quality: 0-4` so future lookups know reliability.
- **Target: 60-100 active learnings.** More = noise. Fewer = amnesia.

## Lifecycle Stages

| Stage | `status` | Gate to advance | Meaning |
|-------|----------|-----------------|---------|
| **Logged** | `"logged"` | Needs evidence | Written down, unverified |
| **Validated** | `"validated"` | Needs enforcement | Tested, worked, evidence exists |
| **Implemented** | `"implemented"` | Done | Code enforces it — `implemented_by` says where |

- **Logged → Validated:** Requires evidence (applied in practice, user confirmed, test passed). "Sounds right" is not evidence.
- **Validated → Implemented:** Requires code (hook blocks violations, lint catches pattern, CLAUDE.md rule mandates it).
- **Implemented learnings stay** — provenance record for WHY the hook/rule exists.

`implemented_by` values: `"hook:hook-name"`, `"rule:CLAUDE.md§N"`, `"hygiene:RuleNN"`, `"lint:script-name"`
