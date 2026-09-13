# Disaster Recovery Baseline

Each generated app must define how data is backed up, restored, deleted, and communicated during incidents.

## Required Plan

| Area | Minimum |
|---|---|
| Backup scope | List databases, object stores, queues, secrets, and generated assets. |
| Backup cadence | State automatic backup frequency and manual snapshot procedure. |
| Restore procedure | Include step-by-step restore commands or provider runbook links. |
| RPO | Define maximum acceptable data loss. Default target: 24 hours unless the product is financial, medical, or operationally critical. |
| RTO | Define maximum acceptable downtime. Default target: 4 hours unless the product requires stricter availability. |
| Data deletion | Define user/workspace deletion flow and irreversible purge window. |
| Incident contact | Define the owner or escalation channel responsible for a production incident. |
| Verification | Restore from backup must be tested before production launch and after major schema changes. |

## Release Gate

Release readiness requires this plan to be present and reviewed. Unknown backup or restore behavior is a shipping blocker for production-bound apps.
