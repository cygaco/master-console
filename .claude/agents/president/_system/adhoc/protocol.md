# Adhoc Build Protocol

Lightweight gauntlet loop for building individual features or tasks outside of full skeleton runs. No state machine, no cycles, no heartbeat management.

## When to use

Alpha dispatches gamma in adhoc mode for:
- Single feature builds during development
- Bug fix gauntlet runs
- Any builder -> reviewer -> fix loop that doesn't need the full oneshot orchestration

## Protocol

> ### ⚠ CANONICAL DISPATCH — NO EXCEPTIONS
>
> **All build-chain roles** (the ADR-0007 roster: `*-builder`, `*-fixer`, the pod reviewers `frontend-reviewer`/`backend-reviewer`, `qa-reviewer`, `security-reviewer`) **MUST** be dispatched via Bash subprocess — **`node scripts/dispatch-claude.js <role>` for Claude-routed BUILD roles** (`*-builder`/`*-fixer`/`stub-scaffold`: the bounded wrapper; raw `claude -p --agent <build-role>` silently REAPS and is blocked by the dispatch-route-guard hook), `claude -p --agent <role>` for the non-build Claude fallback (qa-reviewer/security-reviewer/etc.), and `node scripts/dispatch-agent.js <role>` for OpenAI/Gemini-routed. **Do NOT use the in-process `Agent` tool** for any of these roles, even when running locally as Claude. The `Agent` tool returns the full agent response into the orchestrator conversation; Bash dispatch captures stdout and parses only the JSON envelope. See `.claude/agents/president/gamma.md` Dispatch Method for the full reference pattern.

### 1. Dispatch builder(s)

Gamma dispatches Layer 2 agents via Bash subprocess (the Agent tool is not available to teammates). Build roles go through the bounded wrapper:

```bash
# build-chain Claude role (builder/fixer/*-builder/stub-scaffold) — bounded, recorded:
node scripts/dispatch-claude.js <build-role> <prompt-file> --model sonnet -w
# non-build Claude role (test-runner/visual-review) — raw fallback is allowed:
claude -p --model sonnet --agent <agent-name> "prompt"
```

Available agents (ADR-0007 roster, under `.claude/agents/engineering/` + `product/quality/`): `frontend-builder`/`backend-builder`/`security-builder`, the pod reviewers `frontend-reviewer`/`backend-reviewer`, `qa-reviewer` (absorbs the legacy qa+compliance+req-reviewer), `security-reviewer` (replaces redteam), and the pod fixers `frontend-fixer`/`backend-fixer`/`security-fixer`. Note: `learner` is oneshot-only — adhoc has no learner in the gauntlet (the learner runs cross-cycle pattern analysis, which only oneshot has cycles for).

- One builder per feature. Sequential dispatches (CLI is blocking).
- Pass the feature spec (PRD + stories) and the adhoc prompt template.

### 1.5 Integration phase (multi-builder features only)

When a feature was built by **more than one builder** (e.g. `frontend-builder` +
`backend-builder`), Gamma runs an explicit **integration phase** AFTER the builders
return and BEFORE the gauntlet — it OWNS the FE↔BE seam (shared files, generated types,
env/data contracts, an end-to-end smoke test, and FE/BE merge order/conflict policy). The
producer (backend) defines the shape; the consumer (frontend) adapts (`own-the-integration-seam`).
Gamma writes a per-run integration manifest to `runtime/integration/<feature>/manifest.json`
and runs the **reject-not-lint** acceptance gate:

```bash
node scripts/checks/integration-seam-gate.js runtime/integration/<feature>/manifest.json
```

exit 0 = seam governed (or single-builder N/A) → proceed to the gauntlet; exit 1 = blocking
defect (treat like a reviewer fail: fix brief → builder/fixer, max 3, re-run); exit 2 =
fail-closed error → HALT. In oneshot (no α/β) an unresolved conflict is parked via
`scripts/arbitration/emit.js` (owner `gamma_integration`) and the run-end resolver blocks
ship-ready. Full detail: `.claude/agents/president/gamma.md` → "Integration phase".
Single-builder features skip this step.

### 2. Run gauntlet

After the builder(s) complete, derive the review roster from the registry
(`org-roles.expectedGauntletRoles(pods)` — pod code-reviewers for the pods that
built + qa-reviewer + security-reviewer; NEVER a hardcoded role list) and dispatch
each reviewer via CLI:
- **frontend-reviewer / backend-reviewer** — code-quality only (Check-7 7A-7G + holdout-fixture). One per pod that built; a FE-only feature runs only frontend-reviewer.
- **qa-reviewer** — ABSORBS the legacy qa + compliance + req-reviewer scopes: the 13 functional QA personas + integrity (COPY.md exact-match, hallucinated-dep) + traceability (behavior↔req↔code↔test, contract-propagation, risk-class agreement). Skipped only if `_requirements/_index/requirements.graph.json` is missing (older installs) drops the traceability lane.
- **security-reviewer** — REPLACES redteam: OWASP Top 10 + adversarial patterns + attack-chain correlator + prompt-injection prober (gemini corpus-diverse + the internal 2nd-GPT pass).

Dispatch sequentially (CLI `-p` is blocking). Collect ALL results before proceeding. If `qa-reviewer` returns `fail` with severity `error` finding category `risk_class_disagreement` or `contract_propagation_missed`, treat as a blocking finding regardless of the other reviewers' verdicts (the absorbed req-reviewer BLOCKING rule).

### 3. Fix cycle (if needed)

If any gauntlet reviewer reports failures:
1. Merge all findings into a single fix brief
2. Dispatch the pod fixer via the bounded wrapper (fixers are build-chain): `node scripts/dispatch-claude.js <pod>-fixer <fix-brief-file> --model sonnet -w` (e.g. `frontend-fixer`/`backend-fixer`/`security-fixer` — match the pod whose reviewer failed)
3. Max 3 fix attempts per feature
4. After each fix: targeted re-review (only re-check what failed — the same pod reviewer RE-RUNS)

> **Independence invariant (ADR-0007): the dispatcher CANNOT override a binding FAIL.**
> If a reviewer's verdict is `fail` and fix attempts are exhausted, the run is reported
> `status: "fail"`/`"halted"` and the feature is NOT placed in `features_completed` — a
> dispatcher may never flip a binding FAIL to a declared success. Enforced by
> `scripts/checks/adhoc-fail-override.js` (`/scan:adhoc-fail-override`), which reads the
> GAMMA_RESULT verdict CONTENT and rejects a FAIL-coexists-with-success result (the
> verdict-value blind spot `gauntlet-verify.js`'s record-presence check leaves open).

### 4. Report

Return structured GAMMA_RESULT to caller:

```
GAMMA_RESULT:
  scope: "<feature-name or task>"
  mode: "adhoc"
  status: "pass" | "fail" | "halted"
  features_completed: [...]
  features_failed:
    - name: "<feature>"
      reason: "<why>"
      fix_attempts: <N>
  gate_checks:                                 # ADR-0007 roster (one key per dispatched reviewer)
    - feature: "<name>"
      frontend_reviewer: "pass" | "fail" | "skipped"   # skipped when no FE pod built
      backend_reviewer: "pass" | "fail" | "skipped"    # skipped when no BE pod built
      qa_reviewer: "pass" | "fail"             # absorbs qa/compliance/req-reviewer
      security_reviewer: "pass" | "fail"       # replaces redteam
  human_report:
    verdict: "<pass/fail/halted in one sentence>"
    what_changed: ["<material change>"]
    why: "<why this work mattered>"
    risks_remaining: ["<known residual risk or none>"]
    what_was_rejected: ["<out-of-scope or rejected change>"]
    what_was_tested: ["<gate/test/review>"]
    needs_human_decision: ["<decision or none>"]
    recommended_next_action: "<one next action>"
  halt_reason: "<if halted>"
  next_recommendation: "<what gamma thinks should happen next>"
```

## What adhoc does NOT do

- No store.json state machine updates
- No cycle counting or heartbeat management
- No points/XP/rank calculation
- No lead agent analysis (unless caller requests)
- No pre-flight skeleton verification
- No phase sequencing — caller decides what to build
