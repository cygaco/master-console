#!/usr/bin/env node
/**
 * scripts/mc/settings/test-compile.js — three-layer compiler tests.
 *
 * A. mergeObjects deep + local-wins
 * B. mergePermissionsBuckets union + dedupe
 * C. detectPermissionConflicts allow_vs_deny
 * D. mergeHooks group-by-matcher + dedupe-by-command
 * E. mergeHooks conflict (same matcher + same command, different timeout)
 * F. End-to-end compile() against fixtures (defaults-only)
 * G. End-to-end compile() with local override (env + permissions + hooks merge)
 * H. compile() --check stale detection
 * I. compile() conflict short-circuits
 */

"use strict";

const fs = require("fs");
const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const {
  compile,
  mergeObjects,
  mergePermissionsBuckets,
  detectPermissionConflicts,
  mergeHooks,
} = require(path.join(__dirname, "compile.js"));

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(
      `  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`,
    );
    fail++;
  }
}

function makeFixture(name) {
  const dir = path.join(REPO_ROOT, ".mc", "test-compile-fixtures", name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* */
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// A. mergeObjects
process.stdout.write("A. mergeObjects deep + local-wins\n");
{
  const m = mergeObjects(
    { env: { FOO: "1", BAR: "2" }, x: 10 },
    { env: { BAR: "20", BAZ: "30" }, y: 99 },
  );
  ok("FOO from defaults", m.env.FOO === "1");
  ok("BAR overridden by local", m.env.BAR === "20");
  ok("BAZ added by local", m.env.BAZ === "30");
  ok("x preserved", m.x === 10);
  ok("y added", m.y === 99);
}

// B. mergePermissionsBuckets
process.stdout.write("B. mergePermissionsBuckets union + dedupe\n");
{
  const m = mergePermissionsBuckets(
    { allow: ["a", "b"], deny: ["x"] },
    { allow: ["b", "c"], ask: ["q"] },
  );
  ok("allow union", JSON.stringify(m.allow.slice().sort()) === '["a","b","c"]');
  ok("deny preserved", JSON.stringify(m.deny) === '["x"]');
  ok("ask added", JSON.stringify(m.ask) === '["q"]');
}

// C. detectPermissionConflicts
process.stdout.write("C. detectPermissionConflicts allow_vs_deny\n");
{
  const c = detectPermissionConflicts({
    allow: ["read", "write"],
    deny: ["write", "exec"],
  });
  ok("1 conflict detected", c.length === 1);
  ok("conflict value is 'write'", c[0].value === "write");
}

// D. mergeHooks group-by-matcher + dedupe-by-command
process.stdout.write("D. mergeHooks group + dedupe\n");
{
  const { merged, conflicts } = mergeHooks(
    {
      Stop: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "echo a", timeout: 30 }],
        },
      ],
    },
    {
      Stop: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "echo b", timeout: 30 }],
        },
      ],
    },
  );
  ok("0 conflicts (different commands)", conflicts.length === 0);
  ok("Stop has 1 matcher entry", merged.Stop.length === 1);
  ok(
    "matcher * has 2 hooks (a + b)",
    merged.Stop[0].hooks.length === 2,
    JSON.stringify(merged.Stop),
  );
}

// E. mergeHooks conflict
process.stdout.write("E. mergeHooks conflict (same command, different fields)\n");
{
  const { conflicts } = mergeHooks(
    {
      Stop: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "echo a", timeout: 30 }],
        },
      ],
    },
    {
      Stop: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "echo a", timeout: 60 }],
        },
      ],
    },
  );
  ok("1 conflict detected", conflicts.length === 1);
  ok(
    "conflict kind correct",
    conflicts[0].kind === "hook_command_conflict",
  );
}

// F. End-to-end compile() defaults-only
process.stdout.write("F. compile() defaults-only\n");
{
  const fxDir = makeFixture("defaults-only");
  const defaultsPath = path.join(
    fxDir,
    "_mc",
    "settings",
    "defaults.json",
  );
  writeJson(defaultsPath, {
    env: { FRAMEWORK_VERSION: "0.0.0-test" },
    permissions: { allow: ["read"], deny: [] },
    hooks: {},
  });
  const r = compile({
    root: fxDir,
    defaultsPath,
    outPath: path.join(fxDir, ".claude", "settings.json"),
    localPath: path.join(fxDir, ".claude", "settings.local.json"),
  });
  ok("compile ok", r.ok, r.error);
  const outContent = JSON.parse(
    fs.readFileSync(path.join(fxDir, ".claude", "settings.json"), "utf8"),
  );
  ok("env preserved", outContent.env.FRAMEWORK_VERSION === "0.0.0-test");
  ok(
    "permissions populated",
    JSON.stringify(outContent.permissions.allow) === '["read"]',
  );
  ok("_compiledBy set", typeof outContent._compiledBy === "string");
  cleanup(fxDir);
}

// G. End-to-end compile() with local override
process.stdout.write("G. compile() with local override\n");
{
  const fxDir = makeFixture("with-local");
  const defaultsPath = path.join(
    fxDir,
    "_mc",
    "settings",
    "defaults.json",
  );
  const localPath = path.join(fxDir, ".claude", "settings.local.json");
  writeJson(defaultsPath, {
    env: { FRAMEWORK: "default" },
    permissions: { allow: ["read"], deny: [] },
    hooks: {
      Stop: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "framework-default" }],
        },
      ],
    },
  });
  writeJson(localPath, {
    env: { LOCAL_FLAG: "x" },
    permissions: { allow: ["write"] },
    hooks: {
      Stop: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "project-override" }],
        },
      ],
    },
  });
  const r = compile({
    root: fxDir,
    defaultsPath,
    localPath,
    outPath: path.join(fxDir, ".claude", "settings.json"),
  });
  ok("compile ok", r.ok, r.error);
  const out = JSON.parse(
    fs.readFileSync(path.join(fxDir, ".claude", "settings.json"), "utf8"),
  );
  ok("env merged (default + local)", out.env.FRAMEWORK === "default" && out.env.LOCAL_FLAG === "x");
  ok(
    "permissions union",
    out.permissions.allow.includes("read") && out.permissions.allow.includes("write"),
  );
  ok(
    "hooks merged (2 commands)",
    out.hooks.Stop[0].hooks.length === 2,
    JSON.stringify(out.hooks),
  );
  cleanup(fxDir);
}

// H. --check stale detection
process.stdout.write("H. --check stale detection\n");
{
  const fxDir = makeFixture("check-stale");
  const defaultsPath = path.join(
    fxDir,
    "_mc",
    "settings",
    "defaults.json",
  );
  const outPath = path.join(fxDir, ".claude", "settings.json");
  writeJson(defaultsPath, { env: { K: "v1" }, permissions: {}, hooks: {} });
  // Pre-write a STALE out
  writeJson(outPath, { env: { K: "stale" } });
  const r = compile({ root: fxDir, defaultsPath, outPath, check: true });
  ok("check detects stale", r.stale === true);
  ok("check exits 1", r.code === 1);
  // Now compile for real
  const r2 = compile({ root: fxDir, defaultsPath, outPath });
  ok("compile ok after stale", r2.ok);
  const r3 = compile({ root: fxDir, defaultsPath, outPath, check: true });
  ok("check now ok", r3.ok && r3.code === 0);
  cleanup(fxDir);
}

// I. Conflict short-circuit
process.stdout.write("I. conflict short-circuit (no write)\n");
{
  const fxDir = makeFixture("conflict");
  const defaultsPath = path.join(
    fxDir,
    "_mc",
    "settings",
    "defaults.json",
  );
  const localPath = path.join(fxDir, ".claude", "settings.local.json");
  const outPath = path.join(fxDir, ".claude", "settings.json");
  writeJson(defaultsPath, {
    permissions: { allow: ["x"], deny: [] },
    hooks: {},
  });
  writeJson(localPath, {
    permissions: { deny: ["x"] }, // CONFLICT
  });
  const r = compile({ root: fxDir, defaultsPath, localPath, outPath });
  ok("conflict detected", !r.ok);
  ok("conflict exit 1", r.code === 1);
  ok(
    "conflict surfaces allow_vs_deny",
    r.conflicts.some((c) => c.kind === "allow_vs_deny" && c.value === "x"),
  );
  ok("no file written on conflict", !fs.existsSync(outPath));
  cleanup(fxDir);
}

process.stdout.write(`\nResults: ${pass} passed, ${fail} failed.\n`);
if (fail > 0) process.exit(1);
