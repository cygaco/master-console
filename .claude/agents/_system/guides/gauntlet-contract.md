# Gauntlet / Circuit-Breaker / Context-Scoping Mechanism Contract

> Focused gauntlet/circuit-breaker/context-scoping mechanism contract, AUTHORITATIVE for these
> mechanisms. `_system/agent-system.md` is the operational spec for the rest of oneshot and
> defers to this contract for these mechanisms.

Older labels map to current roles as follows (`learner`, `lead`, `Auditor`, `stub-scaffold`,
`consult`/`advisor`): the between-cycles pattern-analysis / environment-patching role is
`ops-analyst`; `stub-scaffold` → `skeleton-builder`; `consult`/`advisor` → `cabinet`. `gamma`
(adhoc orchestrator) and `delta` (oneshot orchestrator) are current. Reviewer / security / qa /
builder / fixer below are the gauntlet's function labels; they run as the registry's roles
(`frontend-reviewer` / `backend-reviewer`, `security-reviewer`, `qa-reviewer`, `frontend-builder` /
`backend-builder`, and the `*-fixer` roles).

> Note on `reviewer` naming: `agent-system.md` calls the spec-evaluation reviewer "Evaluator"
> and the cross-provider check "Compliance". These are review *functions* of the gauntlet, not
> ADR-0007 role ids. They map to the current `*-reviewer` roles (spec/eval review) and the
> cross-provider compliance pass. The mechanism is unchanged; only the function labels differ.

---

## parallel-gauntlet

The review gauntlet runs all 3 reviewers **in parallel**, collects all failures at once, and uses
**snapshot diffing** (see [snapshot-diff](#snapshot-diff)) to avoid redundant re-reviews after fixes.

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
      → 3 failures → ops-analyst analyzes pattern
```

### Why this works

| Problem                             | How parallel gauntlet solves it                                           |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Compliance fix breaks the feature   | Evaluator re-checks changed files via regression tripwire                 |
| Security fix introduces new bug     | Evaluator re-checks changed files via regression tripwire                 |
| Sequential reviews waste wall clock | All 3 run in parallel — 3x faster                                         |
| Fix agent fixes one thing at a time | Unified fix brief addresses all failures in one pass                      |
| Full re-review after small fix      | Snapshot diff skips unchanged files — only re-review what the fix touched |

### Pipeline parallelism (overlaps that cut wall clock)

The strict "phase → gate → phase" pipeline leaves idle time. These overlaps are safe because the
overlapping work either is read-only or applies only to a *future* cycle.

- **Overlap 1 — Security runs alongside next-phase builders.** Security is read-only and cannot
  regress code that already passed the reviewer + compliance gate. **Rule:** builders in the next
  phase may start as soon as their dependencies are **eval-gated** (reviewer + compliance pass);
  they do NOT wait for security. Security failures spawn fix agents that run alongside next-phase
  builders on separate file scopes. **Exception:** if a security fix must change a file a
  next-phase builder is actively modifying, the orchestrator detects the scope collision and
  queues the fix until that builder finishes.
- **Overlap 2 — ops-analyst runs alongside next-phase builders.** ops-analyst adjusts the
  environment (specs, rules, hygiene) for FUTURE cycles, never the current code. **Rule:**
  ops-analyst's environment changes apply to the NEXT dispatched phase, not the current one —
  safe because ops-analyst never modifies code.
- **Overlap 3 — Multi-feature fix agents fan out.** When multiple features in a phase fail, each
  feature's fix agent is independent (separate file scopes, separate unified fix briefs). **Rule:**
  fix agents for DIFFERENT features ALWAYS run in parallel; fix agents for the SAME feature are
  ALWAYS sequential (they share file scope).
- **Overlap 4 — Multi-feature reviewer fan-out.** **Rule:** per-feature reviews (reviewer,
  compliance) always fan out — one per feature in parallel. Security is a single codebase-wide
  scan, so it runs once per cycle.

Wall-clock savings on a full 13-feature run: ~40%. The critical path shortens from "every stage
sequential" to "only data dependencies block."

### Cross-provider spawning

Each AI tool is a terminal command; the orchestrator calls them directly (no wrapper scripts,
no API keys, no model config in this layer — each tool handles its own setup).

| Command  | What it is              | Use case                       |
| -------- | ----------------------- | ------------------------------ |
| `codex`  | OpenAI's Codex CLI      | Compliance reviews (default)   |
| `gemini` | Google's Gemini CLI     | Compliance reviews (alt)       |
| `claude` | Anthropic's Claude Code | Builders, reviewer, security   |

A review is a single tool call with a prompt that instructs the tool to write its JSON result to
a file (matching the result schema); the orchestrator then reads and parses that file.

**Dispatch shape (current).** In adhoc mode (`gamma`), dispatches are sequential via the bounded
CLI wrappers. In oneshot mode (`delta`) — or when the orchestrator dispatches directly — calls can
fan out in parallel. (For the authoritative CLI-vs-API and wrapper-shape rules, defer to the
agent-dispatch guide; this doc only states the gauntlet's use of cross-provider review.)

**Fallback chain.** If the configured command fails (not installed, rate-limited, errors out):

```
Configured command (e.g., codex)
  → FAIL → fallback from config (e.g., claude)
    → FAIL → skip compliance (log warning, continue without compliance check)
```

The orchestrator logs which command actually ran in the result record.

---

## snapshot-diff

Before ANY review cycle, the orchestrator captures a **snapshot**: `{ file: sha256 }` for every
file in the feature's scope. After a fix, the orchestrator diffs the snapshot:

| File state                       | Action                                                      |
| -------------------------------- | ----------------------------------------------------------- |
| File was NOT reviewed (new file) | ALL 3 reviewers check it                                    |
| File PASSED review + NOT changed | Skip — snapshot proves no regression                        |
| File PASSED review + WAS changed | Regression check — the reviewer that passed it re-checks it |
| File FAILED review + WAS changed | Re-check — the reviewer that failed it re-checks it         |
| File FAILED review + NOT changed | Still fails — count as another failed attempt               |

---

## unified-fix-brief

Instead of separate fix passes for eval, compliance, and security, the fix agent receives ONE
brief that merges all failures, so it addresses everything in a single pass:

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

**Hard rule:** maximum **3 fix attempts** per unified brief. After 3 failures, `ops-analyst` takes
over — it either patches the environment (spec / lint rule / hygiene doc) or escalates to the user.
Agents NEVER loop indefinitely.

---

## snapshot-hashing

The same hashing technique that powers snapshot diffing can optimize other parts of a single run.
All hashes are sha256 of file contents, stored in the store under `snapshots`.

- **Integration-validation hashing.** Each feature's locked interfaces (exported types/functions)
  are hashed when the feature passes gates. When a later feature imports from an earlier one, the
  orchestrator checks the exporter's interface hash: **unchanged** → skip re-validating the import
  (contract hasn't moved); **changed** → re-validate all downstream features that import from it.
  Prevents O(n²) cross-feature validation.
- **ops-analyst skip-analysis.** Between cycles the orchestrator hashes the bug dataset, conflict
  dataset, and hygiene rules. If ALL hashes match the previous cycle, `ops-analyst` skips full
  pattern analysis and only runs if new entries were appended — saving a full agent spawn on
  cycles where no new bugs/conflicts emerged.
- **Security-scan scoping.** Security scans the full codebase, but most files don't change between
  cycles. The orchestrator keeps a run-level file-hash map: first cycle scans everything and
  records hashes; subsequent cycles diff hashes and security only scans new/changed files; new
  files (no prior hash) are always scanned; deleted files are removed from the map. On a
  13-feature run where only 2–3 features build per cycle, this cuts security's workload 60–80% in
  later cycles.
- **Evaluator rubric caching.** Golden fixtures and step expectations rarely change within a run
  (only if `ops-analyst` patches them). The orchestrator hashes the fixture files: **unchanged** →
  reviewer receives a pre-compiled rubric summary instead of re-deriving from raw fixtures;
  **changed** → reviewer re-reads and re-derives.

### Hash storage

```typescript
// Added to Store interface
interface Store {
  // ... existing fields ...
  snapshots: {
    // Per-feature file hashes (gauntlet + integration)
    features: Record<string, Record<string, string>>; // feature → { file: sha256 }
    // Locked interface hashes (integration validation)
    interfaces: Record<string, string>; // feature → sha256 of exported types
    // Dataset hashes (ops-analyst skip-analysis)
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

## escalation-ladder

```
Issue occurs
  → Fix Agent handles it (attempts 1-3)
    → Still failing after 3 attempts?
      → ops-analyst analyzes the pattern:
        → Spec is ambiguous       → ops-analyst patches spec, orchestrator re-dispatches
        → Instrumentation missing → ops-analyst adds lint rule or test
        → Architectural gap       → ops-analyst adjusts contracts or ownership table
        → Cross-feature conflict  → ops-analyst coordinates affected features
        → Product decision needed → ops-analyst escalates to user
```

The user ONLY hears about issues that require product-level decisions. All technical issues are
resolved by the system.

---

## circuit-breaker

The circuit breaker protects the system from cascading failures.

### States

```
CLOSED (normal)   → 3 consecutive failures on same step → OPEN
OPEN (stopped)    → 30s cooldown                        → HALF-OPEN
HALF-OPEN (probe) → success                             → CLOSED
HALF-OPEN (probe) → failure                             → OPEN (double cooldown)
```

### Heartbeat stall detection

If `store.heartbeat.timestamp` is more than 30 minutes stale **and** status is not `"building"`
or `"reviewing"`, treat as a hang — trigger the circuit breaker. Building and reviewing are
expected to take longer; all other statuses should transition within minutes.

### Immediate halts (no retry, no cooldown)

- **HTTP 402** — budget exhausted. Halt entire run. Surface the purchase/top-up flow to the user.
- **HTTP 401** — auth expired. Halt entire run. Surface re-login to the user.
- **5 total failures** across any steps in a single run — halt entire run.

### Special cases

- **Long-poll provider steps** (an external API polled for results): poll-in-progress is NOT a failure.
  Such polls can take minutes. Only count a poll as failed if it returns an error status or exceeds the
  maximum poll duration — long-running poll ≠ failure until error or timeout.
- **HTTP 429 rate limit:** pause the ENTIRE pipeline. Do NOT retry just the one call. Wait for the
  rate-limit window to reset, then resume.
- **Thin data** (e.g. <3 results from a data source): this is a WARNING, not a failure. Log it,
  surface to the user with an explanation, and let the user decide whether to proceed.

---

## context-scoping

Agents are isolated. They do NOT share memory or conversation state.

### How agents share information

1. **The repo is the shared memory.** Agent B reads the code Agent A wrote. The codebase is the
   source of truth.
2. **The store tracks progress.** Status, ownership, locked interfaces, pending tasks.
3. **Types are the contract.** Exported interfaces in `types.ts` define the shape of data between
   features. To consume another feature's data, import its type — do NOT inspect that feature's
   implementation.

### What you MUST NOT do

- Do NOT build a messaging system between agents.
- Do NOT store conversation history or "memory" outside the store.
- Do NOT read other agents' prompts or internal state.
- Do NOT assume anything about another feature's implementation beyond its exported types.
