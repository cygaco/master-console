# S-OS-06 r4 — STALE PLANT fix (AC-2.4, negative-fixtures.test.js) — REPORT

**Verdict: FIXED (test-side only). Enforcer untouched. Handed to the reviewer, not self-certified.**
Dispatch: backend-fixer, α ruling R-110 ("fix the STALE FIXTURE, not the enforcer, not a quarantine").
Branch `s-os-06/r4-contract-fix`, based on `3d9f88b9`.

## 1. Registry measurement (measured, not assumed)

`stale-plant-registry-measure.txt` records every role with its provider and its class as `classForRole` derives it.

- **35 roles** in the registry today. The brief said 36; the count on disk is 35.
- `cross_provider_reviewer` has **exactly 1 live member**: `security-reviewer` (provider `antigravity`).
- `claude_pinned_reviewer` has 6: qa-reviewer, design-quality, visual-review, frontend-reviewer, backend-reviewer, security_claude_hunter.
- Enforcer probe: `validateDispatch({role:"security-reviewer", shape:"in-process-agent"})` → `ok:false`, reason "shape 'in-process-agent' is FORBIDDEN for role 'security-reviewer' (class cross_provider_reviewer)". `qa-reviewer` with the same shape → `ok:true` (class claude_pinned_reviewer).

The property has a live subject, so there was no reason to stop. Watch-point: that subject is **one role**. If an operator re-pins `security-reviewer` to claude, the new `assert.ok` fails loudly. That is intended; it should not be read as a flake.

## 2. The corrected plant, and where its subject comes from

The shape comes from `07a20846`'s `dispatch-contract.test.js` and `dispatch-claude.test.js` siblings:

```js
const XP_REVIEWER = Object.keys(loadRegistry().roles || {})
  .find((r) => classForRole(r) === "cross_provider_reviewer");
assert.ok(XP_REVIEWER, "registry has no cross_provider_reviewer role — the AC-2.4 diversity refusal has no subject");
const XP_PROVIDER = loadRegistry().roles[XP_REVIEWER].provider;
assert.ok(XP_PROVIDER && XP_PROVIDER !== "claude", `cross_provider_reviewer '${XP_REVIEWER}' must carry a non-claude provider (got ${XP_PROVIDER})`);
h.violation(`AC-2.4 forbidden_shape: cross-provider reviewer (${XP_REVIEWER}) via in-process-agent is REFUSED as a FORBIDDEN shape (kills diversity)`, () => {
  const r = validateDispatch({ role: XP_REVIEWER, shape: "in-process-agent" });
  const forbidden = `shape 'in-process-agent' is FORBIDDEN for role '${XP_REVIEWER}'`;
  return { violations: (r.violations || []).filter((v) => v.includes(forbidden)) };
});
```

The subject comes from `loadRegistry()` plus `classForRole()`, the enforcer's own exports, and no role name is hardcoded. The non-claude provider guard is the one the `dispatch-claude.test.js` sibling uses.

### I went one step past the sibling shape, because the neuter showed the sibling shape passes vacuously

I first wrote the plant exactly like the sibling: a bare `h.violation(() => validateDispatch(...))`. Then I neutered **only the `forbidden_shapes` refusal** (N1). The plant stayed **GREEN 9/9** (exit 0), in `neuter/A-N1-sibling-shape-plant-VACUOUS-green.txt`.

Why: `in-process-agent` is also missing from `cross_provider_reviewer`'s `allowed_shapes`. With the forbidden branch gone, the `else if (!allowed.includes(shape))` fallback still refuses, and `h.violation` counts **any** refusal. That fallback is the AC-2.1 api-when-CLI branch. So a bare AC-2.4 never tested its own refusal class (forbidden_shape), which is exactly the vacuous-pass defect this round is chasing. The final plant counts **only** the FORBIDDEN-shape violation for that role. This follows a pattern already in the file: AC-2.5b matches on the refusal text in stderr.

**Note for the reviewer (not fixed, out of scope):** `dispatch-contract.test.js:95` has the same bare `h.violation` on the same input, and it is vacuous in the same way. **Measured:** with N1 applied, that suite still passes **22/22, exit 0** (`neuter/D-N1-sibling-dispatch-contract-test.txt`). I did not touch it; the brief puts that file out of scope and says it must stay green.

## 3. Neuter RED / restored GREEN

**Method:** the neuter never touches the enforcer on disk. `neuter/neuter-preload.cjs` is loaded through `NODE_OPTIONS=--require`. When `scripts/dispatch/dispatch-contract.js` is required, it reads the file, makes a neutered copy in memory (also written to `os.tmpdir()/dispatch-contract.neutered-<N>.js` for inspection), and compiles that copy under the real filename. Each edit anchor must match exactly once or the preload throws.

That guard fired on the first attempt: the bare anchor also matched the look-alike branch in `validateDispatchForClass`. The anchors now include comment lines that exist only in `validateDispatch`. Each run prints `[neuter-preload] N<k> applied to in-memory copy of …dispatch-contract.js`. The extra "NOT APPLIED" line in each capture comes from the `node --test` parent runner process, which never loads the enforcer.

Every run below uses the **final** plant and `node --test tests/regression/SP-20260627-001/negative-fixtures.test.js`:

| Run | What is neutered | Exit | Result | Capture |
|---|---|---|---|---|
| B-N1 | only the forbidden_shapes refusal | **1** | 8/9, **AC-2.4 FAILED** ("but it PASSED ({"violations":[]})") | `neuter/B-N1-forbidden-refusal-neutered.txt` |
| B-N2 | forbidden_shapes + not-in-allowed_shapes | **1** | 7/9, AC-2.1 + **AC-2.4 FAILED** | `neuter/B-N2-all-shape-refusals-neutered.txt` |
| B-N3 (control) | only the not-in-allowed_shapes fallback | **0** | 9/9 | `neuter/B-N3-control-fallback-only-neutered.txt` |
| C restored | nothing (real enforcer) | **0** | 9/9 (7 planted-violation assertions) | `neuter/C-restored-green.txt` |

AC-2.4 now goes RED exactly when the forbidden-shape refusal is neutered, and not when only the fallback is. B-N1 was re-run on the final file (after a comment-only edit) and was still exit 1, 8/9.

For comparison, the sibling-shape plant: A-N1 exit **0** (vacuous) and A-N2 exit 1 (`neuter/A-N*.txt`).

**The enforcer file is untouched:** sha256 `f4d238b923a7cead1bc518c972523841f8bf440b8b047742c04c19c84e457e7b` before (`neuter/enforcer-sha-before.txt`), after (`neuter/enforcer-sha-after.txt`), and again after the final run. `git status scripts/` is clean, and `git diff 3d9f88b9 --stat` touches no file under `scripts/`.

## 4. The stale assertion is gone, not disabled

- The old `h.violation("AC-2.4 … (qa-reviewer) …", () => validateDispatch({ role: "qa-reviewer", … }))` lines are deleted in the diff. Nothing was commented out, skipped or renamed.
- `grep -n "qa-reviewer" tests/regression/SP-20260627-001/negative-fixtures.test.js` → exit 1 (no match).
- Pre-fix capture of the stale red: `stale-plant-before.txt`. The stale plant expected qa-reviewer to be refused and got `ok:true` with class claude_pinned_reviewer, exit 1.

## 5. Verification — each run as its own command, real exit codes

| # | Command | Exit | Numbers | Capture |
|---|---|---|---|---|
| v1 | `node --test tests/regression/SP-20260627-001/negative-fixtures.test.js` | **0** | 9/9 fixture assertions (7 planted-violation); node: tests 1 / pass 1 / fail 0 | `stale-plant-v1-negative-fixtures.txt` |
| v2 | `node --test scripts/dispatch/dispatch-contract.test.js` | **0** | 22/22 (11 planted-violation); tests 1 / pass 1 / fail 0 | `stale-plant-v2-dispatch-contract.txt` |
| v3 | `node --test scripts/dispatch/dispatch-shape.test.js` | **0** | 32/32 (12 planted/mismatch); tests 1 / pass 1 / fail 0 | `stale-plant-v3-dispatch-shape.txt` |
| v4 | `node scripts/checks/framework-purity.js` | **0** | `result: OK (exit 0)`; 236 output lines | `stale-plant-v4-framework-purity.txt` |

About v4: its path listing includes the **previous** dispatch's committed `v3-framework-purity.txt`. That file is an earlier purity output, and purity picks up the token names echoed inside it (e.g. `debitRockets`, `masterResume`). This is informational and does not affect the exit code. My v4 capture holds the same tokens, so it will be listed the same way on the next run. None of the files I added (the test, the preload, the neuter captures) show up in the listing.

## 6. Refused / out of scope

- **Enforcer** (`validateDispatch` and everything it reads): not modified. The hash above proves it.
- **Role registry, the three sibling tests, `.github/workflows/**`, manifest regen, occurrence register, `.claude/settings.json`:** none touched.
- **Did not fix** the matching vacuous bare-`h.violation` at `dispatch-contract.test.js:95`. It was proven vacuous under N1 (section 2 note). It is a sibling file and out of scope, so it is raised for the reviewer/lead.
- **AC-2.1** in this same file still hardcodes `security-reviewer`. It is correct today (still a cross-provider reviewer; it goes RED under N2) but can go stale the same way. I left it alone: the brief scoped this dispatch to the AC-2.4 plant and says not to refactor the surrounding code.
- Worktree path note: the mandatory first action expects `.worktrees/wt-*`, but this dispatch's worktree is `.claude/worktrees/S-OS-06-contract-fix`. The brief names that path explicitly, it is not the main project root, and it is on branch `s-os-06/r4-contract-fix`. So I treated the check as passed and was not in isolation violation.
