<!-- requirement-format-legacy -->
# Acceptance Criteria — Panel namespace + roadmap panel (ROADMAP items 23+25)

**Sprint:** `SP-20260615-001`
**PRD:** `.claude/project/sprint/requirements/SP-20260615-001/prd.md`
**Authored by:** product-lead (design phase, ε-conducted) · **β:** DECIDE 0.89 before_plan (4 HOW-corrections folded in, labeled [β-1..4])

> Each AC is a testable statement with a `verified_by:` line. Layer = dev-tooling (a registry +
> thin forwarder skills + node scripts) → AC scoped to behavior + enforcers, not visual design.
> Tests are node assertions over the modules/files with injected seams (no live browser/dev-server
> in the corpus). `verified_by` root: `tests/regression/SP-20260615-001/`. Two AC are
> `not_applicable` release/process gates with a named manual probe + non-empty justification.
> The R-ids match prd.md R-1..R-5 exactly (single-source, T-298).
>
> **Asymmetry to hold (β-3 vs β-4):** the GENERATOR (R-4 roadmap board) fails SOFT on its
> human-authored inputs (degrade a section, render the rest). The ENFORCER (R-5 coverage check)
> fails CLOSED on its OWN corrupt input (exit ≥2). These are tested as opposite behaviors on
> purpose — do not let one leak into the other.

## S-1 — Panel registry: ONE source of truth (R-1)

- AC-R1a (NEW sibling file, admin registry untouched) **[β-1]**: Given the panel registry is
  introduced, when the tree is inspected, then a **NEW** `framework/panel-registry.json` exists
  AND `framework/admin-panel-registry.json` is **byte-for-byte unchanged** from its pre-sprint
  blob (the admin registry is NOT extended/folded-into — its enforcer hardcodes `ADMIN_SKILLS`,
  a mandatory `route`, an `/admin`-anchored opener regex, and 3 locked regression tests; reusing
  it would force churn on a locked surface). A diff to `admin-panel-registry.json` content FAILS.
  verified_by: tests/regression/SP-20260615-001/registry-new-file.test.js::panel-registry-is-new-file-admin-registry-byte-unchanged
- AC-R1b (row shape — no mandatory `route`) **[β-1]**: Given `framework/panel-registry.json`, when
  validated, then it carries a `$schema` of `warpos/panel-registry/v1` and a `panels` map whose
  every row is exactly `{ name, opener, description, run_context }` — all four are non-empty
  strings, `route` is **NOT** required (run_context, not route, carries the in-app-vs-CLI
  distinction), and `run_context` ∈ a fixed enum `{ in_app, cli }`. A row missing any of the four
  keys, or carrying a mandatory `route`, FAILS.
  verified_by: tests/regression/SP-20260615-001/registry-shape.test.js::rows-are-name-opener-description-run_context-no-mandatory-route
- AC-R1c (single source for BOTH consumers): Given the forwarders (R-2) and the enumerator (R-3),
  when each resolves the set of panels, then **both read `framework/panel-registry.json`** as their
  only source — neither hardcodes a panel list. A forwarder or enumerator with an inline panel list
  that can drift from the registry FAILS.
  verified_by: tests/regression/SP-20260615-001/registry-single-source.test.js::forwarders-and-enumerator-both-read-registry-no-inline-list
- AC-R1d (seeded rows resolve): Given the seeded registry, when each row is read, then it contains
  at minimum the four known panels with the verified openers — `readiness → /cockpit:readiness`,
  `models → /models:router`, `admin → node scripts/admin/preview.js`, `roadmap → node
  scripts/panel/roadmap.js` — and each opener resolves to a real backing target (skill resolves /
  script file exists). A seeded row pointing at a dead opener FAILS.
  verified_by: tests/regression/SP-20260615-001/registry-seed-resolves.test.js::four-known-panels-seeded-and-openers-resolve

## S-2 — /panel:* forwarder skills delegate, never re-implement (R-2)

- AC-R2a (pure delegation — zero duplicated opener logic) **[β-2]**: Given any `/panel:<x>`
  forwarder skill body, when inspected, then it **DELEGATES** to the canonical opener and contains
  **no duplicated opener logic** — `/panel:readiness`'s actionable body is "invoke
  `/cockpit:readiness`", full stop (the proven admin thin-delegator shape). A forwarder body that
  copies/inlines the target's logic (boot/scaffold/parse/render steps, or a second copy of the
  target script's invocation flags beyond the single delegated call) is a **FINDING** and FAILS.
  verified_by: tests/regression/SP-20260615-001/forwarders-delegate.test.js::each-forwarder-delegates-no-duplicated-opener-logic
- AC-R2b (the canonical target stays the source of truth): Given a forwarder and its canonical
  target, when the target's opener changes, then the forwarder needs **no edit** (it names the
  target, not the target's internals) — proven by a forwarder whose only canonical-specific token
  is the target opener id/command string it shells, and nothing else target-specific.
  verified_by: tests/regression/SP-20260615-001/forwarders-delegate.test.js::forwarder-references-target-by-name-only-survives-target-internal-change
- AC-R2c (frontmatter + run-in-product boundary): Given each forwarder skill, when its frontmatter
  is read, then it declares `user-invocable: true`, `namespace: panel`, and lists
  `framework/panel-registry.json` (+ the canonical target) under `reads`; and an `in_app`-context
  forwarder (e.g. `/panel:admin`) inherits the target's run-in-product boundary — it never asserts
  it can open against the WarpOS canonical tree itself (the keystone target owns that refusal).
  verified_by: tests/regression/SP-20260615-001/forwarders-frontmatter.test.js::forwarder-frontmatter-declares-namespace-reads-and-defers-runcontext-to-target

## S-3 — /panel enumerator: the one discoverable entry (R-3)

- AC-R3a (registry-complete enumeration — the FTUE surface): Given `/panel:list` (resp. bare
  `/panel`) is invoked, when it runs, then it lists **every** `panels` row from
  `framework/panel-registry.json` with its one-line `description` and `run_context` — count and
  names match the registry exactly (no omissions, no hardcoded extras). A registry row absent from
  the enumeration, or an enumerated panel not in the registry, FAILS.
  verified_by: tests/regression/SP-20260615-001/enumerator-complete.test.js::enumeration-matches-registry-rows-exactly
- AC-R3b (fail-soft on a malformed registry): Given `framework/panel-registry.json` is unreadable
  or malformed at enumeration time, when `/panel:list` runs, then it reports a clear
  "panel registry unavailable" message and exits non-zero **without throwing an uncaught
  exception** — the operator gets a legible failure, not a stack trace. (Note: this is the
  enumerator's *read-time UX*; the R-5 enforcer is what fails CLOSED on the same corruption.)
  verified_by: tests/regression/SP-20260615-001/enumerator-failsoft.test.js::malformed-registry-yields-clear-message-no-uncaught-throw

## S-4 — Roadmap board: read-only "what's next", fail-soft (R-4)

- AC-R4a (read-only board from the live sources): Given `node scripts/panel/roadmap.js` runs, when
  it completes, then it renders a **static** board (a regenerated artifact, like the maps)
  assembled from the four live sources — ROADMAP.md `## Sprint Pickup Queue` / `### Prioritized
  order`, TRACKER.md `## Current Highest-Priority Next Action`,
  `.claude/project/sprint/active-sprints.yaml`, and the open-gaps registers — showing the ranked
  next-action + in-flight sprints + blockers. The board is **strictly read-only**: the generator
  performs no write to any source file (only its own output artifact).
  verified_by: tests/regression/SP-20260615-001/roadmap-board-render.test.js::renders-board-from-four-live-sources-reads-only
  - **AMENDMENT 2026-09-16 (S-OS-06 r4 lane H; β verdict `7d3e9f51-2b84-4a06-8c95-1f60b3e74d28`,
    betaEvents row 475): the verification is SPLIT BY SOURCE AVAILABILITY. The claim above is unchanged.**
    (a) The three TRACKED sources, ROADMAP.md, TRACKER.md and `active-sprints.yaml`, are in every clean
    checkout. The test keeps running the generator against the REAL repo (its default root, with any
    roadmap-root env override removed). It asserts that each of those three sections resolves healthy and
    carries its source's provenance line. That covers the "do the board's configured source paths still
    resolve against the real tree" regression class. The check reads the provenance line inside the section
    and never matches a bare filename, because a missing source's "section unavailable" reason can contain
    the filename (e.g. `active-sprints.yaml not found`).
    (b) The two open-gaps registers, `.claude/project/memory/enforcement-debt.jsonl` and
    `recurring-issues.jsonl`, are gitignored runtime registers that no clean checkout has. Their provenance
    is asserted on a fixture root that WRITES both registers and copies in the three tracked sources. The
    root is rendered through the generator's existing `--root` seam, and the gaps section must report the
    fixture's own open counts. The read-only proof covers both runs.
    **Warrant:** the test never proved the registers exist. It proved that on a machine which happens to
    carry them, the board cites them. The real-repo run was an incidental way of obtaining sources, not the
    claim, and a test that asserts a state must create that state. The product is right: with the registers
    absent, the gaps section correctly reads "section unavailable" under AC-R4c, which the AC-R4c test
    asserts. The pre-amendment test encoded an environment assumption that never held in a clean checkout.
    **Provenance of the defect:** inherited, not caused by S-OS-06. The test was authored 2026-06-14
    (`7faa1728`) and first surfaced when `npm test` was wired into CI on 2026-09-12 (`cd07638e`).
    The AC-R4c fixture (`roadmap-board-failsoft.test.js`) gets the same correction: it writes its own
    registers instead of copying host runtime state. The AC-R4c text itself needs no change.
- AC-R4b (READ-ONLY v1 — any write path is out of scope) **[β-4]**: Given the roadmap board module,
  when its surface is inspected, then it exposes **no mutate/reorder/mark-done path** — there is no
  code path that writes back to ROADMAP/TRACKER/active-sprints (any such write would be a
  confirm-class action, out of v1 scope). A planted write-back path FAILS.
  verified_by: tests/regression/SP-20260615-001/roadmap-board-readonly.test.js::no-writeback-path-to-any-source-confirm-class-out-of-scope
- AC-R4c (fail-SOFT on human-authored inputs — the cold/empty-state path) **[β-4]**: Given any one
  source section is missing, empty, or malformed (a renamed heading, broken YAML, an absent file),
  when `roadmap.js` runs, then that section **degrades to a "section unavailable" placeholder and
  the rest of the board still renders** — the generator **never throws and never blocks**. Tested
  per-source: a malformed ROADMAP §, a malformed TRACKER §, a broken active-sprints.yaml, and an
  absent open-gaps register each independently degrade-and-continue.
  verified_by: tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js::each-malformed-or-missing-source-degrades-to-section-unavailable-without-throwing
- AC-R4d (/panel:roadmap opens the board via delegation) **[β-2]**: Given `/panel:roadmap` is
  invoked, when it runs, then it **delegates** to `node scripts/panel/roadmap.js` (the R-2 thin-
  forwarder shape — no board-generation logic in the skill body) and surfaces the generated board.
  A `/panel:roadmap` body that re-implements any parse/render step FAILS.
  verified_by: tests/regression/SP-20260615-001/roadmap-opener-delegates.test.js::panel-roadmap-delegates-to-generator-no-inline-render

## S-5 — Coverage enforcer + shipping integrity (R-5)

- AC-R5a (coverage: every registry row resolves to a real opener): Given `node
  scripts/checks/panel-registry-coverage.js` runs over `framework/panel-registry.json`, when it
  evaluates each `panels` row, then it asserts the opener resolves to a **real backing target** —
  a `node <script>` opener's script file exists; a `/<ns>:<name>` opener resolves via
  `dispatch-skill.js --resolve` (`found:true`) — and rejects any opener with a shell metacharacter
  or an unrecognized/unanchored form (the admin-suite-coverage hardening, ported). An orphan /
  phantom / unsafe opener is a hard finding → exit 1.
  verified_by: tests/regression/SP-20260615-001/panel-coverage-resolves.test.js::every-row-opener-resolves-orphan-or-unsafe-is-finding
- AC-R5b (fail-CLOSED on the enforcer's OWN corrupt input — distinct from a clean pass) **[β-3]**:
  Given `framework/panel-registry.json` is itself **unreadable, not JSON, or carries the wrong
  `$schema`**, when `panel-registry-coverage.js` runs, then it exits **≥2** (fail-closed:
  could-not-run is NOT green) and this exit is **distinct from both** a clean all-resolve pass
  (exit 0) and an orphan-row finding (exit 1). A coverage check that reads green on its own
  malformed input FAILS.
  verified_by: tests/regression/SP-20260615-001/panel-coverage-failclosed.test.js::corrupt-registry-exits-ge-2-distinct-from-clean-pass-and-from-finding
- AC-R5c (wired REPORT-ONLY into /scan:full): Given the enforcer ships, when `/scan:full` is
  inspected, then `/scan:panel-registry-coverage` is delegated in the **Tier-2** list (beside
  `/scan:admin-suite-coverage`) and is **report-only** — it surfaces findings but does **not** gate
  the run (does not flip /scan:full's exit). The report-only ramp is honored (non-goal: not
  blocking in v1). `/scan:scan-coverage` confirms it is delegated (no silent scan-list drift).
  verified_by: tests/regression/SP-20260615-001/panel-coverage-wired.test.js::delegated-tier2-report-only-and-on-scan-coverage-inventory
- AC-R5d (path keys survive SOURCE→generated regen): Given new keys (`scriptsPanel`,
  `panelRegistry`) are added to the **SOURCE** `framework/paths.registry.json` and
  `scripts/paths/build.js` is run, when the generated views are read back, then **both keys are
  present** in `.claude/paths.json` AND `scripts/hooks/lib/paths.generated.js`; a key added only to
  the generated view (the orphan-key bug, CLAUDE.md source-vs-generated) FAILS.
  verified_by: tests/regression/SP-20260615-001/pathkey-roundtrip.test.js::panel-keys-survive-source-to-generated-regen
- AC-R5e (both manifests + maps regenerated): Given framework files were added (a registry + panel
  skills + a script + path keys), when the manifests are regenerated, then **BOTH**
  `generate-framework-manifest.js` AND `scripts/warpos/manifest/build.js` are re-run, **BC-02/BC-05
  stay green**, and `maps:skills` lists the new `panel:*` skills.
  verified_by: not_applicable — release-gate check; named manual probe: `/scan:full` shows BC-02 +
  BC-05 green and `maps:skills` lists the `panel:*` skills (readiness/models/admin/roadmap/list)
  post-regen. BC-02/BC-05 are the standing manifest enforcers; this AC binds them to the new surface.
