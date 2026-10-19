#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CANON_REQUIRED = ["CORE_BRIEF.md", "GOLDEN_PATHS.md"];

function canonDir(ctx) {
  const out = ctx.outDir || "_requirements/00-canonical";
  return path.isAbsolute(out) ? out : path.join(ctx.repoRoot, out);
}

function isGroundedRoadmap(roadmapAbs) {
  let body;
  try { body = fs.readFileSync(roadmapAbs, "utf8"); }
  catch { return false; }
  const hasLedgerAnchor = body.includes("<!-- ledger:sprints -->");
  const hasEpics = /^#+\s.*Epics/im.test(body);
  const hasMilestones = /^#+\s.*Milestones/im.test(body);
  return hasLedgerAnchor && (hasEpics || hasMilestones);
}

async function run(ctx) {
  const { repoRoot, product, dryRun, log } = ctx;
  const dir = canonDir(ctx);

  const missing = CANON_REQUIRED.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length && !dryRun) {
    return { ok: false, status: "failed", message: `roadmap step requires canon output (missing ${missing.join(", ")} under ${ctx.outDir})` };
  }

  const roadmapAbs = path.join(repoRoot, "ROADMAP.md");
  const roadmapRel = "ROADMAP.md";

  if (isGroundedRoadmap(roadmapAbs)) {
    log(`grounded ROADMAP.md present (epics + ledger anchor) → ${roadmapRel}`);
    return {
      ok: true,
      status: "done",
      message: `grounded roadmap accepted → ${roadmapRel}`,
      data: { roadmapPath: roadmapRel, grounded: true, firstAction: "Epic-1 S1: bring the core loop on screen." },
    };
  }

  const scaffoldScript = path.join(repoRoot, "scripts", "mc", "generate-roadmap-scaffold.js");
  const scaffoldExisted = fs.existsSync(roadmapAbs);
  if (dryRun) {
    log(`[dry-run] would seed roadmap scaffold via generate-roadmap-scaffold.js (target ${repoRoot})`);
    log(`[dry-run] scaffold is an EMPTY template — grounded synthesis still needs roadmap:create`);
  } else if (!fs.existsSync(scaffoldScript)) {
    log(`scaffold engine not found at scripts/mc/generate-roadmap-scaffold.js — skipping seed`);
  } else {
    log(`seeding roadmap scaffold (reusing generate-roadmap-scaffold.js)...`);
    const r = spawnSync(process.execPath, [scaffoldScript, repoRoot], { cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    if (r.error) return { ok: false, status: "failed", message: `generate-roadmap-scaffold.js failed to spawn: ${r.error.message}` };
    if (r.status !== 0) return { ok: false, status: "failed", message: `generate-roadmap-scaffold.js exited ${r.status} (target ${repoRoot})` };
    if (scaffoldExisted) log(`ROADMAP.md already present — scaffold left it alone (idempotent)`);
    else log(`empty roadmap scaffold written → ${roadmapRel}`);
  }

  const productArg = product ? ` for product "${product}"` : "";
  return {
    ok: false,
    status: "needs_orchestration",
    message: `roadmap synthesis from canon (scaffold seeded; grounded epics+sprints need roadmap:create)`,
    data: { roadmapPath: roadmapRel, scaffolded: !dryRun, grounded: false, canonDir: ctx.outDir },
    orchestration_prompt:
      `Run roadmap:create --source canonical grounded in ${ctx.outDir}/* ` +
      `(MVP-core-loop first: Epic-1 sprint-1 = the core loop on screen via the paint step)${productArg}, ` +
      `rendering EPICS + sprints + the <!-- ledger:sprints --> anchor into ${roadmapRel}, then re-invoke roadmap --resume.`,
  };
}

module.exports = { name: "roadmap", run, canonDir, isGroundedRoadmap, CANON_REQUIRED };
