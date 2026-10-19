#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { isCanonicalDir } = require("../mc/repo-role");

const ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_POINTER_REL = path.join(".claude", "runtime", "admin-preview.json");

const SESSION_FILE = path.join(".admin-preview", "founder-session.json");
const EVENTS_FILE = path.join(".admin-preview", "sample-events.json");
const CHECKLIST_FILE = "FOUNDERS_CHECKLIST.md";
const FOUNDER_ALLOWLIST = ["founder@admin-preview.example"];

const SAMPLE_EVENTS = [
  { id: "evt-seed-1", type: "panel.viewed", actor: "founder@admin-preview.example", note: "warm-start sample" },
  { id: "evt-seed-2", type: "readiness.opened", actor: "founder@admin-preview.example", note: "warm-start sample" },
  { id: "evt-seed-3", type: "guides.opened", actor: "founder@admin-preview.example", note: "warm-start sample" },
];

function safeExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readPointer(pointerPath) {
  if (!safeExists(pointerPath)) {
    return {
      ok: false,
      error: `no live admin-preview instance pointer at ${path.relative(ROOT, pointerPath) || pointerPath} — run /admin:preview first`,
    };
  }
  let raw;
  try {
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

function writeChecklistIdempotent(file) {
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

function seed(opts = {}) {
  const pointerPath = opts.pointer
    ? path.resolve(opts.pointer)
    : path.join(ROOT, DEFAULT_POINTER_REL);

  const p = readPointer(pointerPath);
  if (!p.ok) return { ok: false, error: p.error };

  const instanceDir = path.resolve(p.instanceDir);

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
  actions.session = writeJsonIdempotent(path.join(instanceDir, SESSION_FILE), {
    schema: "mc/admin-preview-session/v1",
    allowlist: FOUNDER_ALLOWLIST,
    activeFounder: FOUNDER_ALLOWLIST[0],
    seededBy: "admin:seed",
  });
  actions.events = writeJsonIdempotent(path.join(instanceDir, EVENTS_FILE), {
    schema: "mc/admin-preview-events/v1",
    events: SAMPLE_EVENTS,
  });
  actions.checklist = writeChecklistIdempotent(path.join(instanceDir, CHECKLIST_FILE));

  return { ok: true, instanceDir, actions };
}

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
