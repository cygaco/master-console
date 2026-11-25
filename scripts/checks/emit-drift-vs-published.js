#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const SCHEMA = "mc/emit-drift/v1";
const CONFIG_REL = "scripts/public-repo/emit-drift.json";
const GENERATOR_REL = "scripts/public-repo/generate.js";
const README = "README.md";
const CI_ALLOW = "ci/public-allowlist.txt";
const GH_WORKFLOW = ".github/workflows/no-personal-content.yml";
const LINE_FILES = [README, CI_ALLOW];
const PUBLISHED_REPO = "cygaco/master-console";
const PUBLISHED_REF = "main";
const SKIP_MESSAGE = "SKIP: publisher source only (no generator here)";

class CannotRun extends Error {}
const cannot = (m) => { throw new CannotRun(m); };

const HEX40 = /^[0-9a-f]{40}$/;
let emptyConfig = null;
function emptyConfigFile() {
  if (!emptyConfig) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "edvp-gitcfg-"));
    emptyConfig = path.join(d, "empty.gitconfig");
    fs.writeFileSync(emptyConfig, "");
    process.on("exit", () => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { } });
  }
  return emptyConfig;
}
function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = emptyConfigFile();
  return env;
}
function git(dir, args, opts = {}) {
  const r = spawnSync("git", ["--no-replace-objects", "-c", "core.autocrlf=false", "-C", dir, ...args], {
    env: gitEnv(), maxBuffer: 1 << 30, encoding: opts.text ? "utf8" : "buffer", windowsHide: true,
  });
  if (r.error) cannot(`git failed to start: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    cannot(`git ${args[0]} failed in ${dir}: ${String(r.stderr || "").trim().split(/\r?\n/)[0]}`);
  }
  return r;
}
const gitText = (dir, args) => git(dir, args, { text: true }).stdout.trim();
function resolveCommit(dir, ref) {
  const r = git(dir, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { text: true, allowFail: true });
  if (r.status !== 0) cannot(`ref ${ref} does not resolve to a commit in ${dir}`);
  const sha = r.stdout.trim();
  if (!HEX40.test(sha)) cannot(`ref ${ref} did not resolve to a 40-hex commit in ${dir}`);
  return sha;
}
function treeOf(dir, sha) {
  const t = gitText(dir, ["rev-parse", "--verify", "--end-of-options", `${sha}^{tree}`]);
  if (!HEX40.test(t)) cannot(`commit ${sha} has no 40-hex tree in ${dir}`);
  return t;
}
function requireToplevel(dir, what) {
  const r = git(dir, ["rev-parse", "--show-prefix"], { text: true, allowFail: true });
  if (r.status !== 0) cannot(`${what}: ${dir} is not a git repository`);
  if (r.stdout.trim() !== "") cannot(`${what}: ${dir} is not the top level of its repository`);
}
function parseTreeRecords(out) {
  const map = new Map();
  for (const rec of out.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    if (tab < 0) cannot("git ls-tree returned a malformed record");
    const [mode, type, oid] = rec.slice(0, tab).split(" ");
    const p = rec.slice(tab + 1);
    if (!p || !HEX40.test(oid || "") || !["blob", "tree", "commit"].includes(type)) cannot("git ls-tree returned an invalid entry");
    map.set(p, { mode, type, sha: oid });
  }
  return map;
}
function lsPaths(dir, sha, rels) {
  return parseTreeRecords(git(dir, ["ls-tree", "--full-tree", "-z", sha, "--", ...rels]).stdout.toString("utf8"));
}
function gitTree(dir, sha) {
  return parseTreeRecords(git(dir, ["ls-tree", "-r", "-z", "--full-tree", sha]).stdout.toString("utf8"));
}
const blobId = (buf) => crypto.createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");

function makeGitFetcher(dir) {
  return {
    resolveRef: (ref) => resolveCommit(dir, ref),
    getTree: (sha) => ({ entries: [...gitTree(dir, sha)].map(([p, e]) => ({ path: p, type: e.type, sha: e.sha })), truncated: false }),
    getBlob: (sha) => git(dir, ["cat-file", "blob", sha]).stdout,
  };
}
function ghApi(endpoint) {
  const env = Object.assign({}, process.env);
  for (const k of ["GH_REPO", "GH_HOST", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]) delete env[k];
  const r = spawnSync("gh", ["api", endpoint, "--hostname", "github.com"], { env, encoding: "utf8", maxBuffer: 1 << 28, windowsHide: true });
  if (r.error) cannot(`gh failed to start: ${r.error.message}`);
  if (r.status !== 0) cannot(`gh api ${endpoint.split("?")[0]} failed: ${String(r.stderr || "").trim().split(/\r?\n/)[0]}`);
  try { return JSON.parse(r.stdout); } catch (_) { return cannot(`gh api ${endpoint.split("?")[0]} returned unparseable JSON`); }
}
function makeGhFetcher(repo) {
  return {
    resolveRef(ref) {
      const j = ghApi(`repos/${repo}/commits/${encodeURIComponent(ref)}`);
      if (!j || typeof j.sha !== "string" || !HEX40.test(j.sha)) cannot("published ref did not resolve to a commit sha");
      return j.sha;
    },
    getTree(sha) {
      const j = ghApi(`repos/${repo}/git/trees/${sha}?recursive=1`);
      if (!j || !Array.isArray(j.tree)) cannot("published tree response is malformed");
      return { entries: j.tree.map((e) => ({ path: e.path, type: e.type, sha: e.sha })), truncated: j.truncated === true };
    },
    getBlob(sha) {
      const j = ghApi(`repos/${repo}/git/blobs/${sha}`);
      if (!j || j.encoding !== "base64" || typeof j.content !== "string") cannot("published blob response is malformed");
      return Buffer.from(j.content, "base64");
    },
  };
}

function parseConfig(buf, what) {
  let c;
  try { c = JSON.parse(decodeStrict(buf, what).replace(/^\uFEFF/, "")); } catch (_) { return cannot(`${what}: not valid JSON`); }
  if (!c || typeof c !== "object" || c.schema !== SCHEMA) cannot(`${what}: schema must be ${SCHEMA}`);
  if (!Array.isArray(c.exceptions)) cannot(`${what}: exceptions must be an array`);
  const str = (v) => typeof v === "string" && v.length > 0;
  c.exceptions.forEach((x, i) => {
    const bad = (m) => cannot(`${what}: exception #${i} ${m}`);
    if (!x || typeof x !== "object" || Array.isArray(x)) bad("is not an object");
    if (!str(x.path)) bad("needs a path");
    if (!str(x.published_blob)) bad("needs a published_blob");
    if (x.kind !== "line" && x.kind !== "file-removed" && x.kind !== "file-changed") bad("kind must be line, file-removed or file-changed");
    if (x.kind === "file-changed" && !(str(x.emitted_blob) && HEX40.test(x.emitted_blob))) bad("of kind file-changed needs a 40-hex emitted_blob");
    if (!str(x.reason) || !x.reason.trim()) bad("needs a reason");
    if (x.kind === "line" && !str(x.line)) bad("of kind line needs a line");
  });
  if (c.published !== undefined) {
    if (!c.published || !str(c.published.repo) || !str(c.published.ref)) cannot(`${what}: published needs repo and ref`);
    const parts = c.published.repo.split("/");
    if (parts.length !== 2 || !parts.every((q) => /^[A-Za-z0-9_.-]+$/.test(q) && q !== "." && q !== "..")) cannot(`${what}: published.repo must be owner/name`);
    const ref = c.published.ref;
    if (!/^[A-Za-z0-9._/-]+$/.test(ref) || /^[-.]/.test(ref) || ref.includes("..")) cannot(`${what}: published.ref has an invalid form`);
  }
  return c;
}
function assertCanonicalPublished(config) {
  const p = config && config.published;
  if (!p || p.repo !== PUBLISHED_REPO || p.ref !== PUBLISHED_REF) {
    cannot("published.repo/ref is not the canonical published target; a committed config cannot redirect the comparison");
  }
}
function readConfigAt(repo, sha, what) {
  const e = lsPaths(repo, sha, [CONFIG_REL]).get(CONFIG_REL);
  if (!e || e.type !== "blob") cannot(`${what}: ${CONFIG_REL} is absent at the config ref`);
  return parseConfig(git(repo, ["cat-file", "blob", e.sha]).stdout, CONFIG_REL);
}

function decodeStrict(buf, what) {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf); } catch (_) { return cannot(`${what || "content"} is not valid UTF-8`); }
}
function normLines(buf, what) {
  let t = Buffer.isBuffer(buf) ? decodeStrict(buf, what) : String(buf);
  t = t.replace(/^\uFEFF/, "");
  const out = [];
  for (const raw of t.split("\n")) {
    const l = raw.replace(/\s+$/, "");
    if (l.length) out.push(l);
  }
  return out;
}

function emittedFromSource(source, ref, wfKey, gen) {
  let surface;
  try { surface = gen.emitSurface(source, ref, { wfKey: wfKey === "gh" ? gen.GH_WORKFLOW : gen.CI_WORKFLOW }); }
  catch (e) { return cannot(`cannot model the emit: ${e && e.message ? e.message : e}`); }
  const blobs = new Map();
  const lines = new Map();
  for (const [p, bytes] of surface) {
    blobs.set(p, blobId(bytes));
    if (LINE_FILES.includes(p)) lines.set(p, normLines(bytes, `emitted ${p}`));
  }
  return { blobs, lines };
}
function emittedFromRepo(dir) {
  const head = resolveCommit(dir, "HEAD");
  const headTree = treeOf(dir, head);
  const tree = gitTree(dir, head);
  const blobs = new Map();
  const lines = new Map();
  for (const [p, e] of tree) {
    if (p.startsWith("docs/") || LINE_FILES.includes(p)) blobs.set(p, e.sha);
  }
  for (const p of LINE_FILES) {
    const e = tree.get(p);
    if (e) lines.set(p, normLines(git(dir, ["cat-file", "blob", e.sha]).stdout, `emitted ${p}`));
  }
  return { blobs, lines, head, headTree };
}

function compare(opts) {
  const config = opts.config;
  const fetcher = opts.fetcher;
  const pubCommit = fetcher.resolveRef(opts.publishedRef);
  if (typeof pubCommit !== "string" || !pubCommit) cannot("published ref did not resolve");
  const listing = fetcher.getTree(pubCommit);
  if (!listing || listing.truncated === true) cannot("published tree listing is truncated or unreadable");
  const pubTree = new Map();
  for (const e of listing.entries) {
    if (!e || typeof e.path !== "string" || !e.path || !["blob", "tree", "commit"].includes(e.type) || typeof e.sha !== "string" || !HEX40.test(e.sha)) {
      cannot("published tree has an invalid entry");
    }
    pubTree.set(e.path, e);
  }

  const readPub = (rel) => {
    const e = pubTree.get(rel);
    if (!e || e.type !== "blob") cannot(`published ${rel} is absent at ${pubCommit}`);
    const bytes = fetcher.getBlob(e.sha);
    if (!Buffer.isBuffer(bytes)) cannot(`published ${rel} could not be read`);
    if (blobId(bytes) !== e.sha) cannot(`published ${rel} content does not match its blob id (empty or undecodable fetch)`);
    if (bytes.length === 0 || normLines(bytes, `published ${rel}`).length === 0) cannot(`published ${rel} is empty`);
    return { bytes, blob: e.sha };
  };
  const pubLines = new Map();
  const pubBlob = new Map();
  for (const rel of LINE_FILES) {
    const r = readPub(rel);
    pubLines.set(rel, normLines(r.bytes, `published ${rel}`));
    pubBlob.set(rel, r.blob);
  }

  let emitted;
  if (opts.mode === "emit") emitted = emittedFromRepo(opts.emit);
  else emitted = emittedFromSource(opts.source, opts.ref, pubTree.has(GH_WORKFLOW) ? "gh" : "ci", opts.generator);

  for (const [p, b] of emitted.blobs) if (typeof b !== "string" || !HEX40.test(b)) cannot(`emitted blob id for ${p} is invalid`);

  const live = [];
  const stale = [];
  for (const x of config.exceptions) {
    const cur = pubTree.get(x.path);
    if (cur && cur.sha === x.published_blob) live.push({ x, used: false });
    else stale.push({ path: x.path, kind: x.kind, line: x.line, published_blob: x.published_blob, reason: "published blob differs or path absent" });
  }
  const excuse = (match) => {
    const hit = live.find((c) => !c.used && match(c.x));
    if (hit) { hit.used = true; return true; }
    return false;
  };

  const removals = [];
  const changed = [];
  for (const rel of LINE_FILES) {
    const have = new Map();
    for (const l of emitted.lines.get(rel) || []) have.set(l, (have.get(l) || 0) + 1);
    for (const l of pubLines.get(rel)) {
      const n = have.get(l) || 0;
      if (n > 0) { have.set(l, n - 1); continue; }
      if (excuse((x) => x.kind === "line" && x.path === rel && x.line === l)) continue;
      removals.push({ path: rel, kind: "line", line: l });
    }
  }
  const docs = [...pubTree].filter(([p, e]) => p.startsWith("docs/") && e.type !== "tree").map(([p, e]) => [p, e.sha]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [p, sha] of docs) {
    const got = emitted.blobs.get(p);
    if (got === sha) continue;
    if (got === undefined) {
      if (excuse((x) => x.kind === "file-removed" && x.path === p)) continue;
      removals.push({ path: p, kind: "file", blob: sha });
    } else {
      if (excuse((x) => x.kind === "file-changed" && x.path === p && x.emitted_blob === got)) continue;
      changed.push({ path: p, kind: "file", published_blob: sha, emitted_blob: got });
    }
  }
  for (const c of live) if (!c.used) stale.push({ path: c.x.path, kind: c.x.kind, line: c.x.line, published_blob: c.x.published_blob, reason: "excuses nothing" });
  return {
    ok: removals.length === 0 && changed.length === 0, skipped: false,
    published_commit: pubCommit, emit_commit: emitted.head || null, emit_tree: emitted.headTree || null,
    source_commit: opts.mode === "source" ? opts.ref : null,
    removals, changed, stale_exceptions: stale,
  };
}

function parseArgs(argv) {
  const valued = new Set(["source", "ref", "emit", "config-repo", "config-ref", "published-dir", "published-ref"]);
  const o = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { o.json = true; continue; }
    if (!a.startsWith("--") || !valued.has(a.slice(2))) cannot(`unknown argument: ${a}`);
    if (i + 1 >= argv.length) cannot(`${a} needs a value`);
    o[a.slice(2)] = argv[++i];
  }
  if (!!o.source === !!o.emit) cannot("exactly one of --source or --emit is required");
  if (o.emit && o.ref !== undefined) cannot("--ref has no effect with --emit");
  if (o.source && (o["config-repo"] !== undefined || o["config-ref"] !== undefined)) cannot("--config-repo and --config-ref have no effect with --source");
  if (!!o["published-dir"] !== !!o["published-ref"]) cannot("--published-dir and --published-ref go together");
  return o;
}

const REQUIRE_RE = /require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
function verifyGeneratorMatchesRef(source, sourceSha) {
  const root = path.join(__dirname, "..", "..");
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch (e) { return cannot(`checkout root cannot be resolved: ${e.message}`); }
  const guard = (abs, rel) => {
    let st;
    try { st = fs.lstatSync(abs); } catch (e) { return cannot(`generator module ${rel} cannot be read: ${e.message}`); }
    if (st.isSymbolicLink()) cannot(`generator module is a symlink: ${rel}`);
    let real;
    try { real = fs.realpathSync(abs); } catch (e) { return cannot(`generator module ${rel} cannot be resolved: ${e.message}`); }
    const want = path.join(realRoot, ...rel.split("/"));
    const norm = (q) => (process.platform === "win32" ? q.toLowerCase() : q);
    if (norm(path.normalize(real)) !== norm(path.normalize(want))) cannot(`generator module resolves outside its lexical path: ${rel}`);
  };
  const seen = new Set();
  const queue = [path.join(root, ...GENERATOR_REL.split("/"))];
  while (queue.length) {
    const abs = path.resolve(queue.shift());
    if (seen.has(abs)) continue;
    seen.add(abs);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith("..") || path.isAbsolute(rel)) cannot(`the generator requires a module outside this checkout: ${abs}`);
    guard(abs, rel);
    let bytes;
    try { bytes = fs.readFileSync(abs); } catch (e) { return cannot(`generator module ${rel} cannot be read: ${e.message}`); }
    const e = lsPaths(source, sourceSha, [rel]).get(rel);
    if (!e || e.type !== "blob" || e.sha !== blobId(bytes)) cannot(`the generator in this checkout differs from the ref (${rel})`);
    const text = bytes.toString("utf8");
    let m;
    REQUIRE_RE.lastIndex = 0;
    while ((m = REQUIRE_RE.exec(text))) {
      const base = path.resolve(path.dirname(abs), m[1]);
      const hit = [base, base + ".js", path.join(base, "index.js")].find((c) => { try { return fs.lstatSync(c).isFile() || fs.lstatSync(c).isSymbolicLink(); } catch (_) { return false; } });
      if (hit) queue.push(hit);
    }
  }
}

function loadGenerator(source, sourceSha) {
  verifyGeneratorMatchesRef(source, sourceSha);
  const file = path.join(__dirname, "..", "public-repo", "generate.js");
  try { return require(file); } catch (e) { return cannot(`generator cannot be loaded: ${e && e.message}`); }
}

function run(argv, deps = {}) {
  const a = parseArgs(argv);
  let config;
  let sourceSha = null;
  if (a.source) {
    const source = path.resolve(a.source);
    requireToplevel(source, "--source");
    sourceSha = resolveCommit(source, a.ref || "HEAD");
    const present = lsPaths(source, sourceSha, [GENERATOR_REL, CONFIG_REL]);
    const gen = present.has(GENERATOR_REL);
    const cfg = present.has(CONFIG_REL);
    if (!gen && !cfg) return { ok: true, skipped: true, published_commit: null, emit_commit: null, emit_tree: null, source_commit: sourceSha, removals: [], changed: [], stale_exceptions: [] };
    if (gen !== cfg) cannot(gen ? `generator present but ${CONFIG_REL} absent at the source ref` : `${CONFIG_REL} present but the generator is absent at the source ref`);
    config = readConfigAt(source, sourceSha, "source");
  } else {
    requireToplevel(path.resolve(a.emit), "--emit");
    const cfgRepo = path.resolve(a["config-repo"] || path.join(__dirname, "..", ".."));
    requireToplevel(cfgRepo, "--config-repo");
    config = readConfigAt(cfgRepo, resolveCommit(cfgRepo, a["config-ref"] || "HEAD"), "config");
  }
  let fetcher;
  let publishedRef;
  if (deps.fetcherFor) ({ fetcher, publishedRef } = deps.fetcherFor(config, a));
  else if (a["published-dir"]) {
    const pdir = path.resolve(a["published-dir"]);
    requireToplevel(pdir, "--published-dir");
    fetcher = makeGitFetcher(pdir);
    publishedRef = a["published-ref"];
  } else {
    if (!config.published) cannot("config has no published repo/ref");
    assertCanonicalPublished(config);
    fetcher = makeGhFetcher(config.published.repo);
    publishedRef = config.published.ref;
  }
  const generator = a.source ? (deps.generator || loadGenerator(path.resolve(a.source), sourceSha)) : null;
  return compare({
    mode: a.source ? "source" : "emit", source: a.source && path.resolve(a.source), ref: sourceSha,
    emit: a.emit && path.resolve(a.emit), config, fetcher, publishedRef, generator,
  });
}

function interpretResult(status, signal, stdout) {
  let j = null;
  try { j = JSON.parse(String(stdout)); } catch (_) { j = null; }
  const isObj = j && typeof j === "object" && !Array.isArray(j);
  const payload = { stale_exceptions: isObj && Array.isArray(j.stale_exceptions) ? j.stale_exceptions : [] };
  const out = (state, reason) => ({ state, reason, payload });
  if (signal) return out("cannot-run", `killed by signal ${signal}`);
  if (!isObj) return out("cannot-run", "stdout is not a JSON object");
  const arr = (v) => (Array.isArray(v) ? v : null);
  if (status === 0) {
    if (j.ok !== true) return out("cannot-run", "exit 0 without ok:true");
    if (j.skipped === true) return out("skipped", "no generator at the source ref");
    if (j.skipped !== false) return out("cannot-run", "skipped flag is not boolean");
    if (typeof j.published_commit !== "string" || !HEX40.test(j.published_commit)) return out("cannot-run", "no 40-hex published_commit");
    const r = arr(j.removals);
    const c = arr(j.changed);
    if (!r || !c) return out("cannot-run", "removals or changed is not an array");
    if (r.length || c.length) return out("cannot-run", "exit 0 with removals or changes");
    return out("green", "nothing published would be dropped");
  }
  if (status === 1) {
    const r = arr(j.removals);
    const c = arr(j.changed);
    if (j.ok === false && r && c && (r.length || c.length)) return out("drift", `${r.length} removal(s), ${c.length} change(s)`);
    return out("cannot-run", "exit 1 without removals or changes");
  }
  return out("cannot-run", `exit ${status}`);
}

function main(argv, deps) {
  let res;
  let code;
  try {
    res = run(argv, deps);
    code = res.skipped || res.ok ? 0 : 1;
  } catch (e) {
    code = 2;
    res = { ok: false, skipped: false, published_commit: null, emit_commit: null, emit_tree: null, source_commit: null, removals: [], changed: [], stale_exceptions: [], error: String(e && e.message ? e.message : e) };
  }
  const json = argv.includes("--json");
  if (json) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  else if (res.skipped) process.stdout.write(SKIP_MESSAGE + "\n");
  else {
    if (res.error) process.stdout.write(`emit-drift-vs-published: COULD NOT RUN: ${res.error}\n`);
    else {
      process.stdout.write(`emit-drift-vs-published: published ${res.published_commit}\n`);
      for (const r of res.removals) process.stdout.write(r.kind === "line" ? `  REMOVED ${r.path}: ${r.line}\n` : `  REMOVED ${r.path} (blob ${r.blob})\n`);
      for (const c of res.changed) process.stdout.write(`  CHANGED ${c.path} (published ${c.published_blob}, emitted ${c.emitted_blob})\n`);
      process.stdout.write(code === 0 ? "  ok: nothing published would be dropped\n" : "  FAIL: the next emit would drop or change published content\n");
    }
  }
  for (const s of res.stale_exceptions || []) process.stderr.write(`warning: stale exception for ${s.path} (${s.reason})\n`);
  return code;
}

module.exports = {
  assertCanonicalPublished, compare, run, main, parseConfig, normLines, blobId, makeGitFetcher, makeGhFetcher, interpretResult, CannotRun, SKIP_MESSAGE, CONFIG_REL };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
