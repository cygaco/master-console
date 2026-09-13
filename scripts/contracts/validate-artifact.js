#!/usr/bin/env node
"use strict";

/**
 * Fail-closed validator for MC product-studio artifact contracts (v0.1).
 *
 * Loads the schemas in schemas/contracts/, then validates a single artifact
 * instance OR a chain (array) of them. It REJECTS (exit 1) — never
 * lint-and-pass — on:
 *   - unknown artifact type            (fail-closed; AC-3.1)
 *   - missing required field           (AC-2.1)
 *   - type/const mismatch
 *   - precedence conflict in a chain   (two artifacts share an effective rank; AC-3.2)
 *   - dangling message_brief reference (derived_from_message_brief id absent from the chain; AC-3.3)
 * A clean conformant chain exits 0 (AC-3.4).
 *
 * Hand-rolled (no ajv vendored) to match the house validators
 * (validate-autonomy-config.js, mc/manifest/validate.js). Any INTERNAL
 * error (missing schema dir, unparseable input) is fail-closed: exit 2, never
 * 0 — a validator that errors must not read as "pass" (LRN false-green class).
 *
 * "Skeleton" = wired + genuinely rejecting on the contract-level violations
 * above; deep per-field business validation is post-pilot (v0.1 is revisable).
 *
 * Usage:
 *   node scripts/contracts/validate-artifact.js <artifact-or-chain.json>
 *   node scripts/contracts/validate-artifact.js --schemas-dir <dir> <file>
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SCHEMAS_DIR = path.join(REPO_ROOT, "schemas", "contracts");

/** Load schemas/contracts/*.schema.json into a { type -> schema } registry. */
function loadSchemas(dir) {
  const reg = {};
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".schema.json"));
  if (files.length === 0) throw new Error(`no schemas found in ${dir}`);
  for (const f of files) {
    const schema = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const t =
      schema.properties &&
      schema.properties.type &&
      schema.properties.type.const;
    if (!t) throw new Error(`schema ${f} has no properties.type.const`);
    if (!schema.contract) throw new Error(`schema ${f} has no 'contract' block`);
    reg[t] = schema;
  }
  return reg;
}

/** Validate one instance against its schema. Returns array of violation strings. */
function validateOne(instance, reg) {
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
    return ["artifact is not an object"];
  }
  const t = instance.type;
  if (typeof t !== "string") return ["artifact missing string 'type'"];
  const schema = reg[t];
  if (!schema) return [`unknown artifact type: ${t}`]; // fail-closed (AC-3.1)

  const errs = [];
  const expect = schema.properties.type.const;
  if (instance.type !== expect) {
    errs.push(`type mismatch: ${instance.type} != ${expect}`);
  }
  for (const req of schema.required || []) {
    const v = instance[req];
    if (v === undefined || v === null || v === "") {
      errs.push(`missing required field: ${req}`); // AC-2.1
    }
  }
  return errs;
}

/** Effective precedence = instance override (if numeric) else the schema's. */
function effectivePrecedence(instance, schema) {
  if (typeof instance.precedence === "number") return instance.precedence;
  return schema.contract.precedence; // may be null (e.g. decision_record)
}

/** Validate a chain (array of instances). Returns { ok, errors[] }. */
function validateChain(items, reg) {
  const errors = [];

  items.forEach((it, i) => {
    for (const e of validateOne(it, reg)) {
      errors.push(`[${i}:${it && it.type}] ${e}`);
    }
  });

  // Distinct effective precedence (null = non-chain artifact, e.g. decision_record, excluded).
  const seen = new Map();
  items.forEach((it) => {
    const schema = reg[it && it.type];
    if (!schema) return; // already flagged unknown
    const p = effectivePrecedence(it, schema);
    if (p === null || p === undefined) return;
    if (seen.has(p)) {
      errors.push(
        `precedence conflict: rank ${p} claimed by both ${seen.get(p)} and ${it.type}`,
      ); // AC-3.2
    } else {
      seen.set(p, it.type);
    }
  });

  // message_brief reference integrity (the spine).
  const mbIds = new Set(
    items
      .filter((it) => it && it.type === "message_brief")
      .map((it) => it.id),
  );
  items.forEach((it) => {
    if (it && typeof it.derived_from_message_brief === "string") {
      if (!mbIds.has(it.derived_from_message_brief)) {
        errors.push(
          `dangling message_brief reference: ${it.type}#${it.id} cites '${it.derived_from_message_brief}' not present in chain`,
        ); // AC-3.3
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/** Accept a single artifact, an array, or { chain: [...] }. */
function validateInput(input, reg) {
  let items;
  if (Array.isArray(input)) items = input;
  else if (input && Array.isArray(input.chain)) items = input.chain;
  else items = [input];
  return validateChain(items, reg);
}

function main(argv) {
  let schemasDir = DEFAULT_SCHEMAS_DIR;
  let file = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--schemas-dir") schemasDir = path.resolve(argv[++i]);
    else if (!argv[i].startsWith("--")) file = argv[i];
  }
  if (!file) {
    process.stderr.write(
      "usage: validate-artifact.js [--schemas-dir <dir>] <artifact-or-chain.json>\n",
    );
    return 2;
  }
  let reg;
  let input;
  try {
    reg = loadSchemas(schemasDir);
  } catch (e) {
    process.stderr.write(`validator error (schemas): ${e.message}\n`);
    return 2; // fail-closed
  }
  try {
    input = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (e) {
    process.stderr.write(`validator error (input): ${e.message}\n`);
    return 2; // fail-closed
  }
  const { ok, errors } = validateInput(input, reg);
  if (ok) {
    process.stdout.write("OK: artifact(s) valid against contracts v0.1\n");
    return 0;
  }
  process.stderr.write(
    `REJECTED (${errors.length}):\n${errors.map((e) => "  - " + e).join("\n")}\n`,
  );
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  loadSchemas,
  validateOne,
  validateChain,
  validateInput,
  effectivePrecedence,
  DEFAULT_SCHEMAS_DIR,
};
