# Agent Dispatch Guide

Canonical rules for dispatching build-chain agents. Loaded as a mandatory
reference by Gamma (γ) and Delta (δ) at startup and surfaced as a
session-start nudge by `scripts/hooks/session-start.js`. The
`dispatch-route-guard` PreToolUse Bash hook enforces the forbidden-pattern
rules below at write-time — violations are blocked before they reach a
shell.

**This guide covers ALL dispatch contexts** — build-chain agents, ad-hoc
cross-provider consults, in-session reviewers, and the orchestrator's
own dispatch decisions. The session-start banner scopes this as
"build-chain"; that is the most common case but NOT the only case.

paths.agentDispatchGuide → `.claude/agents/_system/guides/agent-dispatch-guide.md`

---

## §1 — CLI vs API (the fundamental policy)

**CLI is mandatory for agent dispatch. API is allowed ONLY for provider
capabilities that have no CLI equivalent.**

> *API availability NEVER implies API dispatch.*

**Allowed API uses (whitelist):**
- Deep-research pipeline (`research/deep.md`) — hits OpenAI Responses API
  (`o3-deep-research`/`o4-mini-deep-research`) and Gemini Interactions API
  via `curl`, loading keys from `.env.local` + `~/.gemini/oauth_creds.json`.
  Claude's deep-research leg uses the Agent tool + WebSearch, not API.
- GPT-Pro / API-only models — models with **no CLI** (e.g. `o3-pro`,
  `gpt-5.5-pro`) where the CLI simply does not support them.

**Everything else = CLI.** Cross-provider reviewers, security scans, consults,
gauntlet roles — all dispatched via `dispatch-agent.js` / `dispatch-claude.js`
CLI wrappers, not raw API.

Enforcer: `scripts/dispatch/dispatch-contract.js validate` (report-only, wired
into `/scan:full` Dispatch-shape integrity gate).

---

## §2 — Single safe dispatch path

Every cross-provider build-chain dispatch MUST go through:

```bash
node scripts/dispatch-agent.js <role> <prompt-file>
```

This wrapper:

1. Resolves the role's provider from `manifest.agentProviders` /
   `DEFAULT_AGENT_PROVIDERS`.
2. Acquires a per-provider concurrency slot (`concurrency-lock.js`).
3. Invokes the provider via `runProvider` in `scripts/hooks/lib/providers.js`,
   which applies the Windows-stdin fix (LRN-2026-04-17), captures stderr
   for silent-death telemetry, and emits a completion record.
4. Writes a JSON-shaped lock with `dispatch_id`, `role`, `provider`,
   `model`, `prompt_bytes`, `cmdline_checksum`, `start_time`, `cwd`,
   `pid`.
5. Releases the slot on completion.

### Claude BUILD-CHAIN roles → the bounded wrapper (RI-004 / ED-018)

Claude-routed **build-chain** roles (`builder`, `fixer`, `frontend-builder`,
`backend-builder`, `skeleton-builder`) MUST go through:

```bash
node scripts/dispatch-claude.js <build-role> <prompt-file> --model sonnet -w
```

Why a dedicated wrapper: raw `claude -p --agent builder "$(cat prompt)"` gets
auto-backgrounded by the harness and **silently reaped** — 0 bytes out, NO
completion record, exit code lost to `$(...)`. The reap is invisible
(ED-018): `dispatch-agent.js` bridges only openai/gemini, and raw `claude -p
--agent` writes no record. `dispatch-claude.js` closes this:

1. **Bounds** the inner `claude -p` call with a timeout (`DISPATCH_BUILDER_TIMEOUT_MS`,
   default 20 min) so it returns in time to write a durable record instead of
   being reaped mid-flight.
2. On any reap signal — timeout, spawn failure, **0-byte stdout (even on exit 0
   — the ED-018 signature)**, or non-zero exit — writes a **death record** to
   `.claude/runtime/dispatch-deaths.jsonl` AND exits **non-zero**, so the
   caller's `if [ $? -ne 0 ]` liveness check fires.
3. On success writes a well-formed completion record so `gauntlet-verify` can
   confirm the builder actually ran (add `builder`/`fixer` to its role set as
   the backstop: even if the wrapper itself is reaped, no record → RED).
4. Reuses `dispatch-agent.js`'s canonical telemetry helpers (same ledger,
   `canonicalFile`-anchored, ED-016-safe) and forwards `-w` to claude so the
   worktree isolation is preserved.

The `dispatch-route-guard` hook BLOCKS the raw `claude -p --agent <build-role>`
form, so the wrapper is the only path.

### Builder right-sizing — ≤15-min units, extract-then-write, savepoint per chunk

The bounded wrapper makes a reap LOUD; right-sizing makes it RARE and CHEAP. A
monolith builder that must READ a large surface before it can WRITE spends its
whole window reading and reaps with **zero worktree diff** (measured 2026-07-21:
a ~20-min read-only reap vs 5–9-min chunks after pre-extraction). Size every
build-chain dispatch so the worker WRITES, not reads:

1. **≤15-minute units.** Scope each builder dispatch to a unit that finishes well
   inside `DISPATCH_BUILDER_TIMEOUT_MS` with margin, not racing the clamp. A unit
   that can't fit is too big — split it.
2. **Research / interface-extraction pass BEFORE the first chunk.** Do the reading
   first (yourself, or in a cheap read-only pass) and hand the builder the extracted
   interfaces / signatures / file-map in its prompt, so it writes from a spec
   instead of discovering the surface on the clock. The 20-min read-reap above was
   the builder doing the orchestrator's reading.
3. **Savepoint commit per chunk.** After each chunk lands, commit a savepoint in
   the worktree so a later reap never costs the earlier chunks — chunk + savepoint
   is the ED-018 companion to the loud death record.
4. **On a reap with ZERO worktree diff, NEVER re-fire the monolith.** A zero-diff
   reap is proof the unit was too big to even start writing; an identical retry
   reaps identically (the 540s-clamp determinism — see
   `.claude/agents/_system/guides/teammate-stall-rules.md`). Chunk it + pre-extract,
   then dispatch the smaller unit.
5. **Artifact-first reap verification stays (RI-004).** A reap is diagnosed by the
   completion record + worktree diff, never by narration; a builder that reaped
   AFTER writing real work gets ONE resume-and-finish, not a rebuild.

**Enforcer (debt, ED-257):** unit-sizing + savepoint discipline is behavioral —
nothing asserts a build-chain prompt is a ≤15-min unit or that multi-chunk builds
savepoint per chunk. Candidate: a **`dispatch-claude.js` prompt-size / savepoint
lint** that warns (or, under an enforce env, blocks) when a build-chain prompt
exceeds a size floor implying a >15-min unit, or when a multi-chunk build fires
without per-chunk savepoints. The **prompt-size floor is the write-time firing
part** (load-bearing, deterministic); per-chunk-savepoint detection is harder
(needs cross-dispatch chunk tracking) — its companion signal is a
per-chunk-savepoint field in the completion record, not the prompt lint alone.

### Window budgeting and dead-dispatch triage (S-VLADW1 arc, 2026-08)

Right-sizing above answers *how big*. These four rules answer *what the window is
spent on*, *what to do when it clamps*, and *how to tell the death apart*.

1. **Budget the window by what it will be SPENT on, not by how much there is to
   write.** Any known slow non-writing operation donates the whole window — `npm
   install`, a long test run, and the invisible one: **reading obligations imposed
   in prose** (cite-your-source requirements, "read X before you start"). An
   install is a command you can see; mandatory reading is an obligation you don't.
   Pre-do it conductor-side, give it its own chunk deliberately, or distil it into
   an interface sheet.
2. **Treat every builder dispatch as ONE ~540 s window that WILL clamp.** On a
   clamp: checkpoint-commit whatever landed (in unverified-disclosure form), READ
   the artifacts to derive the VERIFIED gap, mint a completion brief scoped to only
   that gap, redispatch. Never identical-retry a clamp, and never assume the final
   report survived — **stdout dies with the clamp, so the files ARE the report**.
3. **Dead dispatches present IDENTICALLY at the ledger** (no record or a timeout
   row, 0 bytes, no diff). The family — guard **REFUSAL** (pre-spawn, exit 2),
   harness **REAP**, permission **STARVATION** (untrusted workspace; `Ignoring N
   permissions.allow entries` in stderr), **READ-DONATION** (window eaten by
   reading), genuine **SCOPE TIMEOUT**. Only **stderr** separates them, and the
   wrapper writes its pre-flight right-sizing warnings at dispatch time — so read
   **stderr AT DISPATCH**, not only post-mortem. Each member has a different
   remedy; pattern-matching to the wrong one burns a full window proving nothing.
   **Two independent witnesses, never one:** the ledger record and the WORKTREE
   are separate observations, and neither alone classifies a death. `elapsed_ms`
   plus tree state is the discriminator — `540xxx` + uncommitted work = the
   foreground clamp; no ledger row at all = nothing ever spawned; `1200xxx` +
   a committed, clean tree = bound-timeout AFTER the work landed (resume, do not
   rebuild). Read both before naming the family. (S-VLADW1-03 had to separate
   three signatures by hand before any could be diagnosed.)
4. **Completion waiters** — (a) presence ≠ completeness: wrappers pre-create
   out-files at 0 bytes, so gate on NON-EMPTY or a ledger row, never on existence;
   (b) key on the DISPATCH ID, never on a ledger-line-count baseline — positions lag
   and race, identity doesn't; (c) ledger-verify any RELAYED id before arming (a
   relayed identifier is a claim, not a fact); (d) the filter must fire on every
   terminal state, not just success.

**Interface sheets transfer doctrine, not just facts.** A conductor-authored
interface sheet (contracts + `path:line` refs distilled from the conductor's OWN
verified reads) collapses builder read-cost without transferring trust: the builder
keeps the **stop-on-mismatch** obligation, because a drifted sheet is MORE dangerous
than no sheet. Carry the custody/claim-scope rules in the sheet too — a builder that
saw them only through the sheet wrote honest claim-scope into its own file header
unprompted.

**Enforcer:** stderr-at-dispatch and waiter-identity discipline are behavioral here;
the mechanical halves are tracked as **ED-353** (background-lane dispatches must
carry the clamp signal or the wrapper must warn) and **ED-366** (a detector that
enumerates zero candidates must report UNKNOWN, not "clean").

### Non-build Claude roles → raw fallback is allowed

```bash
claude -p --agent <role> [--model <m>] "<prompt-body>"
```

`claude -p --agent` remains the documented fallback for **non-build** Claude
roles (`test-runner`, `visual-review`) and for the review layer
(reviewer/compliance/qa/redteam) when their provider CLI is unavailable —
reap-detection is less load-bearing there, and `claude` is the harness CLI.

---

## §3 — Role → provider routing

Canonical role→provider map. **Source of truth: `DEFAULT_AGENT_PROVIDERS` in
`scripts/hooks/lib/providers.js`** (mirrored by `DEFAULT_PROVIDER_PER_ROLE` in
`scripts/dispatch/catalog.js`); `manifest.agentProviders` overrides per project.
`scripts/checks/dispatch-routing-parity.js` asserts this table and both code maps
agree — keep them in sync.

| Role(s) | Provider | Why |
|---------|----------|-----|
| alpha, beta, gamma, delta | claude | orchestration / judgment |
| builder, fixer, skeleton-builder | claude | code authoring |
| reviewer | openai | gpt-5.5 xhigh — different lens on Claude's output |
| compliance | openai | gpt-5.5 xhigh — cross-provider audit |
| qa | openai | independent failure-mode pass |
| ops-analyst | openai | cross-run synthesis (formerly `learner`) |
| redteam | openai | superseded by `security-reviewer` (antigravity/agy); back-compat FLOOR = openai, the verifiable GPT lane (the individual gemini CLI is SUNSET — deep-clean 2026-07-20) |
| design-lead | openai | gpt-5.5 xhigh — product design/UX/flows (ADR-0007) |
| director-of-product | openai | gpt-5.5 xhigh — product strategy/sequencing/JTBD (E-DISPATCH-PERFECT-001 W2) |
| product-lead | openai | gpt-5.5 high — requirement authoring PRD/stories/AC (operator: GPT writes product requirements) |
| director-of-growth | openai | gpt-5.6-sol high — go-to-market/message judgment (E-DISPATCH-PERFECT-001 W2; DISPATCH.md §8) |
| copy-lead | openai | gpt-5.6-terra xhigh — direct-response copy (DISPATCH.md §8 flip claude→GPT) |
| conversion-lead | openai | gpt-5.6-terra xhigh — conversion copy + landing page (DISPATCH.md §8 flip claude→GPT) |
| marketing-lead | openai | gpt-5.6-terra high — paid media / campaigns / EQ scoring (DISPATCH.md §8 flip claude→GPT) |
| research-lead | antigravity | gemini-3.1-pro-high (agy) — audience research, thinking-on (DISPATCH.md §8 flip claude→antigravity) |
| frontend-reviewer | claude | claude-opus-5 — code-quality review of the Claude FE builder (see CROSS-PROVIDER FALLBACK note below) |
| backend-reviewer | claude | claude-opus-5 — code-quality review of the Claude BE builder (see CROSS-PROVIDER FALLBACK note below) |
| qa-reviewer | claude | claude-opus-5 — traceability + integrity + functional (see CROSS-PROVIDER FALLBACK note below) |
| security-reviewer | antigravity | gemini-3.1-pro-high via agy (Gemini lab; individual gemini CLI sunset) — 3-lab panel: + gpt-5.6-sol hunter + claude-opus-4-8@max in-process hunter + fable-5 planner/judge (ADR-0016; DISPATCH.md §8) |
| cabinet | openai | freeform cross-provider consult / second opinion — NO strict output schema (formerly `advisor`/`consult`) |

> **CROSS-PROVIDER FALLBACK — 2026-08-18, temporary, and it costs something.** codex CLI credits are
> EXHAUSTED and the `openai` provider breaker is tripped for 7 days, so the three code-review lanes
> above are **repinned `openai → claude` / `claude-opus-5`** in the registry, `providers.js` and
> `catalog.js`. This doc row is the fourth surface and is cut over here to match — a repin that lands in
> the code tables but not the doc is the doc-vs-code drift class `dispatch-routing-parity.js` (BC-23)
> exists to catch, and it went red on exactly that gap.
>
> **Name the consequence rather than letting a green gate hide it:** the gauntlet's *corpus diversity*
> is temporarily gone on these three lanes. The independence invariant "no agent judges work it
> authored" still holds — a reviewer is a different agent from the builder — but a Claude reviewer
> reading a Claude builder's output shares the author's blind spots in a way a GPT reviewer did not.
> Treat a clean sweep from these three lanes as **weaker evidence than the same sweep pre-2026-08-18**,
> and say so in any release note that leans on it. `security-reviewer` keeps its non-Claude lane
> (antigravity/gemini), which is now the only cross-family judgment in the gauntlet.
>
> **Reverting:** when codex credits return, clear the breaker (`provider-breaker('openai')`) and repin
> all four surfaces back together — registry, `providers.js`, `catalog.js`, and this row. The other
> `openai` rows above are unchanged because their registry pins are unchanged; the breaker handles
> their runtime fallback without a repin, which is why they do not appear in the parity diff.

> **The GPT product-leadership chain (`design-lead`, `product-lead`, `director-of-product`, `director-of-growth`) is dispatched like a reviewer, NOT like a manager (the door to use).** These are the product/growth judgment + requirement-authoring roles on a non-Claude provider — RULE 4 (operator: GPT is best at product design/UX/flows + product requirements), the deliberate `cross_provider_consult_lead` class (E-DISPATCH-PERFECT-001 W2). So reach each via a subprocess (example shown for design-lead; identical for the other three):
> ```bash
> node scripts/dispatch-agent.js design-lead <prompt-file>
> ```
> **Do NOT** dispatch it via the in-process Agent tool (`Agent(subagent_type:"design-lead")`) or via `epsilon-runtime record-inprocess` — those are for the Claude **in-process** roster only (managers/leads/directors + design-quality/visual-review). `record-inprocess` will refuse it as a route mismatch **by design** (this is the system working, not a bug — ED-055, diagnosed-wrong 2026-06-16). Every other lead/director (quality-lead, the frontend/backend/security leads, etc.) is Claude in-process; the GPT product-leadership chain (design-lead, product-lead, director-of-product, director-of-growth) is the intentional cross-provider set.

Claude is the **fallback** for any non-Claude role on failure (`required-fallback.js`),
not the default for the review layer — cross-provider diversity is the point.

**Cross-provider diversity is mandatory.** Same-model self-review is blind to
shared failure modes. Every gauntlet must include at least one non-Anthropic
reviewer.

> **A cross-family lane is not redundancy — it is the only lane buying a
> different blind spot.** Three consecutive S-VLADW1 gauntlets, three real
> defects that every same-family Claude lane missed — once on code a Claude lane
> had circled, tried to break, and explicitly reported it could not. Treat the
> cross-family lane as load-bearing coverage, not as a spare: dropping it for
> cost, for argv budget, or because the Claude lanes came back clean converts a
> clean sweep into an unmeasured one, and the release note must say so.
>
> **Lane independence is not ceremony either.** In S-VLADW1-04 two lanes that
> never saw each other's work filed the SAME decisive mechanism defect and a
> third filed a different false sentence — the redundancy that looks wasteful
> from the outside is what produced the finding. Do not collapse lanes to save a
> window; cut each lane's scope instead.

**Security runs as a 3-lab panel.** `security-reviewer` (which supersedes `redteam`)
fires the Gemini lab via Antigravity `agy` (primary, corpus-diverse — the individual
`gemini` CLI is SUNSET, so the Gemini lab routes through agy), then a `gpt-5.6-sol`
jailbreak pass, then a `claude-opus-4-8` in-process hunter (last, so it never displaces
the cross-family coverage; ADR-0016). A second GPT pass via the `--provider openai`
override keeps two-model-family coverage if the agy lane is unavailable — the verifiable
GPT floor is where the binding default sits (ADR-0031).

```bash
node scripts/dispatch-agent.js security-reviewer <prompt-file> --provider openai --model gpt-5.6-sol
```

`--provider <claude|openai|gemini>` and `--model <id>` override the manifest
role→provider mapping for any role. When `--provider` differs from the role's
native provider, the role's spec `provider_model` is ignored and `--model` (or
the override provider's default) is used.

---

## §4 — Headless provider setup

| Provider | Auth | Headless notes (auto-handled by `providers.js`) |
|---|---|---|
| **claude** | native harness | none — always available |
| **codex / openai** | `codex login` (OAuth) **or** `OPENAI_API_KEY` in `.env.local` | `--full-auto` is DEPRECATED (≥0.135) — use `--sandbox workspace-write`. `codex exec` is non-interactive; `--ask-for-approval` is interactive-only and `exec` rejects it. |
| **gemini** | `GEMINI_API_KEY` in `~/.gemini/.env` (global) **or** OAuth (`~/.gemini/oauth_creds.json`) | Under `spawnSync` the CLI does not auto-load `~/.gemini/.env` — `providers.js` reads it and injects `GEMINI_API_KEY` into the child env. Headless needs `GEMINI_CLI_TRUST_WORKSPACE=true` (set automatically) or the CLI dies with "not a trusted directory". Default model is `gemini-3.1-pro-preview` (the live default; NOT the old `gemini-2.5-flash`). |

**Key source of truth:** `scripts/dispatch/auth-resolver.js` — checks
`process.env` → `.env.local` → `.env` → `~/.gemini/.env` → OAuth → Codex
stored auth. Returns **source labels only, never values**. Use it; do not
read `process.env.OPENAI_API_KEY` / `GEMINI_API_KEY` directly outside the
resolver.

Two silent dispatch-killers that `providers.js` already handles: gemini auth
code 41 (key not injected into child env) and gemini "untrusted directory"
(`GEMINI_CLI_TRUST_WORKSPACE` missing). Both resolve with zero external env
setup — the key in `~/.gemini/.env` is enough.

**Served-model evidence — a lane is LIVE only when the SERVED model is positively
verified (fail-closed on auth-error markers).** Transport success NEVER proves the
model contract: exit 0 + plausible free-text output are BOTH forgeable by a defaulted
or unauthenticated CLI serving a local/eval model. The 2026-07-18 agy "PROVEN LIVE" was
**retracted mid-session** — the attest had matched the request-echo in the log, not the
served model. Rule: verify the resolved/served-model evidence line positively, and
fail-closed when the log carries auth-error markers. This is the provider-lane twin of the
completion-record false-green (§13 / `[[record-trust-gate]]`). Enforcer landed —
`scripts/checks/cert-attest.js` (positive served-model proof + unauth blocklist + negative
fixtures from real captured log lines); a 2-family gauntlet binding (GPT+Claude) holds until
a real `fallback:false` attested agy record exists. (Learning #124, 2026-07-18/19.)

**agy code payloads go argv-with-guards, not stdin.** agy CLI 1.1.4 has NO stdin /
`--prompt-file` (help-verified), so a code-review payload must ride argv. The `safe-spawn`
value-slot allowlist was carve-out-expanded to permit code-review chars for **that ONE
tool / ONE slot** (shared `INJECT_META`/denylist untouched, NUL universal, `shell:false`).
Positive-scope one-tool-one-slot beats blocking, which would strand the panel-3lab FULL shape;
`shell:false` makes shell-injection structurally absent, so an argv slot with a per-tool char
allowlist is safe. Keep the carve-out narrow + its riders binding —
`scripts/dispatch/safe-spawn.js` (#27). (Learning #133, 2026-07-18/19.)

---

## §5 — Concurrency caps

Provider CLIs aren't all equally happy with parallel calls. Gemini consistently
fails when 15+ calls launch simultaneously — roughly ⅔ of analyses lost in the
run-12 retro. The dispatch-layer slot allocator (`scripts/hooks/lib/concurrency-lock.js`)
is wired into `dispatch-agent.js`. Every cross-provider dispatch acquires a
per-provider slot before invoking the CLI.

**Default caps:**

| Provider | Cap | Env override |
|---|---|---|
| `gemini` | 3 | `GEMINI_MAX_CONCURRENCY` |
| `openai` | 10 | `OPENAI_MAX_CONCURRENCY` |
| `claude` | 32 | `CLAUDE_MAX_CONCURRENCY` |

Slots are file-locks at `.claude/runtime/dispatch-locks/<provider>/`. Stale
locks (>20 min) are auto-pruned so a killed process never permanently leaks a
slot. Smoke test: `node scripts/test-concurrency-lock.js`.

When the cap is hit, callers wait. When the wait exceeds `DISPATCH_SLOT_TIMEOUT_MS`
(default 10 min), the dispatcher returns `fallback: true` so the orchestrator
routes remaining calls to Claude.

**Tuning:**
- `fallback: true` errors citing concurrency-cap-full → raise the cap.
- API rate-limit responses despite the cap → lower the cap.
- Gemini concurrency rejects cleared by an SDK upgrade → bump
  `GEMINI_MAX_CONCURRENCY` to 8 or higher.

---

## §6 — Prompt assembly rules

### Claude-native (builder, fixer, skeleton-builder)

Claude's Agent tool follows `@path` and Read tool calls implicitly inside the
prompt. Still, inline HYGIENE docs, top-N bug patterns, file scope, and the
agent contract directly because re-fetching across many prompts wastes the
prompt cache hit.

### Cross-provider (codex, gemini) — MANDATORY INLINING

Codex/Gemini stdin **cannot** follow file references. Whatever you don't paste
into the prompt body, the agent doesn't see.

Every spec doc, every built file the reviewer needs, must be inlined as:

```
--- BEGIN file: <path> ---
<content>
--- END file ---
```

...blocks before dispatch. Result: prompt sizes of 80–180KB are normal and
expected.

### Prompt size check before dispatch

Always `wc -c <prompt-file>` before dispatch. A 0-byte or near-0-byte prompt
means a compose script failed silently — dispatch it and you get a 1-byte or
empty output (the auth-failure / maxTurns-at-zero signature).

### Brief content contract — a brief is a claim surface

Size and inlining are §6's *shape* rules. These are its *truth* rules. An
unrefusable brief converts the author's error into shipped code, so:

1. **Attach a proof line to every premise.** No brief asserts "X is missing",
   "X is required", "X does not exist", or names a working directory / repo path
   without an attached `grep`/read/`ls` output that the dispatcher actually ran.
   A premise written from belief is the single cheapest way to spend a whole
   dispatch cycle. (**ED-362** — proof-attached premises; **ED-363** — a brief
   must not assert a cwd the dispatcher does not establish.)
2. **Builders may REFUSE a premise with evidence — say so in the brief.** Give
   every builder standing permission to halt and return a refutation instead of
   building against a false premise. In S-VLADW1-04 three builders refused a
   conductor premise (a `grep` refuting "zero executable uses", a proof that the
   paragraph it was told to bind atomically was not bound at all, a halt on a
   wrong-cwd brief) and were right all three times. A refusal returned in ten
   minutes is cheaper than a bundle built on a false sentence.
3. **Name the lane's OWN prior failure mode in its brief.** Add a DISPATCH NOTE
   naming the specific way *that* lane failed before, with an explicit instruction
   to cut scope rather than run out of room before emitting its envelope. Three
   lane-runs were lost to truncated mid-thought returns across two gauntlets;
   after each brief named that failure, all three returned JSON on first dispatch.
4. **Do not pre-list a residual as a "ceiling" to the lane assessing it** — that
   primes silence and the lane's verdict stops being an independent assessment.
   Name ceilings to the *other* lanes, or to β after the independent pass.

---

## §7 — Forbidden patterns

Blocked by `scripts/hooks/dispatch-route-guard.js` (PreToolUse, Bash matcher):

| Pattern | Why forbidden |
|---|---|
| `codex exec …` (not under `node scripts/dispatch-agent.js`) | Re-triggers Windows-stdin failure (LRN-2026-04-17), bypasses concurrency lock |
| `gemini … -p …` (not under the wrapper) | Same — also misses `--skip-trust` handling and JSON envelope unwrap |
| `claude -p …` without `--agent <role>` | Raw `-p` prompt path bypasses the documented agent contract |
| `claude -p --agent <build-role>` (builder/fixer/`*-builder`/skeleton-builder) not under `node scripts/dispatch-claude.js` | Silently REAPS — 0 bytes, no completion record, exit lost (RI-004/ED-018). Use the bounded wrapper. |
| `cat <file> \| (codex \| gemini \| claude)` | Piping prompt into provider stdin is the exact binding-gap failure mode (LRN-2026-04-30) |
| Raw `curl`/`fetch`/SDK call to `api.openai.com` or `generativelanguage.googleapis.com` outside allowlisted wrappers | API-when-CLI-is-available violation (§1) |

## §8 — Always allowed (the guard never blocks these)

- `codex --version`, `gemini --version`, `claude --version` — version probes.
- `gemini --help`, `gemini models list`, `gemini auth status` — read-only inspections.
- `node scripts/dispatch-agent.js <role> <prompt-file>` — the canonical cross-provider wrapper.
- `node scripts/dispatch-claude.js <build-role> <prompt-file> -w` — the bounded Claude build-chain wrapper (RI-004/ED-018).
- `claude -p --agent <role> …` — documented Claude fallback for **non-build** roles only (build roles are blocked; see §7).
- Any command running under `MC_PROVIDER_PROBE=1` — one-shot health probe escape hatch (the bypass is logged via `lib/logger`).

---

## §9 — In-process Agent dispatch — the context-lever (§2.5 + ED-021)

The in-process **Agent tool** dumps the *full* sub-agent response into the
**orchestrator's** context. Two contracts govern it (both in `dispatch-route-guard.js`,
on the `Agent` tool branch):

| Case | Rule | Strength |
|---|---|---|
| Agent dispatch of a **build-chain role** (`subagent_type` ∈ builders/fixers/skeleton-builder) | **BLOCKED** — use `node scripts/dispatch-claude.js <role> <prompt-file> -w`. The Agent tool dumps 50-100K tokens into the orchestrator AND lacks the wrapper's reap-safety (RI-004/§2.5). Spec/doc authoring via `general-purpose` is fine; a Lead fanning out its OWN sub-reviewers is exempt. | hard block |
| Agent dispatch whose prompt runs a **heavy aggregate/verify/research skill** (`/scan:full`, `/research:deep`, `/redteam:full`, `/qa:audit`, big synthesis) **without a lean-return request** | **ADVISORY (ED-021)** — instruct the sub-agent to WRITE its full output to a file and RETURN ONE short verdict envelope ("≤8 lines: PASS/FAIL + counts + the file path"), don't return the full aggregation. | non-blocking warning |

**The lean-return contract (ED-021):** run heavy skills via a dispatched sub-agent
that returns an **envelope, not content** — the orchestrator holds envelopes, not
the tens-of-thousands-of-tokens of sub-output (memory:
`feedback-orchestrator-holds-envelopes-not-content`). The advisory is suppressed
when the prompt already asks for a lean / envelope / write-file-then-summarize
return.

### ε conduct routes (ADR-0014 — ED-041 retired)

ED-041 ("Agent is not available inside subagents") is **retired as a per-spec misstatement**
(ADR-0014): a Claude subagent has the Agent tool **iff its spec lists it**, and ε's does. So a
**teammate-spawned ε** (via `Agent(subagent_type:"epsilon")`) CAN call the Agent tool and summons
the in-process roster directly — the conduct route is the **same in both contexts**:

| Work | Route |
|------|-------|
| Build-chain (builders/fixers) | `node scripts/dispatch-claude.js <role> <prompt-file> -w` |
| Cross-provider (reviewers/security) | `node scripts/dispatch-agent.js <role> <prompt-file>` |
| Non-build Claude roles (test-runner) | `claude -p --agent <role> < "$PROMPT_FILE"` |
| In-process roster (managers/leads/design-quality/visual-review) | **`Agent(subagent_type:<role>, …)` — supply a `scopeContract`** (the `scope-contract-guard` is the real gate; for a read-only consult, a non-empty `forbiddenFiles` = writes-nothing). The node RUNTIME still returns `spawned:false, reason:requires-orchestrator` (a node SCRIPT can't call Agent) — that hands the spawn to **the ε-agent** (you), not α |

The **spawn-hand stays with the conductor**: a summoned roster consult must NOT dispatch the build
chain or cascade — ε is the sole builder-dispatcher (enforced structurally by
`scripts/checks/consult-roster-no-dispatch.js` + the `dispatch-route-guard` in-process build-chain
block). (See §9.5 for the in-process-vs-OS-subprocess lane model; the two sections agree — §9.5's
"in-process subagents have their own context" is the *why*, this table is the *how*.)

**Fire-and-poll dispatch (WG-6):** a teammate-ε must NEVER go idle with an outstanding **OS
subprocess** (dispatch-claude.js / dispatch-agent.js) — the harness does NOT re-wake a teammate when
a background process completes (an in-process Agent-tool spawn returns to you directly, a different
lane — §9.5). Observed as 25-minute stalls (WG-6 ×3). The fix is not "block foreground only" but
**fire-and-poll**: fire the work, then actively POLL a durable signal in the SAME turn — the signal
board (`scripts/teams/signal-board.js wait <topic>`) for teammate rulings, or the completion ledger
(`gauntlet-verify`) for dispatched-worker returns (absence of an `ok:true` record IS the death
signal). Bound every poll; a long dispatch is not dead before the 540s clamp + margin — check for the
late-landing artifact before writing a lane off. Canonical doctrine:
`.claude/agents/_system/guides/teammate-stall-rules.md`; ε-spec projection:
`.claude/agents/president/epsilon.md` TEAMMATE STALL RULES.

---

## §9.5 — Orchestration doctrine: in-process subagents vs OS subprocesses (E-TEAMS-MIGRATION-001)

MC dispatch runs across **two distinct lanes**. Conflating them is the root of a recurring
class of confusion ("are ε/β subprocesses?", "why did the dispatch vanish?"). Know which lane you
are in before you dispatch.

| | **In-process subagents** (Agent tool) | **OS subprocesses** (Bash → wrapper) |
|---|---|---|
| Spawned by | `Agent(subagent_type:…, run_in_background:true)` | `node scripts/dispatch-claude.js` / `dispatch-agent.js` |
| Who | α/ε/β/γ/δ + the roster (directors/leads/builders-as-teammates), reviewers via `general-purpose` | the provider CLIs: `claude` / `codex` / `gemini` |
| Lives in | the harness; its OWN separate context window | a separate OS process tree |
| Talks via | `SendMessage` (to a name or `team-lead`) | stdout/exit-code → a completion record on the ledger |
| Reaped by | the harness (maxTurns) — leaves a member entry in the session team config | the harness reaping the *wrapper* can ORPHAN the grandchild CLI (ED-039/RI-004) |
| Cleanup | session-scoped — torn down with the session | `pruneDeadLocks` (lock file) + `reap-orphans.js` (the orphaned PROCESS) |

### Teams are IMPLICIT + session-scoped (Claude Code v2.1.178, 2026-06-15)

`TeamCreate` / `TeamDelete` were **removed**. You no longer create a team — the **first named
background subagent you spawn implicitly creates the session team**, and the harness still writes
`~/.claude/teams/<session>/config.json` with a `members[]` array as agents join. Consequences:

- **Spawn a teammate** = `Agent(subagent_type:"…", name:"…", run_in_background:true)`. `SendMessage`
  is unchanged. Nesting is allowed up to **5 levels deep**.
- **The team is named `session-<uuid>`, NOT `<slug>-<mode>`.** Any logic that scoped a team to a
  project by its NAME slug is now dead — scope by **member `cwd`** instead (the harness records each
  member's `cwd`; `scripts/teams/lifecycle.js#teamBelongsToProject` + `team-guard.js#isProjectScopedTeam`
  do this). A name-only slug match silently fails to find your own team.
- **No cross-session persistence.** `/resume` does not restore teammates (the task list persists). Re-spawn the team each session.
- The `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env flag is **phasing out** and is no longer required.

### Sharing context without bloating it — pull, don't push

Every in-process subagent has its **own** context window; its reasoning never enters yours. So:

- **Push the question, let the agent pull the facts.** Send a lean consult (scope + question +
  constraints, ~15 lines); the subagent Read/Greps its own detail. Only its lean **verdict envelope**
  returns to you. ("Orchestrator holds envelopes, not content" — §13 + ED-021.)
- **Heavy work → write-file-then-envelope.** A sub-agent running a heavy skill writes its full output
  to a file and returns ≤8 lines (verdict + counts + path). The Agent tool otherwise dumps 50–100K
  tokens of sub-output into your context (the §9 hard rule for build-chain roles).
- **Turn cost is asymmetric.** For the *subagent*, work happens in its isolated context (free to you).
  For *you*, each message you send/receive adds only its **text** to your history — so the parallel-subagent
  model is MORE context-efficient than doing it all inline, provided you keep returns lean. The real
  cost is coordination round-trips — batch consults, reserve the team for genuine judgment boundaries.

### Orphaned-subprocess hygiene

When the harness reaps a `dispatch-*.js` wrapper, the OS can leave the grandchild provider CLI
running with no completion record (holding a model session + slot + memory). `pruneDeadLocks`
clears the dead **lock file**; `node scripts/dispatch/reap-orphans.js` finds + (with `--apply`)
SIGTERM-terminates the orphaned **process** — conservative-by-construction (signature + PPID-orphan
+ age + no-live-lock + not-own-tree; any ambiguity ⇒ skip) and fail-open. It runs report-only on
session start and is surfaced in `/mc:health` §12.5.

---

## §10 — Worktree isolation (build-chain only)

Builders and fixers run in `.worktrees/wt-<feature>`. Reviewers are read-only and do not need an
isolation worktree — **but read-only is not cwd-agnostic; see §10.1.**

### §10.1 — Two cwd traps, both confirmed live 2026-09-13 (S-OS-06)

Read this before dispatching any builder with `-w`, or any reviewer at all.

**Trap 1 — `-w` does NOT cut from HEAD.** The manual `git worktree add … HEAD` pattern below does;
the wrapper's `-w` flag does not. `scripts/hooks/create-worktree-from-head.js` — the hook that would
make it — is `enabled: false` with `registrations: []` in `framework/hooks.registry.json`, so the
CLI cuts the worktree from the sprint BASE (`origin/main`). Harmless for an additive ticket whose
new files merge cleanly; **fatal for any ticket that must READ prior in-sprint work** — a builder
lands in a tree where the earlier tickets' code simply is not there, then stops cleanly on the
missing prerequisite and reports `ok:true` with zero work done (the false-green of ED-427).

> Pre-create the worktree at the head and pass it explicitly:
> `git worktree add <path> -b <branch> <head>` then dispatch with `--worktree <path>`.
> Verify before trusting: the worktree's HEAD must equal the branch head you intended.

Policy row: **ED-381** (isolation worktree must be cut from current HEAD — 3 instances).
Disabled-enforcer row: **ED-433**.

**Trap 2 — an in-process Agent-tool reviewer inherits the SESSION cwd.** It does *not* pick up a
worktree path named in its brief; naming the path in prose changes nothing. On 2026-09-13 a
`backend-reviewer` spawned via the Agent tool read the main tree, reviewed pre-fix code, and
returned a correct FAIL *on what it could see* — which was the wrong tree. It then PASSed at 98 on
the merged head.

> Either (a) review AFTER the fix merges to the branch the session is sitting on, or (b) pass the
> worktree's ABSOLUTE path and require the reviewer to `git -C <path>` every command.
> **Never override such a FAIL** — a verdict from the wrong tree is not a false positive to be
> waived, it is an unevaluated lane. Re-run it on the merged head and keep that verdict.

Row: **ED-429**. This is the in-process sibling of ED-363 (which covers the CLI-wrapper lane only —
its named enforcer cannot reach an Agent-tool spawn, because there is no wrapper to inject cwd).

**Related transport trap — the gemini/`agy` argv ceiling.** The route assembles the whole prompt into
argv and BLOCKS (does not truncate) above ~32,000 assembled characters. A ~30KB gate file plus its
brief exceeds it, so a mandatory Gemini-corpus security pass over large gate files cannot run inline
at all and must be replaced by a stdin-capable route (GPT/codex) with the corpus residual stated
explicitly in the release consult. File-heavy review of gates needs a file-handle transport, not
inline packets. Row: **ED-430**. (The ceiling is on ASSEMBLED argv — file + brief + instructions —
not on the file alone; do not size-check the file and conclude you are under it.)

### Builder pattern

```bash
WT_DIR=".worktrees/wt-${feature}"
[ -d "$WT_DIR" ] && git worktree remove --force "$WT_DIR"
git worktree prune
git worktree add -B "agent/${feature}" "$WT_DIR" HEAD
cd "$WT_DIR"
# raw `claude -p --agent builder` is guard-BLOCKED (RI-004) — use the bounded wrapper
node scripts/dispatch-claude.js builder prompt.txt --model sonnet > output.json 2>&1
```

The `-B` force-resets `agent/<feature>`. Old commits remain reachable from
prior branch history; only the branch label moves.

### Fixer pattern

Same as builder but creates a fresh `agent/<feature>-fix-<N>` branch.

### Continuation pattern (for maxTurns recovery)

When a builder hits maxTurns mid-feature:

1. Detect: `wc -c <feature>-output.json` < 100B + uncommitted changes in worktree.
2. Commit partial work to `agent/<feature>`.
3. **Re-create worktree from `agent/<feature>`** (NOT HEAD):
   `git worktree add .worktrees/wt-<feature> agent/<feature>`. This preserves
   the partial commit.
4. Compose a continuation prompt listing already-done files and remaining files.
5. Re-dispatch.

### Integration pattern — verify before merge, never blind-merge a flagged worktree

When an isolation-worktree builder reports a **stale-base / odd-base signal**, do
NOT merge its branch. Instead: (1) **diff its output vs canonical** and confirm the
change is ADDITIVE — original logic and ids intact; (2) **run its tests against the
CANONICAL tree** (`CLAUDE_PROJECT_DIR=<canonical>`), not against the worktree that
produced them; (3) spot-read the subtle logic yourself; (4) **apply the file(s)
yourself**. Precedent: a backend-builder flagged that its worktree HEAD predated the
validator; its +671-line extension was clean, but it was verified-then-applied
(20/20 live + 55/55 selftest on canonical) rather than merged from a messy branch.
(Learning `L-2026-06-06-worktree-builder-verify-before-merge`.)

**When multiple chunks or builders touch ONE test file**, the brief must say
**APPEND, DO NOT REWRITE**, and the integration check must assert the **suite count
never shrinks** — a suite that shrinks while staying green is the quietest
regression available, because dropped tests read as passing.

---

## §11 — Identity gating (subtle bug class)

When hooks check agent role names (e.g., for team-guard), use **exact-match-after-normalize**,
never substring:

```js
// WRONG — name.includes('beta') matches 'rocket-beta'
if (name.includes('beta')) { ... }

// RIGHT
const normalized = name.toLowerCase().trim();
if (normalized === 'beta') { ... }
```

Same applies to feature-name matching in dispatch hooks.

---

## §12 — Thinking models — tool_choice constraint

For Claude 4.x adaptive-thinking models (opus-4-8, sonnet-4-6 with effort),
`tool_choice` must be `auto` or `none`. `any` and specific-tool requests
return HTTP 400. This affects multi-agent dispatchers — if you're constraining
tools, do it at the agent-spec level (`disallowedTools`), not via API params.

---

## §13 — Output handling — keep the orchestrator lean

Every dispatch writes to `.claude/runtime/dispatch/<role-or-feature>-output.json`.
The orchestrator should:

1. **Check size first**: `wc -c <file>`. A 1-byte output means the agent never
   produced an envelope (typically maxTurns hit or auth failure).
2. **Don't tail or cat the full output**. Use `head -c 300` if you need to peek.
3. **Run aggregation via Node script** — never reconstruct status by reading raw
   envelopes inline.

### JSON envelope contract

Every build-chain agent ends its output with a fenced JSON block:

```json
{
  "status": "built" | "fixed" | "isolation-violation" | "...",
  "feature": "<name>",
  "branch": "agent/<feature>",
  "files_modified": ["..."],
  "commit_sha": "...",
  "typecheck_clean": true,
  "notes": "<brief, ≤500 chars>"
}
```

`parseProviderJson` extracts the **last** ```json fence in the response. Any
narrative before it is "prose-leak" — logged as a warning but the envelope
still parses.

### Review / lane envelopes — the negative-space fields

A reviewer envelope that reports only what it FOUND is half an envelope. Every
review or gauntlet lane (cross-provider or in-process) additionally emits, per
lane and per finding:

| Field | Scope | Why |
|---|---|---|
| `what_i_could_not_assess` | lane | Names the questions the lane could not answer. Silence on a question is otherwise indistinguishable from a clean result. |
| `files_i_could_not_see` | lane | Read-scope limits (excerpt-fed cross-provider lanes, argv-capped payloads). A "clean" verdict is scoped to what was in the window. |
| `execution_proven` | finding | `true` only when the lane RAN something that observed the defect. Belief-derived findings are still worth filing — mislabelled ones are not. |
| `what_would_confirm_or_refute` | finding | The exact command that settles it. |

**Conductor obligations** (the fields are worthless unread):

- A finding from a read-scope-limited lane must be **verified against the full
  file** before it is graded or briefed as a fix, and `files_i_could_not_see`
  must be reconciled against every finding touching or adjacent to those regions.
- A lane that names its own blind spots and supplies its refuting command is
  worth more than one that is merely right: in S-VLADW1-04 the cross-family lane
  filed two HIGHs from a false Unicode belief, marked both `execution_proven:false`
  and supplied the refuting line — cost, two commands instead of a fix bundle.
- **Never aggregate lane silence into a claim.** "Every lane said so" is a
  coverage claim about the lanes; count the envelopes that actually said it.
- Enumerating zero candidates is **UNKNOWN**, not "clean" (**ED-366**).

**Enforcer:** behavioral at the envelope; the conductor-side halves are **ED-362**
(verify a read-scope-limited finding at source) and **ED-364** (no shipped claim
without its attack).

---

## §14 — Why this matters (precedent)

- **LRN-2026-04-17** — codex CLI on Windows died with 0 bytes output when
  prompted via `cat foo.txt | codex exec ...`. Fix lived inside
  `runProvider` (Node `spawnSync` with `input:` instead of cmd.exe pipe).
- **LRN-2026-04-30** — phase-1 and phase-2 review agents bypassed
  `runProvider` and called `cat prompt | codex exec` directly from Bash.
  The original bug re-appeared 13 days later — both phases lost ~5
  minutes per agent to silent zero-byte deaths.
- **RI-004 / ED-018** — Claude builder dispatch via raw `claude -p --agent
  builder` was auto-backgrounded by the harness and silently reaped: 0 bytes,
  no completion record, no error. `dispatch-agent.js` refuses Claude roles and
  `claude -p --agent` writes no record, so the reap was invisible — it bit
  twice in one session (Alpha had to build foreground). Fix: the bounded
  `scripts/dispatch-claude.js` wrapper makes the reap LOUD (death record +
  non-zero exit), backed by `gauntlet-verify` treating a no-record builder as
  RED. Same lib-only-fix lesson: paired with the route-guard (build roles can't
  go raw) and this contract rule.
- The lesson: lib-only fixes don't protect against bypassing callers.
  This guide + the dispatch-route guard hook + the agent-spec rule are
  the three layers that close the bypass.

---

## §15 — Telemetry artifacts

Each successful dispatch appends a line to:

- `.claude/runtime/dispatch-completions.jsonl` — completion record.

Each silent zero-byte exit appends to:

- `.claude/runtime/dispatch-deaths.jsonl` — for post-mortem.

Each concurrency slot is a JSON file under
`.claude/runtime/dispatch-locks/<provider>/`. `scripts/dispatch/prune-dead-locks.js`
prunes locks whose owning PID is dead; the session-start hook runs the
pruner once per cold start.

---

## §16 — Mandatory reads before dispatch

Gamma and Delta MUST consult this file at startup. Alpha consults it before
any cross-provider or build-chain dispatch — not just build-chain (the §1
CLI-vs-API policy + §9 in-process rules apply to consults and ad-hoc reviewers
too). The session-start hook injects a compact reference into `additionalContext`
on every cold start.

---

## §16.9 — Shape-door self-detection (W2-core, `MC_SHAPE_DOOR`)

Every dispatch entry point consults the LIVE shape resolver
(`scripts/dispatch/dispatch-shape.js#shapeDoor`) at spawn — the ONE shared gate so a
role routed through the WRONG wrapper self-detects on a REAL dispatch. Shipped report-only,
then RAMPED per-wrapper. **The 3 agent wrappers — `dispatch-agent`, `dispatch-claude`, and
`epsilon-runtime` CLAUDE_RAW — now ENFORCE by default** (the W2/N2 per-wrapper flip, landed
2026-06-16, dual-lane cross-family gauntlet-green: GPT-5.5 backend-reviewer + qa-reviewer PASS
on the fixed diff; the backend lane caught 4 real issues first — fail-open-not-preserved,
report-vs-legacy precedence, weak per-wrapper kill, missing tests — all fixed + regression-locked).
`dispatch-skill` stays report-pinned (below). **Safe-by-construction:** enforce REFUSES only a
high-severity mismatch, and a legitimate agent dispatch resolves `proven:true` + the matching
shape → never refused; a FAIL-OPEN resolution (contract unavailable/unreadable) is treated as
UNKNOWN, not unproven, so a contract-read hiccup can never become a dispatch outage (see Severity
model). Advisory noise is stderr-only — not yet persisted (**ED-059**).

**Toggles** (read from the process env):

| Var | Values | Effect |
|---|---|---|
| `MC_SHAPE_DOOR` | `report` \| `enforce` | The shape-enforce authority. Default `report` (advisory only). `enforce` REFUSES a high-severity mismatch (exit **2**, named reason). |
| `MC_DISABLE_SHAPE_DOOR` | `1`/`true`/`yes` | **ULTIMATE KILL-SWITCH** — forces report fleet-wide, beats everything. Set this if the door ever false-refuses in production, then file the planted-test gap. |
| `MC_SHAPE_DOOR=report` | (explicit) | **FLEET KILL** — forces report on every wrapper; beats the per-wrapper flip AND the legacy `block` alias (gauntlet-fixed precedence). |
| `MC_SHAPE_DOOR_DISPATCH_AGENT` · `_DISPATCH_CLAUDE` · `_EPSILON` | `report` | **PER-WRAPPER KILL** — force-report (via `reportOnlyPin`) just that one flipped wrapper, leaving the others enforcing. Beats a global `enforce`. |
| `MC_DISPATCH_CONTRACT_ENFORCE` | `block` | DEPRECATED alias → enforce, back-compat only. An explicit `MC_SHAPE_DOOR=report` BEATS it. |

**The four entry points:**

- `dispatch-claude.js` (subprocess-claude), `dispatch-agent.js` (subprocess-cross-provider),
  and `epsilon-runtime.js`'s **CLAUDE_RAW** path (raw `claude -p --agent`) ride the enforce
  ramp normally. (epsilon's `DISPATCH_AGENT`/`DISPATCH_CLAUDE` routes do NOT consult — they
  shell to the already-doored wrappers; doubling the consult would risk a divergent verdict.)
- `dispatch-skill.js` is PINNED **report-only** (`reportOnlyPin:true`): the resolver NOW HAS a
  `subprocess-skill` shape (**ED-057**, built 2026-06-16 — added to `SHAPES` + `resolveSkill`
  returns it for an EARNED skill, distinct from build-chain `subprocess-claude`). But the pin
  LIFT is gated on the §13.6/§13.7 earn-it loop stamping the heavy-by-design skills
  (scan:full/research:deep/…) — until they're stamped, an enforce gate would false-refuse them.
  Wave-D earn-it lifts the pin.

**Severity model.** The door REFUSES only a **high-severity** mismatch (an unproven unit
dispatched as a subprocess, or a build-chain role dispatched in-process). A **medium**
mismatch (wrong wrapper, but not dangerous) stays advisory even under `enforce` — a deliberate
conservative default that keeps false-refusal risk near zero. For the subprocess wrappers with
agent roles (always proven) that means the enforce flip surfaces wrong-wrapper routing as
advisories without bricking working dispatches; the exit-2 refusal fires only on the genuinely
dangerous cases. The sanctioned `--review-fallback` lane (FIX-A3) proceeds in BOTH modes — the
door honors the sanctioned-lane VERDICT (not the bare flag).

`exit 2` = the shape-DOOR refusal; `exit 1` = the separate contract-consult block — kept
distinguishable so a post-mortem names WHICH gate fired. (E-DISPATCH-SHAPE-001 W2-core,
SP-20260616-001.)

---

## §17 — Cross-references

- `.claude/agents/president/gamma.md` — Gamma dispatch rules (cites this guide).
- `.claude/agents/president/delta.md` — Delta dispatch rules (cites this guide).
- `.claude/agents/president/alpha.md` — Alpha dispatch rules (pointer to this guide).
- `scripts/dispatch-agent.js` — the canonical cross-provider wrapper.
- `scripts/dispatch-claude.js` — the bounded Claude build-chain wrapper (RI-004/ED-018).
- `scripts/dispatch/dispatch-claude.test.js` — torture test.
- `scripts/dispatch/auth-resolver.js` — shared key-source resolver (N-3).
- `scripts/dispatch/safe-spawn.js` — trusted tool-path + allowlist safety kernel.
- `scripts/dispatch/dispatch-contract.js` — machine-readable dispatch shape rules.
- `scripts/dispatch/dispatch-shape.js` — `resolveShape`/`shapeMismatch`/`shapeDoor` (the shape decision spine + the W2-core report→enforce door; see §16.9).
- `scripts/dispatch/coverage-gate.js` — N-1 liveness gate (run-ledger).
- `scripts/hooks/lib/providers.js` — `runProvider` implementation.
- `scripts/hooks/dispatch-route-guard.js` — PreToolUse enforcement.
- `scripts/hooks/lib/concurrency-lock.js` — slot allocator + telemetry.
- `scripts/dispatch/prune-dead-locks.js` — eager dead-PID pruner.
