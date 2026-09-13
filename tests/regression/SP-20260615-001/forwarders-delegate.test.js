#!/usr/bin/env node
// AC-R2a/R2b [β-2] — forwarders DELEGATE to the canonical opener; zero duplicated opener logic.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, "framework", "panel-registry.json"), "utf8"));

let p = 0, f = 0;
function ok(n, fn) { try { fn(); p++; console.log("  ok  " + n); } catch (e) { f++; console.log("FAIL  " + n + "\n      " + e.message); } }
function body(fwd) { return fs.readFileSync(path.join(ROOT, ".claude", "commands", "panel", fwd + ".md"), "utf8").replace(/^---[\s\S]*?---/, ""); }

ok("each-forwarder-delegates-no-duplicated-opener-logic", () => {
  for (const name of ["readiness", "models", "admin", "roadmap"]) {
    const b = body(name);
    const opener = REG.panels[name].opener;
    assert.ok(b.includes(opener), `${name} forwarder names its opener (${opener})`);
    const lines = b.split(/\n/).filter((l) => l.trim()).length;
    assert.ok(lines <= 20, `${name} forwarder is thin (${lines} non-blank body lines <= 20)`);
    const codeBlocks = (b.match(/```/g) || []).length / 2;
    assert.ok(codeBlocks <= 1, `${name} forwarder has <= 1 code block (no reproduced multi-step logic) — got ${codeBlocks}`);
    if (/^node\s+/.test(opener)) {
      // Count the full `node <script>` INVOCATION (not bare path mentions in prose —
      // a forwarder may legitimately reference the target script in documentation).
      const re = new RegExp(opener.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      assert.strictEqual((b.match(re) || []).length, 1, `${name} invokes "${opener}" exactly once (delegated, not duplicated)`);
    }
  }
});

ok("forwarder-references-target-by-name-only-survives-target-internal-change", () => {
  const admin = body("admin");
  assert.ok(!/refuseIfTargetIsMC|resolveOrScaffold|detectReady|READY_SIGNAL/.test(admin),
    "admin forwarder does NOT reproduce keystone internals (defers to it)");
  for (const name of ["readiness", "models", "admin", "roadmap"]) {
    const b = body(name);
    assert.ok(!/fs\.readFileSync|JSON\.parse|spawnSync|require\(/.test(b),
      `${name} forwarder contains NO implementation code (pure delegation — survives target internal change)`);
  }
});

console.log(`\nforwarders-delegate: ${p}/${p + f} pass`);
process.exit(f ? 1 : 0);
