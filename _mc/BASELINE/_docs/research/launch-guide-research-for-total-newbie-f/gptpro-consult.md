# Launch-guide recommendations — mobile/web growth + onboarding + Windows testing

**Policy freshness note:** store-policy wording and section numbers move. For publication, verify the latest Apple App Store Review Guidelines, Google Play policy center, StoreKit docs, Play In-App Review docs, COPPA/GDPR-K thresholds, and device-farm service availability. The recommendations below are intentionally conservative for newbie founders.

---

## Guide 1 — Growth loops: in-app review prompting + referrals

### Pipeline placement

**Split the guide internally by maturity:**

- **Review prompting:** while building + pre-launch gate. Ship the infrastructure early, but only trigger after real users have received value and the app is stable.
- **Referrals:** usually **post-launch**, after retention/value is proven. Exception: invite links are core infrastructure for social/collab apps, but reward programs should still wait.

### What this guide must get right

1. **Do not teach review gating.**
2. **Use only native review APIs for in-app prompts.**
3. **Make review prompting event-based, conservative, and silent-failure-safe.**
4. **Treat referrals as a backend reward/fraud system, not just a share button.**
5. **Prevent founders from paying referral rewards before qualification/refund windows.**

---

### 1. Review pre-prompt compliance: the planned flow is risky/noncompliant

Planned flow:

> “Are you enjoying the app?”  
> YES → native store review prompt  
> NO → internal feedback form

For a newbie launch guide, treat this as **noncompliant review gating**.

#### Apple

Relevant area: **App Store Review Guidelines 5.6.1 / App Store Customer Reviews**.

Apple’s core principles:

- Do not manipulate App Store reviews.
- Use Apple’s provided review API for in-app rating prompts.
- Custom review prompts are disallowed or highly risky.
- Do not require or incentivize ratings/reviews.

The yes/no pre-prompt is problematic because it is a **custom sentiment filter** before the App Store review prompt. Even if the native prompt is used after “YES,” the app is selectively routing likely-positive users to the store and likely-negative users away from it.

#### Google Play

Relevant areas:

- Google Play **Ratings, Reviews, and Installs** policy.
- Google Play **In-App Review API UX guidelines**.

Google is more explicit: apps should not ask users questions before presenting the review card, including questions like:

- “Do you like this app?”
- “Would you rate us 5 stars?”
- “Are you enjoying the app?”

So the proposed pattern is not the one to ship.

#### The line

**Allowed:**

- Prompting after objective engagement/value events.
- Suppressing prompts shortly after crashes, failed payments, errors, or support issues.
- Offering a general feedback/support channel.
- Showing an internal feedback form after a genuine failure moment.
- Having a user-initiated “Rate on App Store / Google Play” link in Settings that opens the store listing.

**Not allowed / high-risk:**

- “Do you like us?” → yes goes to store, no goes to feedback.
- NPS/CSAT score determines whether to request a review.
- “If you love us, rate us; if not, email us.”
- “Please rate 5 stars.”
- Any reward for leaving a review.
- Blocking functionality until a review is left.

### Closest compliant variant

Use two **separate** flows:

#### Flow A — feedback deflection

Trigger internal feedback after negative product signals:

- crash recovery
- failed export
- payment failure
- failed AI generation
- support/contact-us action
- cancellation flow
- repeated validation errors
- thumbs-down on a generated result

Copy:

> “Something didn’t work? Tell us what happened so we can fix it.”

Do **not** mention App Store reviews in that flow.

#### Flow B — native review prompt

Trigger the native review prompt after objective positive-value milestones:

- task completed
- level won
- first successful export
- streak achieved
- user returned multiple days
- subscription user got a successful outcome

No pre-question. No custom “Are you enjoying?” branch.

Pseudo-logic:

```text
if recent_negative_experience:
    show_feedback_or_support_flow()

if positive_value_milestone
   and review_eligibility_rules_pass
   and not in onboarding/paywall/permission flow:
    request_native_review()
```

This preserves much of the negative-review deflection benefit without explicit sentiment gating.

---

### 2. Platform mechanics the guide must teach

| Topic | Apple / iOS | Google Play / Android |
|---|---|---|
| API | `SKStoreReviewController.requestReview(...)` / StoreKit review request APIs | Play Core In-App Review API |
| Quotas | Apple documents a max of roughly **3 prompts per user per app per 365 days**. Users can disable in-app ratings. TestFlight behavior differs from production. | Quota is **opaque**. Google does not disclose exact limits. Calls may silently no-op. |
| Can you know whether dialog showed? | **No.** No reliable callback saying the prompt displayed or the user reviewed. | **No.** The task completes even if no UI was shown or no review was submitted. |
| Should you call it from a “Rate us” button? | No. The API can no-op, making the button appear broken. Use a store URL for explicit user-initiated rating links. | No. Google’s review API guidance discourages CTA-triggered review cards. Use store listing link for a “Rate us” settings item. |
| Can you customize the dialog? | No. | No. |
| Can you incentivize reviews? | No. | No. |
| Good trigger moment | After real engagement/value, not on launch. | Same. |
| Testing | Development/TestFlight/App Store behavior differs. Do not depend on seeing the prompt in testing. | Use fake/test review managers where available; production quota behavior cannot be fully simulated. |

Rule for the guide:

> **Record your own `review_prompt_attempted` event, but never assume the store dialog appeared.**

---

### 3. Review trigger design: concrete defaults

Prefer the phrase **“value moment”** over “dopaminergic moment.” Newbie founders may otherwise overfit on manipulation rather than user value.

#### Default eligibility rule a newbie can copy

Trigger review request only if all are true:

```text
days_since_install >= 7
sessions_count >= 3
core_success_events >= 2
current_version_sessions >= 2
last_review_attempt_at is null OR > 120 days ago
no_crash_or_fatal_error_in_last_7_days
no_failed_payment_refund_or_support_ticket_in_last_14_days
not_during_onboarding
not_during_paywall
not_during_permission_prompt
not_during_active_task_or_gameplay
```

For very fast-cycle games, the first prompt can be earlier, but still avoid day-zero spam:

```text
days_since_install >= 2
sessions_count >= 3
levels_completed >= 5
last_session_crash_free = true
```

#### Category examples

| App type | Good review trigger | Bad trigger |
|---|---|---|
| Game | After level completion, boss win, chest opened, streak, tournament finish | Mid-game, after loss, after loot-box purchase, after ad |
| Productivity | After task/project completed, automation saved, export succeeded | On first launch, before user creates anything |
| Habit/fitness | Streak milestone, workout logged, weekly goal reached | After missed streak, injury/bad-health moment |
| Education | Lesson completed, quiz passed, milestone unlocked | After failed quiz |
| AI/content tool | Successful generation/export/save, repeated usage | After failed generation, rate limit, hallucinated result |
| Marketplace/commerce | After order delivered or successful booking | During checkout, failed payment, refund flow |
| Social/community | After meaningful connection or helpful interaction | After report/block/moderation conflict |
| Finance/health | After useful insight or successful setup | During anxiety, bad news, loss, diagnosis-like moment |

#### Frequency caps

Conservative defaults:

- First eligible prompt: **day 7+**
- Minimum sessions: **3**
- Minimum core successes: **2**
- App-level cooldown: **120 days**
- Crash cooldown: **7 days**
- Support/refund/cancellation cooldown: **14–30 days**
- Major version update: wait **48 hours or 2 sessions**
- Lifetime attempts: let platform quota handle hard cap, but your own product should rarely attempt more than **2–3 times/year**

---

### 4. Referrals: sane architecture for a solo founder

For a single-founder app, the default should be:

> **Share link + referral code + backend reward ledger + delayed rewards.**

Do not start with cash payouts or complex affiliate mechanics.

#### Minimum viable architecture

1. Every user gets a referral code.
2. Share URL is a universal/app link, e.g.:

   ```text
   https://example.com/invite/ABCD123
   ```

3. Link opens app if installed.
4. If not installed, route to landing page → App Store / Play Store.
5. On signup/activation, backend records attribution.
6. Reward is created as **pending**.
7. Reward becomes available only after a qualifying event.

Suggested tables/entities:

```text
users
  id
  referral_code

referral_clicks
  referral_code
  timestamp
  platform
  ip_hash
  user_agent_hash

referrals
  referrer_user_id
  referred_user_id
  status: pending | qualified | rewarded | clawed_back | rejected
  qualifying_event
  created_at

reward_ledger
  user_id
  referral_id
  reward_type
  amount
  status
  expires_at
  idempotency_key
```

#### Deferred deep-link reality in 2026

- **Android:** Play Install Referrer can help attribute installs.
- **iOS:** deterministic deferred deep linking is harder. Universal Links work if the app is installed, but post-install attribution often needs a vendor or fallback.
- **Firebase Dynamic Links:** deprecated/shut down by 2025; do not build a new 2026 guide around it.
- **Safer fallback:** invite code entry after signup, email invite links, or Branch/AppsFlyer/Adjust-style provider if budget allows.
- Avoid fingerprinting or pasteboard hacks. They can trigger privacy issues and platform rejection risk.

#### Double-sided vs single-sided rewards

Default for consumer apps: **double-sided non-cash reward**.

| Reward type | Good for | Bad for | Notes |
|---|---|---|---|
| Subscription time | Low marginal-cost subscription apps | High fraud risk if granted instantly | Grant after paid conversion or trial completion. Cap monthly. |
| Credits / consumables | AI generations, storage, scans, exports | Expensive compute if farmed | Know unit economics. Add caps. |
| Feature unlock | Prosumer tools, games, communities | If unlock harms monetization | Good low-cost option. |
| Cosmetic/status reward | Games, social, community | Utility apps with no status layer | Low fraud cost. |
| Cash | Marketplaces, fintech, high-LTV products | Almost all newbie apps | Requires fraud ops, tax/KYC/legal review. Avoid by default. |
| Discounts | Commerce, physical goods | Digital subscription apps if it steers around IAP | Watch App Store/Play payment rules. |

For iOS/Android digital goods, verify Apple/Google payment rules before granting referral-based digital entitlements. Free promotional access may be okay, but do not use referrals to route around required in-app purchase systems.

#### Minimum viable anti-fraud

For a no-fraud-team founder:

- Reward only after referred user is genuinely new.
- Block same account, same device/install ID, same payment instrument.
- Use email verification before reward.
- For paid rewards, require payment success and wait beyond refund window.
- Add refund/chargeback clawback.
- Cap rewards per referrer per day/week/month.
- Create immutable reward ledger entries.
- Use Play Integrity API / Apple App Attest or DeviceCheck for higher-value rewards.
- Rate-limit invite creation and signup.
- Flag same-IP/device clusters.
- Do not pay cash without manual review.
- Do not reward anonymous throwaway accounts.
- Publish referral terms.

Reward qualification examples:

```text
Low-value credits:
  referred user signs up
  verifies email
  completes first core action
  account age >= 24 hours

Subscription reward:
  referred user starts paid subscription
  payment succeeds
  refund window passes
  account age >= 7–14 days

Cash reward:
  do not offer unless you have fraud review, KYC/tax process, and legal approval
```

#### K-factor reality check

K-factor:

```text
k = invites_sent_per_active_user × invite_to_qualified_user_conversion_rate
```

Example:

```text
20% of active users share
average sharer sends 3 invites
=> 0.6 invites per active user

15% of invites become qualified users
=> k = 0.6 × 0.15 = 0.09
```

That is decent but not viral.

For small apps:

- **k < 0.05:** normal for non-social utilities.
- **k = 0.05–0.15:** useful assist channel.
- **k = 0.15–0.4:** strong for consumer apps.
- **k > 1:** rare; usually only deeply social/collab products.

Referrals are probably a waste if:

- retention is poor,
- users are not organically sharing,
- the product has no obvious invite recipient,
- reward cost is unclear,
- fraud would be easy,
- activation from invited users is weak.

In those cases, prioritize ASO, content, SEO, partnerships, or paid acquisition tests.

---

### Sequencing recommendation

Your hypothesis is right with nuance:

- **Review prompting:** ship near launch, but do not prompt on day zero. Enable after stability/value gates.
- **Referrals:** wait until retention and unit economics are credible.
- **Exception:** social/collab apps need invite links early, but not necessarily referral rewards early.

### Deliberately leave out

Do not include:

- fake-review tactics,
- incentivized reviews,
- NPS-to-review routing,
- contact scraping,
- cash affiliate engines,
- multi-touch attribution modeling,
- ML propensity scoring,
- large-scale fraud systems,
- paid ads strategy.

---

## Guide 2 — Onboarding: signup-wall placement + progressive profiling

### Pipeline placement

This guide belongs at **project-start** and **while-building**.

Onboarding affects:

- data model,
- auth architecture,
- analytics,
- legal/privacy obligations,
- referral attribution,
- activation,
- monetization.

It should also be a **pre-launch gate**: no app should launch until signup/profile requirements are justified field by field.

---

### Sharpened doctrine

Your doctrine is directionally right:

> Optimize for time-to-problem-solved. Collect only what the core loop needs. Gate additional information at the moment it becomes necessary.

Sharpen it to:

> **Ask for identity or profile data only when it is required for the next value-delivering action, legal/safety compliance, durable data protection, payment, or interaction with other users.**

Important nuance:

- Deferred signup is not always better.
- A signup wall too early kills activation.
- A signup wall too late can lose data, enable abuse, or poison a network.

---

### Where deferred signup wins

Deferred signup works well when users can experience value without identity:

- single-player utilities,
- AI tools,
- calculators,
- photo/document tools,
- note-taking demos,
- content browsing,
- e-commerce browsing,
- educational previews,
- local-first prototypes,
- try-before-you-buy products.

Good gates:

- save to cloud,
- sync across devices,
- export,
- share,
- publish,
- subscribe,
- restore purchase,
- invite collaborators,
- exceed free quota.

### Where deferred signup hurts

Deferred signup can actively hurt when:

- user data is durable and valuable,
- losing anonymous state would be catastrophic,
- abuse costs money,
- the product has social/network effects,
- other users depend on profile completeness,
- moderation/trust/safety matters,
- payment entitlement must be tied to identity,
- the product is regulated or sensitive,
- the audience includes minors.

Examples:

- A teen matchmaking app should not allow anonymous/empty users into matching.
- A marketplace should not let anonymous users message sellers.
- A health app should not collect sensitive data casually before consent/account.
- An AI app should not give unlimited anonymous compute credits.
- A B2B workspace app often needs identity up front because workspace membership is the product.

---

### Decision framework for an AI agent

#### Step 1 — hard-stop checks

Ask first:

1. Is the app targeted to children or teens?
2. Does it collect sensitive data?
3. Does it enable user-to-user communication?
4. Does it collect precise location, contacts, photos, voice, health, finance, or biometrics?
5. Does it involve payments, payouts, or rewards?

If children/teens + social/matchmaking/location/UGC are involved, the guide should say:

> **STOP: legal and trust/safety review required before onboarding design.**

#### Step 2 — decide signup wall position

| Product condition | Signup wall position | Fields at signup | Gate later |
|---|---|---|---|
| User can solve first problem locally | No signup before first value | None, or anonymous ID | Cloud save, sync, export, subscription |
| Core action creates durable user data | Anonymous account before core action, upgrade later | None or minimal | Email/social login at save/sync |
| Social/community/matchmaking | Account before visibility, posting, messaging, or matching | Age gate, display name, minimum profile, safety settings | Bio, avatar polish, interests, contacts |
| Marketplace buyer | Browse as guest | None | Signup/payment/shipping at checkout or contacting seller |
| Marketplace seller | Signup before listing | Email, name/business, payout/KYC if needed | Advanced shop profile |
| B2B/collaboration | Signup at invite/workspace entry | Work email, name, org/workspace | Role, team metadata, integrations |
| Health/finance/sensitive | Account + consent before sensitive data | Email/auth, consent, required profile fields | Optional personalization later |
| Subscription app | Preview before signup if possible | Account before purchase if entitlement is server-side/cross-device | Billing details at paywall |
| Teen social/gaming matchmaker | Age gate first; account early | DOB/age band, username, game/platform, region, safety prefs | Avatar, detailed bio, optional interests |

#### Field-level rules

| Field | Ask at signup only if… | Otherwise gate at… |
|---|---|---|
| Email | Needed for account recovery, sync, workspace invite, payment, moderation | Save/sync/pay/share |
| Phone | Needed for high-trust marketplace, abuse prevention, 2FA | Transaction or high-risk action |
| Display name | User will be visible to others | First post/comment/match |
| Avatar | Needed for trust/social presence | First profile visibility moment |
| DOB/age | Required for legal, age-restricted, minors, dating/social | Do not ask casually |
| Gender | Required for product function and justified | Specific matching/personalization step |
| Location | Needed for local results, safety, shipping, matching | “Show nearby…” moment |
| Contacts | User explicitly chooses invite flow | Never on first launch |
| Goals/preferences | Needed to generate first useful plan | Ask before personalization, allow skip/default |
| Payment | User is buying | Checkout/paywall |

---

### Anonymous → account upgrade mechanics

Firebase/Supabase/Clerk-class tools usually give you:

- anonymous sessions/users,
- stable auth IDs,
- provider linking,
- email/social login,
- session persistence,
- auth state listeners,
- security-rule/RLS integration,
- passwordless or OAuth flows,
- sometimes passkeys/MFA.

They do **not** solve your product-data merge logic.

#### Common footguns

| Footgun | What happens | Prevention |
|---|---|---|
| Orphaned anonymous data | User upgrades incorrectly; anonymous rows remain detached | Store all user-owned data under auth UID; use transactional linking |
| Existing email collision | Anonymous user tries to link to email that already exists | Design merge flow before launch |
| Reinstall/data loss | Anonymous credential lost on uninstall/storage clear | Prompt account creation before high-value work |
| Multiple devices | Two anonymous profiles become one account | Use object-level IDs and merge rules |
| Abuse | Users reset anonymous account to farm free credits | Rate limits, device checks, email verification, quota by device/IP |
| Analytics split | Anonymous and registered users appear as separate people | Alias anonymous ID to account ID |
| Security rules too broad | Anonymous users can read/write too much | Strict RLS/security rules; anon can access only own data |
| Paid entitlement mismatch | Purchase tied to anonymous state but user later signs in elsewhere | Account before purchase or robust restore/merge |
| Deletion/privacy gap | Anonymous data not deleted with account | Treat anonymous data as personal data if linkable |

Rule:

> **If anonymous users can create valuable data, build the upgrade/merge path before launch, not after.**

---

### Teen/minor audiences

This is the highest-risk onboarding area.

#### Constraints that change design

- **COPPA:** U.S. children under 13. Parental consent may be required before collecting personal information.
- **GDPR-K:** EU children; parental consent threshold varies by member state, up to 16.
- **UK Age Appropriate Design Code / child safety laws:** privacy-by-default and age-appropriate design expectations.
- **Apple Kids Category / Google Play Families:** extra rules for child-directed apps, ads, analytics, SDKs, external links, purchases.
- **User-to-user communication:** moderation, reporting, blocking, anti-grooming, age assurance.
- **Precise location:** extremely sensitive for minors.
- **Photos, voice, contacts:** high-risk personal data.

#### Age gate design

- Age gate before collecting personal data.
- Make it neutral; do not encourage lying.
- Do not let an underage user immediately retry with a different birthday.
- Store only what you need: age band may be better than full DOB.
- Default minors to private settings.
- Do not upload contacts by default.
- Do not expose precise location.
- Do not allow unknown adult/minor matching without serious trust/safety design.

#### When the guide should say STOP

Say STOP and require lawyer/trust-safety review if the app:

- targets under-13 users,
- has mixed children/teen/adult audience,
- enables teen matchmaking,
- enables DMs or user-generated content for minors,
- collects precise location,
- collects contacts/photos/audio from minors,
- uses behavioral ads or tracking,
- involves schools/education records,
- collects health/mental-health data,
- offers cash/rewards to minors.

For the example “gaming-matchmaker social app for teens”: this is not just onboarding. It is a regulated trust/safety product. Minimum signup may still be preferred, but “minimum” must include age, safety, and profile completeness before matching.

---

### First metric to instrument

The first metric should be:

> **Activation rate to first core action / first value moment.**

Not signup completion.

Definition:

```text
activation_rate =
  new users who complete first meaningful core action within first session or 24h
  /
  new users who open the app
```

Examples:

| App type | Activation event |
|---|---|
| Todo/productivity | First task/project completed |
| AI tool | First successful useful generation/export |
| Education | First lesson completed |
| Fitness | First workout/habit logged |
| Marketplace | First relevant item viewed + saved/contacted/checkout started |
| Social/matchmaking | Minimum viable profile completed + first match/message/invite action |
| B2B | Joined workspace + completed first collaborative action |

Sane target bands:

- Simple utility: **50–80%**
- AI/productivity: **30–60%**
- Social/matchmaking: **20–45%**
- B2B/complex workflow: **15–40%**

If activation is under **20%** for a consumer app, fix onboarding/core value before adding referrals.

### Deliberately leave out

Do not include:

- full auth implementation,
- OAuth provider setup,
- legal templates,
- complex A/B testing platforms,
- ML personalization,
- dark-pattern onboarding,
- forced contact import,
- collecting “future useful” data,
- full COPPA compliance program details.

Cross-link to auth, legal, privacy, analytics, and security guides.

---

## Guide 3 — Testing your mobile app on a PC

### Pipeline placement

This guide belongs at:

- **project-start:** choose stack/toolchain honestly,
- **while-building:** daily PC/emulator/device workflow,
- **pre-launch gate:** real-device checklist.

Core message:

> PC testing is excellent for iteration. It is not sufficient for launch validation.

---

### What the guide must get right

1. Be honest: **there is no official iOS simulator on Windows.**
2. Teach a fidelity ladder: browser preview < emulator < physical device < store-distributed build.
3. Explain Expo Go vs dev-client vs production build.
4. Prevent “works on my PC” launches.
5. Make founders test release-like builds on real devices before submission.

---

### 2026 toolchain by stack

| Stack | Best Windows workflow | Good for | Caveats |
|---|---|---|---|
| React Native / Expo | Expo Go, Android emulator, physical Android, Expo web target | Fast iteration, JS/UI, managed Expo features | Expo Go does not include arbitrary native modules/config plugins. Not production-equivalent. |
| React Native / Expo dev-client | EAS dev builds + Android local/cloud + iOS cloud build | Production-like native runtime | iOS still requires cloud build/Mac/TestFlight/physical iPhone. |
| Bare React Native | Android Studio + physical Android/emulator | Android development on Windows | iOS requires Mac/cloud Mac. |
| Flutter | Windows desktop target, Chrome/web, Android emulator, physical Android | Fast UI/business logic iteration | Desktop/web target is not mobile. iOS requires Mac/cloud CI. |
| PWA/web | Browser devtools responsive mode | Layout iteration | Does not emulate iOS Safari/WebKit, mobile performance, PWA install behavior, push quirks. |
| Capacitor/Cordova/web-wrapped | Browser + Android Studio + physical Android | Android wrapper testing | iOS wrapper requires Mac/cloud. WebView behavior differs by platform. |
| Native Android | Android Studio AVD + physical Android | Android-first products | Emulator acceleration setup can be painful. Real device still required. |
| iOS native | Not locally possible on Windows | — | Use physical iPhone + cloud build/device farm/Mac. |

---

### iOS on Windows: honest options ranked

| Option | Cost | Newbie friendliness | Fidelity | Use when |
|---|---:|---|---|---|
| Expo Go on physical iPhone | iPhone/borrowed device, no Mac | High | Medium | Managed Expo app, no custom native modules |
| EAS/cloud build + physical iPhone/TestFlight | Apple dev fee + build service | Medium | High | Serious Expo/RN iOS testing |
| Cloud CI for Flutter/RN/native iOS | Apple dev fee + CI minutes | Medium | High for builds, lower for interactive debugging | Need signed iOS builds from Windows |
| BrowserStack/Sauce/AWS Device Farm/Firebase Test Lab | Monthly/hourly cost | Medium | High for device checks | Pre-launch compatibility, screenshots, manual smoke tests |
| Mac-in-cloud rental | Hourly/monthly | Low-medium | High | Need Xcode/simulator/debugging temporarily |
| Buy used Mac mini/MacBook | $300–$800+ | Medium | Highest long-term | Serious iOS product |

Do **not** recommend Hackintosh or unofficial iOS simulator hacks.

Also note:

- Microsoft App Center retired; don’t make it the center of a new guide.
- Windows Subsystem for Android was deprecated; don’t rely on it for mobile testing.

---

### Android on Windows: must-teach setup notes

For native Android, Flutter, and React Native:

- Install Android Studio.
- Use Android Studio Device Manager / AVD.
- Enable virtualization in BIOS/UEFI.
- Use Windows Hypervisor Platform / current Android Emulator hypervisor support.
- Prefer x86_64 emulator images with Google Play services when testing Play Billing, FCM, sign-in, etc.
- Keep a physical Android device for performance and hardware testing.

Warn newbies that Intel HAXM-era advice is often stale. Hyper-V/WSL2/Docker/emulator interactions are a common source of pain.

---

### What cannot be validated on PC/emulator

Must test on real devices before launch:

- Push notifications/APNs/FCM behavior.
- Notification permissions and channels.
- Camera, microphone, photos, files.
- GPS/location accuracy.
- Bluetooth, NFC, biometrics, sensors, haptics.
- App links/universal links/deferred deep links.
- In-app purchases/subscriptions/restore purchases.
- Sign in with Apple / Google sign-in.
- App review prompt behavior.
- Low-end performance, memory pressure, thermal behavior.
- Battery drain.
- Background/foreground/killed-app behavior.
- OS permission denial paths.
- Keyboard behavior.
- Safe areas, notches, Dynamic Island, home indicator.
- Font scaling/accessibility.
- Dark mode.
- Offline/bad network.
- Install/update/uninstall/reinstall.
- Release-build minification/proguard/tree-shaking issues.
- iOS Safari/WebView quirks for PWAs.
- Store-distributed build signing/entitlements.

---

### Pre-launch real-device checklist

Minimum checklist before app-store submission:

- [ ] Fresh install from production-like build: TestFlight, Play Internal Testing, EAS build, signed release APK/AAB.
- [ ] Upgrade from previous version if applicable.
- [ ] New-user onboarding.
- [ ] Login/signup/password reset/social login.
- [ ] Anonymous-to-account upgrade if used.
- [ ] Core loop completed successfully.
- [ ] Paywall, purchase, subscription, restore purchase.
- [ ] Push permission requested at point of need.
- [ ] Push received in foreground/background/killed states.
- [ ] Notification tap deep-links correctly.
- [ ] Referral/deep link opens correct screen.
- [ ] Camera/photos/location/microphone permissions and denial paths.
- [ ] Offline mode and server-error handling.
- [ ] Logout and account deletion.
- [ ] Crash reporting and analytics events confirmed.
- [ ] Dark mode, large text, small screen, large screen.
- [ ] Low-end Android performance.
- [ ] Current iPhone/iOS behavior.
- [ ] Release build tested, not only debug build.

---

### Minimum physical-device kit

For a solo founder:

#### If Android-only

- Buy one cheap real Android device early.
- Prefer low/mid-range, not flagship.
- Use emulator for many screen sizes, but physical device for truth.

#### If iOS is part of launch

- Borrow an iPhone for prototype checks.
- Buy a refurbished iPhone before pre-launch if you will iterate on iOS weekly.
- Do not wait until App Store submission.

#### Practical minimum kit

1. **Cheap Android phone** — $80–$200 range, current-ish Android, low/mid RAM.
2. **Refurbished iPhone** — current supported iOS, not an ancient device.
3. Optional after traction: one Samsung device, one small-screen phone, one tablet if relevant.

Timing:

- Android phone: once mobile UI exists.
- iPhone: before implementing push, IAP, deep links, camera, or App Store submission.
- Cloud device farm: pre-launch compatibility sweep, not daily development.

---

### Windows-specific traps that deserve guide space

| Trap | Symptom | Guide advice | Priority |
|---|---|---|---|
| Hyper-V / virtualization disabled | Emulator painfully slow or won’t start | Enable virtualization in BIOS; use current Android Emulator hypervisor/WHPX guidance | High |
| Stale HAXM tutorials | Conflicting emulator setup | Warn that many HAXM guides are obsolete | Medium |
| WSL2 localhost confusion | App cannot reach dev server/API | Explain `localhost`, WSL IP, `10.0.2.2`, LAN IP, tunnels | High |
| Firewall blocks Metro/Expo/Vite | Phone cannot connect to dev server | Allow Node/Java/Expo ports on private network | High |
| USB debugging drivers | Device not visible in `adb devices` | Install OEM drivers, use data cable, enable USB debugging, trust computer | High |
| VPN/corporate Wi-Fi isolation | Expo LAN mode fails | Use Expo tunnel or same trusted Wi-Fi | Medium |
| Android emulator vs host API | API works on PC, fails on emulator | Use `10.0.2.2` for host from Android emulator | High |
| Release build untested | Debug works, release crashes | Always test signed release/internal build | High |
| OneDrive/antivirus/path issues | Watchers/builds flaky | Keep projects in local dev folder, avoid synced paths | Medium |
| WSA confusion | Founder tests on deprecated subsystem | Do not rely on Windows Subsystem for Android | Medium |

### Deliberately leave out

Do not turn this into:

- a full CI/CD guide,
- an advanced Appium/Detox/Maestro automation guide,
- a device-lab procurement guide,
- a Hackintosh guide,
- an exhaustive Android Studio troubleshooting encyclopedia.

Keep it focused on “how do I test my mobile app from a Windows PC without lying to myself?”

---

## Cross-cutting recommendations

### 1. Combine review prompting + referrals?

Yes, combining them into a **Growth loops** guide is sane if the guide is explicit that they are different maturity levels:

- Review prompting = reputation loop; cheap, near-launch, conservative.
- Referrals = acquisition loop; only after retention/value, unless invites are core product infrastructure.

Keep **onboarding separate**. Onboarding is activation, identity, privacy, safety, and data architecture. It touches referrals, but it is not the same lifecycle stage.

Add cross-links:

- Onboarding guide → referral attribution for invited users.
- Growth guide → activation event from analytics/onboarding.
- Growth guide → legal guide for referral terms/rewards.
- Testing guide → deep link/referral/push real-device validation.

---

## Single most expensive mistake per guide

| Guide | Most expensive newbie mistake if silent | One-sentence prevention rule |
|---|---|---|
| Growth loops | Shipping noncompliant sentiment-gated reviews or fraud-prone referral rewards. | **Never route store reviews by sentiment or incentive; use native prompts from behavioral eligibility, and keep referral rewards pending until verified after the refund/abuse window.** |
| Onboarding | Choosing a signup/profile wall that either kills activation or lets unsafe/empty users poison the product. | **Put the wall exactly before the action that needs identity, legal compliance, safety, payment, or durable data—no earlier and no later.** |
| Testing on PC | Launching from emulator/browser testing without a production-like build on real devices. | **If it has not been installed and smoke-tested on real target devices from a release-like build, it has not been tested for launch.** |
