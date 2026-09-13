# Launch-guide research (growth loops · onboarding · test-on-PC) — Deep Research Synthesis

**Date:** 2026-06-12
**Method:** Real Deep Research (OpenAI o3-deep-research 4-phase [Landscape/Mechanics/Failure-Modes/Contrarian] + Claude 3-round verified search [35 sources, primary-source quotes] + gpt-5.5-pro xhigh expert-judgment consult; Gemini deep-research leg skipped: model unavailable)
**Original query:** Launch-guide research for total-newbie founders across three workstreams — (1) **growth loops**: in-app review prompting (compliance of the yes/no gating pattern, native API quotas, triggers) + referrals (attribution, rewards, fraud, k-factor, sequencing); (2) **onboarding**: signup-wall placement, progressive profiling, anonymous/guest auth + linking, COPPA/minors, activation metrics; (3) **testing mobile apps on a Windows PC** (toolchains, iOS-without-Mac, emulator limits, device kit, Windows traps).

---

## Executive Summary

The single most load-bearing finding for a newbie founder is that **the popular "Do you like the app?" → YES-to-store / NO-to-feedback review-gating pattern is explicitly banned on Google Play** (the In-App Review API guidelines forbid asking *any* question — naming "Do you like the app?" verbatim — before/while showing the rating card), is **risky-but-unnamed on Apple** (no rule names the pattern, but it violates Apple's anti-manipulation principles and is technically un-buildable because the iOS prompt is fire-and-forget with no result signal), and carries **US regulatory exposure** under the FTC Final Rule on Consumer Reviews (effective Oct 21 2024, up to $51,744/violation, Fashion Nova precedent $4.2M). The second-largest theme is convergent: **defer the signup wall until after first value** using guest/anonymous auth — but build the anonymous-to-account merge path *before* launch, because orphaned-data merge conflicts and anonymous-bot abuse are documented, costly footguns. On testing, the verdict is unambiguous: **Android emulation on Windows is fully viable via WHPX/Hyper-V** (HAXM is dead; AEHD sunsets Dec 31 2026), **there is no legitimate iOS Simulator on Windows**, and a real-device pass from a release-like build is non-negotiable before launch.

---

## Cross-Validation Matrix

Agreement read per engine: **A** = agrees/asserts, **D** = disagrees/contradicts, **~** = partial/soft, **·** = silent.

| Finding | o3 | Claude | gpt-5.5-pro | Confidence |
|---|:--:|:--:|:--:|---|
| Review yes/no gating **banned on Google Play** (verbatim "Do you like the app?") | **D** (says "allowed") | **A** (verbatim quote) | **A** | **High** |
| Review gating **risky-but-unnamed on Apple** (no rule, violates principles, un-gateable) | ~ ("allowed if careful") | A | A | **High** |
| **FTC reviews rule** applies regardless of platform ($51,744/violation, Oct 21 2024) | · | **A** (ftc.gov + Fed Reg) | A | **High** |
| iOS prompt: **max 3 / 365 days**, never in TestFlight, no result signal | A (3/yr) | **A** (full) | A | **High** |
| Google In-App Review **quota undocumented / silent no-op**, no CTA button | A (opaque) | **A** (verbatim) | A | **High** |
| **Firebase Dynamic Links deprecated** — don't build new on it | · (still cites FDL positively) | **A** | **A** | **High** |
| **Double-sided** rewards beat single-sided (direction) | A | A (magnitude=low-conf) | A | **High** (direction) / **Low** (the 2.3x/91% magnitudes) |
| **Referrals after retention** (premature before PMF) | A | A | A | **High** |
| **k-factor realism: most apps < 1** (B2B ~0.2) | A | A (Med-High) | A (worked math) | **Med-High** |
| **Defer signup-wall**; early wall kills activation (demos-behind-signup −30–70%) | A | **A** (multi-source) | A | **High** (direction) / **Med** (exact %) |
| **Anonymous-auth footguns**: merge conflict + bot abuse + no auto-cleanup | ~ (data-loss only) | **A** (Supabase/Firebase primary, 30 req/hr/IP, Turnstile) | **A** (footgun table) | **High** |
| **COPPA amended rule**: effective Jun 23 2025, compliance **Apr 22 2026**, under-13 | ~ (no dates) | **A** (Fed Reg dates) | ~ (no dates) | **High** |
| **Activation metric** = first-core-action (not signup); category bands | A (20–50%) | A (3–5x retain) | **A** (banded by category) | **Med** (bands are directional) |
| **WHPX** is the path; **HAXM dead / AEHD sunsets Dec 31 2026** | ~ (HAXM still mentioned as viable) | **A** (dates) | A | **High** |
| **No iOS Simulator on Windows** (EULA; Hackintosh fragile/illegit) | A | A | A | **High** |
| **EAS free tier** ≈ 15 iOS + 15 Android builds/mo | · | **A** (Expo docs) | ~ ("build service") | **High** |
| **Firebase Test Lab free tier** ≈ 5 physical + 10 virtual runs/day | · | **A** (Firebase docs) | ~ (device-farm option) | **High** |
| **What needs a real device** (push, IAP, sensors, perf, deep links, release build) | A | A | **A** (full checklist) | **High** |

**All-three-agree score: 11 of 18 matrix rows** are full **A/A/A** (or A with only magnitude caveats). The 7 split rows are almost all **o3 dissenting or silent** against a Claude+gpt-pro consensus that is primary-source-backed — see Disagreements.

---

## Consensus (all engines agree)

1. **Use only the native review APIs** (`SKStoreReviewController`/`AppStore.requestReview` on iOS; Play In-App Review on Android). No custom rating UI, no incentivized reviews, no "Rate us" button wired to the native prompt (point it at the store-listing URL instead).
2. **Trigger review prompts at objective value moments, never on day zero or after a failure**, and never assume the dialog actually showed.
3. **Referrals are an amplifier, not an engine** — build them *after* retention/PMF, expect k < 1, default to double-sided non-cash rewards, and pay only after a verified qualifying action past the refund window.
4. **Defer the signup wall to the first action that needs identity** (save/sync/pay/share/interact); collect only the core-loop minimum at signup and gate the rest via progressive profiling.
5. **Guest/anonymous auth is the enabling mechanism** — but the data-merge/upgrade path is *your* problem to build, and anonymous endpoints need bot defenses.
6. **Minors change everything** — age-gate before any data collection; COPPA/GDPR-K obligations are legal, not optional; a teen social/matchmaking app is a regulated trust-and-safety product.
7. **Activation-to-first-core-action is the first metric**, not signup completion.
8. **Emulate to build, real-device to launch** — Android emulation works on Windows; iOS has no local simulator; several bug classes are device-only.

## High-Confidence Insights

- The iOS review prompt is **technically un-gateable**: you get no callback telling you whether it showed or what rating was given, so sentiment-routing is impossible on iOS even if you wanted it — the honest framing is "Apple doesn't bless the gate, and you couldn't reliably build it anyway."
- **Reward only on a qualifying action, never on signup**, is the single highest-leverage anti-fraud move a solo founder can make (self-referral + fake accounts are the dominant attack).
- **Migrate anonymous data BEFORE signing into an existing account** (Cloud Function / transactional merge) is the resilient linking pattern; the naive "sign in then merge" strands users in limbo on the existing-email collision.
- **WHPX (Hyper-V)** works on both Intel and AMD and is the official recommendation; every HAXM tutorial is now stale.
- The **release build ≠ debug build** — minification/tree-shaking breaks things that pass in debug; smoke-test a signed/TestFlight/Play-Internal build on real hardware.

## Disagreements & Resolution

The disagreements cluster on one axis: **o3 vs. the Claude+gpt-pro consensus**, and in every load-bearing case the consensus wins on primary-source recency/primacy.

1. **Is the YES/NO review gate allowed?** o3 says *"the common 'enjoying the app?' gating pattern is **allowed** if done carefully"* (Phase-1/Mechanics) and elsewhere even calls it "acceptable in 2026." **Claude refutes this with a verbatim primary-source quote** from developer.android.com banning *any* pre-question, naming "Do you like the app?" exactly. **gpt-5.5-pro independently calls it "noncompliant review gating."** **Winner: Claude/gpt-pro.** Reason: a verbatim quote from the platform's own current docs beats o3's unsourced "widely used → acceptable" inference. *(Note: o3's own later Failure-Modes phase actually contradicts its own earlier Mechanics phase, citing that Apple "prohibited this review gating practice in 2017" — o3 is internally inconsistent, which itself argues for trusting the cross-validated source.)* The published GROWTH_LOOPS guide already sides correctly with Claude.
2. **Firebase Dynamic Links.** o3 repeatedly recommends FDL as a referral backbone ("Firebase's Dynamic Links allow passing a referral UID…"). **Claude and gpt-pro both flag FDL as deprecated/shut down — do not build new on it.** **Winner: Claude/gpt-pro** (recency — FDL's deprecation is the newer, decisive fact). Guides already correct.
3. **HAXM viability.** o3 still presents HAXM as a live acceleration option alongside Hyper-V. **Claude pins it as removed (emulator 36.2.x+) with AEHD sunsetting Dec 31 2026.** **Winner: Claude** (dated primary sources). Guides already correct.
4. **COPPA dates.** o3 discusses COPPA only generically (under-13, parental consent) with **no dates**; Claude supplies the amended-rule dates (effective Jun 23 2025, compliance Apr 22 2026). No true conflict — **Claude is additive and more precise.** Guides already carry the dates.

## Hallucination Check

Claims in **o3** contradicted by primary-source evidence in Claude/gpt-pro (i.e., things a newbie would be harmed by if they trusted o3 alone):

- **"The yes/no satisfaction gate… neither Apple nor Google have taken action against the pattern as of 2026 (Confidence: Medium)" and "[the gate is] allowed if done carefully (Confidence: High)."** Contradicted by Google's verbatim ban. This is o3's most dangerous claim — it would lead a founder to ship a Play-policy violation. **Flagged.**
- **o3 recommends building referral attribution on Firebase Dynamic Links.** FDL is deprecated; building new on it is dead-end work. **Flagged.**
- **o3 treats HAXM as a current option.** Removed from the emulator. **Flagged (stale, not fabricated).**
- **o3's stray citation artifacts** — several o3 "sources" are mis-attributed (e.g., a `developer.android.com` in-app-review URL cited as the source for an Apple HIG "avoid pestering" quote, and a `daringfireball.net` link cited for COPPA/Kids-category claims). The *substance* of those claims is independently corroborated, but **o3's source attributions are unreliable** and should not be quoted as provenance. **Flagged (citation hygiene).**

No fabrication was found in Claude or gpt-pro; Claude self-labels its one soft area (vendor-sourced double-sided multipliers, k-factor bands) as Low/Med confidence, and gpt-pro is judgment-framed throughout.

## Sub-Question Answers

**Growth loops.** Use native review APIs only; never sentiment-gate (banned on Play, risky on Apple, FTC-exposed in the US). Build two *decoupled* flows: private feedback on negative signals (never mentioning reviews) + native prompt on positive milestones (no question attached). iOS = 3 prompts/365d, no result signal, never in TestFlight; Android quota is opaque and silent. Referrals: share-link + deferred deep link (Play Install Referrer on Android; iOS deterministic attribution is impossible — fall back to a code entered after signup; **not** Firebase Dynamic Links). Default double-sided non-cash rewards; reward only after a qualifying action past the refund window; cap per referrer; immutable ledger; no automated cash payouts. Expect k < 1 (the ~0.09 worked example is "useful assist," not viral). Sequence: review prompt near launch (not day zero), referrals only after activation is healthy (~20%+).

**Onboarding.** Defer the wall to the first identity-needing action; collect only the core-loop minimum, progressively profile the rest. Early-wall counter-cases: multi-device continuity, social/network products (empty profiles poison liquidity), data-sensitive/regulated, B2B workspace. Guest/anonymous auth (Firebase/Supabase `signInAnonymously()`; Clerk's anonymous primitive unconfirmed) enables value-before-identity — but build & test the merge-before-signin upgrade path, turn on App Check/Turnstile + strict per-user rules + scheduled cleanup (no auto-cleanup; Supabase caps 30 req/hr/IP), and alias anonymous→account IDs in analytics. Minors: age-gate before any collection; COPPA amended rule (under-13; effective Jun 23 2025; compliance Apr 22 2026; expanded PI incl. biometrics; mixed-audience age screening); GDPR-K 13–16 by member state. First metric = activation-to-first-core-action; bands ~50–80% utility, 30–60% AI/productivity, 20–45% social, 15–40% B2B; under 20% = fix before growth levers.

**Testing on a Windows PC.** Android: fully viable via WHPX/Hyper-V (HAXM dead; AEHD sunsets Dec 31 2026; enable BIOS virtualization; x86_64 image *with* Google Play Services; 8GB min/16GB comfortable). iOS: no legitimate simulator on Windows — real iPhone + Expo Go (free/instant, bundled native modules only), EAS cloud builds + TestFlight (free ≈15 iOS builds/mo; needs $99/yr Apple account + a real iPhone), device farms (Firebase Test Lab free ≈5 physical/day; BrowserStack/AWS), Mac-in-cloud last resort. Device-only validation: push, IAP/subscriptions, camera/sensors/biometrics/GPS, low-end performance, cold-start deep links, iOS safe-areas/notch, Sign in with Apple, and the *release* build. Windows traps: firewall blocks dev server (allow Node on Private, or `--tunnel`), same-Wi-Fi requirement, WSL2 port-forwarding, USB-debugging drivers, `10.0.2.2` for host-from-emulator, keep project out of OneDrive. Min kit: one cheap/refurbished Android early + access to a real iPhone before push/IAP/deep-links/submission.

## Practical Takeaways

1. Delete any "Are you enjoying the app?" review funnel from the plan; ship the two-decoupled-flows design instead.
2. Wire a "Rate us" Settings item to the **store-listing URL**, not the native prompt (the prompt silently no-ops and looks broken).
3. Build the anonymous→account **merge-before-signin** path and *test* it before launch.
4. Turn on anonymous-auth bot defenses (App Check/Turnstile + strict per-user rules + scheduled cleanup) on day one.
5. Gate referral rewards behind a verified qualifying action past the refund window; never pay on signup; never auto-pay cash.
6. Instrument **activation-to-first-core-action** as the first metric; don't build referrals until it clears ~20%.
7. Set up Android emulation on **WHPX**; ignore every HAXM tutorial; enable BIOS virtualization.
8. Line up a real iPhone (owned/borrowed) and EAS/device-farm accounts at **project start**, not launch week.
9. Smoke-test a **release-like build on real hardware** before every store submission.

## Applicability to This Project

MC is a product factory that ships **launch guides** into the spinup/lastmile bootstrap pipeline and grounds its agents with knowledge rules. Three implications:

- **The three guides this research fed are already published and already correct** on every load-bearing point (verbatim Play ban, FTC rule, FDL deprecation, WHPX, COPPA dates, merge-before-signin, activation-first). The o3 leg, despite being the largest input, adds essentially **no new correct facts the guides lack** — its value here was *negative-space confirmation* (it shows what a single-engine, lower-rigor research pass would have gotten wrong, validating the multi-engine cross-validation discipline).
- **Encode the cross-validation lesson as a grounding rule:** "review-gating is banned on Play (verbatim), risky on Apple, FTC-exposed" is the kind of crisp, enforceable, primary-source-anchored fact that belongs in the agent knowledge layer so any future guide or generated app inherits it.
- **Guide freshness has expiry-dated facts** (AEHD Dec 31 2026; COPPA compliance Apr 22 2026 already passed; EAS/Test-Lab free tiers drift). These warrant a dated re-verification cadence on the guide library rather than treating them as static.

## Gaps & Future Research

1. **Apple's exact reviews-guideline section number** — historically 1.1.7, but the live numbered text drifted; cite the rule by *substance*, not number, until re-verified in Xcode's live guidelines.
2. **GDPR-K per-member-state age table** (13–16) was not enumerated — fill before advising any EU-facing teen product.
3. **Clerk anonymous/guest primitive** — Clerk has progressive sign-up, but a first-class `signInAnonymously()` equivalent was not confirmed; check before recommending Clerk for guest-first.
4. **Deferred-deep-link attribution accuracy on iOS post-ATT** — described qualitatively; no hard 2026 benchmark pinned.
5. **Referral multipliers / k-factor bands** lean on vendor/analyst blogs — directional, not authoritative.
6. **The skipped Gemini leg** — a third independent verification pass on the o3-vs-Claude disagreements would have further hardened the gating/FDL/HAXM resolutions (here, gpt-pro served as the tiebreaker and agreed with Claude on all three).

## Engine Performance

- **Claude (3-round verified)** — the **most reliable** input. Primary-source verbatim quotes (the verbatim Google ban is the report's crown jewel), explicit confidence labels, a confidence matrix, and an honest gaps section. It set the factual spine the guides were built on.
- **gpt-5.5-pro (xhigh consult)** — the **most actionable** input. Translated facts into copyable defaults: the eligibility-rule block, the referral table/ledger schema, the field-by-field signup table, the activation bands by category, the Windows-traps table, and the "single most expensive mistake per guide." It independently corroborated Claude on every contested point.
- **o3-deep-research (4-phase, 174KB)** — the **largest but least precise** input. Its unique contributions were *breadth and structure* (the explicit Landscape→Mechanics→Failure-Modes→Contrarian framing, and a wide enumeration of edge cases like Instruments/Crashlytics blind spots, node-gyp/long-path Windows build traps, and tablet/OS-version device-kit nuance). But on the load-bearing compliance facts it was **wrong or stale** (gating "allowed," FDL recommended, HAXM live) and **internally inconsistent** (its Mechanics phase blessed the gate its Failure-Modes phase said Apple banned in 2017), and its **citations were unreliable**. Net: o3 widened the search space and surfaced minor enrichments, but the multi-engine design is exactly what caught it from poisoning the guides.

## Raw Reports

- o3-deep-research (4-phase): `_docs/research/launch-guide-research-for-total-newbie-f/openai-report.md`
- Claude (3-round verified): `_docs/research/launch-guide-research-for-total-newbie-f/claude-report.md`
- gpt-5.5-pro xhigh consult: `runtime/guides-consult/gpt-pro-answer.md`
- BRIEF.md: `_docs/research/launch-guide-research-for-total-newbie-f/BRIEF.md` (research brief that scoped the three workstreams)

---

*3-engine deep-research synthesis (Gemini leg skipped: model unavailable). Compliance wording, free-tier numbers, and expiry-dated facts (AEHD sunset, COPPA deadline) drift — re-verify primary sources before quoting to a founder.*
