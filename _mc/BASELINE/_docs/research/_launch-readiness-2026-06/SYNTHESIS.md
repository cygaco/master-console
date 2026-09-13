# Launch-Readiness Deep-Research Verification — Synthesis (2026-06)

> **What this is:** a cross-check of three real OpenAI `o3-deep-research` reports (plus one `o4-mini-deep-research` legal cross-check) against the launch-readiness research that earlier fed (or will feed) the MC launch guides. Verification pass — confirm what's confirmed, flag only *real* factual contradictions.
>
> **Provenance:** the four verbatim reports live beside this file (`deep-research-security-o3.md`, `deep-research-appstore-o3.md`, `deep-research-legal-o3.md`, `deep-research-legal-o4mini.md`).

---

## (a) Executive summary

The independent `o3-deep-research` reports **broadly confirm** the substance of the earlier Claude-engine launch research on all three topics — security hardening, iOS App Store approval, and solo-founder legal protection. The overwhelming majority of claims (RLS-by-default, service-role secrecy, rate-limiting / denial-of-wallet, prompt-injection-is-unsolved, magic-byte upload validation, secure headers/CORS; Apple privacy-policy + in-app account-deletion + privacy-manifest + Nov-2025 third-party-AI-consent + IAP/anti-steering; ROSCA/FTC-Act, the vacated FTC click-to-cancel rule, GDPR 14-day withdrawal + the 2023/2673 "withdrawal button" directive, USPTO trademark, AI-copyright non-protectability, the AGPL SaaS trap, LLC/veil/insurance/ADA-EAA) are corroborated against primary sources. **Two genuine discrepancies surfaced — one inside the security report (OWASP #10 ordering) and one *between* the two legal reports (California AB 2863 dating).** Both are resolved below; in both cases the better-sourced position is the one already reflected in the prior Claude research / shipped guides.

**Important scope caveat (honesty):** the three guides this pass was framed to "verify" — `_guides/SECURITY_GUIDE.md`, `_guides/APP_STORE_GUIDE.md`, `_guides/LEGAL_GUIDE.md` — **do not yet exist** in the repo. The shipped `_guides/` library currently contains AUTH, DATABASE, DEV_SETUP, EMAIL, PAYMENTS, and PRIVACY_GDPR (per `_guides/registry.json`). Likewise `_knowledge/security/` and `_knowledge/compliance/` do not exist (only `audience/`, `copy/`, `design/`). So this synthesis verifies the **deep research itself** (the input that will author those three guides), and where the topics overlap an *already-shipped* guide it cross-checks that guide directly:
- App Store research ↔ `DEV_SETUP_GUIDE.md` (the app-store-registration overlap)
- Legal research ↔ `PRIVACY_GDPR_GUIDE.md` (the privacy/legal gate)
- Security research ↔ no shipped guide yet

Net: deep research is sound and ready to author the three missing guides; the two shipped guides it touches need **no corrections**, only optional enrichment.

---

## (b) Per-topic verdicts

### Security — **CONFIRMED** (research sound; one internal numbering wrinkle, see Discrepancy A)

The o3 security report (`deep-research-security-o3.md`, 690s) verified the core hardening checklist against strong sources:
- **RLS by default / BOLA** — Supabase shipped RLS *off* by default; mid-2025 flipped new-table defaults; service_role key has `BYPASSRLS` and must stay server-side. Anchored to the Lovable/CVE-2025-48757 incident and Supabase's own docs. (HIGH)
- **Secret hygiene** — no secrets in git/client bundles; `NEXT_PUBLIC_`/`VITE_` are public; secret scanning (Gitleaks/TruffleHog, GitHub push-protection) + immediate rotation. (HIGH)
- **Rate limiting / denial-of-wallet** — OWASP LLM10:2025 Unbounded Consumption; per-user/IP quotas; account-based login throttling over IP-based; MFA. (HIGH, OWASP GenAI primary source)
- **Prompt injection unsolved** — OWASP LLM01; NCSC "prompt injection is not SQL injection" (Dec 2025); OpenAI's own "unlikely to ever be fully solved." Delimiting, output-as-untrusted, least privilege, indirect/RAG injection. (HIGH)
- **Input validation, magic-byte upload checks, security headers (CSP/HSTS/nosniff), secure cookies + CSRF, CORS no-wildcard-with-credentials, supply-chain / slopsquatting.** All confirmed against MDN, OWASP, BleepingComputer, Transloadit, TechRadar. (HIGH)

The **one wrinkle** is the OWASP Top 10:2025 *ordering* the report asserts (Discrepancy A) — it does not undermine any hardening *action* (every control above stands regardless of which slot SSRF/Injection occupy).

### iOS App Store — **CONFIRMED**

The o3 app-store report (`deep-research-appstore-o3.md`, 507s) is the strongest-sourced of the three (almost entirely Apple primary docs, updated Nov 13 2025):
- **Privacy policy required** (5.1.1(i), URL in metadata + in-app), **in-app account deletion** (5.1.1(v), since 2022), **App Privacy "nutrition label"** mandatory, **Privacy Manifest + Required-Reason APIs** enforced since **May 1 2024**, and the **new Nov-2025 5.1.2(i) third-party-AI data-sharing consent** rule. (all HIGH)
- **Completeness / minimum functionality** (2.1, 4.2) — no placeholder/"waitlist" apps; demo creds required; no thin web wrappers. (HIGH)
- **TestFlight** internal (no review) vs external (Beta App Review); **Sign in with Apple** (4.8) required when other social SSO is offered. (HIGH)
- **IAP** (3.1.1 digital goods), physical-goods/reader-app carve-outs, **Epic anti-steering** (MEDIUM — implementation in flux), **EU DMA / Core Technology Fee** (MEDIUM — region-specific). Google Play parallels: data-safety form, 12-tester/14-day closed test for new personal accounts, Play Billing.

Cross-check vs the shipped **`DEV_SETUP_GUIDE.md`**: fully consistent. The guide already captures the Play 12-tester/14-day closed-test rule, Apple ~2-day payment processing, Sign-in-with-Apple rejection trigger, and the privacy-policy-URL requirement. No conflict.

### Legal — **CONFIRMED** (o3 report is reliable; the *o4-mini* report is the outlier — see Discrepancy B)

The o3 legal report (`deep-research-legal-o3.md`, 803s) confirmed:
- **ToS + privacy-policy** practical necessity; standard clause set (acceptable-use, IP, AS-IS disclaimer, liability cap ~12 months' fees, governing law, arbitration + class-waiver w/ 30-day opt-out, termination, indemnification). (HIGH/MEDIUM on specific caps)
- **FTC click-to-cancel rule VACATED** by the 8th Circuit in *Custom Communications v. FTC* (procedural/economic-analysis defect), ~days before its July 14 2025 effective date — so **ROSCA + FTC Act §5 remain the operative federal law**. (HIGH, both reports agree)
- **State ARLs** (CA, NY effective 2021, MA effective 2024) + EU **14-day withdrawal** and **Directive 2023/2673 "withdrawal button"** (transposed by ~2026). (HIGH)
- **GDPR Art.30 ROPA, CCPA/CPRA categories, ~20-state patchwork, Apple/Google data-safety alignment.** (HIGH)
- **USPTO trademark clearance** (tmsearch.uspto.gov since Nov 2023, classes 9 + 42, likelihood-of-confusion), **AI-generated output not copyrightable** (USCO "Copyright and AI Part II", Jan 2025), **OSS / AGPL SaaS trap**, SBOM/SCA. (HIGH)
- **LLC + corporate-veil, E&O/cyber insurance, ADA (Domino's) + EU EAA June 28 2025, "hire-a-lawyer" triggers** (HIPAA, fintech/KYC-AML, COPPA, BIPA, securities). (HIGH)

Cross-check vs the shipped **`PRIVACY_GDPR_GUIDE.md`**: consistent and complementary. The guide's GDPR/CCPA scope, processor/DPA model, DSAR + erasure, consent-banner opt-in, DPF/SCCs transfer logic, and COPPA age-gate all align with the o3 report. No conflict.

---

## (c) Cross-validation & flagged discrepancies

### Discrepancy A — OWASP Top 10:2025 **#10 = SSRF** (sources genuinely disagree)

- **o3 security report position:** SSRF **remains at #10** (and lists Injection at #5 / A05). Anchored to the official `owasp.org/Top10/` 2025 page.
- **Prior Claude research position:** SSRF *folded into A01 (Broken Access Control)*, with **A10 = "Mishandling of Exceptional Conditions"** — a brand-new 2025 category.
- **Resolution — genuinely unsettled; lean toward the *Claude* (folded-SSRF / new-A10) reading, but mark UNRESOLVED.** The publicly released **OWASP Top 10:2025 (final, released for the 2025 cycle)** did introduce **"Mishandling of Exceptional Conditions"** as a new entry and **merged SSRF into Broken Access Control** — matching the prior Claude research, *not* the o3 report. The o3 report shows internal sourcing strain that undercuts its ordering claim: it asserts "Injection = A05" in prose while its own citation anchors read `#:~:text=1.%20A01%3A2025` (i.e., the snippet it quotes is the A01 line, not an A05 line), indicating the o3 model stitched the 2021 ordering onto a 2025 label. **Practical impact: NONE** — every SSRF/injection control in the security material is recommended regardless of slot. **Flag as a sources-disagree item; do not let the o3 ranking overwrite the Claude ranking in any future SECURITY_GUIDE without a direct re-pull of the live owasp.org/Top10/ page at authoring time.**

### Discrepancy B — California AB 2863 effective date & record-retention (the two legal reports disagree)

- **o3 legal report:** AB 2863 effective **July 1, 2025**; retain consent records **≥3 years (or 1 year after termination, whichever is longer)**. Sourced to **leginfo.legislature.ca.gov** (primary CA statute / bill-compare text).
- **o4-mini legal report:** AB 2863 effective **January 1, 2024**; retain records **25 months**. Sourced to "California 2022 legislation summaries" (secondary, unanchored).
- **Prior Claude research + the (to-be-written) legal guide:** effective **July 1, 2025**; records **≥3 years** (Davis Wright Tremaine).
- **Resolution — o3 wins; o4-mini is the OUTLIER (drop its dating).** AB 2863 was a **2024** California bill (2023–2024 session) amending Bus. & Prof. Code §§17600 et seq., with operative date **July 1, 2025** and a **≥3-year (or 1-year-post-cancellation, whichever longer)** consent-retention requirement. o4-mini's "Jan 1 2024 / 25 months" is internally inconsistent (a 2024 bill cannot have been operative *before* it passed) and rests on a weak secondary citation; it even mislabels the bill as "2022 legislation." The o3 report and the Claude research agree against it. **No guide correction needed** — the better-sourced facts are already what the prior research carried. The o4-mini report is retained only as extra raw data; **its CA-ARL dating should not be propagated.**

### New discrepancies surfaced by the deep research

- **No new *factual* contradictions** against the prior research beyond A and B. The deep research did surface two **net-new authoritative items worth folding into future guides** (additions, not corrections):
  1. **Apple Guideline 5.1.2(i) third-party-AI data-sharing consent** (new Nov 13 2025) — directly relevant to MC-built AI apps; belongs in the future APP_STORE_GUIDE and is a strong candidate cross-ref from `PRIVACY_GDPR_GUIDE.md`.
  2. **EU "Withdrawal Button" Directive (EU) 2023/2673** (cancel-button mandate, ~2026 transposition) — belongs in the future LEGAL_GUIDE's cancellation section and complements `PAYMENTS_GUIDE.md`.
- **Minor o3 sourcing softness (not a discrepancy, a quality note):** the security report leans on several mid-2026-dated secondary blogs (securie.ai, flowpatrol.ai, ptkd.com, bastion.tech) for the Supabase/Lovable narrative. The *claims* are corroborated by Supabase's own security retro and are HIGH-confidence, but a future SECURITY_GUIDE should cite Supabase primary docs over those blogs.

---

## (d) Engines & method

| Topic | Engine | Duration | Status |
|---|---|---|---|
| Security hardening | `o3-deep-research` | 690s | OK |
| iOS App Store approval | `o3-deep-research` | 507s | OK |
| Solo-founder legal | `o3-deep-research` | 803s | OK |
| Solo-founder legal (cross-check) | `o4-mini-deep-research` | — | OK, kept as extra data |

- **All three topics ran on OpenAI `o3-deep-research`.** The legal topic additionally has an `o4-mini-deep-research` report retained as a second opinion (and it is precisely where Discrepancy B's outlier value came from).
- **Gemini Deep Research was UNAVAILABLE** — prepay credits depleted → **HTTP 429** (billing, not a content failure). Confirmed by `gemini-error.json` / `openai-error.json` markers in the per-topic runtime dirs. So this verification rests on OpenAI deep research only (no third independent engine this round).
- **The thing being verified is the Claude-engine launch research** (multi-round web search) that produced the earlier launch-readiness material — i.e., this is OpenAI-o3 fact-checking Claude-engine research, with o4-mini as a tiebreak on legal.
- **Guides note:** the three named guides (SECURITY/APP_STORE/LEGAL) are **not yet authored**; this pass clears the research to write them and finds the two *already-shipped* overlapping guides (DEV_SETUP, PRIVACY_GDPR) need no corrections.

---

## (e) Recommended guide edits (high-value only)

Because SECURITY_GUIDE / APP_STORE_GUIDE / LEGAL_GUIDE do not exist yet, the edits below split into **(1) corrections to shipped guides** and **(2) authoring guidance for the three new guides** so the deep research lands correctly.

**Shipped guides:**
- `_guides/DEV_SETUP_GUIDE.md` — **no edit needed — confirmed.** o3 app-store research is fully consistent (12-tester/14-day, ~2-day Apple payment, Sign-in-with-Apple trigger, privacy-policy URL).
- `_guides/PRIVACY_GDPR_GUIDE.md` — **no correction needed — confirmed.** Optional enrichment (not required): add a one-line cross-ref to the new **Apple 5.1.2(i) third-party-AI consent** rule under §4.1 (note MC builds AI apps, so disclose+consent before sending user data to any third-party AI/model). Source: https://developer.apple.com/news/?id=ey6d8onl (Nov 13 2025). Low priority — belongs more naturally in the future APP_STORE_GUIDE.

**New guides — author with these facts locked (and the two resolved discrepancies applied):**
- **SECURITY_GUIDE.md (to author)** — use the o3 hardening checklist as-is. **On OWASP Top 10:2025 ordering: do NOT adopt the o3 report's "SSRF #10 / Injection A05" list verbatim** (Discrepancy A unresolved); re-pull the live `https://owasp.org/Top10/` at authoring time, and prefer the prior Claude reading (SSRF folded into A01; new A10 = "Mishandling of Exceptional Conditions") until the live page confirms. Cite Supabase primary docs over the *.ai/ptkd blogs for the RLS/service-role narrative.
- **APP_STORE_GUIDE.md (to author)** — adopt the o3 report wholesale (it's near-100% Apple primary sources). **Must include** the new **5.1.2(i) third-party-AI data-sharing consent** rule (Nov 13 2025) — highest-value net-new item. Source: https://developer.apple.com/news/?id=ey6d8onl
- **LEGAL_GUIDE.md (to author)** — adopt the o3 legal report. **California AB 2863 = effective July 1 2025, retain consent records ≥3 years (or 1 year post-cancellation, whichever is longer)** — use the o3 / Claude figure, **discard the o4-mini "Jan 1 2024 / 25 months"** (Discrepancy B). Source: https://leginfo.legislature.ca.gov/faces/billCompareClient.xhtml?bill_id=202320240AB2863 . Include FTC click-to-cancel **VACATED** status (ROSCA/§5 still govern) and the **EU 2023/2673 withdrawal-button** directive. Source: https://www.morganlewis.com/pubs/2025/07/ftcs-click-to-cancel-rule-vacated-ahead-of-planned-july-14-effective-date

---

*Provenance copies (verbatim, byte-identical to the runtime reports) sit beside this file. Verification pass run 2026-06-07. Not legal advice; the legal report is informational only.*
