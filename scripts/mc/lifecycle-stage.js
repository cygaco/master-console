#!/usr/bin/env node
/**
 * scripts/mc/lifecycle-stage.js — resolve the product's current lifecycle stage.
 *
 * The single resolver for "what phase is this product in," per the canonical model
 * in .claude/project/reference/product-lifecycle.md. The Director of Product /
 * Director of QA ground their lifecycle-aware judgment (Principle #2) in this.
 *
 * Stage tokens (← the 5-phase model):
 *   research | pre-mvp | launch | finding-pmf | pmf
 *   (pre-mvp = "Early Development / Pre-Launch" — building 0-to-1 toward an MVP.)
 *
 * Precedence (first wins):
 *   1. MC_LIFECYCLE_STAGE env var   ← the quick override (session / CI / set in
 *      .claude/settings.json#env for persistence). This is why a script resolver
 *      exists: a subagent (Read/Grep/Glob only) cannot read env, so the orchestrator
 *      resolves the stage here and passes it to the Director on dispatch.
 *   2. paths.currentStage file's `Stage:` field (the declarative source of truth —
 *      Beta + the decision policy already read this file every invocation).
 *   3. "unknown" (undeclared — the Director then infers from evidence).
 *
 *   node scripts/mc/lifecycle-stage.js          # print the resolved stage
 *   node scripts/mc/lifecycle-stage.js --json   # {stage, source, valid}
 *
 * Exit 0 always (resolution is informational); `valid:false` flags an unrecognized
 * declared value so a typo doesn't silently read as "unknown".
 */

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const STAGES = Object.freeze(["research", "pre-mvp", "launch", "finding-pmf", "pmf"]);

function normalize(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, "-");
}

// Accept a few intuitive aliases → canonical token.
const ALIASES = Object.freeze({
  "early-development": "pre-mvp",
  "pre-launch": "pre-mvp",
  "prelaunch": "pre-mvp",
  "mvp": "pre-mvp",
  "seeking-pmf": "finding-pmf",
  "pmf-search": "finding-pmf",
  "product-market-fit": "pmf",
});

function canonical(v) {
  const n = normalize(v);
  return ALIASES[n] || n;
}

function currentStagePath() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "paths.json"), "utf8"));
    return p.currentStage ? path.join(ROOT, p.currentStage) : null;
  } catch {
    return null;
  }
}

function fromFile() {
  const fp = currentStagePath();
  if (!fp) return null;
  try {
    const text = fs.readFileSync(fp, "utf8");
    // Match: **Stage:** `pre-mvp`   (tolerant of backticks / spacing / case)
    const m = text.match(/\*\*Stage:\*\*\s*`?\s*([a-z0-9-]+)\s*`?/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function resolve() {
  const env = mcEnv.readEnv("LIFECYCLE_STAGE");
  if (env && env.trim()) {
    const c = canonical(env);
    return { stage: c, source: "env:MC_LIFECYCLE_STAGE", valid: STAGES.includes(c) };
  }
  const f = fromFile();
  if (f) {
    const c = canonical(f);
    return { stage: c, source: "file:currentStage", valid: STAGES.includes(c) };
  }
  return { stage: "unknown", source: "none", valid: false };
}

if (require.main === module) {
  const json = process.argv.includes("--json");
  const r = resolve();
  if (json) {
    process.stdout.write(JSON.stringify({ ...r, stages: STAGES }) + "\n");
  } else {
    process.stdout.write(`${r.stage}\n`);
    if (!r.valid && r.stage !== "unknown") {
      process.stderr.write(
        `warning: "${r.stage}" (from ${r.source}) is not a canonical stage — expected one of: ${STAGES.join(", ")}\n`,
      );
    }
  }
  process.exit(0);
}

module.exports = { resolve, STAGES, canonical };
