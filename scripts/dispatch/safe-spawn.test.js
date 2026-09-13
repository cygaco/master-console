#!/usr/bin/env node
"use strict";

/**
 * Isolated P5 test for safe-spawn.js (the dispatch safety kernel). Proves:
 *   - assertArgs ALLOWS a clean codex/claude invocation,
 *   - assertArgs REJECTS: an unknown flag, a shell metachar, a UNC/abs-exe arg,
 *     a bad flag value (planted violations — the "safe-spawn != safe args" class),
 *   - resolveTool REJECTS a non-allowlisted id, a repo-local resolution, a temp
 *     resolution (PATH-hijack guard),
 *   - normalizeStdin strips a BOM + normalizes CRLF,
 *   - safeSpawnSync fails CLOSED on an arg violation (no spawn) and runs a real
 *     deterministic command on the happy path.
 *
 *   node scripts/dispatch/safe-spawn.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { harness, sealedDir } = require("../checks/lib/fixture-harness");
const { assertArgs, resolveTool, normalizeStdin, treeKill, safeSpawnSync, safeSpawnFile, PROJECT_ROOT, CMDLINE_MAX, assembledCmdlineLen, withCodexHome, DEFAULT_CODEX_HOME } = require("./safe-spawn");

// Synchronous, event-loop-free sleep so a process-liveness poll can block inside a
// synchronous h.test without a foreground shell `sleep`. The detached descendants
// append their PIDs from their OWN processes, so we only need to re-read a file —
// no event loop required between reads.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
const isAlive = (pid) => {
  try { process.kill(pid, 0); } catch { return false; }
  // Linux: a ZOMBIE still answers kill(pid, 0) but is dead — read its state from
  // /proc so an unreaped corpse never reads as "survived treeKill".
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

// ── assertArgs — known-answer (clean invocations pass) ──────
h.pass("codex clean invocation passes", () =>
  assertArgs("codex", ["exec", "--sandbox", "workspace-write", "--ask-for-approval", "never", "-m", "gpt-5.5", "-"]));
h.pass("claude clean invocation passes", () =>
  assertArgs("claude", ["-p", "--agent", "frontend-reviewer", "--model", "claude-opus-4-8", "--effort", "high"]));

// ── #27 agy INJECT_META carve-out — multi-line `-p` value slot ONLY (both ways) ──
const AGY_MULTILINE = "line one\nline two\nline three";
// (a) accepted: a MULTI-LINE prompt in agy's native-exe `-p` value slot rides the carve-out.
h.pass("agy multi-line -p accepted (the ONE carve-out slot)", () =>
  assertArgs("agy", ["--model", "gemini-3.1-pro-high", "--print-timeout", "90s", "-p", AGY_MULTILINE]));
// (b) refused: the SAME multi-line content in ANY OTHER agy arg (--model) hits full INJECT_META.
h.violation("agy multi-line in --model rejected (carve-out is -p only)", () =>
  assertArgs("agy", ["--model", AGY_MULTILINE, "-p", "hi"]));
// (c) refused: a newline to a DIFFERENT tool (codex -m) is not carved out — agy-only.
h.violation("codex -m multi-line rejected (carve-out is agy-only)", () =>
  assertArgs("codex", ["exec", "-m", AGY_MULTILINE, "-"]));
// ── agy --model DISPLAY-NAME allow (2026-07-19: agy's --model takes display names, not slugs —
// its own error output enumerates "Gemini 3.1 Pro (High)" etc.; ADR-0023 positive-scope pattern) ──
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
// (d) (b) CARVE-OUT (β DECIDE B/0.90, ADR-0020-amend, RIDER-4): agy `-p` now ACCEPTS the full code-review
// char set — under shell:false + native-exe + a discrete-argv element (RIDER-3) the shell-injection premise
// is void, so backtick / pipe / $ / ; / < > / " / % / ^ / & in a code payload are accepted for review. Scoped
// to agy `-p` ONLY (the (d2) block below proves every OTHER tool/slot still refuses them — denylist intact).
h.pass("agy -p code payload with backtick+pipe ACCEPTED (b carve-out — shell:false ⇒ metachars inert)", () =>
  assertArgs("agy", ["-p", "review: `whoami` && cat a|b; echo $HOME > out"]));
h.pass("agy -p full code payload ACCEPTED (RIDER-4 fixture i)", () =>
  assertArgs("agy", ["--model", "gemini-3.1-pro-high", "-p", 'function f(x){return `${x}`&&x>0||x<1;} // $VAR, a|b, c;d, e^f, "q", 100%']));
// RIDER-4 fixture (ii): NUL is STILL refused even in the agy -p code slot (REG-001 — it truncates the arg).
h.violation("agy -p NUL still refused (REG-001, the ONE char refused in the code slot)", () =>
  assertArgs("agy", ["-p", "bad" + String.fromCharCode(0) + "payload"]));
// RIDER-4 fixture (v) / RIDER-2: a LEADING-DASH payload is ACCEPTED — structurally bound as -p's discrete-argv
// VALUE (consumed as the flag value at assertArgs, never parsed as a flag), so a real diff / `-webkit-` /
// flag-snippet review is NOT silently dropped (a false-BLOCK there would itself be a security-lane hole).
h.pass("agy -p leading-dash payload ACCEPTED, not silently dropped (RIDER-2 / RIDER-4 v)", () =>
  assertArgs("agy", ["--model", "gemini-3.1-pro-high", "-p", "-webkit-box; - removed diff line; --flag in a snippet"]));
// ── ADR-0031 rider 4: agy must NEVER carry a skip-permissions / auto-approve BYPASS. The scoped
// read-only tool-permission is operator-owned (agy stays BLOCKED-ADVISORY); the bypass is refused
// STRUCTURALLY here so it can never be self-granted (a future edit that adds the flag fails closed). ──
h.pass("agy clean invocation (no permission-bypass) passes", () =>
  assertArgs("agy", ["--model", "Gemini 3.1 Pro (High)", "--print-timeout", "90s", "-p", "review this"]));
h.violation("agy --dangerously-skip-permissions REFUSED (ADR-0031 rider 4)", () =>
  assertArgs("agy", ["--model", "gemini-3.1-pro-high", "--dangerously-skip-permissions", "-p", "x"]));
h.violation("agy --yolo REFUSED (permission-bypass, ADR-0031 rider 4)", () =>
  assertArgs("agy", ["--yolo", "--model", "gemini-3.1-pro-high", "-p", "x"]));
// (d2) β item-2 property 4: the newline carve-out is CROSS-TOOL scoped — the same multi-line value
// refuses in EVERY other tool/slot: gemini -p, codex -c, agy -m (short form), and an agy positional.
h.violation("gemini -p multi-line rejected (carve-out is agy-only, not gemini)", () =>
  assertArgs("gemini", ["-m", "gemini-3.1-pro-preview", "-p", AGY_MULTILINE, "-o", "json"]));
h.violation("codex -c multi-line rejected (carve-out does not leak to codex -c)", () =>
  assertArgs("codex", ["exec", "-c", "model_reasoning_effort=" + AGY_MULTILINE, "-"]));
h.violation("agy -m (short form) multi-line rejected (only -p is carved out)", () =>
  assertArgs("agy", ["-m", AGY_MULTILINE, "-p", "hi"]));
h.violation("agy positional multi-line rejected (agy takes no positionals; not the -p slot)", () =>
  assertArgs("agy", ["-p", "hi", AGY_MULTILINE]));
// (d3) RIDER-1 (β, ADR-0020-amend) — the ASSEMBLED-command-line bound, BIDIRECTIONAL. A real code payload
// UNDER the bound passes; an oversize payload is OVER the bound → safeSpawnSync returns a NAMED cmdline_oversize
// (BLOCKED, never truncate-and-send). Tested via the pure exported helper so it is env-independent (no spawn).
h.test("RIDER-1: a normal agy -p code payload is UNDER the assembled-cmdline bound", () => {
  const payload = "function auth(req){ return verify(`${req.token}`) && !req.expired; } // ~2KB review payload " + "x".repeat(2000);
  assert.ok(assembledCmdlineLen("C:/agy/bin/agy.exe", ["--model", "gemini-3.1-pro-high", "--print-timeout", "90s", "-p", payload]) < CMDLINE_MAX,
    "a ~2KB code payload must be under the bound (real reviews must go through)");
});
h.test("RIDER-1: an OVERSIZE agy -p payload is OVER the bound → BLOCKED-oversize, never truncated", () => {
  const oversize = "x".repeat(CMDLINE_MAX + 500);
  assert.ok(assembledCmdlineLen("C:/agy/bin/agy.exe", ["--model", "gemini-3.1-pro-high", "-p", oversize]) > CMDLINE_MAX,
    "an oversize payload must exceed the bound so safeSpawnSync BLOCKS it (never truncate-and-send)");
});
// (e) refused: a .cmd/.bat SHIM agy is refused in safeSpawnSync (native-exe only — cmd.exe /c would
// reparse the newline). The native-exe half of the allowlist-of-shape.
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
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── assertArgs — PLANTED VIOLATIONS (the arg-allowlist) ─────
// R2 REG-001: a NUL byte is refused on EVERY argv element — flag value AND POSITIONAL (the positional
// path was the residual: SHELL_META does not include NUL, so a node/git positional NUL reached spawnSync).
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
// HOST-absolute outside-repo path, not a Windows literal: "C:\\Windows\\Temp\\x" is a
// RELATIVE path on POSIX, so path.resolve() put it UNDER the repo cwd and the Linux CI
// runner accepted it (false-green). A sibling of PROJECT_ROOT is absolute + outside on
// every host.
const OUTSIDE_REPO = path.join(path.dirname(PROJECT_ROOT), "not-this-repo-x");
h.violation("claude --worktree outside repo rejected", () =>
  assertArgs("claude", ["-p", "--agent", "builder", "--worktree", OUTSIDE_REPO]));
// GPT-5.5 review CRITICAL regression guard: a consumed flag VALUE carrying a cmd
// metachar must be rejected even when the per-flag validator (codex -o path check)
// would accept the path. This is the CVE-2024-27980 .cmd-shim bypass.
h.violation("codex -o value with a cmd metachar (in-repo path + &) is rejected", () => {
  const repoPath = path.join(PROJECT_ROOT, "out&calc");
  return assertArgs("codex", ["exec", "-o", repoPath, "-"]);
});
h.violation("codex -o value with a pipe metachar is rejected", () =>
  assertArgs("codex", ["exec", "-o", path.join(PROJECT_ROOT, "a|b"), "-"]));
// GPT-5.5 review HIGH regression guard: a temp-PREFIX path that is not a temp CHILD
// must be rejected (string-prefix bug: "TempEvil".startsWith("Temp")).
h.violation("codex -o a temp-prefix-not-child path is rejected (boundary, not prefix)", () => {
  const os = require("os");
  return assertArgs("codex", ["exec", "-o", os.tmpdir() + "Evil" + path.sep + "x", "-"]);
});
// GPT-5.5 review R2 fixes: cmd var-expansion + a code-exec git subcommand.
h.violation("codex -o value with %VAR% cmd expansion is rejected", () =>
  assertArgs("codex", ["exec", "-o", path.join(PROJECT_ROOT, "a%PATH%b"), "-"]));
h.violation("codex -o value with !VAR! delayed expansion is rejected", () =>
  assertArgs("codex", ["exec", "-o", path.join(PROJECT_ROOT, "a!x!b"), "-"]));
h.violation("git config (code-exec/persistence) is rejected", () =>
  assertArgs("git", ["config", "core.pager", "x"]));
h.violation("git unknown subcommand is rejected (not a permissive positional)", () =>
  assertArgs("git", ["nonsense"]));

// ── resolveTool — PATH-hijack guard ─────────────────────────
h.test("resolveTool('node') resolves to a real native exe outside the repo", () => {
  const r = resolveTool("node");
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(path.isAbsolute(r.path));
  assert.ok(!r.path.startsWith(PROJECT_ROOT + path.sep), "must not be repo-local");
});
h.violation("non-allowlisted tool-id refused", () => resolveTool("rm"));
h.violation("repo-local resolution refused (planted shim)", () => {
  const fx = sealedDir({ "claude.cmd": "@echo planted" }, "hijack");
  // Force the resolver at a repo-local file by pointing it inside PROJECT_ROOT.
  const planted = path.join(PROJECT_ROOT, "scripts", "dispatch", "__planted_shim.cmd");
  try {
    require("fs").writeFileSync(planted, "@echo planted\n");
    const r = resolveTool("claude", { path: planted });
    return r; // ok:false expected (repo-local) => isPass false => violation passes
  } finally {
    try { require("fs").unlinkSync(planted); } catch {}
    fx.cleanup();
  }
});
h.violation("temp-dir resolution refused (writable hijack)", () => {
  const fx = sealedDir({ "codex.exe": "x" }, "temphijack");
  try {
    return resolveTool("codex", { path: fx.file("codex.exe") }); // under os.tmpdir() => refused
  } finally {
    fx.cleanup();
  }
});

// ── normalizeStdin ──────────────────────────────────────────
h.test("normalizeStdin strips BOM + normalizes CRLF->LF, forces UTF-8 buffer", () => {
  const out = normalizeStdin("﻿line1\r\nline2\r\n");
  assert.ok(Buffer.isBuffer(out));
  assert.strictEqual(out.toString("utf8"), "line1\nline2\n");
});

// ── safeSpawnSync — fail-closed + real happy path ───────────
h.failClosed("safeSpawnSync fails closed on an arg violation (NO spawn)", () => {
  const r = safeSpawnSync("codex", ["exec", "--evil-flag", "-"]);
  // ok:true only if it wrongly spawned/passed; correct = ok:false, reason arg_policy_violation.
  return { ok: r.ok === true || r.reason !== "arg_policy_violation" };
});
h.test("safeSpawnSync runs a real deterministic command on the happy path", () => {
  const r = safeSpawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: PROJECT_ROOT });
  // In this repo git is available; rev-parse prints "true". If git is somehow
  // absent the kernel returns a clean reap (ok:false) — assert it never throws and
  // returns a well-formed shape.
  assert.ok(typeof r === "object" && "ok" in r && "reaped" in r, JSON.stringify(r));
  if (r.ok) assert.match(r.stdout.trim(), /^true$/, `stdout=${JSON.stringify(r.stdout)}`);
});

// ── treeKill — CHILD *and* GRANDCHILD die (PLAN §17.3 / §17.6 precond #2) ──
// The "orphaned paid subprocess tree" residual: CLIs spawn their OWN children, so
// killing only the top process leaks grandchildren that keep burning paid tokens.
// This plants a real 3-level node tree (parent → child → GRANDCHILD, all real PIDs,
// long-sleeping) and proves treeKill(parentPid) reaps ALL THREE — the GRANDCHILD
// death being the load-bearing assertion the prior 21 cases never exercised.
h.test("treeKill reaps a parent + child + GRANDCHILD process tree (not just the top)", () => {
  // Cross-platform: parent/child are spawned detached so on POSIX treeKill's
  // process-group kill reaches them; on win32 `taskkill /T` walks the live tree.
  // Each level appends its own PID to a sealed temp file (deterministic handoff that
  // doesn't depend on stdio inheritance across spawn hops).
  const pidFile = path.join(os.tmpdir(), `warpos-treekill-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(pidFile, "");
  const fj = JSON.stringify(pidFile);
  const detached = process.platform !== "win32";
  const dj = String(detached);
  // GRANDCHILD: record PID, then sleep ~60s (kept alive only by the timer).
  const gSrc = `const fs=require("fs");fs.appendFileSync(${fj},"G "+process.pid+"\\n");setTimeout(()=>{},60000);`;
  // CHILD: spawn the grandchild, record PID, sleep.
  const cSrc = `const cp=require("child_process");const fs=require("fs");cp.spawn(process.execPath,["-e",${JSON.stringify(gSrc)}],{stdio:"ignore",detached:${dj}}).unref();fs.appendFileSync(${fj},"C "+process.pid+"\\n");setTimeout(()=>{},60000);`;
  // PARENT: spawn the child, record PID, sleep.
  const pSrc = `const cp=require("child_process");const fs=require("fs");cp.spawn(process.execPath,["-e",${JSON.stringify(cSrc)}],{stdio:"ignore",detached:${dj}}).unref();fs.appendFileSync(${fj},"P "+process.pid+"\\n");setTimeout(()=>{},60000);`;

  let pids = {};
  let killed = false;
  try {
    if (process.platform === "win32") {
      // win32: no zombies, and a NON-detached child is bound to its parent's job object
      // (it dies with a short-lived launcher), so P is spawned directly.
      const parent = spawn(process.execPath, ["-e", pSrc], { stdio: "ignore", detached });
      parent.unref();
    } else {
      // POSIX double-fork: launch P through a short-lived LAUNCHER so P is NOT this
      // process's direct child. This h.test is fully synchronous (Atomics.wait), so the
      // event loop never reaps a direct child's SIGCHLD — a killed P would linger as a
      // ZOMBIE that still answers kill(pid, 0) and read as "survived" (the Linux CI
      // false-red). Reparented to init, P is reaped the instant it dies.
      const lSrc = `const cp=require("child_process");cp.spawn(process.execPath,["-e",${JSON.stringify(pSrc)}],{stdio:"ignore",detached:${dj}}).unref();`;
      const launcher = spawn(process.execPath, ["-e", lSrc], { stdio: "ignore" });
      launcher.unref();
    }

    // Harvest all three PIDs from the sealed file (bounded poll, fully synchronous).
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

    // The unit under test: a SINGLE treeKill on the top PID must reap the whole tree.
    assert.strictEqual(treeKill(pids.P), true, "treeKill should report success");
    killed = true;

    // Poll for death (taskkill /T + process teardown is async at the OS level).
    const deathDeadline = Date.now() + 5000;
    while (Date.now() < deathDeadline && (isAlive(pids.P) || isAlive(pids.C) || isAlive(pids.G))) {
      sleepSync(50);
    }
    assert.ok(!isAlive(pids.P), `parent ${pids.P} survived treeKill`);
    assert.ok(!isAlive(pids.C), `child ${pids.C} survived treeKill`);
    // THE key assertion: a grandchild two levels down must NOT outlive a tree-kill.
    assert.ok(!isAlive(pids.G), `GRANDCHILD ${pids.G} survived treeKill — orphaned paid subprocess leak`);
  } finally {
    // Deterministic: never leak processes even if an assertion above failed.
    for (const pid of [pids.P, pids.C, pids.G]) {
      if (pid && isAlive(pid)) { try { treeKill(pid); } catch {} }
    }
    if (!killed && pids.P) { try { treeKill(pids.P); } catch {} }
    try { fs.unlinkSync(pidFile); } catch {}
  }
});

// ── safeSpawnFile — durable-file + savepoint recovery (RI-004 reap fix) ──
// Ticket T-20260608-269: the §13.6 ping reaped ~50% because safeSpawnSync buffers
// stdout in RAM and only surfaces it at child exit — an outer-harness reap of the
// dispatcher lost a result `claude` had already produced. safeSpawnFile writes the
// child's stdout to a DURABLE FILE and drops a savepoint sentinel, so the result is
// recoverable independent of how the parent dies.

// (1) Happy path: the out-file holds the real output AND a savepoint sentinel lands.
h.test("safeSpawnFile writes a durable out-file + savepoint sentinel on a clean run", () => {
  const fx = sealedDir({}, "ssfile-ok");
  try {
    const outFile = fx.file("out.txt");
    const r = safeSpawnFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: PROJECT_ROOT, outFile });
    assert.ok(r.ok, `expected ok, got ${JSON.stringify(r)}`);
    assert.strictEqual(r.recovered, false, "first run is NOT a recovery");
    // The durable file holds the output (not an in-memory buffer that dies with the parent).
    assert.ok(fs.existsSync(outFile), "out-file must exist on disk");
    assert.match(fs.readFileSync(outFile, "utf8").trim(), /^true$/, "out-file holds the real stdout");
    assert.match(r.stdout.trim(), /^true$/, "returned stdout mirrors the file");
    // The savepoint sentinel proves a recoverable result for a later retry.
    assert.ok(fs.existsSync(outFile + ".done"), "savepoint sentinel must exist");
    const sv = JSON.parse(fs.readFileSync(outFile + ".done", "utf8"));
    assert.strictEqual(sv.ok, true, "sentinel marks a clean run");
  } finally {
    fx.cleanup();
  }
});

// (2) THE load-bearing reap-resistance assertion: a second call with a valid
// savepoint RECOVERS the prior result WITHOUT re-spawning — so a bounded retry after
// an outer reap returns the real bytes the reaped attempt produced, with no re-spend.
h.test("safeSpawnFile RECOVERS from a savepoint without re-spawning (no re-spend)", () => {
  const fx = sealedDir({}, "ssfile-recover");
  try {
    const outFile = fx.file("out.txt");
    // Plant a savepoint as if a PRIOR attempt finished cleanly but the parent was then
    // reaped before it could surface the result. Point the tool-id at a NON-EXISTENT
    // exe via the path seam: if recovery did NOT happen, the re-spawn would FAIL — so a
    // successful, correct result PROVES the savepoint path was taken (no spawn at all).
    fs.writeFileSync(outFile, "RECOVERED-PAYLOAD\n", "utf8");
    fs.writeFileSync(outFile + ".done", JSON.stringify({ ok: true, exitCode: 0, bytes: 18, durationMs: 999 }) + "\n", "utf8");
    const r = safeSpawnFile("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: PROJECT_ROOT,
      outFile,
      // Force resolution to a bogus exe: a real spawn would reap; recovery must win first.
      resolve: { path: path.join(PROJECT_ROOT, "does-not-exist-ssfile.exe") },
    });
    assert.ok(r.ok, `recovery must succeed, got ${JSON.stringify(r)}`);
    assert.strictEqual(r.recovered, true, "must report recovered:true (savepoint path)");
    assert.match(r.stdout, /RECOVERED-PAYLOAD/, "recovered the prior attempt's real bytes");
  } finally {
    fx.cleanup();
  }
});

// (3) A reaped run leaves NO trustworthy savepoint (so a retry re-spawns, never
// recovers a phantom). Plant a zero-byte out-file with NO sentinel → a fresh spawn
// runs and a real result replaces it.
h.test("safeSpawnFile does NOT recover from a missing/zero-byte savepoint", () => {
  const fx = sealedDir({}, "ssfile-noreap");
  try {
    const outFile = fx.file("out.txt");
    fs.writeFileSync(outFile, "", "utf8"); // empty, NO .done sentinel
    const r = safeSpawnFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: PROJECT_ROOT, outFile });
    // No valid savepoint → it must actually re-run (recovered:false) and succeed.
    assert.strictEqual(r.recovered, false, "must NOT recover without a sentinel");
    assert.ok(r.ok, `re-spawn should succeed, got ${JSON.stringify(r)}`);
    assert.match(r.stdout.trim(), /^true$/, "real re-run output");
  } finally {
    fx.cleanup();
  }
});

// (4) Fail-closed: safeSpawnFile without an outFile refuses (no spawn).
h.failClosed("safeSpawnFile fails closed without an outFile (NO spawn)", () => {
  const r = safeSpawnFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: PROJECT_ROOT });
  return { ok: r.ok === true || r.reason !== "missing_out_file" };
});

// (5) Fail-closed: an arg violation is refused BEFORE any spawn or file write.
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

// ── withCodexHome — the isolated CODEX_HOME seam (RI-009 codex cache multi-writer collision) ──
// The default is the isolated ~/.codex-warpos (reading the constant does NOT seed).
h.pass("DEFAULT_CODEX_HOME is the isolated ~/.codex-warpos", () => ({
  ok: typeof DEFAULT_CODEX_HOME === "string" && /[\\/]\.codex-warpos$/.test(DEFAULT_CODEX_HOME),
}));

// Behavior: codex spawns get the isolated CODEX_HOME; an explicit CODEX_HOME wins; non-codex
// tools are untouched; the caller's env is never mutated. Point DEFAULT at a SEALED temp via a
// fresh require so the one-time seed is side-effect-contained (never touches the real home).
h.pass("withCodexHome: codex defaulted, explicit wins, other tools untouched, no env mutation", () => {
  const fx = sealedDir({}, "codexhome");
  const home = fx.dir;
  const prev = process.env.WARPOS_CODEX_HOME;
  process.env.WARPOS_CODEX_HOME = home;
  delete require.cache[require.resolve("./safe-spawn")];
  try {
    const ss = require("./safe-spawn");
    const input = {};
    ss.withCodexHome("codex", input); // must NOT mutate the caller's env
    const explicitEnv = { CODEX_HOME: "D:/pinned" };
    const claudeEnv = { PATH: "x" };
    const ok =
      ss.withCodexHome("codex", {}).CODEX_HOME === home && // (1) codex defaulted to the isolated home
      ss.DEFAULT_CODEX_HOME === home &&
      ss.withCodexHome("codex", explicitEnv) === explicitEnv && // (2) explicit override returned untouched
      ss.withCodexHome("codex", explicitEnv).CODEX_HOME === "D:/pinned" &&
      ss.withCodexHome("claude", claudeEnv) === claudeEnv && // (3) non-codex tools untouched (same object)
      ss.withCodexHome("agy", claudeEnv).CODEX_HOME === undefined &&
      input.CODEX_HOME === undefined; // (4) no mutation of the caller's env
    return { ok };
  } finally {
    if (prev === undefined) delete process.env.WARPOS_CODEX_HOME;
    else process.env.WARPOS_CODEX_HOME = prev;
    delete require.cache[require.resolve("./safe-spawn")];
    require("./safe-spawn"); // restore the canonical module instance in the require cache
    fx.cleanup();
  }
});

h.done();
