#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PATHS = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"),
);

const HARD_CEILINGS = Object.freeze([
  "push_to_remote",
  "paid_service_signup",
  "production_deploy",
  "destructive_migration",
  "secret_to_remote",
]);

const FORBIDDEN_PRE_AUTH = Object.freeze([
  "production_release_approval",
  "paid_service_approval",
]);

function parseArgs(argv) {
  const out = { file: null, allowSchemaSkip: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--file") out.file = argv[++i];
    else if (argv[i] === "--allow-schema-skip") out.allowSchemaSkip = true;
  }
  return out;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const args = parseArgs(process.argv);
  const requiredKeys = args.file
    ? ["sprintSchemas"]
    : ["sprintFullAutonomy", "sprintSchemas"];
  const missingKeys = requiredKeys.filter((k) => !PATHS[k]);
  if (missingKeys.length > 0) {
    process.stderr.write(
      `autonomy path key(s) not registered in .claude/paths.json: ` +
        `${missingKeys.join(", ")}. The sprint-full subsystem cannot resolve ` +
        `its config. Run \`node scripts/paths/build.js\` to regenerate the ` +
        `registry, then re-run /mc:health.\n`,
    );
    return 1;
  }
  const cfgPath = args.file
    ? path.resolve(args.file)
    : path.join(REPO_ROOT, PATHS.sprintFullAutonomy);
  const schemaPath = path.join(
    REPO_ROOT,
    PATHS.sprintSchemas,
    "sprint-full-autonomy.schema.json",
  );

  if (!fs.existsSync(cfgPath)) {
    process.stderr.write(`autonomy config missing: ${cfgPath}\n`);
    return 1;
  }
  if (!fs.existsSync(schemaPath)) {
    process.stderr.write(`schema missing: ${schemaPath}\n`);
    return 1;
  }

  const cfg = loadJson(cfgPath);
  const schema = loadJson(schemaPath);

  let ajvAvailable = false;
  try {
    require.resolve("ajv");
    ajvAvailable = true;
  } catch {
  }

  if (ajvAvailable) {
    const Ajv = require("ajv");
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(cfg);
    if (!ok) {
      process.stderr.write(
        `schema validation FAILED:\n${JSON.stringify(validate.errors, null, 2)}\n`,
      );
      return 1;
    }
  }

  const presets = cfg.presets || {};
  const presetNames = Object.keys(presets);
  if (presetNames.length === 0) {
    process.stderr.write("no presets defined\n");
    return 1;
  }

  let failures = 0;
  for (const name of presetNames) {
    const p = presets[name];
    if (p.preset_name !== name) {
      process.stderr.write(
        `preset[${name}] preset_name mismatch: '${p.preset_name}'\n`,
      );
      failures++;
    }
    const levels = p.pre_authorized_approval_levels || [];
    for (const level of levels) {
      if (FORBIDDEN_PRE_AUTH.includes(level)) {
        process.stderr.write(
          `preset[${name}] HARD-CEILING BREACH: pre_authorized_approval_levels includes forbidden value '${level}'\n`,
        );
        failures++;
      }
    }
    const targets = p.release_approval_targets || [];
    for (const t of targets) {
      if (t === "production") {
        process.stderr.write(
          `preset[${name}] HARD-CEILING BREACH: release_approval_targets includes 'production'\n`,
        );
        failures++;
      }
    }
  }

  const declared = (cfg.hard_ceilings || []).slice().sort();
  const expected = HARD_CEILINGS.slice().sort();
  if (
    declared.length !== expected.length ||
    !declared.every((v, i) => v === expected[i])
  ) {
    process.stderr.write(
      `hard_ceilings[] mismatch: declared=${JSON.stringify(declared)} expected=${JSON.stringify(expected)}\n`,
    );
    failures++;
  }

  if (failures > 0) {
    process.stderr.write(
      `autonomy config validation FAILED (${failures} issues)\n`,
    );
    return 1;
  }

  if (!ajvAvailable) {
    const skipMsg =
      `autonomy config: contract checks passed (${presetNames.length} presets ` +
      `[${presetNames.join(", ")}] + ${declared.length} hard ceilings), but ` +
      `SCHEMA VALIDATION WAS SKIPPED — ajv is not installed. This is NOT the ` +
      `same as full validation.`;
    if (args.allowSchemaSkip) {
      process.stdout.write(
        `${skipMsg} --allow-schema-skip was passed — exiting 0 (caller has ` +
          `explicitly accepted contract-only validation).\n`,
      );
      return 0;
    }
    process.stderr.write(
      `${skipMsg} Exiting 3 (distinct from 0/1) so a caller reading only the ` +
        `exit code cannot mistake this for a full pass. Pass ` +
        `--allow-schema-skip if contract-only validation is acceptable here.\n`,
    );
    return 3;
  }

  process.stdout.write(
    `autonomy config OK (schema + contract checks both ran): ${presetNames.length} presets [${presetNames.join(", ")}] + ${declared.length} hard ceilings\n`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, HARD_CEILINGS, FORBIDDEN_PRE_AUTH };
