---
description: Set up WarpOS end-to-end — clone, install, merge CLAUDE.md, restart, verify. Safe to re-run; auto-detects and completes missing steps.
user-invocable: true
---

# /warp:setup — Full WarpOS Setup

The one-command onboarding. You run `/warp:setup`, the skill does everything for you — clone, install, merge Alex into your CLAUDE.md, verify. Re-running is safe: the skill checks what's already in place and picks up from the first missing step.

Formerly `/warp:init`. Renamed because it does the whole setup.

## How it works

The skill checks 4 signals in your project, in this order, and runs whatever step is missing:

| Signal | Check | If missing, run |
|---|---|---|
| **1. WarpOS repo nearby** | `../WarpOS/` exists as a git clone | Step A — clone |
| **2. Framework files installed** | `.claude/manifest.json` has `warpos.installed: true` | Step B — run installer |
| **3. Alex identity in CLAUDE.md** | `CLAUDE.md` contains the string `"You are **Alex α**"` | Step C — merge CLAUDE.md |
| **4. Hooks schema valid** | `.claude/settings.json` has `"type": "command"` on every hook entry | Step D — rerun installer to rebuild settings |

If everything passes, the skill reports "WarpOS is fully set up" and suggests `/warp:health`.

## Procedure

### Phase 1 — Assess current state

Read these files (silently, report only what's missing):

1. `ls ../WarpOS/` — repo present?
2. `.claude/manifest.json` → parse → does `warpos.installed === true`?
3. `CLAUDE.md` → grep for `Alex α` → present?
4. `.claude/settings.json` → parse → do hook entries have `type: "command"`?

Tell the user exactly what state their project is in, before doing anything:

> Checking your WarpOS install…
>
> - `../WarpOS/` repo: ✓ present (commit <sha>) | ✗ missing
> - Framework files: ✓ installed (version <v>) | ✗ not installed
> - Alex identity in CLAUDE.md: ✓ merged | ✗ missing
> - Hook schema: ✓ valid | ✗ needs refresh
>
> I'll run <N> step(s) to complete your setup. Here's what I'll do:
> [list the remaining steps]
>
> Ready? [any reply proceeds; "no" stops]

### Step A — Clone WarpOS

Only if `../WarpOS/` is missing.

```bash
git clone https://github.com/cygaco/master-console.git ../master-console
```

If the clone fails (private repo, no access):
> "The WarpOS repo requires access. If you have a GitHub account, ask the owner to add you as a collaborator, then run `/warp:setup` again. If you were given a personal access token, run this first:
> `git config --global credential.helper store`
> `git clone https://<PAT>@github.com/cygaco/master-console.git ../master-console`"

### Step B — Run the installer

Only if framework files missing.

```bash
node ../WarpOS/scripts/warp-setup.js . --interactive
```

Walk the user through the 5-question interview:
1. Project name (default: current dir basename — accept if matches)
2. One-line pitch (can be blank; tell them "fine, we'll fill PROJECT.md later")
3. Primary user
4. Main branch (auto-detected; confirm)
5. ANTHROPIC_API_KEY location (smart-context needs it — tell them `.env.local` is fine; if they skip, warn that prompt enrichment will be disabled)

Watch for the installer's summary. Report success/warnings to the user.

### Step C — Merge Alex into CLAUDE.md

This is the step the installer can't do because your CLAUDE.md is personal. The skill does it conversationally.

**Check if CLAUDE.md exists:**

If NOT:
- Copy `../WarpOS/CLAUDE.md` → `./CLAUDE.md`
- Tell user: "Alex identity installed in CLAUDE.md."
- Done.

If YES (user has existing content):
- Read user's CLAUDE.md — count lines, summarize first heading
- Read `../WarpOS/CLAUDE.md`
- Present the 3 merge strategies to the user IN PLAIN LANGUAGE:

> Your project already has a CLAUDE.md with <N> lines (starts with "<first heading>"). I need to add the Alex framework (~90 lines: identity, autonomy rules, reasoning protocol, β consultation, memory map).
>
> Three options:
> - **A: Append** — keep your content exactly as-is, add the Alex framework below it with a horizontal rule separator. Safest, fully reversible. **Recommended.**
> - **B: Replace** — use only the Alex framework. Do this if your CLAUDE.md was the Claude Code default or nearly empty.
> - **C: Show me both** — I'll paste both side-by-side and you tell me what to keep.
>
> Which? (A / B / C)

Based on the answer:

**A (Append):**
```bash
# Backup first
cp CLAUDE.md .warpos-backup/CLAUDE.md.pre-merge

# Append with separator
cat ../WarpOS/CLAUDE.md >> CLAUDE.md
# (prepend separator: use Edit tool to add "\n\n---\n\n" before the appended block)
```
(In practice, read user's CLAUDE.md, read WarpOS CLAUDE.md, write combined.)

**B (Replace):**
```bash
cp CLAUDE.md .warpos-backup/CLAUDE.md.pre-merge
cp ../WarpOS/CLAUDE.md CLAUDE.md
```

**C (Side-by-side):**
Display both files inline. Ask the user which sections of WarpOS's CLAUDE.md to include. Build a merged version from their selections.

After either path:
- Confirm with user: "Merged. Your original is saved at `.warpos-backup/CLAUDE.md.pre-merge` if you want to revert."

### Step D — Verify hook schema

Read `.claude/settings.json`. For every event in `settings.hooks`, check that every entry inside `hooks: [...]` has `type: "command"`. If any lack it:

> Your settings.json has hook entries in the old schema. I'll re-run the installer to rebuild settings.json with the current schema. Your existing custom hooks (if any) will be preserved.

Then run:
```bash
rm .claude/settings.json
node ../WarpOS/scripts/warp-setup.js . --skip-backup
```

(The `--skip-backup` flag is fine — we already have a backup from the prior install.)

### Phase 2 — Tell user to restart Claude Code

**This is the critical moment.** All file-based setup is now complete, but Claude Code won't recognize the new hooks until it reloads `settings.json` — which only happens at launch.

Tell the user, VERBATIM:

> ✓ Setup complete. One last thing: **close this Claude Code session and open a fresh one in the same project.**
>
> Why: Claude Code reads settings.json only when it starts. Any hooks we just registered won't fire until you restart.
>
> When you reopen, your first prompt will be intercepted by `smart-context.js` (the prompt enrichment hook), logged by `prompt-logger.js`, and your Edits/Writes will go through the guard chain. That's when WarpOS is actually alive in this project.
>
> I'll auto-run `/warp:health` the moment you prompt me next session — it has the verification commands and first-use tips.

### Phase 2.5 — Dispatch + provider sanity (Phase 0)

Run these once, after restart, before the user dispatches anything:

```bash
node scripts/dispatch/prune-dead-locks.js
node scripts/warpos/provider-health-check.js --summary
```

If `provider-health-check` flags any non-green provider, print its
`suggestion` field verbatim to the user. The check is fail-open and
should NOT block setup.

### Phase 3 — Provider CLIs (optional)

AFTER the user restarts, the first `/warp:health` will flag missing provider CLIs. At that point, if they want full model diversity, show:

```
┌─────────────────────────────────────────────────────────────┐
│  Provider CLIs — optional, install if you want them        │
├─────────────────────────────────────────────────────────────┤
│  OpenAI Codex  (evaluator, compliance, qa, auditor)        │
│    npm i -g @openai/codex                                   │
│    codex login                                              │
│                                                             │
│  Gemini CLI    (redteam / security)                        │
│    npm i -g @google/gemini-cli                              │
│    gemini auth login                                        │
│                                                             │
│  Skip either → agents fall back to Claude automatically.   │
└─────────────────────────────────────────────────────────────┘
```

Don't block on this. Setup is already complete without them.

## Flags

- `--source <url>` — use a custom WarpOS repo instead of `cygaco/master-console`
- `--yes` — skip interactive prompts (use detection defaults)
- `--skip-backup` — don't back up existing CLAUDE.md / .claude / .gitignore (advanced; use only in CI)
- `--merge-strategy <append|replace|interactive>` — pre-choose how to handle existing CLAUDE.md

## Related

- `/warp:uninstall` — cleanly removes WarpOS, restores from backup
- `/warp:sync` — pull latest WarpOS updates from GitHub (non-destructive)
- `/warp:health` — post-install verification
- `/warp:tour` — guided subsystem walkthrough

## Why re-run is safe

Every step has an is-done signal. Steps only run when their signal is missing. So:
- First-time setup runs all 5 steps
- Partial install (installer succeeded but user never merged CLAUDE.md) resumes at Step C
- Everything done → skill reports "fully set up, run /warp:health" and exits
- Breaking change in schema? Re-run → Step D rebuilds settings.json

Users never have to think about "which step am I at" — the skill figures it out.

## Provider smoke — terminal step (SP-20260513-002)

After Step E succeeds (or after a re-run reports "fully set up"), invoke the provider smoke as the last operator-visible step:

```
node scripts/warpos/provider-smoke.js --providers claude,openai,gemini
```

This wraps the existing `paths.providerFallbackPolicy`-backed health
check with RCA (`scripts/warpos/lib/provider-rca.js`, ticket
`T-20260513-022`) and a safe-only auto-fix dispatcher
(`scripts/warpos/lib/provider-autofix.js`, ticket `T-20260513-023`).

**Exit-code semantics** (PRD R-7):
- `0` — all green, OR yellow without `--exit-on-yellow` (yellow is non-blocking; an unauthenticated codex CLI is not a setup blocker if the operator hasn't onboarded yet).
- `2` — at least one required provider returned a red status. Setup leaves disk in a usable state but exits non-zero so the operator knows providers are NOT verified yet.
- `1` — internal error (corrupt failure-mode catalog, invalid argv).

**On RED:** print the C-5 block (from
`paths.sprintRequirements/SP-20260513-002/copy.md`) — tells the operator
the cause is fixable and the install is on disk. They can re-run the
smoke after fixing the cause without re-running the full setup.

**No auto-rollback on red.** Rollback is out of scope here (owned by
SP-20260513-005); the smoke is a verification step, not a transaction
boundary. The generic fallback for an operator who wants to revert is
`git reset --hard pre-warpos-<version>` per the install backup.

**Yellow is non-blocking by default.** If the operator wants stricter
gating, pass `--exit-on-yellow` (e.g. for a fresh provisioned dev box
where missing CLIs SHOULD be installed before onboarding).

Linked acceptance criteria: `AC-6.1` (green path exits 0) and `AC-6.2`
(red exit non-zero, install stays on disk).
