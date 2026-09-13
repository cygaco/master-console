#!/usr/bin/env node
"use strict";
/**
 * dir-fallback — S-OS-06 T3 part 4c (project `_mc/` / `.mc/` read fallback) + part 5 (HOME `~/.mc/`, `~/.codex-mc`).
 *
 * scripts/hooks/lib/mc-dirs.js: the canonical path wins when it exists; ONLY the legacy twin existing -> the legacy
 * path IN PLACE with ONE deprecation line per process; neither -> canonical; NOTHING is ever moved or created by a
 * resolution (state ceiling). The helper derives its legacy names from mc-env's prefix (no second legacy literal).
 *
 *   node --test tests/regression/S-OS-06/dir-fallback.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const H = require("./falsifier-harness");

const HELPER = path.join(H.REAL_ROOT, "scripts", "hooks", "lib", "mc-dirs.js");
const dirs = require(HELPER);
const LEG = H.SLUG; // legacy slug (this directory is Class-3 compat data)

function sandbox(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sos06-dirs-${tag}-`));
}
function touch(p, body = "x") {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
function quiet(fn) {
  const lines = [];
  dirs._resetWarningsForTest();
  dirs._setWarnSinkForTest((l) => lines.push(l));
  try {
    return { value: fn(), lines };
  } finally {
    dirs._setWarnSinkForTest(null);
    dirs._resetWarningsForTest();
  }
}

test("dir-fallback: segment map — _mc/.mc/.codex-mc have legacy twins; anything else does not", () => {
  assert.strictEqual(dirs.legacySegment("_mc"), `_${LEG}`);
  assert.strictEqual(dirs.legacySegment(".mc"), `.${LEG}`);
  assert.strictEqual(dirs.legacySegment(".codex-mc"), `.codex-${LEG}`);
  for (const s of ["mc", "scripts", "_mcx", ".mcrc", ".claude", ""]) assert.strictEqual(dirs.legacySegment(s), null, s);
});

test("dir-fallback: project path — canonical-only / legacy-only / dual / neither (existence precedence, no move)", () => {
  const root = sandbox("proj");
  const rel = "_mc/MANIFEST.json";
  const cur = path.join(root, "_mc", "MANIFEST.json");
  const leg = path.join(root, `_${LEG}`, "MANIFEST.json");

  let r = quiet(() => dirs.resolveProjectPath(root, rel));
  assert.deepStrictEqual([r.value, r.lines.length], [cur, 0], "neither -> canonical, silent");
  assert.ok(!fs.existsSync(path.join(root, "_mc")), "resolution never creates the canonical dir");

  touch(leg, "legacy");
  r = quiet(() => [dirs.resolveProjectPath(root, rel), dirs.resolveProjectPath(root, ".mc/../_mc/MANIFEST.json")]);
  assert.strictEqual(r.value[0], leg, "legacy-only -> the legacy path, in place");
  assert.strictEqual(r.lines.length, 1, `exactly one deprecation line per process: ${r.lines.join(" | ")}`);
  assert.match(r.lines[0], /DEPRECATION/);
  assert.ok(fs.existsSync(leg) && !fs.existsSync(cur), "legacy-only is NEVER moved to the canonical location");

  touch(cur, "current");
  r = quiet(() => dirs.resolveProjectPath(root, rel));
  assert.deepStrictEqual([r.value, r.lines.length], [cur, 0], "dual -> canonical precedence, legacy ignored");
  assert.strictEqual(fs.readFileSync(leg, "utf8"), "legacy", "the ignored legacy copy is untouched");

  const other = quiet(() => dirs.resolveProjectPath(root, "scripts/x.js"));
  assert.strictEqual(other.value, path.join(root, "scripts", "x.js"), "a non-renamed root is joined unchanged");
});

test("dir-fallback: .mc/ state files and whole-directory pairs resolve the same way", () => {
  const root = sandbox("state");
  const legState = path.join(root, `.${LEG}`, "spinup-state.json");
  touch(legState, "{}");
  const r = quiet(() => dirs.resolveProjectPath(root, ".mc/spinup-state.json"));
  assert.strictEqual(r.value, legState);
  fs.mkdirSync(path.join(root, `_${LEG}`, "templates"), { recursive: true });
  const d = quiet(() => dirs.resolvePair(path.join(root, "_mc"), path.join(root, `_${LEG}`)));
  assert.deepStrictEqual([d.value.path, d.value.source, d.value.deprecated], [path.join(root, `_${LEG}`), "legacy", true]);
});

test("dir-fallback (part 5 HOME): ~/.mc/portfolio.json then the legacy registry; ~/.codex-mc then the legacy codex home", () => {
  const home = sandbox("home");
  const cur = path.join(home, ".mc", "portfolio.json");
  const leg = path.join(home, `.${LEG}`, "portfolio.json");
  let r = quiet(() => dirs.resolveHomePath(home, ".mc", "portfolio.json"));
  assert.deepStrictEqual([r.value.path, r.value.deprecated], [cur, false], "fresh HOME -> canonical");
  touch(leg, '{"products":{}}');
  r = quiet(() => dirs.resolveHomePath(home, ".mc", "portfolio.json"));
  assert.deepStrictEqual([r.value.path, r.value.source, r.lines.length], [leg, "legacy", 1], "legacy-only registry read in place");
  assert.ok(!fs.existsSync(cur), "HOME state is never auto-moved");
  touch(cur, '{"products":{}}');
  r = quiet(() => dirs.resolveHomePath(home, ".mc", "portfolio.json"));
  assert.strictEqual(r.value.path, cur, "both present -> canonical");

  fs.mkdirSync(path.join(home, `.codex-${LEG}`), { recursive: true });
  const c = quiet(() => dirs.resolvePair(path.join(home, ".codex-mc"), path.join(home, `.codex-${LEG}`), { warn: false }));
  assert.deepStrictEqual([c.value.path, c.lines.length], [path.join(home, `.codex-${LEG}`), 0], "warn:false defers the line");
  const w = quiet(() => dirs.warnLegacy(c.value, "cur", "leg"));
  assert.strictEqual(w.lines.length, 1, "warnLegacy emits the deferred deprecation once");
});

test("dir-fallback: one deprecation line per PROCESS across many legacy-only resolutions (child process)", () => {
  const root = sandbox("child");
  touch(path.join(root, `_${LEG}`, "a.json"));
  touch(path.join(root, `.${LEG}`, "b.json"));
  const code =
    `const d = require(${JSON.stringify(HELPER)});` +
    `for (let i = 0; i < 5; i++) { d.resolveProjectPath(${JSON.stringify(root)}, "_mc/a.json"); d.resolveProjectPath(${JSON.stringify(root)}, ".mc/b.json"); }`;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", env, timeout: 60000 });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual((r.stderr.match(/DEPRECATION/g) || []).length, 1, r.stderr);
});

test("dir-fallback (4c central): hooks/lib/paths.js resolves `_mc/`/`.mc/` registry keys through the fallback, others untouched", () => {
  const root = sandbox("paths");
  touch(path.join(root, ".claude", "paths.json"), JSON.stringify({ version: 1, tpl: "_mc/templates/sprint", tx: ".mc/transactions", fresh: "_mc/settings", hooks: "scripts/hooks" }));
  fs.mkdirSync(path.join(root, `_${LEG}`, "templates", "sprint"), { recursive: true });
  fs.mkdirSync(path.join(root, `.${LEG}`, "transactions"), { recursive: true });
  const pathsLib = path.join(H.REAL_ROOT, "scripts", "hooks", "lib", "paths.js");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(pathsLib)}).PATHS))`], { encoding: "utf8", env, timeout: 60000 });
  assert.strictEqual(r.status, 0, r.stderr);
  const P = JSON.parse(r.stdout);
  assert.strictEqual(P.tpl, path.join(root, `_${LEG}`, "templates", "sprint"), "legacy-only `_mc/` key -> legacy dir in place");
  assert.strictEqual(P.tx, path.join(root, `.${LEG}`, "transactions"), "legacy-only `.mc/` key -> legacy dir in place");
  assert.strictEqual(P.fresh, path.join(root, "_mc", "settings"), "neither present -> canonical");
  assert.strictEqual(P.hooks, path.join(root, "scripts", "hooks"), "non-renamed root untouched");
  assert.strictEqual((r.stderr.match(/DEPRECATION/g) || []).length, 1, r.stderr);
  assert.ok(!fs.existsSync(path.join(root, "_mc")) && !fs.existsSync(path.join(root, ".mc")), "paths.js never creates or moves a dir");
});

test("dir-fallback: the helper carries no legacy literal of its own (derived from mc-env's prefix)", () => {
  const text = fs.readFileSync(HELPER, "utf8");
  assert.ok(!new RegExp(LEG, "i").test(text), "mc-dirs.js must derive the legacy slug, never spell it");
});
