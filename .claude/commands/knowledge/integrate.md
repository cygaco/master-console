---
description: Wire each _knowledge/ domain into its consumers in its declared shape — LIBRARY domains via a knowledge-marker block in every consumer agent spec, STORE domains via a producer-spec store reference + contract README — and record every placement in .claude/project/maps/knowledge-integration.jsonl. Idempotent, read-before-write, with prior-integration conflict detection.
---

# /knowledge:integrate — Place knowledge domains into their consumers

Read the domain registry (`_knowledge/registry.json`, rebuilt from each `_knowledge/<domain>/_domain.json`) and **ground each consumer in the knowledge it's owed** — but the *shape* of that grounding depends on the domain's `kind`:

- **LIBRARY** (e.g. `design`) — framework training-reference files. Ground each declared consumer by inserting a **knowledge-marker block** into its *agent spec* (`paths.agents`/…): an OPEN/CLOSE HTML-comment pair fencing a short grounding section that points at the library's index + overview. The marker is prompt-baked — the agent reads it on every invocation.
- **STORE** (e.g. `audience`, `copy`) — a per-product *runtime data store* drawn at runtime, not prompt-baked. There is **NO marker block**. Instead, ensure the **producer's** spec references the store path (e.g. `research-lead` → `_knowledge/audience`) and the **contract README** (`_knowledge/<domain>/README.md`) exists, so producer and consumers share one contract.

Every placement is recorded so the operation is **idempotent** and **auditable**, and re-running detects + resolves conflicts (a drifted marker, a moved consumer) instead of duplicating grounding.

> Like its sibling `/guides:integrate`, this skill wires the **dev-tooling layer** (it mutates agent specs under `paths.agents`, reversible, and writes the recording store) — it does not author the knowledge itself (that's the library files / the runtime producer). Run `node scripts/knowledge/registry.js` first (via `/knowledge:coverage` or directly) so the registry is fresh before you wire from it.

## Input

`$ARGUMENTS` (all optional):
- `--dry-run` — compute + report the placements and conflicts; write nothing (no spec edits, no ledger append).
- `--domain <name>` — integrate just one domain (e.g. `--domain design`).
- `--rebuild` — re-derive all placements from the registry, superseding stale records and re-reconciling every marker (use after a domain's `consumers[]` or `kind` changes in its `_domain.json`).

## The recording system (the heart of this skill)

`.claude/project/maps/knowledge-integration.jsonl` (`paths.maps`/knowledge-integration.jsonl) — **append-only**, one record per domain×consumer placement (LIBRARY) or domain×producer placement (STORE):

```json
{"domain":"design","kind":"library","role":"design-lead","spec":".claude/agents/product/design-lead.md","marker":"knowledge:design role:design-lead","inserted_at":"YYYY-MM-DDTHH:MM:SSZ","status":"active","conflicts_resolved":[]}
```

```json
{"domain":"audience","kind":"store","role":"research-lead","spec":".claude/agents/growth/research-lead.md","store_ref":"_knowledge/audience","contract":"_knowledge/audience/README.md","inserted_at":"YYYY-MM-DDTHH:MM:SSZ","status":"active","conflicts_resolved":[]}
```

- `status`: `active` (currently wired) | `superseded` (the consumer left `consumers[]`, or the domain's `kind` flipped; the old record stays for the audit trail).
- `conflicts_resolved`: list of what re-integration had to reconcile (e.g. `"re-fenced drifted marker for design-quality"`, `"superseded copy-lead (no longer a design consumer)"`).
- LIBRARY records carry `marker` (the greppable contract — see grammar below); STORE records carry `store_ref` + `contract` and **never** a `marker`.

**READ THIS FILE FIRST, every run.** It is the idempotency + conflict-detection ledger — never blind-append a placement you already made. If it doesn't exist yet (first run), treat the active set as empty and create it on first write.

## The marker grammar (LIBRARY only — must match the coverage enforcer byte-for-byte)

The knowledge-marker block fences a grounding section in a consumer spec. The greppable contract the enforcer keys off is the **OPEN-marker prefix** + the **CLOSE marker**:

- **OPEN:**  `<!-- knowledge:<domain> role:<role> (grounding — training references, <do-not-weaken clause>) -->`
- **CLOSE:** `<!-- /knowledge:<domain> role:<role> -->`

The stable, machine-matched part is the prefix `<!-- knowledge:<domain> role:<role>` (OPEN) and the full CLOSE line. The parenthetical's `<do-not-weaken clause>` is **role-shaped** to the consumer's lane and must read naturally for that role — match what already lives on disk:
- doer/advisory roles → `do not weaken existing grounding` (e.g. design-lead, conversion-lead)
- a gate role → `do not weaken existing gate` (e.g. design-quality)
- a review role → `do not weaken existing review` (e.g. visual-review)

Between OPEN and CLOSE sits the grounding prose: a `### <Domain> … (training references)` heading, a one-paragraph pointer at the library's index (`_knowledge/<domain>/registry.json`) + overview (`_knowledge/<domain>/README.md`), and an "apply each guide's §6 RULES in your own finding vocabulary" line. **The block grounds; it never overrides the consumer's own output contract, principles, or lenses** — say so inside the fence (the parenthetical's "do not weaken" clause is the load-bearing promise).

## The domain → target map

| domain `kind` | target (per declared role) | what gets placed | recorded as |
|---|---|---|---|
| `library` | each `consumers[]` role's **agent spec** (`paths.agents`/…) | OPEN/CLOSE marker block fencing a grounding section | one record per consumer, with `marker` |
| `store` | the **`producer`** role's **agent spec** | a prose reference to the store path (`_knowledge/<domain>`) **+** the contract README at `_knowledge/<domain>/README.md` | one record for the producer, with `store_ref` + `contract`, **no** `marker` |

Resolve a role slug → spec path the same way the registry does (the `paths.orgRoleRegistry` `.claude/agents/_org/role-registry.json` carries each role's `spec`); a role that the registry validates is guaranteed to resolve.

## Procedure

### Step 1 — Load registry + ledger
Read `_knowledge/registry.json`. If stale, rebuild it first: `node scripts/knowledge/registry.js` (the shared engine; never hand-edit the registry). Read the full `knowledge-integration.jsonl` and build the current placement state from `status:active` records. If `--domain <name>`, narrow to that one domain.

### Step 2 — Compute the desired placement set
For each registry domain, branch on `kind`:

**LIBRARY** — for each role in `consumers[]`, resolve its spec and compare to the active ledger:
- **new** — no active record for this domain×role → insert a marker block.
- **unchanged** — active record + a well-formed marker block already present in the spec → skip (idempotent).
- **drifted** — active record exists but the on-disk block is malformed, moved, or the role-shaped clause is wrong → **supersede** the old record, re-fence the block in place (read the existing fence, reconcile, rewrite — never stack a second copy), log it in `conflicts_resolved`.
- **dropped** — an active record names a role no longer in `consumers[]` (or the domain flipped to `store`) → supersede the record and remove its marker block from the spec.

**STORE** — resolve the `producer` spec and confirm two things:
- the spec **references the store path** `_knowledge/<domain>` (insert a one-line reference in the producer's input/output frame if missing; skip if present — idempotent).
- the **contract README** `_knowledge/<domain>/README.md` exists (create a minimal contract stub from the `_domain.json` — producer, consumers, `schema_ref`, what the store holds, NO-PII note — if absent; never overwrite an existing README).
A store consumer is **never** edited — consumers draw at runtime; only the producer + contract are wired.

> **Idempotency note for STORE.** A producer spec may already carry the reference (e.g. `research-lead` already names `_knowledge/audience`). Detect the existing reference before inserting — record the placement as `unchanged` rather than appending a duplicate sentence.

### Step 3 — Place markers / references (unless `--dry-run`)
- **LIBRARY:** at the consumer spec's grounding region (inside its "Input frame / what you ground in" section, after the project-grounding bullets — where the live `design`-marker blocks sit), insert the OPEN marker, the grounding section, then the CLOSE marker. Match the role-shaped clause. **Read-before-write**: if any fence with this domain×role already exists, reconcile it (drifted path) instead of appending — duplicating a block is the failure mode this skill exists to prevent.
- **STORE:** insert the store-path reference into the producer spec (if missing) and write the contract README (if missing). No marker block — ever.

### Step 4 — Record
Append/supersede records in `knowledge-integration.jsonl` so it reflects the new active set. Set `inserted_at`; fill `conflicts_resolved` for any drift/drop. LIBRARY records carry `marker`; STORE records carry `store_ref` + `contract`.

### Step 5 — Verify + report
Run `node scripts/checks/knowledge-coverage.js` and report its result. It asserts: registry fresh; every LIBRARY consumer carries a well-formed marker block (OPEN+CLOSE, role-shaped); every STORE producer references its store path + the contract README exists; no orphan records (a record whose marker/reference is gone) and no orphan markers (a marker with no backing active record). **A green coverage run is the done-gate.** Report: placements made (new / re-fenced / skipped / superseded), conflicts resolved, library-vs-store breakdown, and the coverage exit code. Treat a runner error (exit 2) as a failure to investigate, never a pass.

## Reuses / does not duplicate
- `scripts/knowledge/registry.js` — the registry read + the shared `_domain.json` parser / role-set validation. Never re-parse `_domain.json` by hand; never hand-edit `_knowledge/registry.json`.
- `scripts/checks/knowledge-coverage.js` — the Step-5 verify + the standing enforcer.
- Companion: `/knowledge:coverage` (the fail-closed backstop — proves the whole chain is complete + honest). Sibling pattern: `/guides:integrate` (same recording + read-before-write discipline, single-shape; this skill adds the library-vs-store branch).

## Anti-patterns
- **Don't blind-append** — READ the ledger first; re-running must be idempotent (the recurring "contract defined but not applied / applied twice" drift).
- **Don't put a marker block on a STORE domain** — stores are runtime data drawn at runtime; a prompt-baked marker would stale-bake per-product data into the framework. STORE = producer reference + contract README only.
- **Don't duplicate a LIBRARY block** — if a fence for this domain×role exists, reconcile it in place; never stack a second copy.
- **Don't insert an OPEN without its CLOSE, or mismatch the role-shaped clause** — the coverage enforcer keys off the OPEN prefix + the CLOSE line; a half-fenced or wrong-clause block fails enforcement (and a block with no backing ledger record is an orphan marker).
- **Don't weaken existing grounding** — the block adds references; it never overrides the consumer's own output contract, principles, or lenses (that's the parenthetical's promise).
- **Don't wire a STORE consumer's spec** — only the producer + the contract README; consumers draw at runtime.
- **Don't hand-edit the registry or the jsonl to "fix" a failure** — re-run the registry build / this skill so the source of truth (the `_domain.json` files + real placements) drives the index.
