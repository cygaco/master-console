# Launch-readiness research envelopes (2026-06)

Source: three parallel deep-research agents (Claude multi-round WebSearch+WebFetch), for the `_guides/` + `_knowledge/` launch-readiness build. Subagent disk-writes were blocked by harness policy, so these envelopes (the agents' final returned work-product) are persisted here by Alpha for provenance. Re-verify all in-flux items at the live sources before relying on them.

---

## 1. SECURITY HARDENING (indie / vibe-coded SaaS + AI) — 2025-2026

**STATUS / IN-FLUX:**
- OWASP web **Top 10 2025 is FINAL** (~Nov 2025). 2021 is prior. Map both IDs. https://owasp.org/Top10/2025/
- Supabase **new API keys (June 2025)**: `sb_publishable_` (safe) / `sb_secret_` (server-only, 401 from browser origins, GitHub auto-revocable). Legacy `anon`/`service_role` JWTs still exist → handle BOTH. https://supabase.com/docs
- Prompt injection is **unsolved** — all defenses probabilistic; reject "injection-proof" claims.
- Login lockout: OWASP cites both **3–5** and **5–10** (no single canonical number).

**1 · Supabase RLS / IDOR**
- `ALTER TABLE <s>.<t> ENABLE ROW LEVEL SECURITY;` required for any `public`-schema (PostgREST-exposed) table. RLS-on + zero policies = deny-all. https://supabase.com/docs/guides/database/postgres/row-level-security
- `service_role` bypasses RLS (Postgres `BYPASSRLS`); anon key has no privileges but reads RLS-off tables. NEVER client-side. `FORCE ROW LEVEL SECURITY` applies RLS to the table owner too.
- Perf: use `(select auth.uid())` not bare `auth.uid()` (initPlan caches per-query).
- Linter warning **"RLS Disabled in Public"**; dashboard Auth→Policies→"Enable RLS on new tables". SQL-Editor-created tables default RLS OFF (leak vector).
- **IDOR = OWASP API1:2023 BOLA**; web = **A01 Broken Access Control (#1 in 2021 & 2025)**. **CVE-2025-48757** (May 2025): 170 Lovable projects / 303 endpoints had anon-readable tables.

**2 · Secrets**
- Inlined-into-frontend-build = public: Next `NEXT_PUBLIC_*`, Vite `VITE_*`, Expo `EXPO_PUBLIC_*`. A secret under these prefixes = FAIL. ~half of AI-gen Supabase apps leaked `service_role` browser-reachable.
- **gitleaks** (pre-commit, 150+ patterns), **TruffleHog** (CI, 800+ types, live-verifies), git-secrets/detect-secrets. Combo: gitleaks pre-commit + TruffleHog CI.
- **GitHub Secret Scanning + Push Protection** blocks pushes; deleted/force-pushed commits still scrapeable (Force Push Scanner / "Oops Commits", 2025).
- Rotate (don't just delete) leaked keys.

**3 · Rate limiting / abuse**
- LLM cost abuse = **OWASP LLM10:2025 Unbounded Consumption**; rate-limit + per-user/per-tier quotas + max-token/spend caps. https://genai.owasp.org/llm-top-10/
- Auth: lockout 3–5 (or 5–10) fails; 5/15min common; **tie counter to ACCOUNT not IP** (defeats distributed stuffing); CAPTCHA+backoff+MFA (MFA stops ~99.9%). No-quota class = OWASP BLA7:2025. https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html
- **Upstash Ratelimit** (Redis, serverless): fixed/sliding window + token bucket. + Cloudflare/Vercel WAF.

**4 · Prompt injection / LLM**
- **OWASP LLM Top 10 2025**: LLM01 Prompt Injection, LLM05 Improper Output Handling, LLM06 Excessive Agency, LLM07 System Prompt Leakage, LLM10 Unbounded Consumption. https://genai.owasp.org/llm-top-10/
- LLM01 mitigations: constrain behavior; define+validate output formats; input/output filtering; **least-privilege tools**; **human-in-the-loop** for privileged ops; **segregate/delimit untrusted content**; adversarial testing. Injection need not be human-readable.
- **Indirect injection via RAG/tool output** unfixed by RAG/fine-tune; treat ALL model output as untrusted; never put user/retrieved content in the system-prompt position. **Spotlighting** (trust-tier delimiting) = probabilistic baseline.

**5 · Input validation**
- **Zod** (`.max(n)`, strict, reject unknown keys), Pydantic, Joi. Validate body+params+query.
- Body-size cap: `express.json({limit:"100kb"})` (250mb default region = DoS footgun).
- **A05:2025 Injection** now includes XSS; **SSRF folded into A01:2025**. Parameterized SQL; context-aware output encoding + CSP; allowlist outbound (block internal IP/metadata). **Allowlist > denylist.**
- File upload: validate **magic bytes** server-side (file-type/python-magic), NEVER trust Content-Type/extension; extension allowlist + max size.

**6 · Adjacent**
- **Helmet** (~11 default headers): **CSP** (`frame-ancestors`), **HSTS** (`max-age=63072000;includeSubDomains;preload`), **X-Content-Type-Options: nosniff**. https://owasp.org/www-project-secure-headers/
- Cookies: **HttpOnly + Secure + SameSite=Strict/Lax**. CSRF: SameSite + token on cookie-auth state changes (bearer-header APIs ~immune).
- **CORS**: `ACAO:*` forbidden with credentials; reflecting Origin+creds equally exploitable; fix = server-side origin allowlist, never reflect.
- JWT (A07:2025): verify sig+exp/aud/iss; short-lived + rotating refresh; HttpOnly over localStorage.
- **Supply chain → A03:2025 (NEW, Software Supply Chain Failures)**: commit lockfiles + `npm ci`; Dependabot/Renovate + cooldown/min-package-age; 2025 npm waves (Sept-2025 chalk/debug phishing 180+ pkgs; 454k malicious pkgs in 2025).
- OWASP 2025: A01 Broken Access Control · A02 Security Misconfig · A03 Supply Chain (NEW) · A04 Crypto · A05 Injection(+XSS) · A06 Insecure Design · A07 Auth · A08 Integrity · A09 Logging · A10 Mishandling Exceptional Conditions (NEW).

---

## 2. iOS APP STORE APPROVAL — 2025-2026

Legend: **[RULE]** Apple enforces · **[BP]** best-practice, not required · **[FLUX]** in litigation/active change. Live source: https://developer.apple.com/app-store/review/guidelines/

**1 · Privacy / Terms / Manifest**
- **[RULE] 5.1.1(i)** — privacy-policy URL required in App Store Connect metadata AND in-app; state data collected, third-party/SDK sharing, retention/deletion, consent revoke.
- **[RULE] 5.1.1(v)** — account creation ⇒ must offer in-app account deletion.
- **[RULE, Nov 2025] 5.1.2(i)** — disclose + get explicit consent before sharing personal data with third parties "including with third-party AI."
- **[RULE] App Privacy "nutrition label"** — App Store Connect questionnaire, 14 data categories, covers app + SDKs; on-device-only ≠ collected.
- **[RULE, enforced May 1 2024] Privacy Manifest `PrivacyInfo.xcprivacy`** — declares data types + approved reason for each Required Reason API; missing = rejection at upload. Third-party SDKs must ship signed manifests.
- EULA: Apple Standard EULA applies by default; custom only if terms differ.

**2 · Landing page / waitlist vs completeness**
- **[BP, NOT a rule]** Landing page / waitlist is NOT required by Apple — pure demand-validation advice.
- **[RULE] 2.1 App Completeness** — final version, scrub placeholder/empty/temporary content, include demo account creds if login-gated, no crashes.
- **[RULE] 4.2 Minimum Functionality** — must be more than a repackaged website; 4.2.6 template/generator output rejected unless by content provider. (The thin/web-wrapper rejection.)

**3 · TestFlight + Sign in with Apple**
- TestFlight: internal ≤100 ASC users (immediate, no review); external ≤10,000 (first build → Beta App Review); builds expire 90 days.
- **[RULE] 4.8 Sign in with Apple** — TRIGGER: third-party/social login (Google/Facebook/X…) for the primary account ⇒ must also offer equivalent privacy option. EXCEPTIONS: own-only account system, education/enterprise, gov eID, or a client for a specific service (Gmail/Dropbox). Email/password-only or SiwA-only don't trigger it.

**4 · IAP / payments — [FLUX]**
- **[RULE] 3.1.1** — in-app digital goods/subscriptions/unlocks MUST use Apple IAP/StoreKit, not Stripe/PayPal. Commission 30% / 15% (Small Business Program <$1M & yr-2 subs).
- **[RULE] 3.1.3(e)** — physical goods/services consumed outside app must use non-IAP (Apple Pay/card). **3.1.3(a) reader apps** may use External Link Account Entitlement.
- **[FLUX — US, May 1 2025]** Post-Epic (Gonzalez Rogers): new 3.1.1(a) — US storefront, external links/buttons allowed, NO entitlement required, commission-free; old 27% fee gone. **Apple is appealing** — could revert.
- **[FLUX — EU, June 2025]** DMA: alt-marketplaces/web distribution/external payments allowed but Core Technology Fee (€0.50/install >1M) → Core Technology Commission 5% (targeted 2026) + Store Services 5–13% ≈ ~10–20% total, NOT zero.
- **[RULE — rest of world]** Default IAP required (minor carve-outs: NL dating, S. Korea).

**5 · Rejections + flow**
- Top causes: 2.1 crashes/placeholder/blocked demo (~25%); 4.2 thin/wrapper/template; 5.1.1 privacy URL+label+manifest; 4.3 duplicate/saturated; 2.3 metadata mismatch / hidden features / undisclosed IAP / keyword stuffing; 3.1.1 non-Apple payment; 4.8 social-login-without-equivalent. ~17% rejected first submit.
- Login apps MUST supply working demo credentials in App Review Information. Timeline: ~90% <24h, new apps 24–48h. Expedited review for critical bug/time-sensitive only. Resubmit via Resolution Center citing the guideline #.

**6 · Google Play (brief)**
- Personal accounts created after Nov 13 2023: closed test ≥12 testers opted-in ≥14 continuous days before production (was 20; cut to 12 on Dec 11 2024); org accounts exempt. https://support.google.com/googleplay/android-developer/answer/14151465
- Google Play Billing for digital goods; Data safety form required + accurate; $25 one-time fee.

**Watch-out for an AI compliance reviewer:** never assert "you can link out / no commission" without qualifying US (contested, Apple appealing) vs EU (DMA fees ~10–20%) vs rest-of-world (IAP-only) + the date.

---

## 3. LEGAL PROTECTION — 2025-2026

**NOT legal advice.** Focus = the beyond-privacy layer (sibling PRIVACY_GDPR_GUIDE covers data law depth).

**FTC Click-to-Cancel — ⚠️ VACATED (get this right):** amended Negative Option Rule **16 CFR Part 425**, finalized Oct 2024, enforcement set July 14 2025, **VACATED IN ITS ENTIRETY July 8 2025** by the **8th Circuit** (*Custom Communications, Inc. v. FTC*, No. 24-3137) on PROCEDURAL grounds (FTC skipped the §22 preliminary regulatory analysis) — NOT a merits rejection. **No operative federal click-to-cancel rule now.** Still binds federally: **ROSCA** (15 U.S.C. 8401-8405 — disclosure + express consent + simple cancel) + FTC Act §5. https://www.wilmerhale.com/en/insights/client-alerts/20250801-eighth-circuit-vacates-the-ftcs-click-to-cancel-rule

**California ARL (the real US constraint) — Bus. & Prof. Code 17600 et seq., amended AB 2863, EFFECTIVE July 1 2025:** click-to-cancel (same medium as sign-up); **two separate consents** (service + auto-renewal); covers free trials; clear pre-billing disclosure; annual reminder; keep consent records ≥3 yrs. Other state ARLs: NY GBL 527-a, MA 940 CMR 38.00. https://www.dwt.com/insights/2024/10/ab-2863-updates-california-automatic-renewal-law

**EU — new "Withdrawal Button," Directive (EU) 2023/2673:** prominent "Cancel my contract" function; transpose by Dec 19 2025, **applies June 19 2026**; hits non-EU sellers to EU. Plus the 14-day right of withdrawal (Dir 2011/83/EU).

**Apple/Google cancel natively** but dev must disclose terms: Apple **Guideline 3.1.2** (title/term/price/auto-renew before purchase); Google Play (offer terms, cost, billing freq). **Web/Stripe billing = no native cancel → build it yourself** to satisfy CA ARL + ROSCA.

**Privacy Policy** required (GDPR/CCPA + Apple & Google both require a policy URL); Stripe requires a **DPA** for EU/CA enterprise. **ToS must contain:** acceptable use, **limitation of liability** (cap = 12-mo fees), warranty disclaimers/"AS IS", governing law + venue, arbitration + class-waiver (30-day opt-out for consumer enforceability), termination, IP ownership (user owns content + grants you a license), indemnification.

**Declare every data point — must MATCH reality:** GDPR **Art. 30 ROPA** (data inventory); CCPA "categories of PI"; **Apple Nutrition Labels + Google Data Safety form** must equal code + policy (Google Apr-2025: Android ID = device identifier; "sharing" = any third-party/SDK transfer). Regimes: GDPR=EU/EEA/UK; CCPA = CA + >$26.6M rev OR 100k consumers OR ≥50% rev from PI sale; **20 US states** comprehensive as of 2026 (Texas TDPSA = no volume threshold; IN/KY/RI eff Jan 1 2026).

**Trademark:** USPTO **"Trademark Search" → https://tmsearch.uspto.gov** (replaced TESS Nov 30 2023). Software = **Nice Class 9** (downloadable) + **Class 42** (SaaS) — search BOTH. Test = **likelihood of confusion**. Free knockout misses sound-alikes/common-law → comprehensive clearance before committing a name. Also check Google/store/domain.

**AI content copyright (USCO "Copyright & AI Part 2," Jan 29 2025):** fully AI-generated output **NOT copyrightable**; prompts alone confer no copyright; only human creative contribution is protectable.

**Open source:** MIT/Apache/BSD permissive = attribution only (Apache adds patent grant + NOTICE); GPL = strong copyleft on distribution; **AGPL = SaaS TRAP** — network use triggers source-disclosure even without distributing a binary → avoid in closed-source SaaS or buy a commercial license; run an SCA/SBOM scan.

**Entity:** single-member **LLC** (US)/Ltd shields personal assets but veil pierces if you commingle funds/skip formalities → separate bank account + records. **Accessibility:** US ADA web suits 3,117 federal filings in 2025; **EU EAA in force June 28 2025** (full deadline 2030; <10-employee service providers exempt).

**HIRE A LAWYER when:** health/HIPAA, finance/payments, children/COPPA, **biometrics/BIPA**, equity/fundraising/SAFEs, hiring/IP-assignment, comprehensive trademark clearance or a C&D, AGPL in your tree, enterprise MSAs/DPAs at scale, or any claim/regulator inquiry.
