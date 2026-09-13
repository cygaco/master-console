---
description: Full session wrap-up — cognitive maintenance (learn/mine/sleep → integrate learnings + β recs) → reconcile + validate TRACKER.md (fail-closed) → fresh handoff → land to main → fresh branch → tear down teams. The one "we're done, tee up next session" command. Use --fast to skip the cognitive chain and wrap to a recoverable, zero-loss state in the fewest steps.
---

# /session:end — Full Session Wrap-Up

One command to close a working session cleanly: consolidate what was learned, write the next-session handoff, land the work to `main`, start a fresh branch, and tear down the agent team. Run it when you're done for the session and want the next one to start clean.

This is an **orchestration skill** — it chains existing skills in dependency order; it does not reimplement them. Phases are SEQUENTIAL (each depends on the prior). Fail-open: if a non-critical phase fails, note it and continue; never let a cleanup phase block the handoff/land.

## Input

`/session:end [--fast] [--quick] [--no-push] [--keep-teams] [--branch <name>]`

- `--fast` — **minimum-unit wrap to a recoverable, zero-progress-loss state.** SKIPS the cognitive-maintenance chain (Phases 1–4: `/learn:deep`, `/beta:mine`, `/sleep:*`, integrators) entirely and runs only the recoverability core: Phase 5 (TRACKER green — light reconcile, full re-narration may defer to the DUMP), Phase 6 (DUMP handoff — the load-bearing artifact), Phase 7 (commit EVERYTHING so nothing is lost; land/merge only if clean — see Fast mode below), Phase 8–10 (branch/teardown/report, best-effort). Use when you want to stop NOW and have the next session pick up with no loss. See **## Fast mode** for the exact contract.
- `--quick` — use `/sleep:quick` (NREM + cleanup, ~5 min) instead of `/sleep:deep` (~15-30 min). Default: deep. (Ignored under `--fast`, which skips sleep entirely.)
- `--no-push` — stop at a LOCAL commit+merge; do not push (use when the operator has not authorized a push in the current, ending session).
- `--keep-teams` — skip the team-teardown phase (Phase 9).
- `--branch <name>` — name for the fresh post-land branch. Default: `session/<YYYY-MM-DD>` (or `work/<YYYY-MM-DD>`).

## Fast mode (`--fast`) — the recoverability core

The contract: **reach a state the next session can resume from with ZERO progress loss, in the fewest steps.** Skip everything that's about *learning from* the session; keep everything that's about *not losing* it.

| Phase | `--fast` |
|---|---|
| 1–4 cognitive (learn/mine/sleep/integrate) | **SKIP** (note "deferred to a full `/session:end`" in the report; capture any one-line durable insight as a memory + an `/enforcement:log` gap instead of the full chain) |
| 4.5 debt sweep (`/enforcement:sweep`) | **SKIP** (full-chain only; a `--fast` wrap files at most the one-line `/enforcement:log` gaps it already captures) |
| 5 TRACKER reconcile (fail-CLOSED) | **KEEP** — `node scripts/trackers/validate.js` MUST exit 0. Light reconcile only: if green and not *lying*, the rich per-item state can live in the DUMP (Phase 6) instead of a full header re-narration. If RED, fix to green before proceeding (still fail-closed). |
| 6 DUMP handoff | **KEEP — this is the load-bearing artifact.** It must carry the next-action, in-flight state, and any operating-model/directive changes so a fresh session needs nothing else. |
| 7 Land | **KEEP commit (no loss); CONDITIONAL merge.** Commit ALL working state so nothing is lost. Then: **merge/land to `main` ONLY if the work is genuinely done** (e.g. a sprint whose gauntlet is GREEN). If a sprint is mid-fix-cycle / gauntlet-RED / otherwise unfinished, **commit + push the working branch for backup but do NOT merge to main** — landing unfinished work is a progress-*corruption*, not progress-saving. Surface the judgment. |
| 8 Fresh branch | **CONDITIONAL.** If the work landed to main, branch fresh off main. If the work is intentionally unmerged (Phase 7 conditional), **STAY on the working branch** — it IS the resume point; forcing a fresh branch off a stale main just makes the next session switch back. |
| 9 Teardown | **KEEP, best-effort — but NEVER purposefully reap working agents to finish the wrap (operator rule 2026-06-11).** Classify each member FIRST: **idle** → `shutdown_request`; **mid-work** (building, mining, mid-append, mid-subprocess) → do NOT kill it to complete `--fast` — either give it one short drain window to reach a natural boundary, or LEAVE it as a straggler and say so in the report. There is no `TeamDelete` as of Claude Code v2.1.178 — teams are session-scoped and release when the session ends; stragglers left alive are reconciled by the next session's `/mode:sprint` step 1.75. Speed never justifies discarding in-flight work; "fast" bounds the *waiting*, not the agents' right to finish. Don't poll indefinitely. |
| 10 Report | **KEEP.** State what was skipped (cognitive chain), the TRACKER result, the DUMP next-pick, what committed/pushed/landed-or-not (with the merge judgment), teardown state, and "clear to start fresh." |

`--fast` still honors every hard ceiling (push autonomy-gate, safety floor, no force-push) and stays fail-closed on Phase 5.

## Procedure

> **`--fast`?** Skip Phases 1–4 entirely and run only Phases 5–10 per the **## Fast mode** table above (commit-everything + DUMP + tracker-green = recoverable, no loss). The phases below are the FULL flow.

### Phase 1 — Extract learnings (`/learn:deep`)
Run `/learn:deep`. It mines THREE sources in parallel: conversation, event log, and retro/report files (oneshot retros + **sprint retros** `paths.sprintHistory` + **`_reports/`**). Subagents can't read the transcript — do the conversation phase yourself; fan out events + retros as read-only subagents that RETURN candidates (write centrally to avoid concurrent-write conflicts on `paths.learningsFile`).

### Phase 2 — Mine user patterns (`/beta:mine`)
Run `/beta:mine`. Writes recommendations to the β staging file (`.claude/agents/president/_system/beta/judgement-model-recommendations.md`). Does NOT modify the judgement model directly — Phase 3 reviews the recs. Can run as a background subagent while Phase 1 finishes.

### Phase 3 — Consolidate (`/sleep:deep`, or `/sleep:quick` with `--quick`)
Run `/sleep:deep` (all 6 phases). **Depends on Phase 1 + 2 output** (Phase 4 of sleep reviews the β recs + freshly-logged learnings). This is the long pole (~15-30 min). With `--quick`, run `/sleep:quick` instead.

### Phase 4 — Integrate (`/learn:integrate` + `/beta:integrate`)
Both run AFTER sleep (Phase 3) so they act on the **consolidated + reviewed** set. They touch different targets (learnings → enforcement; β recs → judgment model), so run them in parallel:
- **`/learn:integrate`** — promote validated, high-score **learnings** into actual enforcement (hooks / rules / skills / agent specs).
- **`/beta:integrate`** — promote the validated **β pattern-mining recommendations** (staged by Phase 2's `/beta:mine`, reviewed in `/sleep:deep` Phase 4) into the **β judgment model**. This is the counterpart to `/learn:integrate`: without it, `/beta:mine`'s recs sit in the staging file *mined-but-never-applied* — the exact gap that left P-051..P-054 staged at session-2 end. Apply only operator-validated / high-confidence recs; a NEW *principle* or *policy* item still needs its own operator ruling (don't auto-promote a behavioral principle).

> Both are no-ops if Phase 1/2 produced nothing to integrate — fail-open: note and continue.

### Phase 4.5 — Debt sweep (`/enforcement:sweep`)
Run `/enforcement:sweep`. Finds UNFILED debt — deferral comments, prompt suppressions, skipped
tests, unenforced-policy claims, review residuals — and reconciles it against `paths.enforcementDebt`,
filing what's missing. Runs AFTER integrate (Phase 4) so freshly-promoted learnings don't double-file,
BEFORE the tracker reconcile (Phase 5) so the handoff reflects an honest ledger. Fail-open: on
failure, note it and continue — but capture the triage report path in the DUMP. (Origin: ED-305 —
"a comment is not a ledger entry.")

### Phase 5 — Reconcile + validate `TRACKER.md` (fail-CLOSED)
`TRACKER.md` (root) is the enforced source of truth — the Handoff (Phase 6) is built FROM it and the Land (Phase 7) pushes it, so it must be ACCURATE and GREEN before either. Never write a handoff or land on a tracker that lies about state.
1. **Validate.** Run `node scripts/trackers/validate.js` (the full check set — currently **20 checks**: 12 single-file + 8 cross-file incl. `cross-file-reconciliation`, `epics-in-roadmap`, `roadmap-epic-based`). It must exit 0.
2. **Reconcile if needed.** If it FAILs — OR if `TRACKER.md` doesn't reflect THIS session's work — UPDATE it AND its linked `trackers/epics/E-*.md` + `trackers/sprints/*.md` files so every item's state / percent / evidence / next-action matches reality (state changes, items moved to Completed, new gaps recorded, definitions added, change-log + session-log entries). `cross-file-reconciliation` FAILs if a TRACKER item's state disagrees with its linked file — update BOTH. If roadmap-coupled state changed, reconcile `ROADMAP.md` § Epics too. Re-run the validator until **all checks PASS, exit 0**.
3. **Why fail-closed (unlike the cleanup phases):** a red/stale tracker at session end is the exact "state drifts silently from the contract" / "felt-done-but-wasn't" failure the enforced tracker exists to prevent — and the next session resumes from it. If the validator cannot be made green, **STOP and surface it**; do NOT proceed to Handoff/Land on a lying tracker. (This is the PROACTIVE counterpart to the `scripts/hooks/tracker-completion-gate.js` Stop hook, which catches a red tracker at the actual session Stop — reconcile here so that hook stays silent.)

### Phase 6 — Handoff (`/session:dump`)
Run `/session:dump` to write a fresh prescriptive `DUMP.md` at project root. MUST include: (a) what shipped in the ending session (commits + ISO date, verified), (b) the **next-session pickup** (ranked, role-aware — consult `director-of-product`/`product-lead` for the top pick), (c) **immediate issues found** during the ending session, (d) anti-instructions / coordination lessons, (e) state + spend notes. `DUMP.md` is gitignored/local — it does not get committed; it's read once by the next session.

> **Anti-deixis writing discipline (S-10, applies to the DUMP content):** the reader's "this session" is NOT the writer's — a bare deictic written today reads as a present-tense instruction tomorrow. In the DUMP: anchor every status to an ISO date and (where one exists) a commit hash; give every imperative an explicit actor and scope ("the next session must X", "do NOT merge SP-X to main until <condition>"), never a bare "in this session, do not execute" / "don't do this now"; write negatives past-tense + dated ("push authorization was NOT given in the 2026-06-11 session"), not "no push this session". Same convention as the tracker's `session-relative-language` advisory.

### Phase 7 — Land (`/commit:land`)
Regenerate BOTH manifests first if any hash-tracked file changed (`node scripts/generate-framework-manifest.js` + `node scripts/mc/manifest/build.js`) — else BC-02/BC-05 go red. Then run `/commit:land` (commit → push branch → **brokered** merge onto default via `scripts/dispatch/broker-merge.js` → push default). The merge onto `main` is fenced: a raw `git merge` / `git pull --ff-only origin main` works today unbrokered via the logged fallback but is REFUSED by the reference-transaction hook post-flip — `/commit:land` Step 4 already routes it through the broker.

> **AUTONOMY CEILING (hard):** pushing to remote requires operator authorization (CLAUDE.md `## Autonomy`). `/session:end` does NOT auto-push unless the operator has authorized a push in the current session OR turbo `push-to-main` scope is active. With `--no-push` (or no authorization), stop at the LOCAL commit + brokered merge onto `main` (the fenced land, no push) and surface "ready to push — confirm." NEVER force-push; never bypass the safety floor.

### Phase 8 — Fresh branch
After the land, create a clean working branch off `main` so the next session doesn't start on a dirty/merged branch:
```bash
git -C "$CLAUDE_PROJECT_DIR" switch main
git -C "$CLAUDE_PROJECT_DIR" switch -c <--branch | session/$(date -u +%F)>
```
(Skip if the operator wants to stay on `main`.)

### Phase 9 — Tear down teams (`--keep-teams` to skip)
Tear down ALL persistent teams + members for this project so the next session spawns fresh (avoids W-21 cross-session accretion + zombie in-process teammates) — **without purposefully reaping in-flight work** (operator rule 2026-06-11: never kill a working agent just to finish the wrap; speed bounds the waiting, not the agents' right to finish):
0. **Classify each member before any shutdown:** idle (last signal = idle_notification / task completed, no outstanding work) vs **mid-work** (building, mining, mid-file-append, mid-subprocess — check its task status + recent activity). A `shutdown_request` to a mid-work teammate is processed at its next message boundary, which can interrupt a multi-turn plan — treat it as a reap.
1. For each **idle** member, `SendMessage {type:"shutdown_request"}` and wait for `shutdown_approved` — this reaps **live in-process** agents (a zombie from a dead session stays addressable and reappears until reaped). For each **mid-work** member: give ONE short drain window (let it reach a natural boundary and commit/flush), and if it hasn't drained, **leave it as a straggler** — report it, don't kill it. The next session's `/mode:sprint` step 1.75 reconciles stragglers.
2. Let the session end release the implicit team. As of Claude Code v2.1.178 there is no `TeamDelete` tool — teams are session-scoped and tear down with the session, so "teardown" = the `shutdown_request` drain in step 1 (reaps live in-process agents) plus the on-disk cleanup in step 3. If stragglers live, leave them — report it instead of escalating to kills.
3. Remove any stale on-disk team dirs for THIS project under `~/.claude/teams/` + `~/.claude/tasks/`. As of v2.1.178 the harness names team dirs `session-<uuid>` (not the legacy `<slug>-<mode>`), so identify "this project's" dirs by **member `cwd`** (the project root), exactly as `scripts/teams/lifecycle.js` does — NOT by a name-slug match, which no longer identifies your own team. Only this project's (a member `cwd` at/under the project root); **NEVER touch a sibling-project team** (a different `cwd`). Legacy `*-adhoc`/`*-sprint` name-slug dirs from older Claude Code builds are also yours if present.
4. Verify with `node scripts/checks/adhoc-team-hygiene.js` (clean for this project).

### Phase 10 — Report
Tell the operator: what consolidated (learnings/recs/integrations), **the TRACKER.md validation result + any reconciliation done** (Phase 5), the `DUMP.md` next-pick, what landed (commit + pushed-or-local), the fresh branch name, teams torn down, and a one-line "you're clear to start a fresh session."

## Notes / lessons baked in
- **Sequential by dependency** — sleep needs learn+mine; BOTH integrators (`/learn:integrate` + `/beta:integrate`) need sleep; **the TRACKER.md reconcile (Phase 5) must precede the handoff + land** (both consume the tracker as source of truth); dump needs the analysis; land needs manifests fresh; branch + teardown come last.
- **TRACKER reconcile is fail-CLOSED** (Phase 5) — unlike the fail-open cleanup phases, a red/stale tracker BLOCKS the handoff + land. The handoff is built from it and the next session resumes from it; a lying tracker poisons both. Reconcile `TRACKER.md` + its epic/sprint files + `ROADMAP.md` § Epics until `node scripts/trackers/validate.js` is fully green.
- **Mine + integrate are a PAIR (run both halves)** — `/beta:mine` only STAGES recommendations; `/beta:integrate` is what APPLIES the validated ones to the judgment model. Running mine without integrate (as session-2 did) leaves recs perpetually staged. Same shape as `/learn:deep`→`/learn:integrate`.
- **Push is autonomy-gated** — default to local-only unless authorized.
- **First real run of a new orchestration skill should be operator-supervised** — don't trust an untested wrap-up on a critical push; hand-drive once, then rely on it.
- **Don't `node -e` fs-writes** (merge-guard blocks) — use Write/Edit or a one-shot `scripts/*.js`.
- **Never purposefully reap working agents to finish a wrap** (operator rule 2026-06-11, set during a `--fast` wrap that shutdown-requested still-running miners/fixers to complete teardown). Stragglers + an honest report beat a fast-but-lossy teardown; the wrap is complete WITH stragglers noted. The mechanical counterpart (`scripts/hooks/session-end-team-teardown.js`, S-LC-05) should carry the same idle-vs-mid-work classification — gap candidate for `/enforcement:log` if not yet wired.

## Related
- `/learn:deep`, `/beta:mine`, `/sleep:deep`, `/sleep:quick`, `/learn:integrate`, `/beta:integrate` — the cognitive-maintenance chain (mine+integrate and deep+integrate are PAIRS — run both halves).
- `/enforcement:sweep` — the Phase 4.5 debt-finding sweep (unfiled deferrals → `paths.enforcementDebt`).
- `/trackers:validate` — the fail-closed tracker validator run in Phase 5 (`node scripts/trackers/validate.js`).
- `/session:dump`, `/session:handoff`, `/session:checkpoint` — handoff artifacts.
- `/commit:land` — the commit→push→merge flow.
- `/mode:adhoc` — re-spawns the team next session.
