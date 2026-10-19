"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "worktree-audit.js");
const REPORT_REL = path.join(".claude", "runtime", "notes", "worktree-audit.md");

function cleanEnv(ceiling) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(k)) env[k] = v;
  }
  env.GIT_CEILING_DIRECTORIES = ceiling;
  return env;
}

function makeBase() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "worktree-audit-")));
  const repo = path.join(base, "repo");
  const dest = path.join(repo, "scripts", "mc", "worktree-audit.js");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(SCRIPT, dest);
  return { base, repo, script: dest };
}

function git(cwd, base, args) {
  const r = spawnSync(
    "git",
    ["-c", "user.name=worktree-audit-test", "-c", "user.email=worktree-audit-test@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, env: cleanEnv(base), encoding: "utf8" },
  );
  assert.strictEqual(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepo(branch) {
  const ctx = makeBase();
  git(ctx.repo, ctx.base, ["init", "-q"]);
  git(ctx.repo, ctx.base, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  fs.writeFileSync(path.join(ctx.repo, "README.md"), "# fixture\n");
  git(ctx.repo, ctx.base, ["add", "README.md"]);
  git(ctx.repo, ctx.base, ["commit", "-q", "--no-verify", "-m", "fixture"]);
  ctx.linked = path.join(ctx.base, "linked");
  git(ctx.repo, ctx.base, ["worktree", "add", "-q", "-b", "topic", ctx.linked, branch]);
  return ctx;
}

function runAudit(ctx, args = []) {
  return spawnSync(process.execPath, [ctx.script, ...args], { cwd: ctx.repo, env: cleanEnv(ctx.base), encoding: "utf8" });
}

function count(stdout, bucket) {
  const m = stdout.match(new RegExp(`^\\s*${bucket}: (\\d+)\\s*$`, "m"));
  return m ? Number(m[1]) : null;
}

function section(report, bucket) {
  const start = report.indexOf(`## ${bucket} (`);
  if (start < 0) return "";
  const next = report.indexOf("\n## ", start + 1);
  return next < 0 ? report.slice(start) : report.slice(start, next);
}

function withBase(make, fn) {
  const ctx = make();
  try {
    fn(ctx);
  } finally {
    fs.rmSync(ctx.base, { recursive: true, force: true, maxRetries: 5 });
  }
}

test("a directory that is not a git repository: one plain line, no report, exit 0", () => {
  withBase(makeBase, (ctx) => {
    const r = runAudit(ctx);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.match(r.stdout, /nothing to audit/i);
    assert.match(r.stdout, /not inside a git working tree/i);
    assert.strictEqual(r.stdout.trim().split(/\r?\n/).length, 1, `expected one line, got:\n${r.stdout}`);
    assert.doesNotMatch(r.stderr, /TypeError|\n\s+at /);
    assert.ok(!fs.existsSync(path.join(ctx.repo, ".claude", "runtime", "notes")), "no report directory is created");
  });
});

test("a repository with main and no master: a clean worktree whose head is on main is clean-mergeable", () => {
  withBase(() => makeRepo("main"), (ctx) => {
    const r = runAudit(ctx);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.strictEqual(count(r.stdout, "main"), 1, r.stdout);
    assert.strictEqual(count(r.stdout, "clean-mergeable"), 1, r.stdout);
    assert.strictEqual(count(r.stdout, "clean-orphan"), 0, r.stdout);
    assert.match(r.stdout, /Default branch: main\b/);
  });
});

test("the report is written to .claude/runtime/notes/worktree-audit.md and names the default branch", () => {
  withBase(() => makeRepo("main"), (ctx) => {
    const r = runAudit(ctx);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    const file = path.join(ctx.repo, REPORT_REL);
    assert.ok(fs.existsSync(file), `report missing at ${REPORT_REL}`);
    const report = fs.readFileSync(file, "utf8");
    assert.match(report, /Default branch: main\b/);
    assert.match(section(report, "clean-mergeable"), /linked/);
    assert.doesNotMatch(section(report, "clean-orphan"), /linked/);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ["worktree-audit.md"]);
  });
});

test("a repository with master and no main compares against master", () => {
  withBase(() => makeRepo("master"), (ctx) => {
    const r = runAudit(ctx);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.strictEqual(count(r.stdout, "clean-mergeable"), 1, r.stdout);
    assert.strictEqual(count(r.stdout, "clean-orphan"), 0, r.stdout);
    assert.match(r.stdout, /Default branch: master\b/);
  });
});

function corruptLinkedIndex(ctx) {
  const rel = git(ctx.linked, ctx.base, ["rev-parse", "--git-path", "index"]);
  const indexFile = path.resolve(ctx.linked, rel);
  assert.ok(fs.existsSync(indexFile), `linked worktree index missing at ${indexFile}`);
  fs.writeFileSync(indexFile, "this file is not a git index; git status must fail on it\n");
  const st = spawnSync("git", ["status", "--porcelain"], { cwd: ctx.linked, env: cleanEnv(ctx.base), encoding: "utf8" });
  assert.notStrictEqual(st.status, 0, `precondition: git status should fail in the linked worktree\n${st.stdout}`);
}

test("a linked worktree whose git status fails is dirty-product (frozen), never a clean bucket", () => {
  withBase(() => makeRepo("main"), (ctx) => {
    corruptLinkedIndex(ctx);
    const r = runAudit(ctx);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.strictEqual(count(r.stdout, "dirty-product"), 1, r.stdout);
    assert.strictEqual(count(r.stdout, "clean-mergeable"), 0, r.stdout);
    assert.strictEqual(count(r.stdout, "clean-orphan"), 0, r.stdout);
    assert.strictEqual(count(r.stdout, "dirty-runtime-only"), 0, r.stdout);
    const report = fs.readFileSync(path.join(ctx.repo, REPORT_REL), "utf8");
    const frozen = section(report, "dirty-product");
    assert.match(frozen, /linked/);
    assert.match(frozen, /status could not be read/);
    assert.doesNotMatch(section(report, "clean-mergeable"), /linked/);
    assert.doesNotMatch(section(report, "clean-orphan"), /linked/);
  });
});

test("with neither main nor master, the root checkout's HEAD commit is the comparison point", () => {
  withBase(() => makeRepo("trunk"), (ctx) => {
    const r = runAudit(ctx);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.strictEqual(count(r.stdout, "clean-mergeable"), 1, r.stdout);
    assert.strictEqual(count(r.stdout, "clean-orphan"), 0, r.stdout);
    assert.match(r.stdout, /Default branch: none \(no main or master\); compared against HEAD [0-9a-f]{8}/);
  });
});

function addDetachedWithOwnCommit(ctx) {
  const wt = path.join(ctx.base, "wt-detached-work");
  git(ctx.repo, ctx.base, ["worktree", "add", "-q", "--detach", wt, "main"]);
  fs.writeFileSync(path.join(wt, "work.txt"), "a commit only this worktree's HEAD holds\n");
  git(wt, ctx.base, ["add", "work.txt"]);
  git(wt, ctx.base, ["commit", "-q", "--no-verify", "-m", "detached work"]);
  const sha = git(wt, ctx.base, ["rev-parse", "HEAD"]);
  assert.strictEqual(git(ctx.repo, ctx.base, ["for-each-ref", "--contains", sha]), "", "precondition: no ref contains the detached commit");
  return { wt, sha };
}

const REMOVABLE_BUCKETS = ["missing-dir", "clean-mergeable", "clean-orphan", "dirty-runtime-only"];

test("plan: a detached worktree whose commit no ref contains is detached-unreferenced, never a removable bucket", () => {
  withBase(() => makeRepo("main"), (ctx) => {
    addDetachedWithOwnCommit(ctx);
    const r = runAudit(ctx);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.strictEqual(count(r.stdout, "detached-unreferenced"), 1, r.stdout);
    assert.strictEqual(count(r.stdout, "clean-orphan"), 0, r.stdout);
    const report = fs.readFileSync(path.join(ctx.repo, REPORT_REL), "utf8");
    assert.match(section(report, "detached-unreferenced"), /wt-detached-work/);
    for (const bucket of REMOVABLE_BUCKETS) assert.doesNotMatch(section(report, bucket), /wt-detached-work/, bucket);
  });
});

test("--apply: a detached worktree whose commit no ref contains keeps its directory and its commit", () => {
  withBase(() => makeRepo("main"), (ctx) => {
    const { wt, sha } = addDetachedWithOwnCommit(ctx);
    const r = runAudit(ctx, ["--apply"]);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(wt, "work.txt")), `worktree directory removed\n${r.stdout}`);
    assert.strictEqual(git(wt, ctx.base, ["rev-parse", "HEAD"]), sha, "the worktree still holds its commit");
    assert.ok(git(ctx.repo, ctx.base, ["worktree", "list", "--porcelain"]).includes(`HEAD ${sha}`), "the worktree is still registered");
    assert.match(r.stdout, /^\s*Refused:\s+1\b/m, r.stdout);
    assert.match(r.stdout, /wt-detached-work/, r.stdout);
  });
});

test("--apply: a registered worktree whose directory is gone and whose detached commit no ref contains is not pruned", () => {
  withBase(() => makeRepo("main"), (ctx) => {
    const { wt, sha } = addDetachedWithOwnCommit(ctx);
    fs.rmSync(wt, { recursive: true, force: true, maxRetries: 5 });
    const plan = runAudit(ctx);
    assert.strictEqual(plan.status, 0, `exit ${plan.status}\n${plan.stderr}`);
    assert.strictEqual(count(plan.stdout, "detached-unreferenced"), 1, plan.stdout);
    assert.strictEqual(count(plan.stdout, "missing-dir"), 0, plan.stdout);
    const r = runAudit(ctx, ["--apply"]);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.ok(git(ctx.repo, ctx.base, ["worktree", "list", "--porcelain"]).includes(`HEAD ${sha}`), `the worktree entry holding the commit was pruned\n${r.stdout}`);
  });
});

function makeRepoWithClaudeDir() {
  const ctx = makeBase();
  git(ctx.repo, ctx.base, ["init", "-q"]);
  git(ctx.repo, ctx.base, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  fs.writeFileSync(path.join(ctx.repo, "README.md"), "# fixture\n");
  fs.mkdirSync(path.join(ctx.repo, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(ctx.repo, ".claude", "settings.json"), "{}\n");
  git(ctx.repo, ctx.base, ["add", "README.md", ".claude/settings.json"]);
  git(ctx.repo, ctx.base, ["commit", "-q", "--no-verify", "-m", "fixture"]);
  return ctx;
}

function addBranchWorktree(ctx, name) {
  const wt = path.join(ctx.base, name);
  git(ctx.repo, ctx.base, ["worktree", "add", "-q", "-b", name, wt, "main"]);
  return wt;
}

function writeIn(wt, rel, body) {
  const file = path.join(wt, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

test("uncommitted user files under .claude/ (an agent, a command, settings) make a worktree dirty-product, and --apply keeps it", () => {
  withBase(makeRepoWithClaudeDir, (ctx) => {
    const files = [
      writeIn(addBranchWorktree(ctx, "wt-agent"), ".claude/agents/my-agent.md", "# my agent\n"),
      writeIn(addBranchWorktree(ctx, "wt-command"), ".claude/commands/x/y.md", "# my command\n"),
      writeIn(addBranchWorktree(ctx, "wt-settings"), ".claude/settings.json", '{ "mine": true }\n'),
    ];
    const plan = runAudit(ctx);
    assert.strictEqual(plan.status, 0, `exit ${plan.status}\n${plan.stderr}`);
    assert.strictEqual(count(plan.stdout, "dirty-product"), 3, plan.stdout);
    assert.strictEqual(count(plan.stdout, "dirty-runtime-only"), 0, plan.stdout);
    const report = fs.readFileSync(path.join(ctx.repo, REPORT_REL), "utf8");
    for (const name of ["wt-agent", "wt-command", "wt-settings"]) {
      assert.match(section(report, "dirty-product"), new RegExp(name));
      assert.doesNotMatch(section(report, "dirty-runtime-only"), new RegExp(name));
    }
    const r = runAudit(ctx, ["--apply"]);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    for (const file of files) assert.ok(fs.existsSync(file), `${file} was removed\n${r.stdout}`);
  });
});

test("control: a worktree whose only change is under .claude/runtime/ is still dirty-runtime-only and --apply removes it", () => {
  withBase(makeRepoWithClaudeDir, (ctx) => {
    const wt = addBranchWorktree(ctx, "wt-runtime");
    writeIn(wt, ".claude/runtime/notes/scratch.md", "runtime note\n");
    const plan = runAudit(ctx);
    assert.strictEqual(plan.status, 0, `exit ${plan.status}\n${plan.stderr}`);
    assert.strictEqual(count(plan.stdout, "dirty-runtime-only"), 1, plan.stdout);
    assert.strictEqual(count(plan.stdout, "dirty-product"), 0, plan.stdout);
    const r = runAudit(ctx, ["--apply"]);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.ok(!fs.existsSync(wt), `dirty-runtime-only worktree kept\n${r.stdout}`);
  });
});

test("control: a detached worktree whose commit an annotated tag contains stays clean-orphan", () => {
  withBase(() => makeRepo("main"), (ctx) => {
    const { sha } = addDetachedWithOwnCommit(ctx);
    git(ctx.repo, ctx.base, ["tag", "-a", "keep-detached-work", "-m", "keep", sha]);
    const r = runAudit(ctx);
    assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.stderr}`);
    assert.strictEqual(count(r.stdout, "detached-unreferenced"), 0, r.stdout);
    assert.strictEqual(count(r.stdout, "clean-orphan"), 1, r.stdout);
  });
});
