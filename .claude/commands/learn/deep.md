---
description: Deep learning — extracts from conversation + event log + retro/report files (oneshot retros, sprint retros, _reports) in parallel, deduplicates, reports
says:
  - extract the learnings
  - deep learn
  - what did we learn
  - learn deep
  - harvest learnings
---

# /learn:deep — Comprehensive Learning Extraction

The single learning skill. Extracts from THREE sources in parallel, runs the full status audit + maintenance pass, then reports unified.

Only `/learn:deep`, `/learn:integrate`, and `/learn:ingest` remain in the learn namespace.

## Three Sources

| Source | What it captures | Procedure |
|---|---|---|
| **A. Conversation** | Corrections, effective patterns, discoveries, surprises from the current session | Phase A1–A3 below |
| **B. Event log** | Behavioral patterns from `paths.eventsFile` — tool hotspots, prompt drift, hook triggers, modification frequency | Phase B below |
| **C. Retro + report files** | Synthesized issues, hygiene rules, learnings, action-items, watch-outs from completed runs — oneshot retros, **sprint retros** (`sprint:full` Phase 5), and **`_reports/`** | Phase C below |

## Procedure

### Step 1: Parallel extraction

Launch three agents in parallel (single message, three Agent tool calls). Each agent appends learnings to `paths.learningsFile` via the canonical `logLearning()` helper.

**Do NOT call this inline as `node -e "require('./scripts/hooks/lib/logger').logLearning(...)"`.** The merge-guard hook blocks `node -e` invocations that perform fs writes. The helper does an `fs.appendFileSync` to `paths.learningsFile`, so it trips the rule even though the helper itself is canonical.

Allowed alternatives:
1. **One-shot script file (preferred).** Write a tiny `scripts/log-learnings-phase-<a|b|c>.js` that requires the helper and calls `logLearning(...)` once per learning. Run it via `node scripts/log-learnings-phase-<a|b|c>.js`. Delete after the run if it was truly one-shot.
2. **Edit tool against `paths.learningsFile` directly.** Each learning is a single JSONL line; append via Write (with a prior Read) or via a templated Edit. This skips the helper's tracer event but stays inside hook-friendly territory.

`source` field values: `learn:deep:conversation`, `learn:deep:events`, `learn:deep:retros`. (Legacy `learn:conversation` and `learn:events` source values still accepted by readers but new entries should use the consolidated names.)

**Do NOT** call `log('conversation_learning', ...)` or `log('event_learning', ...)` — those write ONLY to events.jsonl. Direct `appendFileSync` to learnings.jsonl is allowed inside a `scripts/*.js` file as a fallback but skips the tracer event.

---

#### Phase A — Conversation scan (Agent A)

Launch as a sub-agent or run inline. Look for:

##### A.1 Three signal types
1. **Corrections** — User told you to do differently: "no don't do X", "stop doing Y", wrong assumptions
2. **Effective patterns** — Approaches that worked: "yes exactly", "perfect", unusual choices accepted, techniques that solved efficiently
3. **Discoveries** — Non-obvious things learned about codebase/tools/environment: API quirks, CLI flags, error codes, undocumented patterns

##### A.2 Status audit
For each existing learning in `paths.learningsFile`, classify status this session:

| Status | Means | How to detect |
|---|---|---|
| **Implemented** | Has actual code enforcement (hook, lint, CLAUDE.md rule) | `implemented_by` field present |
| **Informed** | You actively referenced it to make a decision | Trace conversation: did this learning change what you did? |
| **Injected** | Surfaced in RECENT LEARNINGS context but didn't drive a decision | Was in context block, no active use |

For informed learnings: bump `score` by +0.1 (cap at 1.0). Flag high-score (>0.7) but NOT implemented = promotion candidates for `/learn:integrate`.

##### A.3 Quality maintenance
- For `status: "logged"` entries: validate against current codebase (referenced files/patterns exist?). If verified useful: `status: "validated"`. If stale: remove.
- For `status: "validated"` + score > 0.7: check if enforcement exists; if so → `implemented` with `implemented_by`. If not, flag as integration candidate.
- Remove duplicates (same meaning, different wording — keep higher-scored or more specific).
- Remove stale entries referencing non-existent files/functions (verify by checking filesystem).

Categories: `bug_fix`, `build`, `spec_work`, `audit`, `refactor`, `deployment`, `testing`, `security_audit`, `meta`, `external_learning`, `oneshot-dispatch`, `provider-routing`, `gauntlet`, `preflight`, `agent-tooling`, `cross-provider`, `orchestrator-budget`, `merge-conflict`, `worktree-hygiene`.

Rules:
- Never self-rate (`score: 0` on new entries)
- Cap tips at 300 chars
- Include WHY context, not just WHAT
- Skip trivial findings (typos, one-off commands)

---

#### Phase B — Event log scan (Agent B)

Read `paths.eventsFile`. Default scope: last 3 days. Filter by argument if user passed `--since 2d` or a category keyword.

##### B.1 Category breakdown
```bash
grep -oP '"cat":"[^"]*"' .claude/project/events/events.jsonl | sort | uniq -c | sort -rn
tail -50 .claude/project/events/events.jsonl
```

##### B.2 Patterns by category
- **Tool events**: hotspot files (most Read/Edit/Write), Read-vs-Edit ratio, failed tool calls
- **Prompt events**: vague-prompt correlation with longer resolution, correction-trigger words ("no", "stop", "wrong"), effective specificity patterns
- **Spec events**: STALE marker age, propagation gaps (spec ≠ code), churn (same spec edited repeatedly)
- **Audit events**: hook trigger frequency, blocked actions, guard patterns
- **Modification events**: self-modification frequency, what's changing (skills/hooks/CLAUDE.md/memory)
- **Inbox events**: cross-session communication patterns

##### B.3 Extract event-pattern learnings
For each pattern with measurable signal (count + time window):
- WHAT: pattern observed with evidence (event counts, file names, timestamps)
- WHY: what this suggests about workflow/codebase/process
- ACTIONABLE: concrete tip or rule

Categories: `event-pattern`, `dispatch-failure`, `tool-churn`, `spec-drift`, `audit-pattern`.

---

#### Phase C — Retro + report files scan (Agent C)

Read all completed-run retro artifacts AND closed-work reports. **THREE source families** — mine all that exist (adhoc and sprint sessions produce the sprint + report families, so do NOT scan oneshot only):

**(C-i) Oneshot retros** (resolve via `paths.oneshotRetros`, default `.claude/agents/president/_system/oneshot/retros/`):

| File | What it contains |
|---|---|
| `<retro>/N/RETRO.md` | Per-run summary: phases, decisions, deferred items, UX |
| `<retro>/N/BUGS.md` | Per-run bugs with root cause + fix + recurrence |
| `<retro>/N/HYGIENE.md` | Per-run new + cumulative rules |
| `<retro>/N/LEARNINGS.md` | Per-run repeat areas + prevention proposals + cross-run trends |
| `<retro>/IMPROVEMENTS.md` | Top-level improvement backlog (cross-run) |
| `<retro>/META-RETRO.md` | Top-level cross-run analysis (rule effectiveness, agent trends, metrics) |

**(C-ii) Sprint retros** — produced by `/sprint:full` Phase 5 / `/sprint:retrospective` (resolve via `paths.sprintHistory`, default `.claude/project/sprint/history/SP-*/retro.{md,yaml}`):

| File | What it contains |
|---|---|
| `<sprintHistory>/SP-*/retro.md` | Per-sprint outcomes, friction, action items |
| `<sprintHistory>/SP-*/retro.yaml` | Schema-validated structured retro (action_items[], friction[]) |

**(C-iii) Reports** — produced by `/report` (resolve via `paths.reportsDir`, default `_reports/`):

| File | What it contains |
|---|---|
| `_reports/**/*.md` | ELI5 sprint/epic/session/checkpoint reports — tl;dr, watch-outs, deferred work |

##### C.1 What to extract

- **Recurring bug patterns** (recurrence ≥ 2 in BUGS.md across runs) that don't yet have an enforced rule
- **Hygiene rules with no `implemented_by`** equivalent in `paths.learningsFile` — surface as integration candidates
- **Prevention proposals** (P-NN-XXX in LEARNINGS.md) that haven't been picked up by `/learn:integrate` yet
- **Top-level IMPROVEMENTS.md entries** still marked `open` or `pending`
- **META-RETRO trend signals** indicating direction shifts (e.g., new bug class emerging, rule effectiveness dropping)
- **Sprint-retro `action_items[]` / friction[]** (C-ii) that recur across ≥2 sprints without an enforcer — surface as integration candidates
- **Report watch-outs / deferred-work** (C-iii) that recur across reports — these are the operator-facing signal of debt that keeps slipping

##### C.2 Dedupe before logging
For each retro-derived candidate, check if an equivalent entry already exists in `paths.learningsFile` (search by file path + pattern). If yes: bump score / link via `evidence:` field. If no: log fresh.

Categories: same as Phase A + add `cross-run-trend` for META-RETRO findings.

##### C.3 Promote stale proposals
If a proposal in IMPROVEMENTS.md or LEARNINGS.md (P-NN-XXX) has been open for ≥ 2 runs, bump its priority signal in the new entry's `conditions.urgency = "high"`.

---

### Step 2: Deduplicate (cross-source)

After all three agents complete, do a final dedupe pass:

1. Read `paths.learningsFile`
2. Find entries with overlapping tips across sources (e.g., a conversation finding that matches an event-log pattern that matches a retro proposal)
3. Merge duplicates: keep highest-scored OR most-specific OR most-recent. Concatenate `evidence:` fields so all sources are credited.
4. Remove duplicates using Edit tool — never `writeFileSync` (memory-guard blocks).

### Step 3: Unified report

```
/learn:deep complete

CONVERSATION ({N} new):
| # | Type | Category | Learning |
|---|---|---|---|
| 1 | Correction | bug_fix | ... |

EVENTS ({N} patterns from {M} events):
| # | Category | Pattern | Events |
|---|---|---|---|
| 1 | tool-churn | ... | 12× |

RETROS ({N} candidates from {M} retro files):
| # | Source | Pattern | Status |
|---|---|---|---|
| 1 | retro-12/BUGS | recurrence-2 ... | new |

LEARNINGS STATUS:
  Total:        {N}
  Implemented:  {N}
  Informed:     {N}
  Injected:     {N}
  Dormant:      {N}
  Promotion candidates: {N} (high-score, not yet implemented)

MAINTENANCE:
  Validated:    {N} (logged → validated with evidence)
  Promoted:     {N} (validated → implemented with implemented_by)
  Pruned:       {N} ({N} stale, {N} duplicate)
  Deduplicated: {N} (cross-source overlaps merged)

NEXT:
  /learn:integrate to apply promotion candidates
  /sleep:deep to consolidate (NREM phase 1)
```

---

## Rules

- **Never self-rate.** `score: 0` on new entries. Promotion to score > 0.7 requires evidence (a referenced commit, a hook fire, a verified pattern recurrence).
- **Never advance status without evidence.** "Sounds right" is not evidence. Advance `logged → validated` only with a code reference, observed test, or git log entry.
- **Cap tips at 300 chars.** Force the WHY into the `conditions:` object, not the tip text.
- **Cross-source dedupe is mandatory.** A learning that arrives via conversation, event log, AND retro is one learning with three evidence sources — not three learnings.
- **Memory-guard friendly writes only.** Use `logLearning()` helper or `appendFileSync` to learnings.jsonl. Never `writeFileSync`. Edit tool for in-place updates.

---

## When to use which scope

| Scope | When |
|---|---|
| `/learn:deep` (default) | After a working session, before sleep, or when curious about accumulated patterns |
| `/learn:deep --since 2d` | Focused recent window |
| `/learn:deep --intent <cat>` | Filter to one category |
| `/learn:deep --skip-events` | Skip event-log mining (faster, when you've recently scanned events) |
| `/learn:deep --skip-retros` | Skip retro scan (when no completed runs since last invocation) |
| `/learn:deep --conversation-only` | Quick session-only scan (replaces removed `/learn:conversation`) |
| `/learn:deep --events-only` | Replaces removed `/learn:events` |

## Companion skills

- `/learn:integrate` — promote validated, high-score learnings into actual enforcement (hooks, rules, scripts)
- `/learn:ingest` — ingest external learnings (URLs, files, videos)
- `/sleep:deep` — full consolidation cycle (calls /learn:deep findings as Phase 1 input)
- `/oneshot:retro` — generate the retro/N/{RETRO,BUGS,HYGIENE,LEARNINGS}.md files that Phase C reads
