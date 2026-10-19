# Recurring-issues tracker — design + write-path options

`paths.recurringIssuesFile` (`.claude/project/memory/recurring-issues.jsonl`) tracks recurring **system-only** issues — bugs/regressions in the agent framework, hooks, skills, `.claude/`, `scripts/`. Product bugs go through `/fix:deep` + bug registry + retro flows; this tracker is for the meta-system.

## Schema

One JSON object per line:

```json
{
  "id": "RI-NNN",
  "title": "short, slug-like (dedup key)",
  "category": "hook|path|skeleton-rebuild|provider|spec-drift|merge-guard|harness|dispatch|context-overflow|other",
  "first_seen": "ISO",
  "last_seen": "ISO",
  "count": N,
  "instances": [{"date":"ISO","context":"..."}],
  "severity": "low|medium|high",
  "status": "open|monitoring|resolved",
  "current_workaround": "string|null",
  "permanent_fix": "string|null",
  "tags": ["..."]
}
```

Dedup is by **title token-overlap** ≥ 70% — so "Hook silently disabled by I/O failure" and "Hook silently disables itself by I/O" match the same entry.

## Write-path options

### A. Skill-driven (currently implemented) ✅

Three user-invocable skills:

- `/issues:log "<title>" <category> <severity> <context...>` — append/increment
- `/issues:list [--all]` — show open (or all)
- `/issues:list --scan` — pattern-mine events.jsonl for repeat audit-block sigs (last 7d)
- `/issues:resolve <id> "<fix>"` — close an issue with a permanent-fix summary

**Pros:**
- Deliberate, human-curated entries — no false positives
- Title-overlap dedup keeps the file small even with many `/issues:log` calls
- Works regardless of how the issue was discovered (memory, retro, in-the-moment)
- Sub-second; pure read+append; no agent dispatch

**Cons:**
- Requires Alex (or user) to recognize "this is recurring" and invoke
- Misses passive captures — issues that hit but neither party noticed at the time
- Susceptible to "forgot to log" gaps after long sessions

**Best for:** structural issues you want explicitly named and tracked.

---

### B. Hook-driven (not implemented — proposed)

A PostToolUse hook with an empty matcher. On every tool call, would:

1. If the call ends with a block decision (`cat:"audit"`, `data.action: *blocked`), tally signature into `.claude/runtime/recurring-issues-counter.jsonl`
2. If a signature crosses a threshold (e.g. 5 hits in 7 days), auto-create an `RI-NNN` entry with `severity: "low"` and `status: "monitoring"`
3. User/Alex can promote via `/issues:log` (which would just increment + raise severity)

**Pros:**
- Catches every block, even silent ones
- Data-driven — no human recognition needed
- Counter file gives a leading indicator before the threshold trips

**Cons:**
- Risk of false positives (a one-off block on a cleaning operation isn't recurring)
- Hook has to be careful about its own I/O — a hook can silently disable itself with side-effect I/O
- Adds runtime cost to every tool call (would need to be sub-millisecond)
- Auto-created entries lack the qualitative context a human adds

**Best for:** noisy block-class issues.

---

### C. Auditor-driven (not implemented — proposed)

The auditor agent already runs after oneshot phases and analyzes patterns across runs. Extend it to:

1. Scan events.jsonl for the patterns it already pattern-matches (block sigs, spec drift, hook firing rates)
2. Emit recurring-issues entries as part of its "Adjusts environment for next cycle" output
3. Deduplicate against existing entries via the helper

**Pros:**
- Reuses an agent already doing pattern analysis
- Runs at a natural cadence (between phases / between runs)
- Has more context than a hook (sees the run as a whole)

**Cons:**
- Only fires during oneshot runs — adhoc and solo sessions are blind
- Auditor analysis takes time; we'd be backlogging detection
- Coupling auditor to this introduces a circular dep (auditor reads issues, writes issues, reads its own writes)

**Best for:** post-run synthesis when a run produced anomalies.

---

### D. Hybrid (chosen path — fully built)

Layer A + a slimmer version of B:

1. **A in place** — `/issues:log`, `/issues:list`, `/issues:resolve`, `/scan:issues` (✅ done)
2. **B-lite** — `/scan:issues` exists as its own skill and pattern-mines events.jsonl on demand. No new hook needed; the scan IS the passive layer, just lazily evaluated.
3. **Touchpoints wired (✅ done):**
   - `/oneshot:retro` Phase D2 invokes `scan` + `list`, surfaces ≥3× candidates as `/issues:log` proposals in the merged Phase F output under a `RECURRING SYSTEM ISSUES:` section.
   - `/sleep:deep` Phase 2 step 7 invokes `list` + `scan`, suggests `/issues:resolve` for entries whose permanent fix landed in the last cycle, and demotes-to-monitoring for entries with `last_seen` >30d.
   - The ops-analyst agent (`ops-analyst.md` Between-Cycle Checklist step 5) invokes `scan` + `list` and emits a `recurring_issues_candidates` array in its output for orchestrator-driven `/issues:log` proposals.

**Why this is the right shape:**
- The most expensive part of a hook-based detector is "what is recurring?" — which is itself a query over events.jsonl. We already have that data; we don't need a separate counter file. The scan command runs over events.jsonl in <1s; lazy evaluation is fine.
- Real-time detection isn't valuable here — these issues are about patterns over days, not seconds. A scan invoked at retro/auditor cadence catches everything a real-time hook would, without a hook's silent-disable risk.
- Keeps the file human-curated. The scan surfaces candidates; `/issues:log` is the gate. That's a feature, not a bug.
