#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { loadOrBuildRequireGraph } = require("../maps/require-graph");

const SCHEMA = "mc/touchpoint/v1";
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
const PATHS_REGISTRY_FILES = new Set(["framework/paths.registry.json", ".claude/paths.json"]);
const PATHS_READERS = ["scripts/hooks/lib/paths.js", "scripts/hooks/lib/paths.generated.js"];
const TEST_FILE = /(?:^|\/)(?:[^/]+\.test\.js|test-[^/]+\.js)$|^tests\//;

function normalize(file, root) {
  let f = String(file || "").trim().replace(/\\/g, "/");
  if (!f) return "";
  if (path.isAbsolute(f) || /^[A-Za-z]:\//.test(f)) {
    const r = path.relative(root, f).replace(/\\/g, "/");
    if (!r.startsWith("..")) f = r;
  }
  return f.replace(/^\.\//, "");
}

function buildIndex(graph) {
  const nodes = new Set(graph.nodes || []);
  const reverse = new Map();
  const forward = new Map();
  const dirEdges = [];
  for (const e of graph.edges || []) {
    if (e.kind === "paths-consumer" && e.to.endsWith("/")) dirEdges.push(e);
    if (!reverse.has(e.to)) reverse.set(e.to, []);
    reverse.get(e.to).push(e);
    if (e.kind === "hook-wiring") {
      if (!forward.has(e.from)) forward.set(e.from, []);
      forward.get(e.from).push(e);
    }
  }
  return { nodes, reverse, forward, dirEdges };
}

function dirEdgesFor(file, index) {
  return index.dirEdges.filter((e) => file.startsWith(e.to) && file !== e.to);
}

function isMapped(file, index) {
  return (
    index.nodes.has(file) ||
    PATHS_REGISTRY_FILES.has(file) ||
    dirEdgesFor(file, index).length > 0
  );
}

function dynamicHintMatches(expr, file) {
  const parts = [...String(expr).matchAll(/["']([^"']*)["']/g)].map((m) => m[1]).filter(Boolean);
  if (!parts.length) return false;
  const joined = parts.join("/").replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\.(?:js|cjs|mjs|json)$/, "");
  const segs = file.replace(/\.(?:js|cjs|mjs|json)$/, "").split("/");
  if (segs.length < 2) return false;
  const tail = segs.slice(-2).join("/");
  return joined === tail || joined.endsWith(`/${tail}`);
}

function touchpointClosure(changedFiles, opts = {}) {
  let files = changedFiles;
  let o = opts || {};
  if (changedFiles && !Array.isArray(changedFiles) && typeof changedFiles === "object") {
    o = { ...changedFiles, ...o };
    files = changedFiles.files;
  }
  const root = path.resolve(o.root || DEFAULT_ROOT);
  const depth = o.depth === undefined || o.depth === null ? 1 : o.depth;
  const graph = o.graph || loadOrBuildRequireGraph(root);
  const changed = [...new Set((files || []).map((f) => normalize(f, root)).filter(Boolean))].sort();

  const base = {
    schema: SCHEMA,
    changed,
    depth,
    files: [],
    tests: [],
    edges_used: [],
    unresolved_hits: [],
    unmapped: false,
    unmapped_files: [],
    broad: false,
    graph_ok: Boolean(graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)),
    map_generated_at: (graph && graph.generatedAt) || null,
    map_head: (graph && graph.head) || null,
  };

  if (!base.graph_ok) {
    base.unmapped = true;
    base.unmapped_files = changed.slice();
    if (!changed.length) base.unmapped_files = ["<no-changed-files-and-no-graph>"];
    return base;
  }
  if (!changed.length) {
    base.unmapped = true;
    base.unmapped_files = ["<no-changed-files>"];
    return base;
  }

  const index = buildIndex(graph);
  const unmapped = changed.filter((f) => !isMapped(f, index));
  base.unmapped = unmapped.length > 0;
  base.unmapped_files = unmapped;

  const changedSet = new Set(changed);
  const visited = new Set(changed);
  const edgesUsed = [];
  const usedKey = new Set();
  const hits = [];
  const hitKey = new Set();
  const noteEdge = (from, to, kind, extra) => {
    const k = `${from}\u0000${to}\u0000${kind}`;
    if (usedKey.has(k)) return;
    usedKey.add(k);
    edgesUsed.push({ from, to, kind, ...(extra || {}) });
  };

  let frontier = changed.filter((f) => isMapped(f, index));
  const maxHops = depth === Infinity ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.floor(depth));
  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next = [];
    const reach = (file, edge) => {
      noteEdge(edge.from, edge.to, edge.kind, edge.key ? { key: edge.key } : undefined);
      if (!visited.has(file)) {
        visited.add(file);
        next.push(file);
      }
    };
    for (const f of frontier) {
      for (const e of index.reverse.get(f) || []) {
        reach(e.from, e);
      }
      for (const e of dirEdgesFor(f, index)) reach(e.from, e);
      if (hop === 1 && changedSet.has(f)) {
        for (const e of index.forward.get(f) || []) reach(e.to, e);
      }
      if (PATHS_REGISTRY_FILES.has(f)) {
        base.broad = true;
        for (const reader of PATHS_READERS) {
          if (!index.nodes.has(reader)) continue;
          noteEdge(reader, f, "paths-registry");
          if (!visited.has(reader)) {
            visited.add(reader);
            next.push(reader);
          }
        }
      }
      for (const u of graph.unresolved || []) {
        if (dynamicHintMatches(u.expr, f)) {
          const k = `${u.file}\u0000${u.line}\u0000${f}`;
          if (!hitKey.has(k)) {
            hitKey.add(k);
            hits.push({ file: u.file, expr: u.expr, line: u.line, target: f, reason: "name-match" });
          }
          noteEdge(u.file, f, "dynamic-hint");
          if (!visited.has(u.file)) {
            visited.add(u.file);
            next.push(u.file);
          }
        }
      }
    }
    frontier = next;
  }

  for (const u of graph.unresolved || []) {
    if (!visited.has(u.file)) continue;
    const k = `${u.file}\u0000${u.line}\u0000`;
    if ([...hitKey].some((h) => h.startsWith(k))) continue;
    hits.push({ file: u.file, expr: u.expr, line: u.line, reason: "in-scope-dynamic" });
  }

  const closure = [...visited].filter((f) => !changedSet.has(f)).sort();
  base.files = closure;
  base.tests = closure.filter((f) => TEST_FILE.test(f));
  base.edges_used = edgesUsed.sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
  );
  base.unresolved_hits = hits;
  return base;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namesBasename(testPath, base) {
  if (!base) return false;
  const re = new RegExp(`(^|[/\\-_.])${escapeRegExp(base)}([/\\-_.]|$)`);
  return re.test(testPath);
}

function focusedSet(opts = {}) {
  const { base, head, cwd, linkedTests } = opts;
  if (!base || !head) throw new Error("focusedSet requires { base, head }");
  const root = path.resolve(cwd || DEFAULT_ROOT);
  const diff = spawnSync("git", ["diff", "--name-only", `${base}...${head}`], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (diff.error || diff.status !== 0) {
    throw new Error(`focusedSet: git diff ${base}...${head} failed: ${diff.error ? diff.error.message : String(diff.stderr).trim()}`);
  }
  const files = [...new Set(String(diff.stdout).split(/\r?\n/).map((f) => normalize(f, root)).filter(Boolean))].sort();

  const ls = spawnSync("git", ["ls-files", "--", "scripts", "tests", ".claude", "framework"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const tracked = ls.status === 0 ? String(ls.stdout).split(/\r?\n/).map((f) => f.replace(/\\/g, "/")).filter(Boolean) : [];
  const trackedTests = tracked.filter((f) => TEST_FILE.test(f));
  const trackedSet = new Set(tracked);

  const tests = new Set();
  for (const f of files) {
    const siblingTest = f.replace(/\.(?:js|cjs|mjs)$/, ".test.js");
    if (siblingTest !== f && trackedSet.has(siblingTest)) tests.add(siblingTest);
    const base = path.basename(f).replace(/\.(?:js|cjs|mjs|json|md)$/, "");
    if (!base) continue;
    for (const t of trackedTests) if (namesBasename(t, base)) tests.add(t);
  }
  for (const t of linkedTests || []) {
    const n = normalize(t, root);
    if (n) tests.add(n);
  }
  return { schema: "mc/focused-set/v1", base, head, files, tests: [...tests].sort() };
}

const SECURITY_RISK_TOKENS = new Set(["security", "auth", "secrets", "dispatch", "leak-gate", "ci", "hooks", "paths-registry", "release-pipeline"]);

function globToRegExp(glob) {
  let re = "";
  const g = String(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      re += ".*";
      i++;
      if (g[i + 1] === "/") i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function securitySurfaceHit(opts = {}) {
  const { files, risks, goldenPaths } = opts;
  const globs = (goldenPaths && Array.isArray(goldenPaths.security_surface_globs)) ? goldenPaths.security_surface_globs : [];
  const matchers = globs.map((g) => globToRegExp(g));
  const by = new Set();
  for (const f of files || []) {
    const n = String(f || "").replace(/\\/g, "/");
    if (matchers.some((re) => re.test(n))) by.add(`path:${n}`);
  }
  for (const r of risks || []) {
    const tok = String(r || "").trim().toLowerCase();
    if (SECURITY_RISK_TOKENS.has(tok)) by.add(`risk:${tok}`);
  }
  return { hit: by.size > 0, by: [...by].sort() };
}

function widenForDynamicHints(touchpoint, opts = {}) {
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const hits = (touchpoint && touchpoint.unresolved_hits) || [];
  if (!hits.length) return { ...touchpoint, dynamic_require_widened: false };
  const fs = require("fs");
  const added = new Set();
  for (const h of hits) {
    const dir = path.dirname(h.file || "");
    if (!dir || dir === ".") continue;
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, ...dir.split("/")));
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!/\.(?:js|cjs|mjs)$/.test(e)) continue;
      added.add(`${dir}/${e}`);
    }
  }
  const files = [...new Set([...(touchpoint.files || []), ...added])].sort();
  const tests = [...new Set([...(touchpoint.tests || []), ...files.filter((f) => TEST_FILE.test(f))])].sort();
  return { ...touchpoint, files, tests, dynamic_require_widened: added.size > 0 };
}

module.exports = {
  SCHEMA,
  touchpointClosure,
  dynamicHintMatches,
  normalize,
  focusedSet,
  securitySurfaceHit,
  globToRegExp,
  widenForDynamicHints,
  SECURITY_RISK_TOKENS,
  TEST_FILE,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const val = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  const filesArg = val("--files");
  if (!filesArg) {
    process.stderr.write("usage: touchpoint.js --files a,b,c [--depth N] [--json]\n");
    process.exit(2);
  }
  const depthArg = val("--depth");
  const res = touchpointClosure(filesArg.split(","), {
    depth: depthArg === null ? 1 : depthArg === "inf" ? Infinity : Number(depthArg),
  });
  if (!res.graph_ok) process.stderr.write("touchpoint: require graph missing/unreadable — run scripts/regen-maps.js\n");
  process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  process.exit(res.unmapped ? 3 : 0);
}
