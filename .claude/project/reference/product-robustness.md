# Product Robustness — Cross-Cutting Failure Modes

A **living** checklist (operator-refined) of the cross-cutting quality issues every product must design for and test against — independent of its feature set. These are the silent retention-killers: they rarely show in a feature demo, but surface the moment real users touch the product on real devices and real networks. **Most acute at Launch → Finding-PMF** (see `.claude/project/reference/product-lifecycle.md`), where they are exactly the "glaring but easily fixable" problems that tank D0/D7 retention if missed.

> **Status: living.** The operator will refine and extend this list. Treat it as canon-in-progress: the Director of Product applies it as a **robustness lens**, and it is a candidate to bake into product `sprint:design` / QA as a per-product robustness suite — the product-side analog of MC's own regression seed.

## 1. Product re-entry / lifecycle states
How the app behaves when resumed or re-entered — the single richest source of real-world bugs. Cover the matrix:
- State after **device sleep**.
- **Prolonged idle** — while open · while closed · while backgrounded.
- Getting **automatically backgrounded** (OS suspends/kills the app).
- **Entry into each app area** via **push** vs **manual re-open**.
- **All of the above combined with push** (e.g. resume-from-sleep straight into a push deep-link).

Concerns: state restoration (resume where left off), stale/expired data on resume, silent re-auth, deep-link/push landing on the correct screen *with correct state*, no crash / blank screen / duplicated state on resume.

## 2. Disconnections
Network loss and recovery — **wifi, mobile, captive portals, flaky/intermittent**, mid-action drops.

Concerns: graceful offline handling (honest UI, not an infinite spinner), automatic reconnection + retry with backoff, queued actions that replay on reconnect, **no data loss**, no duplicate submits, correct state after a mid-action disconnect.

## 3. Sound & notifications
**Follow system rules.** Respect OS conventions for permissions, channels, Do-Not-Disturb / focus modes, mute/silent switches, and sound categories.

Concerns: never play sound when the system says don't; request permissions correctly and at the right moment; honor notification channels/grouping; don't spam; a notification deep-links to the right place with the right state (ties to §1).

## 4. Telemetry errors
Analytics/telemetry must be **fail-open and honest**.

Concerns: a telemetry failure must never break or block the app (fail-open); critical events must not be silently dropped; no false or duplicated events. The lifecycle metric check (Activation, retention, DAU/MAU, CAC…) is only as trustworthy as the telemetry — **bad telemetry = blind product decisions**, so telemetry correctness is a PMF prerequisite, not a nicety.

## (more to come)
Operator will extend this list. Keep categories cross-cutting (apply to *any* product, not feature-specific).

## How to use
- **Director of Product:** apply as a robustness lens — when evaluating launch-readiness or a build, ask "does this hold up across these failure modes?" Flag gaps, especially at Launch / Finding-PMF.
- **Future / candidate:** bake into product `sprint:design` + QA as a per-product robustness checklist so these are tested, not just remembered.
