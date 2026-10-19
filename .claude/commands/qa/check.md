---
description: Passive QA scan on recent git diff changes — checks for 7 failure-mode signatures
---

# /qa:check — Passive QA Scan

Scan recently changed files for failure-mode signatures. Fast, targeted, run after every code change.

## Input

`$ARGUMENTS` — Optional: git ref range (default: HEAD~1..HEAD). Example: `main..HEAD`

## Procedure

### Step 1: Get Changed Files

Run `git diff --name-only ${ARGUMENTS || "HEAD~1..HEAD"}`. Filter to `.ts`, `.tsx`, `.js`, `.md` files.

If no changed files, report:
```json
{"scan_type": "passive", "files_checked": 0, "findings": [], "clean_personas": ["stale-reader", "phantom-render", "cascade-amplifier", "gate-dodger", "zombie-agent", "spec-ghost", "silent-misconfig"], "summary": "No files changed."}
```

### Step 2: Spawn QA Agent

Spawn the QA agent (`.claude/agents/product/quality/qa-reviewer.md`) with:

**Agent type:** qa

**Prompt:**
Run a PASSIVE scan on these changed files:
[list the files from Step 1]

Check each file against all 7 personas. Return the structured JSON result.
scan_type must be "passive".

### Step 3: Log Findings

For each finding in the result, log to the event system. Use a cross-platform approach (Windows-safe):
```bash
node -e "const {log}=require('./scripts/hooks/lib/logger'); log('qa', JSON.parse(process.argv[1]))" -- "${finding_json}"
```

If shell quoting is problematic, write findings to a temp file and read it:
```bash
echo '${findings_json}' > /tmp/qa-findings.json
node -e "const {log}=require('./scripts/hooks/lib/logger'); const f=require('/tmp/qa-findings.json'); f.forEach(r => log('qa', r))"
```

### Step 4: Report

Display the JSON result. If any finding has severity "high", prominently warn:
"HIGH severity findings — fix before commit."
