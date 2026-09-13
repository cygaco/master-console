---
description: Discover orphaned work — find every deferred, forgotten, or abandoned task across NEXT.md, runtime notes, branches, untracked files, TODOs, plans, ADRs, learnings, drift queue. Classifies and proposes concrete next actions.
user-invocable: true
---

# /discover:orphaned — Deferred & Forgotten Work Discovery

Sister skill to `/discover:systems`. Where `/discover:systems` asks "what does this project actually contain?", this skill asks **"what did we promise but never finish?"**.

The bug class: a session writes a deferred-work note, the session ends, the next session starts cold and never reads the note. The work rots. The user hits the same problem six months later.

`/discover:orphaned` triangulates **8 lenses** of "promised but undone" work, deduplicates, classifies, and emits a concrete punch list with suggested actions.

---

## Input

No arguments. The skill operates on the current branch's working state.

(Intentional design choice — args bloat skill surface; the rare cases where you want to filter can be done with grep on the JSON output.)

---

## The 8 lenses

Each lens is a different *source* of "this hasn't been finished." They overlap deliberately — an item appearing in multiple lenses is high-confidence; a single-lens item is investigated case-by-case.

### Lens 1 — Explicit deferred lists

What the project explicitly says is unfinished.

**Sources:**
- `ROADMAP.md` at project root — **the primary Lens-1 source in canonical MC**: sections "Now", "Next", "Known issues", "Downstream Reconcile", any `## ⚠️ ALERTS`, and every `[open]`/`[deferred]`/`[blocked]`-tagged item. (2026-05-30 improvement: canonical has no `NEXT.md`, so the original Lens-1 source was dead here — ROADMAP.md is the real explicit-deferred backlog.)
- `NEXT.md` at project root, if present (product repos use it; sections "Open issues", "Pending decision", "Medium/Low priority", "Open questions") — absent in canonical.
- any root `*-plan.md`
- `paths.handoffs/*.md` (last 3 by mtime)

**Signal:** if the prior session wrote it down, it's already triaged — but did it get done?
**Action:** for each item, check git log for a commit whose subject line resolves it. No matching commit ⇒ still orphaned.

### Lens 2 — Runtime process notes

Issues logged mid-session that may not have made it into formal tracking.

**Sources:**
- `paths.runtime/notes/*.md` (especially `run-NN-process-issues.md`, `run-NN-*-guide.md`)
- `paths.runtime/logs/quicksave.md` if it exists
- Recurring issues file: `paths.recurringIssuesFile`

**Signal:** entries with timestamps older than 14 days and no resolution marker. Phrases like "Fix forward:", "TODO:", "Should investigate" without follow-up.
**Action:** confirm whether the "Fix forward:" line landed as a hook/spec/policy change or was just left as advice.

### Lens 3 — TODO/FIXME comments in code

Anchored work tied to a specific code location.

**Method:**
- Grep `TODO|FIXME|XXX|HACK|@todo|tmp:|temp:|kludge` across `src/`, `scripts/`, `extension/`, `packages/`
- Exclude: `node_modules/`, `.next/`, `.worktrees/`, vendored deps
- Capture file + line + the comment text

**Signal:** count by directory; surface oldest by `git blame` age.
**Action:** any TODO older than 60 days is a smell. Either close it now or convert to a tracked issue.

### Lens 4 — Stale plans

Plans that got written but the implementation may not have followed.

**Sources:**
- `paths.plans/*` (any plan file > 30 days old whose filename or contents reference an open feature)
- `_requirements/00-canonical/PRODUCT_MODEL.md` change log entries with no follow-up
- Memory: project memories with "plan in progress" status (search `memory/MEMORY.md` for "plan", "in progress", "WIP")

**Signal:** plan exists, but no commits in the last 14 days touch the plan's feature dirs.
**Action:** either resume, formally archive, or convert to a NEXT.md item.

### Lens 5 — Diverged branches

Branches that have unique commits not on master/main and haven't been touched recently.

**Method:**
```bash
git for-each-ref --format='%(refname:short) %(committerdate:relative)' refs/heads/ refs/remotes/
# Filter: branches with commits ahead of master AND last commit > 7 days old
```

**Signal:** content sitting in branches outside the integration line. Worktree branches (`agent/wt-*`) over 14 days are usually orphaned dispatcher state.
**Action:** for each, decide merge / rebase-and-merge / abandon-and-delete.

### Lens 6 — Untracked working tree carry-overs

Files in the working tree that aren't gitignored and aren't tracked.

**Method:**
```bash
git status --porcelain | grep '^??' | head -50
```

Filter out known ephemera (cache files, OS turds). What's left is intentional content the user/Claude wrote but never staged.

**Signal:** untracked `.md` files at project root, untracked dirs under `_docs/`, untracked `.json` files under `.claude/project/maps/` not in `.gitignore`.
**Action:** stage and commit, archive to `_docs/99-archive/`, or delete.

### Lens 7 — Validation backlog

Items in the staged-drift queue, learning queue, or memory that are awaiting validation but never got it.

**Sources:**
- `paths.requirementsStagedFile` — entries with status `pending` or `proposed`
- `paths.learningsFile` — entries with `validation_status: pending` and age > 14 days
- `paths.specGraph` — `pending_propagation` edges
- `paths.policy/adr/` — ADRs with frontmatter `status: draft` or `status: proposed`

**Signal:** validation queues that grow without draining indicate the validation step is missing or skipped.
**Action:** dispatch the appropriate validator (`/scan:requirements --propagate`, `/learn:integrate`) or schedule one.

### Lens 8 — Cross-session inbox dangling threads

Other Alex sessions that ended with open questions or incomplete handoffs.

**Sources:**
- `paths.runtime/inbox.json` (or wherever `/session:write` lands)
- Last 5 entries in `paths.handoffs/`

**Signal:** any inbox message with `awaiting_response: true` or "ESCALATE:" prefix that postdates the last reply.
**Action:** answer, dispatch the work, or explicitly mark the thread closed.

---

## Procedure

1. **Resolve paths.** Read `.claude/paths.json`. Use `paths.X` keys throughout, never literal strings.

2. **Run lenses 1–8 in parallel** using native tools:
   - Lens 1, 4, 6: Read + Glob (file existence, recent mtimes)
   - Lens 2: Glob over runtime notes + Read each + extract timestamps
   - Lens 3: Grep for TODO|FIXME|XXX|HACK across source dirs
   - Lens 5: `git for-each-ref` + `git log --oneline master..<branch>`
   - Lens 6: `git status --porcelain` (untracked files only)
   - Lens 7: Read JSONL stores, filter by status fields
   - Lens 8: Read inbox file if present

   Each lens produces a list of `{lens, item, evidence, age_days, suggested_action}` rows.

3. **Dispatch heavy synthesis to GPT-5.5 via the canonical bridge** (token-saving step):
   - Concatenate all lens outputs into one prompt (~50–150KB)
   - Write to `.claude/runtime/dispatch/discover-orphaned-prompt.txt`
   - Invoke through `dispatch-agent.js` (2026-05-30 improvement — **NOT** raw `codex exec`,
     which `dispatch-route-guard` blocks and which bypasses the Windows-stdin +
     concurrency-lock layer; LRN-2026-04-17 / LRN-2026-04-30):
     ```bash
     node scripts/dispatch-agent.js advisor .claude/runtime/dispatch/discover-orphaned-prompt.txt \
       > .claude/runtime/dispatch/discover-orphaned-output.json 2>&1
     ```
     `advisor` is the freeform cross-provider consult role (openai/gpt-5.5, no strict
     envelope — so the synthesis isn't validated as a review envelope). To pin the model
     explicitly: append `--provider openai --model gpt-5.5`.
   - The model deduplicates cross-lens overlaps, classifies into buckets (see below), and proposes one concrete action per item.
   - The orchestrator (Claude) reads only the parsed JSON envelope — typically 2–10KB — keeping context lean.

4. **Read GPT output**: `wc -c .claude/runtime/dispatch/discover-orphaned-output.json` first, then parse the last ` ```json ` fence.

5. **Classify each item** into one of four buckets:

   | Bucket | Multi-lens overlap | Meaning |
   |---|---|---|
   | **Hot** | 2+ lenses, age ≥ 14 days | Multiple signals, getting old, real candidate for "do now" |
   | **Cold** | 2+ lenses, age < 14 days | Fresh, on the radar, monitor |
   | **Stale** | 1 lens, age ≥ 60 days | Almost certainly forgotten — close or revive |
   | **Echo** | 1 lens, age < 60 days | Single signal, recent — note but don't act |

6. **Emit punch list** with suggested actions, grouped by bucket.

7. **Optional persist:** if `--write-to-next` is mentioned in a follow-up turn (no flag in this skill, but conversational), append the Hot bucket to `NEXT.md` under "Open issues for next session".

---

## Output format

### Rollup table

```
┌──────────────────────────────────────────────────────────────────────┐
│ /discover:orphaned — 2026-04-30T15:00Z                               │
├──────────────────────────────────────────────────────────────────────┤
│  Bucket    Count   Median age   Examples                             │
│  ──────    ─────   ──────────   ────────                             │
│  Hot       12      45d          NEXT.md #A rename drift, ...         │
│  Cold      8       3d           run-13 process notes, ...            │
│  Stale     21      90d          run-09 fix-forward TODOs, ...        │
│  Echo      14      8d           single TODO comments, ...            │
│  ──────    ─────   ──────────   ────────                             │
│  TOTAL     55                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Per-bucket detail

- **Hot:** one line each with `[lenses]`, item, age, suggested action (verb + target)
- **Stale:** one line each with `[lens]`, item, last-mention date, "close|revive|delete?" suggestion

### JSON

```json
{
  "ranAt": "<ISO>",
  "lenses": ["explicit","runtime-notes","todos","plans","branches","untracked","validation","inbox"],
  "items": [
    {"item": "rockets / rockets-economy rename drift", "lenses": ["explicit","branches"], "age_days": 21, "bucket": "hot", "action": "git mv _requirements/04-features/rockets-economy/ _requirements/04-features/rockets/ OR edit manifest"},
    ...
  ],
  "summary": {"hot": 12, "cold": 8, "stale": 21, "echo": 14}
}
```

---

## Why GPT 5.5 for synthesis?

Each lens produces ~5–30 raw rows. The hard work is **correlating across lenses** — recognizing that a NEXT.md entry, a runtime note, a TODO comment, and a stale branch are all the same orphaned task. That's pattern-matching at scale, deduplication, and concrete-action generation — exactly the kind of prose-heavy reasoning where shipping the work to GPT 5.5 saves tens of thousands of Claude tokens per run.

The orchestrator (Claude) handles:
- File scanning (cheap, native tools)
- Final classification + presentation (small input)

GPT 5.5 handles:
- The 50–150KB middle layer of "make sense of all these signals"

This is the **same architecture pattern** as build-chain reviewer dispatches (see `paths.agentSystem/guides/agent-dispatch-guide.md`) — different model, prose-heavy work, file-based handoff to keep orchestrator context lean.

---

## Relation to other skills

- `/discover:systems` — what exists vs declared. This skill: what's promised vs delivered.
- `/scan:patterns` — recurring issues across runs. Overlaps with Lens 2; reuse the cache if fresh.
- `/issues:list` — recurring system issues. Lens 7 sometimes re-surfaces these; cross-reference.
- `/learn:integrate` — drains the learning queue (Lens 7 partial). Consider running it AFTER `/discover:orphaned` to clear validation backlog.
- `/session:resume` — loads the last handoff. This skill goes deeper into what the handoff didn't capture.
- `/oneshot:retro` — formal end-of-run capture. This skill catches what retros forgot.

---

## When to run

- **At session start** — after `/session:resume`, to see what the last handoff missed
- **Before a quarterly cleanup** — what's been languishing?
- **After a long break** (> 1 week) — orphans pile up fast in low-attention periods
- **Before declaring a release ready** — open ends are launch risk
- **When NEXT.md feels short** — a clean NEXT.md that ships is good; a clean NEXT.md that hides 30 forgotten items is bad

---

## Token budget

Typical run on this project (Apr 2026 baseline):
- Native scan (Claude): ~3K tokens (file reads, grep, git)
- GPT 5.5 dispatch (one-shot): ~50–80K input, ~5K output
- Final synthesis (Claude): ~1K output
- **Net Claude context impact: ~5K tokens** vs ~60K if Claude did the synthesis natively

That's the win.
