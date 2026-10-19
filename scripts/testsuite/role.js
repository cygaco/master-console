#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { resolveRepoRole } = require("../mc/repo-role");

const ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST = path.join(ROOT, ".claude", "manifest.json");

function readRawRole() {
  try {
    if (!fs.existsSync(MANIFEST)) return null;
    const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8").replace(/^﻿/, ""));
    if (!m) return null;
    if (typeof m.repoRole === "string" && m.repoRole) return m.repoRole;
    if (m.mc && typeof m.mc.repoRole === "string" && m.mc.repoRole) return m.mc.repoRole;
    return null;
  } catch {
    return null;
  }
}

function isCanonical() {
  try {
    return resolveRepoRole({ root: ROOT }).role === "canonical";
  } catch {
    return false;
  }
}

function roleLabel() {
  const raw = readRawRole();
  return raw !== null ? raw : "product";
}

function roleStatus() {
  const exists = fs.existsSync(MANIFEST);
  let readable = false;
  if (exists) {
    try {
      JSON.parse(fs.readFileSync(MANIFEST, "utf8").replace(/^﻿/, ""));
      readable = true;
    } catch {
      readable = false;
    }
  }
  const role = readRawRole();
  let canonical = false;
  try {
    canonical = resolveRepoRole({ root: ROOT }).role === "canonical";
  } catch {
    canonical = false;
  }
  return {
    manifestExists: exists,
    manifestReadable: readable,
    role,
    canonical,
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify({ canonical: isCanonical(), role: roleLabel(), status: roleStatus() }) + "\n");
}

module.exports = { isCanonical, roleLabel, roleStatus };
