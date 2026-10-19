#!/usr/bin/env node

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
  const s = String(v);
  if (s === "") return '""';
  if (/^(true|false|null|yes|no|on|off)$/i.test(s)) return JSON.stringify(s);
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return JSON.stringify(s);
  if (/^[A-Za-z_][A-Za-z0-9_\-/.:@ ]*$/.test(s) && !s.includes("\n")) {
    if (/[:#&*!|>%@`{}\[\]]/.test(s)) return JSON.stringify(s);
    return s;
  }
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
        const lines = dumped.split("\n");
        const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
        if (firstNonEmpty < 0) return `${pad(indent)}- {}`;
        lines[firstNonEmpty] =
          `${pad(indent)}- ${lines[firstNonEmpty].slice(indent + 2)}`;
        return lines.join("\n");
      })
      .join("\n");
  }
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

function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function writeYaml(file, value) {
  ensureDir(path.dirname(file));
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
      out = { schema: `mc/sprint/${kind}/v1`, ...out };
    }
  }
  const body = yamlDump(out, 0) + "\n";
  atomicWrite(file, body);
  return { wrote: true, reason: "ok" };
}

function readYamlMaybe(file) {
  const text = readText(file);
  if (text === null) return null;
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
  }
  try {
    return JSON.parse(text);
  } catch {
  }
  const { value, dropped } = parseMiniYaml(text);
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

function parseMiniYaml(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, value: root, key: null }];
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
    while (stack.length > 1 && topContainer().indent >= indent) stack.pop();
    const parent = topContainer().value;
    const arrMatch = /^-\s*(.*)$/.exec(line);
    if (arrMatch) {
      if (!Array.isArray(parent)) {
      }
      const rest = arrMatch[1];
      if (rest === "" || rest === "{}" || rest === "[]") {
        const v = rest === "[]" ? [] : rest === "{}" ? {} : {};
        if (Array.isArray(parent)) parent.push(v);
        stack.push({ indent, value: v, key: null });
        i++;
        continue;
      }
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
      setValue(parent, k, parseInlineValue(rest));
      i++;
      continue;
    }
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
  if (s.startsWith("{") && s.endsWith("}")) {
    return parseFlowMapping(s);
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    return parseFlowSequence(s);
  }
  return s;
}

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
