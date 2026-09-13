## Executive verdict

Your two-guide plan is directionally right, but under-scoped in two places:

1. **“AI-transparency” is too narrow** for an AI product factory. Add a founder-facing **AI_PRODUCT_COMPLIANCE** guide, not just an agent rule-set.
2. **Minors/teens cannot be handled only by an agent rule-set.** Keep the “no under-13 without escalation” stance, but add a short founder guide for **MINORS_AND_TEENS_RISK_TRIAGE**.

Opinionated default posture for newbie global consumer apps:

> **No under-13s, no targeted ads/pixels until mature, no SMS marketing by default, no training on private user content by default, no public UGC/social features without the UGC module, use an app store or merchant-of-record for global B2C payments, and treat any breach involving unencrypted personal data as a legal escalation.**

Also: tax/VAT, SMS/TCPA, UGC/DMCA/DSA/CSAM, consumer-health/biometric data, and adtech/GPC are the most important missing triggered modules.

---

# 1. At-a-glance gap judgment

| Candidate gap | Real gap? | Cost/risk for newbie founder | Shape | Opinionated recommendation |
|---|---:|---:|---|---|
| **1. Data-rights operations** | Yes | High risk, medium build/ops cost | **Both** | Create **DATA_RIGHTS_AND_RETENTION_OPS** guide + agent rules. Existing build checklist is not enough. |
| **2. Breach/incident notification** | Yes | Very high risk, low prep cost, high incident cost | **Both**, but legal notice decisions escalate | Create **INCIDENT_RESPONSE** guide + readiness rules. Agent should not “decide no notice required.” |
| **3. Minors beyond avoidance** | Yes | Medium to existential depending product | **Both** | Add **MINORS_AND_TEENS_RISK_TRIAGE** guide. 13+ stance is okay only for genuinely general-audience apps. |
| **4. AI-product compliance** | Yes, critical | High because factory ships AI | **Both** | Add **AI_PRODUCT_COMPLIANCE** guide. Transparency is only one piece. |
| **5. Data retention schedule** | Yes | High breach/DSAR multiplier, low build cost | Fold into data-rights guide + rules | Do not make a separate founder guide unless library wants a retention annex. |
| **6. Other 2026 bite points** | Yes | Several high-likelihood/high-cost triggered gaps | Mostly triggered modules | Add modules for tax/MoR, SMS/TCPA, UGC/DMCA/DSA/CSAM, health/biometric/regulated use, adtech/GPC, global marketing consent. |

---

# 2. DATA_RIGHTS_AND_RETENTION_OPS

## Verdict

**Real gap. Add both founder guide and agent rules.** Existing DSAR/export/delete-account build checks are necessary, but they do not create an operating system for requests, clocks, verification, backup honesty, processor cascades, and exceptions.

### Most expensive mistake it prevents

Accidentally disclosing a user’s full export to an impostor, or falsely claiming deletion while data remains live in vendors, logs, and backups.

### One-sentence rule

> **Every privacy request must become a logged ticket with right-sized identity verification, a deadline, real active-system export/deletion, documented exceptions, and processor-cascade evidence.**

## What the founder guide should cover

### A. Right-sized identity verification

The guide should give founders a practical verification ladder:

| Request context | Right-sized verification |
|---|---|
| Logged-in user asks for export/delete | Require current session plus re-auth, MFA, or email confirmation for destructive/export actions. |
| Email request from account email | Send magic link or confirmation to that same email; do not reveal extra data before verification. |
| Request for sensitive data, payment history, private messages, health data, minors’ data | Step-up verification: MFA, recent invoice ID, last 4 of payment method if already available, or similar. |
| User cannot access account | Use minimal evidence needed to match the account. Avoid government ID unless genuinely necessary. |
| Authorized agent / parent / estate / legal representative | Escalation path. Verify authority and user identity. |
| Suspicious request | Pause, ask for minimal additional proof, log rationale. |

Important nuance:

> **Over-verification can itself be a privacy violation.** Do not collect passport scans or government IDs for a simple low-risk account deletion if email/session verification is enough.

### B. Statutory clocks and operational SLA

Do not force newbie founders to memorize every regime. Give them a conservative queue rule.

Suggested internal default:

| Request type | Internal solo-founder SLA | Legal anchor to verify |
|---|---:|---|
| Access/export/delete/correct | Aim 21–30 days | GDPR/UK GDPR: 1 month; CCPA/CPRA: 45 days; many US state privacy laws: 45 days. |
| CCPA-style acknowledgement | 48 hours internal, no later than 10 business days if CCPA applies | Verify current CCPA regulations. |
| Sale/share/targeted-ad opt-out or sensitive-data limit | 10–15 business days | CCPA/CPRA and several state rules often use 15 business days. |
| Email unsubscribe | 10 business days max | CAN-SPAM; CASL/ePrivacy may be stricter on consent. |
| Extension | Only if complex; notify before original deadline | GDPR allows 2-month extension; CCPA/state laws often allow one 45-day extension. |

For a global app, the agent can compute:

```text
due_at = min(applicable_regime_deadline, internal_default_deadline)
```

If regime is uncertain, use the stricter operational default: **30 days for rights requests, 15 days for opt-outs.**

### C. Request intake channel

Minimum newbie stack:

- In-app privacy/account page.
- Public `privacy@domain.com` or support email.
- Web deletion link if Android app allows account creation.
- Admin queue/table: `privacy_requests`.

The founder guide should say:

> A request made through support, email, in-app chat, or app-store review should be routed into the privacy queue; do not ignore it because it arrived in the “wrong” channel.

### D. Audit log

Keep a privacy-request log with:

- Request timestamp.
- Request type.
- Verification method.
- Applicable regime if known.
- Deadline.
- Systems/vendors touched.
- Exceptions/retained records.
- Fulfillment timestamp.
- Response copy.
- Admin who processed it.

Retention default: **2–3 years** for the request log, access-restricted. The log itself contains personal data.

### E. Backup deletion honesty

The accepted practical answer for small apps:

> **Delete from active systems promptly; let encrypted immutable backups age out on a disclosed retention schedule; if a backup is restored, re-apply deletion before returning it to production.**

Good default backup window: **30–60 days**.  
Potentially defensible: **up to 90 days** if justified.  
Bad default for newbie consumer apps: “backups may persist indefinitely.”

The policy and guide should not promise “immediate deletion from all backups” unless that is technically true.

### F. Legal-hold and billing exceptions

The guide should provide a narrow exception model:

Retain only what is needed for:

- Tax/accounting invoices.
- Chargebacks/refunds/fraud.
- Legal claims/legal hold.
- Security abuse investigation.
- Compliance records, such as unsubscribe suppression.

But require:

> Retained exception data must be segregated or flagged, access-restricted, excluded from product/marketing use, and described honestly.

### G. Processor cascade mechanics

The guide should give founders a checklist:

1. Maintain `processors.yaml`.
2. For each processor, record deletion/export method:
   - API deletion.
   - Admin dashboard deletion.
   - Email request.
   - DPA/support portal.
3. Log request sent and confirmation received.
4. For vendors that retain data independently, document reason and role.
5. Reconcile policy/store-label/vendor list after adding SDKs.

### H. Google Play account deletion

Current practical state to encode, but verify exact Play wording in 2026:

> If an Android app lets users create an account, Google Play expects both an **in-app account deletion path** and a **web deletion request link** accessible outside the app, plus accurate Data Safety disclosures about whether account data is deleted or retained.

Agent should check:

- App has account creation? If yes:
  - in-app delete path exists;
  - web deletion URL exists;
  - Play Data Safety says deletion is available;
  - retained data reasons are disclosed;
  - deletion is not just “deactivate account.”

## Agent rules to add

Blocker-level rules:

- `delete_account` cannot be soft-flag-only unless followed by scheduled hard-delete/anonymization.
- Seeded-user deletion test must remove or anonymize user data from all mapped active stores.
- Export endpoint requires re-auth or verified email token.
- Backup retention setting must not exceed published retention window.
- Android account apps must have in-app + web deletion paths.
- `processors.yaml` must list deletion method for each processor.
- Privacy request queue must store `received_at`, `verified_at`, `due_at`, `fulfilled_at`, `status`.

Flag-level rules:

- Logs contain prompts, IPs, device IDs, or email addresses beyond retention default.
- Deleted user remains in analytics/CRM/push/email tools.
- Payment/customer IDs remain attached to product account after deletion without billing exception.
- Deletion policy says “delete immediately” but code uses delayed retention.

## Verify before 2026 launch

- Exact Google Play User Data/account deletion policy text.
- Current CCPA/CPRA regulations on acknowledgement, opt-out, and verification.
- New state privacy deadlines/appeals.
- Brazil LGPD/ANPD access deadlines if targeting Brazil.
- UK/EU guidance on backup deletion language.

---

# 3. INCIDENT_RESPONSE

## Verdict

**Real gap. Add founder guide and agent readiness rules.** This is one of the highest-cost gaps because breach clocks start before a solo founder feels ready.

### Most expensive mistake it prevents

Missing GDPR/UK GDPR or US state breach-notification deadlines because the founder spent the first 72 hours figuring out what happened.

### One-sentence rule

> **The first job in an incident is not PR; it is to preserve evidence, contain harm, start the breach clock, assess affected personal data, and escalate before notification deadlines expire.**

## Founder guide shape

Do not make newbie founders learn 50-state breach law in advance. Give them:

### A. One-person incident runbook

1. **Detect**
   - What happened?
   - Who reported it?
   - When did you become aware?
2. **Contain**
   - Rotate keys.
   - Disable compromised accounts.
   - Patch RLS/security rule.
   - Stop data leakage.
3. **Preserve evidence**
   - Do not delete logs.
   - Snapshot affected configs.
   - Save vendor notices.
4. **Assess**
   - What personal data?
   - Encrypted or plaintext?
   - Which users and countries/states?
   - Credentials/payment/health/biometric/minors?
5. **Decide notification path**
   - GDPR/UK authority?
   - Users?
   - US state notices?
   - AG/consumer reporting agencies?
   - App stores/vendors?
6. **Notify if required**
   - Use templates, but do not speculate.
7. **Document**
   - Even if no notice is required, document why.
8. **Postmortem**
   - Root cause.
   - Fix.
   - Prevent recurrence.

### B. GDPR/UK GDPR practical rule

- Notify supervisory authority within **72 hours after becoming aware** unless breach is unlikely to result in risk to individuals.
- Notify affected individuals without undue delay if high risk.
- Document all personal data breaches, even no-notice ones.
- Processors must notify controllers without undue delay.

### C. US state breach practical rule

The playbook should say:

> **If unencrypted personal information of US residents may have been acquired by an unauthorized party, assume state breach laws may apply and escalate.**

Common high-risk triggers:

- SSN/tax ID.
- Driver’s license/passport.
- Financial account/payment credentials.
- Medical/health insurance/consumer health data.
- Biometric identifiers.
- Account credentials/passwords/API keys.
- Minors’ data.
- Large multistate incident.
- Ransomware/extortion.
- Regulator, journalist, or platform notice.

AG notice thresholds and timing vary by state. The guide should not pretend one template solves all.

### D. Processor breach handling

If Supabase/Firebase/Stripe/OpenAI/etc. reports an incident:

- Determine whether the vendor is processor, subprocessor, or independent controller for the affected data.
- Ask for:
  - affected data categories;
  - affected user IDs/accounts;
  - timeframe;
  - encryption status;
  - containment/remediation;
  - whether vendor will notify anyone directly.
- Founder still assesses duties to users/regulators for data controlled by the app.
- Do not assume “vendor breached, vendor handles everything.”

Stripe nuance:

- Stripe may act as processor for some merchant data and independent controller for some payment/compliance data.
- Founder still needs to assess user-facing impact and coordinate messaging.

### E. Cyber insurance

Right-sized answer:

- Not a launch blocker for a tiny low-risk app.
- Worth considering once the app has meaningful revenue, B2B customers, sensitive data, health/biometric/minor data, or contractual security obligations.
- Valuable mainly because it can pay for breach counsel, forensics, notification, and credit monitoring.

## Agent rules to add

Blocker/readiness rules:

- `incident_runbook.md` exists.
- Security contact exists in app/admin docs.
- Processor list includes security/breach contact or DPA link.
- Logs are retained long enough to investigate likely incidents.
- Secrets rotation procedure exists.
- Admin access is logged.
- Breach assessment template exists with:
  - `aware_at`;
  - `contained_at`;
  - `data_categories`;
  - `affected_users`;
  - `jurisdictions`;
  - `encryption_status`;
  - `notification_decision`;
  - `counsel_escalated`.

Important limitation:

> The agent may flag “possible notification duty,” but it should not conclusively decide “no notice required” for a real breach.

## Verify before 2026 launch

- Current state breach deadlines and AG thresholds.
- FTC Health Breach Notification Rule if consumer health data is involved.
- Sector laws if app touches health, finance, education, employment, or children.
- Vendor DPA breach-notification terms.

---

# 4. MINORS_AND_TEENS_RISK_TRIAGE

## Verdict

**Real gap. Add both a founder guide and agent rules.** The current “age-gate to 13+, escalate children’s products” stance is directionally right but incomplete.

### Most expensive mistake it prevents

Launching a child- or teen-attractive AI/social app with only a fake “I am 13+” checkbox, then facing COPPA, app-store, UK Children’s Code, state teen-safety, or platform enforcement.

### One-sentence rule

> **A 13+ gate is only valid if the product is genuinely not child-directed, does not ignore actual knowledge of under-13 users, and separately handles teen-risk features where minors are likely users.**

## Is the 13+ avoidance stance right?

Yes, for ordinary general-audience apps.

But it fails if:

- branding, characters, language, schools, games, cartoons, or marketing attract children;
- app is likely used by under-13s;
- founder has actual knowledge of under-13 users;
- app is a teen social, messaging, AI companion, tutoring, mental-health, or creator app;
- app collects precise location, biometrics, voice, face, health, or sensitive data;
- app targets UK/EU users and is likely accessed by under-18s.

## What must still be built for a 13+ app

Baseline for general consumer apps:

- Neutral age screen if age matters.
- Do not collect more DOB data than necessary; age band is often enough.
- If user indicates under 13:
  - block account creation;
  - do not continue collecting data;
  - delete any partial data unless needed for security/fraud;
  - do not invite them to “try again.”
- Terms and privacy policy must say under-13s cannot use the service.
- Support process must handle “my child is using this” reports.
- Marketing copy must not contradict 13+ posture.
- App-store age rating must match reality.

If known teens use the app, add:

- High privacy defaults.
- No targeted ads/profiling to known minors unless specifically lawful.
- Avoid public-by-default profiles.
- Avoid precise location sharing.
- Extra caution with DMs, friend discovery, recommender feeds, streaks, nudges, and addictive loops.
- Clear reporting/blocking tools for social/UGC features.
- AI safety filters appropriate for minors.

## Teen design code status: treat as volatile

Use this as a launch verification checklist, not permanent truth.

| Regime | Practical status to encode |
|---|---|
| **COPPA, US under-13** | In force. Verify final amended COPPA rule/effective dates in 2026. Under-13 actual knowledge or child-directed product is escalation. |
| **UK Age Appropriate Design Code / Children’s Code** | In force. Applies to online services likely accessed by under-18s in the UK. High relevance for consumer apps. |
| **EU GDPR children’s consent + DSA minor ad protections** | In force. GDPR member-state consent ages vary. DSA restricts targeted ads to minors for online platforms when reasonably certain user is a minor. |
| **California Age-Appropriate Design Code** | Litigation/enjoinment has been active. Verify current enforceability before launch. Do not hard-code “ignore.” |
| **US state social-media/teen laws** | Highly volatile. Florida, New York, Utah, Arkansas, Ohio, Texas, Maryland, and others have had laws, amendments, or litigation. Verify if app has social, feed, messaging, or teen-targeted features. |
| **Apple Kids Category / Google Families Policy** | In force as platform policy. If you enter child-directed categories, legal and policy burden increases sharply. |

## Escalation line

Escalate before launch if any are true:

- Product intentionally serves under-13s.
- Product is likely child-directed.
- AI companion, AI tutor, AI therapist/coach, or AI friend for minors.
- Public profiles, DMs, UGC, recommender feeds, creator/follower mechanics for teens.
- Precise geolocation, biometrics, voiceprints, face analysis, emotion inference.
- Health, mental health, eating disorder, sexuality, reproductive, or self-harm content.
- School/education deployment.
- Age-restricted goods/content.
- Monetization aimed at minors, loot boxes, gambling-like mechanics, or aggressive in-app purchases.

## Agent rules to add

Blockers:

- Marketing copy says “kids,” “children,” “school,” “homework for kids,” etc., but policy says 13+.
- App-store age rating conflicts with actual content/features.
- Under-13 path allows account creation.
- Known minor user can receive targeted ads or public-by-default profile without teen module.
- App has social/DM/UGC features and no blocking/reporting/moderation workflow.
- AI companion/mental-health feature for teens without escalation flag.

Flag:

- Age gate is a single “I am 13+” checkbox for a child-attractive product.
- DOB stored precisely when age band would suffice.
- User can change age repeatedly after being blocked.
- Product collects location, biometrics, voice, or health data from teens.

## Verify before 2026 launch

- COPPA amended rule final text/effective dates.
- California/ Maryland/ New York/ Florida/ Utah/ Texas/ Arkansas/ Ohio/ Mississippi teen/social-media law status.
- UK ICO Children’s Code guidance updates.
- App-store child-safety policy updates.

---

# 5. AI_PRODUCT_COMPLIANCE

## Verdict

**Critical real gap. Add founder guide and agent rules.** “AI-transparency” is necessary but insufficient. The guide should cover EU AI Act triage, FTC claims, training/user-content terms, generated-media labeling, minors, high-risk use cases, and vendor settings.

### Most expensive mistake it prevents

Launching an AI app that makes consequential health, legal, employment, credit, education, or safety claims without evidence, disclosures, human review, or regulatory triage.

### One-sentence rule

> **Every AI feature needs a disclosed AI interaction, a documented use-case risk tier, substantiated claims, clear input/output/training terms, and escalation if it affects minors or consequential decisions.**

## EU AI Act: practical tiny-app treatment

For a US founder selling to EU users, assume EU AI Act can matter.

### If the app calls OpenAI/Anthropic APIs

Usually:

- The upstream model provider has **GPAI model provider** duties.
- The app founder is not usually a GPAI model provider merely by calling an API.
- The founder may still be a **provider/deployer of an AI system** under their own product brand.
- The founder still needs user-facing transparency and high-risk/prohibited-use triage.

### Guide-worthy EU AI Act obligations now

| Topic | Practical rule |
|---|---|
| Chatbots / AI interaction | Tell users they are interacting with AI unless obvious. |
| Generated image/audio/video/deepfake | Clearly disclose synthetic or manipulated content where realistic or person/event-like. |
| Public-interest generated text | Label or disclose AI-generated/manipulated public-interest content unless appropriate human editorial responsibility applies. |
| Prohibited practices | Do not build manipulative, exploitative, social-scoring, unlawful biometric, or other prohibited AI systems. |
| High-risk AI | Escalate if used for employment, education, credit, housing, insurance, essential services, law enforcement, migration, justice, biometric ID, or similar consequential decisions. |
| AI literacy | Founder/operator should understand limits, risks, and appropriate use. For a one-person company, keep a short internal AI-use note. |
| Logging and human review | If AI affects user rights, money, access, safety, or opportunities, require human review and audit trail. |

### EU AI Act timeline to verify

Likely anchors:

- Prohibited practices: phased in around 2025.
- AI literacy: around 2025.
- GPAI model-provider duties: around 2025.
- Most transparency and high-risk obligations: around 2026.
- Some product-safety high-risk obligations: later.

Verify exact 2026 dates, guidance, codes of practice, and national enforcement details.

## FTC AI claims substantiation

Founder guide should say:

> If an AI claim would influence purchase, health, safety, money, employment, education, legal rights, or trust, keep evidence before publishing the claim.

Examples of risky claims:

- “Diagnoses depression.”
- “FDA-grade.”
- “Lawyer-quality.”
- “Guaranteed accurate.”
- “Detects cheating.”
- “Bias-free hiring.”
- “Predicts creditworthiness.”
- “Therapy replacement.”
- “100% private” when prompts go to vendors.
- “Human support” when it is a bot.

Disclaimers help but do not cure deceptive core claims.

## AI + children

Escalate if AI is:

- companion/friend/romantic roleplay for minors;
- tutoring or school use;
- mental-health/coaching for teens;
- self-harm, eating disorder, sexuality, or crisis-related;
- voice/face/avatar for minors;
- public social AI bot used by teens.

## Training-data and user-content terms

Default recommendation for newbie apps:

> **Do not train models on private user content by default.**

If the founder wants to train/fine-tune on user data:

- Make it clear in privacy policy and ToS.
- Prefer opt-in, especially for private content.
- Keep training corpus separable by user/account.
- Do not promise deletion from trained model unless technically possible.
- Provide deletion from future training datasets.
- Avoid children’s data, health data, biometrics, precise location, and sensitive data.
- Check upstream vendor settings for retention and training.
- List AI vendors as processors/subprocessors where appropriate.
- Warn users not to input third-party confidential/sensitive data unless product is designed for it.

Terms should cover:

- User license to process inputs.
- Output ownership limits.
- No guarantee of uniqueness/copyrightability of outputs.
- User responsibility for reviewing outputs.
- Prohibited inputs and uses.
- Whether prompts/outputs are stored.
- Whether data is used for model improvement/training.

## State AI laws: guide-worthy versus noise

Guide-worthy:

- **Colorado AI Act** style high-risk consequential decision triage. Verify 2026 effective status/amendments.
- **California AI transparency/training-data laws** if founder builds or fine-tunes generative systems, or operates at covered scale. Verify thresholds.
- **Utah AI disclosure** style rules: solved largely by obvious AI labeling.
- **NYC employment AI**, Illinois video interview/biometric laws, BIPA, and anti-discrimination rules if employment/biometric products.
- Deepfake/election/likeness/voice-cloning laws if generating realistic people, voices, political content, or endorsements.

Mostly noise for tiny API-wrapper apps:

- Full GPAI model technical documentation if not building/releasing/fine-tuning a general-purpose model.
- CE-style high-risk system compliance for ordinary consumer summarizers or productivity chat.
- Frontier-model obligations unless training/releasing powerful models.
- Export-control AI model rules unless shipping model weights, cyber capabilities, defense, surveillance, or advanced dual-use systems.

## Agent rules to add

Blockers:

- AI feature exists but UI does not disclose AI interaction.
- Marketing makes capability claims without `claims_evidence.md`.
- App gives medical/legal/financial/employment/housing/education decisions without escalation.
- AI-generated realistic media lacks disclosure.
- App says “human support” but routes to AI bot without disclosure.
- Private user content is used for training without privacy/ToS disclosure and user choice.
- AI vendor not listed in processor/vendor inventory.
- AI feature targets minors without minors escalation.

Flags:

- Prompt/output logs retained longer than retention schedule.
- “Not professional advice” disclaimer used while product flow still makes professional decisions.
- No human review for consequential outputs.
- No abuse/safety handling for self-harm, illegal content, harassment, or sexual content.
- Fine-tuning or model release detected but no GPAI/model-provider review.

## Verify before 2026 launch

- EU AI Act Article 50 transparency guidance and enforcement timing.
- EU AI Office GPAI Code of Practice.
- Colorado AI Act amendments/delay/exemptions.
- California AI transparency/training-data law thresholds.
- FTC AI enforcement updates.
- State deepfake/voice/likeness/election laws.

---

# 6. DATA RETENTION SCHEDULE

## Verdict

**Real gap, but fold it into DATA_RIGHTS_AND_RETENTION_OPS.** Make it a required artifact, not a separate long guide.

### Most expensive mistake it prevents

Keeping everything forever, so a small breach or DSAR becomes a massive historical data exposure.

### One-sentence rule

> **If the app cannot explain why a category of personal data is still needed, it should be deleted, anonymized, aggregated, or moved to a narrow compliance-retention bucket.**

## Right-sized defaults

| Data category | Newbie default |
|---|---|
| Active account profile | While account active. Delete/anonymize within 30 days after deletion request unless exception. |
| User-generated private content | While account active. Delete on account deletion unless user separately published/shared under ToS retention terms. |
| Public UGC | Delete or anonymize author on account deletion unless ToS clearly says public content may remain. |
| Soft-delete grace period | 7–30 days, disclosed. After that, hard-delete/anonymize active data. |
| Backups | 30–60 days encrypted immutable backup retention; 90 days max unless justified. |
| App/error logs | 14–30 days; scrub personal data. |
| Security/audit logs | 90–365 days depending risk; access restricted. |
| AI prompts/outputs | Default: do not store, or store 7–30 days for abuse/debug. If user-saved content, retain as account content. |
| Analytics events | 6–13 months, then aggregate/delete. Avoid user-level analytics forever. |
| Marketing consent records | While subscribed plus 2–4 years; unsubscribe suppression minimally/indefinitely as needed. |
| Support tickets | 1–2 years; shorter for sensitive tickets. |
| Privacy request logs | 2–3 years. |
| Terms/privacy acceptance records | Life of account plus limitations period, often 4 years; minimize after deletion. |
| Invoices/tax/accounting | 7 years US default; 10 years if EU VAT records apply. Merchant-of-record may handle much of this. |
| Payment card data | Do not store. Use Stripe/app store/MoR. |
| Fraud/chargeback records | 18–24 months, or longer if legal/accounting basis. |
| Legal hold | Until hold released; restricted access only. |

Agent should require `retention_schedule.yaml` and compare it to:

- database TTLs;
- log retention;
- backup configuration;
- privacy policy;
- vendor settings;
- deletion job behavior.

---

# 7. Other 2026 gaps ranked by likelihood × cost

## Highest-priority missing modules

| Rank | Gap | When it matters | Shape | Most expensive mistake | One-sentence rule |
|---:|---|---|---|---|---|
| 1 | **Sales tax / VAT / GST / merchant-of-record** | Any paid web subscription sold globally outside app stores | Founder guide + checkout gate | Accruing unpaid VAT/sales tax liabilities across countries/states | **Use app store IAP or a true merchant-of-record for global B2C, or restrict countries and set up tax collection/remittance before Stripe web sales.** |
| 2 | **Regulated data/use cases: health, mental health, biometric, financial, legal, employment, housing, education** | AI advice, scoring, diagnostics, coaching, biometrics, voice/face, wellness apps | Project-start screener + AI/privacy agent flags | Accidentally becoming a medical, financial, employment, biometric, or health-data compliance case | **If the app affects health, money, jobs, housing, education, legal rights, biometrics, or minors’ safety, no-launch without escalation.** |
| 3 | **UGC/platform: DMCA, DSA, CSAM, moderation** | Public uploads, comments, profiles, marketplaces, messaging, sharing | Founder guide + agent rules | Copyright liability, illegal-content orders, CSAM mishandling, DSA enforcement | **Public UGC requires report/takedown flow, moderation records, DMCA agent/repeat-infringer policy, and EU DSA basics if EU users can access it.** |
| 4 | **SMS/TCPA/CTIA + CASL texts** | OTP, alerts, reminders, marketing SMS, AI chat by text | Communications guide + agent rules | TCPA class action at $500–$1,500 per text | **No recurring or marketing SMS without provable prior consent, required disclosures, STOP handling, and message-type separation.** |
| 5 | **Adtech, cookies, ePrivacy, GPC/universal opt-out** | Pixels, retargeting, behavioral ads, analytics SDKs, EU/UK users | Extend privacy guide + agent rules | Pixel enforcement for unauthorized sale/share/sensitive-data disclosure | **Nonessential trackers wait for consent where required, and sale/share/targeted-ad opt-outs including GPC are honored before ad pixels fire.** |
| 6 | **Global marketing consent: CASL/ePrivacy/PECR** | Emailing Canada, EU, UK; newsletters, lifecycle campaigns | Extend email guide + agent rules | Assuming CAN-SPAM is enough globally | **For non-US marketing, collect and store affirmative or soft-opt-in consent before promotional email/SMS unless a specific exception applies.** |
| 7 | **FTC endorsements, fake reviews, influencer, AI-generated testimonials** | Launch pages, Product Hunt, affiliates, creators, review widgets | Marketing-claims micro-guide + agent rule | Fake-review or undisclosed-endorsement enforcement | **Every testimonial, review, influencer post, and performance claim must be real, permissioned, typical/qualified, and materially disclosed.** |
| 8 | **Sanctions/export controls** | Global availability, crypto, cyber tools, advanced AI/model weights, sanctioned countries | Lightweight guide + deployment/payment flags | Providing service to sanctioned person/country or exporting controlled tech | **Do not knowingly sell or provide services to sanctioned regions/persons; escalate cyber, surveillance, defense, crypto, or model-weight exports.** |
| 9 | **GDPR admin: EU/UK representative, DPIA, ROPA** | Actively targeting EU/UK, high-risk data, minors, large monitoring | Add to privacy/AI/minors guides | Treating GDPR as only banner + policy | **If targeting EU/UK or doing high-risk processing, complete a lightweight DPIA/admin checklist and verify representative/DPO obligations.** |
| 10 | **Sweepstakes/referrals/contests** | Giveaways, referral lotteries, prize campaigns | Triggered micro-guide | Illegal lottery or missing state rules | **No prize promotion unless rules, odds, eligibility, no-purchase route, and jurisdiction limits are defined.** |

## Tax/VAT/MoR: not out of scope

This is not “legal privacy,” but it is a launch-library issue because it changes architecture.

Best newbie rule:

- App-store IAP: Apple/Google often handle indirect tax as merchant of record.
- Web Stripe Checkout: founder is usually merchant; Stripe Tax helps calculate/collect but does not magically register/remit everywhere.
- Paddle/Lemon Squeezy/FastSpring-style MoR: can offload much of global VAT/GST/sales tax, but verify actual contractual MoR coverage.

For solo global B2C founders, **MoR is usually worth the fee.**

## UGC/platform module specifics

Add this if users can upload/share/post/comment/message publicly.

Minimum US/EU playbook:

- DMCA agent registration with US Copyright Office.
- Public DMCA policy and repeat-infringer policy.
- Copyright takedown/counter-notice workflow.
- Report abuse/illegal content button.
- Moderation log.
- Terms banning illegal content, harassment, IP infringement, CSAM, nonconsensual intimate imagery.
- CSAM escalation/reporting path to NCMEC if apparent CSAM is discovered.
- EU DSA basics if available to EU users:
  - point of contact;
  - terms for moderation;
  - notice-and-action mechanism;
  - statement of reasons for moderation decisions;
  - transparency reporting where applicable;
  - verify micro/small platform exemptions.

## Adtech/GPC module specifics

Existing privacy guide has consent banner, but add explicit rules for modern enforcement:

- Detect Meta/TikTok/Google ad pixels and mobile ad SDKs.
- Do not load nonessential ad/retargeting tags before consent where EU/UK ePrivacy applies.
- If subject to CCPA/CPRA sale/share rules, honor GPC as opt-out.
- Colorado and other state universal opt-out mechanism rules are expanding; verify 2026 state list.
- Do not send health, precise location, minor, or sensitive event data to ad platforms.
- If below thresholds and not legally required, still consider honoring GPC as low-cost privacy hygiene.

## Regulated data/use-case module

This deserves a **project-start screener**, because it affects whether the factory should even build the product.

Escalate if the product involves:

- consumer health, mental health, therapy, diagnosis, symptoms, medication;
- reproductive/sexual health;
- biometric identifiers, face recognition, voiceprints, emotion inference;
- precise geolocation;
- credit, lending, insurance, investing, taxes;
- employment screening, worker monitoring, hiring;
- housing;
- education admissions/testing/proctoring;
- legal advice/document generation beyond generic templates;
- minors plus any sensitive feature.

Specific high-cost traps:

- FTC Health Breach Notification Rule for consumer health apps.
- Washington My Health My Data Act and similar consumer-health laws.
- Illinois BIPA and other biometric laws.
- FDA medical-device issues for diagnosis/treatment.
- SEC/FINRA/investment-adviser issues.
- Unauthorized practice of law.
- Employment AI bias/audit laws.

---

# 8. Critique of proposed structure

## Your current plan

> ONE new founder guide `DATA_REQUESTS`; ONE `INCIDENT_RESPONSE`; extend privacy/legal; add agent rule-sets `data-rights-ops`, `breach-notification`, `minors/age-assurance`, `AI-transparency`.

## Recommended structure

### Core guides

1. **DATA_RIGHTS_AND_RETENTION_OPS**
   - DSAR/deletion operations.
   - Verification.
   - Request queue.
   - Deadlines.
   - Processor cascade.
   - Backups.
   - Legal exceptions.
   - Retention schedule.

2. **INCIDENT_RESPONSE**
   - Breach runbook.
   - GDPR/UK 72-hour framework.
   - US state escalation.
   - Processor breach handling.
   - Evidence preservation.
   - Notification decision tree.

3. **AI_PRODUCT_COMPLIANCE**
   - Not just transparency.
   - EU AI Act triage.
   - FTC claims substantiation.
   - Training/user-content terms.
   - Generated content/deepfake labeling.
   - High-risk/prohibited use cases.
   - AI + minors.
   - State AI flags.

4. **MINORS_AND_TEENS_RISK_TRIAGE**
   - Keep short.
   - Product-positioning decision guide.
   - 13+ stance boundaries.
   - Teen design codes.
   - Escalation line.

### Triggered micro-guides

5. **TAX_AND_MERCHANT_OF_RECORD**
6. **UGC_PLATFORM_SAFETY**
7. **COMMUNICATIONS_CONSENT**
   - SMS/TCPA.
   - CASL.
   - EU/UK marketing consent.
   - Push notifications.
8. **ADTECH_COOKIES_GPC**
9. **REGULATED_DATA_AND_BIOMETRICS**
10. **MARKETING_CLAIMS_REVIEWS_ENDORSEMENTS**
11. **SANCTIONS_EXPORT_LIGHT**

## Agent rule-sets

Keep the proposed ones, but rename/expand:

| Proposed | Recommended |
|---|---|
| `data-rights-ops` | Keep; include retention, backups, Play deletion, processor cascade. |
| `breach-notification` | Rename to `incident-readiness-and-breach-flags`; avoid agent making final legal notice decisions. |
| `minors/age-assurance` | Keep; require founder audience assessment artifact. |
| `AI-transparency` | Expand to `ai-risk-transparency-claims-training`. |
| Add | `communications-consent` for SMS/CASL/push. |
| Add | `ugc-platform` for DMCA/DSA/CSAM/moderation. |
| Add | `adtech-gpc-cookies`. |
| Add | `regulated-data-biometrics`. |
| Add | `tax-monetization-gate`, mostly founder/checkout config. |
| Add | `marketing-claims-endorsements`. |

---

# 9. Launch pipeline anchors

## Project-start gate

Create `compliance_profile.yaml` before building.

Ask:

- Who is the audience? Any minors/teens?
- Any AI? What use case?
- Any high-risk decisions?
- Any health/biometric/location/sensitive data?
- Any UGC/social/messaging?
- Any SMS/push/email marketing?
- Any ad pixels/targeted ads?
- Web Stripe, app-store IAP, or MoR?
- Countries targeted?
- Any regulated domain?
- Any model training/fine-tuning?
- Any public generated media/deepfakes?

Project-start blockers:

- under-13 product without escalation;
- regulated AI decisioning without escalation;
- health/biometric product without escalation;
- public UGC without UGC module;
- global Stripe payments without tax/MoR plan;
- SMS marketing without TCPA module.

## While-building

Build and maintain artifacts:

- `data_inventory.yaml`
- `processors.yaml`
- `retention_schedule.yaml`
- `privacy_requests` queue/table
- `incident_runbook.md`
- `ai_risk_assessment.md`
- `claims_evidence.md`
- `age_audience_assessment.md`
- `tax_monetization_plan.md`
- `ugc_moderation_policy.md` if applicable
- `communications_consent_matrix.md` if applicable

Engineering tasks:

- deletion/export integration tests;
- processor deletion hooks;
- backup retention config;
- AI disclosure UI;
- generated-media labeling;
- age gate/block flow;
- SMS STOP/unsubscribe if SMS;
- cookie/adtech consent gating;
- GPC handling if adtech/state privacy applies;
- UGC report/takedown flow if UGC.

## Pre-launch gate

Run dry tests:

- DSAR export dry run.
- Account deletion dry run across DB, auth, storage, analytics, email, AI logs, push, processors.
- Backup retention check.
- Incident tabletop: “Supabase bucket exposed for 6 hours.”
- AI disclosure/claims review.
- Minors/age-rating consistency check.
- App-store privacy label/Data Safety review.
- Tax/MoR checkout test.
- SMS consent/STOP test if applicable.
- Cookie/GPC test if adtech.
- UGC abuse report/DMCA test if applicable.

## Post-launch

Recurring ops:

- Check privacy request queue weekly.
- Review vendor/data inventory monthly or on each SDK addition.
- Run deletion test monthly/quarterly.
- Review logs/retention monthly.
- Incident tabletop quarterly.
- Re-check app-store policy on each release.
- Monitor state privacy thresholds and tax nexus.
- Review AI vendor policy changes.
- Review marketing claims before campaigns.
- Verify volatile minors/AI/state law statuses at least quarterly for relevant products.

---

# 10. Final recommendation ledger

| Recommendation | Most expensive mistake prevented | One-sentence rule |
|---|---|---|
| **DATA_RIGHTS_AND_RETENTION_OPS** | Impostor export or fake deletion | Every request becomes a verified, logged, deadline-tracked ticket with real active-system action and processor evidence. |
| **INCIDENT_RESPONSE** | Missing 72-hour/US notice deadlines | Start the incident clock immediately, contain, preserve evidence, assess personal data, and escalate before deadlines. |
| **MINORS_AND_TEENS_RISK_TRIAGE** | Sham 13+ gate on child/teen product | A 13+ gate only works for genuine general-audience apps that do not ignore actual knowledge or teen-risk laws. |
| **AI_PRODUCT_COMPLIANCE** | Unsubstantiated or high-risk AI launch | Every AI feature needs disclosure, risk tier, claims evidence, training terms, and escalation for consequential uses. |
| **Retention schedule** | Breach/DSAR scope explosion | Keep personal data only for a defined purpose and delete/anonymize it on a published schedule. |
| **Tax/MoR** | Global VAT/sales-tax debt | Use app-store/MoR or restrict countries and set up tax collection/remittance before web sales. |
| **UGC/DMCA/DSA/CSAM** | Illegal-content/copyright/CSAM liability | Public UGC requires takedown, reporting, moderation, DMCA, and DSA basics before launch. |
| **SMS/TCPA/CASL** | TCPA class action | No marketing or recurring SMS without provable consent, required disclosures, and STOP handling. |
| **Adtech/GPC/cookies** | Pixel/privacy enforcement | Do not fire nonessential trackers before consent/opt-out logic, and honor GPC where sale/share or UOOM rules apply. |
| **Regulated data/biometrics** | Accidentally entering medical/financial/employment/biometric law | If the app touches health, money, jobs, housing, education, legal rights, biometrics, or minors’ safety, escalate. |
| **Marketing claims/reviews** | FTC fake-review/endorsement enforcement | Claims must be substantiated; reviews/testimonials/influencers must be real and disclosed. |
| **Sanctions/export** | Serving sanctioned users or exporting controlled tech | Do not knowingly serve sanctioned regions/persons; escalate cyber, defense, surveillance, crypto, or model-weight exports. |

---

# 11. Staleness checklist to verify for 2026

Because several areas are moving quickly, the launch library should include a “verify current status” note for:

- Google Play account deletion and Data Safety requirements.
- FTC COPPA amended rule and effective dates.
- US state teen/social-media/AADC laws and injunctions.
- UK ICO Children’s Code enforcement updates.
- EU AI Act guidance, AI Office codes, and national enforcement dates.
- Colorado AI Act amendments or delays.
- California AI transparency/training-data law thresholds.
- CCPA/CPRA regulations and GPC enforcement.
- Universal opt-out mechanism requirements by state.
- US state breach-notification deadlines and AG thresholds.
- FTC Health Breach Notification Rule scope.
- Washington My Health My Data Act and similar health-data laws.
- DSA micro/small platform obligations.
- VAT/GST/sales-tax thresholds and MoR coverage.
- OFAC sanctions list and export-control changes for AI/cyber products.
