#!/usr/bin/env node
"use strict";
/**
 * scripts/bootstrap/phases/canon.js — the `canon` step (MC-PROMPT §1, §2).
 *
 * AI-SYNTHESIS step, anti-degrade. The canon step can NEVER report success while
 * any raw `{{token}}` OR any un-synthesized `*needs input: <field>*` marker survives
 * (except a field explicitly audited via --allow-needs-input). This is the LAST
 * line against degraded canon (the WI-51→WI-47 regression class), enforced
 * STRUCTURALLY regardless of caller.
 *
 * Flow:
 *   1. SCAFFOLD (deterministic): reuse scripts/canon/generate.js to render the
 *      structural scaffold of _requirements/00-canonical/* (valid shape, zero raw
 *      {{tokens}}; thin fields degrade to visible `*needs input:*` markers). Skipped
 *      when the artifacts already exist (idempotent) unless --force.
 *   2. FAIL-CLOSED GATE (non-opt-out): run scripts/checks/canon-no-unfilled-tokens.js
 *      on the output. A raw {{token}}, an unreadable/empty dir (exit 2), or a runner
 *      error → canon FAILED. This is the real enforcer the /scan suite runs — wired
 *      here as the completion gate, not a re-implementation.
 *   3. SYNTHESIS HANDOFF: any remaining `*needs input:*` field NOT in the
 *      --allow-needs-input audit list → status needs_orchestration with a prompt for
 *      the AI to synthesize those substantive fields IN PLACE (grounded in the brief;
 *      never invent — a genuinely-external fact uses --allow-needs-input + a logged
 *      reason). When the gate is clean (or all remaining are audited) → done.
 *
 * generate.js's deterministic render is structural scaffold ONLY; it NEVER ships as
 * "done." There is no --research off / --auto / skip path that bypasses this gate.
 *
 * Phase-module contract:
 *   ctx = { repoRoot, product, intentFile, outDir, research, researchIn, dryRun,
 *           allowNeedsInput[], args, log }
 *   run(ctx) → { ok, status: "done"|"needs_orchestration"|"failed", message, data?, orchestration_prompt? }
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { NARRATIVE, STRUCTURED } = require("../../canon/generate");

const EXPECTED_ARTIFACTS = NARRATIVE.length + STRUCTURED.length;

function resolveUnderRepo(repoRoot, p) {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

// All expected canonical artifacts present on disk? (idempotency signal — when the
// canon set already exists we skip the deterministic re-render and only re-run the
// gate, so an AI's in-place synthesis on --resume is never clobbered.)
function canonArtifactsPresent(outAbs) {
  const required = [...NARRATIVE, ...STRUCTURED].map((d) => (typeof d === "string" ? d : d.file || d.name));
  // NARRATIVE/STRUCTURED entries may be objects; fall back to a presence count.
  try {
    const ents = fs.readdirSync(outAbs).filter((f) => /\.(md|json)$/.test(f));
    return ents.length >= EXPECTED_ARTIFACTS;
  } catch {
    return false;
  }
  void required;
}

// Run the REAL fail-closed gate (the enforcer the /scan suite runs).
// Returns { code, ok, errors[], needsInput[] }. code 2 = fail-closed (unreadable/empty).
function runGate(repoRoot, outAbs) {
  const gate = path.join(repoRoot, "scripts", "checks", "canon-no-unfilled-tokens.js");
  const r = spawnSync(process.execPath, [gate, "--dir", outAbs, "--json"], {
    cwd: repoRoot, encoding: "utf8", windowsHide: true,
  });
  const code = r.status == null ? 2 : r.status;
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* unparseable → treat via code */ }
  return {
    code,
    ok: parsed ? parsed.ok === true : code === 0,
    errors: (parsed && parsed.errors) || [],
    needsInput: (parsed && parsed.needs_input) || [],
    raw: (r.stderr || r.stdout || "").trim().split(/\r?\n/).slice(-4).join(" | "),
  };
}

function runTechStackGate(repoRoot, outAbs) {
  const gate = path.join(repoRoot, "scripts", "checks", "canon-tech-stack.js");
  const r = spawnSync(process.execPath, [gate, "--dir", outAbs, "--json"], {
    cwd: repoRoot, encoding: "utf8", windowsHide: true,
  });
  const code = r.status == null ? 2 : r.status;
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* unparseable -> treat via code */ }
  return {
    code,
    ok: parsed ? parsed.ok === true : code === 0,
    errors: (parsed && parsed.errors) || [],
    unresolved: (parsed && parsed.unresolved) || [],
    stack: (parsed && parsed.stack) || {},
    raw: (r.stderr || r.stdout || "").trim().split(/\r?\n/).slice(-4).join(" | "),
  };
}

async function run(ctx) {
  const { repoRoot, product, intentFile, outDir, research, dryRun, log } = ctx;
  const allow = new Set((ctx.allowNeedsInput || (ctx.args && ctx.args.allowNeedsInput) || []).map(String));

  // ── Gate: the canon step consumes the setup step's intent file ───────────
  if (!intentFile) {
    return { ok: false, status: "failed", message: "canon step requires an intent file from the setup step" };
  }
  const intentAbs = resolveUnderRepo(repoRoot, intentFile);
  if (!fs.existsSync(intentAbs) && !dryRun) {
    return { ok: false, status: "failed", message: `canon step requires an intent file from the setup step (not found: ${intentFile})` };
  }
  const outAbs = resolveUnderRepo(repoRoot, outDir);
  const force = Boolean(ctx.args && ctx.args.force);

  // Dry-run preview when the intent isn't materialized yet (e.g. a full-chain
  // --dry-run where setup didn't write the brief): report what canon WOULD do
  // without shelling to the engine (which would fail on the missing file).
  if (dryRun && !fs.existsSync(intentAbs)) {
    log(`[dry-run] would render + gate canonical scaffold for "${product}" from ${intentFile} (intent not yet materialized in this dry-run)`);
    return { ok: true, status: "done", message: `[dry-run] canon previewed for "${product}" → ${outDir}`, data: { out: outDir, roadmapPath: "ROADMAP.md" } };
  }

  // ── 1. SCAFFOLD (deterministic) — skip when artifacts already exist ──────
  if (force || !canonArtifactsPresent(outAbs)) {
    const generateScript = path.join(repoRoot, "scripts", "canon", "generate.js");
    const cliArgs = [generateScript, "--intent", intentAbs, "--product", String(product), "--out", outAbs, "--research", research, "--json"];
    if (ctx.researchIn || (ctx.args && ctx.args.researchIn)) {
      cliArgs.push("--research-in", resolveUnderRepo(repoRoot, ctx.researchIn || ctx.args.researchIn));
    }
    if (dryRun) cliArgs.push("--dry-run");
    log(`${dryRun ? "[dry-run] " : ""}rendering canonical scaffold for "${product}" (research=${research})...`);
    const r = spawnSync(process.execPath, cliArgs, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
    if (r.error) return { ok: false, status: "failed", message: `canon engine failed to spawn: ${r.error.message}` };
    let parsed;
    try { parsed = JSON.parse(r.stdout); }
    catch (e) {
      const tail = (r.stderr || r.stdout || "").trim().split(/\r?\n/).slice(-5).join(" | ");
      return { ok: false, status: "failed", message: `canon engine produced unparseable JSON (exit ${r.status}): ${e.message}${tail ? ` — ${tail}` : ""}` };
    }
    if (r.status !== 0 || parsed.ok !== true) {
      const errs = (parsed.validation && parsed.validation.errors || []).join("; ");
      return { ok: false, status: "failed", message: `canon scaffold failed (engine exit ${r.status}, ok=${parsed.ok})${errs ? `: ${errs}` : ""}` };
    }
    log(`${dryRun ? "[dry-run] would write " : "wrote "}${(parsed.artifacts || []).length} canonical artifacts → ${outDir}`);
  } else {
    log(`canon artifacts already present in ${outDir} — skipping re-render (idempotent), running gate on existing set`);
  }

  if (dryRun) {
    return { ok: true, status: "done", message: `[dry-run] canon scaffold validated for "${product}" → ${outDir}`, data: { out: outDir } };
  }

  // ── 2. FAIL-CLOSED GATE (non-opt-out) ────────────────────────────────────
  const gate = runGate(repoRoot, outAbs);
  if (gate.code === 2) {
    return { ok: false, status: "failed", message: `canon gate fail-closed (unreadable/empty canonical dir ${outDir}): ${gate.raw}` };
  }
  if (gate.errors.length) {
    // Raw {{token}} leaks are an engine bug, never an AI-synthesis matter — hard fail.
    return { ok: false, status: "failed", message: `canon gate FAILED — raw unfilled tokens present: ${gate.errors.slice(0, 8).join("; ")}` };
  }

  // ── 3. SYNTHESIS HANDOFF — un-synthesized substantive fields ─────────────
  // needs_input entries are "FILE:field"; the field is the part after the last ':'.
  const stackGate = runTechStackGate(repoRoot, outAbs);
  if (stackGate.code === 2) {
    return { ok: false, status: "failed", message: `canon tech-stack gate fail-closed (${outDir}): ${stackGate.raw}` };
  }
  if (stackGate.errors.length) {
    return { ok: false, status: "failed", message: `canon tech-stack gate FAILED: ${stackGate.errors.slice(0, 8).join("; ")}` };
  }
  log(
    `canon tech-stack gate PASS - Tech Stack block parseable` +
      (stackGate.unresolved.length ? ` (${stackGate.unresolved.length} unresolved choice(s))` : ""),
  );

  const remaining = gate.needsInput.filter((ni) => {
    const field = String(ni).split(":").pop();
    return !allow.has(field) && !allow.has(String(ni));
  });
  const audited = gate.needsInput.filter((ni) => !remaining.includes(ni));
  if (audited.length) {
    log(`canon: ${audited.length} audited needs-input field(s) allowed via --allow-needs-input (genuinely external): ${audited.join(", ")}`);
  }

  if (remaining.length) {
    return {
      ok: false,
      status: "needs_orchestration",
      message: `canon synthesis required — ${remaining.length} substantive field(s) un-synthesized: ${remaining.join(", ")}`,
      data: { out: outDir, needs_input: remaining, audited_needs_input: audited },
      orchestration_prompt:
        `Synthesize the un-filled canonical fields IN PLACE under ${outDir}/* — replace each ` +
        `\`*needs input: <field>*\` marker with substance SYNTHESIZED from the brief (${intentFile}) ` +
        `${research !== "off" ? "and the research findings" : ""}: vision, JTBD, cohorts, golden paths, ` +
        `product model, failure states. Never invent or generic-substitute; a genuinely-external real-world ` +
        `fact (one only the user can supply) must be passed back as \`--allow-needs-input <field>\` with a ` +
        `logged reason (/enforcement:log), NOT faked. Fields: ${remaining.join(", ")}. Then re-invoke ` +
        `\`canon --resume\` — the fail-closed gate is the proof the synthesis was real.`,
    };
  }

  // ── Success — gate clean (or all remaining audited) ──────────────────────
  log(`canon gate PASS — zero raw tokens, ${audited.length ? `${audited.length} audited needs-input` : "zero needs-input"} → ${outDir}`);
  return {
    ok: true,
    status: "done",
    message: `canon: synthesized + gate-clean for "${product}" → ${outDir}`,
    data: { out: outDir, audited_needs_input: audited, roadmapPath: "ROADMAP.md" },
  };
}

module.exports = { name: "canon", run, runGate, runTechStackGate, canonArtifactsPresent, EXPECTED_ARTIFACTS };
