#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// preview-failclear.test.js — SP-20260614-002 S-1 / AC-R1c.
//
// Two bindings:
//   1. ::resolved-target-mc-root-refused-precondition — if the resolved
//      target is the MC canonical tree (path match, OR a canonical signal via
//      the shared resolver's isCanonicalDir: _mc/MANIFEST.json /
//      mc.source==="self" / project.slug==="mc" / version.json#name —
//      NOTE a consumer's own mc install-record block, source != "self", is
//      NOT a signal), refuseIfTargetIsMC refuses BEFORE any scaffold/boot,
//      and run() returns non-ok with no side effects. (ED-009: detection routed
//      through scripts/mc/repo-role.js; β DECIDE 0.88, session/2026-06-15.)
//   2. ::missing-precondition-exact-message-nonzero — preconditions fail CLEAR
//      with the exact missing step + remediation, exiting non-zero (no silent
//      hang, no open against a dead server, no orphaned child).
//
// Seam: the dev-server/scaffold are NOT spawned here — we drive the pure guard
// + the run() MC short-circuit, and assert the failure-message contracts
// from the source for the timeout/install paths (no real npm run dev in corpus).
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const preview = require("../../../scripts/admin/preview");
const PREVIEW_SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "scripts", "admin", "preview.js"),
  "utf8",
);

let pass = 0;
let fail = 0;
async function ok(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `admin-preview-${label}-`));
}

async function main() {
  // ── refusal: WARPOS_ROOT by path equality ──────────────────────────────────
  await ok("resolved-target-mc-root-refused-precondition: path equality refuses", () => {
    const g = preview.refuseIfTargetIsMC(preview.WARPOS_ROOT);
    assert.strictEqual(g.refuse, true, "the canonical root must be refused by path");
    assert.ok(/canonical root/i.test(g.reason), "reason names the canonical root");
  });

  // ── NOT refused: a consumer's own mc install-record block ──────────────
  // EVERY scaffolded consumer carries a top-level `mc:{...,source:<provenance>}`
  // block (scaffold-core.js:542) — refusing on its mere PRESENCE would refuse the
  // very products admin:preview targets (the latent over-refusal bug ED-053's
  // deferred live run never hit). Detection now flows through the shared resolver's
  // signals-only isCanonicalDir (ED-009): a consumer block (source != "self") is
  // NOT a canonical signal, so it is NOT refused. (β DECIDE 0.88.)
  await ok("consumer mc: block (source != self, slug != mc) is NOT refused", () => {
    const dir = tmpDir("mc-consumer-block");
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude", "manifest.json"),
      JSON.stringify({ project: { slug: "someproduct" }, mc: { version: "x", installed: true, source: "github:acme/someproduct" } }),
    );
    const g = preview.refuseIfTargetIsMC(dir);
    assert.strictEqual(g.refuse, false, "a consumer's own mc install-record must NOT be refused");
  });

  // ── refusal: manifest mc.source === "self" (the canonical self-identity) ─
  // Signal 3c — the field that distinguishes the canonical dev repo from a
  // consumer (consumers carry source:<provenance>, the dev repo carries "self").
  await ok("manifest mc.source==='self' refuses (canonical self-identity)", () => {
    const dir = tmpDir("mc-self");
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude", "manifest.json"),
      JSON.stringify({ project: { slug: "someproduct" }, mc: { source: "self" } }),
    );
    const g = preview.refuseIfTargetIsMC(dir);
    assert.strictEqual(g.refuse, true, "mc.source==='self' is the canonical self-identity → refuse");
    assert.ok(/canonical (tree|signal|root)/i.test(g.reason), "reason names the canonical detection");
  });

  // ── refusal: project.slug === "mc" ─────────────────────────────────────
  await ok("manifest project.slug==='mc' refuses", () => {
    const dir = tmpDir("mc-slug");
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude", "manifest.json"),
      JSON.stringify({ project: { slug: "mc" } }),
    );
    const g = preview.refuseIfTargetIsMC(dir);
    assert.strictEqual(g.refuse, true, "project.slug==='mc' must be refused");
    assert.ok(/canonical (tree|signal|root)/i.test(g.reason), "reason names the canonical detection");
  });

  // ── NOT refused: ordinary product, no mc markers ───────────────────────
  await ok("ordinary product instance is NOT refused (no getWarpProduct false-positive)", () => {
    const dir = tmpDir("product-ok");
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude", "manifest.json"),
      JSON.stringify({ project: { slug: "admin-preview-instance" } }),
    );
    const g = preview.refuseIfTargetIsMC(dir);
    assert.strictEqual(g.refuse, false, "an ordinary product must NOT be refused");
  });

  // ── run(): MC target → non-ok, no side effects, exact remediation ──────
  await ok("run() refuses a MC-root target before any scaffold (no side effects)", async () => {
    const res = await preview.run(["--instance-dir", preview.WARPOS_ROOT]);
    assert.strictEqual(res.ok, false, "run() must fail on a MC target");
    assert.ok(
      /refusing to preview the MC canonical root/i.test(res.error),
      "fail-clear message names the refusal",
    );
    assert.ok(
      /targets a PRODUCT app, never MC itself/i.test(res.error),
      "remediation states the boundary",
    );
  });

  // ── exact missing-precondition messages exist in the source ────────────────
  await ok("missing-precondition-exact-message-nonzero: npm install failure names dir + remediation", () => {
    assert.ok(
      /npm install failed in \$\{instanceDir\}[\s\S]*Remediation:/.test(PREVIEW_SRC),
      "install failure must name the dir + a remediation",
    );
  });
  await ok("dev-server timeout fails clear (port busy / build error) + never orphans", () => {
    assert.ok(
      /dev server not ready within 90s[\s\S]*port busy or a build error/.test(PREVIEW_SRC),
      "timeout message names the missing step",
    );
    assert.ok(/killChild\(\); \/\/ kill on timeout/.test(PREVIEW_SRC), "timeout kills the child (no orphan)");
  });
  await ok("CLI exits non-zero on a failed run (process.exit(1))", () => {
    assert.ok(/process\.exit\(1\)/.test(PREVIEW_SRC), "failure path exits non-zero");
  });

  console.log(`\npreview-failclear: ${pass}/${pass + fail} pass`);
  process.exit(fail ? 1 : 0);
}

main();
