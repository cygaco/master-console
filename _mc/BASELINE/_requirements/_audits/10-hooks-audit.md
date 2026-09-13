# Hooks Audit Report

**Date:** 2026-03-30
**Hook scripts audited:** 14 (13 in scripts/hooks/ + 1 in .claude/hooks/)
**Events covered:** 7 (SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, PostCompact, Stop, WorktreeCreate)

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 2 |
| MEDIUM | 2 |
| LOW | 2 |

## Agent Risk Assessment

Hook system is functionally strong but strategically incomplete. If builders ran now: (1) no hook prevents editing foundation files (types.ts, constants.ts, etc.) — locked in store.json but unguarded in hooks, (2) no hook prevents Builder A from editing Builder B's files — cross-feature corruption possible, (3) lint.js + typecheck.js add 3-10s latency per edit.

## Findings

### CRITICAL

| # | Finding | Location | Fix |
|---|---|---|---|
| 1 | No foundation file protection hook — Edit/Write to types.ts, constants.ts, storage.ts, validators.ts, pipeline.ts, api.ts, utils.ts, prompts.ts not blocked | Missing hook | Create foundation-guard.js (PreToolUse: Edit\|Write) that blocks edits to foundation files unless override present |
| 2 | No ownership guard for cross-feature edits — Builder A can edit files owned by Builder B | Missing hook | Create ownership-guard.js (PreToolUse: Edit\|Write) that checks store.json file ownership |

### HIGH

| # | Finding | Location | Fix |
|---|---|---|---|
| 3 | No mid-gauntlet edit blocker — cycle-enforcer blocks builder DISPATCH but not post-edit operations during "reviewing" phase | scripts/hooks/cycle-enforcer.js | Extend cycle-enforcer to also trigger on Edit\|Write during gauntlet |
| 4 | Slow lint/typecheck on every Edit — lint.js (3-10s) + typecheck.js (3-8s) run on every post-edit | scripts/hooks/lint.js, typecheck.js | Add skip logic for config files, auto-generated files |

### MEDIUM

| # | Finding | Location | Fix |
|---|---|---|---|
| 5 | Missing GitHub token patterns in secret-guard | scripts/hooks/secret-guard.js | Add ghp_*, gho_*, ghu_* patterns |
| 6 | Markdown formatting guard is documented but relies on exclusion only | scripts/hooks/format.js | Current approach (skip .md) is correct; document as intentional |

### LOW

| # | Finding | Location | Fix |
|---|---|---|---|
| 7 | Decision logger path matching is case-sensitive, Unix-only | scripts/hooks/decision-logger.js | Normalize path comparison for cross-platform |
| 8 | Boss boundary detection relies on store.json heartbeat (single point) | scripts/hooks/boss-boundary.js | Graceful fallback exists; acceptable |

### Resilience Assessment

All 14 hooks have **excellent error handling**:
- Graceful stdin handling (chunked reading)
- JSON parse errors caught (exit 0, non-blocking)
- Missing file/dependency handled (warns, continues)
- Platform-aware clipboard (Windows/macOS/Linux)
- Proper exit codes (0=pass, 2=block)

### Coverage Matrix

| Tool/Event | Hooks | Status |
|---|---|---|
| Edit/Write | secret-guard, decision-logger, format, lint, typecheck | COVERED (missing: foundation guard, ownership guard) |
| Agent | gate-check, gauntlet-gate, cycle-enforcer | COVERED |
| Read/Grep/Glob | boss-boundary | PARTIAL (Boss only) |
| SessionStart | session-start | COVERED |
| UserPromptSubmit | prompt-logger | COVERED |
| PostCompact | compact-saver | COVERED |
| Stop | session-stop | COVERED |
| WorktreeCreate | create-worktree-from-head | COVERED |

## Top 5 Actions Before Next Run

1. **Create foundation-guard.js** — prevent edits to foundation files without explicit override (1 finding)
2. **Create ownership-guard.js** — prevent cross-feature file editing during builds (1 finding)
3. **Extend cycle-enforcer to Edit/Write** — block mid-gauntlet edits from dispatched builders (1 finding)
4. **Add GitHub token patterns to secret-guard** — ghp_*, gho_*, ghu_* (1 finding)
5. **Optimize lint/typecheck hooks** — skip config files and auto-generated files to reduce latency (1 finding)
