---
description: Design and create a new hook from a description
user-invocable: true
says:
  - add a hook
  - make a hook that
  - new hook
  - hooks add
says-args: free-text
---

# /hooks:add — Create a New Hook

Takes a description of what the hook should do and:

1. Parses the description to determine:
   - Which event (PreToolUse, PostToolUse, etc.)
   - Which matcher (Bash, Edit|Write, etc.)
   - What the script should do
2. **Check execution order** — Read `.claude/project/maps/hooks.jsonl` and find all hooks registered for the same event+matcher. Display the current chain with execution order. Show where the new hook will be inserted. If the new hook is fail-closed, warn: "This hook will block all subsequent hooks in the chain on failure." This is advisory — does not block creation.
3. Writes the hook script to `paths.hooks/`
   - **Paths SSoT rule:** always import from `lib/paths.js`. Never hardcode `.claude/*` paths in hook code.
     ```js
     const { PROJECT, relPath, PATHS } = require("./lib/paths");
     // Read from registry:
     const eventsLog = PATHS.eventsFile;
     const learnings = PATHS.learningsFile;
     const agentsDir = PATHS.agents;
     ```
   - NEVER copy-paste PROJECT/relPath patterns inline. NEVER write literal `.claude/project/...` strings in hook bodies. If a path you need isn't in `paths.json` yet, add the key before writing the hook.
   - Hooks that don't use `lib/paths.js` are prone to Windows path bugs.
4. Updates `.claude/settings.json` to wire it in
5. Tests it by triggering the relevant tool

## Usage

`/hooks:add block writes to .env files` → creates a PreToolUse hook on Edit|Write that rejects .env edits
