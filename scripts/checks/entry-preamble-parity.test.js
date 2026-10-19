#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const { spawnSync } = require("child_process");

const { runParity, CANONICAL_REL, FILES } = require("./entry-preamble-parity.js");
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

t("live control: the real shipped repo is clean", () => {
  const { findings } = runParity({});
  assert.strictEqual(findings.length, 0, "expected zero findings on shipped bytes, got " + JSON.stringify(findings));
});

t("a clean fixture copy is GREEN", () => {
  const root = makeFixture();
  try {
    const { findings } = runParity({ repoRoot: root });
    assert.strictEqual(findings.length, 0, JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

t("one-character semantic edit inside a region -> drift finding", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    const beginIdx = txt.indexOf("BEGIN v1 -->");
    const cut = txt.indexOf("MC", beginIdx);
    assert.ok(cut > beginIdx, "fixture precondition: MC inside region");
    txt = txt.slice(0, cut) + "McOX" + txt.slice(cut + "MC".length);
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    const f = findingFor(findings, "CODEX.md");
    assert.ok(f && /drift|mismatch/i.test(f.reason), "expected a drift finding for CODEX.md, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

t("pure CRLF reformat of a region stays GREEN", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "ANTIGRAVITY.md");
    const txt = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, txt.replace(/\n/g, "\r\n"));
    const { findings } = runParity({ repoRoot: root });
    assert.ok(!findingFor(findings, "ANTIGRAVITY.md"), "CRLF reformat must not drift: " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

t("trailing blank line inside a region stays GREEN", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    txt = txt.replace(/(\n<!--\s*MC:ENTERING-AGENT-PREAMBLE:END)/, "\n\n\n$1");
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    assert.ok(!findingFor(findings, "CODEX.md"), "trailing-blank-line reformat must not drift: " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

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

t("oversized shim delta (full-entry tier) -> finding", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    const txt = fs.readFileSync(p, "utf8");
    const filler = ("\nfiller line well beyond the full-entry tier bound ".padEnd(80, "x")).repeat(140);
    fs.writeFileSync(p, txt + filler);
    const { findings } = runParity({ repoRoot: root });
    const f = findingFor(findings, "CODEX.md");
    assert.ok(f && /oversized/i.test(f.reason), "expected an oversized finding, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

t("absent shared region (markers stripped) -> finding", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    const txt = fs.readFileSync(p, "utf8").replace(/<!--\s*MC:ENTERING-AGENT-PREAMBLE:(?:BEGIN[^>]*|END)\s*-->/g, "");
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    const f = findingFor(findings, "CODEX.md");
    assert.ok(f && /region|BEGIN|END/i.test(f.reason), "expected a no-region finding, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

t("bytes appended to a marker line -> finding (no silent escape)", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    txt = txt.replace(/(<!--\s*MC:ENTERING-AGENT-PREAMBLE:BEGIN[^>]*-->)/, "$1 SNEAKY-APPENDED-BYTES");
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    assert.ok(findingFor(findings, "CODEX.md"), "appended bytes on a marker line must be caught, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

t("bytes before --> inside a marker -> finding (exact-marker match)", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    txt = txt.replace(
      /<!--\s*MC:ENTERING-AGENT-PREAMBLE:BEGIN v1\s*-->/,
      "<!-- MC:ENTERING-AGENT-PREAMBLE:BEGIN v1 IGNORE-CANONICAL -->",
    );
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    assert.ok(findingFor(findings, "CODEX.md"), "bytes before --> inside the marker must be caught, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

t("a second marked block -> finding (multi-pair not ignored)", () => {
  const root = makeFixture();
  try {
    const p = path.join(root, "CODEX.md");
    let txt = fs.readFileSync(p, "utf8");
    txt += "\n\n<!-- MC:ENTERING-AGENT-PREAMBLE:BEGIN v1 -->\nCONTRADICTORY SECOND BLOCK\n<!-- MC:ENTERING-AGENT-PREAMBLE:END -->\n";
    fs.writeFileSync(p, txt);
    const { findings } = runParity({ repoRoot: root });
    const f = findingFor(findings, "CODEX.md");
    assert.ok(f && /exactly one|BEGIN|END/i.test(f.reason), "a second marked block must be a finding, got " + JSON.stringify(findings));
  } finally {
    rmrf(root);
  }
});

t("sole-oracle: mutating ONLY canonical makes every embedder mismatch", () => {
  const root = makeFixture();
  try {
    const cp = path.join(root, CANONICAL_REL);
    let txt = fs.readFileSync(cp, "utf8");
    const beginIdx = txt.indexOf("BEGIN v1 -->");
    const cut = txt.indexOf("MC", beginIdx);
    txt = txt.slice(0, cut) + "McOX" + txt.slice(cut + "MC".length);
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

t("CLI spawn exits 2 when canonical is unreadable (fail-closed)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epp-cli-"));
  try {
    const dstScript = path.join(root, "scripts", "checks", "entry-preamble-parity.js");
    fs.mkdirSync(path.dirname(dstScript), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "entry-preamble-parity.js"), dstScript);
    const r = spawnSync(process.execPath, [dstScript], { encoding: "utf8" });
    assert.strictEqual(r.status, 2, "expected exit 2 (fail-closed), got " + r.status + " / " + (r.stderr || r.stdout));
  } finally {
    rmrf(root);
  }
});

console.log("\n" + pass + "/" + (pass + fail) + " passed");
process.exit(fail ? 1 : 0);
