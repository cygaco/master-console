#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { harness, sealedDir } = require("../../checks/lib/fixture-harness");
const {
  rotateIfNeeded,
  rotateBytesIfNeeded,
  rotateSink,
  MIN_BYTES_PER_LINE,
  DEFAULT_JSONL_CAP_LINES,
  SINK_CAPS,
  CAP_CLASSES,
} = require("./rotate");

const h = harness("rotate");

function countLines(content) {
  return content.length === 0 ? 0 : content.split("\n").filter(Boolean).length;
}

function mkLines(n, padTo) {
  const lines = [];
  for (let i = 0; i < n; i++) {
    let line = JSON.stringify({ i, ts: "2026-01-01T00:00:00.000Z" });
    if (padTo && line.length < padTo) line += "x".repeat(padTo - line.length);
    lines.push(line);
  }
  return lines.join("\n") + "\n";
}

function archivedFiles(root) {
  const dir = path.join(root, ".claude", "runtime", "archive");
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n !== "index.jsonl").map((n) => path.join(dir, n));
}

function readIndex(root) {
  try {
    const raw = fs.readFileSync(path.join(root, ".claude", "runtime", "archive", "index.jsonl"), "utf8");
    return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function regSink(file, kind) {
  SINK_CAPS[path.resolve(file)] = {
    kind: kind || "lines",
    cap: 1,
    class: kind === "bytes" ? "diagnostics" : "operational",
  };
  return file;
}

h.test("below-cap: file untouched, nothing archived", () => {
  const fx = sealedDir({}, "rotate-below-cap");
  try {
    const file = regSink(fx.file("events.jsonl"));
    const content = mkLines(5);
    fs.writeFileSync(file, content, "utf8");
    const res = rotateIfNeeded(file, 20000, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, false, "should not rotate below cap");
    assert.strictEqual(fs.readFileSync(file, "utf8"), content, "content must be byte-identical");
    assert.strictEqual(archivedFiles(fx.dir).length, 0, "nothing should be archived");
  } finally {
    fx.cleanup();
  }
});

h.test("over-cap: archives (active gone, archive carries ALL lines), zero lines lost", () => {
  const fx = sealedDir({}, "rotate-over-cap");
  try {
    const file = regSink(fx.file("events.jsonl"));
    const cap = 20;
    const originalContent = mkLines(cap + 5, 120);
    const originalLineCount = countLines(originalContent);
    fs.writeFileSync(file, originalContent, "utf8");

    const res = rotateIfNeeded(file, cap, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, true, "should rotate when over cap");
    assert.strictEqual(res.reason, "archived");
    assert.ok(!fs.existsSync(file), "active file path should be gone after the archive move");

    const arch = archivedFiles(fx.dir);
    assert.strictEqual(arch.length, 1, "exactly one archive generation should exist");
    const archivedLineCount = countLines(fs.readFileSync(arch[0], "utf8"));
    assert.strictEqual(archivedLineCount, originalLineCount, "archive must carry ALL original lines");

    const idx = readIndex(fx.dir);
    assert.strictEqual(idx.length, 1, "an index entry must be written");
    assert.strictEqual(idx[0].origin, "events.jsonl", "index records the origin (relative)");
    assert.ok(idx[0].reason && idx[0].reason.startsWith("rotation:"), "index records the reason");

    const newLine = JSON.stringify({ i: "new-after-rotation" }) + "\n";
    fs.appendFileSync(file, newLine, "utf8");
    const newLineCount = countLines(fs.readFileSync(file, "utf8"));
    assert.strictEqual(newLineCount, 1, "fresh active file should carry only the new line");
    assert.strictEqual(
      archivedLineCount + newLineCount,
      originalLineCount + 1,
      "total lines across archive + fresh active == original + the one new append (zero lost)",
    );
  } finally {
    fx.cleanup();
  }
});

h.test("a second rotation creates a SECOND archive generation (no clobber)", () => {
  const fx = sealedDir({}, "rotate-two-gen");
  try {
    const file = regSink(fx.file("events.jsonl"));
    const cap = 5;
    fs.writeFileSync(file, mkLines(cap + 3, 120), "utf8");
    let res = rotateIfNeeded(file, cap, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, true);
    const firstGen = fs.readFileSync(res.archived, "utf8");

    fs.writeFileSync(file, mkLines(cap + 10, 120), "utf8");
    res = rotateIfNeeded(file, cap, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, true);

    const arch = archivedFiles(fx.dir);
    assert.strictEqual(arch.length, 2, "BOTH generations must survive — no clobber");
    const contents = arch.map((f) => fs.readFileSync(f, "utf8"));
    assert.ok(contents.includes(firstGen), "the first generation must NOT have been overwritten");
    assert.strictEqual(readIndex(fx.dir).length, 2, "two index entries — one per generation");
  } finally {
    fx.cleanup();
  }
});

h.test("tiny 3-byte-per-line file over cap DOES rotate (sound floor)", () => {
  const fx = sealedDir({}, "rotate-sound-pregate");
  try {
    assert.strictEqual(MIN_BYTES_PER_LINE, 1, "the pre-gate floor must be the sound value 1");
    const file = regSink(fx.file("events.jsonl"));
    const cap = 10;
    fs.writeFileSync(file, Array.from({ length: 20 }, () => "{}").join("\n") + "\n", "utf8");
    const res = rotateIfNeeded(file, cap, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, true, "an over-cap tiny-line file MUST rotate under the sound floor");
    assert.strictEqual(archivedFiles(fx.dir).length, 1);
  } finally {
    fx.cleanup();
  }
});

h.test("pre-gate: large bytes but few lines does not rotate; tiny file spared", () => {
  const fx = sealedDir({}, "rotate-pregate");
  try {
    const file = regSink(fx.file("events.jsonl"));
    const content = mkLines(3, 300);
    fs.writeFileSync(file, content, "utf8");
    let res = rotateIfNeeded(file, 10, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, false, "few real lines under cap must not rotate");
    assert.strictEqual(fs.readFileSync(file, "utf8"), content, "content must be untouched");

    const file2 = fx.file("events2.jsonl");
    fs.writeFileSync(file2, mkLines(3), "utf8");
    res = rotateIfNeeded(file2, 20000, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, false);
    assert.strictEqual(res.reason, "below-pregate");
  } finally {
    fx.cleanup();
  }
});

h.test("exactly cap lines rotates (at/over); cap-1 does not", () => {
  const fx = sealedDir({}, "rotate-exact-cap");
  try {
    const cap = 12;
    const atCap = regSink(fx.file("at.jsonl"));
    fs.writeFileSync(atCap, mkLines(cap, 40), "utf8");
    let res = rotateIfNeeded(atCap, cap, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, true, "exactly cap lines must rotate (>= cap)");

    const underCap = fx.file("under.jsonl");
    fs.writeFileSync(underCap, mkLines(cap - 1, 40), "utf8");
    res = rotateIfNeeded(underCap, cap, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, false, "cap-1 lines must NOT rotate");
    assert.strictEqual(res.reason, "under-cap");
  } finally {
    fx.cleanup();
  }
});

h.test("rotateSink no-ops on an unknown (unregistered) path", () => {
  const fx = sealedDir({}, "rotate-sink-closure");
  try {
    const file = fx.file("not-a-known-sink.jsonl");
    fs.writeFileSync(file, mkLines(50, 200), "utf8");
    const res = rotateSink(file, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, false, "an unknown sink must never rotate");
    assert.strictEqual(res.reason, "unknown-sink");
    assert.strictEqual(archivedFiles(fx.dir).length, 0, "nothing archived for an unknown sink");
    assert.ok(fs.existsSync(file), "the unknown file is left untouched");
  } finally {
    fx.cleanup();
  }
});

h.test("seam: rotateIfNeeded on an unregistered over-cap file is REFUSED without allowUnregistered", () => {
  const fx = sealedDir({}, "rotate-seam");
  try {
    const file = fx.file("arbitrary.jsonl");
    fs.writeFileSync(file, mkLines(30, 120), "utf8");
    const res = rotateIfNeeded(file, 5, { root: fx.dir });
    assert.strictEqual(res.rotated, false, "an unregistered path must not be archive-moved at the seam");
    assert.strictEqual(res.reason, "unregistered-sink");
    assert.strictEqual(archivedFiles(fx.dir).length, 0, "nothing archived for an unregistered path");
    assert.ok(fs.existsSync(file), "the arbitrary file is left untouched");

    const bfile = fx.file("arbitrary.log");
    fs.writeFileSync(bfile, "x".repeat(5000), "utf8");
    const bres = rotateBytesIfNeeded(bfile, 1000, { root: fx.dir });
    assert.strictEqual(bres.reason, "unregistered-sink");
    assert.ok(fs.existsSync(bfile));
  } finally {
    fx.cleanup();
  }
});

h.test("stale-decision: a file that drops under cap between the pre-lock count and the lock is NOT archived", () => {
  const fx = sealedDir({}, "rotate-stale");
  try {
    const file = regSink(fx.file("events.jsonl"));
    fs.writeFileSync(file, mkLines(30, 120), "utf8");
    const origRead = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = () => {
      reads++;
      return reads === 1 ? mkLines(30, 120) : mkLines(1);
    };
    let res;
    try {
      res = rotateIfNeeded(file, 5, { root: fx.dir, allowUnregistered: true });
    } finally {
      fs.readFileSync = origRead;
    }
    assert.strictEqual(res.rotated, false, "a decision resolved before the move must not archive");
    assert.strictEqual(res.reason, "resolved-under-lock");
    assert.strictEqual(archivedFiles(fx.dir).length, 0, "nothing archived when the re-check fails");
  } finally {
    fx.cleanup();
  }
});

h.violation("archive move throwing surfaces as a falsy result, never a throw; source kept", () => {
  const fx = sealedDir({}, "rotate-fault-move");
  try {
    const file = regSink(fx.file("events.jsonl"));
    const cap = 5;
    fs.writeFileSync(file, mkLines(cap + 5, 120), "utf8");
    const origRename = fs.renameSync;
    fs.renameSync = () => {
      throw new Error("injected move failure");
    };
    let res;
    let threw = false;
    try {
      res = rotateIfNeeded(file, cap, { root: fx.dir, allowUnregistered: true });
    } catch {
      threw = true;
    } finally {
      fs.renameSync = origRename;
    }
    assert.strictEqual(threw, false, "rotateIfNeeded must NEVER throw, even on a move fault");
    assert.strictEqual(res.rotated, false, "a move fault must surface as a falsy result");
    assert.ok(fs.existsSync(file), "the source must be KEPT when the archive move fails (no data loss)");
    return { ok: false };
  } finally {
    fx.cleanup();
  }
});

h.test("missing file is a no-op (falsy, no throw)", () => {
  const fx = sealedDir({}, "rotate-missing");
  try {
    const res = rotateIfNeeded(fx.file("does-not-exist.jsonl"), 10, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, false);
  } finally {
    fx.cleanup();
  }
});

h.test("0-byte file is a no-op", () => {
  const fx = sealedDir({}, "rotate-zero-byte");
  try {
    const file = fx.file("empty.jsonl");
    fs.writeFileSync(file, "", "utf8");
    const res = rotateIfNeeded(file, 1, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, false);
  } finally {
    fx.cleanup();
  }
});

h.test("rotateBytesIfNeeded: under cap no-op, over cap archives", () => {
  const fx = sealedDir({}, "rotate-bytes");
  try {
    const file = regSink(fx.file("team-guard-debug.log"), "bytes");
    fs.writeFileSync(file, "x".repeat(1000), "utf8");
    let res = rotateBytesIfNeeded(file, 2000, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, false, "under cap must not rotate");

    fs.writeFileSync(file, "x".repeat(3000), "utf8");
    res = rotateBytesIfNeeded(file, 2000, { root: fx.dir, allowUnregistered: true });
    assert.strictEqual(res.rotated, true, "over cap must archive");
    assert.ok(!fs.existsSync(file), "active file moved to archive");
    const arch = archivedFiles(fx.dir);
    assert.strictEqual(arch.length, 1);
    assert.strictEqual(fs.readFileSync(arch[0], "utf8").length, 3000, "archive carries the full bytes");
  } finally {
    fx.cleanup();
  }
});

h.violation("rotateBytesIfNeeded fault-injection never throws", () => {
  const fx = sealedDir({}, "rotate-bytes-fault");
  try {
    const file = regSink(fx.file("team-guard-debug.log"), "bytes");
    fs.writeFileSync(file, "x".repeat(3000), "utf8");
    const origRename = fs.renameSync;
    fs.renameSync = () => {
      throw new Error("injected");
    };
    let res;
    let threw = false;
    try {
      res = rotateBytesIfNeeded(file, 2000, { root: fx.dir, allowUnregistered: true });
    } catch {
      threw = true;
    } finally {
      fs.renameSync = origRename;
    }
    assert.strictEqual(threw, false);
    assert.strictEqual(res.rotated, false);
    return { ok: false };
  } finally {
    fx.cleanup();
  }
});

h.test("rotate returns indexed:false when the index write fails", () => {
  const fx = sealedDir({}, "rotate-index-fail");
  try {
    const file = regSink(fx.file("events.jsonl"));
    fs.writeFileSync(file, mkLines(30, 120), "utf8");
    const origOpen = fs.openSync;
    fs.openSync = (p, ...rest) => {
      if (String(p).endsWith("index.jsonl")) throw new Error("injected index open failure");
      return origOpen(p, ...rest);
    };
    let res;
    try {
      res = rotateIfNeeded(file, 5, { root: fx.dir });
    } finally {
      fs.openSync = origOpen;
    }
    assert.strictEqual(res.rotated, true, "the file IS archived (data safe)");
    assert.strictEqual(res.indexed, false, "the index failure is PROPAGATED to the caller, not swallowed");
    const file2 = regSink(fx.file("events.jsonl"));
    fs.writeFileSync(file2, mkLines(30, 120), "utf8");
    const ok = rotateIfNeeded(file2, 5, { root: fx.dir });
    assert.strictEqual(ok.indexed, true, "a normal rotation reports indexed:true");
  } finally {
    fx.cleanup();
  }
});

h.test("SINK_CAPS carries per-class caps", () => {
  assert.strictEqual(DEFAULT_JSONL_CAP_LINES, 20000);
  const entries = Object.values(SINK_CAPS);
  assert.ok(entries.length > 0, "SINK_CAPS should not be empty in a real checkout");
  assert.ok(entries.every((e) => e.kind === "lines" || e.kind === "bytes"), "recognized kinds only");
  assert.ok(entries.every((e) => typeof e.class === "string" && CAP_CLASSES[e.class]), "every sink carries a known class");
  const caps = new Set(Object.values(CAP_CLASSES).map((c) => c.cap));
  assert.ok(caps.size > 1, "the classes must not all share one cap");
});

h.done();
