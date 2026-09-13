#!/usr/bin/env node
// AC-R2c — forwarder frontmatter declares namespace + reads; in_app forwarder defers run-context to the target.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");

let p = 0, f = 0;
function ok(n, fn) { try { fn(); p++; console.log("  ok  " + n); } catch (e) { f++; console.log("FAIL  " + n + "\n      " + e.message); } }
function full(fwd) { return fs.readFileSync(path.join(ROOT, ".claude", "commands", "panel", fwd + ".md"), "utf8"); }
function fm(fwd) { const m = full(fwd).match(/^---([\s\S]*?)---/); return m ? m[1] : ""; }

ok("forwarder-frontmatter-declares-namespace-reads-and-defers-runcontext-to-target", () => {
  for (const name of ["readiness", "models", "admin", "roadmap", "list"]) {
    const front = fm(name);
    assert.ok(/user-invocable:\s*true/.test(front), `${name} declares user-invocable: true`);
    assert.ok(/namespace:\s*panel/.test(front), `${name} declares namespace: panel`);
    assert.ok(/panel-registry\.json/.test(front), `${name} lists the registry under reads`);
  }
  // admin (in_app) inherits the run-in-product refusal from the keystone — it never asserts its own.
  const admin = full("admin");
  assert.ok(/keystone[\s\S]*owns that refusal|never\b[\s\S]*MC itself/i.test(admin),
    "admin forwarder defers the MC-refusal to the keystone (does not re-assert it)");
});

console.log(`\nforwarders-frontmatter: ${p}/${p + f} pass`);
process.exit(f ? 1 : 0);
