---
description: Deep research pipeline — queries Claude, ChatGPT (Codex), and Gemini in parallel, saves reports, synthesizes, and applies learnings
says:
  - quick research
  - look this up
  - research simple
  - simple research
says-args: free-text
---

# /research — Deep Research Pipeline

Run deep research on a topic using three AI engines in parallel, then synthesize and apply learnings.

## Input

`$ARGUMENTS` — A research brief or topic. Can be a single sentence or a multi-paragraph brief.

If no arguments provided, ask the user for a research brief.

## Phase 1: Prepare Research Brief

Take the user's input and expand it into a structured research prompt. The prompt should:

1. State the research question clearly
2. Ask for: current state of the art, key approaches, trade-offs, practical implementation advice, pitfalls, and real-world examples
3. Request structured output with sections and citations where possible
4. Specify the context: read CLAUDE.md and PROJECT.md for project context. If unavailable, say "This research will be applied to a software project."

Generate a `topic-slug` from the input (lowercase, hyphenated, max 40 chars). Example: "self-improving AI agents" → `self-improving-ai-agents`.

**Resolve the output base from `paths.research`** (never hardcode):

```bash
RESEARCH_BASE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/paths.json','utf8')).research)")
OUTDIR="$RESEARCH_BASE/{topic-slug}"
mkdir -p "$OUTDIR"
```

Save the brief to `$OUTDIR/BRIEF.md`.

## Phase 2: Parallel Research (3 agents)

Launch THREE research tasks in parallel. Each gets the same research prompt but targets a different AI engine.

### Agent 1: Claude (WebSearch + WebFetch)

Use the Agent tool with a general-purpose agent. The agent should:
- Use WebSearch to find 5-10 relevant sources
- Use WebFetch to read the most promising 3-5 sources
- Synthesize findings into a structured report
- Save to `$OUTDIR/claude-report.md`

The agent prompt should include the full research brief and instruct it to write the report file directly.

### Agent 2: ChatGPT (via Codex CLI)

Use Bash to run:
```bash
timeout 300 codex exec --sandbox workspace-write -m o3 -C "$CLAUDE_PROJECT_DIR" \
  "Research the following topic thoroughly and write your findings to $OUTDIR/chatgpt-report.md. Include sections: Overview, Key Approaches, Trade-offs, Implementation Advice, Pitfalls, Examples, Sources. Topic: {research prompt}"
```

Notes:
- `--full-auto` = workspace-write sandbox + auto-approve
- `-m o3` for deep research (or `-m gpt-5.6-sol` for the latest model your account serves)
- `-C` sets working directory so relative paths work
- `timeout 300` wraps the command (Codex has no native timeout)
- `-o /tmp/codex-summary.txt` can optionally capture the final message
- If codex fails, log the error and continue — don't block the pipeline

### Agent 3: Gemini (via Gemini CLI)

Use Bash to run:
```bash
timeout 300 gemini -p "Research the following topic thoroughly. Write your complete findings in markdown format with these sections: Overview, Key Approaches, Trade-offs, Implementation Advice, Pitfalls, Examples, Sources. Be thorough and cite real sources. Topic: {research prompt}" -o text 2>/dev/null > $OUTDIR/gemini-report.md
```

Notes:
- `-p` for non-interactive headless mode
- `-o text` for clean text output (no ANSI codes)
- `2>/dev/null` strips status messages (credential notices, retry warnings)
- stdout redirect to file is MORE RELIABLE than asking Gemini to write files (path interpretation quirks)
- `timeout 300` wraps the command (Gemini has no native timeout, auto-retries rate limits indefinitely)
- For deeper research, add `-m gemini-2.5-pro` (default is flash)
- If gemini fails, log the error and continue

**IMPORTANT**: Launch all three in parallel (single message with 3 tool calls). Don't wait for one before starting the next.

## Phase 3: Collect & Verify

After all three complete:

1. Read each report file that was successfully created
2. Note which engines succeeded and which failed
3. Log a brief status: "Claude: {lines} lines, ChatGPT: {lines} lines, Gemini: {lines} lines"

If fewer than 2 reports exist, warn the user but continue with what's available.

## Phase 4: Synthesize

Read all available reports and create `$OUTDIR/SYNTHESIS.md` with:

```markdown
# {Topic} — Research Synthesis

**Date:** {YYYY-MM-DD}
**Sources:** Claude, ChatGPT, Gemini (note any that failed)
**Brief:** {original brief}

## Consensus

What all sources agree on.

## Key Insights

Unique valuable insights from each source (attribute them).

## Disagreements

Where sources contradict — note which is likely correct and why.

## Practical Takeaways

Ranked list of actionable insights, most impactful first.

## Applicability to This Project

How these findings apply to the current project. Read CLAUDE.md and PROJECT.md for project context.

## Raw Reports

- [Claude Report](claude-report.md)
- [ChatGPT Report](chatgpt-report.md)
- [Gemini Report](gemini-report.md)
```

## Phase 5: Apply Learnings

From the synthesis, extract learnings and apply them:

1. **Learnings**: For each actionable insight, append to `.claude/project/memory/learnings.jsonl`:
   ```json
   {"ts":"YYYY-MM-DD","intent":"external","tip":"the learning","effective":null,"pending_validation":true,"score":0,"source":"research/{topic-slug}"}
   ```

2. **System improvements**: If the research suggests changes to hooks, skills, or agent prompts — note them but do NOT auto-apply. List them as recommendations in the synthesis.

3. **Summary**: Tell the user what was learned, what was applied, and what needs manual review.

## Error Handling

- If a CLI tool fails, capture stderr, log it, and continue with remaining engines
- If only 1 report is available, still synthesize (note limited perspective)
- If 0 reports are available, report the failure and suggest manual research
- Never block the entire pipeline on a single engine failure
