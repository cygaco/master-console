#!/usr/bin/env node
/**
 * scripts/admin/seed.js — warm-start data for the in-app founder admin panel.
 *
 * SP-20260614-002 R-3 (Builder 2). READS the single instance pointer written by
 * the R-1 keystone (scripts/admin/preview.js) to discover the throwaway instance
 * directory, then seeds INTO that instance ONLY:
 *   - a founder-allowlist session marker (so the panel renders authenticated)
 *   - a small set of sample events (so the panel renders non-empty)
 *   - a FOUNDERS_CHECKLIST.md (so launch-readiness renders warm-start), reusing
 *     scripts/scaffold/founders-checklist.js#renderFoundersChecklist.
 *
 * SINGLE-WRITER INVARIANT (AC-R3c): this module is a READER of the pointer. It
 * NEVER writes .claude/runtime/admin-preview.json — preview.js is the sole writer.
 * Search this file: the pointer path appears only inside readPointer()'s
 * fs.readFileSync. There is NO fs.write* / rename targeting that path here.
 *
 * GUARDS:
 *   - No live pointer  → fail CLEAR ("run /admin:preview first"), non-zero, no
 *     scaffold of a second instance.
 *   - MC-refusal   → if the resolved seed target is the MC canonical
 *     root, refuse before any write (refuseIfTargetIsMC), non-zero.
 *   - Idempotent       → running twice produces no duplicate checklist, no
 *     duplicate founder session, no duplicate sample events.
 *
 * lazy require: scripts/scaffold/founders-checklist.js is required INSIDE the
 * seed step, not at module load, so requiring this module for tests/resolution
 * never drags in the checklist renderer's transitive cost.
 *
 * CLI:
 *   node scripts/admin/seed.js [--pointer <path>] [--json]
 *
 * Exit 0 on success, non-zero (1) on any fail-clear precondition or error.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { isCanonicalDir } = require("../mc/repo-role");

// Repo root resolved from this module's location (scripts/admin/../.. = root).
const ROOT = path.resolve(__dirname, "..", "..");

// The single instance pointer. preview.js is the SOLE WRITER; seed.js READS only.
const DEFAULT_POINTER_REL = path.join(".claude", "runtime", "admin-preview.json");

// Seed artifact markers (used for idempotency).
const SESSION_FILE = path.join(".admin-preview", "founder-session.json");
const EVENTS_FILE = path.join(".admin-preview", "sample-events.json");
const CHECKLIST_FILE = "FOUNDERS_CHECKLIST.md";
const FOUNDER_ALLOWLIST = ["founder@admin-preview.local"];

// Stable sample events the warm-start panel renders.
const SAMPLE_EVENTS = [
  { id: "evt-seed-1", type: "panel.viewed", actor: "founder@admin-preview.local", note: "warm-start sample" },
  { id: "evt-seed-2", type: "readiness.opened", actor: "founder@admin-preview.local", note: "warm-start sample" },
  { id: "evt-seed-3", type: "guides.opened", actor: "founder@admin-preview.local", note: "warm-start sample" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * readPointer(pointerPath) → { ok, instanceDir?, error? }
 * The ONLY place the pointer is touched — and it is a READ. Never written here.
 */
function readPointer(pointerPath) {
  if (!safeExists(pointerPath)) {
    return {
      ok: false,
      error: `no live admin-preview instance pointer at ${path.relative(ROOT, pointerPath) || pointerPath} — run /admin:preview first`,
    };
  }
  let raw;
  try {
    // Strip a possible BOM (this repo can ship BOM'd JSON).
    raw = fs.readFileSync(pointerPath, "utf8").replace(/^﻿/, "");
  } catch (e) {
    return { ok: false, error: `could not read instance pointer: ${e.message} — run /admin:preview first` };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `instance pointer is malformed JSON: ${e.message} — re-run /admin:preview` };
  }
  const instanceDir = obj && typeof obj.instanceDir === "string" ? obj.instanceDir.trim() : "";
  if (!instanceDir) {
    return { ok: false, error: "instance pointer is missing instanceDir — re-run /admin:preview" };
  }
  return { ok: true, instanceDir, pointer: obj };
}

/**
 * refuseIfTargetIsMC(targetDir) → { mc: boolean, reason?: string }
 * Mirrors the keystone guard (preview.js): never seed into the MC canonical
 * tree. Detection is target-LOCAL and unforgeable — path identity OR
 * isCanonicalDir(), the env-IMMUNE signals-only detector in
 * scripts/mc/repo-role.js (the single source per ED-009). isCanonicalDir
 * intentionally ignores MC_REPO_ROLE, so the safety floor cannot be
 * env-spoofed (xprovider review HIGH #5 — the concern that previously pushed this
 * guard to hand-roll its own detection). Routing through the resolver keeps the
 * single-source invariant without losing the env-immunity property.
 */
function refuseIfTargetIsMC(targetDir) {
  const resolved = path.resolve(targetDir);
  if (resolved === ROOT) {
    return { mc: true, reason: `resolved seed target is the MC canonical root (${resolved})` };
  }
  if (isCanonicalDir(resolved)) {
    return { mc: true, reason: `seed target resolves to the MC canonical tree (repo-role canonical signal at ${resolved})` };
  }
  return { mc: false };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * writeJsonIdempotent(file, value) → "created" | "unchanged"
 * Writes value only if the file is absent or its content differs — running twice
 * with the same value is a no-op (idempotent).
 */
function writeJsonIdempotent(file, value) {
  const next = JSON.stringify(value, null, 2) + "\n";
  if (safeExists(file)) {
    let cur = "";
    try {
      cur = fs.readFileSync(file, "utf8");
    } catch {
      cur = "";
    }
    if (cur === next) return "unchanged";
  }
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, next, "utf8");
  return "created";
}

/**
 * writeChecklistIdempotent(file) → "created" | "unchanged"
 * Renders FOUNDERS_CHECKLIST.md via the shared producer (lazy require). If the
 * file already carries the mc checklist markers, leave it as-is (idempotent —
 * never duplicate the block).
 */
function writeChecklistIdempotent(file) {
  // Lazy require — the checklist renderer is only loaded when seeding runs.
  const { renderFoundersChecklist, MARKER_OPEN } = require(path.join(
    ROOT, "scripts", "scaffold", "founders-checklist.js"
  ));
  if (safeExists(file)) {
    let cur = "";
    try {
      cur = fs.readFileSync(file, "utf8");
    } catch {
      cur = "";
    }
    if (cur.includes(MARKER_OPEN)) return "unchanged";
  }
  const md = renderFoundersChecklist({});
  fs.writeFileSync(file, md, "utf8");
  return "created";
}

// ── Seed ─────────────────────────────────────────────────────────────────────

/**
 * seed(opts) → { ok, instanceDir?, actions?, error? }
 * Pure-ish entry: takes an explicit pointer path so tests inject a temp pointer.
 * Performs NO pointer writes.
 */
function seed(opts = {}) {
  const pointerPath = opts.pointer
    ? path.resolve(opts.pointer)
    : path.join(ROOT, DEFAULT_POINTER_REL);

  const p = readPointer(pointerPath);
  if (!p.ok) return { ok: false, error: p.error };

  const instanceDir = path.resolve(p.instanceDir);

  // MC-refusal on the seed target BEFORE any write.
  const guard = refuseIfTargetIsMC(instanceDir);
  if (guard.mc) {
    return { ok: false, error: `refused: ${guard.reason} — admin:seed never writes into MC itself` };
  }

  if (!safeExists(instanceDir)) {
    return {
      ok: false,
      error: `instance dir ${instanceDir} from the pointer does not exist — re-run /admin:preview`,
    };
  }

  const actions = {};
  // Founder-allowlist session marker.
  actions.session = writeJsonIdempotent(path.join(instanceDir, SESSION_FILE), {
    schema: "mc/admin-preview-session/v1",
    allowlist: FOUNDER_ALLOWLIST,
    activeFounder: FOUNDER_ALLOWLIST[0],
    seededBy: "admin:seed",
  });
  // Sample events.
  actions.events = writeJsonIdempotent(path.join(instanceDir, EVENTS_FILE), {
    schema: "mc/admin-preview-events/v1",
    events: SAMPLE_EVENTS,
  });
  // Warm-start launch-readiness checklist.
  actions.checklist = writeChecklistIdempotent(path.join(instanceDir, CHECKLIST_FILE));

  return { ok: true, instanceDir, actions };
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { json: false, pointer: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--pointer") out.pointer = argv[++i];
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const r = seed({ pointer: args.pointer });
  if (args.json) {
    process.stdout.write(JSON.stringify(r) + "\n");
  } else if (r.ok) {
    process.stdout.write(
      `admin:seed → seeded into ${r.instanceDir}\n` +
        `  session=${r.actions.session} events=${r.actions.events} checklist=${r.actions.checklist}\n`
    );
  } else {
    process.stderr.write(`admin:seed failed: ${r.error}\n`);
  }
  process.exit(r.ok ? 0 : 1);
}

module.exports = {
  seed,
  readPointer,
  refuseIfTargetIsMC,
  DEFAULT_POINTER_REL,
  SESSION_FILE,
  EVENTS_FILE,
  CHECKLIST_FILE,
};
