# Product — Evolution Tracker

System capabilities achieved and roadmap for what comes next. Ordered by dependency, not chronology.

---

## Achieved

### Foundation
- [x] Project instructions (CLAUDE.md) with autonomy boundaries
- [x] Git branching strategy (skeleton-test1 through test7)
- [x] Environment setup (Next.js 16, Turbopack, Vercel)

### Spec Pipeline
- [x] Canonical requirement documents (_requirements/00-canonical/)
- [x] PRDs for all 13 features
- [x] High-level stories for all 13 features
- [x] Granular stories with agentic metadata (Depends on, Entry state, Verifiable by)
- [x] Copy specs for all 13 features
- [x] Regen gap docs (PROMPT_TEMPLATES, DESIGN_TOKENS, VALIDATION_RULES, etc.)

### Agent System
- [x] Multi-agent architecture (boss/builder/evaluator/security/lead)
- [x] File ownership enforcement (store.json features[*].files + ownership-guard hook)
- [x] Task manifest and feature store (store.json)
- [x] Agent contracts with typed briefs (ReviewResult, SecurityResult JSON)
- [x] Cross-model evaluation (Haiku enhancement, Opus building, cross-model judging)

### Hooks & Policy
- [x] Pre-tool-use hooks (gate-check, prompt-enhancer, context-enhancer)
- [x] Post-tool-use hooks (edit-watcher, systems-sync)
- [x] 27 hooks total, 4 shared modules
- [x] Policy enforcement via hooks (not just advisory)

### Memory & Learning
- [x] Centralized event log (events.jsonl) — append-only by convention
- [x] Spec edit tracking with before/after diffs
- [x] Reasoning traces with framework selection logging (traces.jsonl)
- [x] Learning lifecycle: logged → validated → implemented
- [x] Learning target range (60-100 active) to prevent landfill
- [x] Fix quality scoring (0-4) with retroactive reclassification
- [x] Systems manifest (28 entries, structured health tracking)

### Maps & Observability
- [x] 7 map types (enforcements, skills, hooks, memory, tools, architecture, all)
- [x] Dual-format maps (JSONL + MD)
- [x] Auto-staleness detection via systems-sync
- [x] Enforcement gap tracking (76 gaps, 70 closed)

### Drift Detection
- [x] Spec change event sourcing (category: spec)
- [x] STALE marker tracking across spec files
- [x] Unpropagated change detection
- [x] /scan:requirements with drift mode

### Self-Modification
- [x] Modification logging (category: modification)
- [x] Skill creation from repeated patterns (/skills:create)
- [x] Skill cleanup and audit (/skills:cleanup)
- [x] 61 registered skills across namespaces

### Reasoning Engine
- [x] Problem classification table (8 types)
- [x] Framework router (14 frameworks mapped to signals)
- [x] Meta-reasoning protocol (why this framework? symptom or cause?)
- [x] Decision logs via edit-watcher

---

## In Progress

### Drift Management
- [x] Drift classification v1: 4-tier system based on PRECEDENCE.json level delta
- [x] Drift classification v2: source-type-aware rules (GLOSSARY=COSMETIC, STORIES→INPUTS=DANGER, etc.)
- [x] Fixture drift tracking: holdout-safe hash comparison, no STALE marker leakage
- [x] Confidence tracking: resolution outcome logging, per-pattern accuracy stats
- [~] Spec-to-code traceability exists but breaks on refactors
- [x] edit-watcher cascade fix: `isStaleOnlyChange()` detects STALE-only edits and skips consumer cascade (commit b42e3e3)

### Evaluation
- [~] Golden fixtures exist but not comprehensive — need per-screen state fixtures ("on this screen: user has X, system has Y, data looks like Z")
- [ ] Expand fixtures beyond output shape: full screen-state snapshots (session data, user profile, API responses, UI state) so evaluators can verify the whole picture, not just one field
- [~] Evaluator agents run post-build but not continuously

### Skill Lifecycle
- [~] Skills can be created and cleaned up; no draft → shadow → production pipeline
- [~] No automated validation against historical cases

### Governance
- [x] Event log is append-only — enforced by memory-guard.js hook
- [~] Policy lives in hooks, not declared separately from mechanism
- [~] No hash-chain integrity verification
- [~] No compliance query tool
- [ ] Hook allowlist audit: scan all hooks for overly broad blocking patterns (memory-guard blocked git because it matched filenames in command strings before checking if the command was safe — fixed for git, but other hooks may have similar false-positive classes)

---

## Roadmap

### Phase 1: Audit Integrity
- [x] Hook guard: block Edit/Write to events.jsonl except via logger (memory-guard.js)
- [ ] Hash-chain entries (each line includes prev_hash)
- [ ] Periodic integrity checker (detect tampering)
- [x] Logger as sole write path — enforced by memory-guard.js

### Phase 2: Governance Framework
- [ ] Policy-as-code: separate policy declarations from enforcement hooks
- [ ] Access control matrix (queryable: who can do what, under what conditions)
- [ ] Compliance query tool (actions on file X in last N days, who authorized, which policy)
- [ ] Immutable audit trail with tamper detection

### Phase 3: Pattern Detection
- [ ] Trace clustering (scan traces.jsonl for repeated action sequences)
- [ ] "You've done this N times" alerts during /sleep or /retro
- [ ] Skill candidate proposals from detected patterns
- [ ] Change impact analysis (automated: "if I modify this, what else breaks?")

### Phase 4: Skill Autonomy
- [ ] Skill lifecycle: draft → shadow → production
- [ ] Auto-validation against historical cases before promotion
- [ ] Kill switch for underperforming skills
- [ ] Versioned skills with rollback
- [ ] Autonomous skill synthesis from pattern detection

### Phase 5: Operational Maturity
- [ ] Cost tracking per workflow, per tool, per agent
- [ ] Latency budgets and escalation rules
- [x] Drift classification (CLEAR / COSMETIC / REVIEW / DANGER)
- [ ] Auto-rollback on confidence failure
- [ ] Synthetic bug injection for resilience testing
- [ ] State recovery after interruption
- [ ] Sleep phase checkpointing (breadcrumbs before generative phases — learned from cycle 5 crash)

### Phase 6: Closed-Loop Intelligence
- [ ] Continuous self-evaluation after every material change
- [ ] Self-healing loops with bounded authority
- [ ] Shadow agents evaluating main agents
- [ ] Canary runs for new prompts, hooks, and skills
- [ ] Measuring whether the system actually got smarter
- [ ] Stable regeneration across long time horizons

### Phase 7: Platform
- [ ] Cross-project reusable infrastructure (MC proven)
- [ ] Business workflows, not just coding workflows
- [ ] Organization-scale agent platform
- [ ] Product factory mode

---

## Milestones (Unlockable)

These aren't tasks — they're outcomes that emerge when the phases above land.

- [ ] First clean regen build on one try
- [ ] First fix the system makes before the user notices
- [ ] Someone else onboards from docs alone
- [ ] The system builds a feature not explicitly specced
- [ ] "This was never about prompting."
