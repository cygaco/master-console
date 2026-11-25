#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const REAL_REG = path.join(ROOT, "..", ".claude", "agents", "_org", "role-registry.json");
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

function seededProject(regText, manifestText) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "da-fc-proj-"));
  const regDir = path.join(proj, ".claude", "agents", "_org");
  fs.mkdirSync(regDir, { recursive: true });
  if (regText !== null) fs.writeFileSync(path.join(regDir, "role-registry.json"), regText);
  if (manifestText !== undefined) fs.writeFileSync(path.join(proj, ".claude", "manifest.json"), manifestText);
  return proj;
}
const BAD_MANIFEST = JSON.stringify({ agentProviders: 5 });
function openaiRole(reg) {
  return Object.keys(reg.roles).find((k) => reg.roles[k].build_chain !== true && reg.roles[k].provider !== "claude" && reg.roles[k].kind === "reviewer");
}
function dispatch(proj, role) {
  const promptFile = path.join(proj, "p.md");
  fs.writeFileSync(promptFile, "hello");
  const r = spawnSync(process.execPath, [path.join(ROOT, "dispatch-agent.js"), role, promptFile], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj, DISPATCH_LEDGER_DIR: path.join(proj, "ledger") },
    encoding: "utf8",
    timeout: 60000,
  });
  const line = `${r.stdout}\n${r.stderr}`.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)[0];
  return { status: r.status, out: line || {}, raw: `${r.stdout}${r.stderr}` };
}
const realReg = () => JSON.parse(fs.readFileSync(REAL_REG, "utf8").replace(/^﻿/, ""));

test("item1: openai-pinned reviewer whose pin read throws → dispatch REFUSES (not a claude run)", () => {
  const reg = realReg();
  const role = openaiRole(reg);
  assert.ok(role, "no openai reviewer in registry");
  const r = dispatch(seededProject(JSON.stringify(reg), BAD_MANIFEST), role);
  assert.strictEqual(r.out.ok, false, r.raw);
  assert.strictEqual(r.out.code, "provider-pin-unreadable", r.raw);
  assert.notStrictEqual(r.status, 0);
});

test("item1: hook caller (getProviderForRole) on a throw → still 'claude'; strict throws", () => {
  const reg = realReg();
  const role = openaiRole(reg);
  const proj = seededProject(JSON.stringify(reg), BAD_MANIFEST);
  const code = `const p=require(${JSON.stringify(path.join(ROOT, "hooks", "lib", "providers.js"))});
    let strict="no-throw"; try{p.providerForRoleStrict(${JSON.stringify(role)});}catch{strict="threw";}
    console.log(JSON.stringify({hook:p.getProviderForRole(${JSON.stringify(role)}),strict}));`;
  const r = spawnSync(process.execPath, ["-e", code], { env: { ...process.env, CLAUDE_PROJECT_DIR: proj }, encoding: "utf8" });
  const o = JSON.parse(r.stdout.trim().split(String.fromCharCode(10)).pop().trim());
  assert.strictEqual(o.hook, "claude");
  assert.strictEqual(o.strict, "threw");
});

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`FAIL ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`PASS ${passed} passed`);
