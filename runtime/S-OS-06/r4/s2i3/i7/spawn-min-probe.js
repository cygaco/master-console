"use strict";
// Lane I7 step 1: measure the minimum Windows spawn set. Report-only. Prints a summary; full JSON to argv[2].
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const pick = (names) => {
  const o = {};
  for (const [k, v] of Object.entries(process.env)) if (names.some((n) => n.toUpperCase() === k.toUpperCase())) o[k] = v;
  return o;
};
const out = { platform: process.platform, node: process.version, parentKeys: Object.keys(process.env).sort(), probes: [] };
const tdir = fs.mkdtempSync(path.join(os.tmpdir(), "i7-probe-"));
fs.writeFileSync(
  path.join(tdir, "t.test.js"),
  "const t=require('node:test');t('x',()=>{console.log('TMP='+require('os').tmpdir());console.log('HOME='+require('os').homedir());console.log('KEYS='+Object.keys(process.env).sort().join(','))});\n"
);
const sets = {
  EMPTY: {},
  SYSTEMROOT_ONLY: pick(["SystemRoot"]),
  PATH_ONLY: pick(["PATH"]),
  CANDIDATE: pick(["SystemRoot", "SystemDrive", "windir", "COMSPEC", "PATHEXT", "PATH", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "HOME", "TMPDIR"]),
};
for (const [name, env] of Object.entries(sets)) {
  const n = spawnSync(
    process.execPath,
    ["-e", "console.log(JSON.stringify({keys:Object.keys(process.env).sort(),tmp:require('os').tmpdir(),home:require('os').homedir(),rnd:require('crypto').randomBytes(4).toString('hex')}))"],
    { env, encoding: "utf8", windowsHide: true }
  );
  const t = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "t.test.js"], { cwd: tdir, env, encoding: "utf8", windowsHide: true });
  const g = spawnSync("git", ["--version"], { env, encoding: "utf8", windowsHide: true });
  const gc = spawnSync("git", ["config", "--global", "--list", "--name-only"], { env, encoding: "utf8", windowsHide: true });
  out.probes.push({
    set: name,
    passedKeys: Object.keys(env).sort(),
    nodeE: { status: n.status, error: n.error && n.error.message, stdout: String(n.stdout || "").trim(), stderr: String(n.stderr || "").trim().slice(0, 400) },
    nodeTest: {
      status: t.status,
      error: t.error && t.error.message,
      lines: String(t.stdout || "").split(/\r?\n/).filter((l) => /TMP=|HOME=|KEYS=|^# (pass|fail) /.test(l)),
      stderr: String(t.stderr || "").trim().slice(0, 400),
    },
    git: { status: g.status, error: g.error && g.error.message, stdout: String(g.stdout || "").trim() },
    gitGlobalConfig: { status: gc.status, error: gc.error && gc.error.message, count: String(gc.stdout || "").split("\n").filter(Boolean).length, stderr: String(gc.stderr || "").trim().slice(0, 200) },
  });
}
fs.rmSync(tdir, { recursive: true, force: true });
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log("parent", out.parentKeys.length, out.parentKeys.join(","));
for (const p of out.probes) {
  console.log(`\n== ${p.set} passed=[${p.passedKeys.join(",")}]`);
  console.log(" node -e:", p.nodeE.status, p.nodeE.error || "", p.nodeE.stdout.slice(0, 700), p.nodeE.stderr);
  console.log(" node --test:", p.nodeTest.status, p.nodeTest.error || "", JSON.stringify(p.nodeTest.lines), p.nodeTest.stderr);
  console.log(" git --version:", JSON.stringify(p.git), " git global config:", JSON.stringify(p.gitGlobalConfig));
}
