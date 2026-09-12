# Provenance — Master Console, formerly WarpOS

> "I kept building these things months before the labs announced them. Nobody knew. Here are the receipts." — the founder, 2026-09-02

This page is the receipts. Every claim below is a commit in the public repository, checkable with two git commands, and every date is stated with what it rests on. The honest beat of the story is not that anyone took anything: **they didn't steal it, they shipped it louder.** A single-operator project got to several of these ideas first, quietly, in a public repo; the labs got to them later, with announcements. That is the whole claim.

Master Console is the name since 2026-09-02. The engine was built and released as **WarpOS** from March to July 2026 (the identifiers still say so until the `2.0.0` release; see the README's naming note). Everything below therefore names WarpOS where it names the artifact.

## What this page is, and is not

- **It is** a list of first-landed commits for capabilities that later appeared in Anthropic's or OpenAI's products, with the vendor date beside each. The comparison is against those two vendors because the engine runs on their tools. Wider-industry analogs are footnoted at the bottom, not argued.
- **It is not** a claim on the substrate. Claude Code hooks, subagents, slash commands and Agent Skills are Anthropic's; a WarpOS hook *is* a Claude Code hook. Nothing here claims priority on any of that, and the repository's history begins on 2026-03-02, after all of it.
- **The dates are git author dates** unless marked otherwise. Git dates are author-supplied and, with one exception, the commits are unsigned. Two dates are not author-supplied: the repository's GitHub creation timestamp (`2026-03-02T19:53:12Z`, from the GitHub API) and the GitHub-side object date of the tag `warpos@0.1.4` (`2026-05-02T03:07:12Z`; `2026-05-01 20:07 -07:00` local).
- **The framework arrived partly built.** Commit `cd37d410` (2026-04-12) is a wholesale extraction from an earlier private repository, and it landed with the sleep cycle, the cross-session inbox and the judgment model already complete. Their true dates are earlier and cannot be proven from this repository, so this page uses 2026-04-12 for all of them.
- The underlying analysis, with vendor sources and the cases that went the *other* way (most of them), is tracked at `runtime/prior-art/PRIOR-ART-EVIDENCE-2026-08-28.md` and `runtime/prior-art/SKILL-SWEEP-2026-08-28.md` (237 skills in 35 families; on the Anthropic + OpenAI axis 4 families are WarpOS-first, 17 vendor-first, the rest uncontested or inconclusive).

## The headline receipts

| # | What was built | Landed | Commit | The vendor's date |
|---|---|---|---|---|
| 1 | **Sleep / dream memory consolidation** — `/sleep:deep`, a six-phase cycle (NREM consolidation, cleanup, replay, REM dreaming, repair, growth) over the scored learnings store | 2026-04-12 spec · ran in production 2026-04-22 and 2026-04-25 (dated run scripts) · public tag `warpos@0.1.4` carried the spec 2026-05-02 UTC | `cd37d410` · tag `de9ba8eb` | Anthropic announced **Dreaming** (agent memory consolidation for Managed Agents) on **2026-05-06** at Code with Claude, San Francisco. 24 days after the commit; 4 days after the public tag |
| 2 | **Cross-session inbox** — `/session:write` and `/session:read`, a file-backed board so separate Claude Code sessions of the same assistant can leave each other messages | 2026-04-12 | `cd37d410` | Claude Code shipped cross-session `SendMessage` + `ListAgents` in **v2.1.224, 2026-08-07**. 117 days |
| 3 | **Registry-driven sprint lifecycle** — `/sprint:plan`, `/sprint:design`, `/sprint:execute`, `/sprint:release`, plan contracts, tickets, crash-safe progress | 2026-05-11 | `d460de4b` | Claude Code **Dynamic Workflows** (`agent()` / `parallel()` / `pipeline()`) announced **2026-05-28**; Codex multi-agent V2 **2026-07-21**. 17 and 71 days. Contestable — different layer, and the OpenAI Agents SDK's `handoffs` (2025-03) is arguably an ancestor |
| 4 | **Closed-loop artifact optimization** — `/karpathy:run`, optimize an agent spec or skill against a scalar metric in an isolated worktree, then `/karpathy:integrate` the winner | 2026-04-18 | `38d771bf` | Anthropic **Outcomes** for Managed Agents, **2026-05-06**. 18 days, on a loose analogy |
| 5 | **Cross-provider CLI dispatch** — GPT and Gemini as named peer reviewers of Claude-written code, through their own CLIs | 2026-04-16 | `29908188` | No vendor ships cross-vendor dispatch. Nearest motion: Claude Code fallback model chains (~2026-06), within one provider |
| 6 | **Paths registry** — one source of truth for project paths, generated views, a write-time guard hook | 2026-04-16 (generated view + guard) · 2026-05-03 (registry source) | `bb06646d` · `318971ff` | No vendor analog found |
| 7 | **Enforcement-debt ledger** — "every policy names its enforcer, or logs the gap"; the enforcement map in the extraction, the `/enforcement:*` skills a month later | 2026-04-12 · 2026-05-19 | `cd37d410` · `de8707e1` | No vendor analog found (`claude plugin eval` evaluates plugins, not unenforced policy) |

Items 1 and 2 are the clean ones. Item 3 should not be led with. Items 5–7 are uncontested largely because no vendor entered the category, which is a smaller thing than being first.

## The full receipts

Every row is a commit on the public `main`. "Reproduce" is the same two commands for each: `git log -1 <sha>` shows the date and message, `git show <sha> --stat` shows the files. Rows marked † have a post-rewrite SHA (see the disclosure below); the pre-rewrite SHA is in `runtime/open-source/rewrite/commit-map.txt`.

| Landed | Commit | What |
|---|---|---|
| 2026-03-19 | `c7db0a2b` | First hooks, skills and `CLAUDE.md` synced into this repository from the private predecessor |
| 2026-03-19 | `afd31592` | Shared slash commands including `/handoff` — the session-handoff line starts here |
| 2026-04-12 | `cd37d410` | **v0.1.0 extraction**: `/sleep:deep` and `/sleep:quick`, `/session:write` and `/session:read`, the β judgment face (`beta.md`) and `/beta:mine`, `/session:handoff`, the enforcement map, the learnings lifecycle |
| 2026-04-15 | `f504decf` | Repository restructure `framework/` → `.claude/`; `AGENTS.md` org model |
| 2026-04-15 | `25ce1750` | β judgment model |
| 2026-04-16 | `29908188` | **Cross-provider agent dispatch** — GPT for review, Gemini for security, as peer roles |
| 2026-04-16 | `bb06646d` | **Paths registry** `paths.json` v3 + `path-guard` hook; events ledger |
| 2026-04-16 | `e0f25200` | `/beta:integrate` (the judge refines itself from the operator's own decisions); team guard; twelve new hooks |
| 2026-04-16 | `d39661a8` | `/check:all` — one command running every system check in parallel (today `/scan:full`) |
| 2026-04-17 | `e44b78ad` | `/warp:setup` and `/warp:uninstall` — the framework as an installable, versioned distribution |
| 2026-04-18 | `38d771bf` | **Karpathy autoresearch loop** — `run`, `integrate`, `status` |
| 2026-04-18 | `db6292e2` | A README edit made on GitHub — the one **GitHub-signed** commit in the pre-rewrite range (its `gpgsig` header is intact; see the anchor section) |
| 2026-05-01 | `6779f6e6` | Decision policy, the ops-analyst ("learner") role, scope-contract guard, the mode-entry posture banner |
| 2026-05-01 | `de9ba8eb` | **Tag `warpos@0.1.4`** — the public pre-announcement artifact for the sleep cycle (GitHub-side date 2026-05-02T03:07:12Z) |
| 2026-05-03 | `318971ff` | `framework/paths.registry.json` — the registry **source**, with generated views |
| 2026-05-11 | `b3a5ab06` | Dispatch-route guard — blocks raw provider CLI calls and API-when-CLI from the Bash tool |
| 2026-05-11 | `d460de4b` | **Sprint Workflow v0.1** — plan / design / execute / release |
| 2026-05-12 | `e37620d3` | `/sleep:deep` outputs committed — the dream journal, proof the cycle ran (post-dates the announcement; supporting only) |
| 2026-05-12 | `92c0cece` | Multi-sprint parallelism (Sprint Workflow v0.2) |
| 2026-05-13 | `b1547463` † | `/session:turbo` — session-scoped permission pre-authorization with a spend ceiling |
| 2026-05-18 | `f3cedda8` † | `/session:dump` → `DUMP.md`, the prescriptive next-session brief with verbatim payloads and anti-instructions |
| 2026-05-18 | `96da9aae` † | `/sprint:full` — the autonomous sprint orchestrator |
| 2026-05-19 | `de8707e1` † | `/enforcement:log` and `/enforcement:list` |
| 2026-05-26 | `d0363daa` † | Evidence-bound completion + `gauntlet-verify` (a claimed build must show real bytes); `/warp:flag` and `/warp:reconcile` |
| 2026-05-30 | `d02e310b` † | Ingest firewall — external content is data, never instructions; fail-closed audit |
| 2026-06-01 | `7d97f34a` † | Model router / dispatch console — role → provider → model → effort |
| 2026-06-01 | `d6a7c07d` † | `/session:end` — the cognitive-chain session wrap (learn / mine / sleep → integrate → validate → handoff → land) |
| 2026-06-02 | `6a46719a` † | Bounded Claude-dispatch wrapper — a silently reaped builder becomes a loud death record |
| 2026-06-03 | `2dfbf75a` † | `role-registry.json` keystone (ADR-0007) — one registry for role, model, authority, route |
| 2026-06-05 | `cab32175` † | Enforced tracker system — `TRACKER.md` + a 20-check fail-closed validator, hook-enforced |
| 2026-06-05 | `73cc5d21` † | ε sprint runtime — the registry-driven lifecycle engine (ADR-0009) |
| 2026-06-05 | `13b1e0b1` † | Evidence-bound in-process dispatch records for the agent roster |
| 2026-06-07 | `560434ce` † | Dispatch-contract keystone + safety kernel |
| 2026-06-08 | `e4d00a87` † | `handoff-live.js` — git-ground-truth handoff safety net |
| 2026-06-10 | `1b70dec6` † | `/session:resume` made active — load the brief, reconcile against the tracker, re-establish the team, execute the next action. The session-recovery loop closes here |
| 2026-06-16 | `408d0bbb` † | `tracker-reality-drift` — the "claimed missing but exists" enforcer |
| 2026-06-19 | `1578d527` † | Migration off the removed harness team primitives; orphan-process reaper |
| 2026-07-20 | `2c29ffd9` † | Controller fence + conductor lease on the protected branch (every write to `main` goes through a broker) |
| 2026-07-21 | `ec6b2042` † | Broker merge |
| 2026-07-25 | `6802a5c3` † | `/memory:verify` — verify the harness's auto-memory against code, disk, git and the tracker |
| 2026-07-28 | `3719ad4d` † | `/enforcement:sweep` — find unfiled enforcement debt (deferral comments, suppressions, skipped tests) and reconcile it to the ledger |

Everything from 2026-06 onward is composition and enforcement of ideas that exist elsewhere — fencing tokens, leases, heartbeat reapers, mutation-style gauntlet evidence, preregistered release rules. It is listed because it is what the engine *is*, not as a priority claim. The defensible originality claim is compositional: no single system combines the department org of named faces, cross-provider dispatch, a sleep cycle, an enforcement-debt ledger, a paths registry and validator-enforced trackers in one self-modifying framework.

## Reproduce

```bash
git clone https://github.com/cygaco/WarpOS.git && cd WarpOS     # repo will be renamed; GitHub redirects

# Any row above
git log -1 cd37d410
git show cd37d410 --stat

# The sleep spec as it stood on 2026-04-12, and the proof it was in the public tag
git show cd37d410:framework/commands/sleep/deep.md
git ls-tree -r --name-only warpos@0.1.4 | grep -i sleep
git rev-parse warpos@0.1.4^{commit}          # de9ba8ebdfd286a4fbf50113b379fce2f3c99899

# The cross-session inbox in the same commit
git show cd37d410 --stat -- '*session/write.md' '*session/read.md'

# GitHub-side (not author-supplied) dates
gh api repos/cygaco/WarpOS --jq '{created:.created_at}'
gh api repos/cygaco/WarpOS/git/ref/tags/warpos@0.1.4
```

## Disclosure: the 2026-09-03 history rewrite

The repository has been public since 2026-03-02. On **2026-09-03** its history was rewritten once, deliberately and narrowly, before the rebrand, with `git filter-repo`:

- **Removed:** 20 string rules — seven verbatim quotes from the operator's prompts (they carried profanity into a judgment-model file) and one personal e-mail address — replaced in every commit that carried them.
- **Purged:** nine paths — a paid third-party course corpus, two files marked confidential, one raw AI-session transcript, and three private planning documents — removed from every commit.
- **Range-limited:** the rewrite excluded everything reachable from tag `warpos@0.1.4`. Every commit up to and including `de9ba8eb` (2026-05-01) is byte-identical, which includes every headline receipt above and the GitHub-signed commit `db6292e2`. The first rewritten commits are dated 2026-05-13; 1,905 commits before, 1,905 after, 1,774 with new SHAs, the graph shape unchanged.
- **Before the rewrite,** a private mirror of the untouched history was taken on the operator's GitHub account (it stays private — it is where the removed strings live), and a public GitHub Release named `pre-cleanup-snapshot` was created on the pre-rewrite HEAD so that GitHub's own clock stamped the chain. That release was deleted after the rewritten history was verified from a fresh public clone; the captured release JSON is the timestamp record.
- **Residual, stated plainly:** one mild colloquial line sits inside one pre-tag blob (a β profile file first committed 2026-05-01, six hours before the tag). It cannot be changed without changing the tag SHA, so it stays. Everything the rewrite targeted is gone from every commit.

Anyone who cloned before 2026-09-03 should re-clone; `git pull` would merge the old history into the new. The notice for downstream installs is `runtime/open-source/rewrite/DOWNSTREAM-NOTICE.md`.

### The anchor

Tag `warpos@0.1.4` → commit `de9ba8eb`, dated 2026-05-01 20:07 -07:00 by git and 2026-05-02T03:07:12Z by GitHub's tag object. Its tree contains `.claude/commands/sleep/deep.md` and `.claude/commands/session/write.md`. Commit `db6292e2` (2026-04-18, a README edit made in the GitHub web UI) is an ancestor of the tag commit and carries GitHub's signature; a re-imported commit would have lost that header, so its presence is the cheapest proof that the range up to the tag was not touched. The repository creation timestamp (`2026-03-02T19:53:12Z`) bounds everything from below and is not author-supplied.

### Reproduce the verification

Tracked under `runtime/open-source/rewrite/` (the committed copies redact one private product slug from two filenames; the rule literals are digests, not text, by design):

- `DRY-RUN-REPORT.md` — the exact change set, the numbers above, and the residual (§3)
- `assert-evidence-public-clone.txt` — the assertion run on a fresh public clone after the force-push: the four headline commits and the tag commit exist and are ancestors of `main`, `db6292e2` still carries `gpgsig`, the string sweep is 0 for 19 of 20 rules
- `commit-map.txt` (old → new for every rewritten commit), `ref-map.txt`, `first-changed-commits.txt`, `removed-paths.txt`, `rule-digests.txt`, `diffstat-main.txt`
- `scripts/open-source/assert-evidence.js` — the assertion itself; run it against any clone

And under `runtime/open-source/anchor/`: the captured GitHub JSON for the release, the tag refs and the mirror repository, as they were on 2026-09-02.

---

### Footnotes: earlier analogs elsewhere

Stated once, neutrally, so nobody has to discover them for you.

1. **Sleep-time memory consolidation.** Letta published "sleep-time compute" — a background agent that reorganizes another agent's memory during idle time — on 2025-04-21 (Letta 0.7.0; paper arXiv:2504.13171). Its predecessor MemGPT dates to October 2023. The WarpOS claim is therefore *before Anthropic*, not before the industry.
2. **Structured multi-agent workflows.** Google ADK workflow agents (Sequential / Parallel / Loop, 2025-04), CrewAI Flows (2024) and LangGraph (2024) all predate the sprint lifecycle.
3. **Closed-loop self-optimization.** Sakana's AI Scientist (2024-08), DeepMind's AlphaEvolve (2025-05) and DSPy optimizers predate the autoresearch loop by a year or more.
4. **Cross-session messaging.** No earlier session-to-session board was found in the coding-agent space; LangChain's Agent Inbox (2025-01) is a human-approval inbox and A2A (2025-04) is inter-vendor RPC — related, not the same thing.
5. **Multi-provider routing.** OpenRouter and LiteLLM (2023) routed across providers long before `dispatch-agent.js`; what has no analog is routing rival vendors as *named reviewer roles* of each other's code.
6. **Named-role agent companies.** MetaGPT (2023-08), AutoGen (2023-09) and CrewAI (2023) encoded PM / architect / engineer / QA roles first. The org-chart idea is theirs; the enforcement of it — fixed rosters, binding verdicts, evidence-bound liveness, parity scans — has no vendor equivalent found.
