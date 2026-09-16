# BUILD BRIEF — S-OS-06 r4, lane I5: DIAGNOSE the shared fixture cause before editing anything

WORKTREE: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-s2i-capture`
**RESUME on branch `s-os-06/s2i-capture`.** Your previous dispatch reported honestly and is not being redone.

## The ruling that scopes you

**β verdict `a5e2c418-7b93-4f06-ad51-6e80b7f4c29d`, DECIDE, Class B.** It resolves the I11 scope question
your predecessor correctly refused to answer:

> The eight falsifier failures are **NOT eight authorized contract changes.** The signature — only the
> non-spawning case passes, and every case that reaches the runner dies — is a **SHARED FIXTURE defect**,
> not eight independent reversals.

So: **diagnose the shared cause FIRST. Do not edit eight assertions.** Your licence to edit assertions has
been explicitly removed.

## Facts the conductor verified before writing this — rely on them, but re-check if cheap

- `tests/regression/S-OS-06/falsify-quarantine-runner.test.js` has **9 cases**. Case **(b)** is at L114.
  The ninth, at **L186**, asserts the real register is never touched — it **never spawns the runner**, and
  it is the only one passing.
- Helpers: **`entry(file, over)` at L46** and **`withRepo(files, quarantine, fn)` at L60.**
- `tests/quarantine.json` has **23 entries, and all 23 carry `filedUnder`, `expiry` and `expiryVersion`.**

## Your work, in order

**1. Write `runtime/S-OS-06/r4/s2i3/LANE-I5-REPORT.md` as a stub and COMMIT it first.** A committed report
survives a reap. Your predecessor's first dispatch lost its entire report to a 0-byte stdout.

**2. DIAGNOSE the shared cause. Change nothing yet.**
β's hypothesis, which you should test rather than assume: the helper builds a register that the rewritten
runner **rejects at validation** — a missing freeze-controlled base field, a missing per-entry expiry, or the
new capture format. Find the actual cause. If the cause is not in the helper, say so.

**3. Fix the shared cause, preferring the edit that leaves ASSERTIONS byte-unchanged and touches only
fixture construction** (β row 473 condition (a)). Then **re-run and report what remains.**

**4. Whatever still fails after the helper fix gets its OWN treatment.** Per case: a discriminator that
separates a real defect from a stale assumption, and its own authorization. **Do NOT fold anything into case
(b)'s clearance** — row 473 cleared (b) BY NAME ONLY; (a) and (c) through (h) are NOT cleared. If a case
needs an assertion change, STOP and report it as needing authorization. Do not make it.

**5. Cases (f) cause-lock, (g) empty-subject floor, and (h) per-entry version expiry are β's OWN falsifiers.**
Each needs **red-then-green demonstrated INDIVIDUALLY**. A suite that goes green as a whole does not
discharge them, and absorbing them into a suite green is explicitly refused.

## β recorded a PREDICTION so that measurement can contradict it

> One helper defect explains **seven of the eight**; only (b) is a genuine contract flip.

β flagged this as read from code in its own self-declared miscalibrated domain. **Contradicting it is a
valid and valuable result.** Report what you measure, not what was predicted. If the split is 5/3, or if the
helper explains all eight, or none, say that.

## Out of scope — do not touch

- **The ambient-environment question from your predecessor's F3 finding.** β has NOT yet ruled on the
  remedy (hermetic child env vs a declared ceiling vs a controlled capture env). Do not implement any of
  them, and do not re-capture the register.
- `.github/workflows/**`, manifest regeneration, `.claude/settings.json`, `partition-loader.js`.
- Any assertion edit without per-case authorization.

## TIME BOX — 18 minutes

The wrapper hard-kills at 20 minutes no matter what a brief says. Budget to ALWAYS emit your report.
Commit incrementally. Mark anything unreached `cannot-assess` and name it.

## Report

The shared cause, named and evidenced. What you changed (fixture construction only). The re-run result, per
case. What still fails and what each survivor needs. Whether β's seven-of-eight prediction held, and the
real split. Anything you refused.

**If a premise here is false, prove it and STOP.**
