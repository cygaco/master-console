# Top-Level Runtime Contract — MC Kernel

This is the Top-Level Runtime Contract:
the provider-independent trust boundary + runtime portability contract everything else in MC 1.0
binds to. Home: `.claude/kernel/` (`paths.kernel`). Companions: `role-binding.json`,
`support-matrix.json`, `workorder-min.schema.json`, `fixtures/` + `fixtures/manifest.json`.
ADR: ADR-0018 (durable company, ephemeral executors; see `.claude/agents/president/_system/policy/adr/INDEX.md`).

This contract is a SEQUENCE of numbered POLICY BLOCKS (`#### P<section>.<index> — <title>`), each with
a UNIQUE id (no two blocks, and no two §7 register rows, may share one).
Every ORDINARY (non-CORE) policy block ends with EXACTLY ONE machine-parseable trailer line:

- `Enforcer: scripts/checks/<x>.js` — enforceable-now; the ref MUST resolve to an existing, loadable script.
- `Deferred: ED-NNN @ Phase-X-exit` — enforced-later; the ED MUST exist in `paths.enforcementDebt`
  and name the phase where binding flips. Never a dangling `Enforcer: future.js`.
- `Deferred: no enforcing check yet` — no check enforces the block yet, stated plainly (this exact text).
- `Core: non-waivable` — a CORE invariant (§7); the ED escape-hatch is refused for these blocks.

A CORE-tagged block (§7) carries a RICHER trailer shape: exactly one `Core: non-waivable` trailer PLUS
one-or-more `Enforcer:` refs naming the check(s) that enforce its substance NOW — `Core:
non-waivable` alone, with no enforcer named, is aspirational, not itself a waiver, but not enforcement
either.

`scripts/checks/contract-lint.js` parses this document structurally — never by prose-scraping —
and self-hosts (it lints this very file to exit 0).

---

## §0 — Definition of Done Preamble

The headline sentence, verbatim (this is the yardstick the runtime is built against):

> 1.0 is done when a clean installed product moves idea→canon→roadmap→sprint→build→gauntlet→launch-readiness→release→retro→learning-promotion without relying on chat memory, stale trackers, manual Alpha heroics, or unverified agent claims.

This contract's slice of that DoD: the provider-independent kernel CONTRACT + trust-boundary DEFINITION
that everything else in the sentence binds to. This section is informational (no policy block —
`contract-lint.js` asserts the sentence appears verbatim; it carries no trailer of its own).

---

## §1 — Trust-Boundary Statement

Any provider — Claude, Codex/GPT, Antigravity, or a future model — MAY propose or orchestrate work
at the top level of MC. That is the entire point of the interoperability system: the
company is not the model. But exactly one thing must NOT be provider-negotiable: a single,
PROVIDER-INDEPENDENT TRUSTED layer SOLELY owns:

- **capability grants** — who/what may act with elevated authority
- **protected mutation** — writes to durable company state (trackers, ledgers, registries)
- **verification** — the check suite that decides whether proposed work is acceptable
- **integration into main** — the one route by which a proposed tree becomes the company's tree

Any provider proposing work is UNTRUSTED with respect to these four powers, regardless of how
capable, well-intentioned, or highly-privileged its own runtime session appears. This is the same
distinction ADR-0018 draws between the durable company and its ephemeral executors: models
come and go; the four powers above stay anchored to a trusted layer that no single provider session
controls unilaterally.

**Disambiguation — `write-durable-state` AND `update-tracker` (§4) are provider CAPABILITIES,
not the CORE-2 power.** `support-matrix.json` grants providers a `write-durable-state` capability at
helm-levels 1-2, AND a SEPARATE `update-tracker` capability at helm-levels 1-2 — trackers are named
explicitly, above, among the "durable company state" this section opens with, so `update-tracker` gets
the exact same disambiguation. BOTH capabilities mean a provider may PROPOSE durable state — including
a proposed TRACKER.md edit — by writing to an ISOLATED WORKTREE (or via the trusted dispatch bridge) —
an UNTRUSTED proposal, exactly like any other patch a provider produces. NEITHER capability means a
provider may perform **protected mutation** (writes that land directly in the company's durable state
— trackers, ledgers, registries — on the integrated/main tree) or **integration-to-main** — those two
of the four CORE-2 powers above stay SOLELY with the trusted layer, regardless of what any
support-matrix row says a provider can write. A provider's `write-durable-state`/`update-tracker`
capabilities and the trusted layer's `protected mutation` + `integration-to-main` powers are different
things named similarly; this contract does not read the matrix as granting providers protected
mutation of ANY durable-state-mutation capability, tracker edits included. Any future
durable-state-mutation capability added to the matrix inherits this same disambiguation — see
support-matrix.json's `durable_state_mutation_capabilities_note`.

**This section DEFINES the boundary.** The mechanism that makes it binding — a pinned, content-addressed
trusted checker running OUTSIDE any candidate provider's writable domain, the sole integration
principal, atomic compare-and-swap into the destination ref — is the "trusted
enforcement adapter" (P1.2 states its scope).

#### P1.1 — Provider-independent trusted layer owns capability grants, protected mutation, verification, and integration-to-main

Statement (restated as the binding rule this contract locks in): no provider session — Claude,
Codex/GPT, Antigravity, or a future model — may grant itself capability, perform a protected mutation,
self-verify, or integrate its own proposed tree into main. Those four powers route exclusively through
the trusted layer defined above. A provider that is only proposing/orchestrating (the common case —
any top-level session, any builder, any reviewer) is operating entirely within its rights; the boundary
only bites at the four named powers. This invariant is registered as **CORE-2** (§7) — non-waivable.

The trusted-layer-sole-integrator fixture (`fixtures/trust-boundary/trusted-layer-sole-integrator.json`) is evaluated by `conformance-matrix.js`; the enforcement MECHANISM exists for verification and integration-to-main only (P1.2 states what it does not cover).

Enforcer: scripts/checks/conformance-matrix.js

#### P1.2 — Honest-promise scope: the trusted enforcement adapter covers artifact-verification + integration-to-main ONLY

The trusted enforcement adapter SHIPS as —
`scripts/dispatch/trusted-controller.js` (the sole integration principal), `scripts/dispatch/helm-runner.js`
(the aggregate entrypoint over it), and `scripts/hooks/protected-ref-transaction.js` (the sole-route
MECHANISM for `refs/heads/main`, probe-confirmed). This
block states the adapter's HONEST, BOUNDED promise — the only claim it is entitled to make, and the only
claim a downstream reader may draw below.

- **What IS now live-enforced (2 of CORE-2's 4 named powers):** **verification** — the controller
  re-derives its own verdict from a FRESH, nonce-bound, pinned-checker-bundle run over real git objects,
  never adopting a caller's self-asserted ResultEnvelope verdict — and **integration-to-main**
  — the controller is the sole brokered CAS route into a protected ref, and the `reference-transaction`
  hook is the git-level MECHANISM that refuses any un-brokered write surface (update-ref/merge/push/
  fast-forward) touching it, evidence-grounded and NOT bypassed by `--no-verify`.
- **What is NOT covered by this slice (still open):** **capability grants**
  and **protected mutation** (writes to durable company state — trackers, ledgers, registries — outside the
  one integration-to-main CAS path) are NOT this adapter's job. These stay ADJACENT, not closed —
  see `paths.enforcementDebt`.
- **The honest ceiling (named, evidence-grounded, dropped — adversarial containment, explicitly
  OUT of scope):** `core.hooksPath` redirect, hook file deletion, a direct `.git/refs/**` filesystem write,
  and a hostile process forging the controller's fencing token. All four require local shell access +
  intent; this adapter defends against MISTAKES (an un-brokered merge/update-ref/push/fast-forward), never
  a hostile operator with a shell.
- **Falsifier-proven, never merely asserted:**
  `scripts/dispatch/falsifiers/honest-promise-scope.falsifier.test.js` mechanically asserts this statement
  never overclaims capability-grant/protected-mutation coverage.

Enforcer: scripts/checks/conformance-matrix.js

---

## §2 — Runtime Levels 0–3

A runtime's ability to host the top-level Alpha role is classified into four levels:

| Level | Name | Capability | Use for | Do not use for |
|---|---|---|---|---|
| 0 | Chat-only | Plan, write prompts, review copied outputs. No file/tool access. | Strategy, architecture review, prompt generation, decision support. | Direct repo mutation, dispatch execution, liveness management, release/update operations. |
| 1 | File-aware | Reads repo, produces patches. Cannot run commands. | Docs/plans/templates, code generation for human/automation-applied patches. | Anything requiring live command execution or self-verification. |
| 2 | Tool-capable | Reads/writes files AND runs commands (Bash/CLI). | Hosting Alpha today, IF wrappers/gates exist. | Acting as the sole trusted integration principal (regardless of level). |
| 3 | MC Master Console | Provider-neutral top-level UI/API that binds Alpha to any model and dispatches through adapters. | The long-term interoperability target. | N/A — not built for any helm yet. |

The support matrix declares Claude Code and Codex CLI at **Level 2** (proven). Antigravity/agy is
contracted as a Level-2+ helm and ships `not-verified` (see §4 — Support Matrix): every gate reads
that status exactly like `down`. No helm operates at Level 3; that is the explicitly-named
"long-term target."

#### P2.1 — Runtime-level taxonomy feeds the support matrix

The four levels above are the column dimension `support-matrix.json` uses per capability, per
helm. A runtime is not "Level 2" by self-report — it is Level 2 for a given capability only when a
live, evidenced example exists (`evidence_ref` per cell). The matrix — and whether a claimed
level actually holds — is proven or refuted by `conformance-matrix.js` against the kernel
fixtures in `fixtures/support-matrix/`. `conformance-matrix.js` is report-only by default and BINDING under `--enforce`.

Enforcer: scripts/checks/conformance-matrix.js

---

## §3 — Role-Binding Precedence

Every runtime determines its OWN effective role using this fail-closed precedence order (machine
copy: `role-binding.json`):

1. **explicit_user** — an explicit, in-session user/operator instruction.
2. **validated_workorder_or_cli** — a validated WorkOrder field or CLI/dispatch binding.
3. **explicit_top_level_helm** — an explicit top-level runtime (helm) binding
   (`sources.explicit_top_level_helm.can_bind: true`).
4. **UNBOUND** — nothing above resolved a role.

This is a TOTAL machine graph over the four `order` entries above — every ordered source except
`UNBOUND` has a `sources` entry, and the entry's key name matches the `order` name exactly. The
graph is ALSO total over `{source × actor_kind}`: every `sources` entry
carries an `applies_to_actor` array (`role-binding.json`) naming which actor_kind(s) may bind through
it —

| Source | Can bind a role? | Applies to actor | Meaning |
|---|---|---|---|
| `explicit_user` | **true** | `top_level_session` only | An explicit, in-session user/operator instruction — the OPERATOR's own direct instruction (a trusted human), categorically different from ambient repo prose. Order position #1. |
| `validated_workorder_or_cli` | **true** | `dispatched_worker`, `top_level_session` | A validated WorkOrder field or CLI/dispatch binding. "Validated" is DEFINED at P3.2 below. Order position #2. The ONLY source a `dispatched_worker` may bind through. |
| `explicit_top_level_helm` | **true** | `top_level_session` only | An explicit top-level runtime (helm) binding. The ONLY source for the top-level human-facing session default (`top_level_default_binding_source: "helm_only"`). Order position #3. |
| `agents_md` (the neutral, provider-neutral handbook) | **false** | n/a (never binds, any actor) | Ambient prose every provider auto-loads — NOT an ordered binding source; ambient prose can never manufacture a binding (CORE-3). |
| `repo_prose` (any other ambient repository text) | **false** | n/a (never binds, any actor) | Same CORE-3 refusal as `agents_md` — stale worktree copies, handoff prompts, any other non-operator, non-WorkOrder, non-helm text. |

Four rules follow directly from this table:

- **Dispatched workers default to `FAIL_CLOSED` when unbound** — never to the President (alex-alpha).
  A worker that cannot resolve a role through steps 1–3 stops rather than silently assuming top-level
  authority. This is **CORE-1** (§7).
- **The top-level, human-facing session defaults to `alex-alpha`** — but
  ONLY through an explicit helm binding (`top_level_default_binding_source: "helm_only"`). Neutral,
  provider-neutral, AMBIENT prose (root `AGENTS.md`, or any file every provider auto-loads) can NEVER
  itself manufacture that default — this is **CORE-3** (§7). CORE-3 is a restriction on ambient/neutral
  PROSE specifically; it is NOT a claim that only a WorkOrder/CLI binding or a helm binding can bind a
  role at all — `explicit_user` (the operator's own direct, in-session instruction) is ALSO a
  legitimate binding source per the precedence order above. DISPATCHED workers are
  unbound-fail-closed; the OPERATOR's own top-level session
  is not left unbound, because a blanket no-default rule would strand the operator.
- **A `dispatched_worker` is bindable ONLY through `validated_workorder_or_cli`** (closing a CORE-1
  bypass) — `explicit_user` and `explicit_top_level_helm` are `top_level_session`-
  ONLY sources per the `applies_to_actor` column above. A `dispatched_worker` that PRESENTS an
  `explicit_user` or `explicit_top_level_helm` binding is a **category error**, not a legitimate bind —
  the source exists and can bind *in the abstract*, but not for this actor_kind — and must resolve
  BLOCK (fail-closed), never PASS as though it had resolved through the precedence order. Fixture:
  `fixtures/role-binding/worker-helm-binding-category-error.json`.
- **`CLAUDE.md` binds ONLY as the Claude helm's trusted `explicit_top_level_helm` projection for the
  top-level human-facing session — NEVER as ambient prose, and NEVER for a `dispatched_worker`**
  `support-matrix.json`'s `claude` row `evidence_ref` reads "helm
  projection binds the top-level session" — deliberately not a bare "CLAUDE.md binds"
  — to avoid the exact contradiction that phrasing would otherwise read as against CORE-3: `CLAUDE.md`
  the FILE auto-loads as ambient prose for EVERY session, top-level or dispatched worker alike, exactly
  like root `AGENTS.md` (`sources.agents_md`/`sources.repo_prose`, both `can_bind: false`) — and ambient
  prose can never itself manufacture a binding. What actually binds the top-level, human-facing Claude
  Code session is the `explicit_top_level_helm` SOURCE (order position #3, `can_bind: true`,
  `applies_to_actor: [top_level_session]` only) — the runtime's own explicit helm-binding mechanism
  — for which `CLAUDE.md` is merely the trusted PROJECTED
  representation surface at the top level, never a self-sufficient ambient-prose bind on its own. A
  `dispatched_worker` that inherits `CLAUDE.md`'s "You are Alex" text via ordinary ambient auto-load
  (rather than through the actor-scoped `validated_workorder_or_cli` source) is exactly the CORE-3
  ambient-prose refusal — never a legitimate bind for that actor_kind.

#### P3.1 — Role-binding precedence graph (fail-closed; repo prose cannot bind; actor-scoped)

The full machine-readable precedence graph — order, per-source `can_bind` + `applies_to_actor`,
`worker_default_when_unbound: "FAIL_CLOSED"`, `top_level_human_default: "alex-alpha"`,
`top_level_default_binding_source: "helm_only"` — is `role-binding.json`. It is fixture-proven at the
SEED level: `fixtures/role-binding/unbound-dispatch-fails-closed.json` (CORE-1),
`fixtures/role-binding/no-root-alpha-poison.json` (CORE-3), and
`fixtures/role-binding/worker-helm-binding-category-error.json` (CORE-1, actor-scoping — a
`dispatched_worker` presenting a `top_level_session`-only source must BLOCK, never resolve). `conformance-matrix.js` evaluates these fixtures against `role-binding.json`, and `scripts/dispatch/role-resolver.js` applies the graph at dispatch time.

Enforcer: scripts/checks/conformance-matrix.js

#### P3.2 — `validated_workorder_or_cli` provenance (what makes a binding "validated")

A WorkOrder/CLI binding is **"validated"** — and therefore eligible to bind a role at precedence order
position #2 — IF AND ONLY IF the TRUSTED dispatch bridge (`scripts/dispatch-claude.js` /
`scripts/dispatch-agent.js`) has ACTIVELY VALIDATED it: (a) affirmatively checked it for schema
conformance against the minimal WorkOrder field set (§5, `workorder-min.schema.json`), AND (b)
affirmatively checked its authority/provenance — that the binding genuinely originates from a source the
trusted layer itself recognizes as legitimate — BEFORE the binding is allowed to resolve a role. Both
checks must be PERFORMED BY the trusted layer itself. Merely TRANSITING the trusted dispatch bridge — a
request that reaches the bridge's transport but is never actually checked against (a) and (b) — does NOT
satisfy this definition, no matter how schema-shaped the object looks: transit is not validation.
Self-assertion (a provider's session simply claiming "I am a validated WorkOrder binding") never
satisfies it either, regardless of how the claim is phrased — "validated" names an ACT the trusted layer
performs, never a passive property of the request having arrived through a particular transport or
merely having the right shape.

This is the DEFINITION of provenance. The active validation is performed by `scripts/dispatch/workorder-validator.js` (schema check plus same-session signed provenance), which `scripts/dispatch/role-resolver.js` consults before treating a presented WorkOrder as validated; that validator is not a `scripts/checks/` script, so this block keeps a `Deferred` trailer.

Deferred: no enforcing check yet

---

## §4 — Support Matrix

Provider (helm) × capability × helm-level (§2), rendered from `support-matrix.json`:

| Helm | Current level | Status | Required | Proven | Evidence |
|---|---|---|---|---|---|
| `claude` | 2 | supported | true | true | helm projection binds the top-level session; live dispatch ledger |
| `codex-gpt` | 2 | supported | true | true | dispatch-agent.js codex route |
| `agy-antigravity` | — | **not-verified** | **true** | **false** | **required lane not verified on this install; proven:false** |

A row's `status` is one of `supported`, `down` or `not-verified`; `conformance-matrix.js` refuses any
other value at load. `down` and `not-verified` are both unavailable statuses, and every gate reads them
identically.

The `agy-antigravity` row is CONTRACTED (`panel-3lab` is the 1.0 BINDING profile —
GPT + Claude + Antigravity all REQUIRED) and ships `not-verified` / `proven:false`, so no gate treats
the lane as a working cell. The lane is verified only by an attested, authenticated serve of the
contracted model. `panel-2family` gates while the agy lane is unavailable; `panel-3lab` is the binding
exit once it is.

**Disambiguation:** each row's per-capability `write-durable-state` cell AND `update-tracker` cell
(e.g. `claude`/`codex-gpt` at helm-levels 1-2, evidenced by "file writes in an isolated worktree, live"
/ "TRACKER.md edits ... isolated-worktree proposal only, never direct protected mutation of main's
TRACKER.md") describe an UNTRUSTED-PROPOSAL capability — a provider writing to an isolated worktree it
does not control the integration of, or proposing a change via the trusted dispatch bridge — never
direct protected mutation of the company's integrated/main durable state (trackers included).
§1/CORE-2's **protected mutation** and **integration-to-main** powers stay SOLELY with the
provider-independent trusted layer regardless of this matrix; see §1's disambiguation for the full
statement. This matrix cannot be read as granting any provider row protected mutation or integration
authority over ANY durable-state-mutation capability — `write-durable-state`, `update-tracker`, or any
future capability of the same kind.

**Addendum A — model × channel (seed):**

| Model | Channel | Proven | Evidence |
|---|---|---|---|
| `gpt-5.6-terra` | cli | true | dispatch ledger |
| `gpt-5.6-terra` | harness | false | (non-Claude registry pins fail harness Agent-tool spawn) |
| `gpt-5.6-sol` | cli | proven on code/planning shape | real CLI dispatch |
| `gpt-5.6-sol` | cli (security-review shape) | false | trips defensively on raw security/exploit-shaped prompts; the prompt reframe is the fix |
| `claude-opus-4-8` | harness | true | in-process Agent-tool spawns, live |
| `gemini-3.1-pro-high` | agy | false | lane not verified on this install |

**Kernel scope:** IN = this helm × capability × level contract + the Addendum A seed (both
fixture-covered). OUT = per-request routing policy and the full `panel-3lab` BINDING gate,
and any product-pack/webapp/founder-panel provider gate (lastmile — never
kernel scope).

**Durable rule:** a lane resolved DOWN or NOT-VERIFIED is reflected in EVERY artifact that assumed it UP.
`conformance-matrix.js` reads the `status` field directly — never a cached or self-reported liveness
claim — so a false-green agy seed cannot propagate into the panel lane contract. A
config-intent echo is NOT liveness.

#### P4.1 — Provider × capability × helm-level support contract (a not-verified or down required lane is non-passing)

`support-matrix.json` is the source of truth this block governs. Every row MUST carry
`{status, required, proven, evidence_ref}`; a `required:true` row with `status:"down"` or
`status:"not-verified"` MUST resolve to BLOCKED in the conformance runner
(`fixtures/support-matrix/agy-row-down-blocks.json`), never a silent pass. `conformance-matrix.js` is
the runner; it is report-only by default and BINDING under `--enforce` (blocks on any mismatch, or on
a required lane that is `down` or `not-verified`).

Enforcer: scripts/checks/conformance-matrix.js

---

## §5 — Minimal WorkOrder Field Set

The MINIMAL required field set for a valid, auditable WorkOrder binding (deliberately NOT the
ResultEnvelope):

| # | Field | Required for build roles | Required for non-build roles |
|---|---|---|---|
| 1 | `schema` | yes | yes |
| 2 | `id` | yes | yes |
| 3 | `role` | yes | yes |
| 4 | `objective` | yes | yes |
| 5 | `scope.allowed_files` | yes | **waived** |
| 6 | `scope.forbidden_files` | yes | **waived** |
| 7 | `acceptance_criteria` | yes | yes |
| 8 | `verified_by` | yes | yes |
| 9 | `timeout` \| `lease` | yes (one of) | yes (one of) |
| 10 | `output_contract` | yes | yes |

"Build roles" = `role-registry.json` entries with `kind: builder|fixer` (`build_chain: true`);
"non-build roles" = reviewers, leads, directors, tools, checks, and the President/Beta/mode-conductor
faces. The full JSON Schema is `workorder-min.schema.json`.

This field set is also HALF of what makes a `validated_workorder_or_cli` role-binding source
"validated" per §3 P3.2: schema validation against this field set is necessary condition (a); the
trusted dispatch bridge ACTIVELY validating the binding's authority/provenance — not merely the binding
transiting the bridge, which is insufficient on its own — is the other, condition (b). See P3.2 for the
full provenance definition — this section defines the schema; §3 defines when passing it counts as a
binding.

#### P5.1 — Minimal WorkOrder field set

A WorkOrder missing any of the ten fields (eight for non-build roles) is invalid and must not be
dispatched. This block is lint-covered by `contract-lint.js` (structural presence + well-formedness
of the field-set policy block itself).

Deferred: no enforcing check yet

---

## §6 — Retention Classes

Per-sink retention CLASSES, cited from the LIVE `scripts/hooks/lib/rotate.js#CAP_CLASSES` (verified
against the shipped code at build time, not from memory):

| Class | Kind | Cap | Example sinks |
|---|---|---|---|
| `diagnostics` | bytes | 2 MB (`2 * 1024 * 1024`) | `team-guard-debug.log` |
| `operational` | lines | 20,000 | events/tools/dispatch-completions |
| `security` | lines | 50,000 | β + per-agent judgment fan-out |
| `semantic` | lines | 40,000 | requirements/plans/code/manager-consult |

**All classes: over-cap → move-to-archive, NEVER delete.** An over-cap sink is moved into the
archive tier (`scripts/hooks/lib/archive.js`, `.claude/runtime/archive/` + an `index.jsonl` + a
restore-drill test) under a unique, collision-proof name — never renamed to a single `.1` generation
and never deleted. This is **CORE-4** (§7) — raw history is never destroyed.

#### P6.1 — Retention classes are archive-not-delete

Write-time rotation is `scripts/hooks/lib/rotate.js` (`rotateIfNeeded`/`rotateBytesIfNeeded`/
`rotateSink`, closed over the `SINK_CAPS` allowlist — an unregistered path is refused, never
archived). The `>2×`-cap gate is `scripts/checks/log-sink-caps.js`, which reads the SAME `SINK_CAPS`
map so the enforcer and the write-time mechanism can never disagree about what "too big" means. See
ADR-0017 (retention/rotation contain-via-archive-rename over atomic-delete).

Enforcer: scripts/checks/log-sink-caps.js

---

## §7 — CORE-Invariant Register + Policy-Block Register

The four CORE invariants below are **non-waivable** — the `Deferred: ED-NNN` escape hatch is refused
for them. A block tagged `**core_id:**` MUST carry the `Core: non-waivable` trailer, `**waivable:**
false`, AND one-or-more `Enforcer:` refs naming the check(s) that enforce its substance NOW (`Core:
non-waivable` alone, with no enforcer named,
is aspirational; the invariant itself stays non-waivable, but nothing enforces it — a named enforcer
is not a waiver, it names what enforces the SUBSTANCE). A CORE-tagged block carrying a `Deferred:`
trailer instead of `Core: non-waivable` is a contract authoring error and `contract-lint.js` fails it;
a CORE-tagged block carrying `Core: non-waivable` but zero `Enforcer:` refs is also a contract
authoring error and `contract-lint.js` fails it ("core-unenforced").

#### P7.1 — CORE-1: unbound dispatch fails closed

**core_id:** CORE-1
**waivable:** false

A dispatched worker that cannot resolve a role through §3's precedence order (explicit user →
validated WorkOrder/CLI → explicit top-level helm) MUST fail closed. It must NEVER default to
binding as the President (alex-alpha) merely because no other binding resolved. Fixture:
`fixtures/role-binding/unbound-dispatch-fails-closed.json`.

Core: non-waivable
Enforcer: scripts/checks/contract-lint.js
Enforcer: scripts/checks/conformance-matrix.js

#### P7.2 — CORE-2: the provider-independent trusted layer solely owns capability grants, protected mutation, verification, and integration-to-main

**core_id:** CORE-2
**waivable:** false

Restated from §1: no provider session may grant itself capability, perform a protected mutation,
self-verify, or integrate its own proposed tree into main. Those four powers route exclusively
through a single, provider-independent trusted layer. The invariant itself carries no ED-based
waiver. Fixture: `fixtures/trust-boundary/trusted-layer-sole-integrator.json`
(report-only, definition-level — see the fixture's own note).

Core: non-waivable
Enforcer: scripts/checks/contract-lint.js
Enforcer: scripts/checks/conformance-matrix.js

#### P7.3 — CORE-3: repo prose can never manufacture a binding

**core_id:** CORE-3
**waivable:** false

Neutral, provider-neutral, ambient prose — root `AGENTS.md`, any file every provider auto-loads, any
stale worktree copy, any handoff prompt — can NEVER itself bind a role, grant a default, or assert
top-level authority. This is a restriction on AMBIENT/NEUTRAL PROSE specifically (`sources.agents_md`
and `sources.repo_prose`, both `can_bind: false`) — it is NOT an enumeration of the only sources that
CAN bind. Per §3's precedence order, `explicit_user` (the operator's own direct, in-session
instruction — a trusted human, categorically different from ambient repo prose), a validated
WorkOrder/CLI binding, and an explicit top-level helm binding can all bind a role. Fixture:
`fixtures/role-binding/no-root-alpha-poison.json`.

Core: non-waivable
Enforcer: scripts/checks/contract-lint.js
Enforcer: scripts/checks/conformance-matrix.js

#### P7.4 — CORE-4: raw history is never destroyed

**core_id:** CORE-4
**waivable:** false

Retention/rotation/compaction NEVER delete raw history. An over-cap or compacted sink is archived
(`scripts/hooks/lib/archive.js`), never removed — the archive tier stays accessible via an
`events:query --archive`-class read path and carries a restore-drill test. Fixture:
`fixtures/retention/retention-archive-not-delete.json`. This invariant's runtime
mechanism is live, not deferred: write-time rotation (`scripts/hooks/lib/rotate.js`)
archives — never deletes — any over-cap sink, and `scripts/checks/log-sink-caps.js` (§6 P6.1) is the
real, wired `>2x`-cap gate.

Core: non-waivable
Enforcer: scripts/checks/contract-lint.js
Enforcer: scripts/checks/conformance-matrix.js

#### P7.5 — This contract self-validates

This document is not truth because it exists — it is truth because `contract-lint.js` can prove
every ordinary policy block above names a resolving `Enforcer:`, a real `Deferred: ED-NNN`, or a
non-waivable `Core:`; every CORE-tagged block ADDITIONALLY names >=1 resolving `Enforcer:` alongside
its `Core: non-waivable` trailer (a CORE invariant naming no enforcer is aspirational, a
false-green in a BINDING register); no policy-block id or §7 register row is duplicated (an
ambiguous/contradictory contract); every cited `ED-NNN` exists in `paths.enforcementDebt`; the CORE
register above enumerates all four invariants with `waivable:false`; the §0 sentence is present
verbatim; and the fixture manifest count is nonzero. `contract-lint.js` lints THIS FILE as part of
its own test suite (dogfooding) — a lint failure on this document is a build defect, not a
downstream problem.

**Known residual:** a TRAILING policy block removed together
with its OWN §7 register row (both a section's last heading and its last register row deleted in the
same edit) evades every register-completeness check above (register-block-missing / register-drift /
register-gap) — the remaining sequence stays fully consecutive with no internal gap, so nothing
disagrees. A cheap in-document guard for this specific shape would require an EXTERNAL expected-block-
count manifest per section — named debt, never a silent gap.

Enforcer: scripts/checks/contract-lint.js

### Policy-block register

| Block | Section | Trailer |
|---|---|---|
| P1.1 | §1 Trust boundary | `Enforcer: scripts/checks/conformance-matrix.js` |
| P1.2 | §1 Honest-promise scope | `Enforcer: scripts/checks/conformance-matrix.js` |
| P2.1 | §2 Runtime levels | `Enforcer: scripts/checks/conformance-matrix.js` |
| P3.1 | §3 Role-binding precedence | `Enforcer: scripts/checks/conformance-matrix.js` |
| P3.2 | §3 `validated_workorder_or_cli` provenance | `Deferred: no enforcing check yet` |
| P4.1 | §4 Support matrix | `Enforcer: scripts/checks/conformance-matrix.js` |
| P5.1 | §5 Minimal WorkOrder | `Deferred: no enforcing check yet` |
| P6.1 | §6 Retention classes | `Enforcer: scripts/checks/log-sink-caps.js` |
| P7.1 | §7 CORE-1 | `Core: non-waivable` (+ `Enforcer:` x2) |
| P7.2 | §7 CORE-2 | `Core: non-waivable` (+ `Enforcer:` x2) |
| P7.3 | §7 CORE-3 | `Core: non-waivable` (+ `Enforcer:` x2) |
| P7.4 | §7 CORE-4 | `Core: non-waivable` (+ `Enforcer:` x2) |
| P7.5 | §7 Self-validation | `Enforcer: scripts/checks/contract-lint.js` |

**Kernel scope (versioned, candidate-immutable):** IN = §1–§7 above + their JSON/fixture
companions. OUT = the trusted enforcement adapter itself, the full WorkOrder/
ResultEnvelope v1 — all
named debt, never a silent gap — and product-pack/webapp/founder-panel gates (route to
bootstrap:lastmile, never kernel scope).
