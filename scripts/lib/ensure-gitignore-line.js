"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MC_IGNORE = Object.freeze({
  line: ".mc/",
  equivalents: Object.freeze([".mc", ".mc/"]),
  comment: "# Master Console local state (never committed)",
});

function gitEnv() {
  const env = { ...process.env };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) {
    delete env[k];
  }
  return env;
}

function git(root, args) {
  return spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: gitEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
}

function isGitWorkTree(root) {
  const r = git(root, ["rev-parse", "--is-inside-work-tree"]);
  return r.status === 0 && r.stdout.trim() === "true";
}

function ensureGitignoreLine(root, { line, equivalents = [line], comment = null }) {
  const file = path.join(root, ".gitignore");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const present = current
    .replace(/^﻿/, "")
    .split("\n")
    .some((l) => equivalents.includes(l.trimEnd()));
  if (present) return { updated: false };
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  let block = "";
  if (current) block += (current.endsWith("\n") ? "" : eol) + eol;
  if (comment) block += comment + eol;
  block += line + eol;
  fs.appendFileSync(file, block, "utf8");
  return { updated: true };
}

function ensureMcIgnored(root) {
  return ensureGitignoreLine(root, MC_IGNORE);
}

module.exports = { MC_IGNORE, git, gitEnv, isGitWorkTree, ensureGitignoreLine, ensureMcIgnored };
