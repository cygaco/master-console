# Release Plan — Rebrand identifier layer: Master Console slug mc, mc@2.0.0 with one-release aliases + downstream migration

**Sprint:** `S-OS-06`
**PRD:** `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\prd.md`

> Honored by `/sprint:release`. Lists the conditions under which the
> sprint may ship.

## Required to ship

- [ ] All `done` tickets meet their AC.
- [ ] All blocking issues are resolved, deferred, or explicitly accepted.
- [ ] PRD requirements satisfied.
- [ ] COPY satisfied per `copy.md`.
- [ ] INPUTS satisfied per `inputs.md`.
- [ ] TRACE entries fire as documented in `trace.md`.
- [ ] Acceptance criteria satisfied per `acceptance-criteria.md`.
- [ ] QA plan passing per `qa-plan.md`.
- [ ] Redteam plan passing per `redteam-plan.md`.
- [ ] External service dependencies ready, mocked, integrated, or
      deferred with rationale.
- [ ] Required env vars present (names checked; values never logged).
- [ ] Release approval recorded in `approvals/`.

## Release artifacts

- [ ] Changelog / release notes drafted
- [ ] Docs updated
- [ ] Analytics/events updated where applicable
- [ ] Migration plan (or `none_required` annotated)
- [ ] Rollback plan (or `none_required` annotated)

## Monitoring after release

- [ ] {{monitoring_check_1}}
- [ ] {{monitoring_check_2}}

## Approval

Production deploy requires explicit user approval per
`CLAUDE.md#Autonomy`. Record the approval id in
`releases/<id>.yaml#approval_ref`.

## Documentation scaling

Required for `documentation_scale: m | l | xl`. For xs/s, ship-gate may
be a single block inside the QA plan.

## Release residuals (S-OS-06 → carried to the 2.0.0 release ceremony / r4)

Recorded per the T5-B deferral conditions (team-lead + α). These are NOT sprint-build blockers; the branch CI (leak-gate.yml = 5 gates + npm test) is GREEN without them.

- **install-matrix upgrade cases require the release-minted 2.0.0 capsule — GATE-B at ceremony.** npm test does not run the install-matrix (`scripts/mc/test-install-matrix.js` is a separate release gate). The `existing_install_upgrade` / `multi_version_upgrade` cases need a resolvable canonical `framework/releases/2.0.0/` capsule with `checksums.json` + `release.json`, which the release-build tooling mints at the 2.0.0 ceremony (operator-run, as for every prior release). The hand-assembled partial `framework/releases/2.0.0/` is untracked and must NOT be committed; release-build re-mints it canonically.
- **Compat window expiry (2.1.0):** the 7 registered compat surfaces (warp:* / scan:warpos-* alias skills, warpos-*.js check-script shims, WARPOS_* env read-both, mc-env legacy map, _mc//.mc/ + HOME fallbacks, migrations/1.2.0-to-2.0.0 data, doc-ref legacy-rename tolerance) each carry a per-entry `expires: 2.1.0` and fail closed at that version — the 2.1.0 release must remove them.
- **otherWarpResidual (~95)** non-enumerated `warp:` refs + **bare `warp-*` filenames** (e.g. `warp-setup.js`) — α-ruled OUT of the warp:→mc rename for 2.0.0; named residual for r4.
- **MC-prose:** the codemod turned "WarpOS"→"MC" in some user-facing prose (version.json description, a few skill descriptions) — β rules at r4 whether "MC" is accepted for 2.0.0 or a "Master Console" prose pass is scheduled for 2.0.1 / S-OS-07.
