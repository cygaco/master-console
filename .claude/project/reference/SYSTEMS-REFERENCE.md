
# Alex — Systems Reference

Built on Claude Code. Project: the origin product (a job-search app). Branch: skeleton-test6.

## What Is This?

"Alex" is an autonomous AI assistant that runs inside Claude Code (Anthropic's
CLI). It has persistent memory, self-improving learnings, a skill library,
multi-agent orchestration, and a biologically-inspired "sleep" cycle.

The system is built as hooks (scripts that fire on events), skills (markdown
command files), and JSONL data stores. Claude Code loads CLAUDE.md as the
system prompt, hooks inject context per-prompt, and skills define reusable
capabilities.

---

## Data Stores & Who Writes Them

### .claude/project/memory/learnings.jsonl — 36 entries, target 30-50

```
WRITES:  /learn:ingest   (external knowledge from URLs/videos)
         /learn:self     (promotes pending -> effective, prunes stale)
         /sleep:deep     (Phase 1: consolidation, merge, decay, prune)
         context-enhancer.js  (adds entries from session assessments)
READS:   context-enhancer.js  (injects top ~10 relevant per prompt)
         /sleep:deep     (all phases reference learnings)
         /fix:deep       (Phase 0: check history before fixing)
FORMAT:  {"ts","intent","tip","effective","score","source","importance",
          "pending_validation","fix_quality","conditions"}
NOTES:   effective:true = validated. pending_validation:true = unproven.
         Never self-rate. Only external signals promote.
```

### .claude/project/memory/traces.jsonl — EMPTY (reasoning engine unused)

```
WRITES:  /reasoning:trace     (manual trace logging)
         /reasoning:classify  (auto after classification)
         /fix:deep            (Phase 5: post-fix trace)
READS:   context-enhancer.js  (would inject REASONING HISTORY)
         /sleep:deep          (Phase 1g: retroactive reclassification)
         /reasoning:evaluate  (reviews past traces)
FORMAT:  {"ts","problem","framework","solution","quality_score",
          "reclassified_from","reclassified_ts"}
NOTES:   Empty because /reasoning:* and /fix:deep have never been invoked.
```

### .claude/project/memory/modifications.jsonl — 11 entries, all validated

```
WRITES:  Alex manually  (instruction in CLAUDE.md says "log after self-mods")
         No hook enforcement — relies on Alex remembering
READS:   /learn:self    (reviews whether self-mods achieved their purpose)
         /sleep:deep    (Phase 3: replay analysis)
FORMAT:  {"ts","file","change","reason","status"}
NOTES:   Tracks changes to CLAUDE.md, hooks, skills, agents. "status" is
         untested -> validated. Instruction-following only, no automation.
```

### .claude/project/memory/systems.jsonl — 22 entries

```
WRITES:  systems-sync.js  (PostToolUse hook, auto-updates on Edit/Write
                           to hook scripts, skills, or src/lib/ files)
         Alex manually    (new systems, status changes)
         /sleep:deep      (Phase 5: marks broken systems)
READS:   session-start.js (counts pending learnings, untested systems)
         /status:system   (dashboard view)
         /sleep:deep      (all phases reference system health)
FORMAT:  {"id","name","description","status","category","files",
          "depends_on","test","diagnose","created","last_modified","notes"}
NOTES:   Status: active | untested | stub | broken. This is the manifest
         that tracks every subsystem.
```

### .claude/project/memory/inbox.jsonl — 2 messages, 24h TTL

```
WRITES:  session-stop.js   (auto-broadcasts session summary on exit)
         /threads:write    (manual cross-session message)
         systems-sync.js   (auto-broadcasts on foundation file changes)
READS:   context-enhancer.js  (injects as CROSS-SESSION INBOX per prompt)
FORMAT:  {"ts","from","message","files_changed","session_id"}
NOTES:   Messages older than 24h are ignored by context-enhancer.
         Purpose: multiple Alex sessions running in parallel can see
         what each other did.
```

### .claude/runtime/handoffs/*.md — 57 files

```
WRITES:  session-stop.js  (generates rich handoff on Stop/SessionEnd/
                           StopFailure events)
READS:   session-start.js (loads latest handoff into session context)
         /session:resume  (manual reload after /clear)
         /session:history (browse past handoffs)
         /sleep:deep      (Phase 3: replay analysis)
FORMAT:  Markdown with branch state, conversation summary, assessment
NOTES:   One generated per session end. /sleep prunes old ones.
         The "PREVIOUS SESSION HANDOFF" block at session start comes
         from here.
```

### .claude/.session-tracking.jsonl — 0 lines (cleared by sleep)

```
WRITES:  session-tracker.js  (PostToolUse hook, fires on EVERY tool call)
READS:   session-stop.js     (summarizes session activity for handoff)
         /sleep:deep         (Phase 2: clears it)
FORMAT:  {"ts","tool","file","event"}
NOTES:   Grows fast (hundreds of lines per session). Sleep clears it.
         Pure telemetry — feeds handoff generation.
```

### .claude/dreams/journal.md — Append-only sleep log

```
WRITES:  /sleep:deep  (all 6 phases append results)
         /sleep:quick (phases 1-2 only)
READS:   session-start.js  (surfaces key findings at session start)
FORMAT:  Markdown sections: NREM, Cleanup, Replay, REM Dreams, Repair,
         Growth — one dated section per sleep cycle
NOTES:   Append-only (appendFileSync). Never overwrite.
```

### .claude/dreams/coaching.md — Append-only morning briefings

```
WRITES:  /sleep:deep Phase 4+6  (coaching synthesis + session briefing)
READS:   session-start.js       (morning briefing at session start)
FORMAT:  Markdown: Morning Briefing, Suggested First Task, System Health
NOTES:   Append-only (appendFileSync). One dated section per cycle.
```

### .claude/dreams/YYYY-MM-DD.md — Dream paintings per cycle

```
WRITES:  /sleep:deep Phase 4  (REM dreaming — ASCII paintings + deep reads)
READS:   /sleep:deep Phase 4  (reads past dreams for recurring imagery)
FORMAT:  Markdown: ASCII art painting + Deep Read per dream
NOTES:   One file per sleep cycle. Accumulates over time.
```

### .claude/events/events.jsonl — DELETED (directory gone)

```
WRITES:  edit-watcher.js  (PostToolUse hook — BROKEN, target doesn't exist)
READS:   nothing
FORMAT:  Was {"id","ts","file","change","direction","trigger","source"}
NOTES:   Dead for 4 consecutive sleeps. Directory deleted at some point.
         Recommended: remove entirely. Git log serves the same purpose.
```

---

## Hook Pipeline

Hooks are JS scripts in `scripts/hooks/` registered in `.claude/settings.json`.
Claude Code runs them automatically on specific events. They execute in
order, and can inject context or block actions.

```
EVENT              HOOK SCRIPT           WHAT IT DOES
-----              -----------           ------------

SessionStart  -->  session-start.js      Loads latest handoff, coaching,
                                         counts pending learnings +
                                         untested systems, injects as
                                         context. Fires on /clear too.

UserPromptSubmit   (fires on every user message, in order)
              -->  prompt-enhancer.js    Sends raw prompt to Haiku for
                                         expansion. Fail-open (2s timeout).
              -->  context-enhancer.js   Injects learnings, inbox, traces,
                                         system state as <system-reminder>.
              -->  prompt-logger.js      Logs enhanced prompt to session log.

PreToolUse         (fires BEFORE a tool executes, can BLOCK it)
  Edit|Write  -->  secret-guard.js       Blocks writes containing API keys,
                                         tokens (sk-, ghp_, aws patterns).
              -->  foundation-guard.js   Guards foundation files from
                                         accidental modification.
              -->  ownership-guard.js    Enforces file ownership boundaries.
  Agent       -->  worktree-preflight.js Validates worktree before agent spawn.
              -->  gate-check.js         Agent gate validation.
              -->  gauntlet-gate.js      Gauntlet compliance enforcement.
              -->  cycle-enforcer.js     Build cycle enforcement.
  Read|Grep   -->  boss-boundary.js      Boundary enforcement for agent reads.
  |Glob

PostToolUse        (fires AFTER a tool executes)
  *           -->  session-tracker.js    Logs every tool call to
                                         .session-tracking.jsonl.
  Edit|Write  -->  edit-watcher.js         Decision logger (BROKEN — target
                                         directory deleted).
              -->  format.js             Auto-format edited files.
              -->  lint.js               Auto-lint edited files.
              -->  typecheck.js          TypeScript type check.
              -->  systems-sync.js       Auto-updates systems.jsonl when
                                         hook/skill/lib files change.
                                         Auto-broadcasts to inbox.jsonl.

PostCompact   -->  compact-saver.js      Saves context snapshot when Claude
                                         Code compresses conversation.

Stop          -->  session-stop.js       Generates handoff, broadcasts to
SessionEnd    -->  session-stop.js       inbox, captures session summary.
StopFailure   -->  session-stop.js       (same handler for all 3 events)
```

---

## Systems — Full Details

### MEMORY (6 systems)

#### 1. Unified Memory — ACTIVE

The directory `.claude/project/memory/` containing all 5 JSONL files (learnings,
traces, modifications, systems, inbox). The foundation everything else
depends on.

#### 2. Long-term Memory (Learnings) — ACTIVE

Semantic memory. 36 entries with importance tagging, staged promotion
(`pending_validation` -> `effective`), and fix quality scores. Target 30-50
entries. Context enhancer injects relevant ones into every prompt.

#### 3. Episodic Memory (Handoffs) — ACTIVE

Session snapshots generated on stop, loaded on start. Stored in
`.claude/runtime/handoffs/`. Also broadcasts to inbox on session end for
cross-session awareness.

#### 4. Procedural Memory (Skills) — ACTIVE

72 skills as markdown files in `.claude/commands/`. CRUD managed via
`/skills:create`, `/skills:edit`, `/skills:delete`. Skills ARE Alex's
capabilities.

#### 5. Self-Modification Log — STUB

`.claude/project/memory/modifications.jsonl` tracks changes to Alex's own
infrastructure (CLAUDE.md, hooks, skills). Has 11 entries but relies on
Alex remembering to log — no hook enforcement.

#### 6. Cross-Session Threads — ACTIVE

Inbox system (`.claude/project/memory/inbox.jsonl`) for multiple Alex sessions to
communicate. Auto-broadcasts on session stop, manual via `/threads:write`.
24h TTL. Messages appear in context injection.

### AUTOMATION (7 systems)

#### 7. Prompt Enhancer — ACTIVE

First UserPromptSubmit hook. Sends your raw prompt to Claude Haiku for
expansion/clarification. Fail-open (if Haiku times out or fails, original
passes through). Disable with `DISABLE_PROMPT_ENHANCER=1`.

#### 8. Context Enhancer — ACTIVE

Second UserPromptSubmit hook. Injects relevant learnings (both effective
and pending with `?` label), inbox messages, traces, and system state
alongside every prompt. The "RECENT LEARNINGS" block in system-reminders
comes from this.

#### 9. Sleep Cycle — ACTIVE

6-phase biologically-inspired consolidation:

```
Phase 1 (NREM)    — learning consolidation: tag, replay, dedup, decay, promote
Phase 2 (Cleanup) — clear session files, prune handoffs, compact logs, git gc
Phase 3 (Replay)  — re-read session, cross-ref retros, find blind spots
Phase 4 (REM)     — creative dreaming: inversion, analogy, cross-pollination
Phase 5 (Repair)  — security scan, npm audit, architecture drift, hook check
Phase 6 (Growth)  — evolution summary, pre-compute next session briefing
```

Modes: `/sleep:deep` (all 6, ~15-30 min), `/sleep:quick` (phases 1-2,
~5 min), `/sleep:dream` (phase 4 only, for stuck problems).

#### 10. Retrospective Analysis — UNTESTED

1 skill (`/oneshot:retro`, with `--context` and `--code` narrow modes) for
cross-run pattern analysis. Designed to produce BUGS.md, HYGIENE.md,
LEARNINGS.md. Never executed in current form. (Consolidated 2026-04-25 from former 3-skill retro:* namespace.)

#### 11. Gap Detection & Automation — UNTESTED

`/evolve:scan`, `/evolve:auto`, `/evolve:prompting`. Scans for automation
gaps — missing hooks, skill improvements, prompting patterns. Never executed.

#### 12. Learning Review — UNTESTED

`/learn:self`. Reviews learnings, validates pending entries, prunes stale
ones. Executed once in a prior session (promoted 9 mods, added 2 learnings).

#### 13. Decision Audit Trail — BROKEN

edit-watcher.js PostToolUse hook was supposed to log spec edits to
`.claude/events/events.jsonl`. The target directory was deleted. Dead for
4 consecutive sleeps. Dream solution: kill it, use git as the decision log.

### COGNITION (6 systems)

#### 14. Identity & Doctrine — ACTIVE

CLAUDE.md. The behavioral rules that make Alex "Alex": act autonomously,
never escalate, detect layer, manage systems. Instruction-following only,
no code enforcement.

#### 15. Reasoning Engine — STUB

Framework-driven problem solving. Classify problem -> select framework ->
solve -> score quality -> log trace. Skills exist (`/reasoning:classify`,
`/reasoning:trace`, `/reasoning:evaluate`, `FRAMEWORKS.md`). traces.jsonl
is empty — never invoked.

Frameworks: Direct Investigation, Binary Search (bisect), Trace Analysis,
Fault Tree, Root Cause Analysis, Differential Diagnosis, 5 Whys,
JTBD, Eisenhower Matrix, SWOT, Design Patterns, Rubber Duck.

#### 16. Deep Diagnostic Fix — UNTESTED

`/fix:deep`. Full investigation pipeline: classify error, select framework,
generate 5 solutions, apply best, log prevention. Never invoked.

#### 17. Quick Fix — UNTESTED

`/fix:fast`. Direct investigation: read error, find cause, fix, verify.
Never invoked.

#### 18. Research Pipeline — ACTIVE

Multi-engine research — queries Claude, ChatGPT (Codex CLI), and Gemini CLI
in parallel. Synthesizes results. Applies learnings. 9 completed research
topics.

Modes: `/research:simple` (fast 3-engine), `/research:deep` (Gemini writes
brief, then OpenAI Deep Research + Gemini Deep Research + Claude multi-round).

#### 19. Evaluation Pyramid — ACTIVE

4-tier cascade: deterministic assertions (pipeline-assertions.ts) ->
same-model check -> cross-model Gemini judge -> human flag queue. Built
based on deep research findings. `/eval:cascade` skill + golden fixtures.

### INTEGRATION (1 system)

#### 20. Agent Orchestration — ACTIVE

Boss-directed multi-agent system for codebase regeneration. Builders,
evaluators, fixers, security agents working from `store.json` task manifest.
6 successful runs completed.

### SESSION (2 systems)

#### 21. Session Rhythms — UNTESTED

Proactive behaviors: session-start health check, post-work retro triggers,
pattern-to-skill conversion. Implemented in `session-start.js` + CLAUDE.md
rules but instruction-following only.

#### 22. (included in Memory) Cross-Session Threads

See Memory #6 above.

---

## Skill Namespaces (72 skills)

Skills are markdown files in `.claude/commands/{namespace}/{name}.md`.
Invoked as `/{namespace}:{name}` (e.g., `/sleep:deep`, `/fix:fast`).

```
NAMESPACE    COUNT  PURPOSE                              STATUS
---------    -----  -------                              ------
audit          13   Code, security, architecture audits  Active
preflight       7   Pre-agent-run validation passes      Dormant (no runs)
sleep           3   Memory consolidation cycles          Active
research        2   Multi-engine deep research           Active
learn           2   Knowledge ingestion + self-review    Active
skills          4   Skill CRUD management                Active
session         4   Handoffs, checkpoints, history       Active
threads         2   Cross-session messaging              Active
eval            1   4-tier evaluation cascade            New
retro           4   Post-run retrospective analysis      Untested
evolve          3   Gap detection + automation           Untested
reasoning       4   Problem classification + tracing     Stub
fix             2   Bug diagnosis (fast + deep)          Untested
hooks           5   Hook management + friction analysis  Mixed
status          2   System + project dashboards          Active
warp            3   Cross-product sync (MC)          Dormant
deploy          1   Pre-deploy checklist + push          Dormant
reconcile       2   Spec staleness scanning              Dormant
fav             2   Favorite moments collection          Dormant
wakeup          2   Morning briefing review              Dormant
step            1   Step screenshot inspection           Dormant
```

---

## System Status Summary

```
+-- ACTIVE (9) -----+-- BROKEN (1) --+-- STUB (2) -----+-- UNTESTED (6) ---+
| identity           | decision-log   | reasoning-engine | fix-deep          |
| prompt-enhancer    |                | self-mod-tracking| fix-fast          |
| context-enhancer   |                |                  | retro-system      |
| sleep-system       |                |                  | evolve-system     |
| research-engine    |                |                  | self-evaluation   |
| multi-agent        |                |                  | proactive-behavs  |
| evaluation-system  |                |                  |                   |
| cross-session-thrd |                |                  |                   |
| learnings          |                |                  |                   |
+--------------------+----------------+------------------+-------------------+
```

Known Issues:
- decision-log: target directory deleted, edit-watcher.js writes to void
- reasoning-engine: skills exist, traces.jsonl empty, never invoked
- 23 orphan agent/wt-* branches from Run 006 (safe to delete)
- 18+ skills built but never exercised

---

## Data Flow Diagram

```
USER MESSAGE
     |
     v
+------------------+     +-------------------+
| prompt-enhancer  |---->| Haiku API (2s)    |
| (expand/clarify) |<----| fail-open         |
+------------------+     +-------------------+
     |
     v
+------------------+     +-------------------+
| context-enhancer |<----| learnings.jsonl   |
| (inject context) |<----| inbox.jsonl       |
|                  |<----| traces.jsonl      |
+------------------+     +-------------------+
     |
     v
+============+
||  CLAUDE  ||  <-- sees enhanced prompt + injected context
|| (Opus 4) ||
+============+
     |
     v
TOOL CALLS (Edit, Write, Agent, Read, etc.)
     |
     +--[PreToolUse]----> secret-guard (BLOCK if secrets)
     |                    foundation-guard (BLOCK if protected)
     |                    ownership-guard (BLOCK if wrong owner)
     |
     +--[PostToolUse]---> session-tracker --> .session-tracking.jsonl
     |                    pulse-core -----> events.jsonl (BROKEN)
     |                    format/lint/typecheck (auto-quality)
     |                    systems-sync ---> systems.jsonl + inbox.jsonl
     |
     v
SESSION END (Stop/SessionEnd/StopFailure)
     |
     v
+------------------+     +-------------------+
| session-stop.js  |---->| handoffs/*.md     |
|                  |---->| inbox.jsonl       |
+------------------+     +-------------------+

SLEEP CYCLE (manual: /sleep:deep)
     |
     +-- Phase 1 (NREM) -----> learnings.jsonl (consolidate/prune)
     +-- Phase 2 (Cleanup) --> .session-tracking (clear), handoffs (prune)
     +-- Phase 3 (Replay) ---> dreams/journal.md (insights)
     +-- Phase 4 (REM) ------> dreams/YYYY-MM-DD.md (paintings + deep reads)
     +-- Phase 5 (Repair) ---> systems.jsonl (mark broken), npm audit
     +-- Phase 6 (Growth) ---> dreams/coaching.md (next-session briefing)
```
