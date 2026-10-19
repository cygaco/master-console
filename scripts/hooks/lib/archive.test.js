#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { harness, sealedDir } = require("../../checks/lib/fixture-harness");
const archive = require("./archive");

const h = harness("archive");

function seedRuntime(fx) {
  fs.mkdirSync(path.join(fx.dir, ".claude", "runtime"), { recursive: true });
}

h.test("archive moves the file into the tier and writes an index entry", () => {
  const fx = sealedDir({}, "archive-move");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "a\nb\nc\n", "utf8");
    const res = archive.archive(src, { root: fx.dir, reason: "rotation:over-cap", shape: "operational" });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.indexed, true, "a successful archive reports indexed:true");
    assert.ok(!fs.existsSync(src), "source moved off its origin");
    assert.ok(fs.existsSync(res.archived), "archived file exists in the tier");
    assert.strictEqual(fs.readFileSync(res.archived, "utf8"), "a\nb\nc\n", "content preserved byte-for-byte");

    const idx = archive.readIndex(fx.dir);
    assert.strictEqual(idx.length, 1);
    assert.strictEqual(idx[0].origin, ".claude/runtime/events.jsonl");
    assert.strictEqual(idx[0].reason, "rotation:over-cap");
    assert.strictEqual(idx[0].shape, "operational");
    assert.strictEqual(idx[0].lines, 3, "index records the line count");
    assert.ok(typeof idx[0].bytes === "number" && idx[0].bytes > 0, "index records the byte size");
  } finally {
    fx.cleanup();
  }
});

h.test("RESTORE DRILL: archive then restore returns the file to its origin intact", () => {
  const fx = sealedDir({}, "archive-restore-drill");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "handoffs", "old.md");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    const original = "line1\nline2\nline3\n";
    fs.writeFileSync(src, original, "utf8");

    const a = archive.archive(src, { root: fx.dir, reason: "retention:handoffs-dir" });
    assert.strictEqual(a.ok, true);
    assert.ok(!fs.existsSync(src), "moved off origin");

    const idx = archive.readIndex(fx.dir);
    const r = archive.restore(idx[0], { root: fx.dir });
    assert.strictEqual(r.ok, true, "restore must succeed");
    assert.ok(fs.existsSync(src), "the file is back at its origin");
    assert.strictEqual(fs.readFileSync(src, "utf8"), original, "restored content is byte-identical");
  } finally {
    fx.cleanup();
  }
});

h.test("restore refuses when the origin already exists (never clobber live state)", () => {
  const fx = sealedDir({}, "archive-restore-noclobber");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "old\n", "utf8");
    const a = archive.archive(src, { root: fx.dir, reason: "rotation" });
    fs.writeFileSync(src, "fresh-live\n", "utf8");
    const r = archive.restore(a.entry, { root: fx.dir });
    assert.strictEqual(r.ok, false, "restore must refuse to overwrite the live file");
    assert.strictEqual(r.reason, "origin-exists");
    assert.strictEqual(fs.readFileSync(src, "utf8"), "fresh-live\n", "live file untouched");
  } finally {
    fx.cleanup();
  }
});

h.test("archive refuses a source outside root", () => {
  const fx = sealedDir({}, "archive-escape");
  const outside = sealedDir({}, "archive-outside");
  try {
    seedRuntime(fx);
    const evil = path.join(outside.dir, "secret.md");
    fs.writeFileSync(evil, "secret\n", "utf8");
    const res = archive.archive(evil, { root: fx.dir, reason: "x" });
    assert.strictEqual(res.ok, false, "a source outside root must be refused");
    assert.strictEqual(res.reason, "escapes-root");
    assert.ok(fs.existsSync(evil), "the outside file is untouched");
  } finally {
    fx.cleanup();
    outside.cleanup();
  }
});

function trySymlink(target, link) {
  try {
    fs.symlinkSync(target, link, "file");
    return true;
  } catch (e) {
    process.stderr.write(
      `  (skip: this host cannot create file symlinks — ${e && e.code}; the lstat branch is covered by the directory-source case)\n`,
    );
    return false;
  }
}

h.test("archive refuses a symlink source whose target escapes root (realpath containment)", () => {
  const fx = sealedDir({}, "archive-symlink-out");
  const outside = sealedDir({}, "archive-symlink-target");
  try {
    seedRuntime(fx);
    const target = path.join(outside.dir, "secret.md");
    fs.writeFileSync(target, "secret\n", "utf8");
    const link = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    if (!trySymlink(target, link)) return;
    const res = archive.archive(link, { root: fx.dir, reason: "x" });
    assert.strictEqual(res.ok, false, "a symlink out of root must be refused");
    assert.strictEqual(res.reason, "escapes-root", "realpath containment fires first");
    assert.ok(fs.existsSync(target), "the symlink target survives");
    assert.ok(fs.lstatSync(link).isSymbolicLink(), "the link itself is left in place (never moved)");
    assert.strictEqual(archive.readIndex(fx.dir).length, 0, "nothing indexed");
  } finally {
    fx.cleanup();
    outside.cleanup();
  }
});

h.test("archive refuses a symlink source whose target is inside root (lstat no-follow)", () => {
  const fx = sealedDir({}, "archive-symlink-in");
  try {
    seedRuntime(fx);
    const target = path.join(fx.dir, ".claude", "runtime", "real.jsonl");
    fs.writeFileSync(target, "real\n", "utf8");
    const link = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    if (!trySymlink(target, link)) return;
    const res = archive.archive(link, { root: fx.dir, reason: "x" });
    assert.strictEqual(res.ok, false, "a symlink source must be refused");
    assert.strictEqual(res.reason, "not-a-regular-file", "lstat sees the link, not the target");
    assert.strictEqual(fs.readFileSync(target, "utf8"), "real\n", "the in-root target is untouched");
    assert.ok(fs.lstatSync(link).isSymbolicLink(), "the link itself is left in place (never moved)");
    assert.strictEqual(archive.readIndex(fx.dir).length, 0, "nothing indexed");
  } finally {
    fx.cleanup();
  }
});

h.test("archive refuses a directory source (not-a-regular-file, no symlink needed)", () => {
  const fx = sealedDir({}, "archive-dir-source");
  try {
    seedRuntime(fx);
    const dirSrc = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.mkdirSync(dirSrc);
    fs.writeFileSync(path.join(dirSrc, "child.txt"), "c\n", "utf8");
    const res = archive.archive(dirSrc, { root: fx.dir, reason: "x" });
    assert.strictEqual(res.ok, false, "a directory source must be refused");
    assert.strictEqual(res.reason, "not-a-regular-file");
    assert.ok(fs.existsSync(path.join(dirSrc, "child.txt")), "the directory and its content survive");
    assert.strictEqual(archive.readIndex(fx.dir).length, 0, "nothing indexed");
  } finally {
    fx.cleanup();
  }
});

h.test("archiving the same basename twice yields TWO distinct generations", () => {
  const fx = sealedDir({}, "archive-two-gen");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "gen-one\n", "utf8");
    const a1 = archive.archive(src, { root: fx.dir, reason: "rotation" });
    fs.writeFileSync(src, "gen-two\n", "utf8");
    const a2 = archive.archive(src, { root: fx.dir, reason: "rotation" });
    assert.ok(a1.ok && a2.ok);
    assert.notStrictEqual(a1.archived, a2.archived, "unique names — the two generations are distinct files");
    assert.strictEqual(fs.readFileSync(a1.archived, "utf8"), "gen-one\n", "first generation intact");
    assert.strictEqual(fs.readFileSync(a2.archived, "utf8"), "gen-two\n", "second generation intact");
    assert.strictEqual(archive.readIndex(fx.dir).length, 2);
  } finally {
    fx.cleanup();
  }
});

h.test("reader: a reader of the archived generation gets the complete content (rotation loses nothing)", () => {
  const fx = sealedDir({}, "archive-reader");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    const lines = [];
    for (let i = 0; i < 500; i++) lines.push(JSON.stringify({ i, msg: "event-" + i }));
    fs.writeFileSync(src, lines.join("\n") + "\n", "utf8");
    const a = archive.archive(src, { root: fx.dir, reason: "rotation" });
    const parsed = fs
      .readFileSync(a.archived, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.strictEqual(parsed.length, 500, "all 500 lines readable from the archive");
    assert.strictEqual(parsed[0].i, 0);
    assert.strictEqual(parsed[499].i, 499);
    const idx = archive.readIndex(fx.dir);
    assert.strictEqual(path.join(fx.dir, idx[0].archived), a.archived);
  } finally {
    fx.cleanup();
  }
});

h.test("readIndex tolerates a torn/partial index line (never throws)", () => {
  const fx = sealedDir({}, "archive-torn-index");
  try {
    seedRuntime(fx);
    const idxPath = path.join(fx.dir, ".claude", "runtime", "archive", "index.jsonl");
    fs.mkdirSync(path.dirname(idxPath), { recursive: true });
    fs.writeFileSync(idxPath, JSON.stringify({ origin: "a" }) + "\n{ this is not json\n" + JSON.stringify({ origin: "b" }) + "\n");
    const idx = archive.readIndex(fx.dir);
    assert.strictEqual(idx.length, 2, "the two valid lines parse; the torn line is skipped");
  } finally {
    fx.cleanup();
  }
});

h.test("tryLock: a fresh lock blocks a second acquire; release re-opens it", () => {
  const fx = sealedDir({}, "archive-lock");
  try {
    const lp = path.join(fx.dir, ".claude", "runtime", "x.lock");
    const rel = archive.tryLock(lp);
    assert.strictEqual(typeof rel, "function", "first acquire succeeds");
    assert.strictEqual(archive.tryLock(lp), null, "a second acquire while held returns null");
    rel();
    const rel2 = archive.tryLock(lp);
    assert.strictEqual(typeof rel2, "function", "after release the lock is acquirable again");
    rel2();
  } finally {
    fx.cleanup();
  }
});

h.test("tryLock: a STALE lock (older than staleMs) is reclaimed", () => {
  const fx = sealedDir({}, "archive-lock-stale");
  try {
    const lp = path.join(fx.dir, ".claude", "runtime", "y.lock");
    fs.mkdirSync(path.dirname(lp), { recursive: true });
    fs.writeFileSync(lp, JSON.stringify({ pid: 999999, ts: 0 }) + "\n");
    const old = (Date.now() - 10 * 1000) / 1000;
    fs.utimesSync(lp, old, old);
    const rel = archive.tryLock(lp, { staleMs: 1000 });
    assert.strictEqual(typeof rel, "function", "a stale lock must be reclaimable");
    rel();
  } finally {
    fx.cleanup();
  }
});

h.violation("archive move fault surfaces as ok:false, source kept, never throws", () => {
  const fx = sealedDir({}, "archive-fault");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "data\n", "utf8");
    const origRename = fs.renameSync;
    fs.renameSync = () => {
      throw new Error("injected move failure");
    };
    let res;
    let threw = false;
    try {
      res = archive.archive(src, { root: fx.dir, reason: "x" });
    } catch {
      threw = true;
    } finally {
      fs.renameSync = origRename;
    }
    assert.strictEqual(threw, false, "archive must NEVER throw");
    assert.strictEqual(res.ok, false, "a move fault surfaces as ok:false");
    assert.ok(fs.existsSync(src), "the source is KEPT on a move fault (no data loss)");
    return { ok: false };
  } finally {
    fx.cleanup();
  }
});

h.test("archive surfaces an index-write failure as indexed:false (file still archived)", () => {
  const fx = sealedDir({}, "archive-index-fail");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "a\nb\n", "utf8");
    const origOpen = fs.openSync;
    fs.openSync = (p, ...rest) => {
      if (String(p).endsWith("index.jsonl")) throw new Error("injected index open failure");
      return origOpen(p, ...rest);
    };
    let res;
    try {
      res = archive.archive(src, { root: fx.dir, reason: "rotation" });
    } finally {
      fs.openSync = origOpen;
    }
    assert.strictEqual(res.ok, true, "the file IS archived (data safe) even when the index write fails");
    assert.strictEqual(res.indexed, false, "the index-write failure must be SURFACED, not swallowed");
    assert.ok(fs.existsSync(res.archived), "the archived generation is on disk (recoverable by dir scan)");
    assert.ok(!fs.existsSync(src), "source moved");
  } finally {
    fx.cleanup();
  }
});

h.test("adversarial containment: vector (b) non-regular file (directory source) is REFUSED", () => {
  const fx = sealedDir({}, "contain-dir");
  try {
    seedRuntime(fx);
    const dirSrc = path.join(fx.dir, ".claude", "runtime", "a-directory");
    fs.mkdirSync(dirSrc, { recursive: true });
    const r = archive.archive(dirSrc, { root: fx.dir, reason: "x" });
    assert.strictEqual(r.ok, false, "a directory source must be refused (lstat isFile())");
    assert.strictEqual(r.reason, "not-a-regular-file");
    assert.ok(fs.existsSync(dirSrc), "the directory is untouched (not deleted)");
  } finally {
    fx.cleanup();
  }
});

h.test("adversarial containment: vector (d) out-of-root source is REFUSED", () => {
  const fx = sealedDir({}, "contain-out");
  const outside = sealedDir({}, "contain-out-src");
  try {
    seedRuntime(fx);
    const evil = path.join(outside.dir, "secret.md");
    fs.writeFileSync(evil, "secret\n", "utf8");
    const r = archive.archive(evil, { root: fx.dir, reason: "x" });
    assert.strictEqual(r.ok, false, "an out-of-root source must be refused");
    assert.strictEqual(r.reason, "escapes-root");
    assert.ok(fs.existsSync(evil), "the out-of-root file survives (not deleted, not moved outside)");
  } finally {
    fx.cleanup();
    outside.cleanup();
  }
});

h.test("adversarial containment: vector (a) symlink-source/ancestor → refuse OR archive-WITHIN-root, never delete/exfil", () => {
  const fx = sealedDir({}, "contain-symlink");
  const target = sealedDir({}, "contain-symlink-target");
  try {
    seedRuntime(fx);
    const outsideFile = path.join(target.dir, "secret.md");
    fs.writeFileSync(outsideFile, "secret\n", "utf8");
    const link = path.join(fx.dir, ".claude", "runtime", "evil.jsonl");
    let symlinkOk = true;
    try {
      fs.symlinkSync(outsideFile, link, "file");
    } catch {
      symlinkOk = false;
    }
    if (!symlinkOk) return;
    const r = archive.archive(link, { root: fx.dir, reason: "x" });
    assert.strictEqual(r.ok, false, "a symlink source must be refused (not a regular file)");
    assert.ok(fs.existsSync(outsideFile), "the symlink target (out-of-root) survives — no delete, no exfil");
    if (r.ok && r.archived) {
      assert.ok(archive.resolveInsideRoot(path.resolve(fx.dir), r.archived), "any archive dest stays inside root");
    }
  } finally {
    fx.cleanup();
    target.cleanup();
  }
});

h.test("no-delete proof: retention.js + rotate.js contain NO fs.unlink/fs.rm/fs.rmdir (archive-move only)", () => {
  const stripComments = (s) =>
    s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rel of ["retention.js", "rotate.js"]) {
    const code = stripComments(fs.readFileSync(path.join(__dirname, rel), "utf8"));
    for (const pat of [/fs\.unlink/, /fs\.rmSync/, /fs\.rm\b/, /fs\.rmdir/]) {
      assert.ok(
        !pat.test(code),
        `${rel} must contain no ${pat} — the destructive path is MOVE-TO-ARCHIVE only`,
      );
    }
  }
  const arch = stripComments(fs.readFileSync(path.join(__dirname, "archive.js"), "utf8"));
  assert.ok(
    !/unlinkSync\(srcAbs\)/.test(arch),
    "archive.js must NOT unlink the move source (the EXDEV external-delete vector is removed)",
  );
  assert.ok(
    !/code === "EXDEV"/.test(arch) || !/copyFileSync\(srcAbs/.test(arch),
    "archive.js archive() must not carry the EXDEV copyFileSync(src)+unlink(src) fallback",
  );
});

h.violation("EXDEV rename fails cleanly — no copy, no unlink, source KEPT", () => {
  const fx = sealedDir({}, "archive-exdev");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "data\n", "utf8");
    const origRename = fs.renameSync;
    const origCopy = fs.copyFileSync;
    const origUnlink = fs.unlinkSync;
    let copyCalled = false;
    let unlinkCalled = false;
    fs.renameSync = () => {
      const e = new Error("EXDEV: cross-device link not permitted");
      e.code = "EXDEV";
      throw e;
    };
    fs.copyFileSync = (...a) => {
      copyCalled = true;
      return origCopy(...a);
    };
    fs.unlinkSync = (...a) => {
      unlinkCalled = true;
      return origUnlink(...a);
    };
    let res;
    let threw = false;
    try {
      res = archive.archive(src, { root: fx.dir, reason: "x" });
    } catch {
      threw = true;
    } finally {
      fs.renameSync = origRename;
      fs.copyFileSync = origCopy;
      fs.unlinkSync = origUnlink;
    }
    assert.strictEqual(threw, false, "archive must not throw on EXDEV");
    assert.strictEqual(res.ok, false, "EXDEV must fail cleanly");
    assert.strictEqual(res.reason, "move-failed");
    assert.ok(fs.existsSync(src), "the source is KEPT on EXDEV (never deleted)");
    assert.strictEqual(copyCalled, false, "NO copyFileSync on EXDEV (the fallback is removed)");
    assert.strictEqual(unlinkCalled, false, "NO unlink on EXDEV (the external-delete vector is gone)");
    return { ok: false };
  } finally {
    fx.cleanup();
  }
});

h.test("dest containment: a symlinked archive dir (out of root) is REFUSED, source not moved out", () => {
  const fx = sealedDir({}, "archive-dest-junction");
  const outside = sealedDir({}, "archive-dest-outside");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "data\n", "utf8");
    const archDir = path.join(fx.dir, ".claude", "runtime", "archive");
    let symlinkOk = true;
    try {
      fs.symlinkSync(outside.dir, archDir, "dir");
    } catch {
      symlinkOk = false;
    }
    if (!symlinkOk) return;
    const res = archive.archive(src, { root: fx.dir, reason: "x" });
    assert.strictEqual(res.ok, false, "a symlinked-out archive dir must be refused");
    assert.strictEqual(res.reason, "archive-dir-escapes-root");
    assert.ok(fs.existsSync(src), "the source is NOT moved out of root");
    assert.strictEqual(fs.readdirSync(outside.dir).length, 0, "nothing was written outside root");
  } finally {
    fx.cleanup();
    outside.cleanup();
  }
});

h.test("restore containment: an out-of-root origin (via ancestor junction) is REFUSED", () => {
  const fx = sealedDir({}, "restore-junction");
  const outside = sealedDir({}, "restore-outside");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "data\n", "utf8");
    const a = archive.archive(src, { root: fx.dir, reason: "x" });
    assert.strictEqual(a.ok, true);
    const restoredir = path.join(fx.dir, ".claude", "runtime", "restoredir");
    let symlinkOk = true;
    try {
      fs.symlinkSync(outside.dir, restoredir, "dir");
    } catch {
      symlinkOk = false;
    }
    if (!symlinkOk) return;
    const poisoned = { ...a.entry, origin: ".claude/runtime/restoredir/pwned.md" };
    const r = archive.restore(poisoned, { root: fx.dir });
    assert.strictEqual(r.ok, false, "an out-of-root origin (via junction) must be refused");
    assert.strictEqual(r.reason, "escapes-root");
    assert.strictEqual(fs.readdirSync(outside.dir).length, 0, "nothing written outside root");
  } finally {
    fx.cleanup();
    outside.cleanup();
  }
});

h.test("hard-link index: a hard-linked index.jsonl → indexed:false, external file NOT written (nlink guard)", () => {
  const fx = sealedDir({}, "archive-hardlink-index");
  const outside = sealedDir({}, "archive-hardlink-outside");
  try {
    seedRuntime(fx);
    const archDir = path.join(fx.dir, ".claude", "runtime", "archive");
    fs.mkdirSync(archDir, { recursive: true });
    const external = path.join(outside.dir, "external-target.txt");
    fs.writeFileSync(external, "EXTERNAL-ORIGINAL\n", "utf8");
    const idxPath = path.join(archDir, "index.jsonl");
    let linkOk = true;
    try {
      fs.linkSync(external, idxPath);
    } catch {
      linkOk = false;
    }
    if (!linkOk) return;
    assert.ok(fs.statSync(idxPath).nlink >= 2, "precondition: index is hard-linked (nlink>=2)");

    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "a\nb\n", "utf8");
    const res = archive.archive(src, { root: fx.dir, reason: "x" });
    assert.strictEqual(res.ok, true, "the file is still archived (data safe)");
    assert.strictEqual(res.indexed, false, "a hard-linked index is REFUSED (indexed:false)");
    assert.strictEqual(
      fs.readFileSync(external, "utf8"),
      "EXTERNAL-ORIGINAL\n",
      "the external file was NOT written to (nlink guard held)",
    );
  } finally {
    fx.cleanup();
    outside.cleanup();
  }
});

h.test("restore no-clobber uses lstat (no symlink-follow): a dangling-symlink origin is NOT clobbered", () => {
  const fx = sealedDir({}, "restore-lstat");
  try {
    seedRuntime(fx);
    const src = path.join(fx.dir, ".claude", "runtime", "events.jsonl");
    fs.writeFileSync(src, "data\n", "utf8");
    const a = archive.archive(src, { root: fx.dir, reason: "rotation" });
    assert.strictEqual(a.ok, true);
    let symlinkOk = true;
    try {
      fs.symlinkSync(path.join(fx.dir, ".claude", "runtime", "nonexistent-target"), src, "file");
    } catch {
      symlinkOk = false;
    }
    if (!symlinkOk) return;
    const r = archive.restore(a.entry, { root: fx.dir });
    assert.strictEqual(r.ok, false, "restore must refuse when a (dangling) symlink already occupies the origin");
    assert.strictEqual(r.reason, "origin-exists");
    assert.ok(fs.lstatSync(src).isSymbolicLink(), "the dangling symlink at the origin is untouched");
  } finally {
    fx.cleanup();
  }
});

h.violation("archive refuses a missing source (ok:false, no throw)", () => {
  const fx = sealedDir({}, "archive-missing");
  try {
    seedRuntime(fx);
    const res = archive.archive(path.join(fx.dir, ".claude", "runtime", "nope.jsonl"), { root: fx.dir });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "missing");
    return { ok: false };
  } finally {
    fx.cleanup();
  }
});

h.done();
