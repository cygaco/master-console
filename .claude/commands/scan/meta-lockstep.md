---
description: The meta-lockstep enforcer — couples a scan's cross-provider SCOPE FILTER to the class_derivation rule-table, so broadening one without the paired rule is self-detecting. Report-only in /scan:full.
---

# /scan:meta-lockstep — Scope-filter ↔ class_derivation lockstep

The structural coupling between a scan's cross-provider **scope filter** and the **class_derivation
rule-table**.

## What it does

Runs `node scripts/checks/meta-lockstep.js` (`--json` for machine output). It imports the SAME
`CROSS_PROVIDER_SCOPE` symbol the filter reads and REUSES `role-parity-scan.js`'s `deriveClass` (one
source, two consumers — no reimplementation, no drift). It asserts **symmetry of cross-provider-routing
rules across the in-scope providers**: for each `(tier|kind)=value` key that ANY in-scope provider
routes to a `subprocess-cross-provider` class via a provider-pinned rule, EVERY in-scope provider must
route it cross-provider too — UNLESS

- **excused** — no LIVE registry role of that `(tier|kind=value, provider)` exists, OR
- **waived** — the `(dimension, value, provider)` triple is on the frozen NARROWEST waiver baseline.

The baseline waiver carries exactly `{tier:director, provider:antigravity}` (ADR-0031 deferral: no
live antigravity director; role-parity self-detects the gap at introduction — the rule is NOT re-added).
Waiver integrity is itself enforced: a non-narrowest entry, a why-less entry, or a waiver
**widened** beyond the frozen baseline is a finding. And a source-coupling teeth: a re-inlined
provider literal at the `role-parity-scan` filter (dropping the shared constant) is flagged.

Findings name the broken invariant, the offending `(dimension, value, provider)`, and the fix (add the
paired rule OR a narrowest-form documented waiver).

**Exit:** 0 clean · 1 findings · 2 fail-closed (unreadable/unparseable registry or contract).
**Wired REPORT-ONLY** in `/scan:full` — the symmetry algorithm can over-fire, so a finding is
reported but does not block.

Bite-test: `node scripts/checks/meta-lockstep.test.js` (14 assertions incl. the asymmetry-reason
de-aliasing, a role-parity-green-yet-symmetry-violated case proving independent teeth, director
excused+waived, scope-constant-is-read, and the three waiver-integrity negatives).

## When to run

After any edit to `role-parity-scan.js`'s `CROSS_PROVIDER_SCOPE`, `dispatch-contract.json`'s
`class_derivation` rules, or the introduction of a new cross-provider role/provider. Part of `/scan:full`.
