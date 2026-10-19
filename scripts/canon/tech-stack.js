#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const CANONICAL_STACK_REL = path.join("_requirements", "00-canonical", "DATA_AND_ACCOUNTS.md");

const STACK_LAYERS = [
  {
    key: "framework",
    label: "Framework",
    stackKey: "framework",
    aliases: ["framework", "app framework", "frontend", "frontend framework", "runtime", "platform"],
  },
  {
    key: "database",
    label: "Database",
    stackKey: "db",
    aliases: ["database", "db", "data", "data store", "datastore", "storage", "persistence"],
  },
  {
    key: "auth",
    label: "Authentication",
    stackKey: "auth",
    aliases: ["auth", "authentication", "identity", "identity provider", "accounts"],
  },
  {
    key: "payments",
    label: "Payments",
    stackKey: "payments",
    aliases: ["payments", "payment", "billing", "monetization", "checkout"],
  },
  {
    key: "hosting",
    label: "Hosting",
    stackKey: "hosting",
    aliases: ["hosting", "host", "deployment", "deploy", "deploy target", "infrastructure"],
  },
  {
    key: "analytics",
    label: "Analytics",
    stackKey: "analytics",
    aliases: ["analytics", "telemetry", "event sink", "product analytics", "tracking"],
  },
];

const REQUIRED_LAYER_KEYS = STACK_LAYERS.map((l) => l.key);
const LAYER_BY_KEY = new Map(STACK_LAYERS.map((l) => [l.key, l]));
const NEEDS_INPUT_RE = /\*needs input:\s*([a-zA-Z0-9_]+)\s*\*/i;
const RAW_TOKEN_RE = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/;

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLayerKey(input) {
  const n = normalizeText(input);
  if (!n) return null;
  for (const layer of STACK_LAYERS) {
    if (layer.key === n || layer.aliases.some((a) => normalizeText(a) === n)) {
      return layer.key;
    }
  }
  return null;
}

function stripInlineMarkdown(s) {
  return String(s || "")
    .replace(/^`|`$/g, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
}

function splitPipeRow(line) {
  const t = String(line || "").trim();
  if (!t.includes("|")) return [];
  return t
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripInlineMarkdown(cell));
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(String(c || "").trim()));
}

function choiceHeaderIndex(headers) {
  const choices = new Set([
    "choice",
    "declared choice",
    "declared",
    "provider",
    "selection",
    "value",
    "stack choice",
  ]);
  return headers.findIndex((h) => choices.has(normalizeText(h)));
}

function parseStackTable(body) {
  const lines = String(body || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && l.includes("|"));
  if (!lines.length) return { rows: [], errors: ["Tech Stack block has no markdown table"] };

  const headers = splitPipeRow(lines[0]);
  const normalized = headers.map(normalizeText);
  const layerIdx = normalized.findIndex((h) => h === "layer" || h === "stack layer");
  const choiceIdx = choiceHeaderIndex(headers);
  if (layerIdx < 0 || choiceIdx < 0) {
    return {
      rows: [],
      errors: [
        "Tech Stack table must include a Layer column and a Choice/Declared Choice column",
      ],
    };
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitPipeRow(line);
    if (!cells.length || isSeparatorRow(cells)) continue;
    rows.push({
      layer: cells[layerIdx] || "",
      choice: cells[choiceIdx] || "",
      cells,
    });
  }
  return { rows, errors: [] };
}

function parseBulletStack(body) {
  const rows = [];
  for (const line of String(body || "").split(/\r?\n/)) {
    const m = /^\s*[-*]\s+([^:]+?)\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    rows.push({ layer: stripInlineMarkdown(m[1]), choice: stripInlineMarkdown(m[2]), cells: [] });
  }
  return rows;
}

function extractTechStackBlock(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Tech Stack\s*$/i.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

function isUnresolvedChoice(value) {
  const v = String(value || "").trim();
  return !v || NEEDS_INPUT_RE.test(v) || RAW_TOKEN_RE.test(v);
}

function parseRows(rows, opts = {}) {
  const requireAll = opts.requireAll !== false;
  const errors = [];
  const warnings = [];
  const stack = {};
  const unresolved = [];
  const normalizedRows = [];

  for (const row of rows) {
    const key = normalizeLayerKey(row.layer);
    const choice = stripInlineMarkdown(row.choice);
    if (!key) {
      warnings.push(`unknown stack layer ignored: ${row.layer}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(stack, key)) {
      errors.push(`duplicate stack layer: ${key}`);
      continue;
    }
    if (!choice) {
      errors.push(`stack layer ${key} has an empty choice`);
      continue;
    }
    if (RAW_TOKEN_RE.test(choice)) {
      errors.push(`stack layer ${key} contains a raw template token`);
    }
    stack[key] = choice;
    normalizedRows.push({ key, label: LAYER_BY_KEY.get(key).label, choice });
    if (isUnresolvedChoice(choice)) unresolved.push(`${key}:${choice}`);
  }

  if (requireAll) {
    for (const key of REQUIRED_LAYER_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(stack, key)) {
        errors.push(`missing required stack layer: ${key}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    stack,
    rows: normalizedRows,
    unresolved,
    errors,
    warnings,
  };
}

function parseTechStackBlock(markdown) {
  const block = extractTechStackBlock(markdown);
  if (block == null) {
    return {
      ok: false,
      present: false,
      stack: {},
      rows: [],
      unresolved: [],
      errors: ["DATA_AND_ACCOUNTS.md is missing a ## Tech Stack block"],
      warnings: [],
    };
  }
  const table = parseStackTable(block);
  const parsed = parseRows(table.rows, { requireAll: true });
  parsed.present = true;
  parsed.block = block;
  parsed.errors = [...table.errors, ...parsed.errors];
  parsed.ok = parsed.errors.length === 0;
  return parsed;
}

function parseStackIntent(body) {
  const text = String(body || "");
  if (!text.trim()) {
    return { ok: true, stack: {}, rows: [], unresolved: [], errors: [], warnings: [] };
  }
  const table = parseStackTable(text);
  const rows = table.rows.length ? table.rows : parseBulletStack(text);
  const parsed = parseRows(rows, { requireAll: false });
  parsed.errors = table.rows.length ? [...table.errors, ...parsed.errors] : parsed.errors;
  parsed.ok = parsed.errors.length === 0;
  return parsed;
}

function resolvedStack(stack) {
  const out = {};
  for (const key of REQUIRED_LAYER_KEYS) {
    const value = stack && stack[key];
    if (value && !isUnresolvedChoice(value)) out[key] = value;
  }
  return out;
}

function readCanonicalStack(repoRoot, rel = CANONICAL_STACK_REL) {
  const root = repoRoot || process.cwd();
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  const source = path.relative(root, abs).split(path.sep).join("/");
  if (!fs.existsSync(abs)) {
    return {
      present: false,
      source,
      ok: false,
      values: {},
      unresolved: [],
      errors: [`canonical stack file not found: ${source}`],
      warnings: [],
    };
  }
  let parsed;
  try {
    parsed = parseTechStackBlock(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    return {
      present: true,
      source,
      ok: false,
      values: {},
      unresolved: [],
      errors: [`could not read canonical stack file ${source}: ${e.message}`],
      warnings: [],
    };
  }
  return {
    present: true,
    source,
    ok: parsed.ok,
    values: resolvedStack(parsed.stack),
    raw: parsed.stack,
    rows: parsed.rows,
    unresolved: parsed.unresolved,
    errors: parsed.errors,
    warnings: parsed.warnings,
  };
}

module.exports = {
  STACK_LAYERS,
  REQUIRED_LAYER_KEYS,
  CANONICAL_STACK_REL,
  NEEDS_INPUT_RE,
  RAW_TOKEN_RE,
  normalizeLayerKey,
  isUnresolvedChoice,
  parseTechStackBlock,
  parseStackIntent,
  resolvedStack,
  readCanonicalStack,
};
