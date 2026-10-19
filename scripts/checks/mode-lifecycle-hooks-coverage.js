#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");

const ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_REGISTRY =
  PATHS.modeLifecycleHooks ||
  path.join(ROOT, ".claude", "agents", "_org", "mode-lifecycle-hooks.json");
const DEFAULT_ALLOWLIST = path.join(__dirname, "mode-lifecycle-hooks-coverage.allowlist.json");

const VALID_MODES = ["block", "advisory"];

const ENFORCE = process.argv.includes("--enforce");
const JSON_OUT = process.argv.includes("--json");
function flagVal(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : dflt;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function validateRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== "object") {
    return { ok: false, errors: ["registry is not an object"] };
  }
  if (!Array.isArray(registry.events)) {
    return { ok: false, errors: ["registry.events missing or not an array"] };
  }
  if (registry.events.length === 0) {
    errors.push("registry.events is empty");
  }
  const seen = new Set();
  registry.events.forEach((row, i) => {
    const at = `events[${i}] (${row && row.event})`;
    if (!row || typeof row !== "object") {
      errors.push(`${at}: not an object`);
      return;
    }
    if (!row.event || typeof row.event !== "string") errors.push(`${at}: missing/invalid 'event'`);
    if (!row.when || typeof row.when !== "string") errors.push(`${at}: missing/invalid 'when'`);
    if (!VALID_MODES.includes(row.mode)) errors.push(`${at}: mode '${row.mode}' not one of ${VALID_MODES.join("|")}`);
    if (!Array.isArray(row.payload_fields)) errors.push(`${at}: 'payload_fields' must be an array`);
    if (row.harness_fires !== false) errors.push(`${at}: 'harness_fires' must be the literal false (virtual event)`);
    if (typeof row.event === "string") {
      if (seen.has(row.event)) errors.push(`${at}: duplicate event id '${row.event}'`);
      seen.add(row.event);
    }
  });
  return { ok: errors.length === 0, errors };
}

const SCAN_ROOTS = ["scripts", ".claude"];
const SCAN_SKIP_DIRS = new Set(["node_modules", ".git", ".worktrees", "releases"]);
const EMIT_RE = /\bemit\(\s*["']([^"']+)["']/g;
const SELF_BASENAMES = new Set([
  "lifecycle-events.js",
  "mode-lifecycle-hooks-coverage.js",
]);
function isExcludedFromEmitScan(file) {
  const base = path.basename(file);
  if (SELF_BASENAMES.has(base)) return true;
  if (/\.test\.js$/.test(base) || /^test-/.test(base)) return true;
  return false;
}

function* walkJs(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(e.name) || e.name.startsWith(".worktrees")) continue;
      yield* walkJs(full);
    } else if (e.isFile() && e.name.endsWith(".js")) {
      yield full;
    }
  }
}

function findStaticEmitters(root = ROOT) {
  const emitted = new Set();
  for (const sub of SCAN_ROOTS) {
    const dir = path.join(root, sub);
    for (const file of walkJs(dir)) {
      if (isExcludedFromEmitScan(file)) continue;
      let text;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!text.includes("lifecycle-events")) continue;
      let m;
      EMIT_RE.lastIndex = 0;
      while ((m = EMIT_RE.exec(text))) emitted.add(m[1]);
    }
  }
  return emitted;
}

function findRuntimeEmitters(eventsPath) {
  const emitted = new Set();
  if (!eventsPath || !fs.existsSync(eventsPath)) return emitted;
  let raw;
  try {
    raw = fs.readFileSync(eventsPath, "utf8");
  } catch {
    return emitted;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || !line.includes("lifecycle-event")) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const d = rec && rec.data;
    if (d && d.kind === "lifecycle-event" && typeof d.event === "string") emitted.add(d.event);
  }
  return emitted;
}

function readFrameworkVersion(root = ROOT) {
  const semver = (v) => (typeof v === "string" && /^\d+\.\d+\.\d+/.test(v) ? v : null);
  const read = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
    } catch {
      return null;
    }
  };
  const inst = read(path.join(".claude", "framework-installed.json"));
  if (inst && /^mc\/framework-installed\//.test(String(inst.$schema || "")) && inst.source && inst.source !== "self") return semver(inst.installedVersion);
  const vj = read("version.json");
  return vj && vj.$schema === "mc/version/v1" ? semver(vj.version) : null;
}

function versionGte(a, b) {
  const pa = String(a).split(/[.+-]/).slice(0, 3).map(Number);
  const pb = String(b).split(/[.+-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return true;
}

function loadAllowlistSchema(al, now = new Date(), currentVersion = readFrameworkVersion()) {
  const pending = new Set();
  const flagged = [];
  const wp = al && al.wiring_pending;
  if (!wp || typeof wp !== "object") return { pending, flagged };
  const todayIso = (now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date())
    .toISOString()
    .slice(0, 10);
  for (const [event, entry] of Object.entries(wp)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      flagged.push({ event, problem: "schemaless (not an object; needs { owner, review_by|expiry|review_by_version, reason })" });
      continue;
    }
    const owner = typeof entry.owner === "string" ? entry.owner.trim() : "";
    const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
    const rawExpiry = entry.review_by != null ? entry.review_by : entry.expiry;
    const expiry = typeof rawExpiry === "string" ? rawExpiry.trim() : "";
    const dueVersion = typeof entry.review_by_version === "string" ? entry.review_by_version.trim() : "";
    const missing = [];
    if (!owner) missing.push("owner");
    if (!expiry && !dueVersion) missing.push("review_by/expiry/review_by_version");
    if (!reason) missing.push("reason");
    if (missing.length) {
      flagged.push({ event, problem: `schemaless (missing ${missing.join(", ")})` });
      continue;
    }
    if (!expiry) {
      if (!/^\d+\.\d+\.\d+$/.test(dueVersion)) {
        flagged.push({ event, problem: `unparseable review_by_version '${dueVersion}' (treated as expired — fail-closed)` });
        continue;
      }
      if (!currentVersion) {
        flagged.push({ event, problem: "framework version unreadable (the install record, or else the framework's version.json, gives no MAJOR.MINOR.PATCH version) — review_by_version treated as due (fail-closed)" });
        continue;
      }
      if (versionGte(currentVersion, dueVersion)) {
        flagged.push({ event, problem: `REVIEW DUE at framework version ${dueVersion} (current ${currentVersion}) — downgraded to a gap` });
        continue;
      }
      pending.add(event);
      continue;
    }
    const m = expiry.match(/^(\d{4}-\d{2}-\d{2})/);
    const real = m && !Number.isNaN(Date.parse(`${m[1]}T00:00:00Z`)) && new Date(`${m[1]}T00:00:00Z`).toISOString().slice(0, 10) === m[1];
    const expiryDay = real ? m[1] : null;
    if (!expiryDay) {
      flagged.push({ event, problem: `unparseable review_by/expiry '${expiry}' (treated as expired — fail-closed)` });
      continue;
    }
    if (expiryDay < todayIso) {
      flagged.push({ event, problem: `EXPIRED review_by/expiry ${expiryDay} (past ${todayIso}) — downgraded to a gap` });
      continue;
    }
    pending.add(event);
  }
  return { pending, flagged };
}

function computeCoverage(registry, emitted, pending) {
  const covered = [];
  const pend = [];
  const gaps = [];
  for (const row of (registry.events || [])) {
    const ev = row && row.event;
    if (!ev) continue;
    if (emitted.has(ev)) covered.push(ev);
    else if (pending.has(ev)) pend.push(ev);
    else gaps.push(ev);
  }
  return { covered, pending: pend, gaps, total: (registry.events || []).length };
}

function main() {
  const registryPath = flagVal("--registry", DEFAULT_REGISTRY);
  const allowlistPath = flagVal("--allowlist", DEFAULT_ALLOWLIST);
  const eventsPath = flagVal("--events", mcEnv.readEnv("EVENTS_FILE") || PATHS.eventsFile);

  let registry;
  try {
    registry = readJson(registryPath);
  } catch (e) {
    process.stderr.write(`ERROR [mode-lifecycle-hooks-coverage] registry unreadable/unparseable (${registryPath}): ${e.message}\n`);
    return 2;
  }
  const rev = validateRegistry(registry);
  if (!rev.ok) {
    process.stderr.write(
      `FAIL [mode-lifecycle-hooks-coverage] registry structurally incoherent (${rev.errors.length}):\n` +
        rev.errors.map((e) => "  - " + e).join("\n") + "\n",
    );
    return 2;
  }

  let pending = new Set();
  let allowlistFlagged = [];
  try {
    const al = readJson(allowlistPath);
    const loaded = loadAllowlistSchema(al);
    pending = loaded.pending;
    allowlistFlagged = loaded.flagged;
  } catch {
  }

  const emitted = new Set([...findStaticEmitters(ROOT), ...findRuntimeEmitters(eventsPath)]);
  const res = computeCoverage(registry, emitted, pending);

  const ok = res.gaps.length === 0;
  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok,
      total: res.total,
      covered: res.covered.length,
      pending: res.pending.length,
      gaps: res.gaps,
      allowlistFlagged,
      enforce: ENFORCE,
    }));
  } else if (ok) {
    console.log(
      `OK   [mode-lifecycle-hooks-coverage] ${res.total} virtual event(s); ` +
        `${res.covered.length} emitted, ${res.pending.length} wiring-pending (info), 0 gaps`,
    );
  } else {
    const sink = ENFORCE ? process.stderr : process.stdout;
    sink.write(
      `${ENFORCE ? "FAIL" : "WARN"} [mode-lifecycle-hooks-coverage] ${res.gaps.length} ` +
        `event(s) declared with NO emitter and NOT wiring-pending` +
        `${ENFORCE ? "" : " (REPORT-ONLY — blocks only with --enforce)"}:\n`,
    );
    for (const g of res.gaps.slice(0, 25)) sink.write(`  - ${g}\n`);
    if (res.gaps.length > 25) sink.write(`  ... and ${res.gaps.length - 25} more\n`);
  }
  if (!JSON_OUT && allowlistFlagged.length) {
    const sink = ENFORCE && !ok ? process.stderr : process.stdout;
    sink.write(
      `note [mode-lifecycle-hooks-coverage] ${allowlistFlagged.length} allowlist entry(ies) REJECTED ` +
        `(schemaless/expired — not honored as wiring-pending; an uncovered such event is a GAP):\n`,
    );
    for (const f of allowlistFlagged.slice(0, 25)) sink.write(`  - ${f.event}: ${f.problem}\n`);
  }

  if (ok) return 0;
  return ENFORCE ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  validateRegistry,
  computeCoverage,
  loadAllowlistSchema,
  readFrameworkVersion,
  versionGte,
  findStaticEmitters,
  findRuntimeEmitters,
  readJson,
  DEFAULT_REGISTRY,
  DEFAULT_ALLOWLIST,
};
