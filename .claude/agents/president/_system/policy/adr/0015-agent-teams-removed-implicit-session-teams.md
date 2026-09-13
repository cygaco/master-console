# ADR 0015 — Claude Code v2.1.178 removed agent-teams: MC migrates to implicit session-scoped teams, member-cwd project scoping, and an orphaned-subprocess reaper

**Status:** accepted

**Date:** 2026-06-19

**Epic:** E-TEAMS-MIGRATION-001 (externally triggered)

## Context

Claude Code **v2.1.178 (2026-06-15)** REMOVED the experimental agent-teams tools `TeamCreate` and
`TeamDelete`. Teams are now **implicit + session-scoped**: a teammate is created by spawning a NAMED
BACKGROUND SUBAGENT via `Agent(subagent_type:…, name:…, run_in_background:true)`, and the **first such
spawn implicitly creates the session team**. `SendMessage` is unchanged; nesting is allowed up to 5
levels deep; the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env flag is phasing out. Nothing in MC
crashes (a Node script could never call those tools anyway), but ~5 skills, ~4 hooks, tests, and
~12 docs instructed the dead API.

An empirical probe of `~/.claude/teams/` under v2.1.178 established two load-bearing facts (this is
verify-don't-inherit — the migration's whole scope rests on them):

1. The harness **STILL writes** `~/.claude/teams/<session>/config.json` with a full `members[]` array
   (each member carrying `agentType`, `name`, `cwd`, `backendType`). So every hook's member/`team_name`
   INSPECTION logic remains valid — the migration is fundamentally a **directive swap, not a logic
   rewrite**.
2. The team is now named **`session-<uuid>`** (e.g. `session-e9813efe`), NOT the `<slug>-<mode>` handle
   (`mc-sprint`) that `session-start.js` mints. This **silently breaks every project-scoping path
   that matched a team by its NAME slug** — `lifecycle.js#teamBelongsToProject` (name-only) returned
   false for our own team, so `projectTeams()` went empty, `verify()` falsely reported "no team live",
   and teardown mistook the real team for a foreign one (and never tore it down). This is a real
   silent-fail-open-wrong logic bug, beyond pure text.

## Decision

**1. Spawn-via-Agent replaces TeamCreate everywhere.** Every skill/hook directive that instructed
`TeamCreate(…)` now instructs `Agent(subagent_type:…, name:…, run_in_background:true)`; the implicit
session team is documented as the model. Remediation block-messages (the team-guard hard gate, the
session-start `teamInitDirective`) point at the NEW remediation — a gate that blocks while telling the
operator to run a REMOVED tool is a dead-end gate, strictly worse than no gate.

**2. Project scope is by member `cwd`, not team name.** `lifecycle.js#teamBelongsToProject` gains a
member-cwd arm (mirroring the existing `team-guard.js#isProjectScopedTeam` arm (b)): a team is ours iff
its NAME carries our slug (legacy/back-compat) **OR** a member `cwd` is the project root exactly or
strictly under it. The wrong-project-survives safety invariant is preserved — a team with neither a
matching name nor a matching member cwd is still NOT ours and is never kill-eligible.

**3. The `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` flag is informational, not a gate.** `install.js` and
`/warp:health` §3.5 report it as INFO (present = harmless legacy; absent = fine) — never a FAIL/RED.

**4. Orphaned dispatch subprocesses get a reaper.** `scripts/dispatch/reap-orphans.js` detects (and
with `--apply` SIGTERM-terminates) a provider CLI orphaned when the harness reaps its `dispatch-*.js`
wrapper (the ED-039/RI-004 class — distinct from the lock-file cleanup `pruneDeadLocks` already does).
It is conservative-by-construction and fail-open: a process is reaped ONLY when its command line
matches a MC dispatch signature AND its parent is dead/reparented AND it is older than ~20min AND
it holds no fresh concurrency lock AND it is not the reaper's own tree; any ambiguity ⇒ skip. It runs
report-only on session start and is surfaced in `/warp:health` §12.5.

**5. Named enforcer (per the policy-needs-an-enforcer rule).** `scripts/checks/no-dead-team-tools.js`
(wired into `/scan:full`) fails on any new LIVE call to the REMOVED team tools as a directive in the
active skill/hook/script layer (historical/descriptive mentions are exempt via marker), AND asserts the
POSITIVE — that the new `Agent(… run_in_background …)` remediation is actually present — so a future
edit can't trade one dead tool-name for another. Fail-closed on runner error; planted-violation test.

## Consequences

- The migration touched directives + one real logic fix (the cwd-scoping arm), validated empirically
  (the MC session team is now correctly recognized as live + ours; the dreamweaver/doogle sibling
  teams remain correctly foreign) and against the full S-LC-05 lifecycle suite (17/17, including the
  wrong-project-survives invariants) and the team-guard/session-start hook tests (no regression).
- Fail-open is preserved on every hook (the load-bearing invariant for code that runs every session).
- The orchestration doctrine (in-process subagents vs OS subprocesses, pull-don't-push/envelopes,
  nesting-5, turn-cost, implicit-team model) is documented in `agent-dispatch-guide.md` §9.5 + CLAUDE.md.

## Alternatives considered

- **Full gate-logic rewrite** — rejected: the harness still writes the members[] config, so the
  inspection logic is sound; only name-based scoping needed the cwd arm. A rewrite would be larger
  blast radius on session-critical hooks for no gain.
- **Auto-`--apply` the reaper on session start** — rejected: terminating processes silently on every
  session start is too aggressive for a privilege surface; report-only + a deliberate operator `--apply`
  (or `/warp:health`) is the safe default. The reaper's conservative gates make a false-kill unlikely,
  but defense-in-depth keeps the kill explicit.

## Known limitations (documented by design — β rider 3)

- **The reaper recognizes only `node <abs-wrapper>` invocations** (argv[0]=node, argv[1] = the
  canonical absolute path of `dispatch-claude.js`/`dispatch-agent.js`). A **directly-orphaned
  grandchild provider CLI** (a `claude`/`codex`/`gemini` process whose node wrapper already exited,
  leaving the CLI reparented on its own) is **out of scope by design** — it is reaped only when its
  wrapper is still present (the wrapper's process tree is taken down via `taskkill /T`). This is the
  deliberate conservative trade: a node invocation with ANY flag before the script, or a lone
  provider CLI, is NOT recognized — a missed orphan is cheap (it ages out / is caught next session),
  a false kill of a live process is expensive (lost uncommitted work). The signature was hardened
  across a multi-round security review to this `argv[1]`-must-be-the-wrapper rule precisely because
  every looser rule (telemetry-marker-in-argv, any-token-resolves, flag-skipping) was shown trickable.
- **The cross-provider gauntlet ran GPT-only** for this sprint — gemini is TIER-DEAD
  (`IneligibleTierError` → Antigravity migration), so the security 2nd-pass corpus-diversity leg was
  unavailable. Logged as cross-provider debt with a resumption trigger (re-run the gemini/Antigravity
  leg on the reaper once that provider is live). Acceptable here because the changes are dev-tooling
  (not product/security-critical runtime) and the reaper is report-only without `--apply`.

## Enforcement

- `scripts/checks/no-dead-team-tools.js` (`/scan:full`) — no new dead-tool directives + remediation present.
- `scripts/dispatch/reap-orphans.test.js` — 12 planted-fixture assertions proving every reaper safety gate.
- `tests/regression/S-LC-05/team-lifecycle.test.js` — the cwd-scoping change keeps the wrong-project-survives invariants green.
- The cross-provider (GPT + Gemini) gauntlet on every hook change (blast-sensitive — hooks run every session).
