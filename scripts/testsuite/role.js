#!/usr/bin/env node
/**
 * scripts/testsuite/role.js — repo-role bridge for the test-suite enforcer.
 *
 * Thin shim over the shared repo-role resolver (scripts/mc/repo-role.js).
 * This replaces the interim stub (0.17.0 ED-009 open item) per its own comment:
 * "Replace this module's body when the resolver lands; keep the isCanonical()/
 * roleLabel() surface stable so callers don't move."
 *
 * CONTRACT NOTES — two-layer design (do NOT collapse):
 *
 *   LABEL surface  (roleLabel(), roleStatus().role):
 *     Returns the RAW manifest repoRole string ("framework", "canonical", etc.)
 *     or "product"/null when absent/unreadable. This is the legacy display
 *     contract that callers (enforce.js, release-gates.js) consume as a string.
 *     It does NOT return resolver tokens like "consumer" or "unknown".
 *
 *   DECISION surface (isCanonical(), roleStatus().canonical):
 *     Backed by the shared resolver (resolveRepoRole). Correct even when the
 *     manifest is absent (e.g. canonical-by-_mc/MANIFEST.json signal or
 *     version.json heuristic). Never throws — fail-safe to false on any error.
 *
 * Public surface (unchanged — callers enforce.js, run.js, release-gates.js):
 *   isCanonical()  → boolean   true iff this repo IS the canonical framework source
 *   roleLabel()    → string    raw manifest repoRole field, or "product" when absent
 *   roleStatus()   → object    { manifestExists, manifestReadable, role, canonical }
 *                               role     = raw manifest repoRole (or null if absent)
 *                               canonical = resolver-backed boolean
 *
 *   node scripts/testsuite/role.js   # prints { canonical, role, status } as JSON
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { resolveRepoRole } = require("../mc/repo-role");

// Root of this repo, same anchor the old stub used.
const ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST = path.join(ROOT, ".claude", "manifest.json");

// ── Internal: read the RAW manifest repoRole field (legacy display contract) ──
// Returns the raw string from manifest.json top-level repoRole (or mc.repoRole),
// or null if the manifest is absent, unreadable, or has no repoRole field.
// Strips BOM (this repo ships BOM'd JSON).
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

// ── isCanonical ───────────────────────────────────────────────────────────────
// DECISION surface — resolver-backed. True iff resolveRepoRole resolves to
// "canonical" via any signal (manifest, marker, version.json, etc.).
// Never throws — resolver is fail-safe (unknown/consumer on any error).
function isCanonical() {
  try {
    return resolveRepoRole({ root: ROOT }).role === "canonical";
  } catch {
    return false;
  }
}

// ── roleLabel ─────────────────────────────────────────────────────────────────
// LABEL surface — returns the RAW manifest repoRole string, or "product" when
// the field is absent or the manifest is missing/unreadable. Does NOT return
// resolver tokens ("consumer", "unknown") — that would break callers that use
// this as a display/gate-label value.
function roleLabel() {
  const raw = readRawRole();
  return raw !== null ? raw : "product";
}

// ── roleStatus ────────────────────────────────────────────────────────────────
// Extended status for release-gate callers that need to distinguish a genuine
// product repo from an unreadable manifest (qa W5 invariant).
//   .role      = raw manifest repoRole string, or null (NOT a resolver token)
//   .canonical = resolver-backed boolean (correct without manifest via other signals)
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
  // role: raw manifest repoRole (legacy display), NOT the resolver token.
  const role = readRawRole(); // null if absent/unreadable
  // canonical: resolver-backed (correct via any signal, not just manifest).
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
