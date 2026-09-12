"use strict";
/**
 * leak-denylist.test.js — RED proof + known-answer + no-plaintext proof for
 * scripts/checks/leak-denylist.js (S-OS-04 / ED-417).
 *
 *   node --test scripts/checks/leak-denylist.test.js
 *
 * The fixture phrase is assembled at runtime in REVERSED word order so this source
 * file never contains the phrase as an adjacent token sequence (the gate scans this
 * file too).
 */
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

// The four fixture words, listed backwards and reversed at runtime — so this file never
// contains the fixture phrase as an adjacent token sequence.
const FIXTURE = ["fandango", "quota", "giraffe", "purple"].reverse().join(" ");

function tmp(content, name = "planted.md") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "denylist-test-"));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content);
  return f;
}
function run(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...extraEnv } });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("normalisation: lowercase, punctuation stripped, whitespace collapsed", () => {
  const a = normalizePhrase("  Orange, WALRUS!!  ledger\ttango. ");
  assert.strictEqual(a.text, "orange walrus ledger tango");
  assert.strictEqual(a.k, 4);
  assert.strictEqual(a.chars, "orange walrus ledger tango".length);
});

test("the shipped denylist is well-formed, non-empty, hash-only, and carries the fixture", () => {
  const dl = loadDenylist(DENYLIST);
  assert.ok(!dl.error, dl.error);
  assert.ok(dl.entries.length >= 2, "expected the fixture plus at least one seeded rule");
  for (const e of dl.entries) assert.ok(validateEntry(e));
  const raw = fs.readFileSync(DENYLIST, "utf8");
  // No plaintext: every non-hex string value must be a kind or a label; and the
  // fixture phrase itself must not appear.
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
  // Now the scratch list catches a planted file.
  const f = tmp(`x ${phrase} y\n`);
  assert.strictEqual(run(["--files", f, "--denylist", dl]).code, 1);
});

test("live tree: the tracked repository has no hits (exit 0)", () => {
  const r = run([]);
  assert.strictEqual(r.code, 0, r.out.split("\n").slice(0, 20).join("\n"));
});
