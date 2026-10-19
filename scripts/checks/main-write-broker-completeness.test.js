"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const enforcer = require("./main-write-broker-completeness.js");
const { scan, classifyFile, isLocalWrite, selectsMain } = enforcer;

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

test("a planted $DEFAULT-variable MARKDOWN INLINE-CODE numbered-list merge (the un-brokered land-step shape) REDs", () => {
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

test("the naive-recognizer traps are each individually defeated", () => {
  const noLiteral = "Sync `$DEFAULT`.\n1. `git checkout $DEFAULT`\n2. `git merge --no-ff $BRANCH`\n";
  assert.ok(relOf(scanFixture({ ".claude/commands/a/x.md": noLiteral })).length === 1, "a variable-only main ref must still RED");

  assert.ok(!noLiteral.includes("```"), "fixture must genuinely contain no fenced block");

  assert.ok(isLocalWrite("2. Merge it: `git merge --no-ff $BRANCH` now.", true), "markdown inline-code merge is a write");
  assert.ok(selectsMain("1. `git checkout $DEFAULT` then `git pull --ff-only origin $DEFAULT`"), "$DEFAULT selects main");
});

test("the PROSE tier catches a main-write described with no `git` token at all (the mc/release.md stage-9 row shape)", () => {
  const md = ["# Release", "", "| 9 | merge-to-main-and-push | ff-merge to main + push origin main |", ""].join("\n");
  assert.ok(relOf(scanFixture({ ".claude/commands/w/release.md": md })).includes(".claude/commands/w/release.md"), "a `ff-merge to main` table row must RED even with no git idiom");
});

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
  const c = classifyFile(abs, dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(c.status, "UNBROKERED", "an unreadable in-scope file must fail closed, not read clean");
  assert.match(c.reason, /unreadable/);
});

test("LIVE — the flip-trigger is GREEN, and the two flagship writers are handled (not silently dropped)", () => {
  const res = scan();
  assert.strictEqual(res.ok, true, "the flip-trigger must be GREEN — zero un-brokered main-writers remain");
  assert.deepStrictEqual(relOf(res), [], "no violations may remain");

  const land = res.allowlisted.find((a) => a.rel === ".claude/commands/commit/land.md");
  assert.ok(land, "commit/land.md must still be recognized and be visible as an ALLOWLIST decision, not vanish");
  assert.strictEqual(land.status, "doc-prose");

  const relCanon = classifyFile(path.resolve("scripts/mc/release-canonical.js"), process.cwd());
  assert.strictEqual(relCanon.writes.length, 0, "release-canonical.js must have ZERO raw write call-sites left");
  assert.ok(relCanon.mainLines.length > 0, "release-canonical.js must still be recognized as main-selecting (not a scan miss)");
  assert.match(
    fs.readFileSync(path.resolve("scripts/mc/release-canonical.js"), "utf8"),
    /integrateBranchMerge/,
    "release-canonical.js must document routing through integrateBranchMerge (the brokered transport)",
  );
});
