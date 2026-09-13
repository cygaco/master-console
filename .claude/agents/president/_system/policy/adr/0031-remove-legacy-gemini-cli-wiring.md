# ADR 0031 — remove all legacy Gemini-CLI wiring; Gemini-family lab routes through agy only; role defaults to the verifiable floor

**Date:** 2026-07-20
**Status:** accepted
**Class:** B (dispatch/security architecture — provider removal + role reroute + new enforcer)
**Context:** MC 1.0 operator directive ("no more wiring to Google's Gemini anywhere") + the 2026-07-20 no-presupposition agy diagnostic
**Extends:** ADR-0020 (panel lane contract) · ADR-0027 (agy same-user-spawn strategy) · ED-243 (routing/enforcer) · ED-060 · ED-230
**β consult:** DECIDE B/0.90, OPEN_ADR:true, 2026-07-20 (grep-verified both premises; four binding rulings; logged `paths.betaEvents`, reply_to 71775b4e).

---

## Decision

1. **Remove all wiring to the sunset legacy `gemini` CLI** (`@google/gemini-cli` — `IneligibleTierError`, migrate-to-Antigravity ~2026-06-18): the `gemini:` provider block, `GEMINI_API_KEY`/`GOOGLE_API_KEY` injection + gemini OAuth checks, `GEMINI_CLI_TRUST`/`--skip-trust`/`geminiTrustBypass`, `GEMINI_DEFAULT`, the `gemini models list` probe, the legacy `provider==="gemini"` cert-attest probe branch, the `gemini` key in `PROVIDER_FAMILY`, role→`gemini` pins, and gemini fallback rungs.
2. **Reroute the role DEFAULT `gemini`→`openai`** (the verifiable GPT floor), NOT `antigravity`, for `security-reviewer` + `redteam`, in BOTH `providers.js` and `catalog.js` `DEFAULT_PROVIDER_PER_ROLE`. The **binding** security verdict must stay on a **verifiable** lane while ED-230 (served-model proof) is open; agy remains the panel's advisory google-family LAB, never a role's binding default.
3. **Keep the Gemini MODELS served via agy** (`gemini-3.1-pro-high` / "Gemini 3.1 Pro (High)"), the `antigravity` provider, `antigravity:"google"` family, and the google→openai cross-family fallback. The role-registry already migrated `security-reviewer`/`research-lead` to `antigravity` — this ADR removes the *dead CLI*, not the Gemini family.
4. **agy headless tool-permission = scoped read-only allow-list** (grep/cat/ls/find/git-log/diff/show, deny else) + a guard that the agy invocation can NEVER carry `--dangerously-skip-permissions`. If scoped-allow is insufficient, agy stays BLOCKED-ADVISORY (honest 2-family floor). skip-perms is operator territory, never self-granted.
5. **New creep-back enforcer:** a wiring-precise check (extends `scan:model-chain`, ED-243) that fails on legacy-gemini CLI/provider/key wiring but not on gemini model IDs served via agy — backed by a negative fixture per removed form + a positive fixture (no-widen/no-narrow proof).

## Context

The 2026-07-20 diagnostic (operator-prompted) refuted the long-standing "agy blocked on operator login" framing: agy authenticates fine from a subprocess. The real blockers were a stale routing line (role→sunset `gemini` CLI), agy's agentic headless tool-permission wall, and the served-model proof gap. The legacy `gemini` CLI is dead upstream; leaving its wiring in place guarantees `IneligibleTierError` at dispatch time and is dead weight for 1.0.

## Options considered

1. **Reroute the role default to `antigravity` (agy):** REJECTED — puts the binding security verdict on the unverifiable agy lane (ED-230 open), the exact risk SP-20260719-001 + ADR-0027 guard.
2. **Reroute the role default to `openai` (verifiable floor) + agy as advisory panel lab (CHOSEN):** preserves the verifiable-binding invariant; agy contributes adversarial diversity via the panel path only.
3. **Drop the Gemini family entirely (2-family permanent):** REJECTED — contradicts the ratified 3-lab commitment; the Gemini family is retained via agy.

## Why this option won

It satisfies the operator directive (no legacy-gemini CLI wiring) while preserving both ratified invariants: the panel-3lab commitment (agy is the google-family lab) and verifiable-binding (ADR-0027). Removing a dead CLI is pure debt reduction; the reroute-to-floor keeps trust on a verifiable lane.

## Risks & mitigations

- **r1 incomplete clean** → a role/fallback still pinned to the dead CLI → silent `IneligibleTierError`. *Mitigation:* grep-all-forms completeness (the inventory), the creep-back enforcer, and the catalog.js/providers.js sync verify-rider.
- **r2 enforcer over-flags kept model IDs** → false-red. *Mitigation:* key on CLI/provider/key wiring, not the "gemini" substring; the positive fixture proves no-widen.
- **r3 scoped-allow insufficient** → do NOT reach for skip-perms; blocked-advisory is the honest floor; operator decides any arbitrary-execution acceptance.

## Reversal plan

Superseding ADR. If Google revives an individual Gemini CLI tier, a new provider block would be added deliberately — not by un-reverting this. The reroute-to-verifiable-floor is invariant until ED-230 closes.

## GPT cross-check + class-symmetry completion (2026-07-20)

An independent GPT cross-check (gpt-5.6-terra; `runtime/agy-adr-evidence/gpt-check-{coherence,conflict}-result-20260720.json`) found the deep-clean broadened the role-parity shape-route check to `antigravity` (`role-parity-scan.js`) **without** adding the matching `class_derivation` rule — leaving `research-lead` (the sole `{tier:lead, provider:antigravity}` role) to fall to the `{tier:lead}→manager` (Claude-only, in-process) catch-all and trip a role-parity RED. Fix (β DECIDE B/0.88→0.90): added `{tier:lead, provider:antigravity}→cross_provider_consult_lead` (mirrors the openai-lead rule), completing the symmetry. **research-lead stays on the Gemini lab as a cross-provider research consult** (ADR-0016 department model-spread — Growth leads are non-Claude by design); the gemini→antigravity reroute applies to it as a cross-provider role, NOT a demotion to Claude. Regression-locked by a `dispatch-contract.test.js` assertion.

- **Director analog deferred (deliberate, not missed):** the `{tier:director, provider:antigravity}` rule is NOT added — no antigravity director exists today, and the broadened scan self-detects at introduction (a future antigravity director trips role-parity RED, the signal to add the rule then with a real role to test against).
- **point-2 openai-floor caveat (pre-existing, NOT resolved here):** the security-reviewer/redteam role DEFAULT resolves to `antigravity` (registry derivation), not the `openai` literal floor point 2 intends — the floor has no enforcer and is silently overridden. The binding-verdict-on-verifiable-lane invariant still holds in practice (agy is blocked-advisory → the antigravity primary can't serve → the openai/claude passes bind). Pre-existing state (inherited from merged SP-20260719-001), tracked as enforcement debt — NOT claimed resolved.

## References
- Consolidated plan: `_planning/mc-1.0-plan/GEMINI-DEEPCLEAN-AND-AGY-MIGRATION.md`
- Inventory: `runtime/agy-adr-evidence/GEMINI-DEEPCLEAN-INVENTORY-20260720.md`
- β ruling: `paths.betaEvents` 2026-07-20 (DECIDE B/0.90)
- Branch: `sprint/gemini-deepclean-20260720`

---

## AMENDMENT — 2026-07-20 (ED-060 Task #3, Epsilon2): point-4 scoped-allow is STRUCTURALLY ABSENT in agy 1.1.4 → BLOCKED-ADVISORY stands; re-open trigger = agy version bump

Point 4 specified "agy headless tool-permission = scoped read-only allow-list (grep/cat/ls/find/git-log/diff/show,
deny else) … If scoped-allow is insufficient, agy stays BLOCKED-ADVISORY." The ED-060 diagnostic (worktree off
main @bf7b5aa3) establishes the stronger fact: **agy 1.1.4 exposes NO per-tool permission mechanism at all** — the
"scoped read-only allow-list" has nothing to bind to, so the fallback clause resolves to BLOCKED-ADVISORY not
because scoped-allow is *insufficient* but because it is **absent**.

**Evidence (re-checkable):**
- `agy --help` (v1.1.4): the ONLY permission-related flags are `--dangerously-skip-permissions` (Auto-approve ALL —
  forbidden by the `safe-spawn.js#AGY_FORBIDDEN_SKIP_PERM` guard + operator directive), `--sandbox` (terminal
  restrictions — a coarse restrict, not a per-tool allow), and `--mode plan|accept-edits` (execution modes, not an
  allowlist). There is NO `--allowedTools`, NO `--permissions-file`, NO `--permission-mode allowlist`.
- agy settings (`~/.gemini/settings.json`, `~/.gemini/antigravity-cli/settings.json`, `~/.gemini/trustedFolders.json`):
  ONLY folder-trust (`trustedWorkspaces` / `trustedFolders` — already trusting MC). NO `permissions.allow` /
  `allowedTools` schema exists for agy to read.

**Resolution:** the agy AGENTIC headless tool-permission wall stays **BLOCKED-ADVISORY** (the honest 2-family floor,
r3) — no scoped seam to build; NEVER skip-perms; NEVER a manual bypass. This is not a capability regression: the
ED-060 **liveness** serve uses agy `-p` PRINT mode (agy's sole transport, ADR-0023), which does NOT invoke agentic
tools (empirically `-p "PROBE OK."` returns clean, no permission wall), so the liveness close is **DECOUPLED** from
the agentic tool-permission wall — ED-060 (c) does not require (b).

**Re-open trigger (named enforcer, per policy-hygiene):** an **agy version bump** (current `agy --version` = 1.1.4).
If a future agy adds a scoped per-tool permission flag/settings schema, re-open point-4 and wire the scoped
read-only allow-list. Re-checkable at any time: `agy --version` + `agy --help | grep -iE 'allow|permission|tool'`
(non-empty scoped-permission match = the seam now exists = re-open). Until then, point-4's allow-list is
NOT-BUILDABLE-BY-CONSTRUCTION and BLOCKED-ADVISORY is the terminal honest state.

**Do NOT reach for folder-trust as the permission seam (β-binding).** `trustedWorkspaces`/`trustedFolders` is
COARSE (folder-level), the OPPOSITE of point-4's "scoped read-only, deny-else" intent — using it to enable agentic
tools is a BROADER grant than the ADR wanted (a security downgrade dressed as a fix), it is not in point-4's option
set (scoped-allow OR blocked-advisory; skip-perms operator-only), and enabling broader agy arbitrary execution is
explicitly operator territory (r3). Since ED-060 liveness is decoupled via `-p`, there is no forcing function to
solve agentic-permission now.

**NAMED FUTURE OPERATOR DECISION (flag, do not pre-adopt):** if agy AGENTIC tool use ever becomes genuinely
required beyond `-p`, whether to accept folder-trust-scoped agy execution is a **Class C operator security-posture
call**. Surface it then with a real forcing function; never pre-adopt.

### ED-060 HONESTY SPLIT (β load-bearing rider — never-claim-live-from-transport)
A clean `agy -p` return proves the TRANSPORT is reachable and the print path decouples from the agentic wall — a
NEGATIVE/decoupling result. It does NOT prove agy served the CONTRACTED model AUTHENTICATED. With the keyring
EXPIRED (live 19:04Z probe: "not logged into Antigravity" + defaulting-to-CCPA + local-chrome/eval), a current
clean `-p` return is very likely EVAL-MODE output, not an authenticated serve (the SP-719-L2 false-green: a
"serve-proven" artifact whose own `cli_output` said "not logged in / eval mode"). So the ED-060 record SPLITS:
- **(i) closeable NOW, recorded NARROWLY:** `-p` TRANSPORT-reachability + agentic-wall DECOUPLING.
- **(ii) DEFERRED, blocked on operator `agy` login + ED-230:** the REAL served-model proof (`fallback:false`,
  `gemini-3.1-pro-high`, cert-attest GREEN). NEVER folded into "ED-060 done" or "agy live."

**Therefore ED-060 PARTIALLY closes:** (a) routing DONE (ADR-0031), (b) headless-perms RESOLVED-AS-BLOCKED-ADVISORY
(this amendment), (c) real-serve OPEN/DEFERRED. Do NOT mark ED-060 fully closed. panel-3lab activation stays
BLOCKED.

**Enforcer for the split (β):** cert-attest MUST stay FAIL-CLOSED on the eval/default/not-logged-in `cli_output`
tells (verified: `attested:false` at 19:04Z). Never let an `attested` boolean or a self-serving gate edit override
the raw `cli_output` tells (the SP-719-L2 guard) — that is what keeps a future eval-mode `-p` output from being
attested as live.

- β: design-boundary consult to the PERSISTENT Beta → **DECIDE B/0.90** (msg 1c363adf reply, 2026-07-20 ~19:10Z,
  ED-239 route); lead concurs + cleared the commit. Position-stable; verified against point-4/r3 + the
  advisory-lab architecture.
- ED-060 (c) real serve (`-p` → `fallback:false`, contracted model) remains gated on a valid keyring (operator
  interactive `agy` login — ADR-0027 mitigation-3); ED-230 served-model proof stays OPEN.

## AMENDMENT — 2026-07-23 (SP-20260723-005, α ground-truth-verified): the re-open trigger FIRED — agy bumped 1.1.4 → 1.1.5, which HAS a per-tool permission model. The 2026-07-20 "no mechanism / BLOCKED-ADVISORY" read is SUPERSEDED for 1.1.5.

The 2026-07-20 amendment above named the re-open trigger as **an agy version bump**. It fired: `agy --version` = **1.1.5** on the installed binary (2026-07-23), NOT 1.1.4. The stronger claim in that amendment — "agy 1.1.4 exposes NO per-tool permission mechanism at all" — is now STALE; do NOT re-inherit the 1.1.4 read.

**Ground truth (α, verified against the INSTALLED agy 1.1.5, 2026-07-23):** agy 1.1.5 HAS a per-tool permission model — a `settings.json` `{ "permissions": { "allow": [], "deny": [], "ask": [] } }` block with `action(target)` rules (`read_file`/`write_file`/`read_url`/`command`/`unsandboxed`/`mcp`), plus the `--dangerously-skip-permissions` flag (auto-approves all — NEVER use). Proven three ways: the skip-flag (a skip implies permissions to skip); the headless wall denied the specific **command** permission (per-tool); agy's own error points at **`permissions.allow` in `settings.json`** (its own schema); and the official docs (antigravity.google/docs/cli/permissions) describe the model. So the permission model is REAL and agy-referenced — NOT "no mechanism," NOT "agy ignores settings.json," NOT folder-trust-only.

**CORRECTED terminal state (the honest posture, replacing BLOCKED-ADVISORY-no-mechanism):**
- (a) The per-tool permission MODEL EXISTS in agy 1.1.5.
- (b) Whether a scoped `permissions.allow` allow-rule actually ENFORCES headless is **UNVERIFIED** (empirically untested this session). Do NOT rely on it; do NOT add a `permissions` block speculatively until an enforcement probe confirms it.
- (c) Cross-provider REVIEW is UNAFFECTED and works today: the dispatch `-p` PRINT path inlines the review content (toolless) and invokes no agentic tools (ADR-0023), so a normal review needs no permission grant (bounded ~32KB by the safe-spawn CreateProcess cap).
- (d) agy READING files headlessly (needed only for a big diff > ~32KB) would require BOTH a scoped read-only allow-rule AND an enforcement probe — an OPTIONAL operator-machine **Class C** security-posture decision, out of scope until requested. Recommendation when opened: a pure file-reader floor (allow reads, deny writes/destructive); NEVER `--dangerously-skip-permissions`; NEVER folder-trust as the seam.

**New re-open/action trigger:** an empirical **enforcement probe** (does a scoped `permissions.allow` rule actually gate headless tool use?) → THEN, if a big-diff file-read review is wanted, the Class C operator sign-off. Never a speculative permissions block, never a false-posture sign-off before the enforcement probe. The live-doc statement of this is `ANTIGRAVITY.md` §4 (α-ground-truth-corrected 2026-07-23). β's 2026-07-20 "theater" ruling (betaEvents e30a2774) rested on this now-stale premise; β logged an append-only `beta-premise-correction` (outcome held — F6-CONFIG stays deferred; corrected reason = enforcement-unverified, not agy-ignores-it).
