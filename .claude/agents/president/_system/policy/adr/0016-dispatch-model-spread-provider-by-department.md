# ADR 0016 — Dispatch model-spread: GPT-5.6 / Claude-5 / Antigravity, provider-by-department, and the fable-top supersession

**Date:** 2026-07-16
**Status:** accepted (operator-authoritative spec `DISPATCH.md` 2026-07-12, handed to α this session as the goal of Sprint A "update our agent dispatch & routing system"). Migration in progress — **two-stage**, canary per DISPATCH.md §10.
**Class:** B (architectural — the model catalog, provider topology, effort ladder, and the machine-enforced model-policy invariant)
**Sprint:** SP-20260716-001 (fresh; E-DISPATCH-MODELSPREAD-001 — distinct from E-DISPATCH-PERFECT-001 W3, which is the codex-doer build *shape*)

---

## Decision

Adopt the `DISPATCH.md` (2026-07-12, doogle plan-hardening, β rows 113–114) agent-dispatch architecture in MC canonical:

1. **Model families.** OpenAI `gpt-5.5` → the **`gpt-5.6` family** (`-sol` flagship, `-terra` mid, `-luna` cheap, 1.05M ctx; never the bare `gpt-5.6` alias — it 400s and silently degrades). Anthropic **add `claude-fable-5`** (top brain) **+ `claude-sonnet-5`** (builders/legwork); **retire `claude-sonnet-4-6`** and any Opus < 4.8; keep `claude-opus-4-8` as **the** fallback target. Gemini: the individual `gemini` CLI is **sunset** → route all Gemini through the **Antigravity `agy`** CLI (new provider id `antigravity`), model `gemini-3.1-pro-preview` only (Flash removed).
2. **Effort ladder.** Add `max` + `ultra`, for `sol`/`terra` only (`luna` caps at `max`; no xhigh/ultra). `ultra` fans out parallel subagents (heavy/agentic — budget 10–15 min; for a bounded verdict use `sol@xhigh`).
3. **Provider-by-department routing (§8).** GPT = Product + Growth · Claude = Engineering · Security = a 3-lab panel. Authors (design/product/copy/conversion leads, qa-reviewer) run `xhigh`; overseers/judges (Directors, β, security judge, marketing-lead) run `high`.
4. **Fallback with teeth (§7).** Required iff `provider !== "claude"`; must differ from primary (claude→claude rejected); every OpenAI/Antigravity role → `fallback: "claude"` = explicit `claude-opus-4-8`. Outage-only, logged, alert on chronic fire. **Security fails CLOSED on lab-diversity loss** — a hunter falling back to Claude collapses the cross-lab guarantee → re-run or BLOCK.
5. **Topology doctrine (§9).** Orchestrator holds envelopes not content; heavy work → CLI subprocess (≤8-line envelope); light small-return judgment → in-process Agent tool (Claude-only — see §"GPT-pin ↔ Agent-tool collision").

## The supersession (the operator-review surface — read this)

`DISPATCH.md` **REVERSES** the emphatic **2026-06-16** operator directive that was machine-encoded in `scripts/checks/model-chain.js` (and mirrored in the user auto-memory `feedback_model_opus48max_not_fable`):

| Question | 2026-06-16 directive (old) | DISPATCH.md 2026-07-12 (new, this ADR) |
|---|---|---|
| Top model | `claude-opus-4-8` is the shipped top; **`fable` is NOT the top default (rejected)** | **`claude-fable-5` is the top brain** (President, Dir-Eng, security planner+judge) |
| President (α) | opus-4-8 @ **max** | fable-5 @ **high** |
| Doers (builders/fixers) | opus-4-8 | **sonnet-5** |
| `max` effort | **alpha-only** | the Claude **security-hunter** lane (opus@max); President drops to high |
| `ultra` effort | did not exist | added, gated to `gpt-5.6` sol/terra |

**Ratification chain:** the 2026-06-16 directive predates the Claude-5 family; `DISPATCH.md` (2026-07-12) is the operator's later explicit directive, handed to α **this session** as the authoritative spec. Corroboration: this very session runs on `claude-fable-5` at the operator's choice, and fable-5 is a real Mythos-class model above Opus. β verdict `EVT-session-20260716-sprintA-designbuild-beta-004` (DECIDE B/0.88): this is a **sanctioned policy-update, not guard-evasion** — the policy itself changed (newer authoritative spec on the same question) and the enforcer is **replaced by an equally-strict enforcer of the new policy** (structure + fail-closed preserved, target constants swapped), not disabled.

**Action taken:** the stale auto-memory `feedback_model_opus48max_not_fable` is flagged for update (lead updated the user-side copy; ε updates the agent-memory at retro).

## Two-stage enforcer migration (β-ruled — the load-bearing HOW)

The enforcer rewrite is staged like migrate-first(widen)/remove-last(narrow), applied to the enforcer itself, to avoid self-RED-ing the current roster and to preserve the ADR-0013 kill-switch+GREEN separation:

- **Bucket A (landed) — WIDEN `model-chain.js` to the old∪new SUPERSET.** Both the current opus roster AND a future fable-top roster pass. Retire the no-fable rejection; `alpha ∈ {opus-4-8@max, fable-5@high}`; `doers ∈ {opus-4-8, sonnet-5}`; `max ∈ {alpha, security-reviewer}`; add `ultra` gated to sol/terra; null-effort allowance extended to `antigravity`. **Every non-superseded tooth kept** (drift-detector, scrapped-role guard, completeness, spec-effort parity, fail-closed). The superset boundary is proven by **negative fixtures per refused class** (model-chain.test 34/34).
- **Bucket D (GATED) — NARROW to the new positive-pins ATOMIC with the provider flip.** President MUST be fable-5@high, builders MUST be sonnet-5, ultra gated sol/terra. Behind β's binding gate + gauntlet GREEN + **kill-switch**. **GREEN = an effective-model attestation captured from the CLI header, not a config diff** (the `opts.model || provider.default_model` trap — a registry-only migration can look green while dispatch stays stale; WG-26 below is the canonical instance).

## GPT-pin ↔ Agent-tool collision (design item for Bucket D)

The harness Agent tool is **Claude-only** — a role pinned to a GPT model cannot be summoned in-process (empirically: product-lead/design-lead gpt-pins failed to spawn; the opus-pinned DoE spawned fine). So §8 (GPT = Product) collides with §9 (light in-process judgment) for every advisory role consulted in-process. Per-role resolution at Bucket D, two coherent options: **(a)** keep in-process advisory-judgment roles Claude-pinned and read §8 "GPT = Product" as Product's **CLI-dispatched** builder/reviewer roles (β's lean, preserves the in-process topology); or **(b)** GPT-pin them and reach them **only via CLI subprocess**, never the Agent tool. **Either way** the §9 parity enforcer MUST fire on "a `provider != claude` role carries Agent-tool / in-process reachability" (planted-violation test), so the contradiction cannot ship silently. The pre-existing gpt-5.5 advisory pins already trip this.

## The ONE legal Claude shape for a cross-provider reviewer's Claude lane

A `cross_provider_reviewer` (e.g. `security-reviewer`) has NO legal **subprocess** path for its Claude
lane — a contract hole exposed by the ADR-0013 enforce-flip and confirmed live running Auth's fallback:

- `dispatch-claude.js` → shape `subprocess-claude` → the contract **REFUSES** it for the class (ADR-0013,
  working as designed — a reviewer's allowed shape is `subprocess-cross-provider`);
- `dispatch-agent.js` → **refuses `provider=claude` outright** ("this bridge handles OpenAI and Gemini
  only — dispatch natively via the Agent tool / `claude -p`").

So the systematic claude-3rd-pass failure on both sprints was the honest contract catching a
mis-shaped chain, not a contract bug. **Resolution (lead + ε agreed 2026-07-16):** the Claude lane of
a multi-lab review is **declared `in-process-agent` shape** — ε summons it via the harness Agent tool
with a `scopeContract` (ADR-0014), evidenced by a `record-inprocess` completion (ADR-0009, the same
`ok:true` record `gauntlet-verify` reads). This is the **one legal Claude shape for the class**; it
needs no new transport and matches the W5 doctrine. Chosen over growing a new Claude subprocess route
in the bridge.

**Reconciliation (lands with Bucket E):** the 3-lab panel runs its GPT + Gemini(agy) hunter lanes as
`dispatch-agent` subprocesses, and its Claude hunter/`fable-5` judge lanes **in-process** via the
Agent tool + `record-inprocess`. `dispatch-review.js`'s multi-pass fireer is updated so the Claude
pass is NOT dispatched as a refused `subprocess-claude` — the registry/contract name `in-process-agent`
as the Claude lane's shape for the class, so the chain and `gauntlet-verify` agree. Fail-closed on
lab-diversity loss is unchanged (the lone-survivor `below_bar` surfacing already ships).

## Related settled calls recorded here

- **AUTH (Sprint B):** products use **Supabase passwordless** auth (operator-settled; Epsilon-Auth owns the content). Recorded here so the dispatch/security topology and the auth security-review lane share one decision surface.
- **Doogle-verified dispatch repairs folded into this sprint:** WG-10 (hollow dispatch prompts), WG-11 (gemini-gated quota fallback + quota-blind records), WG-13 (no write-ahead started-row), WG-26 (`manifest.agentProviders` overrides the role-registry keystone + carries stale pre-ADR-0007 names). WG-15 (build-chain hardcodes Claude; no `subprocess-codex` shape) is **E-DISPATCH-PERFECT-001 W3** feature scope, not this sprint's repair set.

## Naming — Greek letters = the President's office ONLY (operator directive 2026-07-16)

DISPATCH.md §8 ("Greek call-signs live ONLY in the President's office") is ratified as a hard naming
rule and applied to canonical (which had never had the strip pass — the whole department leadership
still carried Greek). **Audit (verify-don't-inherit, against disk):**

- **Correct (keep):** the five faces — `alpha` α · `beta` β · `gamma` γ · `delta` δ · `epsilon` ε.
- **STRIP (10 non-office roles carrying Greek call_signs — a naming violation):**
  Product — `director-of-product` ζ · `product-lead` κ · `design-lead` μ · `quality-lead` θ;
  Engineering — `director-of-engineering` η;
  Growth — `director-of-growth` ι · `research-lead` λ · `copy-lead` ν · `conversion-lead` ο · `marketing-lead` ξ.
  Remove the `call_sign` from the registry entry, the spec frontmatter/body, and the org docs for each.
- **ASSIGN (president-office residents that lacked a letter — operator: "the ENTIRE office gets Greek"):**
  `cabinet` → **ζ** and `ops-analyst` → **η** (the next letters after the faces, reclaimed from the
  freed department set). Both are the President's own tools (outside-counsel + cross-cycle auditor),
  so they are office members and take letters (lead ruling 2026-07-16 — no separate escalation).

**Blast-radius caveat:** a Greek glyph in a `president/_system` ADR or the lexicon is often an
incidental prose/precedent reference to a face, NOT an identity — each hit is verified surgically,
never blind-replaced.

**Enforcer:** a bijection `greek-symbol ⟺ president-office membership` (folded into role-parity / the
§9 parity set) with planted violations BOTH ways — an office role missing its letter FAILS, and a
non-office role carrying one FAILS. The keeper that makes the rule self-detecting.

## Consequences

- The catalog, effort kernel, health layer, and model-chain enforcer already carry the superset (Bucket A, reversible, green). The risky provider-by-department flip is isolated behind the β+GREEN+kill-switch gate (Bucket D) and the fail-closed security panel (Bucket E).
- Legacy ids (`gpt-5.5`, `gemini-3.5-flash`, `claude-sonnet-4-6`) are removed **last**, only on all parity/readiness enforcers green + a CLI-header attestation (self-detecting gate; no operator consult).
- The 2026-06-16 machine-encoded invariant is auditably reversed here; any future reintroduction of a no-fable/opus-top rule must supersede this ADR.

## Precedent

ADR-0013 (a live-default flip needs GREEN + kill-switch; the enforce-flip reverted once for false-refusing a legit `-w` builder); SP-20260627-001 (enforcer-flip: no-widen proof = negative fixtures per refused class); ADR-0014 (teammate-ε has the Agent tool — the collision analysis above depends on the Agent-tool reachability model). β records `EVT-session-20260716-sprintA-plandesign-beta-002`, `...-designbuild-beta-004`, `...-pipeline-amend-beta-005`.

## Amendment — 2026-07-18 (SR-015, SP-20260718-003; α-ruled, β-recommended)

The "Security = a 3-lab panel" clause (§Decision #3) and the security-panel claude lane are **refined by
a two-tier claude contract**, homed in **ADR-0020** (security panel lane contract): the `security_claude_hunter`
in-process lane defined here remains the contracted claude lane for the **BINDING `panel-3lab`** exit, but
the **degraded `panel-2family` FLOOR** (the operative interim while agy is DOWN, ED-060) accepts a
**`subprocess-claude`** security review. Rationale: the hunter's adversarial semantics come from the
security-reviewer SPEC (which subprocess-claude runs identically), not the in-process shape — which was
this ADR's answer to the provider-pin↔Agent-tool collision (§"GPT-pin ↔ Agent-tool collision"), not a
stronger review capability. Requiring the in-process hunter for the floor would couple a node-script gate
to conductor presence (ED-041) and re-create the hollow-gate class. The two-tier split is **reverting by
construction**: when ED-060 resolves and panel-3lab binds, the binding evaluation demands the in-process
hunter (a subprocess record can never satisfy it — identity is shape + role). See ADR-0020 "Two-tier CLAUDE
lane contract" + the `claude_lane_reversion` note on the panel-lane-manifest sunset.

## Amendment — 2026-07-24 (opus-5 workhorse cutover; operator-directed, α-ruled, β DECIDE B/0.90)

**What.** The opus WORKHORSE tier moves `claude-opus-4-8` → **`claude-opus-5`** (exact API id `claude-opus-5`,
no date suffix; Bedrock `anthropic.claude-opus-5`; 1M ctx / 128K out / $5/$25 — UNCHANGED from 4.8). The
fable-top spread is **untouched** (α/DoE/security planner stay `claude-fable-5`; §Decision #3 stands). **`claude-opus-4-8`
STAYS a served, valid catalog member** — it is NOT deleted; it remains the fallback / version-diversity target
(provider-fallback.json `deep_fallback`, the providers.js Claude last-resort). The catalog now carries BOTH.

**Channel partition (the load-bearing rider — never-claim-live-from-transport).** opus-5 was PROVEN served on
ONE channel only:
- **CLI channel — PROVEN 2026-07-24.** `claude -p --output-format json --model claude-opus-5 --effort max` →
  exit 0, envelope `modelUsage.canonicalModel="claude-opus-5"`, `provider:"firstParty"`, `contextWindow:1000000`
  (round-trip served, not a request-side echo, no 400). So the **CLI top-opus lane flips** (the delta canonical
  dispatch smoke). Catalog ADDS opus-5.
- **In-process Agent-tool channel — NOT yet servable.** α's harness-spawn probe (2026-07-24) shows the `opus`
  alias still resolves `claude-opus-4-8[1m]`; opus-5 is not harness-spawnable. Therefore **every role whose
  dispatch is IN-PROCESS ONLY holds at opus-4-8** — the faces γ/δ/ε, the manager/lead consults (quality-lead,
  frontend/backend/security-lead), the claude-pinned visual judges (design-quality, visual-review), and the
  in-process security Claude hunter lane (`security-reviewer.third_pass` + `security_claude_hunter`). Flipping
  their registry/spec pins to opus-5 would be a **registry-overclaims-served drift** (config claiming a serve the
  channel can't deliver). The two frozen in-process-channel surfaces — `scripts/dispatch/harness-spawn-model.js`
  `HARNESS_FACE_MODEL` and `.claude/kernel/support-matrix.json` (Addendum A proven-set) — **stay opus-4-8**.

**Follow-up (named).** When the harness serves opus-5 (re-run the harness-spawn probe), flip in lockstep:
`HARNESS_FACE_MODEL`, the support-matrix proven-set, the in-process role registry pins + their spec `model:`
frontmatter, and `panel-lane-manifest.json` `lanes.claude.model`. Until then they are correct at opus-4-8.

**NEW standing invariant (opus-5 breaking change → enforced).** opus-5 has **thinking ON by default**, and
`thinking:{type:"disabled"}` is a **400 at effort `xhigh` or `max`** (disabled thinking is allowed only at `high`
or below). Therefore: **any Claude-lane config (a role or a `second_pass`/`third_pass`) at effort `xhigh`/`max`
MUST keep thinking ON.** Named enforcer: **`scripts/checks/model-chain.js` block J** (`[THINKING-400]`), covered
by `model-chain.test.js` (negative fixtures: disabled+max, `{type:"disabled"}`+xhigh, third_pass off+max; positive:
always-on+max, disabled+high, non-claude). The CLI argv builders (`dispatch-claude.js`, providers.js
`buildProviderArgv`, the delta smoke) pass **no** thinking-disable flag — thinking stays default-ON — so the live
dispatch path is already safe (breaking-change sweep 2026-07-24: zero disabled-thinking flags in scripts/ or
.claude/agents/). `thinking:{type:"adaptive"}` stays valid/equivalent.

β records this cutover DECIDE B/0.90 with riders R0–R7 (channel partition, CLI round-trip proof, freeze set,
provider-fallback kept at opus-4-8, this amendment + enforcer, exercised-not-string-equality battery).
