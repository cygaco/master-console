---
description: Role-aware roadmap prioritization — runs /roadmap:cleanup first, then consults the Product Lead (single-product) or Director of Product (strategic) to rank the open roadmap into a clear do-next order, and applies the ordering content-preservingly.
---

# /roadmap:prioritize — Order the Roadmap (role-aware: Product Lead / Director of Product)

Turn a sprawling roadmap into a ranked **do-next** order. Runs `/roadmap:cleanup` first (so you prioritize a clean, current list), then hands the roadmap to the role-appropriate product manager — the **Product Lead** for execution-altitude prioritization, the **Director of Product** for strategic/cross-product ranking (see **Role routing** below) — to produce the ranking, and applies it to `ROADMAP.md` without losing content. Both personas carry the must-follow product principles defined in their specs (`.claude/agents/03-managers/{product-lead,director-of-product}.md` — referenced by pointer, not re-enumerated here, so this skill never drifts as principles are added, reordered, or reassigned).

## Role routing (deterministic — R2 altitude split)

Pick the consulting persona by the **scope** of the prioritization, per the altitude split (FINAL-PLAN §11 R2, β `EVT-org-roadmap-principles-beta-001`):

- **Single-product backlog ranking / within-sprint sequencing** → the **product-lead** persona. Signals: a single product's open backlog, ordering candidates inside one product/epic, "what's next in *this* sprint", `$ARGUMENTS` scoped to one product or sprint range (e.g. `"rank only the Sprint 11+ candidates"`).
- **Strategic / cross-product / lifecycle-phase-shift ranking** → the **director-of-product** persona. Signals: ranking that trades across products, a lifecycle-phase or pivot call, portfolio-level sequencing, "what should the *program* do next".
- **Fallback (R2 — no regression):** when the Product Lead *would* be chosen but the scope is ambiguous, **default to `director-of-product`**. The Director is also the standing default for MC's own framework roadmap (a single "product", but program-altitude) until a per-product Lead is explicitly in scope. Defaulting up never regresses behavior — the Lead inherits the Director's principles (R4), so a Director ranking is always at least as principled.

The chosen persona is read-only in both cases; this skill applies its ranking.

## Input

`$ARGUMENTS` — optional focus/constraint passed to the consulted persona (e.g. `"MC ships externally soon"`, `"we're pre-launch"`, `"rank only the Sprint 11+ candidates"`). If omitted, the persona ranks the whole open backlog grounded in canonical + lifecycle. The constraint also informs **Role routing** — e.g. a single-product/sprint-scoped `$ARGUMENTS` points to the Product Lead, a cross-product/strategic one to the Director of Product.

## Procedure

### Phase 1: Clean first
Run `/roadmap:cleanup` to detect completed/stale/duplicate entries and surface hidden urgencies. Apply only its **safe, unambiguous** recommendations (mark shipped items, drop exact duplicates); leave judgment calls for the consulted persona in Phase 2. You prioritize a clean list, not a stale one.

### Phase 2: Consult the role-appropriate product manager
Resolve the candidate agents from the skill-hook registry at call time: `node scripts/skills/skill-hook-points.js resolve roadmap:prioritize rank`. It returns both personas with their `condition` (single-product vs strategic) and the `default`. Pick per the **Role routing** rules above; when scope is ambiguous, dispatch the `default` role (the R2 no-regression fallback). Do NOT hardcode a role name. State which you chose and why in one line. Dispatch that persona and hand it:
- the cleaned `ROADMAP.md` (Epics + Sprint Pickup Queue + backlog),
- canonical intent (`_requirements/00-canonical/*` when present) + the lifecycle model (`.claude/project/reference/product-lifecycle.md`) + the playbook (`.claude/project/reference/playbook.md`),
- any `$ARGUMENTS` focus/constraint.

Ask it — applying its must-follow principles — to return:
- the **keystone** (the one item that unblocks the most),
- a **ranked "do-next" order** of the open candidates (top-N, each with a one-line rationale + which product goal / lifecycle phase it serves),
- a **defer / parked** bucket with reasons,
- **confidence + the one thing that would change the ranking**, and any **strategic/irreversible call escalated to the operator** (it decides those, the Director doesn't).

The Director is read-only — it returns judgment; this skill applies it.

### Phase 3: Apply the ordering (content-preserving)
Write the consulted persona's ranking into `ROADMAP.md` **without rewriting any entry's content** (below, "the manager" = whichever persona Role routing selected):
- **Default (safe + auditable):** at the top of the Sprint Pickup Queue, refresh a dated block — `### Prioritized order — roadmap:prioritize (<UTC YYYY-MM-DD>)` — and name the consulting persona on its first line (e.g. `_ranked by: Product Lead_` / `_ranked by: Director of Product_`). List the keystone + ranked top-N with one-line rationales, pointing at the existing entries by title. The heading is **persona-neutral on purpose**: a prior such block (from either persona) is matched by this stable prefix and **replaced** (idempotent), so re-running at a different altitude never stacks two blocks.
- **Optional (`--reorder`):** physically reorder the candidate list(s) to match the ranking — move entries verbatim, never edit their text; keep all `[shipped]`/`[open]`/`[partial]` markers intact.
- Record the manager's **confidence** + the "what would change it" note so the ranking is auditable.
- If the manager **escalated** a strategic question, surface it to the operator and DO NOT silently resolve it — mark the ranking **conditional** on that answer. (Per R2, the Product Lead escalates strategic/cross-product/lifecycle calls up to the Director of Product; either may escalate genuinely irreversible/business calls to the operator.)

### Phase 4: Regenerate manifests + report
`ROADMAP.md` is framework-tracked, so the regression-seed enforcer (BC-02/BC-05) reds on an un-regenerated edit. After applying:
```
node scripts/generate-framework-manifest.js && node scripts/mc/manifest/build.js
```
Then verify green (`node scripts/testsuite/enforce.js`) and report: which persona was consulted (Product Lead vs Director of Product) + why, the keystone, the ranked top-N, what got deferred, the manager's confidence, and any escalated decision the operator still owes.

## Notes
- The **consulted persona is the source of the judgment** (Product Lead for execution-altitude, Director of Product for strategic — see **Role routing**); this skill is the orchestration + the content-preserving apply.
- Pairs with `/roadmap:cleanup` (the Phase-1 audit), `/roadmap:add` (commit a new entry — role-neutral mechanical appender), `/roadmap:next` (the 1-item version of this), and `/roadmap:ideas` (generate candidates). The same R2 altitude split governs `next`/`ideas`/`create`.
- **High blast radius** — a full reorder of a strategic doc. When `$ARGUMENTS` scopes it (e.g. "only Sprint 11+ candidates"), keep the reorder within that scope. Prefer the default dated-block apply over `--reorder` unless the operator wants the list physically resequenced.
- Portable: ships to products too — the consulted persona grounds in *that* project's canonical, so the skill works in any MC-installed repo.
