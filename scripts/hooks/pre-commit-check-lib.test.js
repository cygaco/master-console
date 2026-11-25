"use strict";
const test = require("node:test");
const assert = require("node:assert");

const { reduceBlockingReasons } = require("./pre-commit-check-lib");
const { TRANSPORT_SKIP_ALLOWED } = require("../dispatch/transport-skip-allowlist");

const REQUIRED = new Set(["false-green-envelope", "no-nul-bytes"]);

test("single-source shape: exactly one frozen name, the pinned reason, shared with the authority", () => {
  assert.deepStrictEqual(
    Object.keys(TRANSPORT_SKIP_ALLOWED),
    ["false-green-envelope"],
    "the skip allowance stays exactly one pinned name",
  );
  assert.strictEqual(TRANSPORT_SKIP_ALLOWED["false-green-envelope"], "no-envelope-in-context");
  assert.ok(Object.isFrozen(TRANSPORT_SKIP_ALLOWED), "allowlist must stay frozen (silent widening = visible diff)");
  const ctl = require("../dispatch/trusted-controller");
  assert.strictEqual(ctl.TRANSPORT_SKIP_ALLOWED, TRANSPORT_SKIP_ALLOWED, "controller re-exports the single source");
});

test("POSITIVE: the exact allowlisted name+reason pair does NOT block", () => {
  const out = reduceBlockingReasons(
    [{ name: "false-green-envelope", status: "skipped", reason: "no-envelope-in-context" }],
    REQUIRED,
  );
  assert.deepStrictEqual(out, [], "the authority-tolerated pair must not block local feedback");
});

test("NEGATIVE: the allowlisted check skipped for any OTHER reason still blocks", () => {
  const out = reduceBlockingReasons(
    [{ name: "false-green-envelope", status: "skipped", reason: "checker-crashed" }],
    REQUIRED,
  );
  assert.strictEqual(out.length, 1, "same name, different reason: must block");
  assert.strictEqual(out[0].name, "false-green-envelope");
});

test("NEGATIVE: any OTHER required check skipped still blocks — even with the allowlisted reason string", () => {
  const out = reduceBlockingReasons(
    [{ name: "no-nul-bytes", status: "skipped", reason: "no-envelope-in-context" }],
    REQUIRED,
  );
  assert.strictEqual(out.length, 1, "different name: must block regardless of reason");
  assert.strictEqual(out[0].name, "no-nul-bytes");
});

test("fail and timeout always block — the alignment touches ONLY the skip branch", () => {
  const out = reduceBlockingReasons(
    [
      { name: "false-green-envelope", status: "fail", reason: "x" },
      { name: "no-nul-bytes", status: "timeout", reason: "y" },
    ],
    REQUIRED,
  );
  assert.strictEqual(out.length, 2, "fail/timeout are never tolerated, allowlisted name or not");
});

test("a skipped OPTIONAL (non-required) check never blocked and still does not", () => {
  const out = reduceBlockingReasons(
    [{ name: "some-optional-check", status: "skipped", reason: "whatever" }],
    REQUIRED,
  );
  assert.deepStrictEqual(out, [], "non-required skips stay non-blocking (pre-existing contract)");
});

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { computeExitCode } = require("./pre-commit-check-lib");

for (const k of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX"]) delete process.env[k];

const NUL_BUF = Buffer.from([0x61, 0x00, 0x62, 0x0a]);

function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precommit-staged-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "clean.js"), "module.exports = 1;\n");
  return dir;
}

function put(dir, rel, content) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}

function add(dir, ...rels) {
  execFileSync("git", ["add", "--", ...rels], { cwd: dir, stdio: "pipe" });
}

function quietExit(opts) {
  const ow = process.stdout.write;
  const ew = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    return computeExitCode(opts);
  } finally {
    process.stdout.write = ow;
    process.stderr.write = ew;
  }
}

test("staged scan: a staged file with a NUL byte under scripts/ blocks (exit 1)", (t) => {
  const dir = tempRepo(t);
  put(dir, "scripts/bad.js", NUL_BUF);
  add(dir, "scripts/clean.js", "scripts/bad.js");
  assert.strictEqual(quietExit({ root: dir }), 1);
});

test("staged scan: the same NUL bytes in an UNSTAGED file only pass (exit 0)", (t) => {
  const dir = tempRepo(t);
  add(dir, "scripts/clean.js");
  put(dir, "scripts/bad.js", NUL_BUF);
  assert.strictEqual(quietExit({ root: dir }), 0);
});

test("staged scan: a symlink turned into a regular file (type change) is scanned (exit 1)", (t) => {
  const dir = tempRepo(t);
  const g = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: dir, stdio: "pipe" }).toString("utf8").trim();
  const linkBlob = g("hash-object", "-w", "scripts/clean.js");
  g("update-index", "--add", "--cacheinfo", `120000,${linkBlob},scripts/linked.js`);
  g("commit", "-q", "--no-verify", "-m", "base");
  put(dir, "scripts/linked.js", NUL_BUF);
  const fileBlob = g("hash-object", "-w", "scripts/linked.js");
  g("update-index", "--cacheinfo", `100644,${fileBlob},scripts/linked.js`);
  assert.strictEqual(g("diff", "--cached", "--name-status"), "T\tscripts/linked.js");
  assert.strictEqual(quietExit({ root: dir }), 1);
});

test("staged scan: a NUL only in a working-tree edit after a clean add passes (index content counts)", (t) => {
  const dir = tempRepo(t);
  put(dir, "scripts/edited.js", "ok\n");
  add(dir, "scripts/edited.js");
  put(dir, "scripts/edited.js", NUL_BUF);
  assert.strictEqual(quietExit({ root: dir }), 0);
});

test("staged scan: the filter is unchanged — NUL under runtime/ or in a .png is not scanned (exit 0)", (t) => {
  const dir = tempRepo(t);
  put(dir, "scripts/runtime/bad.js", NUL_BUF);
  put(dir, ".claude/runtime/bad.json", NUL_BUF);
  put(dir, "scripts/image.png", NUL_BUF);
  put(dir, "other/bad.js", NUL_BUF);
  add(dir, "scripts/runtime/bad.js", ".claude/runtime/bad.json", "scripts/image.png", "other/bad.js");
  assert.strictEqual(quietExit({ root: dir }), 0);
});

test("staged scan: an uppercase extension is still scanned (filter is case-insensitive)", (t) => {
  const dir = tempRepo(t);
  put(dir, ".claude/notes/BAD.MD", NUL_BUF);
  add(dir, ".claude/notes/BAD.MD");
  assert.strictEqual(quietExit({ root: dir }), 1);
});

test("staged scan: nothing staged passes with an empty file list (exit 0, scanned 0)", (t) => {
  const dir = tempRepo(t);
  put(dir, "scripts/bad.js", NUL_BUF);
  let seen;
  const code = quietExit({
    root: dir,
    runCheckLibSuiteFn: (ctx) => {
      seen = ctx.files;
      return { blocked: false, blockingReasons: [] };
    },
  });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(seen, [], "the suite receives an empty staged list, never undefined (full walk)");
});

test("staged scan: git failing (root is not a repo) is a RUNNER ERROR (exit 2), never a pass", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precommit-norepo-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prev = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(dir);
  t.after(() => {
    if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = prev;
  });
  let called = false;
  const code = quietExit({
    root: dir,
    runCheckLibSuiteFn: () => {
      called = true;
      return { blocked: false, blockingReasons: [] };
    },
  });
  assert.strictEqual(code, 2);
  assert.strictEqual(called, false, "no fall back to the suite's full walk when git fails");
});
