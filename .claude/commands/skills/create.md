---
description: Create a new skill from a description — supports simple, multi-phase, and parallel workflows
says:
  - create a skill
  - make a new skill
  - new skill for
  - skills create
says-args: free-text
---

# /skill:create — Create a New Skill

## Usage

```
/skill:create <name> "<description>"
/skill:create  (interactive — will ask for name and description)
```

## Procedure

### Step 0: Paths rule (read this first)

When you author the new skill's content, reference project paths via **`paths.X` keys** (e.g. `paths.eventsFile`, `paths.learningsFile`, `paths.hooks`, `paths.maps`), **not** literal strings like `.claude/project/memory/learnings.jsonl`. The registry lives at `.claude/paths.json`; literals rot when we move things.

If you need to mention the resolved location for reader clarity, use: `` `paths.learningsFile` (`.claude/project/memory/learnings.jsonl`) `` — key first, literal in parens.

This is enforced at commit time by `scripts/path-lint.js` (critical findings exit 1). Upstream enforcement starts here.

### Step 1: Parse input

Extract the skill name and description from the user's command. If not provided, ask:
- "What should this skill be called?" (lowercase, hyphens for spaces)
- "What should it do?" (one sentence)

### Step 2: Determine skill shape

Based on the description, classify:

| Shape | When | File structure |
|-------|------|---------------|
| **Simple** | Single procedure, sequential steps | `namespace/name.md` |
| **Multi-phase** | Multiple distinct phases (research → analyze → apply) | `namespace/name.md` with `## Phase N` sections |
| **Parallel** | Phases that run concurrently | Same as multi-phase, mark with `**PARALLEL**` |
| **Subcommanded** | Multiple modes or entry points | `namespace/sub1.md`, `namespace/sub2.md` — one file per subcommand |

Multi-phase and parallel are NOT separate systems — they're just skills with richer step structure.

### Step 3A: Generate single skill file (simple, multi-phase, parallel)

**Path:** `.claude/commands/<namespace>/<name>.md`

If the namespace directory doesn't exist, create it. If adding to an existing namespace, just add the file.

```markdown
---
description: <one-line description — shown in /command autocomplete>
---

# /<namespace>:<name> — <Title>

<One-line description of what this skill does and when to use it.>

## Input

`$ARGUMENTS` — <what the user passes>

## Procedure

### Step 1: <Action>
<Instructions>

### Step 2: <Action>
<Instructions>
```

For multi-phase skills, use `## Phase N: <Name>` with steps inside each phase.
For parallel phases, add `**PARALLEL**` and describe concurrent steps.

### Step 3B: Generate subcommanded skill (multiple entry points)

**Path:** `.claude/commands/<namespace>/` directory with one `.md` per subcommand.

For each subcommand, create a separate file:

```
.claude/commands/<namespace>/
  sub1.md    → registers as /namespace:sub1
  sub2.md    → registers as /namespace:sub2
  sub3.md    → registers as /namespace:sub3
```

Each file has its own frontmatter, title, and procedure:

```markdown
---
description: <what this subcommand does>
---

# /<namespace>:<subcommand> — <Title>

<Description>

## Input

`$ARGUMENTS` — <what the user passes>

## Procedure
...
```

**CRITICAL:** Do NOT create a root `.md` file (e.g., `<namespace>.md`) alongside the directory. It won't register as a skill AND it blocks sub-skill detection. The subcommand files ARE the skills.

### Step 4: Phase design rules (for multi-phase and parallel skills)

- Each phase has a clear input and output
- **PARALLEL** phases: all steps launch in one message, results collected after all complete
- Phases reference prior phase output by name (e.g., "Read the reports from Phase 2")
- For CLI tools (codex, gemini, claude), use the validated patterns:
  - Codex: `timeout 300 codex exec --sandbox workspace-write -m o3 -C "$CLAUDE_PROJECT_DIR" "prompt"`
  - Gemini: `echo "context" | gemini -p "instruction" -o text 2>/dev/null > output.md` — `-p` flag is REQUIRED for headless mode. Without it, piped stdin hangs.
  - Claude: `claude --bare -p --dangerously-skip-permissions --model sonnet "prompt"`
  - All need `timeout` wrapper. Stdout redirect (`> file.md`) is more reliable than asking the AI to write files.
- Error handling: each phase should note what to do if it fails (skip, retry, warn user)

### Step 5: Verify

Read the created file(s) back. Confirm:
- Frontmatter has `description`
- Steps are numbered and specific
- File paths are correct
- No root `.md` alongside a subcommand directory
- CLI commands use validated patterns

Report: "Created `/namespace:name` — N steps. Try it with `/namespace:name`."
For subcommanded: "Created `/namespace` — N subcommands: `:sub1`, `:sub2`, `:sub3`."

## Spoken triggers — the `says:` frontmatter (operator-facing skills)

Operator-facing skills (explicit `user-invocable: true`) carry a `says:` block so a dictated sentence ("wrap up the session") routes to the skill without the operator remembering its slug. This section is the authoring summary.

```yaml
---
description: ...
user-invocable: true
says:
  - wrap up the session
  - end the session
  - session end
says-flags:
  quick: --quick
says-args: none
says-confirm: never
---
```

Rules:

- `says` holds 3–6 phrases. Each is lowercase, 2–8 words, letters/digits/apostrophes/spaces only — no commas, colons, slashes, or hyphens (the dictated form never has them).
- Put the natural sentence first and the slug spoken plainly ("session end") as one phrase. Add a mangled-dictation variant only when fuzzy matching would not catch it.
- Phrases must be unique across the whole catalog. A phrase that maps to two skills is a lint failure, not a runtime tie.
- `says-flags` maps a spoken form to a flag the skill body actually documents. Never invent a flag.
- `says-args` is `none` (default), `free-text` (remainder passes verbatim as `$ARGUMENTS`), or `topic` (one quoted topic).
- `says-confirm: always` (or `fuzzy-only`) is REQUIRED when the slug or a documented flag matches push, remote, land, deploy, release, delete, uninstall, authoriz, purchase, turbo, or force. Voice never lowers an autonomy ceiling. `fuzzy-only` applies to the permission-widening family (`mode:*`, `sprint:full`, `session:turbo`, `turbo`): an explicit, exactly-spoken name runs directly (HIGH); a fuzzy match, or the widening flag surfacing as a secondary modifier on another skill, asks one line first (MEDIUM).
- Alias/forwarder skills (description starts `[alias →` or `[deprecated alias →`) must NOT carry `says:`.
- Preserve every existing frontmatter key. Claude Code ignores unknown keys, so `says:` is harness-safe.

Enforcer: `scripts/checks/skill-says-lint.js`.
