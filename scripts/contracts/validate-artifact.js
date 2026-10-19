#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SCHEMAS_DIR = path.join(REPO_ROOT, "schemas", "contracts");

function loadSchemas(dir) {
  const reg = Object.create(null);
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

function validateOne(instance, reg) {
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
    return ["artifact is not an object"];
  }
  const t = instance.type;
  if (typeof t !== "string") return ["artifact missing string 'type'"];
  const schema = reg[t];
  if (!schema) return [`unknown artifact type: ${t}`];

  const errs = [];
  const expect = schema.properties.type.const;
  if (instance.type !== expect) {
    errs.push(`type mismatch: ${instance.type} != ${expect}`);
  }
  for (const req of schema.required || []) {
    const v = instance[req];
    if (v === undefined || v === null || v === "") {
      errs.push(`missing required field: ${req}`);
    }
  }
  return errs;
}

function effectivePrecedence(instance, schema) {
  if (typeof instance.precedence === "number") return instance.precedence;
  return schema.contract.precedence;
}

function validateChain(items, reg) {
  const errors = [];

  items.forEach((it, i) => {
    for (const e of validateOne(it, reg)) {
      errors.push(`[${i}:${it && it.type}] ${e}`);
    }
  });

  const seen = new Map();
  items.forEach((it) => {
    const schema = reg[it && it.type];
    if (!schema) return;
    const p = effectivePrecedence(it, schema);
    if (p === null || p === undefined) return;
    if (seen.has(p)) {
      errors.push(
        `precedence conflict: rank ${p} claimed by both ${seen.get(p)} and ${it.type}`,
      );
    } else {
      seen.set(p, it.type);
    }
  });

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
        );
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

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
    return 2;
  }
  try {
    input = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (e) {
    process.stderr.write(`validator error (input): ${e.message}\n`);
    return 2;
  }
  let result;
  try {
    result = validateInput(input, reg);
  } catch (e) {
    process.stderr.write(`validator error (validate): ${e.message}\n`);
    return 2;
  }
  const { ok, errors } = result;
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
