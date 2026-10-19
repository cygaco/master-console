#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ARCHIVE_SUBDIR = path.join(".claude", "runtime", "archive");
const INDEX_BASENAME = "index.jsonl";

function resolveInsideRoot(rootAbs, candidate) {
  try {
    const resolved = path.resolve(candidate);
    const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    if (resolved !== rootAbs && !resolved.startsWith(rootWithSep)) return null;
    return resolved;
  } catch {
    return null;
  }
}

function containResolved(rootAbs, candidate) {
  try {
    const lexical = resolveInsideRoot(rootAbs, candidate);
    if (!lexical) return null;
    let probe = lexical;
    let real = null;
    for (let i = 0; i < 128; i++) {
      try {
        real = fs.realpathSync(probe);
        break;
      } catch (e) {
        if (e && e.code === "ENOENT") {
          const parent = path.dirname(probe);
          if (parent === probe) return null;
          probe = parent;
          continue;
        }
        return null;
      }
    }
    if (real === null) return null;
    if (!resolveInsideRoot(rootAbs, real)) return null;
    const suffix = path.relative(probe, lexical);
    if (suffix.startsWith("..")) return null;
    const composed = suffix ? path.join(real, suffix) : real;
    return resolveInsideRoot(rootAbs, composed);
  } catch {
    return null;
  }
}

function archiveDir(rootAbs) {
  return path.join(rootAbs, ARCHIVE_SUBDIR);
}

function archiveIndexPath(rootAbs) {
  return path.join(archiveDir(rootAbs), INDEX_BASENAME);
}

function uniqueArchiveName(basename) {
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${basename}.${ts}.${process.pid}.${rand}`;
}

function countLinesSafe(file) {
  try {
    const content = fs.readFileSync(file, "utf8");
    return content.length === 0 ? 0 : content.split("\n").filter(Boolean).length;
  } catch {
    return null;
  }
}

function archive(srcPath, opts) {
  try {
    opts = opts || {};
    if (!opts.root || typeof opts.root !== "string") {
      return { ok: false, reason: "no-trusted-root" };
    }
    const rootAbs = path.resolve(opts.root);
    const srcAbs = containResolved(rootAbs, srcPath);
    if (!srcAbs) return { ok: false, reason: "escapes-root" };

    const srcLexical = path.resolve(srcPath);
    let st;
    try {
      st = fs.lstatSync(srcLexical);
    } catch {
      return { ok: false, reason: "missing" };
    }
    if (!st.isFile()) return { ok: false, reason: "not-a-regular-file" };

    const dir = archiveDir(rootAbs);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return { ok: false, reason: "archive-dir-unwritable" };
    }
    const dirSafe = containResolved(rootAbs, dir);
    if (!dirSafe) return { ok: false, reason: "archive-dir-escapes-root" };

    const bytes = typeof st.size === "number" ? st.size : null;
    const lines = countLinesSafe(srcAbs);

    const destAbs = path.join(dirSafe, uniqueArchiveName(path.basename(srcAbs)));

    try {
      fs.renameSync(srcAbs, destAbs);
    } catch {
      return { ok: false, reason: "move-failed" };
    }

    const entry = {
      ts: new Date().toISOString(),
      origin: path.relative(rootAbs, srcAbs).replace(/\\/g, "/"),
      archived: path.relative(rootAbs, destAbs).replace(/\\/g, "/"),
      shape: opts.shape || null,
      reason: opts.reason || null,
      bytes,
      lines,
      pid: process.pid,
    };
    let indexed = appendIndex(rootAbs, entry);
    if (!indexed) indexed = appendIndex(rootAbs, entry);

    return { ok: true, archived: destAbs, origin: srcAbs, entry, indexed };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function appendIndex(rootAbs, entry) {
  try {
    const idx = archiveIndexPath(rootAbs);
    fs.mkdirSync(path.dirname(idx), { recursive: true });
    const fd = fs.openSync(idx, "a");
    try {
      if (fs.fstatSync(fd).nlink !== 1) return false;
      fs.writeSync(fd, JSON.stringify(entry) + "\n");
      return true;
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
      }
    }
  } catch {
    return false;
  }
}

function readIndex(root) {
  try {
    const rootAbs = path.resolve(root);
    const idx = archiveIndexPath(rootAbs);
    let raw;
    try {
      raw = fs.readFileSync(idx, "utf8");
    } catch {
      return [];
    }
    const out = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch {
      }
    }
    return out;
  } catch {
    return [];
  }
}

function restore(entry, opts) {
  try {
    opts = opts || {};
    if (!entry || typeof entry !== "object") return { ok: false, reason: "bad-entry" };
    if (!opts.root) return { ok: false, reason: "no-trusted-root" };
    const rootAbs = path.resolve(opts.root);
    const archivedAbs = containResolved(rootAbs, path.join(rootAbs, entry.archived || ""));
    const originAbs = containResolved(rootAbs, path.join(rootAbs, entry.origin || ""));
    if (!archivedAbs || !originAbs) return { ok: false, reason: "escapes-root" };
    let ast;
    try {
      ast = fs.lstatSync(archivedAbs);
    } catch (e) {
      if (e && e.code === "ENOENT") return { ok: false, reason: "archived-missing" };
      return { ok: false, reason: "archived-unreadable" };
    }
    if (!ast.isFile()) return { ok: false, reason: "archived-not-a-regular-file" };
    try {
      fs.mkdirSync(path.dirname(originAbs), { recursive: true });
      fs.copyFileSync(archivedAbs, originAbs, fs.constants.COPYFILE_EXCL);
    } catch (e) {
      if (e && e.code === "EEXIST") return { ok: false, reason: "origin-exists" };
      return { ok: false, reason: "restore-failed" };
    }
    try {
      fs.unlinkSync(archivedAbs);
    } catch {
    }
    return { ok: true, restored: originAbs };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function tryLock(lockPath, opts) {
  const staleMs = (opts && typeof opts.staleMs === "number") ? opts.staleMs : 60000;
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch {
  }
  const attempt = () => {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }) + "\n");
      } finally {
        fs.closeSync(fd);
      }
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
        }
      };
    } catch {
      return undefined;
    }
  };
  let release = attempt();
  if (release) return release;
  try {
    const st = fs.statSync(lockPath);
    if (Date.now() - st.mtimeMs > staleMs) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
      }
      release = attempt();
      if (release) return release;
    }
  } catch {
  }
  return null;
}

module.exports = {
  ARCHIVE_SUBDIR,
  INDEX_BASENAME,
  resolveInsideRoot,
  archiveDir,
  archiveIndexPath,
  uniqueArchiveName,
  archive,
  appendIndex,
  readIndex,
  restore,
  tryLock,
};
