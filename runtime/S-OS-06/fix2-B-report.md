# S-OS-06 fix2-B — security-fixer report (F3 HIGH, F4 MEDIUM / ED-434)

Branch `open-source/S-OS-06-fix2-B` (worktree `.claude/worktrees/S-OS-06-fix2-B`), base `dd435266`. Node v24.16.0.

## ⚠ ESCALATION (read first)

1. **The sprint's own suite has a pre-existing RED in scope: `tests/regression/S-OS-06/record-trust-exit.test.js:111` (GREEN) fails with "the exit gate must not change the committed ledger".** I did not fix it: the fix needs files outside my scope.
   - Reproduced **standalone** (`node --test tests/regression/S-OS-06/record-trust-exit.test.js`, nothing else running): 7 pass / 1 fail, same ledger rewrite. So it is **not** caused by my new wrapper spawning the enforcer at the same time.
   - Cause: `TRACKER.md` was changed in `f899ee69` (2026-09-13 14:27) **after** the committed ledger `scripts/open-source/rename-mc.occurrences.json` was last written (`be33525d`, 13:04). The `TRACKER.md` line-7 occurrence pin in `scripts/open-source/rename-mc.denylist.json` ("Last Updated: 2026-09-12 …") now matches nothing. Any `--dry-run` rewrites the ledger: `rewritten 0→53`, `pinned 206→174`, 32 TRACKER.md line-7 pin rows dropped, and `.claude/framework-manifest.json` derived rows move lines (3978→4146, 10910→11102). Diff: +19/−51.
   - The same stale pin already shows up in the **BEFORE** (old-glob) run as the `cutover-completeness` self-host failure: `[F7] stale occurrence pin 'pin|TRACKER.md|…Last Updated: 2026-09-12 …' matches NOTHING`.
   - The fix belongs to the owner of `rename-mc.denylist.json` + the committed ledger: re-pin or refresh the TRACKER.md pin, regenerate the ledger, then regenerate the manifests.
   - Side note: `record-trust-exit.js` **exits 0** even while the committed ledger is stale; only this test's extra assertion catches it. Every `npm test` run now dirties that tracked ledger file (the existing GREEN test already did this under direct runs). I restored it by `git checkout` after each run; nothing was committed.
2. **The widened `npm test` is RED on 25 out-of-scope files that were already broken** (list below). None were skipped or allow-listed, per the brief.
3. **Manifest regen owed:** `_mc/MANIFEST.json` stores a sha256 for `tests/regression/S-OS-06/raw-env-scan.js`, and I changed that file. The regen touches files outside my scope and I did not run it. The integrator must run the manifest triple before landing.
4. **Guard note:** `dependency-admission-guard` refused the `package.json` **Edit** ("could not evaluate this edit … failing closed"). It parses `new_string` as a whole package.json, so a fragment edit can never be evaluated. I read the guard (`scripts/hooks/dependency-admission-guard.js` → `scripts/deps/admission.js#checkPackageEdit`) and made the same change as a full-content **Write**. The guard **evaluated** that Write and allowed it (no dependency blocks → nothing added). It was not bypassed. Resulting diff: one line (below). Finding: the guard can never evaluate any package.json Edit; worth a follow-up for its owner.

## Commits

| sha | stage |
|---|---|
| `da56ad59` | F3: `/i` on the three RAW_ENV_PATTERNS + falsifier |
| `49375ced` | F4: widened `npm test` glob + record-trust-exit wrapper |
| (report commit) | this report |

## F3 (HIGH) — raw-env-scan case-insensitive

- `tests/regression/S-OS-06/raw-env-scan.js`: added the `"i"` flag to `dot`, `bracket`, `destructure`. `PREFIX_ALT` is unchanged (`MC_` + the legacy prefix), so the prefix set is **not** broadened.
- Checked the other site: `scripts/open-source/rename-mc.js:402` `RAW_LEGACY_ENV_READ_RE = /process\.env\s*(?:\.\s*WARPOS_|\[\s*["'`]WARPOS_)/i` — **still carries `/i`.** Both sites hold.
- Live-tree impact: I scanned all 1106 live JS files with the `/i` patterns before committing. There are **0 new offenders**. `env-read-both.test.js` passes 7/7, including `no-raw-env-read-outside-helper` and its planted-shapes test.
- Falsifier: **`tests/regression/S-OS-06/falsify-raw-env-case-insensitive.test.js`** (`FALSIFIER_ID = "RAW-ENV-CASE"`; every slug is built from `H.SLUG`, never written literally; path is Class-3 write-protected).
  - RED 1: lowercase legacy prefix. `process.env.<slug>_home`, `process.env["<slug>_x"]`, `{ <slug>_y } = process.env` → ≥3 hits, ids `dot`, `bracket`, `destructure` each present, in line order.
  - RED 2: `mc_` / `Mc_` and a mixed-case legacy prefix (including a template-literal bracket) → all six lines flagged with the right id.
  - GREEN: `// <slug> era`, a quoted `"the <slug> era"`, `settings.<slug>_home`, and `process.env.HOME` → no hits.
  - **Proof. BEFORE the fix** (scanner unmodified): `# tests 3 / pass 1 / fail 2`, with `not ok 1 … error: 'expected >= 3 raw-env hits, got 0: []'`; `not ok 2`; `ok 3` (the GREEN test). **AFTER the fix:** 3/3 pass, both standalone and inside the widened `npm test`.
- `record-trust-exit.js` item 1 discovers this file as a `falsify-*` fixture. It declares a unique FALSIFIER_ID that is not in the required list. `record-trust-exit.test.js` "every required falsifier id is present" still passes.

## F4 (MEDIUM / ED-434) — widened glob + record-trust-exit under npm test

- `package.json`: `"test": "node --test \"scripts/**/*.test.js\" \"tests/**/*.test.js\""` (one-line diff).
- Checked that node v24.16.0 accepts multiple glob args to `--test`: in a temp tree with `scripts/a/x.test.js` + `tests/b/y.test.js`, both ran (`# tests 2 / pass 2`, exit 0). The widened run below also reports tests from both trees.
- Tracked test files: 231 under `scripts/`, 162 under `tests/`. The old glob ran none of the `tests/` files.
- Wrapper **`tests/regression/S-OS-06/record-trust-exit-runs.test.js`**: spawns `node scripts/checks/record-trust-exit.js` with `cwd` = `path.resolve(__dirname,"..","..","..")`, a 20-min spawn timeout, and `NODE_TEST_CONTEXT` stripped. Its assertions:
  - `r.error === undefined` (a spawn error or timeout is a FAIL)
  - `r.status !== null` (being killed is a FAIL)
  - `r.status === 0`
  - the enforcer's own `record-trust-exit: PASS (N/N items pass)` line is present, with N>0 and all N passing.

  The enforcer's item 1 only matches `falsify-*`, so it never runs this wrapper.
- **Confirmed: record-trust-exit.js now runs under `npm test`.** The AFTER log shows `✔ record-trust-exit runs under npm test: a real exit code 0 on the clean tree (18022.9ms)`. No workflow edit.

## npm test — BEFORE (old glob) vs AFTER (widened)

| run | tests | pass | fail | cancelled | skipped | todo | exit | wall |
|---|---|---|---|---|---|---|---|---|
| BEFORE `scripts/**` only (base tree, before any edit) | 912 | 906 | 3 | 0 | 3 | 0 | 1 | 38 s |
| AFTER `scripts/**` + `tests/**` (both commits) | 1190 | 1158 | 29 | 0 | 3 | 0 | 1 | 52 s |

The 3 BEFORE failures fail again in AFTER. The 26 new failures are 25 out-of-scope `tests/**` files plus 1 in scope (`S-OS-06/record-trust-exit.test.js` GREEN, escalation 1). All 29 were already broken; none come from this fix.

## Failures that predate this fix (file + first failing assertion)

In scope (sprint suite), not fixed — escalated:
- `tests/regression/S-OS-06/record-trust-exit.test.js:111` — `AssertionError: the exit gate must not change the committed ledger` (stale TRACKER.md pin, see escalation 1).

Out of scope, already failing under the OLD glob:
- `scripts/checks/cutover-completeness.test.js` — self-host: `enforcer must exit 0 on the live tree … got 1: FAIL [cutover-completeness] rename partition: 1 problem(s): [F7] stale occurrence pin 'pin|TRACKER.md|…' matches NOTHING`
- `scripts/checks/doc-ref-integrity.test.js` — `FAIL LIVE: the real canon scan ships zero broken refs` (`.claude/agents/president/_system/beta/mined/judgement-model-recommendations-archive.md:685,802 → scripts/warpos/beta-mine-analyze.js`)
- `scripts/checks/framework-purity-gate.test.js:102` — `live tree … passes the default gate`: `1 !== 0` (framework-purity `legacy_slug: 53` = `TRACKER.md` 36 live-unallowed + `trackers/epics/E-OPEN-SOURCE-001-master-console-open-source.md` 17)

Out of scope, newly visible under the widened glob:
- `tests/mc/dispatch-readiness.test.js` — `FAIL KNOWN_DANGLING_REFS is empty by default (no pre-populated allowlist): length=33`
- `tests/mc/lib/provider-autofix.unit.test.js` — `Error: Cannot find module '…/.claude/agents/00-alex/.system/policy/provider-failure-modes.json'`
- `tests/mc/lib/provider-rca.unit.test.js` — `Error: Cannot find module '…/.claude/agents/00-alex/.system/policy/provider-failure-modes.json'`
- `tests/mc/product-bootstrap.unit.test.js` — `Error: Cannot find module '…/scripts/product/bootstrap.js'`
- `tests/mc/provider-smoke.unit.test.js` — `FAIL — 7 of 68 cases failed`
- `tests/regression/S-LC-06/coverage-gate-caller.test.js` — `fixture-test: 7/8 passed, 1 FAILED`
- `tests/regression/S-LC-06/mode-profile.test.js` — `fixture-test: 10/11 passed, 1 FAILED`
- `tests/regression/S-LC-07/spend-ledger.test.js` — `FAIL BLOCKER 1: prototype-key models price via _default — usd FINITE, not NaN`
- `tests/regression/S-PF-01/scaffold-coverage-telemetry.test.js` — `FAIL real-scaffold-telemetry-tree-passes: AssertionError: Expected values to be strictly deep-equal`
- `tests/regression/S-PF-03/admin-surface.test.js` — `11 passed, 3 FAILED`
- `tests/regression/S-PF-04/founders-checklist.test.js` — `5 passed, 1 FAILED`
- `tests/regression/SP-20260518-007/docs-and-skill-bodies.test.js` — `Error: ENOENT … '.claude/agents/00-alex/.system/policy/sprint-full-autonomy.json'`
- `tests/regression/SP-20260518-008/hooks-and-diagnostics.test.js` — `FAIL test_settings_registers_lint_hook_output_between_path_guard_and_sprint_routing`
- `tests/regression/SP-20260611-001/epsilon-spawn-grace.test.js` — `FAIL epsilon-agent / small (1000): child probe ran — no probe line; stdout={"ok":false,"provider":"gemini",…,"error":"dispatch_contract_violation"…`
- `tests/regression/SP-20260611-001/review-fallback-shape.test.js` — `FAIL qa-reviewer (cross_provider_reviewer) → sanctioned via review_fallback — {"sanctioned":false,…"role 'qa-reviewer' (class 'claude_pinned_reviewer') is not in lane …`
- `tests/regression/SP-20260611-001/sprint-id-correlation.test.js` — `1 passed, 3 FAILED`
- `tests/regression/SP-20260611-001/window-clamp.test.js` — `5 passed, 3 FAILED`
- `tests/regression/SP-20260611-002/coverage-gate-scan-live-cli.test.js` — `fixture-test: 4/7 passed, 3 FAILED`
- `tests/regression/SP-20260611-002/coverage-gate-scan-source.test.js` — `fixture-test: 4/6 passed, 2 FAILED`
- `tests/regression/SP-20260611-002/wrapper-mode-binding.test.js` — `FAIL report-only-ramp-preserved-not-blocking`
- `tests/regression/SP-20260615-001/registry-seed-resolves.test.js` — `FAIL four-known-panels-seeded-and-openers-resolve`
- `tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js` — `FAIL clean fixture root: all four sections healthy (no false degrade)`
- `tests/regression/SP-20260615-001/roadmap-board-render.test.js` — `FAIL board cites all four live sources`
- `tests/regression/SP-20260616-001/wrapper-door.test.js` — `FAIL sanctioned --review-fallback + MC_SHAPE_DOOR=enforce → exit 0 (lane not bricked) — status=1 … dispatch-contract VIOLATION: shape 'subprocess-claude' is not allowed for role 'backend-reviewer'`
- `tests/regression/SP-20260627-001/negative-fixtures.test.js` — `fixture-test: 8/9 passed, 1 FAILED`

Many of these point at paths from before the ADR-0007 cutover (`00-alex/.system`, `scripts/product/bootstrap.js`), or at dispatch-contract lanes that have since changed. That is test rot a bare `scripts/**` glob hid.

Hazard for whoever lands this: once the widened glob is on CI's `npm test`, CI goes RED until these 26 files (plus the 3 already failing) are fixed or retired. That is the intended ED-434 effect, but it is a landing decision for the lead.

## Tree state

After each run I restored the test-mutated `scripts/open-source/rename-mc.occurrences.json` (`git checkout`). Test runs left untracked `runtime/S-OS-06/` fixture byproducts (`fixture-product/…`, dry-run plan/ledger). They are not committed; only this report is added from `runtime/`.
