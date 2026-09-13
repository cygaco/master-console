#!/usr/bin/env node
"use strict";
/**
 * scripts/bootstrap/phases/roadmap.js — the `roadmap` step (MC-PROMPT §1, §2, §5).
 *
 * Turns the canon (_requirements/00-canonical/*) into a real ROADMAP.md with
 * EPICS + sprints, MVP-core-loop first (Epic-1 sprint-1 = the core loop on screen).
 *
 * DETERMINISTIC seed + LLM synthesis split: the deterministic part shells to the
 * existing scaffold engine (scripts/mc/generate-roadmap-scaffold.js) which emits
 * an EMPTY product-style ROADMAP.md (placeholder prose, NO grounded epics/sprints,
 * NO `<!-- ledger:sprints -->` anchor). The grounded epic/sprint synthesis from the
 * canon's golden paths is roadmap:create's LLM job — a node process can't run it — so
 * the step returns needs_orchestration; the consumer (in-loop Alpha or a runner)
 * fulfills it and re-invokes --resume. There is NO --auto self-complete path (§2: a
 * thin templated roadmap is degraded output).
 *
 * Phase-module contract (see scripts/bootstrap/spinup-orchestrate.js):
 *   ctx = { repoRoot, product, intentFile, outDir, research, dryRun, args, log }
 *   run(ctx) → { ok, status: "done"|"needs_orchestration"|"failed", message, data?, orchestration_prompt? }
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// The canon docs the roadmap must be grounded in. CORE_BRIEF + GOLDEN_PATHS are the
// load-bearing pair for MVP-core-loop sequencing.
const CANON_REQUIRED = ["CORE_BRIEF.md", "GOLDEN_PATHS.md"];

function canonDir(ctx) {
  const out = ctx.outDir || "_requirements/00-canonical";
  return path.isAbsolute(out) ? out : path.join(ctx.repoRoot, out);
}

// Has the consumer already produced a grounded roadmap? A roadmap:create result
// carries the `<!-- ledger:sprints -->` anchor AND an Epics (or legacy Milestones)
// heading; the bare scaffold has neither.
function isGroundedRoadmap(roadmapAbs) {
  let body;
  try { body = fs.readFileSync(roadmapAbs, "utf8"); }
  catch { return false; }
  const hasLedgerAnchor = body.includes("<!-- ledger:sprints -->");
  const hasEpics = /^#+\s.*Epics/im.test(body);
  const hasMilestones = /^#+\s.*Milestones/im.test(body); // legacy product roadmaps
  return hasLedgerAnchor && (hasEpics || hasMilestones);
}

async function run(ctx) {
  const { repoRoot, product, dryRun, log } = ctx;
  const dir = canonDir(ctx);

  // ── Precondition: the canon step must have produced the grounding docs ──
  const missing = CANON_REQUIRED.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length && !dryRun) {
    return { ok: false, status: "failed", message: `roadmap step requires canon output (missing ${missing.join(", ")} under ${ctx.outDir})` };
  }

  const roadmapAbs = path.join(repoRoot, "ROADMAP.md");
  const roadmapRel = "ROADMAP.md";

  // ── Already-grounded short-circuit (idempotent) ──────────────────────────
  if (isGroundedRoadmap(roadmapAbs)) {
    log(`grounded ROADMAP.md present (epics + ledger anchor) → ${roadmapRel}`);
    return {
      ok: true,
      status: "done",
      message: `grounded roadmap accepted → ${roadmapRel}`,
      data: { roadmapPath: roadmapRel, grounded: true, firstAction: "Epic-1 S1: bring the core loop on screen." },
    };
  }

  // ── Deterministic seed: scaffold an empty ROADMAP.md if none exists ──────
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

  // ── Hand the grounded synthesis back to the consumer ─────────────────────
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
