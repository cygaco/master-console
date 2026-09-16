"use strict";
/**
 * history-proof-message-surface.test.js — S-OS-06 r4, lane D.
 *
 * The S-OS-03 "0 hits in history" proof (assert-evidence.js step 4) was `git log --all -S<literal> -i`:
 * a pickaxe over DIFFS, blind to commit messages and identities. A purged literal survived in a commit
 * message of an ancestor of public main under that green proof. These fixtures are FALSIFIERS of the old
 * behaviour, not restatements of the new one: each plants a literal where no blob carries it and first
 * asserts the diff-only pickaxe passes the fixture, then asserts the widened sweep goes RED on the exact
 * surface, then GREEN on the same repository once that surface is clean.
 *
 * The last test drives the real consumer, assert-evidence.js, on a fixture carrying the real anchor
 * (fetched from the enclosing repository) and asserts its EXIT CODE gates on the sweep: 0 → 1 → 0 → 2.
 *
 *   node --test tests/regression/S-OS-06/history-proof-message-surface.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const ASSERT_EVIDENCE = path.join(ROOT, "scripts", "open-source", "assert-evidence.js");
const HS = require(path.join(ROOT, "scripts", "open-source", "history-surface.js"));

// Fixture-only planted literals (not credentials). They match no real rule.
const PLANTED = "planted.history.literal@fixture.invalid";
const PLANTED_NAME = "Plantedname Fixtureliteral";
const ID = { name: "Fixture Person", email: "person@fixture.invalid" };
const SURFACE_KEYS = HS.SURFACES.map(([k]) => k);
const LOCATOR_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY", "GIT_NAMESPACE", "GIT_NO_REPLACE_OBJECTS"];

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of LOCATOR_ENV) if (!(k in extra)) delete env[k];
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function g(repo, args, { input, env } = {}) {
  const r = spawnSync("git", ["-C", repo, "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], {
    input, encoding: "utf8", env: cleanEnv(env), windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
  return r.stdout.trim();
}

function mkBare(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "histproof-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "fx.git");
  const r = spawnSync("git", ["init", "--bare", "-q", repo], { encoding: "utf8", env: cleanEnv() });
  assert.strictEqual(r.status, 0, r.stderr);
  g(repo, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return { dir, repo };
}

const blob = (repo, content) => g(repo, ["hash-object", "-w", "--stdin"], { input: content });
function tree(repo, files) {
  const input = Object.entries(files).map(([n, c]) => `100644 blob ${blob(repo, c)}\t${n}`).join("\n") + "\n";
  return g(repo, ["mktree"], { input });
}
function commit(repo, { tree: t, parents = [], message, author = ID, committer = ID, date = "1700000000 +0000" }) {
  return g(repo, ["commit-tree", t, ...parents.flatMap((p) => ["-p", p])], {
    input: message,
    env: {
      GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: committer.name, GIT_COMMITTER_EMAIL: committer.email, GIT_COMMITTER_DATE: date,
    },
  });
}

/** A → B → C on refs/heads/main. B carries whatever the case plants; A and C never do. Same blobs every time. */
function buildChain(repo, { message = "second commit\n", author = ID, committer = ID } = {}) {
  const A = commit(repo, { tree: tree(repo, { "a.txt": "alpha\n" }), message: "root commit\n" });
  const B = commit(repo, { tree: tree(repo, { "a.txt": "alpha\n", "b.txt": "beta\n" }), parents: [A], message, author, committer, date: "1700000100 +0000" });
  const C = commit(repo, { tree: tree(repo, { "a.txt": "alpha\n", "b.txt": "beta\n", "c.txt": "gamma\n" }), parents: [B], message: "third commit\n", date: "1700000200 +0000" });
  g(repo, ["update-ref", "refs/heads/main", C]);
  return { A, B, C };
}

/** The S-OS-03 method, verbatim. */
const oldPickaxe = (repo, lit) => g(repo, ["log", "--all", "--format=%h", `-S${lit}`, "-i"]);

/** Does ANY blob in the object store carry the literal (case-insensitive)? */
function anyBlobCarries(repo, lit) {
  const blobs = g(repo, ["cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)"])
    .split("\n").filter((l) => l.endsWith(" blob")).map((l) => l.split(" ")[0]);
  return blobs.some((o) => g(repo, ["cat-file", "blob", o]).toLowerCase().includes(lit.toLowerCase()));
}

function assertOnly(result, surface, ids) {
  assert.strictEqual(result.clean, false, `expected RED on ${surface}`);
  for (const k of SURFACE_KEYS) {
    if (k === surface) assert.deepStrictEqual([...result.hits[k]].sort(), [...ids].sort(), `${k} hits`);
    else assert.deepStrictEqual(result.hits[k], [], `${k} must be 0 when only ${surface} is planted`);
  }
}

function sweepOk(repo, literals) {
  const s = HS.sweepHistory(repo, literals);
  assert.strictEqual(s.refused, null, `unexpected refusal: ${s.refused}`);
  return s;
}

// ── D2: the planted-message falsifier ────────────────────────────────────────

test("D2: a literal in a commit MESSAGE only — the old pickaxe passes it, the widened sweep is RED, then GREEN on the same repo once the message is clean", (t) => {
  const { repo } = mkBare(t);
  const planted = buildChain(repo, { message: `second commit\n\nauthenticated through ${PLANTED} (planted)\n` });

  assert.strictEqual(anyBlobCarries(repo, PLANTED), false, "the literal must be in no blob — message-only placement");
  assert.strictEqual(oldPickaxe(repo, PLANTED), "", "the diff-only pickaxe must PASS this fixture, or it falsifies nothing");

  const red = sweepOk(repo, [PLANTED]);
  assertOnly(red.results[0], "commit.message", [planted.B]);
  assert.strictEqual(red.population.objects.commit, 3);

  // Same repository, same blobs, message rewritten clean. The planted commit is still in the object store —
  // unreachable, which the declared population excludes.
  const cleaned = buildChain(repo, { message: "second commit\n\nauthenticated through the operator account\n" });
  assert.notStrictEqual(cleaned.B, planted.B);
  g(repo, ["cat-file", "-e", planted.B]);
  const green = sweepOk(repo, [PLANTED]);
  assert.strictEqual(green.results[0].clean, true, JSON.stringify(green.results[0].hits));
  assert.strictEqual(green.population.objects.commit, 3);
});

test("D2: the matcher is the pickaxe's -i — an upper-cased planted message is still RED", (t) => {
  const { repo } = mkBare(t);
  const planted = buildChain(repo, { message: `subject\n\n${PLANTED.toUpperCase()}\n` });
  assert.strictEqual(oldPickaxe(repo, PLANTED), "");
  assertOnly(sweepOk(repo, [PLANTED]).results[0], "commit.message", [planted.B]);
});

// ── identity-field mirrors ───────────────────────────────────────────────────

const IDENTITY_MIRRORS = [
  { surface: "commit.author.name", literal: PLANTED_NAME, plant: { author: { name: PLANTED_NAME, email: ID.email } } },
  { surface: "commit.author.email", literal: PLANTED, plant: { author: { name: ID.name, email: PLANTED } } },
  { surface: "commit.committer.name", literal: PLANTED_NAME, plant: { committer: { name: PLANTED_NAME, email: ID.email } } },
  { surface: "commit.committer.email", literal: PLANTED, plant: { committer: { name: ID.name, email: PLANTED } } },
  // A literal spanning `name <email>` exists only on the raw ident line; it is still counted (under the name surface).
  { surface: "commit.author.name", literal: `${PLANTED_NAME} <${PLANTED}>`, plant: { author: { name: PLANTED_NAME, email: PLANTED } } },
];

for (const m of IDENTITY_MIRRORS) {
  test(`mirror: literal planted only in ${m.surface} (literal length ${m.literal.length}) — old pickaxe passes, sweep RED on that surface alone, GREEN once clean`, (t) => {
    const { repo } = mkBare(t);
    const planted = buildChain(repo, m.plant);
    assert.strictEqual(anyBlobCarries(repo, m.literal), false);
    assert.strictEqual(oldPickaxe(repo, m.literal), "", "the diff-only pickaxe must pass an identity-only plant");
    assertOnly(sweepOk(repo, [m.literal]).results[0], m.surface, [planted.B]);
    buildChain(repo, {});
    assert.strictEqual(sweepOk(repo, [m.literal]).results[0].clean, true);
  });
}

test("mirror: annotated tag message and tagger email — RED on each surface, GREEN once the tag is re-cut clean", (t) => {
  const { repo } = mkBare(t);
  const { C } = buildChain(repo, {});
  const mktag = (tagger, message) => g(repo, ["mktag"], {
    input: `object ${C}\ntype commit\ntag v-fixture\ntagger ${tagger.name} <${tagger.email}> 1700000300 +0000\n\n${message}`,
  });
  const msgTag = mktag(ID, `release notes mention ${PLANTED}\n`);
  g(repo, ["update-ref", "refs/tags/v-fixture", msgTag]);
  assert.strictEqual(oldPickaxe(repo, PLANTED), "");
  assertOnly(sweepOk(repo, [PLANTED]).results[0], "tag.message", [msgTag]);

  const taggerTag = mktag({ name: ID.name, email: PLANTED }, "clean notes\n");
  g(repo, ["update-ref", "refs/tags/v-fixture", taggerTag]);
  assertOnly(sweepOk(repo, [PLANTED]).results[0], "tag.tagger.email", [taggerTag]);

  g(repo, ["update-ref", "refs/tags/v-fixture", mktag(ID, "clean notes\n")]);
  const green = sweepOk(repo, [PLANTED]);
  assert.strictEqual(green.results[0].clean, true);
  assert.strictEqual(green.population.refs.byClass.tags, 1);
  assert.strictEqual(green.population.objects.tag, 1);
});

test("mirror: a replace ref cannot hide a planted message (the naive `log --all --format=%B` widening is blind to it)", (t) => {
  const { repo } = mkBare(t);
  const planted = buildChain(repo, { message: `second commit\n\n${PLANTED}\n` });
  const decoy = commit(repo, { tree: g(repo, ["rev-parse", `${planted.B}^{tree}`]), parents: [planted.A], message: "second commit\n", date: "1700000100 +0000" });
  g(repo, ["replace", planted.B, decoy]);
  assert.ok(!g(repo, ["log", "--all", "--format=%B"]).includes(PLANTED), "control: replace-aware log must NOT show the planted message");
  assertOnly(sweepOk(repo, [PLANTED]).results[0], "commit.message", [planted.B]);

  g(repo, ["replace", "-d", planted.B]);
  buildChain(repo, {});
  assert.strictEqual(sweepOk(repo, [PLANTED]).results[0].clean, true);
});

test("mirror: content introduced only by a merge commit — default pickaxe is blind, the sweep's diff surface is RED", (t) => {
  const { repo } = mkBare(t);
  const base = { "a.txt": "alpha\n" };
  const A = commit(repo, { tree: tree(repo, base), message: "root\n" });
  const X = commit(repo, { tree: tree(repo, { ...base, "x.txt": "x\n" }), parents: [A], message: "x\n", date: "1700000100 +0000" });
  const Y = commit(repo, { tree: tree(repo, { ...base, "y.txt": "y\n" }), parents: [A], message: "y\n", date: "1700000200 +0000" });
  const merge = (files) => commit(repo, { tree: tree(repo, { ...base, "x.txt": "x\n", "y.txt": "y\n", ...files }), parents: [X, Y], message: "merge\n", date: "1700000300 +0000" });
  const M = merge({ "evil.txt": `${PLANTED}\n` });
  g(repo, ["update-ref", "refs/heads/main", M]);
  assert.strictEqual(oldPickaxe(repo, PLANTED), "", "control: git log -S without -m skips merge diffs");
  assertOnly(sweepOk(repo, [PLANTED]).results[0], "diffs", [M]);

  g(repo, ["update-ref", "refs/heads/main", merge({})]);
  assert.strictEqual(sweepOk(repo, [PLANTED]).results[0].clean, true);
});

// ── D4: declared population + refusals ───────────────────────────────────────

test("D4: the population is declared — ref classes, ref-set digest, object counts by type, surfaces searched and NOT searched", (t) => {
  const { repo } = mkBare(t);
  buildChain(repo, {});
  g(repo, ["update-ref", "refs/notes/commits", g(repo, ["rev-parse", "refs/heads/main"])]);
  const s = sweepOk(repo, [PLANTED]);
  const p = s.population;
  assert.strictEqual(p.objects.commit, Number(g(repo, ["rev-list", "--all", "--count"])));
  assert.strictEqual(p.objects.total, g(repo, ["rev-list", "--objects", "--all"]).split("\n").length);
  assert.deepStrictEqual([p.refs.byClass.heads, p.refs.byClass.notes, p.refs.total, p.refs.head], [1, 1, 2, true]);
  const text = HS.formatPopulation(p).join("\n");
  assert.match(text, /refs\s+2 — heads 1 · tags 0 · remotes 0 · notes 1/);
  assert.match(text, /ref-set sha256 [0-9a-f]{16}/);
  assert.match(text, /commits 3 · tags 0 · trees 3 · blobs 3 · missing 0/);
  for (const [, label] of HS.SURFACES) assert.ok(text.includes(label), `searched surface declared: ${label}`);
  for (const gap of HS.NOT_SEARCHED) assert.ok(text.includes(gap), `NOT-searched surface declared: ${gap}`);
});

const REFUSALS = [
  {
    name: "a shallow clone (history truncated)",
    why: /shallow/,
    make(dir, repo) {
      const shallow = path.join(dir, "shallow.git");
      const r = spawnSync("git", ["clone", "-q", "--bare", "--depth", "1", pathToFileURL(repo).href, shallow], { encoding: "utf8", env: cleanEnv() });
      assert.strictEqual(r.status, 0, r.stderr);
      return shallow;
    },
  },
  {
    name: "a ref that peels to a blob",
    why: /do not peel to a commit/,
    make(dir, repo) {
      g(repo, ["update-ref", "refs/tags/blob-ref", blob(repo, "loose data\n")]);
      return repo;
    },
  },
  {
    name: "a missing reachable object",
    why: /missing/,
    make(dir, repo) {
      const oid = g(repo, ["rev-parse", "refs/heads/main:c.txt"]);
      fs.rmSync(path.join(repo, "objects", oid.slice(0, 2), oid.slice(2)));
      return repo;
    },
  },
  {
    name: "a grafts file",
    why: /grafts/,
    make(dir, repo) {
      fs.writeFileSync(path.join(repo, "info", "grafts"), "");
      return repo;
    },
  },
];

for (const c of REFUSALS) {
  test(`D4 refusal: ${c.name} — REFUSED with no tallies, never a clean zero over a subset`, (t) => {
    const { dir, repo } = mkBare(t);
    buildChain(repo, {});
    fs.mkdirSync(path.join(repo, "info"), { recursive: true });
    const target = c.make(dir, repo);
    const s = HS.sweepHistory(target, [PLANTED]);
    assert.match(String(s.refused), c.why);
    assert.deepStrictEqual(s.results, []);
  });
}

test("D4 refusal: zero literals or an empty literal is a vacuous sweep, never green", (t) => {
  const { repo } = mkBare(t);
  buildChain(repo, {});
  assert.match(String(HS.sweepHistory(repo, []).refused), /zero literals/);
  assert.match(String(HS.sweepHistory(repo, [""]).refused), /empty literal/);
});

// ── the real consumer ────────────────────────────────────────────────────────

test("consumer: assert-evidence.js gates its exit code on the widened sweep — anchor fixture 0 → planted message 1 → clean 0 → grafts 2", (t) => {
  const src = fs.readFileSync(ASSERT_EVIDENCE, "utf8");
  const tag = /const TAG = "([^"]+)";/.exec(src)[1];
  const tagTarget = /const TAG_TARGET = "([0-9a-f]{40})";/.exec(src)[1];
  const { dir, repo } = mkBare(t);
  const f = spawnSync("git", ["-C", repo, "fetch", "-q", "--no-tags", ROOT, `+refs/tags/${tag}:refs/tags/${tag}`], { encoding: "utf8", env: cleanEnv() });
  assert.strictEqual(f.status, 0, `this test needs the anchor tag from the enclosing repository (full clone with tags): ${f.stderr}`);

  const anchorTree = g(repo, ["rev-parse", `${tagTarget}^{tree}`]);
  const onAnchor = (message) => {
    const c = commit(repo, { tree: anchorTree, parents: [tagTarget], message, date: "1790000000 +0000" });
    g(repo, ["update-ref", "refs/heads/main", commit(repo, { tree: anchorTree, parents: [c], message: "fixture tip\n", date: "1790000100 +0000" })]);
    return c;
  };
  const rules = path.join(dir, "rules.txt");
  fs.writeFileSync(rules, `# fixture rules — never a real rule\n${PLANTED}==>[REDACTED]\n`);
  const run = (...extra) => spawnSync(process.execPath, [ASSERT_EVIDENCE, "--repo", repo, "--ref", "refs/heads/main", ...extra], { encoding: "utf8", env: cleanEnv() });

  onAnchor("fixture commit on the anchor\n");
  const noStrings = run();
  assert.strictEqual(noStrings.status, 0, noStrings.stdout + noStrings.stderr);
  assert.match(noStrings.stdout, /history sweep NOT RUN \(no --strings\) — this result makes no history-clean claim/);

  let r = run("--strings", rules);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /population \(GIT_NO_REPLACE_OBJECTS=1/);
  assert.match(r.stdout, /RESULT: OK — .*history sweep: 0 of 1 literal\(s\) with hits over \d+ refs · \d+ commits/);

  const planted = onAnchor(`fixture commit on the anchor\n\nplanted ${PLANTED}\n`);
  assert.strictEqual(oldPickaxe(repo, PLANTED), "", "the S-OS-03 method passes the planted fixture");
  r = run("--strings", rules);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`FAIL sha256 [0-9a-f]{16}… \\(len ${PLANTED.length}\\) — diffs 0 · msg 1 \\[${planted.slice(0, 8)}\\]`));
  assert.match(r.stdout, /RESULT: FAIL \(1 assertion\(s\)\) — history sweep: 1 of 1 literal\(s\) with hits/);
  assert.ok(!r.stdout.toLowerCase().includes(PLANTED), "the matched literal is never printed");

  onAnchor("fixture commit on the anchor\n");
  r = run("--strings", rules);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);

  fs.mkdirSync(path.join(repo, "info"), { recursive: true });
  fs.writeFileSync(path.join(repo, "info", "grafts"), "");
  r = run("--strings", rules);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /REFUSED history sweep — .*grafts/);
  assert.match(r.stdout, /RESULT: REFUSED — history sweep REFUSED — no history-clean claim is made/);
  assert.doesNotMatch(r.stdout, /RESULT: OK/);
});
