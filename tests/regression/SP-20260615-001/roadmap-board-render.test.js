#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// roadmap-board-render.test.js — SP-20260615-001 S-4 / AC-R4a (as amended
// 2026-09-16, S-OS-06 r4 lane H, β verdict 7d3e9f51 / betaEvents row 475).
//
// ::renders-board-from-four-live-sources-reads-only
//   The four sources are NOT alike, and the test is SPLIT BY SOURCE AVAILABILITY:
//
//   (a) TRACKED sources — ROADMAP.md, TRACKER.md, active-sprints.yaml. A clean
//       checkout carries them, so the generator runs against the REAL repo (its
//       own default root, no --root, no root env override) and the test asserts
//       each of those sections resolved HEALTHY and cites its source. This is the
//       "do the board's configured source paths still resolve against the real
//       tree" regression class. The assertion keys on the healthy-path provenance
//       line inside the section body, NOT a bare filename anywhere in the output:
//       a missing source's "section unavailable" reason can itself contain the
//       filename (e.g. "active-sprints.yaml not found"), which a bare regex would
//       read as a pass.
//
//   (b) RUNTIME registers — .claude/project/memory/enforcement-debt.jsonl +
//       recurring-issues.jsonl. These are gitignored (.gitignore
//       `.claude/project/memory/`), owner:runtime registers a clean checkout can
//       NEVER have. A test that asserts a state must create that state: a fixture
//       root WRITES the two registers (and copies the three tracked sources in),
//       the generator renders it through its existing `--root` seam, and the test
//       asserts all four are cited and the gaps section reports the FIXTURE's open
//       counts (proving the citation came from reading the fixture).
//
//   Read-only PROOF, both runs: snapshot size+mtime+sha of every source file
//   before and after; assert NONE changed and none was created (the generator
//   writes only its own stdout, never a source file).
//
//   Removed environment assumption (why the split): the pre-amendment test ran
//   ONLY against the real repo and asserted enforcement-debt provenance, so it
//   passed only on a machine that happened to carry the gitignored registers and
//   failed in every clean checkout (CI included). Authored 2026-06-14; first
//   surfaced when `npm test` was wired into CI on 2026-09-12.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "panel", "roadmap.js");
const mcEnv = require(path.join(ROOT, "scripts", "hooks", "lib", "mc-env.js"));

// The live sources the board reads (AC-R4a), split by source availability.
const REL_TRACKED = {
  roadmap: "ROADMAP.md",
  tracker: "TRACKER.md",
  sprints: path.join(".claude", "project", "sprint", "active-sprints.yaml"),
};
const REL_REGISTERS = {
  debt: path.join(".claude", "project", "memory", "enforcement-debt.jsonl"),
  issues: path.join(".claude", "project", "memory", "recurring-issues.jsonl"),
};
const REL_ALL = [...Object.values(REL_TRACKED), ...Object.values(REL_REGISTERS)];

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

function snapshot(file) {
  if (!fs.existsSync(file)) return { exists: false };
  const buf = fs.readFileSync(file);
  const st = fs.statSync(file);
  return {
    exists: true,
    size: st.size,
    mtimeMs: st.mtimeMs,
    sha: crypto.createHash("sha256").update(buf).digest("hex"),
  };
}

function assertUnchanged(files, before, after) {
  for (let i = 0; i < files.length; i++) {
    const b = before[i];
    const a = after[i];
    assert.strictEqual(a.exists, b.exists, `${files[i]} existence flipped`);
    if (!b.exists) continue;
    assert.strictEqual(a.sha, b.sha, `${files[i]} CONTENT changed (sha differs)`);
    assert.strictEqual(a.size, b.size, `${files[i]} SIZE changed`);
    assert.strictEqual(a.mtimeMs, b.mtimeMs, `${files[i]} MTIME changed (was written)`);
  }
}

// Section body — the text between a `## <heading>` line and the next `## ` line.
function sectionBody(board, heading) {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, "m");
  const m = re.exec(board);
  if (!m) return null;
  const rest = board.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+\S/m);
  return next === -1 ? rest : rest.slice(0, next);
}

// A section resolved from its source: present, not degraded, and carrying the
// healthy-path provenance line for that source.
function assertResolvedWithProvenance(board, heading, provenance, label) {
  const body = sectionBody(board, heading);
  assert.ok(body !== null, `missing '## ${heading}' section`);
  assert.ok(!/section unavailable/i.test(body), `${label} did not resolve — got:\n${body}`);
  assert.ok(provenance.test(body), `no ${label} provenance in '## ${heading}' — got:\n${body}`);
}

// The fixture's own open-gaps registers: 2 open + 1 closed debt, 1 open + 1 closed issue.
const FIXTURE_DEBT = [
  { id: "ED-FIXTURE-1", status: "open", policy: "fixture open debt one" },
  { id: "ED-FIXTURE-2", status: "open", policy: "fixture open debt two" },
  { id: "ED-FIXTURE-3", status: "closed", policy: "fixture closed debt" },
];
const FIXTURE_ISSUES = [
  { id: "RI-FIXTURE-1", status: "open", title: "fixture open issue" },
  { id: "RI-FIXTURE-2", status: "resolved", title: "fixture resolved issue" },
];
const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

function makeFixtureRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-render-"));
  fs.mkdirSync(path.join(dir, ".claude", "project", "sprint"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".claude", "project", "memory"), { recursive: true });
  // Tracked sources: a clean checkout carries these — copy them from the real tree.
  for (const rel of Object.values(REL_TRACKED)) {
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  // Runtime registers: a clean checkout never carries these — the fixture WRITES
  // them (never copied from the host, so the outcome cannot vary with host state).
  fs.writeFileSync(path.join(dir, REL_REGISTERS.debt), toJsonl(FIXTURE_DEBT));
  fs.writeFileSync(path.join(dir, REL_REGISTERS.issues), toJsonl(FIXTURE_ISSUES));
  return dir;
}

// The child env for the REAL-tree run: drop any roadmap-root override (current +
// legacy name) so the generator provably reads its own default root.
function realTreeEnv() {
  const env = { ...process.env };
  const { current, legacy } = mcEnv.envNames("ROADMAP_ROOT");
  delete env[current];
  delete env[legacy];
  return env;
}

function main() {
  // ══ (a) REAL repo — the tracked sources a clean checkout carries ═══════════
  const realFiles = REL_ALL.map((rel) => path.join(ROOT, rel));
  const realBefore = realFiles.map(snapshot);
  const real = execFileSync("node", [SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    env: realTreeEnv(),
  });
  const realAfter = realFiles.map(snapshot);

  ok("board renders the NEXT ACTION section", () => {
    assert.ok(/^##\s+NEXT ACTION\s*$/m.test(real), "missing '## NEXT ACTION' section");
  });
  ok("board renders the Ranked next (Prioritized) section", () => {
    assert.ok(
      /^##\s+Ranked next \(Prioritized\)\s*$/m.test(real),
      "missing '## Ranked next (Prioritized)' section",
    );
  });
  ok("board renders the In flight section", () => {
    assert.ok(/^##\s+In flight\s*$/m.test(real), "missing '## In flight' section");
  });
  ok("board renders the Open gaps / blockers section", () => {
    assert.ok(
      /^##\s+Open gaps \/ blockers\s*$/m.test(real),
      "missing '## Open gaps / blockers' section",
    );
  });
  ok("REAL tree: the three tracked sources resolve and are cited (TRACKER.md, ROADMAP.md, active-sprints.yaml)", () => {
    assertResolvedWithProvenance(real, "NEXT ACTION", /_\(source: TRACKER\.md -> /, "TRACKER.md");
    assertResolvedWithProvenance(real, "Ranked next (Prioritized)", /_\(source: ROADMAP\.md -> /, "ROADMAP.md");
    assertResolvedWithProvenance(
      real,
      "In flight",
      /_\(source: \.claude\/project\/sprint\/active-sprints\.yaml\)_/,
      "active-sprints.yaml",
    );
  });
  ok("READ-ONLY (real tree): no source file content/mtime/size changed across the run", () => {
    assertUnchanged(realFiles, realBefore, realAfter);
  });

  // ══ (b) FIXTURE root — the runtime registers the fixture itself writes ═════
  const dir = makeFixtureRoot();
  const fixtureFiles = REL_ALL.map((rel) => path.join(dir, rel));
  const fixBefore = fixtureFiles.map(snapshot);
  const fixture = execFileSync("node", [SCRIPT, "--root", dir], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
  });
  const fixAfter = fixtureFiles.map(snapshot);

  ok("board cites all four live sources (fixture writes the two runtime registers)", () => {
    assertResolvedWithProvenance(fixture, "NEXT ACTION", /_\(source: TRACKER\.md -> /, "TRACKER.md");
    assertResolvedWithProvenance(fixture, "Ranked next (Prioritized)", /_\(source: ROADMAP\.md -> /, "ROADMAP.md");
    assertResolvedWithProvenance(
      fixture,
      "In flight",
      /_\(source: \.claude\/project\/sprint\/active-sprints\.yaml\)_/,
      "active-sprints.yaml",
    );
    assertResolvedWithProvenance(
      fixture,
      "Open gaps / blockers",
      /_\(source: enforcement-debt\.jsonl \+ recurring-issues\.jsonl\)_/,
      "enforcement-debt",
    );
    // The citation is backed by a read of THESE registers: open counts match the fixture.
    const gaps = sectionBody(fixture, "Open gaps / blockers");
    assert.ok(/Enforcement debt \(open\): \*\*2\*\*/.test(gaps), `debt open count should be the fixture's 2 — got:\n${gaps}`);
    assert.ok(/Recurring issues \(open\): \*\*1\*\*/.test(gaps), `issues open count should be the fixture's 1 — got:\n${gaps}`);
    assert.ok(/ED-FIXTURE-1/.test(gaps) && /RI-FIXTURE-1/.test(gaps), "fixture open ids should be listed");
  });
  ok("READ-ONLY (fixture root): no source file content/mtime/size changed across the run", () => {
    assertUnchanged(fixtureFiles, fixBefore, fixAfter);
  });

  console.log(`\nroadmap-board-render: ${pass}/${pass + fail} pass`);
  process.exit(fail ? 1 : 0);
}

main();
