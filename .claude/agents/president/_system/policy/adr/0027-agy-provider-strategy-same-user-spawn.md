# ADR 0027 — agy provider strategy: same-user safe-spawn subprocess (no SDK/API exception; 2-family floor holds until a real-path serve)

**Date:** 2026-07-19
**Status:** accepted
**Class:** B (provider strategy — affects the panel-3lab 1.0 exit, dispatch architecture, and the CLI-vs-API rule)
**Context sprint:** SP-20260719-001 (Lane 2, agy id-mapping — parked at R2-FAIL) · resolves the ED-060 strategy question raised by DUMP.md 2026-07-19 #2
**Relates to:** ADR-0020 (panel lane contract) · ADR-0022 (claude-hunter producer) · ADR-0023 (agy `-p` transport carve-out) · ADR-0025 (attestation origin-proof) · ED-060 · ED-230
**β consult:** DECIDE B/0.88, OPEN_ADR:true, 2026-07-19 (~22:25Z), four binding riders (logged `paths.betaEvents`); α-endorsed. Precedent: SP-719-L2 consult-8 architectural close (B/0.90) + consult-4 false-green block (0.94).

---

## Decision

**agy dispatch = same-user subprocess spawn through the existing safe-spawn kernel (Option B); the Antigravity SDK/API exception (Option A) is dead; the panel-2family floor (Option C) stays the honest interim until Option B's ED-060 close criteria land through the REAL dispatch path.**

Production capture contract: reply TEXT from the piped stdout (proven under Node `spawnSync`, `shell:false`) + serve EVIDENCE from the DEFAULT cli.log delta (rotation-aware; **never** `--log-file`, which breaks keyring auth). agy 1.1.4 offers no output-file/JSON flag — stdout + default cli.log are the only channels.

## Context — what changed (evidence 2026-07-19)

DUMP.md 2026-07-19 framed agy headless auth as an **upstream hard blocker** (GitHub #479 file-token write-only; #88 Windows token not persisted; Credential-Manager-bound-to-interactive-logon mechanism) and proposed choosing between an SDK exception, a spawn spike, or accepting agy-down. Two independent authed runs today refute the **auth-wall mechanism** on native Windows:

1. **12:38 PDT** (print-mode, SP-719 worktree): keyring token loaded (`expired=false`), OAuth authenticated as the operator, "Gemini 3.1 Pro (High)" resolved post-auth, `streamGenerateContent` ran. (`runtime/agy-adr-evidence/EVIDENCE-20260719.md`)
2. **22:16Z spike** (sanctioned route: `node scripts/checks/cert-attest.js --model "Gemini 3.1 Pro (High)" --provider antigravity --json` → `safeSpawnSync`, `shell:false`): genuine keyring auth in a subprocess, requested model resolved + bound post-auth, real round-trip to `daily-cloudcode-pa.googleapis.com` (2 ResponseIDs), reply TEXT (`PROBE OK.`, 10 bytes) captured on the pipe. (`runtime/agy-adr-evidence/SPIKE-20260719.md`; verdict artifact `runtime/cert-attest/gemini-3.1-pro-(high)-2026-07-19T22-16-11-295Z.json`)

Load-bearing corrections to the prior framing:

- **GitHub #76 (non-TTY stdout drop) does NOT manifest on MC's actual transport.** The Node `spawnSync` pipe captured stdout in both runs. Whether #76 bites a raw bash pipe is untested and moot — raw agy dispatch is guard-blocked anyway.
- **GitHub #479 is a Linux-container-without-keyring failure mode, not native Windows.** Auth is per-USER (Windows keyring/DPAPI + `~/.gemini/oauth_creds.json`); there is no per-folder auth artifact; a same-user subprocess CAN read it (proven twice).
- **`GEMINI_API_KEY`/env-var auth is a confirmed-dead upstream seam** (staff, 2026-06-29). Nobody builds it (standing anti-instruction, unchanged).

## Options considered

1. **Option A — Antigravity SDK/API exception ADR:** dead, over-determined. The CLI-vs-API rule permits API only where **no CLI equivalent exists**; a CLI that authenticates and streams from a subprocess demonstrably exists, and the API path would add a new metered seam. A fails the tech-introduction bar independent of option ordering.
2. **Option B — same-user spawn via the existing safe-spawn transport (CHOSEN):** zero new seams; reuses the kernel ADR-0023 already relies on (`shell:false`, native-exe, arg-allowlist, discrete-argv `-p`); reproducible today.
3. **Option C — accept agy-down, keep the 2-family floor:** retained as the **interim floor**, not the strategy. It remains the fail-safe if B's close criteria stay unreachable.

## Decision criteria

| Criterion | A (SDK exception) | B (safe-spawn) | C (floor only) |
|---|---|---|---|
| Simplicity | low (new SDK seam) | high (existing kernel) | high |
| Reversibility | medium | high | high |
| Reliability | unknown (unproven seam) | high (2 reproduced runs) | high but capability-losing |
| Use-what-we-have | fails | exactly | partial |
| Rule coherence (CLI-vs-API) | **violates** | conforms | conforms |

## The four binding β riders (non-optional — they are what makes B honest)

1. **Spike scope is precisely bounded.** The 22:16 spike is **auth-wall-refutation + transport-reproducibility evidence ONLY** (pid-local stdout + a real backend round-trip a cross-pid fake can't forge). It is **NOT an ED-060-close artifact and NOT a clean serve**. Its `attested:true` came from the KNOWN-UNSOUND canonical GATE slice (the exact thing Lane-2 #16/#18 hardens) — **that boolean must not be cited anywhere.**
2. **The spike's own log FAILS the hardened gate — recorded as the teeth-check.** The cli.log carries `expired=true` + eval-mode + local-chrome + resolved-via-default terminal tells; Lane-2's hardened served-model gate, applied to THIS log, correctly REJECTS it. That is proof the gate is not a rubber stamp, not a contradiction. The "keyring auto-refreshed the expired token" narrative is **evidence-FAVORED but OPEN** (no refresh-to-new-expiry line in the excerpt); it is validated only by the real post-login serve — never enshrined as settled fact.
3. **ED-060 close criteria (consult-8 ratification rider, verbatim):** ONE real security-reviewer serve through the REAL dispatch path (`dispatch-agent.js`/providers — NOT the cert-attest probe), post-operator-login, proving: keyring VALID (not `expired=true`) + NO terminal-fallback tell + real output + a `fallback:false` completion record — AND the served-MODEL identity derived from the operator's authenticated ACCOUNT CONFIG, never a backend-label name-match in the record reader either (else the banned client-echo relocates from cert-attest to the reader). The 07-18 and 19-11 artifacts remain the committed NEGATIVE fixture set; no positive fixture exists yet.
4. **The floor holds hard.** Until Lane-2 merges: canonical cert-attest stays HONEST-CEILING FAIL-CLOSED on agy self-attestation; the support-matrix stays 2-family; **no "3-lab green" input may draw on the spike or the canonical gate's `attested:true`.**

**Durable distinction (β):** the spike refutes the narrower **AUTH-WALL** claim only. It does **not** overturn consult-8's "agy has never genuinely served the contracted model **with a verified served-model attestation**." Auth-refuted ≠ serve-clean.

## Risks

1. The request-side ceiling (agy logs a request-side backend-bind, no response-side served-model id) gets mistaken downstream for full served-proof.
2. The canonical GATE-1 unsound slice stays live until Lane-2 merges.
3. The keyring-auto-refresh assumption is false and the real serve hits an expired-token failure.

## Mitigations (1:1)

1. Riders 1–4 above + Lane-2's hardened gate; attestation semantics recorded here as "request-bind + authenticated-round-trip" with the ceiling NAMED.
2. Lane-2's fix items (#16 done, #18 in scope) are exactly that hardening; floor rider 4 keeps the unsound slice out of any binding verdict meanwhile.
3. Close criteria REQUIRE a valid keyring; on failure, surface the operator re-login seam (one interactive `agy` login) and continue — an availability seam, not a strategy change.

## Enforcers (named, per policy-hygiene)

- **Floor rider (4):** the existing fail-closed attestLane/support-matrix mechanics (2-family), plus Lane-2's hardened gate at merge. Violation = a 3-lab-green claim without the rider-3 record; caught by gauntlet-verify's `fallback:false` correlation + the panel gate.
- **Close criteria (3):** gauntlet-verify record correlation (real `fallback:false` completion record on the ledger) + the Lane-2 served-model gate; the negative fixture set (07-18, 19-11) is REQUIRED-PRESENT.
- **"Never cite the spike's `attested:true`" (1):** behavioral until Lane-2 merges — tracked inside ED-060 (not a new ED); the hardened gate structurally supersedes the unsound slice at merge.

## Reversal plan

If upstream agy adds a response-side served-model identifier, rider-3's account-config derivation can be simplified (revisit, don't auto-loosen). If upstream removes `--print` or breaks keyring subprocess reads, B degrades to C automatically (the floor is fail-safe by construction — no action required to stay honest). Cost of reversal: one ADR supersession; no code unwinding beyond Lane-2's provider wiring.

## References

- Evidence: `runtime/agy-adr-evidence/EVIDENCE-20260719.md` · `runtime/agy-adr-evidence/SPIKE-20260719.md` · `runtime/cert-attest/gemini-3.1-pro-(high)-2026-07-19T22-16-11-295Z.json`
- Research (superseded framing, kept for the upstream-issue map): `runtime/cert-attest/agy-auth-research-20260719.md`
- β verdict: `paths.betaEvents` 2026-07-19 provider-strategy consult (DECIDE B/0.88)
- Prior canon: ADR-0020/0022/0023/0025 · memory `project_gemini_dispatch_headless_fix.md` (Corrections 1→3) · DUMP.md 2026-07-19 #2 (the question this answers)
