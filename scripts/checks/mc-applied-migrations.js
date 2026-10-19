#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");

function semver(v) {
  return v.split(".").map((n) => parseInt(n, 10) || 0);
}
function cmp(a, b) {
  const A = semver(a),
    B = semver(b);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
}

function loadCapsuleMigrations(rootDir) {
  const releasesDir = path.join(rootDir, "framework", "releases");
  const known = new Set();
  if (!fs.existsSync(releasesDir)) return known;
  for (const ent of fs.readdirSync(releasesDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const releaseFile = path.join(releasesDir, ent.name, "release.json");
    if (!fs.existsSync(releaseFile)) continue;
    try {
      const r = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
      for (const m of r.migrations || []) {
        if (m && typeof m === "object") {
          if (m.file) known.add(String(m.file));
          if (m.dir) known.add(String(m.dir));
          if (m.id) known.add(String(m.id));
          if (m.name) known.add(String(m.name));
        } else if (typeof m === "string") {
          known.add(m);
        }
      }
    } catch {
    }
  }
  return known;
}

const installedFile = path.join(ROOT, ".claude", "framework-installed.json");
if (!fs.existsSync(installedFile)) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({
        ok: true,
        reason: "no framework-installed.json — not a consumer project",
      }),
    );
  else
    console.log(
      "OK   [mc-applied-migrations] not a MC-installed consumer project",
    );
  process.exit(0);
}
const installedVersion = JSON.parse(
  fs.readFileSync(installedFile, "utf8"),
).installedVersion;

const migrationsDir = path.join(ROOT, "migrations");
if (!fs.existsSync(migrationsDir)) {
  if (JSON_OUT)
    console.log(JSON.stringify({ ok: true, reason: "no migrations/ dir" }));
  else console.log("OK   [mc-applied-migrations] no migrations/ dir");
  process.exit(0);
}

const capsuleKnown = loadCapsuleMigrations(ROOT);
const stale = [];
const expectedFromCapsule = [];
for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const name = entry.name;
  const m = name.match(/^([0-9.x]+)-to-([0-9.]+)$/);
  if (!m) continue;
  const targetVersion = m[2].replace(/\.x$/, ".0");
  if (cmp(installedVersion, targetVersion) >= 0) {
    const dirKey = `migrations/${name}`;
    const inCapsule =
      capsuleKnown.has(dirKey) ||
      capsuleKnown.has(name) ||
      [...capsuleKnown].some((k) => k.includes(name));
    if (inCapsule) {
      expectedFromCapsule.push({
        dir: dirKey,
        target: targetVersion,
        installed: installedVersion,
      });
    } else {
      stale.push({
        dir: dirKey,
        target: targetVersion,
        installed: installedVersion,
      });
    }
  }
}

if (stale.length === 0) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({
        ok: true,
        installedVersion,
        count: 0,
        expectedFromCapsule: expectedFromCapsule.length,
      }),
    );
  else
    console.log(
      `OK   [mc-applied-migrations] no stale migrations (installed ${installedVersion}${
        expectedFromCapsule.length
          ? `; ${expectedFromCapsule.length} present + expected by capsule`
          : ""
      })`,
    );
  process.exit(0);
}

const out = {
  ok: false,
  installedVersion,
  count: stale.length,
  stale,
  expectedFromCapsule: expectedFromCapsule.length,
};
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.error(
    `FAIL [mc-applied-migrations] ${stale.length} already-applied migration(s) on disk and NOT in any capsule release.json#migrations[]:`,
  );
  for (const s of stale)
    console.error(
      `  - ${s.dir}  (target ${s.target} <= installed ${s.installed})`,
    );
  console.error(
    '\nFix: remove the stale dir(s) or run preflight with --operator-override applied-migrations --override-reason "<text>".',
  );
}
process.exit(1);
