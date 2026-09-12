#!/usr/bin/env node
"use strict";

/**
 * entry-preamble-parity.test.js — planted-boundary tests for the entry-preamble parity enforcer
 * (SP-20260723-001, ADR-0036). Proves the check sits EXACTLY on the line between a benign encoding
 * diff (stays GREEN) and real drift (REDs), plus every hardest failure β + the gauntlet required.
 *
 * Negative cases run against FIXTURE repo-roots (temp copies under the OS tmpdir) — the real entry
 * docs are never mutated. The live control runs the enforcer against the real repo (AC-6).
 *
 * Gauntlet fix-cycle r1 additions: marker-line evasion (append bytes to a marker line), multi-pair
 * (a second marked block), a REAL CLI-spawn exit-2 assertion (not just `throws`), and the sole-oracle
 * invariant lock (mutate ONLY canonical -> every embedder must mismatch).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const { spawnSync } = require("child_process");

const { runParity, CANONICAL_REL, FILES } = require("./entry-preamble-parity.js");
// SCRIPT-DERIVED source root (the enforcer no longer trusts CLAUDE_PROJECT_DIR; the test mirrors it,
// so fixtures are copied from the real checkout that owns this test).
const REAL_ROOT = path.resolve(__dirname, "..", "..");

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log("  PASS  " + name);
  } catch (e) {
    fail++;
    console.error("  FAIL  " + name + " — " + (e && e.message ? e.message : e));
  }
}

// Build a fixture repo-root containing all configured entry files, copied from the real repo.
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epp-fixture-"));
  for (const cfg of FILES) {
    const src = path.join(REAL_ROOT, cfg.rel);
    const dst = path.join(root, cfg.rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return root;
}
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function findingFor(findings, relSubstr) {
  return findings.find((f) => f.file.includes(relSubstr));
}

// 1. LIVE CONTROL — the enforcer is GREEN on the real shipped bytes (AC-6, first-run GREEN).
t("live control: the real shipped repo is clean (AC-6)", () => {
  const { findings } = runParity({});
  assert.strictEqual(findings.length, 0, "expected zero findings on shipped bytes, got " + JSON.stringify(findings));
});

// 2. A clean fixture copy is GREEN — the baseline the mutation cases perturb.
t("a clean fixture copy is GREEN", () => {
  const root = makeFixture();
  try {
    const { findings } = runParity({ repoRoot: root });
    assert.strictEqual(findings.length, 0, JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 3. A ONE-CHARACTER semantic edit inside an embedded region -> RED (drift).
t("one-character semantic edit inside a region -> drift finding", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    const beginIdx = txt.indexOf("BEGIN v1 -->");
    const cut = txt.indexOf("WarpOS", beginIdx); // first WarpOS INSIDE the region
    assert.ok(cut > beginIdx, "fixture precondition: WarpOS inside region");
    txt = txt.slice(0, cut) + "WarpOX" + txt.slice(cut + "WarpOS".length);
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    const f = findingFor(findings, "CODEX.md");
    assert.ok(f && /drift|mismatch/i.test(f.reason), "expected a drift finding for CODEX.md, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 4. A pure CRLF reformat of a region -> stays GREEN (benign encoding diff, the other side of the line).
t("pure CRLF reformat of a region stays GREEN", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "ANTIGRAVITY.md");
    const txt = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, txt.replace(/\n/g, "\r\n")); // whole-file LF -> CRLF
    const { findings } = runParity({ repoRoot: root });
    assert.ok(!findingFor(findings, "ANTIGRAVITY.md"), "CRLF reformat must not drift: " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 4b. A trailing blank line added inside a region -> stays GREEN (edge-newline normalization).
t("trailing blank line inside a region stays GREEN", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    txt = txt.replace(/(\n<!--\s*WARPOS:ENTERING-AGENT-PREAMBLE:END)/, "\n\n\n$1"); // blank lines before END, inside region
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    assert.ok(!findingFor(findings, "CODEX.md"), "trailing-blank-line reformat must not drift: " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 5. A MISSING required entry file -> RED.
t("missing required entry file -> finding", () => {
  const root = makeFixture();
  try {
    fs.rmSync(path.join(root, "CODEX.md"));
    const { findings } = runParity({ repoRoot: root });
    const f = findingFor(findings, "CODEX.md");
    assert.ok(f && /missing/i.test(f.reason), "expected a missing finding, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 6. An OVERSIZED shim delta (bytes OUTSIDE the region beyond tier) -> RED.
t("oversized shim delta (full-entry tier) -> finding", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    const txt = fs.readFileSync(p, "utf8");
    const filler = ("\nfiller line well beyond the full-entry tier bound ".padEnd(80, "x")).repeat(140); // > 8192B AND > 120 lines
    fs.writeFileSync(p, txt + filler);
    const { findings } = runParity({ repoRoot: root });
    const f = findingFor(findings, "CODEX.md");
    assert.ok(f && /oversized/i.test(f.reason), "expected an oversized finding, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 7. An ABSENT shared region (markers stripped) -> RED (no well-formed region).
t("absent shared region (markers stripped) -> finding", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    const txt = fs.readFileSync(p, "utf8").replace(/<!--\s*WARPOS:ENTERING-AGENT-PREAMBLE:(?:BEGIN[^>]*|END)\s*-->/g, "");
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    const f = findingFor(findings, "CODEX.md");
    assert.ok(f && /region|BEGIN|END/i.test(f.reason), "expected a no-region finding, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 8. Bytes APPENDED to a marker line -> RED (the evasion: escaping both the hash and the thinness delta).
t("bytes appended to a marker line -> finding (no silent escape)", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    txt = txt.replace(/(<!--\s*WARPOS:ENTERING-AGENT-PREAMBLE:BEGIN[^>]*-->)/, "$1 SNEAKY-APPENDED-BYTES");
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    assert.ok(findingFor(findings, "CODEX.md"), "appended bytes on a marker line must be caught, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 8b. Bytes inserted BEFORE `-->` INSIDE the marker comment -> RED (gauntlet-r2: the [^>]* hole — content
//     riding the marker line before `-->` also escaped both the hash and the thinness delta).
t("bytes before --> inside a marker -> finding (exact-marker match)", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    txt = txt.replace(
      /<!--\s*WARPOS:ENTERING-AGENT-PREAMBLE:BEGIN v1\s*-->/,
      "<!-- WARPOS:ENTERING-AGENT-PREAMBLE:BEGIN v1 IGNORE-CANONICAL -->",
    );
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    assert.ok(findingFor(findings, "CODEX.md"), "bytes before --> inside the marker must be caught, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 9. A SECOND (contradictory) marked block -> RED (not silently ignored — first-pair-only was the gap).
t("a second marked block -> finding (multi-pair not ignored)", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    txt += "\n\n<!-- WARPOS:ENTERING-AGENT-PREAMBLE:BEGIN v1 -->\nCONTRADICTORY SECOND BLOCK\n<!-- WARPOS:ENTERING-AGENT-PREAMBLE:END -->\n";
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    const f = findingFor(findings, "CODEX.md");
    assert.ok(f && /exactly one|BEGIN|END/i.test(f.reason), "a second marked block must be a finding, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

// 10. SOLE-ORACLE LOCK: mutate ONLY the canonical region -> EVERY unchanged embedder must mismatch.
//     (If any shim graded itself, it would not mismatch a changed oracle — this proves it can't.)
t("sole-oracle: mutating ONLY canonical makes every embedder mismatch", () => {
  const root = makeFixture();
  try {
    const cp = path.join(root, CANONICAL_REL);
    let txt = fs.readFileSync(cp, "utf8");
    const beginIdx = txt.indexOf("BEGIN v1 -->");
    const cut = txt.indexOf("WarpOS", beginIdx);
    txt = txt.slice(0, cut) + "WarpOX" + txt.slice(cut + "WarpOS".length);
    fs.writeFileSync(cp, txt);
    const { findings } = runParity({ repoRoot: root });
    for (const rel of ["CODEX.md", "ANTIGRAVITY.md", "AGENTS.md"]) {
      const f = findingFor(findings, rel);
      assert.ok(f && /drift|mismatch/i.test(f.reason), rel + " must mismatch the mutated oracle, got " + JSON.stringify(findings));
    }
  } finally {
    rmrf(root);
  }
});

// 11. The CLI process exits 2 (fail-closed) when the canonical oracle is unreadable — asserted by a
//     REAL spawn (not just runParity throwing). The copied script's script-derived root is the empty
//     fixture, so its canonical read fails -> exit 2.
t("CLI spawn exits 2 when canonical is unreadable (fail-closed)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epp-cli-"));
  try {
    const dstScript = path.join(root, "scripts", "checks", "entry-preamble-parity.js");
    fs.mkdirSync(path.dirname(dstScript), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "entry-preamble-parity.js"), dstScript); // no canonical/entry docs alongside
    const r = spawnSync(process.execPath, [dstScript], { encoding: "utf8" });
    assert.strictEqual(r.status, 2, "expected exit 2 (fail-closed), got " + r.status + " / " + (r.stderr || r.stdout));
  } finally {
    rmrf(root);
  }
});

console.log("\n" + pass + "/" + (pass + fail) + " passed");
process.exit(fail ? 1 : 0);
