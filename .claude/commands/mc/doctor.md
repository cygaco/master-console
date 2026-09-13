---
description: "Unified MC diagnostic — runs every health check in one place. Like /mc:health but full-coverage."
user-invocable: true
---

# /mc:doctor — Comprehensive MC diagnostic

Phase 4F entry point. Aggregates every check that exists across the system into one report. Use this when:

- After `/mc:update --apply` completes — verify the install is healthy.
- Before `/mc:release` — confirm the source repo is green.
- After a long session — sweep for accumulated drift.
- When `/mc:health` reports yellow and you want the deeper view.

## Difference from /mc:health

- `/mc:health` = quick status (10s) — green/yellow/red per system, designed for "is anything broken?" triage.
- `/mc:doctor` = full diagnostic (1-3 min) — runs every check + every gate + every fixture, surfaces every finding, classifies severity.

## Usage

| Invocation | Behavior |
|---|---|
| `/mc:doctor` | Full diagnostic. Default. |
| `/mc:doctor --quick` | Skip fixtures. ~30s. |
| `/mc:doctor --gates-only` | Run only the release gates (use before `/mc:release`). |
| `/mc:doctor --json` | Machine-readable output. |
| `/mc:doctor --worktrees` | Also enumerate active worktrees + their dirty state. |

## What runs

In parallel where possible:

1. **`/mc:health`** — install integrity, ownership, missing files.
2. **`/scan:references`** — broken cross-file links.
3. **`/scan:requirements`** + `node scripts/requirements/gate.js` — spec drift.
4. **`/paths:lint --strict`** — path coherence.
5. **`/scan:architecture`** — agent system + cross-layer seams.
6. **`/hooks:test --all`** — every hook against its fixtures (Phase 5G; doctor surfaces the gap if the hook lacks fixtures).
7. **`scripts/schemas/validate.js`** — every config validates against its `$schema`.
8. **`scripts/mc/release-build.js <current-version> --check`** — current capsule integrity.
9. **Runtime-leak scan** — anything under `paths.runtime/` accidentally tracked in git.
10. **Version consistency** — `version.json`, `framework-manifest.json`, capsule `release.json` all agree on current version.

## Output shape

For each check:

```
[GRN ] check_name: 1-line message
[YEL ] check_name: 1-line message
[RED ] check_name: 1-line message
        - finding 1
        - finding 2
```

Final summary:

```
Summary: N green · M yellow · K red — overall <PASS|WARN|FAIL>
```

Fail = any red. Warn = any yellow without red. Pass = all green.

## Release gates (Phase 4H)

When called as `/mc:doctor --gates-only`, runs only the 10 release gates:

1. Path Coherence — `node scripts/paths/gate.js`
2. Framework Manifest — `node scripts/generate-framework-manifest.js --check`
3. Reference Integrity — `/scan:references --json`
4. Hook Registration — `/hooks:test --registered`
5. Hook Fixture Tests — `/hooks:test --all` (skipped if 5G hasn't shipped fixtures yet; surfaced as YEL not RED until then)
6. Fresh Install Fixture — `node scripts/mc/test-fresh-install-smoke.js` (skipped if `fixtures/install-empty-next-app/` missing — Phase 4G)
7. Update Fixture from previous — `node scripts/mc/update.js --to <prev-version> --dry-run` against `fixtures/update-from-<prev>-clean/`
8. Customized Install Fixture — same engine against `fixtures/update-from-<prev>-customized/`
9. Runtime Leak Scan — `git ls-files | grep -E '\\.claude/runtime/|\\.claude/project/events/'` empty
10. Version Consistency — `version.json` `version` matches `framework-manifest.json` `version` matches latest capsule's `release.json` `version`

If any gate fails, `/mc:release` stops; the publish does not proceed.

## Failure recovery

The output for each red finding includes a fix hint. For framework-level fixes (path-registry drift, manifest regen) the hints reference the regenerator script. For project-level findings (open Class C RCO, stale spec) the hints reference the appropriate `/check:*` skill.

## See also

- `/mc:health` — the lightweight check, designed to run frequently.
- `/mc:release` — uses `/mc:doctor --gates-only` as its first step.
- `/scan:full` — runs the project-level checks; `/mc:doctor` is the framework-level superset.
