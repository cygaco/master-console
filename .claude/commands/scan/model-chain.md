---
description: The named enforcer for the role-registry model/effort CHAIN. Report-only in /scan:full.
---

# /scan:model-chain — Role-registry model/effort chain integrity

The model-chain HOME (**ADR-0016**): it
accepts the **old∪new SUPERSET** so both the current opus roster AND a future fable-top roster pass,
while keeping every tooth.
A silent registry↔consumer drift would still run a role on the wrong model — the drift
detector is unchanged.

This is **not** a duplicate of `/scan:role-parity` (which owns registry-INTERNAL consistency:
model-in-catalog, dispatch-graph, reporting-line, spec model-pin). model-chain adds what role-parity
does not cover.

## What it does

Runs `node scripts/checks/model-chain.js` (`--json` for machine output). Reads
`.claude/agents/_org/role-registry.json` (the SoT) and the live consumer maps via `require()`
(`scripts/dispatch/catalog.js` `DEFAULT_PROVIDER_PER_ROLE`/`DEFAULT_EFFORT_PER_ROLE` +
`scripts/hooks/lib/providers.js` `DEFAULT_AGENT_PROVIDERS`/`getReasoningEffort`). REJECTS (exit 1)
when ANY:

1. **no-fable** — any role's `model`/`second_pass.model` or `model_policy.*.model` references a
   fable model. (Scans MODEL fields ONLY, never prose — a `_doc`/`_note` mentioning fable to reject
   it does not trip the rule.)
2. **alpha positive-pin** — `alpha.model` ≠ `claude-opus-4-8` or `alpha.effort` ≠ `max` (role-parity
   only checks the negative "max only on alpha"; a downgraded alpha would pass silently otherwise).
3. **top-model** — `model_policy.doers.model` ≠ the shipped top.
4. **completeness / validity** — a role missing `model`, missing an `effort` key, or carrying an
   invalid effort level. `effort:null` is allowed only for `skeleton-builder`, `security_claude_hunter`
   (the in-process claude hunter — effort carried by `security-reviewer.third_pass`), and `antigravity`
   (agy) roles.
5. **max-only-alpha** — any non-alpha role at `max` (positive policy home; mirrors role-parity for a
   CRITICAL invariant).
6. **[DRIFT]** — catalog/providers resolve a role to a DIFFERENT provider or effort than the
   registry declares (the live drift detector — catches stale `DEFAULT_REASONING_EFFORT` literals).

**Fail-closed** (exit 2) on an unreadable/unparseable registry or internal error — a chain check
must never read green on its own corruption. **Wired REPORT-ONLY** in `/scan:full` (it surfaces
findings alongside `/scan:role-parity`; the flip-to-blocking is the ramp tail once the chain has
held drift-free).

Bite-test: `node scripts/checks/model-chain.test.js` (planted-violation assertions incl. the
no-fable false-positive guard + a live-registry integration pass).

## Legacy-Gemini-CLI creep-back gate (ADR-0031, extends this scan)

Also runs `node scripts/checks/no-legacy-gemini-cli.js` — the wiring-precise gate that REJECTS
(exit 1) any re-introduction of the SUNSET individual `gemini` CLI: a `gemini:` provider block /
`cli:"gemini"`, `GEMINI_API_KEY`/`GOOGLE_API_KEY` injection, `GEMINI_CLI_TRUST*`/`--skip-trust`, the
removed key/oauth loaders, a bare quoted provider/tool id `"gemini"` (role→`"gemini"`,
`provider==="gemini"`, a `"gemini"` TOOL_ID, a panel pass→`"gemini"`), or a `gemini <flag>` CLI call.
It does NOT flag the KEPT partition — `gemini-3.1-pro-*` MODEL ids served via `agy`, `antigravity`/`agy`
wiring, `ANTIGRAVITY_MODEL`. The sanctioned Gemini DEEP-RESEARCH API path (`scripts/research/deep-run.js`,
`gemini-deep-research.js`, `auth-resolver.js`) is excluded (a no-CLI-equivalent capability, not the CLI).
Bite-test: `node scripts/checks/no-legacy-gemini-cli.test.js` (a negative fixture per removed form +
a positive gemini-model-via-agy fixture — the no-widen/no-narrow proof).

## When to run

After any edit to `role-registry.json` model/effort fields, `catalog.js`/`providers.js` role maps,
a model-catalog refresh, or any dispatch provider wiring. Part of `/scan:full`.
