"use strict";
/**
 * main-write-broker-completeness.test.js — BITE TEST for the flip-trigger enforcer
 * (SP-20260721-001 D-4 INC-1, unit SEC-1).
 *
 * THE POINT (β's gauntlet built-artifact check): an enforcer that cannot be PROVEN to catch the shapes it
 * claims to catch is a false-green generator. The two shapes that matter most are pinned here:
 *   1. A planted RAW main-commit in a JS script (the obvious shape).
 *   2. A planted `$DEFAULT`-VARIABLE, MARKDOWN-INLINE-CODE, NUMBERED-LIST-STEP merge — the exact
 *      commit/land.md:33 shape (`git merge --no-ff $BRANCH` while on `$DEFAULT` from a prior checkout).
 *      This is the FOLD-1 case a naive recognizer misses, giving a FALSE GREEN on a flagship writer.
 * Plus the inverse (a migrated caller passes) so the enforcer is not a constant-RED stub, and the
 * conservative/precision boundaries.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const enforcer = require("./main-write-broker-completeness.js");
const { scan, classifyFile, isLocalWrite, selectsMain } = enforcer;

/** Build a throwaway repo-shaped tree with the two scan roots, write `files`, and scan it. */
function scanFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mwbc-"));
  fs.mkdirSync(path.join(dir, ".claude", "commands"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const res = scan(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

const relOf = (res) => res.violations.map((v) => v.rel);

// ── 1. THE FOLD-1 CASE: a $DEFAULT-variable markdown-inline-code numbered-list merge ────────────────────

test("FOLD 1 — a planted $DEFAULT-variable MARKDOWN INLINE-CODE numbered-list merge (the commit/land.md:33 shape) REDs", () => {
  // Mirrors commit/land.md Step 4 exactly: a prior checkout of `$DEFAULT`, then a numbered list step whose
  // merge lives in an INLINE-CODE span with a VARIABLE branch ref. There is NO literal `refs/heads/main`
  // anywhere, and NO fenced code block — the shapes a naive recognizer keys on.
  const skill = [
    "---",
    "description: Land the working branch to the default branch.",
    "---",
    "",
    "### Step 2 — Resolve the default branch",
    "Call it `$DEFAULT`. Record the current branch as `$BRANCH`.",
    "",
    "### Step 4 — Merge into the default branch",
    "1. `git checkout $DEFAULT` then `git pull --ff-only origin $DEFAULT` to sync.",
    "2. Merge `$BRANCH`: prefer fast-forward; if a FF isn't possible, `git merge --no-ff $BRANCH` with a clear merge message.",
    "3. Push it.",
    "",
  ].join("\n");

  const res = scanFixture({ ".claude/commands/planted/land.md": skill });

  assert.ok(
    relOf(res).includes(".claude/commands/planted/land.md"),
    "MUST RED: the $DEFAULT-variable markdown-inline-code merge must be recognized as an un-brokered main-write",
  );
  assert.strictEqual(res.ok, false, "the enforcer must NOT be green with a planted un-brokered markdown writer");

  const v = res.violations.find((x) => x.rel === ".claude/commands/planted/land.md");
  assert.ok(
    v.writes.some((w) => /git merge --no-ff \$BRANCH/.test(w.text)),
    "the recognized write site must be the inline-code merge line itself (line 10), proving inline-code awareness",
  );
  assert.ok(
    v.mainLines.some((m) => /\$DEFAULT/.test(m.text)),
    "the main-selection evidence must be the $DEFAULT variable ref, proving variable-ref awareness",
  );
});

test("FOLD 1 — the naive-recognizer traps are each individually defeated", () => {
  // (i) NO literal refs/heads/main token anywhere.
  const noLiteral = "Sync `$DEFAULT`.\n1. `git checkout $DEFAULT`\n2. `git merge --no-ff $BRANCH`\n";
  assert.ok(relOf(scanFixture({ ".claude/commands/a/x.md": noLiteral })).length === 1, "a variable-only main ref must still RED");

  // (ii) NO fenced code block — the write is inline-code inside a numbered list.
  assert.ok(!noLiteral.includes("```"), "fixture must genuinely contain no fenced block");

  // (iii) NOT a JS call-site — it is pure markdown.
  assert.ok(isLocalWrite("2. Merge it: `git merge --no-ff $BRANCH` now.", true), "markdown inline-code merge is a write");
  assert.ok(selectsMain("1. `git checkout $DEFAULT` then `git pull --ff-only origin $DEFAULT`"), "$DEFAULT selects main");
});

test("FOLD 1 — the PROSE tier catches a main-write described with no `git` token at all (warp/release.md stage-9 shape)", () => {
  const md = ["# Release", "", "| 9 | merge-to-main-and-push | ff-merge to main + push origin main |", ""].join("\n");
  assert.ok(relOf(scanFixture({ ".claude/commands/w/release.md": md })).includes(".claude/commands/w/release.md"), "a `ff-merge to main` table row must RED even with no git idiom");
});

// ── 2. THE RAW CASE: a plain main-commit in a script ────────────────────────────────────────────────────

test("a planted RAW main-commit script REDs", () => {
  const js = [
    '"use strict";',
    'const { execSync } = require("child_process");',
    'execSync("git checkout main");',
    'execSync("git commit -m bookkeeping");',
    "",
  ].join("\n");
  const res = scanFixture({ "scripts/planted/regen.js": js });
  assert.ok(relOf(res).includes("scripts/planted/regen.js"), "MUST RED: a raw `git commit` on main is an un-brokered writer");
});

test("a planted raw `git update-ref refs/heads/main` args-array write REDs", () => {
  const js = ['spawnSync("git", ["update-ref", "refs/heads/main", newHead]);', ""].join("\n");
  const res = scanFixture({ "scripts/planted/cas.js": js });
  assert.ok(relOf(res).includes("scripts/planted/cas.js"), "MUST RED: a direct update-ref on refs/heads/main");
});

// ── 3. THE INVERSE: not a constant-RED stub ─────────────────────────────────────────────────────────────

test("a MIGRATED caller (routes through a brokered entrypoint, no raw write site) PASSES", () => {
  const js = [
    '"use strict";',
    'const ctl = require("../dispatch/trusted-controller.js");',
    "// Lands the sprint branch onto refs/heads/main through the broker — no raw git write here.",
    'const r = ctl.integrateBranchMerge({ merge_commit: sha, target_ref: "refs/heads/main" }, opts);',
    "",
  ].join("\n");
  const res = scanFixture({ "scripts/planted/migrated.js": js });
  assert.deepStrictEqual(relOf(res), [], "a caller that routes through integrateBranchMerge with no raw write must be clean");
  assert.strictEqual(res.ok, true, "the enforcer must be able to reach GREEN — it is not a constant-RED stub");
});

test("an empty tree is GREEN (the enforcer can reach its flip-trigger state)", () => {
  const res = scanFixture({ "scripts/planted/readme.md": "# nothing to see\n" });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.violations.length, 0);
});

test("a file that writes but never selects main is CLEAN (no false positive on ordinary branch work)", () => {
  const js = ['execSync("git checkout -b feature/x");', 'execSync("git commit -m work");', ""].join("\n");
  assert.deepStrictEqual(relOf(scanFixture({ "scripts/planted/feature.js": js })), [], "ordinary feature-branch commits must not trip the enforcer");
});

test("PRECISION — English prose containing the words 'git' and 'commit' in a sentence is NOT a write", () => {
  assert.ok(!isLocalWrite(" * git-head.js — resolve the current commit SHA by READING .git directly.", false), "a JS doc sentence must not match TIER A");
  assert.ok(!isLocalWrite("git merge-base A B", false), "merge-base is read-only plumbing");
  assert.ok(!isLocalWrite('const r = gitRead(["merge-base", a, b]);', false), "a merge-base args array is read-only");
});

// ── 4. PARTIAL MIGRATION stays RED (the subtle regression) ──────────────────────────────────────────────

test("a PARTIALLY migrated caller (calls the broker but KEEPS a raw main write) stays RED", () => {
  const js = [
    'const ctl = require("../dispatch/trusted-controller.js");',
    'ctl.integrateReleaseCommit({ release_commit: sha, target_ref: "refs/heads/main" }, opts);',
    "// ...but the old path was never deleted:",
    'execSync("git checkout main && git merge --ff-only " + branch);',
    "",
  ].join("\n");
  const res = scanFixture({ "scripts/planted/partial.js": js });
  assert.ok(
    relOf(res).includes("scripts/planted/partial.js"),
    "MUST RED: a broker call does NOT launder a surviving raw write site — partial migration is not migration",
  );
});

// ── 5. FAIL-CLOSED + allowlist discipline ───────────────────────────────────────────────────────────────

test("the ALLOWLIST is frozen, and every entry carries a kind + a non-trivial reason", () => {
  assert.ok(Object.isFrozen(enforcer.ALLOWLIST), "the allowlist must be frozen (a reviewed code diff, not a settable table)");
  for (const [rel, e] of Object.entries(enforcer.ALLOWLIST)) {
    assert.ok(e.kind && typeof e.kind === "string", `${rel}: allowlist entry needs a kind`);
    assert.ok(e.reason && e.reason.length > 40, `${rel}: allowlist entry needs a substantive reason (got: ${e.reason})`);
  }
});

test("an UNREADABLE in-scope file is FAIL-CLOSED (never silently clean)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mwbc-unreadable-"));
  const abs = path.join(dir, "scripts", "gone.js");
  const c = classifyFile(abs, dir); // never created -> unreadable
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(c.status, "UNBROKERED", "an unreadable in-scope file must fail closed, not read clean");
  assert.match(c.reason, /unreadable/);
});

// ── 6. LIVE REPO — the census state this enforcer was built to report ───────────────────────────────────

// Ceremony step 1 (SP-20260721-001 D-4 INC-1) landed: #2 release-canonical.js is MIGRATED (stages 8-9
// route the only main-write through brokerMerge()/integrateBranchMerge, plumbing-built, zero raw
// commit/merge/update-ref call-sites left in the file) and #4 commit/land.md is ALLOWLISTED (guidance doc,
// its brokered-aware rewrite is a named follow-up, not this step). The two flagship writers this enforcer
// was built to catch are still individually asserted below — what changed is the DISPOSITION, not whether
// the recognizer sees them. This is the FIRST-GREEN the flip-trigger exists to report.
test("LIVE — the flip-trigger is GREEN, and the two flagship writers are handled (not silently dropped)", () => {
  const res = scan();
  assert.strictEqual(res.ok, true, "post-ceremony-step-1 the flip-trigger must be GREEN — zero un-brokered main-writers remain");
  assert.deepStrictEqual(relOf(res), [], "no violations may remain");

  // #4 commit/land.md — ALLOWLISTED (doc-prose guidance, not an executable call-site), not silently "clean".
  const land = res.allowlisted.find((a) => a.rel === ".claude/commands/commit/land.md");
  assert.ok(land, "#4 commit/land.md must still be recognized by FOLD 1 and be visible as an ALLOWLIST decision, not vanish");
  assert.strictEqual(land.status, "doc-prose");

  // #2 release-canonical.js — every raw commit/merge/update-ref call-site is gone (migrated to the brokered
  // transport); classifyFile therefore reports it writes.length===0. It still SELECTS main (mainLines>0),
  // proving the recognizer still sees the file — it is genuinely clean, not a false negative.
  const relCanon = classifyFile(path.resolve("scripts/mc/release-canonical.js"), process.cwd());
  assert.strictEqual(relCanon.writes.length, 0, "#2 release-canonical.js must have ZERO raw write call-sites left");
  assert.ok(relCanon.mainLines.length > 0, "#2 release-canonical.js must still be recognized as main-selecting (not a scan miss)");
  assert.match(
    fs.readFileSync(path.resolve("scripts/mc/release-canonical.js"), "utf8"),
    /integrateBranchMerge/,
    "#2 release-canonical.js must document routing through integrateBranchMerge (the brokered transport)",
  );
});
