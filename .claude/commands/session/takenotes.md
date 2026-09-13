---
description: Append a timestamped note to a per-topic file under runtime/notes/
user-invocable: true
---

# /session:takenotes — Take a Quick Note

Append a dated note to a per-topic markdown file under `paths.runtime/notes/<topic-slug>.md`. Use this while working to jot things down that don't belong in events, memory, or handoffs — e.g. "MC issues found this session," "decisions deferred," "things to try next."

Each topic gets its own file. First note for a topic creates the file; subsequent notes append. The file has an `# <topic>` header followed by timestamped bullets — newest at the bottom.

## Input

`/session:takenotes <topic-slug> <note body>`

- **topic-slug** — first whitespace-separated token, slugified (lowercase, non-alphanumerics → `-`, collapse runs of `-`). Examples: `mc-issues-found`, `launch-day-observations`, `deferred`.
- **note body** — everything after the first token. Multi-line welcome. Markdown inside a bullet works.

If topic or body is missing, print usage and stop.

## Procedure

### Step 1: Parse args

Split the raw input on the first run of whitespace:

```js
const match = raw.trim().match(/^(\S+)\s+([\s\S]+)$/);
if (!match) { console.error('Usage: /session:takenotes <topic> <note body>'); process.exit(1); }
const topic = match[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const body  = match[2].trim();
```

### Step 2: Resolve file path

Prefer `paths.runtime` from `.claude/paths.json`, fall back to literal. The topic's file lives under a `notes/` subdirectory:

```js
const { PATHS } = require('./scripts/hooks/lib/paths');
const fs = require('fs'), path = require('path');
const runtime = (PATHS && PATHS.runtime) || '.claude/runtime';
const notesDir = path.join(runtime, 'notes');
fs.mkdirSync(notesDir, { recursive: true });
const notesFile = path.join(notesDir, `${topic}.md`);
```

### Step 3: Ensure file has header

If `<topic>.md` doesn't exist, create it with:

```markdown
# <topic>

Append-only log. Newest entries at the bottom.
```

Where `<topic>` is the slug (unquoted). Leave a blank line between the header block and the first bullet.

### Step 4: Append the timestamped bullet

ISO timestamp format: `new Date().toISOString().replace(/\.\d+Z$/, 'Z')` — drop millis for readability.

Append a single bullet to the end of the file on its own line:

```
- **<ISO-8601 timestamp>** — <body>
```

Multi-line bodies: indent continuation lines with two spaces so they render as part of the bullet.

If the file already ends with content (not a blank line), add a newline before the new bullet. Preserve a trailing newline after the bullet.

### Step 5: Write + confirm

Use `fs.appendFileSync` (or read + rewrite if you need to manage trailing newlines). This is an append-style update.

Output one line:

```
Noted to notes/<topic>.md (<N> entries in topic).
```

Where `N` is the bullet count in the file after this append.

## Rules

- Do NOT edit or reorder existing bullets — append-only.
- Do NOT dedupe — identical back-to-back notes are allowed.
- Do NOT truncate long bodies — preserve verbatim.
- One file per topic. Different topics → different files. No exceptions.
- If a legacy `.claude/runtime/notes.md` monolith exists, leave it alone as a historical archive. Do NOT migrate its contents.
- No gauntlet, no β consult — this is a single-file append, fire and forget.

## Migration note

Before this skill update, notes were appended to a single `.claude/runtime/notes.md` file under `## <topic>` H2 sections. That file is preserved as an archive. All new invocations of `/session:takenotes` write to `.claude/runtime/notes/<topic>.md` instead. There is no automated migration; old topics stay in the archive, new notes start fresh.

## Example

```
/session:takenotes mc-issues-found fav:list reads favorites.md without delimiters — stored prompt injection risk
```

Creates (or appends to) `.claude/runtime/notes/mc-issues-found.md`.

```
/session:takenotes deferred redteam full audit — wait until after launch
```

Creates (or appends to) `.claude/runtime/notes/deferred.md`.
