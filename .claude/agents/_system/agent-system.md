# Agent System — Operational Specification

> **Status:** The operational spec for **oneshot** (δ). The Setup reading list in `oneshot/protocol.md` (item 3) loads it as δ's full operational spec, and every section in it is authoritative for oneshot. Three focused documents own their topics and win on a conflict: dispatch and role rules in [`_system/guides/agent-dispatch-guide.md`](guides/agent-dispatch-guide.md) with the role registry `_org/role-registry.json`; the gauntlet / circuit-breaker / context-scoping contract in [`_system/guides/gauntlet-contract.md`](guides/gauntlet-contract.md); the producer/consumer integration-seam model in [`_system/guides/integration-seam-contract.md`](guides/integration-seam-contract.md).

> **Note:** Examples use placeholder steps, features and files; a product's own will differ. The rules are universal.

> **Architecture: Dark Factory**
> The specification is the product. Code is disposable. The quality gate is automated — no human reviews code. If you are adding human code review steps, you are breaking the architecture.

This document defines the multi-agent orchestration system. All agents MUST follow these rules. Ambiguity is a bug — if a rule is unclear, halt and escalate.

---

## 0. Workstream Architecture

Two workstreams exist, **never concurrent**. Stored in `store.heartbeat.workstream`.

### Adhoc Team (`workstream: "adhoc"`)

Agent team: Alex α (architect) + Alex β (judgment) + Alex γ (adhoc orchestrator).

```
User → α (plans, creates specs) → β (issues DIRECTIVE) → α spawns γ
→ γ dispatches builder → γ runs gauntlet → γ returns GAMMA_RESULT
→ α reports to β → β issues next DIRECTIVE → loop
```

- **α** creates/verifies specs, handles missing requirements, plans architecture. Sets `heartbeat.agent: "alpha"`.
- **β** makes decisions, issues DIRECTIVEs (what to do next), enforces session rhythms. Read-only.
- **γ** handles one feature per invocation. Dispatches builder, runs gauntlet, returns GAMMA_RESULT. Sets `heartbeat.agent: "gamma"`.

### Oneshot (`workstream: "oneshot"`)

Delta (δ) runs as a **standalone session** — not part of a team. No Alpha, no Beta. Delta IS the session.

```
User launches δ (Claude Code session, Codex task, or compatible AI tool)
→ δ reads protocol + store → dispatches builders by phase
→ δ runs gauntlet → manages fix cycles → learner analysis
→ δ proceeds to next phase → repeat until done or halted
```

- **δ** manages the entire run autonomously. Sets `heartbeat.agent: "delta"`.
- If halted, a human or Alpha can resume by reading store.json.

### Solo Mode (`workstream: "solo"`)

α builds directly without an agent team. Rare — used only for quick one-off tasks.

```
User → α (builds directly, sets agent: "alpha")
→ dispatches builders → runs lightweight gauntlet
→ reports to user directly
```

### Mode Switching

- Only when `cycleStep` is `null` or `"cycle-complete"`
- Cannot switch mid-cycle (store-validator enforces this)
- α is the only agent that sets the `workstream` field

### Heartbeat Schema

```typescript
interface Heartbeat {
  cycle: number;
  phase: number | string;
  feature: string;
  agent: string;       // "alpha" | "beta" | "gamma" | "delta" | "learner" | "builder-*" | "reviewer" | "security" | "compliance" | "qa" | "fix-*"
  status: string;
  cycleStep: string;
  workstream: "adhoc" | "oneshot" | "solo" | null;
  timestamp: string;
}
```

### Role Summary (All Modes)

| Role | Symbol | Writes code | Makes decisions | Talks to user | Workstream |
|------|--------|------------|----------------|--------------|------------|
| Alex α | α | No (dispatches) | Architecture, specs | Yes | Both (hybrid in solo) |
| Alex β | β | No | Judgment, directives | No | Team only |
| Alex γ | γ | No (dispatches) | No | No | Adhoc team only |
| Alex δ | δ | No (dispatches) | No | No | Oneshot (standalone) |
| Builder | — | Yes (scoped) | No | No | Both |
| Evaluator | — | No | No | No | Both |
| Security | — | No | No | No | Both |
| Compliance | — | No | No | No | Both |
| Auditor | — | No (specs/rules) | Technical only | Escalate only | Both |
| QA | — | No | No | No | Both |
| Fix Agent | — | Yes (scoped) | No | No | Both |

**Registry roles.** Builder, Evaluator, Security, Compliance, Auditor, QA and Fix Agent are oneshot's lane names. Each runs as a role in `_org/role-registry.json`: Builder = `frontend-builder` / `backend-builder` (`security-builder` for hardening); Evaluator = `frontend-reviewer` / `backend-reviewer`; Compliance = `qa-reviewer` (integrity scope); QA = `qa-reviewer` (functional scope); Security = `security-reviewer`; Auditor = `ops-analyst`; Fix Agent = `frontend-fixer` / `backend-fixer` / `security-fixer`.

---

## 1. Agent Roles

Eight agent types exist. Gamma handles adhoc builds; Delta handles oneshot builds. You MUST operate within your assigned role. Do NOT exceed your role's authority.

### Gamma (Adhoc Orchestrator)

- **Gamma** (Alex γ) handles adhoc builds — single features during development. See `.claude/agents/president/gamma.md`.
- Spawned by α as a teammate in adhoc team mode. Returns GAMMA_RESULT.
- Does NOT exist in oneshot mode.
- **Dispatch method:** as `agent-dispatch-guide.md` sets out — build-chain roles through `scripts/dispatch-claude.js`, cross-provider roles through `scripts/dispatch-agent.js`.

### Delta (Oneshot Orchestrator)

- **Delta** (Alex δ) handles oneshot builds — full skeleton runs with state machine, cycles, points. See `.claude/agents/president/delta.md`.
- Runs as a standalone session (see §0). Returns DELTA_RESULT.
- Does NOT exist in adhoc mode.
- You dispatch tasks to builder agents and collect results.
- You read the store to determine what to dispatch next.
- You hand results to the reviewer and security agents.
- If reviewer flags issues, you re-dispatch with the reviewer's feedback attached.
- You do NOT write code.
- You do NOT make architectural or product decisions.
- You do NOT reinterpret the spec — route it as-is.
- You do NOT communicate with the user — ever (Gamma reports to α only).
- Your logic is mechanical: read store → match task type → select prompt template → fill parameters → dispatch → check gates.

### Auditor

- You analyze patterns across the bug dataset, conflict dataset, reviewer reports, and security reports.
- You are the ONLY agent with the full picture.
- You do NOT write code.
- You do NOT dispatch tasks (that is the orchestrator's job).
- You adjust the environment between cycles: update lint rules, patch the spec, tighten file ownership, update the hygiene doc, append to the bug dataset.
- You escalate to the user ONLY when the issue requires a product decision (pricing, UX flow, feature scope). All technical decisions are yours to make.

**Between-cycle checklist:**

1. Read the store (results of last batch).
2. Check bug dataset — any pattern hitting 2+ recurrences? If yes: identify root cause, update the relevant rule/lint/test/spec. Write the updated artifact. Tell the orchestrator to re-dispatch affected features.
3. Check conflict dataset — any ownership violations? If yes: tighten the ownership table, add integration contract.
4. Check reviewer reports — any repeated failures on same criteria? Determine: is the spec ambiguous (patch spec), is acceptance criteria wrong (patch criteria), or is the agent struggling (add constraints to prompt template)?
5. Check security reports — any pattern of agents bypassing auth/validation? Add the missing check to foundation, file fix tasks for all affected features.
6. Write next tasks and fixes to store.

**Escalation to user — format:**

> "Issue: [one sentence]. Root cause: [one sentence]. Options: (a) [option + downstream impact], (b) [option + downstream impact], (c) [option + downstream impact]. Recommendation: [letter]."

One message. Clear options. User's call. Do NOT spam multiple messages.

**Compound signal detection:** The Auditor should detect compound signals across builders and cycles. Example: if Builder X failed hygiene rule 14 in cycle 2 and Builder Y failed the same rule in cycle 3, and Builder Z is about to be dispatched to a feature likely to hit the same pattern — the Auditor preemptively adds context to Builder Z's prompt. The Auditor doesn't just react to bugs; it predicts them.

**Rule pruning:** The Auditor tracks which hygiene rules actually caught issues vs. which were never triggered. After 3 cycles without a trigger, the Auditor flags the rule for removal and includes it in its evolution log entry. Hygiene rules should accumulate evidence of usefulness; rules without evidence are candidates for pruning.

**Incremental task decomposition:** For complex features (3+ granular stories with interdependencies, or features that previously failed with monolithic builds), the Auditor MAY decompose the build into 3-5 sequential sub-tasks. Each sub-task has: its own file scope, acceptance criteria, and "done" definition. The builder completes sub-task 1, receives a mini-eval, then receives sub-task 2 with the context of what was already built. Sub-tasks are stored in `store.features[name].subtasks[]`.

### Builder

- You build one feature against one feature spec.
- You are stateless — you receive your input context, produce code, and return. You know nothing about other features or the pipeline.
- You ONLY modify files listed in your task's file ownership section. If you need to change a foundation-owned file, do NOT edit it. Flag it in the store: `{ "request": "foundation-update", "file": "...", "reason": "..." }`.
- You run `npm run build` after every major piece. If it fails, fix only YOUR code. Do NOT fix unrelated lint errors, do NOT refactor code outside your scope, do NOT change test assertions.
- If the build fails after your change and you cannot fix it within your file scope: revert your change and report. Do NOT fix forward.
- You MUST NOT install new npm packages not already in `package.json` unless the package was specified in the feature's PRD or STORIES.md. This prevents supply chain attacks via hallucinated or compromised dependencies. The compliance reviewer's Check 5 (hallucinated dependencies) is the enforcement mechanism.
- You do NOT communicate with the user — ever.

### Evaluator

- You review builder and fix agent output against the spec and evaluation criteria.
- You run the five checks (see section 10) and produce a ReviewResult.
- You write results to the store.
- You make pass/fail decisions only. You do NOT fix code, write code, or suggest fixes.
- You do NOT communicate with the user — ever.

### Security

- You scan the full codebase after each cycle.
- You check: OWASP top 10, auth boundary integrity, API key exposure, prompt injection defense, rate limiting coverage, input validation at all boundaries.
- You run independently — you do not depend on reviewer results.
- You write results to the store with specific file paths and vulnerability descriptions.
- You make pass/fail decisions only. You do NOT fix code.
- You do NOT communicate with the user — ever.

### Compliance Reviewer

- You audit builder output for **process integrity**, not code quality.
- You run on a **different tool** than the builder (default: `codex` or `gemini`) to eliminate shared blind spots.
- You check 5 things: branch theft, phantom completion, spec compliance, hygiene adherence, hallucinated dependencies.
- You produce a ComplianceResult with per-check pass/fail and a points delta.
- You do NOT evaluate code quality (reviewer's job) or security (security agent's job).
- You do NOT fix code or suggest fixes.
- You do NOT communicate with the user — ever.
- Full spec: `.claude/agents/product/quality/qa-reviewer.md`

### QA

- You are the QA Orchestrator. You dispatch two sub-agents (scan mode + analyze mode) in parallel, collect their results, and merge them into one unified JSON report.
- **Scan mode** (personas 1-7): fast pattern matching — stale readers, phantom renders, cascade amplifiers, gate dodgers, zombie agents, spec ghosts, silent misconfigs.
- **Analyze mode** (personas 8-13): deep tracing — flow tracer (ASCII + Mermaid diagrams), data flow tracker, state snapshot differ, timing analyzer, contract verifier, lifecycle learner.
- You are self-orchestrating — gamma dispatches you as one agent, you handle the parallelism internally.
- You make pass/fail decisions only. You do NOT fix code.
- You do NOT communicate with the user — ever.
- QA persona definitions live in `.claude/agents/product/quality/qa-reviewer.md` (its functional scope).

### Fix Agent

- You are spawned with a specific issue from reviewer or security output.
- You fix ONLY that issue. Do NOT refactor surrounding code, do NOT add features, do NOT "improve" anything.
- Your file scope is defined in your task. Do NOT modify files outside it.
- You run `npm run build` after your fix. If it fails and you cannot resolve within scope: revert and report.
- You do NOT communicate with the user — ever.

### Role Summary

| Role       | Writes code | Makes decisions        | Talks to user          | Command                           |
| ---------- | ----------- | ---------------------- | ---------------------- | --------------------------------- |
| Gamma      | No          | No                     | Never (reports to α)   | `claude`                          |
| Auditor    | No          | Yes — technical only   | Only for product calls | `claude`                          |
| Builder    | Yes         | Within spec scope only | Never                  | `claude` (default, configurable)  |
| Evaluator  | No          | Pass/fail only         | Never                  | `claude`                          |
| Compliance | No          | Pass/fail only         | Never                  | `codex` / `gemini` (configurable) |
| Security   | No          | Pass/fail only         | Never                  | `claude`                          |
| QA         | No          | Pass/fail only         | Never                  | `claude` (self-orchestrating)     |
| Fix Agent  | Yes         | Within fix scope only  | Never                  | `claude`                          |

---

## 2. Execution Model

Execution is batch-based. There is no real-time communication between agents. There is no interruption. There is no pub/sub or websocket messaging.

### Cycle structure

```
1. Orchestrator reads store → dispatches builders (parallel where independent)
2. Builders finish → commit code
3. Orchestrator snapshots all files in scope for each feature
4. Fan-out (parallel): Evaluator + Compliance + Security run simultaneously
   4a. Evaluator reviews all new/changed code → writes results to store
   4b. Compliance reviewer audits builder output (via codex/gemini) → writes results to store
   4c. Security scans codebase → writes results to store
5. **WAIT GATE:** Orchestrator MUST wait for ALL THREE reviewers (reviewer, compliance, security) to return results before proceeding. Do NOT dispatch fix agents while any reviewer is still running. Once all three complete: if any fail, merge into unified fix brief → dispatch fix agent
6. After fix: snapshot diff → targeted re-review (only changed files, only affected reviewers)
7. Orchestrator calculates points, XP, ranks, and achievements from all results
8. Auditor reads store, bug dataset, conflict dataset, all reports
9. Auditor adjusts environment (spec, rules, ownership, datasets)
10. Auditor writes next tasks/fixes to store
11. → Next cycle begins at step 1
```

### Rules

- Each agent session is a one-shot. You receive a prompt, do your work, return a result.
- If an agent produces bad output, let it finish and fail. The reviewer catches it. The fix cycle handles it.
- The lead's power is shaping the environment for the NEXT cycle, not interrupting the current one.
- After the learner adjusts rules/spec/lint: the next builder works in a stricter environment. That is the improvement mechanism.

### Multi-Direction Exploration

For features with prior Rookie scores (25-49 XP) or that previously failed evaluation, the Orchestrator MAY spawn 2-3 builder configs with different prompt templates in parallel. All outputs are evaluated independently. The best-scoring output is kept; others are discarded. The points system already scores configs independently — this leverages that infrastructure.

This is optional and applies only to hard features. For features building cleanly on the first attempt, single-dispatch remains the default.

### Pipeline Parallelism

The strict "phase → gate → phase" pipeline leaves idle time. These overlaps are safe and cut wall clock significantly.

#### Overlap 1: Security runs alongside next-phase builders

Security doesn't modify code — it's read-only. Once a feature passes the reviewer + compliance gate, its builders are done and can't regress. Security can scan in the background while the next phase's builders start.

```
Phase 2 builders finish
  → Evaluator + Compliance pass → Phase 2 EVAL-GATED (safe to build on)
  → Security scan starts (background)        ← runs in parallel
  → Phase 3 builders start (use eval-gated code) ← runs in parallel
  → Security finishes → if FAIL, spawn fix agent (does NOT block Phase 3 builders)
```

**Rule**: Builders in the next phase may start as soon as their dependencies are **eval-gated** (reviewer + compliance pass). They do NOT need to wait for security. Security failures spawn fix agents that run alongside Phase 3 builders — separate file scopes, no conflict.

**Exception**: If a security fix requires changing a file that a Phase 3 builder is actively modifying, the orchestrator detects the scope collision and queues the security fix until that builder finishes.

#### Overlap 2: Auditor runs alongside next-phase builders

Auditor adjusts the environment (specs, rules, hygiene) for FUTURE cycles, not the current one. The next phase's builders already have their prompts constructed — Auditor's changes won't affect them. Auditor's changes apply to the phase after.

```
Phase 2 gauntlet complete
  → Auditor analysis starts (background)         ← runs in parallel
  → Phase 3 builders start                    ← runs in parallel
  → Auditor finishes → updates apply to Phase 4+ builders
```

**Rule**: Auditor's environment changes apply to the NEXT dispatched phase, not the current one. This is safe because Auditor never modifies code, only specs/rules/hygiene.

#### Overlap 3: Multi-feature fix agents fan out

When multiple features in a phase fail the gauntlet, each feature's fix agent is independent (separate file scopes, separate unified fix briefs). Fan them all out in parallel.

```
Phase 4: features A, B, C all fail gauntlet
  → Fix Agent A, Fix Agent B, Fix Agent C all spawn in parallel
  → Each works on its own file scope
  → Each gets targeted re-review when done
```

**Rule**: Fix agents for different features ALWAYS run in parallel. Fix agents for the SAME feature are always sequential (they share file scope).

#### Overlap 4: Multi-feature reviewer fan-out

When multiple builders finish in a phase, each feature's reviewer review is independent. Spawn one reviewer per feature in parallel instead of reviewing them one at a time.

```
Phase 4: builders for A, B, C all finish
  → Evaluator-A, Evaluator-B, Evaluator-C spawn in parallel
  → Compliance-A, Compliance-B, Compliance-C spawn in parallel
  → Security scans everything once (it's codebase-wide)
```

**Rule**: Per-feature reviews (reviewer, compliance) always fan out. Security is a single codebase-wide scan, so it runs once per cycle.

#### Pipeline Summary

| What                          | Old (sequential)              | New (pipelined)                              |
| ----------------------------- | ----------------------------- | -------------------------------------------- |
| Security + next phase         | Wait for security, then build | Security in background, builders start early |
| Auditor + next phase             | Wait for lead, then build     | Auditor in background, builders start early     |
| Multi-feature fix agents      | One at a time                 | All in parallel (separate scopes)            |
| Multi-feature eval/compliance | One at a time                 | All in parallel (independent reviews)        |

The critical path shortens from "every stage sequential" to "only data dependencies block."

### Cross-Provider Spawning

Reviewers on another provider run through `scripts/dispatch-agent.js`; `agent-dispatch-guide.md` describes how it resolves each role's provider and model.

#### Fallback

If the configured command fails (not installed, rate limited, errors out):

```
Configured command (e.g., codex)
  → FAIL → fallback from config (e.g., claude)
    → FAIL → skip compliance (log warning, continue without compliance check)
```

The orchestrator logs which command actually ran in the ComplianceResult.

---

## 3. Loops and Retry Logic — Parallel Gauntlet

The review gauntlet runs all 3 reviewers **in parallel**, collects all failures at once, and uses **snapshot diffing** to avoid redundant re-reviews after fixes.

### The Parallel Gauntlet

```
Builder produces code
  → Snapshot: hash all files in scope
  → Fan-out (parallel):
      Evaluator reviews (Claude)
      Compliance reviews (codex/gemini)
      Security scans (Claude)
  → Collect ALL results
  → ALL PASS → calculate points → mark done
  → ANY FAIL → merge failures into unified fix brief
    → Fix Agent addresses ALL issues in one pass (max 3 attempts)
    → Snapshot diff: compare pre-fix and post-fix file hashes
    → Targeted re-review (only reviewers whose files changed):
        - Files that FAILED a reviewer + were changed → that reviewer re-checks ONLY those files
        - Files that PASSED a reviewer + were changed → REGRESSION CHECK: that reviewer re-checks ONLY those files
        - Files that PASSED a reviewer + were NOT changed → SKIP (snapshot proves no regression)
        - Security: ALWAYS re-runs (non-negotiable, but scoped to changed files)
    → ALL PASS → calculate points → mark done
    → ANY FAIL → next fix attempt (up to 3 total)
      → 3 failures → Auditor analyzes pattern
```

### Why This Works

| Problem                             | How parallel gauntlet solves it                                           |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Compliance fix breaks the feature   | Evaluator re-checks changed files via regression tripwire                 |
| Security fix introduces new bug     | Evaluator re-checks changed files via regression tripwire                 |
| Sequential reviews waste wall clock | All 3 run in parallel — 3x faster                                         |
| Fix agent fixes one thing at a time | Unified fix brief addresses all failures in one pass                      |
| Full re-review after small fix      | Snapshot diff skips unchanged files — only re-review what the fix touched |

### Snapshot Diff Rules

Before ANY review cycle, the orchestrator captures a **snapshot**: `{ file: sha256 }` for every file in the feature's scope.

After a fix, the orchestrator diffs the snapshot:

| File state                       | Action                                                      |
| -------------------------------- | ----------------------------------------------------------- |
| File was NOT reviewed (new file) | ALL 3 reviewers check it                                    |
| File PASSED review + NOT changed | Skip — snapshot proves no regression                        |
| File PASSED review + WAS changed | Regression check — the reviewer that passed it re-checks it |
| File FAILED review + WAS changed | Re-check — the reviewer that failed it re-checks it         |
| File FAILED review + NOT changed | Still fails — count as another failed attempt               |

### Unified Fix Brief

Instead of separate fix passes for eval, compliance, and security, the fix agent receives ONE brief:

```
## Fix Brief for: account-settings

### Evaluator Failures
- ProfileForm.tsx: no error state when the save request fails (line 45-60)
- AvatarUpload.tsx: progress indicator not rendered while the upload runs

### Compliance Failures
- Check 3 (spec compliance): GS-XXX-NN acceptance criteria "save progress visible on every field" — no progress indicator found

### Security Failures
- AvatarUpload.tsx: accepts any file type without server-side validation

Fix ALL of the above. Do not fix them separately.
Files in scope: ProfileForm.tsx, AvatarUpload.tsx, SaveStatus.tsx
```

This typically reduces fix cycles from 3+ (one per reviewer) to 1.

**Hard rule: maximum 3 fix attempts per unified brief. After 3 failures, the learner takes over. The lead either patches the environment or escalates to the user. Agents NEVER loop indefinitely.**

### Snapshot Hashing — Within-Run Optimizations

The same hashing technique that powers snapshot diffing in the gauntlet can optimize other parts of a single run. All hashes are sha256 of file contents, stored in the store under `snapshots`.

#### Integration Validation Hashing

Each feature's locked interfaces (exported types/functions) get hashed when the feature passes gates. When a later feature imports from an earlier one, the orchestrator checks the exporter's interface hash:

- **Hash unchanged since last cycle** → skip re-validating the import. The contract hasn't moved.
- **Hash changed** → re-validate all downstream features that import from it.

This prevents O(n²) cross-feature validation. Only re-check integration points where the contract actually changed.

#### Auditor Skip-Analysis

Between cycles, the orchestrator hashes the bug dataset, conflict dataset, and hygiene rules. If ALL hashes match the previous cycle:

- Auditor skips full pattern analysis (no new data to analyze)
- Auditor only runs if new entries were appended

This saves an entire Auditor agent spawn on cycles where no new bugs or conflicts emerged (common in later phases where builders are more experienced).

#### Security Scan Scoping

Security scans the full codebase, but most files don't change between cycles. The orchestrator maintains a run-level file hash map:

- **First cycle**: security scans everything, orchestrator records hashes
- **Subsequent cycles**: orchestrator diffs hashes, security only scans files with new/changed hashes
- **New files** (no previous hash): always scanned
- **Deleted files**: removed from hash map, no scan needed

When only a few features build per cycle, this cuts security's workload in later cycles.

#### Evaluator Rubric Caching

Golden fixtures and step expectations rarely change within a run (only if Auditor patches them). The orchestrator hashes the fixture files:

- **Hash unchanged** → reviewer receives a pre-compiled rubric summary instead of re-deriving from raw fixtures
- **Hash changed** → reviewer re-reads and re-derives (Auditor patched something)

#### Hash Storage

```typescript
// Added to Store interface
interface Store {
  // ... existing fields ...
  snapshots: {
    // Per-feature file hashes (gauntlet + integration)
    features: Record<string, Record<string, string>>; // feature → { file: sha256 }
    // Locked interface hashes (integration validation)
    interfaces: Record<string, string>; // feature → sha256 of exported types
    // Dataset hashes (lead skip-analysis)
    datasets: {
      bugDataset: string;
      conflictDataset: string;
      hygieneRules: string;
    };
    // Run-level file hashes (security scoping)
    securityBaseline: Record<string, string>; // file → sha256
    // Fixture hashes (reviewer caching)
    fixtures: string; // sha256 of all golden fixture files combined
  };
}
```

---

## 4. Escalation Ladder

```
Issue occurs
  → Fix Agent handles it (attempts 1-3)
    → Still failing after 3 attempts?
      → Auditor analyzes the pattern:
        → Spec is ambiguous       → Auditor patches spec, orchestrator re-dispatches
        → Instrumentation missing → Auditor adds lint rule or test
        → Architectural gap       → Auditor adjusts contracts or ownership table
        → Cross-feature conflict  → Auditor coordinates affected features
        → Product decision needed → Auditor escalates to user
```

The user ONLY hears about issues that require product-level decisions. All technical issues are resolved by the system.

---

## 5. Circuit Breaker

The circuit breaker protects the system from cascading failures.

### States

```
CLOSED (normal)   → 3 consecutive failures on same step → OPEN
OPEN (stopped)    → 30s cooldown                        → HALF-OPEN
HALF-OPEN (probe) → success                             → CLOSED
HALF-OPEN (probe) → failure                             → OPEN (double cooldown)
```

### Heartbeat stall detection

If `store.heartbeat.timestamp` is more than 30 minutes stale and status is not `"building"` or `"reviewing"`, treat as a hang — trigger circuit breaker. Building and reviewing are expected to take longer; all other statuses should transition within minutes.

### Immediate halts (no retry, no cooldown)

- **HTTP 402** — budget exhausted. Halt entire run. Surface the credit-purchase flow to the user.
- **HTTP 401** — auth expired. Halt entire run. Surface re-login to user.
- **5 total failures** across any steps in a single run — halt entire run.

### Special cases

- **HTTP 429 rate limit**: Pause the ENTIRE pipeline. Do NOT retry just the one call. Wait for the rate limit window to reset, then resume.

---

## 6. The Store

The store is a shared JSON file that all agents read and write. It is the single source of truth for system state.

### Schema

```typescript
interface Store {
  // Feature tracking
  features: Record<
    string,
    {
      status:
        | "not_started"
        | "in_progress"
        | "built"
        | "eval_pass"
        | "eval_fail"
        | "compliance_pass"
        | "security_pass"
        | "security_fail"
        | "done";
      owner: string; // agent that built it
      files: string[]; // files this feature owns
      lockedInterfaces: string[]; // exported types/functions that cannot change
      evalResult?: ReviewResult;
      securityResult?: SecurityResult;
      fixAttempts: number;
    }
  >;

  // Pending work
  tasks: Array<{
    id: string;
    type: "build" | "fix" | "foundation-update";
    feature: string;
    spec: string; // path to feature spec or inline description
    fileScope: string[]; // files this task may modify
    feedback?: string; // reviewer/security feedback for fix tasks
    priority: number;
  }>;

  // System state
  cycle: number;
  circuitBreaker: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  totalFailures: number;
  lastCooldownMs: number;

  // Evolution audit trail — the Auditor MUST write here before modifying
  // any environment setting (hygiene rules, specs, ownership, etc.)
  evolution: EvolutionEntry[];

  // Heartbeat — Orchestrator writes this at every phase transition
  heartbeat: Heartbeat;

  // Bug and conflict tracking
  bugDataset: BugEntry[];
  conflictDataset: ConflictEntry[];

  // Compliance reviewer configuration
  compliance: {
    command: string; // tool to run compliance (e.g., "codex", "gemini")
    fallback: string; // fallback tool if primary unavailable
    model: string; // model used by compliance tool (e.g., "gpt-5.6-sol")
    syntax: string; // non-interactive invocation syntax (e.g., "codex exec \"prompt\"")
    interactiveSyntax: string; // interactive terminal syntax (e.g., "codex \"prompt\"")
    note: string; // human-readable usage notes and known caveats
    promptPrefix?: string; // adversarial review prompt prefix
  };

  // Snapshot hashes for drift detection
  snapshots: {
    features: Record<string, string>;
    interfaces: Record<string, string>;
    datasets: {
      bugDataset: string;
      conflictDataset: string;
      hygieneRules: string;
    };
    securityBaseline: Record<string, string>;
    fixtures: string;
  };

  // Known stub files that need replacement during builds
  knownStubs: string[];

  // Run log for the current/last run
  runLog: {
    runId: string;
    startedAt: string; // ISO timestamp
    entries: LogEntry[];
    finalStatus: string | null;
    haltReason: string | null;
    resumableFrom?: string | null;
  };

  // Builder scoring system
  points: PointsStore;
}

interface EvolutionEntry {
  cycle: number;
  field: string; // what was changed (e.g., "hygiene", "spec", "ownership")
  change: string; // description of the change
  reason: string; // why the change was made
  oldValue: string | null;
  newValue: string;
  approved: boolean;
  applied_at: string; // ISO timestamp
}

interface Heartbeat {
  cycle: number;
  phase: number;
  feature: string; // current feature being processed
  status: string; // "idle" | "dispatching" | "building" | "reviewing" | "fixing" | "gating"
  timestamp: string; // ISO timestamp
}

interface BugEntry {
  id: string; // e.g., "BUG-NNN"
  pattern: string; // human-readable description of the bug pattern
  feature: string; // which feature was affected
  agent: string; // which agent caused or found it
  root_cause: string;
  fix: string;
  recurrence: number; // how many times this pattern has occurred
  prevention: string; // hygiene rule or process change to prevent recurrence
}

interface ConflictEntry {
  id: string;
  features: string[]; // features involved in the conflict
  file: string; // contested file
  description: string;
  resolution: string;
  timestamp: string; // ISO timestamp
}

interface LogEntry {
  type: string; // "GATE_CHECK" | "DISPATCH" | "BUILD" | "EVAL" | "FIX" | "SECURITY"
  phase: number;
  buildResult?: string;
  reviewerResult?: string;
  securityResult?: string;
  feature?: string;
  timestamp: string; // ISO timestamp
}

interface PointsStore {
  configs: Record<
    string, // key format: "{builderType}:{model}:{feature}"
    {
      runs: Array<{
        run: number;
        points: {
          nailedIt: number; // 0-30
          cleanSheet: number; // 0-25
          fullCoverage: number; // 0-20
          byTheBook: number; // 0-15
          laserFocus: number; // 0-10
        };
        total: number; // 0-100
        xp: number; // EMA-based
      }>;
      currentXP: number;
      rank: "benched" | "rookie" | "solid" | "all-star";
      achievements: string[];
    }
  >;
  runCelebrations: string[];
  phaseCelebrations: string[];
}
```

### Rules

- Orchestrator reads `tasks` to determine what to dispatch.
- Builders write their `features[name].status` and `features[name].files` on completion.
- Evaluator writes `features[name].evalResult` and updates `features[name].status`.
- Security writes `features[name].securityResult` and updates `features[name].status`.
- Auditor reads everything, writes `tasks`, updates `features[name].lockedInterfaces`, increments `cycle`.
- Fix agents update `features[name].fixAttempts` on each attempt.

---

## 7. Shared Context

Agents are isolated. They do NOT share memory or conversation state.

### How agents share information

1. **The repo is the shared memory.** Agent B reads code that Agent A wrote. The codebase is the source of truth.
2. **The store tracks progress.** Status, ownership, locked interfaces, pending tasks.
3. **Types are the contract.** The product's shared session type and its sub-interfaces define the shape of data between features. If you consume data from another feature, you import the type — you do NOT inspect the other feature's implementation.

### What you MUST NOT do

- Do NOT build a messaging system between agents.
- Do NOT store conversation history or "memory" outside the store.
- Do NOT read other agents' prompts or internal state.
- Do NOT assume anything about another feature's implementation beyond its exported types.

---

## 8. Bug Dataset

Append-only structured log. The lead reads this between cycles to identify recurring patterns.

### Schema

```json
{
  "id": "BUG-NNN",
  "pattern": "direct localStorage access instead of the storage helper",
  "feature": "settings",
  "agent": "builder-settings",
  "root_cause": "agent ignored hygiene rule",
  "fix": "replace the direct localStorage call with the storage helper",
  "recurrence": 3,
  "prevention": "eslint rule no-direct-localstorage"
}
```

### Rules

- Evaluator appends a bug entry whenever a builder or fix agent fails a check.
- Auditor reads the dataset between cycles. When `recurrence >= 2`: the learner MUST update the relevant lint rule, spec, or hygiene doc to prevent reoccurrence. Fixing the bug is not enough — fix the system.
- The `prevention` field records what systemic change was made. If empty, the learner has not yet addressed it.

---

## 9. Conflict Dataset

Append-only structured log. The lead reads this between cycles to tighten ownership boundaries.

### Schema

```json
{
  "id": "CONFLICT-NNN",
  "agents": ["builder-auth", "builder-settings"],
  "file": "src/lib/types.ts",
  "nature": "both added different User interface shapes",
  "resolution": "types.ts is foundation-owned, builders consume not modify",
  "rule_added": "OWNERSHIP: types.ts is locked after foundation phase"
}
```

### Rules

- Evaluator or orchestrator appends a conflict entry whenever two agents modify the same file or produce incompatible interfaces.
- Auditor reads the dataset between cycles. Every conflict MUST result in a new ownership rule or integration contract. Conflicts are not one-off fixes — they are boundary failures.

---

## 10. The Reviewer (Evaluator Protocol)

After every builder or fix agent completes, the reviewer runs these five checks in order.

### Check 1: Structural

- All required fields in the output exist and are non-empty.
- All fields have correct types (string where string expected, array where array expected).
- Array fields meet minimum/maximum count thresholds defined in golden fixtures.
- Output conforms to the product's TypeScript interfaces.

### Check 2: Grounding

- Every named entity in the output appears in the input data.
- Every metric or number in the output appears in the input data.
- Every claim about the user traces to the user's own input (the artifact the product ingests — see the product's canon for the concrete entity).
- If the output contains ANY entity (name, metric, date) not present in the input: **hard fail**.

**Synthesis exception:** Steps marked `synthesis_allowed: true` in the context scoping table (section 12) intentionally generate new content (queries, questions, recommendations). For these steps, the grounding check applies ONLY to factual claims about the user. Generated queries, questions, and recommendations are exempt — they are the expected output, not fabrication. The reviewer MUST still fail if a synthesis step fabricates facts about the user.

### Check 3: Coverage

- Output uses the key terms the upstream step produced (where applicable).
- All required sections defined in the step expectation are populated.
- Minimum content length thresholds are met per section.

### Check 4: Negative

- Output does NOT contain terms from the user's exclusion list (where the product keeps one).
- Output does NOT contain prompt injection artifacts ("As an AI language model...", "I'd be happy to help...", "Here is...", etc.).
- Output does NOT fabricate facts about the user that are not in the input.

### Check 5: Open Loop

- Placeholders, TODO comments, stub implementations, `// FIXME` markers, and unresolved questions are failures.
- Every output should close a loop, not open one.
- ANY open loop artifact = **hard fail**.
- **Stub exception:** Files in `store.knownStubs` are pre-existing — only fail if the builder CREATED a new stub.

### Scoring

```typescript
interface ReviewResult {
  step: number;
  pass: boolean;
  score: number; // 0-100
  violations: string[]; // specific failures with field paths
  warnings: string[]; // suspicious but non-fatal
  durationMs: number;
}
```

| Score  | Meaning                                                          | Action                                               |
| ------ | ---------------------------------------------------------------- | ---------------------------------------------------- |
| 0      | Hard fail — missing required fields, hallucination, fabrication  | Halt step. Spawn fix agent.                          |
| 1-49   | Soft fail — output too short, missing key terms, wrong tone      | Retry once. If second attempt < 50: spawn fix agent. |
| 50-79  | Warning — suboptimal keyword coverage, verbose, minor formatting | Log warning. Continue.                               |
| 80-100 | Pass                                                             | Mark step complete.                                  |

---

## 11. Golden Fixtures

Golden fixtures define what "correct" means for each step.

### Step Expectations

```typescript
interface StepExpectation {
  step: number;
  name: string;
  requiredFields: string[];
  mustContain: string[];
  mustNotContain: string[];
  counts?: Record<string, { min: number; max?: number }>;
  validate?: (input: State, output: State) => string[]; // State = the product's shared session type
}
```

### Per-step expectations

| Step | Required content | Prohibited content | Count constraints |
| ---- | ---------------- | ------------------ | ----------------- |
| `<n> (<step name>)` | `<what the output must contain>` | `<what it must not contain>` | `<field>: <min>-<max>` |

### Golden Pairs

```typescript
interface GoldenPair {
  step: number;
  input: Partial<State>;
  goldenOutput: Partial<State>;
  tolerance: "exact" | "structural" | "semantic";
}
```

| Tolerance  | When to use                              | What it checks                                  |
| ---------- | ---------------------------------------- | ----------------------------------------------- |
| exact      | Deterministic steps                      | Field values must match                         |
| structural | Steps with fixed schema                  | Same shape, same field count ranges, same types |
| semantic   | AI-generated content                     | Same topics and keywords, wording may differ    |

### Non-deterministic output handling

AI output varies between runs. You CANNOT use `assertEquals`. Instead use the five checks from section 10. The grounding check is the highest priority — if output references entities not in the input, it is a hard fail regardless of all other checks.

---

## 12. Context Scoping

Each builder agent receives ONLY the data it needs. This is enforced by the orchestrator when constructing the agent's prompt.

| Worker | Receives | Does NOT receive | synthesis_allowed |
| ------ | -------- | ---------------- | ----------------- |
| `<worker> (step n)` | `<the inputs it needs>` | `<inputs it must not see>` | `Yes` when it generates content (queries, questions, recommendations); otherwise `No` |

### Why this matters

1. Smaller context produces better output.
2. Agents cannot hallucinate from data they never received.
3. The grounding check (section 10, check 2) is only possible because input is scoped — if a worker mentions something not in its input, it fabricated it.

If you are a builder and your output references data you did not receive: that is a bug in your output, not missing context. Rewrite without the fabricated content.

### Builder context — what each role receives

Builders get: PRD, STORIES.md, FLOW_SPEC.md, COPY.md, INPUTS.md (if exists), DATA-CONTRACTS.md, and the latest HYGIENE.md. Builders do NOT get: golden fixtures, reviewer rubric, step expectations, or any file under `_requirements/_shared/canonical-fixtures/`.

| Role       | Context includes                                                     | Context excludes                                     |
| ---------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| Builder    | PRD, STORIES, FLOW_SPEC, COPY, HYGIENE, foundation spec, store state | Golden fixtures, reviewer rubric, step expectations |
| Evaluator  | Golden fixtures, step expectations, reviewer rubric, builder output | Other builders' output, Auditor analysis                |
| Security   | Full codebase (read-only), security checklist                        | Evaluator results, golden fixtures                   |
| Compliance | Builder diff, acceptance criteria, hygiene rules                     | Golden fixtures, reviewer rubric                    |
| Auditor       | Everything (full picture)                                            | Nothing excluded                                     |
| Fix Agent  | Unified fix brief, feature spec, file scope                          | Golden fixtures, other features' code                |

### Holdout Set

Golden fixtures in `_requirements/_shared/canonical-fixtures/` are **invisible to builders during development**. The reviewer loads them at eval time. This prevents builders from optimizing for tests instead of specs. Builders should implement features based on the spec, not reverse-engineer expected outputs from fixture files.

This separation is critical. Agents cheat — not deliberately, but effectively. Given access to golden output, a builder will pattern-match against it rather than reasoning from the specification. The holdout set forces builders to demonstrate genuine spec comprehension.

The Orchestrator MUST enforce this by excluding `_requirements/_shared/canonical-fixtures/` from the file list and context payload when constructing builder prompts.

---

## 13. Step Graph and Dependencies

The step graph comes from the manifest: `.claude/manifest.json` `build.phases` and each feature's `build.features[].phase`.

- Steps that share inputs and do not depend on each other MAY run in parallel.
- A step that depends on several steps waits for all of them.

---

## 14. Connecting Points Between Features

The producer/consumer integration-seam model — types, explicit seams, the read-only commons — is [`_system/guides/integration-seam-contract.md`](guides/integration-seam-contract.md).

---

## 15. Run Log

Every step execution produces a log entry. The run log is append-only and kept in the store (`runLog`).

```typescript
interface RunLog {
  runId: string;
  startedAt: string;
  entries: OrchestratorLog[];
  finalStatus: "completed" | "halted" | "partial";
  haltReason?: string;
  resumableFrom?: number;
}

interface OrchestratorLog {
  step: number;
  outcome: StepOutcome;
  timestamp: string;
  durationMs: number;
  retryCount: number;
  reviewResult?: ReviewResult;
}

type StepOutcome =
  | { status: "success"; data: Partial<State> } // State = the product's shared session type
  | { status: "retry"; reason: string; attempt: number }
  | { status: "skip"; reason: string }
  | { status: "halt"; reason: string; fatal: boolean };
```

### Rules

- Every step MUST produce a log entry, including failures.
- The `reviewResult` field is populated by the reviewer after review.
- `resumableFrom` is set when the circuit breaker trips, marking where to restart.
- The run log is the forensic record. When the system collapses, the log explains exactly where and why.

---

## 16. Eject Protocol

When the circuit breaker trips or the user triggers a kill:

1. Save the run's current state to the store immediately.
2. Set `resumableFrom` in the run log to the last successful step + 1.
3. Set `finalStatus` to `'halted'`.
4. Set `haltReason` to a specific, actionable message.
5. Surface to user: "Stopped at step [X] because [Y]. Your progress is saved. [Resume] [Start over]"

Partial success is valid. A halted run keeps the output of every step before the halt. Do NOT discard partial results.

---

## 17. The Oneshot Spec — 4 Deliverables

The system is bootstrapped from four documents:

1. **Foundation spec** — environment, skeleton repo structure, type definitions, shared utilities, folder structure, code hygiene rules, instrumentation setup (strict TypeScript, ESLint architectural rules, schema validators, placeholder tests).

2. **Feature specs** — one per feature. Each includes: product requirements, file ownership, integration contracts (producer/consumer), acceptance criteria, prohibited patterns. Feature specs are self-contained — a builder agent needs only its feature spec plus the foundation spec.

3. **Hygiene rules** — the CLAUDE.md equivalent for agents. Naming conventions, import patterns, error handling patterns, CSS approach, anti-patterns, file organization. Every builder reads this.

4. **Evaluation criteria** — what the reviewer and security agents check. The golden fixtures, the five-check protocol, the scoring tiers. This document.

### Build order

1. Foundation builds first (skeleton repo that compiles with zero features).
2. Features fan out in parallel (respecting the step dependency graph).
3. Evaluator + security sweep after each batch.
4. Auditor adjusts between cycles.
5. Repeat until store shows all features at `done`.

---

## 18. How Agents Are Invoked

### Claude Code sessions

Each agent runs as a separate Claude Code session. The session prompt includes:

- The agent's role definition (from this document, section 1)
- The foundation spec
- The feature spec (for builders) or evaluation criteria (for reviewer/security)
- The hygiene rules
- The current store state
- The file ownership scope ("You may ONLY modify these files: [list]")

### Codex / background agents

Same prompt structure, submitted as async tasks. Each agent works in isolation on its own git branch.

### Required infrastructure

- **Template repo** — skeleton that compiles with zero features. Includes: `tsconfig.json` (strict), `.eslintrc` (with architectural rules), `types.ts` (all interfaces), `package.json`, folder structure, placeholder tests.
- **Task manifest** — list of feature specs with file ownership, dispatched by the orchestrator.
- **Prompt templates** — one per agent role. The orchestrator fills parameters and dispatches.
- **Merge strategy** — parallel agent branches are merged sequentially. Merge conflicts are escalated to learner.

### Model Selection Per Role

Each role's provider, model and effort come from `_org/role-registry.json`.

---

## 20. Instruction Sources

Tasks assigned to agents come from these sources:

1. **User stories** — feature work. "As a user I want X."
2. **Bug dataset entries** — "This pattern broke. Here is the fix spec."
3. **Auditor observations** — lead reads codebase, spots drift, generates tickets.
4. **Automated signals** — lint failures, test failures, type errors, coverage gaps, CI logs.
5. **Spec documents** — standing rules (CLAUDE.md, hygiene rules) that shape every task.
6. **Other agents' output** — one agent's deliverable is another's input.

### Rule for all instruction sources

Instructions MUST be unambiguous. A dumb agent with a perfect spec will outperform a smart agent with a vague spec every time. Every task MUST include:

- **File list** — touch these files, not those.
- **Acceptance criteria** — the build passes, this test exists, this type is exported, this endpoint returns X given Y.
- **Constraints** — do not refactor X, do not add dependencies, do not modify files outside scope, stay under N lines.

---

## 21. Known Failure Patterns

These patterns WILL occur. The system is designed to catch and correct them.

### 1. "Almost works" — code passes build but is subtly wrong

A missing edge case, a shadowed variable, logic that works for the test but not production. This is the most dangerous failure because it's silent.

**Mitigation:** The five-check reviewer (section 10). Behavioral assertions, not just compilation. The grounding check catches fabrication. The coverage check catches omission.

### 2. Context window blindness — agent conflicts with unseen code

Agents only see their scoped context. They will confidently make changes that conflict with code in other features.

**Mitigation:** Tight file scoping. One agent, one file boundary. Foundation files are read-only. Integration points are explicit contracts. Conflicts are logged and ownership is tightened.

### 3. Yak shaving spirals — fix cascades into unrelated changes

Agent hits lint error → refactors → breaks test → changes assertion → test is meaningless. Each step was locally rational.

**Mitigation:** Hard constraints. "Only modify these files." "Do not change test assertions." "If build fails after your change, revert and report — do not fix forward."

### 4. Auditor bottleneck — orchestrator does more work than agents

If the learner is making complex decisions on every task, it's doing the agents' work.

**Mitigation:** Auditor is mechanical between cycles. Pattern match, check datasets, apply rules, dispatch. Save judgment for when automated checks fail.

### 5. Premature abstraction — building framework before patterns emerge

The urge to build a generic orchestration framework before running 10 tasks through the system.

**Mitigation:** Start ugly. Hardcode. Run 20+ real tasks before abstracting. Actual patterns will differ from imagined ones.

### 6. Unclosed feedback loops — failures without rule updates

Agent makes a mistake. It gets fixed. The rule that would prevent reoccurrence is never written. Same mistake next week.

**Mitigation:** Rule updates are a first-class output. When something goes wrong, the deliverable is BOTH the fix AND the updated rule/lint/test. The bug dataset's `prevention` field tracks this. Empty `prevention` = the system has not learned from this failure.

---

## 24. Design Principles

These are not suggestions. They are rules.

1. **Change the environment, not the agents.** Do not teach agents. All intelligence about past failures lives in the system — bug dataset, lint rules, spec, ownership table.

2. **Start ugly, do not abstract.** Switch statements. If-statements. Prompt templates. No classes, no generic frameworks, no inheritance hierarchies. Abstraction comes after 20+ successful task completions, not before.

3. **Every failure is a rule you did not write yet.** When something goes wrong, the deliverable is the fix AND the new rule. Empty `prevention` fields in the bug dataset are system debt.

4. **The lead does not think — it routes and enforces.** Mechanical pattern matching between cycles. Judgment is reserved for when automated checks fail.

5. **Partial success is valid.** A halted run still has output from completed steps. Do NOT discard partial results.

6. **Instructions must be unambiguous, not smart.** Dumb agent + perfect spec > smart agent + vague spec.

7. **Three attempts then escalate.** Never loop indefinitely. Three fix attempts, then the learner takes over.

8. **Rule updates are first-class output.** Not afterthoughts. Not TODO comments. Actual updated artifacts committed to the repo.

9. **Three-cycle rollout.** New system features (new review checks, new hygiene rules, new dispatch strategies) follow this rollout: Cycle N: introduce with full monitoring and manual override available. Cycle N+1: use with standard monitoring, compare results to baseline. Cycle N+2: trust and spot-check only. This prevents premature reliance on untested mechanisms.

---

## 25. Open Design Questions

These items are acknowledged as undefined. They will be designed in subsequent iterations.

- User stories — per-feature stories (separate pass)

---

## 26. Git & Isolation Strategy

Parallel builders must be isolated so they cannot corrupt each other's work. The strategy depends on the harness.

### Claude Code (worktrees)

Each builder subagent runs in isolation. The dispatch method depends on the agent's context:

- **Alpha (lead)** dispatches via the **Agent tool** with `isolation: "worktree"` — creates a temporary git worktree with its own branch.
- **Gamma/Delta (teammates)** dispatch via the **`claude` CLI** through Bash: `claude -p --model sonnet --agent builder -w "prompt"` — the `-w` flag creates a worktree. The Agent tool is not available to teammates.

```
Orchestrator dispatches builder → worktree created (branch: agent/<feature>)
  → Builder works in isolation, commits to its branch
  → Builder returns result
  → Orchestrator merges branch into master (fast-forward or squash)
  → Worktree is cleaned up
```

#### WorktreeCreate Hook (Branch Override)

By default, `isolation: "worktree"` branches from origin/HEAD (the remote default branch). A WorktreeCreate hook overrides this to branch from HEAD (the current local branch).

- **Hook location:** `scripts/hooks/create-worktree-from-head.js` (Node.js — no jq dependency)
- **Config:** `.claude/settings.json` → `hooks.WorktreeCreate`

This is critical for skeleton runs where the current branch has stubs but master has complete implementations. Without the hook, builders would see master's code and could copy instead of building from specs.

### Codex (sandboxes)

Each builder task is submitted as an async Codex task. Codex provides its own sandbox isolation — each task gets a clean copy of the repo.

```
Orchestrator creates Codex task → Task runs in isolated sandbox
  → Builder works, commits to branch agent/<feature>
  → Task completes, returns branch/patch
  → Orchestrator pulls branch, merges into master (fast-forward or squash)
```

**Codex dispatch flow:**

1. Orchestrator creates a branch `agent/<feature>` from current master
2. Orchestrator submits Codex task with: builder prompt + branch name + repo context
3. Orchestrator polls for task completion (not a failure — same as a polled external API)
4. On completion: orchestrator merges the branch into master
5. On failure: orchestrator reads task output, spawns fix agent on the same branch

Parallel tasks within a phase each get their own branch. They are merged sequentially after the phase gate passes.

### Merge Rules (both harnesses)

1. **Merge order follows TASK-MANIFEST phase order.** Within a phase, merge in the order listed in the manifest.
2. **Fast-forward preferred.** If the branch is clean (no conflicts), fast-forward merge.
3. **Conflicts → escalate to lead.** Do NOT auto-resolve merge conflicts. The lead analyzes the conflict, updates the ownership table or integration contracts, and re-dispatches.
4. **No force-pushes.** Ever. If master has diverged, rebase the feature branch first.
5. **Phase gate before merge.** All builders in a phase must pass eval + security before ANY of them merge. This prevents a passing feature from being broken by a failing one.
6. **Post-merge build check.** After merging all features in a phase: `npm run build`. If it fails, the learner analyzes which merge introduced the break.

### Branch Naming

```
agent/<feature-name>     — builder branches (e.g., agent/auth, agent/credits)
agent/fix/<feature-name> — fix agent branches
```

Branches are ephemeral. They are deleted after successful merge. Failed branches are preserved for forensics until the learner reviews them.
