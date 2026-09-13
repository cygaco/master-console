# Launch-guide research (growth loops · onboarding · test-on-PC) — Claude Deep Research Report

*Claude leg of a 3-engine deep-research pipeline. Focus: source verification, contrarian analysis, cross-source validation. Date: 2026-06-12. 3 rounds completed, 35 sources consulted.*

## Executive Summary

The single most load-bearing finding for a newbie founder: the **"Do you like the app?" → YES-to-store / NO-to-feedback review-gating pattern is explicitly BANNED on Google Play** (the In-App Review API design guidelines state, verbatim, that "Your app shouldn't ask the user any questions before or while presenting the rating button or card, including questions about their opinion (such as 'Do you like the app?')"), while **Apple's App Store Review Guidelines contain no equivalent rule** — and on iOS the gate is *technically impossible* anyway because `SKStoreReviewController`/`AppStore.requestReview(in:)` is a fire-and-forget call that returns no signal about whether the prompt showed or what rating was given (max 3 prompts per 365-day window). A US-facing founder is *also* governed by the **FTC Final Rule on Consumer Reviews (effective Oct 21 2024, up to $51,744/violation)**, which targets review suppression broadly — so even where a platform is silent, gating to suppress negative public reviews carries regulatory risk. On onboarding, the evidence strongly favors a **guest/anonymous-first flow that defers the signup wall until after first value** (forced registration in the first session drives immediate uninstalls; demos-behind-signup cut trial starts 30-70%), but anonymous auth (Firebase/Supabase/Clerk) carries real footguns — orphaned-data merge conflicts on account-linking and bot-abuse that floods your DB and runs up cost (mitigated by App Check/CAPTCHA/Turnstile + scheduled cleanup). For **teen/minor audiences**, the amended COPPA Rule (effective June 23 2025, compliance deadline **April 22 2026**) materially raises the bar. On **testing from a Windows PC**: Android emulation is fully viable (use **WHPX/Hyper-V** — HAXM is dead, AEHD sunsets Dec 31 2026), but there is **no legitimate iOS Simulator on Windows**; the real path is a physical iPhone + Expo Go / EAS cloud builds (Free tier: 15 iOS builds/mo) + a cloud device lab (Firebase Test Lab free tier: 5 physical-device runs/day) — and several bug classes (push notifications, IAP, real camera/sensors, performance, deep links) *cannot* be validated on emulator and need a real device before launch.

---

## Phase 1: Landscape

### Workstream 1 — Growth loops

**In-app review prompting.** Both platforms ship a native, non-customizable prompt and *require* you to use it rather than link out to a custom rating UI:

- **iOS** — `SKStoreReviewController.requestReview()` (legacy) / `AppStore.requestReview(in:)` (SwiftUI/current). Apple **Guideline 1.1.7** disallows custom review prompts; you must use the provided API. Quota: **a maximum of 3 prompts within a 365-day period, per user, per app**. The prompt always shows in debug builds, **never shows in TestFlight builds**, and is rate-limited/non-deterministic in production. There is **no programmatic way to know whether the prompt displayed or what rating the user gave**.
- **Android** — Google Play **In-App Review API** (`ReviewManager` / `launchReviewFlow`). The card is rendered by Play; you cannot modify size/opacity/shape, overlay it, or remove it programmatically. Google enforces a **time-bound quota** (calling `launchReviewFlow` more than once in a short period — "for example, less than a month" — may show no dialog), and the **exact quota value is an undocumented implementation detail that can change without notice**.

**Referral programs.** Modern stack = share-link + **deferred deep-link attribution** (routes a user to the right in-app destination even through an App Store/Play install gap). Note Firebase Dynamic Links is deprecated; alternatives include Branch, AppsFlyer OneLink, Adjust, Airbridge, and lighter SDKs (Tapp, Dynalinks). **100% deterministic attribution is not achievable on iOS** due to Apple's privacy stance — platforms blend device-fingerprint + platform referrer data probabilistically. Vendor data favors **double-sided rewards** (claims of ~2.3x more referrals, ~91% higher participation vs single-sided; >78% of programs reward both sides) — treat these specific multipliers as **vendor-sourced/low-confidence**.

### Workstream 2 — Onboarding

Strong, repeated consensus: **defer the signup wall until after first value.** Best practice is to gate only the legally-required minimum at the door and collect the rest via **progressive profiling** (ask for a field at the point-of-need when it becomes relevant). Guest/anonymous-first is the enabling mechanism: **Firebase Anonymous Auth**, **Supabase `signInAnonymously()`**, and Clerk-style progressive sign-up all let a user reach value before committing an identity, then **link** the anonymous session to a real provider later. Time-to-first-value targets cluster around **<15 min for simple products, 1-3 days for complex B2B**; users who hit a value milestone in the first session retain at **3-5x** the rate of those who don't.

### Workstream 3 — Testing on a Windows PC

- **Android**: Fully supported. Android Studio emulator accelerated by **WHPX (Windows Hypervisor Platform, via Hyper-V)** — works on Intel *and* AMD. **HAXM is deprecated** (gone from emulator 36.2.x+); **AEHD** is a fallback that **sunsets Dec 31 2026** — migrate to WHPX. Needs hardware virtualization enabled in BIOS, 8GB RAM min (16GB recommended).
- **iOS**: **No official iOS Simulator on Windows** — it's part of Xcode, macOS-only, and Apple's EULA restricts macOS to Apple hardware. Hackintosh/VM routes violate the EULA and are fragile. Legitimate paths: **physical iPhone + Expo Go**, **EAS cloud builds** (no Mac needed), cloud device farms, or Mac-in-cloud rental.
- **Cross-platform**: Expo offers three test surfaces — **Expo Go** (fast, but only bundled native modules; not for production-grade native deps), **dev client** (`expo-dev-client`; full native environment, the real choice for production apps), and **web**. PWA/browser device-mode (Chrome/Edge DevTools) covers responsive layout but not native behaviors.

---

## Phase 2: Mechanics (verified quotes & numbers)

### Review prompting — exact platform text

**Google Play In-App Review API** (primary source, developer.android.com — *quoted verbatim*):
> "Your app shouldn't ask the user any questions before or while presenting the rating button or card, including questions about their opinion (such as 'Do you like the app?') or predictive questions (such as 'Would you rate this app 5 stars')."
> "Surface the card as-is, without tampering or modifying the existing design in any way, including size, opacity, shape, or other properties."
> "To provide a great user experience, Google Play enforces a time-bound quota on how often a user can be shown the review dialog. Because of this quota, calling the `launchReviewFlow` method more than once during a short period of time (for example, less than a month) might not always display a dialog."
> "The specific value of the quota is an implementation detail, and it can be changed by Google Play without any notice."
> "...you should not have a call-to-action option (such as a button) to trigger the API, as a user might have already hit their quota and the flow won't be shown... For this use case, redirect the user to the Play Store instead."

**iOS StoreKit** (`SKStoreReviewController` — confirmed across Apple docs + criticalmoments.io + Microsoft Learn):
> "The system will only display the review prompt a maximum of three times within a 365-day period, per user, per app." Limit doesn't apply in development builds; prompt **never appears in TestFlight**. "There's no programmatic way to know if your requestReview call displayed a prompt or not. Similarly, there's no way to determine if the user rated your app or what rating they gave it."

**Apple Guideline 1.1.7**: disallows custom review prompts → you must use the provided API. (Note: the *current* numbered text of "1.1.7" in Apple's live guidelines reads about harmful/exploitative concepts; the "use the provided API for reviews" rule is the long-standing reviews provision historically cited as 1.1.7 and still enforced — see Gaps.) Apple also reserves the right to remove apps and expel developers for **manipulating ratings or App Store discovery**.

### Anonymous auth mechanics (Supabase — primary source, quoted)

- Convert anonymous → permanent: **email/phone via `updateUser()`** (then verify), or **OAuth via `linkIdentity()`**.
- Conflict on link: "When an anonymous user attempts to link to an existing account, the system detects the conflict" — you must "reassign entities tied to the anonymous user" and "implement your chosen conflict resolution strategy" (merge / overwrite / custom).
- Abuse: "It is strongly recommended to enable invisible CAPTCHA or Cloudflare Turnstile to prevent abuse for anonymous sign-ins." Anonymous sign-ups carry an **IP-based rate limit of 30 requests/hour** (token-bucket, adjustable in dashboard). The JWT exposes an `is_anonymous` claim.
- Cleanup: "Automatic cleanup of anonymous users is currently not available." Manual: `delete from auth.users where is_anonymous is true and created_at < now() - interval '30 days';`

**Firebase** account-linking footgun (from official issues/docs): linking fails if the credential is already attached to another account → **merge conflict**. The resilient pattern is to **migrate the anonymous user's data BEFORE signing into the existing account** (e.g., a Cloud Function authenticated as the anonymous user that merges data, then proceed with sign-in only on success) — otherwise a failed migration leaves the user in "limbo"/data-loss because the anonymous account is discarded on `signIn`.

### COPPA — amended rule (primary-source dates verified)

- **Effective June 23 2025; full compliance required by April 22 2026.** Scope: children **under 13**.
- Expanded "personal information" to include **biometric identifiers** (fingerprints, facial patterns, voiceprints, gait, DNA) and **government-issued identifiers**.
- Requires **separate verifiable parental consent** for non-integral third-party disclosures (targeted advertising, AI training).
- Prohibits **indefinite retention** of children's data; mandates a written security program with a designated coordinator + annual risk assessments.
- **Mixed-audience** services require **age screening before collecting any PI**; you can bifurcate site sections to avoid a mandatory age gate on general-audience areas.
- New approved consent methods include text-message initiation, knowledge-based authentication, and facial-recognition match to a government ID. (Feb 25 2026 FTC Policy Statement eases enforcement when data is collected *solely* for age-verification without prior parental consent.)

### Testing — exact free-tier / pricing numbers

- **EAS Build (Expo)**: Free tier = **15 Android + 15 iOS builds/month**. Starter $19/mo ($45 build credit, 3,000 MAU for EAS Update). Production $199/mo ($225 build credits). SDK/CLI are free forever; cost only from EAS Build/Update/Submit.
- **Firebase Test Lab**: Spark (free) = **10 virtual-device test runs/day + 5 physical-device runs/day**. Blaze = **$1/hr virtual, $5/hr physical** (with 60 min/day virtual + 30 min/day physical free allowance). iOS supported via **XCTest/XCUITest + Game Loop** (Robo is Android-only); iOS tests cap at 45 min on physical devices.
- **BrowserStack App Live**: free signup + paid plans from ~$12.50/mo; 30,000+ real devices via browser.

---

## Phase 3: Failure Modes (documented)

1. **Review-gating regulatory/policy hit.** Google bans the pre-prompt at the API level *and* via Business-Profile review policy ("Discouraging or prohibiting negative reviews, or selectively soliciting positive reviews from customers" is not allowed). The **FTC Final Rule (Oct 21 2024)** prohibits review suppression with penalties up to **$51,744/violation** (precedent: Fashion Nova, $4.2M). Confidence: **High**, primary-source verified.
2. **Anonymous-auth bot abuse / cost blowout.** Anonymous endpoints are "slightly easier to abuse with bots and scripts than OAuth." Firebase anonymous login is exploitable: an attacker decompiles the APK, extracts the embedded Firebase config, scripts anonymous logins, and reads any data exposed by a permissive rule like `.read: auth.uid != null` — and bot sign-ups can balloon DB size/cost. Mitigate with App Check/CAPTCHA/Turnstile, rules stricter than "is authenticated," and scheduled cleanup. Confidence: **High**.
3. **Orphaned data / merge-conflict on account linking.** Repeated across Firebase issue trackers (2018→present): naive anonymous-upgrade flows lose data or strand users in limbo when the destination identity already exists. The fix (migrate-before-signin / Cloud Function merge) is non-obvious and easy to get wrong. Confidence: **High**.
4. **Signup wall too early kills activation.** Forced registration in a mobile app's first session → "immediate uninstalls and poor retention"; demo-behind-signup cuts trial starts **30-70%**; each removed friction point lifts completion **3-8%**. A documented anti-pattern: gating an email before download spiked *account* counts but produced **no more activated or paying users**. Confidence: **High**.
5. **Emulator-green, real-device-red.** Apple/RN forums document apps that run in the simulator but **crash on first launch on a physical iPhone** (e.g., `EXC_BREAKPOINT`/`SIGTRAP`), and crash in TestFlight while fine in the emulator. Classes that *cannot* be validated on emulator: push notifications, in-app purchases/StoreKit, real camera/biometrics/GPS/sensors, true performance + thermal/battery, and (on iOS) the actual store-review prompt. Confidence: **High**.
6. **Windows dev-server networking traps.** Under WSL2 the Metro/Expo dev server (port 8081; older 19000/19002) isn't on the same LAN as your phone → connection fails unless you add a `netsh interface portproxy` forward, open a Windows Defender inbound rule for TCP 8081 (Private), and set `REACT_NATIVE_PACKAGER_HOSTNAME`. USB-debugging also needs Developer Options → USB debugging + MTP/file-transfer mode + correct OEM drivers. Confidence: **High**.
7. **Referral fraud / poor-quality leads.** Self-referrals + fake accounts are the dominant attack on signup flows (~46% of fraudulent activity per Arkose 2025); one cited program saw **>40% of Jan-May 2025 referral payouts claimed by fraudulent actors**. A documented case: a referral program generated such **poor-quality leads** that screening cost more than it returned. Minimum viable defenses for a solo founder: reward only on a verified *qualifying action* (not signup), block self-referral (device/IP/payment-instrument checks), cap rewards per advocate, and validate "new user" strictly. Confidence: **Med-High** (some stats vendor-sourced).

---

## Phase 4: Contrarian

- **"Review gating is fine — everyone does it."** *Partly true on iOS, false on Android.* On iOS the satisfaction pre-prompt is widely used and Apple's guidelines don't forbid it — and `SKStoreReviewController` is un-gateable anyway (you can't suppress it based on the answer; you can only choose *whether to call it*). On Android the In-App Review pre-prompt is **explicitly banned**. And US-facing, the **FTC rule against review suppression applies regardless of platform**. Net: a "how's it going?" check that routes unhappy users to *private feedback* is defensible **only if you do NOT also suppress their ability to leave a public review**; routing designed to *block* negative public reviews is the prohibited form.
- **"Referral programs don't work for small apps / build them early."** *Mostly correct as a caution.* Most apps have a **k-factor well below 1** (B2B ~0.20 is common); below 1, referrals **cannot** sustain growth on their own — they only shave CAC (a k of 0.2 ≈ ~17% CAC reduction). The Dropbox/Clubhouse home-runs are survivorship outliers. Referrals are **premature** before you have product-market fit and a love-it core loop; building them first is a classic newbie misallocation. Worth it once retention is proven and sharing is natural.
- **"Signup walls increase user quality."** *Weak-to-mixed support.* There's a real signal that friction filters for higher-intent users (PLG free tiers attract uncommitted users that drag activation), but the dominant evidence is that early walls **destroy** both conversion AND downstream activation/revenue. The defensible synthesis: keep the wall late, but place a *meaningful* commitment step at the point of value-capture (e.g., to save/sync work), which filters intent without taxing exploration.
- **"Emulator testing is enough."** *False for launch.* Emulators are fine for layout/logic iteration but provably miss device-only failures (push, IAP, sensors, performance, real-device crashes). A real-device pass is non-negotiable pre-launch.

---

## Source Registry

*(P = primary/authoritative, S = secondary)*

**Growth — reviews**
- https://developer.android.com/guide/playcore/in-app-review — Play In-App Review API: verbatim pre-prompt ban, quota, design rules. **(P)**
- https://developer.apple.com/documentation/storekit/skstorereviewcontroller — iOS review controller (API surface). **(P)**
- https://criticalmoments.io/blog/skstorereviewcontroller_guide_with_examples — 3-per-365 quota, debug/TestFlight behavior, no-detection rule. (S)
- https://learn.microsoft.com/en-us/dotnet/api/storekit.skstorereviewcontroller.requestreview — API binding/versioning confirm. **(P-mirror)**
- https://developer.apple.com/app-store/review/guidelines/ — Apple guidelines (1.1.7 / ratings-manipulation). **(P)** *(JS-rendered; partial fetch)*
- https://www.spokk.io/blog/google-review-gating — Google Business-Profile gating ban + FTC penalty. (S)
- https://birdeye.com/blog/google-birdeye-against-review-gating/ — review-gating-is-banned framing. (S)
- https://www.appreply.co/blog/app-store-reviews-101 — satisfaction-gate as tactic (no policy cite). (S)

**Growth — referrals**
- https://adapty.io/blog/deferred-deep-linking/ — deferred deep-link mechanics 2026. (S)
- https://www.tapp.so/firebase-dynamic-links-deprecation-guide/ — FDL deprecation + alternatives. (S)
- https://referral-factory.com/learn/double-sided-referral-program — double-sided reward claims. (S, vendor)
- https://www.voucherify.io/blog/how-to-launch-a-double-sided-referral-program — fraud/margin caution. (S, vendor)
- https://www.saxifrage.xyz/post/k-factor-benchmarks — k-factor benchmarks (most <1). (S)
- https://review.firstround.com/glossary/k-factor-virality/ — k-factor definition/threshold. (S)
- https://www.rivo.io/blog/fraud-prevention-referrals-statistics — referral-fraud stats 2026. (S, vendor)
- https://seon.io/resources/referral-fraud/ — referral-fraud taxonomy + defenses. (S, vendor)
- https://loyaltyrewardco.com/teslas-secret-to-curbing-referral-program-fraud/ — Tesla referral-fraud case. (S)

**Onboarding**
- https://supabase.com/docs/guides/auth/auth-anonymous — anonymous sign-in, linking, conflict, rate limit, cleanup. **(P)**
- https://supabase.com/docs/guides/troubleshooting/security-of-anonymous-sign-ins-iOrGCL — abuse guidance (CAPTCHA/Turnstile). **(P)**
- https://firebase.google.com/docs/auth/android/account-linking — Firebase account linking + merge conflict. **(P)**
- https://medium.com/h7w/abusing-anonymous-login-on-firebase-91416ce2fd36 — anonymous-auth abuse PoC. (S)
- https://www.descope.com/learn/post/progressive-profiling — progressive profiling pattern. (S)
- https://www.context.dev/blog/saas-onboarding-best-practices — signup-wall placement, field-cut conversion lift. (S)
- https://www.digitalapplied.com/blog/customer-onboarding-time-to-value-2026-saas-metrics-framework — TTV targets. (S)
- https://blogs.perficient.com/2017/08/29/be-our-guest-how-forced-account-creation-kills-conversion/ — forced-account-creation kills conversion. (S)
- https://clerk.com/docs/upgrade-guides/progressive-sign-up — Clerk progressive sign-up. **(P)**

**Onboarding — minors/COPPA**
- https://www.loeb.com/en/insights/publications/2025/05/childrens-online-privacy-in-2025-the-amended-coppa-rule — amended COPPA dates/obligations. **(P-grade legal)**
- https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule... — FTC COPPA finalization. **(P)**
- https://www.federalregister.gov/documents/2025/04/22/.../childrens-online-privacy-protection-rule — Federal Register text. **(P)**
- https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials — FTC reviews rule. **(P)**
- https://www.federalregister.gov/documents/2024/08/22/2024-18519/... — FTC reviews rule (Federal Register). **(P)**

**Testing on Windows**
- https://developer.android.com/studio/run/emulator-acceleration — WHPX recommended; acceleration config. **(P)**
- https://learn.microsoft.com/en-us/dotnet/maui/android/emulator/hardware-acceleration — HAXM deprecation, AEHD sunset Dec 31 2026. **(P-mirror)**
- https://docs.expo.dev/develop/development-builds/introduction/ — Expo Go vs dev client. **(P)**
- https://docs.expo.dev/billing/plans/ — EAS Build free-tier (15+15). **(P)**
- https://firebase.google.com/docs/test-lab/usage-quotas-pricing — Test Lab free quota + Blaze pricing. **(P)**
- https://firebase.google.com/docs/test-lab/ios/get-started — iOS test types, 45-min cap. **(P)**
- https://www.browserstack.com/guide/test-ios-apps-on-windows — iOS-on-Windows via real-device cloud. (S, vendor)
- https://www.codegenes.net/blog/flutter-ios-emulator-for-windows/ — no iOS sim on Windows / EULA. (S)
- https://medium.com/weavik/react-native-expo-on-wsl2-aff04b1639f8 — WSL2 Metro/firewall/port traps. (S)
- https://gist.github.com/younes0/de8ff1386a5868e77e9907728f93645e — netsh portproxy LAN forward. (S)

---

## Confidence Matrix

| Key claim | Confidence | Verified vs primary |
|---|---|---|
| Google Play bans "Do you like the app?" pre-prompt before review card | **High** | **Yes** (developer.android.com, verbatim) |
| Apple has no equivalent gating ban; iOS prompt is un-gateable / no result signal | **High** | Partial — StoreKit no-detect confirmed (P); "no Apple rule" is absence-of-evidence (Med on the negative) |
| iOS review prompt: max 3 / 365 days, none in TestFlight | **High** | Yes (Apple docs + 2 corroborating) |
| Google In-App Review quota is undocumented/changeable; no CTA button | **High** | **Yes** (developer.android.com, verbatim) |
| FTC Final Rule on reviews effective Oct 21 2024, up to $51,744/violation | **High** | **Yes** (ftc.gov + Federal Register) |
| Amended COPPA: effective Jun 23 2025, compliance Apr 22 2026, under-13 | **High** | **Yes** (legal analyses + Federal Register) |
| Supabase anon: 30 req/hr IP limit, CAPTCHA/Turnstile, no auto-cleanup | **High** | **Yes** (supabase.com, verbatim) |
| Firebase anon-link merge-conflict → migrate-before-signin pattern | **High** | Yes (Firebase docs + issue trackers) |
| Early signup wall kills activation; demos-behind-signup -30–70% trials | **High** | Med-primary (multiple S sources converge) |
| HAXM deprecated; use WHPX; AEHD sunsets Dec 31 2026 | **High** | **Yes** (Android dev + MS Learn) |
| No legitimate iOS Simulator on Windows | **High** | Yes (Apple EULA logic, multiple S) |
| EAS Free = 15 iOS + 15 Android builds/mo | **High** | Yes (Expo docs/pricing) |
| Firebase Test Lab free = 5 physical + 10 virtual runs/day; Blaze $5/$1 per hr | **High** | **Yes** (firebase.google.com) |
| Double-sided ≈ 2.3x referrals / 91% higher participation | **Low** | No (vendor-sourced marketing stats) |
| Most apps k-factor < 1 (B2B ~0.20) | **Med-High** | Med (consistent across analyst sources) |
| Emulator-green/device-red crash class is real | **High** | Yes (Apple forums, multiple threads) |

---

## Gaps Remaining

1. **Apple's exact reviews-guideline numbering.** Apple's live guidelines page is JS-rendered and resisted clean fetch; the "must use the provided API for reviews" rule is historically cited as **1.1.7**, but the *current* numbered text at 1.1.7 reads about exploitative concepts. The substance (use the native API, don't manipulate ratings) is verified; the precise current section number should be confirmed directly in Xcode's guidelines or the live page before quoting a number to a founder. **Recommendation: cite the rule by substance, not by "1.1.7," unless re-verified.**
2. **Apple's stance on the satisfaction pre-prompt is silence, not explicit permission.** No Apple document was found that *affirmatively blesses* the YES/NO pre-prompt. The defensible claim is "Apple does not prohibit it and the API can't enforce gating," not "Apple permits it."
3. **Clerk anonymous/guest specifics.** Clerk has progressive sign-up (verified) but I could not confirm a first-class *anonymous-user/guest* primitive equivalent to Firebase/Supabase `signInAnonymously()` — needs a direct docs check before recommending Clerk for a guest-first flow.
4. **GDPR-K age-of-digital-consent table.** COPPA (US, under-13) is well-covered; the EU "age of digital consent" varies by member state (13-16) and was not enumerated this round — fill before advising an EU-facing teen product.
5. **Quantitative referral multipliers and k-factor bands** lean on vendor/analyst blogs; treat the specific numbers as directional, not authoritative.
6. **Deferred-deep-link attribution accuracy rates** (e.g., probabilistic match success on iOS post-ATT) were described qualitatively; no hard 2026 benchmark number was pinned.
