<!-- generated 2026-04-30 by Phase 3L; drafted by codex (gpt-5.5), reviewed by alpha. -->
# Validation Backlog Policy

## 1. Purpose

This policy defines how MC controls the validation backlog created by Requirements Change Object (RCO) staging.
It prevents operational drift: staged entries persist after their context is gone, then stale requirements pollute gates and reviews.
An unbounded backlog of `requirements-staged.jsonl` entries makes the Freshness Gate noise > signal.
The policy defines lifecycle states, expiration, batch review, operator overrides, metrics, and review triggers.

## 2. Lifecycle

Each RCO holds exactly one lifecycle status:

- `open`: The RCO is staged and awaiting resolution.
- `applied`: The RCO was accepted and incorporated into the project source of truth.
- `dismissed`: The RCO was reviewed and rejected as obsolete, duplicative, incorrect, too speculative, or not worth applying.
- `expired`: The RCO was closed by age-based policy because it had no activity inside the allowed window.

`riskClass` is set at staging time using Class A/B/C from `paths.decisionPolicy`.
`riskClass` does not change during lifecycle transitions.
Status transitions append resolution data; they never delete the RCO entry.

## 3. Auto-expire rule (the 30-day rule)

Open RCOs older than 30 days are auto-closed to `status=expired` during the next `/learn:integrate` run.
The age calculation uses the RCO staging timestamp.
Class C RCOs are exempt from auto-expire.
Class C entries require human resolution because they may affect security, data integrity, compliance, irreversible behavior, or explicit user decision boundaries.

The implementation entry point is:

```bash
node scripts/requirements/apply-rco.js --auto-expire 30
```

The command may only close eligible `open` entries.

## 4. Periodic batch review

`/learn:integrate` is the canonical sweep cadence for validation backlog review.
During each run, the integrator:

1. Calls `node scripts/requirements/apply-rco.js --auto-expire 30` first.
2. Groups remaining open RCOs by feature.
3. For each Class A group, scans for the dominant `recommendedSpecUpdate` and offers a single batch resolution.
4. For each Class B group, lists one-line summaries and asks the operator to dismiss / apply / leave-open.
5. Presents Class C entries one-by-one with full context.

Class C is the only risk class that can block the `/learn:integrate` run.
Class A batch review favors high-volume consolidation over item-by-item discussion.
Class B review preserves operator judgment without forcing full-context inspection for every entry.

## 5. Operator overrides

A human operator may resolve an RCO manually with:

```bash
node scripts/requirements/apply-rco.js --resolve <id> <applied|dismissed|expired> "<notes>"
```

Resolutions are appended to the resolution field on the entry.
The entry itself is never deleted; the append-only event log invariant must hold.
Resolution notes should explain the reason for the transition.

## 6. Initial backlog (786 entries as of 2026-04-30)

As of 2026-04-30, the validation backlog contains 786 staged entries.
Any entry without `riskClass` gets classified by:

```bash
node scripts/requirements/stage-rco.js --backfill
```

The backfill command is already implemented.
Any backfilled entry that pre-dates 2026-03-31 is auto-expired.
Class C entries surviving auto-expire are surfaced for human review during the first `/learn:integrate` run after this policy ships.
The initial backlog cleanup must preserve the append-only event log invariant.

## 7. Metrics

The gate reports:

- Number of open RCOs by `riskClass`.
- Median age of open RCOs by class.
- Percentage auto-expired versus human-resolved over the last 7 days.

Metrics are surfaced through `/scan:requirements`.

Targets:

- Under 50 open Class A entries.
- Under 10 open Class B entries.
- Zero open Class C entries unaddressed for more than 24 hours.

## 8. Failure modes the policy prevents

- `BACKLOG_NOISE_DROWNS_GATE`: stale staged requirements dominate gate output and hide currently relevant validation signals.
- `GATE_BECOMES_RUBBER_STAMP_BY_FATIGUE`: reviewers stop reading backlog output because every run repeats unresolved low-value entries.
- `CLASS_C_BURIED_UNDER_TRIVIAL_AS`: high-risk human-decision items are hidden under large volumes of trivial Class A suggestions.

## 9. Review

Re-read this policy when:

- The validation backlog crosses 200 entries.
- The number of auto-expired RCOs in a 7-day window crosses 100.
- A Class C entry stays open for more than 7 days.

When any review trigger fires, the operator should decide whether cadence, thresholds, classification logic, or gate reporting need adjustment.
