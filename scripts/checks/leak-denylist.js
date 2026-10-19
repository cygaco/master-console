#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync, spawnSync } = require("child_process");
const mcEnv = require("../hooks/lib/mc-env");

const DEFAULT_DENYLIST = path.join(__dirname, "leak-denylist.json");
const MAX_BYTES = 8 * 1024 * 1024;
const BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|eot|pdf|zip|gz|tgz|tar|7z|mp[34]|wav|mov|exe|dll|node|wasm)$/i;

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function normalizePhrase(s) {
  const text = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const words = text ? text.split(" ") : [];
  return { text, words, k: words.length, chars: text.length };
}

const TOKEN_SPLIT = /[\s<>()[\]{}"'`,;|]+/;
function normalizeToken(s) {
  return String(s)
    .toLowerCase()
    .replace(/^[.:!?*_~\-]+|[.:!?*_~\-]+$/g, "");
}

function makeEntries(phrase, label) {
  const out = [];
  const p = normalizePhrase(phrase);
  if (p.k > 0) {
    out.push({ kind: "phrase", words: p.k, chars: p.chars, sha256: sha256(p.text), label });
  }
  const raw = String(phrase).trim();
  if (raw && !/\s/.test(raw)) {
    const t = normalizeToken(raw);
    if (t) out.push({ kind: "token", words: 1, chars: t.length, sha256: sha256(t), label });
  }
  return out;
}

const HEX64 = /^[0-9a-f]{64}$/;

function validateEntry(e) {
  return (
    e &&
    (e.kind === "phrase" || e.kind === "token") &&
    Number.isInteger(e.words) &&
    e.words >= 1 &&
    Number.isInteger(e.chars) &&
    e.chars >= 1 &&
    typeof e.sha256 === "string" &&
    HEX64.test(e.sha256)
  );
}

const LOCAL_REL = path.join(".claude", "project", "memory", "leak-denylist.local.json");
const FIXTURE_LABEL = "fixture-red-proof";
const PRIVATE_BAD = "private denylist (local file or MC_LEAK_DENYLIST) malformed";

function parsePrivate(text) {
  let j;
  try {
    j = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch {
    return { error: PRIVATE_BAD };
  }
  const list = Array.isArray(j) ? j : j && Array.isArray(j.entries) ? j.entries : null;
  if (!list) return { error: PRIVATE_BAD };
  for (const e of list) if (!validateEntry(e)) return { error: PRIVATE_BAD };
  return { entries: list };
}

function loadDenylist(file = DEFAULT_DENYLIST, extras = []) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { error: `denylist unreadable or not valid JSON: ${file}` };
  }
  if (!j || !Array.isArray(j.entries)) return { error: `denylist malformed: ${file} (no entries[])` };
  const all = j.entries.slice();
  const shippedCount = all.length;
  for (const x of extras) {
    const p = parsePrivate(x.text);
    if (p.error) return { error: p.error };
    all.push(...p.entries);
  }
  const byHash = new Map();
  const shapes = new Map();
  const ks = new Set();
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (!validateEntry(e)) return { error: `denylist entry ${i} malformed (needs kind/words/chars/sha256)` };
    byHash.set(e.sha256, e);
    shapes.set(`${e.kind}:${e.words}:${e.chars}`, true);
    if (e.kind === "phrase") ks.add(e.words);
  }
  return { entries: all, shippedCount, byHash, shapes, ks: Array.from(ks).sort((a, b) => a - b), raw: j };
}

const PRIVATE_TRACKED = "private denylist local file is tracked by git or a symlink — required mode takes private entries only from an untracked, gitignored file or the env";
function isTracked(root, rel) {
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", rel], { cwd: root, stdio: "ignore" });
  return r.status === 0;
}
function privateSources(root, env = process.env, required = false) {
  const extras = [];
  const local = path.join(root, LOCAL_REL);
  let st = null;
  try {
    st = fs.lstatSync(local);
  } catch (e) {
    if (!e || e.code !== "ENOENT") return { error: PRIVATE_BAD };
  }
  if (st) {
    if (st.isSymbolicLink() || !st.isFile()) return { error: PRIVATE_BAD };
    if (required && isTracked(root, LOCAL_REL)) return { error: PRIVATE_TRACKED };
    try {
      extras.push({ text: fs.readFileSync(local, "utf8") });
    } catch {
      return { error: PRIVATE_BAD };
    }
  }
  const envText = mcEnv.readEnv("LEAK_DENYLIST", env);
  if (typeof envText === "string" && envText.trim()) extras.push({ text: envText });
  return { extras };
}

function scanText(text, dl) {
  const hits = [];
  const lines = text.split("\n");
  const toks = [];
  const tokLine = [];
  for (let ln = 0; ln < lines.length; ln++) {
    const n = normalizePhrase(lines[ln]);
    for (const w of n.words) {
      toks.push(w);
      tokLine.push(ln + 1);
    }
    for (const rt of lines[ln].toLowerCase().split(TOKEN_SPLIT)) {
      const t = normalizeToken(rt);
      if (!t) continue;
      if (!dl.shapes.has(`token:1:${t.length}`)) continue;
      const e = dl.byHash.get(sha256(t));
      if (e && e.kind === "token") hits.push({ line: ln + 1, label: e.label || "(unlabelled)" });
    }
  }
  const n = toks.length;
  const pre = new Array(n + 1);
  pre[0] = 0;
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + toks[i].length;
  for (const k of dl.ks) {
    if (k > n) continue;
    for (let i = 0; i + k <= n; i++) {
      const chars = pre[i + k] - pre[i] + (k - 1);
      if (!dl.shapes.has(`phrase:${k}:${chars}`)) continue;
      const e = dl.byHash.get(sha256(toks.slice(i, i + k).join(" ")));
      if (e && e.kind === "phrase") hits.push({ line: tokLine[i], label: e.label || "(unlabelled)" });
    }
  }
  return hits;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function trackedFiles(root) {
  try {
    return execSync("git ls-files", { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function scanFiles(files, root, dl) {
  const hits = [];
  const skipped = [];
  let scanned = 0;
  for (const rel of files) {
    if (BINARY_EXT.test(rel)) continue;
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_BYTES) {
      skipped.push(rel);
      continue;
    }
    const buf = fs.readFileSync(abs);
    if (looksBinary(buf)) continue;
    scanned++;
    for (const h of scanText(buf.toString("utf8"), dl)) hits.push({ file: rel, line: h.line, label: h.label });
  }
  return { hits, scanned, skipped };
}

function parseArgs(argv) {
  const o = { files: null, root: null, json: false, add: null, label: null, allowEmpty: false, denylist: DEFAULT_DENYLIST, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--files") o.files = String(argv[++i] || "").split(",").filter(Boolean);
    else if (a === "--root") o.root = argv[++i];
    else if (a === "--json") o.json = true;
    else if (a === "--add") o.add = argv[++i];
    else if (a === "--label") o.label = argv[++i];
    else if (a === "--allow-empty") o.allowEmpty = true;
    else if (a === "--denylist") o.denylist = argv[++i];
    else if (a === "--help" || a === "-h") o.help = true;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    process.stdout.write(
      "usage: leak-denylist.js [--files a,b] [--root dir] [--json] [--denylist file] [--allow-empty]\n       leak-denylist.js --add \"<phrase>\" [--label <l>]\n",
    );
    return 0;
  }

  if (o.add !== null) {
    if (!o.add || !String(o.add).trim()) {
      process.stderr.write("--add needs a non-empty phrase\n");
      return 2;
    }
    let j = { _comment: "", entries: [] };
    if (fs.existsSync(o.denylist)) {
      try {
        j = JSON.parse(fs.readFileSync(o.denylist, "utf8"));
      } catch {
        process.stderr.write("denylist unreadable or not valid JSON\n");
        return 2;
      }
      if (!Array.isArray(j.entries)) j.entries = [];
    }
    const label = o.label || `manual-${new Date().toISOString().slice(0, 10)}`;
    const fresh = makeEntries(o.add, label).filter((e) => !j.entries.some((x) => x.sha256 === e.sha256));
    j.entries.push(...fresh);
    fs.writeFileSync(o.denylist, JSON.stringify(j, null, 2) + "\n");
    for (const e of fresh) process.stdout.write(`added ${e.kind} words=${e.words} chars=${e.chars} sha256=${e.sha256} label=${label}\n`);
    if (!fresh.length) process.stdout.write("no new entries (already present)\n");
    return 0;
  }

  const root = path.resolve(o.root || process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", ".."));
  const required = mcEnv.readEnv("REQUIRE_PRIVATE_DENYLIST") === "1";
  const ps = privateSources(root, process.env, required);
  if (ps.error) {
    process.stderr.write(`FAIL [leak-denylist] ${ps.error}\n`);
    return 2;
  }
  const dl = loadDenylist(o.denylist, ps.extras);
  if (dl.error) {
    process.stderr.write(`FAIL [leak-denylist] ${dl.error}\n`);
    return 2;
  }
  const privateCount = dl.entries.length - dl.shippedCount;
  process.stderr.write(`[leak-denylist] private entries loaded: ${privateCount}\n`);
  const realPrivate = dl.entries.slice(dl.shippedCount).filter((e) => e.label !== FIXTURE_LABEL).length;
  if (required && realPrivate === 0) {
    process.stderr.write(
      "FAIL [leak-denylist] MC_REQUIRE_PRIVATE_DENYLIST=1 but 0 private entries loaded (non-fixture required) — provide MC_LEAK_DENYLIST (env, JSON text) or .claude/project/memory/leak-denylist.local.json\n",
    );
    return 2;
  }
  if (dl.entries.length === 0 && !o.allowEmpty) {
    process.stderr.write("FAIL [leak-denylist] denylist has 0 entries — a vacuous gate never reads green (pass --allow-empty to override)\n");
    return 2;
  }

  let files = o.files;
  if (!files) {
    files = trackedFiles(root);
    if (files === null) {
      process.stderr.write("FAIL [leak-denylist] git ls-files failed — refusing to read green on an unreadable tree\n");
      return 2;
    }
  }
  const r = scanFiles(files, root, dl);
  const ok = r.hits.length === 0;
  if (o.json) {
    process.stdout.write(JSON.stringify({ ok, entries: dl.entries.length, private_entries: privateCount, scanned: r.scanned, skipped_large: r.skipped, hits: r.hits }, null, 2) + "\n");
  } else if (ok) {
    process.stdout.write(`OK   [leak-denylist] scanned ${r.scanned} file(s) against ${dl.entries.length} hashed entries, 0 hits${r.skipped.length ? ` (${r.skipped.length} skipped > ${MAX_BYTES} bytes)` : ""}\n`);
  } else {
    process.stderr.write(`FAIL [leak-denylist] ${r.hits.length} hit(s) against ${dl.entries.length} hashed entries (matched text is never printed):\n`);
    for (const h of r.hits.slice(0, 50)) process.stderr.write(`  - ${h.file}:${h.line}  [${h.label}]\n`);
    if (r.hits.length > 50) process.stderr.write(`  ... and ${r.hits.length - 50} more\n`);
    process.stderr.write("\nFix: remove or rewrite the flagged line(s); the phrase must not appear in any tracked file.\n");
  }
  return ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { sha256, normalizePhrase, normalizeToken, makeEntries, loadDenylist, scanText, scanFiles, validateEntry, privateSources, LOCAL_REL, DEFAULT_DENYLIST };
