#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * Isolated test for events-compact.js — the C1 EVENT COMPACTOR (SP-20260718-002,
 * D-1 CORE-4: raw history is NEVER destroyed). Mirrors archive.test.js's idiom:
 * the fixture-harness + sealed temp dirs + fs monkeypatch-and-restore-in-finally.
 *
 * Covers AC-1..AC-6 per qa-plan §2 with TEETH (a broken compactor MUST fail):
 *   AC-1  conservation  set(idsBefore) ⊆ set(liveTailIds ∪ archivedIds)
 *         + the mandatory DROPPED-ID negative control (a missing id MUST fail it)
 *   AC-2  restore-drill  readIndex → restore → byte-compare recovered raw
 *   AC-3  crash-seam matrix  S5 / S7(indexed:false) / S9-partial / renameSync-EPERM
 *         — CONSERVES at each seam + convergence on re-run
 *   AC-4  no-unlink grep/AST over the compactor's OWN source (+ teeth negative control)
 *   AC-5  summary shape + archived_generation_ref resolves to a real index entry
 *   AC-6  idempotent (double-run converges) + single-writer (pre-acquired lock ⇒ no-op)
 *
 *   node scripts/events/events-compact.test.js
 */

// TEST-ONLY: enable the crashAfter seam-abort hook for this process.
mcEnv.setEnv("COMPACT_ALLOW_CRASH", "1");

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { harness, sealedDir } = require("../checks/lib/fixture-harness");
const archive = require("../hooks/lib/archive");
const compact = require("./events-compact");

const h = harness("events-compact");

// ── fixture helpers ──────────────────────────────────────────────────────────

const EVENTS_REL = path.join(".claude", "project", "events", "events.jsonl");

function seedEvents(fx, n, startId = 0) {
  const file = path.join(fx.dir, EVENTS_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(fx.dir, ".claude", "runtime"), { recursive: true });
  const base = Date.UTC(2026, 6, 18, 0, 0, 0);
  const lines = [];
  for (let i = startId; i < startId + n; i++) {
    lines.push(
      JSON.stringify({
        id: `EVT-t-${String(i).padStart(6, "0")}`,
        ts: new Date(base + i * 1000).toISOString(),
        cat: "audit",
        actor: "system",
        data: { i },
      }),
    );
  }
  fs.appendFileSync(file, lines.join("\n") + "\n", "utf8");
  return file;
}

function readIds(file) {
  const out = new Set();
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e && typeof e.id === "string" && e.type !== "compaction-summary") out.add(e.id);
    } catch {
      /* torn line — skip */
    }
  }
  return out;
}

/** Read the ids of EVERY archived generation on disk (dir-scan, index-independent). */
function archivedIdsOnDisk(rootDir) {
  const out = new Set();
  const dir = archive.archiveDir(rootDir);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === archive.INDEX_BASENAME) continue;
    for (const id of readIds(path.join(dir, name))) out.add(id);
  }
  return out;
}

/** The conservation predicate (AC-1): every needed id MUST be present in `have`. */
function assertSubset(need, have, msg) {
  for (const id of need) {
    if (!have.has(id)) throw new Error(`${msg || "conservation"}: missing id ${id}`);
  }
  return true;
}

function union(...sets) {
  const out = new Set();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — conservation + the mandatory DROPPED-ID negative control
// ═══════════════════════════════════════════════════════════════════════════
h.test("AC-1: every raw id survives in (live tail ∪ archived) after a fold", () => {
  const fx = sealedDir({}, "compact-ac1");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);
    assert.strictEqual(idsBefore.size, 9000, "precondition: 9000 raw events seeded");

    const res = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res.ok, true, "compaction succeeds");
    assert.strictEqual(res.compacted, true);

    const liveIds = readIds(file);
    const archIds = archivedIdsOnDisk(fx.dir);
    assertSubset(idsBefore, union(liveIds, archIds), "AC-1");

    // The whole file was archived, so EVERY raw id is in the archive.
    assertSubset(idsBefore, archIds, "AC-1 archive completeness");
    // The reseeded tail keeps the most-recent TAIL_KEEP_LINES live.
    assert.strictEqual(liveIds.size, compact.TAIL_KEEP_LINES, "tail keeps exactly TAIL_KEEP_LINES live");
  } finally {
    fx.cleanup();
  }
});

h.test("AC-1 negative control: a genuinely DROPPED seeded event MUST fail conservation (real teeth, QA-2)", () => {
  const fx = sealedDir({}, "compact-ac1-neg");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);
    compact.compactOnce(fx.dir, { apply: true });

    // Physically DROP a REAL seeded event from the archived generation on disk
    // (simulating a compaction bug that lost raw) — NOT a phantom injected into the
    // NEED set. The conservation check reading the REAL (live tail ∪ archive) must
    // then FAIL for that specific seeded id. This exercises the read path end-to-end.
    const foldEntry = archive.readIndex(fx.dir).find((e) => e.reason === "compaction:fold");
    assert.ok(foldEntry, "a compaction:fold generation exists");
    const genAbs = path.join(fx.dir, foldEntry.archived);
    const genLines = fs.readFileSync(genAbs, "utf8").split("\n").filter(Boolean);
    const victim = JSON.parse(genLines[0]).id; // the OLDEST seeded id — not in the live tail
    fs.writeFileSync(
      genAbs,
      genLines.filter((l) => {
        try {
          return JSON.parse(l).id !== victim;
        } catch {
          return true;
        }
      }).join("\n") + "\n",
    );

    const haveAfterDrop = union(readIds(file), archivedIdsOnDisk(fx.dir));
    assert.ok(
      idsBefore.has(victim) && !haveAfterDrop.has(victim),
      "victim is a REAL seeded id now present in NEITHER live tail nor archive",
    );
    assert.throws(
      () => assertSubset(idsBefore, haveAfterDrop, "AC-1 real-drop"),
      new RegExp(`missing id ${victim}`),
      "conservation must reject a genuinely dropped seeded event (not just a phantom)",
    );
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — restore drill (byte-identical recovery)
// ═══════════════════════════════════════════════════════════════════════════
h.test("AC-2: restore drill recovers the pre-fold raw bytes byte-for-byte", () => {
  const fx = sealedDir({}, "compact-ac2");
  try {
    const file = seedEvents(fx, 9000);
    const preFoldBytes = fs.readFileSync(file);

    const res = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res.ok, true);

    // (a) The archived generation is byte-identical to the pre-fold file (direct read).
    const idx = archive.readIndex(fx.dir);
    const foldEntry = idx.find((e) => e.reason === "compaction:fold");
    assert.ok(foldEntry, "a compaction:fold index entry exists");
    const archivedAbs = path.join(fx.dir, foldEntry.archived);
    assert.ok(
      preFoldBytes.equals(fs.readFileSync(archivedAbs)),
      "archived generation is byte-identical to the pre-fold file",
    );

    // (b) An actual restore() drill. restore() refuses to clobber the live origin,
    // so free the origin first (test-side move), then restore + byte-compare.
    const parked = file + ".live";
    fs.renameSync(file, parked); // test-side only — the COMPACTOR never renames the events file
    const r = archive.restore(foldEntry, { root: fx.dir });
    assert.strictEqual(r.ok, true, "restore must succeed once the origin is free");
    assert.ok(preFoldBytes.equals(fs.readFileSync(file)), "restored origin is byte-identical to pre-fold");
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — crash-seam matrix: CONSERVES at each seam + convergence on re-run
// ═══════════════════════════════════════════════════════════════════════════
h.test("AC-3 seam S5: crash right after the archive move ⇒ CONSERVES via archive; re-run converges", () => {
  const fx = sealedDir({}, "compact-ac3-s5");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

    const res = compact.compactOnce(fx.dir, { apply: true, crashAfter: "S5" });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "test-crash-injected");
    assert.strictEqual(res.crashedAfter, "S5");

    // Post-S5: the file was moved to the archive; the live log does not exist yet.
    assert.ok(!fs.existsSync(file), "events file was moved off its origin at S5");
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "AC-3/S5 CONSERVES via archive");

    // Convergence (β rider #1 res.b): the live log is empty (0 < FOLD_TRIGGER) so the
    // next pass is a CLEAN no-op — no auto-reseed of the old tail. Raw stays in archive.
    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.compacted, false, "re-run is a clean no-op (live empty)");
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "AC-3/S5 still CONSERVES after re-run");
  } finally {
    fx.cleanup();
  }
});

h.test("AC-3 seam S7: indexed:false (index openSync throws) ⇒ index-pending + non-zero; reconcile converges", () => {
  const fx = sealedDir({}, "compact-ac3-s7");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

    // Fail ONLY the index write (openSync on index.jsonl) — the move still succeeds,
    // archive() reports indexed:false.
    const origOpen = fs.openSync;
    fs.openSync = (p, ...rest) => {
      if (String(p).endsWith("index.jsonl")) throw new Error("injected index open failure");
      return origOpen(p, ...rest);
    };
    let res;
    try {
      res = compact.compactOnce(fx.dir, { apply: true });
    } finally {
      fs.openSync = origOpen;
    }
    assert.strictEqual(res.ok, false, "index-pending is a fault, not silent-green");
    assert.strictEqual(res.reason, "index-pending");
    assert.strictEqual(res.indexed, false);
    assert.strictEqual(res.exitCode, 1, "S7 must exit NON-ZERO");

    // The generation is on disk (recoverable by dir-scan) though NOT yet indexed.
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "AC-3/S7 CONSERVES via on-disk archive");
    assert.ok(
      !archive.readIndex(fx.dir).some((e) => e.reason === "compaction:fold"),
      "the failed generation is NOT in the index yet",
    );
    // The summary flags index_pending with no resolvable ref.
    const liveSummary = readSummary(file);
    assert.strictEqual(liveSummary.data.index_pending, true);
    assert.strictEqual(liveSummary.data.archived_generation_ref, null);

    // Convergence: the next pass reconciles the orphan (re-indexes it).
    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.ok, true);
    assert.ok(res2.reconciled >= 1, "reconcileOrphans re-indexed the orphan generation");
    assert.ok(
      archive.readIndex(fx.dir).some((e) => e.reason === "reconcile:orphan"),
      "the reconciled generation is now indexed",
    );
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "AC-3/S7 still CONSERVES after reconcile");
  } finally {
    fx.cleanup();
  }
});

h.test("AC-3 seam S9-partial: a torn reseed append ⇒ CONSERVES via archive; re-run converges", () => {
  const fx = sealedDir({}, "compact-ac3-s9");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

    const res = compact.compactOnce(fx.dir, { apply: true, crashAfter: "S9-partial" });
    assert.strictEqual(res.crashedAfter, "S9-partial");
    // The whole file is in the archive; the live reseed is only partial.
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "AC-3/S9-partial CONSERVES via archive");
    assert.ok(fs.existsSync(file), "a (partial) live file exists after the torn reseed");

    // Convergence: the partial live log is small (< FOLD_TRIGGER) ⇒ clean no-op re-run.
    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.compacted, false);
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "AC-3/S9-partial still CONSERVES after re-run");
  } finally {
    fx.cleanup();
  }
});

h.test("AC-3 seam renameSync-EPERM: the archive move fault ⇒ events INTACT (fail-closed); re-run converges", () => {
  const fx = sealedDir({}, "compact-ac3-eperm");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);
    const preBytes = fs.readFileSync(file);

    const origRename = fs.renameSync;
    fs.renameSync = () => {
      const e = new Error("EPERM: operation not permitted");
      e.code = "EPERM";
      throw e;
    };
    let res;
    let threw = false;
    try {
      res = compact.compactOnce(fx.dir, { apply: true });
    } catch {
      threw = true;
    } finally {
      fs.renameSync = origRename;
    }
    assert.strictEqual(threw, false, "compactOnce must NEVER throw, even on a move fault");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "archive-failed");
    assert.strictEqual(res.exitCode, 1);
    // Fail-closed: the events file is untouched — CONSERVES trivially (all live).
    assert.ok(preBytes.equals(fs.readFileSync(file)), "events file is byte-identical (untouched)");
    assertSubset(idsBefore, readIds(file), "AC-3/EPERM CONSERVES (all ids still live)");

    // Convergence: with rename restored, the next pass compacts normally.
    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.compacted, true);
    assertSubset(idsBefore, union(readIds(file), archivedIdsOnDisk(fx.dir)), "AC-3/EPERM CONSERVES after recovery");
  } finally {
    fx.cleanup();
  }
});

h.test("BR-1 (QA-2): a REAL appendFileSync reseed fault ⇒ reseed-failed non-zero; archive CONSERVES; --archive union recovers", () => {
  const fx = sealedDir({}, "compact-br1-reseed-fail");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

    // Inject a REAL appendFileSync FAULT (not a slice-simulation): the S9 reseed
    // fails after S5 already archived the whole file. Raw is SAFE in the archive,
    // but the live tail cannot be written — BR-1: compactOnce must fail LOUD, never ok:true.
    const origAppend = fs.appendFileSync;
    fs.appendFileSync = () => {
      throw new Error("injected appendFileSync failure");
    };
    let res;
    try {
      res = compact.compactOnce(fx.dir, { apply: true });
    } finally {
      fs.appendFileSync = origAppend;
    }
    assert.strictEqual(res.ok, false, "a failed reseed is NOT reported as success (BR-1)");
    assert.strictEqual(res.reason, "reseed-failed");
    assert.strictEqual(res.exitCode, 1, "reseed-failed exits NON-ZERO");
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "BR-1 CONSERVES via archive after a failed reseed");

    // Validate the ARCHIVE-UNION result (QA-2): query --archive recovers every raw
    // id despite the failed/empty live reseed — the archive holds the truth.
    const cli = require("./cli");
    const captured = [];
    const origOut = process.stdout.write;
    process.stdout.write = (s) => {
      captured.push(String(s));
      return true;
    };
    let code;
    try {
      code = cli.query(["--archive", "--root", fx.dir, "--source", file, "--json"]);
    } finally {
      process.stdout.write = origOut;
    }
    assert.strictEqual(code, 0, "healthy indexed archive tier → query --archive exits 0");
    const unionIds = new Set(
      captured
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l).id;
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
    assertSubset(idsBefore, unionIds, "query --archive union recovers every raw id after a failed reseed");
  } finally {
    fx.cleanup();
  }
});

h.test("BR-4: a dry-run (apply:false) does NOT mutate disk — reconcileOrphans is a read-only preview", () => {
  const fx = sealedDir({}, "compact-br4-dryrun");
  try {
    seedEvents(fx, 9000);
    // An ORPHAN generation on disk not in the index (an apply pass would re-index it).
    const dir = archive.archiveDir(fx.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "events.jsonl.orphan1"),
      JSON.stringify({ id: "EVT-orphan", ts: "2026-01-01T00:00:00Z" }) + "\n",
    );
    const idxBefore = archive.readIndex(fx.dir).length;

    const res = compact.compactOnce(fx.dir, { apply: false });
    assert.strictEqual(res.reason, "dry-run");
    assert.strictEqual(res.wouldCompact, true);
    assert.ok(res.reconciled >= 1, "dry-run still PREVIEWS the orphan count");
    // The index was NOT mutated (the orphan was previewed, not re-indexed).
    assert.strictEqual(
      archive.readIndex(fx.dir).length,
      idxBefore,
      "dry-run must not appendIndex (BR-4)",
    );
  } finally {
    fx.cleanup();
  }
});

h.test("BR-11 (gauntlet R3): reconcileOrphans re-indexes a REAL orphan even when a same-basename decoy is indexed", () => {
  const fx = sealedDir({}, "compact-br11");
  try {
    const dir = archive.archiveDir(fx.dir);
    fs.mkdirSync(dir, { recursive: true });
    // A REAL orphan generation IN the archive dir, NOT in the index:
    fs.writeFileSync(
      path.join(dir, "events.jsonl.genX"),
      JSON.stringify({ id: "EVT-realorphan", ts: "2026-07-18T01:00:00Z" }) + "\n",
    );
    // A DECOY elsewhere in-root with the SAME basename, which IS indexed:
    fs.mkdirSync(path.join(fx.dir, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(fx.dir, "docs", "events.jsonl.genX"),
      JSON.stringify({ id: "EVT-decoy", ts: "2026-07-18T02:00:00Z" }) + "\n",
    );
    archive.appendIndex(fx.dir, { archived: "docs/events.jsonl.genX", reason: "compaction:fold", origin: null });
    assert.strictEqual(
      archive.readIndex(fx.dir).filter((e) => e.reason === "reconcile:orphan").length,
      0,
      "precondition: the real orphan is NOT yet reconciled",
    );

    // A basename-based reconciler would SKIP the real orphan (basename collides with
    // the indexed decoy) → reconciled:0 → permanent fail-closed. Path-aware re-indexes it.
    const res = compact.reconcileOrphans(fx.dir, { apply: true });
    assert.ok(res.reconciled >= 1, "the REAL orphan is re-indexed despite the same-basename decoy (BR-11)");
    const recon = archive.readIndex(fx.dir).find((e) => e.reason === "reconcile:orphan");
    assert.ok(
      recon && /runtime[\\/]archive[\\/]events\.jsonl\.genX$/.test(recon.archived),
      "re-indexed the archive-dir orphan, not the docs decoy",
    );
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — no-unlink grep/AST over the compactor's OWN source (+ teeth)
// ═══════════════════════════════════════════════════════════════════════════
const FORBIDDEN_FS = [
  /fs\.unlinkSync\b/,
  /fs\.unlink\b/,
  /fs\.rmSync\b/,
  /fs\.rm\b/,
  /fs\.rmdir/,
  /fs\.truncate/,
  /fs\.renameSync\b/,
  /fs\.rename\b/,
  /fs\.writeFileSync\b/,
  /fs\.writeFile\b/,
];

function stripComments(s) {
  return s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function scanForbidden(source) {
  const code = stripComments(source);
  const found = [];
  for (const pat of FORBIDDEN_FS) if (pat.test(code)) found.push(String(pat));
  return found;
}

h.test("AC-4: the compactor source performs NO destructive fs op on the events file", () => {
  const src = fs.readFileSync(path.join(__dirname, "events-compact.js"), "utf8");
  const code = stripComments(src);
  const found = scanForbidden(src);
  assert.deepStrictEqual(
    found,
    [],
    `events-compact.js must contain NO destructive fs op (found: ${found.join(", ")}) — ` +
      `the ONLY mutations of the events file are archive.archive (S5) + fs.appendFileSync (S9)`,
  );
  // The reseed must use appendFileSync (not writeFileSync), and the move must go
  // through archive.archive (never a raw rename here).
  assert.ok(/fs\.appendFileSync\s*\(/.test(code), "reseed must use fs.appendFileSync");
  assert.ok(/archive\.archive\s*\(/.test(code), "the move must go through archive.archive");
});

h.violation("AC-4 negative control: a source with fs.writeFileSync on the events file MUST fail the scan", () => {
  const mutant =
    "const fs=require('fs');\nfunction reseed(f){ fs.writeFileSync(f, 'x'); }\n"; // planted destructive op
  const found = scanForbidden(mutant);
  // A scan with teeth returns a non-empty violation list for the mutant.
  assert.ok(found.length > 0, "the mutant must be caught");
  return { violations: found }; // non-empty ⇒ isPass=false ⇒ this h.violation passes
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-5 — summary shape + archived_generation_ref resolves to a real index entry
// ═══════════════════════════════════════════════════════════════════════════
function readSummary(file) {
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let e;
    try {
      e = JSON.parse(t);
    } catch {
      continue;
    }
    if (e && e.type === "compaction-summary") return e;
  }
  throw new Error("no compaction-summary record found in the live log");
}

h.test("AC-5: the compaction-summary shape is exact + its ref resolves to a real index entry", () => {
  const fx = sealedDir({}, "compact-ac5");
  try {
    const file = seedEvents(fx, 9000);
    const res = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res.ok, true);

    const s = readSummary(file);
    assert.strictEqual(s.cat, "audit");
    assert.strictEqual(s.actor, "compactor");
    assert.strictEqual(s.type, "compaction-summary");
    assert.strictEqual(typeof s.id, "string");
    assert.strictEqual(typeof s.ts, "string");
    assert.ok(s.data && typeof s.data === "object", "summary.data present");
    assert.strictEqual(s.data.event_count, 9000, "event_count matches the archived generation");
    assert.ok(s.data.id_range && typeof s.data.id_range.min === "string" && typeof s.data.id_range.max === "string");
    assert.ok(s.data.ts_range && typeof s.data.ts_range.min === "string" && typeof s.data.ts_range.max === "string");
    assert.strictEqual(typeof s.data.archived_generation_ref, "string");

    // The ref resolves to a REAL readIndex entry (the query --archive seam).
    const idx = archive.readIndex(fx.dir);
    const hit = idx.find((e) => e.archived === s.data.archived_generation_ref);
    assert.ok(hit, "archived_generation_ref points at a real index entry");
    assert.strictEqual(hit.reason, "compaction:fold");
    assert.ok(fs.existsSync(path.join(fx.dir, hit.archived)), "the referenced archived file exists on disk");
  } finally {
    fx.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-6 — idempotent (double-run converges) + single-writer (pre-acquired lock)
// ═══════════════════════════════════════════════════════════════════════════
h.test("AC-6 idempotent: a double-run converges to ONE fold (second run is a no-op)", () => {
  const fx = sealedDir({}, "compact-ac6-idem");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

    const r1 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(r1.compacted, true, "first run folds");

    const r2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.compacted, false, "second run is a no-op (live tail < FOLD_TRIGGER)");
    assert.strictEqual(r2.reason, "below-fold-trigger");

    // Exactly ONE fold generation + ONE summary; conservation still holds.
    const folds = archive.readIndex(fx.dir).filter((e) => e.reason === "compaction:fold");
    assert.strictEqual(folds.length, 1, "exactly one compaction:fold generation");
    const summaries = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes('"type":"compaction-summary"'));
    assert.strictEqual(summaries.length, 1, "exactly one summary record in the live log");
    assertSubset(idsBefore, union(readIds(file), archivedIdsOnDisk(fx.dir)), "AC-6 idempotent CONSERVES");
  } finally {
    fx.cleanup();
  }
});

h.test("AC-6 single-writer: a pre-acquired compact lock ⇒ compactOnce no-ops (reason:locked), CONSERVES", () => {
  const fx = sealedDir({}, "compact-ac6-lock");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

    // Pre-acquire the EXACT lock the compactor uses.
    const release = archive.tryLock(compact.compactLockPath(fx.dir));
    assert.strictEqual(typeof release, "function", "the test holds the compact lock");
    try {
      const res = compact.compactOnce(fx.dir, { apply: true });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.reason, "locked");
      assert.strictEqual(res.compacted, false, "no fold while another writer holds the lock");
    } finally {
      release();
    }

    // Nothing moved, no summary written — all ids still live.
    assert.strictEqual(idsBefore.size, readIds(file).size, "events file untouched under a held lock");
    assert.ok(
      !fs.readFileSync(file, "utf8").includes('"type":"compaction-summary"'),
      "no summary was written under the held lock",
    );
    assertSubset(idsBefore, readIds(file), "AC-6 single-writer CONSERVES");

    // After release the fold proceeds normally (proves the lock was the only blocker).
    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.compacted, true, "fold proceeds once the lock is released");
  } finally {
    fx.cleanup();
  }
});

// ── never-throws contract (belt-and-suspenders across bad inputs) ────────────
h.violation("compactOnce never throws on a bad root (surfaces ok:false)", () => {
  let threw = false;
  let res;
  try {
    res = compact.compactOnce(null, { apply: true });
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, false, "must not throw");
  // A null root cannot resolve to a valid events file ⇒ a clean no-op, never a crash.
  assert.ok(res && res.ok !== undefined, "returns a result envelope");
  return { ok: false }; // mark this fault-injection as correctly handled
});

h.done();
