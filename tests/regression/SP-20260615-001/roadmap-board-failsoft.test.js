#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// roadmap-board-failsoft.test.js — SP-20260615-001 S-4 / AC-R4c.
//
// ::each-malformed-or-missing-source-degrades-to-section-unavailable-without-throwing
//   The GENERATOR fails SOFT on its human-authored inputs (β-4). Build a TEMP
//   fixture root (copy the three TRACKED sources in; WRITE the two runtime
//   open-gaps registers), then INDEPENDENTLY break each one and assert that ONE
//   section degrades to a "section unavailable" placeholder while the REST of the
//   board still renders, the generator NEVER throws, and the render is exit-0 clean.
//
//   Fixture preconditions (amended 2026-09-16, S-OS-06 r4 lane H, β verdict
//   7d3e9f51 / betaEvents row 475 — see the AC-R4a amendment): the open-gaps
//   registers are gitignored (.gitignore `.claude/project/memory/`), owner:runtime
//   files a clean checkout NEVER carries. The pre-amendment fixture COPIED them
//   "if present", so its "clean" root silently depended on the host's runtime
//   state: in any clean checkout (CI included) the gaps section correctly degraded
//   (the B4 contract below), so 6 of 15 cases failed on a gaps section that was
//   never broken on purpose. The
//   fixture now WRITES its own minimal registers and never copies host runtime
//   state. The B4-missing and EISDIR cases remove/replace those fixture files, so
//   they now exercise the degradation they name (pre-amendment, in a clean
//   checkout, the EISDIR case passed only because the OTHER register was absent).
//   Authored 2026-06-14; first surfaced when `npm test` was wired into CI on
//   2026-09-12.
//
//   Covered degradations (each independent):
//     - ROADMAP §  : renamed "Ranked do-next:" marker            → Ranked unavailable
//     - TRACKER §  : removed Next-Action heading                 → NEXT ACTION unavailable
//     - active-sprints.yaml:
//         · NUL / binary garbage                                 → In flight unavailable
//         · MISSING file (B4 — distinct from empty)              → In flight unavailable
//         · malformed YAML "sprints: ["          (B5)            → In flight unavailable
//         · unterminated "primary: [unterminated" (B5)           → In flight unavailable
//     - open-gaps registers:
//         · unreadable register (EISDIR)                         → Open gaps unavailable
//         · MISSING register files (B4 — distinct from empty)    → Open gaps unavailable
//   Plus: present-but-EMPTY sources are an empty STATE, NOT "section unavailable"
//   (the B4 distinction), and the operator-polish In-flight summary
//   ("…and N more in-flight (M stale planning)") is asserted.
//
//   SANDBOX-SAFE: drives the generator IN-PROCESS via require()+generate({root})
//   and the exported parse fns — NO nested `node` spawnSync (the review sandbox
//   denies spawnSync with EPERM). Fixtures are fed through the injectable `root`
//   seam so the REAL repo files are never touched. generate() is pure + fail-soft
//   (each section is its own try/catch), so a thrown error here = a real bug.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "panel", "roadmap.js");
const roadmap = require(SCRIPT);

const REL = {
  roadmap: "ROADMAP.md",
  tracker: "TRACKER.md",
  sprints: path.join(".claude", "project", "sprint", "active-sprints.yaml"),
  debt: path.join(".claude", "project", "memory", "enforcement-debt.jsonl"),
  issues: path.join(".claude", "project", "memory", "recurring-issues.jsonl"),
};

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

// Sources a clean checkout carries (tracked) vs. runtime registers it never has.
const TRACKED = [REL.roadmap, REL.tracker, REL.sprints];
const FIXTURE_REGISTERS = {
  [REL.debt]: [
    { id: "ED-FIXTURE-1", status: "open", policy: "fixture open debt" },
    { id: "ED-FIXTURE-2", status: "closed", policy: "fixture closed debt" },
  ],
  [REL.issues]: [
    { id: "RI-FIXTURE-1", status: "open", title: "fixture open issue" },
    { id: "RI-FIXTURE-2", status: "resolved", title: "fixture resolved issue" },
  ],
};

// Build a fresh fixture root: the three tracked sources copied from the real tree,
// the two runtime registers WRITTEN by the fixture (never copied from the host).
function makeFixtureRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-failsoft-"));
  fs.mkdirSync(path.join(dir, ".claude", "project", "sprint"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".claude", "project", "memory"), { recursive: true });
  for (const rel of TRACKED) {
    const srcFile = path.join(ROOT, rel);
    const dstFile = path.join(dir, rel);
    if (fs.existsSync(srcFile)) fs.copyFileSync(srcFile, dstFile);
  }
  for (const [rel, rows] of Object.entries(FIXTURE_REGISTERS)) {
    fs.writeFileSync(path.join(dir, rel), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return dir;
}

// Render the board IN-PROCESS (no spawn). generate() is fail-soft by contract;
// if it ever throws, that is itself the failure the test should catch — so we let
// the throw propagate to the enclosing ok() wrapper (which records a FAIL).
function renderBoard(rootDir) {
  const { markdown } = roadmap.generate({ root: rootDir });
  return markdown;
}

// Section bodies — given the full board text, return the text of one section.
// `heading` is a RAW literal (e.g. "Ranked next (Prioritized)"); escaped once here.
function sectionBody(board, heading) {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, "m");
  const m = re.exec(board);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = board.slice(start);
  const next = rest.search(/^##\s+\S/m);
  return next === -1 ? rest : rest.slice(0, next);
}

// RAW heading literals (NOT pre-escaped — sectionBody escapes once).
const HEADINGS = ["NEXT ACTION", "Ranked next (Prioritized)", "In flight", "Open gaps / blockers"];

function assertHealthyExcept(board, brokenHeading) {
  for (const h of HEADINGS) {
    const body = sectionBody(board, h);
    assert.ok(body !== null, `section '${h}' missing entirely`);
    if (h === brokenHeading) {
      assert.ok(
        /section unavailable/i.test(body),
        `broken section '${h}' must show 'section unavailable' — got:\n${body}`,
      );
    } else {
      assert.ok(
        !/section unavailable/i.test(body),
        `healthy section '${h}' unexpectedly degraded (cross-contamination) — got:\n${body}`,
      );
    }
  }
}

function main() {
  // ── 0. Baseline: clean fixture root renders all four sections healthy ───────
  ok("clean fixture root: all four sections healthy (no false degrade)", () => {
    const dir = makeFixtureRoot();
    const board = renderBoard(dir);
    for (const h of HEADINGS) {
      const body = sectionBody(board, h);
      assert.ok(body && !/section unavailable/i.test(body), `clean section '${h}' should be healthy`);
    }
  });

  // ── 1. ROADMAP §: renamed heading → Ranked section degrades ─────────────────
  ok("malformed ROADMAP § (renamed 'Ranked do-next:' marker) degrades Ranked, rest render", () => {
    const dir = makeFixtureRoot();
    const f = path.join(dir, REL.roadmap);
    const txt = fs.readFileSync(f, "utf8").replace(/\*\*Ranked do-next:\*\*/g, "**Ranked TODO (renamed):**");
    fs.writeFileSync(f, txt);
    assertHealthyExcept(renderBoard(dir), "Ranked next (Prioritized)");
  });

  // ── 2. TRACKER §: removed NEXT ACTION heading → next-action section degrades ─
  ok("malformed TRACKER § (no 'Current Highest-Priority Next Action' heading) degrades NEXT ACTION, rest render", () => {
    const dir = makeFixtureRoot();
    const f = path.join(dir, REL.tracker);
    const txt = fs
      .readFileSync(f, "utf8")
      .replace(/^##\s+Current Highest-Priority Next Action\s*$/m, "## (heading renamed away)");
    fs.writeFileSync(f, txt);
    assertHealthyExcept(renderBoard(dir), "NEXT ACTION");
  });

  // ── 3. active-sprints.yaml: NUL/binary garbage → In flight degrades ─────────
  ok("broken active-sprints.yaml (binary/NUL garbage) degrades In flight, rest render", () => {
    const dir = makeFixtureRoot();
    const f = path.join(dir, REL.sprints);
    fs.writeFileSync(f, Buffer.from([0x73, 0x70, 0x72, 0x00, 0x00, 0xff, 0xfe, 0x0a]));
    assertHealthyExcept(renderBoard(dir), "In flight");
  });

  // ── 3b. (B5) malformed YAML "sprints: [" (unterminated flow seq) degrades ────
  ok("B5: malformed active-sprints.yaml ('sprints: [' unterminated) degrades In flight, rest render", () => {
    const dir = makeFixtureRoot();
    const f = path.join(dir, REL.sprints);
    fs.writeFileSync(f, "schema: mc/sprint/active-sprints/v1\nprimary: SP-X\nsprints: [\n");
    const board = renderBoard(dir);
    // Direct parse probe too (sandbox-safe, no spawn): the parse must report error.
    const parsed = roadmap.parseActiveSprints(dir);
    assert.ok(parsed.error, "parseActiveSprints must flag 'sprints: [' as an error, not normalize to empty");
    assertHealthyExcept(board, "In flight");
  });

  // ── 3c. (B5) unterminated quoted scalar "primary: [unterminated" degrades ────
  ok("B5: malformed active-sprints.yaml (unterminated 'primary: \"oops') degrades In flight, rest render", () => {
    const dir = makeFixtureRoot();
    const f = path.join(dir, REL.sprints);
    // An unterminated double-quoted scalar — the canonical 'primary: [unterminated'
    // corruption shape. (We use a quote so the assertion is unambiguous.)
    fs.writeFileSync(f, 'schema: mc/sprint/active-sprints/v1\nprimary: "unterminated\nsprints:\n');
    const parsed = roadmap.parseActiveSprints(dir);
    assert.ok(parsed.error, "unterminated quoted scalar must be flagged, not silently accepted");
    assertHealthyExcept(renderBoard(dir), "In flight");
  });

  // ── 3d. assertYamlNotCorrupt unit probes (no spawn) ─────────────────────────
  ok("B5: assertYamlNotCorrupt throws on corruption, passes on the real file", () => {
    // Corrupt shapes throw…
    assert.throws(() => roadmap.assertYamlNotCorrupt("sprints: ["), /malformed YAML/i, "'sprints: [' must throw");
    assert.throws(() => roadmap.assertYamlNotCorrupt('primary: "oops'), /malformed YAML/i, "unterminated quote must throw");
    assert.throws(() => roadmap.assertYamlNotCorrupt("a: ]"), /malformed YAML/i, "stray ']' must throw");
    // …and the REAL, valid active-sprints.yaml (with '#' inside a quoted title) does NOT.
    const real = fs.readFileSync(path.join(ROOT, REL.sprints), "utf8");
    assert.doesNotThrow(() => roadmap.assertYamlNotCorrupt(real), "valid real YAML must NOT be flagged (quote-aware '#')");
  });

  // ── 3e. (B4) MISSING active-sprints FILE → In flight unavailable ────────────
  ok("B4: MISSING active-sprints.yaml degrades In flight to 'section unavailable' (not 'None in flight')", () => {
    const dir = makeFixtureRoot();
    fs.rmSync(path.join(dir, REL.sprints), { force: true });
    const board = renderBoard(dir);
    const body = sectionBody(board, "In flight");
    assert.ok(/section unavailable/i.test(body), `missing file must be 'section unavailable' — got:\n${body}`);
    assert.ok(!/None in flight/i.test(body), "missing file must NOT read as the empty state");
    const parsed = roadmap.parseActiveSprints(dir);
    assert.ok(parsed.error && /not found/i.test(parsed.error), "parse must report 'not found'");
  });

  // ── 3f. (B4) PRESENT-but-EMPTY active-sprints → empty STATE (distinct) ───────
  ok("B4 distinction: EMPTY active-sprints.yaml is an empty state ('None in flight'), NOT unavailable", () => {
    const dir = makeFixtureRoot();
    fs.writeFileSync(path.join(dir, REL.sprints), "");
    const body = sectionBody(renderBoard(dir), "In flight");
    assert.ok(/None in flight/i.test(body), `empty file should render the empty state — got:\n${body}`);
    assert.ok(!/section unavailable/i.test(body), "present-but-empty must NOT be 'section unavailable'");
  });

  // ── 4. open-gaps register unreadable (EISDIR) → Open gaps degrades ──────────
  ok("unreadable open-gaps register (EISDIR) degrades Open gaps, rest render", () => {
    const dir = makeFixtureRoot();
    const f = path.join(dir, REL.debt);
    fs.rmSync(f, { force: true });
    fs.mkdirSync(f); // a directory where a file is expected → read throws
    assertHealthyExcept(renderBoard(dir), "Open gaps / blockers");
  });

  // ── 4b. (B4) MISSING open-gaps registers → Open gaps unavailable ────────────
  ok("B4: MISSING open-gaps registers degrade Open gaps to 'section unavailable' (not count 0)", () => {
    const dir = makeFixtureRoot();
    fs.rmSync(path.join(dir, REL.debt), { force: true });
    fs.rmSync(path.join(dir, REL.issues), { force: true });
    const body = sectionBody(renderBoard(dir), "Open gaps / blockers");
    assert.ok(/section unavailable/i.test(body), `missing registers must be 'section unavailable' — got:\n${body}`);
    assert.ok(!/Enforcement debt \(open\): \*\*0\*\*/.test(body), "missing must NOT read as count 0");
    const parsed = roadmap.parseGaps(dir);
    assert.ok(parsed.error && /not found/i.test(parsed.error), "parseGaps must report 'not found'");
  });

  // ── 5. ALL sources missing at once → every section degrades, no throw ───────
  ok("all sources missing (empty root): every section degrades, board still renders, no throw", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-empty-"));
    const board = renderBoard(empty);
    assert.ok(/^#\s/m.test(board), "a board header must still render");
    for (const h of HEADINGS) {
      const body = sectionBody(board, h);
      assert.ok(body !== null, `section '${h}' missing entirely`);
      assert.ok(/section unavailable/i.test(body), `absent source → '${h}' must be unavailable`);
    }
  });

  // ── 5b. nonexistent-root probe (the review's B4 acceptance probe) ───────────
  ok("B4 probe: --root <nonexistent> → In-flight AND Open-gaps both 'section unavailable'", () => {
    const board = renderBoard(path.join(os.tmpdir(), "roadmap-does-not-exist-" + Date.now()));
    const inflight = sectionBody(board, "In flight");
    const gaps = sectionBody(board, "Open gaps / blockers");
    assert.ok(/section unavailable/i.test(inflight), "nonexistent root → In-flight unavailable");
    assert.ok(!/None in flight/i.test(inflight), "nonexistent root → NOT 'None in flight'");
    assert.ok(/section unavailable/i.test(gaps), "nonexistent root → Open-gaps unavailable");
  });

  // ── 6. operator polish: In-flight shows the stale-planning summary line ─────
  ok("operator polish: In-flight caps active rows + summarizes the rest with stale-planning count", () => {
    const dir = makeFixtureRoot();
    // Synthesize a queue: 1 active + many stale planning, with a primary.
    const rows = [];
    rows.push("schema: mc/sprint/active-sprints/v1");
    rows.push("primary: SP-ACTIVE-1");
    rows.push("sprints:");
    rows.push("  - id: SP-ACTIVE-1");
    rows.push("    status: in_progress");
    for (let i = 1; i <= 20; i++) {
      rows.push(`  - id: SP-STALE-${i}`);
      rows.push("    status: planning");
    }
    fs.writeFileSync(path.join(dir, REL.sprints), rows.join("\n") + "\n");
    const body = sectionBody(renderBoard(dir), "In flight");
    assert.ok(/SP-ACTIVE-1.*\(primary\)/.test(body), "primary row must be shown");
    assert.ok(/stale planning/i.test(body), `summary must mention stale planning — got:\n${body}`);
    // The 20 stale rows must be summarized, NOT listed individually.
    const staleLinesListed = (body.match(/- `SP-STALE-/g) || []).length;
    assert.strictEqual(staleLinesListed, 0, "stale planning rows must be summarized, not listed");
    // The summary count must reflect the 20 stale planning sprints.
    assert.ok(/\(20 stale planning\)/.test(body), `summary count should be 20 — got:\n${body}`);
  });

  // ── 7. read-only guarantee: generate() must not mutate the fixture sources ──
  ok("generate() is read-only: fixture source bytes are unchanged after a render", () => {
    const dir = makeFixtureRoot();
    const before = Object.values(REL).map((rel) => {
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? fs.readFileSync(p) : null;
    });
    renderBoard(dir);
    renderBoard(dir); // twice — idempotent, still no writes
    Object.values(REL).forEach((rel, i) => {
      const p = path.join(dir, rel);
      const now = fs.existsSync(p) ? fs.readFileSync(p) : null;
      if (before[i] === null) {
        assert.strictEqual(now, null, `${rel} should not have been created`);
      } else {
        assert.ok(now.equals(before[i]), `${rel} content changed — generator wrote to a source!`);
      }
    });
  });

  console.log(`\nroadmap-board-failsoft: ${pass}/${pass + fail} pass`);
  process.exit(fail ? 1 : 0);
}

main();
