# Per-provider cwd / sandbox behavior

The rule: **cwd/sandbox behavior per provider gets TESTS before any "neutral cwd"
change — changing cwd moves codex's sandbox root, so don't adopt blind.** This document is the invariant
matrix the guard test (`cwd-sandbox-invariants.test.js`) protects. The table below is the CURRENT behavior,
asserted as a standing guard so a FUTURE cwd change cannot silently regress it.

| Provider / role | cwd at spawn | Write root | Sandbox note |
|---|---|---|---|
| Claude **builder/fixer** (dispatch-claude) | the ISOLATED git worktree (`--worktree`/`-w`) | exactly one isolated worktree — never canonical | `CLAUDE_PROJECT_DIR` is forced to CANONICAL so telemetry/records resolve canonical, never the worktree |
| Claude **reviewer** (dispatch-agent, claude fallback) | canonical | read-only (no worktree) | reviewers get read-only evidence — no write root |
| **codex** reviewer (dispatch-agent) | canonical | read-only | **codex's sandbox root = its cwd**; codex auto-loads AGENTS.md from cwd. Changing the wrapper's cwd MOVES codex's sandbox root and swaps which AGENTS.md it reads — this is why a "neutral cwd" change is UNSAFE to adopt blind |
| **gemini/agy** reviewer (dispatch-agent) | canonical | read-only | cwd/sandbox unproven; follows the codex posture |

## Invariants the guard asserts
1. **Builder isolation (write-root):** a build-chain role dispatched via `dispatch-claude.js` REQUIRES an
   isolated git worktree (`-w`/`--worktree`); a missing/canonical/non-worktree path is refused. A builder
   never edits canonical.
2. **Canonical telemetry env:** the builder's child env carries `CLAUDE_PROJECT_DIR = AGENT_ROOT`
   (canonical) EVEN when cwd is a worktree — nested telemetry resolves canonical, never the worktree copy.
3. **No global neutral-cwd override:** the dispatch bridges do NOT change process cwd to a shared "neutral"
   directory (which would move codex's sandbox root). The only cwd move is the builder → its isolated worktree.

## Why there is no "neutral cwd"
Running every provider from one neutral cwd is UNSAFE for codex: its
sandbox root follows cwd, so a neutral cwd would change what codex may read/write AND which AGENTS.md it
slurps. The per-role cwd above stands. Enforcer: `scripts/dispatch/cwd-sandbox-invariants.test.js`.
