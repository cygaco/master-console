---
description: Run every scan in parallel — a full system scan across project health, governance, and WarpOS distribution integrity — merged into one unified report. One command for full system health.
---

# /scan:full — Unified Health Check

Runs every `/scan:*` skill in parallel and merges their output into one report — a **full system scan**. The single-entry diagnostic. Use before shipping, on session start after a long break, or any time you're about to trust the system to do heavy work.

This skill does **not** duplicate logic — it delegates to the specialists and aggregates. If a specialist changes its checks, `/scan:full` inherits the change for free.

## Input

`$ARGUMENTS` — Mode selection:
- No args — **full system scan**: every `/scan:*` skill (Tier 1 core + Tier 2 governance + Tier 3 WarpOS integrity), default modes
- `--fast` — Tier 1 core only (architecture internal, environment ready, references quick, requirements static compact, system inventory, patterns diagnose-only)
- `--deep` — all tiers in thorough modes (architecture seams+health, environment audit, patterns diagnose+propose, requirements full static audit, every WarpOS integrity scan)
- `--json` — raw aggregated JSON output
- `--since=<N>d` — passed through to patterns for time-window analysis
- `--focus=<feature>` — scoped spec audit in requirements

---

## Delegation plan

Dispatch the scan suite **in parallel** (via Agent tool, each producing a sub-report — or Bash-spawned `claude -p` for non-team sessions). The runtime caps concurrent agents (~10); dispatch in batches as slots free. Every scan is a side-effect-free audit, so parallel dispatch is always safe.

**Tier 1 — Core project health** *(always; the only tier under `--fast`)*

| # | Skill | Mode (default / `--fast` / `--deep`) | Produces |
|---|---|---|---|
| 1 | `/scan:architecture` | internal+seams+health / internal / internal+seams+health | Layer integrity report |
| 2 | `/scan:environment` | ready / ready / audit | Tool + env readiness |
| 3 | `/scan:references` | (default) / --summary / (default) | Broken-ref list |
| 4 | `/scan:requirements` | static / static --compact / static full + drift | Spec health |
| 5 | `/scan:patterns` | diagnose / diagnose / diagnose+propose | Cross-run intelligence |
| 6 | `/scan:system` | inventory / inventory / inventory + drift | System manifest audit |

**Tier 2 — Governance & quality** *(default + `--deep`)*

`/scan:ac-coverage` · `/scan:coherence` · `/scan:design-system` · `/scan:dispatch-routing-parity` · `/scan:privacy` · `/scan:docker-secrets` · `/scan:roadmap-trace` · `/scan:sprint-beta-honesty` · `/scan:sprint-manager-consult` · `/scan:sprint-hook-coverage` · `/scan:skill-hook-coverage` · `/scan:admin-suite-coverage` · `/scan:panel-registry-coverage` · `/scan:adhoc-fail-override` · `/scan:adhoc-team-hygiene` · `/scan:timeline` · `/scan:node-procs` · `/scan:issues` · `/scan:role-parity` · `/scan:model-chain` · `/scan:provider-agent-tool-parity` · `/scan:greek-office-parity` · `/scan:cutover-completeness` · `/scan:scaffold-coverage` · `/scan:etc-harness` · `/scan:ingest-firewall` · `/scan:scan-coverage` · `/scan:meta-lockstep` · `/scan:security-binding-lane`

**Tier 3 — WarpOS distribution integrity** *(default + `--deep`)*

`/scan:install` · `/scan:framework-purity` · `/scan:framework-views-fresh` · `/scan:warpos-version-quorum` · `/scan:version-coherence` · `/scan:warpos-manifest-coverage` · `/scan:warpos-ship-coverage` · `/scan:warpos-manifest-honesty` · `/scan:warpos-path-resolution` · `/scan:warpos-structure-parity` · `/scan:warpos-staleness` · `/scan:warpos-tracked-transients` · `/scan:warpos-capsule-resolvable` · `/scan:warpos-install-baseline` · `/scan:warpos-applied-migrations` · `/scan:warpos-migration-coverage` · `/scan:warpos-migration-presence`

> **Coverage note (2026-05-30):** `/scan:warpos-ship-coverage` was added here after a full-system-scan-vs-`/scan:full` comparison found the ship-coverage check (`scripts/checks/warpos-ship-coverage.js`) existed and passed but was **never delegated by `/scan:full`** — the exact "the enforcer exists but isn't on the path" gap. It guards the B1/E3 "ships to nobody" class.

> **Coverage note (2026-05-31, SP-20260531-004):** added `/scan:role-parity`, `/scan:scaffold-coverage`, `/scan:etc-harness`, `/scan:ingest-firewall` (4 governance/security enforcers that existed but were never delegated) + `/scan:scan-coverage` (the new self-inventory). That manual-comparison gap is now **enforced**: `/scan:scan-coverage` (`scripts/checks/scan-coverage.js`) asserts every `/scan:*` is delegated here or on `scan-coverage.allowlist.json` with a reason — so this list can no longer drift from the `scan/` directory silently. `/scan:warpos-layer-diff` is intentionally excluded (read-only informational, never a gate).

> **Coverage note (2026-06-04, ADR-0007 Tier-4):** added `/scan:sprint-manager-consult` (asserts the named design authority `design-quality` was consulted on every UI-touching `/sprint:full` run — GAP 1) and `/scan:adhoc-fail-override` (rejects a dispatcher that overrode a binding reviewer FAIL — GAP 2, a verdict-CONTENT check distinct from `gauntlet-verify.js`'s record-presence check). Both are the Tier-4 enforcement of ADR-0007's independence + design-authority invariants.

> **Coverage note (2026-06-05, Phase D F3c):** added `/scan:sprint-hook-coverage` — the bidirectional coverage enforcer for the sprint hook-point registry (`.claude/agents/_org/sprint-hook-points.json`): FORWARD (every `block`-row that matched a run's composition has a `manager_consult` record) + REVERSE (registry structurally coherent — every role ∈ `role-registry`, no orphan step). Generalizes the single-manager `/scan:sprint-manager-consult` to the whole registry; the operator's "easily find gaps" made self-detecting on the agent↔sprint surface.

> **Coverage note (2026-06-05, E8 / ED-026):** added `/scan:cutover-completeness` — the rename/cutover gate (`scripts/checks/cutover-completeness.js`). It greps the IMPERATIVE layer (paths.js/paths.json incl. the `LEGACY_FALLBACK` table · hooks · checks · sprint scripts · live dispatch/manifest scripts · fixtures) + the keystone registries (`_principles/registry.json` · `_org/role-registry.json` · `_evals/*.json`) for **RAW** deleted-old-tree literals (`00-alex`/`01-adhoc/`/`02-oneshot/`/`03-managers`) + renamed-away role names — the layer `/scan:role-parity`'s declarative bijection does NOT cover. **The key insight:** it checks the raw literals, NOT alias-resolved roles, because `role-aliases.js` resolves old→new so `role-parity` + `manager-principles` pass GREEN on stale registry data (`L-2026-06-05-alias-table-masks-cutover-staleness`). It is a *flag-don't-fix* gate: it currently exits 1 on the known live keystone debt (the `_principles` dead keys, `03-managers/` paths, `role-registry.current_spec`, the resonance rubric, + two genuinely-broken `phase0-verify`/`test-sprint` refs) — that exit-1 is EXPECTED until the cleanup follow-up lands. Fail-closed (exit 2 = could-not-run = NOT green). Allowlist: `scripts/checks/cutover-completeness.allowlist.json` (the alias table, `was:` fields, frozen capsules, the ADR doc, migrated-from comments).

> **Coverage note (2026-06-05, M1 §8):** added `/scan:skill-hook-coverage` — the SKILLS sibling, bidirectional coverage of the skill hook-point registry (`.claude/agents/_org/skill-hook-points.json`): REVERSE (every entry's role ∈ `role-registry`) + FORWARD (every registered skill has a command file) + HARDCODE/STALE (no skill body hardcodes a renamed-away or unresolved persona role — the rename-break catch). All 8 registered agent-calling skills (roadmap×4 + growth×4) are now MIGRATED — they resolve their persona from the registry at call time; the allowlist (`MIGRATION_PENDING`) is EMPTY, so any new persona hardcode hard-fails. Closes the silent rename-break class on the skill↔agent surface. (Open M1-c tail: `ad-images`/`iterate` dispatch via prose, not a `subagent_type` literal — a registry undercount tracked for the detection-broadening slice.)

> **Coverage note (2026-06-14, SP-20260614-002):** added `/scan:admin-suite-coverage` (`scripts/checks/admin-suite-coverage.js`) — the coverage + freshness enforcer for the `admin:*` dev-tooling suite, **wired REPORT-ONLY** (it does not gate the run; it surfaces findings alongside `/scan:skill-hook-coverage`). Three assertions: (i) each `admin:*` skill (`preview`/`readiness`/`guides`/`seed`) resolves via `dispatch-skill --resolve`, (ii) every `framework/admin-panel-registry.json` `panels` row's opener resolves to a real script/skill (no orphan/phantom), (iii) `scripts/admin/preview.js` carries the `refuseIfTargetIsWarpOS` precondition. Fail-CLOSED (malformed registry → exit 2). It is tolerant by design — a target absent in a worktree mid-gauntlet is SKIPPED-with-note, so the gate reads green pre-integration but enforces every check once the suite is integrated.

> **Coverage note (2026-06-15, SP-20260615-001 — ROADMAP items 23+25):** added `/scan:panel-registry-coverage` (`scripts/checks/panel-registry-coverage.js`) — the coverage enforcer for the `/panel:*` unified panel-opener suite, **wired REPORT-ONLY** (it surfaces findings; it does not gate the run). For each `framework/panel-registry.json` `panels` row it asserts the row shape (`{name,opener,description,run_context}`, `run_context ∈ {in_app,cli}`) and that the `opener` resolves to a real backing target — a `node <script>` file exists, or a `/<ns>:<name>` skill resolves via `dispatch-skill --resolve`; an orphan/phantom/unsafe opener is a finding (exit 1). **Fail-CLOSED on its OWN corrupt input** (unreadable / non-JSON / wrong `$schema` / no `panels` → exit ≥2), **distinct** from a clean pass (exit 0) and from a finding (exit 1) — a coverage check must never read green on its own corruption (β-3, BC-16). Like `admin-suite-coverage`, lane-absent targets SKIP-with-note so it stays green pre-integration.

> **Coverage note (2026-06-16, ED-058 — Opus-4.8-max chain alignment):** added `/scan:model-chain` (`scripts/checks/model-chain.js`) — the named enforcer for the role-registry model/effort CHAIN, **wired REPORT-ONLY** (surfaces findings alongside `/scan:role-parity`). Encodes the operator policy 2026-06-16 (`feedback_model_opus48max_not_fable`): Opus-4.8 is the shipped top, `max` is alpha-ONLY, `fable`/`claude-fable-5` is NOT a model option (scans MODEL fields only — a `_doc` mentioning fable to reject it does not trip it), every role carries a scaled model+effort, and the live consumers (`catalog.js`/`providers.js`) must RESOLVE to the registry's provider+effort (the `[DRIFT]` detector — catches stale `DEFAULT_REASONING_EFFORT` literals). **NOT a duplicate of `/scan:role-parity`** (which owns registry-internal consistency); model-chain adds the no-fable rule, the alpha POSITIVE pin (=opus-4.8/max), completeness, and live consumer parity. **Fail-CLOSED** (exit 2) on an unreadable/unparseable registry. Bite-test `scripts/checks/model-chain.test.js` (19 planted assertions incl. the no-fable false-positive guard). Flip-to-blocking is the ramp tail once the chain holds drift-free.

**Canon integrity — the golden-flow gate** *(default + `--deep`)*

The two canon enforcers run as direct script invocations (they guard the canon engine's output, not a `/scan:*` skill — so they're referenced by path here, not as `/scan:` tokens, and are listed on `scan-coverage.allowlist.json` only as scripts, not skills):

```bash
node scripts/checks/canon-no-unfilled-tokens.js   # WI-38: zero raw {{tokens}} in the generated canonical set (exit 0/1/2, fail-closed)
node scripts/checks/canon-type-coverage.js        # WI-39: the 12-type canon manifest all have templates (exit 0/1/2, fail-closed)
```

Any non-zero exit is a critical finding (a canon artifact shipped a raw token, or a canon type lost its template). Both are fail-closed (exit 2 = could-not-run = NOT green).

**Knowledge-layer integrity — the company-brain gate** *(default + `--deep`)*

The `_knowledge/` layer enforcer (ADR-0007 "company brain", E5) runs as a direct script invocation — it is the engine behind the `/knowledge:coverage` skill (a `/knowledge:*` skill, not a `/scan:*` token, so it is referenced by path here like the canon enforcers, and is not on the `scan-coverage.allowlist.json` skill list):

```bash
node scripts/checks/knowledge-coverage.js   # E5: registry fresh · every LIBRARY consumer wired (marker block + ledger record) · every STORE has its contract README + producer ref · index not drifted · no orphan/phantom records or markers (exit 0/1/2, fail-closed)
```

A non-zero exit is a critical finding (the knowledge brain's wiring drifted — a consumer ungrounded, a marker orphaned, a store uncontracted). Fail-closed (exit 2 = could-not-run = NOT green).

**Playbook-suite integrity — the situational-procedure gate** *(default + `--deep`)*

The situational playbook suite check runs as a direct script invocation. The `_planning/` store is not shipped to products, so the script reports a clean skip when `_planning/` is absent; in canonical WarpOS, where `_planning/playbooks/` exists, it fails closed on missing or malformed playbooks:

```bash
node scripts/checks/playbook-suite-coverage.js   # S-PF-07: launch-readiness, provider-setup, mode-switch, incident-response, and retro-loop reference playbooks exist; each carries Situation/Preconditions/Ordered Steps/Gates/DoD/Rollback and cites SUITE-DESIGN.md (exit 0/1/2, fail-closed when the planning store exists)
```

A non-zero exit in canonical is a critical finding: the reference procedure layer has drifted from the suite design or an authored playbook lost its required operating sections.

**Tracker integrity — the enforced-tracker gate** *(default + `--deep`)*

The enforced-tracker validator (`_planning/tracker-system-improvements.md` §28.7, epic E-TRACKER-001) runs as a direct script invocation — it is the engine behind the `/trackers:validate` skill (a `/trackers:*` skill, not a `/scan:*` token, so it is referenced by path here like the canon + knowledge enforcers, and is NOT on the `scan-coverage.allowlist.json` skill list):

```bash
node scripts/trackers/validate.js   # E-TRACKER-001/T4: TRACKER.md carries all 34 §5 sections, no blank section, no broken intra-repo links, active epics/sprints link to real /trackers/ files, active items have a next action, completed items have evidence + are 100%, 100% items are marked completed, sprints name a parent epic, no §21 ambiguous-state language, no undefined §8 terms, §33 required paths exist (exit 0/1/2, fail-closed)
```

A non-zero exit is a critical finding (the tracker drifted from reality / lies about state — a missing section, an active item with no next action, a completed item with no evidence, a broken tracker-file link). Fail-closed (exit 2 = could-not-run = NOT green). This is what makes the tracker's truthfulness an automatic gate, not a runnable-on-demand check.

The tracker-fidelity probe (`_planning/tracker-system-improvements.md` / SP-20260718-005 AC-15, ED-056 recurrence class) is the STRUCTURED-YAML sibling of `tracker-reality-drift.js`: it checks the sprint trackers (`progress.yaml` / `current.yaml`) FIELD-BY-FIELD against a ground-truth AUTHORITY MAP at a consistent snapshot — a field that names a nonexistent artifact path, or a `current.id` that disagrees with the active-sprint registry, is drift:

```bash
node scripts/checks/tracker-fidelity.js   # SP-20260718-005 AC-15 / G3.5 (REPORT-ONLY here): field-level ground-truth authority map over the active sprint's progress.yaml + current.yaml (active-sprint id · plan_contract/requirements/active_files disk existence · checks_passing script existence), consistent-snapshot semantics. exit 0 clean / 0 report-only-with-findings / 2 FAIL-CLOSED (unreadable tracker / no active sprint). --enforce ramp = exit 1 on a mismatch (BINDING at a sprint's Phase-3 exit). Test: scripts/checks/tracker-fidelity.test.js 8/8.
```

A non-zero exit under `--enforce` is a critical finding (a structured tracker field contradicts ground truth — the stale "entering build" progress.yaml class this enforcer's own sprint hit on resume). Fail-closed (exit 2 = could-not-run = NOT green). Wired report-only in `/scan:full` (a pre-existing drift cannot break the scan on landing); `--enforce` is the standing binding mode used at a sprint's Phase-3 gauntlet exit.

**Dispatch-shape integrity — the dispatch-contract gate** *(default + `--deep`)*

The dispatch-shape keystone (`.claude/agents/_org/dispatch-contract.json`, PLAN §17.1 — the dispatch analogue of `role-registry.json`) runs as a direct script invocation — it guards the dispatch system's shape policy, not a `/scan:*` skill (referenced by path here like the canon/knowledge/tracker enforcers; NOT on the `scan-coverage.allowlist.json` skill list):

```bash
node scripts/dispatch/dispatch-contract.js validate   # PLAN §17.1: every role-registry role resolves to a dispatch-shape class; classes reference real shapes; the build_chain<->in-process-agent invariant holds; role_overrides target real roles (exit 0/1, fail-closed)
node scripts/checks/duplicate-doc-drift.js --strict    # PLAN §4 S-6 (BLOCKING — flipped 0.15.5 §4-step-8; Wave 2 consolidation removed the only drift, now 0-drifted): two SHIPPED framework docs sharing a basename with DRIFTED content (the gap scan:references can't see — both files exist, so it's not a broken ref). Non-zero = critical. Sanctioned dupes (per-pod builder/fixer/reviewer/protocol) are allowlisted in scripts/checks/duplicate-doc-drift.allowlist.json. Fail-closed on its own errors.
node scripts/checks/provider-api-policy.js --strict    # PLAN §4 N-2 + dispatch-guide §1 (BLOCKING — flipped 0.15.5 §4-step-8; live repo CLEAN at flip): raw provider-API usage (the provider API hosts, the OpenAI/Gemini SDK constructors, or raw fetch to those hosts — see the enforcer for the exact patterns) OUTSIDE the allowlist = an API-when-CLI violation. Non-zero = critical. Allowlist (deep-research + GPT-Pro API-only wrappers) in scripts/checks/provider-api-policy.allowlist.json. Fail-closed on its own errors.
node scripts/checks/doc-ref-integrity.js --enforce     # E-SYSTEM-ORG-001 S-13b (MECHANICAL + BLOCKING; baseline 0-broken; ALSO auto-fires at commit/merge via merge-guard.js so it never depends on a human running /scan:full): a high-read CANON doc (root *.md + .claude/agents|commands + trackers) cites a repo-internal relative path (a [text](path) link or a backtick scripts/foo.js-shaped ref) that resolves to NOTHING — the inverse of duplicate-doc-drift (points-at-nothing, not same-name-diverged). The class the .system/ADR-0007/role-rename waves left behind in prose. Allowlist (runtime-generated / dead-tree / planned / historical) in scripts/checks/doc-ref-integrity.allowlist.json; per-line `<!-- doc-ref-ignore -->` for self-documenting/anti-example lines. Non-zero = critical. Fail-closed on its own errors.
node scripts/checks/repo-role-single-source.js         # ED-009 (REPORT-ONLY — do NOT block this sprint; ramp-to-blocking gated on closing the line-local grep limitation, xprovider review 2026-06-15 BLOCKER-1b): canonical-vs-consumer ROLE derivation in GUARDS must flow through scripts/warpos/repo-role.js (resolveRepoRole / the env-immune isCanonicalDir), not be re-derived inline "from path vibes". Greps scripts/** for inline role-derivation idioms (.warpos-canonical, warpos.source==="self"/?., project.slug==="warpos"/?., _warpos/MANIFEST.json existsSync, version.json#name) OUTSIDE the resolver + the manifest CONTENT-reader allowlist. Live-clean after the admin:* + bootstrap.js adoptions (2026-06-15). LIMITATION (why report-only, not blocking): the grep is line-local — it misses split-var/multi-line + variable-indirection shapes, so a blocking flip would give false assurance; that must be closed (AST-grade scan or accepted-limitation sign-off) first. exit 0/1/2, fail-closed on its own errors.
node scripts/checks/mode-lifecycle-registry.js         # E-LIFECYCLE-001 S-LC-01 (BLOCKING — flipped report-only→blocking 2026-06-16 per operator §22 #4 sign-off; green-under-enforce verified, exit 1 on real registry drift is now a hard finding): the mode/lifecycle keystone analogue of dispatch-contract — verifies the readers (team-guard.js FACE_TYPES, session-start.js TEAM_MODES) resolve required-team-by-mode FROM .claude/agents/_org/mode-lifecycle.json, that lib/mode-lifecycle.js#FALLBACK mirrors the registry (no fail-open drift), and the registry schema is complete (every live mode × roster/requires_team/bindings/provider_tier/dispatch_profile_ref/teardown). exit 0/1/2, fail-closed on its own errors. Ramp-to-blocking FLIPPED 2026-06-16 (operator §22 #4 sign-off; the watch-period was clean — registry green-under-enforce).
node scripts/checks/mode-lifecycle-hooks-coverage.js --enforce   # E-LIFECYCLE-001 S-LC-02 (BLOCKING — flipped report-only→blocking 2026-06-16 per operator §22 #4 sign-off; --enforce now passed, green-under-enforce verified; gap→exit 1 is a hard finding): the SIBLING coverage enforcer for the VIRTUAL mode-lifecycle EVENT registry (.claude/agents/_org/mode-lifecycle-hooks.json). REVERSE (registry structurally coherent — every row event/when/mode/payload_fields, mode ∈ {block,advisory}, harness_fires the literal false, no dup event) + FORWARD (every declared harness_fires:false event has an emitter — a lifecycle-events.emit("<event>") reference and/or a real lifecycle-event record in paths.eventsFile; an un-wired event listed in mode-lifecycle-hooks-coverage.allowlist.json is wiring-pending INFO, not a gap). Exit contract (P-053 loud-fail): clean→0, gap-only→0 (report-only), parse/unreadable/structurally-broken registry→2 (fail loud — a broken registry must never report "0 gaps"). The --enforce ramp tail was FLIPPED 2026-06-16 (operator §22 #4 sign-off; watch-period clean); the 20 wiring-pending events stay allowlisted-as-info (not gaps), so the gate is green-under-enforce.
node scripts/checks/coverage-gate-scan.js              # E-LIFECYCLE-001 S-LC-06 (REPORT-ONLY + FAIL-OPEN — do NOT pass --enforce / do NOT block this sprint): the LIVE CALLER for coverage-gate.js evaluate() (which was built+P5-tested but had NO live caller — PLAN §2.6 low-hanging wiring). Reads the dispatch-completions ledger (paths.dispatchCompletionsFile), groups records by run_id, derives external expected roles from sprint_id + phase_id/step through the sprint hook-point registry and ticket composition (with claimed ok:true roles unioned as a fallback), and runs evaluate() to surface the sprint-theater class: an omitted hook-point role with no record, an ok:true claim that is unbacked / blind (no artifact proof) / stale-schema, a cross-provider role satisfied by provider=claude, or a hand-authored phantom row. This is the STATIC-scan complement to the per-PHASE runtime gate (coverage-gate.js --run <id> --expect <roles>, BLOCKING). Exit contract: ALWAYS exit 0 in report-only (gaps are printed, not blocked) and FAIL-OPEN (a malformed/unreadable ledger or any internal error → a note + exit 0, never breaks /scan:full). The --expected-source flag can still supply an explicit source; the no-flag /scan:full path is no longer self-derived only. The --enforce ramp tail (gap→exit 1) is a later flip behind operator sign-off.
node scripts/checks/planning-principles.js --enforce   # /scan:planning-principles — E-LIFECYCLE-001 S-LC-08 (BLOCKING — flipped report-only→blocking 2026-06-16 per operator §22 #4 sign-off; --enforce passed, green-under-enforce verified after both plan docs got their labeled ## Enforcer section; gap→exit 1 is a hard finding; still FAIL-OPEN on infra errors): the named enforcer for the planning principles (_planning/principle.md §8.11). Walks the lifecycle-store epic plan artifacts (_planning/epics/**) and flags any plan .md (README.md excluded) that OMITS a principle-required section — a named ENFORCER per policy (#7), PROOF/acceptance (#6/#15), or a BLAST-RADIUS assessment (#5). Makes the "principles live only in a prompt, nothing checks them" gap self-detecting. Exit contract: ALWAYS exit 0 (report-only — gaps printed, not blocked) and FAIL-OPEN (a missing planning dir / unreadable file / any internal error → a note + exit 0, never breaks /scan:full). The --enforce ramp tail was FLIPPED 2026-06-16 (operator §22 #4 sign-off; the only findings — E-DISPATCH-SHAPE-001 + E-PRODUCT-FOUNDATION-001 plan docs missing the named-enforcer section — were cleared first).
node scripts/checks/tracker-reality-drift.js          # ED-056 tracker-reality-drift (REPORT-ONLY, NEW 2026-06-16): catches the "stale-claimed-done" tracker-drift class that recurred 5x on 2026-06-16 (work CLAIMED "Missing But Required" while actually built+working — nearly re-built a certified keystone; the verify-don't-inherit memory). MVP scope (precise > noisy) = verification-log TABLE ROWS whose State cell is exactly "Missing But Required" while a sibling cell names a `scripts/…*.js` (or backtick'd path) that EXISTS on disk. Table-row only — line-level prose matching was tried + REMOVED (false-positived on a multi-claim line: "X SHIPPED … Y not yet built"). SKIPS the §10 legend row + the Session/Change-log history sections. exit 0 clean / 0 report-only-with-findings / 2 FAIL-CLOSED (no epics dir / unreadable — a broken scan never reports "0 drift"). --enforce ramp = exit 1 on findings (later flip). Test: `scripts/checks/tracker-reality-drift.test.js` 7/7. Does NOT cover the fuzzy PROSE class (a later/harder ramp; the "claimed-green-but-RED" inverse needs execution).
node scripts/checks/ed-register-reality-drift.js       # SP-20260724-001 / ED-056 residual (REPORT-ONLY): the ED-REGISTER sibling of tracker-reality-drift — catches the stale-open register row that nearly caused a duplicate keystone build (task #4, 2026-07-24: ED-256/257/258 marked open while built+landed). Flags an OPEN ED (no closure/resolution row) whose row TEXT names a concrete NEW enforcer `scripts/(checks|enforcement)/<name>.js` that EXISTS on disk WITH a sibling test (the "shipped-with-teeth" discriminator — the modify-existing case has no NEW matching test, so it does not false-RED). EXCLUDES intentionally-open partials (open_adr/partial_enforced fields or REMAINING OPEN/residual/deferred/sub-item markers) — a managed partial is not stale. CANDIDATE surfacer: a finding means "verify + close-or-annotate", never auto-close. Register is GITIGNORED — absent (fresh clone/CI) => SKIP exit 0; present-unreadable => fail-closed exit 2. Report-only default; --enforce => exit 1. Test: scripts/checks/ed-register-reality-drift.test.js 9/9 (shipped-with-teeth→RED, modify-existing/no-test→GREEN, closed→GREEN, partial-marker→excluded, append-safe live CONTROL invariant).
node scripts/checks/security-pass-count.js              # E-DISPATCH-PERFECT-001 W1 (CONFIG-coherence HARD + runtime-stamp REPORT-ONLY ramp): the NAMED pass-count enforcer for the 3-provider security review (β DECIDE 0.88 cond d). HARD (exit 1): the security-reviewer registry row declares a full pass chain (primary + second_pass + third_pass) with DISTINCT providers (claude LAST), scripts/dispatch-review.js (the firing consumer of second_pass/third_pass) exists, and the sprint-gauntlet path (epsilon-runtime.js) routes multi-pass roles through it — a break means the firing wiring regressed (the keys became a declarative lie again). REPORT-ONLY ramp: post-cutoff security reviews on the dispatch-completions ledger (grouped by run/sprint) must carry one ok:true record per declared pass with DISTINCT providers — fewer = the N-pass review did not fully run (flip to blocking via --strict once the gauntlet path is proven across a watch window). exit 0/1/2, fail-closed on an unreadable registry. Test: scripts/checks/security-pass-count.test.js (8 planted assertions).
node scripts/checks/ed060-sunset.js                    # SP-20260718-003 D9 / AC-17 (BLOCKING once due): the executable ED-060 sunset enforcer for the agy (Antigravity) security lab. Reads panel-lane-manifest.json sunset.date (2026-10-16) + the agy resolved status from support-matrix.json; exits NON-ZERO (1) once the date has PASSED while agy is still down (unresolved) — the dated operator deadline the doc-only ED-060 note could not enforce. exit 0 not-yet-due OR resolved (agy live) · 1 sunset-passed-unresolved · 2 fail-closed (no dated sunset / unreadable). Two-sided test scripts/checks/ed060-sunset.test.js (past→finding, future→clean, resolved→moot). Not-yet-due today (2026-07-18), so exit 0.
node scripts/enforcement/ed-dup-id-lint.js             # SP-20260723-003 / ED-258a (BLOCKING): the GENESIS-KEYED duplicate-ED-id lint — the backstop for the ED-267b allocator (`scripts/enforcement/next-ed-id.js`, which replaced log.md's line-count minting). Flags an id with >1 GENESIS row (two distinct debt loggings colliding). GENESIS-KEYED per β 0.90 DIRECTIVE: a genesis row carries a substantive description (policy/origin/gap) and is NOT an amendment (`amendment:true`/`record_kind`/`amends`) or a thin closure row (status-change + closure_receipt/enforcer, no description) — so an append-only closure re-using an id does NOT false-RED (the ED-244 pattern). Shared scan with ED-267a (P-034 one-implementer, `scripts/enforcement/ed-registry.js` + `dedup-util.js`). exit 0 clean · 1 genesis-dup · 2 fail-closed (register unreadable). Test: scripts/enforcement/ed-registry.test.js 11/11 (real-dup→RED + append-only closure→GREEN teeth).
node scripts/enforcement/pipe-masks-gate-lint.js       # SP-20260723-003 / ED-258b (BLOCKING): the CLAUDE.md Tool-Use "pipe masks a gate's exit" enforcer. Flags `<gate> | <passthrough:tail/head/tee/cat/less/more> [args] (&&|;) <next>` inside FENCED bash/sh blocks of dev-tooling `.md` docs (.claude/commands, .claude/agents, root docs) — a passthrough filter exits 0 regardless, so the pipeline status masks the gate and the chain proceeds past a RED gate (α committed this 3× on 2026-07-22). FENCED-ONLY so the rule's own inline-prose example does not self-trip; a `# pipe-masks-gate-lint:allow` pragma exempts a sanctioned illustrative line. exit 0 clean · 1 finding · 2 fail-closed. Live-clean at land (337 docs). Test: scripts/enforcement/pipe-masks-gate-lint.test.js 10/10 (|tail AND |head→RED, bare-gate/grep-gate/prose/pragma→GREEN).
node scripts/enforcement/betaevents-dedup-lint.js      # SP-20260723-003 / ED-267a (REPORT-ONLY; --enforce exits 1 on a DEDUP finding or an unresolved row when the log is trusted): the betaEvents verdict-row dedup + msg_id-resolution HYGIENE lint (NOT a verdict authenticator — persistent-beta delivery + recipient msg_id verification is), scoped to scan:full ONLY (beta: never CI/fresh-clone — betaEvents is a GITIGNORED advisory ledger, absent on a clean checkout, then SKIP). Supports the beta-writes-at-delivery pattern (post-SP-002 recipient-drop). (1) DEDUP no msg_id on >1 verdict row (decision in DECIDE|DIRECTIVE|ESCALATE) — keyed on MSG_ID so reconfirms + the plan-design vs plan-design-correction pair (beta rider 1) are NOT false-RED'd, unlike a naive sprint+boundary count. (2) msg_id-RESOLUTION (advisory, beta rider 2 fail-open): each msg_id should resolve in the message log (paths.eventsFile) by EXACT set-membership (not substring); if the log resolves a LOW fraction (under 80% — e.g. a truncated-preview log that isn't the real SendMessage log) it SKIPS-with-note, never a wall of false unresolved. Shares dedup-util.js (P-034). Test: scripts/enforcement/betaevents-dedup-lint.test.js 13/13 (real dup->RED + boundary-distinct/reconfirm->GREEN + low-rate->SKIP + exact-match prefix-collision).
node scripts/checks/reasoned-consult-honesty.js        # SP-20260723-004 / ED-234 (REPORT-ONLY; --enforce exits 1 on any STRUCTURAL finding): the reasoned-consult-lane STRUCTURAL well-formedness lint over the betaEvents ledger — the sibling of ED-267a's dedup HYGIENE on the same lane. Checks that each consult row is well-formed FOR ITS TYPE: universal parseable `ts`; conditional value-domains (decision in {DECIDE,DIRECTIVE,ESCALATE,REQUESTED}, class in {A,B,C}, confidence a number OR per-dimension object in [0,1], id-shaped msg_id) that fire only when the field is provided (null = not-applicable, GREEN); per-family requirement (verdict types must carry a decision OR a non-empty verdict; beta-ledger-reconcile must carry a non-empty reconciles[] of non-null entries; FLEX consult/request rows must carry >=1 CONTENT field — not an empty {type,ts} envelope). Bypass-hardened (backend r1): the generic-logger classifier requires the FULL {id,cat,actor,session,data} schema (a partial row can't masquerade as generic to skip checks), and a verdict-SHAPED row (decision/verdict/class/confidence) with an unknown or DELETED type is a STRUCTURAL finding (a settable-type mutation can't silently evade the verdict-family gate) while a benign unknown type stays a graceful advisory. STRUCTURAL, NOT SEMANTIC (beta rider 2): a GREEN means "rows well-formed", NOT "consults happened / msg_ids resolve" — that semantic check needs the msg-log authenticator and is DEFERRED as ED-275; the output prints that boundary so GREEN is never mis-read. The ledger is MIXED — 105 generic logger rows ({id,cat,actor,data}, no type) are classified out-of-scope + SKIPPED; an unrecognized type is an ADVISORY, never a hard RED (graceful, so a future shape does not false-RED). /scan:full-ONLY, never CI/fresh-clone (betaEvents is a GITIGNORED advisory ledger — absent => SKIP-with-note exit 0). exit 0 clean/report-only · 1 with --enforce on a structural finding · SKIP when unreadable. Test: scripts/checks/reasoned-consult-honesty.test.js 29/29 (real-corpus 0-false-reject + append-safe classification invariants + synthetic-fixture exact counts + planted REDs per code incl. empty_consult_row/reconcile_entry_malformed/verdict_shaped_unknown_type/verdict_shaped_untyped_row + null/object-confidence/optional-field/benign-unknown GREENs + CLI SKIP/enforce/disclaimer).
node scripts/checks/beta-verdict-citation-receipt.js   # SP-20260724-001 / ED-239 CRITICAL (REPORT-ONLY; --enforce exits 1 on a HARD finding): scans downstream artifacts (ADRs, epic trackers, ROADMAP) for β-verdict CITATIONS (β/beta DECIDE|DIRECTIVE|ESCALATE|ruled|verdict) and requires each to be RECEIPT-BACKED against paths.betaEvents. HARD (gate-able, near-zero false-positive): a citation carrying a `msg_id <token>` that does NOT resolve to a betaEvents verdict row — a forged/typo/stale receipt. SOFT (report-only advisory): a load-bearing citation with NO msg_id — the conductor-side contract nudge (never blocks; the historical corpus predates the convention). STRUCTURAL receipt-presence only; the deeper msg-log semantic authentication is ED-275. betaEvents GITIGNORED — absent => SKIP; present-unreadable => fail-closed exit 2. Test: scripts/checks/beta-verdict-citation-receipt.test.js 10/10 (resolving→clean, unresolved-msg_id→HARD, no-msg_id→SOFT, history-section→skipped, absent→skip, malformed-row→resilient, non-citation→ignored, append-safe live CONTROL).
node scripts/enforcement/enforcer-selftest-coverage.js # SP-20260724-001 / ED-033 meta-gate (REPORT-ONLY; --enforce exits 1 on a HARD finding): enumerates the CLI enforcers under scripts/checks + scripts/enforcement (a *.js with `require.main === module`, excluding test files) and requires each to ship a self-test. HARD (gate-able): an enforcer with NEITHER sibling convention (`<name>.test.js` NOR `test-<name>.js`). SOFT (advisory): a test with no detectable PLANTED-VIOLATION (failing-case) assertion. Surfaces the real coverage debt (currently 26 enforcers lack a self-test). exit 0 clean/report-only · 1 HARD under --enforce · 2 fail-closed (no dirs). Test: scripts/enforcement/enforcer-selftest-coverage.test.js 7/7 (no-test→HARD, weak-test→SOFT, non-enforcer→ignored, both naming conventions, append-safe live CONTROL).
node scripts/checks/provider-invocation-parity.js     # SP-20260723-005 (REPORT-ONLY; --enforce exits 1 on any parity finding): asserts each DOC's per-provider CLI invocation string matches the SHAPE the CODE builds (buildProviderArgv in scripts/hooks/lib/providers.js — the single source of truth, DERIVED not hardcoded per β rider; hardcoding just moves the drift). Catches the doc↔code drift the per-provider language audit found: F1 a doc claiming the WRONG prompt-delivery (stdin vs `-p` argv — the agy case, an entering agent reads the wrong shape), F2 a doc carrying a MANDATORY flag the real argv omits (`--ask-for-approval` on non-interactive `codex exec`). FENCED-code + TABLE-cell invocations ONLY, command must START with the cli — so prose that merely mentions a cli/flag (e.g. "agy has no `--allowedTools`") does NOT self-trip; bracketed-optional `[ … ]` flags are excluded. Closes the gap the SP-001 entry-preamble parity enforcer leaves (it checks only the SHARED preamble block, not per-file router/invocation content). exit 0 clean/report-only · 1 with --enforce. Test: scripts/checks/provider-invocation-parity.test.js 16/16 (real-docs 0-false-reject + planted F1 drift both directions + F2 stale-flag + prose-not-self-tripped + bracketed-optional/table-cell GREEN).
node scripts/checks/liveness-read-choke-point.js       # SP-20260718-004 gauntlet R4 (BLOCKING — the kill-the-seam guard; β DIRECTIVE): any SAME-SESSION file that reads the dispatch-completions ledger AND gates on an ok:true record MUST verify a valid origin-proof signature (via scripts/dispatch/verified-liveness-read.js#isVerifiedLivenessRecord or attest-signing.verifyRecord) — a new reader that trusts field-only ok:true records is a re-opened forged-liveness false-green and FAILS this guard (the recurrence-stopper). CROSS-SESSION-by-construction readers (a foreign-session ledger, unverifiable under the per-session HMAC — ADR-0025) are STRUCTURALLY exempted with a named reason + tracked (ED-232 key-distribution). exit 0 clean · 1 an unverified same-session reader / stale exemption · 2 fail-closed. Test: scripts/checks/liveness-read-choke-point.test.js.
node scripts/checks/transport-record-trust-guard.js    # SP-20260721-001 D-4 INC-1 / SEC-1 (BLOCKING — the record-trust structural guard over the brokered transport): three invariants on scripts/dispatch/trusted-controller.js. G1 the fence token is NEVER caller-asserted (resolved fresh via defaultLeaseTokenResolver from the conductor-lease store; leaseToken/base_commit/expectedHead/anchor/candidateRoot are absent from the FROZEN TRANSPORT_OPT_KEYS, so a caller anchor/token is UNPASSABLE, not merely unread — and each public entrypoint routes opts through sanitizeTransportOpts). G2 EXACTLY 2 sanctioned withControllerFence call sites — integrateInternal (the UNIT/acceptance path) + fencedRefUpdateInternal (the TRANSPORT/merge-release path) — with withControllerFence the SOLE fence-env-setting site and a finally-restore (a THIRD site would raise the fence around an unreviewed write; a leaked fence would authorize every later write ambiently). G3 the FROZEN TRANSPORT_SKIP_ALLOWED pin is un-widened: exactly `false-green-envelope` → `no-envelope-in-context` (honest — a transport write has no ResultEnvelope, and fabricating one is the false-green genesis the design refuses), gated by EXACT name+reason so a skip tolerated by name alone (a dead gate) fails. exit 0 clean · 1 violation · 2 fail-closed (unreadable subject never reads green). Test: scripts/checks/transport-record-trust-guard.test.js 14/14 (11 planted regressions + a live control).
node scripts/checks/main-write-broker-completeness.js  # SP-20260721-001 D-4 INC-1 / SEC-1 (REPORT-ONLY until the release ceremony — EXPECTED RED today, see below): the MECHANIZED FLIP-TRIGGER for arming the Seam E fence. A static scan over scripts/** + .claude/commands/** enumerating LOCAL main-write call-sites, asserting ZERO un-brokered — each must be a broker, a caller migrated to integrateBranchMerge/integrateReleaseCommit, or an in-code ALLOWLIST entry with a reason. RECOGNIZER (the subtle part): MARKDOWN-aware (inline-code spans + numbered-list steps, not just fenced blocks/JS), VARIABLE-ref-aware ($DEFAULT/$DEFAULT_BRANCH/origin/main/HEAD:main, not just a literal refs/heads/main), and CONSERVATIVE (flags any file that SELECTS main and then merges/commits/update-refs, with no literal-main-token-on-the-write-line requirement) — a naive recognizer reads commit/land.md:33 and warp/release.md as GREEN, the exact false-green on the two flagship deferred writers. Prefers a false-POSITIVE (flag→allowlist) over a false-NEGATIVE. CEILING, NAMED: a static scan cannot enumerate variable-ref/prose/dynamically-constructed writes, so green = "no KNOWN un-brokered writer remains" (pre-flip BREAKAGE-PREVENTION), NOT "provably every writer migrated"; the LIVE reference-transaction hook is the runtime security BOUNDARY and a scan miss breaks fail-closed at first post-flip use, never a silent land. DISTINCT from write-surface-delegation-completeness.falsifier (mechanism vs caller). Currently RED on 5 files / 4 logical writers: #2 release-canonical.js + warp/release.md and #4 commit/land.md (both DEFERRED to the release ceremony by design), plus census-discovered session/end.md + session/turbo.md. FLIP-TRIGGER = this enforcer's FIRST green (dogfood mileage is corroborating, never the gate). exit 0 zero-unbrokered · 1 findings · 2 fail-closed. Test: scripts/checks/main-write-broker-completeness.test.js 13/13 (incl. the planted $DEFAULT-variable markdown-inline-code merge + a planted raw main-commit).
node scripts/checks/authority-pollution-scan.js        # SP-20260718-004 Phase 2 G2.3 (BLOCKING — the STANDING authority-pollution enforcer; CORE-3): fails (exit 1) if any NEUTRAL/ambient instruction surface (AGENTS.md / GEMINI.md / a non-root CLAUDE.md — the canonical ROOT CLAUDE.md helm projection is EXEMPT) asserts a top-level IDENTITY ("you are Alex/Alpha/President"), a DEFAULT top-level role binding (the rule-#5 "default top-level human-facing role = alpha" class β flagged), or unconditional operator MERGE/DEPLOY/APPROVAL authority. Self-detecting on RE-INTRODUCTION (a new worktree CLAUDE.md / neutral shim / stale handoff). HONEST SCOPE: a detector at the R6 completeness ceiling (word/pattern match = LOWER BOUND, paraphrase can slip) — defense-in-depth ON TOP of the STRUCTURAL guarantee (scripts/dispatch/role-resolver.js derived-not-settable, ambient text inert-by-construction). exit 0 clean · 1 violation · 2 fail-closed. Test: scripts/checks/authority-pollution-scan.test.js (BLOCKING FIXTURE ii — the default-binding plant proven caught + a clean control that descriptive President mentions do NOT trip).
```

A non-zero exit (when blocking) is a critical finding (the dispatch contract drifted from the role registry — a role with no class, a class allowing a ghost shape, a build-chain role that could be dispatched in-process). The N-1 coverage gate (`node scripts/dispatch/coverage-gate.js --run <id> --expect <roles>`) is the companion runtime check that makes a backing `ok:true` completion record the precondition for "covered" (kills sprint theater) — now **BLOCKING by default** (PLAN §4 ramp FLIPPED): the §17.4 strengthening makes a record's mere existence insufficient (it must be stamped at the current `argv_schema_version` AND carry artifact proof — `output_digest` or an `artifacts[]` digest — so a stale/backfilled/blind record is rejected), with an auditable `waiver{reason}` escape; `--report-only` opts out. It is a RUNTIME gate (needs a `--run <id>` + `--expect`), so it is invoked per sprint phase. Its STATIC-scan complement is `coverage-gate-scan.js` (S-LC-06, in the block above) — the LIVE CALLER that audits the dispatch-completions ledger run-by-run with no per-run `--expect`, deriving expected roles from sprint registry/ticket composition when run records carry sprint_id + phase_id/step and unioning claimed roles as a fallback. The **duplicate-doc-drift** enforcer (PLAN §4 S-6) is the self-detecting backstop for E-SYSTEM-ORG-001 — it makes the "same-basename shipped doc drifted" class loud. The Wave-2 consolidation removed the `agent-dispatch-guide.md` duplicate (0-drifted), so per §4-step-8 it is now **BLOCKING** (`--strict`). The **provider-api-policy** enforcer (N-2) is likewise **BLOCKING** (live repo clean at the flip). Both keep allowlists for sanctioned cases; both fail-closed on their own errors. The safety kernel (`scripts/dispatch/safe-spawn.js` — now WIRED into the live cross-provider spawn path via `scripts/hooks/lib/providers.js`) + auth-resolver (N-3, `scripts/dispatch/auth-resolver.js`) + each module's `*.test.js` carry the P5 planted-violation tests. The **doc-ref-integrity** enforcer (E-SYSTEM-ORG-001 S-13b) is the navigational-link complement to duplicate-doc-drift: a broken repo-relative ref in high-read canon (the stale-link class the operator hit after the `.system`/ADR-0007/role-rename waves). It ships **REPORT-ONLY** at a 0-broken baseline (168 surfaced refs → fixed-or-categorized); `--enforce` is the ramp tail. `scripts/checks/doc-ref-integrity.test.js` carries the P5 cases. The **repo-role-single-source** enforcer (ED-009) is the role-derivation analogue of these single-source/no-drift gates: it keeps the canonical-vs-consumer verdict flowing through the ONE resolver (`scripts/warpos/repo-role.js`) so no guard re-derives role "from path vibes" (the false-green class that re-appeared when the admin:* suite hand-rolled its own detection, and that `bootstrap.js#detectMode` was also refactored off). **REPORT-ONLY** (live-clean after the admin:* + bootstrap adoptions 2026-06-15); the ramp-to-blocking is gated on closing the enforcer's line-local grep limitation (it misses split-var / variable-indirection shapes) — via an AST-grade scan or an accepted-limitation sign-off — so it never ships as a false-green BLOCKING gate (xprovider review 2026-06-15 BLOCKER-1b). Allowlist = the resolver + its test + the manifest-tool CONTENT readers; fail-closed on its own errors.

**Sprint conductor liveness** *(default + `--deep`)*

The epsilon-liveness enforcer detects a stalled sprint conductor (WG-6 ×3 — observed 25-minute
stalls): when in-process evidence files older than 10 minutes have no matching completion record
in the dispatch ledger, the conductor is likely stuck (a teammate-ε went idle waiting for a
subprocess return that will never re-wake it). REPORT-ONLY — never blocks `/scan:full`:

```bash
node scripts/checks/epsilon-liveness.js   # T-291 / doogle WG-6 (REPORT-ONLY): scans .claude/runtime/epsilon-prompts/*.return.txt older than 10m; each with no sha256 or sprint+step+role match in dispatch-completions.jsonl → epsilon-stalled finding. exit 0/1/2, fail-closed (unreadable ledger + evidence = exit 1). Run directly with --stale-minutes / --evidence-dir for a real-time gate.
```

A non-zero exit (when run directly) names orphaned evidence files and their age. Fail-closed on
runner errors (exit 2). Linked: `T-291` · `doogle WG-6` · `ED-041` · `epsilon.md` TEAMMATE STALL RULES · `scripts/checks/epsilon-liveness.test.js`.

**Source hygiene — the NUL-byte gate** *(default + `--deep`)*

A literal NUL byte (0x00) never legitimately appears in our `.js/.json/.md/.ts` sources — it sneaks in via tooling artifacts (a literal space before `]` in a regex char class serialized to 0x00 via the Write tool) and silently corrupts a file (ripgrep treats it as binary + skips it; Edit can't match across it). Runs as a direct script invocation (a source-hygiene script, not a `/scan:*` skill):

```bash
node scripts/checks/no-nul-bytes.js   # scans scripts/** + .claude/** text sources for a NUL byte; exit 0/1/2, fail-closed
```

A non-zero exit names the corrupted file + byte offset. The fix is `\u0000` (the escape) not a literal NUL. This is the enforcer pairing for the regex-charclass-space-becomes-NUL learning; it caught a real latent NUL in `scripts/trackers/validate.js` on first run.

**Helm entry-file parity — the single-source preamble gate** *(default + `--deep`)*

SP-20260723-001 / ADR-0036: the entering-agent preamble is single-sourced at `.claude/project/reference/entry-preamble.md` and embedded verbatim in every executor entry doc (`CODEX.md`, `ANTIGRAVITY.md`, `GEMINI.md`, and an `AGENTS.md` section). This enforcer keys on REAL FILE BYTES: every required entry file exists, each embedder's marked region hash-matches the canonical oracle (canonical = the sole hash source; a shim can never grade itself), and each thin shim's provider-delta stays within its size tier. Runs as a direct script invocation (a source-integrity script, not a `/scan:*` skill):

```bash
node scripts/checks/entry-preamble-parity.js   # exists + region-present + canonical hash-parity + tier-thinness; exit 0 clean / 1 finding / 2 could-not-run (fail-closed)
```

A non-zero exit names the drifted/dropped/oversized/missing entry file; exit 2 (canonical unreadable) is fail-closed, never a silent green. Also a hard-blocking release gate (`scripts/warpos/release-gates.js` -> `entry_preamble_parity`, 0->green / 1|2->RED). Test: `scripts/checks/entry-preamble-parity.test.js` (9 planted cases incl. the one-char-semantic-edit->RED / CRLF-reformat->GREEN boundary + fail-closed exit 2).

**agy auth-fallback record honesty — the sequence-aware tell detector + (c)-close gate** *(default + `--deep`)*

SP-20260723-002 / ADR-0037: an UNauthenticated agy serve exits 0 with output but writes its tells to the cli.log NOT stdout, so a naive record false-greened `fallback:false`. The detector (`scripts/dispatch/agy-auth-tells.js`) is POSITIVE-PROOF-ONLY + PID-SCOPED (a code-site auth-success in this serve's pid-scoped cli.log DELTA, `expired=true` demoted to soft, stdout NOT scanned); the ED-060(c) LIVENESS close has a NAMED consumer gate requiring `auth_fallback === false` (`true`/`"indeterminate"`/absent all FAIL — the fail-open trap). Both teeth run here (deterministic, no external deps):

```bash
node scripts/dispatch/agy-auth-tells.test.js    # 21 cases incl. the byte-real genuine-serve regression (auth->false) + the concurrency false-green (interleaved-pid->true) + clean-no-signal->indeterminate
node scripts/checks/ed060c-close-gate.test.js   # 8 cases incl. the DoE fail-open trap: auth_fallback:"indeterminate"/absent must NOT close
```

A non-zero exit means the auth-honesty contract regressed (a genuine serve false-RED'd, an unauth serve false-greened, or the close gate went fail-open). The keyring-expired residual (confirm child.pid === agy's logged pid on a live serve) is login-gated ED-268. Detector single-sources `NON_AUTH_SIGNAL`/`filterAgyLogToRunWindow`/`norm` into `cert-attest.js` (the pure-move — a byte-identity test freezes `NON_AUTH_SIGNAL`).

**Log-sink caps gate — rotation is firing on every known sink** *(default + `--deep`)*

SP-20260717-001 AC6 (F-ENF-1): the retention/rotation gate. `log-sink-caps.js` imports the SAME `SINK_CAPS` map the write-time rotation trigger uses (single source of truth) and flags any known sink grown past **2× its cap** — a breach means rotation is not firing on that sink — AND validates the SINK_CAPS INVENTORY itself (every declared descriptor well-formed) whether or not the sink exists yet. Fail-closed: an unrecognized `kind`, an `existsSync` fault, a non-finite `actual`, or a stat/read error is an offender, never a silent pass. This invocation was the AC6 wiring the original build skipped (builder hit the 540s clamp) — it is now delegated here:

```bash
node scripts/checks/log-sink-caps.js   # SP-20260717-001 AC6 (REPORT-ONLY): flags any SINK_CAPS sink over 2x cap + validates the inventory descriptors; fail-closed on unreadable/malformed/non-finite (exit 0 report-only; --enforce -> exit 1 on a breach; exit 2 = runner error)
```

Wired **REPORT-ONLY** (default invocation exits 0 even on a breach) so a pre-existing oversized sink cannot break `/scan:full` on landing; `--enforce` (exit 1 on a breach) is the ramp tail once the archive-move rotation has kept the hot sinks under cap across a watch window. Test: `scripts/checks/log-sink-caps.test.js`.

**Dead team-tools gate — TeamCreate/TeamDelete regression** *(default + `--deep`)*

Claude Code v2.1.178 (2026-06-15) REMOVED the `TeamCreate`/`TeamDelete` tools (teams are now implicit + session-scoped; teammates spawn via `Agent(run_in_background:true)`). This gate (E-TEAMS-MIGRATION-001) prevents a new LIVE directive instructing the removed tools from creeping back into the active skill/hook/script layer, and ALSO asserts the POSITIVE — that the NEW remediation (`Agent` background-subagent spawn) is actually present, so a future edit can't trade one dead tool-name for another:

```bash
node scripts/checks/no-dead-team-tools.js   # scans scripts/** + .claude/commands|agents|project for a live TeamCreate / TeamDelete call form; exit 0/1/2, fail-closed
```

A non-zero exit names the file + line of the offending directive. The enforcer flags only the executable CALL FORM (the `TeamCreate` / `TeamDelete` token immediately followed by an open paren) in the active skill/hook/script/agent layer; prose that names the tools without the call form (e.g. "TeamCreate was removed in v2.1.178", "the Node-side surrogate for TeamDelete") is fine. The history/decision layer that legitimately quotes the call form — `adr/`, `_docs`, `_planning`, `_reports`, the shipped baseline (`_warpos`/`BASELINE`/`EXAMPLES`), per-run telemetry (`events/`), and `tests/regression` fixtures — is path-skipped.

**Consult-roster no-dispatch gate — ε is the sole builder-dispatcher** *(default + `--deep`)*

ADR-0014 lets the ε conductor summon the in-process roster in any spawn context. The SCOPED guarantee (E-DISPATCH-PERFECT-001 W5): **a role summoned at a CONSULT/author hook-point cannot dispatch the build chain BY CONSTRUCTION** — its spec carries no `Bash`/`Agent`. The dispatch-route-guard hook can't enforce a deeper no-cascade (it has no spawn-lineage signal), so this is a STRUCTURAL tool-set check on roles summoned at a CONSULT hook-point (sprint step ∈ {plan, design}). NOTE the bounded residual (tracked as ED-065, NOT a blanket "no-cascade"): the one documented exemption `quality-lead` retains `Agent` for its sanctioned one-hop fan-out to leaf reviewers — and a reviewer it summons carries `Bash` by design (reviewers run checks), so a deeper `lead→reviewer→Bash→dispatch-claude.js builder` cascade is a PRE-EXISTING reviewer-tool-set property this structural check does not close (it needs the lineage-aware one-hop-reviewer-only assertion, ED-065). The check enforces exactly its scoped claim:

```bash
node scripts/checks/consult-roster-no-dispatch.js   # E-DISPATCH-PERFECT-001 W5 (ADR-0014 spawn-hand-stays-with-conductor): asserts no consult-summonable role's SPEC lists Bash/Agent (reads real frontmatter × the hook-point join) — the DIRECT consult→dispatch route closed BY CONSTRUCTION. HONEST-RED (lead 2026-06-20): the ONE documented exemption (quality-lead, retains Agent for its reviewer fan-out) is reported as a KNOWN OPEN HOLE — "the guarantee is INCOMPLETE" — NOT a green-with-exemption pass; REPORT-ONLY exit 0 (does not break the scan, like tracker-reality-drift), `--enforce` flips the known hole to exit 1 once the ED-065 one-hop-reviewer assertion lands. A NEW untracked consult role gaining a dispatch tool ALWAYS hard-fails (exit 1); runner error → exit 2 (fail-closed). Test: consult-roster-no-dispatch.test.js 16/16 (6 planted-violation/fail-closed).
```

It reads each consult role's ACTUAL spec `tools:` (the `.md` the role-registry `spec` points at — rename-proof, fires on real frontmatter), joined with the consult hook-points. A consult role whose spec gains a dispatch tool FAILS the gate (and an unconfirmable/missing/unfenced spec fails CLOSED). The one documented dual-role exemption (`quality-lead` — its design-consult is trusted-read-only; it retains `Agent` (NOT Bash — Bash was removed) for its sanctioned one-hop fan-out to leaf reviewers) is REPORTED, not silently passed. ED-065 tracks the bounded residual: a reviewer it Agent-summons carries `Bash` by design (reviewers run checks), so a deeper `lead→reviewer→Bash→dispatch-claude.js builder` cascade is a PRE-EXISTING reviewer-tool-set property this structural check does not close (the lineage-aware one-hop-reviewer-only assertion is the follow-up). Report-only in `/scan:full` until ED-065 lands (then blocking).

**Regression seed — the bug-class lens** *(default + `--deep`)*

`/scan:regressions` — runs the **26 recurring bug classes** (`_requirements/07-testing/recurring-bug-classes.json`) as detectors and reports a catch-rate. Several detectors overlap the tiers above; this is the roll-up view + the 0.17.0 test-suite core. Surfaces `gap`/`partial`/`n/a` classes as the system's backlog.

Each scan returns `{ findings: [{severity, check, message, file?, suggestedFix?}], summary }`. **Don't run sequentially** — parallel dispatch cuts wall time dramatically. A scan that's N/A in the current repo role (e.g. some `warpos-*` checks in canonical) reports `skipped` with a reason rather than failing.

---

## Aggregation

After all six return, merge into one rollup:

### Summary table

```
┌──────────────────────────────────────────────────────────────────────┐
│ /scan:full — 2026-04-17T03:45Z — mode: default                       │
├──────────────────────────────────────────────────────────────────────┤
│  Specialist          Critical  High  Medium  Low   Status            │
│  ────────────        ────────  ────  ──────  ───   ──────            │
│  architecture        0         2     5       3     ⚠ 2 high          │
│  environment         0         0     1       0     ✓ ready           │
│  references          1         0     4       12    ✗ 1 broken link   │
│  requirements        0         3     7       2     ⚠ spec drift      │
│  patterns            —         —     —       —     ✓ 0 new clusters  │
│  system              0         0     2       0     ⚠ 2 stale entries │
│  ────────────        ────────  ────  ──────  ───   ──────            │
│  TOTAL               1         5     19      17                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Critical section

Anything severity=critical across all specialists. List each with: which specialist, file, one-line fix. This is the go/no-go gate — critical = ship blocked.

### High-priority actions

Top 5-10 across specialists, sorted by severity then impact. Each entry:
- `[specialist] <file>:<line>` — message
- Suggested fix

### Per-specialist sections

Full sub-reports collapsed by default. One-line teaser + "run /check:<name> directly for detail."

### Recommended next commands

Based on findings:
- Any critical references → `/scan:references --fix`
- Any stale maps → `/maps:all --refresh`
- Any spec drift → `/scan:requirements review`
- Any manifest drift → `/scan:system --update`
- Provider CLI missing → echo the install command inline

---

## Output format

### Markdown (default)

Full formatted report above, plus:

```
## Decision

✓ SHIP — zero critical findings
OR
✗ BLOCKED — <N> critical findings must be resolved before ship
OR
⚠ PROCEED WITH CAUTION — zero critical, but <N> high findings should be addressed
```

### JSON (`--json`)

```json
{
  "ranAt": "<ISO>",
  "mode": "default|fast|deep",
  "specialists": {
    "architecture": { "critical": N, "high": N, "findings": [...] },
    "environment": { "...": "..." },
    "references": { "...": "..." },
    "requirements": { "...": "..." },
    "patterns": { "...": "..." },
    "system": { "...": "..." }
  },
  "summary": { "critical": N, "high": N, "medium": N, "low": N },
  "decision": "ship|blocked|caution",
  "recommended_next": ["/scan:references --fix", "/maps:all --refresh"]
}
```

---

## Execution

**Via the Agent tool (team mode):**

Dispatch six Explore agents in a single message (multiple tool calls in one turn = parallel). Each agent's prompt is the corresponding specialist skill's content + "Run in <mode> mode. Return JSON report."

**Via `claude -p` (solo mode, no teammates):**

Bash, all six in the background with `&`, then `wait`:

```bash
claude -p "/scan:architecture internal" > /tmp/check-arch.json &
claude -p "/scan:environment ready"    > /tmp/check-env.json &
claude -p "/scan:references"           > /tmp/check-refs.json &
claude -p "/scan:requirements static"  > /tmp/check-req.json &
claude -p "/scan:patterns diagnose"    > /tmp/check-pat.json &
claude -p "/scan:system"               > /tmp/check-sys.json &
wait
# Then aggregate each JSON into the final report
```

Use whichever path is faster for the current session.

---

## When to run

- **Before shipping** — the definitive pre-ship gate
- **First thing after `/clear` on a long-running branch** — catch drift accumulated across sessions
- **After a structural change** (new system, renamed skill, moved directory) — cascade check
- **Weekly / on `/sleep:deep`** — embedded as a growth-phase step
- **When `/warp:health` shows multiple yellow items** — deep dive to classify them

## Not for

- **Per-edit validation** — hooks handle that (path-guard, memory-guard, edit-watcher)
- **Single-feature checks** — use `/scan:requirements <feature>` directly
- **Quick triage** — `/warp:health` is faster for a green/yellow/red rollup

## Related

- `/warp:health` — lightweight rollup (faster, less detail)
- `/warp:doctor` — planned: `/warp:health` + `/scan:full` + deltas
- `/sleep:deep` Phase 2 — runs `/scan:full --fast` as part of cleanup
- `/oneshot:preflight` — pre-agent-run subset (architecture + environment + requirements)
