#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const MODULE_PATH = path.join(__dirname, "views", "populate-seed-provenance.js");
const { populateSeedProvenance, BASELINE_PREFIX, PROVENANCE_FILE } = require(MODULE_PATH);
const { SKELETON_DIRS } = require("./scaffold-core");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

const noop = () => {};
const FORBIDDEN_SOURCE = ["framework", "templates"].join("/");

function snapshotMarkers(root) {
  const out = {};
  for (const zone of SKELETON_DIRS) {
    const abs = path.join(root, zone, PROVENANCE_FILE);
    out[zone] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  }
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-seed-prov-"));
try {
  for (const zone of SKELETON_DIRS) {
    fs.mkdirSync(path.join(tmp, zone), { recursive: true });
  }

  const VERSION = "9.9.9";
  const r1 = populateSeedProvenance({ targetRoot: tmp, mcVersion: VERSION, log: noop });

  ok("writer ok + wrote every seed zone", r1.ok && r1.written.length === SKELETON_DIRS.length,
    `ok=${r1.ok} written=${r1.written.length}/${SKELETON_DIRS.length}`);
  ok("writer reports the seeding version", r1.version === VERSION, `version=${r1.version}`);

  let allMarkersValid = true;
  let firstBadDetail = "";
  for (const zone of SKELETON_DIRS) {
    const abs = path.join(tmp, zone, PROVENANCE_FILE);
    if (!fs.existsSync(abs)) {
      allMarkersValid = false;
      firstBadDetail = firstBadDetail || `missing marker for ${zone}`;
      continue;
    }
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      allMarkersValid = false;
      firstBadDetail = firstBadDetail || `unparseable marker for ${zone}: ${e.message}`;
      continue;
    }
    const srcOk =
      typeof marker.seeded_from === "string" &&
      (marker.seeded_from.startsWith("_mc/BASELINE/") ||
        marker.seeded_from.startsWith("_mc/templates/")) &&
      marker.seeded_from === `${BASELINE_PREFIX}/${zone}`;
    const fieldsOk =
      marker.framework_version === VERSION &&
      marker.seeded_by === "/mc:setup" &&
      marker.zone === zone &&
      !marker.seeded_from.includes(FORBIDDEN_SOURCE);
    if (!srcOk || !fieldsOk) {
      allMarkersValid = false;
      firstBadDetail = firstBadDetail || `bad marker for ${zone}: seeded_from=${marker.seeded_from}`;
    }
  }
  ok("every zone marker: seeded_from under _mc/ + correct fields", allMarkersValid, firstBadDetail);

  const before = snapshotMarkers(tmp);
  const r2 = populateSeedProvenance({ targetRoot: tmp, mcVersion: VERSION, log: noop });
  const after = snapshotMarkers(tmp);
  const byteStable = SKELETON_DIRS.every((z) => before[z] === after[z] && after[z] !== null);
  ok("second run is byte-stable (idempotent)", byteStable);
  ok("second run writes nothing new, all unchanged",
    r2.written.length === 0 && r2.unchanged.length === SKELETON_DIRS.length,
    `written=${r2.written.length} unchanged=${r2.unchanged.length}`);

  const userZone = "_requirements/00-canonical";
  const userFile = path.join(tmp, userZone, "USER_NOTES.md");
  const userContent = "# my notes\noperator-authored — must survive a re-run\n";
  fs.writeFileSync(userFile, userContent);

  const editedMarkerZone = "_docs";
  const editedMarkerAbs = path.join(tmp, editedMarkerZone, PROVENANCE_FILE);
  const operatorMarker = JSON.stringify({ custom: "operator-edited marker" }, null, 2) + "\n";
  fs.writeFileSync(editedMarkerAbs, operatorMarker);

  const r3 = populateSeedProvenance({ targetRoot: tmp, mcVersion: VERSION, log: noop });

  ok("pre-edited operator content file untouched",
    fs.readFileSync(userFile, "utf8") === userContent);
  ok("hand-edited marker preserved, not clobbered",
    fs.readFileSync(editedMarkerAbs, "utf8") === operatorMarker &&
      r3.preserved.includes(editedMarkerZone),
    `preserved=${JSON.stringify(r3.preserved)}`);

  const moduleSrc = fs.readFileSync(MODULE_PATH, "utf8");
  ok(`module has zero "${FORBIDDEN_SOURCE}" references`,
    !moduleSrc.includes(FORBIDDEN_SOURCE));
  ok("module references the _mc/ baseline source", moduleSrc.includes("_mc/BASELINE"));

  {
    const escRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-seed-esc-"));
    try {
      const targetInside = path.join(escRoot, "product");
      fs.mkdirSync(targetInside, { recursive: true });
      const escZone = "../pwned";
      const leakedDir = path.join(escRoot, "pwned");
      const leakedMarker = path.join(leakedDir, PROVENANCE_FILE);

      const rEsc = populateSeedProvenance({
        targetRoot: targetInside,
        mcVersion: VERSION,
        zones: [escZone],
        log: noop,
      });

      ok("'../pwned' zone reported in result.failed (not silently written)",
        rEsc.failed.some((f) => f.zone === escZone) && rEsc.written.length === 0,
        `failed=${JSON.stringify(rEsc.failed)} written=${JSON.stringify(rEsc.written)}`);
      ok("'../pwned' wrote NOTHING outside the target root",
        !fs.existsSync(leakedMarker) && !fs.existsSync(leakedDir),
        `leaked=${leakedMarker}`);
      ok("'../pwned' marks the run not-ok (ok=false, code=1)",
        rEsc.ok === false && rEsc.code === 1,
        `ok=${rEsc.ok} code=${rEsc.code}`);
    } finally {
      try { fs.rmSync(escRoot, { recursive: true, force: true }); } catch { }
    }
  }

  {
    const jRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-seed-jct-"));
    try {
      const targetJ = path.join(jRoot, "product");
      const outside = path.join(jRoot, "outside");
      fs.mkdirSync(targetJ, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      const junctionZone = "_docs";
      const junctionPath = path.join(targetJ, junctionZone);
      let junctionMade = false;
      try {
        fs.symlinkSync(outside, junctionPath, "junction");
        junctionMade = true;
      } catch {
        try {
          fs.symlinkSync(outside, junctionPath, "dir");
          junctionMade = true;
        } catch { }
      }

      if (!junctionMade) {
        ok("junction-escape test SKIPPED (env cannot create a junction/symlink) — '../escape' still covers traversal", true);
      } else {
        const rJ = populateSeedProvenance({
          targetRoot: targetJ,
          mcVersion: VERSION,
          zones: [junctionZone],
          log: noop,
        });
        const leakedMarker = path.join(outside, PROVENANCE_FILE);
        ok("junction zone: marker NOT written through the junction",
          !fs.existsSync(leakedMarker), `leaked=${leakedMarker}`);
        ok("junction zone reported in result.failed (escape detected), nothing written",
          rJ.failed.some((f) => f.zone === junctionZone) && rJ.written.length === 0,
          `failed=${JSON.stringify(rJ.failed)} written=${JSON.stringify(rJ.written)}`);
      }
    } finally {
      try { fs.rmSync(jRoot, { recursive: true, force: true }); } catch { }
    }
  }
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
  }
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
