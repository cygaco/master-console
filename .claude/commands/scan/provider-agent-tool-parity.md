---
description: The carve-out enforcer — a `provider != claude` role must NOT carry Agent-tool reachability (tools:["Agent"] in the registry or its spec frontmatter), because the harness Agent tool is Claude-only. Report-only in /scan:full.
---

# /scan:provider-agent-tool-parity — GPT-pin ↔ Agent-tool collision guard

The harness `Agent` tool is **Claude-only**: an in-process Agent-tool spawn runs a Claude subagent.
So a role pinned to a non-Claude provider (openai/antigravity/gemini) **cannot** be summoned
in-process via the Agent tool.
Therefore a `provider != claude` role must **not** carry Agent-tool
reachability (`tools: ["Agent"]` in the role-registry OR its spec frontmatter). Such a role either
(a) stays Claude-pinned to keep its Agent fan-out, or (b) is reached ONLY via a CLI subprocess and
drops `tools:["Agent"]` (its fan-out becomes CLI sub-prompts, or is delegated to a Claude lead that
DOES carry Agent).

The Claude carve-out is legitimate and NOT flagged: `quality-lead` (claude + Agent — its fan-out IS
the QA absorb layer) and `design-quality`/`visual-review` (claude_pinned visual judges).

## What it does

Runs `node scripts/checks/provider-agent-tool-parity.js` (`--json` for machine output). Reads
`.claude/agents/_org/role-registry.json` and each role's spec frontmatter `tools:`. REJECTS (exit 1)
when a `provider != claude` role carries Agent-tool reachability from EITHER source. **Fail-closed**
(exit 2) on an unreadable/unparseable registry. **Wired REPORT-ONLY** in `/scan:full` — it surfaces
the contradiction so it cannot ship silently.

Bite-test: `node scripts/checks/provider-agent-tool-parity.test.js` (planted violations for
registry-source + spec-source + antigravity, the Claude carve-out passes, and a live-registry pass).

## When to run

After any edit to role providers or a role's `tools:` (registry or spec frontmatter), and as part of
`/scan:full`.
