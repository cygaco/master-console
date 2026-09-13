---
description: "From 'just MC' to something on screen — one in-project command: setup (deterministic create+scaffold+intake) → canon (degrade-proof AI synthesis) → roadmap (epics + sprints) → paint (core loop serves). Step-driven, idempotent, resumable. The idea→screen on-ramp."
user-invocable: true
---

# /bootstrap:spinup — Idea → on screen, one step-driven command

The single in-project on-ramp. Run it inside a project that has MC installed
(scaffolded via `/portfolio:new`, or a manual `/mc:setup`) and it takes you
from a bare framework to: **canonical product docs + a roadmap organized into
epics & sprints + the core loop running on screen.** One command; the steps below
are positional subcommands, not separate skills.

> **Two entry points, one implementation.** `bootstrap:spinup` is the real
> implementation (runs in the current project). From MC, `portfolio:spinup
> <slug>` is a thin wrapper that dispatches this skill into the chosen product
> via `portfolio:run`, forwarding the positional `<step>` + modifiers verbatim.
> Both reach the same result.

## Input — positional `<step>` subcommand (like `git commit`)

```
/bootstrap:spinup [<step>] [--clone <competitor-name|url>]
                  [--name <n>] [--what <w>] [--who <c>]
                  [--where android|ios|web|desktop-pc|desktop-mac]
                  [--research simple|deep] [--research-in <findings.json>]
                  [--allow-needs-input <field>]... [--repo-root <path>] [--resume] [--json]
```

- **`<step>` ∈ `{ setup, canon, roadmap, paint }`** — a positional SUBCOMMAND.
  Omitted ⇒ the full chain `setup → canon → roadmap → paint`. (`--phase <step>`
  is accepted as a back-compat alias.)
- **`--clone <target>`** — a MODIFIER on `setup`: derive intent from a competitor
  instead of structured args. Produces the clone doc under `_docs/clones/<slug>/`
  (kept) and feeds it into the same on-ramp.
- **`--name/--what/--who`** — structured intake captured by `setup` into the
  INTENT/brief artifact (raw → intent; canon synthesizes the substance).
- **`--where`** — the platform target (§3). v1 scaffolds the web/PWA baseline for
  every target and records the target honestly; native packaging is a follow-on epic.
- **`--resume`** — continue a partially-completed on-ramp from its last step.

## Pipeline (idea → on screen)

```
spinup [setup → canon → roadmap → paint]
  → 1. setup    DETERMINISTIC: create + platform-aware app scaffold + register +
                capture raw intake (--name/--what/--who/--where, or --clone) into the
                INTENT/brief ONLY + /scan:install preflight gate. (reuses portfolio:new)
  → 2. canon    AI SYNTHESIS (anti-degrade): scaffold _requirements/00-canonical/* then
                an AI synthesizes every thin field; fail-closed canon-no-unfilled-tokens gate.
  → 3. roadmap  roadmap:create — EPICS + sprints (core-loop first).
  → 4. paint    execute Epic-1's first sprint until the core loop SERVES (verify-before-claim).
```

<!-- guide-anchor:DEV_SETUP anchor:spinup:preflight shape:checklist -->
> ⏱️ **Day-zero launch guide — DEV_SETUP (start the slow clocks NOW):** the moment you begin, fire off the long-lead developer-account signups — see [`_guides/DEV_SETUP_GUIDE.md`](../../../_guides/DEV_SETUP_GUIDE.md). Apple ~2d payment+verify, Google Play identity review + 12-tester / 14-day closed test, D-U-N-S days–weeks. The setup is cheap; the *waiting* is the cost — so start the waiting early. (Surfaced here by `/guides:integrate`.)
<!-- guide-anchor:API_LIMITS anchor:spinup:preflight shape:checklist -->
> ⏱️ **Day-zero launch guide — API_LIMITS (the limits ramp over time too):** third-party API usage tiers (OpenAI/AI, email, SMS, Stripe) rise gradually with account age + verified spend — money alone won't unlock them — so you can't just launch on a provider's API and serve unlimited users on day one. See [`_guides/API_LIMITS_GUIDE.md`](../../../_guides/API_LIMITS_GUIDE.md): start climbing tiers + request increases early, and architect for the ceiling (per-user quotas, backoff, fallback providers). (Surfaced here by `/guides:integrate`.)
<!-- guide-anchor:TESTING_ON_PC anchor:spinup:preflight shape:walkthrough -->
> ⏱️ **Day-zero launch guide — TESTING_ON_PC (mobile app, Windows PC, no Mac):** set up the PC test loop early — Android emulator via WHPX/Hyper-V (HAXM is dead), Expo Go/dev-client — and line up the things with lead time NOW: a cheap/refurbished Android test device, EAS + device-farm accounts, and arranged access to a real iPhone by launch-validation week (there is no legitimate iOS simulator on Windows). See [`_guides/TESTING_ON_PC_GUIDE.md`](../../../_guides/TESTING_ON_PC_GUIDE.md). (Surfaced here by `/guides:integrate`.)
<!-- guide-anchor:MINORS anchor:spinup:preflight shape:notice -->
> 🚸 **Day-zero fork — MINORS:** who is this product for? Anything under-13 (or "kids" as an audience) = 🔴 lawyer BEFORE building, not before launch; teens-as-target = amber lane with extra duties; general-audience 13+ still needs an honest age gate. See [`_guides/MINORS_GUIDE.md`](../../../_guides/MINORS_GUIDE.md). (Surfaced here by `/guides:integrate`.)
<!-- guide-anchor:COMPLIANCE_TRIGGERS anchor:spinup:preflight shape:notice -->
> ⚖️ **Day-zero triage — COMPLIANCE_TRIGGERS:** 10 questions that switch on extra duties (cross-border sales tax/MoR, SMS/TCPA, UGC/DMCA/CSAM, ad pixels/GPC, health/biometric data, sanctions). Answer them in writing on day zero and re-answer when adding feature classes. See [`_guides/COMPLIANCE_TRIGGERS_GUIDE.md`](../../../_guides/COMPLIANCE_TRIGGERS_GUIDE.md). (Surfaced here by `/guides:integrate`.)

### Step 1 — setup (DETERMINISTIC — no LLM)
Create the product repo when the target isn't a MC repo yet (reusing
`portfolio:new`'s `create()`/`scaffold()` callables — §4, one implementation), or
operate in-place; scaffold the platform-aware app (web/PWA baseline, §3); register;
and capture RAW intake into the INTENT/brief artifact ONLY:
- **structured** `--name/--what/--who/--where` → a deterministic founding brief.
- **`--clone <target>`** → reuse the clone engine `scripts/portfolio/clone.js` (do
  NOT reimplement) — discover across **source classes** `product | review | landing |
  devdocs | appimg`, tag each, synthesize JTBDs / scored features / gaps /
  opportunities. The clone doc is written to `_docs/clones/<slug>/` **and kept**.
- **`--intent <file>`** → accept a brief the caller already wrote.
Then runs the `/scan:install` preflight gate — a gappy install is a hard refuse.
setup is deterministic: with structured args it NEVER blocks on an interactive
prompt and NEVER exit-3 dead-ends; with no intent source at all it fails with a
clear error (it does not run an LLM discussion — the consumer gathers intake and
passes it as args, or writes a brief and passes `--intent`).

### Step 2 — canon (AI SYNTHESIS — anti-degrade, load-bearing)
Generate the full `_requirements/00-canonical/*` (7 narrative + 4 structured + the
DATA_AND_ACCOUNTS doc = 12 artifacts) from the setup brief. **The engine refuses
degraded output, no matter what a caller requests:**

1. **Scaffold (deterministic):** `scripts/canon/generate.js` renders the structural
   scaffold — valid shape, ZERO raw `{{tokens}}`; every thin field degrades to a
   visible `*needs input: <field>*` marker. This is scaffold ONLY — it NEVER ships as
   "done."
2. **Fail-closed gate (non-opt-out):** the step runs `scripts/checks/canon-no-unfilled-tokens.js`
   on the output. A raw `{{token}}`, an unreadable/empty dir, or a runner error →
   canon FAILS. There is no flag/tier/alias/skip that bypasses this gate.
3. **Synthesis handoff:** any remaining `*needs input:*` field → the step returns
   `needs_orchestration` with an `orchestration_prompt` to synthesize those
   substantive fields IN PLACE (grounded in the brief; never invent or
   generic-substitute). The consumer fulfills it and re-invokes `canon --resume`;
   the gate is the proof the synthesis was real.

**Research depth.** `--research simple` (the floor + default — a handful of parallel
web searches, cents, under the `## Autonomy` $5 line) or `--research deep` (the
explicit opt-up). **There is NO `--research off`/`light` and no `--auto`/skip path —
they are REJECTED non-zero (anti-degrade §2; the WI-51→WI-47 regression class is now
structurally impossible).** The bounded research fill (cited category signal) is
governed by `schemas/canon/research-fields.schema.json`; every finding MUST carry
`sources[]` (a finding with empty sources is THIN and dropped — never a silent pass).

**The one audited exception.** `--allow-needs-input <field>` may leave a
GENUINELY-EXTERNAL field unfilled (a real-world fact only the user can supply, e.g. a
D-U-N-S number) — per field, with a logged reason (`/enforcement:log`). It is NOT a
bulk escape and NEVER applies to thinkable substance.

### Step 3 — roadmap
Invoke `roadmap:create` to produce `ROADMAP.md` — grounded in the canonical docs
(preferred) or the brief/clone — with **EPICS + sprints, MVP-core-loop first**:
Epic 1's first sprint = the paint step (core loop on screen). A node process can't
run that synthesis, so the step seeds the deterministic scaffold and returns
`needs_orchestration`; the consumer runs `roadmap:create` and re-invokes
`roadmap --resume`. There is no `--auto` thin-roadmap path (a templated roadmap is
degraded output, §2).

### Step 4 — paint
**Scaffold-if-missing (S0.3):** an idempotent safety net materializes the MC app
scaffold (Next.js+Tailwind v4+shadcn/ui+Radix+Lucide via `scripts/scaffold/app.js`)
when the repo has no `package.json` (setup is the primary scaffolder). Then execute
Epic-1's first sprint until the core loop **serves**, gated by verify-before-claim:
build clean + dev server returns HTTP 200 + entry module transforms without error.
"It builds" ≠ "it serves" — prove both; a live `node` process or an existing worktree
is not evidence. The gate is `paint.verifyServe()` in
`scripts/bootstrap/phases/paint.js`. The actual first-sprint execution is product-side
(LLM-orchestrated); the step returns `needs_orchestration` and the consumer drives it,
gating completion with `verifyServe`. There is NO `--auto` self-complete path (a
bare-scaffold "serve" is a degraded first paint, §2).

> **Visual confirmation is opt-in and needs Playwright.** The objective serve gate
> above (build clean + HTTP 200 + entry transforms) is the only auto-verifiable
> check. A *visual* "does it look right" pass via the `visual-review` agent requires
> the Playwright MCP server connected (`mcp__playwright__browser_*`); when it is
> absent, `visual-review` correctly BAILS rather than fabricating — treat that as
> "not run," not a failure, and never claim a visual pass that didn't execute. Run
> the visual pass in a session where the MCP is connected, or document its absence.

<!-- design-overview-pointer (single bootstrap entry to the agent-grounding design library; anchor:none, NOT a guide-anchor marker) -->
> 🎨 **Design-principles guides (overview):** the first-screen UX is judged by the
> `design-lead` / `conversion-lead` / `design-quality` / `visual-review`
> agents, which ground their craft in the **design-principles guide library** —
> overview at [`_knowledge/design/README.md`](../../../_knowledge/design/README.md) (index
> `_knowledge/design/registry.json`). These are agent-grounding training references
> (`anchor: none`), not staged launch guides; the README is the one design-overview
> entry the bootstrap pipeline surfaces.
>
> ⌨️ **Reusable component patterns:** for a "type or speak, then send" input surface
> (chat, notes, capture), use the **input-composer pattern** —
> [`_knowledge/design/INPUT_COMPOSER_PATTERN.md`](../../../_knowledge/design/INPUT_COMPOSER_PATTERN.md).
> The scaffold already ships the reference component (`src/components/composer/`,
> `src/hooks/`, `src/lib/composer/`) into every product, so paint the composer from the
> pattern rather than rebuilding it; the doc's §7 taste gate + §8 checklist are the
> adoption bar.

## The consumer dispatch contract (expose, do not implement)

Each LLM step (`canon`, `roadmap`, `paint`) returns — via the orchestrator's stable
`--json` status — a machine-readable handoff so ANY consumer (an in-loop Alpha
session, OR a product-side headless runner like the Master Console cockpit) can
drive **one step = one turn**:

```json
{ "phase": "canon", "status": "ok|needs_orchestration|failed", "ran": ["canon"],
  "orchestration_prompt": "<what to do>", "data": { "serveUrl": null, "firstAction": null, "roadmapPath": "ROADMAP.md" } }
```

A consumer fulfills the `orchestration_prompt` (synthesize canon / run
`roadmap:create` / execute the sprint) and re-invokes the SAME step with `--resume`;
the engine's fail-closed gate is the proof the synthesis was real, not dumb. The
engine DEFINES + DOCUMENTS this contract; it does NOT spawn agents itself.

**Named enforcer:** `scripts/bootstrap/test-spinup-orchestrate.js` is the regression
enforcer of this contract — per-step seam (each step standalone + idempotent + resumable),
the anti-degrade gate (thin → `needs_orchestration`, raw `{{token}}` → fail, synthesized →
`done`), `--research off`/degrade-alias rejection, and the headless `--json` status shape.

## Execution — the orchestrator driver

```bash
node scripts/bootstrap/spinup-orchestrate.js [<step>] \
  [--name <n>] [--what <w>] [--who <c>] [--where <platform>] [--clone <target>] \
  [--intent <file>] [--research simple|deep] [--research-in <findings.json>] \
  [--allow-needs-input <field>] [--repo-root <dir>] [--resume] [--json] [--dry-run]
```

- Each step is independently dispatchable, idempotent (2nd run = no-op), resumable.
- Deterministic steps run in-process by reusing existing engines (`portfolio:new`
  create/scaffold, `scripts/check/install.js`, `scripts/canon/generate.js`,
  `scripts/portfolio/clone.js`, `scripts/mc/generate-roadmap-scaffold.js`).
- LLM steps exit **3 (`needs_orchestration`)** with an `orchestration_prompt`; the
  consumer fulfills it then re-invokes `--resume`.
- Phase-state persists to `.mc/spinup-state.json`; `--resume` continues after the
  last completed step, `<step>` re-runs exactly one.
- Seam + anti-degrade + headless-contract tests: `node scripts/bootstrap/test-spinup-orchestrate.js`.

## Pre-flight — install completeness
The `setup` step runs `/scan:install` (incl. the sprint-subsystem probe) and refuses
to proceed on a gappy install — a fresh `/portfolio:new` scaffold or a manual
`/mc:setup` must reach a complete, sprint-capable state first.

## Relationship
- `portfolio:spinup <slug>` — the from-MC wrapper (forwards `<step>` + modifiers).
- `bootstrap:ponder` — sit with direction before/around an on-ramp.
- `roadmap:create` — the roadmap step's engine (also runnable standalone).
- `/portfolio:new` — scaffolds the repo; `bootstrap:spinup setup` is it composed.

## Notes
- Reference paths via `paths.*` keys, not literals (path-lint enforces).
- Reversible per step: setup/canon/roadmap each write to their own dirs; the paint
  step runs in a sprint branch.
- Supersedes the former standalone product-brief and competitor-clone skills —
  both are now `setup` intake modes. Their engines
  (`scripts/portfolio/bootstrap.js`, `scripts/portfolio/clone.js`) are reused.
