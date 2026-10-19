---
guide: README-SECURITY
anchor: none
shape: notice
timing: reference
lead_time: "none"
---

# MC Application-Security Knowledge Library — agent training references

> This is the **security-hardening knowledge library**: 9 self-contained, teachable references that **train the Security pod agents** — `security-builder` (builds the hardening), `security-fixer` (repairs it), and `security-reviewer` (the binding red-team verdict). Each ref closes with a §6 **agent-applicable RULES** section phrased as PASS/FAIL assertions in the reviewer's own finding vocabulary, so a ref is something an agent can grade a build against.
>
> **These are NOT launch guides.** Every ref here is `anchor: none` — they are *agent grounding*, consumed at judgment time, not staged into the spinup/lastmile bootstrap pipeline. The newbie-facing, plain-language launch playbook for the same topics is the separate **[`_guides/SECURITY_GUIDE.md`](../../_guides/SECURITY_GUIDE.md)** ("How Not to Get Hacked"). This library is the deep, precise, reviewer-grade layer behind it.
>
> **Machine-readable index:** `_knowledge/security/registry.json` — per-ref `tier` / `rule_prefix` / `trains` / `maps_to`, plus a coverage block proving every security-review axis is owned by ≥1 ref.

---

## How the agents consume these

| Agent | What it reads here |
|---|---|
| **security-builder** | every ref — to build hardening that satisfies the §6 RULES up front (authz/RLS, secrets handling, rate limits + quotas, prompt-injection defenses, input validation, web headers) rather than retrofitting them. |
| **security-fixer** | the ref matching the issue in its Fix Brief — to repair a specific finding without weakening the rest. |
| **security-reviewer** | every ref's §6 RULES as part of its deterministic OWASP / authn-z / injection / secrets / prompt-injection review — the assertions are written so a finding maps to a stable rule ID + severity. |

Producer/owner: **`security-lead`** (the Security pod manager). Each agent applies the matching refs' §6 RULES in its own finding/verdict vocabulary; the refs supply the *principle*, the agent keeps its existing output contract.

---

## The 9 references

| Ref | Tier | Rule IDs | Maps to |
|---|---|---|---|
| [AUTHZ_AND_TENANT_ISOLATION](AUTHZ_AND_TENANT_ISOLATION.md) | core | `AUTHZ-*` | authz |
| [AUTHENTICATION_AND_SESSION](AUTHENTICATION_AND_SESSION.md) | core | `AUTHN-*` | auth-session · authz |
| [SECRETS_AND_CONFIG](SECRETS_AND_CONFIG.md) | core | `SECRET-*` | secrets |
| [RATE_LIMITING_AND_ABUSE](RATE_LIMITING_AND_ABUSE.md) | core | `RATE-*` | rate-limiting · authz |
| [PROMPT_INJECTION_AND_LLM](PROMPT_INJECTION_AND_LLM.md) | core | `PINJ-*` | prompt-injection · input-validation |
| [INPUT_VALIDATION_AND_INJECTION](INPUT_VALIDATION_AND_INJECTION.md) | core | `INVAL-*` | input-validation |
| [WEB_SECURITY_HEADERS_CSRF_CORS](WEB_SECURITY_HEADERS_CSRF_CORS.md) | standard | `WEBSEC-*` | web-hardening · supply-chain |
| [LOGGING_BACKUP_IR](LOGGING_BACKUP_IR.md) | core | `OPS-*` | detect-respond |
| [MOBILE_CLIENT_SECURITY](MOBILE_CLIENT_SECURITY.md) | standard | `MOB-*` | mobile-client |

**Coverage — every security-review axis is owned by ≥1 ref:** `authz` (AUTHZ, RATE, AUTHN) · `auth-session` (AUTHN) · `secrets` (SECRET) · `rate-limiting` (RATE) · `prompt-injection` (PINJ) · `input-validation` (INVAL, PINJ) · `web-hardening` (WEBSEC) · `supply-chain` (WEBSEC) · `detect-respond` (OPS) · `mobile-client` (MOB). No gap.

---

## Wiring

This library is **agent grounding (`anchor: none`)** — it is grounded into each consumer spec via a `<!-- knowledge:security role:<role> -->` marker block, wired by `/knowledge:integrate` and enforced by `/knowledge:coverage` (registry fresh · every consumer carries a live marker backed by a record · index count matches the on-disk refs). The refs are consumed live by the Security pod, not staged as bootstrap markers.

---

*The MC application-security knowledge library — framework-generic, reviewer-grade security judgment training, grounded in OWASP (Top 10 2025, API Top 10 2023, LLM Top 10 2025, Cheat Sheets), Supabase/Postgres RLS docs, and current 2025–2026 incident evidence. Sources are cited per ref. Last reviewed: 2026-06. Not a substitute for a professional security audit on apps handling sensitive data.*
