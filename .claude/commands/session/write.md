---
description: Post a message to the cross-session inbox so other Alex sessions can see it. Default is fully automatic — no arguments needed. Use `--about <topic>` to focus the broadcast on a specific topic the user wants emphasized.
---

# /session:write — Cross-Session Message

Posts an inbox event to `.claude/project/events/events.jsonl` (cat=inbox) that all other Alex sessions will see on their next prompt (via context-enhancer).

**Default behavior is fully automatic** — `/session:write` with no arguments auto-gathers everything worth sharing and broadcasts. You don't decide what to include; the skill does.

## Modes

| Invocation | Behavior |
|------------|----------|
| `/session:write` | Auto-gather + write to inbox. This is the **auto mode** — no user input needed. Message covers whatever stood out this session. |
| `/session:write <note>` | Auto-gather + append the user's note verbatim at the end + write to inbox. |
| `/session:write --about <topic>` | **Topic-focused mode.** User tells the skill what the message should be *about*; skill auto-gathers, filters/re-orders the gathered context to emphasize that topic, composes a focused message, and writes to inbox. Still a write, not read-only. Example: `/session:write --about our new backend idea and how it impacted requirements` → broadcast message centers on the backend design + its spec impact, not on a generic session summary. |

## Input

`$ARGUMENTS` — Optional.

- If the first token is `--about`, treat the rest of the arguments as the **topic** the user wants the broadcast message to focus on. The skill still writes to the inbox; the topic tells it what to emphasize from the auto-gathered context. Non-topical material is dropped from the final message (kept only if it's critical context).
- Otherwise the arguments are treated as a free-form user note appended to the auto-composed message.
- If omitted entirely, the skill auto-gathers ALL context and broadcasts without user direction.

## Process

### 1. Auto-Gather Context (no user effort required)

The skill collects everything another session would need. Run these in parallel:

**a) Git state:**
```bash
BRANCH=$(git branch --show-current)
LAST_COMMIT=$(git log -1 --format="%h %s" 2>/dev/null)
UNCOMMITTED=$(git diff --stat HEAD 2>/dev/null | tail -1)
```

**b) Recent file changes** (what was actually touched this session):
```bash
# Files modified in the last 2 hours (session proxy)
git diff --name-only HEAD 2>/dev/null | head -15
```
If no uncommitted changes, check `git log --since="2 hours ago" --name-only --format=""` instead.

**c) Last user task:** Read the conversation context — what was the user's last major request or goal? Summarize in one line.

**d) Learnings added:** Check if any learnings were appended to `.claude/project/memory/learnings.jsonl` this session (compare line count or check recent timestamps).

**e) Systems changed:** Check if any of these were modified: `CLAUDE.md`, `.claude/commands/**`, `scripts/hooks/**`, `.claude/reference/**`, `.claude/project/memory/systems.jsonl`. List which ones.

**f) Research outputs:** Check if any new files exist under `paths.research` (`_docs/research/`) that weren't there before.

**g) Spec changes:** Check for modified files in `_requirements/04-features/` or `_requirements/03-architecture/`.

### 2. Build Message

Compose the message automatically from gathered context:

```
Session ended. Last task: {user's last major request}
{UNCOMMITTED — e.g. "14 files changed, 3 insertions(+), 2 deletions(-)"}
{Key files: list of important changed files, max 10}
{If learnings added: "+N learnings"}
{If systems changed: "Systems modified: CLAUDE.md, hooks/foo.js, ..."}
{If research: "Research: {paths.research}/{slug}/"}
{If $ARGUMENTS provided: "Note: {user's message}"}
```

**Keep it under 500 chars.** Other sessions get this injected into every prompt — be dense, not verbose.

```json
{
  "ts": "ISO-8601 timestamp",
  "session_id": "read from .claude/runtime/.session-id",
  "from": "{branch} / {one-line task descriptor}",
  "message": "{auto-composed message above}",
  "files_changed": ["auto-gathered list"]
}
```

### 3. Branch by mode

**If `--about <topic>` in $ARGUMENTS** (topic-focused mode):

Recompose the message so it is *about* the topic the user specified. Steps:

1. Re-rank the gathered context by relevance to the topic (files, systems, decisions that touch the topic go first; unrelated noise is dropped).
2. Include a one-line framing at the top: `Topic: {user's --about string}`.
3. Compose a dense, topic-focused message that a future session would need to continue that specific thread (not a generic session log).
4. Write to inbox via the logger as normal.
5. Confirm with a brief "Shared to inbox (topic-focused): ..." note.

**Otherwise** (default / note-appended mode): write via the logger with the auto-composed message; append user's free-form note verbatim if provided.

Use the centralized logger to write the inbox event:
```bash
node -e "const {log}=require('./scripts/hooks/lib/logger'); log('inbox', {from:'...', message:'...', files_changed:[...]}, {session:'...'}); console.log('OK')"
```

No cleanup needed — events.jsonl is append-only, context-enhancer already filters by 24h TTL.

### 4. Confirm

Output a brief confirmation:
```
Shared to inbox: "{first 80 chars of message}"
Other sessions will see this on their next prompt.
```

Always output the confirmation — both default and `--about` modes write to the inbox.

## Auto-Share Triggers

Consider posting to inbox automatically when:
- A significant system change is made (new hook, new skill, CLAUDE.md edit)
- A breaking change to shared files (types.ts, constants.ts, settings.json)
- After `/sleep` completes (consolidation results)
- After a commit that other sessions should know about

## Notes

- Messages expire after 24 hours automatically
- Max 5 most recent messages shown per prompt (older ones still in file but not injected)
- The prompt-enhancer reads this file on every UserPromptSubmit
- All sessions sharing the same project directory share the same inbox
- This is one-way broadcast — no replies or threading. Keep messages self-contained.
