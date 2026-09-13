# CODEX.md — Codex / GPT executor entrypoint (thin shim, one source of truth)

> Thin per-executor entrypoint for when the executor is **Codex/GPT** (the `codex` CLI) instead of the
> Claude harness. It DUPLICATES NOTHING: the shared entering-agent rules are the block below (single-
> sourced from `.claude/project/reference/entry-preamble.md`, hash-parity-checked); this file adds ONLY
> what is DIFFERENT under Codex. (SP-20260723-001 / ADR-0036 — supersedes the interim 2026-06-11 shim.)

<!-- MC:ENTERING-AGENT-PREAMBLE:BEGIN v1 -->
**What this repo is.** MC is a framework for running an autonomous AI software company. Work is delivered by mode-selected *faces* of a single operator persona, plus departmental agents (Product, Engineering, Growth). Identity, the autonomy ceilings, and the full operating doctrine live in `CLAUDE.md` — this preamble asserts none of them; it points you there.

**Read order — once, then act.**
1. `DUMP.md` (repo root, local) — the session handoff: next action, in-flight state, verbatim payloads. Read once, then execute.
2. `TRACKER.md` (repo root) — the ENFORCED source of truth. It OUTRANKS `DUMP.md`, this preamble, and your own assumptions. Validate with `node scripts/trackers/validate.js` (must exit 0) before AND after meaningful work; on any disagreement, the tracker wins.
3. `CLAUDE.md` (repo root) — the operating doctrine: autonomy, dispatch, and policy/enforcement + refactor/rename hygiene. Its RULES apply to every executor; the harness-specific mechanics may not.

**Dispatch is CLI-first.** Agent dispatch runs through the CLI wrappers — `node scripts/dispatch-claude.js <role> <prompt-file> -w` for build-chain Claude roles, `node scripts/dispatch-agent.js <role> <prompt-file>` for cross-provider reviewers. CLI is mandatory; a provider API is used ONLY where there is no CLI equivalent. Cross-provider review diversity is required, and a binding FAIL cannot be overridden.

**Guards, gates, and output destinations.** The repo's guarantees are enforced: the `refs/heads/main` reference-transaction fence (every write to main goes through the broker), `/scan:full`, and the release gates. Every policy names an enforcer or logs the debt. Write per-run output under `runtime/`, never a manifest-tracked project dir. Orchestrators hold envelopes, not content — heavy work goes to a subprocess that writes its full output to a file and returns a short envelope. Regenerate both manifests after editing any hash-tracked file.

**For identity, authority, and the complete rules, read `CLAUDE.md`.**
<!-- MC:ENTERING-AGENT-PREAMBLE:END -->

## What is DIFFERENT under Codex

**1. Auth surface — ChatGPT-OAuth, not an API key.** On this machine `codex` authenticates via `~/.codex/auth.json` with `auth_mode=chatgpt`, so `codex exec` bills the **ChatGPT plan** (zero metered-API credits). Never assert a billing surface without reading `auth_mode` first (a stale read once caused a false spend escalation). If `auth.json` reads `apikey`, that is a different (metered) surface — do not assume. Do NOT write `sk-…`/`*_API_KEY=` literals into tracked files; secrets live in env / `.env.local` only. To avoid cache collisions with the ChatGPT desktop app, an isolated `CODEX_HOME=~/.codex-mc` is the sanctioned seam ("missing field"/"Access denied" cache errors are a multi-writer collision, not an outage).

**2. Invocation — non-interactive, prompt on stdin.**
```
codex exec --sandbox workspace-write [-c model_reasoning_effort=<low|medium|high>] -m <model> -
```
The trailing `-` reads the prompt from **stdin** (`cat prompt.txt | codex exec … -`; a large prompt via argv overflows the arg limit). `exec` is non-interactive: `--ask-for-approval` is interactive-only and `--full-auto` is deprecated (≥0.135) → use `--sandbox workspace-write`. Do NOT pipe a secret via a PowerShell pipe (it prepends a UTF-8 BOM that corrupts the value); install credentials via `cmd /c 'tool < keyfile'`.

**3. NO HOOKS FIRE → the guards are YOUR manual responsibility.** Every MC guard is a Claude-harness hook (`scripts/hooks/*`, wired in `.claude/settings.json`); under Codex they are INERT. So you self-enforce: no secrets in tracked files (secret-guard); real file writes, not `node -e` fs-writes, and `\s` not a literal space before `]` in a regex char class (no-nul-bytes/merge-guard); reference paths via the registry, not stale literals (path-guard); builder dispatches still carry an explicit `allowedFiles`/`forbiddenFiles` scope in the brief (scope-contract-guard); run `node scripts/trackers/validate.js` yourself before claiming done (tracker-completion-gate); read `TRACKER.md` + `DUMP.md` + the relevant `runtime/notes/*` explicitly (no auto memory injection).

**4. NO HARNESS AGENT TOOL → CLI dispatch only.** You are not a Claude-harness agent, so you have no in-process `Agent` tool and cannot summon α/β/ε/directors/leads as teammates. Dispatch via the CLI routes only: `node scripts/dispatch-claude.js <role> <prompt-file> -w` (build-chain Claude roles — a Claude builder is a cross-family worker for you; the wrapper handles auth) and `node scripts/dispatch-agent.js <role> <prompt-file>` (cross-provider reviewers; pin the family with `--provider openai|antigravity` when a re-review must match the prior FAIL's family — `gemini` is sunset, the Gemini family is `antigravity`/`agy`).

**5. THE REAP (read before dispatching ANY builder).** A headless `claude -p` builder launched from a BACKGROUND shell is silently killed at the CLI buffer (~45s in, before any output or death record — RI-004). Always dispatch builders FOREGROUND (`-w`, no backgrounding, no `WARPOS_DISPATCH_BACKGROUND=1`); foreground survives past the reap point. After each dispatch, independently verify the worktree diff + commit + the worker's envelope — never trust a self-report.

**6. CROSS-PROVIDER REVIEW STAYS REAL.** The gauntlet's binding verdicts come from cross-provider reviewers. As a GPT executor you still run them as independent lanes (never self-review your dispatched work); a binding FAIL cannot be overridden.

## Skills (slash commands) under Codex

`.claude/commands/*.md` are PROCEDURES, not executable slash commands for you. When `DUMP.md`/`TRACKER.md` says "run `/x:y`", OPEN `.claude/commands/x/y.md` and follow its documented CLI steps. <!-- doc-ref-ignore: x/y.md is an illustrative pattern for any skill path --> The sprint runtime itself is real CLI (`node scripts/sprint/epsilon-runtime.js plan|conduct`), but `record-inprocess` + the in-process roster need the Agent tool you don't have — so build/gauntlet run through the `dispatch-claude.js` / `dispatch-agent.js` CLI routes per #4.
