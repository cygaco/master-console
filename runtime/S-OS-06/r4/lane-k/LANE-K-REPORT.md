# S-OS-06 r4 — Lane K report: property adjudication (A instrument / B record / RESIDUE)

**Status: COMPLETE.** Every figure below comes from the lane's own decision record, `adjudication-k.decisions.json` (committed `7b04cdd4`), run through the lane's own instrument, `adjudicate-k.js`, at the head stated next. The full machine output is committed beside this report as `adjudication-k.out.json`. The instrument decides and fixes nothing; this lane made no fixes or renames.

## Head

- The decision record's `measuredHead` is `56a16fc19269d217879e0a844a15253d9a24bdbc`. **Confirmed still correct as the record's basis.** The branch was at `56a16fc1` when this dispatch resumed.
- **Instrument run head: `53cf07d1d64985912a627693fff5dbe0f7754379`** (inventory re-measured at the same head: `53cf07d1d64985912a627693fff5dbe0f7754379`). That head is `56a16fc1` plus the two reap-recovery commits of this lane (`7b04cdd4`, `53cf07d1`). `git diff --name-status 56a16fc1 53cf07d1` lists exactly three added files, all under `runtime/S-OS-06/r4/lane-k/`: `adjudicate-k.js`, `adjudication-k.decisions.json` and `LANE-K-REPORT.md` (the skeleton). No file outside lane K changed.
- Both committed inventories are stale for this record. `inventory.json` was measured at `a5c64c89` and `inventory-k.out.json` at `b26ff91d`; there are 62 changed files between `b26ff91d` and `56a16fc1`. The earlier run never produced an inventory at `56a16fc1` (the out-of-tree copy in %TEMP%/laneK is also from `b26ff91d`). The inventory was therefore re-run with the existing `inventory-k.js`, which is not a new instrument, at `53cf07d1`.
- Reconciliation: adjudicated files 1684 == inventory withOccurrence 1684; occurrences 27393 == 27393 [holds=true]. Instrument exit code 0.
- Self-reference (section 7b): the round's own `runtime/S-OS-06/r4/**` artifacts are inside the swept population, {"files":20,"occurrences":1944}; lane K's share is {"files":5,"occurrences":387}: `runtime/S-OS-06/r4/lane-k/ENTRY-LEVEL-READING.md (1)`, `runtime/S-OS-06/r4/lane-k/adjudication-k.decisions.json (120)`, `runtime/S-OS-06/r4/lane-k/inventory-k.out.json (132)`, `runtime/S-OS-06/r4/lane-k/inventory-summary.md (2)`, `runtime/S-OS-06/r4/lane-k/inventory.json (132)`. Files committed AFTER the measurement head (`adjudication-k.out.json` and this report's later revisions) are outside the measured population by construction.

## Headline: the sets

Population: `{"tracked":4465,"allowListed":2124,"allowListedWithOccurrence":1684,"allowListedNoOccurrence":440,"binary":0,"unreadable":0}`.

| Set | Files | Occurrences | Breakdown |
|---|---:|---:|---|
| A | 35 | 2520 | -: 34 files / 2489 occ; specification-subject: 1 files / 31 occ |
| B | 1437 | 23854 | -: 1437 files / 23854 occ |
| RESIDUE | 206 | 1013 | fix: 160 files / 810 occ; compat-seam: 44 files / 140 occ; fix+rename: 1 files / 61 occ; rename: 1 files / 2 occ |
| CANNOT-ASSESS | 5 | 5 | -: 5 files / 5 occ |
| CI-UNRULED | 1 | 1 | -: 1 files / 1 occ |

- **A (instrument):** rewriting the literal would break the file's own function. It must be verbatim and test-pinned; a missing pin is marked OWED.
- **B (record):** rewriting would falsify a record of something that happened.
- **RESIDUE (the fix population):** neither property admits the file. Sub-dispositions are `fix`, `rename`, `fix+rename` and `compat-seam`.
- **CANNOT-ASSESS:** named with its reason and never silently admitted.
- **REMOVED:** 0 files / 0 occurrences. NOTHING REMOVED at this head. Lane J Part 2 is BLOCKED on the CI binding and deleted nothing (brief correction 3). REMOVED remains a disposition separate from FIXED; if the alias drop lands later, its count is emitted separately.

## β's expectation vs the measured result

β's expectation, recorded before measuring: RESIDUE is zero for dreams, reports, archive and decision records, and non-zero for the planning directory. Measured:

| Directory | β expected RESIDUE | Measured A | Measured B | Measured RESIDUE (files / occ) | Verdict |
|---|---|---:|---:|---|---|
| dreams (`.claude/dreams/**`) | zero | 0 | 5 | 0 / 0 | agrees |
| reports (`_reports/**`) | zero | 0 | 16 | 1 / 4 | **DISAGREES** |
| archive (`_archive/**`) | zero | 0 | 5 | 0 / 0 | agrees |
| decision records (`.claude/agents/president/_system/policy/adr/**`) | zero | 0 | 5 | 1 / 6 | **DISAGREES** |
| planning (`_planning/**`) | non-zero | 1 | 46 | 11 / 128 | agrees |

**The measured result disagrees with β in two places.** It is reported as measured, not bent to fit:

- `_reports/README.md` (4 occ, fix): LIVE README. L71/L73/L86 describe the present repo ('In canonical WarpOS (this repo) …') by the legacy brand.
- `.claude/agents/president/_system/policy/adr/0013-two-dispatch-shape-gates.md` (6 occ, fix): CONTRADICTS the expectation of zero residue for decision records. The body (L32) is record, but 'Mitigations / escapes' (L81-83) and 'Reversal plan' (L87) are OPERATIVE instructions ('Set <legacy-prefix>_DISPATCH_CONTRACT_ENFORCE=report …') naming legacy-prefixed env names. Scripts read the MC_ names (e.g. scripts/dispatch-agent.js:835-843), and the legacy names are honoured only through the read-both compat window expiring 2.1.0. An instruction is not a record. Fix form (not done here): an amendment naming the current variables, leaving the historical body intact.

The two agreements that hold are dreams (0) and archive (0), and planning is non-zero as β expected. Planning also has one A file (`_planning/epics/E-OPEN-SOURCE-001.md`, pin OWED) and 46 B files. Its 11 RESIDUE files are listed under RESIDUE below.

## Regression directory `tests/regression/S-OS-06/`, per file

38 tracked files: `{"A":13,"NO-OCCURRENCE":24,"RESIDUE":1}`. The guard: a test whose assertion has the legacy literal as its SUBJECT is A. A test that merely carries its OWN legacy identifier is LIVE and belongs to RESIDUE (rename).

| File | Occ | Guard | Set | Pin | Reason |
|---|---:|---|---|---|---|
| `alias-map.test.js` | 5 | SUBJECT | **A** | self (falsifier; pins scripts/open-source/mc-alias-map.json) | asserts the alias map's LEGACY side (every enumerated skill is mapped warp:<skill> -> mc:<skill>; the legacy skill/scan/check path regex). The LEGACY constant builds exactly the legacy names under assertion; rewriting it makes the test assert mc->mc. |
| `codemod.test.js` | 36 | SUBJECT | **A** | self (falsifier; pins scripts/open-source/rename-mc.js) | every occurrence is codemod INPUT under test: fixture files/dirs the codemod must rewrite (scripts/warpos/ -> scripts/mc/), the protected class-4 historical fixture, the write-protected .github fixture, and the raw env-read forms the codemod must refuse. Rewriting the fixtures removes what the assertions exercise. |
| `denylist.test.js` | 7 | SUBJECT | **A** | self (falsifier; pins scripts/open-source/rename-mc.denylist.json) | asserts the generated-view MOVE _warpos/MANIFEST.json -> _mc/MANIFEST.json is done and that the class-4 _planning/warpos-lifecycle-plan.md keeps its legacy name (keptHistoricalPaths). The legacy paths ARE the assertion subject. |
| `falsifier-harness.js` | 1 | SUBJECT | **A** | consumed by every S-OS-06 falsifier | SLUG is the legacy slug every falsifier plants and detects (H.SLUG is imported across the suite). Rewriting it makes every falsifier plant and look for the current slug, so none can go RED on a legacy leak. The function test fails. |
| `falsify-codemod-touches-generated-view.test.js` | 1 | SUBJECT | **A** | self (falsifier) | asserts the exact refusal for the legacy-named generated view .claude/warpos-views.json -> .claude/mc-views.json. The legacy path is the assertion subject. |
| `falsify-historical-literal-preserved.test.js` | 26 | SUBJECT | **A** | self (falsifier) | the legacy release tags (warpos@<semver>) and the brand-history phrase are the assertion SUBJECT. gitTags() over the legacy-lab glob at L85 is functional (the fail-closed proof the tags exist). Occurrence-grain note, NOT an admission change: the local variable name at L85/L90/L93/L100 names the subject set and could be renamed without breaking function. The current-lab members authored in this file are adjudicated separately in authored21 (one of them, L6, is RESIDUE there). |
| `falsify-live-warpos-off-allowlist.test.js` | 2 | OWN-IDENTIFIER | **RESIDUE** (rename) |  | its ONLY legacy occurrences are its OWN identifier: the filename, the falsifier name in its header (L4) and its own run command (L12). The planted subject is built from H.SLUG and carries no literal. Rename the file and its self-references. The only other tree reference is the generated _mc/MANIFEST.json (regenerated), plus mentions inside S-OS-06 sprint records. |
| `falsify-occurrence-scoped-disposition.test.js` | 12 | SUBJECT | **A** | self (falsifier) | pinned-vs-rewritten occurrence-grain behaviour on legacy literals (the .warpos pin, the ~/.warpos/x rewrite, the odd-case sanity regex listing the legacy case variants). The legacy forms are the assertion subject. |
| `falsify-refused-rename.test.js` | 2 | SUBJECT | **A** | self (falsifier) | asserts the exact refusal for renaming records/warpos/guide.md onto a write-protected path. The legacy path is the subject. |
| `max-scan-bytes-fail-not-skip.test.js` | 1 | SUBJECT | **A** | self (falsifier) | the header (L7) states the regression under test: a legacy occurrence inside an oversized file went unledgered. The test plants that occurrence via H.SLUG (L28/L59). The legacy literal is the subject. |
| `migration.test.js` | 15 | SUBJECT | **A** | self (pins migrations/1.2.0-to-2.0.0/**) | NS (the legacy skill namespace), the three migration ids (named for what they migrate), the fixture update-transaction id and fixture reason text are INPUTS the 1.2.0->2.0.0 migration must transform. ALIAS_RE is loaded from the migration itself. |
| `occurrence-ledger.test.js` | 1 | SUBJECT | **A** | self (pins scripts/open-source/rename-mc.occurrences.json) | L70 describes the legacy generated-view move whose derived-row identity the assertion checks (subject). |
| `raw-env-scan.js` | 2 | SUBJECT | **A** | consumed by env-read-both.test.js | the AC-3.3 scanner for raw legacy-prefixed env reads (prefix built from H.SLUG). The comment examples at L22-23 are the exact forms it must catch. |
| `skill-namespace.test.js` | 66 | SUBJECT | **A** | self (falsifier) | tests the warp: -> mc: skill-namespace rewrite, its enumeration boundary (non-enumerated legacy skills untouched), path renames of .claude/commands/warp/*.md and the named residual counter. Every legacy token is rewrite input or expected residual. |

**NO-OCCURRENCE (24):** there is no legacy literal in the content or the name, so nothing to admit and nothing to fix: `dir-fallback.test.js`, `env-read-both.test.js`, `falsify-changelog-historical-unregistered.test.js`, `falsify-codemod-rewrites-class3-literal.test.js`, `falsify-compat-outside-register.test.js`, `falsify-computed-tag-glob.test.js`, `falsify-doc-ref-legacy-rename.test.js`, `falsify-freeze-merge-commit.test.js`, `falsify-postfreeze-silent-addition.test.js`, `falsify-quarantine-runner.test.js`, `falsify-raw-env-case-insensitive.test.js`, `falsify-split-brain.test.js`, `falsify-stale-allowlist-entry.test.js`, `falsify-truncated-allowlist.test.js`, `falsify-unclassified-path.test.js`, `falsify-unwarranted-allowlist-entry.test.js`, `history-proof-message-surface.test.js`, `home-read-both.test.js`, `partition-single-loader.test.js`, `partition-total.test.js`, `paths-registry.test.js`, `record-trust-exit-runs.test.js`, `record-trust-exit.test.js`, `split-brain.test.js`.

**Regression-directory RESIDUE: exactly 1 file**, `falsify-live-warpos-off-allowlist.test.js`. Its only legacy occurrences are its own identifier (the filename, the falsifier name in its header, its run command), so it is RESIDUE (rename). The other 13 files with occurrences carry the legacy literal as the assertion SUBJECT or as a falsifier input, so they are A.

## Set A: 35 files, per file

| File | Occ | Rule | Pin | Reason |
|---|---:|---|---|---|
| `_planning/epics/E-OPEN-SOURCE-001.md` | 31 | explicit / specification-subject | OWED (not test-pinned; A's disposition requires a pin) | plan of the ACTIVE open-source epic. Every legacy occurrence is the SUBJECT of the rename/evidence specification: the repo to rename (L10), the evidence tag warpos@0.1.4 kept forever (L10/L13), the name-collision finding (L13/L83), the S-OS-06 rename scope (L16/L113/L115) and the brand-history phrase (L65). Rewriting them turns the spec into mc->mc and destroys its function. Background L13 is also a record of the 2026-09-02 review. No line tells a reader to USE a legacy name. |
| `.claude/project/sprint/requirements/S-OS-06/acceptance-criteria.md` | 21 | R-sprint-body | OWED (sprint specification; not test-pinned) | the CURRENT rename sprint. Its requirement and state prose has the legacy literal as the SUBJECT of the rename specification (what to rename, what stays pinned, the H-1 historical set), so rewriting it destroys the spec's function (A, specification-subject; pin OWED). Its live state files (current.yaml, progress.yaml) carry the legacy schema id on the schema line while the schema consts and writers use mc/ (RESIDUE). Machine-path segments stay B. |
| `.claude/project/sprint/requirements/S-OS-06/granular-stories.md` | 29 | R-sprint-body | OWED (sprint specification; not test-pinned) | the CURRENT rename sprint. Its requirement and state prose has the legacy literal as the SUBJECT of the rename specification (what to rename, what stays pinned, the H-1 historical set), so rewriting it destroys the spec's function (A, specification-subject; pin OWED). Its live state files (current.yaml, progress.yaml) carry the legacy schema id on the schema line while the schema consts and writers use mc/ (RESIDUE). Machine-path segments stay B. |
| `.claude/project/sprint/requirements/S-OS-06/high-level-stories.md` | 9 | R-sprint-body | OWED (sprint specification; not test-pinned) | the CURRENT rename sprint. Its requirement and state prose has the legacy literal as the SUBJECT of the rename specification (what to rename, what stays pinned, the H-1 historical set), so rewriting it destroys the spec's function (A, specification-subject; pin OWED). Its live state files (current.yaml, progress.yaml) carry the legacy schema id on the schema line while the schema consts and writers use mc/ (RESIDUE). Machine-path segments stay B. |
| `.claude/project/sprint/requirements/S-OS-06/prd.md` | 50 | R-sprint-body | OWED (sprint specification; not test-pinned) | the CURRENT rename sprint. Its requirement and state prose has the legacy literal as the SUBJECT of the rename specification (what to rename, what stays pinned, the H-1 historical set), so rewriting it destroys the spec's function (A, specification-subject; pin OWED). Its live state files (current.yaml, progress.yaml) carry the legacy schema id on the schema line while the schema consts and writers use mc/ (RESIDUE). Machine-path segments stay B. |
| `.claude/project/sprint/requirements/S-OS-06/qa-plan.md` | 3 | R-sprint-body | OWED (sprint specification; not test-pinned) | the CURRENT rename sprint. Its requirement and state prose has the legacy literal as the SUBJECT of the rename specification (what to rename, what stays pinned, the H-1 historical set), so rewriting it destroys the spec's function (A, specification-subject; pin OWED). Its live state files (current.yaml, progress.yaml) carry the legacy schema id on the schema line while the schema consts and writers use mc/ (RESIDUE). Machine-path segments stay B. |
| `.claude/project/sprint/requirements/S-OS-06/release-plan.md` | 11 | R-sprint-body | OWED (sprint specification; not test-pinned) | the CURRENT rename sprint. Its requirement and state prose has the legacy literal as the SUBJECT of the rename specification (what to rename, what stays pinned, the H-1 historical set), so rewriting it destroys the spec's function (A, specification-subject; pin OWED). Its live state files (current.yaml, progress.yaml) carry the legacy schema id on the schema line while the schema consts and writers use mc/ (RESIDUE). Machine-path segments stay B. |
| `.claude/project/sprint/requirements/S-OS-06/trace.md` | 15 | R-sprint-body | OWED (sprint specification; not test-pinned) | the CURRENT rename sprint. Its requirement and state prose has the legacy literal as the SUBJECT of the rename specification (what to rename, what stays pinned, the H-1 historical set), so rewriting it destroys the spec's function (A, specification-subject; pin OWED). Its live state files (current.yaml, progress.yaml) carry the legacy schema id on the schema line while the schema consts and writers use mc/ (RESIDUE). Machine-path segments stay B. |
| `migrations/0.0.0-to-0.1.0/004-rename-warp-sync-to-update.js` | 23 | explicit | OWED (no file under tests/ references this migration) | renames the legacy sync skill to the update skill in installs. The legacy tokens are the migration's input and output. |
| `migrations/0.1.x-to-0.2.0/001-rename-warpos-to-framework.js` | 10 | explicit | OWED (no file under tests/ references this migration) | renames the legacy-named install directory to framework/. The legacy path is its input. |
| `migrations/0.1.x-to-0.2.0/003-rename-docs-to-_docs.js` | 3 | explicit | OWED (no file under tests/ references this migration) | L45-47: the CLI-mode fallback backup dir sits under the legacy hidden home where 0.1.x installs kept state (functional). The L2 header is a B-line. |
| `migrations/0.1.x-to-0.2.0/004-paths-schema-v4-to-v5.js` | 2 | explicit | OWED (no file under tests/ references this migration) | L30 writes the v5 paths schema id as it existed at 0.2.0; rewriting it makes the migration emit an id that version never had. The L2 header is a B-line. |
| `migrations/1.2.0-to-2.0.0/001-warpos-to-mc-layout.js` | 28 | explicit | tests/regression/S-OS-06/migration.test.js | the 2.0.0 downstream migration: the legacy layout/settings/skill names are exactly what it finds and renames in installed products. |
| `migrations/1.2.0-to-2.0.0/002-warpos-to-mc-settings.js` | 22 | explicit | tests/regression/S-OS-06/migration.test.js | the 2.0.0 downstream migration: the legacy layout/settings/skill names are exactly what it finds and renames in installed products. |
| `migrations/1.2.0-to-2.0.0/003-warpos-to-mc-skills.js` | 19 | explicit | tests/regression/S-OS-06/migration.test.js | the 2.0.0 downstream migration: the legacy layout/settings/skill names are exactly what it finds and renames in installed products. |
| `runtime/S-OS-06/r4/oracles/cross-lab-join.js` | 1 | R-r4-oracle-instrument | runtime/S-OS-06/r4/oracles/self-test.js, cross-lab-join.self-test.js | the round's oracles: the legacy slug/lab/brand-phrase literals (assembled or matched) are what they detect. Rewrite them and the oracle finds nothing. |
| `runtime/S-OS-06/r4/oracles/lib.js` | 1 | R-r4-oracle-instrument | runtime/S-OS-06/r4/oracles/self-test.js, cross-lab-join.self-test.js | the round's oracles: the legacy slug/lab/brand-phrase literals (assembled or matched) are what they detect. Rewrite them and the oracle finds nothing. |
| `runtime/S-OS-06/r4/oracles/oracle-iv-occupancy.js` | 2 | R-r4-oracle-instrument | runtime/S-OS-06/r4/oracles/self-test.js, cross-lab-join.self-test.js | the round's oracles: the legacy slug/lab/brand-phrase literals (assembled or matched) are what they detect. Rewrite them and the oracle finds nothing. |
| `scripts/open-source/mc-alias-map.json` | 73 | explicit | tests/regression/S-OS-06/alias-map.test.js | the alias map: its old side IS the legacy names. Rewrite it and the mapping is destroyed. |
| `scripts/open-source/rename-mc.denylist.json` | 858 | explicit | tests/regression/S-OS-06/denylist.test.js | the denylist/pin register: it names the legacy literals and paths the codemod must not rewrite, with warrants. Rewrite them and the pins match nothing. |
| `scripts/open-source/rename-mc.js` | 112 | explicit | tests/regression/S-OS-06/codemod.test.js, skill-namespace.test.js | the codemod: its legacy literals are the patterns it finds and the categories it assigns. Rewrite them and it stops finding legacy tokens. |
| `scripts/open-source/rename-mc.occurrences.json` | 1022 | explicit | tests/regression/S-OS-06/occurrence-ledger.test.js | the occurrence register. Rewrite the literals and it no longer records which occurrences carry the legacy token. |
| `tests/regression/S-OS-06/alias-map.test.js` | 5 | explicit | self (falsifier; pins scripts/open-source/mc-alias-map.json) | asserts the alias map's LEGACY side (every enumerated skill is mapped warp:<skill> -> mc:<skill>; the legacy skill/scan/check path regex). The LEGACY constant builds exactly the legacy names under assertion; rewriting it makes the test assert mc->mc. |
| `tests/regression/S-OS-06/codemod.test.js` | 36 | explicit | self (falsifier; pins scripts/open-source/rename-mc.js) | every occurrence is codemod INPUT under test: fixture files/dirs the codemod must rewrite (scripts/warpos/ -> scripts/mc/), the protected class-4 historical fixture, the write-protected .github fixture, and the raw env-read forms the codemod must refuse. Rewriting the fixtures removes what the assertions exercise. |
| `tests/regression/S-OS-06/denylist.test.js` | 7 | explicit | self (falsifier; pins scripts/open-source/rename-mc.denylist.json) | asserts the generated-view MOVE _warpos/MANIFEST.json -> _mc/MANIFEST.json is done and that the class-4 _planning/warpos-lifecycle-plan.md keeps its legacy name (keptHistoricalPaths). The legacy paths ARE the assertion subject. |
| `tests/regression/S-OS-06/falsifier-harness.js` | 1 | explicit | consumed by every S-OS-06 falsifier | SLUG is the legacy slug every falsifier plants and detects (H.SLUG is imported across the suite). Rewriting it makes every falsifier plant and look for the current slug, so none can go RED on a legacy leak. The function test fails. |
| `tests/regression/S-OS-06/falsify-codemod-touches-generated-view.test.js` | 1 | explicit | self (falsifier) | asserts the exact refusal for the legacy-named generated view .claude/warpos-views.json -> .claude/mc-views.json. The legacy path is the assertion subject. |
| `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js` | 26 | explicit | self (falsifier) | the legacy release tags (warpos@<semver>) and the brand-history phrase are the assertion SUBJECT. gitTags() over the legacy-lab glob at L85 is functional (the fail-closed proof the tags exist). Occurrence-grain note, NOT an admission change: the local variable name at L85/L90/L93/L100 names the subject set and could be renamed without breaking function. The current-lab members authored in this file are adjudicated separately in authored21 (one of them, L6, is RESIDUE there). |
| `tests/regression/S-OS-06/falsify-occurrence-scoped-disposition.test.js` | 12 | explicit | self (falsifier) | pinned-vs-rewritten occurrence-grain behaviour on legacy literals (the .warpos pin, the ~/.warpos/x rewrite, the odd-case sanity regex listing the legacy case variants). The legacy forms are the assertion subject. |
| `tests/regression/S-OS-06/falsify-refused-rename.test.js` | 2 | explicit | self (falsifier) | asserts the exact refusal for renaming records/warpos/guide.md onto a write-protected path. The legacy path is the subject. |
| `tests/regression/S-OS-06/max-scan-bytes-fail-not-skip.test.js` | 1 | explicit | self (falsifier) | the header (L7) states the regression under test: a legacy occurrence inside an oversized file went unledgered. The test plants that occurrence via H.SLUG (L28/L59). The legacy literal is the subject. |
| `tests/regression/S-OS-06/migration.test.js` | 15 | explicit | self (pins migrations/1.2.0-to-2.0.0/**) | NS (the legacy skill namespace), the three migration ids (named for what they migrate), the fixture update-transaction id and fixture reason text are INPUTS the 1.2.0->2.0.0 migration must transform. ALIAS_RE is loaded from the migration itself. |
| `tests/regression/S-OS-06/occurrence-ledger.test.js` | 1 | explicit | self (pins scripts/open-source/rename-mc.occurrences.json) | L70 describes the legacy generated-view move whose derived-row identity the assertion checks (subject). |
| `tests/regression/S-OS-06/raw-env-scan.js` | 2 | explicit | consumed by env-read-both.test.js | the AC-3.3 scanner for raw legacy-prefixed env reads (prefix built from H.SLUG). The comment examples at L22-23 are the exact forms it must catch. |
| `tests/regression/S-OS-06/skill-namespace.test.js` | 66 | explicit | self (falsifier) | tests the warp: -> mc: skill-namespace rewrite, its enumeration boundary (non-enumerated legacy skills untouched), path renames of .claude/commands/warp/*.md and the named residual counter. Every legacy token is rewrite input or expected residual. |

**A with pin OWED: 12 files** (`_planning/epics/E-OPEN-SOURCE-001.md`, `.claude/project/sprint/requirements/S-OS-06/acceptance-criteria.md`, `.claude/project/sprint/requirements/S-OS-06/granular-stories.md`, `.claude/project/sprint/requirements/S-OS-06/high-level-stories.md`, `.claude/project/sprint/requirements/S-OS-06/prd.md`, `.claude/project/sprint/requirements/S-OS-06/qa-plan.md`, `.claude/project/sprint/requirements/S-OS-06/release-plan.md`, `.claude/project/sprint/requirements/S-OS-06/trace.md`, `migrations/0.0.0-to-0.1.0/004-rename-warp-sync-to-update.js`, `migrations/0.1.x-to-0.2.0/001-rename-warpos-to-framework.js`, `migrations/0.1.x-to-0.2.0/003-rename-docs-to-_docs.js`, `migrations/0.1.x-to-0.2.0/004-paths-schema-v4-to-v5.js`). A's disposition requires a pin, so each is an A admission with an owed test, not a settled one.

## RESIDUE (the fix population): 206 files, per file

### Explicit decisions (60 files, 314 occ)

| File | Occ | Name hit | Sub | Reason |
|---|---:|---|---|---|
| `_planning/design/WARP-cross-project-nervous-system.md` | 61 | yes | fix+rename | header: 'DESIGN SPEC, NOT BUILT … for the main thread to build later'. It is forward-looking, so it is an INSTRUCTION, not a record. It proposes skills in the legacy namespace (emit/watch/staged update), a legacy HOME bus path, and a legacy-branded layer and charter name. The filename carries the legacy name. The 'verified-real gap as of 0.15.1' lines (L28-38) are B-lines inside a live spec. |
| `_planning/epics/E-DISPATCH-PERFECT-001.md` | 2 |  | fix | plan artifact of an ACTIVE epic (trackers/epics: Current state Active, ~92%). The goal line (L10) and background (L13) name the live system by the legacy brand. A live plan's goal is not a record. |
| `_planning/epics/E-DISPATCH-SHAPE-001.md` | 5 |  | fix | plan artifact of an ACTIVE epic (~88%). L101 (the W2 ramp design, including the run-correlation env) and L122 prescribe ramp, kill-switch and correlation env names with the legacy prefix. Scripts read the MC_ names (scripts/dispatch-agent.js:835-843), and the legacy names work only through the read-both compat window expiring 2.1.0. This is an instruction, not a record. |
| `_planning/epics/README.md` | 1 |  | fix | LIVE README of the epics dir. L7 cites the legacy-named compat shim as the MUST_NOT_SHIP enforcer; canonical is scripts/checks/mc-ship-coverage.js. |
| `_planning/playbooks/launch-readiness-playbook.md` | 1 |  | fix | LIVE playbook step (L54) names the framework by the legacy brand in an operative instruction. |
| `_planning/playbooks/mode-switch-playbook.md` | 2 |  | fix | LIVE playbook: it tells the reader to run the legacy health skill (L24; deprecated alias expiring 2.1.0), and its use-when (L11) carries the legacy brand. |
| `_planning/playbooks/provider-setup-playbook.md` | 11 |  | fix | LIVE playbook. The commands at L32/L36-38/L52/L57 run node scripts/warpos/provider-*.js, a path ABSENT at head (scripts/mc/provider-tier-check.js exists). The legacy health skill (L31/L57) is a deprecated alias, and L11/L13/L18 use the legacy brand. |
| `_planning/playbooks/SUITE-DESIGN.md` | 2 |  | fix | LIVE playbook-suite design. It composes the legacy health skill (L33/L49), a deprecated alias expiring 2.1.0 (canonical /mc:health). |
| `_planning/principle.md` | 7 |  | fix | self-declared 'canonical doctrine … working doctrine' (LIVE). The title and doctrine lines use the legacy brand (L1/L10/L37/L47). L4 cites _planning/ingest/warpos-lifecycle.md, ABSENT at head. L6 cites the lifecycle plan by its real (test-pinned) filename, which resolves and is not a fix unless that file is renamed. The L113 provenance line is a B-line. |
| `_planning/README.md` | 4 |  | fix | LIVE store README describing present wiring. L1 names the system by the legacy brand. L57 cites scripts/warpos/manifest/walk-skip.js, ABSENT at head (it is under scripts/mc/manifest/). L58 cites the legacy-named compat shim as the enforcer (canonical mc-ship-coverage.js). L19 names a B-admitted file by its real filename, which is not a fix unless that file is renamed. |
| `_planning/warpos-lifecycle-plan.md` | 32 | yes | fix | plan of E-LIFECYCLE-001, which is ACTIVE (trackers/epics: Active, ~94%). It carries live-shaped instructions and present-tense claims with legacy identifiers that no longer resolve at head: legacy-prefixed gate and kill-switch env names (L90/L107/L455, which scripts/ does not read under those names; only the codemod registers carry them), scripts/warpos/provider-tier-check.js (L334/L482, ABSENT), and the legacy setup script line ref plus legacy health skill (L129). The FILENAME is TEST-PINNED as a kept class-4 path by tests/regression/S-OS-06/denylist.test.js:113-114, so a rename must move that pin in the same change. |
| `_reports/README.md` | 4 |  | fix | LIVE README. L71/L73/L86 describe the present repo ('In canonical WarpOS (this repo) …') by the legacy brand. |
| `.claude/agents/president/_system/policy/adr/0013-two-dispatch-shape-gates.md` | 6 |  | fix | CONTRADICTS the expectation of zero residue for decision records. The body (L32) is record, but 'Mitigations / escapes' (L81-83) and 'Reversal plan' (L87) are OPERATIVE instructions ('Set <legacy-prefix>_DISPATCH_CONTRACT_ENFORCE=report …') naming legacy-prefixed env names. Scripts read the MC_ names (e.g. scripts/dispatch-agent.js:835-843), and the legacy names are honoured only through the read-both compat window expiring 2.1.0. An instruction is not a record. Fix form (not done here): an amendment naming the current variables, leaving the historical body intact. |
| `.claude/commands/scan/warpos-applied-migrations.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-applied-migrations (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-capsule-resolvable.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-capsule-resolvable (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-install-baseline.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-install-baseline (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-layer-diff.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-layer-diff (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-manifest-coverage.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-manifest-coverage (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-manifest-honesty.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-manifest-honesty (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-migration-coverage.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-migration-coverage (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-migration-presence.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-migration-presence (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-path-resolution.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-path-resolution (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-ship-coverage.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-ship-coverage (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-staleness.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-staleness (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-structure-parity.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-structure-parity (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-tracked-transients.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-tracked-transients (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/scan/warpos-version-quorum.md` | 5 | yes | compat-seam | deprecated alias skill forwarding to /scan:mc-version-quorum (registered compat, expires 2.1.0). Neither property per the spec table. Disposition is compat or REMOVED. |
| `.claude/commands/warp/check.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:check (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/deprecate.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:deprecate (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/diff.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:diff (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/doctor.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:doctor (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/flag.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:flag (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/health.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:health (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/md.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:md (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/reconcile.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:reconcile (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/release.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:release (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/setup.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:setup (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/sync.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:sync (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/tour.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:tour (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/uninstall.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:uninstall (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/commands/warp/update.md` | 5 |  | compat-seam | deprecated alias skill forwarding to /mc:update (registered compat, expires 2.1.0). The STOP-CONDITION section 1 evidence table rules alias shims NEITHER property. Disposition is compat-with-expiry or REMOVED, never FIXED. Tension recorded: the function test alone would admit it (rewriting the alias's legacy name destroys the alias); the spec rules it out because the seam is time-boxed, not permanent. |
| `.claude/project/sprint/active-sprints.yaml` | 30 |  | fix | LIVE sprint registry (primary: S-OS-06). L1 schema: carries the LEGACY schema id, while the schemas/sprint/active-sprints.schema.json const and the writers (scripts/sprint/add-sprint.js:36, init.js:220) use the mc/ id. Registry titles are B-lines recording sprint names as minted. |
| `.claude/project/sprint/README.md` | 4 |  | fix | LIVE README of the sprint-tracker directory. It names the framework by the legacy brand in present-tense guidance (L1/L4/L44/L50). |
| `scripts/checks/warpos-applied-migrations.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-applied-migrations.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-capsule-resolvable.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-capsule-resolvable.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-enforcer-shippability.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-enforcer-shippability.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-install-baseline.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-install-baseline.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-layer-diff.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-layer-diff.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-manifest-honesty.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-manifest-honesty.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-migration-coverage.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-migration-coverage.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-migration-presence.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-migration-presence.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-path-resolution.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-path-resolution.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-promote-coverage.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-promote-coverage.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-roundtrip.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-roundtrip.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-ship-coverage.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-ship-coverage.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-staleness.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-staleness.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-structure-parity.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-structure-parity.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `scripts/checks/warpos-tracked-transients.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-tracked-transients.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. CI-BOUND: invoked by .github/workflows/leak-gate.yml:36 (see ci). |
| `scripts/checks/warpos-version-quorum.js` | 0 | yes | compat-seam | deprecated check shim forwarding to mc-version-quorum.js (registered compat, expires 2.1.0). Legacy name only (0 content occurrences). Neither property. Disposition is compat or REMOVED. |
| `tests/regression/S-OS-06/falsify-live-warpos-off-allowlist.test.js` | 2 | yes | rename | its ONLY legacy occurrences are its OWN identifier: the filename, the falsifier name in its header (L4) and its own run command (L12). The planted subject is built from H.SLUG and carries no literal. Rename the file and its self-references. The only other tree reference is the generated _mc/MANIFEST.json (regenerated), plus mentions inside S-OS-06 sprint records. |

### Sprint-body rule R-sprint-body (146 files, 699 occ)

Rule reason for a LIVE sprint (queued or active): sprint is LIVE (queued or active): its specification is a forward INSTRUCTION, so legacy identifiers and the legacy brand naming this system are live occurrences (RESIDUE). Its state files carry the legacy schema id while the schema consts and writers use mc/ (RESIDUE). Machine-path segments stay B.

Rule reason for a PLAN-ONLY sprint: registry non-terminal (status planning) with NO execution evidence (<=1 commit references the id; no tracker landing). The docs are an unexecuted forward specification queued in the live registry, i.e. an INSTRUCTION (RESIDUE). Alternative fix: retire the registry entry (cancel/supersede), which converts the docs to records (B). Machine-path segments stay B.

#### S-VLADW1-02: state live, 6 files, 57 occ

State evidence: trackers/sprints/S-VLADW1-02: Current state 'Designed, build queued (as of 2026-08-11)'. Note: some legacy test ids it names live in the out-of-tree vlad repo, so a rename there is coordinated, not in-tree

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/S-VLADW1-02/acceptance-criteria.md` | 17 | 33, 43, 44, 122, 124, 126, 128, 130, 132, 258, 266, 272, 278, 286, 294, 319 | {"other:RESIDUE":17} |
| `.claude/project/sprint/requirements/S-VLADW1-02/granular-stories.md` | 7 | 25, 28, 39, 42 | {"abspath:B":1,"other:RESIDUE":6} |
| `.claude/project/sprint/requirements/S-VLADW1-02/prd.md` | 15 | 17, 21, 25, 29, 48 | {"other:RESIDUE":6,"abspath:B":9} |
| `.claude/project/sprint/requirements/S-VLADW1-02/trace.md` | 2 | 74 | {"abspath:B":1,"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/S-VLADW1-02/current.yaml` | 15 | 1, 9, 19 | {"schema-id:RESIDUE":1,"other:RESIDUE":4,"abspath:B":10} |
| `.claude/project/sprint/sprints/S-VLADW1-02/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260519-002: state plan-only, 12 files, 103 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260519-002/acceptance-criteria.md` | 10 | 8, 10, 12, 30, 32, 34, 36, 37, 50 | {"other:RESIDUE":10} |
| `.claude/project/sprint/requirements/SP-20260519-002/copy.md` | 16 | 14, 16, 18, 20, 39, 41, 45, 47, 53, 57, 59, 61, 65 | {"other:RESIDUE":16} |
| `.claude/project/sprint/requirements/SP-20260519-002/granular-stories.md` | 16 | 8, 11, 12, 15, 45, 48, 52, 53, 64, 82 | {"other:RESIDUE":16} |
| `.claude/project/sprint/requirements/SP-20260519-002/high-level-stories.md` | 4 | 10, 11, 19, 29 | {"other:RESIDUE":4} |
| `.claude/project/sprint/requirements/SP-20260519-002/inputs.md` | 3 | 34, 41 | {"other:RESIDUE":3} |
| `.claude/project/sprint/requirements/SP-20260519-002/prd.md` | 22 | 10, 20, 25, 27, 28, 34, 40, 42, 44, 52, 53, 61, 65, 76 | {"other:RESIDUE":22} |
| `.claude/project/sprint/requirements/SP-20260519-002/qa-plan.md` | 4 | 13, 21, 33, 45 | {"other:RESIDUE":4} |
| `.claude/project/sprint/requirements/SP-20260519-002/redteam-plan.md` | 6 | 13, 15, 22, 32 | {"other:RESIDUE":6} |
| `.claude/project/sprint/requirements/SP-20260519-002/release-plan.md` | 1 | 39 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260519-002/trace.md` | 1 | 14 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260519-002/current.yaml` | 19 | 1, 4, 8, 9, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61 | {"schema-id:RESIDUE":1,"other:RESIDUE":18} |
| `.claude/project/sprint/sprints/SP-20260519-002/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-001: state plan-only, 12 files, 109 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-001/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-001/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-001/granular-stories.md` | 46 | 5, 15, 25, 28, 29, 39, 42, 43, 57, 67, 70, 71, 85, 95, 98, 99, 113, 127, 137, 140, 141, 155 | {"other:RESIDUE":46} |
| `.claude/project/sprint/requirements/SP-20260525-001/high-level-stories.md` | 11 | 5, 10, 13, 14, 23 | {"other:RESIDUE":11} |
| `.claude/project/sprint/requirements/SP-20260525-001/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-001/prd.md` | 27 | 11, 17, 21, 25, 29, 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":27} |
| `.claude/project/sprint/requirements/SP-20260525-001/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-001/redteam-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-001/release-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-001/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-001/current.yaml` | 17 | 1, 8, 9, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54 | {"schema-id:RESIDUE":1,"other:RESIDUE":16} |
| `.claude/project/sprint/sprints/SP-20260525-001/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-002: state plan-only, 10 files, 55 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-002/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-002/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-002/granular-stories.md` | 21 | 5, 15, 29, 43, 57, 71, 85, 95, 98, 99, 113, 127 | {"other:RESIDUE":21} |
| `.claude/project/sprint/requirements/SP-20260525-002/high-level-stories.md` | 5 | 5, 14, 23 | {"other:RESIDUE":5} |
| `.claude/project/sprint/requirements/SP-20260525-002/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-002/prd.md` | 13 | 11, 17, 21, 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":13} |
| `.claude/project/sprint/requirements/SP-20260525-002/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-002/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-002/current.yaml` | 10 | 1, 9, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":9} |
| `.claude/project/sprint/sprints/SP-20260525-002/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-005: state plan-only, 10 files, 45 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-005/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-005/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-005/granular-stories.md` | 13 | 5, 15, 29, 43, 57, 67, 70, 71, 81, 84, 85, 99, 113 | {"other:RESIDUE":13} |
| `.claude/project/sprint/requirements/SP-20260525-005/high-level-stories.md` | 3 | 5, 14, 23 | {"other:RESIDUE":3} |
| `.claude/project/sprint/requirements/SP-20260525-005/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-005/prd.md` | 12 | 11, 21, 29, 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":12} |
| `.claude/project/sprint/requirements/SP-20260525-005/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-005/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-005/current.yaml` | 11 | 1, 8, 9, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":10} |
| `.claude/project/sprint/sprints/SP-20260525-005/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-006: state plan-only, 10 files, 54 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-006/acceptance-criteria.md` | 2 | 2, 5 | {"other:RESIDUE":2} |
| `.claude/project/sprint/requirements/SP-20260525-006/copy.md` | 2 | 2, 5 | {"other:RESIDUE":2} |
| `.claude/project/sprint/requirements/SP-20260525-006/granular-stories.md` | 14 | 2, 5, 15, 29, 43, 57, 67, 70, 71, 81, 84, 85, 99, 113 | {"other:RESIDUE":14} |
| `.claude/project/sprint/requirements/SP-20260525-006/high-level-stories.md` | 4 | 2, 5, 14, 23 | {"other:RESIDUE":4} |
| `.claude/project/sprint/requirements/SP-20260525-006/inputs.md` | 2 | 2, 5 | {"other:RESIDUE":2} |
| `.claude/project/sprint/requirements/SP-20260525-006/prd.md` | 13 | 2, 11, 21, 29, 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":13} |
| `.claude/project/sprint/requirements/SP-20260525-006/qa-plan.md` | 2 | 1, 4 | {"other:RESIDUE":2} |
| `.claude/project/sprint/requirements/SP-20260525-006/trace.md` | 2 | 2, 5 | {"other:RESIDUE":2} |
| `.claude/project/sprint/sprints/SP-20260525-006/current.yaml` | 12 | 1, 3, 8, 9, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":11} |
| `.claude/project/sprint/sprints/SP-20260525-006/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-007: state plan-only, 10 files, 45 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-007/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-007/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-007/granular-stories.md` | 13 | 5, 15, 29, 43, 57, 67, 70, 71, 81, 84, 85, 99, 113 | {"other:RESIDUE":13} |
| `.claude/project/sprint/requirements/SP-20260525-007/high-level-stories.md` | 3 | 5, 14, 23 | {"other:RESIDUE":3} |
| `.claude/project/sprint/requirements/SP-20260525-007/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-007/prd.md` | 12 | 11, 21, 29, 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":12} |
| `.claude/project/sprint/requirements/SP-20260525-007/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-007/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-007/current.yaml` | 11 | 1, 8, 9, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":10} |
| `.claude/project/sprint/sprints/SP-20260525-007/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-008: state plan-only, 10 files, 45 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-008/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-008/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-008/granular-stories.md` | 13 | 5, 15, 29, 43, 57, 67, 70, 71, 81, 84, 85, 99, 113 | {"other:RESIDUE":13} |
| `.claude/project/sprint/requirements/SP-20260525-008/high-level-stories.md` | 3 | 5, 14, 23 | {"other:RESIDUE":3} |
| `.claude/project/sprint/requirements/SP-20260525-008/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-008/prd.md` | 12 | 11, 21, 29, 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":12} |
| `.claude/project/sprint/requirements/SP-20260525-008/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-008/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-008/current.yaml` | 11 | 1, 8, 9, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":10} |
| `.claude/project/sprint/sprints/SP-20260525-008/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-009: state plan-only, 10 files, 45 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-009/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-009/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-009/granular-stories.md` | 13 | 5, 15, 29, 43, 57, 67, 70, 71, 81, 84, 85, 99, 113 | {"other:RESIDUE":13} |
| `.claude/project/sprint/requirements/SP-20260525-009/high-level-stories.md` | 3 | 5, 14, 23 | {"other:RESIDUE":3} |
| `.claude/project/sprint/requirements/SP-20260525-009/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-009/prd.md` | 12 | 11, 21, 29, 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":12} |
| `.claude/project/sprint/requirements/SP-20260525-009/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-009/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-009/current.yaml` | 11 | 1, 8, 9, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":10} |
| `.claude/project/sprint/sprints/SP-20260525-009/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-010: state plan-only, 10 files, 26 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-010/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-010/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-010/granular-stories.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-010/high-level-stories.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-010/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-010/prd.md` | 9 | 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":9} |
| `.claude/project/sprint/requirements/SP-20260525-010/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-010/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-010/current.yaml` | 9 | 1, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":8} |
| `.claude/project/sprint/sprints/SP-20260525-010/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-011: state plan-only, 10 files, 26 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-011/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-011/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-011/granular-stories.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-011/high-level-stories.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-011/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-011/prd.md` | 9 | 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":9} |
| `.claude/project/sprint/requirements/SP-20260525-011/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-011/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-011/current.yaml` | 9 | 1, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":8} |
| `.claude/project/sprint/sprints/SP-20260525-011/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-012: state plan-only, 10 files, 26 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-012/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-012/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-012/granular-stories.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-012/high-level-stories.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-012/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-012/prd.md` | 9 | 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":9} |
| `.claude/project/sprint/requirements/SP-20260525-012/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-012/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-012/current.yaml` | 9 | 1, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":8} |
| `.claude/project/sprint/sprints/SP-20260525-012/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260525-013: state plan-only, 10 files, 26 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/requirements/SP-20260525-013/acceptance-criteria.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-013/copy.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-013/granular-stories.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-013/high-level-stories.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-013/inputs.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-013/prd.md` | 9 | 64, 65, 66, 67, 68, 69, 70, 71, 72 | {"other:RESIDUE":9} |
| `.claude/project/sprint/requirements/SP-20260525-013/qa-plan.md` | 1 | 4 | {"other:RESIDUE":1} |
| `.claude/project/sprint/requirements/SP-20260525-013/trace.md` | 1 | 5 | {"other:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260525-013/current.yaml` | 9 | 1, 45, 46, 47, 48, 49, 50, 51, 52 | {"schema-id:RESIDUE":1,"other:RESIDUE":8} |
| `.claude/project/sprint/sprints/SP-20260525-013/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### S-OS-06: state live, 2 files, 23 occ

State evidence: active-sprints.yaml primary: S-OS-06; TRACKER.md: BRANCH STILL NOT LANDED

Reason: the CURRENT rename sprint. Its requirement and state prose has the legacy literal as the SUBJECT of the rename specification (what to rename, what stays pinned, the H-1 historical set), so rewriting it destroys the spec's function (A, specification-subject; pin OWED). Its live state files (current.yaml, progress.yaml) carry the legacy schema id on the schema line while the schema consts and writers use mc/ (RESIDUE). Machine-path segments stay B.

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/sprints/S-OS-06/current.yaml` | 22 | 1 | {"schema-id:RESIDUE":1,"other:A":11,"abspath:B":10} |
| `.claude/project/sprint/sprints/S-OS-06/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### S-VLADW1-06: state live, 2 files, 2 occ

State evidence: commit 398533eb minted registry entry + PC-20260830-0089; open successor of S-VLADW1-05

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/sprints/S-VLADW1-06/current.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |
| `.claude/project/sprint/sprints/S-VLADW1-06/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260528-003: state plan-only, 2 files, 2 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/sprints/SP-20260528-003/current.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260528-003/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260528-004: state plan-only, 2 files, 2 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/sprints/SP-20260528-004/current.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260528-004/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260606-001: state plan-only, 2 files, 2 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/sprints/SP-20260606-001/current.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260606-001/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260612-001: state plan-only, 2 files, 2 occ

State evidence: git log --grep: <=1 commit references the id at 56a16fc1; no tracker landing line found

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/sprints/SP-20260612-001/current.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260612-001/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260725-002: state live, 2 files, 2 occ

State evidence: trackers/sprints/SP-20260725-002: Current state Active

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/sprints/SP-20260725-002/current.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260725-002/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

#### SP-20260830-001: state live, 2 files, 2 occ

State evidence: TRACKER.md 2026-08-30: added by the runtime as the enforcer successor; open

| File | Occ | Live lines | Occurrence tally |
|---|---:|---|---|
| `.claude/project/sprint/sprints/SP-20260830-001/current.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |
| `.claude/project/sprint/sprints/SP-20260830-001/progress.yaml` | 1 | 1 | {"schema-id:RESIDUE":1} |

## Set B: 1437 files

| Rule | Files | Occ | Reason |
|---|---:|---:|---|
| explicit | 79 | 471 | per-file, see the table below |
| R-sprint-records | 336 | 3059 | sprint-machinery RECORD: dated plan-contract snapshots, sprint history, release records, ralph loop logs, approvals, external-service decisions, the append-only routing trace and issue records. Each records something that happened, and its legacy literals (including the legacy schema ids of the time) are part of that record (B). |
| R-sprint-body | 759 | 3691 | per-sprint state, see the appendix |
| R-release-capsule | 162 | 13004 | release capsule (changelog, framework-manifest, release.json, upgrade-notes, checksums) is the record of what shipped under that tag. Its legacy names and commands are what that release actually said. checksumPinned is verified per file against the capsule's checksums.json. |
| R-runtime-record | 84 | 1689 | per-run artifact (reports, consult prompts and outputs, gauntlet briefs, discovery corpora, scan outputs, and the one-shot generator/fixture scripts recorded with the output they produced). A dated record of that run. Spot-read for live instructions: the S-OS-03 downstream notice (dated 2026-09-03 as issued), the wave-1 sprint specs (ACs satisfied), and the credential-custody ADR draft (header: PROMOTED 2026-08-03, accepted copy in the ADR dir) are all records. |
| R-r4-measurement-record | 17 | 1940 | section 7b: the round's own measurement artifacts (join member sets, oracle printouts, inventories, lane reports) carry legacy tokens AS MEASUREMENT RECORDS. They are inside the swept population and admitted as records, not excluded by path. Contribution emitted under section7b. |

### B, explicit decisions (79 files)

| File | Occ | Reason |
|---|---:|---|
| `_archive/root-2026-07-26/DISPATCH-ERRORS.md` | 2 | root document archived 2026-07-26; content and filename are the record's identity. DISAGREEMENT RECORDED: ENTRY-LEVEL-READING.md says two archive filenames 'rename per the clear-the-live-surface ruling', but no such ruling text was found in STOP-CONDITION.md, runtime/S-OS-06/** or the S-OS-06 requirements, so it is not applied here. By the property test an archived filename is record identity (B). |
| `_archive/root-2026-07-26/MASTERCONSOLE-PROMPT.md` | 8 | root document archived 2026-07-26; content and filename are the record's identity. DISAGREEMENT RECORDED: ENTRY-LEVEL-READING.md says two archive filenames 'rename per the clear-the-live-surface ruling', but no such ruling text was found in STOP-CONDITION.md, runtime/S-OS-06/** or the S-OS-06 requirements, so it is not applied here. By the property test an archived filename is record identity (B). Its GATED 'do not execute' instructions are the archived prompt's own record. |
| `_archive/root-2026-07-26/NOTAGAIN.md` | 5 | root document archived 2026-07-26; content and filename are the record's identity. DISAGREEMENT RECORDED: ENTRY-LEVEL-READING.md says two archive filenames 'rename per the clear-the-live-surface ruling', but no such ruling text was found in STOP-CONDITION.md, runtime/S-OS-06/** or the S-OS-06 requirements, so it is not applied here. By the property test an archived filename is record identity (B). |
| `_archive/root-2026-07-26/WARPOS-ISSUES.md` | 6 | root document archived 2026-07-26; content and filename are the record's identity. DISAGREEMENT RECORDED: ENTRY-LEVEL-READING.md says two archive filenames 'rename per the clear-the-live-surface ruling', but no such ruling text was found in STOP-CONDITION.md, runtime/S-OS-06/** or the S-OS-06 requirements, so it is not applied here. By the property test an archived filename is record identity (B). |
| `_archive/root-2026-07-26/WARPOS-PROMPT.md` | 8 | root document archived 2026-07-26; content and filename are the record's identity. DISAGREEMENT RECORDED: ENTRY-LEVEL-READING.md says two archive filenames 'rename per the clear-the-live-surface ruling', but no such ruling text was found in STOP-CONDITION.md, runtime/S-OS-06/** or the S-OS-06 requirements, so it is not applied here. By the property test an archived filename is record identity (B). |
| `_planning/epics/E-PRODUCT-FOUNDATION-001.md` | 3 | plan of a COMPLETED epic (trackers/epics: Completed, 100%, 2026-06-16). The legacy check and team names (L77/L87/L98) were instructions to that epic's own waves, all executed, and are now a record. |
| `_planning/plans/FINAL-PLAN.md` | 9 | dated 2026-05-30 system-update plan whose waves executed (the department org rewrite landed). The legacy brand is the system's name at authoring, and the deferred W-Platform CLI name (L93) records what was proposed then. |
| `_planning/plans/MASTERPLAN.md` | 4 | 'CONSOLIDATED FINAL DRAFT … execution HELD', superseded by FINAL-PLAN v1.1. The L12-13 layout and edit guidance records the canonical layout as of May 2026. A superseded draft is a record. |
| `_planning/plans/PONDER-real-shape.md` | 6 | dated analysis output. The legacy brand names the system as it was at authoring. |
| `_planning/reviews/dump-review-prompt.md` | 10 | the review request exactly as sent to an external reviewer (a consult-input record). |
| `_planning/reviews/final-review-consult.txt` | 6 | the consult prompt exactly as sent (a record). |
| `_planning/reviews/final-review-out.json` | 2 | the provider's review output JSON (a record of what the reviewer returned). |
| `_planning/sources/SOURCES.md` | 3 | dated source-batch log including a verbatim operator quote (L36). Rewriting the quote falsifies it. |
| `_planning/warpos-1.0-plan/ed060-c-serve-runbook.md` | 3 | the runbook is operative in genre, but its occurrences are (a) the 1.0 plan's recorded name (L4) and (b) the REAL current path of its payload inside the B-admitted 1.0-plan directory (L6/L15). Both are true and resolve at head. If that directory is ever renamed, L6/L15 become live references to fix. Whether ED-060(c) is closed was NOT established, and the disposition does not depend on it. |
| `_planning/warpos-1.0-plan/evidence/cabinet-consult-gpt56sol-ultra.md` | 4 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/enforcement-audit.md` | 9 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/execution-folds-20260718.md` | 2 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/hardening-20260717/alpha-eyeball-rulings.md` | 2 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/hardening-20260717/cabinet-sol-reharden-verdict.md` | 2 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/hardening-20260717/discrepancies.md` | 8 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/hardening-20260717/sol-reharden-prompt.md` | 7 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/hardening-20260717/verify-claims.md` | 10 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/packet-analysis.md` | 12 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/runtime-hygiene.md` | 11 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/evidence/sp-20260717-001-gauntlet-findings.md` | 3 | dated evidence record from the 1.0 plan's hardening and execution (consult outputs, audits, probes, verified claims with the machine paths they ran against). |
| `_planning/warpos-1.0-plan/GEMINI-DEEPCLEAN-AND-AGY-MIGRATION.md` | 4 | consolidated plan labelled for the WarpOS 1.0 release (released 2026-07-23). The legacy brand is that release's name, and L35 records a dated deferral. |
| `_planning/warpos-1.0-plan/HARDENING-CHANGES.md` | 3 | operator-facing change ledger of the 2026-07-17 hardening (a record). |
| `_planning/warpos-1.0-plan/packet-original/00-README.md` | 7 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/01-MASTER-PROMPT-FOR-CLAUDE.md` | 11 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/02-WARPOS-1.0-CHARTER.md` | 6 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/03-ADR-DURABLE-COMPANY-EPHEMERAL-EXECUTORS.md` | 3 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/04-INTEROPERABILITY-SYSTEM.md` | 6 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/05-INSTRUCTION-COMPILER.md` | 7 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/06-WORKORDER-RESULTENVELOPE-SPEC.md` | 3 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/07-SPRINTROOM-PERSISTENCE.md` | 3 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/09-PACKS-CATALOG.md` | 2 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/10-WEBAPP-PRODUCTION-BASELINE-PACK.md` | 1 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/11-FOUNDER-PANEL-PACK.md` | 1 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/12-OBSERVABILITY-MEMORY-LEARNING.md` | 2 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/13-WARPOS-1.0-CHECKLIST.md` | 2 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/14-FIRST-SPRINTS.md` | 2 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/15-VERIFICATION-GATES.md` | 3 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/16-TOP-LEVEL-AI-PORTABILITY.md` | 5 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/17-DO-NOT-BUILD.md` | 1 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/18-SOURCE-INDEX.md` | 8 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/templates/AGENTS.md.template` | 2 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/templates/CLAUDE.md.template` | 1 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/templates/GEMINI.md.template` | 1 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/templates/ResultEnvelope.schema.md` | 1 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/packet-original/templates/WorkOrder.schema.md` | 1 | verbatim copy of the externally generated 2026-06-28 finish packet as RECEIVED (packet-original), superseded by RATIFIED-PLAN. Its imperative prompts and templates record the input; they are not live instructions. Nothing in scripts/ instantiates these templates (scripts/checks/authority-pollution-scan.js references packet-original only as a scan subject). Any legacy-named filename is the packet's own name. |
| `_planning/warpos-1.0-plan/RATIFIED-PLAN.md` | 26 | the 2026-07-17 ratified 1.0 kernel plan, executed through the 1.0.0 release. Its legacy identifiers (an installer function name, the legacy setup script, the legacy release chain) record the audit and plan state at ratification. |
| `_reports/E-LIFECYCLE-001-capstone-validation.md` | 2 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/E-MC-READINESS-findings-register.md` | 3 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/E-MC-READINESS-track1-hardening-simulation.md` | 3 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/E-MC-READINESS-track2-security.md` | 10 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/E-MC-READINESS-track3-edge-cases.md` | 7 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/E-MC-READINESS-track4-release-pipeline-analysis.md` | 4 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/E-MC-READINESS-track6-prose-vs-enforcement.md` | 4 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/epics/E-CONTENT-DELIVERY-001.md` | 15 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/sessions/2026-05-31-system-reconciliation.md` | 2 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/sessions/2026-05-31.md` | 4 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/sessions/2026-06-01-models-suite-and-0.13.x-releases.md` | 7 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/sessions/2026-06-01-phase-b-guides-suite.md` | 1 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/sessions/2026-06-02.md` | 6 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/sessions/2026-06-10-1715.md` | 7 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/sprints/SP-20260531-001.md` | 3 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `_reports/sprints/SP-20260531-004.md` | 5 | dated report (session, sprint, epic or readiness track) describing the system, identifiers and code paths as they stood when written. |
| `.claude/agents/president/_system/policy/adr/0001-warp-promote-location.md` | 7 | decision record: the decision was to build the legacy promote skill in DevRepo first. The filename and title record the decision's subject as named then. |
| `.claude/agents/president/_system/policy/adr/0006-sealed-capsule-consumer-contract-gate.md` | 3 | decision record describing the installer (legacy setup script) and options as they stood at decision time. |
| `.claude/agents/president/_system/policy/adr/0009-epsilon-sprint-runtime.md` | 1 | decision record: the legacy-prefixed gating flag (L11) describes how the runtime was gated when decided. |
| `.claude/agents/president/_system/policy/adr/0034-gate-a-fresh-scaffold-all-ways-sandbox-isolation.md` | 3 | decision record: the legacy-prefixed root and registry env seams (L33/L35/L42) describe the mechanism the decision relied on when taken. |
| `.claude/agents/president/_system/policy/adr/INDEX.md` | 2 | the index row (L47) mirrors ADR-0001's recorded title and actual filename (a B member). |
| `.claude/dreams/2026-05-13.md` | 2 | dated sleep-cycle record (journal/dream). Legacy commands and brand record what the system was and did on those nights. |
| `.claude/dreams/2026-05-21.md` | 18 | dated sleep-cycle record (journal/dream). Legacy commands and brand record what the system was and did on those nights. |
| `.claude/dreams/2026-09-12.md` | 2 | dated sleep-cycle record (journal/dream). Legacy commands and brand record what the system was and did on those nights. |
| `.claude/dreams/coaching.md` | 28 | append-only dated briefings. Each was addressed to ONE next session long past, so each is now a record. DELIVERY CAVEAT (not a fix to this file): scripts/hooks/session-start.js:170 injects dreams/coaching.md into live sessions, where stale sections read as instructions with legacy commands (observed in this lane's own session context: the 2026-05-13 briefing). That is a session-start selection defect outside this population. |
| `.claude/dreams/journal.md` | 42 | dated sleep-cycle record (journal/dream). Legacy commands and brand record what the system was and did on those nights. |
| `docs/PROVENANCE.md` | 22 | **PROVISIONAL** PROVISIONAL, NOT SETTLED. Property B's strongest member: its legacy tags, brand-history phrase and legacy command names are the record of what the project was called and shipped as, and rewriting falsifies that record. Disposition provisional on the operator Class C (the maximal reading of 'this was never WarpOS'). |
| `migrations/0.1.x-to-0.2.0/002-rename-requirements-to-_requirements.js` | 1 | PROPERTY TEST DIVERGES FROM CLASS: the only occurrence is the header comment (L2) naming the product line it migrated (WarpOS 0.1.x -> 0.2.0). Rewriting it breaks no function, so it is not A. It records which release line the migration was written for, so it is B. |

## CANNOT-ASSESS: 5 files, named

| File | Occ | Sprint | State evidence | Reason |
|---|---:|---|---|---|
| `.claude/project/sprint/sprints/_no-active-sprint/reasoning-auto-approval.md` | 1 | _no-active-sprint | registry status: unregistered; no execution evidence recorded | per occurrence: (1) the checkout directory name inside an absolute machine path records where the document lived (B, whatever the sprint state); (2) a legacy schema id on a state file's schema line is live state data iff the sprint is live (the schema consts and writers use mc/), and a record iff terminal; (3) every other occurrence takes the sprint's established state. |
| `.claude/project/sprint/sprints/SP-20260528-002/current.yaml` | 1 | SP-20260528-002 | trackers: 'Active/Planned — test-suite foundation + planning (shipped the enforcer + 28-class regression …)' (partially executed; terminal state not established) | state not established inside the time box |
| `.claude/project/sprint/sprints/SP-20260528-002/progress.yaml` | 1 | SP-20260528-002 | trackers: 'Active/Planned — test-suite foundation + planning (shipped the enforcer + 28-class regression …)' (partially executed; terminal state not established) | state not established inside the time box |
| `.claude/project/sprint/sprints/SP-20260619-001/current.yaml` | 1 | SP-20260619-001 | registry status: unregistered; no execution evidence recorded | per occurrence: (1) the checkout directory name inside an absolute machine path records where the document lived (B, whatever the sprint state); (2) a legacy schema id on a state file's schema line is live state data iff the sprint is live (the schema consts and writers use mc/), and a record iff terminal; (3) every other occurrence takes the sprint's established state. |
| `.claude/project/sprint/sprints/SP-20260619-001/progress.yaml` | 1 | SP-20260619-001 | registry status: unregistered; no execution evidence recorded | per occurrence: (1) the checkout directory name inside an absolute machine path records where the document lived (B, whatever the sprint state); (2) a legacy schema id on a state file's schema line is live state data iff the sprint is live (the schema consts and writers use mc/), and a record iff terminal; (3) every other occurrence takes the sprint's established state. |

None of these is admitted. Each one is a single occurrence whose sprint's terminal or live state was not established inside the earlier time box.

## The single continuous-integration hit: identified, NOT adjudicated, NOT edited

- `.github/workflows/leak-gate.yml` (1 occ, partition class-2 path-glob '.github/**'): IDENTIFIED, NOT ADJUDICATED (property D unruled). L36, step 'tracked-transients', runs node scripts/checks/warpos-tracked-transients.js: the CI binding to the legacy-named compat shim, which is the binding lane J Part 2 stopped on per the brief. It sits under .github/workflows/, so any change is operator-run (the classifier auto-denies edits there). Not edited.

Set: **CI-UNRULED** (property D is unruled). The file is under `.github/**`, which this lane may not touch.

## Provenance document: PROVISIONAL, not settled

- `docs/PROVENANCE.md`: 22 occurrences, recorded as set **B** with `provisional: true`.
- PROVISIONAL, NOT SETTLED. Property B's strongest member: its legacy tags, brand-history phrase and legacy command names are the record of what the project was called and shipped as, and rewriting falsifies that record. Disposition provisional on the operator Class C (the maximal reading of 'this was never WarpOS').
- **The disposition is provisional on an operator (Class C) decision.** It is counted in B above only so the tallies reconcile; it is not a settled B admission.

## The 21 authored join members (lane G `join-authored-for-K.json`), adjudicated

Source: `runtime/S-OS-06/r4/join-authored-for-K.json`. Lane G's join was measured at `73b36112` and written on `56139ca3`; its counts are `{"members":43,"authored":21,"rewrite":22}`. **Tally: `{"B":9,"RESIDUE":2,"A":10}`** (21 members).

Position re-verification at `53cf07d1`: **18/21 verify at lane G's coordinates.** The other 3 are **line drift, not a missing token**. Checked by hand: the current-lab token and lane G's line excerpt sit at the SAME column on a shifted line.
- member 4: `scripts/open-source/partition-loader.js` 73:18 is now **75:18** (+2 lines). The excerpt text matches; the only textual difference is lane G's hex escaping of the at-sign.
- member 5: `scripts/open-source/partition-loader.js` 74:96 is now **76:96** (+2 lines). The excerpt matches.
- member 7: `scripts/open-source/rename-mc.denylist.json` 924:109 is now **1232:109** (+308 lines, from lane B/J denylist growth). The excerpt matches.

| # | Location (lane G coordinates) | Verified at head | Set | Reason |
|---:|---|---|---|---|
| 1 | `TRACKER.md:7:6707` | yes | **B** | tracker narrative RECORDING an event: the epic and ROADMAP had been rewritten to the current-lab token and were restored in gauntlet fix-cycle r2. The token is quoted as the falsified string; rewriting it falsifies the account. Occurrence-grain admission inside a class-1 live file. |
| 2 | `runtime/S-OS-06/gauntlet/fix-brief-r2.md:33:76` | yes | **B** | executed r2 fix brief: the token is the subject of a restore instruction that was carried out. A record of the brief as issued. |
| 3 | `runtime/S-OS-06/gauntlet/fix-brief-r2.md:33:156` | yes | **B** | same brief line: 'does not exist as a tag' is the brief's recorded finding (and stays true: no current-lab tag of a pre-2.0 version will be minted). |
| 4 | `scripts/open-source/partition-loader.js:73:18` | drifted (see above) | **RESIDUE** | code COMMENT asserting in the present tense that the current-lab tag glob lists nothing. A comment has no function, so not A. It is a present-tense claim, not a record, so not B. It self-falsifies the moment the operator mints the 2.0.0 tag. Fix the sentence (bound it to 'before 2.0.0' or compute it). Inside a class-1 live file, so it is outside the allow-listed population as a file. |
| 5 | `scripts/open-source/partition-loader.js:74:96` | drifted (see above) | **B** | RECORDS a specific event: the 7021ff55 apply rewrote the legacy 0.1.4 tag to the current lab. Rewriting it falsifies the record of that commit. |
| 6 | `scripts/open-source/rename-mc.denylist.json:66:136` | yes | **A** | warrant text inside the denylist register (an instrument, test-pinned by denylist.test.js). The current-lab token is the SUBJECT of the warrant (the rewrite that must not happen). Rewriting it makes the warrant contradict itself. |
| 7 | `scripts/open-source/rename-mc.denylist.json:924:109` | drifted (see above) | **A** | same warrant in the register's per-entry form; subject of the instrument's pin. A, pinned by denylist.test.js. |
| 8 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:6:90` | yes | **RESIDUE** | header COMMENT with the same self-expiring present-tense claim as member 4 (the current-lab glob 'is empty'). The test itself computes the real tag list at L86 and does not depend on the sentence. The file is A. This occurrence is not, because the sentence goes false at the 2.0.0 mint. |
| 9 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:8:43` | yes | **B** | RECORDS the 7021ff55 falsification this falsifier exists for (legacy 0.1.4 -> current lab). |
| 10 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:19:31` | yes | **A** | describes the test's own method (driven by git tag -l over the current-lab glob, fail-closed). The literal is the function's subject, test-pinned by the file itself. |
| 11 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:86:29` | yes | **A** | FUNCTIONAL: gitTags() over the current-lab glob computes the real tag set the assertion compares against. Rewrite it and the falsifier queries the wrong lab. |
| 12 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:87:25` | yes | **A** | explains the functional query's single-method negative (β R5); subject of the method. |
| 13 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:107:33` | yes | **A** | grammar example: a git-ref ASSERTION form the falsifier must catch (subject). |
| 14 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:107:47` | yes | **A** | grammar example (subject). |
| 15 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:107:65` | yes | **A** | grammar example (subject). |
| 16 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:108:7` | yes | **A** | counter-example: a DESCRIPTION the grammar must NOT match (subject). |
| 17 | `tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:108:67` | yes | **A** | counter-example: a version-milestone phrase the grammar must NOT match (subject). |
| 18 | `trackers/epics/E-OPEN-SOURCE-001-master-console-open-source.md:47:1268` | yes | **B** | RECORDS a verified security-review finding (four more falsified current-lab 0.14.0 tag refs). |
| 19 | `trackers/epics/E-OPEN-SOURCE-001-master-console-open-source.md:76:353` | yes | **B** | RECORDS the finding that the current-lab 0.1.4 tag does not exist (it never will: the current lab starts at 2.0.0). |
| 20 | `trackers/epics/E-OPEN-SOURCE-001-master-console-open-source.md:76:456` | yes | **B** | RECORDS what the codemod had rewritten the criteria to. |
| 21 | `trackers/epics/E-OPEN-SOURCE-001-master-console-open-source.md:238:16` | yes | **B** | decision-table row RECORDING an adjudicated question about the string the codemod injected. |

The 2 authored RESIDUE members are both present-tense comments claiming the current-lab tag glob lists nothing. A comment has no function, so it is not A, and a present-tense claim is not a record, so it is not B. They are member 4 (`scripts/open-source/partition-loader.js:73`) and member 8 (`tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js:6`).

## Held referral (routed to α, not admitted)

- `scripts/mc/test-upgrade-current-to-new.js:1262:61` (provenance rewrite): LOAD-BEARING AS THE FILE STANDS: the literal is the mocked git-tag stdout of selfTest()'s F1 positive control, and tagExists() (L120/L132) builds and compares the tag through the current-lab interpolation template. Rewriting (restoring) this literal alone makes the positive control FAIL, so the function test is met. The function it serves is itself in dispute: for a pre-2.0 version the real tag is under the legacy lab, so tagExists queries a lab no such tag lives under. NOT ADMITTED here. Property A holds only derivatively, and the live-code decision routes to α as lane G stated.

## Directory-name occurrences (the inventory's name hit reads basenames only)

| Directory | Tracked allow-listed files | Set | Reason |
|---|---:|---|---|
| `.claude/commands/warp` | 14 | **RESIDUE** (compat-seam) | the deprecated alias-skill namespace directory (registered compat, expires 2.1.0). Neither property. Disposition compat or REMOVED. |
| `_planning/warpos-1.0-plan` | 45 | **B** | names the WarpOS 1.0 release plan as it was called; that release shipped 2026-07-23. |
| `runtime/warpos-v1-discovery` | 21 | **B** | per-run discovery corpus named for the v1-rebuild discovery of that date. |

## Reproduce

```
node runtime/S-OS-06/r4/lane-k/inventory-k.js --oracle <abs>/runtime/S-OS-06/r4/oracles/oracle-iv-occupancy.js --out <tmp>/inventory.json
node runtime/S-OS-06/r4/lane-k/adjudicate-k.js --inventory <tmp>/inventory.json --decisions runtime/S-OS-06/r4/lane-k/adjudication-k.decisions.json --out <tmp>/adjudication.json
```

Run on a clean tracked tree at `53cf07d1`. Adding tracked files under `runtime/**` (such as this report or the out.json) moves the population by exactly those files.

## Appendix: every rule-admitted B file, by rule

<details><summary>R-sprint-records: 336 files, 3059 occ</summary>

Reason: sprint-machinery RECORD: dated plan-contract snapshots, sprint history, release records, ralph loop logs, approvals, external-service decisions, the append-only routing trace and issue records. Each records something that happened, and its legacy literals (including the legacy schema ids of the time) are part of that record (B).

- `.claude/project/sprint/approvals/AP-20260512-001.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260513-002.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260513-003.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260513-004.yaml` (4)
- `.claude/project/sprint/approvals/AP-20260513-005.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260513-006.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260513-007.yaml` (6)
- `.claude/project/sprint/approvals/AP-20260513-008.yaml` (5)
- `.claude/project/sprint/approvals/AP-20260513-009.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260513-010.yaml` (3)
- `.claude/project/sprint/approvals/AP-20260513-011.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260513-012.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260513-013.yaml` (3)
- `.claude/project/sprint/approvals/AP-20260514-014.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260514-015.yaml` (3)
- `.claude/project/sprint/approvals/AP-20260514-016.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260518-017.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260518-018.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260518-019.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260518-020.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260518-021.yaml` (3)
- `.claude/project/sprint/approvals/AP-20260519-022.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260521-023.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260521-024.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260521-025.yaml` (3)
- `.claude/project/sprint/approvals/AP-20260521-026.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260521-027.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260611-028.yaml` (1)
- `.claude/project/sprint/approvals/AP-20260612-029.yaml` (3)
- `.claude/project/sprint/decisions/routing-trace.jsonl` (463)
- `.claude/project/sprint/external-services/ESD-20260513-001.yaml` (1)
- `.claude/project/sprint/external-services/ESD-20260521-002.yaml` (1)
- `.claude/project/sprint/external-services/ESD-20260521-003.yaml` (1)
- `.claude/project/sprint/external-services/ESD-20260521-004.yaml` (1)
- `.claude/project/sprint/external-services/ESD-20260521-005.yaml` (4)
- `.claude/project/sprint/external-services/ESD-20260521-006.yaml` (3)
- `.claude/project/sprint/external-services/ESD-20260521-007.yaml` (2)
- `.claude/project/sprint/external-services/ESD-20260521-008.yaml` (2)
- `.claude/project/sprint/external-services/ESD-20260521-009.yaml` (1)
- `.claude/project/sprint/history/S-PF-01/retro.md` (1)
- `.claude/project/sprint/history/S-PF-01/retro.yaml` (2)
- `.claude/project/sprint/history/S-VLADW1-03/retro.md` (2)
- `.claude/project/sprint/history/S-VLADW1-03/retro.yaml` (3)
- `.claude/project/sprint/history/S-VLADW1-04/retro.yaml` (2)
- `.claude/project/sprint/history/SP-20260512-001/retro.md` (1)
- `.claude/project/sprint/history/SP-20260512-001/retro.yaml` (2)
- `.claude/project/sprint/history/SP-20260512-001/sprint-history.yaml` (4)
- `.claude/project/sprint/history/SP-20260513-001/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260513-002/retro.md` (14)
- `.claude/project/sprint/history/SP-20260513-002/retro.yaml` (15)
- `.claude/project/sprint/history/SP-20260513-003/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260513-004/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260513-004/retro.yaml.partial` (1)
- `.claude/project/sprint/history/SP-20260513-005/retro.md` (27)
- `.claude/project/sprint/history/SP-20260513-005/retro.yaml` (28)
- `.claude/project/sprint/history/SP-20260514-002/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260518-001/retro.md` (1)
- `.claude/project/sprint/history/SP-20260518-001/retro.yaml` (2)
- `.claude/project/sprint/history/SP-20260518-001/sprint-history.yaml` (3)
- `.claude/project/sprint/history/SP-20260518-007/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260518-008/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260518-009/sprint-history.yaml` (11)
- `.claude/project/sprint/history/SP-20260521-001/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260523-001/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260523-002/retro.md` (3)
- `.claude/project/sprint/history/SP-20260523-002/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260523-003/retro.md` (2)
- `.claude/project/sprint/history/SP-20260523-003/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260524-001/retro.md` (2)
- `.claude/project/sprint/history/SP-20260524-001/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260525-003/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260525-004/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260525-018/retro.md` (1)
- `.claude/project/sprint/history/SP-20260525-018/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260525-019/retro.md` (1)
- `.claude/project/sprint/history/SP-20260525-019/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260528-001/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260531-002/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260531-003/retro.md` (1)
- `.claude/project/sprint/history/SP-20260531-003/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260531-006/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260602-001/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260610-002/retro.md` (1)
- `.claude/project/sprint/history/SP-20260610-002/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260610-003/retro.md` (1)
- `.claude/project/sprint/history/SP-20260610-003/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260610-005/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260610-006/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260610-007/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260610-008/retro.yaml` (1)
- `.claude/project/sprint/history/SP-20260611-002/retro.md` (1)
- `.claude/project/sprint/history/SP-20260611-002/retro.yaml` (2)
- `.claude/project/sprint/history/SP-20260611-002/sprint-history.yaml` (2)
- `.claude/project/sprint/issues/I-20260513-001.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260512-0001.report.md` (1)
- `.claude/project/sprint/plan-contracts/PC-20260512-0001.yaml` (4)
- `.claude/project/sprint/plan-contracts/PC-20260513-0002.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260513-0003.report.md` (11)
- `.claude/project/sprint/plan-contracts/PC-20260513-0003.yaml` (27)
- `.claude/project/sprint/plan-contracts/PC-20260513-0004.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260513-0005.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260513-0006.report.md` (11)
- `.claude/project/sprint/plan-contracts/PC-20260513-0006.yaml` (37)
- `.claude/project/sprint/plan-contracts/PC-20260514-0007.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260514-0008.report.md` (5)
- `.claude/project/sprint/plan-contracts/PC-20260514-0008.yaml` (22)
- `.claude/project/sprint/plan-contracts/PC-20260514-0009.report.md` (1)
- `.claude/project/sprint/plan-contracts/PC-20260514-0009.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260518-0010.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260518-0011.report.md` (1)
- `.claude/project/sprint/plan-contracts/PC-20260518-0011.yaml` (6)
- `.claude/project/sprint/plan-contracts/PC-20260518-0012.yaml` (2)
- `.claude/project/sprint/plan-contracts/PC-20260519-0013.report.md` (11)
- `.claude/project/sprint/plan-contracts/PC-20260519-0013.yaml` (43)
- `.claude/project/sprint/plan-contracts/PC-20260519-0014.report.md` (3)
- `.claude/project/sprint/plan-contracts/PC-20260519-0014.yaml` (11)
- `.claude/project/sprint/plan-contracts/PC-20260519-0015.report.md` (3)
- `.claude/project/sprint/plan-contracts/PC-20260519-0015.yaml` (11)
- `.claude/project/sprint/plan-contracts/PC-20260520-0016.report.md` (27)
- `.claude/project/sprint/plan-contracts/PC-20260520-0016.yaml` (71)
- `.claude/project/sprint/plan-contracts/PC-20260521-0017.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260521-0018.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260521-0019.report.md` (18)
- `.claude/project/sprint/plan-contracts/PC-20260521-0019.yaml` (44)
- `.claude/project/sprint/plan-contracts/PC-20260521-0020.report.md` (26)
- `.claude/project/sprint/plan-contracts/PC-20260521-0020.yaml` (64)
- `.claude/project/sprint/plan-contracts/PC-20260521-0021.report.md` (15)
- `.claude/project/sprint/plan-contracts/PC-20260521-0021.yaml` (55)
- `.claude/project/sprint/plan-contracts/PC-20260522-0022.report.md` (54)
- `.claude/project/sprint/plan-contracts/PC-20260522-0022.yaml` (130)
- `.claude/project/sprint/plan-contracts/PC-20260522-0023.report.md` (21)
- `.claude/project/sprint/plan-contracts/PC-20260522-0023.yaml` (62)
- `.claude/project/sprint/plan-contracts/PC-20260522-0024.report.md` (6)
- `.claude/project/sprint/plan-contracts/PC-20260522-0024.yaml` (12)
- `.claude/project/sprint/plan-contracts/PC-20260523-0025.report.md` (38)
- `.claude/project/sprint/plan-contracts/PC-20260523-0025.yaml` (79)
- `.claude/project/sprint/plan-contracts/PC-20260523-0026.report.md` (38)
- `.claude/project/sprint/plan-contracts/PC-20260523-0026.yaml` (79)
- `.claude/project/sprint/plan-contracts/PC-20260523-0027.report.md` (11)
- `.claude/project/sprint/plan-contracts/PC-20260523-0027.yaml` (26)
- `.claude/project/sprint/plan-contracts/PC-20260523-0028.report.md` (11)
- `.claude/project/sprint/plan-contracts/PC-20260523-0028.yaml` (26)
- `.claude/project/sprint/plan-contracts/PC-20260523-0029.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260523-0030.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260523-0031.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260523-0032.report.md` (20)
- `.claude/project/sprint/plan-contracts/PC-20260523-0032.yaml` (34)
- `.claude/project/sprint/plan-contracts/PC-20260523-0033.report.md` (20)
- `.claude/project/sprint/plan-contracts/PC-20260523-0033.yaml` (34)
- `.claude/project/sprint/plan-contracts/PC-20260523-0034.report.md` (9)
- `.claude/project/sprint/plan-contracts/PC-20260523-0034.yaml` (40)
- `.claude/project/sprint/plan-contracts/PC-20260523-0035.report.md` (27)
- `.claude/project/sprint/plan-contracts/PC-20260523-0035.yaml` (70)
- `.claude/project/sprint/plan-contracts/PC-20260523-0036.report.md` (5)
- `.claude/project/sprint/plan-contracts/PC-20260523-0036.yaml` (10)
- `.claude/project/sprint/plan-contracts/PC-20260523-0037.yaml` (2)
- `.claude/project/sprint/plan-contracts/PC-20260523-0038.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260523-0039.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260523-0039.yaml` (14)
- `.claude/project/sprint/plan-contracts/PC-20260523-0040.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260523-0040.yaml` (14)
- `.claude/project/sprint/plan-contracts/PC-20260523-0041.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260523-0041.yaml` (14)
- `.claude/project/sprint/plan-contracts/PC-20260523-0042.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260523-0042.yaml` (14)
- `.claude/project/sprint/plan-contracts/PC-20260523-0043.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260523-0043.yaml` (14)
- `.claude/project/sprint/plan-contracts/PC-20260523-0044.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260523-0045.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260523-0046.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260523-0047.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260523-0048.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260523-0049.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260523-0050.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260523-0051.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260525-0052.yaml` (36)
- `.claude/project/sprint/plan-contracts/PC-20260525-0053.report.md` (14)
- `.claude/project/sprint/plan-contracts/PC-20260525-0053.yaml` (28)
- `.claude/project/sprint/plan-contracts/PC-20260525-0054.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260525-0054.yaml` (7)
- `.claude/project/sprint/plan-contracts/PC-20260525-0055.report.md` (2)
- `.claude/project/sprint/plan-contracts/PC-20260525-0055.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260525-0056.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260525-0056.yaml` (5)
- `.claude/project/sprint/plan-contracts/PC-20260529-0057.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260529-0057.yaml` (14)
- `.claude/project/sprint/plan-contracts/PC-20260530-0058.report.md` (2)
- `.claude/project/sprint/plan-contracts/PC-20260530-0058.yaml` (7)
- `.claude/project/sprint/plan-contracts/PC-20260531-0059.report.md` (3)
- `.claude/project/sprint/plan-contracts/PC-20260531-0059.yaml` (11)
- `.claude/project/sprint/plan-contracts/PC-20260531-0060.report.md` (11)
- `.claude/project/sprint/plan-contracts/PC-20260531-0060.yaml` (22)
- `.claude/project/sprint/plan-contracts/PC-20260531-0061.yaml` (2)
- `.claude/project/sprint/plan-contracts/PC-20260531-0062.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260602-0063.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260602-0063.yaml` (8)
- `.claude/project/sprint/plan-contracts/PC-20260608-0064.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260609-0065.yaml` (2)
- `.claude/project/sprint/plan-contracts/PC-20260610-0066.report.md` (3)
- `.claude/project/sprint/plan-contracts/PC-20260610-0066.yaml` (15)
- `.claude/project/sprint/plan-contracts/PC-20260610-0067.report.md` (5)
- `.claude/project/sprint/plan-contracts/PC-20260610-0067.yaml` (19)
- `.claude/project/sprint/plan-contracts/PC-20260610-0068.report.md` (1)
- `.claude/project/sprint/plan-contracts/PC-20260610-0068.yaml` (7)
- `.claude/project/sprint/plan-contracts/PC-20260610-0069.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260610-0070.report.md` (5)
- `.claude/project/sprint/plan-contracts/PC-20260610-0070.yaml` (18)
- `.claude/project/sprint/plan-contracts/PC-20260610-0071.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260611-0072.report.md` (4)
- `.claude/project/sprint/plan-contracts/PC-20260611-0072.yaml` (16)
- `.claude/project/sprint/plan-contracts/PC-20260611-0073.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260611-0074.report.md` (1)
- `.claude/project/sprint/plan-contracts/PC-20260611-0074.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260611-0075.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260614-0076.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260614-0077.report.md` (6)
- `.claude/project/sprint/plan-contracts/PC-20260614-0077.yaml` (14)
- `.claude/project/sprint/plan-contracts/PC-20260614-0078.report.md` (6)
- `.claude/project/sprint/plan-contracts/PC-20260614-0078.yaml` (12)
- `.claude/project/sprint/plan-contracts/PC-20260615-0079.yaml` (3)
- `.claude/project/sprint/plan-contracts/PC-20260615-0080.yaml` (2)
- `.claude/project/sprint/plan-contracts/PC-20260616-0081.report.md` (8)
- `.claude/project/sprint/plan-contracts/PC-20260616-0081.yaml` (19)
- `.claude/project/sprint/plan-contracts/PC-20260628-0082.report.md` (6)
- `.claude/project/sprint/plan-contracts/PC-20260628-0082.yaml` (11)
- `.claude/project/sprint/plan-contracts/PC-20260730-0083.report.md` (5)
- `.claude/project/sprint/plan-contracts/PC-20260730-0083.yaml` (18)
- `.claude/project/sprint/plan-contracts/PC-20260730-0084.report.md` (6)
- `.claude/project/sprint/plan-contracts/PC-20260730-0084.yaml` (29)
- `.claude/project/sprint/plan-contracts/PC-20260730-0085.report.md` (1)
- `.claude/project/sprint/plan-contracts/PC-20260730-0085.yaml` (5)
- `.claude/project/sprint/plan-contracts/PC-20260828-0086.yaml` (1)
- `.claude/project/sprint/plan-contracts/PC-20260829-0087.report.md` (1)
- `.claude/project/sprint/plan-contracts/PC-20260829-0087.yaml` (5)
- `.claude/project/sprint/plan-contracts/PC-20260829-0088.report.md` (1)
- `.claude/project/sprint/plan-contracts/PC-20260829-0088.yaml` (5)
- `.claude/project/sprint/plan-contracts/PC-20260830-0089.yaml` (2)
- `.claude/project/sprint/plan-contracts/PC-20260913-0090.report.md` (33)
- `.claude/project/sprint/plan-contracts/PC-20260913-0090.yaml` (88)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-001.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-002.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-003.yaml` (3)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-005.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-007.yaml` (3)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-008.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-010.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-012.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-013.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-014.yaml` (3)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-015.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-016.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-017.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260512-001/T-20260512-018.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-063.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-064.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-065.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-066.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-067.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-068.yaml` (3)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-069.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-070.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-071.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-072.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-073.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-074.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-075.yaml` (3)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-076.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-001/T-20260514-077.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-002/T-20260514-078.yaml` (3)
- `.claude/project/sprint/ralph/SP-20260514-002/T-20260514-079.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-002/T-20260514-080.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-002/T-20260514-081.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260514-002/T-20260514-082.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260518-009/T-20260519-123.yaml` (5)
- `.claude/project/sprint/ralph/SP-20260518-009/T-20260519-124.yaml` (5)
- `.claude/project/sprint/ralph/SP-20260518-009/T-20260519-125.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260518-009/T-20260519-126.yaml` (3)
- `.claude/project/sprint/ralph/SP-20260519-001/T-20260519-127.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260519-001/T-20260519-128.yaml` (3)
- `.claude/project/sprint/ralph/SP-20260519-001/T-20260519-129.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260519-001/T-20260519-130.yaml` (2)
- `.claude/project/sprint/ralph/SP-20260521-001/T-20260521-168.yaml` (2)
- `.claude/project/sprint/releases/RL-20260513-001.yaml` (2)
- `.claude/project/sprint/releases/RL-20260513-002.yaml` (2)
- `.claude/project/sprint/releases/RL-20260513-003.report.md` (1)
- `.claude/project/sprint/releases/RL-20260513-003.yaml` (3)
- `.claude/project/sprint/releases/RL-20260513-004.yaml` (2)
- `.claude/project/sprint/releases/RL-20260513-005.yaml` (2)
- `.claude/project/sprint/releases/RL-20260513-006.report.md` (1)
- `.claude/project/sprint/releases/RL-20260513-006.yaml` (3)
- `.claude/project/sprint/releases/RL-20260514-007.yaml` (2)
- `.claude/project/sprint/releases/RL-20260514-008.changelog.md` (40)
- `.claude/project/sprint/releases/RL-20260514-008.report.md` (1)
- `.claude/project/sprint/releases/RL-20260514-008.yaml` (3)
- `.claude/project/sprint/releases/RL-20260514-009.changelog.md` (5)
- `.claude/project/sprint/releases/RL-20260514-009.yaml` (4)
- `.claude/project/sprint/releases/RL-20260518-010.changelog.md` (3)
- `.claude/project/sprint/releases/RL-20260518-010.yaml` (2)
- `.claude/project/sprint/releases/RL-20260518-011.yaml` (1)
- `.claude/project/sprint/releases/RL-20260519-012.yaml` (1)
- `.claude/project/sprint/releases/RL-20260519-013.report.md` (1)
- `.claude/project/sprint/releases/RL-20260519-013.yaml` (3)
- `.claude/project/sprint/releases/RL-20260521-014.yaml` (2)
- `.claude/project/sprint/releases/RL-20260521-015.yaml` (2)
- `.claude/project/sprint/releases/RL-20260521-016.changelog.md` (16)
- `.claude/project/sprint/releases/RL-20260521-016.yaml` (2)
- `.claude/project/sprint/releases/RL-20260522-017.yaml` (1)
- `.claude/project/sprint/releases/RL-20260522-018.yaml` (1)
- `.claude/project/sprint/releases/RL-20260522-019.yaml` (1)
- `.claude/project/sprint/releases/RL-20260522-020.yaml` (3)
- `.claude/project/sprint/releases/RL-20260522-021.yaml` (1)
- `.claude/project/sprint/releases/RL-20260522-022.yaml` (1)
- `.claude/project/sprint/releases/RL-20260523-023.yaml` (3)
- `.claude/project/sprint/releases/RL-20260523-024.yaml` (2)
- `.claude/project/sprint/releases/RL-20260523-025.yaml` (1)
- `.claude/project/sprint/releases/RL-20260523-026.yaml` (4)
- `.claude/project/sprint/releases/RL-20260523-027.yaml` (3)
- `.claude/project/sprint/releases/RL-20260523-028.yaml` (3)
- `.claude/project/sprint/releases/RL-20260525-029.yaml` (2)
- `.claude/project/sprint/releases/RL-20260525-030.yaml` (2)
- `.claude/project/sprint/releases/RL-20260525-031.yaml` (2)
- `.claude/project/sprint/releases/RL-20260529-032.yaml` (1)
- `.claude/project/sprint/releases/RL-20260531-033.yaml` (1)
- `.claude/project/sprint/releases/RL-20260531-034.yaml` (2)
- `.claude/project/sprint/releases/RL-20260602-035.yaml` (1)
- `.claude/project/sprint/releases/RL-20260610-036.yaml` (2)
- `.claude/project/sprint/releases/RL-20260610-037.yaml` (2)
- `.claude/project/sprint/releases/RL-20260610-038.yaml` (2)
- `.claude/project/sprint/releases/RL-20260610-039.yaml` (2)
- `.claude/project/sprint/releases/RL-20260610-040.yaml` (1)
- `.claude/project/sprint/releases/RL-20260610-041.yaml` (1)
- `.claude/project/sprint/releases/RL-20260610-042.yaml` (1)
- `.claude/project/sprint/releases/RL-20260611-043.yaml` (1)
- `.claude/project/sprint/releases/RL-20260611-044.yaml` (2)
- `.claude/project/sprint/releases/RL-20260611-045.report.md` (3)
- `.claude/project/sprint/releases/RL-20260611-045.yaml` (2)

</details>

<details><summary>R-sprint-body: 759 files, 3691 occ</summary>

- **S-LC-01** (terminal; TRACKER.md / trackers/epics/E-LIFECYCLE-001: LANDED on branch june-9 2026-06-09/10, gauntlet-clean (registry still says planning: stale)): `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **S-OS-06** (live; active-sprints.yaml primary: S-OS-06; TRACKER.md: BRANCH STILL NOT LANDED): `copy.md` (1), `inputs.md` (1), `redteam-plan.md` (1)
- **S-PF-01** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `artifacts/build_spec-S-PF-01-w0-telemetry-seam.chain.json` (1), `qa-plan.md` (1), `current.yaml` (12), `progress.yaml` (1)
- **S-VLADW1-01** (terminal; TRACKER.md: closed at honest state 2026-08-19, not released; commit 2597d00d): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (10), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **S-VLADW1-02** (live; trackers/sprints/S-VLADW1-02: Current state 'Designed, build queued (as of 2026-08-11)'. Note: some legacy test ids it names live in the out-of-tree vlad repo, so a rename there is coordinated, not in-tree): `copy.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1)
- **SP-20260512-001** (terminal; registry status: retrospected): `acceptance-criteria.md` (4), `copy.md` (1), `granular-stories.md` (1), `inputs.md` (1), `prd.md` (3), `release-plan.md` (2), `current.yaml` (15), `progress.yaml` (1)
- **SP-20260513-001** (terminal; registry status: retrospected): `copy.md` (1), `qa-plan.md` (1), `current.yaml` (12), `progress.yaml` (1)
- **SP-20260513-002** (terminal; registry status: retrospected): `acceptance-criteria.md` (18), `copy.md` (11), `granular-stories.md` (8), `high-level-stories.md` (5), `inputs.md` (7), `prd.md` (37), `qa-plan.md` (12), `redteam-plan.md` (4), `release-plan.md` (20), `trace.md` (8), `current.yaml` (19), `progress.yaml` (1), `retro-synthesis.json` (14)
- **SP-20260513-003** (terminal; registry status: retrospected): `granular-stories.md` (1), `redteam-plan.md` (2), `current.yaml` (12), `progress.yaml` (1)
- **SP-20260513-004** (terminal; registry status: retrospected): `inputs.md` (1), `qa-plan.md` (1), `current.yaml` (10), `progress.yaml` (1)
- **SP-20260513-005** (terminal; registry status: retrospected): `acceptance-criteria.md` (15), `copy.md` (29), `granular-stories.md` (26), `high-level-stories.md` (8), `inputs.md` (17), `prd.md` (58), `qa-plan.md` (9), `redteam-plan.md` (6), `release-plan.md` (10), `trace.md` (42), `current.yaml` (16), `failure-mining.md` (82), `progress.yaml` (1), `retro-synthesis.json` (27)
- **SP-20260514-001** (terminal; registry status: closed): `acceptance-criteria.md` (6), `copy.md` (2), `granular-stories.md` (2), `high-level-stories.md` (4), `inputs.md` (1), `prd.md` (15), `qa-plan.md` (7), `redteam-plan.md` (1), `release-plan.md` (7), `trace.md` (3), `current.yaml` (7), `execution-report.md` (12), `progress.yaml` (6)
- **SP-20260514-002** (terminal; registry status: retrospected): `acceptance-criteria.md` (4), `copy.md` (2), `granular-stories.md` (1), `prd.md` (2), `qa-plan.md` (1), `redteam-plan.md` (4), `release-plan.md` (7), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260518-001** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `granular-stories.md` (1), `inputs.md` (1), `trace.md` (1), `current.yaml` (12), `progress.yaml` (3)
- **SP-20260518-007** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (2), `qa-plan.md` (3), `release-plan.md` (1), `current.yaml` (1), `progress.yaml` (1)
- **SP-20260518-008** (terminal; registry status: retrospected): `copy.md` (1), `inputs.md` (1), `trace.md` (1), `current.yaml` (10), `progress.yaml` (1)
- **SP-20260518-009** (terminal; registry status: closed): `acceptance-criteria.md` (19), `changelog.md` (18), `copy.md` (2), `execution-report.md` (15), `granular-stories.md` (20), `high-level-stories.md` (4), `inputs.md` (1), `prd.md` (24), `qa-plan.md` (9), `trace.md` (1), `current.yaml` (13), `progress.yaml` (1)
- **SP-20260519-001** (terminal; RELEASES.md exists at repo root (the sprint's deliverable); commit b89c9a7a): `acceptance-criteria.md` (6), `copy.md` (8), `granular-stories.md` (5), `high-level-stories.md` (1), `inputs.md` (4), `prd.md` (11), `qa-plan.md` (3), `redteam-plan.md` (2), `release-plan.md` (5), `trace.md` (7), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260520-001** (terminal; registry status: closed): `qa-plan.md` (1), `release-plan.md` (1), `current.yaml` (11), `progress.yaml` (3)
- **SP-20260520-002** (terminal; registry status: closed): `granular-stories.md` (1), `prd.md` (2), `release-plan.md` (17), `current.yaml` (12), `progress.yaml` (1)
- **SP-20260521-001** (terminal; registry status: retrospected): `acceptance-criteria.md` (14), `copy.md` (7), `granular-stories.md` (8), `high-level-stories.md` (8), `inputs.md` (5), `prd.md` (20), `qa-plan.md` (7), `redteam-plan.md` (1), `release-plan.md` (3), `trace.md` (4), `current.yaml` (21), `progress.yaml` (1)
- **SP-20260522-001** (terminal; TRACKER.md: Completed; commit 1b02d1cc retrospected): `acceptance-criteria.md` (5), `copy.md` (3), `granular-stories.md` (13), `high-level-stories.md` (13), `inputs.md` (3), `prd.md` (60), `qa-plan.md` (3), `redteam-plan.md` (3), `release-plan.md` (3), `trace.md` (3), `current.yaml` (30), `progress.yaml` (1)
- **SP-20260522-002** (terminal; commit 1b02d1cc 'close(sprints): SP-20260522-001/002/003 retrospected'): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (48), `high-level-stories.md` (7), `inputs.md` (1), `prd.md` (29), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (19), `progress.yaml` (1)
- **SP-20260522-003** (terminal; commit 1b02d1cc 'close(sprints): SP-20260522-001/002/003 retrospected'): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (21), `high-level-stories.md` (5), `inputs.md` (1), `prd.md` (16), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260522-004** (terminal; registry status: retrospected): `acceptance-criteria.md` (3), `copy.md` (3), `granular-stories.md` (37), `high-level-stories.md` (15), `inputs.md` (3), `prd.md` (43), `qa-plan.md` (3), `redteam-plan.md` (3), `release-plan.md` (3), `trace.md` (3), `current.yaml` (21), `progress.yaml` (1)
- **SP-20260522-005** (terminal; registry status: retrospected): `acceptance-criteria.md` (2), `copy.md` (2), `granular-stories.md` (14), `high-level-stories.md` (8), `inputs.md` (2), `prd.md` (20), `qa-plan.md` (2), `trace.md` (2), `current.yaml` (17), `progress.yaml` (1)
- **SP-20260523-001** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `trace.md` (1), `current.yaml` (10), `progress.yaml` (1)
- **SP-20260523-002** (terminal; registry status: retrospected): `acceptance-criteria.md` (4), `copy.md` (4), `granular-stories.md` (4), `high-level-stories.md` (4), `inputs.md` (4), `prd.md` (12), `qa-plan.md` (4), `trace.md` (4), `current.yaml` (13), `progress.yaml` (1)
- **SP-20260523-003** (terminal; registry status: retrospected): `acceptance-criteria.md` (3), `copy.md` (3), `granular-stories.md` (32), `high-level-stories.md` (17), `inputs.md` (3), `prd.md` (30), `qa-plan.md` (3), `trace.md` (3), `current.yaml` (17), `progress.yaml` (1)
- **SP-20260524-001** (terminal; registry status: retrospected): `acceptance-criteria.md` (33), `copy.md` (4), `granular-stories.md` (15), `high-level-stories.md` (7), `inputs.md` (3), `prd.md` (25), `qa-plan.md` (4), `redteam-plan.md` (5), `release-plan.md` (5), `trace.md` (9), `current.yaml` (23), `progress.yaml` (1)
- **SP-20260525-003** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260525-004** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `trace.md` (1), `current.yaml` (9), `progress.yaml` (1)
- **SP-20260525-014** (terminal; trackers/epics/E-MANAGER-LAYER-001: superseded by / largely delivered via E-ADR0007 (retired as planned)): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260525-015** (terminal; trackers/epics/E-MANAGER-LAYER-001: superseded by / largely delivered via E-ADR0007 (retired as planned)): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260525-016** (terminal; trackers/epics/E-MANAGER-LAYER-001: superseded by / largely delivered via E-ADR0007 (retired as planned)): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260525-017** (terminal; trackers/epics/E-MANAGER-LAYER-001: superseded by / largely delivered via E-ADR0007 (retired as planned)): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260525-018** (terminal; registry status: retrospected): `acceptance-criteria.md` (30), `copy.md` (2), `granular-stories.md` (16), `high-level-stories.md` (4), `inputs.md` (2), `prd.md` (24), `qa-plan.md` (2), `redteam-plan.md` (2), `release-plan.md` (2), `trace.md` (2), `current.yaml` (13), `progress.yaml` (1)
- **SP-20260525-019** (terminal; registry status: retrospected): `acceptance-criteria.md` (21), `copy.md` (2), `granular-stories.md` (20), `high-level-stories.md` (8), `inputs.md` (2), `prd.md` (22), `qa-plan.md` (2), `redteam-plan.md` (2), `release-plan.md` (2), `trace.md` (2), `current.yaml` (15), `progress.yaml` (1)
- **SP-20260525-021** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (9), `high-level-stories.md` (5), `inputs.md` (1), `prd.md` (13), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (12), `progress.yaml` (1)
- **SP-20260525-022** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (8), `high-level-stories.md` (3), `inputs.md` (1), `prd.md` (11), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260525-023** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (15), `high-level-stories.md` (5), `inputs.md` (1), `prd.md` (12), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260528-001** (terminal; registry status: retrospected): `acceptance-criteria.md` (2), `copy.md` (1), `granular-stories.md` (5), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (12), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (13), `progress.yaml` (1)
- **SP-20260530-001** (terminal; registry status: closed): `acceptance-criteria.md` (3), `copy.md` (1), `granular-stories.md` (11), `high-level-stories.md` (3), `inputs.md` (1), `prd.md` (11), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260531-002** (terminal; registry status: retrospected): `acceptance-criteria.md` (10), `copy.md` (1), `granular-stories.md` (15), `high-level-stories.md` (9), `prd.md` (12), `qa-plan.md` (2), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (4), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260531-003** (terminal; registry status: retrospected): `acceptance-criteria.md` (11), `copy.md` (2), `granular-stories.md` (13), `high-level-stories.md` (6), `inputs.md` (1), `prd.md` (18), `qa-plan.md` (4), `redteam-plan.md` (1), `release-plan.md` (2), `trace.md` (4), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260602-001** (terminal; registry status: retrospected): `acceptance-criteria.md` (22), `copy.md` (1), `granular-stories.md` (3), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (15), `qa-plan.md` (2), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (13), `progress.yaml` (1)
- **SP-20260608-001** (terminal; TRACKER.md: merged 06fee13 + pushed): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260610-001** (terminal; commit 73bc2b9c E-LIFECYCLE-001 epic retrospective; _reports/sessions/2026-06-10-1715.md): `acceptance-criteria.md` (2), `copy.md` (2), `granular-stories.md` (9), `high-level-stories.md` (6), `inputs.md` (2), `prd.md` (15), `qa-plan.md` (2), `redteam-plan.md` (2), `release-plan.md` (2), `trace.md` (2), `current.yaml` (6), `progress.yaml` (1)
- **SP-20260610-002** (terminal; registry status: retrospected): `acceptance-criteria.md` (3), `copy.md` (2), `granular-stories.md` (2), `high-level-stories.md` (2), `inputs.md` (2), `prd.md` (16), `qa-plan.md` (3), `redteam-plan.md` (2), `release-plan.md` (4), `trace.md` (8), `current.yaml` (15), `progress.yaml` (1)
- **SP-20260610-003** (terminal; registry status: retrospected): `acceptance-criteria.md` (2), `copy.md` (2), `granular-stories.md` (2), `high-level-stories.md` (2), `inputs.md` (2), `prd.md` (12), `qa-plan.md` (3), `redteam-plan.md` (2), `release-plan.md` (5), `trace.md` (5), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260610-005** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (2), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260610-006** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (7), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (14), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (2), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260610-007** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (12), `progress.yaml` (1)
- **SP-20260610-008** (terminal; registry status: retrospected): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (8), `high-level-stories.md` (5), `inputs.md` (1), `prd.md` (14), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (2), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260611-001** (terminal; registry status: closed): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (2), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260611-002** (terminal; registry status: retrospected): `acceptance-criteria.md` (6), `copy.md` (3), `granular-stories.md` (4), `high-level-stories.md` (1), `inputs.md` (3), `prd.md` (10), `qa-plan.md` (2), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (3), `current.yaml` (12), `progress.yaml` (1)
- **SP-20260613-001** (terminal; registry status: closed): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260614-001** (terminal; TRACKER.md: LANDED on main 2026-06-14 @70892a4b): `acceptance-criteria.md` (5), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (15), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (2), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260614-002** (terminal; registry status: closed): `acceptance-criteria.md` (17), `copy.md` (1), `granular-stories.md` (4), `high-level-stories.md` (3), `inputs.md` (1), `prd.md` (16), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (3), `current.yaml` (14), `progress.yaml` (1)
- **SP-20260615-001** (terminal; registry status: done): `acceptance-criteria.md` (3), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260615-002** (terminal; registry status: done): `acceptance-criteria.md` (2), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (9), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (1), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260616-001** (terminal; commit ff73a34e: W2-core landed): `acceptance-criteria.md` (9), `copy.md` (1), `granular-stories.md` (1), `high-level-stories.md` (1), `inputs.md` (1), `prd.md` (15), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (3), `current.yaml` (15), `progress.yaml` (1)
- **SP-20260627-001** (terminal; registry status: done): `acceptance-criteria.md` (1), `copy.md` (1), `granular-stories.md` (6), `high-level-stories.md` (5), `inputs.md` (1), `prd.md` (15), `qa-plan.md` (1), `redteam-plan.md` (1), `release-plan.md` (1), `trace.md` (2), `current.yaml` (11), `progress.yaml` (1)
- **SP-20260718-001** (terminal; commit fe168b59 chore(SP-20260718-001 close)): `build-spec.md` (1), `prd.md` (1), `current.yaml` (2), `plan-composition.md` (2), `progress.yaml` (1)
- **SP-20260718-004** (terminal; registry status: retrospected): `build_spec.md` (4), `current.yaml` (2), `plan.md` (4), `progress.yaml` (1)
- **SP-20260719-001** (terminal; commit 0750bc95 merge(SP-20260719-001)): `prd.md` (1), `current.yaml` (1), `progress.yaml` (1)
- **SP-20260723-001** (terminal; registry status: done): `prd.md` (5), `current.yaml` (1), `progress.yaml` (1)
- **S-LC-02** (terminal; TRACKER.md / trackers/epics/E-LIFECYCLE-001: LANDED on branch june-9 2026-06-09/10, gauntlet-clean (registry still says planning: stale)): `current.yaml` (2), `progress.yaml` (1)
- **S-LC-03** (terminal; TRACKER.md / trackers/epics/E-LIFECYCLE-001: LANDED on branch june-9 2026-06-09/10, gauntlet-clean (registry still says planning: stale)): `current.yaml` (1), `progress.yaml` (1)
- **S-LC-04** (terminal; TRACKER.md / trackers/epics/E-LIFECYCLE-001: LANDED on branch june-9 2026-06-09/10, gauntlet-clean (registry still says planning: stale)): `current.yaml` (1), `progress.yaml` (1)
- **S-LC-05** (terminal; TRACKER.md / trackers/epics/E-LIFECYCLE-001: LANDED on branch june-9 2026-06-09/10, gauntlet-clean (registry still says planning: stale)): `current.yaml` (1), `progress.yaml` (1)
- **S-LC-06** (terminal; registry status: closed): `current.yaml` (1), `progress.yaml` (1)
- **S-LC-07** (terminal; registry status: closed): `current.yaml` (1), `progress.yaml` (1)
- **S-LC-08** (terminal; registry status: closed): `current.yaml` (1), `progress.yaml` (1)
- **S-LC-09** (terminal; registry status: closed): `current.yaml` (1), `progress.yaml` (1)
- **S-LC-12** (terminal; registry status: closed): `current.yaml` (1), `progress.yaml` (1)
- **S-PF-09a** (terminal; TRACKER.md: SP-20260614-001 (S-PF-09a R-2) LANDED on main 2026-06-14 @70892a4b): `current.yaml` (1), `plan-product-lead.md` (7), `progress.yaml` (1)
- **S-VLADW1-03** (terminal; registry status: closed): `current.yaml` (1), `progress.yaml` (1)
- **S-VLADW1-04** (terminal; registry status: closed): `current.yaml` (1), `progress.yaml` (1)
- **S-VLADW1-05** (terminal; registry status: closed): `current.yaml` (4), `progress.yaml` (1)
- **SP-20260513-006** (terminal; registry status: closed): `current.yaml` (2), `progress.yaml` (1)
- **SP-20260525-020** (terminal; commit 6cb9a811 merge(sprint): SP-20260525-020): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260531-001** (terminal; commit 46e72762 feat(reports) [engine-fast-close]; _reports/ exists): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260531-004** (terminal; registry status: done): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260531-005** (terminal; registry status: superseded): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260531-006** (terminal; registry status: retrospected): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260605-001** (terminal; registry status: closed): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260618-001** (terminal; registry status: done): `current.yaml` (2), `progress.yaml` (1)
- **SP-20260618-002** (terminal; registry status: done): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260716-002** (terminal; registry status: done): `current.yaml` (2), `progress.yaml` (1)
- **SP-20260716-003** (terminal; registry status: done): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260718-002** (terminal; TRACKER.md: COMPLETE — MERGED (2026-07-18)): `current.yaml` (3), `plan-composition.md` (1), `progress.yaml` (3)
- **SP-20260718-003** (terminal; registry status: closed): `current.yaml` (1), `design/qa-plan.md` (1), `plan-composition.md` (3), `progress.yaml` (1)
- **SP-20260718-005** (terminal; registry status: closed): `current.yaml` (2), `plan.md` (2), `progress.yaml` (1), `record-trust-gate.manifest.json` (1)
- **SP-20260720-002** (terminal; registry status: closed): `current.yaml` (2), `plan-composition.md` (2), `progress.yaml` (1), `record-trust-gate.manifest.json` (1)
- **SP-20260720-003** (terminal; commit d78a7bf2 release(SP-20260720-003)): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260721-001** (terminal; TRACKER.md: 1.0 release ceremony sprint; 1.0.0 released 2026-07-23): `current.yaml` (3), `progress.yaml` (1)
- **SP-20260723-002** (terminal; registry status: done): `current.yaml` (1), `progress.yaml` (4)
- **SP-20260723-003** (terminal; registry status: done): `current.yaml` (1), `progress.yaml` (2)
- **SP-20260723-004** (terminal; registry status: done): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260723-005** (terminal; registry status: done): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260725-001** (terminal; registry status: done): `current.yaml` (1), `progress.yaml` (1)
- **SP-20260829-001** (terminal; TRACKER.md: CLOSED NO RELEASE (registry status never advanced: ED-359 class)): `current.yaml` (3), `DESIGN-EVIDENCE.md` (7), `progress.yaml` (1)

</details>

<details><summary>R-release-capsule: 162 files, 13004 occ</summary>

Reason: release capsule (changelog, framework-manifest, release.json, upgrade-notes, checksums) is the record of what shipped under that tag. Its legacy names and commands are what that release actually said. checksumPinned is verified per file against the capsule's checksums.json.

- `framework/releases/0.1.0/changelog.md` (12) checksumPinned=true
- `framework/releases/0.1.0/checksums.json` (1) checksumPinned=self (the pin file)
- `framework/releases/0.1.0/framework-manifest.json` (95) checksumPinned=true
- `framework/releases/0.1.0/release.json` (8) checksumPinned=true
- `framework/releases/0.1.0/upgrade-notes.md` (11) checksumPinned=true
- `framework/releases/0.1.1/changelog.md` (5) checksumPinned=true
- `framework/releases/0.1.1/framework-manifest.json` (112) checksumPinned=true
- `framework/releases/0.1.1/release.json` (2) checksumPinned=true
- `framework/releases/0.1.1/upgrade-notes.md` (5) checksumPinned=true
- `framework/releases/0.1.2/changelog.md` (27) checksumPinned=true
- `framework/releases/0.1.2/framework-manifest.json` (118) checksumPinned=true
- `framework/releases/0.1.2/release.json` (3) checksumPinned=true
- `framework/releases/0.1.2/upgrade-notes.md` (22) checksumPinned=true
- `framework/releases/0.1.4/changelog.md` (3) checksumPinned=true
- `framework/releases/0.1.4/framework-manifest.json` (128) checksumPinned=true
- `framework/releases/0.1.4/release.json` (3) checksumPinned=true
- `framework/releases/0.1.4/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.10.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.10.0/framework-manifest.json` (316) checksumPinned=true
- `framework/releases/0.10.0/release.json` (5) checksumPinned=true
- `framework/releases/0.10.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.11.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.11.0/framework-manifest.json` (348) checksumPinned=true
- `framework/releases/0.11.0/release.json` (5) checksumPinned=true
- `framework/releases/0.11.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.11.1/changelog.md` (8) checksumPinned=true
- `framework/releases/0.11.1/framework-manifest.json` (348) checksumPinned=true
- `framework/releases/0.11.1/release.json` (5) checksumPinned=true
- `framework/releases/0.11.1/upgrade-notes.md` (7) checksumPinned=true
- `framework/releases/0.12.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.12.0/framework-manifest.json` (358) checksumPinned=true
- `framework/releases/0.12.0/release.json` (5) checksumPinned=true
- `framework/releases/0.12.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.12.1/changelog.md` (3) checksumPinned=true
- `framework/releases/0.12.1/framework-manifest.json` (358) checksumPinned=true
- `framework/releases/0.12.1/release.json` (5) checksumPinned=true
- `framework/releases/0.12.1/upgrade-notes.md` (7) checksumPinned=true
- `framework/releases/0.13.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.13.0/framework-manifest.json` (358) checksumPinned=true
- `framework/releases/0.13.0/release.json` (5) checksumPinned=true
- `framework/releases/0.13.0/upgrade-notes.md` (7) checksumPinned=true
- `framework/releases/0.13.1/changelog.md` (5) checksumPinned=true
- `framework/releases/0.13.1/framework-manifest.json` (358) checksumPinned=true
- `framework/releases/0.13.1/release.json` (5) checksumPinned=true
- `framework/releases/0.13.1/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.14.0/changelog.md` (5) checksumPinned=true
- `framework/releases/0.14.0/framework-manifest.json` (373) checksumPinned=true
- `framework/releases/0.14.0/release.json` (5) checksumPinned=true
- `framework/releases/0.14.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.15.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.15.0/framework-manifest.json` (373) checksumPinned=true
- `framework/releases/0.15.0/release.json` (5) checksumPinned=true
- `framework/releases/0.15.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.15.1/changelog.md` (3) checksumPinned=true
- `framework/releases/0.15.1/framework-manifest.json` (373) checksumPinned=true
- `framework/releases/0.15.1/release.json` (5) checksumPinned=true
- `framework/releases/0.15.1/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.15.2/changelog.md` (3) checksumPinned=true
- `framework/releases/0.15.2/framework-manifest.json` (376) checksumPinned=true
- `framework/releases/0.15.2/release.json` (5) checksumPinned=true
- `framework/releases/0.15.2/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.15.3/changelog.md` (3) checksumPinned=true
- `framework/releases/0.15.3/framework-manifest.json` (376) checksumPinned=true
- `framework/releases/0.15.3/release.json` (5) checksumPinned=true
- `framework/releases/0.15.3/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.15.4/changelog.md` (3) checksumPinned=true
- `framework/releases/0.15.4/framework-manifest.json` (376) checksumPinned=true
- `framework/releases/0.15.4/release.json` (5) checksumPinned=true
- `framework/releases/0.15.4/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.16.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.16.0/framework-manifest.json` (387) checksumPinned=true
- `framework/releases/0.16.0/release.json` (5) checksumPinned=true
- `framework/releases/0.16.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.17.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.17.0/framework-manifest.json` (614) checksumPinned=true
- `framework/releases/0.17.0/release.json` (5) checksumPinned=true
- `framework/releases/0.17.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.2.0/changelog.md` (28) checksumPinned=true
- `framework/releases/0.2.0/checksums.json` (1) checksumPinned=self (the pin file)
- `framework/releases/0.2.0/framework-manifest.json` (105) checksumPinned=true
- `framework/releases/0.2.0/release.json` (9) checksumPinned=true
- `framework/releases/0.2.0/upgrade-notes.md` (12) checksumPinned=true
- `framework/releases/0.2.1/changelog.md` (3) checksumPinned=true
- `framework/releases/0.2.1/framework-manifest.json` (165) checksumPinned=true
- `framework/releases/0.2.1/release.json` (3) checksumPinned=true
- `framework/releases/0.2.1/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.2.2/changelog.md` (10) checksumPinned=true
- `framework/releases/0.2.2/framework-manifest.json` (165) checksumPinned=true
- `framework/releases/0.2.2/release.json` (3) checksumPinned=true
- `framework/releases/0.2.2/upgrade-notes.md` (20) checksumPinned=true
- `framework/releases/0.4.0/changelog.md` (14) checksumPinned=true
- `framework/releases/0.4.0/framework-manifest.json` (187) checksumPinned=true
- `framework/releases/0.4.0/release.json` (4) checksumPinned=true
- `framework/releases/0.4.0/upgrade-notes.md` (12) checksumPinned=true
- `framework/releases/0.4.1/changelog.md` (12) checksumPinned=true
- `framework/releases/0.4.1/framework-manifest.json` (187) checksumPinned=true
- `framework/releases/0.4.1/release.json` (10) checksumPinned=true
- `framework/releases/0.4.1/upgrade-notes.md` (9) checksumPinned=true
- `framework/releases/0.4.2/changelog.md` (10) checksumPinned=true
- `framework/releases/0.4.2/framework-manifest.json` (187) checksumPinned=true
- `framework/releases/0.4.2/release.json` (5) checksumPinned=true
- `framework/releases/0.4.2/upgrade-notes.md` (9) checksumPinned=true
- `framework/releases/0.4.3/changelog.md` (3) checksumPinned=true
- `framework/releases/0.4.3/framework-manifest.json` (187) checksumPinned=true
- `framework/releases/0.4.3/release.json` (4) checksumPinned=true
- `framework/releases/0.4.3/upgrade-notes.md` (5) checksumPinned=true
- `framework/releases/0.4.4/changelog.md` (2) checksumPinned=true
- `framework/releases/0.4.4/framework-manifest.json` (187) checksumPinned=true
- `framework/releases/0.4.4/release.json` (4) checksumPinned=true
- `framework/releases/0.4.4/upgrade-notes.md` (2) checksumPinned=true
- `framework/releases/0.5.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.5.0/framework-manifest.json` (187) checksumPinned=true
- `framework/releases/0.5.0/release.json` (3) checksumPinned=true
- `framework/releases/0.5.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.6.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.6.0/framework-manifest.json` (251) checksumPinned=true
- `framework/releases/0.6.0/release.json` (4) checksumPinned=true
- `framework/releases/0.6.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.6.1/changelog.md` (3) checksumPinned=true
- `framework/releases/0.6.1/framework-manifest.json` (263) checksumPinned=true
- `framework/releases/0.6.1/release.json` (4) checksumPinned=true
- `framework/releases/0.6.1/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.7.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.7.0/framework-manifest.json` (269) checksumPinned=true
- `framework/releases/0.7.0/release.json` (4) checksumPinned=true
- `framework/releases/0.7.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.7.1/changelog.md` (3) checksumPinned=true
- `framework/releases/0.7.1/framework-manifest.json` (269) checksumPinned=true
- `framework/releases/0.7.1/release.json` (4) checksumPinned=true
- `framework/releases/0.7.1/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.7.2/changelog.md` (3) checksumPinned=true
- `framework/releases/0.7.2/framework-manifest.json` (269) checksumPinned=true
- `framework/releases/0.7.2/release.json` (4) checksumPinned=true
- `framework/releases/0.7.2/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.8.0/changelog.md` (3) checksumPinned=true
- `framework/releases/0.8.0/framework-manifest.json` (269) checksumPinned=true
- `framework/releases/0.8.0/release.json` (4) checksumPinned=true
- `framework/releases/0.8.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.8.1/changelog.md` (3) checksumPinned=true
- `framework/releases/0.8.1/framework-manifest.json` (269) checksumPinned=true
- `framework/releases/0.8.1/release.json` (4) checksumPinned=true
- `framework/releases/0.8.1/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/0.8.2/changelog.md` (8) checksumPinned=true
- `framework/releases/0.8.2/framework-manifest.json` (269) checksumPinned=true
- `framework/releases/0.8.2/release.json` (4) checksumPinned=true
- `framework/releases/0.8.2/upgrade-notes.md` (7) checksumPinned=true
- `framework/releases/0.9.0/changelog.md` (18) checksumPinned=true
- `framework/releases/0.9.0/framework-manifest.json` (298) checksumPinned=true
- `framework/releases/0.9.0/release.json` (4) checksumPinned=true
- `framework/releases/0.9.0/upgrade-notes.md` (16) checksumPinned=false
- `framework/releases/1.0.0/changelog.md` (3) checksumPinned=true
- `framework/releases/1.0.0/framework-manifest.json` (698) checksumPinned=true
- `framework/releases/1.0.0/release.json` (5) checksumPinned=true
- `framework/releases/1.0.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/1.1.0/changelog.md` (3) checksumPinned=true
- `framework/releases/1.1.0/framework-manifest.json` (698) checksumPinned=true
- `framework/releases/1.1.0/release.json` (5) checksumPinned=true
- `framework/releases/1.1.0/upgrade-notes.md` (8) checksumPinned=true
- `framework/releases/1.2.0/changelog.md` (3) checksumPinned=true
- `framework/releases/1.2.0/framework-manifest.json` (698) checksumPinned=true
- `framework/releases/1.2.0/release.json` (5) checksumPinned=true
- `framework/releases/1.2.0/upgrade-notes.md` (8) checksumPinned=true

</details>

<details><summary>R-runtime-record: 84 files, 1689 occ</summary>

Reason: per-run artifact (reports, consult prompts and outputs, gauntlet briefs, discovery corpora, scan outputs, and the one-shot generator/fixture scripts recorded with the output they produced). A dated record of that run. Spot-read for live instructions: the S-OS-03 downstream notice (dated 2026-09-03 as issued), the wave-1 sprint specs (ACs satisfied), and the credential-custody ADR draft (header: PROMOTED 2026-08-03, accepted copy in the ADR dir) are all records.

- `runtime/adr-drafts/adr-0041-credential-custody-DRAFT.md` (5)
- `runtime/diagnostic/contract-map.md` (7)
- `runtime/diagnostic/log-mining.md` (8)
- `runtime/enforcer-fixtures/SP-20260829-001/b3-fault-injection.test.js` (1)
- `runtime/gauntlet-SP-20260725-002/r14-fixer-prompt.txt` (1)
- `runtime/gemini-deepclean-fixtures/negative-fixtures.txt` (1)
- `runtime/models-research/gemini.json` (3)
- `runtime/models-research/openai.json` (1)
- `runtime/open-source/anchor/commit-de9ba8eb.json` (3)
- `runtime/open-source/anchor/mirror-repo.json` (2)
- `runtime/open-source/anchor/release-pre-cleanup-snapshot.json` (7)
- `runtime/open-source/anchor/tag-ref-pre-cleanup-snapshot.json` (2)
- `runtime/open-source/anchor/tag-ref-warpos-0.1.4.json` (4)
- `runtime/open-source/rewrite/assert-evidence-dryrun2-main.txt` (3)
- `runtime/open-source/rewrite/assert-evidence-public-clone.txt` (3)
- `runtime/open-source/rewrite/DOWNSTREAM-NOTICE.md` (11)
- `runtime/open-source/rewrite/DRY-RUN-REPORT.md` (5)
- `runtime/open-source/rewrite/ref-map.txt` (41)
- `runtime/open-source/rewrite/removed-paths.txt` (2)
- `runtime/open-source/S-OS-03-rewrite-plan.md` (11)
- `runtime/open-source/S-OS-04-REPORT.md` (9)
- `runtime/open-source/S-OS-05-REPORT.md` (23)
- `runtime/prior-art/_fam.js` (4)
- `runtime/prior-art/_families.json` (17)
- `runtime/prior-art/_gen.js` (16)
- `runtime/prior-art/_gen2.js` (9)
- `runtime/prior-art/_gen3.js` (14)
- `runtime/prior-art/_gen4.js` (4)
- `runtime/prior-art/_skill-dates.txt` (28)
- `runtime/prior-art/_vendor.json` (46)
- `runtime/prior-art/PRIOR-ART-EVIDENCE-2026-08-28.md` (136)
- `runtime/prior-art/prior-art-report.html` (91)
- `runtime/prior-art/prior-art.json` (261)
- `runtime/prior-art/SKILL-SWEEP-2026-08-28.md` (254)
- `runtime/prior-art/skill-sweep.json` (324)
- `runtime/refscan-20260729/broken-canonical.txt` (46)
- `runtime/refscan-20260729/report.md` (1)
- `runtime/S-OS-06/CONDUCTOR-NOTES.md` (39)
- `runtime/S-OS-06/fix2-B-report.md` (3)
- `runtime/S-OS-06/gauntlet/fix-brief-r2.md` (14)
- `runtime/sp-20260618-001-retro.md` (1)
- `runtime/sp-dp-review/w1w2-review-out.md` (1)
- `runtime/sp-dp-w0/review-prompt.md` (1)
- `runtime/sp-dp-w4/recon-vocab-map.md` (3)
- `runtime/sp002-dispatch/w1-2ndpass-canary-prompt.md` (4)
- `runtime/sp002-dispatch/w1-2ndpass-canary.out.json` (3)
- `runtime/sp002-dispatch/WSG3b-alphahand-envelope.txt` (2)
- `runtime/sp002-gauntlet/backend-reviewer-prompt.md` (8)
- `runtime/sp002-gauntlet/backend-reviewer.out.json` (8)
- `runtime/sp002-gauntlet/qa-reviewer-prompt.md` (4)
- `runtime/sp002-gauntlet/security-reviewer-prompt.md` (11)
- `runtime/sp002-gauntlet/security-reviewer.out.json` (4)
- `runtime/sp002-invariants/invariants-v1.md` (1)
- `runtime/sp002-invariants/invariants-v2.md` (2)
- `runtime/sp002-invariants/lane-i1-success-path-verdict.md` (1)
- `runtime/sp002-invariants/lane-i4-report-state-totality-verdict.md` (1)
- `runtime/sp004-design/doe-build-spec-consult.json` (1)
- `runtime/sp20260720-003/ed-handoff.md` (2)
- `runtime/sp719-gauntlet/sec-review-r2-out.json` (1)
- `runtime/sprints/wave-guides/_AUTHORING-SPEC.md` (1)
- `runtime/sprints/wave-guides/_INTEGRATION-SPEC.md` (2)
- `runtime/sprints/wave-guides/TAXONOMY.md` (1)
- `runtime/sprints/wave1/s-0160-content-delivery.md` (10)
- `runtime/sprints/wave1/s-0181-dispatch-readiness.md` (4)
- `runtime/sprints/wave1/s-repo-role-resolver.md` (11)
- `runtime/sprints/wave1/s-typed-success.md` (2)
- `runtime/warpos-v1-discovery/DISCOVERY.md` (14)
- `runtime/warpos-v1-discovery/lanes/01-paths.md` (4)
- `runtime/warpos-v1-discovery/lanes/03-sprint.md` (4)
- `runtime/warpos-v1-discovery/lanes/04-skills.md` (10)
- `runtime/warpos-v1-discovery/lanes/05-memory.md` (1)
- `runtime/warpos-v1-discovery/lanes/06-trackers.md` (1)
- `runtime/warpos-v1-discovery/lanes/07-product.md` (5)
- `runtime/warpos-v1-discovery/lanes/08-dispatch.md` (3)
- `runtime/warpos-v1-discovery/lanes/10-checks.md` (7)
- `runtime/warpos-v1-discovery/lanes/11-session.md` (2)
- `runtime/warpos-v1-discovery/lanes/12-release.md` (38)
- `runtime/warpos-v1-discovery/systems/angle1-declared.md` (2)
- `runtime/warpos-v1-discovery/systems/angle2-structural.md` (16)
- `runtime/warpos-v1-discovery/systems/angle4-refgraph.md` (2)
- `runtime/warpos-v1-discovery/systems/angle5-convention.md` (6)
- `runtime/warpos-v1-discovery/systems/angle6-historical.md` (9)
- `runtime/warpos-v1-discovery/systems/ROLLUP.md` (7)
- `runtime/warpos-v1-discovery/TRANSPLANT.md` (8)

</details>

<details><summary>R-r4-measurement-record: 17 files, 1940 occ</summary>

Reason: section 7b: the round's own measurement artifacts (join member sets, oracle printouts, inventories, lane reports) carry legacy tokens AS MEASUREMENT RECORDS. They are inside the swept population and admitted as records, not excluded by path. Contribution emitted under section7b.

- `runtime/S-OS-06/r4/cross-lab-join.members.json` (166)
- `runtime/S-OS-06/r4/histproof-d3-local-run.txt` (3)
- `runtime/S-OS-06/r4/join-authored-for-K.json` (15)
- `runtime/S-OS-06/r4/join-restored.json` (113)
- `runtime/S-OS-06/r4/lane-k/adjudication-k.decisions.json` (120)
- `runtime/S-OS-06/r4/lane-k/ENTRY-LEVEL-READING.md` (1)
- `runtime/S-OS-06/r4/lane-k/inventory-k.out.json` (132)
- `runtime/S-OS-06/r4/lane-k/inventory-summary.md` (2)
- `runtime/S-OS-06/r4/lane-k/inventory.json` (132)
- `runtime/S-OS-06/r4/oracle-coverage-map.md` (9)
- `runtime/S-OS-06/r4/oracle-i.candidates.json` (364)
- `runtime/S-OS-06/r4/oracle-iv.out.md` (142)
- `runtime/S-OS-06/r4/oracle-iv.set.json` (721)
- `runtime/S-OS-06/r4/s2a-comparator-premise-findings.md` (7)
- `runtime/S-OS-06/r4/s2e/premise-findings.md` (4)
- `runtime/S-OS-06/r4/s2h/lane-report.md` (2)
- `runtime/S-OS-06/r4/STOP-CONDITION.md` (7)

</details>

