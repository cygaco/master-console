#!/usr/bin/env node
/**
 * scripts/checks/leak-denylist.js — operator-quote / scrubbed-string detector
 * (S-OS-04 / ED-417). Refuses any tracked text file that contains a phrase the
 * 2026-09-03 public-history rewrite removed — WITHOUT the tracked denylist ever
 * carrying those phrases in plaintext.
 *
 * Design:
 *   • scripts/checks/leak-denylist.json holds { words: k, chars: n, sha256, kind, label }
 *     entries. The hash is over the phrase NORMALISED (lowercase, punctuation
 *     stripped, whitespace collapsed) for kind=phrase, or over the raw lowercased
 *     token for kind=token (single tokens such as an email address).
 *   • The scanner tokenises every tracked text file the same way, slides a k-word
 *     window for every k in the list, and checks membership. `chars` (the
 *     normalised length) is a cheap pre-filter so only windows of a matching
 *     (k, length) shape are hashed — the list reveals only lengths, never words.
 *   • A hit prints file:line and the entry label. NEVER the matched text.
 *
 * Usage:
 *   node scripts/checks/leak-denylist.js                     scan every tracked file
 *   node scripts/checks/leak-denylist.js --files a,b         scan specific files
 *   node scripts/checks/leak-denylist.js --root <dir>        scan another git tree
 *   node scripts/checks/leak-denylist.js --json
 *   node scripts/checks/leak-denylist.js --add "<phrase>" [--label <l>]   append a hashed entry
 *
 * Exit codes:
 *   0  clean
 *   1  one or more hits
 *   2  fail-closed: denylist missing/malformed/EMPTY, git listing failed, bad usage
 *
 * Text-matching trap (ED-417 note): this file and its docs describe the banned
 * CLASSES, never the strings — nothing here can match its own list.
 *
 * Enforcer of its own contract: scripts/checks/leak-denylist.test.js (a planted
 * file carrying the innocuous fixture phrase must exit 1; the live tree exit 0;
 * the JSON must contain no plaintext).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const DEFAULT_DENYLIST = path.join(__dirname, "leak-denylist.json");
const MAX_BYTES = 8 * 1024 * 1024;
const BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|eot|pdf|zip|gz|tgz|tar|7z|mp[34]|wav|mov|exe|dll|node|wasm)$/i;

// ── Normalisation (the ONE definition both the seeder and the scanner use) ──

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

// Phrase: lowercase, every run of non-alphanumerics → one space, trim.
function normalizePhrase(s) {
  const text = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const words = text ? text.split(" ") : [];
  return { text, words, k: words.length, chars: text.length };
}

// Token: lowercase, surrounding quote/bracket/punctuation stripped, no inner change.
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

// ── Denylist ─────────────────────────────────────────────────────────

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

function loadDenylist(file = DEFAULT_DENYLIST) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { error: `denylist unreadable: ${file} (${e.message})` };
  }
  if (!j || !Array.isArray(j.entries)) return { error: `denylist malformed: ${file} (no entries[])` };
  const byHash = new Map();
  const shapes = new Map(); // `${kind}:${words}:${chars}` → true
  const ks = new Set();
  for (let i = 0; i < j.entries.length; i++) {
    const e = j.entries[i];
    if (!validateEntry(e)) return { error: `denylist entry ${i} malformed (needs kind/words/chars/sha256)` };
    byHash.set(e.sha256, e);
    shapes.set(`${e.kind}:${e.words}:${e.chars}`, true);
    if (e.kind === "phrase") ks.add(e.words);
  }
  return { entries: j.entries, byHash, shapes, ks: Array.from(ks).sort((a, b) => a - b), raw: j };
}

// ── Scanner ──────────────────────────────────────────────────────────

function scanText(text, dl) {
  const hits = [];
  const lines = text.split("\n");
  // Phrase stream across the WHOLE file (a phrase may wrap lines) with line numbers.
  const toks = [];
  const tokLine = [];
  for (let ln = 0; ln < lines.length; ln++) {
    const n = normalizePhrase(lines[ln]);
    for (const w of n.words) {
      toks.push(w);
      tokLine.push(ln + 1);
    }
    // Raw-token stream, per line.
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

// ── CLI ──────────────────────────────────────────────────────────────

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
      } catch (e) {
        process.stderr.write(`denylist unreadable: ${e.message}\n`);
        return 2;
      }
      if (!Array.isArray(j.entries)) j.entries = [];
    }
    const label = o.label || `manual-${new Date().toISOString().slice(0, 10)}`;
    const fresh = makeEntries(o.add, label).filter((e) => !j.entries.some((x) => x.sha256 === e.sha256));
    j.entries.push(...fresh);
    fs.writeFileSync(o.denylist, JSON.stringify(j, null, 2) + "\n");
    // Print ONLY shapes + hashes — never the phrase.
    for (const e of fresh) process.stdout.write(`added ${e.kind} words=${e.words} chars=${e.chars} sha256=${e.sha256} label=${label}\n`);
    if (!fresh.length) process.stdout.write("no new entries (already present)\n");
    return 0;
  }

  const dl = loadDenylist(o.denylist);
  if (dl.error) {
    process.stderr.write(`FAIL [leak-denylist] ${dl.error}\n`);
    return 2;
  }
  if (dl.entries.length === 0 && !o.allowEmpty) {
    process.stderr.write("FAIL [leak-denylist] denylist has 0 entries — a vacuous gate never reads green (pass --allow-empty to override)\n");
    return 2;
  }

  const root = path.resolve(o.root || process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", ".."));
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
    process.stdout.write(JSON.stringify({ ok, entries: dl.entries.length, scanned: r.scanned, skipped_large: r.skipped, hits: r.hits }, null, 2) + "\n");
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

module.exports = { sha256, normalizePhrase, normalizeToken, makeEntries, loadDenylist, scanText, scanFiles, validateEntry, DEFAULT_DENYLIST };
