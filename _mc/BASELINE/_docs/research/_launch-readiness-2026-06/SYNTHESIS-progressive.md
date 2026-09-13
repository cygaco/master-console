# Progressive Deep-Research — Final Synthesis vs. Current Materials (2026-06)

> **What this is:** the final synthesis of three *progressive 4-phase* `o3-deep-research` reports (deeper than the single-call `deep-research-security-o3.md` this dir already holds) against the **already-expanded** launch materials — `_guides/SECURITY_GUIDE.md` (471 lines), the 9 `_knowledge/security/*` refs (each with §6 PASS/FAIL agent rules), and the prior `gpt55pro-security-expansion.md` fold-in. The materials went through single-call deep research → GPT-5.5-Pro expert review → fold-in already, so this pass is **selective**: find what's *genuinely* net-new, confirm the rest checks out.
>
> **Provenance (verbatim, beside this file):** `deep-research-security-hardening-o3-progressive.md`, `deep-research-security-best-practices-o3-progressive.md`, `deep-research-vibe-pwns-o3-progressive.md`.

---

## (a) Highest-value cross-cutting findings

Across all three progressive reports, four themes recur with the strongest evidence:

1. **Human factors and configuration beat code bugs.** DBIR 2022/2023: **~74–82% of breaches involve the "human element"** (stolen creds, phishing, misconfig, error), and "stolen credentials" is the **top action in web-app breaches (~86%)** — not XSS/SQLi. CIS's Community Defense Model: implementing the prioritized CIS Controls mitigates **~83% of MITRE ATT&CK techniques**, and the basic **IG1 "essential cyber hygiene"** tier alone covers the top attack patterns. Australia's ACSC: the "Top 4" basics blocked **~85%** of targeted attacks. The leverage is lopsided toward a handful of identity/config controls.

2. **Secure-by-default is still a myth you must override.** Every "I got pwned" story traces to a default left unflipped — Supabase RLS off on SQL-created tables, public buckets, "9 Google Cloud safeguards off by default," Firebase test-mode rules. The vibe-pwns report's contrarian take: *don't trust defaults; assume every security feature is off until you flip it.*

3. **Denial-of-wallet is now a top-2 real-world pwn, and provider budgets don't save you.** Confirmed 2026 incidents: $82,314 Gemini bill in 48h (facing bankruptcy), $18k despite a $7 budget (Google auto-upgraded the billing tier past the cap without notice), $15k "destroyed my startup," $1.3M autonomous-loop burn. Root cause: a **single Google API key silently becomes a full-power Gemini credential** when the service is enabled, and provider budget *alerts* are not *hard caps*.

4. **Prompt injection is unsolved; damage is bounded by tool permissions, not prompt wording.** All three reports converge: no reliable fix exists (Willison, OpenAI, NCSC); indirect/second-order injection via RAG/docs/DB rows is the hard frontier; the only real mitigation is least-privilege tools + sandbox + human-in-loop, so a successful injection can't reach anything irreversible.

The distinctive contribution of the **best-practices report** is that it *ranks* controls by real-world leverage (CIS IG1 / NIST SSDF / ASVS-L1 / DBIR-KEV evidence) rather than listing them flat — see (d).

---

## (b) Net-new vs. current materials — ruthless cut

The materials are already remarkably complete: phishing-resistant MFA/passkeys, slopsquatting + dependency min-age/cooldown, DNS-rebinding/metadata SSRF, denial-of-wallet caps + kill switch, CI/CD + GitHub-Actions hardening, storage/RAG/vector tenant isolation, service-role-bypasses-RLS, webhook raw-body signature + idempotency, file-upload-beyond-magic-bytes, backups/restore-test/audit-logs/IR runbook, mobile binary/keystore/deep-link, security.txt — **all present.** Only the items below are genuinely *not yet* in the guide / knowledge refs / GPT-5.5-Pro review.

| # | Net-new item | Why it matters | Belongs in | 1-line draft addition / rule |
|---|---|---|---|---|
| 1 | **Prioritize by real-world leverage — a "if you only do 5 things" frame.** The materials are a flat (excellent) checklist; they never tell a newbie *what to do first*. The best-practices report's core thesis — **80%+ of breaches are stolen creds / phishing / misconfig, not code bugs** (DBIR), so admin MFA + RLS/bucket lockdown + no-client-secrets + rate/spend caps + backups beat polishing CSP — is absent as explicit ordering. | `SECURITY_GUIDE.md` (a short "Start here: the 5 highest-leverage locks" callout near the top; currently leverage appears only as one buried Gotcha line). | "Most apps aren't pwned by clever code exploits — **80%+ of real breaches are stolen passwords, phishing, or a default left open** (Verizon DBIR). If you do nothing else, do these five first: (1) admin/founder MFA, (2) RLS + private buckets, (3) no secrets in the client/git, (4) rate + hard spend caps on paid APIs, (5) tested backups." |
| 2 | **Provider budget *alerts* ≠ *hard caps*; one cloud key can become a full-power AI key.** §3 has per-user quotas + a kill switch, but not the *specific* 2026 lesson: Google auto-upgraded a billing tier past a $7 budget, and a Maps-style key turned into a Gemini credential when the service was enabled. | `SECURITY_GUIDE.md` §3 / `API_LIMITS_GUIDE.md` / `RATE_LIMITING_AND_ABUSE.md` §6. | "A cloud **budget is an alert, not a brake** — providers have charged thousands past a cap. Set a **provider-side hard cap** if one exists, **restrict each API key to only the service + referrer/IP it needs** (a generic Google key can silently become a paid Gemini key), and keep your own kill switch — don't rely on the provider to stop the bleed." |
| 3 | **"Enabling RLS denies-all and *will* break legit access until policies exist" — staging-first, never 'fix' it with service_role.** The GPT-5.5-Pro *correction* captured this nuance and it **is** in the shipped `SECURITY_GUIDE.md` §1 (verified) — so this is **confirmed, not net-new.** (Listed here only to record the check.) | — (already in §1) | — |
| 4 | **Fail-closed limiter / auth-check on outage.** Reports stress fail-safe design: if the rate-limiter (Redis) or an authz check is *down*, costly/sensitive routes must **deny**, not run unmetered. `RATE-15` WARN exists in the knowledge ref, but the guide proper doesn't state the principle. | `SECURITY_GUIDE.md` §3 (one line). | "If your rate-limiter or auth check **errors or times out, fail *closed*** — deny the costly/sensitive request rather than letting it through unmetered. An outage shouldn't become an open tap." |

Everything else the progressive reports raise (SSRF/DNS-rebinding, deserialization/XXE, mass-assignment, zip-bombs, OAuth state/PKCE, CSRF-vs-CORS, supply-chain/SLSA/SBOM, secure cookies, segmentation, WAF, VDP/pentest, AI guardrails/sandboxing) is **already covered** in the guide or the §6 PASS/FAIL rules.

---

## (c) Confirmed (already covered) — the rest checks out

The progressive reports **broadly corroborate** the shipped materials with no factual contradictions. Spot-verified as present: RLS-off-by-default + service_role `BYPASSRLS` + service-role-routes-must-re-authz; storage/Firebase/vector/RAG tenant isolation + negative tests; secret hygiene + `NEXT_PUBLIC_`/`VITE_`/`EXPO_PUBLIC_` are public + rotate-don't-delete; gitleaks/TruffleHog/push-protection; OWASP LLM01/05/06/07/10 + indirect injection + least-power tools + human-in-loop; account-based login lockout + CAPTCHA + MFA ~99.9%; phishing-resistant passkeys/WebAuthn over SMS; reset-token single-use/short-lived/hashed; OAuth state/nonce/PKCE/exact-redirect; sessions rotate + HttpOnly/Secure/SameSite; Argon2id/bcrypt; Zod/Pydantic schema + body-size + allowlist; parameterized queries; output-encoding-primary + strict-CSP-backup; file-upload magic-bytes + AV/transcode + SVG/PDF active-content + zip-bomb + private storage + download headers; webhook raw-body signature + stale-reject + idempotency + never-trust-client-price/tier; CI/CD branch-protection + SHA-pinned Actions + read-only token + no-secrets-to-fork-PRs + OIDC deploy; slopsquatting + lockfile + `npm ci` + Dependabot/min-age; security headers + cookies + CSRF + CORS allowlist; backups/PITR + tested restore + audit logs + human alerts + log redaction + incident runbook + security.txt; mobile no-secrets-in-binary + Keychain/Keystore + deep-link/WebView. The "name over code" OWASP-ID guidance (avoid drifting A0x numbers) is honored throughout.

---

## (d) Prioritized-framework guidance (the best-practices report's distinctive lens)

The best-practices report explicitly ranks controls by **risk-reduction per unit effort**, grounded in evidence the materials cite but never rank:

- **CIS Critical Controls v8.1 → IG1 ("essential cyber hygiene")** = the small-team must-do tier (asset inventory, MFA, secure config, patching). CIS CDM: full controls mitigate **~83% of ATT&CK techniques**; IG1 alone covers the top patterns.
- **NIST SSDF (SP 800-218)** = the secure-SDLC baseline (threat modeling PW.3, SAST PW.8, SBOM/SCA, secret rotation PO.5, CI security gates PO.8) — now a US federal supplier requirement.
- **OWASP ASVS L1 / MASVS** = the app/mobile verification checklist *beyond* the Top-10 awareness list (the Top-10 is explicitly a "bare-minimum baseline," not a program).
- **Verizon DBIR + CISA KEV** = the "what actually prevents breaches" evidence: human element ~74–82%; stolen creds the #1 web-app action; attackers overwhelmingly exploit **known, already-patched** CVEs (KEV) — so **MFA + rapid patching of KEV-listed bugs** is the highest-leverage spend.
- **MITRE ATT&CK** = map each control to a real attacker technique so coverage isn't guessed.

**The materials do not yet rank controls by this real-world leverage** — they're an (excellent) flat checklist. The single highest-value final edit is item (b)(1): a short "start-here, highest-leverage-first" frame at the top of `SECURITY_GUIDE.md`, justified by the DBIR/CIS-IG1 evidence. The frameworks themselves (CIS/SSDF/ASVS/ATT&CK) are background scaffolding, not newbie-facing content — keep them out of the guide prose; they belong, at most, as a one-line "for the pros" pointer.

---

*Synthesized 2026-06-07 from the three verbatim progressive reports in this directory. Bottom line: the materials are already strong and internally consistent with the deepest available research — only a handful of small, targeted edits (above) are worth making, the largest being a leverage-ordered "start here" frame.*
