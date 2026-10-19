#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { harness, sealedDir } = require("../checks/lib/fixture-harness");
const { assertArgs, resolveTool, normalizeStdin, treeKill, safeSpawnSync, safeSpawnFile, PROJECT_ROOT, CMDLINE_MAX, assembledCmdlineLen, withCodexHome, DEFAULT_CODEX_HOME } = require("./safe-spawn");

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
const isAlive = (pid) => {
  try { process.kill(pid, 0); } catch { return false; }
  if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const state = stat.slice(stat.lastIndexOf(")") + 1).trim()[0];
      if (state === "Z" || state === "X") return false;
    } catch { return false; }
  }
  return true;
};

const h = harness("safe-spawn");

h.pass("codex clean invocation passes", () =>
  assertArgs("codex", ["exec", "--sandbox", "workspace-write", "--ask-for-approval", "never", "-m", "gpt-5.5", "-"]));
h.pass("claude clean invocation passes", () =>
  assertArgs("claude", ["-p", "--agent", "frontend-reviewer", "--model", "claude-opus-4-8", "--effort", "high"]));

const AGY_MULTILINE = "line one\nline two\nline three";
h.pass("agy multi-line -p accepted (the ONE carve-out slot)", () =>
  assertArgs("agy", ["--model", "gemini-3.1-pro-high", "--print-timeout", "90s", "-p", AGY_MULTILINE]));
h.violation("agy multi-line in --model rejected (carve-out is -p only)", () =>
  assertArgs("agy", ["--model", AGY_MULTILINE, "-p", "hi"]));
h.violation("codex -m multi-line rejected (carve-out is agy-only)", () =>
  assertArgs("codex", ["exec", "-m", AGY_MULTILINE, "-"]));
h.pass("agy --model display name ACCEPTED (agy's real id format)", () =>
  assertArgs("agy", ["--model", "Gemini 3.1 Pro (High)", "-p", "hi"]));
h.violation("codex -m display name REFUSED (display-name allow is agy-only)", () =>
  assertArgs("codex", ["exec", "-m", "Gemini 3.1 Pro (High)", "-"]));
h.violation("agy --model metachar REFUSED (display allow admits no metachars)", () =>
  assertArgs("agy", ["--model", "Gemini $(whoami) Pro", "-p", "hi"]));
h.violation("agy --model leading-dash REFUSED (no flag-shaped model values)", () =>
  assertArgs("agy", ["--model", "-Gemini Pro (High)", "-p", "hi"]));
h.violation("agy --model overlong display-shape REFUSED (64-char bound; space forces the display path)", () =>
  assertArgs("agy", ["--model", "Gemini " + "e".repeat(80), "-p", "hi"]));
h.pass("agy -p code payload with backtick+pipe ACCEPTED (shell:false ⇒ metachars inert)", () =>
  assertArgs("agy", ["-p", "review: `whoami` && cat a|b; echo $HOME > out"]));
h.pass("agy -p full code payload ACCEPTED (fixture i)", () =>
  assertArgs("agy", ["--model", "gemini-3.1-pro-high", "-p", 'function f(x){return `${x}`&&x>0||x<1;} // $VAR, a|b, c;d, e^f, "q", 100%']));
h.violation("agy -p NUL still refused (the ONE char refused in the code slot)", () =>
  assertArgs("agy", ["-p", "bad" + String.fromCharCode(0) + "payload"]));
h.pass("agy -p leading-dash payload ACCEPTED, not silently dropped (fixture v)", () =>
  assertArgs("agy", ["--model", "gemini-3.1-pro-high", "-p", "-webkit-box; - removed diff line; --flag in a snippet"]));
h.pass("agy clean invocation (no permission-bypass) passes", () =>
  assertArgs("agy", ["--model", "Gemini 3.1 Pro (High)", "--print-timeout", "90s", "-p", "review this"]));
h.violation("agy --dangerously-skip-permissions REFUSED (ADR-0031)", () =>
  assertArgs("agy", ["--model", "gemini-3.1-pro-high", "--dangerously-skip-permissions", "-p", "x"]));
h.violation("agy --yolo REFUSED (permission-bypass, ADR-0031)", () =>
  assertArgs("agy", ["--yolo", "--model", "gemini-3.1-pro-high", "-p", "x"]));
h.violation("gemini -p multi-line rejected (carve-out is agy-only, not gemini)", () =>
  assertArgs("gemini", ["-m", "gemini-3.1-pro-preview", "-p", AGY_MULTILINE, "-o", "json"]));
h.violation("codex -c multi-line rejected (carve-out does not leak to codex -c)", () =>
  assertArgs("codex", ["exec", "-c", "model_reasoning_effort=" + AGY_MULTILINE, "-"]));
h.violation("agy -m (short form) multi-line rejected (only -p is carved out)", () =>
  assertArgs("agy", ["-m", AGY_MULTILINE, "-p", "hi"]));
h.violation("agy positional multi-line rejected (agy takes no positionals; not the -p slot)", () =>
  assertArgs("agy", ["-p", "hi", AGY_MULTILINE]));
h.test("a normal agy -p code payload is UNDER the assembled-cmdline bound", () => {
  const payload = "function auth(req){ return verify(`${req.token}`) && !req.expired; } // ~2KB review payload " + "x".repeat(2000);
  assert.ok(assembledCmdlineLen("C:/agy/bin/agy.exe", ["--model", "gemini-3.1-pro-high", "--print-timeout", "90s", "-p", payload]) < CMDLINE_MAX,
    "a ~2KB code payload must be under the bound (real reviews must go through)");
});
h.test("an OVERSIZE agy -p payload is OVER the bound → BLOCKED-oversize, never truncated", () => {
  const oversize = "x".repeat(CMDLINE_MAX + 500);
  assert.ok(assembledCmdlineLen("C:/agy/bin/agy.exe", ["--model", "gemini-3.1-pro-high", "-p", oversize]) > CMDLINE_MAX,
    "an oversize payload must exceed the bound so safeSpawnSync BLOCKS it (never truncate-and-send)");
});
h.failClosed("agy .cmd-shim refused (native-exe only carve-out)", () => {
  const dir = path.join(PROJECT_ROOT, "runtime", ".agy-shim-test");
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, "agy.cmd");
  fs.writeFileSync(shim, "@echo off\r\necho hi\r\n");
  try {
    const r = safeSpawnSync("agy", ["--model", "gemini-3.1-pro-high", "-p", AGY_MULTILINE], {
      resolve: { path: shim, allowRepoLocal: true },
      timeoutMs: 3000,
    });
    return { ok: r.ok === true || r.reason !== "agy_requires_native_exe" };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});

h.violation("NUL in a node POSITIONAL rejected (universal, before positional policy)", () =>
  assertArgs("node", ["/repo/x" + String.fromCharCode(0) + ".js"]));
h.violation("NUL in a git positional rejected", () =>
  assertArgs("git", ["diff", String.fromCharCode(0)]));
h.violation("unknown/disallowed flag rejected", () =>
  assertArgs("codex", ["exec", "--dangerously-skip", "-"]));
h.violation("shell metachar in a flag value rejected", () =>
  assertArgs("codex", ["exec", "-m", "gpt-5.5;rm -rf /", "-"]));
h.violation("UNC / absolute-exe arg rejected (model never picks the exe)", () =>
  assertArgs("codex", ["exec", "\\\\attacker\\share\\evil.exe", "-"]));
h.violation("bad flag value rejected (sandbox not in allowlist)", () =>
  assertArgs("codex", ["exec", "--sandbox", "full-access-please", "-"]));
const OUTSIDE_REPO = path.join(path.dirname(PROJECT_ROOT), "not-this-repo-x");
h.violation("claude --worktree outside repo rejected", () =>
  assertArgs("claude", ["-p", "--agent", "builder", "--worktree", OUTSIDE_REPO]));
h.violation("codex -o value with a cmd metachar (in-repo path + &) is rejected", () => {
  const repoPath = path.join(PROJECT_ROOT, "out&calc");
  return assertArgs("codex", ["exec", "-o", repoPath, "-"]);
});
h.violation("codex -o value with a pipe metachar is rejected", () =>
  assertArgs("codex", ["exec", "-o", path.join(PROJECT_ROOT, "a|b"), "-"]));
h.violation("codex -o a temp-prefix-not-child path is rejected (boundary, not prefix)", () => {
  const os = require("os");
  return assertArgs("codex", ["exec", "-o", os.tmpdir() + "Evil" + path.sep + "x", "-"]);
});
h.violation("codex -o value with %VAR% cmd expansion is rejected", () =>
  assertArgs("codex", ["exec", "-o", path.join(PROJECT_ROOT, "a%PATH%b"), "-"]));
h.violation("codex -o value with !VAR! delayed expansion is rejected", () =>
  assertArgs("codex", ["exec", "-o", path.join(PROJECT_ROOT, "a!x!b"), "-"]));
h.violation("git config (code-exec/persistence) is rejected", () =>
  assertArgs("git", ["config", "core.pager", "x"]));
h.violation("git unknown subcommand is rejected (not a permissive positional)", () =>
  assertArgs("git", ["nonsense"]));

h.test("resolveTool('node') resolves to a real native exe outside the repo", () => {
  const r = resolveTool("node");
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(path.isAbsolute(r.path));
  assert.ok(!r.path.startsWith(PROJECT_ROOT + path.sep), "must not be repo-local");
});
h.violation("non-allowlisted tool-id refused", () => resolveTool("rm"));
h.violation("repo-local resolution refused (planted shim)", () => {
  const fx = sealedDir({ "claude.cmd": "@echo planted" }, "hijack");
  const planted = path.join(PROJECT_ROOT, "scripts", "dispatch", "__planted_shim.cmd");
  try {
    require("fs").writeFileSync(planted, "@echo planted\n");
    const r = resolveTool("claude", { path: planted });
    return r;
  } finally {
    try { require("fs").unlinkSync(planted); } catch {}
    fx.cleanup();
  }
});
h.violation("temp-dir resolution refused (writable hijack)", () => {
  const fx = sealedDir({ "codex.exe": "x" }, "temphijack");
  try {
    return resolveTool("codex", { path: fx.file("codex.exe") });
  } finally {
    fx.cleanup();
  }
});

h.test("normalizeStdin strips BOM + normalizes CRLF->LF, forces UTF-8 buffer", () => {
  const out = normalizeStdin("﻿line1\r\nline2\r\n");
  assert.ok(Buffer.isBuffer(out));
  assert.strictEqual(out.toString("utf8"), "line1\nline2\n");
});

h.failClosed("safeSpawnSync fails closed on an arg violation (NO spawn)", () => {
  const r = safeSpawnSync("codex", ["exec", "--evil-flag", "-"]);
  return { ok: r.ok === true || r.reason !== "arg_policy_violation" };
});
h.test("safeSpawnSync runs a real deterministic command on the happy path", () => {
  const r = safeSpawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: PROJECT_ROOT });
  assert.ok(typeof r === "object" && "ok" in r && "reaped" in r, JSON.stringify(r));
  if (r.ok) assert.match(r.stdout.trim(), /^true$/, `stdout=${JSON.stringify(r.stdout)}`);
});

h.test("treeKill reaps a parent + child + GRANDCHILD process tree (not just the top)", () => {
  const pidFile = path.join(os.tmpdir(), `mc-treekill-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(pidFile, "");
  const fj = JSON.stringify(pidFile);
  const detached = process.platform !== "win32";
  const dj = String(detached);
  const gSrc = `const fs=require("fs");fs.appendFileSync(${fj},"G "+process.pid+"\\n");setTimeout(()=>{},60000);`;
  const cSrc = `const cp=require("child_process");const fs=require("fs");cp.spawn(process.execPath,["-e",${JSON.stringify(gSrc)}],{stdio:"ignore",detached:${dj}}).unref();fs.appendFileSync(${fj},"C "+process.pid+"\\n");setTimeout(()=>{},60000);`;
  const pSrc = `const cp=require("child_process");const fs=require("fs");cp.spawn(process.execPath,["-e",${JSON.stringify(cSrc)}],{stdio:"ignore",detached:${dj}}).unref();fs.appendFileSync(${fj},"P "+process.pid+"\\n");setTimeout(()=>{},60000);`;

  let pids = {};
  let killed = false;
  try {
    if (process.platform === "win32") {
      const parent = spawn(process.execPath, ["-e", pSrc], { stdio: "ignore", detached });
      parent.unref();
    } else {
      const lSrc = `const cp=require("child_process");cp.spawn(process.execPath,["-e",${JSON.stringify(pSrc)}],{stdio:"ignore",detached:${dj}}).unref();`;
      const launcher = spawn(process.execPath, ["-e", lSrc], { stdio: "ignore" });
      launcher.unref();
    }

    const harvestDeadline = Date.now() + 8000;
    while (Date.now() < harvestDeadline) {
      const lines = fs.readFileSync(pidFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
      if (lines.length >= 3) {
        for (const l of lines) { const [k, v] = l.split(" "); pids[k] = Number(v); }
        break;
      }
      sleepSync(50);
    }
    assert.ok(pids.P && pids.C && pids.G, `failed to harvest all 3 PIDs (got ${JSON.stringify(pids)})`);
    assert.ok(isAlive(pids.P) && isAlive(pids.C) && isAlive(pids.G), `tree not fully alive pre-kill: ${JSON.stringify(pids)}`);

    assert.strictEqual(treeKill(pids.P), true, "treeKill should report success");
    killed = true;

    const deathDeadline = Date.now() + 5000;
    while (Date.now() < deathDeadline && (isAlive(pids.P) || isAlive(pids.C) || isAlive(pids.G))) {
      sleepSync(50);
    }
    assert.ok(!isAlive(pids.P), `parent ${pids.P} survived treeKill`);
    assert.ok(!isAlive(pids.C), `child ${pids.C} survived treeKill`);
    assert.ok(!isAlive(pids.G), `GRANDCHILD ${pids.G} survived treeKill — orphaned paid subprocess leak`);
  } finally {
    for (const pid of [pids.P, pids.C, pids.G]) {
      if (pid && isAlive(pid)) { try { treeKill(pid); } catch {} }
    }
    if (!killed && pids.P) { try { treeKill(pids.P); } catch {} }
    try { fs.unlinkSync(pidFile); } catch {}
  }
});

h.test("safeSpawnFile writes a durable out-file + savepoint sentinel on a clean run", () => {
  const fx = sealedDir({}, "ssfile-ok");
  try {
    const outFile = fx.file("out.txt");
    const r = safeSpawnFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: PROJECT_ROOT, outFile });
    assert.ok(r.ok, `expected ok, got ${JSON.stringify(r)}`);
    assert.strictEqual(r.recovered, false, "first run is NOT a recovery");
    assert.ok(fs.existsSync(outFile), "out-file must exist on disk");
    assert.match(fs.readFileSync(outFile, "utf8").trim(), /^true$/, "out-file holds the real stdout");
    assert.match(r.stdout.trim(), /^true$/, "returned stdout mirrors the file");
    assert.ok(fs.existsSync(outFile + ".done"), "savepoint sentinel must exist");
    const sv = JSON.parse(fs.readFileSync(outFile + ".done", "utf8"));
    assert.strictEqual(sv.ok, true, "sentinel marks a clean run");
  } finally {
    fx.cleanup();
  }
});

h.test("safeSpawnFile RECOVERS from a savepoint without re-spawning (no re-spend)", () => {
  const fx = sealedDir({}, "ssfile-recover");
  try {
    const outFile = fx.file("out.txt");
    fs.writeFileSync(outFile, "RECOVERED-PAYLOAD\n", "utf8");
    fs.writeFileSync(outFile + ".done", JSON.stringify({ ok: true, exitCode: 0, bytes: 18, durationMs: 999 }) + "\n", "utf8");
    const r = safeSpawnFile("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: PROJECT_ROOT,
      outFile,
      resolve: { path: path.join(PROJECT_ROOT, "does-not-exist-ssfile.exe") },
    });
    assert.ok(r.ok, `recovery must succeed, got ${JSON.stringify(r)}`);
    assert.strictEqual(r.recovered, true, "must report recovered:true (savepoint path)");
    assert.match(r.stdout, /RECOVERED-PAYLOAD/, "recovered the prior attempt's real bytes");
  } finally {
    fx.cleanup();
  }
});

h.test("safeSpawnFile does NOT recover from a missing/zero-byte savepoint", () => {
  const fx = sealedDir({}, "ssfile-noreap");
  try {
    const outFile = fx.file("out.txt");
    fs.writeFileSync(outFile, "", "utf8");
    const r = safeSpawnFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: PROJECT_ROOT, outFile });
    assert.strictEqual(r.recovered, false, "must NOT recover without a sentinel");
    assert.ok(r.ok, `re-spawn should succeed, got ${JSON.stringify(r)}`);
    assert.match(r.stdout.trim(), /^true$/, "real re-run output");
  } finally {
    fx.cleanup();
  }
});

h.failClosed("safeSpawnFile fails closed without an outFile (NO spawn)", () => {
  const r = safeSpawnFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: PROJECT_ROOT });
  return { ok: r.ok === true || r.reason !== "missing_out_file" };
});

h.failClosed("safeSpawnFile fails closed on an arg violation (NO spawn, NO file)", () => {
  const fx = sealedDir({}, "ssfile-argviol");
  try {
    const outFile = fx.file("out.txt");
    const r = safeSpawnFile("codex", ["exec", "--evil-flag", "-"], { outFile });
    const wrong = r.ok === true || r.reason !== "arg_policy_violation" || fs.existsSync(outFile);
    return { ok: wrong };
  } finally {
    fx.cleanup();
  }
});

const { resolveCodexHome } = require("./safe-spawn");
const LEGACY_CODEX_DIR = `.codex-${mcEnv.LEGACY_PREFIX.slice(0, -1).toLowerCase()}`;
h.pass("DEFAULT_CODEX_HOME is the isolated ~/.codex-mc (or an existing legacy codex home, read-both)", () => {
  const override = mcEnv.readEnv("CODEX_HOME");
  const expected = override || resolveCodexHome().path;
  const shapeOk = override ? true : [".codex-mc", LEGACY_CODEX_DIR].includes(path.basename(DEFAULT_CODEX_HOME));
  return { ok: typeof DEFAULT_CODEX_HOME === "string" && DEFAULT_CODEX_HOME === expected && shapeOk };
});

h.pass("resolveCodexHome: fresh -> ~/.codex-mc; legacy-only -> legacy in place (deprecated, never moved); both -> ~/.codex-mc", () => {
  const fx = sealedDir({}, "codexhome-readboth");
  try {
    const home = fx.dir;
    const cur = path.join(home, ".codex-mc");
    const leg = path.join(home, LEGACY_CODEX_DIR);
    const fresh = resolveCodexHome(home);
    const freshCreatedNothing = !fs.existsSync(cur);
    fs.mkdirSync(leg);
    const legacyOnly = resolveCodexHome(home);
    const notMoved = !fs.existsSync(cur) && fs.existsSync(leg);
    fs.mkdirSync(cur);
    const both = resolveCodexHome(home);
    return {
      ok:
        fresh.path === cur && !fresh.deprecated && freshCreatedNothing &&
        legacyOnly.path === leg && legacyOnly.deprecated === true && notMoved &&
        both.path === cur && !both.deprecated,
    };
  } finally {
    fx.cleanup();
  }
});

h.pass("withCodexHome: codex defaulted, explicit wins, other tools untouched, no env mutation", () => {
  const fx = sealedDir({}, "codexhome");
  const home = fx.dir;
  const prev = mcEnv.readEnv("CODEX_HOME");
  mcEnv.setEnv("CODEX_HOME", home);
  delete require.cache[require.resolve("./safe-spawn")];
  try {
    const ss = require("./safe-spawn");
    const input = {};
    ss.withCodexHome("codex", input);
    const explicitEnv = { CODEX_HOME: "D:/pinned" };
    const claudeEnv = { PATH: "x" };
    const ok =
      ss.withCodexHome("codex", {}).CODEX_HOME === home &&
      ss.DEFAULT_CODEX_HOME === home &&
      ss.withCodexHome("codex", explicitEnv) === explicitEnv &&
      ss.withCodexHome("codex", explicitEnv).CODEX_HOME === "D:/pinned" &&
      ss.withCodexHome("claude", claudeEnv) === claudeEnv &&
      ss.withCodexHome("agy", claudeEnv).CODEX_HOME === undefined &&
      input.CODEX_HOME === undefined;
    return { ok };
  } finally {
    if (prev === undefined) mcEnv.unsetEnv("CODEX_HOME");
    else mcEnv.setEnv("CODEX_HOME", prev);
    delete require.cache[require.resolve("./safe-spawn")];
    require("./safe-spawn");
    fx.cleanup();
  }
});

const { pickCodexCandidate, isNpmGlobalPath, whichAll } = require("./safe-spawn");
const DESK = { path: "C:\\Programs\\OpenAI\\Codex\\bin\\codex.exe", npm: false, version: "0.146.0" };
const NPMC = { path: "C:\\npm\\codex.cmd", npm: true, version: "0.160.0" };
h.test("pickCodexCandidate: npm-global NEWER than PATH-first → npm chosen", () => {
  const r = pickCodexCandidate([DESK, NPMC]);
  assert.equal(r.chosen, NPMC); assert.equal(r.reason, "npm-global-newer-than-path-first");
});
h.test("pickCodexCandidate: npm-global OLDER → PATH-first kept", () => {
  const r = pickCodexCandidate([DESK, { ...NPMC, version: "0.140.0" }]);
  assert.equal(r.chosen, DESK); assert.equal(r.reason, "path-first-not-older-than-npm-global");
});
h.test("pickCodexCandidate: UNKNOWN version never flips the choice (PATH-first kept)", () => {
  const r = pickCodexCandidate([DESK, { ...NPMC, version: null }]);
  assert.equal(r.chosen, DESK);
});
h.test("pickCodexCandidate: single / no-npm / npm-first are stable", () => {
  assert.equal(pickCodexCandidate([DESK]).reason, "single-candidate");
  assert.equal(pickCodexCandidate([DESK, { ...DESK, path: "D:\\other\\codex.exe" }]).reason, "no-npm-global-candidate");
  assert.equal(pickCodexCandidate([NPMC, DESK]).reason, "npm-global-first-on-path");
  assert.equal(pickCodexCandidate([]).chosen, null);
});
h.test("isNpmGlobalPath: provenance = realpath under the trusted npm prefix, NOT a path substring", () => {
  const base = path.join(os.homedir(), `.mc-safe-spawn-prov-${process.pid}`);
  const prefix = path.join(base, "prefix");
  const pkg = path.join(prefix, "node_modules", "@openai", "codex");
  const evil = path.join(base, "evil", "npm");
  try {
    fs.mkdirSync(pkg, { recursive: true }); fs.mkdirSync(evil, { recursive: true });
    fs.writeFileSync(path.join(prefix, "codex.cmd"), "@echo off\r\n");
    fs.writeFileSync(path.join(evil, "codex.cmd"), "@echo off\r\n");
    fs.mkdirSync(path.join(base, "evil", "node_modules", "@openai", "codex"), { recursive: true });
    const real = (x) => fs.realpathSync(x);
    assert.ok(isNpmGlobalPath(path.join(prefix, "codex.cmd"), real(path.join(prefix, "codex.cmd")), prefix), "shim in the trusted prefix is npm-global");
    assert.ok(isNpmGlobalPath("/x/bin/codex", path.join(pkg, "bin", "codex.js"), prefix), "realpath inside prefix node_modules/@openai/codex is npm-global");
    assert.ok(!isNpmGlobalPath(path.join(evil, "codex.cmd"), real(path.join(evil, "codex.cmd")), prefix), "dir named 'npm' outside the prefix is NOT npm-global");
    const spoofPkg = path.join(base, "evil", "node_modules", "@openai", "codex", "bin", "codex.js");
    assert.ok(!isNpmGlobalPath("/x/bin/codex", spoofPkg, prefix), "spoofed node_modules/@openai/codex outside the prefix is NOT npm-global");
    assert.ok(!isNpmGlobalPath(path.join(prefix, "codex.cmd"), path.join(prefix, "codex.cmd"), null), "no trusted prefix → nothing is npm-global");
    assert.ok(!isNpmGlobalPath(DESK.path, DESK.path, prefix));
  } finally { try { fs.rmSync(base, { recursive: true, force: true }); } catch { } }
});

const _win = process.platform === "win32";
const _shimSrc = (dir, ver) => {
  fs.mkdirSync(dir, { recursive: true });
  if (_win) { const t = path.join(dir, "codex.exe"); try { fs.linkSync(process.execPath, t); } catch { fs.copyFileSync(process.execPath, t); } }
  else { const f = path.join(dir, "codex"); fs.writeFileSync(f, `#!/bin/sh\necho codex-cli ${ver}\n`); fs.chmodSync(f, 0o755); }
};
const _npmFake = (prefix, ver) => {
  const pkg = _win ? path.join(prefix, "node_modules", "@openai", "codex") : path.join(prefix, "lib", "node_modules", "@openai", "codex");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@openai/codex", version: ver }));
  const dir = _win ? prefix : path.join(prefix, "bin");
  fs.mkdirSync(dir, { recursive: true });
  if (_win) fs.writeFileSync(path.join(dir, "codex.cmd"), "@echo off\r\necho codex-cli 0.0.0-lying\r\n");
  else { const f = path.join(dir, "codex"); fs.writeFileSync(f, "#!/bin/sh\necho codex-cli 0.0.0-lying\n"); fs.chmodSync(f, 0o755); }
  return dir;
};
const _evil = (dir, marker) => {
  fs.mkdirSync(dir, { recursive: true });
  if (_win) fs.writeFileSync(path.join(dir, "codex.cmd"), `@echo off\r\necho pwned> "${marker}"\r\necho codex-cli 999.0.0\r\n`);
  else { const f = path.join(dir, "codex"); fs.writeFileSync(f, `#!/bin/sh\necho pwned > "${marker}"\necho codex-cli 999.0.0\n`); fs.chmodSync(f, 0o755); }
};
const _withEnv = (fn) => {
  const savedPath = process.env.PATH;
  const envSnap = mcEnv.snapshotEnv(["TOOL_CODEX_PATH", "APPROVED_TOOL_ROOTS"]);
  mcEnv.unsetEnv("TOOL_CODEX_PATH"); mcEnv.unsetEnv("APPROVED_TOOL_ROOTS");
  try { return fn(); } finally { process.env.PATH = savedPath; mcEnv.restoreEnv(envSnap); }
};
const _ver = process.versions.node;

h.test("resolveTool('codex'): newer npm-global (package metadata) wins over the PATH-first shim; older does not", () => _withEnv(() => {
  const base = path.join(os.homedir(), `.mc-safe-spawn-shims-${process.pid}`);
  try {
    const aOther = path.join(base, "a", "other"), aPre = path.join(base, "a", "prefix");
    _shimSrc(aOther, _ver); const aNpm = _npmFake(aPre, "999.0.0");
    process.env.PATH = [aOther, aNpm].join(path.delimiter);
    assert.equal(whichAll("codex").length, 2, "both shims visible: " + whichAll("codex").join(" | "));
    const r = resolveTool("codex", { npmPrefix: aPre });
    assert.ok(r.ok, r.reason);
    assert.ok(r.path.toLowerCase().startsWith(fs.realpathSync(aNpm).toLowerCase()), "npm shim chosen: " + r.path);
    assert.equal(r.resolution.reason, "npm-global-newer-than-path-first");
    assert.equal(r.resolution.chosen_version, "999.0.0");
    assert.equal(r.resolution.alternatives[0].version, _ver);
    const bOther = path.join(base, "b", "other"), bPre = path.join(base, "b", "prefix");
    _shimSrc(bOther, _ver); const bNpm = _npmFake(bPre, "0.0.1");
    process.env.PATH = [bOther, bNpm].join(path.delimiter);
    const r2 = resolveTool("codex", { npmPrefix: bPre });
    assert.ok(r2.ok, r2.reason);
    assert.ok(r2.path.toLowerCase().startsWith(fs.realpathSync(bOther).toLowerCase()), "PATH-first kept: " + r2.path);
    assert.equal(r2.resolution.reason, "path-first-not-older-than-npm-global");
    const r3 = resolveTool("codex", { path: path.join(bOther, _win ? "codex.exe" : "codex"), npmPrefix: bPre });
    assert.ok(r3.ok, r3.reason);
    assert.equal(r3.resolution.reason, "explicit-path");
    assert.ok(r3.resolution.alternatives.some((a) => a.npm && a.version === "0.0.1"), "npm alternative versioned: " + JSON.stringify(r3.resolution.alternatives));
    const tmpShim = path.join(os.tmpdir(), `codex-${process.pid}.cmd`);
    fs.writeFileSync(tmpShim, "@echo off\r\necho codex-cli 9.9.9\r\n");
    try { assert.ok(!resolveTool("codex", { path: tmpShim }).ok, "temp-dir shim must stay refused"); } finally { try { fs.unlinkSync(tmpShim); } catch { } }
  } finally { try { fs.rmSync(base, { recursive: true, force: true }); } catch { } }
}));

h.test("resolveTool('codex'): NO guard-failing candidate is executed during resolution (pre-guard probe)", () => _withEnv(() => {
  const base = path.join(os.homedir(), `.mc-safe-spawn-evil-${process.pid}`);
  const evilBase = path.join(os.tmpdir(), `mc-evil-${process.pid}`);
  const marker = path.join(base, "MARKER");
  try {
    fs.mkdirSync(base, { recursive: true });
    const good = path.join(base, "good"); _shimSrc(good, _ver);
    const evilDir = path.join(evilBase, "npm");
    _evil(evilDir, marker);
    process.env.PATH = [good, evilDir].join(path.delimiter);
    resolveTool("codex");
    assert.ok(!fs.existsSync(marker), "unguarded candidate was EXECUTED by the version probe (default scenario)");
    resolveTool("codex", { path: path.join(good, _win ? "codex.exe" : "codex") });
    assert.ok(!fs.existsSync(marker), "alternative PATH candidate was EXECUTED despite an explicit override");
    require("./safe-spawn").toolVersion(path.join(evilDir, _win ? "codex.cmd" : "codex"));
    assert.ok(!fs.existsSync(marker), "toolVersion executed a guard-failing path");
  } finally {
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { }
    try { fs.rmSync(evilBase, { recursive: true, force: true }); } catch { }
  }
}));

h.done();
