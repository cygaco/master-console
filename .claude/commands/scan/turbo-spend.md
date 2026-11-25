---
description: Report what the turbo session's cross-provider API calls really cost against the operator-set ceiling (framework default $100, raisable at runtime), and check the turbo permission profile stays honest (turbo grants no push; no push scope may be auto or notice). Report-only for the cost total; fail-open on a ledger fault. A separate scan, not part of /scan:full.
disable-model-invocation: true
---

# /scan:turbo-spend — Turbo spend ledger + profile honesty

The turbo-hardening backstop. Two surfaces in one report:

1. **Spend ledger (REPORT-ONLY).** Sums the REAL paid cross-provider dispatcher
   calls (`scripts/dispatch-agent.js` → GPT / Gemini, recorded in
   `paths.dispatchCompletionsFile`) for the session and compares the estimated
   total against the resolved ceiling. The ceiling is **source-vs-instance**
   the runtime override in `authorization.json` (`spend_ceiling_usd`)
   when present+valid, **else the framework default $100** —
   never a hardcoded instance value. Budget-approach warnings (≥80%) and
   under-budget notices are emitted but NEVER block. The real gates are the
   **$5/op CLAUDE.md autonomy line** and the **operator session ceiling**.

2. **Profile honesty (HAS TEETH).** Validates the `auto / notice / confirm / never`
   permission profile (`scripts/turbo/permission-profile.js`). **Turbo grants no
   push**, so the profile has no push action class: the harness auto-mode
   classifier sits ABOVE `permissions.allow` and reads push trust only from the
   user settings (the operator's own `scripts/operator/trust-my-repos.js`). A
   candidate profile that declares a push scope at `auto`/`notice` is a
   dishonest overclaim → HARD finding (exit 1).

> Intentionally NOT part of `/scan:full` — this is a standalone, opt-in scan.

## What it does

```
node scripts/checks/turbo-spend.js [--json] [--profile <file>]
```

- Default: validates the CANONICAL profile + reports session spend.
- `--profile <file>`: validate a candidate profile JSON (a planted auto-push
  profile is flagged → exit 1).
- `--json`: machine envelope.

## Exit codes

- `0` — spend reported; profile honest (the normal path). **Spend state NEVER
  drives a non-zero exit** (report-only).
- `1` — a profile honesty / hard-ceiling violation was found (e.g. an auto-push
  overclaim or a lifted hard ceiling).

A malformed / absent ledger is **fail-open** (exit 0) — a ledger fault must never
stall the build.

## Pairs with

- `scripts/turbo/spend-ledger.js` — the report-only spend ledger + ceiling resolution.
- `scripts/turbo/permission-profile.js` — the explicit `auto/notice/confirm/never` scope→level table + honesty validator.
- `scripts/turbo/apply.js` + `scripts/hooks/authorization-gate.js` — the turbo grant + the PreToolUse authorization gate.
- `.claude/agents/president/_system/policy/decision-policy.md` § "Autonomy-ceiling resolution" — the turbo autonomy-ceiling rule.
