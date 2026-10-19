#!/usr/bin/env node
"use strict";

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

const JSON_REQUIRED = {
  "FIELD_REGISTRY.json": ["version"],
  "PRECEDENCE.json": ["version", "cascade"],
  "STEPS.json": ["version", "phases", "steps"],
  "WATCHED_DIRS.json": ["version", "directories"],
};

function headingRegex(line) {
  const escaped = line
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{\\\{[a-zA-Z0-9_\s]+\\\}\\\}/g, ".*?");
  return new RegExp("^" + escaped + "\\s*$", "m");
}

function templateHeadings(tmpl) {
  return tmpl
    .split(/\r?\n/)
    .filter((l) => /^#{1,3}\s+\S/.test(l))
    .map((l) => l.trim());
}

function productFromH1(md) {
  const m = /^#\s+(.+?)\s+[—-]\s+/m.exec(md);
  return m ? m[1].trim() : null;
}

function phaseIds(phases) {
  if (!Array.isArray(phases)) return [];
  return phases
    .map((p) =>
      typeof p === "string" ? p : p && (p.id || p.name || p.key || p.label),
    )
    .filter(Boolean)
    .map(String);
}

function validateArtifacts(artifacts, opts = {}) {
  const tmplDir = opts.tmplDir || TMPL_DIR;
  const narrative = opts.narrative || DEFAULT_NARRATIVE;
  const structured = opts.structured || DEFAULT_STRUCTURED;
  const errors = [];
  const warnings = [];
  const thinSet = new Set();

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
    const raw = body.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
    if (raw)
      for (const tok of raw)
        errors.push(`${fname}: raw unfilled token "${tok}" — degrade bypassed`);
    let ni;
    const niRe = /\*needs input:\s*([a-zA-Z0-9_]+)\s*\*/g;
    while ((ni = niRe.exec(body)) !== null) thinSet.add(`${fname}:${ni[1]}`);
  }

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
    if (/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(body))
      errors.push(`${fname}: raw unfilled token — degrade bypassed`);
  }

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
      const gp = artifacts["GOLDEN_PATHS.md"];
      if (typeof gp === "string" && !/\{\{\s*path_1_name\s*\}\}/.test(gp))
        warnings.push(
          "STEPS.json: phases/steps empty but GOLDEN_PATHS declares a path — seed STEPS by hand",
        );
    }
  }

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
