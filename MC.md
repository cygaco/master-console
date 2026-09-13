# MC.md — upstream framework gap register

> The durable channel that carries **framework/tooling-layer gaps** to MC canonical so
> they get fixed once, for everyone. Produced by `/warp:flag`; consumed by `/warp:reconcile`.
> MC sync is one-way (canonical → product); this register is how the *gap* travels upstream.
>
> Installed MC version: **0.14.0** (source: `.claude/framework-installed.json#installedVersion`).
> This file lives in canonical itself — entries here are self-flagged framework capability gaps
> discovered while building the framework.

**Severity legend:** `H` blocks a subsystem/command · `M` friction / partial failure · `L` polish / latent.
**Status legend:** Local = state in THIS repo (`fixed-local`/`open`/`worked-around`) · Upstream = state in canonical (`open`/`escalated`/`fixed-canonical`).

## Summary

| ID | Severity | Subsystem | Symptom | Local | Upstream |
|---|---|---|---|---|---|
| WG-1 | M | scaffold | `bootstrap:spinup --where android\|ios\|desktop-*` scaffolds the web/PWA baseline only — no native scaffold | worked-around | open |
| WG-2 | H | research/dispatch | `/research:deep` is unrunnable as-written in the Claude Code harness (foreground `sleep` + `node -e` fs-writes + sub-agent file-writes are all blocked) | worked-around | open |
| WG-3 | M | research | `/research:deep` Phase 0 checks model *access* but not account *credit/quota* — a depleted key passes Phase 0 then fails async (`insufficient_quota` / 429) | worked-around | open |

---

## WG-1 — No native app scaffold for `--where android|ios|desktop-pc|desktop-mac`

- **Layer:** framework (`scripts/scaffold/app.js` + the `bootstrap:spinup` `setup` step).
- **ID:** WG-1
- **Severity:** M
- **Subsystem:** scaffold
- **Symptom:** `bootstrap:spinup` accepts `--where android|ios|web|desktop-pc|desktop-mac` (MC-PROMPT §3), but `scripts/scaffold/app.js` only knows the Next.js + Tailwind v4 + shadcn/ui web baseline. For a native target the `setup` step scaffolds the **web/PWA baseline**, records the requested target honestly in the brief + `data.platform`, and logs a note — but there is no native (React Native / Expo / Tauri / Electron) scaffold. A web app is never presented as native (verify-before-claim holds).
- **Root cause:** `scripts/scaffold/app.js` — no platform-conditional scaffold path; `scaffoldApp()` emits the web baseline unconditionally. The `setup` step (`scripts/bootstrap/phases/setup.js` `resolvePlatform` / `NATIVE_PLATFORMS`) records the target and routes all targets to the web baseline by design (v1).
- **Local status:** worked-around — web/PWA baseline for all targets, target recorded honestly, native-packaging epic added to ROADMAP (`E-NATIVE-PACKAGING-001`).
- **Upstream status:** open.
- **Recommended upstream fix:** add platform-conditional scaffolds to `scripts/scaffold/app.js` — Expo/React Native for `android|ios`, Tauri (or Electron) for `desktop-pc|desktop-mac` — gated by `--where`, with the `setup` step selecting the scaffold by platform. Until then the web/PWA baseline + native-packaging epic is the honest v1.
- **Verify-in-canonical hint:** `grep -n "NATIVE_PLATFORMS\|platform" scripts/scaffold/app.js` — if `scaffoldApp` still emits only the web baseline regardless of platform, the gap REPRODUCES. `node scripts/bootstrap/spinup-orchestrate.js setup --where ios --name X --what Y --who Z --repo-root <tmp> --json` shows `data.platform: "ios"` with the web scaffold (recorded, not native).

---

## WG-2 — `/research:deep` is unrunnable as-written in the Claude Code harness

- **Layer:** framework (`.claude/commands/research/deep.md` — the Phase-2 engine bash blocks).
- **ID:** WG-2
- **Severity:** H
- **Subsystem:** research / dispatch
- **Symptom:** `/research:deep`'s documented execution path cannot complete in the Claude Code harness because it relies on three patterns the harness/framework **deliberately forbid — each guard is intentional and well-reasoned, NOT a bug:** (1) foreground **`sleep`** (`sleep 15`/`sleep 90`) in the OpenAI/Gemini poll loops — blocked because a foreground sleep idles the whole turn; the sanctioned pattern is **background execution + completion notification** (`run_in_background`) or a Monitor/until-loop. (2) **`node -e "...fs.writeFileSync..."`** to build payload/report files — blocked by `scripts/hooks/merge-guard.js` ("Blocks dangerous Bash commands that bypass other hooks") because an inline `node -e` write **bypasses the Edit/Write ownership hooks** (manifest tracking, path/purity/framework guards); the sanctioned escape hatch is a **standalone `scripts/<name>.js`** (a reviewable, tracked artifact). (3) the Claude engine dispatches a **sub-agent to WRITE its own report file**, but background/default sub-agents are denied disk writes — the design is that a sub-agent returns its **product as text** and the accountable **parent persists it** via the governed Write path (or a worktree-isolated builder writes), so there is one accountable writer and no racy shared-tree mutations. So the skill is not "broken by the harness" — it reaches for the exact three shortcuts these guards exist to prevent (merge-guard's own log notes the `node -e` reflex fired **45× in 3 days**).
- **Root cause:** `research/deep.md` predates / does not respect these guards — its Phase-2 bash was written with the forbidden shortcuts (foreground `sleep`, inline `node -e` fs-writes, sub-agent tree-writes) instead of the sanctioned compliant patterns (background + notify, standalone script, return-text-parent-persists). The gap is the **skill being out of compliance**, not the guards.
- **Local status:** worked-around — wrote a self-contained background runner (`runtime/research/deep-run.js`) that (a) drives the OpenAI Deep Research API with **internal async polling** (`await sleep()` inside node, no bash `sleep`), (b) does **all fs writes inside the standalone script** (the no-inline-fs-write guard exempts `node scripts/<name>.js`), (c) does not rely on a sub-agent to write files. Run via `node <runner>` with `run_in_background:true`; the parent reads the emitted report files on completion. NOTE: the poll must also tolerate transient non-JSON gateway responses (o3 polls occasionally return `"upstream connect error…"`); abandoning the job on one bad poll loses an in-flight (billable) run — the runner now treats non-JSON polls as retry, not failure.
- **Upstream status:** open.
- **Recommended upstream fix:** bring the skill **into compliance** with the guards — do NOT weaken them. Ship a standalone `scripts/research/deep-run.js` (satisfies merge-guard's standalone-script escape hatch) that (a) polls via **internal async** (satisfies the no-foreground-sleep rule → background + notify), (b) writes all payloads/reports **inside the script** (no `node -e` side-channel; tolerate transient non-JSON gateway polls), and (c) has the Claude engine **return text the parent persists** via the Write tool (satisfies the single-accountable-writer rule — no sub-agent tree-write). `deep.md` then just invokes the script with `run_in_background`. The local workaround (`runtime/research/deep-run.js`) already follows exactly these compliant patterns and is a usable starting point.
- **Verify-in-canonical hint:** `grep -nE "sleep [0-9]+|node -e .*writeFileSync" .claude/commands/research/deep.md` — both patterns are present and both are blocked by the Claude Code harness. The Claude-engine step also instructs a sub-agent to write `claude-report.md`, which a background/default sub-agent cannot do.

## WG-3 — `/research:deep` Phase 0 verifies model access but not account credit/quota

- **Layer:** framework (`.claude/commands/research/deep.md` — Phase 0 prerequisites check).
- **ID:** WG-3
- **Severity:** M
- **Subsystem:** research
- **Symptom:** Phase 0 confirms the deep-research models are listed in `GET /v1/models` (org-verified) but does NOT confirm the account has spendable credit. A depleted-but-valid key passes Phase 0; the deep-research job is then accepted (HTTP 200, `status:queued`) and fails **asynchronously** on the first poll with `insufficient_quota` — wasting the launch. Same class for Gemini (HTTP 429 "prepayment credits are depleted" only at submit). Observed this session: a valid, org-verified OpenAI key whose account was out of credits (even `gpt-4o-mini` → `insufficient_quota`); a freshly-funded key then worked.
- **Root cause:** the Phase 0 probe (`curl /v1/models | filter deep-research | count`) conflates "model is visible to the org" with "model is runnable for this account right now."
- **Local status:** worked-around — added a cheap pre-flight (a 5-token `gpt-4o-mini` call) before the long run; only launch deep research if it returns 200, otherwise report "account out of credits — top up billing" and skip.
- **Upstream status:** open.
- **Recommended upstream fix:** Phase 0 should add a tiny billable test call per provider (cheap model, ≤5 tokens) and classify the result: `insufficient_quota`/429-credits ⇒ "engine unavailable — top up billing at the provider," distinct from "key missing." This turns an async mid-run failure into a clear up-front skip with an actionable message.
- **Verify-in-canonical hint:** with a depleted key, `curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $K" | grep deep-research` still lists the models, but a real submit→poll returns `status:failed, error.code:insufficient_quota`; `/research:deep` Phase 0 currently treats "models listed" as ready.

## WG-4 — `/portfolio:new` scaffolds `Write(path)` permission rules the harness does not honor for file tools

- **Layer:** framework (`/portfolio:new` product-repo template → the scaffolded `.claude/settings.json` in every new product repo).
- **ID:** WG-4
- **Severity:** L
- **Subsystem:** portfolio
- **Symptom:** A build-chain agent dispatched into a freshly-scaffolded product repo emits harness warnings that the `Write(...)` allow-rules in the repo's `.claude/settings.json` are not matched for file tools — the honored form is `Edit(path)`. Observed 2026-08-04 in the `vlad` product repo during S-VLADW1-01: a completed builder run wrote 1227 bytes of stderr consisting **only** of these warnings. The rules are simply inert, so the effect is noise rather than breakage — but it is noise **on the exact channel used to distinguish dispatch-failure classes**.
- **Root cause:** the scaffold template declares file-write permissions using `Write(path)` syntax; the harness matches file-tool permissions under `Edit(path)`. Every repo created by `/portfolio:new` inherits the mismatch, so it is a template defect rather than a per-repo one.
- **Why it is worth fixing despite being benign:** stderr is the **only** signal separating three dispatch-death classes that are otherwise identical at the completion ledger (no record / no bytes / no diff) — **refusal** (guard rejects pre-spawn), **reap** (harness kills the wrapper), and **starvation** (process alive, permissions ignored, burns the clamp waiting on approvals that cannot arrive). This session, reading stderr twice prevented acting on a wrong-but-plausible diagnosis. Predictable benign noise on that channel raises the cost of the one read that matters, and trains readers to skim it.
- **Local status:** not worked around — recorded only. The warnings are inert and the builder writes correctly; suppressing them locally would defeat the point above.
- **Upstream status:** open.
- **Recommended upstream fix:** change the `/portfolio:new` settings template to emit `Edit(path)` for file-write permissions (keeping `Write(...)` only where the harness genuinely honors it), and add a scaffold-time assertion that the rendered `.claude/settings.json` produces no permission-syntax warnings on a trivial dispatch.
- **Verify-in-canonical hint:** scaffold a repo with `/portfolio:new`, dispatch any build-chain role into it via `scripts/dispatch-claude.js --worktree`, and read stderr: the `Write(...)` rules are reported as unmatched for file tools while the write itself succeeds.
