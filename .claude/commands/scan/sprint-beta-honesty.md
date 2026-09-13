---
description: Audits Beta consultation honesty across post-cutoff /sprint:full runs (missing consults, placeholder verdicts, ESCALATE-without-halt)
---

# /scan:sprint-beta-honesty

Audits the Beta consultation cadence enforced by `/sprint:full` (SP-20260525-003). For every post-cutoff sprint that ran at least one `/sprint:full` phase, the check verifies that each expected phase boundary has a real `sprint_full_beta_consult` event — not a placeholder — and that every `ESCALATE` verdict was followed by a halt.

## What it detects

Seven finding types, each with shape `{ sprint_id, phase, expected_consult, actual_event, verdict, evidence, finding_type, fingerprint }` (the `fingerprint` keys the ED-049 waiver ledger — see Triage / waivers below):

1. **`missing_consult`** — a phase boundary was reached (`sprint_full_phase_started` for that phase) but no `sprint_full_beta_consult` event was recorded for the sprint + boundary. The four expected boundaries are `before_design`, `before_execute`, `before_release-prep`, `before_retro` (corresponding to transitions into phases 2–5). `before_plan` is not a check boundary.

2. **`placeholder_verdict`** — a consult event exists but is considered fake:
   - Kind is `sprint_full_beta_consultation` (the pre-SP-003 placeholder name), **or**
   - Kind is `sprint_full_beta_consult` but `beta_message` is empty/missing, `latency_ms` is null/undefined, or `model` is empty/missing. Note: `latency_ms = 0` is valid (CLI resume has no live round-trip; it is not a placeholder signal).

3. **`escalate_without_halt`** — a `sprint_full_beta_consult` with `verdict: "ESCALATE"` has no corresponding `sprint_full_halt` with `halt_reason: "beta_escalate"` for the same sprint at/after the consult timestamp.

**Canned / non-substantive verdicts (P-AP-1).** `placeholder_verdict` catches *absent* messages; these catch present-but-*non-substantive* ones (β's `/sprint:full` verdicts historically collapsed to ~3 hardcoded strings). The contract: a substantive verdict is **≥40 chars AND structured** — a decision token (`DECIDE`/`DIRECTIVE`/`ESCALATE`/`CLASS`/`confidence`/`0.xx`) **OR** a grounding reference (a ticket/sprint/precedent id or a reasoning connective like `because`/`per`/`rubric`/`reversible`/`blast-radius`). The lenient **OR** (flag only when *both* are absent) keeps the runtime false-positive rate low; real verdicts carry both. The **runtime** guard enforces only these per-message checks (C1/C2); the cross-boundary/cross-sprint duplicate checks (C3/C4) are **audit-only** (each `/sprint:full` resume is a fresh process with no prior-consult history). This is a **deterministic string/structure check — no model judgment**, so β cannot be prompted past it (the self-reference trap). Synthetic/test sprints (prefix `SP-J`) are exempt from the audit; the runtime guard in `scripts/sprint/full.js` (`maybeConsultBeta`) enforces the same contract **fail-closed at the boundary** (halt `beta_message_non_substantive`, kill switch `MC_BETA_SUBSTANCE_GATE=off`).

4. **`canned_too_short`** (C1) — trimmed `beta_message` is `< 40` chars.

5. **`canned_unstructured`** (C2) — `beta_message` has **neither** a decision token **nor** a grounding reference (long but bare boilerplate).

6. **`canned_cross_boundary_dup`** (C3) — the same normalized `beta_message` is reused at **≥2 distinct phase boundaries** within one sprint (the strongest "collapsed to N strings" signal).

7. **`canned_cross_sprint_template`** (C4) — the same normalized `beta_message` appears across **≥3 distinct** applicable, non-synthetic sprints (a propagating boilerplate template).

## Date-cutoff (legacy exempt)

Sprints whose start date is **before `2026-05-25`** (the SP-003 ship date) are **exempt**. Their events predate the enforcement mechanism and flagging them would be false positives. Override the cutoff with `--since <ISO-date>`.

If a sprint's start date cannot be determined from `paths.sprintSprints/<id>/current.yaml` or `paths.sprintActiveRegistry`, the sprint is **exempted** (fail-safe: prefer not-false-flagging over over-reporting).

## Graceful empty

If no applicable (post-cutoff, dated) sprints with `/sprint:full` activity exist — which is the expected state until the first real `/sprint:full` run occurs after the cutoff — the check exits `0` with an informational message:

```
OK   [sprint-beta-honesty] no applicable sprints in window (cutoff <date>) — nothing to audit
```

An empty events file, a missing full-reports directory, or a dataset containing only legacy sprints all produce this clean outcome.

## Invocation

```bash
node scripts/checks/sprint-beta-honesty.js [--json] [--since <ISO-date>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | off | Emit machine-readable JSON instead of human text |
| `--since <ISO-date>` | `2026-05-25` | Override the legacy-exempt cutoff date |
| `--no-waivers` | off | Audit the RAW findings, ignoring the ED-049 waiver ledger (used by the triage tool to enumerate everything before waiving) |

**Exit codes:** `0` = clean (no findings or no applicable sprints); `1` = one or more findings.

## Triage / waivers (ED-049)

Historical β-consultation records are **immutable** — once a sprint recorded a canned/short verdict, that finding exists forever. Without a triage path, the first such finding past the cutoff hard-blocks **every** future release (the only escape being the emergencies-only `--skip-beta-honesty-check`), so the gate decays into ritual bypass.

The fix is a precise, auditable **waiver ledger** (`paths.betaHonestyWaivers` → `.claude/project/memory/beta-honesty-waivers.jsonl`). Each line waives **one** finding by a stable **fingerprint** + a `reason` + an `approver`. The audit drops waived findings, so release-build blocks only on **NEW** (un-waived) findings — a genuinely-new canned verdict has no matching waiver and still hard-blocks.

**Fingerprint stability.** The fingerprint hashes **immutable record fields only** — `sha256(sprint_id | finding_type | phase_boundary | normalizeMessage(raw beta_message) | actual_event)` — never the checker-*rendered* `evidence` string. The rendered evidence embeds corpus-derived counts (`across N sprints`) and threshold literals (`< 40`) that move when the corpus grows or thresholds retune; hashing those would silently un-match a waiver and re-block the finding. (β HOW-fix, DECIDE B 0.88, 2026-06-12.)

**Fail-closed.** A waiver missing `fingerprint`/`reason`/`approver`, or a corrupt JSONL line, is **ignored** — the finding still blocks (malformed → fail-closed, never fail-open). The per-line parse never throws; a bad line drops only that waiver. The `waived` count is reported in `--json` so an audit can see the gate is doing something (an invisible waiver count is its own false-green).

```bash
# Inspect: every finding the gate sees, with its fingerprint + waived/blocking status
node scripts/checks/beta-honesty-triage.js list [--since <ISO>] [--json]

# Waive (requires an approver + reason; --all needs a --expect count guard)
node scripts/checks/beta-honesty-triage.js waive --reason "<why>" --approver "<who>" \
     ( --sprint <SP-id> | --fingerprint <hex> | --all --expect <N> ) [--batch <id>] [--dry-run]
```

## JSON output shape

```json
{
  "ok": false,
  "applicable": 2,
  "checked": 2,
  "findings": [
    {
      "sprint_id": "SP-...",
      "phase": "design",
      "expected_consult": "before_design",
      "actual_event": null,
      "verdict": null,
      "evidence": "phase 'design' started but no sprint_full_beta_consult recorded for boundary 'before_design'",
      "finding_type": "missing_consult"
    }
  ],
  "totalFindings": 1,
  "cutoff": "2026-05-25",
  "undatedExempt": 0,
  "malformedLines": 0,
  "waived": 0
}
```

## See also

- `_docs/sprint/AUTONOMY.md` — preset configuration for halt/approval behaviour in `/sprint:full`
- SP-20260525-003 — ships the halt-at-boundary enforcement mechanism (`sprint_full_beta_consult` + `sprint_full_halt`)
- SP-20260525-004 / T-20260525-214 — this check (engine + skill + tests)
- `scripts/checks/test-sprint-beta-honesty.js` — fixture-driven tests (run `node scripts/checks/test-sprint-beta-honesty.js`)
