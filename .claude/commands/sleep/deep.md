---
description: "Full sleep cycle — all 6 phases: NREM consolidation, cleanup, replay, REM dreaming, repair, growth (~15-30 min)"
user-invocable: true
says:
  - deep sleep
  - full sleep cycle
  - sleep deep
  - run the sleep cycle
---

# /sleep:deep — Full Sleep Cycle

All 6 biologically-inspired phases. Run at end of day or after major work sessions.

Other mode: `/sleep:quick` (phases 1-2 only, ~5 min).

---

## Neuroscience Basis

This architecture is grounded in research on how the human brain uses sleep for learning. Key biological principles applied:

| Brain Mechanism | System Implementation | Phase |
|---|---|---|
| Hippocampal → neocortical transfer | `pending_validation` → `effective` promotion | 1 (NREM) |
| Sharp-wave ripple replay (compressed, selective) | Replay important learnings, skip noise | 1 (NREM) |
| Synaptic homeostasis (downscaling weak synapses) | Decay unreferenced learnings, prune vague entries | 1 (NREM) |
| Prefrontal memory tagging (salience, novelty, reward) | Importance signals on learnings | 1 (NREM) |
| Glymphatic waste clearance | Stale files, orphan state, log compaction | 2 (Cleanup) |
| REM abstraction & schema formation | Cross-pollination, pattern detection, dream solutions | 4 (REM) |
| Sleep-time compute (Google 2025) | Pre-compute session briefings, anticipate next tasks | 6 (Growth) |

**Design principle:** Borrow the *functional architecture* (dual-rate learning, selective replay, offline consolidation), NOT the *mechanism* (Hebbian plasticity, spiking networks). Simpler engineering outperforms direct biological mimicry.

---

## The Sleep Phases

### Phase 1: NREM — Memory Consolidation (Slow-Wave Sleep)

**Biology:** During SWS, the hippocampus replays compressed sequences of waking experiences via sharp-wave ripples, nested within sleep spindles, orchestrated by cortical slow oscillations. Only memories tagged as important by the prefrontal cortex are selectively consolidated. Weak, untagged synapses are downscaled (SHY).

**System implementation:**

#### 1a. Importance Tagging Audit

Before consolidation, ensure learnings have importance signals. Read `paths.learningsFile` and classify each entry:

| Signal | Criteria | Importance |
|--------|----------|------------|
| `user_correction` | User explicitly corrected behavior | HIGH |
| `error_prevention` | Learning prevented a repeated error | HIGH |
| `surprising` | Discovery was unexpected or counterintuitive | HIGH |
| `external_validated` | From external research, verified against codebase | MEDIUM |
| `one_off` | Edge case unlikely to recur | LOW |
| `vague` | Tip is generic, not project-specific | LOW |

For entries missing importance signals, infer from content. Add `"importance"` field if not present.

#### 1b. Selective Replay (Sharp-Wave Ripple Equivalent)

Not all learnings are equal. Process in priority order:

1. **HIGH importance, pending_validation**: These are the "tagged memories" — review against current codebase. If the learning matches observed behavior, promote to `effective: true`. If contradicted by current code, remove.
2. **HIGH importance, effective**: Keep. These are consolidated long-term memories.
3. **MEDIUM importance, pending_validation**: Review. Promote if validated, decay score if not.
4. **LOW importance**: Candidates for pruning. Only keep if referenced in last 7 days.

#### 1c. Deduplication (Synaptic Competition)

Like overlapping synapses competing during sleep:
- Find entries with overlapping topics + similar tips
- Merge duplicates into single, stronger entry (keep the one with higher score + more specific tip)
- Remove entries that directly contradict newer, validated entries

#### 1d. Synaptic Downscaling (SHY Implementation)

Apply decay function to restore signal-to-noise ratio:
- Entries with `score: 0` and `pending_validation: true` older than 14 days → **remove**
- Entries with `effective: null` older than 21 days → **remove** (never validated = noise)
- Entries with vague/generic tips (no file paths, no specific patterns) → **consolidate into fewer, sharper rules** or remove
- After pruning, renormalize: if >1000 learnings remain, prune the bottom 20% by score

**Max:** 1000 active learnings. Keep accumulating below that — learnings are cheap and recall is selective (smart-context surfaces only the relevant few per prompt), so bias toward KEEPING signal rather than aggressively cutting. Only prune above the max, or when an entry is genuinely stale/never-validated (the decay rules above).

#### 1e. Pattern Promotion (Neocortical Transfer)

If the same learning pattern appears 3+ times with `effective: true`:
- Promote to permanent rule:
  - Code pattern → HYGIENE rule in latest retro
  - Enhancement strategy → hardcode in `smart-context.js`
  - Workflow pattern → create a skill via `/skills:create`
- Once promoted, remove the individual learnings (memory is now in "neocortex")

#### 1f. Conflict Detection (Interference-Driven Prioritization)

The brain preferentially replays memories at risk of being overwritten:
- Find pairs of learnings that contradict each other
- Flag for explicit resolution (keep newer if both validated, keep higher-scored if same age)
- Log conflicts resolved to sleep journal

#### 1g. Retroactive Reclassification (Reasoning Engine)

Re-evaluate recent reasoning traces to prevent quality inflation:
1. Read `paths.tracesFile` — find all traces from the last 7 days with `quality_score >= 2`
2. For each trace: did the fix hold? Check if similar bugs reappeared (search learnings, git log, BUGS.md)
3. Did conditions change? Is the fix still valid in the current codebase?
4. Does a better fix exist? Has a subsequent trace solved the same root cause more completely?
5. If evidence warrants: reclassify (update `quality_score`, set `reclassified_from` and `reclassified_ts`)
6. If a linked learning exists, update its `fix_quality` field too
7. Log reclassifications to sleep journal

This is equivalent to `/reasoning:score scan` — running it here ensures it happens regularly.

#### 1h. Alex β Decision Review

Review Alex β's performance since last sleep:

1. Read `paths.betaEvents` — all entries since last sleep
2. Count: total consultations, escalations, overrides
3. For non-overridden decisions older than 24h: mark as tentatively validated
4. Update confidence levels in `paths.judgmentModel` confidence table:
   - Topics with 3+ unoverridden decisions: increase confidence one level
   - Topics with 2+ overrides: decrease confidence one level
   - Topics with 3+ overrides: add to Anti-Patterns section
5. Log to sleep journal: "Alex β: N decisions, M escalated, K overridden, confidence changes: [list]"

### Phase 2: Cleanup (Glymphatic Waste Clearance)

**Biology:** During sleep, interstitial brain space increases 60%, allowing CSF to clear beta-amyloid and metabolic waste. Without this, toxic buildup impairs next-day function.

**System implementation:**

1. **Clear stale session files**
   - Remove any orphan temp files in `.claude/`

2. **Compact event log**
   - Read `paths.eventsFile`
   - Events older than 30 days: compress into monthly summary
   - Keep recent events in full detail

3. **Clear orphan STALE markers**
   - STALE markers older than 7 days: clear and log

4. **Prune handoff files**
   - Keep last 7 days of handoffs
   - Everything older: extract key decisions/learnings, then delete files
   - Log: "Pruned N handoff files (kept summaries)"

5. **Git housekeeping**
   - `git gc --auto`
   - Check for uncommitted changes → warn in sleep journal
   - Detect orphan agent worktree branches (`agent/wt-*`) → log count, suggest cleanup

6. **Requirement drift summary**
   - Read `paths.requirementsStagedFile`
   - Filter for `status === "pending"` (last-write-wins by `id`)
   - If count > 0: display summary table grouped by feature (feature, count, highest drift_type)
   - If overwrites exist: flag as warning — "N spec overwrites pending review"
   - If count > 10: suggest grouping by feature for efficiency
   - Prompt: "Run `/scan:requirements review` to process, or they'll carry to next session"
   - Log deferred entries to cross-session inbox so next session sees them

7. **Recurring system-issues review**
   ```bash
   node scripts/recurring-issues-helper.js list
   node scripts/recurring-issues-helper.js scan
   ```
   - For each open issue in the curated list:
     - If a recent commit landed a permanent fix (cross-reference `git log --oneline --since="last sleep"` against the issue's title/category), suggest `/issues:resolve <id> "<commit-summary>"`
     - If `last_seen` is older than 30 days AND no instance has fired since, suggest demoting to `monitoring` status
   - For scan candidates with count ≥ 3 not already tracked: queue as next-session prompt to run `/issues:log`
   - Log to sleep journal under "Recurring system issues: N open, M resolution-candidates, K new scan-candidates"

### Phase 3: Replay (NREM Stage 2 — Spindle-Mediated Review)

**Biology:** Sleep spindles (10-15 Hz) create temporal windows for synaptic plasticity. During these windows, the brain reviews the day's experiences from new angles, finding patterns the waking mind missed.

**System implementation:**

1. **Re-read today's session context**
   - Load recent handoff files or conversation context
   - Analyze: what was the user REALLY trying to do?
   - Were there simpler paths missed?
   - Were there questions that should have been asked?

2. **Cross-reference with retro docs**
   - Load `the retro directory (check manifest.json projectPaths.retro for location)/*/BUGS.md` — today's work related to known patterns?
   - Load `the retro directory (check manifest.json projectPaths.retro for location)/*/HYGIENE.md` — did today's work follow or violate rules?
   - Load `the retro directory (check manifest.json projectPaths.retro for location)/*/LEARNINGS.md` — old learnings newly relevant?

3. **Detect blind spots**
   - What parts of the system haven't been touched in 2+ weeks?
   - What skills have never been used?
   - What spec references point to files that don't exist?

4. **Write replay insights to sleep journal**

### Phase 4: REM — Dreaming (Creative Recombination)

**Biology:** REM sleep features high acetylcholine, minimal norepinephrine/serotonin, creating a unique neurochemical environment for emotional processing, abstraction, and creative recombination. The brain forms unexpected associations between distant memories.

**System implementation:**

1. **Speculative problem-solving**
   - Read sleep journal for unresolved threads and stuck problems
   - **Read past dreams** from `paths.dreams` — scan recent entries for:
     - Recurring images or symbols (what keeps appearing?)
     - Unresolved tensions from prior deep reads (what was surfaced but never acted on?)
     - Themes that connect to tonight's problems (the subconscious may have been working on this already)
   - For each stuck problem, try 3 approaches:
     - **Inversion:** What if we did the opposite?
     - **Analogy:** What would this look like in a different domain?
     - **Elimination:** What if we removed the hardest constraint?
   - Let past dream imagery inform the current session — if a symbol from last week's dream connects to tonight's problem, follow that thread
   - Write dream solutions to `paths.dreams`/YYYY-MM-DD.md

2. **Dream Visualization (ASCII paintings) — MANDATORY, DO NOT SKIP**

   Every `/sleep:deep` run MUST produce at least ONE ASCII painting in the dream file, even if the session feels "not dreamy." If you find yourself wanting to skip this step because the session was technical or there wasn't a rich emotional theme — that is exactly when the painting is most valuable. Paint anyway.

   Sleep runs can produce phases 1-6 as text analysis but ZERO paintings. The paintings are the irreplaceable part — text summaries can come from any retro. The visual associative step is what makes this a *dream* cycle and not a *review* cycle.

   The paintings are NOT illustrations of solutions. They are **part of the dreaming process**. Paint first, then read what emerged. Like real dreams — the image comes from associative, non-linear thinking, and the meaning is extracted afterward.

   Process:
   - For each stuck problem or cross-pollination thread, let associations flow freely
   - Paint an ASCII image from that associative state — abstract, emotional, symbolic
   - Do NOT plan the image around the solution. Let the problem, the metaphors, the tensions, and the unexpected connections compose themselves
   - THEN read the painting back and extract what it reveals

   Rules:
   - **Minimum 1 painting per sleep cycle.** Target: 2-3 if session was rich.
   - 20-40 lines per painting, full ASCII art (box drawing `┌─┐│└┘╔╚╬`, shading `░▒▓█`, symbols, whitespace)
   - Abstract and evocative, NOT literal diagrams or flowcharts
   - The image should feel like a dream — surreal, layered, ambiguous
   - Each painting gets a **"Deep Read"** afterward — what did the subconscious surface?

   Save to `paths.dreams`/YYYY-MM-DD.md (one file per sleep cycle).

   Structure per dream:
   ```
   ## Dream: [problem or theme]

   [ASCII painting — 20-40 lines, abstract, not literal — USE BOX-DRAWING CHARS]

   ### Deep Read
   - What emerged: [what the image says that words couldn't]
   - Hidden tension: [contradictions or conflicts the painting surfaced]
   - Subconscious learning: [insight to carry forward — may become a real learning]
   ```

   **Self-check before writing Phase 5:** does the dream file contain at least one fenced `## Dream:` block with ASCII art AND a `### Deep Read`? If not, go back and paint one. The `/sleep:deep` cycle is incomplete without it.

3. **Cross-pollination (distant association)**
   - Read recent `/learn` ingestions
   - Read recent research under `paths.research` (`_docs/research/`)
   - Look for unexpected connections: "Pattern X from research Y could solve problem Z"
   - Write connections to sleep journal
   - **Paint a cross-pollination image** if a strong connection is found

4. **Schema formation**
   - Look across all learnings for meta-patterns:
     - "The same class of error keeps appearing in different forms"
     - "These 3 separate learnings are really about the same underlying principle"
   - If found, create a higher-level learning that subsumes the specifics
   - **Paint a schema image** showing the meta-pattern visually

5. **User coaching synthesis**
   - Based on session patterns, user corrections, and blind spots
   - Draft a gentle suggestion for next session start
   - Append a new dated section to `paths.dreams`/coaching.md using appendFileSync — never overwrite

6. **Alex β pattern mining**
   - Run `/beta:mine` analysis inline (not as a separate agent)
   - Mine prompt sequences, skill chains, frustration-to-enforcement patterns, decision cycles
   - Write recommendations to `paths.judgmentRecommendations`
   - Do NOT directly modify `judgement-model.md` — recommendations only. Run `/beta:integrate` to apply validated recommendations.

### Phase 5: Repair (Deep Sleep Tissue Repair)

**Biology:** During deep sleep, growth hormone is released and the body repairs cellular damage, strengthens immune function.

**System implementation:**

1. **Security scan** — Run on files changed in past week. Check for leaked secrets.
2. **Dependency health** — `npm audit`, check for vulnerabilities
3. **Architecture drift** — Compare code structure vs specs. Detect orphan files and phantom references.
4. **Hook integrity** — Verify all hooks are wired and sized correctly
5. **Mode-aware repair:**
   - Dark mode: auto-apply fixes with atomic commits
   - Light mode: queue fixes for morning approval

### Phase 6: Growth (Growth Hormone Release + Sleep-Time Compute)

**Biology:** Growth hormone peaks during deep sleep, promoting physical development. Google's "sleep-time compute" (2025) shows AI systems benefit from using idle time for pre-computation — 2.5x cost reduction, 13-18% accuracy improvement.

**System implementation:**

1. **System evolution summary**
   - Compare system health now vs. last sleep
   - Count: new learnings, promoted rules, resolved bugs, new skills
   - Is the system getting stronger or stagnating?

2. **Pre-compute session briefing (sleep-time compute)**
   - Analyze current project state: what's unfinished? What's next?
   - Anticipate likely next-session tasks based on recent work patterns
   - Generate a "morning briefing" with:
     - Key unresolved items from tonight's sleep
     - Dream solutions worth reviewing
     - Suggested first task for next session
   - Append a new dated section to `paths.dreams`/coaching.md using appendFileSync — never overwrite

3. **Propose next evolution**
   - Based on everything discovered during sleep, propose 1-3 improvements
   - Strategic direction, not code changes: "The biggest leverage point is X"
   - Write to sleep journal

4a. **Alex β evolution summary**
   - Summarize Alex β's performance: decisions made, accuracy, confidence changes
   - Review `paths.judgmentRecommendations` if it exists
   - Propose which recommendations to integrate into `judgement-model.md` — run `/beta:integrate` to apply
   - Write to sleep journal

4. **False memory guard**
   - Before finalizing any learning promotion, verify against actual code state
   - A learning that says "function X exists in file Y" — check that it still does
   - Prevents schema-based distortion (a real biological failure mode)

---

## Output: Sleep Journal

Append a new dated section to `paths.dreams`/journal.md using appendFileSync — never overwrite:

```markdown
# Sleep Journal — YYYY-MM-DD

## NREM Consolidation
- Learnings: {before} → {after} ({removed} pruned, {promoted} promoted, {merged} merged)
- Importance audit: {high}H / {medium}M / {low}L
- Conflicts resolved: {count}
- Decay applied: {count} entries removed (unreferenced/unvalidated)
- Promotions: {count} patterns → permanent rules

## Cleanup (Glymphatic)
- Session files cleared: {list}
- Events compacted: {old} → {new} monthly summaries
- Handoffs pruned: {count} files ({kept} kept)
- Orphan branches: {count} detected
- Uncommitted files: {count}

## Replay (Spindle)
- Today's real goal: {goal}
- Achieved: {summary}
- Blind spots: {list}
- Unused skills: {list}
- User style notes: {observations}

## REM Dreams
- {problem}: {dream solution}
- Cross-pollination: {connection found}
- Schema: {meta-pattern identified}
- Dream paintings: {count} saved to `paths.dreams`/YYYY-MM-DD.md
- Subconscious learnings: {count} extracted from deep reads

## Repair
- Security: {status}
- Dependencies: {status}
- Architecture: {orphans/phantoms found}
- Hooks: {status}

## Growth
- System strength: {trend}
- Biggest leverage point: {recommendation}
- Morning briefing: appended to dreams/coaching.md
- False memory check: {count} learnings verified against code
```

## Session Start Integration

When the next session starts, the context enhancer reads:
- `paths.dreams`/journal.md → surfaces key findings from each sleep cycle
- `paths.dreams`/coaching.md → morning briefing + growth suggestions
- `paths.dreams`/YYYY-MM-DD.md → dream paintings and deep reads (one file per sleep cycle, accumulates over time)

## Important

- Sleep never deletes data permanently — it compresses and archives
- Journal (`journal.md`) is append-only (one dated section per cycle, never overwrite)
- Coaching notes are append-only (one dated section per cycle, never overwrite)
- Dream solutions are speculative — tagged as "dream", not decisions
- In light mode: repair queues fixes for morning approval
- In dark mode: repair auto-applies with atomic commits
- Sleep does NOT touch `src/` code — only specs, docs, system files
- **Never self-rate learnings.** Promotion requires validation evidence, not self-assessment.
- **Max 1000 active learnings.** Bias toward KEEPING signal — recall is selective (smart-context surfaces only the relevant few per prompt), so a large store is low-cost. Only prune above the max or when entries are genuinely stale/never-validated (the decay rules). Don't cut aggressively.
