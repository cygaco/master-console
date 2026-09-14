# S-OS-06 gauntlet fix brief — round 2 (attempt 2 of 3) — six items

Source: security-reviewer FAIL `d-mu0b4omb-9e2a28c7` (GPT-5.5 via codex, 3 HIGH + 1 MEDIUM) on `f666c702`, re-verified during the 2026-09-13 tracker reconcile; plus the CI-RED leak-gate on `dd435266` (run 34784543858). Sprint head for all worktree cuts = `dd435266`.

Lane split (ε decision):
- **Lane A** (dispatched, security-fixer): F1 + F2 — `scripts/open-source/partition-loader.js`, `scripts/open-source/rename-mc.js`, new falsifier fixtures.
- **Lane B** (dispatched, security-fixer): F3 + F4 — `tests/regression/S-OS-06/raw-env-scan.js`, `package.json`, a test wrapper for `record-trust-exit.js`, new falsifier fixture.
- **Lane C** (ε-direct, after Lane A merges so pins validate against the occurrence-scoped loader): F5 + F6 — `trackers/…`, `scripts/open-source/rename-mc.denylist.json`, new falsifier fixture.

---

## F1 (HIGH) — occurrence-scoped dispositions, not line-scoped
`partition-loader.js` `tallyLegacySlug` (Class-1 per-line loop, line ~508) and `rename-mc.js` (per-occurrence loop, line ~657) credit a compat/pin match to **every** `warpos` hit on the line (`n = count(lineText)`; or `comp`/`pin` computed per-line). A same-line extra live slug beside a compat/pinned occurrence is counted compat/pinned (verified: `pending=0, compat=2`), masking a live leak and gaming the per-category delta.

Fix: a single occurrence-scoped choke-point in `partition-loader.js`, consumed by both files. A pin/compat covers a `warpos` occurrence ONLY when that occurrence's character index lies inside a span of the pin/compat `matchText` on the line.

Falsifier (`tests/regression/S-OS-06/falsify-occurrence-scoped-disposition.test.js`): plant an extra live slug ON a pinned line AND ON a compat line → framework-purity (and the codemod dry-run) must go RED (`live_unallowed >= 1`). GREEN companion: matchText covering all occurrences stays green.

## F2 (HIGH) — F8 freeze-history must inspect merge commits
`partition-loader.js` `checkFreeze` line ~926 uses `git log --no-merges`, so an allow-list/compat widening added inside a MERGE commit evades the separate-amendment rule. Fix: drop `--no-merges` and compare each commit against its first parent (`git diff --name-only <c>^ <c>` for the foreign-file set, `readPartitionAt(c^)` for added entries — already first-parent).

Falsifier (`tests/regression/S-OS-06/falsify-freeze-merge-commit.test.js`): a fixture git history where a partition-widening entry lands inside a `--no-ff` merge commit → cutover-completeness must exit 1 naming F8.

## F3 (HIGH) — raw-env-scan case-insensitive
`tests/regression/S-OS-06/raw-env-scan.js:18-23`: `PREFIX_ALT` is uppercase-only and the three `RAW_ENV_PATTERNS` regexes have no `i` flag. On Windows `process.env` is case-insensitive, so lowercase / bracket / destructured reads bypass the helper. Fix: add the `i` flag to all three regexes. Verify the backend re-review's earlier `/i` fix at the DIFFERENT site (`rename-mc.js` `RAW_LEGACY_ENV_READ_RE`) is still intact — both sites must hold.

Falsifier (`tests/regression/S-OS-06/falsify-raw-env-case-insensitive.test.js`): assert `findRawEnvReads` catches all three read shapes in lowercase (`process.env.warpos_home`, `process.env["warpos_x"]`, `const { warpos_y } = process.env`).

## F4 (MEDIUM / ED-434) — widen the test glob + wire record-trust-exit into npm test
`package.json` `test` = `node --test "scripts/**/*.test.js"` — misses `tests/**/*.test.js` (the sprint's regression + falsifier suite) and never runs `scripts/checks/record-trust-exit.js`. Fix: widen the glob so `tests/**/*.test.js` runs AND `record-trust-exit.js` executes under `npm test` (a test-file wrapper `tests/regression/S-OS-06/record-trust-exit-runs.test.js` that spawns it with a real exit-code assertion is the chosen shape). No `.github/workflows/` edit (classifier-denied); the leak-gate workflow already runs `npm test`. RUN THE WIDENED SUITE LOCALLY; if pre-existing failures OUTSIDE this sprint's files appear, list them (file + first assertion) and report — do NOT skip/allow-list silently.

## F5 (DEFECT) — restore the two historical literals (ε-direct, Lane C)
`trackers/epics/E-OPEN-SOURCE-001-master-console-open-source.md`: restore `mc@0.1.4` → `warpos@0.1.4` (§ Goal line 11, § Scope line 12/13, DoD 5 line 23; `mc@0.1.4` does not exist as a tag) and "formerly MC" → "formerly WarpOS" (DoD 8 line 26). Add invariant + falsifier: a `warpos@<semver>` tag name is NEVER rewritten anywhere, and "formerly WarpOS" is pinned wherever it appears. Then drop the § Open questions "Verified Nonexistent" pending status on the tag row (resolved by this fix); leave the row as history.

## F6 (CI RED) — leak gate green by honest per-occurrence dispositions (ε-direct, Lane C)
Reproduce with the workflow command `node scripts/checks/framework-purity.js --full`. Live-unallowed = 53 (TRACKER.md 36 + epic 17); the F5 restores ADD warpos occurrences that also need pins. Disposition each honestly: `warpos@<semver>` tag names + the "formerly WarpOS" brand-history phrase absorbed by the F5 invariant pins; the remainder (historical prose: past sprint IDs, old filenames, old env-var names, branch names, audit narrative) closed by occurrence pins keyed on the SPECIFIC literal (never a bare `warpos` matchText — that over-covers) with a per-pin warrant. NO wholesale file allow-list, NO report-only downgrade (β r3b). Note: `.claude/settings.json:428` `warpos/settings-compiler/v1` is a LOCAL uncommitted settings-recompile artifact (HEAD carries `mc/…`), not a committed leak — irrelevant to CI.

---

## Verify (each lane) then report
- Affected `node --test` targets pass; the new falsifier goes RED on the planted defect, GREEN clean.
- `node scripts/checks/framework-purity.js --full` and `npm run leak-gate` GREEN on the merged head.
- Return ≤8-line envelope: commit shas, falsifier fixture path + RED/GREEN proof, suite tally, leak-gate result.
