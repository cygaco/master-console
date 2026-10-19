---
description: Catch up on the last N turns of this session — what you asked, what I did, what's still pending
user-invocable: true
says:
  - recap the session
  - catch me up
  - what did we do
  - what's still pending
  - session recap
says-args: topic
---

# /session:recap — Last-N-Turns Recap

Use this when you've walked away from the session and come back, or returned the next day, and need a fast read on where we left off. Surfaces what you asked, what I did, what's still pending, and current branch/mode state — all from the live `paths.eventsFile`, `runtime/notes/`, and git, no stale handoff file.

Pairs with:
- **/session:read** — cross-session inbox messages from OTHER sessions
- **/session:history** — pick a past session's handoff to reload
- **/session:resume** — load the last handoff into context

## Input

`$ARGUMENTS` — Optional `N` (1–10), default `3`. Each turn = one user prompt + everything I did before the next user prompt.

Examples:
- `/session:recap` — last 3 turns
- `/session:recap 5` — last 5 turns
- `/session:recap 1` — just the most recent turn

## Procedure

### Step 1: Run the recap script

```bash
node scripts/session-recap.js $ARGUMENTS
```

If `$ARGUMENTS` is empty, the script defaults to N=3. Output is markdown — render it directly to the user without modification or summarization. The script handles:

- Pulling the last N `cat:"prompt", actor:"user"` events from `paths.eventsFile`
- For each turn, slicing all events between that prompt and the next (or now)
- Summarizing tools used, files touched, bash commands, blocks, Beta consults
- Detecting **pending / unsolved** signals:
  - Phrases in your message that look like complaints (`still`, `0 results`, `broken`, `doesn't work`, multiple `?`)
  - Beta consults sent via SendMessage without an inbox reply from Beta yet
  - Hook blocks that fired during the turn
  - Notes appended to `paths.runtime/notes/*.md` during the turn
- Pulling git commits since the start of the window
- Reading `paths.runtime/mode.json`, current branch, uncommitted file count

### Step 2: Add any context the script can't see

Only if relevant — don't pad the output. Things you might know that the script doesn't:
- A teammate (Beta/Gamma) is currently working on something — check `~/.claude/teams/*/heartbeat.json`
- A long-running build or agent is still in flight — check `~/.claude/tasks/*/`
- The user just asked a question in the most recent turn that doesn't have a matching tool/edit yet (the script sees this as "no tools used" but it might be unanswered)

If there's nothing extra worth adding, end the response after the script output. **Do not summarize the recap** — the recap IS the summary.

### Step 3 (optional): Offer next-step suggestions

If the recap surfaces obvious next steps (e.g. "2 Beta consults pending" → "Want me to chase Beta?"), offer them tersely. Skip if the user's last message already implies they know what to do.

## Output shape

```markdown
## Session recap — last N turn(s)

### Turn -N (X min ago)

**You:** <verbatim user message, ≤300 chars>

- Edited <count> file(s): <relative paths>
- Ran: `<top bash commands>`
- Tools: <Bash×N, Read×N, Edit×N, ...>
- Beta consults: <N>
- Blocked <N>× (<first block reason>)

### Turn -N+1 (...)
...

### Open / pending in this window
- **Turn -X**: you flagged "..."
- **Turn -X**: N Beta consult(s) sent without reply yet
- **Turn -X**: hook block — ...
- **Turn -X**: note modified: `.claude/runtime/notes/<topic>.md`

### Commits this window (N)
- <sha> <subject>

### Current state
- Branch: `<branch>`
- Uncommitted: N file(s)
- Mode: `<adhoc|oneshot|solo>`
- Open note topics: `<topic1>`, `<topic2>`
- Last turn: X min ago
```

## Notes

- **Pure read.** No agents, no commits, no writes — this is meant to be sub-second and safe to run any time.
- **Source is event-sourced.** `paths.eventsFile` is the truth, not the conversation transcript. If an event wasn't logged, it won't appear here.
- **Pending detection is pattern-based.** Watches for specific complaint markers in your verbatim text, plus structural signals (unreplied Beta consults, hook blocks). Not exhaustive — surface anything the script missed in Step 2.
