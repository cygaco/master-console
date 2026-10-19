#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function loadPaths() {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8")
  );
}

const VALID_CHECK_KINDS = new Set([
  "must_contain_all",
  "must_contain_any",
  "must_not_contain",
  "regex_match",
  "min_count",
  "max_count",
]);

function validateEvalPack(pack, filePath) {
  const errs = [];
  if (!pack || typeof pack !== "object") {
    errs.push(`${filePath}: not a JSON object`);
    return errs;
  }
  if (!pack.id || typeof pack.id !== "string" || pack.id.length === 0) {
    errs.push(`${filePath}: missing or empty required field 'id'`);
  }
  if (!pack.target || typeof pack.target !== "string" || pack.target.length === 0) {
    errs.push(`${filePath}: missing or empty required field 'target'`);
  }
  if (!Array.isArray(pack.rubric) || pack.rubric.length === 0) {
    errs.push(`${filePath}: 'rubric' must be an array with ≥1 dimension`);
  } else {
    pack.rubric.forEach((dim, i) => {
      if (!dim.dimension || typeof dim.dimension !== "string") {
        errs.push(`${filePath}: rubric[${i}] missing 'dimension'`);
      }
      if (typeof dim.weight !== "number" || dim.weight <= 0) {
        errs.push(`${filePath}: rubric[${i}].weight must be a number > 0`);
      }
      if (typeof dim.mechanical !== "boolean") {
        errs.push(`${filePath}: rubric[${i}].mechanical must be a boolean`);
      }
      if (!Array.isArray(dim.checks)) {
        errs.push(`${filePath}: rubric[${i}].checks must be an array`);
      } else {
        dim.checks.forEach((c, j) => {
          if (!VALID_CHECK_KINDS.has(c.kind)) {
            errs.push(
              `${filePath}: rubric[${i}].checks[${j}].kind '${c.kind}' not in valid set`
            );
          }
        });
      }
    });
  }
  return errs;
}

function main(argv) {
  const jsonMode = argv.includes("--json");
  const violations = [];

  let PATHS;
  try {
    PATHS = loadPaths();
  } catch (e) {
    process.stderr.write(`etc-harness-scan error (paths load): ${e.message}\n`);
    return 2;
  }

  const etcCommandsDir = path.join(REPO_ROOT, ".claude", "commands", "etc");
  if (!PATHS.etcEvalPacks || !PATHS.etcDecisions) {
    process.stderr.write("etc-harness-scan error: paths.etcEvalPacks or paths.etcDecisions not found in paths.json\n");
    return 2;
  }
  const evalPacksDir = path.join(REPO_ROOT, PATHS.etcEvalPacks);
  const decisionsDir = path.join(REPO_ROOT, PATHS.etcDecisions);

  try {
    const rootEtcMd = path.join(REPO_ROOT, ".claude", "commands", "etc.md");
    if (fs.existsSync(rootEtcMd)) {
      violations.push(
        "namespace violation: .claude/commands/etc.md exists — subcommanded namespace must NOT have a root .md (it blocks sub-skill detection)"
      );
    }

    let etcMdFiles = [];
    try {
      etcMdFiles = fs
        .readdirSync(etcCommandsDir)
        .filter((f) => f.endsWith(".md") && !f.startsWith("."));
    } catch {
    }

    for (const f of etcMdFiles) {
      const filePath = path.join(etcCommandsDir, f);
      let content;
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch (e) {
        violations.push(`cannot read ${f}: ${e.message}`);
        continue;
      }
      if (!/^---\s*\n[\s\S]*?\bdescription\s*:/m.test(content)) {
        violations.push(
          `.claude/commands/etc/${f}: missing frontmatter 'description:' (non-standard authoring format)`
        );
      }
      if (!/^##\s+Procedure\b/m.test(content)) {
        violations.push(
          `.claude/commands/etc/${f}: missing '## Procedure' section (non-standard authoring format)`
        );
      }
    }

    let packFiles = [];
    try {
      packFiles = fs
        .readdirSync(evalPacksDir)
        .filter((f) => f.endsWith(".json") && !f.startsWith("."));
    } catch {
    }

    for (const f of packFiles) {
      const filePath = path.join(evalPacksDir, f);
      let pack;
      try {
        pack = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (e) {
        violations.push(`eval-pack ${f}: JSON parse error: ${e.message}`);
        continue;
      }
      const errs = validateEvalPack(pack, f);
      violations.push(...errs);
    }

    let recordFiles = [];
    try {
      recordFiles = fs
        .readdirSync(decisionsDir)
        .filter((f) => f.endsWith(".json") && !f.startsWith("."));
    } catch {
    }

    for (const f of recordFiles) {
      const filePath = path.join(decisionsDir, f);
      const r = spawnSync(
        process.execPath,
        [
          path.join(REPO_ROOT, "scripts", "contracts", "validate-artifact.js"),
          filePath,
        ],
        { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }
      );
      if (r.status !== 0) {
        const reason = (r.stderr || r.stdout || "").trim() || "validation failed";
        violations.push(`decision_record ${f}: ${reason}`);
      }
    }
  } catch (e) {
    process.stderr.write(`etc-harness-scan internal error: ${e.message}\n${e.stack || ""}\n`);
    return 2;
  }

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({ ok: violations.length === 0, violations }, null, 2) + "\n"
    );
    return violations.length > 0 ? 1 : 0;
  }

  if (violations.length === 0) {
    process.stdout.write(
      "OK etc-harness: namespace convention + format + eval-packs + decision_records all valid\n"
    );
    return 0;
  }

  process.stderr.write(
    `FAIL etc-harness (${violations.length}):\n${violations
      .map((v) => "  - " + v)
      .join("\n")}\n`
  );
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { main };
