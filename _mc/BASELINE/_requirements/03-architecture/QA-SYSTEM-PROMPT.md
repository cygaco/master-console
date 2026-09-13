# QA System Design Brief

> **Purpose:** Reference document for Alex when designing and implementing the Pantry Pilot QA system.
> **Status:** Design brief — no implementation yet. Code comes after design approval.

---

## 1. Objective

Design a testing and quality system that detects and prevents the seven empirically observed failure modes. The system has three pillars: Playwright e2e tests, a QA agent, and infrastructure health checks.

## 2. The Seven Failure Modes

### 2.1 — The Stale Reader
Components and agents read state once (on mount or from a cached source) and miss subsequent updates.

**Bugs:** BUG-034 (stale session spread in complete()), BUG-050 (evaluator read wrong worktree, 4x), BUG-059 (Step8Ingredients missed parent setSession)

**Detection:** Any component calling `loadSession()` in `useEffect([], [])` without also accepting session as a prop. Any agent reading files without verifying `git branch --show-current`.

### 2.2 — The Phantom Render
React component identity issues cause visual artifacts — duplicate mounts, 1-frame flashes, double-triggered effects.

**Bugs:** BUG-032/035 (Strict Mode kills mountedRef/hasRunRef), BUG-037 (file picker opens twice), BUG-060/062 (1-frame gaps between loading phases), BUG-010-r02 (two recipe upload screens)

**Detection:** Grep for `{condition && <Component` patterns where the same component appears under multiple conditions. Check all `useRef(false)` for Strict Mode compatibility. Check substep transitions for loading state gaps.

### 2.3 — The Cascade Amplifier
Changes propagate through dependency graphs in ways that amplify rather than converge.

**Bugs:** 10 STALE marker removals generated 44 new markers (confirmed 2026-04-09, fixed with `isStaleOnlyChange()`). BUG-061 (analysis re-runs on "View Your Targets").

**Detection:** Any operation that should be idempotent but triggers side effects. Spec graph has ~50 edges — a single canonical file change can theoretically mark all 52 downstream files.

### 2.4 — The Gate Dodger
Security, billing, and process gates that exist but have alternate paths around them.

**Bugs:** BUG-038 (plan-tier gate bypassed), BUG-008 (quotaOverride bypass), BUG-009 (arbitrary userId), BUG-010-r02 (NEXT_PUBLIC as server gate), BUG-046 (Stripe redirect injection), BUG-045 (Boss skipped compliance)

**Detection:** Every `/api/` route needs: (1) auth via `verifySession()`, (2) rate limiting, (3) input validation, (4) no client-exposed secrets. Every agent gate needs all N reviewers passing before merge.

### 2.5 — The Zombie Agent
Agents that dispatch but don't complete properly — missing commits, orphan worktrees, results from wrong location.

**Bugs:** BUG-001 (agents see skeleton stubs as "complete"), 3/7 builders failed to commit, 20 orphan worktrees lingered 2 weeks, 71 `dispatch-unknown` audit events.

**Detection:** Post-builder: verify commit exists, diffs are non-trivial, worktree cleaned after merge. Orphan count should be zero after run completes.

### 2.6 — The Spec Ghost
Deleted features resurrect because references persist in specs, prompts, or agent configs.

**Bugs:** BUG-058 (category ranking survived 94 refs across 34+ files). Removing field from types.ts but leaving it in prompts.ts causes Claude to re-emit it.

**Detection:** When removing a feature/field, grep ALL layers: `prompts.ts`, `PROMPT_TEMPLATES.md`, every PRD, every STORIES.md, `manifest.json`, `INTEGRATION-MAP.md`, `store.json` features[*].files, `types.ts`. Zero references = safe.

### 2.7 — The Silent Misconfiguration
Systems appear active but produce zero output due to pathing errors, missing env vars, or wrong model IDs.

**Bugs:** RT-002 (edit-watcher zero events for 4 cycles — Windows path bug), RT-003 (systems-sync same bug), Alex β model `claude-sonnet-4-6-20250514` silently failed.

**Detection:** Every system that writes output must verify: entry count > 0, most recent entry < 24h old, output format valid. "No errors" is not "working."

## 3. QA Agent Design

### 3.1 — Agent Definition

The QA agent is a read-only team member that scans code and infrastructure for failure-mode signatures. It does NOT write production code.

**File:** `.claude/agents/qa.md`

**Properties:**
- **Model:** Sonnet (fast enough for scanning, smart enough for judgment)
- **Tools:** Read, Grep, Glob, Bash (read-only commands only)
- **Disallowed tools:** Edit, Write
- **maxTurns:** 25

**Persona:** The QA agent knows the 7 failure personas by name and signature. It returns structured findings, not prose.

### 3.2 — Two Modes

**Passive scan** — Given a set of changed files (from `git diff`), check for persona patterns:
- Stale Reader: new `loadSession()` without prop? new `useEffect([], [])` without session prop?
- Phantom Render: conditional render pattern? useRef(false) in async context?
- Gate Dodger: new API route without verifySession/rateLimit?
- Spec Ghost: types.ts field removal without prompts.ts cleanup?

**Active audit** — Walk the full codebase checking all 7 personas systematically. Run on-demand via skill invocation.

### 3.3 — Output Schema

```json
{
  "scan_type": "passive|active",
  "files_checked": 42,
  "findings": [
    {
      "id": "QA-001",
      "persona": "stale-reader",
      "severity": "high|medium|low",
      "file": "src/components/steps/Step8Ingredients.tsx",
      "line": 15,
      "evidence": "loadSession() in useEffect without session prop",
      "suggested_fix": "Accept session as prop, add useEffect sync"
    }
  ],
  "clean_personas": ["cascade-amplifier", "spec-ghost"],
  "summary": "2 findings across 42 files. 5 personas clean."
}
```

### 3.4 — Integration Points

- **With Alex β:** Alex β judges whether findings are worth fixing now or deferring. QA reports, Alex β prioritizes.
- **With evaluator:** Evaluator checks code against spec (correctness). QA checks code against failure patterns (robustness). Complementary.
- **With builder:** QA runs after builder completes, before merge. Findings can block merge if severity=high.
- **With smart-context:** Recent QA findings injected into prompt context (like learnings and Alex β decisions).
- **Findings stored:** `paths.eventsFile` via logger, category `qa`.

### 3.5 — Skill

**Skill file:** `.claude/commands/qa/check.md`

Invocable as `/qa:check` (passive, on recent changes) or `/qa:audit` (active, full codebase).

## 4. Playwright Test Suite

### 4.1 — Setup

```
tests/
  e2e/
    onboarding.spec.ts     — Steps 1-3 happy path + stale reader tests
    menu-research.spec.ts   — Steps 4-5 + loading transition tests
    ingredient-curation.spec.ts — Step 6 (simplified MVP)
    shop.spec.ts            — Step 10 smoke test
  fixtures/
    dummy-session.json      — Pre-built session data for mid-flow tests
  helpers/
    dummy-plug.ts           — Navigate to /?dummyplug&step=N, wait for ready
    assertions.ts           — Common assertions (no flash, data persists, etc.)
  playwright.config.ts
```

### 4.2 — Key Test Patterns

**Dummy Plug for state setup:** Every test that needs to start mid-wizard uses `/?dummyplug&step=N` to fast-forward. No real API keys or recipe uploads needed.

**Persona-targeted tests:**

| Test | Persona | What it does |
|------|---------|-------------|
| Speed Runner | Phantom Render | Click Next at 0ms delay through all steps. Assert zero frame flicker (no element appears for <100ms then disappears). |
| Session Persistence | Stale Reader | Complete step 3, refresh page, verify step 4 loads with all step 3 data intact. |
| Async Overwrite | Stale Reader | Start recipe parse, immediately advance. Verify parse results aren't overwritten by stale snapshot. |
| Loading Continuity | Phantom Render | During step 4-5 (fetch→analysis), assert a loading indicator is ALWAYS visible — no 1-frame gap. |
| Gate Probe | Gate Dodger | Call `/api/claude` without auth cookie. Assert 401. Call `/api/subscription/grant` with fake userId. Assert 403. |
| Double Mount | Phantom Render | On step transitions, count React mounts of the target component. Assert exactly 1. |

### 4.3 — Vercel Constraints

- Tests run against `npm run dev` (local), not Vercel deployment
- Account for Turbopack HMR — wait for page ready before assertions
- 60s timeout per test matches Vercel function timeout

## 5. Agent-Run Assertions

Checks that run during or after a multi-agent build run. These are NOT Playwright tests — they're Node.js scripts or hook-level checks.

### 5.1 — Pre-Merge Checks (after builder, before merge)

| Check | Persona | Implementation |
|-------|---------|---------------|
| Commit exists | Zombie Agent | `git log -1` in worktree, verify non-empty diff |
| Non-trivial diff | Zombie Agent | Count changed lines > threshold (e.g., >20 for a feature) |
| Branch correct | Stale Reader | `git branch --show-current` matches expected worktree branch |
| No skeleton stubs | Zombie Agent | Grep for `// TODO: implement` or `throw new Error('Not implemented')` |

### 5.2 — Post-Build Checks (after all builders, before eval)

| Check | Persona | Implementation |
|-------|---------|---------------|
| Worktree cleanup | Zombie Agent | `git worktree list` count matches expected (main + active only) |
| Spec ghost scan | Spec Ghost | For each feature marked "removed" in store.json, grep all spec layers for references |
| Build passes | General | `npm run build` exits 0 |

### 5.3 — Post-Gauntlet Checks (after eval+security+compliance, before merge)

| Check | Persona | Implementation |
|-------|---------|---------------|
| All reviewers ran | Gate Dodger | store.json GATE_CHECK has entries for all 3 reviewer types |
| No stale evaluations | Stale Reader | Evaluator timestamp > builder timestamp for same feature |

## 6. Infrastructure Health Protocol

Checks that verify the enforcement layer itself works. Run daily or at session start.

| System | Health Check | Persona |
|--------|-------------|---------|
| events.jsonl | Entry count > 0 in last 24h AND last entry < 1h old during active session | Silent Misconfig |
| memory-guard | At least 1 block AND at least 1 allow in last 24h | Silent Misconfig |
| edit-watcher | Spec edit event exists for the most recent spec file change | Silent Misconfig |
| learnings.jsonl | Count in range 30-100. Status distribution has >0 validated. | General |
| systems.jsonl | All 28 entries parse as valid JSON. No status="broken" without diagnostic notes. | General |
| Hooks registered | Every .js in scripts/hooks/ has a matching entry in settings.json | Silent Misconfig |
| STALE markers | Count across all spec files. Alert if >20 (cascade amplifier risk). | Cascade Amplifier |
| Orphan worktrees | `git worktree list` minus main = 0 outside active runs | Zombie Agent |

## 7. Implementation Sequence

Each step is independently useful. No step requires more than one session (~2 hours).

### Step 1: QA Agent (passive mode)
Build `.claude/agents/qa.md` and `/qa:check` skill. Passive scan only — given `git diff`, check for Stale Reader and Phantom Render patterns in changed files. Returns structured JSON. Immediately useful after every code change.

### Step 2: Playwright setup + 3 smoke tests
Install Playwright, configure for Next.js dev server. Write 3 tests: (1) Dummy Plug loads to each step, (2) Speed Runner through onboarding, (3) Session persistence across refresh. Proves the framework works.

### Step 3: Gate Dodger API tests
Playwright or plain Node.js: hit every `/api/` route without auth, verify 401/403. Hit with bad input, verify validation. No browser needed — pure HTTP.

### Step 4: Infrastructure health script
Node.js script (`scripts/qa-health.js`) that runs the infrastructure health protocol table above. Outputs pass/fail per system. Wire into session-start hook as advisory.

### Step 5: QA Agent (active audit mode)
Extend QA agent to walk full codebase. Add Spec Ghost detection (grep for removed features), Gate Dodger (API route audit), Silent Misconfiguration (output existence checks). Invocable via `/qa:audit`.

### Step 6: Agent-run assertions
Build pre-merge and post-build checks as scripts callable from the Boss agent prompt. Start with: commit exists, non-trivial diff, worktree cleanup, spec ghost scan.

### Step 7: Persona-specific Playwright tests
Loading Continuity, Async Overwrite, Double Mount tests. These require understanding the specific component behaviors — build after steps 1-6 establish the patterns.
