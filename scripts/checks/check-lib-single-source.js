#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CHECK_LIB_DIR = path.join(ROOT, "scripts", "dispatch", "check-lib");
const NAME = "check-lib-single-source";

const SCAN_ROOTS = ["scripts", ".claude"];
const SKIP_DIRS = new Set(["node_modules", ".git", "runtime", ".provider-tmp"]);
const TEXT_EXT = new Set([".js", ".mjs", ".cjs"]);

const WRAPPED_SOURCES = {
  "no-nul-bytes": ["scripts/checks/no-nul-bytes.js"],
};

const SELF_EXEMPT = new Set(["scripts/checks/check-lib-single-source.js"]);

const CONSUMERS = Object.freeze([
  { id: "hook", path: "scripts/hooks/check-lib-prevention.js", requireTarget: "check-lib" },
  { id: "pre-commit", path: "scripts/hooks/pre-commit-check-lib.js", requireTarget: "check-lib" },
  { id: "controller", path: "scripts/dispatch/trusted-controller.js", requireTarget: "pinned-checker-bundle" },
]);

function identifierVariants(name) {
  const parts = String(name).split(/[-_]/).filter(Boolean);
  const camel = parts.map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join("");
  const pascal = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  const snake = parts.join("_");
  return Array.from(new Set([name, camel, pascal, snake].filter(Boolean)));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      yield* walk(path.join(dir, ent.name));
    } else if (ent.isFile() && TEXT_EXT.has(path.extname(ent.name).toLowerCase())) {
      yield path.join(dir, ent.name);
    }
  }
}

function collectFiles(root = ROOT, roots = SCAN_ROOTS) {
  const files = [];
  for (const r of roots) {
    const abs = path.join(root, r);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      try {
        files.push({ path: path.relative(root, file).split(path.sep).join("/"), content: fs.readFileSync(file, "utf8") });
      } catch {
      }
    }
  }
  return files;
}

function evaluate({ checkNames = [], files = [], wrappedSources = WRAPPED_SOURCES } = {}) {
  const findings = [];
  for (const name of checkNames) {
    const idents = identifierVariants(name).map(escapeRegex);
    const exempt = new Set((wrappedSources[name] || []).map((p) => p.replace(/\\/g, "/")));
    const pattern = new RegExp(`\\b(function|const|let|var)\\s+(${idents.join("|")})\\b`);
    for (const f of files) {
      const norm = f.path.replace(/\\/g, "/");
      if (norm.startsWith("scripts/dispatch/check-lib/")) continue;
      if (exempt.has(norm)) continue;
      if (SELF_EXEMPT.has(norm)) continue;
      if (pattern.test(f.content)) findings.push({ check: name, file: norm });
    }
  }
  return { ok: findings.length === 0, findings };
}

function checkConsumers(root = ROOT, consumers = CONSUMERS) {
  const report = [];
  for (const c of consumers) {
    const abs = path.join(root, ...c.path.split("/"));
    if (!fs.existsSync(abs)) {
      report.push({ ...c, status: "pending" });
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch (e) {
      report.push({ ...c, status: "unreadable", error: String(e && e.message ? e.message : e) });
      continue;
    }
    const wiredRe =
      c.requireTarget === "pinned-checker-bundle"
        ? /require\(\s*(['"])(?:[^'"]*\/)?(?:dispatch\/)?pinned-checker-bundle(?:\.js)?\1\s*\)/
        : /require\(\s*(['"])(?:[^'"]*\/)?(?:dispatch\/)?check-lib(?:\/index(?:\.js)?)?\1\s*\)/;
    report.push({ ...c, status: wiredRe.test(content) ? "wired" : "missing-require" });
  }
  return report;
}

function checkLineage({ manifestPath, sourceDigestOf, loadBundleManifest } = {}) {
  if (!manifestPath) return { checked: false };
  const pcb = require("../dispatch/pinned-checker-bundle");
  const digestFn = sourceDigestOf || pcb.sourceDigestOf;
  const loadFn = loadBundleManifest || pcb.loadBundleManifest;
  let bundle;
  try {
    bundle = loadFn(manifestPath);
  } catch (e) {
    return { checked: true, ok: false, reason: `bundle manifest unreadable: ${e.message}` };
  }
  const fresh = digestFn(CHECK_LIB_DIR);
  const pinned = bundle.promotion && bundle.promotion.from_src_digest;
  if (!pinned || pinned !== fresh) {
    return { checked: true, ok: false, reason: "lineage-mismatch", pinned: pinned || null, fresh };
  }
  return { checked: true, ok: true, pinned, fresh };
}

function run(opts = {}) {
  const root = opts.root || ROOT;
  const files = opts.files || collectFiles(root);
  const { CHECK_NAMES } = require(path.join(CHECK_LIB_DIR, "registry"));
  const scan = evaluate({ checkNames: CHECK_NAMES, files, wrappedSources: opts.wrappedSources });
  const consumers = checkConsumers(root, opts.consumers);
  const lineage = checkLineage({ manifestPath: opts.manifestPath, sourceDigestOf: opts.sourceDigestOf, loadBundleManifest: opts.loadBundleManifest });
  const missingRequire = consumers.filter((c) => c.status === "missing-require" || c.status === "unreadable");
  const ok = scan.ok && missingRequire.length === 0 && lineage.ok !== false;
  return { ok, findings: scan.findings, consumers, lineage };
}

module.exports = {
  evaluate,
  identifierVariants,
  collectFiles,
  checkConsumers,
  checkLineage,
  run,
  CONSUMERS,
  WRAPPED_SOURCES,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const manifestIdx = argv.indexOf("--bundle-manifest");
  const manifestPath = manifestIdx >= 0 ? argv[manifestIdx + 1] : undefined;
  let res;
  try {
    res = run({ manifestPath });
  } catch (e) {
    if (jsonOut) console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
    else console.error(`[${NAME}] runner error: ${e && e.message ? e.message : e}`);
    process.exit(2);
  }
  if (jsonOut) {
    console.log(JSON.stringify({ check: NAME, ...res }));
  } else if (res.ok) {
    console.log(`OK   [${NAME}] zero re-implementations; consumers: ${res.consumers.map((c) => `${c.id}:${c.status}`).join(", ")}`);
  } else {
    console.error(`FAIL [${NAME}]`);
    for (const f of res.findings) console.error(`  - re-implementation: check '${f.check}' declared in ${f.file}`);
    for (const c of res.consumers.filter((c) => c.status === "missing-require" || c.status === "unreadable")) {
      console.error(`  - consumer ${c.id} (${c.path}) does not require() check-lib (${c.status})`);
    }
    if (res.lineage && res.lineage.ok === false) console.error(`  - lineage: ${res.lineage.reason} (pinned=${res.lineage.pinned}, fresh=${res.lineage.fresh})`);
  }
  process.exit(res.ok ? 0 : 1);
}
