# SP-20260725-002 — memory-verify: agent-memory integrity detector + gated apply

- **Sprint label and number:** SP-20260725-002
- **Title:** memory-verify — a read-only agent-memory integrity detector, a transactional gated executor, and the `/memory:verify` skill
- **Owner:** Alex ε (sprint conductor), under Alex α
- **Parent epic:** [E-SYSTEM-ORG-001](../epics/E-SYSTEM-ORG-001-agent-system-org-cleanup.md)
- **Goal:** Make agent-memory drift self-detecting. Ship a read-only structural detector over agent-memory stores, a separately gated executor that applies corrections as an all-or-nothing transaction, and a skill that runs the pair.
- **Scope:** `scripts/checks/memory-integrity.js` (detector, read-only), `scripts/checks/memory-apply.js` (gated executor), `.claude/commands/memory/verify.md` (skill), and the two test suites `memory-integrity.test.js` and `memory-apply.test.js`.
- **Out of scope:** Wiring the detector into `/scan:full` — deliberately deferred and logged as ED-287. Semantic judgement about memory CONTENT; the detector is structural.
- **Current state:** Active
- **Percent completion:** 80% — fix round r10 closed all four defects it targeted and both suites rose (47/47 and 36/36), but the r10 gauntlet is red again: re-establishing the security scope on a provider that discriminates surfaced three NEW HIGHs, including an out-of-store write. Percent is held rather than raised because the newly-surfaced defects are at least as serious as those closed.

## Definition of Done
- [x] A read-only structural detector exists and cannot mutate a store.
- [x] The executor applies corrections as a backup → apply → rollback transaction, so a mid-flight failure leaves no partial apply.
- [x] The skill exists and invokes the pair.
- [x] Both test suites pass on the sprint commit.
- [ ] The detector rejects malformed frontmatter without false-greens.
- [ ] The executor never leaves a structurally invalid store on disk.
- [ ] All registry-fixed gauntlet lanes return `pass` on one single commit.
- [ ] Landed on `main`.

## Related definitions
- Validator, Verification, Evidence, Completion — see ../../TRACKER.md

## Tasks
- [x] Build the read-only detector with fail-closed parsing.
- [x] Make the executor a true all-or-nothing transaction with an in-memory byte-exact backup.
- [x] Add case-family canonicalization for store names and an index-accessibility pre-check.
- [x] Reject non-flat `metadata` mappings.
- [x] Linearize `decodeScalar` after a self-caught ReDoS.
- [ ] Treat an unquoted comment-only scalar as an absent value (open — qa-reviewer HIGH).
- [ ] Refuse to enter metadata-block mode when `metadata` carries a same-line scalar (open — qa-reviewer HIGH).
- [ ] Pre-validate a corrected body before mutation, or roll the transaction back on a fatal post-check (open — backend-reviewer HIGH, qa-reviewer MEDIUM).
- [ ] Sync the taxonomy list in the script header (open — qa-reviewer LOW).
- [ ] Re-run the qa and backend reviewer lanes on the fixed commit.

## Files expected to change
- `scripts/checks/memory-integrity.js`
- `scripts/checks/memory-apply.js`
- `.claude/commands/memory/verify.md`
- `scripts/checks/memory-integrity.test.js`
- `scripts/checks/memory-apply.test.js`

## Files actually changed
- `scripts/checks/memory-integrity.js` — 2026-07-25 through 2026-07-26
- `scripts/checks/memory-apply.js` — 2026-07-25 through 2026-07-26
- `.claude/commands/memory/verify.md` — 2026-07-26
- `scripts/checks/memory-integrity.test.js` — 2026-07-26
- `scripts/checks/memory-apply.test.js` — 2026-07-26

## Paths expected to exist
- `scripts/checks/memory-integrity.js`
- `scripts/checks/memory-apply.js`
- `.claude/commands/memory/verify.md`

## Paths verified to exist
- `scripts/checks/memory-integrity.js` — Verified Exists 2026-07-27 via `ls -la` by Alex ε
- `scripts/checks/memory-apply.js` — Verified Exists 2026-07-27 via `ls -la` by Alex ε
- `.claude/commands/memory/verify.md` — Verified Exists 2026-07-27 via `ls -la` by Alex ε
- `scripts/checks/memory-integrity.test.js` — Verified Exists 2026-07-27 via `ls` by Alex ε
- `scripts/checks/memory-apply.test.js` — Verified Exists 2026-07-27 via `ls` by Alex ε

## Paths verified nonexistent
- None currently recorded.

## Wirings expected
- `/memory:verify` skill → the detector and the gated executor.
- Detector → `/scan:full` lane registry — deliberately NOT wired; deferred and logged as ED-287.

## Wirings verified
- None currently recorded. The skill-to-script wiring is verified by the skill's own test path, not by a wiring ledger record.

## Dependencies
- The live agent-memory stores as the corpus the detector reads.

## Blockers
- Five open defects from the r10 gauntlet — three HIGH (hardlink escape writing outside the store; a parser fail-open that bypasses the r10 pre-validation gate; a rollback that reports `rolledBack: true` while changing MEMORY.md bytes), one MEDIUM (invisible-only evidence passes the evidence gate), one LOW (the taxonomy test has no teeth in the reverse direction). Next action to clear: β's scope ruling, then one r11 round covering all five, then a full three-lane re-fire including security-via-GPT.

## Risks
- Partial fix / likelihood medium / impact medium — a brief covering only some of the named defects guarantees the omitted one re-fails on re-review. Mitigation: enumerate every finding with its file and line in one brief.
- Executor blast radius / likelihood low / impact high — the executor mutates real memory files. Mitigation: it stays gated behind an explicit apply flag, and the open HIGH is precisely about closing its last dirty-store path.

## Decisions
- 2026-07-26 — Defer the `/scan:full` wiring rather than widen the sprint; log the gap as enforcement debt ED-287.
- 2026-07-27 — ε adjudication: the gauntlet is FAIL. The two agy security lanes returned `pass`, but the qa and backend lanes returned binding FAILs, so the sprint does not land.

## Open questions
- None currently recorded.

## Session log
<!-- Append-only (§24). See SESSION_LOG_TEMPLATE.md for the full field set. -->
### 2026-07-27 00:15 UTC — Session 2026-07-26-sprint-resume
- Agent(s): Alex ε (conductor), Alex α (dispatcher) · Mode: sprint
- Work performed: Resumed the sprint mid-gauntlet. α fired the four-lane re-review against commit `a56978fc`; ε verified lane liveness and adjudicated the returned verdicts.
- Files changed: None by ε. · Paths changed: None. · Wirings changed: None.
- Decisions: Adjudicated the gauntlet as FAIL; withheld the land.
- Issues discovered: Two parser false-greens in the detector and one apply-safety gap in the executor.
- Definitions added/changed: None
- State change: Active → Active · Completion change: 80% → 80%
- Verification performed: `gauntlet-verify` over the three registry roles on the canonical ledger; verdict artifacts read directly. · Validation run: `node scripts/dispatch/gauntlet-verify.js --roles security-reviewer,qa-reviewer,backend-reviewer --since 2026-07-27T00:03:00Z` · Validation result: PASS (liveness), exit 0
- Next action: Author one fix brief covering all four named defects, then re-run the qa and backend lanes.
- Evidence/references: `runtime/gauntlet-SP-20260725-002/out/` (four verdict payloads)

### 2026-07-27 02:20 UTC — Session 2026-07-26-sprint-resume (r10 round)
- Agent(s): Alex ε (conductor), backend-fixer, the registry reviewer roster · Mode: sprint
- Work performed: β authorized the bounded 3-defect-plus-low fix (DECIDE B/0.89, msg_id `b41d8f06-9c27-4e53-8d1a-3f7b2e9c604d`) and OVERRODE the default re-convergence scope, requiring the security lane be re-established on a provider that demonstrably discriminates rather than carrying the antigravity PASSes. A fixer closed all four; α merged at `16bcf623`; the three lanes re-fired.
- Files changed: `memory-integrity.js`, `memory-apply.js` and both test files (by the fixer). None by ε.
- Decisions: adjudicated the r10 gauntlet as FAIL; withheld the land; superseded the staged qa-only micro-brief with a full five-item r11 brief.
- Issues discovered: three NEW HIGHs — a hardlink escape writing outside the store, a parser fail-open bypassing the new pre-validation gate, and a rollback reporting success while altering MEMORY.md bytes — plus a MEDIUM (invisible-only evidence) and the qa LOW.
- Definitions added/changed: None
- State change: Active → Active · Completion change: 80% → 80%
- Verification performed: all three lanes liveness-verified; every verdict read from its on-disk artifact rather than from relay; both suites re-run directly by ε (47/47, 36/36); the rider-3 store check run in report mode. · Validation run: `node scripts/dispatch/gauntlet-verify.js --roles qa-reviewer,backend-reviewer,security-reviewer --since 2026-07-27T02:06:00Z` · Validation result: PASS, exit 0
- Next action: β scope ruling, then the r11 round.
- Evidence/references: `runtime/gauntlet-SP-20260725-002/out/{security-reviewer-r10-gpt,qa-reviewer-r10,backend-reviewer-r10}.json`; brief at `runtime/gauntlet-SP-20260725-002/r11-fix-brief.md`
- Note for the retro: β's rider F is vindicated by measurement. The antigravity lanes returned 0 findings twice on this code; the GPT lane found three HIGHs on it. A 0-finding lane that provably missed what another caught is an unfalsifiable null result, not evidence of a clean scope.

### 2026-07-28 19:50 UTC — Session 2026-07-28-r13-refire
- Agent(s): Alex ε (conductor) · Mode: sprint
- Work performed: Fired the three held r13 lanes against `92b9d19e` and adjudicated. Verified the basis BEFORE firing: the r13 files are unchanged since `92b9d19e`, both suites match their stated counts (memory-apply 64/64, memory-integrity 59/59), and the staged security prompt cites `92b9d19e` and carries INV-3a/INV-3b — a staged prompt is pinned to the commit it was built against, so this is checked rather than assumed. Every finding was then re-verified at source rather than accepted from the reviewer.
- Files changed: None by ε. · Paths changed: None. · Wirings changed: None.
- Decisions: Adjudicated the r13 gauntlet as FAIL; withheld the land; held the unified brief until all three lanes were in, so that no survivor is omitted.
- Issues discovered: FIVE survivors. S-1 HIGH `memory-apply.js:276` — TOCTOU source-swap: `renameSync` re-resolves the temp BY PATH after a chain otherwise bound to the DESCRIPTOR, breaking the module's own `:234` invariant ("THE DESCRIPTOR, not the path"). B-1 MEDIUM `:202` — the confinement check rejects legitimate case-variant spellings (reproduced directly through `__testonly__`: control writes, three case-variants throw EOUTOFSTORE, `existsSync` proves the same directory); it is the ONLY comparison in the module whose two sides have independent provenance, so `:651` is structurally safe and deliberately out of scope. B-2 MEDIUM `:139` — `strayTempNames` swallows readdir errors and fails OPEN. B-3 MEDIUM `:337` — `canonicalStoreName` swallows readdir errors and fails CLOSED but conflates "could not read the store" with "no such file", at the choke-point its own docstring calls the one canonicalization the case class routes through. B-2 and B-3 are the same swallow shape failing in OPPOSITE directions, which is why "make it fatal" is the wrong instruction for either.
- Definitions added/changed: None
- State change: Active → Active · Completion change: 80% → 80% (held: the newly-surfaced HIGH is at least as serious as anything closed in r13)
- Verification performed: all three lanes liveness-verified from the completion ledger, not from prose; every verdict read from its on-disk artifact; both suites re-run directly by ε; B-1 reproduced with a purpose-built probe; the r13 un-export independently confirmed to have no production consumer (only the test file, via `__testonly__`, with the suite asserting the surface shape). · Validation run: `node scripts/dispatch/gauntlet-verify.js --roles security-reviewer,backend-reviewer,qa-reviewer --since 2026-07-28T21:30:00Z` · Validation result: PASS, exit 0 — all three roles produced well-formed completion records
- Next action: fresh live-β ruling on r14 (the r13 authorization was one-round-capped), then ONE unified brief covering all five ids.
- Evidence/references: `runtime/gauntlet-SP-20260725-002/out/{security-reviewer-r13-gpt,backend-reviewer-r13,qa-reviewer-r13}.json` — persisted from session-scoped harness temp files, which do not survive the session
- Dispatch note for the retro: the security lane took three attempts, and the first two failures were routing errors of ε's own making, not provider outages. The registry default routes `security-reviewer` to antigravity — the binding security lane defaulting to a provider ADR-0039 bars as scope-of-record — and it only surfaced loudly because the 95KB prompt blew agy's 32000 argv bound. A shorter prompt would have produced a plausible-looking agy verdict. Then `--provider openai` inherited `effort: null` (agy has no effort flag) and defaulted to xhigh, which on gpt-5.6-sol at this prompt size died at the 540s clamp (elapsed 540237ms) and then instantly. gpt-5.6-terra, the configuration already proven on the qa lane at the same prompt size, completed in 461227ms.

## Change log
### 2026-07-28 19:50 UTC — Session 2026-07-28-r13-refire
- Changed: r13 gauntlet round completed and adjudicated FAIL; three verdict artifacts persisted into the sprint evidence dir.
- Reason: The r13 lanes were staged but never fired; adjudication was unclaimed at the previous session's wrap.
- Affected: `runtime/gauntlet-SP-20260725-002/out/`, this tracker
- Previous state: Active, r13 merged, lanes held unfired.
- New state: Active, r13 gauntlet RED with five enumerated survivors, r14 pending a fresh β ruling.

### 2026-07-27 00:15 UTC — Session 2026-07-26-sprint-resume
- Changed: This tracker file created as the sprint's durable record; state recorded as Active with a red gauntlet.
- Reason: The sprint ran to fix round r9 and through a full gauntlet without ever being registered in the tracker system.
- Affected: `TRACKER.md`, `trackers/sprints/`, epic E-SYSTEM-ORG-001
- Previous state: Untracked — no tracker file, no TRACKER.md row, no ROADMAP entry, no `active-sprints.yaml` record.
- New state: Active, tracked, linked from `TRACKER.md`.

## Evidence log
### 2026-07-27 00:08 UTC — All three registry gauntlet roles ran and produced well-formed completion records
- Evidence type: Validation result
- Detail/location: `node scripts/dispatch/gauntlet-verify.js --roles security-reviewer,qa-reviewer,backend-reviewer --since "2026-07-27T00:03:00Z" --until "2026-07-27T00:20:00Z"` → PASS, exit 0; the security role shows four records because the security review ran as two sequential parts
- Verified by: Alex ε · Supports: the gauntlet completed rather than silently died

### 2026-07-27 00:08 UTC — backend-reviewer returned FAIL with a HIGH apply-safety finding
- Evidence type: Review note
- Detail/location: `runtime/gauntlet-SP-20260725-002/out/backend-reviewer.json` — HIGH at `memory-apply.js:417`; a `correct` plan with a non-empty but structurally invalid body is written before the store is proven clean, and the post-check then exits 1 with `applied: true`
- Verified by: Alex ε · Supports: DoD item "the executor never leaves a structurally invalid store on disk" is NOT satisfied

### 2026-07-27 00:08 UTC — qa-reviewer returned FAIL with two HIGH parser false-greens
- Evidence type: Review note
- Detail/location: `runtime/gauntlet-SP-20260725-002/out/qa-reviewer.json` — HIGH at `memory-integrity.js:149` (a comment-only scalar passes as a real value) and HIGH at `memory-integrity.js:229` (`metadata` with a same-line scalar still satisfies a nested `type`), plus a MEDIUM restating the executor gap and a LOW taxonomy-sync miss
- Verified by: Alex ε · Supports: DoD item "the detector rejects malformed frontmatter without false-greens" is NOT satisfied

### 2026-07-27 00:07 UTC — Both agy security lanes returned PASS
- Evidence type: Review note
- Detail/location: `runtime/gauntlet-SP-20260725-002/out/security-reviewer-part1.json` and `security-reviewer-part2.json` — verdict `pass`, findings empty in both. Recorded with the ED-230 caveat that an `ok:true` antigravity record establishes liveness only, because the served model is not yet proven.
- Verified by: Alex ε · Supports: the security scope, at the disclosed evidence strength

## Verification log
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| `memory-integrity.js` | Yes | Verified Exists | `scripts/checks/` | `ls -la` | 2026-07-27 | Alex ε |
| `memory-apply.js` | Yes | Verified Exists | `scripts/checks/` | `ls -la` | 2026-07-27 | Alex ε |
| `.claude/commands/memory/verify.md` | Yes | Verified Exists | `.claude/commands/memory/` | `ls -la` | 2026-07-27 | Alex ε |
| Detector wired into `/scan:full` | No | Verified Nonexistent (and expected nonexistent) | `/scan:full` lane registry | deferred by decision; logged as ED-287 | 2026-07-27 | Alex ε |
| Four lane completion records | Yes | Verified Exists | canonical `dispatch-completions.jsonl` | `gauntlet-verify` exit 0 | 2026-07-27 | Alex ε |

**STATE AS OF 2026-07-29 (supersedes the r11-era text that stood here; corrected per β D1 before the 1.2.0 tag).**

This sprint is **OPEN**. It is NOT closed, NOT complete, and the 1.2.0 release does not close it.

- **Rounds ran through r15.** r15 @ `8adf768b`: qa PASS (0 findings); backend FAIL (1 MEDIUM); security FAIL (3 HIGH). Four findings remain **OPEN**, filed one row each in `paths.enforcementDebt`: **ED-306** (S-3, successful delete silently rewrites retained MEMORY.md line endings), **ED-307** (S-4, the close→rename window can leave a failed apply with the store changed, so `ok:false` does not imply pre-apply byte identity), **ED-308** (S-5, rollback verification checks only backed-up paths, so a failed temp cleanup leaves a new in-store file while reporting `rolledBack:true`), **ED-309** (B-6, a swallowed unlink failure at `memory-apply.js:370` that also wedges every subsequent apply).
- **None of the four is eligible for the disclosed-residual route.** All four fail ADR-0039 §A2.1 condition 2 — each is a claim consumed as a safety guarantee that is silently false — so "land it as debt" is not permitted by the doctrine. They ship as OPEN findings behind a held executor, never as accepted debt.
- **`--apply` is HELD fail-closed in MC 1.2.0** (**ED-310**, the tracked home of the hold and its unhold trigger). The read-only detector `scripts/checks/memory-integrity.js` ships and is useful on its own; it is byte-identical between the released tree and `8adf768b` (verified: `git diff` empty, 806 lines both), which is why the release record may inherit the r15 qa PASS.
- **The hard terminal: RAN, AND IS NOW CONSUMED.** β reserved exactly ONE more pass, to be run a different way — write the guarantees down first, then verify the code against the *written invariants* rather than against reported findings. That pass ran. **Outcome, in β's exact words (`2d94f6b1`), to be quoted rather than paraphrased: "terminal not fired; `--apply` held and scoped as a follow-up; the reserved pass is consumed."**
  - **Why the terminal did not fire.** The trigger was *another* HIGH — meaning the count of uncounted HIGHs grows again, i.e. the module is not converging. It did not grow. Both lanes' HIGHs confirm **already-counted** findings by observed bytes and **narrow** them (ED-306 to sub-clause (i) only; ED-309 corrected *downward*). β checked that letter and purpose **agree** on that reading rather than choosing between them, because declining twice on the same reasoning is how a cap gets argued away.
  - **What that does NOT mean — the load-bearing half.** Terminal-not-fired is **NOT** unhold. `--apply` **does not ship**, and it **is** a scoped follow-up — reached by the pass's *success* rather than by the terminal's firing. All four HIGHs fail ADR-0039 §A2.1 condition 2, so the disclosed-residual route is unavailable and "land it as debt" is not permitted. β's framing: *the terminal was insurance against the pass failing to converge; the pass converged, so we arrive where the terminal would have sent us by the honest route.*
  - **THE PASS IS CONSUMED (R1).** Three lanes, **23 apply-probes executed, zero absorbed by a hold**. No further pass is granted under row 275; work on `--apply` from here is a **new work item needing its own authorization**, and anyone proposing "one more round" is proposing a second pass the terminal does not grant.
  - **Lane verdicts** — I4 report-state totality (7 emittable configurations enumerated, unprimed by design): `runtime/sp002-invariants/lane-i4-report-state-totality-verdict.md`. Lane 1 I1 success-path (**FAIL on I1.c**; five of six sub-invariants PASS with byte evidence, including both required positive probes): `…/lane-i1-success-path-verdict.md`. Lane 2 I2/I3 (**FAIL on I2.a, I2.c, I3.b, I3.c**): `…/lane-i2-i3-failure-rollback-verdict.md`. Invariants spec: `runtime/sp002-invariants/invariants-v2.md` (v1 retained, SUPERSEDED).
  - **Two disclosures that must survive into the follow-up.** I1.f **holds by construction and its PASS is not independent evidence** — the post-check *is* the detector and a dirty store is refused before mutation, so the delta is zero by construction; it becomes falsifiable only if the projection gate stops refusing a dirty store. And **I3.a's PASS was reachable only via the surrogate-collision lever** (ED-322) — real evidence, exotic path, not a naturally-occurring route.
  - **New debt from the pass:** ED-320 (`applied:true` over an unchanged store, second mechanism), ED-321 (`undo` rewrites unmutated captured paths; errs fail-closed; its equality-skip fix also closes ED-320), ED-322 (the "cannot disagree by construction" claim is false — **the action item is auditing every place that claim was used as a justification**, since r12's fix leaned on it), ED-323 (POSIX mode/ownership, recorded **untested-on-this-platform**). Amended: ED-306 (observational confirmation, the narrowing, and the deliberate-policy cause — fixing it *reverses a documented decision* rather than patching a bug), ED-308 (**grounding-confirmed, outcome-form unreached** — the literal form argued structurally unreachable under single-writer fault injection, generalising to POSIX), ED-309 (**overclaim corrected**: the residue is denied by `rollbackVerified`, not by `rolledBack` — an error ε's own first amendment had inherited by transcribing a finding report without verifying it).
  - **The scoped follow-up must carry:** the four HIGH fix sites as now pinned (the LF rejoin in `removeIndexLines`; `undo`'s captured-set-only verification; the four bare-`catch {}` cleanups cited by enclosing construct; the `applied` derivation — **fix `applied`, never `rolledBack`'s deliberate fail-closed**), ED-321's equality-skip, ED-322's justification audit, ED-323's POSIX probe, and re-verification **against these invariants** rather than against findings.
- **Governing rulings** (each cited by msg_id AND its git-tracked verbatim text, per β rider R2 — an msg_id with no tracked resolver is a dead end): betaEvents row 275 `d4f81b6a` (ESCALATE, class C, ED-287) — `runtime/beta-consult/ROW-275-ESCALATE-verdict-d4f81b6a.md` · `3b7c9f41` hold shape, C1–C8, with the `8c4d1e6b` refusal-citation amendment as an AMENDMENT section in the same file — `runtime/beta-consult/ROW-275-HOLD-SHAPE-verdict-3b7c9f41.md` · `5e2a80c7` landing discharge (row 275's "do not land" is scoped to the EXECUTOR and discharged for the 1.2.0 landing only) — `runtime/beta-consult/ROW-275-LANDING-DISCHARGE-verdict-5e2a80c7.md`. Provenance correction + tracking adoption: rows `9f3c26d4` / `c1a7b482` (2026-07-29).
- **Next action:** open the **scoped follow-up** as a new work item with its own authorization, carrying the specification above. **Not** another round inside this sprint — the reserved pass is consumed and row 275 grants no second one. This sprint stays OPEN with `--apply` HELD until the follow-up fixes the four HIGHs and re-verifies against the written invariants.

## Completion record
- Final state: Not yet complete
- Percent completion: n/a
- Completion timestamp: n/a
- Definition of done used: the Definition of Done above
- Evidence of completion: n/a — the gauntlet is red
- Session IDs / dates / agents: 2026-07-25 through 2026-07-27, Alex ε + Alex α + the registry-fixed reviewer roster
- Parent epic: E-SYSTEM-ORG-001
- Remaining follow-up items: three open defects plus one low; ED-287 (`/scan:full` wiring deferred); the ED-230 served-model caveat on the antigravity lanes
- Related untracked work: None
- ../../TRACKER.md updated: Yes · Roadmap reconciled: No
