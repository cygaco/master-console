#!/usr/bin/env node
"use strict";
/**
 * scripts/canon/validate.js — output validation for the canon engine
 * (SP-20260525-022 T5 / T-20260525-233).
 *
 * Validates the rendered artifact set before/after emit:
 *   1. Narrative section-presence — every static heading in each MD template must
 *      appear in its rendered artifact (template-driven, so it can't rot when a
 *      template changes). A missing section is an ERROR (a real rendering bug).
 *   2. Structured JSON — each of the 4 JSON artifacts must JSON.parse and carry
 *      its required top-level keys. Parse/shape failure is an ERROR.
 *   3. Cross-references resolve:
 *      - product_name identical (and non-empty) across all 7 narrative H1s.
 *      - STEPS referential integrity: every steps[].phase is declared in phases[]
 *        (STEPS<->GOLDEN_PATHS); dangling = ERROR, empty-while-path-exists = WARNING.
 *      - FIELD_REGISTRY appears_in[] entries resolve to an emitted artifact = WARNING.
 *   4. WI-38 zero-unfilled-token invariant: a raw `{{token}}` surviving into ANY
 *      rendered artifact is an ERROR (not a warning). The engine degrades every
 *      unfilled field to a `*needs input: <field>*` marker before validation, so a
 *      raw token here means degrade was bypassed/regressed — a real bug. The
 *      `needs input:` markers are the SANCTIONED thin signal: reported in `thin`
 *      (never a silent pass), never an error.
 *
 * Contract: a STRUCTURALLY correct engine produces zero ERRORS on ANY intent;
 * ERRORS mean a real bug (incl. a raw-token leak). `needs input:` markers are
 * reported as `thin` and still exit 0.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TMPL_DIR = path.join(REPO_ROOT, "_mc", "templates", "canonical");

const DEFAULT_NARRATIVE = [
  "CORE_BRIEF",
  "USER_COHORTS",
  "GOLDEN_PATHS",
  "PRODUCT_MODEL",
  "EVOLUTION",
  "FAILURE_STATES",
  "GLOSSARY",
];
const DEFAULT_STRUCTURED = ["FIELD_REGISTRY", "PRECEDENCE", "STEPS", "WATCHED_DIRS"];

// Required top-level keys per structured artifact.
const JSON_REQUIRED = {
  "FIELD_REGISTRY.json": ["version"],
  "PRECEDENCE.json": ["version", "cascade"],
  "STEPS.json": ["version", "phases", "steps"],
  "WATCHED_DIRS.json": ["version", "directories"],
};

// Turn a template heading line into a regex that tolerates {{token}} -> .*?
function headingRegex(line) {
  const escaped = line
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex metachars
    .replace(/\\\{\\\{[a-zA-Z0-9_\s]+\\\}\\\}/g, ".*?"); // {{token}} -> .*?
  return new RegExp("^" + escaped + "\\s*$", "m");
}

// Extract static heading lines (## / ###) from a template body.
function templateHeadings(tmpl) {
  return tmpl
    .split(/\r?\n/)
    .filter((l) => /^#{1,3}\s+\S/.test(l))
    .map((l) => l.trim());
}

// Pull the product name from a narrative H1: "# <product> — <title>".
function productFromH1(md) {
  const m = /^#\s+(.+?)\s+[—-]\s+/m.exec(md);
  return m ? m[1].trim() : null;
}

// Collect declared phase identifiers from STEPS phases[].
function phaseIds(phases) {
  if (!Array.isArray(phases)) return [];
  return phases
    .map((p) =>
      typeof p === "string" ? p : p && (p.id || p.name || p.key || p.label),
    )
    .filter(Boolean)
    .map(String);
}

/**
 * @param {object} artifacts  { "DOC.md"|"DOC.json": "<body>", ... }
 * @param {object} [opts]     { tmplDir, narrative, structured }
 * @returns {{ ok, errors: string[], warnings: string[], thin: string[] }}
 */
function validateArtifacts(artifacts, opts = {}) {
  const tmplDir = opts.tmplDir || TMPL_DIR;
  const narrative = opts.narrative || DEFAULT_NARRATIVE;
  const structured = opts.structured || DEFAULT_STRUCTURED;
  const errors = [];
  const warnings = [];
  const thinSet = new Set();

  // 1 + 4: narrative section-presence + thin detection
  for (const name of narrative) {
    const fname = `${name}.md`;
    const body = artifacts[fname];
    if (typeof body !== "string") {
      errors.push(`${fname}: missing from output`);
      continue;
    }
    const tmplPath = path.join(tmplDir, `${name}.md.tmpl`);
    if (fs.existsSync(tmplPath)) {
      const tmpl = fs.readFileSync(tmplPath, "utf8");
      for (const h of templateHeadings(tmpl)) {
        if (!headingRegex(h).test(body)) {
          errors.push(`${fname}: missing required section heading "${h}"`);
        }
      }
    }
    // WI-38: a raw {{token}} surviving render is an ERROR (degrade was bypassed).
    const raw = body.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
    if (raw)
      for (const tok of raw)
        errors.push(`${fname}: raw unfilled token "${tok}" — degrade bypassed (WI-38)`);
    // SANCTIONED thin signal: `*needs input: <field>*` markers (reported, not failed).
    let ni;
    const niRe = /\*needs input:\s*([a-zA-Z0-9_]+)\s*\*/g;
    while ((ni = niRe.exec(body)) !== null) thinSet.add(`${fname}:${ni[1]}`);
  }

  // 2: structured JSON validity + required keys
  const parsed = {};
  for (const name of structured) {
    const fname = `${name}.json`;
    const body = artifacts[fname];
    if (typeof body !== "string") {
      errors.push(`${fname}: missing from output`);
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(body);
      parsed[fname] = obj;
    } catch (e) {
      errors.push(`${fname}: invalid JSON — ${e.message}`);
      continue;
    }
    for (const k of JSON_REQUIRED[fname] || []) {
      if (!(k in obj)) errors.push(`${fname}: missing required key "${k}"`);
    }
    // A raw {{token}} in JSON would usually break parse above; if it survived
    // (e.g. inside a string), it's still a WI-38 invariant breach -> ERROR.
    if (/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(body))
      errors.push(`${fname}: raw unfilled token — degrade bypassed (WI-38)`);
  }

  // 3a: product_name identical across narrative H1s
  const names = {};
  for (const name of narrative) {
    const body = artifacts[`${name}.md`];
    if (typeof body !== "string") continue;
    const p = productFromH1(body);
    if (!p) errors.push(`${name}.md: could not read product name from H1`);
    else names[name] = p;
  }
  const distinct = [...new Set(Object.values(names))];
  if (distinct.length > 1)
    errors.push(
      `product_name mismatch across narrative docs: ${JSON.stringify(names)}`,
    );

  // 3b: STEPS <-> phases referential integrity (+ STEPS<->GOLDEN_PATHS)
  const steps = parsed["STEPS.json"];
  if (steps) {
    const ids = phaseIds(steps.phases);
    const stepList = Array.isArray(steps.steps) ? steps.steps : [];
    for (const s of stepList) {
      const ph = typeof s === "string" ? null : s && s.phase;
      if (ph && !ids.includes(String(ph)))
        errors.push(`STEPS.json: step references undeclared phase "${ph}"`);
    }
    if (ids.length === 0 && stepList.length === 0) {
      // empty STEPS is fine for a fresh scaffold, but warn if GOLDEN_PATHS has a path
      const gp = artifacts["GOLDEN_PATHS.md"];
      if (typeof gp === "string" && !/\{\{\s*path_1_name\s*\}\}/.test(gp))
        warnings.push(
          "STEPS.json: phases/steps empty but GOLDEN_PATHS declares a path — seed STEPS by hand",
        );
    }
  }

  // 3c: FIELD_REGISTRY appears_in[] resolves to an emitted artifact
  const reg = parsed["FIELD_REGISTRY.json"];
  if (reg && typeof reg === "object") {
    const artifactNames = new Set(Object.keys(artifacts));
    const walk = (obj) => {
      if (!obj || typeof obj !== "object") return;
      for (const [k, v] of Object.entries(obj)) {
        if (k === "appears_in" && Array.isArray(v)) {
          for (const ref of v) {
            const base = String(ref).split("/").pop();
            if (!artifactNames.has(base) && !artifactNames.has(String(ref)))
              warnings.push(
                `FIELD_REGISTRY.json: appears_in "${ref}" does not resolve to an emitted artifact`,
              );
          }
        } else if (v && typeof v === "object") walk(v);
      }
    };
    walk(reg);
  }

  const thin = [...thinSet].sort();
  return { ok: errors.length === 0, errors, warnings, thin };
}

module.exports = { validateArtifacts, templateHeadings, headingRegex, productFromH1 };
