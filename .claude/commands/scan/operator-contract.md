---
description: Wiring gate for the operator message contract — proves the Stop hook (operator-contract-lint.js) is registered, compiled into settings.json, its fixture suite is green, and the three doctrine homes (paths.operatorContract, CLAUDE.md, the lib's HEADERS constant) have not drifted. Fail-closed; report-only 7-day telemetry summary.
---

# /scan:operator-contract — Is the operator message contract actually enforced?

A doctrine block in three files and a hook script on disk are not the same thing as an
**enforced** contract. This gate proves the chain end to end, not just that the pieces exist.

## Run

```bash
node scripts/checks/operator-contract-scan.js          # human-readable
node scripts/checks/operator-contract-scan.js --json   # machine-readable (findings + telemetry)
```

## What it asserts (fail-closed)

1. **Fixture suite is green.** Spawns `node --test scripts/hooks/operator-contract-lint.test.js`
   (all 15 fixtures in `fixtures/hooks/operator-contract-lint/` + the four gate proofs +
   the strictness table) and requires exit 0.
2. **Registered AND compiled.** `operator-contract-lint` must be `enabled:true` with a `Stop`
   registration in `framework/hooks.registry.json` **and** the literal hook script must appear
   in the compiled `.claude/settings.json` Stop block — a registry entry with a stale compiled
   copy is a silent no-op (run `node scripts/hooks/build.js` if this fails).
3. **Doctrine parity (no byte-hash of independent prose — a set/hash check on the one table
   that must stay verbatim-identical).** The 4-row header table (`▶️ RUN THIS` /
   `⚠️ DECISION NEEDED` / `⛔ BLOCKED` / `📌 FYI`) in `paths.operatorContract`'s doc
   (`.claude/agents/president/_system/policy/operator-contract.md`) must hash-equal the same
   table in `CLAUDE.md` § "Talking to the Operator", and the set of header types those rows name
   must exactly match `scripts/hooks/lib/operator-contract.js`'s `HEADERS` constant — a header
   renamed/added in one place with no matching update elsewhere is a finding.
4. **Telemetry summary (report-only, never fails the scan).** Counts `operator-contract-lint`
   verdicts and finding codes from `paths.eventsFile` over the last 7 days. A quiet week (zero
   events) is not a failure — Stop only fires on real sessions.

Exit `0` clean · `1` at least one finding · `2` runner/setup error (**fail-closed** — missing
file, unreadable JSON, etc. must never read green).

## When to run

- Inside `/scan:full` (Tier 2 governance).
- After editing the hook, its lib, the doctrine doc, or the `CLAUDE.md` "Talking to the
  Operator" section — before relying on strictness defaults in a release.

## Reference

- Engine: `scripts/checks/operator-contract-scan.js` (pure `evaluate()` core)
- Hook: `scripts/hooks/operator-contract-lint.js` · lib: `scripts/hooks/lib/operator-contract.js`
- Doctrine: `paths.operatorContract` · per-install setting: `mc.operatorContract` /
  `MC_OPERATOR_CONTRACT` (`scripts/hooks/lib/project-config.js#getOperatorContract`)
