---
guide: README-COPY
anchor: none
shape: notice
timing: reference
lead_time: "none"
---

# MC Copy Store — voice + high-leverage copy

> This is a **store domain**, not a guide library: a per-product runtime data store that holds the house **voice** and the **high-leverage copy** — the *argument* (not the words), the **hooks**, and the **≤6 Necessary Beliefs** the prospect must hold before buying. It is the persuasion truth the rest of the Growth chain draws on.
>
> **Canonical ships this EMPTY.** This directory is scaffolding — zero copy artifacts. The store is populated **at runtime**, per product, by the producer below. Consumers draw from it at runtime (not via prompt-baked marker blocks).
>
> **Schema / contract:** none yet (`schema_ref: null`) — the contract is the producer spec (`copy-lead.md`) plus this README.
> **Machine-readable domain card:** `_knowledge/copy/_domain.json` (producer · consumers).

---

## What this store holds

The **argument, not the copy** (Agora / E5 — "argument creators, not copy creators"), plus the artifacts that carry it:

- **Voice** — the house voice/tone the product's copy speaks in; clear over clever (5th–8th-grade reading level).
- **The argument** — the single **North-Star belief** that pre-sells the offer, and the **unique mechanism** that proves the solution is *different and better* with an airtight logical **and** emotional case. Better verbs are layered in later, in editing — never as a substitute for the argument.
- **Hooks** — the scroll-stoppers, judged by the "**PIG**" (punch-in-the-gut) / scroll-stopper test and grounded in real voice-of-customer language. The hook is ~90% of the effort.
- **The ≤6 Necessary Beliefs** — the "I believe that…" statements (derived from the avatar + offer + research) the prospect must hold before buying. **≤6, each source-grounded** — no invented data, every claim inside the product-verifiable claims boundary.

These mirror `copy-lead.md`; this README invents no new principles.

---

## Producer · consumers

| Role | Relationship |
|---|---|
| **Producer** | `copy-lead` — the direct-response copy persona under the Director of Marketing. Read-only by construction; it judges, scores, and tightens (incl. the "Chief" coherence gate) — it is not the writer of record and does not approve its own work. |
| **Consumers** | `conversion-lead`, `director-of-growth` — the downstream Growth roles that ground their work in the voice + argument seeded here. |

---

## The COPY.md-contract relationship

Copy reaches builders **as a `COPY.md` contract authored FROM this store — never invented at build time.** This is the load-bearing seam:

- `copy-lead` seeds this store with the voice, argument, hooks, and Necessary Beliefs (grounded in the `audience_dossier` from `_knowledge/audience` + the `message_brief`).
- When a build needs copy, the `COPY.md` contract is authored **from** the store's artifacts and handed to the builder.
- A builder therefore does **not** improvise copy — it consumes a `COPY.md` derived from this grounded store, keeping the shipped words traceable to the argument and inside the claims boundary.

The "Chief" coherence review (the producer's editor-in-chief gate — avatar / proof / beliefs / consciousness / objections / clarity / claims) is what keeps the copy in this store coherent before it ever becomes a contract.

---

*A MC `_knowledge/` store domain — framework-generic and canonical (no product content). Populated per product at runtime by `copy-lead`; empty scaffolding in canonical. Contract: `copy-lead.md` + this README (no JSON schema yet).*
