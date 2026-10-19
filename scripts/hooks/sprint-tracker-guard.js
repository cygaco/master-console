#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (process.env.SPRINT_GUARD === "off") process.exit(0);

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function emitBlock(detail) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "block",
      "system",
      "sprint-tracker-guard",
      "",
      detail.slice(0, 400),
    );
  } catch {
  }
  console.log(JSON.stringify({ decision: "block", reason: detail }));
  process.exit(0);
}

function emitWarn(detail) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "warn",
      "system",
      "sprint-tracker-guard",
      "",
      detail.slice(0, 400),
    );
  } catch {
  }
  process.stderr.write("[sprint-tracker-guard] " + detail + "\n");
}

const SCHEMA_KIND_RULES = [
  {
    re: /^\.claude\/project\/sprint\/active-sprints\.yaml$/,
    kind: "active-sprints",
  },
  {
    re: /^\.claude\/project\/sprint\/sprints\/(?:SP-[0-9]{8}-[0-9]{3,4}|S-[A-Z0-9]+-[0-9]{2,3})\/current\.yaml$/,
    kind: "current-sprint",
  },
  {
    re: /^\.claude\/project\/sprint\/sprints\/(?:SP-[0-9]{8}-[0-9]{3,4}|S-[A-Z0-9]+-[0-9]{2,3})\/progress\.yaml$/,
    kind: "sprint-progress",
  },
  {
    re: /^\.claude\/project\/sprint\/current-sprint\.yaml$/,
    kind: "current-sprint",
  },
  {
    re: /^\.claude\/project\/sprint\/sprint-progress\.yaml$/,
    kind: "sprint-progress",
  },
  {
    re: /^\.claude\/project\/sprint\/approvals\/AP-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "approval",
  },
  {
    re: /^\.claude\/project\/sprint\/tickets\/T-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "ticket",
  },
  {
    re: /^\.claude\/project\/sprint\/releases\/RL-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "release",
  },
  {
    re: /^\.claude\/project\/sprint\/issues\/I-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "issue",
  },
  {
    re: /^\.claude\/project\/sprint\/plan-contracts\/PC-[0-9]{8}-[0-9]{4}\.yaml$/,
    kind: "plan-contract",
  },
  {
    re: /^\.claude\/project\/sprint\/external-services\/ESD-[0-9]{8}-[0-9]{3}\.yaml$/,
    kind: "external-service-dependency",
  },
  {
    re: /^\.claude\/project\/sprint\/checkpoints\/(?:SP-[0-9]{8}-[0-9]{3,4}|S-[A-Z0-9]+-[0-9]{2,3})-[0-9]{4}\.yaml$/,
    kind: "sprint-progress",
  },
  {
    re: /^\.claude\/project\/sprint\/ralph\/(?:SP-[0-9]{8}-[0-9]{3,4}|S-[A-Z0-9]+-[0-9]{2,3})\/.*\.yaml$/,
    kind: "ralph-progress",
  },
  {
    re: /^\.claude\/project\/sprint\/history\/(?:SP-[0-9]{8}-[0-9]{3,4}|S-[A-Z0-9]+-[0-9]{2,3})\/sprint-history\.yaml$/,
    kind: "sprint-history",
  },
  {
    re: /^\.claude\/project\/sprint\/sprints\/(?:SP-[0-9]{8}-[0-9]{3,4}|S-[A-Z0-9]+-[0-9]{2,3})\/retrospective\.yaml$/,
    kind: "sprint-retrospective",
  },
];

function inferSchemaKind(filePath) {
  for (const r of SCHEMA_KIND_RULES) {
    if (r.re.test(filePath)) return r.kind;
  }
  return null;
}

function emitAutoInject(filePath, kind, content) {
  const header = `schema: mc/sprint/${kind}/v1\n`;
  const newContent = header + content;
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "audit",
      "system",
      "sprint-tracker-auto-injected",
      filePath.slice(0, 120),
      `kind=${kind}`,
    );
  } catch {
  }
  process.stderr.write(
    `[sprint-tracker-guard] auto-injected schema: mc/sprint/${kind}/v1 → ${filePath}\n`,
  );
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { content: newContent },
    },
  };
  console.log(JSON.stringify(output));
  process.exit(0);
}

function loadSprintPaths() {
  try {
    const raw = fs.readFileSync(
      path.join(PROJECT_DIR, ".claude", "paths.json"),
      "utf8",
    );
    const j = JSON.parse(raw);
    return {
      root: j.sprintRoot,
      history: j.sprintHistory,
      schemas: j.sprintSchemas,
    };
  } catch {
    return {
      root: ".claude/project/sprint",
      history: ".claude/project/sprint/history",
      schemas: "schemas/sprint",
    };
  }
}

function rel(absOrRel) {
  if (!absOrRel) return "";
  if (path.isAbsolute(absOrRel)) {
    return path.relative(PROJECT_DIR, absOrRel).replace(/\\/g, "/");
  }
  return absOrRel.replace(/\\/g, "/");
}

function extractTarget(event) {
  const input = event.tool_input || {};
  return {
    file_path: rel(input.file_path || ""),
    content:
      typeof input.content === "string"
        ? input.content
        : typeof input.new_string === "string"
          ? input.new_string
          : null,
    old_string: typeof input.old_string === "string" ? input.old_string : "",
  };
}

function isUnderSprintRoot(rel, root) {
  if (!rel || !root) return false;
  return rel === root || rel.startsWith(root.replace(/\/$/, "") + "/");
}

function isUnderHistory(rel, history) {
  if (!rel || !history) return false;
  return rel.startsWith(history.replace(/\/$/, "") + "/");
}

function loadSchemas(schemasDir) {
  const abs = path.join(PROJECT_DIR, schemasDir);
  if (!fs.existsSync(abs)) return {};
  const out = {};
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith(".schema.json")) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(abs, f), "utf8"));
      if (j.$id) out[j.$id] = j;
    } catch {
    }
  }
  return out;
}

function extractSchemaField(text) {
  if (!text) return null;
  const m = text.match(/^schema:\s*(.+)$/m);
  if (!m) return null;
  let v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

function tryYamlParse(text) {
  try {
    const sprintFs = require(
      path.join(PROJECT_DIR, "scripts", "sprint", "fs.js"),
    );
    const tmp = path.join(
      PROJECT_DIR,
      ".claude",
      "runtime",
      ".sprint-guard-tmp.yaml",
    );
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, text, "utf8");
    const parsed = sprintFs.readYamlMaybe(tmp);
    fs.unlinkSync(tmp);
    return parsed;
  } catch {
    return null;
  }
}

function validate(parsed, schema, rootSchema, pathStr, errors) {
  if (!schema) return;
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/")) {
      errors.push(`${pathStr}: external $ref not supported (${schema.$ref})`);
      return;
    }
    const target = resolveRef(rootSchema, schema.$ref);
    if (!target) {
      errors.push(`${pathStr}: cannot resolve $ref ${schema.$ref}`);
      return;
    }
    validate(parsed, target, rootSchema, pathStr, errors);
    return;
  }
  if (schema.const !== undefined && parsed !== schema.const) {
    errors.push(
      `${pathStr}: expected const=${JSON.stringify(schema.const)} got ${JSON.stringify(parsed)}`,
    );
  }
  if (schema.enum && !schema.enum.includes(parsed)) {
    errors.push(`${pathStr}: value ${JSON.stringify(parsed)} not in enum`);
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(parsed);
    const matched = allowed.some((a) => {
      if (a === "integer") return t === "number" && Number.isInteger(parsed);
      if (a === "number") return t === "number";
      return a === t;
    });
    if (!matched) {
      errors.push(`${pathStr}: type ${t} not in ${JSON.stringify(allowed)}`);
      return;
    }
  }
  if (typeof parsed === "string" && schema.pattern) {
    const re = new RegExp(schema.pattern);
    if (!re.test(parsed)) {
      errors.push(
        `${pathStr}: ${JSON.stringify(parsed)} fails pattern /${schema.pattern}/`,
      );
    }
  }
  if (typeOf(parsed) === "array" && schema.items) {
    for (let i = 0; i < parsed.length; i++) {
      validate(parsed[i], schema.items, rootSchema, `${pathStr}[${i}]`, errors);
    }
  }
  if (typeOf(parsed) === "object" && parsed !== null) {
    if (Array.isArray(schema.required)) {
      for (const r of schema.required) {
        if (!(r in parsed)) {
          errors.push(`${pathStr}.${r}: required property missing`);
        }
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in parsed) {
          validate(parsed[k], sub, rootSchema, `${pathStr}.${k}`, errors);
        }
      }
    }
  }
}

function resolveRef(schema, ref) {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let node = schema;
  for (const p of parts) {
    if (node == null) return null;
    node = node[p];
  }
  return node;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function main() {
  let event;
  try {
    event = JSON.parse(readStdinSync() || "{}");
  } catch {
    process.exit(0);
  }
  const target = extractTarget(event);
  if (!target.file_path) process.exit(0);
  const toolName = event.tool_name || "";

  const sp = loadSprintPaths();
  if (!isUnderSprintRoot(target.file_path, sp.root)) process.exit(0);

  if (isUnderHistory(target.file_path, sp.history)) {
    const abs = path.join(PROJECT_DIR, target.file_path);
    if (fs.existsSync(abs)) {
      emitBlock(
        `sprint history is append-only. ${target.file_path} already exists; refuse to edit. ` +
          "Sprints are archived once closed — preserve the historical record. " +
          "If you must amend, write a new addendum file alongside it (e.g. addendum-<date>.md), " +
          "or set SPRINT_GUARD=off in your environment to override.",
      );
    }
    process.exit(0);
  }

  if (!target.file_path.endsWith(".yaml")) process.exit(0);
  if (target.content === null) {
    process.exit(0);
  }

  const schemaId = extractSchemaField(target.content);
  if (!schemaId) {
    const kind = inferSchemaKind(target.file_path);
    if (kind && toolName === "Write") {
      emitAutoInject(target.file_path, kind, target.content);
    }
    emitWarn(
      `${target.file_path}: no schema: field detected${kind ? ` (would auto-inject mc/sprint/${kind}/v1 on Write — Edit is warn-only)` : " and path doesn't match any known sprint-kind rule"}. ` +
        "Sprint tracker yaml MUST declare its schema. Allowing (warn-only). " +
        "If this is a new sprint artifact type, add a SCHEMA_KIND_RULES entry to sprint-tracker-guard.js.",
    );
    process.exit(0);
  }

  if (!schemaId.startsWith("mc/sprint/")) {
    process.exit(0);
  }

  const schemas = loadSchemas(sp.schemas);
  if (!schemas[schemaId]) {
    emitWarn(
      `${target.file_path}: declared schema ${schemaId} not found in ${sp.schemas}/. ` +
        "Allowing (warn-only) — install may be stale; consider running paths/build.js.",
    );
    process.exit(0);
  }

  const parsed = tryYamlParse(target.content);
  if (parsed === null || typeof parsed !== "object") {
    emitWarn(
      `${target.file_path}: yaml parse failed. Allowing (warn-only). ` +
        "Sprint helpers will validate at read time.",
    );
    process.exit(0);
  }

  const errors = [];
  validate(parsed, schemas[schemaId], schemas[schemaId], "$", errors);
  if (errors.length) {
    emitBlock(
      `${target.file_path} fails ${schemaId} validation (${errors.length} error(s)):\n` +
        errors
          .slice(0, 5)
          .map((e) => "  " + e)
          .join("\n") +
        (errors.length > 5 ? `\n  ... ${errors.length - 5} more` : "") +
        `\n\nUse the corresponding scripts/sprint/* helper to write tracker files rather than ` +
        `hand-editing yaml. To override, set SPRINT_GUARD=off.`,
    );
  }
  process.exit(0);
}

main();
