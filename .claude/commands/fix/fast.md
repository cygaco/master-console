---
description: Quick fix — Direct Investigation, no formal framework. Read error, find cause, fix it, verify.
says:
  - quick fix
  - fix it fast
  - just fix it
  - fix fast
  - patch this
says-args: free-text
---

# /fix:fast — Quick Fix (Direct Investigation)

Fix a bug fast. No formal diagnostic framework — just read, trace, fix, verify.

## Input

`$ARGUMENTS` — Error message, symptom description, file path, or stack trace.

If no arguments: scan the current conversation for the most recent error, stack trace, or complaint. Use that.

## Step 1: Read the Error

Parse the input for actionable signals:
- **Error message**: Extract the exact error text
- **File + line**: If a stack trace or file:line reference exists, go directly there
- **Symptom**: If no error message, identify what's wrong ("shows wrong data", "hangs", "returns 404")

If the input contains a stack trace, read the top frame's file immediately. If it contains an error message, grep the codebase for it.

If the input is vague (e.g., "fix step 5"), check:
1. Recent conversation for error context
2. Recent git diff for recently changed files
3. `npm run build` output for compile errors

## Step 2: Trace and Fix

Follow the data/control flow from the error to its root cause:
1. Read the file where the error occurs
2. Trace the data backward — where does the bad value come from?
3. Identify the root cause (wrong logic, missing check, stale value, bad import, etc.)
4. Apply the fix directly

**Rules:**
- Fix the root cause, not the symptom
- Minimal change — don't refactor surrounding code
- If you're unsure about the fix, say so and present 2 options — don't guess

## Step 3: Verify

After applying the fix:
1. Run `npm run build` if it's a TypeScript/compile issue
2. If a specific test exists for the affected code, run it
3. If the fix is behavioral, describe how to verify manually

**If verification fails**: Don't loop — report what happened and suggest `/fix:deep` for a thorough investigation.

## Step 4: Log (if new pattern)

If this bug reveals a pattern that could recur:
- Append a learning to `.claude/project/memory/learnings.jsonl`:
  ```json
  {"ts":"YYYY-MM-DD","intent":"bug_fix","tip":"what was learned","effective":null,"pending_validation":true,"score":0,"source":"fix:fast"}
  ```
- Only log if the pattern is non-obvious. Don't log typo fixes.

## Step 5: Reasoning Trace (if non-trivial)

If the fix was more than a typo/import fix, log a reasoning trace to `.claude/project/memory/traces.jsonl`:
- `framework_selected`: "direct"
- `source`: "fix:fast"
- `quality_score`: Score the fix 0-4 using the quality scale in CLAUDE.md
- Use `/reasoning:log` or append directly
