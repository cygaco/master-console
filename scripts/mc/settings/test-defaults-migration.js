#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULTS_FILE = path.join(REPO_ROOT, "_mc", "settings", "defaults.json");
const LOCAL_FILE = path.join(REPO_ROOT, ".claude", "settings.local.json");
const COMPILE_SCRIPT = path.join(__dirname, "compile.js");

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

function tmpFile(label) {
  return path.join(
    os.tmpdir(),
    `settings-defaults-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
}

function runCompile(args) {
  return spawnSync(process.execPath, [COMPILE_SCRIPT, ...args], { encoding: "utf8" });
}

ok("_mc/settings/defaults.json exists", fs.existsSync(DEFAULTS_FILE));

if (fs.existsSync(DEFAULTS_FILE)) {
  let defaults = null;
  try {
    defaults = JSON.parse(fs.readFileSync(DEFAULTS_FILE, "utf8"));
  } catch (e) {
    ok("defaults.json is valid JSON", false, e.message);
  }
  if (defaults) {
    ok("defaults.json is valid JSON", true);
    ok("defaults.json has hooks key", typeof defaults.hooks === "object");
    ok("defaults.json has env key", typeof defaults.env === "object");
    ok("defaults.json has permissions key", typeof defaults.permissions === "object");
    ok(
      "defaults.json env has CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
      defaults.env && defaults.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1",
    );
    ok(
      "defaults.json hooks has SessionStart",
      defaults.hooks && Array.isArray(defaults.hooks.SessionStart) && defaults.hooks.SessionStart.length > 0,
    );
    ok(
      "defaults.json hooks has UserPromptSubmit",
      defaults.hooks && Array.isArray(defaults.hooks.UserPromptSubmit) && defaults.hooks.UserPromptSubmit.length > 0,
    );
  }
}

if (fs.existsSync(DEFAULTS_FILE)) {
  const out = tmpFile("compile-c");
  try {
    const compileArgs = ["--defaults", DEFAULTS_FILE, "--out", out];
    if (fs.existsSync(LOCAL_FILE)) {
      compileArgs.push("--local", LOCAL_FILE);
    }
    const r = runCompile(compileArgs);
    ok("compile exit 0", r.status === 0, `stderr: ${r.stderr}`);
    if (r.status === 0) {
      const compiled = JSON.parse(fs.readFileSync(out, "utf8"));
      ok("compiled output is valid JSON", true);
      ok("compiled output has hooks", typeof compiled.hooks === "object");
      ok("compiled output has env", typeof compiled.env === "object");
      ok("compiled output has permissions", typeof compiled.permissions === "object");
      ok(
        "compiled output has _compiledAt metadata",
        typeof compiled._compiledAt === "string",
      );
      ok(
        "compiled output has _compiledBy metadata",
        typeof compiled._compiledBy === "string",
      );
    }
  } finally {
    try { fs.unlinkSync(out); } catch {}
  }
}

if (fs.existsSync(DEFAULTS_FILE)) {
  const out1 = tmpFile("compile-d1");
  const out2 = tmpFile("compile-d2");
  try {
    const compileArgs = (out) => {
      const args = ["--defaults", DEFAULTS_FILE, "--out", out];
      if (fs.existsSync(LOCAL_FILE)) args.push("--local", LOCAL_FILE);
      return args;
    };
    runCompile(compileArgs(out1));
    runCompile(compileArgs(out2));
    const c1 = JSON.parse(fs.readFileSync(out1, "utf8"));
    const c2 = JSON.parse(fs.readFileSync(out2, "utf8"));
    delete c1._compiledAt;
    delete c2._compiledAt;
    ok(
      "compile is idempotent (modulo _compiledAt)",
      JSON.stringify(c1) === JSON.stringify(c2),
    );
  } finally {
    try { fs.unlinkSync(out1); } catch {}
    try { fs.unlinkSync(out2); } catch {}
  }
}

if (fs.existsSync(DEFAULTS_FILE)) {
  const out = tmpFile("compile-e");
  try {
    const compileArgs = ["--defaults", DEFAULTS_FILE, "--out", out];
    if (fs.existsSync(LOCAL_FILE)) compileArgs.push("--local", LOCAL_FILE);
    runCompile(compileArgs);
    const checkArgs = [...compileArgs, "--check"];
    const r = runCompile(checkArgs);
    ok(
      "--check on freshly-compiled file exits 0",
      r.status === 0,
      `got ${r.status}: ${r.stderr}\n${r.stdout}`,
    );
  } finally {
    try { fs.unlinkSync(out); } catch {}
  }
}

if (fs.existsSync(DEFAULTS_FILE) && fs.existsSync(LOCAL_FILE)) {
  const out = tmpFile("compile-g");
  try {
    const local = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
    const localAllowList = (local.permissions && local.permissions.allow) || [];
    const compileArgs = ["--defaults", DEFAULTS_FILE, "--out", out, "--local", LOCAL_FILE];
    const r = runCompile(compileArgs);
    if (r.status === 0) {
      const compiled = JSON.parse(fs.readFileSync(out, "utf8"));
      const compiledAllow = (compiled.permissions && compiled.permissions.allow) || [];
      for (const item of localAllowList) {
        ok(
          `operator override "${item}" present in compiled permissions.allow`,
          compiledAllow.includes(item),
        );
      }
    }
  } finally {
    try { fs.unlinkSync(out); } catch {}
  }
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
