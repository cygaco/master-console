"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_LIB_SRC = path.join(PROJECT_ROOT, "scripts", "dispatch", "check-lib");
const DEFAULT_EXTERNAL_DEPS_REL = ["scripts/checks/no-nul-bytes.js"];

function sha256File(absPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value === undefined ? null : value;
}
function sha256Of(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(obj))).digest("hex");
}
function sortObj(o) {
  const out = {};
  for (const k of Object.keys(o || {}).sort()) out[k] = o[k];
  return out;
}

function collectDirFiles(dir) {
  const out = [];
  (function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push(abs);
    }
  })(dir);
  return out;
}

function copyTreeInto(srcRoot, destRoot) {
  const map = {};
  for (const f of collectDirFiles(srcRoot)) {
    const rel = path.relative(srcRoot, f).split(path.sep).join("/");
    const dest = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f, dest);
    map[rel] = sha256File(f);
  }
  return map;
}

function sourceDigestOf(srcRoot) {
  const map = {};
  for (const f of collectDirFiles(srcRoot)) {
    const rel = path.relative(srcRoot, f).split(path.sep).join("/");
    map[rel] = sha256File(f);
  }
  return sha256Of(sortObj(map));
}

function realpathOrResolve(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isInside(childAbs, rootAbs) {
  const rel = path.relative(rootAbs, childAbs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertOutsideZones(absPath, zones = {}, code = "resolution-outside-candidate") {
  const real = realpathOrResolve(absPath);
  if (zones.candidateRoot) {
    const cr = realpathOrResolve(zones.candidateRoot);
    if (isInside(real, cr)) {
      throw Object.assign(new Error(`resolution '${real}' is inside candidateRoot '${cr}' — refused (${code})`), { code });
    }
  }
  if (zones.repoCheckLibRoot) {
    const rc = realpathOrResolve(zones.repoCheckLibRoot);
    if (isInside(real, rc)) {
      throw Object.assign(
        new Error(`resolution '${real}' is inside the LIVE in-tree check-lib source '${rc}' — the pinned snapshot must be used instead (${code})`),
        { code },
      );
    }
  }
  return real;
}

function buildBundle(opts = {}) {
  const srcRoot = path.resolve(opts.srcRoot || DEFAULT_LIB_SRC);
  if (!fs.existsSync(srcRoot) || !fs.statSync(srcRoot).isDirectory()) {
    throw new Error(`buildBundle: srcRoot does not exist or is not a directory: ${srcRoot}`);
  }
  if (!opts.outRoot) {
    throw new Error("buildBundle: opts.outRoot is required (the promoted, out-of-tree destination)");
  }
  const bundleRoot = path.resolve(opts.outRoot);
  const libDir = path.join(bundleRoot, "lib");
  const externalDir = path.join(bundleRoot, "external");
  fs.mkdirSync(libDir, { recursive: true });
  fs.mkdirSync(externalDir, { recursive: true });

  const files = {};
  const libMap = copyTreeInto(srcRoot, libDir);
  for (const [rel, hash] of Object.entries(libMap)) files[`lib/${rel}`] = hash;

  const repoRoot = path.resolve(opts.repoRoot || PROJECT_ROOT);
  const externalDepsAbs = Array.isArray(opts.externalDeps)
    ? opts.externalDeps
    : DEFAULT_EXTERNAL_DEPS_REL.map((p) => path.join(repoRoot, ...p.split("/")));

  const deps = { fs: "builtin", path: "builtin", crypto: "builtin" };
  for (const depAbs of externalDepsAbs) {
    if (!fs.existsSync(depAbs)) continue;
    const relToRepo = path.relative(repoRoot, depAbs).split(path.sep).join("/");
    const destAbs = path.join(externalDir, relToRepo);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(depAbs, destAbs);
    const hash = sha256File(depAbs);
    files[`external/${relToRepo}`] = hash;
    deps[relToRepo] = hash;
  }

  const config = {
    scanRoots: ["scripts", ".claude"],
    textExt: [".js", ".json", ".md", ".ts", ".mjs", ".cjs"],
    skipDirs: ["node_modules", ".git", "runtime", ".provider-tmp"],
  };
  const executables = { node: fs.realpathSync(process.execPath) };

  const bundle_digest = sha256Of({ files: sortObj(files), executables, config });
  const prevManifest = opts.prevManifest || null;
  const promotion = {
    promoted_at: Date.now(),
    promoted_by: opts.promotedBy || "unknown",
    from_src_digest: sourceDigestOf(srcRoot),
    prev_bundle_digest: prevManifest ? prevManifest.bundle_digest : null,
  };
  const rollback = {
    prev_bundle_digest: prevManifest ? prevManifest.bundle_digest : null,
    prev_manifest_path: opts.prevManifestPath || null,
  };

  const manifest = {
    schema_version: "checker-bundle/v1",
    suite_version: opts.suiteVersion || require("./check-lib/registry").SUITE_VERSION,
    bundle_digest,
    files,
    deps,
    config,
    executables,
    promotion,
    rollback,
  };

  const manifestPath = path.join(bundleRoot, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, bundleRoot, manifestPath };
}

function loadBundleManifest(manifestPath) {
  if (typeof manifestPath !== "string" || !manifestPath) {
    throw new Error("loadBundleManifest: manifestPath is required");
  }
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (e) {
    throw new Error(`loadBundleManifest: cannot read manifest at ${manifestPath}: ${e.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    throw new Error(`loadBundleManifest: manifest at ${manifestPath} is not valid JSON: ${e.message}`);
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.schema_version !== "checker-bundle/v1" ||
    typeof manifest.bundle_digest !== "string" ||
    !manifest.bundle_digest ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    Array.isArray(manifest.files) ||
    !manifest.executables ||
    typeof manifest.executables !== "object"
  ) {
    throw new Error(`loadBundleManifest: manifest at ${manifestPath} is missing required fields (fail-closed)`);
  }
  if (Object.keys(manifest.files).length === 0) {
    throw new Error(`loadBundleManifest: manifest at ${manifestPath} has an EMPTY 'files' map (fail-closed — a vacuous pin proves nothing)`);
  }
  if (!Object.prototype.hasOwnProperty.call(manifest.files, "lib/index.js")) {
    throw new Error(`loadBundleManifest: manifest at ${manifestPath} 'files' does not include 'lib/index.js' (fail-closed — incomplete pin)`);
  }
  return manifest;
}

function assertBundleCompleteness(manifest, opts = {}) {
  const files = (manifest && manifest.files) || {};
  if (Object.keys(files).length === 0 || !("lib/index.js" in files)) {
    return { ok: false, missing: ["lib/index.js"] };
  }
  const bundleRoot = path.resolve(opts.bundleRoot || "");
  const registryPath = path.join(bundleRoot, "lib", "registry.js");
  if (!("lib/registry.js" in files)) {
    return { ok: false, missing: ["lib/registry.js"] };
  }
  const missing = [];
  try {
    if (fs.existsSync(registryPath)) {
      delete require.cache[registryPath];
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const pinnedRegistry = require(registryPath);
      for (const name of (pinnedRegistry && pinnedRegistry.CHECK_NAMES) || []) {
        const rel = `lib/checks/${name}.js`;
        if (!(rel in files)) missing.push(rel);
      }
    } else {
      missing.push("lib/registry.js (pinned copy unreadable on disk)");
    }
  } catch (e) {
    missing.push(`lib/registry.js (unreadable: ${e && e.message ? e.message : e})`);
  }
  return { ok: missing.length === 0, missing };
}

function verifyBundle(manifest, opts = {}) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, mismatches: [{ path: "__manifest__", reason: "invalid-manifest" }], recomputedDigest: null, observedDigest: null };
  }
  const bundleRoot = path.resolve(opts.bundleRoot || "");
  const mismatches = [];
  const observedFiles = {};
  for (const [rel, expected] of Object.entries(manifest.files || {})) {
    const abs = path.join(bundleRoot, rel);
    if (!fs.existsSync(abs)) {
      mismatches.push({ path: rel, reason: "missing", expected });
      observedFiles[rel] = "MISSING";
      continue;
    }
    let actual;
    try {
      actual = sha256File(abs);
    } catch (e) {
      mismatches.push({ path: rel, reason: "unreadable", expected, error: e.message });
      observedFiles[rel] = "UNREADABLE";
      continue;
    }
    observedFiles[rel] = actual;
    if (actual !== expected) mismatches.push({ path: rel, reason: "hash-mismatch", expected, actual });
  }
  const recomputedDigest = sha256Of({ files: sortObj(manifest.files || {}), executables: manifest.executables, config: manifest.config });
  if (recomputedDigest !== manifest.bundle_digest) {
    mismatches.push({ path: "__bundle_digest__", reason: "bundle-digest-mismatch", expected: manifest.bundle_digest, actual: recomputedDigest });
  }
  const observedDigest = sha256Of({ files: sortObj(observedFiles), executables: manifest.executables, config: manifest.config });
  return { ok: mismatches.length === 0, mismatches, recomputedDigest, observedDigest };
}

function resolveExecutable(manifest, toolId, opts = {}) {
  if (toolId !== "node") {
    throw new Error(`resolveExecutable: unknown toolId '${toolId}' (only 'node' is pinned in the bundle manifest)`);
  }
  const raw = manifest && manifest.executables && manifest.executables[toolId];
  if (typeof raw !== "string" || !raw) {
    throw new Error(`resolveExecutable: no pinned executable recorded for '${toolId}'`);
  }
  return assertOutsideZones(raw, { candidateRoot: opts.candidateRoot, repoCheckLibRoot: opts.repoCheckLibRoot }, "resolution-outside-candidate");
}

const REQUIRED_INDEX_EXPORTS = Object.freeze(["SUITE_VERSION", "CHECK_NAMES", "REQUIRED_CHECKS", "listChecks", "getCheck", "runCheck", "runSuite"]);
const REQUIRED_INDEX_FUNCTIONS = new Set(["listChecks", "getCheck", "runCheck", "runSuite"]);

function assertCheckLibExports(mod) {
  const missing = REQUIRED_INDEX_EXPORTS.filter((k) => {
    if (!mod || !(k in mod)) return true;
    const v = mod[k];
    if (REQUIRED_INDEX_FUNCTIONS.has(k)) return typeof v !== "function";
    return v === undefined || v === null;
  });
  return { ok: missing.length === 0, missing };
}

function bundleContentDigest(manifest) {
  return manifest && manifest.bundle_digest;
}

function runPinnedSuite(manifest, ctx = {}, opts = {}) {
  const bundleRoot = path.resolve(opts.bundleRoot || "");
  const candidateRoot = opts.candidateRoot;
  const nonce = opts.nonce;
  const empty = { version: manifest && manifest.suite_version, results: [], missing: [] };

  if (candidateRoot) {
    let bundleRootReal;
    try {
      bundleRootReal = realpathOrResolve(bundleRoot);
    } catch (e) {
      return { ok: false, verified: false, reason: "checker-not-from-pinned-bundle", error: e.message, ...empty, preDigest: null, postDigest: null };
    }
    const candidateRootReal = realpathOrResolve(candidateRoot);
    if (isInside(bundleRootReal, candidateRootReal)) {
      return {
        ok: false,
        verified: false,
        reason: "checker-not-from-pinned-bundle",
        error: `bundleRoot '${bundleRootReal}' resolves inside candidateRoot '${candidateRootReal}'`,
        ...empty,
        preDigest: null,
        postDigest: null,
      };
    }
  }

  const completeness = assertBundleCompleteness(manifest, { bundleRoot });
  if (!completeness.ok) {
    return {
      ok: false,
      verified: false,
      reason: "incomplete-bundle-manifest",
      ...empty,
      missing: completeness.missing,
      preDigest: null,
      postDigest: null,
    };
  }

  const pre = verifyBundle(manifest, { bundleRoot });
  if (!pre.ok) {
    return { ok: false, verified: false, reason: "bundle-pin-mismatch", mismatches: pre.mismatches, ...empty, preDigest: pre.observedDigest, postDigest: null };
  }

  const resolveFn = typeof opts.resolveExecutableFn === "function" ? opts.resolveExecutableFn : resolveExecutable;
  try {
    resolveFn(manifest, "node", { candidateRoot, repoCheckLibRoot: DEFAULT_LIB_SRC });
  } catch (e) {
    return { ok: false, verified: false, reason: e.code || "resolution-outside-candidate", error: e.message, ...empty, preDigest: pre.observedDigest, postDigest: null };
  }

  const pinnedIndexPath = path.join(bundleRoot, "lib", "index.js");
  let pinnedIndexReal;
  try {
    pinnedIndexReal = assertOutsideZones(pinnedIndexPath, { candidateRoot, repoCheckLibRoot: DEFAULT_LIB_SRC }, "checker-not-from-pinned-bundle");
  } catch (e) {
    return { ok: false, verified: false, reason: e.code || "checker-not-from-pinned-bundle", error: e.message, ...empty, preDigest: pre.observedDigest, postDigest: null };
  }

  let pinnedIndex;
  const requireFn = typeof opts.requireFn === "function" ? opts.requireFn : (p) => require(p);
  try {
    delete require.cache[pinnedIndexReal];
    pinnedIndex = requireFn(pinnedIndexReal);
  } catch (e) {
    return { ok: false, verified: false, reason: "pinned-index-require-failed", error: e.message, ...empty, preDigest: pre.observedDigest, postDigest: null };
  }

  const contract = assertCheckLibExports(pinnedIndex);
  if (!contract.ok) {
    return { ok: false, verified: false, reason: "check-export-missing", missingExports: contract.missing, ...empty, preDigest: pre.observedDigest, postDigest: null };
  }

  const execCtx = { ...ctx, nonce };
  let raw;
  try {
    raw = pinnedIndex.runSuite(pinnedIndex.CHECK_NAMES.slice(), execCtx);
  } catch (e) {
    return {
      ok: false,
      verified: false,
      reason: "pinned-suite-execution-error",
      error: e.message,
      version: pinnedIndex.SUITE_VERSION,
      results: [],
      missing: [],
      preDigest: pre.observedDigest,
      postDigest: null,
    };
  }
  const results = (raw.results || []).map((r) => ({ ...r, nonce }));

  const post = verifyBundle(manifest, { bundleRoot });
  const preDigest = pre.observedDigest;
  const postDigest = post.observedDigest;
  if (!post.ok || preDigest !== postDigest) {
    return {
      ok: false,
      verified: false,
      reason: "checker-mutated-mid-run",
      mismatches: post.mismatches,
      version: raw.version,
      results,
      missing: raw.missing,
      preDigest,
      postDigest,
    };
  }

  return { ok: true, verified: true, version: raw.version, results, missing: raw.missing, preDigest, postDigest };
}

module.exports = {
  buildBundle,
  loadBundleManifest,
  verifyBundle,
  assertBundleCompleteness,
  resolveExecutable,
  runPinnedSuite,
  bundleContentDigest,
  sourceDigestOf,
  assertCheckLibExports,
  assertOutsideZones,
  isInside,
  sha256File,
  sha256Of,
  DEFAULT_LIB_SRC,
  PROJECT_ROOT,
};
