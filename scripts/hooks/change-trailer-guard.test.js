"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const GUARD = path.join(__dirname, "change-trailer-guard.js");
const G = require("./change-trailer-guard");
const CT = require("../checks/change-trailer");
const MCENV = require("./lib/mc-env");
const FIXDIR = path.join(ROOT, "fixtures", "hooks", "change-trailer-guard");

const TRAILER = "Change: update\nBlast: minor\nRisks: hooks";

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ctg-${tag}-`));
}

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

function makeRepo({ status = "planning", registry = true } = {}) {
  const root = tmpDir("repo");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "T"]);
  if (registry) {
    const dir = path.join(root, ".claude", "project", "sprint");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "active-sprints.yaml"),
      `schema: mc/sprint/active-sprints/v1\nprimary: S-X-01\nsprints:\n  - id: S-X-01\n    title: live\n    status: ${status}\n    layout: per_sprint_subdir\n`,
    );
  }
  return root;
}

function envFor(project, extra) {
  const e = { ...process.env, CLAUDE_PROJECT_DIR: project };
  MCENV.unsetEnv("CHANGE_TRAILER", e);
  return Object.assign(e, extra || {});
}

function run(payload, { cwd, env, guard = GUARD } = {}) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [guard], {
    cwd,
    input,
    env: envFor(cwd, env),
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

const bash = (command, cwd = ".") => ({ tool_name: "Bash", cwd, tool_input: { command } });

function readEvents(projectDir) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    let ents = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== ".git") walk(p, depth + 1);
      } else if (e.name === "events.jsonl") {
        for (const line of fs.readFileSync(p, "utf8").split("\n")) {
          try {
            if (line.trim()) out.push(JSON.parse(line));
          } catch {
          }
        }
      }
    }
  };
  walk(projectDir, 0);
  return out;
}
const kinds = (root) =>
  readEvents(root)
    .map((e) => e && e.data && e.data.kind)
    .filter(Boolean);

function assertThreeLines(stderr) {
  for (const l of CT.FIX_LINES) assert.ok(stderr.includes(l), `stderr names the line "${l}"; got: ${stderr}`);
}

test("RED: `git commit -m x` under an active sprint is blocked (exit 2) with the three lines", () => {
  const repo = makeRepo();
  const r = run(bash('git commit -m "x"'), { cwd: repo });
  assert.strictEqual(r.status, 2, r.stderr);
  assertThreeLines(r.stderr);
  assert.ok(kinds(repo).includes("change-trailer-guard-blocked"), "the block is logged");
});

test("GREEN: the same commit with the trailer passes", () => {
  const repo = makeRepo();
  assert.strictEqual(run(bash(`git commit -m "x" -m "${TRAILER}"`), { cwd: repo }).status, 0);
  assert.strictEqual(run(bash(`git commit -m "x

${TRAILER}"`), { cwd: repo }).status, 0);
  assert.strictEqual(run(bash(`git commit -m "x" --trailer "Change: update" --trailer "Blast: minor" --trailer "Risks: hooks"`), { cwd: repo }).status, 0, "--trailer flags count");
});

test("an invalid trailer value is blocked and named", () => {
  const repo = makeRepo();
  const r = run(bash('git commit -m "x" -m "Change: feature\nBlast: minor\nRisks: none"'), { cwd: repo });
  assert.strictEqual(r.status, 2);
  assert.ok(/invalid Change "feature"/.test(r.stderr));
});

test("`--amend --no-edit` inherits (not blocked); `--amend -m x` carries a NEW message and is blocked", () => {
  const repo = makeRepo();
  assert.strictEqual(run(bash("git commit --amend --no-edit"), { cwd: repo }).status, 0);
  assert.strictEqual(run(bash("git commit -a --amend --no-edit"), { cwd: repo }).status, 0);
  assert.strictEqual(run(bash("git commit --amend -C HEAD"), { cwd: repo }).status, 0, "-C reuses a message");
  assert.strictEqual(run(bash('git commit --amend -m "new message"'), { cwd: repo }).status, 2);
});

test("heredoc -m form: trailered passes, trailer-less blocks", () => {
  const repo = makeRepo();
  const heredoc = (body) => `git commit -m "$(cat <<'EOF'\n${body}\nEOF\n)"`;
  assert.strictEqual(run(bash(heredoc(`subject\n\nbody (with parens) and "quotes"\n\n${TRAILER}\n\nCo-Authored-By: C <c@example.com>`)), { cwd: repo }).status, 0);
  const bad = run(bash(heredoc("subject\n\nbody only\n\nCo-Authored-By: C <c@example.com>")), { cwd: repo });
  assert.strictEqual(bad.status, 2, bad.stderr);
});

test("-F <file> and -F - <<heredoc> are read", () => {
  const repo = makeRepo();
  const good = path.join(repo, "good.txt");
  const bad = path.join(repo, "bad.txt");
  fs.writeFileSync(good, `s\n\n${TRAILER}\n`);
  fs.writeFileSync(bad, "s\n");
  assert.strictEqual(run(bash(`git commit -F "${good.replace(/\\/g, "/")}"`), { cwd: repo }).status, 0);
  assert.strictEqual(run(bash(`git commit -F "${bad.replace(/\\/g, "/")}"`), { cwd: repo }).status, 2);
  assert.strictEqual(run(bash("git commit -F bad.txt"), { cwd: repo }).status, 2, "relative to the payload cwd");
  assert.strictEqual(run(bash(`git commit -F - <<'EOF'\ns\n\n${TRAILER}\nEOF`), { cwd: repo }).status, 0);
  assert.strictEqual(run(bash("git commit -F - <<'EOF'\ns\nEOF"), { cwd: repo }).status, 2);
});

test("chained commands and `git -C <dir>` are judged against the repo being committed to", () => {
  const repo = makeRepo();
  assert.strictEqual(run(bash('git add -A && git commit -m "x"'), { cwd: repo }).status, 2);
  assert.strictEqual(run(bash(`git add -A && git commit -m "x" -m "${TRAILER}" && git status`), { cwd: repo }).status, 0);
  const elsewhere = tmpDir("elsewhere");
  const target = repo.replace(/\\/g, "/");
  assert.strictEqual(run(bash(`git -C "${target}" commit -m "x"`, elsewhere), { cwd: elsewhere }).status, 2, "the target repo has the live sprint");
  assert.strictEqual(run(bash('git commit -m "x"', elsewhere), { cwd: elsewhere }).status, 0, "cwd is not a repository: nothing to enforce");
});

test("clustered short flags (-am, -qm) are read", () => {
  const repo = makeRepo();
  assert.strictEqual(run(bash('git commit -am "x"'), { cwd: repo }).status, 2);
  assert.strictEqual(run(bash(`git commit -qm "x

${TRAILER}"`), { cwd: repo }).status, 0);
});

test("scope: no live sprint, no registry, non-commit commands and quoted mentions never block", () => {
  const closed = makeRepo({ status: "closed" });
  assert.strictEqual(run(bash('git commit -m "x"'), { cwd: closed }).status, 0, "primary sprint closed");
  const none = makeRepo({ registry: false });
  assert.strictEqual(run(bash('git commit -m "x"'), { cwd: none }).status, 0, "no sprint registry");
  const live = makeRepo();
  for (const c of ['echo "git commit -m x"', "git log --grep commit", "git status", "npm run commit-lint", 'git push origin main']) {
    assert.strictEqual(run(bash(c), { cwd: live }).status, 0, c);
  }
  assert.strictEqual(run({ tool_name: "Edit", tool_input: { file_path: "x" } }, { cwd: live }).status, 0);
});

test("no active sprint, but the STAGED diff touches the tracked surface — trailer still required", () => {
  const none = makeRepo({ registry: false });
  fs.mkdirSync(path.join(none, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(none, "scripts", "x.js"), "module.exports = 1;\n");
  git(none, ["add", "scripts/x.js"]);
  const red = run(bash('git commit -m "x"'), { cwd: none });
  assert.strictEqual(red.status, 2, red.stdout + red.stderr);
  const green = run(bash(`git commit -m "x" -m "${TRAILER}"`), { cwd: none });
  assert.strictEqual(green.status, 0, green.stdout + green.stderr);

  git(none, ["reset"]);
  fs.mkdirSync(path.join(none, "docs"), { recursive: true });
  fs.writeFileSync(path.join(none, "docs", "notes.md"), "hello\n");
  git(none, ["add", "docs/notes.md"]);
  const outside = run(bash('git commit -m "x"'), { cwd: none });
  assert.strictEqual(outside.status, 0, outside.stdout + outside.stderr);

  for (const prefix of [".claude", "framework", "tests"]) {
    const repo = makeRepo({ registry: false });
    fs.mkdirSync(path.join(repo, prefix), { recursive: true });
    fs.writeFileSync(path.join(repo, prefix, "y.txt"), "y\n");
    git(repo, ["add", `${prefix}/y.txt`]);
    const r = run(bash('git commit -m "x"'), { cwd: repo });
    assert.strictEqual(r.status, 2, `${prefix}: ${r.stdout}${r.stderr}`);
  }
});

test("unreadable commits are left to the commit-msg git hook: editor commit, unresolved substitution", () => {
  const live = makeRepo();
  assert.strictEqual(run(bash("git commit"), { cwd: live }).status, 0, "editor message");
  assert.strictEqual(run(bash('git commit -m "$(date)"'), { cwd: live }).status, 0, "unresolved $(...)");
  assert.strictEqual(run(bash("git commit -F /nonexistent/file.txt"), { cwd: live }).status, 0, "unreadable -F");
  assert.strictEqual(run(bash("git commit --fixup HEAD"), { cwd: live }).status, 0);
});

function poisonedGuard() {
  const base = tmpDir("poison");
  fs.mkdirSync(path.join(base, "scripts", "hooks"), { recursive: true });
  fs.mkdirSync(path.join(base, "scripts", "checks"), { recursive: true });
  fs.cpSync(path.join(ROOT, "scripts", "hooks", "lib"), path.join(base, "scripts", "hooks", "lib"), { recursive: true });
  fs.writeFileSync(path.join(base, "scripts", "checks", "change-trailer.js"), 'throw new Error("boom: validator will not load");\n');
  const guard = path.join(base, "scripts", "hooks", "change-trailer-guard.js");
  fs.copyFileSync(GUARD, guard);
  return { guard, base };
}

function nonFailOpenGuard(poison) {
  const src = fs.readFileSync(GUARD, "utf8");
  let m = src.replace(/let result;\s*try \{\s*result = decide\(payload\);\s*\} catch \(e\) \{[\s\S]*?\n  \}\n/, "const result = decide(payload);\n");
  assert.notStrictEqual(m, src, "mutation 1 (unwrap decide) applied");
  const m2 = m.replace(/try \{\s*payload = raw \? JSON\.parse\(raw\) : \{\};\s*\} catch \(e\) \{[\s\S]*?\n  \}\n/, "payload = raw ? JSON.parse(raw) : {};\n");
  assert.notStrictEqual(m2, m, "mutation 2 (unwrap JSON.parse) applied");
  m = m2.replace('process.on("uncaughtException"', 'process.on("__fail_open_removed__"');
  assert.notStrictEqual(m, m2, "mutation 3 (drop uncaughtException handler) applied");
  const out = path.join(path.dirname(poison.guard), "change-trailer-guard.nofailopen.js");
  fs.writeFileSync(out, m);
  return out;
}

test("crash: a validator that cannot load exits 0 (not blocking) and records a crash event", () => {
  const repo = makeRepo();
  const p = poisonedGuard();
  const r = run(bash('git commit -m "x"'), { cwd: repo, guard: p.guard });
  assert.strictEqual(r.status, 0, `GREEN: fail-open, got ${r.status}: ${r.stderr}`);
  assert.ok(kinds(repo).includes("change-trailer-guard-crash"), "telemetry event written");
});

test("crash RED: the same fault in a guard WITHOUT the fail-open code exits non-zero", () => {
  const repo = makeRepo();
  const p = poisonedGuard();
  const bad = nonFailOpenGuard(p);
  const r = run(bash('git commit -m "x"'), { cwd: repo, guard: bad });
  assert.notStrictEqual(r.status, 0, "RED: without the guard's own try/catch the crash escapes");
  assert.ok(/boom/.test(r.stderr), "and it is the poisoned validator that crashed it");
});

test("malformed stdin exits 0 and is logged; RED: without the fail-open code it does not", () => {
  const repo = makeRepo();
  for (const raw of ["{not json", "", "null", '"a string"', "[1,2]"]) {
    const r = run(raw, { cwd: repo });
    assert.strictEqual(r.status, 0, `stdin ${JSON.stringify(raw)}: ${r.stderr}`);
  }
  assert.ok(kinds(repo).includes("change-trailer-guard-bad-input"));
  const p = poisonedGuard();
  const bad = nonFailOpenGuard(p);
  const rr = run("{not json", { cwd: repo, guard: bad });
  assert.notStrictEqual(rr.status, 0, "RED: JSON.parse escapes in the mutated guard");
});

test("unreadable stdin exits 0 and records an unreadable-stdin event carrying the read error", () => {
  const repo = makeRepo();
  const woFile = path.join(tmpDir("wo"), "stdin.txt");
  fs.writeFileSync(woFile, "");
  const fd = fs.openSync(woFile, "w");
  let r;
  try {
    r = spawnSync(process.execPath, [GUARD], {
      cwd: repo,
      stdio: [fd, "pipe", "pipe"],
      env: envFor(repo),
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    });
  } finally {
    fs.closeSync(fd);
  }
  assert.strictEqual(r.status, 0, `fail-open, got ${r.status}: ${r.stderr}`);
  const ev = readEvents(repo).find((e) => e && e.data && e.data.kind === "change-trailer-guard-unreadable-stdin");
  assert.ok(ev, `an unreadable-stdin event is written; kinds seen: ${JSON.stringify(kinds(repo))}`);
  assert.ok(/EBADF/.test(String(ev.data.error)), `the event carries the read error message, got ${JSON.stringify(ev.data.error)}`);
});

test("kill switch: RED blocked without it; MC_CHANGE_TRAILER=off is a silent no-op (even with a broken validator)", () => {
  const repo = makeRepo();
  const cmd = bash('git commit -m "x"');
  assert.strictEqual(run(cmd, { cwd: repo }).status, 2, "RED");
  const off = run(cmd, { cwd: repo, env: MCENV.envPair("CHANGE_TRAILER", "off") });
  assert.strictEqual(off.status, 0, "GREEN");
  assert.strictEqual(off.stderr, "", "silent");
  assert.ok(kinds(repo).includes("change-trailer-bypass"), "the bypass is logged");
  const p = poisonedGuard();
  const repo2 = makeRepo();
  const off2 = run(cmd, { cwd: repo2, guard: p.guard, env: MCENV.envPair("CHANGE_TRAILER", "off") });
  assert.strictEqual(off2.status, 0);
  assert.ok(!kinds(repo2).includes("change-trailer-guard-crash"), "off never even loads the validator");
});

test("MC_CHANGE_TRAILER=report demotes to report-only AND logs it", () => {
  const repo = makeRepo();
  const r = run(bash('git commit -m "x"'), { cwd: repo, env: MCENV.envPair("CHANGE_TRAILER", "report") });
  assert.strictEqual(r.status, 0);
  assert.ok(/report-only/.test(r.stderr));
  assertThreeLines(r.stderr);
  assert.ok(kinds(repo).includes("change-trailer-report-only"));
});

test("fixtures/hooks/change-trailer-guard payloads behave as named", () => {
  const repo = makeRepo();
  const load = (n) => JSON.parse(fs.readFileSync(path.join(FIXDIR, n), "utf8"));
  assert.strictEqual(run(load("trailerless-commit.json"), { cwd: repo }).status, 2);
  assert.strictEqual(run(load("amend-no-edit.json"), { cwd: repo }).status, 0);
  assert.strictEqual(run(load("with-trailer.json"), { cwd: repo }).status, 0);
});

test("registration: registry row (fail-open, PreToolUse Bash, fixture listed), settings.json and manifest agree", () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "framework", "hooks.registry.json"), "utf8"));
  const row = reg.hooks.find((h) => h.id === "change-trailer-guard");
  assert.ok(row, "registry row");
  assert.strictEqual(row.script, "scripts/hooks/change-trailer-guard.js");
  assert.strictEqual(row.failMode, "fail-open");
  assert.strictEqual(row.enabled, true);
  assert.deepStrictEqual(row.registrations, [{ event: "PreToolUse", matcher: "Bash" }]);
  for (const f of row.testFixtures) assert.ok(fs.existsSync(path.join(ROOT, f)), `fixture exists: ${f}`);
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "settings.json"), "utf8"));
  const bashBlocks = settings.hooks.PreToolUse.filter((b) => b.matcher === "Bash");
  assert.ok(bashBlocks.some((b) => b.hooks.some((h) => /change-trailer-guard\.js/.test(h.command))), "settings.json registers it on PreToolUse Bash");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "hooks", "hook-manifest.json"), "utf8"));
  assert.ok(manifest.hooks["change-trailer-guard.js"], "hook-manifest has it");
});

test("analyzeCommand: message assembly", () => {
  const a = (c) => G.analyzeCommand(c, { cwd: "/x" }).commits;
  assert.strictEqual(a("git status").length, 0);
  assert.deepStrictEqual(a('git commit -m "a" -m "b"')[0].message, "a\n\nb");
  assert.deepStrictEqual(a('git commit --message="a" --message "b"')[0].message, "a\n\nb");
  assert.deepStrictEqual(a("git commit -m 'single quoted \"x\"'")[0].message, 'single quoted "x"');
  assert.strictEqual(a('git commit -m "a" --trailer "Change: update"')[0].message, "a\n\nChange: update");
  assert.strictEqual(a("git commit --amend --no-edit")[0].kind, "inherit");
  assert.strictEqual(a("git commit")[0].kind, "unparseable");
  assert.strictEqual(a('FOO=1 git commit -m "x"')[0].message, "x");
  assert.strictEqual(a('git add . && git commit -m "x" && git push').length, 1);
  assert.strictEqual(a('git commit -m "x"; git commit -m "y"').length, 2);
  assert.strictEqual(a('git commit -m "$(date)"')[0].dynamic, true);
});
