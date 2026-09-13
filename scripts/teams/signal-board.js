#!/usr/bin/env node
// scripts/teams/signal-board.js — Pull-Based Signal Channel (Wave-2 #28)
//
// PROBLEM: SendMessage to a mid-work teammate only delivers on that teammate's
// NEXT yield (the harness batches the inbox). A conductor idle-awaiting a
// ruling therefore blocks for the full round-trip — cost 4 ruling round-trips
// in one night, minutes each. This board is the ACCELERATOR: a sender posts a
// ruling to a topic (and SendMessages as before), and the consumer POLLS the
// topic with `wait` instead of idle-awaiting the inbox.
//
// DESIGN (deliberately tiny, zero-dependency, new-files-only):
//   • One signal = one file. No locks — an atomic write (tmp + rename) per
//     signal means concurrent posters never collide (distinct filenames), and
//     a reader never sees a half-written file.
//   • Board root: paths.runtime/signals/<topic>/  (.claude/runtime/signals/…).
//     Topic may contain "/" (e.g. "<sprint-id>/<boundary>") → nested dirs.
//   • Signal record: {topic, from, ts, payload}. `ts` is an ISO-8601 string;
//     the filename is `<epoch-ms>-<rand>.json` so a lexical sort == time sort.
//   • BOM-safe reads: this machine's PowerShell writes UTF-8 BOMs that break
//     JSON.parse (documented hazard) — every read strips a leading BOM first.
//   • FAIL-OPEN: a malformed/unreadable signal file is SKIPPED with a warning
//     on stderr, never crashes the reader. A `wait` still resolves on the next
//     WELL-FORMED signal.
//
// CLI:
//   node signal-board.js post <topic> <json | -->            (-- reads stdin)
//   node signal-board.js read <topic> [--since <iso>] [--last N]
//   node signal-board.js wait <topic> --timeout <s> [--poll <ms>] [--since <iso>]
//
//   post → prints the written file path.  exit 0.
//   read → prints matching signals as a JSON array.  exit 0.
//   wait → prints the FIRST new signal (JSON) to stdout, exit 0; on timeout
//          prints nothing to stdout and exits 3.
//
// Enforcer: scripts/teams/signal-board.test.js (self-testing lib).
// Doctrine: paths.agentGuides/signal-channel.md.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// ── Board root. Resolve via the paths registry when available (paths.runtime),
//    fall back to CLAUDE_PROJECT_DIR/.claude/runtime so the lib works even if
//    the generated paths view is missing. Injectable via opts for tests. ──────
function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || ".");
}

function boardRoot(opts = {}) {
  if (opts.root) return opts.root;
  if (process.env.WARPOS_SIGNALS_DIR_OVERRIDE) {
    return process.env.WARPOS_SIGNALS_DIR_OVERRIDE;
  }
  // Prefer the registry's runtime key; fall back to the literal.
  let runtime;
  try {
    const { PATHS } = require("../hooks/lib/paths");
    runtime = PATHS && PATHS.runtime;
  } catch {
    runtime = undefined;
  }
  if (!runtime) runtime = path.join(projectDir(), ".claude", "runtime");
  return path.join(runtime, "signals");
}

// Topics may be nested ("<sprint-id>/<boundary>"). Reject "." / ".." segments
// and absolute anchors so a topic can never escape the board root.
function topicDir(topic, opts = {}) {
  if (typeof topic !== "string" || topic.trim() === "") {
    throw new Error("signal-board: topic must be a non-empty string");
  }
  const segments = topic.split(/[/\\]+/).filter(Boolean);
  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      throw new Error(`signal-board: illegal topic segment "${seg}"`);
    }
  }
  return path.join(boardRoot(opts), ...segments);
}

function stripBom(s) {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// ── post ────────────────────────────────────────────────────────────────────
// Atomic: write to a tmp file in the same dir, then rename into place. A reader
// listing the dir never sees the tmp (it does not end in .json).
// Filename stamp is MONOTONIC within a process: two posts in the same
// millisecond (routine on a fast Linux runner / tmpfs; rare on NTFS) would
// otherwise share the epoch prefix and let the RANDOM suffix decide lexical
// order — the older signal sorted last ~50% of the time, so `--last 1` and
// `wait()` could return the wrong record. Bumping past the previous stamp keeps
// "lexical sort == post order" true for a single writer on every platform.
let lastStamp = 0;
function nextStamp() {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

function post(topic, payload, meta = {}, opts = {}) {
  const dir = topicDir(topic, opts);
  fs.mkdirSync(dir, { recursive: true });
  const ts = meta.ts || new Date().toISOString();
  const from = meta.from || process.env.WARPOS_SIGNAL_FROM || "unknown";
  const record = { topic, from, ts, payload };
  const now = nextStamp();
  const rand = Math.random().toString(36).slice(2, 8);
  const base = `${now}-${rand}.json`;
  const finalPath = path.join(dir, base);
  const tmpPath = path.join(dir, `.tmp-${base}`);
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), "utf8");
  fs.renameSync(tmpPath, finalPath);
  return { path: finalPath, record };
}

// ── read ──────────────────────────────────────────────────────────────────
// Returns signals for a topic, oldest-first (filename == time order). A
// malformed/unreadable file is skipped with a stderr warning (fail-open).
// opts: { since?: ISO string, last?: N }
function read(topic, opts = {}) {
  const dir = topicDir(topic, opts);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // no signals yet == empty board, not an error
  }
  const files = names.filter((n) => n.endsWith(".json")).sort();
  const out = [];
  const sinceMs = opts.since ? Date.parse(opts.since) : null;
  for (const name of files) {
    const full = path.join(dir, name);
    let rec;
    try {
      rec = JSON.parse(stripBom(fs.readFileSync(full, "utf8")));
    } catch (e) {
      process.stderr.write(
        `signal-board: skipping malformed signal ${name}: ${e.message}\n`,
      );
      continue;
    }
    if (sinceMs !== null) {
      const recMs = Date.parse(rec && rec.ts);
      // Keep strictly-after `since` (a wait's `since` is its own start point).
      if (!(recMs > sinceMs)) continue;
    }
    out.push({ ...rec, _file: full });
  }
  if (opts.last && opts.last > 0) return out.slice(-opts.last);
  return out;
}

// ── wait ────────────────────────────────────────────────────────────────────
// Poll a topic until a signal newer than `since` (default: now) appears, or the
// timeout elapses. Resolves { signal } on hit, { timedOut: true } on timeout.
async function wait(topic, opts = {}) {
  const timeoutMs = (opts.timeoutS != null ? opts.timeoutS : 30) * 1000;
  const pollMs = opts.pollMs != null ? opts.pollMs : 1000;
  const since = opts.since || new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  // Immediate check first so a signal already posted after `since` returns fast.
  for (;;) {
    const hits = read(topic, { ...opts, since });
    if (hits.length > 0) return { signal: hits[0], all: hits };
    if (Date.now() >= deadline) return { timedOut: true };
    const remaining = deadline - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining)));
  }
}

module.exports = { post, read, wait, boardRoot, topicDir, stripBom };

// ── CLI ───────────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push("--");
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);

  if (cmd === "post") {
    const topic = positional[0];
    let raw = positional[1];
    if (raw === "--" || raw === undefined) raw = readStdin().trim();
    let payload;
    try {
      payload = raw ? JSON.parse(stripBom(raw)) : {};
    } catch {
      payload = raw; // a bare string is a valid payload
    }
    const meta = {};
    if (typeof flags.from === "string") meta.from = flags.from;
    const { path: p } = post(topic, payload, meta);
    process.stdout.write(p + "\n");
    process.exit(0);
  }

  if (cmd === "read") {
    const topic = positional[0];
    const opts = {};
    if (typeof flags.since === "string") opts.since = flags.since;
    if (flags.last) opts.last = parseInt(flags.last, 10) || 0;
    const signals = read(topic, opts);
    process.stdout.write(JSON.stringify(signals, null, 2) + "\n");
    process.exit(0);
  }

  if (cmd === "wait") {
    const topic = positional[0];
    const opts = {};
    if (flags.timeout) opts.timeoutS = parseFloat(flags.timeout);
    if (flags.poll) opts.pollMs = parseInt(flags.poll, 10);
    if (typeof flags.since === "string") opts.since = flags.since;
    const res = await wait(topic, opts);
    if (res.timedOut) {
      process.stderr.write(`signal-board: wait timed out on "${topic}"\n`);
      process.exit(3);
    }
    process.stdout.write(JSON.stringify(res.signal, null, 2) + "\n");
    process.exit(0);
  }

  process.stderr.write(
    "usage: signal-board.js post|read|wait <topic> [...]\n" +
      "  post <topic> <json|-->            write a signal (-- reads stdin)\n" +
      "  read <topic> [--since <iso>] [--last N]\n" +
      "  wait <topic> --timeout <s> [--poll <ms>] [--since <iso>]  (exit 3 on timeout)\n",
  );
  process.exit(2);
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`signal-board: ${e.stack || e.message}\n`);
    process.exit(1);
  });
}
