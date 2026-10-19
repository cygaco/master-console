# ADR NNNN — [Title]

**Date:** YYYY-MM-DD
**Status:** proposed | accepted | superseded by ADR-NNNN
**Class:** B (architectural impact) — Class A decisions don't get ADRs.

---

## Decision

What we will do, in one sentence. State the chosen option directly. No hedging.

## Context

What problem are we solving? What constraints exist? What changed that made this decision necessary?

Keep this section to the actual context. Don't restate the product or the stack — link to `_requirements/00-canonical/` or `_requirements/03-architecture/` for those.

## Options considered

1. **Option A — [name]:** one-line summary
2. **Option B — [name]:** one-line summary
3. **Option C — [name]:** one-line summary

If only one option was seriously considered, say so and explain why the others were dismissed before scoring.

## Decision criteria

Score against the rubric in `paths.decisionPolicy`. Note the criteria that mattered most for this decision (often a subset of the full rubric).

| Criterion | Option A | Option B | Option C |
|---|---|---|---|
| Product fit | high | medium | low |
| Simplicity | high | low | medium |
| Reliability | medium | high | high |
| Reversibility | high | low | medium |
| ... | ... | ... | ... |

## Why this option won

One paragraph. Reference the rubric scores. State the tiebreaker if the scores were close.

## Risks

Known downsides of the chosen option. Be specific. "It might not scale" is not a risk; "queue depth >10k will block the function timeout" is.

## Mitigations

How we reduce each risk. Tied 1:1 to the risks above.

## Reversal plan

How we would change this later if we needed to. What's the cost? What signals would trigger reversal?

## References

- Related ADRs (supersedes, supersedes-by, related)
- Implementation PR / commit
- Relevant `_requirements/03-architecture/` files this decision touches
