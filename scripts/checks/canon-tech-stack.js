#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  CANONICAL_STACK_REL,
  parseTechStackBlock,
} = require("../canon/tech-stack");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const out = { dir: null, file: null, json: false, strictValues: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dir = argv[++i];
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--strict-values") out.strictValues = true;
  }
  return out;
}

function resolveTarget(args) {
  if (args.file) return path.isAbsolute(args.file) ? args.file : path.resolve(REPO_ROOT, args.file);
  if (args.dir) {
    const dir = path.isAbsolute(args.dir) ? args.dir : path.resolve(REPO_ROOT, args.dir);
    return path.join(dir, "DATA_AND_ACCOUNTS.md");
  }
  return path.join(REPO_ROOT, CANONICAL_STACK_REL);
}

function emit(args, code, payload) {
  if (args.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return code;
  }
  const rel = path.relative(REPO_ROOT, payload.file || "").split(path.sep).join("/");
  if (code === 0) {
    process.stdout.write(
      `OK canon-tech-stack: ${rel} has a parseable Tech Stack block` +
        (payload.unresolved.length ? ` (${payload.unresolved.length} unresolved choice(s))` : "") +
        "\n",
    );
    return 0;
  }
  const target = code === 2 ? process.stderr : process.stderr;
  target.write(
    `FAIL canon-tech-stack (${code}) ${rel || "(unknown target)"}:\n` +
      (payload.errors || []).map((e) => `  - ${e}`).join("\n") +
      "\n",
  );
  return code;
}

function main(argv) {
  const args = parseArgs(argv || process.argv);
  const file = resolveTarget(args);
  let body;
  try {
    body = fs.readFileSync(file, "utf8");
  } catch (e) {
    return emit(args, 2, {
      ok: false,
      file,
      stack: {},
      unresolved: [],
      errors: [`cannot read DATA_AND_ACCOUNTS.md target: ${e.message}`],
      warnings: [],
    });
  }

  const parsed = parseTechStackBlock(body);
  const errors = [...parsed.errors];
  if (args.strictValues && parsed.unresolved.length) {
    errors.push(...parsed.unresolved.map((u) => `unresolved stack choice: ${u}`));
  }
  return emit(args, errors.length ? 1 : 0, {
    ok: errors.length === 0,
    file,
    stack: parsed.stack,
    rows: parsed.rows,
    unresolved: parsed.unresolved,
    errors,
    warnings: parsed.warnings,
  });
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { main, parseArgs, resolveTarget };
