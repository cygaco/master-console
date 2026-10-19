# Growth Mechanics Knowledge Library

> Agent-grounding references for the cheapest growth loops a launch-stage product gets — store reviews, referrals, and the onboarding path to activation. The center of gravity: the popular review-gating pattern is banned/risky, referrals come after retention, and every signup field before value is a toll booth.

The founder-facing companions are `_guides/GROWTH_LOOPS_GUIDE.md` and `_guides/ONBOARDING_GUIDE.md`.

## Consumers

| Role | How it uses this library |
|---|---|
| `marketing-lead` | Judges growth-loop plans (review prompting, referral economics, k-factor claims) against the rules. |
| `product-lead` | Authors build specs for onboarding/activation and review-prompt flows that pass `GRW-*` by construction. |
| `qa-reviewer` | Flags review-gating violations and untested anonymous-linking paths in built features. |

## References

| Ref | Rule IDs | Purpose |
|---|---|---|
| [REVIEW_PROMPT_COMPLIANCE](REVIEW_PROMPT_COMPLIANCE.md) | `GRW-REV-*` | The banned gating pattern, the verified policy ground truth, and the decoupled two-flow design. |
| [REFERRAL_MECHANICS](REFERRAL_MECHANICS.md) | `GRW-REF-*` | Retention-before-referrals, attribution architecture, reward economics, solo-founder fraud minimums. |
| [ONBOARDING_ACTIVATION](ONBOARDING_ACTIVATION.md) | `GRW-ONB-*` | Signup-wall placement, progressive profiling, anonymous-mode footguns, minors escalation. |

## Wiring

Grounded by `<!-- knowledge:growth-mechanics role:<role> -->` marker blocks in consumer specs and active rows in `.claude/project/maps/knowledge-integration.jsonl`.

*Last reviewed: 2026-06.*
