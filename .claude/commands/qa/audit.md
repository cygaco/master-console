---
description: Active full-codebase QA audit — systematically walks all 7 failure-mode personas
---

# /qa:audit — Active QA Audit

Walk the full codebase checking all 7 failure-mode personas systematically. Thorough, run on-demand.

## Input

`$ARGUMENTS` — Optional: specific persona slug (e.g., `gate-dodger`). Default: all 7 personas.

## Procedure

### Step 1: Build File Inventory

Glob these categories:
- Components: `src/components/**/*.tsx`
- API routes: `src/app/api/**/route.ts`
- Libraries: `src/lib/**/*.ts`
- Hooks: `scripts/hooks/**/*.js`
- Specs: `_requirements/04-features/**/*.md`
- Architecture: `_requirements/03-architecture/**/*.md`

### Step 2: Determine Scope

- No args: audit all 7 personas
- Persona slug arg: audit only that persona (e.g., `gate-dodger`)

### Step 3: Spawn QA Agent

Spawn the QA agent with:

**Agent type:** qa

**Prompt:**
Run an ACTIVE audit across the full codebase. File inventory:
[paste the categorized file list from Step 1]

Scope: ${ARGUMENTS ? "Only persona: " + ARGUMENTS : "All 7 personas"}

For each persona in scope, systematically:
a. Stale Reader: scan all loadSession() files, cross-ref with useEffect deps and prop signatures
b. Phantom Render: scan useRef(false) files, conditional render patterns in step components
c. Cascade Amplifier: count STALE markers in _docs/, check hooks for non-idempotent ops
d. Gate Dodger: audit all API routes for auth (getAuthToken + verifyJWT), rate limiting, CSRF, validation
e. Zombie Agent: check git worktree list, grep for TODO stubs, check events for dispatch-unknown
f. Spec Ghost: cross-reference types.ts exports against all spec layers
g. Silent Misconfig: verify events.jsonl freshness, hook wiring, system output

Return the structured JSON result. scan_type must be "active".

### Step 4: Log and Report

Log all findings via event logger (category: "qa"). Use a cross-platform approach:
```bash
node -e "const {log}=require('./scripts/hooks/lib/logger'); const findings=JSON.parse(process.argv[1]); findings.forEach(f => log('qa', f))" -- "${findings_json}"
```
Display the complete JSON result with a summary table:

| Persona | Findings | Severity |
|---------|----------|----------|
