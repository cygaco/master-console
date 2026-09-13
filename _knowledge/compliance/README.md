---
guide: README-COMPLIANCE
anchor: none
shape: notice
timing: reference
lead_time: "none"
---

# MC Launch-Compliance Knowledge Library — agent training references

> This is the **launch-compliance knowledge library**: 8 self-contained, teachable references that **train the `qa-reviewer`'s integrity/compliance scope** — the review lane that asks "is this product *legally and policy* shippable?" alongside its correctness checks. Each ref closes with a §6 **agent-applicable RULES** section; because much of compliance needs human/legal judgment, many rules are written as **FLAGs** (the reviewer surfaces them for human confirmation) rather than hard automated PASS/FAIL.
>
> **⚠️ Not legal advice.** These refs train a reviewer to *spot likely issues + missing artifacts*; they do not make a product compliant and do not replace a lawyer. The hire-a-lawyer triggers live inside the refs.
>
> **These are NOT launch guides.** Every ref here is `anchor: none` — *agent grounding*, not staged into the spinup/lastmile bootstrap pipeline. The newbie-facing, plain-language playbooks for the same topics are the separate launch guides **[`_guides/LEGAL_GUIDE.md`](../../_guides/LEGAL_GUIDE.md)**, **[`_guides/PRIVACY_GDPR_GUIDE.md`](../../_guides/PRIVACY_GDPR_GUIDE.md)**, and **[`_guides/APP_STORE_GUIDE.md`](../../_guides/APP_STORE_GUIDE.md)**. This library is the deep, reviewer-grade layer behind them.
>
> **Machine-readable index:** `_knowledge/compliance/registry.json` — per-ref `tier` / `rule_prefix` / `trains` / `maps_to`, plus a coverage block proving every compliance axis is owned by ≥1 ref.

---

## How the agent consumes these

| Agent | What it reads here |
|---|---|
| **qa-reviewer** (integrity/compliance scope) | every ref's §6 RULES — to extend its existing integrity checks (COPY.md exact-match, hallucinated-dep, the violation types) with code↔policy↔store-label compliance: does every collected data point appear in the privacy policy + the Apple/Google privacy labels (three-way match); is every paid subscription cancellable; is the app-store-policy surface covered; is there an IP/trademark/AGPL exposure to flag. |

Producer/owner: **`quality-lead`** (owns the verdict on quality, dispatches the qa-reviewer). The refs supply the *principle*; the qa-reviewer keeps its existing binding output contract and finding vocabulary. The block **grounds, it never weakens** the reviewer's existing review.

---

## The 8 references

| Ref | Tier | Rule IDs | Maps to |
|---|---|---|---|
| [PRIVACY_AND_DATA_COMPLIANCE](PRIVACY_AND_DATA_COMPLIANCE.md) | core | `PRIV-*` | privacy-data |
| [CONSUMER_PROTECTION_AND_SUBSCRIPTIONS](CONSUMER_PROTECTION_AND_SUBSCRIPTIONS.md) | core | `SUBS-*` | consumer-subscriptions |
| [APP_STORE_AND_PLATFORM_POLICY](APP_STORE_AND_PLATFORM_POLICY.md) | core | `STORE-*` | app-store-policy · privacy-data |
| [IP_AND_TRADEMARK](IP_AND_TRADEMARK.md) | standard | `IP-*` | ip-trademark |
| [DATA_RIGHTS_OPERATIONS](DATA_RIGHTS_OPERATIONS.md) | core | `DSR-*` | data-rights-ops · privacy-data |
| [INCIDENT_READINESS](INCIDENT_READINESS.md) | core | `BRCH-*` | breach-incident |
| [MINORS_AND_AGE_ASSURANCE](MINORS_AND_AGE_ASSURANCE.md) | core | `MINOR-*` | minors · privacy-data |
| [AI_PRODUCT_COMPLIANCE](AI_PRODUCT_COMPLIANCE.md) | core | `AIACT-*` | ai-compliance · privacy-data |

**Coverage — every compliance axis is owned by ≥1 ref:** `privacy-data` (PRIVACY, STORE, DSR, MINOR, AIACT) · `consumer-subscriptions` (SUBS) · `app-store-policy` (STORE) · `ip-trademark` (IP) · `data-rights-ops` (DSR) · `breach-incident` (BRCH) · `minors` (MINOR) · `ai-compliance` (AIACT). No gap.

The founder-facing companions for the new refs: [`_guides/DATA_REQUESTS_GUIDE.md`](../../_guides/DATA_REQUESTS_GUIDE.md), [`_guides/INCIDENT_RESPONSE_GUIDE.md`](../../_guides/INCIDENT_RESPONSE_GUIDE.md), [`_guides/MINORS_GUIDE.md`](../../_guides/MINORS_GUIDE.md), [`_guides/AI_COMPLIANCE_GUIDE.md`](../../_guides/AI_COMPLIANCE_GUIDE.md), [`_guides/SUBSCRIPTION_CANCELLATION_GUIDE.md`](../../_guides/SUBSCRIPTION_CANCELLATION_GUIDE.md), [`_guides/COMPLIANCE_TRIGGERS_GUIDE.md`](../../_guides/COMPLIANCE_TRIGGERS_GUIDE.md). A guardrail by construction: the reviewer FLAGS possible breach-notification duties but never concludes "no notice required" (BRCH-07), and the under-13 line stays a counsel escalation.

---

## Wiring

This library is **agent grounding (`anchor: none`)** — grounded into the consumer spec via a `<!-- knowledge:compliance role:qa-reviewer -->` marker block, wired by `/knowledge:integrate` and enforced by `/knowledge:coverage`. Consumed live by the qa-reviewer at review time, not staged as a bootstrap marker.

---

*The MC launch-compliance knowledge library — framework-generic, reviewer-grade compliance judgment training, grounded in current 2025–2026 primary sources (FTC, USPTO, US Copyright Office, GDPR/CCPA text, Apple App Review Guidelines, Google Play policy). Sources cited per ref. Last reviewed: 2026-06. **Not legal advice** — a flagged item means "get a human/lawyer to confirm," not "this is fine."*
