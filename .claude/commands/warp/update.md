---
description: "Update MC in this project to a target release. Default = latest. Default mode = dry-run; pass --apply to execute."
user-invocable: true
---

# /warp:update — Apply a MC release capsule

Phase 4C entry point. The actual engine lives at `scripts/mc/update.js`. This skill is a thin wrapper that resolves arguments, runs the engine, and presents the plan.

## Usage

| Invocation | Behavior |
|---|---|
| `/warp:update` | Dry-run against latest available release capsule. Prints the 12-category plan + class-A/B/C breakdown. **Safe.** |
| `/warp:update 0.2.0` | Dry-run against capsule `framework/releases/0.2.0/`. |
| `/warp:update --apply` | **Apply** the latest plan. Class A auto-apply, Class B apply-with-reviewer, Class C escalates. |
| `/warp:update --apply --confirm-deletes` | Same as above, plus actually executes Class A `DELETE_SAFE` removals (otherwise deferred). |
| `/warp:update --json` | Machine-readable output. |

## Procedure

### Step 1 — pre-flight

Check `.claude/framework-installed.json` exists. If not: tell the user to run `install.ps1` first; this skill is for upgrades, not fresh installs.

**Do NOT pre-check the local `framework/releases/<version>/` directory.** 0.4.1+ update.js auto-discovers canonical clones via sibling walk (`../MC`, `../mc`) and via `manifest.json#mc.source` / `framework-installed.json#source`. If the local repo's `framework/releases/` is stale, the engine reads the capsule from canonical and the slash command stays silent about the lookup. Only fall back to "list available capsules" if the engine itself reports the capsule can't be found anywhere.

### Step 2 — invoke engine

```bash
node scripts/mc/update.js --to <version> --dry-run    # default
node scripts/mc/update.js --to <version> --apply       # if --apply supplied
```

The engine prints `[update] capsule <v> not in local framework/releases/ — using canonical at <path>` to stderr when it auto-discovered a sibling/manifest-pointed clone. Pass that line through verbatim so the user sees where the source came from. Pass `--no-discover` to disable the walk (useful for closed-environment tests).

Capture stdout. The engine emits a 12-category classification plus Class A/B/C totals.

### Step 3 — present the plan

Render a one-screen summary:

- **From → To** versions
- **Class A (auto):** count + sample of asset IDs
- **Class B (apply+review):** count + sample
- **Class C (escalate):** count + each item one-line, full detail

If any Class C: stop with an "ESCALATE:" prefix message; the user must decide for each.

Then render the standard human report shape:

1. Verdict
2. What changed
3. Why
4. Risks remaining
5. What was rejected
6. What was tested
7. What needs human decision
8. Recommended next action

### Step 4 — if --apply

The engine walks the plan and writes to the local install:
- Class A `ADD_SAFE` / `UPDATE_SAFE` / `GENERATED_REBUILD` / `MERGE_SAFE` → copy from capsule's source tree to the local destination.
- Class A `DELETE_SAFE` → deferred unless `--confirm-deletes` is passed (matches `promote.js` semantics).
- Class A `LOCAL_ONLY` / `LOCAL_CUSTOMIZED` → no-op.
- Class B `MERGE_SAFE` / `RENAME_SAFE` / `MIGRATION_REQUIRED` → applied in this run; reviewer surfaces in the report.
- Class C — refused. Engine returns `ok:false` with an `ESCALATE:` error and a sample of offenders.

After the apply, run the `postUpdateChecks` from `release.json` in order. Any non-zero exit → stop, surface the failing check, and recommend `/warp:doctor` to verify state.

### Step 5 — write installed snapshot

The engine updates `.claude/framework-installed.json` with the new `installedVersion`, `installedCommit`, `installedAt`, per-asset `installedHash`, and the `generated[]` array. The snapshot is the source of truth `/warp:update` reads on the next run to classify local-vs-installed drift.

## Preflight (SP-20260513-005 — `scripts/mc/preflight.js`)

Before any classify or write, the engine composes 10 gates in fail-fast order. The composer returns one structured aggregate report (per `IN-1`) and emits one `mc.update.preflight` event per gate plus an aggregate summary event.

| # | Gate (`scan:mc-*`) | Mitigates | Override flag |
|---|---|---|---|
| 1 | `install-baseline` (NEW) | F-4 missing baseline | `--force-fresh` |
| 2 | `capsule-resolvable` (NEW) | F-1 capsule missing | `--source <path>` |
| 3 | `version-quorum` (NEW) | F-3 version drift | `--allow-version-drift` (composer-level) |
| 4 | `manifest-honesty` | F-3 (steady-state) | — |
| 5 | `staleness` | drift bounded | `--allow-stale` |
| 6 | `path-resolution` | F-6 | — |
| 7 | `structure-parity` | F-7 | — |
| 8 | `applied-migrations` | F-5 (cleanup side) | — |
| 9 | `migration-presence` (NEW) | F-5 (the broken-capsule side) | — |
| 10 | `tracked-transients` | F-8 | — |

Red on any gate refuses apply. Yellow with the matching override accepted is treated as green for blocking but logs `overrideUsed=true` to `events.jsonl` (R-34 mitigation).

Pass `--all-red` (a.k.a. `--diagnostic`) to skip fail-fast and surface every red in one report.

## Transaction (SP-20260513-005 — `scripts/mc/transaction.js`)

Once preflight is green, the engine wraps the apply phase in a transaction.

- `beginTransaction(opts)` writes `<targetRoot>/.mc/transactions/<txId>/{header,plan,snapshot,capsule}.json` atomically, then copies every UPDATE_SAFE / GENERATED_REBUILD / DELETE_SAFE asset's pre-state to `<txDir>/backup/<dest>` with its `pre_state_sha256` recorded in `snapshot.json`.
- An `active.lock` file at `<targetRoot>/.mc/transactions/active.lock` is taken (**R-32** — refuses begin if already held by another in-progress apply).
- A fast preflight subset (install-baseline + manifest-honesty + tracked-transients) re-runs at `begin` (**R-33** — defends against begin-vs-classify race).
- `snapshot.json` is hashed and the hash is recorded in `header.json#snapshotSha256` (**R-31** — rollback refuses if the hash mismatches).
- On any error during the apply loop, `rollbackTransaction(txDir)` restores every file with `existed_pre_apply:true` from `backup/<dest>` and unlinks every `existed_pre_apply:false` write that completed before the error, writes `result.json{outcome:"rolled-back"}`, clears the lock, and exits 1.
- `commitTransaction(txDir, …)` writes `result.json{outcome:"committed"}` and clears the lock.

The whole `.mc/transactions/` directory is git-ignored (see `.gitignore`).

## Postflight (SP-20260513-005 — `scripts/mc/postflight.js`)

After a successful commit, the engine runs 5 checks (diagnostic — does NOT auto-rollback unless `--strict-postflight`):

1. `manifest-honesty` — framework-installed.json matches disk
2. `path-resolution` — every `paths.X` key resolves
3. `applied-migrations` — no leftover scripts
4. **provider-smoke** — external check via the `registerExternalCheck` primitive (SP-002 boundary; records `status:degraded` until SP-002 ships)
5. `/warp:health` rollup — system health aggregate

Per-check + aggregate events emit to `events.jsonl` (`cat=mc.update.postflight`). An evidence package is written to `<txDir>/evidence/postflight.json` matching `IN-3`. Postflight pointer event (`cat=mc.update.evidence`) carries the path.

## Integrated flow (T-20260513-062 — `scripts/mc/update.js#run()`)

As of T-20260513-062 the tri-pillar above is wired into the engine's `run()` itself. Applying a capsule walks this exact sequence:

```
1. classify          — 12-category plan against installed snapshot
2. ESCALATE check    — refuse if any Class C
3. Preflight         — runPreflight() composes 10 gates; red ⇒ refuse with remediation
4. beginTransaction  — header + plan + snapshot + capsule.json + backup/, active.lock taken,
                       fast-preflight subset re-run (R-33), snapshot hashed (R-31)
5. Apply (wrapped)   — applyUpdateDecisions() copies files; any error throws
6. Migrations        — runMigrations() inside the same try; any failed migration throws
7. ON ERROR          — rollbackTransaction() restores backups, unlinks ADDs,
                       writes result.json{outcome:"rolled-back"}, clears lock
8. ON SUCCESS        — write framework-installed.json, then commitTransaction()
                       writes result.json{outcome:"committed"} + clears lock
9. Capsule checks    — release.json#postUpdateChecks (per-capsule contract)
10. Postflight       — runPostflight() composes 5 checks; diagnostic only,
                       writes <txDir>/evidence/postflight.json (IN-3)
11. Return           — { ok, preflight, apply, migrations, postUpdateChecks, postflight, transaction, transactionDir }
```

**Coexistence:** `release.json#postUpdateChecks` (the per-capsule contract every release carries) and `runPostflight()` (the framework-side composer) both run. The capsule checks fire first; postflight fires after. Either can surface failures, but only postflight produces the IN-3 evidence package. SP-002's provider-smoke participates in postflight via `postflight.js#registerExternalCheck`, which self-wires at module load.

**Per-gate override flags introduced by T-062:**

| Flag | Behavior |
|---|---|
| `--force-fresh` | Preflight: accept yellow on `install-baseline` (treat as fresh install) |
| `--allow-stale` | Preflight: accept yellow on `staleness` |
| `--allow-version-drift` | Preflight: accept yellow on `version-quorum` |
| `--skip-preflight` | Bypass preflight composer entirely (NOT recommended; emergency hatch) |
| `--no-transaction` | Skip the transaction wrapper — legacy compatibility; writes a minimal txDir without snapshot/lock/rollback |
| `--skip-postflight` | Skip the postflight composer (suppresses the 5 diagnostic checks + IN-3 evidence) |
| `--strict-postflight` | Treat any postflight red as a non-zero exit (still no rollback — postflight is diagnostic) |

Dry-run (`--dry-run` or omitting `--apply`) does **not** run preflight, transaction, or postflight — the classify step alone produces the plan, and no file touches occur. Operators who want a standalone preflight read against the install run `node scripts/mc/preflight.js --target <root> --to <v>` directly.

## `--rollback <txId>` (manual rollback CLI)

The auto-rollback inside `run()` covers the *common* failure path (apply or migration throws). The manual CLI surface exists for the operator-driven cases:

- Postflight surfaced reds and `--strict-postflight` was **not** set, so the run committed — but on inspection the operator wants to roll back anyway.
- A previous run was killed mid-flight (`Ctrl-C`, OS reboot, OOM) and left `.mc/transactions/<txId>/` with `result.json` absent or `outcome != "committed"`.
- `ROLLBACK.md` inside every txDir already advertises this command verbatim; this section makes the operator surface real.

### CLI form

```bash
node scripts/mc/update.js --rollback <txId>                       # positional
node scripts/mc/update.js --rollback=<txId>                       # equals form
node scripts/mc/update.js --rollback <txId> --target <root>       # alternate install root
node scripts/mc/update.js --rollback <txId> --json                # machine-readable output
```

`<txId>` is the directory name under `<targetRoot>/.mc/transactions/`. `--target` defaults to the repo containing `update.js` (legacy self-update mode). `paths.mcTransactionsDir` (`.mc/transactions`) is the relative base under target.

### What it does

1. Resolves `<targetRoot>/.mc/transactions/<txId>/` and verifies the directory + `header.json` exist.
2. Refuses with exit `4` if the txDir was created with `--no-transaction` (no snapshot envelope to roll back from).
3. Calls `transaction.rollbackTransaction(txDir, { trigger: "operator", reason: "manual-cli-rollback", operator: process.env.USER || process.env.USERNAME || "unknown", … })`.
4. The underlying call restores every `existed_pre_apply:true` entry from `backup/<dest>`, unlinks every `existed_pre_apply:false` write that completed, hash-verifies `snapshot.json` against `header.snapshotSha256` (R-31), and clears `active.lock` (R-32).
5. Emits a one-line summary: `[OK] rollback <txId>: restored=<n> unlinked=<n> partial=<bool>`.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Full rollback — no partial, no error. |
| `1` | Partial rollback — some entries restored, some failed. Inspect `<txDir>/diagnostics.log` + `<txDir>/result.json`. |
| `2` | Usage error — `--rollback` passed without a `<txId>` argument. |
| `4` | `txDir` not found, `header.json` missing/unparseable, or transaction was `--no-transaction` (no envelope). |
| `5` | `rollbackTransaction` threw — e.g. snapshot hash mismatch (R-31). |

### Example

```bash
# After an aborted update, list the abandoned transactions:
ls .mc/transactions/

# Roll back a specific one:
node scripts/mc/update.js --rollback 2026-05-13T22-42-58-072Z-warp-update-MC

# → [OK] rollback 2026-05-13T22-42-58-072Z-warp-update-MC: restored=42 unlinked=3 partial=false
#       txDir:        <abs-path>/.mc/transactions/2026-05-13T22-42-58-072Z-warp-update-MC
#       fromVersion:  0.4.4 (would have been 0.5.0)
```

The rollback is itself transactional when invoked with the underlying `rollbackTransaction({ undo: true })` option (R-30 — `rollback-undo/` snapshot before mutate); the CLI does NOT pass `undo:true` by default — pass it through the programmatic API if you need it.

**Override flags:**

| Flag | Behavior |
|---|---|
| `--allow-stale` | Yellow on `staleness` accepted; logs `overrideUsed=true` |
| `--force-fresh` | Yellow on `install-baseline` accepted (treats as fresh install) |
| `--allow-version-drift` | Yellow on `version-quorum` accepted (NOT recommended) |
| `--strict-postflight` | Any postflight red causes non-zero exit + `--rollback <txId>` hint |
| `--rollback <txId>` | Rolls back the named transaction. Snapshots pre-rollback state to `<txDir>/rollback-undo/` (R-30 — rollback itself is transactional) |
| `--source <path>` | Explicit canonical clone root (overrides discovery) |
| `--no-discover` | Disable sibling-clone discovery |
| `--diagnostic` / `--all-red` | Preflight: run all 10 gates even on first red |

## Troubleshooting

Indexed to `failure-mining.md` signatures F-1..F-9.

### F-1 — `Capsule X.Y.Z missing release.json at <path>`

**Symptom:** Apply refuses immediately; gate `capsule-resolvable` reports red.

**Diagnosis:** The capsule for `--to <v>` is not in `REPO_ROOT`, any sibling clone, nor at the manifest-hinted source.

**Remediation:**
1. Run `/warp:update` (no `--to`) — it auto-discovers and uses the latest available capsule.
2. Or list available versions and pick one: the red-gate output names them per searched location.
3. Or point `--source` at a canonical clone explicitly: `/warp:update --to <v> --source /abs/path/to/MC --apply`.

### F-2 — Capsule gap (release tag exists, capsule wasn't built)

**Symptom:** Same as F-1, but no canonical clone has the requested version either.

**Diagnosis:** The capsule was never built.

**Remediation:** In the canonical clone, `node scripts/mc/release-build.js <v>`. A future `release-gates.js` extension (out of scope for SP-005) will enforce capsule-per-tag at release time.

### F-3 — Version drift between sources of truth

**Symptom:** Gate `version-quorum` reports red with per-source values.

**Diagnosis:** `version.json`, `framework-manifest.json`, `framework-installed.json`, and/or the `install.ps1` header constant disagree.

**Remediation:** **Trust order is `version.json` wins** (CLAUDE.md learning 2026-05-13). Inspect each disagreeing file; if `framework-manifest.json` is stale, `git checkout HEAD -- .claude/framework-manifest.json`, then re-run `/scan:mc-manifest-honesty`. No automatic reconciliation — operator must resolve.

### F-4 — `framework-installed.json` missing or ignored by `.gitignore`

**Symptom:** Gate `install-baseline` reports red.

**Diagnosis:** `.claude/` is git-ignored by default; `framework-installed.json` is a per-machine snapshot. On a fresh clone, this gate fires until install or restore.

**Remediation:** Either `powershell -ExecutionPolicy Bypass -File <mc-repo>/install.ps1`, or restore from a prior commit via `git checkout`. Use `--force-fresh` ONLY if you mean to treat this as a fresh install (yields a massive ADD_SAFE plan).

### F-5 — Migration not run / migration-coverage gap

**Symptom:** Gate `migration-presence` reports red with `evidence.missing` listing migration paths.

**Diagnosis:** The capsule's `release.json#migrations[]` references files that don't exist in the source tree.

**Remediation:** In canonical, `node scripts/mc/release-build.js <v>` to regenerate; or edit `release.json` to remove the entry and rebuild checksums via `node scripts/mc/release-canonical.js <v>`. **No override** — refuse to apply with a broken capsule.

### F-6 — Path-resolution drift after update

**Symptom:** Gate `path-resolution` reports red (preflight or postflight).

**Diagnosis:** A `paths.X` key in `.claude/paths.json` points to a non-existent file.

**Remediation:** `node scripts/paths/build.js --check` and `node scripts/paths/gate.js`. The path-guard hook warns at write-time; path-lint exits 1 on criticals.

### F-7 — Structure parity drift

**Symptom:** Gate `structure-parity` reports red.

**Diagnosis:** Canonical's framework manifest declares a structural skeleton dir that the install doesn't have.

**Remediation:** Re-run install in repair mode, or `mkdir -p <missing-dir>` and re-run `/warp:update`.

### F-8 — Tracked transients in capsule

**Symptom:** Gate `tracked-transients` reports red.

**Diagnosis:** `.mc/`, `qa-*.png`, `runtime/qa-*/` got committed to the canonical repo and ended up in the capsule.

**Remediation:** Clean up in canonical, rebuild the capsule, re-run `/warp:update`. The downstream install is not at fault.

### F-9 — HTML-entity-encoded commands

**Symptom:** Shell parser error: ``syntax error near unexpected token '&amp;'``.

**Diagnosis:** Copied a command from a PR description or HTML-rendered source; `&` got entity-encoded.

**Remediation:** Scan pasted commands for `&amp; &lt; &gt;` before executing. **Not gated** — operator hygiene only.

## Failure modes (legacy)

- `release.json` missing → see F-1 above.
- `framework-installed.json` missing → see F-4 above.
- Class C unresolved → cannot apply; ESCALATE.
- `postUpdateChecks` fails → see postflight evidence package; consider `--rollback <txId>` if state is genuinely broken.

## Provider smoke (SP-20260513-002 — `scripts/mc/provider-smoke.js`)

After SP-005's 5-check postflight completes, the engine runs the
provider-smoke orchestrator as a terminal verification gate. The smoke is
declared in `release.json#postUpdateChecks` (see T-20260513-020 wiring)
**and** registered through SP-005's `registerExternalCheck` primitive so
the smoke participates in the postflight evidence package alongside the
built-in checks. Both paths are deliberate: `postUpdateChecks` is the
contract every capsule carries; `registerExternalCheck` is the run-time
composition seam that lets postflight surface degraded states.

### Exit-code contract (PRD R-7)

| Code | Meaning |
|---|---|
| `0` | All required providers green. |
| `0` | At least one yellow status, no reds. `--exit-on-yellow` flips this to `2`. |
| `1` | Internal error — corrupt failure-mode catalog (AC-3.2), invalid argv, shell-meta in `--providers`, or `..`/null-byte in `--target`. |
| `2` | At least one required provider red. Update apply already committed; smoke is a post-apply verifier, not a rollback trigger. |

`/warp:update --apply` honours these codes per `release.json#postUpdateChecks`. A non-zero smoke exit surfaces in the postflight evidence package at `<txDir>/evidence/postflight.json` (per IN-3).

### RCA + safe-only auto-fix

Each non-green probe result is run through `scripts/mc/lib/provider-rca.js` (T-022) which maps `status -> { root_cause, safe_to_autofix, fix_recipe, remediation, fallback_allowed }` using the catalog at `paths.providerFailureModes`. Entries whose `safe_to_autofix === true` are routed to `scripts/mc/lib/provider-autofix.js` (T-023). The dispatcher enforces a closed-set policy:

- **`ALLOWED_RECIPE_KINDS`** — `set_env_and_reprobe`, `retry_with_same_timeout` (only).
- **`ALLOWED_ENV_KEYS`** — `GEMINI_CLI_TRUST_WORKSPACE` (only).
- **`FORBIDDEN_ENV_SUBSTRINGS`** — `API_KEY`, `TOKEN`, `AUTH`, `SECRET`, `PASSWORD`, `OAUTH`, `SESSION`, `BEARER`, ...

The catalog lint test (`tests/mc/provider-smoke.unit.test.js`) enforces RT-2: no catalog entry with `safe_to_autofix === true` may have a recipe that mutates operator auth state.

### Flags introduced by the smoke

- `--no-autofix` — skip the auto-fix dispatcher entirely (AC-5.3). Smoke still prints remediation.
- `--exit-on-yellow` — treat yellow as a blocking exit (`2`). Default off per β `allow-yellow` directive.
- `--probe list` — deep probe (model registry list) instead of presence-only.
- `--target <root>` — alternate install root (defaults to cwd). Traversal-protected (`..` rejected pre-resolve).

### Append-only boundary

SP-005 owns the preflight / transaction / postflight composition above. SP-002 owns this section plus the orchestrator script, the catalog, the RCA module, and the auto-fix dispatcher. The two are coupled at exactly one seam: `scripts/mc/postflight.js#registerExternalCheck`. No SP-002 code mutates `scripts/mc/update.js`.

## See also

- `scripts/mc/update.js` — the engine.
- `scripts/mc/preflight.js` — 10-gate composer.
- `scripts/mc/transaction.js` — begin / commit / rollback.
- `scripts/mc/postflight.js` — 5-check composer + `registerExternalCheck` primitive.
- `scripts/mc/lib/update-events.js` — TR-1..TR-6 emitter.
- `framework/releases/<version>/release.json` — capsule manifest.
- `migrations/<from>-to-<to>/` — migration scripts run during apply.
- `.claude/project/sprint/sprints/SP-20260513-005/failure-mining.md` — F-1..F-10 evidence catalog.
- `/warp:promote` — the outbound counterpart.
- `/warp:release` — generate a new capsule from current state.
- `/warp:doctor` — verify the install is healthy after update.
