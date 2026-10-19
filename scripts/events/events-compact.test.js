#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

mcEnv.setEnv("COMPACT_ALLOW_CRASH", "1");

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { harness, sealedDir } = require("../checks/lib/fixture-harness");
const archive = require("../hooks/lib/archive");
const compact = require("./events-compact");

const h = harness("events-compact");

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
    }
  }
  return out;
}

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

h.test("every raw id survives in (live tail ∪ archived) after a fold", () => {
  const fx = sealedDir({}, "compact-conservation");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);
    assert.strictEqual(idsBefore.size, 9000, "precondition: 9000 raw events seeded");

    const res = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res.ok, true, "compaction succeeds");
    assert.strictEqual(res.compacted, true);

    const liveIds = readIds(file);
    const archIds = archivedIdsOnDisk(fx.dir);
    assertSubset(idsBefore, union(liveIds, archIds));

    assertSubset(idsBefore, archIds, "archive completeness");
    assert.strictEqual(liveIds.size, compact.TAIL_KEEP_LINES, "tail keeps exactly TAIL_KEEP_LINES live");
  } finally {
    fx.cleanup();
  }
});

h.test("negative control: a genuinely DROPPED seeded event MUST fail conservation (real teeth)", () => {
  const fx = sealedDir({}, "compact-conservation-neg");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);
    compact.compactOnce(fx.dir, { apply: true });

    const foldEntry = archive.readIndex(fx.dir).find((e) => e.reason === "compaction:fold");
    assert.ok(foldEntry, "a compaction:fold generation exists");
    const genAbs = path.join(fx.dir, foldEntry.archived);
    const genLines = fs.readFileSync(genAbs, "utf8").split("\n").filter(Boolean);
    const victim = JSON.parse(genLines[0]).id;
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
      () => assertSubset(idsBefore, haveAfterDrop, "real-drop"),
      new RegExp(`missing id ${victim}`),
      "conservation must reject a genuinely dropped seeded event (not just a phantom)",
    );
  } finally {
    fx.cleanup();
  }
});

h.test("restore drill recovers the pre-fold raw bytes byte-for-byte", () => {
  const fx = sealedDir({}, "compact-restore");
  try {
    const file = seedEvents(fx, 9000);
    const preFoldBytes = fs.readFileSync(file);

    const res = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res.ok, true);

    const idx = archive.readIndex(fx.dir);
    const foldEntry = idx.find((e) => e.reason === "compaction:fold");
    assert.ok(foldEntry, "a compaction:fold index entry exists");
    const archivedAbs = path.join(fx.dir, foldEntry.archived);
    assert.ok(
      preFoldBytes.equals(fs.readFileSync(archivedAbs)),
      "archived generation is byte-identical to the pre-fold file",
    );

    const parked = file + ".live";
    fs.renameSync(file, parked);
    const r = archive.restore(foldEntry, { root: fx.dir });
    assert.strictEqual(r.ok, true, "restore must succeed once the origin is free");
    assert.ok(preFoldBytes.equals(fs.readFileSync(file)), "restored origin is byte-identical to pre-fold");
  } finally {
    fx.cleanup();
  }
});

h.test("seam S5: crash right after the archive move ⇒ CONSERVES via archive; re-run converges", () => {
  const fx = sealedDir({}, "compact-seam-s5");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

    const res = compact.compactOnce(fx.dir, { apply: true, crashAfter: "S5" });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "test-crash-injected");
    assert.strictEqual(res.crashedAfter, "S5");

    assert.ok(!fs.existsSync(file), "events file was moved off its origin at S5");
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "S5 CONSERVES via archive");

    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.compacted, false, "re-run is a clean no-op (live empty)");
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "S5 still CONSERVES after re-run");
  } finally {
    fx.cleanup();
  }
});

h.test("seam S7: indexed:false (index openSync throws) ⇒ index-pending + non-zero; reconcile converges", () => {
  const fx = sealedDir({}, "compact-seam-s7");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

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

    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "S7 CONSERVES via on-disk archive");
    assert.ok(
      !archive.readIndex(fx.dir).some((e) => e.reason === "compaction:fold"),
      "the failed generation is NOT in the index yet",
    );
    const liveSummary = readSummary(file);
    assert.strictEqual(liveSummary.data.index_pending, true);
    assert.strictEqual(liveSummary.data.archived_generation_ref, null);

    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.ok, true);
    assert.ok(res2.reconciled >= 1, "reconcileOrphans re-indexed the orphan generation");
    assert.ok(
      archive.readIndex(fx.dir).some((e) => e.reason === "reconcile:orphan"),
      "the reconciled generation is now indexed",
    );
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "S7 still CONSERVES after reconcile");
  } finally {
    fx.cleanup();
  }
});

h.test("seam S9-partial: a torn reseed append ⇒ CONSERVES via archive; re-run converges", () => {
  const fx = sealedDir({}, "compact-seam-s9");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

    const res = compact.compactOnce(fx.dir, { apply: true, crashAfter: "S9-partial" });
    assert.strictEqual(res.crashedAfter, "S9-partial");
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "S9-partial CONSERVES via archive");
    assert.ok(fs.existsSync(file), "a (partial) live file exists after the torn reseed");

    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.compacted, false);
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "S9-partial still CONSERVES after re-run");
  } finally {
    fx.cleanup();
  }
});

h.test("seam renameSync-EPERM: the archive move fault ⇒ events INTACT (fail-closed); re-run converges", () => {
  const fx = sealedDir({}, "compact-seam-eperm");
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
    assert.ok(preBytes.equals(fs.readFileSync(file)), "events file is byte-identical (untouched)");
    assertSubset(idsBefore, readIds(file), "EPERM CONSERVES (all ids still live)");

    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.compacted, true);
    assertSubset(idsBefore, union(readIds(file), archivedIdsOnDisk(fx.dir)), "EPERM CONSERVES after recovery");
  } finally {
    fx.cleanup();
  }
});

h.test("a REAL appendFileSync reseed fault ⇒ reseed-failed non-zero; archive CONSERVES; --archive union recovers", () => {
  const fx = sealedDir({}, "compact-reseed-fail");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

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
    assert.strictEqual(res.ok, false, "a failed reseed is NOT reported as success");
    assert.strictEqual(res.reason, "reseed-failed");
    assert.strictEqual(res.exitCode, 1, "reseed-failed exits NON-ZERO");
    assertSubset(idsBefore, archivedIdsOnDisk(fx.dir), "CONSERVES via archive after a failed reseed");

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

h.test("a dry-run (apply:false) does NOT mutate disk — reconcileOrphans is a read-only preview", () => {
  const fx = sealedDir({}, "compact-dryrun");
  try {
    seedEvents(fx, 9000);
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
    assert.strictEqual(
      archive.readIndex(fx.dir).length,
      idxBefore,
      "dry-run must not appendIndex",
    );
  } finally {
    fx.cleanup();
  }
});

h.test("reconcileOrphans re-indexes a REAL orphan even when a same-basename decoy is indexed", () => {
  const fx = sealedDir({}, "compact-decoy-orphan");
  try {
    const dir = archive.archiveDir(fx.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "events.jsonl.genX"),
      JSON.stringify({ id: "EVT-realorphan", ts: "2026-07-18T01:00:00Z" }) + "\n",
    );
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

    const res = compact.reconcileOrphans(fx.dir, { apply: true });
    assert.ok(res.reconciled >= 1, "the REAL orphan is re-indexed despite the same-basename decoy");
    const recon = archive.readIndex(fx.dir).find((e) => e.reason === "reconcile:orphan");
    assert.ok(
      recon && /runtime[\\/]archive[\\/]events\.jsonl\.genX$/.test(recon.archived),
      "re-indexed the archive-dir orphan, not the docs decoy",
    );
  } finally {
    fx.cleanup();
  }
});

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

h.test("the compactor source performs NO destructive fs op on the events file", () => {
  const src = fs.readFileSync(path.join(__dirname, "events-compact.js"), "utf8");
  const code = stripComments(src);
  const found = scanForbidden(src);
  assert.deepStrictEqual(
    found,
    [],
    `events-compact.js must contain NO destructive fs op (found: ${found.join(", ")}) — ` +
      `the ONLY mutations of the events file are archive.archive (S5) + fs.appendFileSync (S9)`,
  );
  assert.ok(/fs\.appendFileSync\s*\(/.test(code), "reseed must use fs.appendFileSync");
  assert.ok(/archive\.archive\s*\(/.test(code), "the move must go through archive.archive");
});

h.violation("negative control: a source with fs.writeFileSync on the events file MUST fail the scan", () => {
  const mutant =
    "const fs=require('fs');\nfunction reseed(f){ fs.writeFileSync(f, 'x'); }\n";
  const found = scanForbidden(mutant);
  assert.ok(found.length > 0, "the mutant must be caught");
  return { violations: found };
});

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

h.test("the compaction-summary shape is exact + its ref resolves to a real index entry", () => {
  const fx = sealedDir({}, "compact-summary-shape");
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

    const idx = archive.readIndex(fx.dir);
    const hit = idx.find((e) => e.archived === s.data.archived_generation_ref);
    assert.ok(hit, "archived_generation_ref points at a real index entry");
    assert.strictEqual(hit.reason, "compaction:fold");
    assert.ok(fs.existsSync(path.join(fx.dir, hit.archived)), "the referenced archived file exists on disk");
  } finally {
    fx.cleanup();
  }
});

h.test("idempotent: a double-run converges to ONE fold (second run is a no-op)", () => {
  const fx = sealedDir({}, "compact-idempotent");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

    const r1 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(r1.compacted, true, "first run folds");

    const r2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.compacted, false, "second run is a no-op (live tail < FOLD_TRIGGER)");
    assert.strictEqual(r2.reason, "below-fold-trigger");

    const folds = archive.readIndex(fx.dir).filter((e) => e.reason === "compaction:fold");
    assert.strictEqual(folds.length, 1, "exactly one compaction:fold generation");
    const summaries = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes('"type":"compaction-summary"'));
    assert.strictEqual(summaries.length, 1, "exactly one summary record in the live log");
    assertSubset(idsBefore, union(readIds(file), archivedIdsOnDisk(fx.dir)), "idempotent CONSERVES");
  } finally {
    fx.cleanup();
  }
});

h.test("single-writer: a pre-acquired compact lock ⇒ compactOnce no-ops (reason:locked), CONSERVES", () => {
  const fx = sealedDir({}, "compact-lock");
  try {
    const file = seedEvents(fx, 9000);
    const idsBefore = readIds(file);

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

    assert.strictEqual(idsBefore.size, readIds(file).size, "events file untouched under a held lock");
    assert.ok(
      !fs.readFileSync(file, "utf8").includes('"type":"compaction-summary"'),
      "no summary was written under the held lock",
    );
    assertSubset(idsBefore, readIds(file), "single-writer CONSERVES");

    const res2 = compact.compactOnce(fx.dir, { apply: true });
    assert.strictEqual(res2.compacted, true, "fold proceeds once the lock is released");
  } finally {
    fx.cleanup();
  }
});

h.violation("compactOnce never throws on a bad root (surfaces ok:false)", () => {
  let threw = false;
  let res;
  try {
    res = compact.compactOnce(null, { apply: true });
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, false, "must not throw");
  assert.ok(res && res.ok !== undefined, "returns a result envelope");
  return { ok: false };
});

h.done();
