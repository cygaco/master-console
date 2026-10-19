"use strict";
const fs = require("fs");
const path = require("path");

function readGitHead(root) {
  try {
    let gitDir = path.join(root, ".git");
    const st = fs.statSync(gitDir);
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, "utf8"));
      if (!m) return "";
      gitDir = path.isAbsolute(m[1].trim()) ? m[1].trim() : path.resolve(root, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*(.+)$/.exec(head);
    if (!ref) return /^[0-9a-f]{7,40}$/i.test(head) ? head : "";
    const refName = ref[1].trim();
    const commonDir = readCommonDir(gitDir) || gitDir;
    for (const base of [gitDir, commonDir]) {
      let looseContent = null;
      try {
        looseContent = fs.readFileSync(path.join(base, refName), "utf8").trim();
      } catch {
        looseContent = null;
      }
      if (looseContent !== null) {
        return /^[0-9a-f]{7,40}$/i.test(looseContent) ? looseContent : "";
      }
      const packed = readPackedRef(path.join(base, "packed-refs"), refName);
      if (packed) return packed;
    }
    return "";
  } catch {
    return "";
  }
}

function readCommonDir(gitDir) {
  try {
    return path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim());
  } catch {
    return null;
  }
}

function readPackedRef(packedPath, refName) {
  try {
    for (const line of fs.readFileSync(packedPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("^")) continue;
      const sp = t.indexOf(" ");
      if (sp > 0 && t.slice(sp + 1) === refName) {
        const sha = t.slice(0, sp);
        return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : "";
      }
    }
  } catch {
  }
  return "";
}

module.exports = { readGitHead };
