# HOW2CLEANMEMORY.md — Why AI Agent Memory Rots, and the Pipeline That Cleans It

*Written 2026-07-25, the night three stale memories bit us in one session. Raw material for a blog
post. The short thesis: **harness auto-memory is a write-mostly store with no verification loop —
it rots silently, and the agent confidently serves the rot back to you as fact.***

## The trigger (one evening, three failures)

The operator asked "didn't we fix agy? I swear we used it." The agent answered from memory:
"parked by your ruling, three blockers." **Wrong.** Ground truth: agy was fixed 2 days earlier
(by the operator's own login), had served 9 real reviews since, and the parking ruling had
expired. The agent had to be pushed twice before opening the actual ledger.

Same evening, the new memory-integrity enforcer's FIRST run on the live store found two more:
a 36-day-old memory that had been invisible at every session start, and an index line whose own
title broke its link. Three distinct rot mechanisms, one store, one night.

## The failure catalog (real cases, dated)

**F1 — Index rot: the file was corrected, the index wasn't (agy, 2026-07-23→25).**
Auto-memory is two layers: per-fact files + a MEMORY.md index. Only the INDEX loads into context
each session. The agy memory file received "Correction 6: LIVE, deferral expired" on 07-23 —
but its index line still said "DEFERRED — do NOT resurface." For two days every fresh session
inherited the stale index and never opened the corrected file. Cost: the agent told the operator
agy was parked while its ledger showed 9 successful serves; a working review lane sat unused
during a provider outage. **Mechanism: the recall surface and the truth surface diverged.**

**F2 — Orphan memory: written but never indexed (two-gate lesson, 2026-06-19→07-25).**
A real, expensive lesson ("operator verbal authorization does NOT clear the auto-mode classifier
— two separate gates") was saved as a file but never got an index line. Result: invisible at
every session start for 36 days. The lesson might as well not exist — until the same mistake
gets made again and re-learned at full price. **Mechanism: write path has two steps (file +
index line) and nothing enforces the second.**

**F3 — Format rot: the index line broke its own link (regex-NUL memory).**
An index title contained a literal `]` — "Literal space before ] in a regex char class…" —
which breaks markdown link parsing. Any tool walking the index drops that entry. **Mechanism:
memory content itself can corrupt the index's parseability; nothing validated it at write time.**

**F4 — Inherited wrong root-cause: memory repeated as fact (agy "upstream auth bug", 2026-07-19→20).**
A session diagnosed an agy failure as "unfixable upstream auth bug, operator login required" and
saved it. The next session inherited the note and repeated it as fact. A no-presupposition
re-diagnosis proved it WRONG (agy authenticated fine; the real blockers were routing + a
permission wall). The operator had to push back before anyone re-checked. **Mechanism: memories
carry conclusions, not evidence — and conclusions get inherited with unearned confidence.**

**F5 — Stale operational reads → false escalations (codex billing, 2026-07-17).**
A stale memory of which billing surface codex used caused a false spend-alarm escalation to the
operator. The rule that came out of it: NEVER assert a billing surface without reading auth_mode
from disk. **Mechanism: point-in-time observation served as live state.**

**F6 — Trackers claim open work that's been done for weeks (2026-06-16, recurred 5× in one day).**
Same rot class, adjacent store: a tracker claimed a keystone was "Missing/open"; it had been
built and certified weeks earlier. The session nearly re-built it. **Mechanism: any derived
register (memory, tracker, gap list) drifts from the artifact it summarizes unless something
forces reconciliation.**

**F7 — Tonight's meta-case: the diagnosis flip-flop.**
The codex outage was called "auth expired" (wrong), corrected to "quota" (also wrong), settled
by ground truth as auth-adjacent after the operator said "I have quota." Every wrong turn came
from reasoning over remembered patterns instead of opening the primary artifact FIRST. Memory
is a ROUTER to sources, never a SUBSTITUTE for them (rule ED-235, operator-issued 2026-07-19 —
after a previous instance of the same failure).

## Why harness auto-memory rots (the design analysis)

1. **Write-mostly.** Everything encourages saving; nothing schedules verification. Entropy only
   accumulates.
2. **Two-surface recall.** Index loads, files don't. Any correction that touches the file but
   not the index is INVISIBLE — the worst kind of fix: real on disk, absent in practice.
3. **Point-in-time facts presented as live state.** A memory is a snapshot with a date; the
   context window renders it as an eternal truth. (The harness now stamps age warnings on reads —
   necessary, not sufficient.)
4. **Conclusions without evidence chains.** "X is broken" gets saved; "X was broken, per probe Y,
   on date Z" is what could actually be re-verified later.
5. **Corrections don't cascade.** A corrected memory doesn't update the OTHER memories that cite
   the old claim, or the index line summarizing it, or the session-start recall extracts.
6. **No enforcement.** Nothing failed loudly when the index and store diverged — for 36 days.

## The pipeline (what we built, 2026-07-25 — SP-20260725-002)

**Layer 1 — structural enforcer** (`scripts/checks/memory-integrity.js`): deterministic,
read-only, seconds. Checks index↔file bijection both directions (catches F2), link parseability
(catches F3), frontmatter validity, duplicate slugs, dangling wikilinks. Report-only default;
`--enforce` for gating. First live run found F2+F3 immediately.

**Layer 2 — semantic verifier** (`/memory:verify` skill): for each memory, open the CURRENT
ground truth it claims to describe (code, disk, git, trackers, registers) and classify:
- **CONFIRMED** — evidence still supports it
- **STALE→corrected** — reality moved; update with evidence + date (catches F1, F4, F5)
- **INVALIDATED→delete** — provably wrong or superseded; delete ONLY with cited contradicting
  evidence
- **UNVERIFIABLE→flagged** — cannot check; NEVER auto-delete, mark for human judgment

**Layer 3 — gated apply** (`scripts/checks/memory-apply.js`): every mutation goes through an
executor that is dry-run by default, requires an evidence-backed CONTRADICTED classification
for any delete/rewrite, confines paths (a crafted plan can't touch files outside the store —
found and fixed via a real path-traversal catch in review), and keeps the index in sync
atomically. The safety claims are CODE, not prose — that distinction was itself a review finding.

**Cadence:** structural on session start or pre-commit (cheap); semantic periodically and ALWAYS
after a "wait, didn't we fix this?" moment — that question is the smell of F1/F4.

## Rules that keep memory clean (behavioral layer)

- **Memory routes, never substitutes** (ED-235). Before a memory shapes an answer or a decision,
  open the artifact it points to. The memory's job is to tell you WHERE to look.
- **Every correction updates BOTH surfaces** — the file AND its index line, same edit session.
  A file-only correction is invisible; that's F1.
- **Save evidence, not just conclusions.** Date + probe + artifact path. Future sessions can
  re-verify evidence; they can only inherit conclusions.
- **Date-stamp corrections and keep the audit trail** (the agy file's Corrections 1→6 chain is
  what made tonight's recovery possible — the truth was IN the file, in order).
- **Verify-don't-inherit** (ED-056): any register claiming work is "open" gets checked against
  code/disk before you build; any memory claiming something is "broken/parked" gets checked
  before you route around it.
- **When the human says "I swear we did X"** — treat that as a ground-truth check request, not
  a memory-vs-memory debate. The operator's pushback beat the agent's memory twice tonight.

## How to run it

```
# Layer 1 — structural (seconds, safe, report-only)
node scripts/checks/memory-integrity.js --dir <memory-dir>

# Layer 2+3 — full pipeline via the skill (report first, then gated apply)
/memory:verify            # report-only
/memory:verify --apply    # corrections through the gated executor
```

*Everything in this doc is reconstructable from: the dispatch ledger, the memory files'
correction chains, the ED register (ED-235/ED-056/ED-213), and the 2026-07-25 session log.*
