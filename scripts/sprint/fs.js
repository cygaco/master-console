#!/usr/bin/env node

/**
 * scripts/sprint/fs.js — File-system helpers for sprint scripts.
 *
 *   ensureDir(dir)               -> mkdir -p
 *   readText(file)               -> string or null
 *   writeText(file, text, opts)  -> { wrote: bool, reason }
 *   render(template, data)       -> string with {{key}} substituted
 *   readYamlMaybe(file)          -> parsed yaml/json or null
 *   writeYaml(file, value)       -> writes yaml-ish text (no js-yaml dep)
 *   nowIso()                     -> ISO-8601 UTC string
 *
 * The YAML writer is intentionally small. It handles strings, numbers,
 * booleans, nulls, arrays, and objects — enough for sprint tracker
 * files. Multi-line strings use the `|` block style only when the
 * value contains a newline. Reading falls back to JSON.parse if
 * js-yaml is unavailable AND the file happens to be JSON (the schemas
 * are valid JSON), otherwise tries a minimal yaml-subset parser via
 * eval-free split.
 */

"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function writeText(file, text, opts = {}) {
  const { force = false } = opts;
  if (!force && fs.existsSync(file)) {
    return { wrote: false, reason: "exists" };
  }
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, "utf8");
  return { wrote: true, reason: "ok" };
}

function render(template, data) {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = data[key];
    if (v === undefined || v === null) return `{{${key}}}`;
    return String(v);
  });
}

function nowIso() {
  return new Date().toISOString();
}

// ── YAML writer (tiny) ────────────────────────────────────────

function isScalar(v) {
  return (
    v === null ||
    typeof v === "boolean" ||
    typeof v === "number" ||
    typeof v === "string"
  );
}

function yamlScalar(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  // strings
  const s = String(v);
  if (s === "") return '""';
  if (/^(true|false|null|yes|no|on|off)$/i.test(s)) return JSON.stringify(s);
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return JSON.stringify(s);
  // simple identifiers and paths are safe without quotes
  if (/^[A-Za-z_][A-Za-z0-9_\-/.:@ ]*$/.test(s) && !s.includes("\n")) {
    // still quote if it has yaml-significant chars
    if (/[:#&*!|>%@`{}\[\]]/.test(s)) return JSON.stringify(s);
    return s;
  }
  // strings with newlines use block literal
  if (s.includes("\n")) {
    const indented = s
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    return `|\n${indented}`;
  }
  return JSON.stringify(s);
}

function yamlDump(value, indent = 0) {
  const pad = (n) => " ".repeat(n);
  if (isScalar(value)) {
    return yamlScalar(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (isScalar(item)) {
          return `${pad(indent)}- ${yamlScalar(item)}`;
        }
        const dumped = yamlDump(item, indent + 2);
        // First line gets `- `, subsequent lines indent by 2.
        const lines = dumped.split("\n");
        const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
        if (firstNonEmpty < 0) return `${pad(indent)}- {}`;
        lines[firstNonEmpty] =
          `${pad(indent)}- ${lines[firstNonEmpty].slice(indent + 2)}`;
        return lines.join("\n");
      })
      .join("\n");
  }
  // object
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const lines = [];
  for (const k of keys) {
    const v = value[k];
    if (isScalar(v)) {
      lines.push(`${pad(indent)}${k}: ${yamlScalar(v)}`);
    } else if (Array.isArray(v) && v.length === 0) {
      lines.push(`${pad(indent)}${k}: []`);
    } else if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      Object.keys(v).length === 0
    ) {
      lines.push(`${pad(indent)}${k}: {}`);
    } else if (Array.isArray(v)) {
      lines.push(`${pad(indent)}${k}:`);
      lines.push(yamlDump(v, indent + 2));
    } else {
      lines.push(`${pad(indent)}${k}:`);
      lines.push(yamlDump(v, indent + 2));
    }
  }
  return lines.join("\n");
}

// L-2026-05-14-event-sprint-schema-missing: sprint scripts run as standalone
// CLIs from Bash; their fs.writeFileSync calls bypass the Edit/Write tool
// hooks, so sprint-tracker-guard's auto-inject never fires on them. Result:
// 134 schema-missing warns vs 18 auto-inject successes in 3d (7:1 ratio).
// Fix: inject the schema header at the canonical writer, mirroring the
// guard's path-to-kind mapping. Every sprint write through writeYaml now
// guarantees the schema field — no hook dependency.
// Keep this list in sync with scripts/hooks/sprint-tracker-guard.js
// (SCHEMA_KIND_RULES). The guard remains the enforcement floor (catches
// non-writeYaml writes), but writeYaml is now the prevention layer.
const SPRINT_SCHEMA_KIND_RULES = [
  { re: /[/\\]sprint[/\\]active-sprints\.yaml$/, kind: "active-sprints" },
  {
    re: /[/\\]sprint[/\\]sprints[/\\](?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3})[/\\]current\.yaml$/,
    kind: "current-sprint",
  },
  {
    re: /[/\\]sprint[/\\]sprints[/\\](?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3})[/\\]progress\.yaml$/,
    kind: "sprint-progress",
  },
  {
    re: /[/\\]sprint[/\\]sprints[/\\](?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3})[/\\]retrospective\.yaml$/,
    kind: "sprint-retrospective",
  },
  { re: /[/\\]sprint[/\\]current-sprint\.yaml$/, kind: "current-sprint" },
  { re: /[/\\]sprint[/\\]sprint-progress\.yaml$/, kind: "sprint-progress" },
  {
    re: /[/\\]sprint[/\\]approvals[/\\]AP-\d{8}-\d{3}\.yaml$/,
    kind: "approval",
  },
  { re: /[/\\]sprint[/\\]tickets[/\\]T-\d{8}-\d{3}\.yaml$/, kind: "ticket" },
  {
    re: /[/\\]sprint[/\\]releases[/\\]RL-\d{8}-\d{3}\.yaml$/,
    kind: "release",
  },
  { re: /[/\\]sprint[/\\]issues[/\\]I-\d{8}-\d{3}\.yaml$/, kind: "issue" },
  {
    re: /[/\\]sprint[/\\]plan-contracts[/\\]PC-\d{8}-\d{4}\.yaml$/,
    kind: "plan-contract",
  },
  {
    re: /[/\\]sprint[/\\]external-services[/\\]ESD-\d{8}-\d{3}\.yaml$/,
    kind: "external-service-dependency",
  },
  {
    re: /[/\\]sprint[/\\]checkpoints[/\\](?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3})-\d{4}\.yaml$/,
    kind: "sprint-progress",
  },
  {
    re: /[/\\]sprint[/\\]ralph[/\\](?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3})[/\\].*\.yaml$/,
    kind: "ralph-progress",
  },
  {
    re: /[/\\]sprint[/\\]history[/\\](?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3})[/\\]sprint-history\.yaml$/,
    kind: "sprint-history",
  },
];

function inferSprintSchemaKind(filePath) {
  for (const r of SPRINT_SCHEMA_KIND_RULES) {
    if (r.re.test(filePath)) return r.kind;
  }
  return null;
}

// Atomic write: stage to a sibling `.tmp` then rename-over, so a concurrent reader / parallel
// sprint resume never observes a HALF-written file (the torn progress.yaml / active-sprints.yaml
// corruption class — raw writeFileSync is not atomic and a reader can catch a partial buffer).
// renameSync is atomic within a filesystem. Ported from scripts/sprint/ledger.js#atomicWrite.
function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function writeYaml(file, value) {
  ensureDir(path.dirname(file));
  // Schema injection at the canonical writer. If the file path matches a
  // known sprint pattern AND the value doesn't already declare a schema,
  // inject it as the first key. Non-sprint paths and already-schema'd
  // values pass through unchanged.
  let out = value;
  if (
    out &&
    typeof out === "object" &&
    !Array.isArray(out) &&
    !out.schema &&
    !out.$schema
  ) {
    const kind = inferSprintSchemaKind(file);
    if (kind) {
      // Object spread preserves key order; schema lands first.
      out = { schema: `mc/sprint/${kind}/v1`, ...out };
    }
  }
  const body = yamlDump(out, 0) + "\n";
  atomicWrite(file, body);
  return { wrote: true, reason: "ok" };
}

// ── Minimal YAML reader (handles the subset we write) ──────────

function readYamlMaybe(file) {
  const text = readText(file);
  if (text === null) return null;
  // First try js-yaml if available (better robustness).
  //
  // SP-20260829-001 B4 T2: this catch used to collapse TWO different facts
  // into one silent fall-through:
  //   (a) require("js-yaml") itself threw (MODULE_NOT_FOUND) — an
  //       ENVIRONMENT fact (the library is absent). Legitimate fall-through;
  //       verified true for THIS repo (no package.json / node_modules — same
  //       fact ED-380 records for ajv). No signal needed.
  //   (b) require succeeded but yaml.load(text) itself threw — a CONTENT
  //       fact: a real YAML parser rejected this text as malformed. That is
  //       corruption, not "needs the next parser", and must be visible.
  // Only (a) is a legitimate silent fall-through; (b) never was, and is kept
  // distinct below even though it is currently unreachable in this repo
  // (verified: require.resolve("js-yaml") fails MODULE_NOT_FOUND here) so the
  // distinction holds the moment js-yaml becomes available.
  try {
    const yaml = require("js-yaml");
    return yaml.load(text);
  } catch (err) {
    if (!(err && err.code === "MODULE_NOT_FOUND")) {
      process.stderr.write(
        `readYamlMaybe: ${file} — js-yaml rejected this file as malformed ` +
          `YAML (${err && err.message}). Falling back to JSON/mini-YAML, but ` +
          `this file should be treated as SUSPECT/CORRUPT, not merely ` +
          `"needed a different parser".\n`,
      );
    }
    // else: js-yaml module not installed — environment fact, legitimate
    // fall-through, no signal needed.
  }
  try {
    return JSON.parse(text);
  } catch {
    // JSON.parse failing is the EXPECTED, normal path for the yaml-ish
    // (non-JSON) text writeYaml() itself emits for every multi-line/nested
    // tracker file — NOT a corruption signal on its own. (Verified: every
    // sprint tracker file in this repo is written by writeYaml() in this
    // dialect, not raw JSON, so this catch fires on the overwhelming
    // majority of NORMAL reads. Flagging it here would be a false-positive
    // flood, not a meaningful defect repair.) Fall through to the mini-YAML
    // parser below, where the REAL reachable signal lives.
  }
  const { value, dropped } = parseMiniYaml(text);
  // This is the failure that is actually reachable and live in this repo
  // today (js-yaml/JSON.parse both legitimately miss on every real tracker
  // file): parseMiniYaml's line loop silently dropped ANY line it could not
  // interpret as blank/comment, array, or key:value — previously with zero
  // signal, so a genuinely corrupt or truncated file became "whatever
  // survived" with no trace. Surface it.
  if (dropped.length > 0) {
    const warning =
      `readYamlMaybe: ${file} — mini-YAML parser could not interpret ` +
      `${dropped.length} line(s) (line ${dropped.map((d) => d.line).join(", ")}) ` +
      `and silently dropped them. This file may be CORRUPT or use syntax ` +
      `outside the writeYaml() subset — verify it manually before trusting ` +
      `its parsed contents.`;
    process.stderr.write(`${warning}\n`);
    if (value && typeof value === "object") {
      Object.defineProperty(value, "__parseDroppedLines", {
        value: dropped,
        enumerable: false,
        configurable: true,
      });
    }
  }
  return value;
}

// Very small yaml subset parser — only handles scalar/array/object/
// block-literal that our own yamlDump writer emits. NOT a general
// yaml parser. Sprint tracker files written by writeYaml are
// round-trippable through it.
function parseMiniYaml(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, value: root, key: null }];
  // SP-20260829-001 B4 T2: lines that match neither the array pattern nor
  // the key:value pattern used to hit the generic `i++` below and vanish
  // with zero trace — a corrupt/truncated/garbled file became "whatever
  // survived" indistinguishably from a well-formed one. Record them instead.
  const dropped = [];

  function setValue(parent, key, val) {
    if (Array.isArray(parent)) {
      parent.push(val);
    } else {
      parent[key] = val;
    }
  }
  function topContainer() {
    return stack[stack.length - 1];
  }
  function indentOf(line) {
    let i = 0;
    while (i < line.length && line[i] === " ") i++;
    return i;
  }

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trim().startsWith("#")) {
      i++;
      continue;
    }
    const indent = indentOf(raw);
    const line = raw.slice(indent);
    // pop stack until parent has lower indent
    while (stack.length > 1 && topContainer().indent >= indent) stack.pop();
    const parent = topContainer().value;
    const arrMatch = /^-\s*(.*)$/.exec(line);
    if (arrMatch) {
      // ensure parent is array
      if (!Array.isArray(parent)) {
        // convert: parent[key] should be array; happen by replacing on key
        // not expected in our writer output
      }
      const rest = arrMatch[1];
      if (rest === "" || rest === "{}" || rest === "[]") {
        const v = rest === "[]" ? [] : rest === "{}" ? {} : {};
        if (Array.isArray(parent)) parent.push(v);
        stack.push({ indent, value: v, key: null });
        i++;
        continue;
      }
      // inline: - key: value
      const km = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(rest);
      if (km) {
        const obj = {};
        const v = parseInlineValue(km[2]);
        obj[km[1]] = v;
        if (Array.isArray(parent)) parent.push(obj);
        stack.push({ indent, value: obj, key: km[1] });
        i++;
        continue;
      }
      // - scalar
      const sv = parseInlineValue(rest);
      if (Array.isArray(parent)) parent.push(sv);
      i++;
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      const k = kv[1];
      const rest = kv[2];
      if (rest === "") {
        // nested container — peek next line to decide array vs object
        const next = lines[i + 1] || "";
        if (next.trim().startsWith("- ") || next.trim() === "-") {
          const v = [];
          setValue(parent, k, v);
          stack.push({ indent, value: v, key: k });
        } else {
          const v = {};
          setValue(parent, k, v);
          stack.push({ indent, value: v, key: k });
        }
        i++;
        continue;
      }
      if (rest === "|") {
        // block literal — read indented lines beneath this one
        const baseIndent = indent + 2;
        const buf = [];
        i++;
        while (i < lines.length) {
          const next = lines[i];
          if (next.trim() === "") {
            buf.push("");
            i++;
            continue;
          }
          const nIndent = indentOf(next);
          if (nIndent < baseIndent) break;
          buf.push(next.slice(baseIndent));
          i++;
        }
        setValue(parent, k, buf.join("\n").replace(/\n+$/, ""));
        continue;
      }
      if (rest === "{}") {
        setValue(parent, k, {});
        i++;
        continue;
      }
      if (rest === "[]") {
        setValue(parent, k, []);
        i++;
        continue;
      }
      // inline scalar
      setValue(parent, k, parseInlineValue(rest));
      i++;
      continue;
    }
    // Neither an array item nor a key:value line — genuinely unrecognized.
    // This is the real silent-drop site: record it instead of discarding.
    dropped.push({ line: i + 1, text: raw });
    i++;
  }
  return { value: root, dropped };
}

function parseInlineValue(s) {
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "{}") return {};
  if (s === "[]") return [];
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  // YAML flow mapping: { k1: v1, k2: v2, ... }
  if (s.startsWith("{") && s.endsWith("}")) {
    return parseFlowMapping(s);
  }
  // YAML flow sequence: [ v1, v2, ... ]
  if (s.startsWith("[") && s.endsWith("]")) {
    return parseFlowSequence(s);
  }
  return s;
}

// Splits flow content on commas at depth 0, respecting nested {...}/[...]
// and double-quoted strings. Does not handle single-quoted yaml strings
// (we don't emit them).
function splitFlowItems(inner) {
  const items = [];
  let depth = 0;
  let inStr = false;
  let buf = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      buf += c;
      if (c === "\\" && i + 1 < inner.length) {
        buf += inner[++i];
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      buf += c;
      continue;
    }
    if (c === "{" || c === "[") {
      depth++;
      buf += c;
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      buf += c;
      continue;
    }
    if (c === "," && depth === 0) {
      items.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim().length > 0) items.push(buf.trim());
  return items;
}

function parseFlowMapping(s) {
  const inner = s.slice(1, -1).trim();
  if (inner === "") return {};
  const out = {};
  for (const item of splitFlowItems(inner)) {
    const idx = item.indexOf(":");
    if (idx < 0) continue;
    const k = item.slice(0, idx).trim();
    const v = item.slice(idx + 1).trim();
    out[k] = parseInlineValue(v);
  }
  return out;
}

function parseFlowSequence(s) {
  const inner = s.slice(1, -1).trim();
  if (inner === "") return [];
  return splitFlowItems(inner).map(parseInlineValue);
}

module.exports = {
  ensureDir,
  readText,
  writeText,
  render,
  nowIso,
  writeYaml,
  readYamlMaybe,
  yamlDump,
  inferSprintSchemaKind,
};
