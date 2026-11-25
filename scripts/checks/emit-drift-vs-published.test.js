#!/usr/bin/env node
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ENFORCER = path.join(__dirname, "emit-drift-vs-published.js");
const GENERATOR = path.join(__dirname, "..", "public-repo", "generate.js");
const STRIP = path.join(__dirname, "..", "public-repo", "comment-strip.js");
const lib = require("./emit-drift-vs-published.js");
const CONFIG_REL = "scripts/public-repo/emit-drift.json";
const HAS_GEN = fs.existsSync(GENERATOR) && fs.existsSync(STRIP);
const NO_GEN = HAS_GEN ? false : "scripts/public-repo/generate.js is absent (shipped copy)";

const cleanup = [];
process.on("exit", () => { for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { } } });

const GENV = Object.assign({}, process.env, {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
});
for (const k of Object.keys(GENV)) if (/^GIT_(DIR|INDEX_FILE|WORK_TREE)$/.test(k)) delete GENV[k];
function git(dir, ...args) {
  const r = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-C", dir, ...args], { env: GENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function mkRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edvp-"));
  cleanup.push(dir);
  git(dir, "init", "-q");
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture");
  return { dir, sha: git(dir, "rev-parse", "HEAD"), blob: (p) => git(dir, "rev-parse", `HEAD:${p}`) };
}
const cfgJson = (exceptions, extra) => JSON.stringify(Object.assign({ schema: "mc/emit-drift/v1", published: { repo: "example/product", ref: "main" }, exceptions }, extra || {}));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const baseFiles = () => ({
  "README.md": "# Product\nline one\nline two\nfoobar\n",
  "ci/public-allowlist.txt": "# header\nalpha\nbeta\n",
  "docs/pic.png": PNG,
});
function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [ENFORCER, ...args], { encoding: "utf8", cwd: opts.cwd, env: GENV });
  let json = null;
  if (args.includes("--json")) { try { json = JSON.parse(r.stdout); } catch (_) { json = null; } }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}
function emitRun({ emit, published, cfg, extra = [] }) {
  const config = cfg || mkRepo({ [CONFIG_REL]: cfgJson([]) });
  return run(["--emit", emit.dir, "--config-repo", config.dir, "--config-ref", "HEAD", "--published-dir", published.dir, "--published-ref", "HEAD", "--json", ...extra]);
}
function inProc(argv, deps) {
  const w = process.stdout.write;
  process.stdout.write = () => true;
  try { return lib.main(argv, deps); } finally { process.stdout.write = w; }
}

test("F1 identical sides exit 0", () => {
  const f = baseFiles();
  const r = emitRun({ emit: mkRepo(f), published: mkRepo(f) });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.json.ok, true);
  assert.match(r.json.published_commit, /^[0-9a-f]{40}$/);
});

test("F2 a removed published README line is RED, then GREEN with an exact pinned exception", () => {
  const pub = mkRepo(baseFiles());
  const em = mkRepo(Object.assign(baseFiles(), { "README.md": "# Product\nline one\nfoobar\n" }));
  const red = emitRun({ emit: em, published: pub });
  assert.strictEqual(red.code, 1);
  assert.deepStrictEqual(red.json.removals, [{ path: "README.md", kind: "line", line: "line two" }]);
  const ex = [{ path: "README.md", kind: "line", line: "line two", published_blob: pub.blob("README.md"), reason: "intentional" }];
  const green = emitRun({ emit: em, published: pub, cfg: mkRepo({ [CONFIG_REL]: cfgJson(ex) }) });
  assert.strictEqual(green.code, 0);
});

test("F3 a removed allowlist line exits 1", () => {
  const pub = mkRepo(baseFiles());
  const em = mkRepo(Object.assign(baseFiles(), { "ci/public-allowlist.txt": "# header\nalpha\n" }));
  const r = emitRun({ emit: em, published: pub });
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.json.removals[0].path, "ci/public-allowlist.txt");
  assert.strictEqual(r.json.removals[0].line, "beta");
});

test("F4 a missing docs file and a changed docs file each exit 1", () => {
  const pub = mkRepo(baseFiles());
  const files = baseFiles();
  delete files["docs/pic.png"];
  const missing = emitRun({ emit: mkRepo(files), published: pub });
  assert.strictEqual(missing.code, 1);
  assert.strictEqual(missing.json.removals[0].path, "docs/pic.png");
  assert.strictEqual(missing.json.removals[0].kind, "file");
  const changed = emitRun({ emit: mkRepo(Object.assign(baseFiles(), { "docs/pic.png": Buffer.from([9, 9, 9]) })), published: pub });
  assert.strictEqual(changed.code, 1);
  assert.strictEqual(changed.json.changed[0].path, "docs/pic.png");
});

test("F5 an emit with no README at all exits 1 with every line removed, never 0 or skip", () => {
  const pub = mkRepo(baseFiles());
  const files = baseFiles();
  delete files["README.md"];
  const r = emitRun({ emit: mkRepo(files), published: pub });
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.json.skipped, false);
  assert.strictEqual(r.json.removals.filter((x) => x.path === "README.md").length, 4);
});

test("F6 an empty (0 byte) published README exits 2", () => {
  const f = baseFiles();
  const r = emitRun({ emit: mkRepo(f), published: mkRepo(Object.assign(baseFiles(), { "README.md": "" })) });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.json.ok, false);
});

test("F7 a missing published ref and a git failure each exit 2", () => {
  const f = baseFiles();
  const em = mkRepo(f);
  const pub = mkRepo(f);
  const cfg = mkRepo({ [CONFIG_REL]: cfgJson([]) });
  const noRef = run(["--emit", em.dir, "--config-repo", cfg.dir, "--published-dir", pub.dir, "--published-ref", "no-such-ref", "--json"]);
  assert.strictEqual(noRef.code, 2);
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), "edvp-nogit-"));
  cleanup.push(notRepo);
  const bad = run(["--emit", em.dir, "--config-repo", cfg.dir, "--published-dir", notRepo, "--published-ref", "HEAD", "--json"]);
  assert.strictEqual(bad.code, 2);
});

test("F8 an exception pinned to a different published blob is not applied and is listed stale", () => {
  const pub = mkRepo(baseFiles());
  const em = mkRepo(Object.assign(baseFiles(), { "README.md": "# Product\nline one\nfoobar\n" }));
  const ex = [{ path: "README.md", kind: "line", line: "line two", published_blob: "0".repeat(40), reason: "stale pin" }];
  const r = emitRun({ emit: em, published: pub, cfg: mkRepo({ [CONFIG_REL]: cfgJson(ex) }) });
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.json.stale_exceptions.length, 1);
  assert.strictEqual(r.json.stale_exceptions[0].path, "README.md");
});

test("F9 an exception line with a wildcard character does not excuse a different removed line", () => {
  const pub = mkRepo(baseFiles());
  const em = mkRepo(Object.assign(baseFiles(), { "README.md": "# Product\nline one\nline two\n" }));
  const ex = [{ path: "README.md", kind: "line", line: "foo*", published_blob: pub.blob("README.md"), reason: "literal only" }];
  const r = emitRun({ emit: em, published: pub, cfg: mkRepo({ [CONFIG_REL]: cfgJson(ex) }) });
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.json.removals[0].line, "foobar");
});

test("F10 a malformed exception exits 2 (missing or empty field, unknown kind, line missing for kind line)", () => {
  const f = baseFiles();
  const pub = mkRepo(f);
  const em = mkRepo(f);
  const good = { path: "README.md", kind: "line", line: "x", published_blob: "a".repeat(40), reason: "r" };
  const variants = [
    Object.assign({}, good, { published_blob: undefined }),
    Object.assign({}, good, { path: undefined }),
    Object.assign({}, good, { reason: "" }),
    Object.assign({}, good, { reason: undefined }),
    Object.assign({}, good, { kind: "glob" }),
    Object.assign({}, good, { line: undefined }),
    Object.assign({}, good, { published_blob: 7 }),
  ];
  for (const v of variants) {
    const r = emitRun({ emit: em, published: pub, cfg: mkRepo({ [CONFIG_REL]: cfgJson([v]) }) });
    assert.strictEqual(r.code, 2, JSON.stringify(v));
  }
});

test("F11a source mode with neither generator nor config at the ref is SKIP exit 0", () => {
  const src = mkRepo({ "README.md": "x\n" });
  const r = run(["--source", src.dir, "--ref", "HEAD"]);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /^SKIP: publisher source only \(no generator here\)/);
  const j = run(["--source", src.dir, "--json"]);
  assert.strictEqual(j.json.skipped, true);
});

test("F11b generator present but no config at the ref exits 2", () => {
  const src = mkRepo({ "scripts/public-repo/generate.js": "// stub\n" });
  assert.strictEqual(run(["--source", src.dir]).code, 2);
});

test("F11c generator absent but config present at the ref exits 2", () => {
  const src = mkRepo({ [CONFIG_REL]: cfgJson([]) });
  assert.strictEqual(run(["--source", src.dir]).code, 2);
});

test("F12 additions only (the emit is a superset) exit 0", () => {
  const pub = mkRepo(baseFiles());
  const em = mkRepo(Object.assign(baseFiles(), { "README.md": "# Product\nextra\nline one\nline two\nfoobar\nmore\n", "ci/public-allowlist.txt": "# header\nalpha\nbeta\ngamma\n", "docs/new.png": PNG }));
  assert.strictEqual(emitRun({ emit: em, published: pub }).code, 0);
});

test("F13 CRLF versus LF with the same content exits 0", () => {
  const pub = mkRepo(baseFiles());
  const em = mkRepo(Object.assign(baseFiles(), { "README.md": "# Product\r\nline one\r\nline two\r\nfoobar\r\n" }));
  assert.strictEqual(emitRun({ emit: em, published: pub }).code, 0);
});

test("F14 structural guard: only the enforcer, its test and docs name the config file", (t) => {
  const top = spawnSync("git", ["-C", __dirname, "rev-parse", "--show-toplevel"], { encoding: "utf8", env: GENV });
  if (top.status !== 0) return t.skip("not a git checkout: the structural scan cannot run here");
  const root = top.stdout.trim();
  const ls = spawnSync("git", ["-C", root, "grep", "-l", "-F", "-e", "emit-drift.json", "-e", "CONFIG_REL"], { encoding: "utf8", env: GENV, maxBuffer: 1 << 28 });
  assert.strictEqual(ls.status, 0, `git grep must succeed (status ${ls.status}): ${ls.stderr}`);
  const hits = ls.stdout.split(/\r?\n/).filter(Boolean);
  assert.ok(hits.includes("scripts/checks/emit-drift-vs-published.js"), "the scan must find the enforcer itself");
  const FIXTURE_WRITERS = ["scripts/checks/emit-drift-wire.test.js", "tests/public-repo/release-evidence.test.js", "tests/public-repo/cr4.test.js",
    "tests/public-repo/evidence-r1fix.test.js", "tests/public-repo/evidence-r2fix.test.js"];
  const DISPLAY_READERS = ["scripts/public-repo/release-evidence.js"];
  const allowed = (p) => p === "scripts/checks/emit-drift-vs-published.js" || p === "scripts/checks/emit-drift-vs-published.test.js" ||
    FIXTURE_WRITERS.includes(p) || DISPLAY_READERS.includes(p) || /\.md$/.test(p) || /(^|\/)(framework-manifest|framework-installed|MANIFEST)\.json$/.test(p);
  const extra = hits.filter((p) => !allowed(p));
  assert.deepStrictEqual(extra, [], `unexpected readers of the exceptions config: ${extra.join(", ")}`);
});

const ROOT = path.join(__dirname, "..", "..");
function realGeneratorFiles() {
  const out = {};
  const queue = [GENERATOR];
  while (queue.length) {
    const abs = path.resolve(queue.shift());
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (out[rel]) continue;
    const bytes = fs.readFileSync(abs);
    out[rel] = bytes;
    const re = /require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
    let m;
    while ((m = re.exec(bytes.toString("utf8")))) {
      const base = path.resolve(path.dirname(abs), m[1]);
      const hit = [base, base + ".js", path.join(base, "index.js")].find((c) => { try { return fs.statSync(c).isFile(); } catch (_) { return false; } });
      if (hit) queue.push(hit);
    }
  }
  return out;
}
function sourceFixture({ readme, allow, docs }) {
  const files = {
    ...(HAS_GEN ? realGeneratorFiles() : { "scripts/public-repo/generate.js": "// stub\n" }),
    "scripts/public-repo/comment-strip.js": fs.existsSync(STRIP) ? fs.readFileSync(STRIP) : "",
    "scripts/public-repo/policy.json": JSON.stringify({ schema: "mc/public-repo-policy/v1", exclude: [], seeds: {} }),
    "scripts/public-repo/allowlist.txt": "# header\n" + allow.join("\n") + "\n",
    [CONFIG_REL]: cfgJson([]),
    "README.md": readme,
  };
  for (const [p, c] of Object.entries(docs || {})) files[p] = c;
  return mkRepo(files);
}
const CI_KEYS = (wf) => ["ci/no-personal-content.js", "ci/public-allowlist.txt", "ci/seeds.json", "ci/narrative-allowlist.json", wf, "ci/GENERATED"];
const ciAllowText = (paths, wf) => "# Public allowlist: every path that may exist in this repository (exact, one per line).\n" + [...paths, ...CI_KEYS(wf)].sort().join("\n") + "\n";

test("F15 source mode: a published side equal to the would-emit view exits 0", { skip: NO_GEN }, () => {
  const allow = ["README.md", "docs/pic.png"];
  const src = sourceFixture({ readme: "# Product\nline one\n", allow, docs: { "docs/pic.png": PNG } });
  const pub = mkRepo({ "README.md": "# Product\nline one\n", "ci/public-allowlist.txt": ciAllowText(allow, "ci/workflows/no-personal-content.yml"), "docs/pic.png": PNG });
  const r = run(["--source", src.dir, "--ref", "HEAD", "--published-dir", pub.dir, "--published-ref", "HEAD", "--json"]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.json.ok, true);
  const dropped = run(["--source", src.dir, "--ref", "HEAD", "--published-dir", mkRepo({ "README.md": "# Product\nline one\nline gone\n", "ci/public-allowlist.txt": ciAllowText(allow, "ci/workflows/no-personal-content.yml"), "docs/pic.png": PNG }).dir, "--published-ref", "HEAD", "--json"]);
  assert.strictEqual(dropped.code, 1);
});

test("F16 source mode: an activated published side does not false-RED (wfKey derives from the published tree)", { skip: NO_GEN }, () => {
  const allow = ["README.md"];
  const src = sourceFixture({ readme: "# Product\nline one\n", allow });
  const activated = mkRepo({ "README.md": "# Product\nline one\n", "ci/public-allowlist.txt": ciAllowText(allow, ".github/workflows/no-personal-content.yml"), ".github/workflows/no-personal-content.yml": "name: x\n" });
  const r = run(["--source", src.dir, "--ref", "HEAD", "--published-dir", activated.dir, "--published-ref", "HEAD", "--json"]);
  assert.strictEqual(r.code, 0, r.out + r.err);
});

test("F16b source mode: emitSurface refuses a surface path that a later transform touches (exit 2)", { skip: NO_GEN }, () => {
  const src = sourceFixture({ readme: "# Product\n", allow: ["README.md", "scripts/tool.js"], docs: { "scripts/tool.js": "// c\nvar a = 1;\n" } });
  const gen = require(GENERATOR);
  assert.doesNotThrow(() => gen.emitSurface(src.dir, "HEAD", { wfKey: gen.CI_WORKFLOW }));
  const scoped = sourceFixture({ readme: "# Product\n", allow: ["README.md", "docs/helper.js"], docs: { "docs/helper.js": "// c\nvar a = 1;\n" } });
  assert.throws(() => gen.emitSurface(scoped.dir, "HEAD", { wfKey: gen.CI_WORKFLOW }), /cannot model docs\/helper\.js/);
  const pub = mkRepo(baseFiles());
  assert.strictEqual(run(["--source", scoped.dir, "--published-dir", pub.dir, "--published-ref", "HEAD"]).code, 2);
});

test("F17 an exception present only in the working tree does not excuse a removal", () => {
  const pub = mkRepo(baseFiles());
  const em = mkRepo(Object.assign(baseFiles(), { "README.md": "# Product\nline one\nfoobar\n" }));
  const cfg = mkRepo({ [CONFIG_REL]: cfgJson([]) });
  const ex = [{ path: "README.md", kind: "line", line: "line two", published_blob: pub.blob("README.md"), reason: "uncommitted" }];
  fs.writeFileSync(path.join(cfg.dir, CONFIG_REL), cfgJson(ex));
  const r = emitRun({ emit: em, published: pub, cfg });
  assert.strictEqual(r.code, 1);
});

function wrapFetcher(pubDir, over) {
  const base = lib.makeGitFetcher(pubDir);
  const calls = { resolveRef: [], getTree: [], getBlob: [] };
  const f = {
    calls,
    resolveRef: (r) => { calls.resolveRef.push(r); return base.resolveRef(r === "main" ? "HEAD" : r); },
    getTree: (s) => { calls.getTree.push(s); return base.getTree(s); },
    getBlob: (s) => { calls.getBlob.push(s); return base.getBlob(s); },
  };
  return Object.assign(f, over || {});
}
function apiRun(em, fetcher, cfgText) {
  const cfg = mkRepo({ [CONFIG_REL]: cfgText || cfgJson([]) });
  const out = [];
  const w = process.stdout.write;
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  let code;
  try {
    code = lib.main(["--emit", em.dir, "--config-repo", cfg.dir, "--json"], { fetcherFor: (config) => ({ fetcher, publishedRef: config.published.ref }) });
  } finally { process.stdout.write = w; }
  return { code, json: JSON.parse(out.join("")) };
}

test("F18 a truncated tree response exits 2", () => {
  const pub = mkRepo(baseFiles());
  const f = wrapFetcher(pub.dir, { getTree: (s) => Object.assign(lib.makeGitFetcher(pub.dir).getTree(s), { truncated: true }) });
  const r = apiRun(mkRepo(baseFiles()), f);
  assert.strictEqual(r.code, 2);
  assert.match(r.json.error, /truncated/);
});

test("F19 a removed nested docs file exits 1", () => {
  const nested = Object.assign(baseFiles(), { "docs/a/b.png": PNG });
  const pub = mkRepo(nested);
  const r = apiRun(mkRepo(baseFiles()), wrapFetcher(pub.dir));
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(r.json.removals.map((x) => x.path), ["docs/a/b.png"]);
});

test("F20 an empty or undecodable blob response for a non-empty blob exits 2", () => {
  const pub = mkRepo(baseFiles());
  for (const bytes of [Buffer.alloc(0), Buffer.from("not the bytes")]) {
    const r = apiRun(mkRepo(baseFiles()), wrapFetcher(pub.dir, { getBlob: () => bytes }));
    assert.strictEqual(r.code, 2);
    assert.match(r.json.error, /blob id/);
  }
});

test("F21 the fetch is keyed by the resolved commit sha, not the branch name", () => {
  const pub = mkRepo(baseFiles());
  const f = wrapFetcher(pub.dir);
  const r = apiRun(mkRepo(baseFiles()), f, cfgJson([], { published: { repo: "example/product", ref: "main" } }));
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(f.calls.resolveRef, ["main"]);
  assert.deepStrictEqual(f.calls.getTree, [pub.sha]);
  assert.ok(f.calls.getBlob.length >= 2);
  assert.strictEqual(r.json.published_commit, pub.sha);
});

test("F22 emit mode compares the emit repo HEAD commit; a working-tree-only line is ignored", () => {
  const pub = mkRepo(baseFiles());
  const em = mkRepo(Object.assign(baseFiles(), { "README.md": "# Product\nline one\nfoobar\n" }));
  fs.writeFileSync(path.join(em.dir, "README.md"), baseFiles()["README.md"]);
  const r = emitRun({ emit: em, published: pub });
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.json.removals[0].line, "line two");
});

test("F23 a BOM on the first published line does not false-RED", () => {
  const pub = mkRepo(Object.assign(baseFiles(), { "README.md": "\uFEFF# Product\nline one\nline two\nfoobar\n" }));
  assert.strictEqual(emitRun({ emit: mkRepo(baseFiles()), published: pub }).code, 0);
});

test("F24 a forced internal error exits 2, never 1", () => {
  const pub = mkRepo(baseFiles());
  const boom = wrapFetcher(pub.dir, { getTree: () => { throw new TypeError("forced"); } });
  const r = apiRun(mkRepo(baseFiles()), boom);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.json.ok, false);
  assert.match(r.json.error, /forced/);
  assert.deepStrictEqual(r.json.removals, []);
});

test("normalisation: trailing whitespace and whitespace-only lines are ignored", () => {
  assert.deepStrictEqual(lib.normLines("\uFEFFa \r\n \t\nb\t\n"), ["a", "b"]);
});

function corruptObject(dir, oid, how) {
  const p = path.join(dir, ".git", "objects", oid.slice(0, 2), oid.slice(2));
  fs.chmodSync(p, 0o666);
  if (how === "delete") fs.rmSync(p);
  else fs.writeFileSync(p, "not a git object");
}
function genSource() {
  return sourceFixture({ readme: "# Product\nline one\n", allow: ["README.md"] });
}

test("F25 the tree object at the source ref is missing: exit 2, never SKIP", { skip: NO_GEN }, () => {
  const src = genSource();
  corruptObject(src.dir, git(src.dir, "rev-parse", "HEAD^{tree}"), "delete");
  const r = run(["--source", src.dir, "--ref", "HEAD", "--json"]);
  assert.strictEqual(r.code, 2, r.out + r.err);
  assert.strictEqual(r.json.skipped, false);
});

test("F26 a degraded repo (a subtree missing, then a corrupt root tree) exits 2, never SKIP", { skip: NO_GEN }, () => {
  const src = genSource();
  corruptObject(src.dir, git(src.dir, "rev-parse", "HEAD:scripts"), "delete");
  const r = run(["--source", src.dir, "--ref", "HEAD", "--json"]);
  assert.strictEqual(r.code, 2, r.out + r.err);
  assert.strictEqual(r.json.skipped, false);
  const src2 = genSource();
  corruptObject(src2.dir, git(src2.dir, "rev-parse", "HEAD^{tree}"), "garbage");
  const r2 = run(["--source", src2.dir, "--ref", "HEAD", "--json"]);
  assert.strictEqual(r2.code, 2, r2.out + r2.err);
  assert.strictEqual(r2.json.skipped, false);
});

test("F27 a subdirectory of a repository is refused for --emit and --published-dir", () => {
  const f = baseFiles();
  const outer = mkRepo(Object.assign({ "sub/keep.txt": "x\n" }, f));
  const nested = path.join(outer.dir, "sub");
  const em = mkRepo(f);
  const pub = mkRepo(f);
  const cfg = mkRepo({ [CONFIG_REL]: cfgJson([]) });
  const asEmit = run(["--emit", nested, "--config-repo", cfg.dir, "--published-dir", pub.dir, "--published-ref", "HEAD", "--json"]);
  assert.strictEqual(asEmit.code, 2, asEmit.out);
  assert.match(asEmit.json.error, /top level/);
  const asPub = run(["--emit", em.dir, "--config-repo", cfg.dir, "--published-dir", nested, "--published-ref", "HEAD", "--json"]);
  assert.strictEqual(asPub.code, 2, asPub.out);
  const asCfg = run(["--emit", em.dir, "--config-repo", nested, "--published-dir", pub.dir, "--published-ref", "HEAD", "--json"]);
  assert.strictEqual(asCfg.code, 2, asCfg.out);
  const plain = fs.mkdtempSync(path.join(outer.dir, "plain-"));
  assert.strictEqual(run(["--emit", plain, "--config-repo", cfg.dir, "--published-dir", pub.dir, "--published-ref", "HEAD", "--json"]).code, 2);
});

test("F28 a refs/replace ref in the emit repo does not turn exit 1 into exit 0", () => {
  const pub = mkRepo(baseFiles());
  const em = mkRepo(Object.assign(baseFiles(), { "README.md": "# Product\nline one\nfoobar\n" }));
  const dropped = em.sha;
  fs.writeFileSync(path.join(em.dir, "README.md"), baseFiles()["README.md"]);
  git(em.dir, "commit", "-q", "-am", "restore");
  const restored = git(em.dir, "rev-parse", "HEAD");
  git(em.dir, "reset", "-q", "--hard", dropped);
  git(em.dir, "replace", dropped, restored);
  assert.strictEqual(git(em.dir, "rev-parse", "HEAD^{tree}"), git(em.dir, "rev-parse", `${restored}^{tree}`));
  const r = emitRun({ emit: em, published: pub });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.strictEqual(r.json.emit_commit, dropped);
  assert.match(r.json.emit_tree, /^[0-9a-f]{40}$/);
});

test("F29 a malformed published repo or ref in the config exits 2", () => {
  const f = baseFiles();
  const em = mkRepo(f);
  const pub = mkRepo(f);
  const pubs = [
    { repo: "a/b/c", ref: "main" }, { repo: "a", ref: "main" }, { repo: "../b", ref: "main" }, { repo: "a/..", ref: "main" },
    { repo: "a b/c", ref: "main" }, { repo: "a/b ", ref: "main" }, { repo: "a/b", ref: "-bad" }, { repo: "a/b", ref: "a..b" },
    { repo: "a/b", ref: ".hidden" }, { repo: "a/b", ref: "with space" }, { repo: "a/b", ref: "x?y=1" },
  ];
  for (const published of pubs) {
    const r = emitRun({ emit: em, published: pub, cfg: mkRepo({ [CONFIG_REL]: cfgJson([], { published }) }) });
    assert.strictEqual(r.code, 2, JSON.stringify(published));
  }
  assert.strictEqual(emitRun({ emit: em, published: pub, cfg: mkRepo({ [CONFIG_REL]: cfgJson([], { published: { repo: "own-er/na.me_1", ref: "release/v1.0" } }) }) }).code, 0);
});

test("F30 a published tree entry with no sha, no path or an unknown type exits 2", () => {
  const pub = mkRepo(baseFiles());
  const bad = [{ path: "docs/x.png", type: "blob" }, { path: "", type: "blob", sha: "a".repeat(40) }, { path: "docs/y.png", type: "weird", sha: "a".repeat(40) }, { path: "docs/z.png", type: "blob", sha: "xyz" }];
  for (const entry of bad) {
    const base = lib.makeGitFetcher(pub.dir);
    const f = wrapFetcher(pub.dir, { getTree: (s) => { const l = base.getTree(s); return { entries: l.entries.concat([entry]), truncated: false }; } });
    const r = apiRun(mkRepo(baseFiles()), f);
    assert.strictEqual(r.code, 2, JSON.stringify(entry));
    assert.match(r.json.error, /invalid entry/);
  }
});

test("F31 undecodable README bytes on either side exit 2", () => {
  const junk = Buffer.concat([Buffer.from("# Product\nline one\n"), Buffer.from([0xff, 0xfe, 0xc3, 0x28]), Buffer.from("\n")]);
  const f = baseFiles();
  const pubBad = emitRun({ emit: mkRepo(f), published: mkRepo(Object.assign(baseFiles(), { "README.md": junk })) });
  assert.strictEqual(pubBad.code, 2, pubBad.out);
  assert.match(pubBad.json.error, /UTF-8/);
  const emBad = emitRun({ emit: mkRepo(Object.assign(baseFiles(), { "README.md": junk })), published: mkRepo(f) });
  assert.strictEqual(emBad.code, 2, emBad.out);
});

test("F32 source mode refuses a generator whose bytes differ from the ref", { skip: NO_GEN }, () => {
  const src = genSource();
  const pub = mkRepo(baseFiles());
  fs.appendFileSync(path.join(src.dir, "scripts", "public-repo", "generate.js"), "\n// a different generator at the ref\n");
  git(src.dir, "commit", "-q", "-am", "diverge");
  const r = run(["--source", src.dir, "--ref", "HEAD", "--published-dir", pub.dir, "--published-ref", "HEAD", "--json"]);
  assert.strictEqual(r.code, 2, r.out + r.err);
  assert.match(r.json.error, /generator in this checkout differs from the ref/);
  const src2 = genSource();
  fs.appendFileSync(path.join(src2.dir, "scripts", "public-repo", "settings-seed.js"), "\n// differs\n");
  git(src2.dir, "commit", "-q", "-am", "diverge module");
  const r2 = run(["--source", src2.dir, "--ref", "HEAD", "--published-dir", pub.dir, "--published-ref", "HEAD", "--json"]);
  assert.strictEqual(r2.code, 2, r2.out + r2.err);
  assert.match(r2.json.error, /differs from the ref \(scripts\/public-repo\/settings-seed\.js\)/);
});

function docsFixture(emitBytes) {
  const pub = mkRepo(baseFiles());
  const files = baseFiles();
  if (emitBytes === null) delete files["docs/pic.png"]; else files["docs/pic.png"] = emitBytes;
  return { pub, em: mkRepo(files) };
}
const dEx = (kind, pub, extra) => Object.assign({ path: "docs/pic.png", kind, published_blob: pub.blob("docs/pic.png"), reason: "intentional" }, extra || {});

test("F33 a file-changed exception does not excuse a deletion; file-removed does; the old kind file is malformed", () => {
  const { pub, em } = docsFixture(null);
  const someBlob = "b".repeat(40);
  const cfgOf = (ex) => mkRepo({ [CONFIG_REL]: cfgJson(ex) });
  assert.strictEqual(emitRun({ emit: em, published: pub, cfg: cfgOf([dEx("file-changed", pub, { emitted_blob: someBlob })]) }).code, 1);
  assert.strictEqual(emitRun({ emit: em, published: pub, cfg: cfgOf([dEx("file-removed", pub)]) }).code, 0);
  assert.strictEqual(emitRun({ emit: em, published: pub, cfg: cfgOf([dEx("file", pub)]) }).code, 2);
});

test("F34 a file-changed exception excuses exactly one replacement blob and nothing else", () => {
  const repl = Buffer.from([9, 9, 9]);
  const { pub, em } = docsFixture(repl);
  const replBlob = em.blob("docs/pic.png");
  const cfgOf = (ex) => mkRepo({ [CONFIG_REL]: cfgJson(ex) });
  assert.strictEqual(emitRun({ emit: em, published: pub, cfg: cfgOf([dEx("file-changed", pub, { emitted_blob: replBlob })]) }).code, 0);
  assert.strictEqual(emitRun({ emit: em, published: pub, cfg: cfgOf([dEx("file-changed", pub, { emitted_blob: "c".repeat(40) })]) }).code, 1);
  assert.strictEqual(emitRun({ emit: em, published: pub, cfg: cfgOf([dEx("file-removed", pub)]) }).code, 1);
  assert.strictEqual(emitRun({ emit: em, published: pub, cfg: cfgOf([dEx("file-changed", pub)]) }).code, 2);
});

test("F35 interpretResult classifies every branch", () => {
  const sha = "a".repeat(40);
  const clean = { ok: true, skipped: false, published_commit: sha, removals: [], changed: [], stale_exceptions: [{ path: "x" }] };
  const J = (o) => JSON.stringify(o);
  const st = (status, signal, out) => lib.interpretResult(status, signal, out).state;
  assert.strictEqual(st(0, null, J(clean)), "green");
  assert.deepStrictEqual(lib.interpretResult(0, null, J(clean)).payload.stale_exceptions, [{ path: "x" }]);
  assert.strictEqual(st(0, null, J({ ok: true, skipped: true })), "skipped");
  const drift = Object.assign({}, clean, { ok: false, removals: [{ path: "README.md", kind: "line", line: "x" }] });
  assert.strictEqual(st(1, null, J(drift)), "drift");
  assert.strictEqual(st(1, null, J(Object.assign({}, drift, { removals: [], changed: [{ path: "docs/a" }] }))), "drift");
  const cannotRun = [
    [0, "SIGTERM", J(clean)], [0, null, "not json"], [0, null, "[]"], [0, null, "null"], [0, null, J(Object.assign({}, clean, { ok: false }))],
    [0, null, J(Object.assign({}, clean, { skipped: undefined }))], [0, null, J(Object.assign({}, clean, { published_commit: "short" }))],
    [0, null, J(Object.assign({}, clean, { published_commit: null }))], [0, null, J(Object.assign({}, clean, { removals: [{ path: "x" }] }))],
    [0, null, J(Object.assign({}, clean, { changed: [{ path: "x" }] }))], [0, null, J(Object.assign({}, clean, { removals: undefined }))],
    [1, null, J(clean)], [1, null, J(Object.assign({}, drift, { ok: true }))], [1, null, "garbage"], [2, null, J(clean)], [null, null, J(clean)], [3, null, J(drift)],
    [0, null, J({ ok: true, skipped: "yes" })],
  ];
  for (const [status, signal, out] of cannotRun) assert.strictEqual(st(status, signal, out), "cannot-run", `${status} ${signal} ${out}`);
  assert.deepStrictEqual(lib.interpretResult(2, null, "garbage").payload.stale_exceptions, []);
});

test("F36 a flag that does nothing in the chosen mode exits 2", () => {
  const f = baseFiles();
  const em = mkRepo(f);
  const pub = mkRepo(f);
  const cfg = mkRepo({ [CONFIG_REL]: cfgJson([]) });
  const base = ["--published-dir", pub.dir, "--published-ref", "HEAD", "--json"];
  assert.strictEqual(run(["--emit", em.dir, "--config-repo", cfg.dir, "--ref", "HEAD", ...base]).code, 2);
  assert.strictEqual(run(["--source", em.dir, "--config-repo", cfg.dir, ...base]).code, 2);
  assert.strictEqual(run(["--source", em.dir, "--config-ref", "HEAD", ...base]).code, 2);
});

test("F37 a live exception that excuses nothing is reported stale", () => {
  const pub = mkRepo(baseFiles());
  const ex = [{ path: "README.md", kind: "line", line: "line two", published_blob: pub.blob("README.md"), reason: "no longer needed" }];
  const r = emitRun({ emit: mkRepo(baseFiles()), published: pub, cfg: mkRepo({ [CONFIG_REL]: cfgJson(ex) }) });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.json.stale_exceptions.length, 1);
  assert.strictEqual(r.json.stale_exceptions[0].reason, "excuses nothing");
});

function enforcerCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edvp-co-"));
  cleanup.push(root);
  fs.mkdirSync(path.join(root, "scripts", "checks"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts", "public-repo"), { recursive: true });
  fs.copyFileSync(ENFORCER, path.join(root, "scripts", "checks", "emit-drift-vs-published.js"));
  const pr = path.join(__dirname, "..", "public-repo");
  for (const f of fs.readdirSync(pr)) {
    if (f.endsWith(".js") && !f.endsWith(".test.js")) fs.copyFileSync(path.join(pr, f), path.join(root, "scripts", "public-repo", f));
  }
  return root;
}
function runIn(root, args) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "checks", "emit-drift-vs-published.js"), ...args], { encoding: "utf8", env: GENV });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (_) { json = null; }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}
function trySymlink(target, link) {
  try { fs.symlinkSync(target, link, "file"); return true; } catch (_) { return false; }
}

test("F38 a generator or local require that is a symlink to identical bytes exits 2", { skip: NO_GEN }, (t) => {
  const pub = mkRepo(baseFiles());
  const src = genSource();
  const args = (root) => ["--source", src.dir, "--ref", "HEAD", "--published-dir", pub.dir, "--published-ref", "HEAD", "--json"];
  const ok = enforcerCheckout();
  const rOk = runIn(ok, args(ok));
  assert.ok(!/symlink|lexical path/.test(String(rOk.json && rOk.json.error)), rOk.out + rOk.err);
  for (const rel of ["generate.js", "settings-seed.js"]) {
    const root = enforcerCheckout();
    const file = path.join(root, "scripts", "public-repo", rel);
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edvp-ext-")), rel);
    cleanup.push(path.dirname(outside));
    fs.copyFileSync(file, outside);
    fs.rmSync(file);
    if (!trySymlink(outside, file)) {
      const dir = path.join(root, "scripts", "public-repo");
      const ext = fs.mkdtempSync(path.join(os.tmpdir(), "edvp-extdir-"));
      cleanup.push(ext);
      fs.cpSync(dir, ext, { recursive: true });
      fs.copyFileSync(outside, path.join(ext, rel));
      fs.rmSync(dir, { recursive: true, force: true });
      try { fs.symlinkSync(ext, dir, "junction"); } catch (_) { t.skip("neither symlinks nor junctions are permitted on this host"); return; }
    }
    const r = runIn(root, args(root));
    assert.strictEqual(r.code, 2, r.out + r.err);
    assert.match(r.json.error, /symlink|lexical path/);
  }
});

test("F39 assertCanonicalPublished pins the published repo and ref", () => {
  assert.doesNotThrow(() => lib.assertCanonicalPublished({ published: { repo: "cygaco/master-console", ref: "main" } }));
  assert.throws(() => lib.assertCanonicalPublished({ published: { repo: "attacker/evil", ref: "main" } }), lib.CannotRun);
  assert.throws(() => lib.assertCanonicalPublished({ published: { repo: "cygaco/master-console", ref: "old-tag" } }), lib.CannotRun);
  assert.throws(() => lib.assertCanonicalPublished({}), lib.CannotRun);
});

test("F40 a refs/replace ref in the source repo does not turn a source-mode exit 1 into exit 0", { skip: NO_GEN }, () => {
  const allow = ["README.md"];
  const src = sourceFixture({ readme: "# Product\nline one\n", allow });
  const ci = ciAllowText(allow, "ci/workflows/no-personal-content.yml");
  const pub = mkRepo({ "README.md": "# Product\nline one\nline gone\n", "ci/public-allowlist.txt": ci });
  const args = ["--source", src.dir, "--ref", "HEAD", "--published-dir", pub.dir, "--published-ref", "HEAD", "--json"];
  const before = run(args);
  assert.strictEqual(before.code, 1, before.out + before.err);
  const orig = git(src.dir, "rev-parse", "HEAD:README.md");
  const tmp = path.join(src.dir, ".swap");
  fs.writeFileSync(tmp, "# Product\nline one\nline gone\n");
  const fake = git(src.dir, "hash-object", "-w", ".swap");
  fs.rmSync(tmp);
  git(src.dir, "replace", orig, fake);
  assert.match(git(src.dir, "cat-file", "blob", "HEAD:README.md"), /line gone/, "the replacement must be live for plain git");
  const after = run(args);
  assert.strictEqual(after.code, 1, after.out + after.err);
  assert.deepStrictEqual(after.json.removals, before.json.removals);
});
