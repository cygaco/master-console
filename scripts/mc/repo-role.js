#!/usr/bin/env node
/**
 * scripts/mc/repo-role.js — resolve the canonical-vs-consumer repo role.
 *
 * The SINGLE source of truth for "is this repo the MC framework source
 * (canonical), a product install that consumes the framework (consumer), or
 * something unrecognisable (unknown)?" Every guard that gates on repo role MUST
 * call this instead of re-deriving heuristics inline. The invariant is enforced
 * by scripts/checks/repo-role-single-source.js (ED-009).
 *
 * Role tokens:
 *   'canonical'  — this repo IS the MC framework source tree
 *   'consumer'   — a product install that consumes the framework
 *   'unknown'    — cannot determine (no signals; don't block, don't enforce)
 *
 * Precedence (first wins):
 *   (a) explicit override arg   resolveRepoRole({ override: 'canonical' })
 *   (b) env WARPOS_REPO_ROLE    WARPOS_REPO_ROLE=canonical node <script>
 *   (c) manifest/marker signals  — see CANONICAL_SIGNALS below
 *   (d) structural heuristic    version.json#name === "mc"
 *   (e) consumer heuristic      .claude/framework-installed.json present but no canonical signal
 *   (f) 'unknown'               no signals at all
 *
 * Domain validation: override and env values MUST be a member of ROLES
 * (canonical|consumer|unknown). An invalid value is silently ignored and
 * processing falls through to the next precedence tier. This preserves the
 * role ∈ ROLES invariant — returning an out-of-enum value would silently break
 * every === 'canonical' / === 'consumer' check downstream.
 *
 * WHY (a) MATTERS (LRN-2026-05-30): subagents and guards invoked in contexts
 * that cannot read env vars must be able to pass the role explicitly so the
 * orchestrator's resolved value threads through cleanly. This is the #1 reason
 * the resolver accepts an arg.
 *
 * Fail-safe: on any read/parse error fall through — do NOT spuriously return
 * 'canonical'. The "safer = strict" invariant: an ambiguous repo is treated as
 * non-canonical, keeping gates active.
 *
 * CLI:
 *   node scripts/mc/repo-role.js           # print the resolved role
 *   node scripts/mc/repo-role.js --json    # {role,source,canonical,consumer,roles}
 *
 * Exit 0 always (resolution is informational).
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Resolved from this module's location so it works when required from any callsite.
const ROOT = path.resolve(__dirname, "..", "..");

const ROLES = Object.freeze(["canonical", "consumer", "unknown"]);

// repoRole values in .claude/manifest.json that mean "this IS the framework".
const CANONICAL_ROLE_VALUES = new Set(["canonical", "framework"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeExists(p) {
  try {
    return fs.existsSync(p);
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

// ── Canonical signal detection (filesystem only) ─────────────────────────────
/**
 * detectCanonicalSignal(root) → string|null
 *
 * Returns a source token if `root` carries a positive canonical filesystem
 * signal, else null. This is the FILESYSTEM-ONLY detector: it deliberately does
 * NOT consult the override arg or the WARPOS_REPO_ROLE env var. resolveRepoRole()
 * layers override/env ON TOP of this; safety guards that must be env-IMMUNE call
 * it through isCanonicalDir() so a hostile or misconfigured env can never spoof a
 * canonical tree into looking non-canonical (xprovider review HIGH #5 — the very
 * reason the admin:* guards previously hand-rolled their own detection).
 *
 * Fail-safe: any read/parse error yields null (safer = not canonical).
 */
function detectCanonicalSignal(root) {
  // Signal 1: _mc/MANIFEST.json — the strongest canonical marker. Only the
  // canonical source tree ships this; consumer installs receive a product-side
  // copy with a different shape. Presence alone is sufficient.
  if (safeExists(path.join(root, "_mc", "MANIFEST.json"))) {
    return "marker:_mc/MANIFEST.json";
  }

  // Signal 2: .mc-canonical explicit marker file — written by maintainers in
  // mid-build trees where _mc/ isn't yet present.
  if (safeExists(path.join(root, ".mc-canonical"))) {
    return "marker:.mc-canonical";
  }

  // Signal 3: .claude/manifest.json — four fields can signal canonical.
  try {
    const mfp = path.join(root, ".claude", "manifest.json");
    if (fs.existsSync(mfp)) {
      // Strip BOM (this repo ships BOM'd JSON — mirror testsuite/role.js).
      const m = JSON.parse(fs.readFileSync(mfp, "utf8").replace(/^﻿/, ""));
      if (m) {
        // Field 3a: explicit repoRole field.
        if (typeof m.repoRole === "string" && CANONICAL_ROLE_VALUES.has(m.repoRole)) {
          return "manifest.json#repoRole";
        }
        // Field 3b: mc.repoRole (nested variant).
        if (m.mc && typeof m.mc.repoRole === "string" && CANONICAL_ROLE_VALUES.has(m.mc.repoRole)) {
          return "manifest.json#mc.repoRole";
        }
        // Field 3c: mc.source === "self" (the canonical dev repo self-identifies).
        if (m.mc && m.mc.source === "self") {
          return "manifest.json#mc.source";
        }
        // Field 3d: project.slug === the canonical slug.
        if (m.project && m.project.slug === "mc") {
          return "manifest.json#project.slug";
        }
      }
    }
  } catch {
    /* read/parse error — fall through; safer = not canonical */
  }

  // Signal 4 (structural heuristic): version.json#name === "mc" — backup for
  // trees mid-build before the manifest is fully written.
  try {
    const vjp = path.join(root, "version.json");
    if (fs.existsSync(vjp)) {
      const v = JSON.parse(fs.readFileSync(vjp, "utf8"));
      if (v && v.name === "mc") {
        return "version.json#name";
      }
    }
  } catch {
    /* fall through */
  }

  return null;
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * resolveRepoRole(opts?) → { role, source, canonical, consumer }
 *
 * @param {object}  [opts]
 * @param {string}  [opts.override]  Explicit role string — wins over EVERYTHING
 *                                   including env. Pass when the caller has already
 *                                   resolved the role and wants to thread it through.
 * @param {string}  [opts.root]      Directory to probe for role signals.
 *                                   Default: the repo root resolved from this module's
 *                                   own __dirname (scripts/mc/../.. = project root).
 * @param {string}  [opts.cwd]       Alias for opts.root (backward-compat shim).
 * @returns {{ role: string, source: string, canonical: boolean, consumer: boolean }}
 */
function resolveRepoRole(opts) {
  const overrideArg = opts && typeof opts.override === "string" ? opts.override.trim() : "";
  const root = opts && (opts.root || opts.cwd)
    ? path.resolve(opts.root || opts.cwd)
    : ROOT;

  // ── (a) Explicit override arg ────────────────────────────────────────────
  // Wins unconditionally when valid — subagents pass this when env is unavailable.
  // Invalid values (not in ROLES) are ignored and fall through to the next tier,
  // preserving the role ∈ ROLES invariant.
  if (overrideArg) {
    const normalized = overrideArg.toLowerCase();
    if (ROLES.includes(normalized)) {
      return makeResult(normalized, "arg:override");
    }
    // Invalid override value — fall through to env/signals.
  }

  // ── (b) Env override ─────────────────────────────────────────────────────
  // Same domain validation: invalid env values fall through rather than
  // contaminating the result with a non-enum role token.
  const envVal = (process.env.WARPOS_REPO_ROLE || "").trim();
  if (envVal) {
    const normalized = envVal.toLowerCase();
    if (ROLES.includes(normalized)) {
      return makeResult(normalized, "env:WARPOS_REPO_ROLE");
    }
    // Invalid env value — fall through to signals.
  }

  // ── (c)+(d) Filesystem canonical signals ─────────────────────────────────
  // Delegated to detectCanonicalSignal() so the SAME detection logic backs both
  // resolveRepoRole() (override/env on top) and the env-immune isCanonicalDir()
  // (signals only). Canonical if ANY positive signal is present; read/parse
  // errors yield null so a corrupt file never causes a false-canonical verdict.
  const sig = detectCanonicalSignal(root);
  if (sig) {
    return makeResult("canonical", sig);
  }

  // ── (e) Consumer heuristic ───────────────────────────────────────────────
  // A repo with .claude/framework-installed.json but NONE of the canonical
  // signals above is a consumer install.
  if (safeExists(path.join(root, ".claude", "framework-installed.json"))) {
    return makeResult("consumer", "heuristic:framework-installed.json");
  }

  // ── (f) Unknown ──────────────────────────────────────────────────────────
  return makeResult("unknown", "none");
}

/**
 * isCanonicalDir(dir) → boolean
 *
 * TRUE iff `dir` carries a positive canonical filesystem signal. Unlike
 * resolveRepoRole(), this NEVER consults the override arg or the
 * WARPOS_REPO_ROLE env var — it is the env-IMMUNE detector for safety floors
 * that must not be spoofable (the admin:* "never run/seed against MC itself"
 * guards; xprovider review HIGH #5). It answers "is THIS directory the MC
 * canonical tree?", so it probes `dir` directly rather than the module root.
 *
 * Acceptable false-positive (fail-CLOSED): a product whose
 * .claude/manifest.json#project.slug is literally the canonical slug reads as
 * canonical. For a safety floor that is the SAFE direction (refuse), never the
 * dangerous one (a false negative that lets a guard run against real MC).
 */
function isCanonicalDir(dir) {
  return detectCanonicalSignal(path.resolve(dir)) !== null;
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const json = process.argv.includes("--json");
  const r = resolveRepoRole();
  if (json) {
    process.stdout.write(JSON.stringify({ ...r, roles: ROLES }) + "\n");
  } else {
    process.stdout.write(`${r.role}\n`);
  }
  process.exit(0); // always 0 — resolution is informational
}

module.exports = { resolveRepoRole, isCanonicalDir, ROLES };
