#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SCHEMA = "mc/require-graph/v1";
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
const SCAN_ROOTS = ["scripts", "tests"];
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const JS_EXT = /\.(?:js|cjs|mjs)$/;
const RESOLVE_EXT = ["", ".js", ".json", ".cjs", ".mjs", "/index.js", "/index.json"];

const ID_CHAR = /[A-Za-z0-9_$]/;
const REGEX_PREV = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);

function skipQuoted(src, i) {
  const q = src[i];
  const n = src.length;
  i++;
  while (i < n && src[i] !== q && src[i] !== "\n") {
    if (src[i] === "\\") i++;
    i++;
  }
  return Math.min(i + 1, n);
}

function skipTemplate(src, i) {
  const n = src.length;
  i++;
  while (i < n) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i + 1;
    if (c === "$" && src[i + 1] === "{") {
      i = skipBraced(src, i + 2);
      continue;
    }
    i++;
  }
  return n;
}

function skipBraced(src, i) {
  const n = src.length;
  let depth = 1;
  while (i < n && depth > 0) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipQuoted(src, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplate(src, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  return i;
}

function skipRegex(src, i) {
  const n = src.length;
  let j = i + 1;
  let inClass = false;
  while (j < n && src[j] !== "\n") {
    const c = src[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      j++;
      while (j < n && /[a-z]/.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

function scanSource(src) {
  const n = src.length;
  const requires = [];
  const code = [];
  let i = 0;
  let line = 1;
  let prevSig = "";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "\n") {
      line++;
      code.push(c);
      i++;
      continue;
    }
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") {
          line++;
          code.push("\n");
        }
        i++;
      }
      i += 2;
      code.push(" ");
      continue;
    }
    if (c === '"' || c === "'") {
      const j = skipQuoted(src, i);
      code.push(src.slice(i, j));
      i = j;
      prevSig = c;
      continue;
    }
    if (c === "`") {
      const j = skipTemplate(src, i);
      const chunk = src.slice(i, j);
      for (const ch of chunk) if (ch === "\n") line++;
      code.push(chunk);
      i = j;
      prevSig = c;
      continue;
    }
    if (c === "/" && REGEX_PREV.has(prevSig)) {
      const j = skipRegex(src, i);
      if (j > 0) {
        code.push(src.slice(i, j));
        i = j;
        prevSig = "/";
        continue;
      }
    }
    if (c === "r" && src.startsWith("require", i) && !ID_CHAR.test(src[i - 1] || "") && src[i - 1] !== ".") {
      let j = i + 7;
      while (j < n && /[ \t]/.test(src[j])) j++;
      if (src[j] === "(") {
        const open = j;
        let k = open + 1;
        let depth = 1;
        while (k < n && depth > 0) {
          const ch = src[k];
          if (ch === '"' || ch === "'") {
            k = skipQuoted(src, k);
            continue;
          }
          if (ch === "`") {
            k = skipTemplate(src, k);
            continue;
          }
          if (ch === "(") depth++;
          else if (ch === ")") depth--;
          k++;
        }
        const expr = src.slice(open + 1, k - 1).trim();
        const lit = /^(["'])([^"'\\\n]*)\1$/.exec(expr);
        if (lit) requires.push({ kind: "literal", spec: lit[2], expr, line });
        else if (expr) requires.push({ kind: "dynamic", expr: expr.replace(/\s+/g, " "), line });
        for (const ch of src.slice(i, k)) if (ch === "\n") line++;
        code.push(src.slice(i, k));
        i = k;
        prevSig = ")";
        continue;
      }
    }
    code.push(c);
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return { requires, code: code.join("") };
}

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function walk(dir, out = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && JS_EXT.test(e.name)) out.push(full);
  }
  return out;
}

function walkExt(dir, ext, out = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkExt(full, ext, out);
    else if (e.isFile() && e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function readLinesJsonl(p) {
  let txt;
  try {
    txt = fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
  const out = [];
  for (const ln of txt.split(/\r?\n/)) {
    if (!ln.trim()) continue;
    try {
      const o = JSON.parse(ln);
      if (!o._meta) out.push(o);
    } catch {
    }
  }
  return out;
}

function gitHead(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function resolveRelative(root, fromAbs, spec) {
  const base = path.resolve(path.dirname(fromAbs), spec);
  for (const ext of RESOLVE_EXT) {
    const cand = base + ext;
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch {
    }
  }
  return null;
}

function pathsKeysIn(code) {
  const keys = new Set();
  for (const m of code.matchAll(/\bPATHS\s*\.\s*([A-Za-z_$][\w$]*)/g)) keys.add(m[1]);
  for (const m of code.matchAll(/\bPATHS\s*\[\s*["']([\w$]+)["']\s*\]/g)) keys.add(m[1]);
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*(?:[\w$]+\s*\.\s*)?PATHS\b/g)) {
    for (const part of m[1].split(",")) {
      const k = part.trim().split(":")[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.add(k);
    }
  }
  return keys;
}

function buildRequireGraph(root = DEFAULT_ROOT) {
  const rootAbs = path.resolve(root);
  const rel = (abs) => toPosix(path.relative(rootAbs, abs));

  const nodes = new Set();
  const edgeKey = new Set();
  const edges = [];
  const unresolved = [];
  const missing = [];
  const counts = { files: 0, externalRequires: 0 };
  const sources = {};

  function addEdge(from, to, kind, extra) {
    const k = `${from}\u0000${to}\u0000${kind}\u0000${extra ? JSON.stringify(extra) : ""}`;
    if (edgeKey.has(k)) return;
    edgeKey.add(k);
    nodes.add(from);
    nodes.add(to);
    edges.push({ from, to, kind, ...(extra || {}) });
  }

  const pathsJson = readJsonSafe(path.join(rootAbs, ".claude", "paths.json")) || {};
  const registry = readJsonSafe(path.join(rootAbs, "framework", "paths.registry.json"));
  const keyTarget = new Map();
  for (const [k, v] of Object.entries(pathsJson)) {
    if (k === "version" || k === "$schema" || typeof v !== "string") continue;
    const regKind = registry && registry.paths && registry.paths[k] && registry.paths[k].kind;
    const isDir = regKind ? regKind === "dir" : !/\.[A-Za-z0-9]+$/.test(v);
    const p = toPosix(v).replace(/\/+$/, "");
    keyTarget.set(k, isDir ? `${p}/` : p);
  }
  sources.pathsKeys = keyTarget.size;

  const roots = SCAN_ROOTS.filter((r) => fs.existsSync(path.join(rootAbs, r)));
  const files = [];
  for (const r of roots) walk(path.join(rootAbs, r), files);
  files.sort();
  for (const abs of files) {
    let src;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    counts.files++;
    const from = rel(abs);
    nodes.add(from);
    const { requires, code } = scanSource(src);
    for (const r of requires) {
      if (r.kind === "dynamic") {
        unresolved.push({ file: from, expr: r.expr, line: r.line });
        continue;
      }
      if (!r.spec.startsWith(".")) {
        counts.externalRequires++;
        continue;
      }
      const target = resolveRelative(rootAbs, abs, r.spec);
      if (!target) {
        missing.push({ file: from, spec: r.spec, line: r.line });
        continue;
      }
      const to = rel(target);
      if (to.startsWith("..")) {
        missing.push({ file: from, spec: r.spec, line: r.line, reason: "outside-root" });
        continue;
      }
      addEdge(from, to, "require");
    }
    if (/\bPATHS\b/.test(code)) {
      for (const k of pathsKeysIn(code)) {
        const t = keyTarget.get(k);
        if (t) addEdge(from, t, "paths-consumer", { key: k });
      }
    }
  }

  const hooksReg = readJsonSafe(path.join(rootAbs, "framework", "hooks.registry.json"));
  sources.hooksRegistry = Boolean(hooksReg);
  let wiring = 0;
  if (hooksReg && Array.isArray(hooksReg.hooks)) {
    for (const h of hooksReg.hooks) {
      if (!h || !h.script) continue;
      const script = toPosix(h.script);
      if (!fs.existsSync(path.join(rootAbs, script))) continue;
      const regs = Array.isArray(h.registrations) && h.registrations.length ? h.registrations : [{}];
      for (const reg of regs) {
        addEdge("framework/hooks.registry.json", script, "hook-wiring", {
          hook: h.id || path.basename(script, ".js"),
          event: reg.event || null,
          matcher: reg.matcher || null,
        });
        wiring++;
      }
    }
  }
  counts.hookWiring = wiring;

  const mapsRel = toPosix(pathsJson.maps || ".claude/project/maps");
  const skills = readLinesJsonl(path.join(rootAbs, mapsRel, "skills.jsonl"));
  sources.skillsMap = skills ? skills.length : 0;
  const skillPathById = new Map();
  for (const s of skills || []) if (s.id && s.path) skillPathById.set(s.id, toPosix(s.path));
  let skillEdges = 0;
  let specRefs = 0;
  for (const s of skills || []) {
    if (!s.path) continue;
    const from = toPosix(s.path);
    for (const c of s.calls || []) {
      const tp = skillPathById.get(`skill:${String(c).replace(/\//g, ":")}`) || skillPathById.get(`skill:${c}`);
      if (tp && tp !== from && fs.existsSync(path.join(rootAbs, tp))) {
        addEdge(from, tp, "skill-call");
        skillEdges++;
      }
    }
  }
  const SCRIPT_REF = /scripts\/[A-Za-z0-9_./-]+\.(?:js|cjs|mjs)\b/g;
  const skillFiles = walkExt(path.join(rootAbs, ".claude", "commands"), ".md").sort();
  sources.skillFiles = skillFiles.length;
  for (const abs of skillFiles) {
    const from = rel(abs);
    nodes.add(from);
    let md;
    try {
      md = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const m of new Set(md.match(SCRIPT_REF) || [])) {
      if (!fs.existsSync(path.join(rootAbs, m))) continue;
      if (m.startsWith("scripts/hooks/")) {
        addEdge(from, m, "skill-call");
        skillEdges++;
      } else {
        addEdge(from, m, "spec-ref");
        specRefs++;
      }
    }
    for (const m of new Set([...md.matchAll(/\bpaths\.([A-Za-z_$][\w$]*)/g)].map((x) => x[1]))) {
      const t = keyTarget.get(m);
      if (t) addEdge(from, t, "paths-consumer", { key: m });
    }
  }
  counts.skillCall = skillEdges;
  counts.specRef = specRefs;

  const sortedEdges = edges.sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
  );
  const byKind = {};
  for (const e of sortedEdges) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  unresolved.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  missing.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    head: gitHead(rootAbs),
    roots,
    nodes: [...nodes].sort(),
    edges: sortedEdges,
    unresolved,
    missing,
    sources,
    counts: {
      nodes: nodes.size,
      edges: sortedEdges.length,
      unresolved: unresolved.length,
      missing: missing.length,
      byKind,
      filesScanned: counts.files,
      externalRequires: counts.externalRequires,
    },
  };
}

function graphPath(root = DEFAULT_ROOT) {
  const pj = readJsonSafe(path.join(root, ".claude", "paths.json")) || {};
  return path.join(root, pj.requireGraph || path.join(pj.maps || ".claude/project/maps", "require-graph.json"));
}

function regenRequireGraph(root = DEFAULT_ROOT) {
  const graph = buildRequireGraph(root);
  const out = graphPath(root);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(graph, null, 2) + "\n");
  return graph;
}

function loadRequireGraph(root = DEFAULT_ROOT) {
  return readJsonSafe(graphPath(root));
}

function isGraphStale(graph, root = DEFAULT_ROOT) {
  if (!graph || typeof graph !== "object") return true;
  const generatedMs = graph.generatedAt ? Date.parse(graph.generatedAt) : NaN;
  if (Number.isNaN(generatedMs)) return true;
  const rootAbs = path.resolve(root);
  const roots = SCAN_ROOTS.filter((r) => fs.existsSync(path.join(rootAbs, r)));
  const files = [];
  for (const r of roots) walk(path.join(rootAbs, r), files);
  for (const abs of files) {
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.mtimeMs > generatedMs) return true;
  }
  return false;
}

function loadOrBuildRequireGraph(root = DEFAULT_ROOT) {
  const onDisk = loadRequireGraph(root);
  if (onDisk && !isGraphStale(onDisk, root)) return onDisk;
  try {
    return module.exports.buildRequireGraph(root);
  } catch {
    return onDisk || null;
  }
}

module.exports = {
  SCHEMA,
  scanSource,
  buildRequireGraph,
  regenRequireGraph,
  loadRequireGraph,
  loadOrBuildRequireGraph,
  isGraphStale,
  graphPath,
};

if (require.main === module) {
  const check = process.argv.includes("--check");
  const asJson = process.argv.includes("--json");
  const root = DEFAULT_ROOT;
  let graph;
  try {
    graph = check ? buildRequireGraph(root) : regenRequireGraph(root);
  } catch (e) {
    process.stderr.write(`require-graph: failed: ${(e && e.message) || e}\n`);
    process.exit(2);
  }
  const c = graph.counts;
  if (asJson) process.stdout.write(JSON.stringify({ ok: true, counts: c }, null, 2) + "\n");
  else {
    process.stdout.write(
      `  require-graph: ${c.nodes} nodes, ${c.edges} edges (${Object.entries(c.byKind).map(([k, v]) => `${k}=${v}`).join(", ")}), ${c.unresolved} unresolved dynamic, ${c.missing} missing\n`,
    );
    if (!check) process.stdout.write(`  wrote ${toPosix(path.relative(root, graphPath(root)))}\n`);
  }
  if (check && (c.filesScanned === 0 || c.missing > 0)) {
    for (const m of graph.missing.slice(0, 20)) process.stderr.write(`  MISSING ${m.file}:${m.line} require("${m.spec}")\n`);
    process.exit(1);
  }
}
