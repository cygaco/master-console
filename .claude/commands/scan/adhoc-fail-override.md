---
description: Reject an adhoc dispatcher that overrode a binding reviewer FAIL — verdict-content check (the blind spot gauntlet-verify's presence-only check leaves open)
---

# /scan:adhoc-fail-override

Enforces the load-bearing **independence invariant** from ADR-0007: *"the Lead/dispatcher **cannot override a FAIL**."*

## The blind spot it closes

`scripts/dispatch/gauntlet-verify.js` is a strong enforcer — but it only checks that each reviewer's **completion RECORD is PRESENT and well-formed** (`role` / `provider` / `ok:true` / parseable timestamp). It **never reads the reviewer's verdict VALUE**. So a dispatcher can:

- record `ok:true` completions for every reviewer (gauntlet-verify reads green), **while**
- one reviewer's INNER verdict was `FAIL` / critical / high, **yet**
- declare the adhoc run `status: "pass"` and list the feature in `features_completed`.

That is a dispatcher overriding a binding FAIL, and nothing detects it. This check reads the **verdict content** and rejects that override. It deliberately does **not** reuse `gauntlet-verify` (presence ≠ verdict).

## What it checks

Input is the adhoc **GAMMA_RESULT** (schema at `.claude/agents/president/gamma.md` ~lines 374-401), supplied via `--result <gamma-result.json>`:

```yaml
status: "pass" | "fail" | "halted"
features_completed: ["<feature>"]
gate_checks:
  - feature: "<name>"
    frontend_reviewer: "pass" | "fail" | "skipped"
    backend_reviewer:  "pass" | "fail" | "skipped"
    qa_reviewer:       "pass" | "fail"
    security_reviewer: "pass" | "fail"
```

Optionally, per-role reviewer output JSONs under `.claude/runtime/dispatch/` (or `--reviewers <dir>`) are ALSO scanned for an inner verdict of `FAIL` / critical / high (a **summary-vs-detail** override: the reviewer said fail even though the dispatcher's `gate_checks` summary said pass).

**REJECT (exit 1)** when ANY binding FAIL coexists with a declared success:
- any `gate_check` reviewer verdict `== "fail"`, OR any reviewer JSON inner verdict is `FAIL`/critical/high, **AND**
- the declared top-level `status == "pass"` OR the feature appears in `features_completed`.

An **honest** run — a FAIL with `status: "fail"`/`"halted"` and the feature NOT in `features_completed` — **passes** (the dispatcher did not override; it reported the failure truthfully).

## Graceful empty / fail-closed

- **Graceful exit 0** when there is no adhoc run to check: no `--result` supplied and no failing reviewer output present. A scan with nothing to audit is a clean pass.
- **Fail-closed exit 2** on a malformed/unreadable result (or a `--result` path that does not exist) — a result we were told to read but cannot parse must never read green.

## Invocation

```bash
node scripts/checks/adhoc-fail-override.js [--result <gamma-result.json>] [--reviewers <dir>] [--json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--result <file>` | none | The adhoc GAMMA_RESULT JSON to audit |
| `--reviewers <dir>` | `.claude/runtime/dispatch` | Dir of per-role reviewer output JSONs to scan for inner FAIL |
| `--json` | off | Emit machine-readable JSON |

**Exit codes:** `0` = no override (or nothing to audit); `1` = override detected (REJECT); `2` = malformed/unreadable result (fail-closed).

## JSON output shape

```json
{
  "ok": false,
  "check": "adhoc-fail-override",
  "result": "REJECT",
  "checked": 1,
  "errors": [
    "override: feature \"feat-x\" has FAILING reviewer(s) [qa_reviewer] yet top-level status == \"pass\" — a dispatcher cannot override a binding FAIL (ADR-0007 independence invariant)"
  ]
}
```

## See also

- ADR-0007 (agent-system org rewrite; see `.claude/agents/president/_system/policy/adr/INDEX.md`) — the independence invariant this enforces
- `.claude/agents/president/gamma.md` — the GAMMA_RESULT `gate_checks` schema + fix-cycle this audits
- `.claude/agents/president/_system/adhoc/protocol.md` — the adhoc gauntlet + fix cycle
- `scripts/dispatch/gauntlet-verify.js` — the presence-only enforcer whose verdict-content blind spot this complements (NOT reused)
- `scripts/checks/test-adhoc-fail-override.js` — bite-test (run `node scripts/checks/test-adhoc-fail-override.js`)
