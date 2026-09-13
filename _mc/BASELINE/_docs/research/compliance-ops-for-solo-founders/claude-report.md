# Operational Compliance for a Solo Newbie Founder (Consumer Web/Mobile + LLM), 2026 — Claude Primary-Source Leg

*Research date: 2026-06-12. Claude compliance leg of a multi-engine pipeline. Mandate: primary-source verification with verbatim quotes, contrarian analysis, cross-source validation. Every load-bearing legal/quantitative claim is tagged with a confidence level and a verified Y/N. Where a statute or policy text was retrieved, it is quoted verbatim.*

---

## Executive Summary

For a solo founder shipping a consumer app in 2026, "I have a privacy policy" is the floor, not the duty. The operational obligations that actually generate enforcement — and that a one-person team most often gets wrong — are **rights-request mechanics, breach clocks, store account-deletion plumbing, children's-data handling, and AI transparency labels**. The verified headline facts:

1. **Account deletion is a store-gate, not just a privacy nicety.** Both Apple (Guideline 5.1.1(v)) and Google Play require in-app account deletion if your app supports account creation; Google *additionally* requires a **web deletion link entered into the Data Safety form**. These are app-review blockers — non-compliant submissions get rejected. **[H, verified Y]**

2. **Over-verification of a rights request is itself a GDPR violation.** Demanding an ID copy for a routine DSAR breaches data minimization. The Dutch DPA fined DPG Media €525,000 for exactly this, and California's CPPA fined **Honda ($632,500)** and **Todd Snyder ($345,178)** in 2025 partly for over-burdening opt-outs with ID requirements. The instinct to "verify hard" is a liability, not a safeguard. **[H, verified Y]**

3. **The breach clock is 72 hours from *awareness*, not from investigation-complete** (GDPR Art. 33), with a narrow "unlikely to result in a risk" carve-out; user notice (Art. 34) is a *higher* bar ("high risk"). US state laws layer 30–60 day deadlines and AG-notification thresholds (often 500+ residents). **[H, verified Y]**

4. **An app that merely *calls* OpenAI/Anthropic APIs is a "deployer," not a "provider,"** under the EU AI Act — but deployers still carry Article 50(4) transparency duties (deepfake/AI-content disclosure), and chatbot disclosure (50(1)) is a provider duty that the model vendor owns. The "AI Act doesn't touch API callers" claim is **false**. **[H, verified Y]**

5. **The EU AI Act timeline shifted in late 2025.** The Digital Omnibus (proposed 19 Nov 2025; provisional Council/Parliament agreement 7 May 2026) **delayed high-risk rules to Dec 2027**, but **Article 50 transparency obligations remain on 2 August 2026** (with one carve-out: machine-readable marking of already-on-market generative systems pushed to Feb 2027). A founder must not assume "the whole AI Act slipped." **[H, verified Y]**

6. **COPPA's amended Rule is in full effect as of April 22, 2026** — new separate consent for targeted-ad disclosure, a written data-retention policy requirement, and biometric identifiers folded into "personal information." The trap is "actual knowledge": a neutral age-gate that captures an under-13 birthdate flips you into COPPA scope the moment you see it. **[H, verified Y]**

The cross-cutting newbie failure pattern: founders treat compliance as a document (the privacy policy) when regulators treat it as a **set of working mechanisms** — a deletion button that actually deletes, an opt-out that's honored within the clock, a breach runbook, an age screen that isn't a dark pattern, and an "AI" label. Every fine below is a mechanism that didn't work, not a policy that was missing.

---

## Phase 1: Landscape

### Workstream 1 — Data-Rights Operations
The DSAR/deletion world in 2026 is a patchwork of statutory clocks (GDPR one month; CCPA 45 days; ~19 US comprehensive state laws), plus two app-store account-deletion mandates that operate independently of any privacy law. The under-appreciated angle for newbies: **identity verification must be *right-sized* — over-verification is its own violation**, and **backups don't have to be instantly purged** (the "beyond use" / rolling-window doctrine).

### Workstream 2 — Breach Notification
Two-tier GDPR structure (authority at 72h / "risk"; users at "high risk") plus a 50-state US patchwork (all 50 states + DC + territories now have breach laws). Vendor breaches (your Stripe/Supabase processor) flow up to you the controller via Art. 33(2), and **you remain the notifying party to the authority and users**.

### Workstream 3 — Minors
COPPA amended Rule fully effective 22 Apr 2026. State AADC / teen-social laws are a litigation minefield — most are **enjoined or partially enjoined** (CA AADC narrowed by the 9th Cir. in March 2026; TX SCOPE, FL HB 3, UT all blocked or on appeal). The durable, non-litigated obligation is federal COPPA + the "actual knowledge" age-gate discipline.

### Workstream 4 — AI Compliance
EU AI Act deployer transparency (Art. 50) lands Aug 2026; FTC "Operation AI Comply" is the active US enforcer (deceptive AI claims); Colorado AI Act delayed to **Jan 1, 2027** and narrowed (and it targets *consequential-decision high-risk* systems, not generic consumer chat apps anyway). Plus: TCPA one-to-one consent rule **vacated** (Jan 2025), GPC honoring **required in 12 states** by Jan 1 2026.

---

## Phase 2: Mechanics (verified quotes & numbers)

### 2.1 DSAR / deletion clocks

**GDPR Art. 12(3) — one month + extension.** Verbatim (gdpr-info.eu):
> "provide information on action taken on a request … without undue delay and in any event within one month of receipt"
>
> The period "may be extended by two further months where necessary, taking into account the complexity and number of the requests" and the controller "shall inform the data subject of any such extension within one month of receipt of the request, together with the reasons for the delay."

So: **one month default, extendable by two more (three total), but only with notice inside the first month.** **[H, verified Y — primary source]**

**GDPR Art. 12(5) — free unless excessive.** Verbatim:
> "Information provided … shall be provided free of charge. Where requests from a data subject are manifestly unfounded or excessive, in particular because of their repetitive character, the controller may either: charge a reasonable fee … or refuse to act on the request."
**[H, verified Y]**

**GDPR Art. 12(6) — identity doubts.** Verbatim:
> "Where the controller has reasonable doubts concerning the identity of the natural person making the request … the controller may request the provision of additional information necessary to confirm the identity of the data subject."
Note the threshold: *reasonable doubts*, not "always ask for ID." **[H, verified Y]**

**CCPA/CPRA deletion clock.** Confirm receipt within **10 business days**; substantively respond within **45 calendar days**, extendable by another **45 (90 total)** with notice. **[H, verified Y — secondary (Clym), consistent across sources; the 45-day figure is statutory at Cal. Civ. Code §1798.130]**

**Right-sized identity verification (over-verification = violation).** This is the load-bearing nuance most engines miss. EDPB Guidelines 01/2022 (Right of Access) positions:
> "copies of ID cards should not be considered an appropriate way of authentication."
> The method "should be relevant, appropriate, proportionate, and respect the data minimisation principle."
And the enforcement proof: **Dutch DPA fined DPG Media €525,000 in 2020 for requiring ID copies for all DSARs.** ID-level verification passes proportionality only where data is "particularly sensitive, such as … medical data." **[H, verified Y — EDPB guideline + named enforcement]**

**Other US state laws in force by mid-2026 (comprehensive privacy, with deletion rights & clocks).** As of 2026, ~19 states have comprehensive laws live or imminent, including California, Virginia, Colorado, Connecticut, Utah, Texas, Oregon, Montana, Iowa, Indiana, Tennessee, Nebraska, New Hampshire, New Jersey, Delaware, Maryland, Minnesota, plus Kentucky and others phasing in. Most mirror a **45-day respond + 45-day extension** clock. **[M, verified partial — the count and clock pattern are consistent across sources; exact per-state effective dates vary and should be confirmed against each state AG before relying on a specific one]**

### 2.2 Deletion from backups (the "beyond use" doctrine)

You do **not** have to surgically purge a name from frozen backups the instant a deletion request lands. ICO guidance (right to erasure):
> "the key issue is to put the backup data 'beyond use' … You must ensure that you do not use the data within the backup for any other purpose, ie that the backup is simply held on your systems until it is replaced in line with an established schedule."

So the accepted practice is a **rolling-window** deletion: live-system data goes immediately, backup data ages out at the next overwrite cycle, and you don't restore the deleted record from an old backup. **[H, verified Y — ICO primary, though phrased "until it is replaced in line with an established schedule" rather than a fixed number of days]**

**Caveat for 2026:** the EDPB's Feb 2026 CEF report on the right to erasure flagged that "half of the responding DPAs raised concerns that many controllers have no specific procedures for erasure in the context of backup data," and recommended *further* guidance on what "without undue delay" means for backups. So the "beyond use" latitude exists but is under active regulatory scrutiny — document your backup retention schedule. **[H, verified Y — EDPB report]**

### 2.3 Retention exceptions / legal-hold

Erasure does not apply where processing is necessary for compliance with a legal obligation, establishment/exercise/defense of legal claims, or where you have an overriding legitimate ground. Practical defaults a founder should bake in: **billing/tax records ~6–7 years** (jurisdiction-dependent — e.g., US IRS generally 7 years for certain records, UK ~6 years), and a documented retention schedule per data category. **[M, verified — the *existence* of these exceptions is H/verified via GDPR Art. 17(3); the specific year-counts are jurisdiction-specific and should be confirmed against local tax law]**

### 2.4 Apple account deletion — Guideline 5.1.1(v) (VERBATIM)

From the App Store Review Guidelines, 5.1.1(v) Account Sign-In:
> "If your app supports account creation, you must also offer account deletion within the app."

From Apple's linked support page *Offering account deletion in your app* (the operational detail):
> "Starting June 30, 2022, apps submitted to the App Store that support account creation must also let users initiate deletion of their account within the app."
> "Make the account deletion option easy to find in your app. Typically, it's included in the app's account settings."
> "Offer to delete the entire account record, along with associated personal data. You may include additional options, but only offering to temporarily deactivate or disable an account is insufficient."
> "Apps that support Sign in with Apple should use the Sign in with Apple REST API to revoke user tokens."
> On directing users elsewhere: "Apps in highly regulated industries, as described in App Store Review Guideline 5.1.1(ix), may use additional customer service flows to confirm and facilitate the account deletion process. Apps not operating in highly regulated industries should not require people to make a phone call, send an email, or go through other support flows."

**[H, verified Y — Apple primary source]**

### 2.5 Google Play account deletion (VERBATIM)

From Play Console Help (support.google.com/.../answer/13327111):
> In-app path must be prominent: "the pathway should be prominent (for example, within the account settings or a similar section)."
> Web link required: "provide a web link resource where users can request app account deletion and associated data deletion" — usable "without sending the user back to the app and requiring them to re-download it."
> Data Safety form: "you must disclose if your app provides account deletion and provide the web link within your Data safety form in Play Console."
> Data deletion: "you must also delete the user data associated with that app account."
> Retention carve-out: "It is possible that your app may need to retain certain data for legitimate reasons such as security, fraud prevention or regulatory compliance. In that case, you must clearly inform users about your data retention practices, for example, within your privacy policy."

**This confirms the brief's hypothesis exactly: Google requires BOTH in-app deletion AND a web deletion link entered into the Data Safety form.** Apple does *not* require the standalone web link; Google does. **[H, verified Y — Google primary source]**

Enforcement reality: "If there are issues with your answers to the Data deletion questions in your Data safety form, new submissions and app updates will be rejected in Play Console." And in 2025 Google reported rejecting ~2M apps and blocking 80,000+ developer accounts. **[H, verified Y]**

### 2.6 Breach notification (VERBATIM)

**GDPR Art. 33(1)** (gdpr-info.eu):
> Controller must notify the supervisory authority "without undue delay and, where feasible, not later than 72 hours after having become aware of" a personal data breach, "unless the personal data breach is unlikely to result in a risk to the rights and freedoms of natural persons." If late, "it shall be accompanied by reasons for the delay."

**GDPR Art. 33(2):**
> The processor "shall notify the controller without undue delay after becoming aware of a personal data breach." (No fixed hour count for the processor — "without undue delay.")

**GDPR Art. 34(1):**
> "When the personal data breach is likely to result in a high risk to the rights and freedoms of natural persons, the controller shall communicate the personal data breach to the data subject without undue delay."

**GDPR Art. 34(3)** — user notice NOT required if: (a) data was rendered unintelligible (e.g., encryption); (b) subsequent measures ensure the high risk "is no longer likely to materialise"; or (c) it "would involve disproportionate effort," in which case a public communication suffices. **[H, verified Y — all primary source]**

**The two thresholds are deliberately different**: Art. 33 (authority) triggers unless "unlikely to result in a risk"; Art. 34 (users) triggers only at "high risk." Many breaches clear 33 but not 34.

**US state breach laws — practical shape.** All 50 states + DC + territories have laws. Key data points:
- **New York SHIELD Act (GBL §899-aa):** notify affected residents; AG/Dept. of State/State Police notification where **>500 NY residents** affected. **[M-H, verified — 30-day-ish norm; SHIELD itself says "most expedient time possible and without unreasonable delay"]**
- **California:** "in the most expedient time possible and without unreasonable delay"; AG notification if **>500 California residents**. **[H, verified]**
- **Florida:** AG notification when **500+ residents** affected; 30-day individual deadline. **[H, verified]**
- ~20 states set a numeric consumer deadline, **30–60 days**; CA, CO, FL, NY, WA use **30 days**. **[M, verified — secondary aggregators consistent]**
- **50-state source:** Foley & Lardner "State Data Breach Notification Laws" chart (updated Mar 4, 2026) and Privacy Rights Clearinghouse "50-State Survey (2026 Edition)" are the maintained references. **[H, verified — sources exist]**

**Vendor breach (Stripe/Supabase).** They are your **processors**; under Art. 33(2) they must tell you "without undue delay," and **your 72-hour clock starts when you (the controller) become aware**. You — not the vendor — notify the authority and the users. Pre-wire this in your DPA (Art. 28 requires a written DPA covering breach assistance). **[H, verified Y]**

### 2.7 COPPA amended Rule (numbers + dates)

- **Published Apr 22, 2025; effective Jun 23, 2025; full compliance deadline Apr 22, 2026.** **[H, verified Y — Federal Register + multiple firms]**
- **Separate verifiable parental consent** now required to disclose a child's personal info to third parties for **targeted advertising** (you can't bundle ad-targeting consent into general collection consent). **[H, verified Y]**
- **§312.10 written data-retention policy** required, stating purposes and retention duration, and it must appear in the online privacy notice. **[H, verified Y]**
- **"Personal information" expanded** to include **biometric identifiers** (face templates, fingerprints, retina scans, voiceprints). **[H, verified Y]**
- **Civil penalty ceiling: up to $53,088 per violation.** **[H, verified Y — FTC]**

**Age-gate / "actual knowledge."** COPPA covers general-audience sites only where the operator has **actual knowledge** a user is under 13. A **neutral age screen** lets you rely on the entered age — but "if your age-neutral registration form captures a user entering a birthdate that indicates they are under 13, you cannot discard that data and continue treating the platform as a general audience service." FTC has flagged as *inadequate*: defaulting the age selector above 13, making "over 13" the dominant tap target, burying the age question after a long sunk-cost flow, or leading language. **[H, verified Y — FTC FAQ + policy guidance]**

### 2.8 EU AI Act — deployer vs provider + Art. 50 (VERBATIM)

**You (calling OpenAI/Anthropic) are a DEPLOYER, not a provider.** "OpenAI, Anthropic, and Google are general-purpose AI (GPAI) providers … while organizations that call their APIs are deployers." You only become a provider if you "sufficiently modify the underlying model — specifically, if your fine-tuning compute exceeds one-third of the original model's training compute." **[H, verified Y — consistent across sources; the one-third threshold tracks the Commission's GPAI guidelines]**

**Article 50(1)** — chatbot disclosure (PROVIDER duty): AI systems "intended to interact directly with natural persons" must be designed so persons "are informed that they are interacting with an AI system" — "unless this is obvious from the point of view of a natural person who is reasonably well-informed, observant and circumspect."

**Article 50(2)** — synthetic-content marking (PROVIDER duty): providers of generative AI must "ensure that the outputs of the AI system are marked in a machine-readable format and detectable as artificially generated or manipulated," with solutions "effective, interoperable, robust and reliable as far as this is technically feasible."

**Article 50(4)** — deepfake + public-interest text (DEPLOYER duty): deployers of a system generating deepfakes must "disclose that the content has been artificially generated or manipulated"; for AI-generated text published "to inform the public on matters of public interest," deployers must disclose unless the content "has undergone a process of human review or editorial control and … a natural or legal person holds editorial responsibility."

**Practical read for a solo founder:** your chatbot-disclosure burden is largely the model vendor's (50(1)/50(2)), but **if your app generates deepfakes or publishes AI-written public-interest text, the 50(4) disclosure is yours as the deployer.** **[H, verified Y — primary text of Art. 50]**

**Timeline (with the late-2025 Omnibus correction):**
- Entry into force **1 Aug 2024**; prohibited practices + AI literacy **2 Feb 2025**; GPAI/governance/penalties **2 Aug 2025**; **most obligations incl. Art. 50 → 2 Aug 2026**; original high-risk **2 Aug 2027**. **[H, verified Y — primary timeline]**
- **Digital Omnibus (proposed 19 Nov 2025; provisional Council/Parliament agreement 7 May 2026):** high-risk standalone systems delayed to **2 Dec 2027**, embedded-in-products to **2 Aug 2028**. **Article 50 transparency stays on 2 Aug 2026**, except machine-readable marking of *already-on-market* generative systems (50(2)) pushed to **Feb 2027**. **[H, verified Y — but the Omnibus is a *provisional agreement*, not final-adopted text; confirm final dates before relying]**

### 2.9 FTC AI enforcement (Operation AI Comply)
- **DoNotPay (settled Jan 2025): $193,000** — "world's first robot lawyer" claims not backed by training on actual law. **[H, verified Y — FTC]**
- **Workado (Apr 2025):** AI Content Detector advertised "98% accurate," alleged actual ~53%. **[H, verified Y]**
- **Rytr (complaint Sept 2024, final order Dec 2024) — REVERSED:** FTC reopened and set aside the Rytr order on **Dec 22, 2025**. So Rytr is no longer a live precedent. **[H, verified Y — important nuance: don't cite Rytr as good law]**
- **Disney COPPA (settled 2025; court-approved Dec 2025): $10 million** — enabling collection of kids' data on YouTube kid-directed videos. **[H, verified Y — FTC]**

### 2.10 Colorado AI Act + the "does it hit small consumer apps?" question
- **Delayed to Jan 1, 2027** (SB 25B-004 pushed to Jun 30 2026; SB 189 signed May 14 2026 pushed to **Jan 1 2027** and narrowed it). **[H, verified Y]**
- It targets **"high-risk" AI systems used in consequential decisions** (employment, lending, housing, etc.) — **a generic consumer chat/LLM feature is generally NOT in scope** unless it drives a consequential decision. So for most solo consumer apps, Colorado AI Act is a low-priority concern. **[M-H, verified — the scope is high-risk/consequential-decision; "generic consumer app excluded" is an inference from that scope, well-supported]**

### 2.11 PLUS items
- **TCPA one-to-one consent rule: VACATED.** 11th Cir. (*Insurance Marketing Coalition v. FCC*) vacated it **Jan 24, 2025**; FCC then deleted the language. **Bundled consent remains permissible** under the prior rules. Still: get clear prior express written consent for marketing SMS, honor STOP, and check the standard TCPA rules — they still apply. **[H, verified Y]**
- **Global Privacy Control: required in 12 states by Jan 1, 2026** (CA, CO, CT, MT, NE, NH, NJ, MN, MD, DE, OR, TX). CA/CO/CT have explicitly confirmed GPC qualifies. New CA regs (eff. Jan 1, 2026) require a **visible confirmation** ("Opt-Out Request Honored"). Sept 2025 joint CA/CO/CT AG sweep targeted non-honoring. **[H, verified Y]**
- **Cookie/ePrivacy enforcement trend:** CPPA/AG actions increasingly target **consent banners that don't actually disable tracking** (Todd Snyder's misconfigured banner; Healthline's banner "that did not disable tracking cookies, despite purporting to do so"). The banner must *work*, not just appear. **[H, verified Y]**

---

## Phase 3: Failure Modes (documented enforcement)

These are real fines/actions — each maps to a mechanism that didn't work:

| Action | Who / When | $ | What broke | Lesson for a solo founder |
|---|---|---|---|---|
| **Honda** (CPPA) | Mar 2025 | $632,500 | Required identity verification / agent authorization to submit **opt-outs**; cookie tool made opt-out harder than opt-in | **Over-verification of a rights request is a violation.** Don't gate an opt-out behind ID. |
| **Todd Snyder** (CPPA) | May 2025 | $345,178 | Misconfigured cookie banner failed to honor opt-outs **for 40 days**; privacy portal demanded **government ID for all requests** incl. opt-out | The banner must actually disable tracking; don't demand ID for opt-outs. |
| **Healthline** (CA AG) | Jul 2025 | $1.55M (largest CCPA to date) | Kept sharing data after opt-out; shared article titles revealing medical-condition inference; consent banner that "did not disable tracking cookies, despite purporting to do so"; no required contract terms with ad vendors | Honor opt-outs end-to-end; put CCPA terms in vendor contracts. |
| **Tractor Supply** (CPPA) | Oct 2025 | $1.35M | (record CPPA penalty — opt-out / signal handling) | Opt-out plumbing is the #1 CCPA enforcement target. |
| **Sephora** (CA AG) | Aug 2022 | $1.2M | Didn't disclose "sale," didn't honor **GPC** opt-outs | GPC must be honored as a valid opt-out. |
| **DPG Media** (Dutch DPA) | 2020 | €525,000 | Required **ID copy for all DSARs** | The original over-verification fine — minimization applies to verification. |
| **Disney** (FTC, COPPA) | Dec 2025 | $10M | Enabled kids'-data collection on kid-directed YouTube videos w/o parental consent | COPPA "actual knowledge" + child-directed content. |
| **DoNotPay** (FTC) | Jan 2025 | $193,000 | "Robot lawyer" AI claims not substantiated | Don't overstate AI capability — "AI washing." |

**Play-store rejections are the most common solo-founder failure:** account-deletion answers that don't validate in the Data Safety form get new submissions/updates **rejected in Play Console** — a launch blocker, not a fine, but it stops you cold. Google blocked 80,000+ developer accounts in 2025.

**The pattern:** every privacy fine above is an opt-out/deletion/verification *mechanism* failing, or a consent banner that lies. None is "missing privacy policy."

---

## Phase 4: Contrarian

I stress-tested the five claims a newbie most wants to believe:

1. **"Small apps never get fined."** *False, with nuance.* The headline GDPR fines are big-tech, but **DPG Media (€525k)**, **Todd Snyder ($345k)**, and **Honda ($632k)** are not big-tech privacy giants — they're mid-size companies fined for ordinary mechanism failures (ID-gated opt-outs, broken banners). COPPA penalties scale partly by **company size**, which cuts a small operator's per-incident exposure — but the FTC's per-violation ceiling ($53,088) multiplies fast across many child users. The realistic solo-founder risk isn't a headline fine; it's (a) a **Play/App Store rejection** that blocks launch, (b) a **complaint-driven DPA inquiry** that eats weeks, and (c) **class-action / private-right-of-action** exposure (CCPA gives a private right for breaches; BIPA-style biometric suits). **[H, verified — named mid-size enforcement exists]**

2. **"GDPR doesn't apply to US-only companies."** *False where you target EU residents.* Art. 3(2) "targeting" criterion: GDPR applies to non-EU companies that **offer goods/services to people in the EU (even free) or monitor their behavior** — **no EU office or employee needed**, location-based not citizenship-based. The safe-harbor nuance: *mere accessibility* from the EU isn't enough; there must be **intent to target** (EU-language marketing, EUR pricing, EU shipping). A genuinely US-only app that doesn't court EU users can credibly fall outside it — but the moment you run EU ads or accept EU signups deliberately, you're in. **[H, verified Y — EDPB Guidelines 3/2018]**

3. **"The AI Act doesn't touch API callers."** *False.* API callers are **deployers**, and deployers carry Art. 50(4) (deepfake/public-interest-text disclosure). The chatbot-disclosure (50(1)) and content-marking (50(2)) duties sit with the model **provider** (OpenAI/Anthropic), so a thin chat wrapper offloads much of the burden upward — **but not all of it**, and you inherit vendor-due-diligence expectations (confirm the provider's GPAI transparency docs). **[H, verified Y]**

4. **"The AI Act got delayed, so I have until 2027."** *Misleading.* The **high-risk** rules slipped to Dec 2027 — but **Art. 50 transparency is still 2 Aug 2026**. A founder who reads "AI Act delayed" headlines and relaxes will miss the transparency deadline that actually applies to a consumer LLM app. **[H, verified Y]**

5. **"Backups make GDPR deletion impossible, so I can ignore it."** *False.* The ICO's "beyond use" doctrine explicitly permits a **rolling-window** purge — delete from live systems now, let backups age out on their schedule, don't restore deleted records. You must *document* the schedule and not re-use backup data. The 2026 EDPB report shows DPAs are now *checking* for exactly this procedure, so "we have no backup-deletion process" is the failing answer. **[H, verified Y]**

**Bonus contrarian — "Colorado AI Act will hit my consumer app."** *Probably false.* It governs **high-risk consequential-decision** systems and is delayed to **Jan 1, 2027**; a generic consumer LLM feature isn't a consequential-decision system. Don't over-prioritize it. **[M-H, verified]**

---

## Source Registry

*(P = primary/official; S = secondary/firm-analysis; A = aggregator)*

| URL | Supports | Type |
|---|---|---|
| https://gdpr-info.eu/art-12-gdpr/ | Art. 12(3)/(5)/(6) DSAR clock, fee, ID-doubt | P (consolidated text) |
| https://gdpr-info.eu/art-33-gdpr/ | Art. 33(1)/(2) 72h breach + processor duty | P |
| https://gdpr-info.eu/art-34-gdpr/ | Art. 34(1)/(3) user notice + exceptions | P |
| https://developer.apple.com/app-store/review/guidelines/ | Guideline 5.1.1(v) verbatim | P (Apple) |
| https://developer.apple.com/support/offering-account-deletion-in-your-app/ | Apple deletion mechanics, REST API, regulated carve-out | P (Apple) |
| https://support.google.com/googleplay/android-developer/answer/13327111 | Google in-app + web link + Data Safety form | P (Google) |
| https://ico.org.uk/.../right-to-erasure/ | "beyond use" backup doctrine, erasure exceptions | P (ICO) |
| https://www.edpb.europa.eu/.../edpb_cef-report_2025_right-to-erasure_en.pdf | 2026 EDPB CEF report on backup-erasure gaps | P (EDPB) |
| https://www.edpb.europa.eu/system/files/2023-04/edpb_guidelines_202201_data_subject_rights_access_v2_en.pdf | Right-of-access ID-verification proportionality | P (EDPB) |
| https://artificialintelligenceact.eu/article/50/ | Art. 50(1)/(2)/(4) provider vs deployer duties | P (consolidated AI Act text) |
| https://artificialintelligenceact.eu/implementation-timeline/ | AI Act application dates | P (consolidated) |
| https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule | COPPA amended Rule (dates, §312.10) | P (Federal Register) |
| https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions | "actual knowledge," neutral age-gate | P (FTC) |
| https://www.ftc.gov/.../disney-pay-10-million-... | Disney $10M COPPA | P (FTC) |
| https://oag.ca.gov/news/press-releases/attorney-general-bonta-announces-largest-ccpa-settlement-date-secures-155 | Healthline $1.55M | P (CA AG) |
| https://www.hunton.com/.../cppa-fines-honda-632-500... | Honda $632,500 (over-verification of opt-out) | S |
| https://www.cdflaborlaw.com/blog/todd-snyder-... | Todd Snyder $345,178 (banner + ID-for-opt-out) | S |
| https://www.onetrust.com/blog/eu-digital-omnibus-proposes-delay-of-ai-compliance-deadlines/ | Digital Omnibus high-risk delay, Art. 50 stays | S |
| https://www.consilium.europa.eu/en/press/press-releases/2026/05/07/... | 7 May 2026 provisional Omnibus agreement, new high-risk dates | P (Council) |
| https://natlawreview.com/article/eleventh-circuit-vacates-tcpa-one-one-consent-rule... | TCPA 1:1 vacated Jan 2025 | S |
| https://www.clym.io/blog/what-is-global-privacy-control... | GPC required in 12 states | S/A |
| https://www.insideprivacy.com/childrens-privacy/district-court-enjoins-... + Cooley/H&K (Mar 2026) | CA AADC 9th Cir. narrowing | S |
| https://www.hunton.com/.../district-court-blocks-enforcement-of-scope-act... | TX SCOPE Act blocked | S |
| https://www.akingump.com/.../colorado-postpones-implementation... + Clark Hill | Colorado AI Act delayed to 2027 | S |
| https://www.foley.com/insights/publications/2026/03/state-data-breach-notification-laws/ | 50-state breach chart (Mar 2026) | S (maintained chart) |
| https://privacyrights.org/.../data-breach-notification-laws-50-state-survey-2026-edition | 50-state breach survey | A (maintained) |

---

## Confidence Matrix (key claims)

| Claim | Confidence | Verified | Basis |
|---|---|---|---|
| GDPR DSAR = 1 month + 2-month extension w/ notice | H | Y | Art. 12(3) verbatim |
| CCPA deletion = 10-bus-day ack + 45 days (+45) | H | Y | Statute + multiple sources |
| Over-verification of a rights request is itself a violation | H | Y | EDPB guideline + DPG/Honda/Todd Snyder fines |
| Backups: "beyond use" rolling-window is accepted | H | Y | ICO primary |
| Apple 5.1.1(v) requires in-app account deletion | H | Y | Apple primary (verbatim) |
| Google requires in-app deletion + **web link in Data Safety form** | H | Y | Google primary (verbatim) |
| GDPR breach: 72h to authority unless "unlikely … risk"; users at "high risk" | H | Y | Art. 33/34 verbatim |
| Vendor (processor) breach → your clock starts at your awareness; you notify | H | Y | Art. 33(2)/28 |
| US state breach laws: all 50; AG threshold often 500+; 30–60 day deadlines | M-H | Partial | Aggregators consistent; confirm per-state |
| COPPA amended Rule full compliance 22 Apr 2026 | H | Y | Federal Register |
| COPPA "actual knowledge" + neutral age-gate discipline | H | Y | FTC FAQ |
| CA AADC narrowed (9th Cir. Mar 2026); TX/FL/UT enjoined/on appeal | H | Y | Court opinions + firm analyses |
| API caller = deployer (not provider) | H | Y | AI Act structure + sources |
| Art. 50 transparency duties incl. deployer 50(4) | H | Y | Art. 50 verbatim |
| AI Act Art. 50 stays 2 Aug 2026; high-risk delayed to Dec 2027 (Omnibus) | H | Y | Council + firm analyses (Omnibus provisional) |
| Colorado AI Act delayed to Jan 1 2027; targets high-risk decisions | H | Y | Akin/Clark Hill |
| TCPA one-to-one consent rule vacated Jan 2025 | H | Y | 11th Cir. via firm analyses |
| GPC required in 12 states by Jan 1 2026 | H | Y | Multiple sources |
| Billing/tax retention ~6–7 yrs | M | Partial | Jurisdiction-specific; exception itself is H |

---

## Gaps Remaining

1. **Apple 5.1.1(v) exact registry text vs. support-page text.** The main Review Guidelines page returned only the one-sentence 5.1.1(v) ("you must also offer account deletion within the app"); the operational detail came from Apple's *Offering account deletion* support page. Both are Apple-official, but a literal block-quote of the full 5.1.1(v) sub-bullets directly from the guidelines page wasn't retrievable in one fetch — confirm against the live guidelines PDF if the verbatim sub-bullets matter.
2. **Per-state US breach deadlines & thresholds.** I verified the *pattern* (30–60 days; 500-resident AG thresholds for CA/FL/NY) and the existence of maintained 50-state charts, but did not enumerate all 50. For any specific target market, pull the exact state statute (the Foley chart, updated Mar 2026, is the fastest authoritative index).
3. **Comprehensive-state-law exact effective dates.** The count (~19) and the 45+45 clock pattern are solid; individual 2026 effective dates (e.g., the newest tier) should be confirmed against each state AG before a founder relies on a specific one.
4. **Digital Omnibus is provisional, not final.** The 7 May 2026 Council/Parliament agreement on the new high-risk dates (Dec 2027 / Aug 2028) is a *provisional agreement*; final adopted text could shift. The Art. 50 = Aug 2026 date is the safe planning assumption regardless.
5. **Tax/billing retention year-counts** are jurisdiction-specific and were not pinned to a primary tax-authority citation here (the *existence* of the legal-obligation exception is verified; the durations are practitioner defaults).
6. **ICO "beyond use" — no fixed day count.** ICO says "until it is replaced in line with an established schedule," not a number; the EDPB's promised further guidance on "without undue delay for backups" had not been issued as of this research.
