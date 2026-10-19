# Integration-Seam Contract — Producer / Consumer Connecting Points

> Focused producer/consumer **integration-seam** contract, AUTHORITATIVE for how features
> connect (`_system/agent-system.md` §14, "Connecting Points Between Features", points here);
> for the gauntlet / circuit-breaker / context-scoping mechanisms, defer to
> [`gauntlet-contract.md`](gauntlet-contract.md).

Ownership language below uses the current ADR-0007 department tree. "Foundation-owned" means
owned by the **Gamma integration phase** under the **Director of Engineering** — the phase that owns
generated types, env, shared `src/lib` files, smoke tests, and the FE/BE merge. The
"producer/consumer" pair is the **FE/BE seam** the Director of Engineering owns; see the
org map (`.claude/agents/_org/org-map.json`) for who owns what. Feature builders
(`frontend-builder`, `backend-builder`) are consumers/producers of the seam — they do NOT
own the commons.

> Why a single contract: features do NOT talk to each other. They talk through **data**.
> The three layers below are that data spine — types (the shape), integration points (the
> explicit seams), and foundation utilities (the read-only commons). Get the seam right and
> two features built by isolated agents compose without either agent ever reading the
> other's code.

---

## The model in one sentence

**The producer defines the shape; the consumer adapts.** A consumer imports the producer's
exported type, trusts the shape, and never inspects the producer's implementation. An
exported type IS a contract — changing it without updating the store's `lockedInterfaces`
breaks every consumer downstream.

---

## Layer 1 — Types (the data spine)

A single shared interface (the product's shared session type, in its type module) is the
spine. Every feature reads from and writes to it. Features do NOT communicate directly —
they communicate **through the data**:

- A producer feature **writes** a field.
- A consumer feature **reads** that field.
- They never import each other's code.

**Types are owned by the integration phase, not by feature builders.** No feature agent may
modify the shared type module. If you need a new field or type, do NOT edit the type module
yourself — flag it in the store as a `foundation-update` request and let the Gamma
integration phase (under the Director of Engineering) own the change. This keeps the data
spine single-sourced; a feature builder silently widening a shared type is the seam bug this
rule prevents.

---

## Layer 2 — Integration Points (the explicit seams)

An integration point is any place where one feature's output feeds another feature's input.
Each seam is a named contract with a producer, a consumer, and a rule:

```
producer-feature → consumer-feature
  Contract: <the exported type / function / field that crosses the seam>
  Producer: <feature that defines the shape>
  Consumer: <feature that adapts to it>
  Rule:     Producer defines the shape. Consumer adapts.
```

**The two roles, stated as rules:**

- **If you are a consumer:** import the type, trust the shape, adapt your code. Do NOT
  inspect or depend on the producer's implementation — only its exported type.
- **If you are a producer:** your exported type IS your contract. Changing it without
  updating the store's `lockedInterfaces` will break consumers. Flag a changed locked
  interface for the Gamma integration phase — never mutate it silently.

**Directionality is part of the contract.** A seam points one way: the producer exports, the
consumer imports, never the reverse. (In the example below, the auth seam exports and the
pages import — the seam never imports a page.) A bidirectional dependency between two
features is a design smell: re-cut the seam so one side is the unambiguous producer, or hoist
the shared piece into Layer 3.

---

## Layer 3 — Foundation Utilities (the commons)

A small set of shared files is the **commons** — utilities every feature reads but no feature
owns. In the shipped app scaffold they include `src/lib/utils.ts`, the `src/components/ui/*`
primitives and the `src/lib/supabase/*` auth seam. The defining property is not the path, it's the
ownership:

**Foundation files are read-only for all feature agents.** If you need something added to a
foundation file, do NOT edit it. Write a `foundation-update` task to the store with the file
path and what you need; the orchestrator (under the Director of Engineering's integration
phase) dispatches that change separately. This is the same `foundation-update` request path
as a Layer-1 type change — the commons and the type spine share one ownership rule: the
integration phase owns them, feature builders request changes against them.

---

## Illustrative example

> The example below is the shipped app scaffold (`_mc/templates/app-scaffold`), shown to apply the model in
> practice. A product's own features, paths and types will differ; read it for the *shape* of a seam.

**Layer 1 (types).** `src/lib/readiness/types.ts` defines the readiness shapes (`ReadinessItem`,
`ReadinessReport`, `ReadinessView`, …). The readiness board page renders them through
`src/lib/readiness/group.ts`, and the readiness action patches the checklist through
`src/lib/readiness/writeback.ts`; the page and the writer never import each other.

**Layer 2 (integration points).**

```
auth seam → sign-in and account pages
  Contract: isSupabaseConfigured(), createSupabaseBrowserClient()
  Producer: src/lib/supabase/{config,client}
  Consumers: src/app/auth/page.tsx, src/app/account/page.tsx
  Rule: The UI imports only what the seam exports (scripts/check-auth-seam.mjs asserts it).

auth seam → auth callback route
  Contract: createSupabaseServerClient(), isSupabaseConfigured(), safeNextUrl()
  Producer: src/lib/supabase/{server,config,safe-next}
  Consumer: src/app/auth/callback/route.ts
  Rule: The post-sign-in redirect comes from safeNextUrl(); the route builds only fixed error paths itself.

admin gate → admin actions
  Contract: requireFounderAdmin(), resolveAdminActor()
  Producer: src/lib/admin/config
  Consumers: src/app/admin/actions.ts, src/app/admin/readiness/actions.ts
  Rule: Every admin action checks the gate before it changes anything.

telemetry → pages
  Contract: track(event, props)
  Producer: src/lib/telemetry/track (its sink resolved by sink.ts)
  Consumer: src/app/page.tsx
  Rule: Pages call track(); only the sink knows where events go.
```

**Layer 3 (foundation utilities).** `src/lib/utils.ts` (`cn()`), the `src/components/ui/*` primitives and the
`src/lib/supabase/*` seam are the commons: feature builders request changes to them and do not edit them.
