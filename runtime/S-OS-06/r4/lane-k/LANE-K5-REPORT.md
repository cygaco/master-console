# LANE-K5 REPORT: S-OS-06 r4, lane K5, the residue re-emitted at OCCURRENCE grain

**Status: COMPLETE.** This is a grain correction, not a re-measurement. The inventory was not re-run, the standing lane K adjudication was not redone, and nothing was fixed, renamed or removed. The occurrence register and the manifest were not regenerated, and nothing under `.github/**` was touched.

- Ruling carried: β `b3f81d47-2c9a-4e60-8571-0d94a7e3c6b2` (DECIDE, Class B).
- Instrument: `occurrence-k5.js`. Per-occurrence decisions: `occurrence-k5.overlay.json`. Full output with every occurrence row: `occurrence-k5.out.json`. Appendix renderer: `render-k5.js`. Rendered appendix: `LANE-K5-APPENDIX.md`.
- Reproduce: `node runtime/S-OS-06/r4/lane-k/occurrence-k5.js --out runtime/S-OS-06/r4/lane-k/occurrence-k5.out.json` then `node runtime/S-OS-06/r4/lane-k/render-k5.js`. The instrument exited 0.

## 1. Head measured at

- **Measured at `b44f6511895cb4add3635e3c9d59eb336c942f79`** on `s-os-06/s2k-properties`.
- The standing adjudication instrument ran at `53cf07d1`. `git diff --name-status 53cf07d1 b44f6511` touches only lane-K files: `LANE-K-REPORT.md` (M), `LANE-K5-REPORT.md` (A, this stub) and `adjudication-k.out.json` (A). No file in the adjudicated population moved.
- Machine check, not assumed: the instrument re-scans every one of the 206 RESIDUE files and the 5 CANNOT-ASSESS files at this head. It REFUSES (exit 2) if any per-file count differs from the standing row. All 211 matched.
- **Register staleness caveat.** The committed occurrence register is stale against the merged tree (pinned 319 in the register vs 334 on regeneration). This lane did not regenerate it, because sequencing that is α/β's call. **If the register is regenerated, these sets need re-deriving.** The count guard above refuses on drift, so a re-run cannot silently reuse them.

## 2. Headline: the RESIDUE at occurrence grain

Standing figure: **206 files / 1013 content occurrences**, reported per FILE. Re-emitted per OCCURRENCE:

| Disposition | Occurrences | Note |
|---|---:|---|
| RESIDUE / fix | 721 | |
| RESIDUE / compat-seam | 140 | 28 deprecated alias skill files × 5 each |
| RESIDUE / fix+rename | 59 | the cross-project design spec |
| RESIDUE / rename | 2 | |
| **RESIDUE subtotal** | **922** | |
| **B** (record, verbatim) | **76** | bundled into RESIDUE by the per-file rows |
| **A** (instrument) | **15** | 11 S-OS-06 sprint subject (standing rule, pin OWED) + 4 references to a kept, test-pinned filename (pin OWED) |
| CANNOT-ASSESS | 0 | every occurrence has a disposition |
| **Total** | **1013** | reconciles: `content occurrences 1013 == standing RESIDUE 1013 [holds=true]` |

Plus **16 name-only occurrences** (compat-seam check shims under `scripts/checks/`, 0 content occurrences, legacy basename only). They stay outside the 1013, as they were in the standing count.

**What the grain correction found.** 11 of the 206 files carry mixed content. Their per-file disposition bundled **91 occurrences that are not residue** (76 B + 15 A). No file leaves RESIDUE entirely: all 206 still carry at least one RESIDUE occurrence. The other 195 files are homogeneous, and the appendix lists every one of their occurrences by line:col so the homogeneity claim can be checked.

| Mixed file | RESIDUE | B | A |
|---|---:|---:|---:|
| `_planning/design/WARP-cross-project-nervous-system.md` | 59 (fix+rename) | 2 (L28, L38) | 0 |
| `_planning/principle.md` | 5 | 1 (L113) | 1 (L6) |
| `_planning/README.md` | 3 | 0 | 1 (L19) |
| `_planning/warpos-lifecycle-plan.md` | 18 | 12 | 2 (L423, L478) |
| `.claude/agents/president/_system/policy/adr/0013-two-dispatch-shape-gates.md` | 5 | 1 (L32) | 0 |
| `.claude/project/sprint/active-sprints.yaml` | 1 (L1) | 29 (titles) | 0 |
| `.claude/project/sprint/requirements/S-VLADW1-02/granular-stories.md` | 6 | 1 (abspath) | 0 |
| `.claude/project/sprint/requirements/S-VLADW1-02/prd.md` | 6 | 9 (abspath) | 0 |
| `.claude/project/sprint/requirements/S-VLADW1-02/trace.md` | 1 | 1 (abspath) | 0 |
| `.claude/project/sprint/sprints/S-OS-06/current.yaml` | 1 (L1 schema) | 10 (abspath) | 11 (L8/L9 sprint subject) |
| `.claude/project/sprint/sprints/S-VLADW1-02/current.yaml` | 5 | 10 (abspath) | 0 |

Where the mixed dispositions come from:
- **The sprint-body rows (5 files)** already computed per-occurrence kinds (abspath → B, schema-id → sprint schemaSet, other → sprint otherSet). The per-file row then collapsed them by maximum rank. The K5 output un-collapses them. Nothing is re-decided.
- **Explicit rows with a standing `liveLines` partition (ADR, principle, _planning README, lifecycle plan, active-sprints)**: live lines stay RESIDUE, and every other occurrence gets a stated disposition in the overlay. The instrument does not let a non-live occurrence inherit silently; without an overlay entry it would emit CANNOT-ASSESS, and that happened 0 times.
- **The design spec**: its standing reason already named L28-38 as B-lines inside a live spec. The per-file row bundled them anyway, and they are now split out.

### Finding to flag: the standing `liveLines` for `_planning/warpos-lifecycle-plan.md` under-enumerated

The standing row listed 6 live lines (L90/L107/L129/L334/L455/L482) under the warrant *present-tense claims with legacy identifiers that no longer resolve at head*. Reading the 26 non-live occurrences one by one turned up 8 more of the **same class under the same warrant**. They are recorded as RESIDUE/fix and labelled `STANDING-RULE APPLICATION` in the output:
- L58, L76, L228: schema id `…/mode-marker/v2`. Scripts emit only `mc/mode-marker/v2` (3 hits, 0 legacy).
- L82: env name `…_AUTO_MODE`. Scripts read only `MC_AUTO_MODE` (2 hits, 0 legacy).
- L121, L171: the legacy ship-coverage check named as the live wiring or enforcer. It resolves only through the compat shim that expires at 2.1.0; this is β's ADR reasoning applied.
- L161: the legacy `{setup,health,update}` alias skills, which expire at 2.1.0.
- L122: a present-tense claim about the ingest lifecycle file, which is ABSENT at head (the same class as the standing live line principle.md L4).

This applies the standing rule. No new rule was written. It moves 8 occurrences within a file that was already RESIDUE and does not change the file's set. It is flagged because it corrects the standing row's enumeration. The other 18 non-live occurrences are B (12: title, provenance, Phase-0 analysis prose, the proof paragraph, the epic title as minted) or A (2: self-path to the kept filename). Each has its warrant in Appendix A1.

## 3. ADR `0013-two-dispatch-shape-gates.md`: SPLIT, occurrence by occurrence

β: *the decision body is record and stays verbatim. The mitigations and reversal-plan sections are OPERATIVE instructions naming environment variables the scripts no longer read, surviving only on a window that expires at 2.1.0. **The reversal plan will be false exactly when someone executes it.***

One file, two dispositions, split by occurrence:

| Line:col | Section | Form | Disposition |
|---|---|---|---|
| L32:3 | `## Decision` (L7-37) | `…_DISPATCH_CONTRACT_ENFORCE` | **B**, record, verbatim |
| L81:14 | `## Mitigations / escapes` (L79-84) | `…_DISPATCH_CONTRACT_ENFORCE_<WRAPPER>` | **RESIDUE / fix** |
| L82:2 | `## Mitigations / escapes` | `…_DISPATCH_CONTRACT_ENFORCE` | **RESIDUE / fix** |
| L82:52 | `## Mitigations / escapes` | `…_DISABLE_SHAPE_DOOR` | **RESIDUE / fix** |
| L83:9 | `## Mitigations / escapes` | `…_DISPATCH_CONTRACT_ENFORCE` | **RESIDUE / fix** |
| L87:6 | `## Reversal plan` (L85-89) | `…_DISPATCH_CONTRACT_ENFORCE` | **RESIDUE / fix** |

Tally: B 1, RESIDUE 5. The warrants are occurrence-level; the sections only locate the occurrences and are not a new grain (β: per-section is NOT a new grain). Fix form (not done here): name the current variables in the operative sections, and leave L32 untouched.

## 4. `_reports/README.md`: FIX (homogeneous)

β: it describes the PRESENT repository, so rewriting falsifies no record. All 4 occurrences carry the one disposition:

| Line:col | Form | Disposition |
|---|---|---|
| L71:18 | brand | RESIDUE / fix |
| L71:60 | brand | RESIDUE / fix |
| L73:36 | brand | RESIDUE / fix |
| L86:66 | brand | RESIDUE / fix |

## 5. The five cannot-assess, read individually

Refuse-never-skip. Each one was read and has its own reason. None is disposed by category.

| # | File | Occurrence | Disposition | Its own reason |
|---|---|---|---|---|
| 1 | `.claude/project/sprint/sprints/_no-active-sprint/reasoning-auto-approval.md` | L119, schema id `…/auth/v1` | **B** | Reasoning episode **RT-003, dated 2026-05-13** (header L1-8). Candidate 3 *proposes* a flag-file shape. The line records what that episode proposed. The shipped writer and reader use `mc/auth/v1` (`scripts/hooks/authorization-gate.js:315`, `scripts/turbo/apply.js:10`), and nothing reads this document as a contract. Sprint state does not apply: `_no-active-sprint` is a bucket, not a sprint. |
| 2 | `.claude/project/sprint/sprints/SP-20260528-002/current.yaml` | L1, `schema: …/sprint/current-sprint/v1` | **RESIDUE / fix** | Registered in `active-sprints.yaml` (L598-600) with **status: planning**. The file says `status: not_started`, `current_phase: idle`, so the sprint is non-terminal. The registry *could* establish this state; the earlier time box did not get to it. That is the plan-only class, whose schema-id lines the standing adjudication already puts in RESIDUE (SP-20260525-*). A resuming runtime reads this state against the `mc/` const. |
| 3 | `.claude/project/sprint/sprints/SP-20260528-002/progress.yaml` | L1, `schema: …/sprint/sprint-progress/v1` | **RESIDUE / fix** | Same sprint, read separately. `status: starting`, `last_completed_step: tracker_initialized`, `current_phase: idle`, registry `planning`. Live state data for a non-terminal registered sprint. |
| 4 | `.claude/project/sprint/sprints/SP-20260619-001/current.yaml` | L1, `schema: …/sprint/current-sprint/v1` | **B** | **UNREGISTERED.** It is absent from `active-sprints.yaml`, and `runtime/…-v1-discovery/lanes/03-sprint.md:36` lists it as orphaned (on disk, not in registry). `status: not_started`. It was committed in `17c54bd2` among "23 settled sprint artifacts". No registry-driven reader reaches it, so the schema line has no live consumer and records what the initializer wrote. Whether to REMOVE the orphan is not this lane's call. |
| 5 | `.claude/project/sprint/sprints/SP-20260619-001/progress.yaml` | L1, `schema: …/sprint/sprint-progress/v1` | **B** | Same orphan, read separately. `status: starting`, `last_completed_step: tracker_initialized`. There is no registry entry and no runtime reader, and it was committed as a settled artifact. The line records the initializer's output. |

Result: **B 3, RESIDUE/fix 2, CANNOT-ASSESS 0.** The instrument verifies that each file still has exactly one occurrence at the stated line before it applies the reading.

**Net effect on the round's sets** (standing + K5, stated separately so neither double-counts): RESIDUE content occurrences 922 (grain-corrected) **+ 2** (from the five) = **924**, across **208 files**. B gains 76 (grain) + 3 (the five). A gains 15 (grain). CANNOT-ASSESS goes from 5 to 0.

## 6. The CI hit, stated ONCE

- `.github/workflows/` holds exactly one tracked file, `leak-gate.yml` (verified: `git ls-files .github/workflows`). Line 36, in the `tracked-transients` step, runs the legacy-named tracked-transients check script. That is **1 file, 1 occurrence**.
- **Disposition: OPERATOR-GATED** (property D resolves it as operator-gated). Lane J defers this same occurrence. Per β, it is **COUNTED ONCE**. It appears in no K5 tally above: not in the 1013, not in the 922/924, not among the five. The standing lane K row that carried it as CI-UNRULED is superseded by this single operator-gated statement, not added to it.
- Identified only. Not edited. `.github/**` is out of scope, and the classifier auto-denies edits there.

## 7. REMOVED accounting

- **Lane K REMOVED: 0 files, 0 occurrences.** This lane (K and K5) removed nothing.
- **The round's entire REMOVED count sits in lane J.** Neither lane's tally includes the other's. The 16 name-only compat-seam shims and 140 compat-seam alias occurrences above are dispositions (*compat-with-expiry or REMOVED, never FIXED*), not removals. If lane J removes any of them, that count is lane J's, and these rows must be re-derived rather than netted here.

## 8. What was not done (out of scope)

No fixes or renames. No codemod, runner or oracle changes. No `.github/**` edits. No regeneration of the manifest or the occurrence register. No `.claude/settings.json` changes. The inventory was not re-run and the standing record was not re-adjudicated. The only departures from the standing enumeration are the 8 lifecycle-plan lines in §2 (the standing rule applied, flagged) and the five in §5 (read individually, as instructed).

## Appendix

The occurrence-by-occurrence rows for the 11 mixed files, with warrants, and the line:col lists for the 195 homogeneous files are in **`LANE-K5-APPENDIX.md`**, rendered from `occurrence-k5.out.json` (1029 occurrence rows: 1013 content + 16 name-only).
