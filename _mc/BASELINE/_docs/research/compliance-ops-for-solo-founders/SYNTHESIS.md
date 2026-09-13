# Compliance ops for solo founders — Deep Research Synthesis

**Date:** 2026-06-12 · **Method:** o3-deep-research 4-phase + Claude 3-round verified + gpt-5.5-pro xhigh consult (Gemini leg unavailable)

## Executive Summary (3 sentences)

For a solo founder shipping a consumer (often AI) app in 2026, the enforced obligations are not "have a privacy policy" but a set of *working mechanisms* — right-sized DSAR verification, a breach clock that starts at awareness, app-store account-deletion plumbing, an honest age gate, and an AI-transparency label — and every recent fine maps to a mechanism that failed, not a document that was missing. All three engines agree on the load-bearing facts (DSAR clocks, over-verification-as-violation, the Play-vs-Apple deletion asymmetry, the GDPR two-tier 72h/high-risk split, deployer-vs-provider for API callers, and Art. 50 transparency surviving the high-risk delay), and the primary-source-verified Claude leg supplies the exact numbers and verbatim statutory text the o3 leg only gestures at. The o3 report adds genuine value in breadth (named extra enforcement cases, a small-business threshold/scope analysis, concrete DSAR tooling) but is unreliable on specifics — it hedges every date ("around 2025–2026"), invents a "hypothetical Colorado AI Act," and on the one place it pins a clean number it contradicts the verified leg (CCPA "confirm within 10 *business* days" rendered as a flat 45-day-only clock), so it is mined for adds and distrusted on facts.

## Cross-Validation Matrix

Confidence = the synthesized confidence after weighting the primary-source (Claude) leg highest. "o3" / "Claude" / "gpt-pro" columns: ✓ = stated and correct, ~ = stated but vague/hedged/partial, ✗ = wrong or contradicted by primary source, — = not addressed.

| Finding | o3 | Claude | gpt-pro | Confidence |
|---|---|---|---|---|
| GDPR DSAR clock = 1 month, extendable +2 months (3 total) with in-month notice | ✓ | ✓ (Art. 12(3) verbatim) | ✓ | **High** |
| CCPA/CPRA = confirm receipt ≤10 business days + substantive response ≤45 days (+45, 90 total) | ~ (45-day only; drops the 10-bus-day ack) | ✓ (statute + sources) | ✓ (names the 10-bus-day ack) | **High** |
| Over-verification (demanding ID for a routine request) is itself a GDPR violation | ✓ | ✓ (EDPB 01/2022 + DPG/Honda/Todd Snyder) | ✓ | **High** |
| The three enforcement actions: DPG Media €525k, Honda $632.5k, Todd Snyder $345,178 | ~ (Spain ID-copy + 1&1, not these three by name) | ✓ (all three, dated) | — | **High** |
| Google Play = in-app deletion **AND** web deletion link declared in Data Safety form | ✓ | ✓ (Google primary, verbatim) | ~ ("verify exact wording") | **High** |
| Apple 5.1.1(v) = in-app deletion only (no standalone web link required) | ✓ | ✓ (Apple primary, verbatim) | ✓ | **High** |
| Backups: "beyond use" rolling-window is the accepted answer (no fixed day count in law) | ✓ (says "30–90 days") | ✓ (ICO verbatim; flags no fixed number) | ✓ (30–60d default, 90 max) | **High** |
| Billing/tax + legal-hold retention exception (GDPR Art. 17(3)); ~6–7 yr practitioner default | ✓ | ✓ (exception H; year-counts jurisdiction-specific) | ✓ | **High** (exception) / **Med** (durations) |
| GDPR breach: 72h to authority from awareness, "unless unlikely to result in a risk" | ✓ | ✓ (Art. 33(1) verbatim) | ✓ | **High** |
| Art. 34 user notice = the *higher* "high risk" bar (+ unintelligible/disproportionate carve-outs) | ~ (states it, no carve-out detail) | ✓ (Art. 34(1)/(3) verbatim) | ~ | **High** |
| Processor breach flows up: vendor notifies controller "without undue delay"; your clock starts at *your* awareness | ✓ | ✓ (Art. 33(2)/28) | ✓ | **High** |
| State AG-notice thresholds ~500 residents (CA/FL/NY); 30–60 day deadlines | ✓ (Florida 30d named) | ✓ (CA/FL/NY 500; 30–60d) | ~ | **High** (CA/FL/NY) / **Med** (others) |
| COPPA amended Rule: published 22 Apr 2025, effective 23 Jun 2025, full compliance 22 Apr 2026 | ~ ("effective June 2025, compliance April 2026" — fuzzy) | ✓ (Federal Register, all three dates) | ~ ("verify final dates") | **High** |
| What COPPA changed: separate VPC for targeted-ad sharing; written retention policy (§312.10); biometrics added to PII | ~ ("likely expand… maybe") | ✓ (all three, specific) | — | **High** |
| Teen/AADC laws in-force-vs-enjoined: CA AADC narrowed (9th Cir. Mar 2026); TX/FL/UT blocked or on appeal | ~ (Utah/Arkansas; misses 9th-Cir. narrowing) | ✓ | ✓ (lists as volatile; verify) | **High** |
| API caller = **deployer**, not provider (provider only if fine-tune compute >⅓ of training compute) | ✓ (no ⅓ threshold) | ✓ (⅓ threshold) | ✓ | **High** |
| Art. 50(4) deepfake/public-interest-text disclosure is the *deployer's* (your) duty | ✓ | ✓ (Art. 50 verbatim) | ✓ | **High** |
| Art. 50 transparency stays **2 Aug 2026**; Omnibus delayed high-risk to ~Dec 2027; 50(2) already-on-market marking → Feb 2027 | ✗ (no Omnibus; "high-risk by 2027" only) | ✓ (Council 7 May 2026; PROVISIONAL) | ~ ("verify exact 2026 dates") | **High** (Aug 2026) |
| FTC AI enforcement (Operation AI Comply): DoNotPay $193k, Workado 98%-vs-53%; **Rytr set aside Dec 22 2025** | ~ ("hypothetical… at least one") | ✓ (named + Rytr reversal) | ~ | **High** |
| Training on user data needs consent/disclosure; no retroactive-by-stealth ToS | ✓ | ✓ | ✓ | **High** |
| TCPA one-to-one consent rule **vacated** (11th Cir., 24 Jan 2025); bundled consent permissible again | — | ✓ (named) | ~ ("ruling vacated… safe posture unchanged") | **High** |
| GPC honoring required in **12 states** by 1 Jan 2026; CA visible-confirmation reg | ~ (CA/CO/CT, "and others") | ✓ (12 states listed) | ✓ | **High** |
| Colorado AI Act delayed to **1 Jan 2027**, narrowed to high-risk consequential decisions (not generic chat) | ✗ ("Colorado AI Act… effective 2023/2026"; "hypothetical") | ✓ | ✓ | **High** |

**All-engines-agree score: 16 / 24** rows show all three legs aligned (✓ or acceptably-~ with no ✗). The 8 non-unanimous rows are non-unanimous *because o3 was vague or wrong*, not because Claude and gpt-pro disagreed — Claude and gpt-pro never directly conflict on any row.

## Consensus

Held by all three legs, no dissent:

- **Compliance is mechanisms, not paperwork.** A deletion button that deletes, an opt-out honored inside the clock, a breach runbook, an honest age screen, an AI label. Every cited fine is a broken mechanism.
- **Over-verification is a violation.** Right-size identity checks to risk; the authenticated session or an email round-trip covers ~95% of requests; government ID is the rare last resort, never the default.
- **The two app-store mandates are independent of privacy law and are app-review blockers.** Apple 5.1.1(v) = in-app deletion; Google Play = in-app deletion **plus** a web deletion link declared in the Data Safety form.
- **Breach is two-tier and clock-driven.** 72h to the authority from *awareness* (unless "unlikely to result in a risk"); users only at "high risk." Processor breaches don't transfer your duty.
- **API callers are deployers.** Heavy duties sit upstream with the model vendor; the deployer still owes Art. 50(4) content disclosure plus FTC honesty and data-handling duties.
- **Don't train on private user content by default**, and don't make AI capability claims you can't substantiate.
- **Right-size to scale, but GDPR has no small-business exemption.** (gpt-pro and o3 both stress thresholds; Claude's contrarian section confirms GDPR/targeting applies regardless of size.)

## High-Confidence Insights

1. **The "AI Act got delayed" headline is a trap.** The Digital Omnibus (provisional Council/Parliament agreement 7 May 2026) delayed *high-risk* rules to ~Dec 2027, but **Art. 50 transparency holds at 2 Aug 2026.** A founder who relaxes misses the one deadline that actually applies to a consumer LLM app. (Only the Claude leg got this right; o3 missed the Omnibus entirely.)
2. **Encryption is the founder's cheapest breach lever.** Encrypted-at-rest data that leaks usually falls outside US state-law triggers and qualifies for the Art. 34(3) "unintelligible" carve-out from *user* notice — materially shrinking obligations after an incident.
3. **The realistic solo-founder risk isn't a headline GDPR fine — it's (a) an App/Play Store rejection that blocks launch, (b) a complaint-driven DPA inquiry that eats weeks, and (c) private-right-of-action exposure** (CCPA breach PRA, BIPA-style biometric suits). Named mid-size enforcement (DPG Media, Honda, Todd Snyder) proves "small companies never get fined" is false.
4. **Don't cite dead law.** Rytr (FTC AI action) was reopened and **set aside 22 Dec 2025**; the TCPA one-to-one consent rule was **vacated Jan 2025**. Both legs that addressed these flagged the reversals; o3 did not.
5. **Document the backup-deletion schedule.** The "beyond use" latitude is real but the EDPB's 2026 CEF report is actively checking for it — "we have no backup-deletion process" is now the failing answer.

## Disagreements & Resolution

- **CCPA clock shape.** o3 presents CCPA as a flat 45-day clock and omits the **10-business-day acknowledgement**. Claude and gpt-pro both carry the ack. *Resolution:* the 10-bus-day ack + 45-day substantive response (+45) is correct (Cal. Civ. Code §1798.130); the published `DATA_REQUESTS_GUIDE` already states it. o3 loses.
- **Colorado AI Act.** o3 calls it "hypothetical," ties it to a 2023 Colorado Privacy Act profiling provision, and is internally muddled. Claude and gpt-pro both have it as a real, signed law **delayed to 1 Jan 2027** and narrowed to high-risk consequential decisions. *Resolution:* Claude/gpt-pro win; o3's framing is stale.
- **EU AI Act timeline.** o3 hedges to "around 2025–2027" and never mentions the Omnibus. Claude has the precise, primary-sourced post-Omnibus picture. *Resolution:* Claude wins; the Aug 2026 Art. 50 date is the safe planning anchor regardless of how the *provisional* high-risk dates finalize.
- **Backup window number.** o3 says 30–90 days; gpt-pro says 30–60 (90 max); Claude says there is **no fixed legal number** (ICO: "an established schedule"). *Resolution:* Claude is right on the law — the day-counts are practitioner defaults, and the artifacts already label them as such.

No substantive Claude-vs-gpt-pro conflict exists; gpt-pro's role is structure/judgment, and where it touches facts it aligns with the verified leg.

## Hallucination Check (o3 claims contradicted by primary sources)

1. **"Hypothetical 'Colorado AI Act'"** + "Colorado Privacy Act (effective 2023) requires profiling impact assessments… an AI accountability bill (hypothetical)." **Wrong.** Colorado's AI Act (SB 24-205, amended by SB 25B-004 / SB 189) is a real signed law, delayed to **1 Jan 2027**. *Winner: Claude + gpt-pro.*
2. **CCPA = flat 45 days**, dropping the 10-business-day confirmation-of-receipt. **Incomplete to the point of wrong.** *Winner: Claude (statute).*
3. **EU AI Act "expected to be in force around 2025–2026"** with no Digital Omnibus and no firm Art. 50 = Aug 2026 date. **Stale.** The Omnibus (7 May 2026 provisional agreement) is the current state of the world; Art. 50 = 2 Aug 2026 is fixed. *Winner: Claude (Council primary).*
4. **Fines framed speculatively** — "By 2025, the FTC also took action against at least one company… (confidence: Medium – hypothetical scenario based on FTC's signaled intent)." The actions are **real and named** (DoNotPay $193k Jan 2025, Workado Apr 2025). o3 hedged real enforcement into hypotheticals. *Winner: Claude (FTC primary).*
5. **No mention that Rytr was set aside (22 Dec 2025) or that the TCPA one-to-one rule was vacated (Jan 2025).** Presenting either as live law would be wrong; o3 simply omits both reversals. *Winner: Claude.*
6. **"AI Act… fines up to €30 million"** as the headline number. The Act's top tier is the higher of €35M / 7% of global turnover (for prohibited-practice violations); €30M is an outdated draft figure. Minor, but stale. *Winner: primary AI Act text.*

Net: o3's *direction* is reliable and its breadth is useful, but **every place o3 commits to a specific date, statute mechanic, or live-law status, it is either hedged into uselessness or contradicted by the primary-source leg.** This matches the pipeline's known precedent that the o3 leg is imprecise/stale on policy specifics.

## Sub-Question Answers

- **DSAR/deletion clocks?** GDPR 1 month (+2). CCPA 10-business-day ack + 45 days (+45). ~19 US state laws mostly mirror 45+45.
- **Verification?** Right-sized; over-verification is a violation; session/email-token default; ID only for genuine locked-out-of-sensitive-data cases.
- **Backups?** Rolling-window "beyond use" (ICO); delete live now, age backups out on a *documented* schedule, never restore a deleted record.
- **Retention exceptions?** Billing/tax (~6–7 yr) + legal hold (Art. 17(3)); retain the narrow slice, segregate, disclose.
- **Store deletion?** Apple = in-app only; Google = in-app + web link in Data Safety form.
- **Breach clock + thresholds?** 72h authority from awareness; users at high risk; AG notice commonly ≥500 residents; 30–60 day state deadlines.
- **Processor breach?** Vendor → you "without undue delay"; your clock starts at your awareness; you notify.
- **COPPA?** Amended Rule full compliance 22 Apr 2026: separate VPC for ad-targeting, written retention policy, biometrics in PII; "actual knowledge" via the age gate is the trap.
- **Teen laws?** Volatile/enjoined (CA AADC narrowed Mar 2026; TX/FL/UT blocked or on appeal). Durable layer = federal COPPA + honest age gate. UK Children's Code is in force for UK-reachable teens.
- **Deployer vs provider?** API caller = deployer; provider only if fine-tune compute >⅓ of training compute.
- **Art. 50 / Omnibus?** Transparency 2 Aug 2026 (held); high-risk → ~Dec 2027; 50(2) already-on-market marking → Feb 2027; 50(1) chatbot/50(2) marking are provider duties, 50(4) deepfake/public-interest text is the deployer's.
- **FTC AI?** Operation AI Comply: DoNotPay, Workado; substantiate every claim; a disclaimer doesn't cure a deceptive core claim; Rytr is no longer good law.
- **Training on user data?** Default off; opt-in must be separate + revocable; no retroactive-by-stealth ToS; turn off vendor-side training too.
- **TCPA?** One-to-one consent rule vacated Jan 2025; bundled consent permissible again, but get prior express written consent for marketing SMS and honor STOP.
- **GPC?** Required in 12 states by 1 Jan 2026; CA reg adds a visible "Opt-Out Request Honored" confirmation.
- **Cookies?** Banners must *actually* disable tracking (Todd Snyder, Healthline); a reject-all as easy as accept-all.

## Practical Takeaways

1. Build the DSAR queue, the deletion cascade, and the web deletion link **before launch** — the clocks and the store review don't wait for you to feel ready.
2. Default to the lightest verification rung; never gate an opt-out behind ID.
3. Encrypt at rest — it shrinks both US-state breach triggers and the Art. 34 user-notice duty.
4. Write the one-page incident runbook and the "who to call" list (including a pre-identified breach lawyer) on day zero; the 72h clock runs from awareness.
5. Ship the AI-transparency label *with* the feature (Art. 50 = Aug 2026), keep a `claims_evidence.md`, and leave training-on-user-content off by default.
6. Run the day-zero audience fork: anything under-13 → lawyer before you build; honest neutral age gate for the 13+ default lane.
7. Treat o3's unique adds (below) as leads to verify, not facts to ship.

## Applicability to This Project

MC is an AI-product factory whose mandate is to get newbie-founder products **to PMF**, so this research is directly load-bearing for the launch pipeline (spinup/lastmile) and the qa-reviewer's compliance lens. The 10 already-published artifacts (6 `_guides/` + 4 `_knowledge/compliance/` rule-sets) consume exactly this research and are **already aligned with the verified Claude leg** — they were published from it. The delta-check (Task B) is therefore the operative deliverable: the o3 report landed *after* publication, and the question is only whether o3 surfaces anything the published artifacts should absorb. It largely does not (see envelope); the artifacts are current, primary-source-anchored, and correctly hedge the provisional items (Omnibus) and the practitioner-default numbers (retention durations, backup windows). The genuine o3-unique adds worth folding are enumeration/scope helpers (small-business thresholds, extra enforcement exemplars, named DSAR tooling), not corrections.

## Gaps & Future Research

1. **Per-state US breach deadlines + AG thresholds** — verified the *pattern* (CA/FL/NY ≥500, 30–60 days) and the maintained 50-state charts (Foley Mar 2026; Privacy Rights Clearinghouse 2026), not all 50. Pull the exact statute per target market.
2. **Comprehensive-state-law exact effective dates** — the ~19 count and 45+45 pattern are solid; the newest tier's 2026 dates need per-AG confirmation.
3. **Digital Omnibus is provisional** — the 7 May 2026 high-risk dates (Dec 2027 / Aug 2028) could shift in the final adopted text; Art. 50 = Aug 2026 is the safe anchor regardless.
4. **Tax/billing retention year-counts** — jurisdiction-specific; not pinned to a primary tax-authority citation.
5. **ICO "beyond use" has no fixed day count** — and the EDPB's promised further backup-erasure guidance had not issued as of this research.
6. **The o3-unique triggered modules** (tax/MoR, UGC/DMCA/DSA/CSAM, sanctions/export, FTC endorsements/reviews) — gpt-pro ranks these as the most important *missing* lanes; MC already has `COMPLIANCE_TRIGGERS_GUIDE` covering them at notice-depth, but several merit their own full guides as the library grows.

## Engine Performance

- **Claude (primary-source verified, 3 rounds, ~27 sources):** the spine. Verbatim statutory text, dated enforcement, explicit confidence/verified tags, and the only leg that caught the Digital Omnibus, the Rytr reversal, the TCPA vacatur, and the CCPA 10-business-day ack. Highest trust.
- **gpt-5.5-pro xhigh (expert judgment consult):** the best *structure* — gap rankings, the guide/rule-set taxonomy, the "agent must never decide no-notice" constraint, the triggered-module enumeration. Factually conservative and aligned with the verified leg; explicitly defers exact numbers to verification. High trust on judgment, abstains on specifics.
- **o3-deep-research (4 phases, 134KB, largest):** widest net and the source of the genuinely-unique adds (named extra cases, threshold/scope analysis, DSAR tooling, the contrarian "right-size to scale" argument). But it hedges every date, invents a "hypothetical" Colorado AI Act, misses the Omnibus, and softens real enforcement into "hypothetical scenarios." **Mine for breadth; distrust on any specific.**
- **Gemini leg:** unavailable this run.

## Raw Reports

- [`openai-report.md`](./openai-report.md) — o3-deep-research, 4 phases (~134KB)
- [`claude-report.md`](./claude-report.md) — Claude 3-round primary-source verified (~36KB)
- [`gptpro-consult.md`](./gptpro-consult.md) — gpt-5.5-pro xhigh expert consult (~44KB)
- [`deep-run-manifest.json`](./deep-run-manifest.json) — run manifest

---

*Part of the MC research library (`_docs/research/`). Synthesis date 2026-06-12. Confidence labels weight the primary-source-verified Claude leg highest, the gpt-pro consult for structure/judgment, and the o3 leg for breadth only. NOT legal advice; every date-stamped or jurisdiction-specific claim is a re-verify-before-relying item.*
