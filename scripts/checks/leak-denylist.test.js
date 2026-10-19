"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(__dirname, "leak-denylist.js");
const DENYLIST = path.join(__dirname, "leak-denylist.json");
const { sha256, normalizePhrase, makeEntries, loadDenylist, scanText, validateEntry } = require("./leak-denylist");

const FIXTURE = ["fandango", "quota", "giraffe", "purple"].reverse().join(" ");

function tmp(content, name = "planted.md") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "denylist-test-"));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content);
  return f;
}
function run(args, extraEnv = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "denylist-proj-"));
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, ...extraEnv };
  if (!("MC_LEAK_DENYLIST" in extraEnv)) delete env.MC_LEAK_DENYLIST;
  if (!("MC_REQUIRE_PRIVATE_DENYLIST" in extraEnv)) delete env.MC_REQUIRE_PRIVATE_DENYLIST;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", env });
  return { code: r.status, out: r.stdout + r.stderr };
}
function projWithLocal(text) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "denylist-local-"));
  const d = path.join(proj, ".claude", "project", "memory");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "leak-denylist.local.json"), text);
  return proj;
}
const PRIV_PHRASE = ["umber", "heron", "mosaic", "quartz"].join(" ");
const privEntries = () => makeEntries(PRIV_PHRASE, "private-unit");

test("normalisation: lowercase, punctuation stripped, whitespace collapsed", () => {
  const a = normalizePhrase("  Orange, WALRUS!!  ledger\ttango. ");
  assert.strictEqual(a.text, "orange walrus ledger tango");
  assert.strictEqual(a.k, 4);
  assert.strictEqual(a.chars, "orange walrus ledger tango".length);
});

test("the shipped denylist is well-formed, non-empty, hash-only, and carries the fixture", () => {
  const dl = loadDenylist(DENYLIST);
  assert.ok(!dl.error, dl.error);
  assert.ok(dl.entries.length >= 1, "expected at least the fixture entry");
  for (const e of dl.entries) {
    assert.ok(validateEntry(e));
    assert.strictEqual(e.label, "fixture-red-proof", "the SHIPPED denylist may carry only fixture entries");
  }
  const raw = fs.readFileSync(DENYLIST, "utf8");
  assert.ok(!raw.toLowerCase().includes(FIXTURE), "fixture phrase must not be stored in plaintext");
  assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(raw), "no email-shaped plaintext in the denylist");
  const expected = sha256(normalizePhrase(FIXTURE).text);
  assert.ok(dl.byHash.has(expected), "fixture hash must be present");
});

test("RED proof: a planted file with the fixture phrase exits 1 and never echoes the text", () => {
  const f = tmp(`intro line\nsome text ${FIXTURE.toUpperCase()}, trailing words\n`);
  const r = run(["--files", f]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /planted\.md:2/);
  assert.match(r.out, /fixture-red-proof/);
  assert.ok(!r.out.toLowerCase().includes(FIXTURE), "matched text must never be printed");
});

test("RED proof: the phrase is caught across a line break and through punctuation", () => {
  const f = tmp(`Purple\ngiraffe -- "quota" (fandango)!\n`);
  const r = run(["--files", f]);
  assert.strictEqual(r.code, 1, r.out);
});

test("known-answer: the same words in a different order are NOT a hit", () => {
  const f = tmp(`fandango quota giraffe purple\n`);
  assert.strictEqual(run(["--files", f]).code, 0);
});

test("token entries: a single raw token (email-shaped) is matched by its raw lowercased form", () => {
  const token = ["fixture", "person"].join(".") + "@" + "fixture-domain.example";
  const entries = makeEntries(token, "t");
  assert.ok(entries.some((e) => e.kind === "token" && e.words === 1));
  const dl = { byHash: new Map(entries.map((e) => [e.sha256, e])), shapes: new Map(entries.map((e) => [`${e.kind}:${e.words}:${e.chars}`, true])), ks: [4] };
  const hits = scanText(`mail <${token.toUpperCase()}> here\n`, dl);
  assert.ok(hits.length >= 1, "token must be found inside angle brackets, case-insensitively");
  assert.strictEqual(scanText("nothing relevant here\n", dl).length, 0);
});

test("fail-closed: an empty or malformed denylist exits 2", () => {
  const empty = tmp(JSON.stringify({ entries: [] }), "d.json");
  assert.strictEqual(run(["--files", empty, "--denylist", empty]).code, 2);
  const bad = tmp("{nope", "d.json");
  assert.strictEqual(run(["--files", bad, "--denylist", bad]).code, 2);
  const badEntry = tmp(JSON.stringify({ entries: [{ kind: "phrase", words: 1, chars: 1, sha256: "zz" }] }), "d.json");
  assert.strictEqual(run(["--files", badEntry, "--denylist", badEntry]).code, 2);
});

test("--add appends hashed entries to a scratch denylist and prints no plaintext", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "denylist-add-"));
  const dl = path.join(dir, "d.json");
  const phrase = ["orange", "walrus", "ledger", "tango"].join(" ");
  const r = run(["--add", phrase, "--label", "unit", "--denylist", dl]);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(!r.out.includes("walrus"), "the added phrase must not be echoed");
  const j = JSON.parse(fs.readFileSync(dl, "utf8"));
  assert.strictEqual(j.entries.length, 1);
  assert.strictEqual(j.entries[0].sha256, sha256(phrase));
  const f = tmp(`x ${phrase} y\n`);
  assert.strictEqual(run(["--files", f, "--denylist", dl]).code, 1);
});

test("private local file: its entries are loaded and catch a planted file; text never echoed", () => {
  const proj = projWithLocal(JSON.stringify({ entries: privEntries() }));
  const f = tmp(`hello ${PRIV_PHRASE} bye\n`);
  const r = run(["--files", f], { CLAUDE_PROJECT_DIR: proj });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /private-unit/);
  assert.ok(!r.out.includes("heron"), "matched text must never be printed");
  assert.strictEqual(run(["--files", f]).code, 0);
});

test("env MC_LEAK_DENYLIST: entries are loaded (array or {entries}) and catch a planted file", () => {
  const f = tmp(`hello ${PRIV_PHRASE} bye\n`);
  assert.strictEqual(run(["--files", f], { MC_LEAK_DENYLIST: JSON.stringify(privEntries()) }).code, 1);
  assert.strictEqual(run(["--files", f], { MC_LEAK_DENYLIST: JSON.stringify({ entries: privEntries() }) }).code, 1);
});

test("fail-closed: a malformed local file or env exits 2 with a fixed message and no input echo", () => {
  const f = tmp("clean text\n");
  const marker = "zorblat-quenneville-marker";
  const proj = projWithLocal(`{ "entries": [ ${marker} `);
  const a = run(["--files", f], { CLAUDE_PROJECT_DIR: proj });
  assert.strictEqual(a.code, 2, a.out);
  assert.ok(!a.out.includes(marker), "local file content must not be echoed");
  const b = run(["--files", f], { MC_LEAK_DENYLIST: `not json ${marker}` });
  assert.strictEqual(b.code, 2, b.out);
  assert.ok(!b.out.includes(marker), "env content must not be echoed");
  const c = run(["--files", f], { MC_LEAK_DENYLIST: JSON.stringify([{ kind: "phrase", words: 1, chars: 1, sha256: "zz", label: marker }]) });
  assert.strictEqual(c.code, 2, c.out);
  assert.ok(!c.out.includes(marker));
  assert.match(b.out, /private denylist .* malformed/);
});

test("the instance-local denylist path is gitignored", () => {
  const r = spawnSync("git", ["-C", ROOT, "check-ignore", "-q", ".claude/project/memory/leak-denylist.local.json"]);
  assert.strictEqual(r.status, 0);
});

test("live tree: the tracked repository has no hits (exit 0)", () => {
  const r = run(["--root", ROOT]);
  assert.strictEqual(r.code, 0, r.out.split("\n").slice(0, 20).join("\n"));
});

test("require-private: MC_REQUIRE_PRIVATE_DENYLIST=1 + no private source exits 2 with the fixed message", () => {
  const f = tmp("clean text\n");
  const r = run(["--files", f], { MC_REQUIRE_PRIVATE_DENYLIST: "1" });
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /0 private entries loaded/);
  assert.match(r.out, /MC_LEAK_DENYLIST/);
});

test("require-private: required + private env present gives the normal result (0 clean, 1 on a hit)", () => {
  const env = { MC_REQUIRE_PRIVATE_DENYLIST: "1", MC_LEAK_DENYLIST: JSON.stringify(privEntries()) };
  assert.strictEqual(run(["--files", tmp("clean text\n")], env).code, 0);
  assert.strictEqual(run(["--files", tmp(`x ${PRIV_PHRASE} y\n`)], env).code, 1);
});

test("require-private: required + private local file present gives the normal result", () => {
  const proj = projWithLocal(JSON.stringify(privEntries()));
  const f = tmp("clean text\n");
  const r = spawnSync(process.execPath, [SCRIPT, "--files", f], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: proj, MC_REQUIRE_PRIVATE_DENYLIST: "1", MC_LEAK_DENYLIST: "" },
  });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test("not required + no private source: normal result (public default), count line reads 0", () => {
  const r = run(["--files", tmp("clean text\n")]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /private entries loaded: 0/);
});

test("count line: reports the number of private entries, never their content", () => {
  const entries = privEntries();
  const r = run(["--files", tmp("clean text\n")], { MC_LEAK_DENYLIST: JSON.stringify(entries) });
  assert.match(r.out, new RegExp("private entries loaded: " + entries.length + "$", "m"));
  assert.ok(!r.out.includes(PRIV_PHRASE));
});

test("CI=true alone never triggers require-private", () => {
  assert.strictEqual(run(["--files", tmp("clean text\n")], { CI: "true" }).code, 0);
});

function gitRepoWithLocal(text, commit) {
  const proj = projWithLocal(text);
  const g = (...a) => spawnSync("git", ["-C", proj, ...a], { encoding: "utf8" });
  g("init", "-q");
  if (commit) {
    g("add", "-f", ".");
    g("-c", "user.email=a@example.invalid", "-c", "user.name=alice", "commit", "-q", "-m", "x");
  }
  return proj;
}
function runIn(proj, extra = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, MC_REQUIRE_PRIVATE_DENYLIST: "1", ...extra };
  if (!("MC_LEAK_DENYLIST" in extra)) delete env.MC_LEAK_DENYLIST;
  const r = spawnSync(process.execPath, [SCRIPT, "--root", proj, "--files", tmp("clean text\n")], { cwd: ROOT, encoding: "utf8", env });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("required mode refuses a TRACKED local private file; untracked is accepted", () => {
  const text = JSON.stringify(privEntries());
  const tracked = runIn(gitRepoWithLocal(text, true));
  assert.strictEqual(tracked.code, 2, tracked.out);
  assert.match(tracked.out, /tracked by git/);
  const untracked = runIn(gitRepoWithLocal(text, false));
  assert.strictEqual(untracked.code, 0, untracked.out);
});

test("required mode refuses fixture-only private entries; a mix with a real one passes", () => {
  const fixtureOnly = JSON.stringify(makeEntries(PRIV_PHRASE, "fixture-red-proof"));
  const a = runIn(projWithLocal(fixtureOnly));
  assert.strictEqual(a.code, 2, a.out);
  const mix = JSON.stringify([...makeEntries(PRIV_PHRASE, "fixture-red-proof"), ...privEntries()]);
  assert.strictEqual(runIn(projWithLocal(mix)).code, 0);
  const bad = JSON.stringify([...privEntries(), { kind: "phrase", words: 0, chars: 1, sha256: "x" }]);
  assert.strictEqual(runIn(projWithLocal(bad)).code, 2);
});

test("a symlinked local file is refused (skipped where symlinks are not permitted)", (t) => {
  const proj = projWithLocal("[]");
  const local = path.join(proj, ".claude", "project", "memory", "leak-denylist.local.json");
  const target = path.join(proj, "target.json");
  fs.writeFileSync(target, JSON.stringify(privEntries()));
  fs.unlinkSync(local);
  try {
    fs.symlinkSync(target, local);
  } catch {
    return t.skip("symlink creation not permitted");
  }
  const r = runIn(proj);
  assert.strictEqual(r.code, 2, r.out);
});

test("no parser disclosure — unreadable/invalid --denylist and --add report a fixed message", () => {
  const marker = "zorblat-quenneville-marker";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "denylist-bad-"));
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, `{ "entries": [ ${marker} `);
  const a = run(["--files", tmp("x\n"), "--denylist", bad]);
  assert.strictEqual(a.code, 2, a.out);
  assert.ok(!a.out.includes(marker) && !/position|Unexpected|token/i.test(a.out), a.out);
  const b = run(["--add", "some phrase", "--denylist", bad]);
  assert.strictEqual(b.code, 2, b.out);
  assert.ok(!b.out.includes(marker) && !/position|Unexpected|token/i.test(b.out), b.out);
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "denylist-dir-"));
  fs.mkdirSync(path.join(proj, ".claude", "project", "memory", "leak-denylist.local.json"), { recursive: true });
  const c = runIn(proj);
  assert.strictEqual(c.code, 2, c.out);
});

test("legacy env name is honoured through the read-both helper", () => {
  const { privateSources } = require("./leak-denylist");
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "denylist-legacy-"));
  const legacy = ["WARP", "OS_LEAK_DENYLIST"].join("");
  const r = privateSources(empty, { [legacy]: JSON.stringify(privEntries()) });
  assert.strictEqual(r.extras.length, 1);
});
