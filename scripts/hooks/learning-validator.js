#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");
const { logEvent } = require("./lib/logger");

const memoryDir =
  PATHS.memory || path.join(PROJECT, ".claude", "project", "memory");
const learningsRel = relPath(path.join(memoryDir, "learnings.jsonl"));
const systemsRel = relPath(path.join(memoryDir, "systems.jsonl"));

const VALID_IMPLEMENTED_BY_PREFIXES = [
  "hook:",
  "rule:",
  "hygiene:",
  "lint:",
  "gate:",
  "guard:",
];

const SYSTEMS_REQUIRED_FIELDS = ["id", "status"];

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    if (event.tool_response === undefined) {
      process.exit(0);
    }

    if (toolName !== "Edit" && toolName !== "Write") {
      process.exit(0);
    }

    const filePath = (event.tool_input || {}).file_path || "";
    if (!filePath) {
      process.exit(0);
    }

    const rel = relPath(filePath);

    if (rel === learningsRel || rel.endsWith("learnings.jsonl")) {
      validateLearnings(filePath);
    }

    if (rel === systemsRel || rel.endsWith("systems.jsonl")) {
      validateSystems(filePath);
    }

    process.exit(0);
  } catch (e) {
    process.stderr.write(
      `\x1b[33m[learning-validator] Error: ${String(e).slice(0, 100)}\x1b[0m\n`,
    );
    process.exit(0);
  }
});

function validateLearnings(filePath) {
  try {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) return;

    const content = fs.readFileSync(absPath, "utf8").trim();
    if (!content) return;

    const lines = content.split("\n");
    const recentLines = lines.slice(-3);

    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);

        if (entry.status === "implemented") {
          if (!entry.implemented_by || entry.implemented_by.trim() === "") {
            const msg = `Learning "${(entry.tip || "").slice(0, 60)}" has status "implemented" but no implemented_by field`;
            process.stderr.write(
              `\x1b[33m[learning-validator] WARN: ${msg}\x1b[0m\n`,
            );
            logEvent(
              "warn",
              "system",
              "learning-missing-implemented-by",
              "",
              msg,
            );
            continue;
          }

          const impl = entry.implemented_by.trim();
          const hasValidPrefix = VALID_IMPLEMENTED_BY_PREFIXES.some((p) =>
            impl.startsWith(p),
          );

          if (!hasValidPrefix) {
            const potentialPath = path.resolve(PROJECT, impl);
            if (!fs.existsSync(potentialPath)) {
              const msg = `Learning implemented_by "${impl}" doesn't match known format (hook:, rule:, hygiene:, lint:) and isn't a valid file path`;
              process.stderr.write(
                `\x1b[33m[learning-validator] WARN: ${msg}\x1b[0m\n`,
              );
              logEvent(
                "warn",
                "system",
                "learning-invalid-implemented-by",
                "",
                msg,
              );
            }
          }
        }

        if (
          entry.status === "validated" &&
          !entry.fix_quality &&
          entry.fix_quality !== 0
        ) {
          const msg = `Learning "${(entry.tip || "").slice(0, 60)}" is "validated" but has no fix_quality score`;
          process.stderr.write(
            `\x1b[33m[learning-validator] INFO: ${msg}\x1b[0m\n`,
          );
        }
      } catch {
      }
    }
  } catch {
  }
}

function validateSystems(filePath) {
  try {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) return;

    const content = fs.readFileSync(absPath, "utf8").trim();
    if (!content) return;

    const lines = content.split("\n");
    const recentLines = lines.slice(-3);

    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);

        const missing = SYSTEMS_REQUIRED_FIELDS.filter((f) => !entry[f]);
        if (missing.length > 0) {
          const msg = `Systems entry "${entry.id || "unknown"}" missing required fields: ${missing.join(", ")}`;
          process.stderr.write(
            `\x1b[33m[learning-validator] WARN: ${msg}\x1b[0m\n`,
          );
          logEvent("warn", "system", "systems-schema-violation", "", msg);
        }

        if (entry.files && !Array.isArray(entry.files)) {
          const msg = `Systems entry "${entry.id}" has non-array "files" field`;
          process.stderr.write(
            `\x1b[33m[learning-validator] WARN: ${msg}\x1b[0m\n`,
          );
          logEvent("warn", "system", "systems-schema-violation", "", msg);
        }

        if (entry.deps && !Array.isArray(entry.deps)) {
          const msg = `Systems entry "${entry.id}" has non-array "deps" field`;
          process.stderr.write(
            `\x1b[33m[learning-validator] WARN: ${msg}\x1b[0m\n`,
          );
          logEvent("warn", "system", "systems-schema-violation", "", msg);
        }
      } catch {
      }
    }
  } catch {
  }
}
