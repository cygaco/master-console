"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { nextEdId } = require("./ed-registry");

function registerPath() {
  try { return require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS.enforcementDebt; }
  catch { return path.join(".claude", "project", "memory", "enforcement-debt.jsonl"); }
}

function resolveRegisterText(p, read = fs.readFileSync, lstat = fs.lstatSync) {
  try {
    return read(p, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") {
      try {
        lstat(p);
      } catch (le) {
        if (le && le.code === "ENOENT") return "";
        const lerr = new Error(`enforcement-debt register lstat failed, cannot confirm absence (${(le && (le.code || le.message)) || "unknown"}): ${p}`);
        lerr.failClosed = true;
        throw lerr;
      }
      const err = new Error(`enforcement-debt register path EXISTS but readFileSync could not read it (dangling symlink or special file): ${p}`);
      err.failClosed = true;
      throw err;
    }
    const err = new Error(`enforcement-debt register unreadable (${(e && (e.code || e.message)) || "unknown"}): ${p}`);
    err.failClosed = true;
    throw err;
  }
}

if (require.main === module) {
  let p = registerPath();
  if (!path.isAbsolute(p)) p = path.join(ROOT, p);
  let text;
  try {
    text = resolveRegisterText(p);
  } catch (e) {
    process.stderr.write(`next-ed-id: FAIL-CLOSED — ${e.message}\n`);
    process.exit(2);
  }
  process.stdout.write(nextEdId(text) + "\n");
}

module.exports = { nextEdId, registerPath, resolveRegisterText };
