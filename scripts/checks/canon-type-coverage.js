#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const { NARRATIVE, STRUCTURED } = require("../canon/generate");

const EXPECTED_TOTAL = 12;
const EXPECTED_NARRATIVE = 8;
const EXPECTED_STRUCTURED = 4;

function resolveTemplateDir() {
  const fallback = path.join(REPO_ROOT, "_mc", "templates", "canonical");
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"),
    );
    return reg.canonicalTemplates
      ? path.join(REPO_ROOT, reg.canonicalTemplates)
      : fallback;
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const out = { dir: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dir = argv[++i];
    else if (a === "--json") out.json = true;
  }
  return out;
}

function resolveEmittedDir(arg) {
  if (!arg) return null;
  return path.isAbsolute(arg) ? arg : path.resolve(REPO_ROOT, arg);
}

function main(argv) {
  const args = parseArgs(argv || process.argv);
  const errors = [];
  const notes = [];

  if (
    NARRATIVE.length !== EXPECTED_NARRATIVE ||
    STRUCTURED.length !== EXPECTED_STRUCTURED ||
    NARRATIVE.length + STRUCTURED.length !== EXPECTED_TOTAL
  ) {
    const msg =
      `canon-type-coverage: manifest self-consistency FAILED — ` +
      `expected ${EXPECTED_NARRATIVE} narrative + ${EXPECTED_STRUCTURED} structured = ${EXPECTED_TOTAL}, ` +
      `got ${NARRATIVE.length} + ${STRUCTURED.length} = ${NARRATIVE.length + STRUCTURED.length}. ` +
      `Update EXPECTED_* constants in this file after an intentional manifest change.`;
    process.stderr.write(msg + "\n");
    return 2;
  }

  const tmplDir = resolveTemplateDir();
  let tmplEnts;
  try {
    tmplEnts = fs.readdirSync(tmplDir, { withFileTypes: true });
  } catch (e) {
    process.stderr.write(
      `canon-type-coverage: cannot read template dir ${path.relative(REPO_ROOT, tmplDir)} — ${e.message}\n`,
    );
    return 2;
  }

  const tmplNames = new Set(
    tmplEnts.filter((e) => e.isFile()).map((e) => e.name),
  );

  const missingTmpls = [];
  for (const type of NARRATIVE) {
    const expected = `${type}.md.tmpl`;
    if (!tmplNames.has(expected)) missingTmpls.push(`narrative template missing: ${expected}`);
  }
  for (const type of STRUCTURED) {
    const expected = `${type}.json.tmpl`;
    if (!tmplNames.has(expected)) missingTmpls.push(`structured template missing: ${expected}`);
  }
  for (const m of missingTmpls) errors.push(m);

  const emittedDir = resolveEmittedDir(args.dir);
  let emittedArtifacts = null;

  if (emittedDir) {
    let emittedEnts;
    try {
      emittedEnts = fs.readdirSync(emittedDir, { withFileTypes: true });
    } catch (e) {
      process.stderr.write(
        `canon-type-coverage: cannot read emitted dir ${args.dir} — ${e.message}\n`,
      );
      return 2;
    }

    emittedArtifacts = new Set(
      emittedEnts.filter((e) => e.isFile()).map((e) => e.name),
    );

    const missingEmitted = [];
    for (const type of NARRATIVE) {
      const expected = `${type}.md`;
      if (!emittedArtifacts.has(expected))
        missingEmitted.push(`required narrative artifact missing in emitted dir: ${expected}`);
    }
    for (const type of STRUCTURED) {
      const expected = `${type}.json`;
      if (!emittedArtifacts.has(expected))
        missingEmitted.push(`required structured artifact missing in emitted dir: ${expected}`);
    }
    for (const m of missingEmitted) errors.push(m);

    notes.push(
      `emitted dir: ${args.dir} (${emittedArtifacts.size} file(s) found, ` +
        `${EXPECTED_TOTAL - missingEmitted.length}/${EXPECTED_TOTAL} required types present)`,
    );
  }

  return emit(args.json, {
    errors,
    notes,
    tmplDir: path.relative(REPO_ROOT, tmplDir),
    emittedDir: args.dir || null,
    manifest: {
      narrative: NARRATIVE,
      structured: STRUCTURED,
      total: NARRATIVE.length + STRUCTURED.length,
    },
  });
}

function emit(json, { errors, notes, tmplDir, emittedDir, manifest }) {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: errors.length === 0,
          manifest,
          tmpl_dir: tmplDir,
          emitted_dir: emittedDir,
          errors,
          notes,
        },
        null,
        2,
      ) + "\n",
    );
    return errors.length ? 1 : 0;
  }
  if (errors.length === 0) {
    const parts = [
      `OK canon-type-coverage: all ${manifest.total} canon types have templates in ${tmplDir}`,
    ];
    if (emittedDir) parts.push(`and all ${manifest.total} required types are emitted in ${emittedDir}`);
    process.stdout.write(parts.join(" ") + "\n");
    return 0;
  }
  process.stderr.write(
    `FAIL canon-type-coverage (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}\n`,
  );
  return 1;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { main, parseArgs, resolveTemplateDir, resolveEmittedDir, EXPECTED_TOTAL };
