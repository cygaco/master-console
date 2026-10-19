#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const ROLES = Object.freeze(["canonical", "consumer", "unknown"]);

const CANONICAL_ROLE_VALUES = new Set(["canonical", "framework"]);

function safeExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isSelfInstallSource(source) {
  return typeof source === "string" && source.trim().toLowerCase() === "self";
}

function hasInstallRecord(root) {
  try {
    const fip = path.join(root, ".claude", "framework-installed.json");
    if (!fs.existsSync(fip)) return false;
    const rec = JSON.parse(fs.readFileSync(fip, "utf8").replace(/^﻿/, ""));
    return (
      !!rec &&
      /^mc\/framework-installed\//.test(String(rec.$schema || "")) &&
      typeof rec.source === "string" &&
      rec.source.trim() !== "" &&
      !isSelfInstallSource(rec.source)
    );
  } catch {
    return false;
  }
}

function makeResult(role, source) {
  return {
    role,
    source,
    canonical: role === "canonical",
    consumer: role === "consumer",
  };
}

function detectCanonicalSignal(root) {
  const installed = hasInstallRecord(root);

  if (safeExists(path.join(root, ".mc-canonical"))) {
    return "marker:.mc-canonical";
  }

  try {
    const mfp = path.join(root, ".claude", "manifest.json");
    if (fs.existsSync(mfp)) {
      const m = JSON.parse(fs.readFileSync(mfp, "utf8").replace(/^﻿/, ""));
      if (m) {
        if (typeof m.repoRole === "string" && CANONICAL_ROLE_VALUES.has(m.repoRole)) {
          return "manifest.json#repoRole";
        }
        if (m.mc && typeof m.mc.repoRole === "string" && CANONICAL_ROLE_VALUES.has(m.mc.repoRole)) {
          return "manifest.json#mc.repoRole";
        }
        if (m.mc && m.mc.source === "self") {
          return "manifest.json#mc.source";
        }
        if (m.project && m.project.slug === "mc") {
          return "manifest.json#project.slug";
        }
      }
    }
  } catch {
  }

  if (!installed && safeExists(path.join(root, "_mc", "MANIFEST.json"))) {
    return "marker:_mc/MANIFEST.json";
  }

  try {
    const vjp = path.join(root, "version.json");
    if (!installed && fs.existsSync(vjp)) {
      const v = JSON.parse(fs.readFileSync(vjp, "utf8"));
      if (v && v.name === "mc") {
        return "version.json#name";
      }
    }
  } catch {
  }

  return null;
}

function resolveRepoRole(opts) {
  const overrideArg = opts && typeof opts.override === "string" ? opts.override.trim() : "";
  const root = opts && (opts.root || opts.cwd)
    ? path.resolve(opts.root || opts.cwd)
    : ROOT;

  if (overrideArg) {
    const normalized = overrideArg.toLowerCase();
    if (ROLES.includes(normalized)) {
      return makeResult(normalized, "arg:override");
    }
  }

  const envVal = (mcEnv.readEnv("REPO_ROLE") || "").trim();
  if (envVal) {
    const normalized = envVal.toLowerCase();
    if (ROLES.includes(normalized)) {
      return makeResult(normalized, "env:MC_REPO_ROLE");
    }
  }

  const sig = detectCanonicalSignal(root);
  if (sig) {
    return makeResult("canonical", sig);
  }

  if (safeExists(path.join(root, ".claude", "framework-installed.json"))) {
    return makeResult("consumer", "heuristic:framework-installed.json");
  }

  return makeResult("unknown", "none");
}

function isCanonicalDir(dir) {
  return detectCanonicalSignal(path.resolve(dir)) !== null;
}

if (require.main === module) {
  const json = process.argv.includes("--json");
  const r = resolveRepoRole();
  if (json) {
    process.stdout.write(JSON.stringify({ ...r, roles: ROLES }) + "\n");
  } else {
    process.stdout.write(`${r.role}\n`);
  }
  process.exit(0);
}

module.exports = { resolveRepoRole, isCanonicalDir, isSelfInstallSource, ROLES };
