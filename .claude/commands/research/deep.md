---
description: Real deep research — Gemini Thinking writes the brief, then OpenAI Deep Research API + Gemini Deep Research API + Claude multi-round search run in parallel
---

# /research:deep — Real Deep Research Pipeline

Uses the actual deep research engines (not just "be thorough" prompts):
- **Brief**: Gemini Thinking (gemini-2.5-flash) writes the research prompt
- **OpenAI**: Deep Research API (`o3-deep-research` via Responses API) — autonomous multi-step web crawling
- **Gemini**: Deep Research API (`deep-research-pro-preview-12-2025` via Interactions API) — autonomous research agent
- **Claude**: Multi-round iterative WebSearch + WebFetch (3 rounds) — best available without API-level deep research

## Input

`$ARGUMENTS` — A research topic or question. Can be brief — Gemini Thinking will expand it.

If no arguments provided, ask the user for a research brief.

## Phase 0 + Phase 1 + Phase 2 (OpenAI + Gemini legs): Run the Node runner

The Node runner handles all async polling, key loading, Phase 0 quota probe, and
report writing. Claude's leg (Phase 2 leg 3) and synthesis stay below because they
require the harness Agent tool and WebSearch.

```bash
node scripts/research/deep-run.js "$ARGUMENTS"
```

**Background-friendly**: the runner logs progress to stdout; the harness session
re-wakes when it completes. Add `--providers openai` or `--providers gemini` to
run only one provider. Add `--skip-phase0` if keys are pre-verified.

The runner writes to `<paths.research>/<slug>/` (resolved from `.claude/paths.json`).
The runner logs `[deep-run] outdir: <path>` near the top and `manifest written: <path>`
at the end. Capture the outdir from the runner's stdout:

```bash
DEEP_RUN_OUT=$(node scripts/research/deep-run.js "$ARGUMENTS")
echo "$DEEP_RUN_OUT"
OUTDIR=$(echo "$DEEP_RUN_OUT" | grep 'deep-run\] outdir:' | head -1 | sed 's/.*deep-run\] outdir: //')
```

Read `$OUTDIR/manifest.json` to confirm which providers succeeded before proceeding.

---

## Phase 2 (leg 3): Claude Multi-Round WebSearch + WebFetch

Use the Agent tool with a general-purpose agent. Claude has no deep research API,
so we compensate with iterative multi-round searching.

Read `$OUTDIR/brief.json` first to get the research question and `claude_instructions`.

Agent prompt — fill in `{brief_content}` from `$OUTDIR/brief.json`:

```
You are conducting deep research across 4 phases. Be exhaustive — this is the deep research pipeline.

RESEARCH BRIEF:
{full brief from brief.json, including claude_instructions and all 4 phases}

OUTPUT FILE: {$OUTDIR}/claude-report.md

PROCESS — follow these 4 phases mapped to 3 search rounds:

ROUND 1 — LANDSCAPE + MECHANICS (Phases 1-2):
- Run 8-12 WebSearch queries covering: current state of the field, key players, implementation patterns
- WebFetch the 5 most promising results
- Note: what's well-covered, what has gaps, which sources are most authoritative
- Check stop conditions: 3+ approaches identified? 2+ code examples found?

ROUND 2 — FAILURE MODES (Phase 3):
- Run 5-8 WebSearch queries targeting: post-mortems, incident reports, CVEs, cost blowups, edge cases
- WebFetch 3-5 new sources focusing on what breaks and why
- Cross-reference claims from Round 1 — flag contradictions
- Check stop condition: 5+ failure modes documented?

ROUND 3 — CONTRARIAN + VERIFICATION (Phase 4):
- WebSearch for counterarguments, criticisms, alternative approaches
- WebFetch 2-3 contrarian/critical sources
- Verify the top 3 most important claims from Rounds 1-2 against primary sources
- Check stop condition: 2+ substantive counter-arguments found?

After all 3 rounds, write the report with this structure:

# {Topic} — Claude Deep Research Report

## Executive Summary (3-5 sentences)
## Phase 1: Landscape
## Phase 2: Mechanics
## Phase 3: Failure Modes
## Phase 4: Contrarian
## Source Registry
## Confidence Matrix
## Gaps Remaining
```

---

## Phase 3: Collect & Cross-Validate

After all three legs complete:

1. Check which reports were created:
```bash
for f in openai-report.md gemini-report.md claude-report.md; do
  fpath="$OUTDIR/$f"
  if [ -f "$fpath" ]; then
    lines=$(wc -l < "$fpath")
    echo "$f: $lines lines"
  else
    echo "$f: MISSING"
  fi
done
```

2. Read each successful report.
3. If fewer than 2 reports exist, warn the user but continue.

### Source Verification Pass

From across all reports, pick the 5 most important cited URLs. Use WebFetch to verify each one actually exists and supports the claim made. Record results for synthesis.

## Phase 4: Deep Synthesis

Read all available reports and verification results. Create `$OUTDIR/SYNTHESIS.md`:

```markdown
# {Topic} — Deep Research Synthesis

**Date:** {YYYY-MM-DD}
**Method:** Real Deep Research (OpenAI o3-deep-research + Gemini deep-research-pro + Claude 3-round search)
**Brief by:** Gemini Thinking (gemini-2.5-flash)
**Engines:** {list which succeeded and which failed/fell back}
**Original query:** {$ARGUMENTS}
**Estimated cost:** ~${X.XX} (OpenAI: ${a}, Gemini: ${b}, Claude: included)

## Executive Summary
The single most important finding, in 3 sentences.

## Cross-Validation Matrix

| Finding | OpenAI | Gemini | Claude | Verified | Confidence |
|---------|--------|--------|--------|----------|------------|
| {finding} | {agree/disagree/silent} | ... | ... | {Y/N} | {H/M/L} |

## Consensus (all engines agree)
## High-Confidence Insights
## Disagreements & Resolution
## Hallucination Check
## Sub-Question Answers
## Practical Takeaways
## Applicability to This Project
## Gaps & Future Research
## Engine Performance

## Raw Reports
- [OpenAI Report](openai-report.md)
- [Gemini Report](gemini-report.md)
- [Claude Report](claude-report.md)
- [Research Brief](BRIEF.md)
```

## Phase 5: Apply Learnings

1. **Learnings**: For each HIGH-confidence actionable insight, append to `paths.learningsFile` (`.claude/project/memory/learnings.jsonl`):
   ```json
   {"ts":"YYYY-MM-DD","intent":"external","tip":"the learning","effective":null,"pending_validation":true,"score":0,"source":"deep-research/{topic-slug}"}
   ```
   Only HIGH-confidence findings. MEDIUM stays in synthesis only.

2. **System improvements**: List as recommendations in synthesis. Do NOT auto-apply.

3. **Summary to user**:
   - Which engines used real deep research vs fallback
   - How many sources consulted across all engines
   - Cross-validation score (how many findings all 3 agreed on)
   - Top 3 actionable takeaways
   - Total wall-clock time
   - Estimated cost

## Phase 6: Research Recap

After everything is done (synthesis written, learnings saved), print a boxed terminal recap:

```
═══════════════════════════════════════════════════
  DEEP RESEARCH COMPLETE: {topic-slug}
═══════════════════════════════════════════════════
  Query:    {original user query}
  Engines:  {which succeeded} / {which failed or skipped}
  Duration: {total wall-clock time}
  Reports:  {$OUTDIR}/

  TOP 3 FINDINGS:
  1. {highest-confidence actionable finding}
  2. {second finding}
  3. {third finding}

  KEY NUMBER: {the single most surprising or important statistic}

  CONTRARIAN: {one-line summary of the strongest counter-argument}

  LEARNINGS SAVED: {N} to paths.learningsFile
  FULL SYNTHESIS:  {$OUTDIR}/SYNTHESIS.md
═══════════════════════════════════════════════════
```

This recap is the LAST thing printed — it's the "what did we just do?" anchor.

## Error Handling

- API key missing → probe fails → engine skipped with actionable message
- Quota exhausted → phase0 probe → engine skipped before wasting 30+ min async
- Runner fails entirely → exits non-zero → synthesize from Claude leg only
- Only 1 report available → synthesize with reduced confidence
- 0 reports → report failure, suggest `/research` (standard) as fallback

## Fallback Chain Summary

| Engine | Primary | Fallback 1 | Fallback 2 |
|--------|---------|------------|------------|
| **Brief** | Gemini CLI (gemini-2.5-flash) | Inline default brief | — |
| **OpenAI** | Deep Research API (o3-deep-research, 4-phase) | Deep Research API (o4-mini-deep-research) | Skip engine |
| **Gemini** | Interactions API + API key | Interactions API + OAuth token | Skip engine |
| **Claude** | 3-round WebSearch + WebFetch | (always available) | — |

**Key loading** (handled inside the runner via `scripts/dispatch/auth-resolver.js`):
- Full precedence: override key-file → process.env → .env.local → .env → ~/.gemini/.env → OAuth
- Keys are NEVER printed — only source labels and lengths are logged

**CRITICAL — Gemini CLI headless mode** (for brief generation): The `-p` flag with actual
text is **required** for non-interactive mode. Without `-p`, piped stdin causes the CLI to
enter interactive mode, which hangs without a TTY. Always:
`echo "context" | gemini -p "instruction" -o text`
