---
description: Deep fix — Full diagnostic with automatic framework selection, 5 solutions, root cause analysis, and prevention
---

# /fix:deep — Deep Diagnostic Fix

Full investigation pipeline. Classifies the error, selects the right diagnostic framework, generates multiple solutions, applies the best one, and logs a prevention learning.

Use this for: regressions, intermittent bugs, multi-system failures, agent hangs, vague symptoms, recurring issues.

> **⚠ MANDATORY — Phase 5.0 trace logging is non-optional.** Past runs have skipped it. Every `/fix:deep` invocation MUST append a trace entry to `paths.tracesFile` before reporting the fix. If you finish without logging the trace, the run is incomplete and future `/fix:deep` calls lose the pattern-match benefit. See Phase 5.0 for the exact write command.

## Input

`$ARGUMENTS` — Error description, stack trace, symptom, or context.

If no arguments: scan the current conversation for the most recent error or complaint. Use that.

## Phase 0: Check Reasoning History

**Goal**: Search memory for similar past problems before diagnosing.

1. Search `paths.tracesFile` for similar problems (grep for keywords from the error)
2. Search `paths.learningsFile` for related learnings
3. If a match is found: surface the prior framework, outcome, and quality score
4. Use this to bias framework selection in Phase 1.3 (but don't blindly reuse — compare context first)

**Output**: "Found [N] similar traces" or "No prior history."

## Phase 1: Triage

**Goal**: Classify the error and select a diagnostic framework.

### 1.1 Gather Evidence

Collect all available signals:
- Parse `$ARGUMENTS` for: error messages, HTTP codes, file paths, stack traces, timestamps
- Search `paths.learningsFile` for similar past issues (grep for keywords from the error)
- Search `the retro directory (check manifest.json projectPaths.retro for location)/*/BUGS.md` for prior occurrences
- Check `git log --oneline -20` for recent changes that might be related
- If a file is mentioned, read it. If a stack trace exists, read the top frame.

### 1.1a Verify-Before-Declaring-Absent (HARD RULE)

If diagnosis hinges on a Claude Code harness primitive, tool param, slash command, env flag, or feature being **absent** — **STOP before Phase 2**. Local introspection (ToolSearch, tool-schema description in the prompt, deferred-tools listing) is INCOMPLETE evidence. Claude Code gates experimental primitives behind env flags; tool schemas can be runtime-extended; ToolSearch keyword index can miss known-real tools.

Required confirmation steps (any ONE clears the gate):
1. **WebSearch** `code.claude.com/docs` for the primitive name and read the doc page.
2. **Dispatch the `claude-code-guide` subagent** with a targeted question about the primitive — it has WebFetch/WebSearch access and is the authoritative in-repo lookup.
3. **Test the call.** If a tool exists, attempting the call with the parameters per the docs is the cheapest disambiguator. The failed call returns a useful error; the successful call ends the investigation. Cost is one tool turn.

If you cannot clear the gate, do NOT proceed with a fix that assumes absence. File the question to the user instead — being wrong about absence has burned credibility 3× in the same week (RT-001, RT-005, RT-006). The Agent tool's spawn output is ground truth: if it advertises `Use SendMessage with to: <agentId>`, that primitive exists.

Sources: L-2026-05-14-verify-claude-code-primitives-before-declaring-absent, L-2026-05-14-test-the-call-before-declaring-impossible.

### 1.2 Classify Error Type

Based on gathered evidence, classify into one of:

| Category | Signals |
|----------|---------|
| **Code bug** | Build failure, type error, test failure, wrong return value |
| **Runtime error** | Uncaught exception, null ref, stack trace with crash |
| **API/Integration** | HTTP status code, timeout, auth failure, schema mismatch |
| **Config/Environment** | "not found", env var missing, path issue, CRLF, version mismatch |
| **Agentic system** | Agent hang, no output, infinite loop, orphan process, stale lock, worktree conflict |
| **Data/State** | Wrong values, partial data, corrupt state, cache stale, schema drift |
| **Infrastructure** | Build timeout, OOM, deploy failure, disk full, CI error |
| **Tool/CLI** | Wrong flags, version incompatible, permission denied, exit code != 0 |
| **Security** | 401/403, CORS, CSP, token expired, auth bypass |
| **Spec/Logic** | Feature works but does wrong thing, requirement mismatch, UX flow break |

### 1.3 Select Framework

Use this decision tree:

```
IF clear error with file:line AND no prior occurrences
  → Direct Investigation

IF "it used to work" OR "regression" OR "broke after update"
  → Binary Search (git bisect)

IF HTTP status code OR API error OR timeout
  → Trace Analysis (follow the request through layers)

IF intermittent OR race condition OR "sometimes works"
  → Fault Tree Analysis (map all possible causes with AND/OR gates)

IF found in learnings OR bug registry (recurring)
  → RCA (formal root cause analysis — why does it keep happening?)

IF "works on my machine" OR env-specific
  → Differential Diagnosis (compare environments systematically)

IF agent hang OR no output OR infinite loop OR orphan process
  → Agentic System Protocol:
    1. Check PIDs: any zombie processes?
    2. Check locks: any stale lock files?
    3. Check worktrees: any conflicts?
    4. Check output files: any partial writes?
    5. Check rate limits: any 429s in logs?

IF build/deploy failure
  → Trace Analysis (follow the pipeline: source → build → test → deploy)

IF wrong behavior (not error) OR spec mismatch
  → 5 Whys (why does it do X instead of Y?)

IF vague / unclear / "something is wrong"
  → Differential Diagnosis (list 5+ possible causes, eliminate one by one)
```

**Output**: State the classification and selected framework before proceeding.

## Phase 2: Diagnose

**Goal**: Find the root cause using the selected framework.

Execute the framework step-by-step. For each framework:

### Direct Investigation
1. Read the file at the error location
2. Trace data flow backward from the error
3. Identify where the data/logic first goes wrong
4. State the root cause

### 5 Whys
1. **Why 1**: Why does [symptom] happen? → Because [A]
2. **Why 2**: Why does [A] happen? → Because [B]
3. **Why 3**: Why does [B] happen? → Because [C]
4. **Why 4**: Why does [C] happen? → Because [D]
5. **Why 5**: Why does [D] happen? → Because [root cause]

### Root Cause Analysis (RCA)
1. **Problem statement**: One sentence describing the observable problem
2. **Timeline**: When did it start? What changed? (check git log)
3. **Data collection**: Read error logs, affected files, related configs
4. **Cause identification**: List all contributing factors
5. **Root cause**: The deepest cause that, if fixed, prevents all symptoms
6. **Contributing factors**: Other things that made it worse

### Fault Tree Analysis
1. **Top event**: The failure being investigated
2. **Level 1 gates**: What conditions must be true for the failure? (AND/OR)
3. **Level 2 events**: Break each condition into sub-causes
4. **Basic events**: Leaf nodes — testable hypotheses
5. **Cut set**: The minimal set of basic events that cause the top event
6. Test the most likely cut set first

### Binary Search (git bisect)
1. Identify the last-known-good state (commit, date, or version)
2. Run `git log --oneline` to find the range
3. Binary search: test the midpoint commit
4. Narrow until the breaking commit is found
5. Read that commit's diff to identify the cause

### Trace Analysis
1. Identify the entry point (API call, user action, cron trigger)
2. Follow the request through each layer (client → API route → service → external API → response)
3. At each layer, check: does the data look correct here?
4. Find the layer where data first goes wrong
5. Read the code at that layer to find the bug

### Differential Diagnosis
1. List 5+ possible causes (brainstorm broadly)
2. For each: what evidence would confirm or rule it out?
3. Test the easiest-to-verify causes first
4. Eliminate causes one by one with evidence
5. Confirm the remaining cause

**Output**: Root cause statement (or top 3 candidates if uncertain).

## Phase 3: Ideate Solutions

**Goal**: Generate 3-5 fix options and rank them.

For each solution, assess:

| Solution | Correctness | Blast Radius | Effort | Prevention |
|----------|-------------|--------------|--------|------------|
| Option 1 | Fixes root cause? | What else could break? | Files/lines changed | Prevents recurrence? |
| Option 2 | ... | ... | ... | ... |
| ... | ... | ... | ... | ... |

Also check:
- Does a similar fix exist in `git log`? If so, reference it.
- Does a hygiene rule in `the retro directory (check manifest.json projectPaths.retro for location)/*/HYGIENE.md` address this pattern?

**Recommend** the solution with the best correctness + lowest blast radius. If two are tied, prefer the one that prevents recurrence.

## Phase 4: Apply Fix

1. Implement the recommended solution
2. If blast radius is HIGH (touches 3+ files, changes shared interfaces, affects production), state the risk and wait for confirmation
3. After applying:
   - Run `npm run build` to verify no compile errors
   - If a test covers the affected code, run it
   - Describe manual verification steps if needed
4. If verification fails: try the next-ranked solution from Phase 3

### 4.x Skill-Body Touch Check (HARD RULE for skill-driven bugs)

If the diagnosed root cause is "skill body misled Alpha or the user" (or any variant where a `.claude/commands/**/*.md` file drives the wrong behavior), the diff for the fix MUST include a change inside the skill's `## Procedure` section (or equivalent body). Edits limited to:
- `## Built-in primitive limits` / appendix sections
- `## Notes` / footnotes
- Sibling reference docs (`_docs/**`, `.claude/project/reference/**`)
- The future-flag ledger (`mc-to-update.md`)

…do NOT close the loop. Alpha and the user both read the procedural body first; appendices are skipped on default flow. A doc-only fix re-triggers the bug next session.

Detection (do this before marking the trace `quality_score >= 2`):
1. List the files touched by the fix diff.
2. For any `.claude/commands/**/*.md` in the list, grep for `## Procedure` and verify the diff includes a hunk inside it.
3. If no skill body was touched but the root cause was skill-driven, the fix is incomplete — return to Phase 3 and re-pick.

Source: L-2026-05-14-doc-only-fix-antipattern (validated 2026-05-14 — RT-004 was an appendix-only fix that re-triggered the bug 24 hours later).

**Output**: Files changed + verification result.

## Phase 5: Learn & Prevent

### 5.0 Log Reasoning Trace + Score Quality — MANDATORY

**Do this FIRST, before any other Phase 5 step.** Past `/fix:deep` runs have silently skipped trace logging because it was buried at the end. The trace is the *output* of this skill — without it, Phase 0 of the next `/fix:deep` run has nothing to pattern-match against.

Append a reasoning trace to `paths.tracesFile` with:
- `id`: `RT-<next-integer>` (count existing entries + 1)
- `ts`: ISO timestamp
- `framework_selected`: The framework used in Phase 1.3
- `framework_rationale`: WHY that framework was chosen
- `history_match`: Trace ID from Phase 0 if one was found (else null)
- `problem`: One-sentence symptom
- `root_cause`: The root cause statement from Phase 2
- `fix`: One-sentence fix description
- `quality_score`: Score the fix 0-4 using the quality scale in CLAUDE.md §2
- `source`: "fix:deep"
- `learning_id`: ID of the learning appended in 5.1 (cross-link)

**Exact write command** (memory-guard enforced, do NOT deviate):

```bash
node -e "const {PATHS}=require('./scripts/hooks/lib/paths'); const fs=require('fs'); fs.appendFileSync(PATHS.tracesFile, JSON.stringify({id:'RT-XXX',ts:new Date().toISOString(),/* ... */})+'\n')"
```

**Never use:** `writeFileSync` (blocked), bash `>>` or `echo >>` redirects (blocked by echo/redirect guards), literal path strings (use `PATHS.tracesFile` per Paths SSoT).

**Self-check before reporting the fix:** did you run the node append command above? If no, stop and run it. Reporting a fix without logging the trace is an incomplete `/fix:deep` run.

### 5.1 Log the Fix

If this bug reveals a pattern (not a one-off typo):

```json
{"ts":"YYYY-MM-DD","intent":"bug_fix","tip":"<what was learned — max 300 chars>","effective":null,"pending_validation":true,"score":0,"source":"fix:deep"}
```

Append to `paths.learningsFile` using `appendFileSync` (same method as 5.0, different PATHS key).

### 5.2 Prevention Recommendation

Ask: could this class of bug be prevented automatically?

| Prevention Type | Example | When to suggest |
|----------------|---------|-----------------|
| **Lint rule** | Ban `Math.random()` for crypto | Pattern bug in code style |
| **Hook** | Pre-commit check for env vars | Config/environment issues |
| **Type constraint** | Stricter TypeScript types | Type-related bugs |
| **Test** | Regression test for the specific case | Behavioral bugs |
| **Hygiene rule** | Add to HYGIENE.md for agents | Agent-caused bugs |
| **None** | One-off, not preventable | Truly unique issues |

State the recommendation but do NOT auto-apply prevention measures. The user decides.

### 5.3 Bug Registry

If this session is during an agent run (check for active run context):
- Append to `the retro directory (check manifest.json projectPaths.retro for location)/{NN}/BUGS.md` with: symptom, root cause, fix, severity
- If it's a pattern bug, also update `HYGIENE.md`

### 5.4 Capture Eval Fixture

If this fix involved incorrect pipeline output (bad data, missing fields, wrong structure):

1. Identify the pipeline stage where the output went wrong (e.g., `MARKET_OUTPUT`, `RESUME_OUTPUT`)
2. Capture the input that produced the bad output (from session data or reproduction)
3. Capture the bad output itself
4. Append to `.claude/eval/fixtures/fixtures.jsonl`:

```json
{"id":"FIX-NNN","ts":"YYYY-MM-DD","source":"fix:deep","pipeline_stage":"MARKET_OUTPUT","input_snapshot":{},"bad_output":{},"fix_description":"what was wrong","dimensions_affected":["completeness","accuracy"],"trace_id":"RT-NNN"}
```

5. Cross-link to the trace ID from 5.0

**Skip if:** the bug was a code typo, config issue, hook problem, or non-data bug. Only capture when the bug involved incorrect AI-generated output flowing through the pipeline.

**Goal:** Accumulate 20-50 fixtures over time for evaluator calibration.

**Output**: Summary — what was learned, what prevention is recommended.
