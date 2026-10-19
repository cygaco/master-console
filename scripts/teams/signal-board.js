#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const os = require("os");
const path = require("path");

function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || ".");
}

function boardRoot(opts = {}) {
  if (opts.root) return opts.root;
  if (mcEnv.readEnv("SIGNALS_DIR_OVERRIDE")) {
    return mcEnv.readEnv("SIGNALS_DIR_OVERRIDE");
  }
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
  const from = meta.from || mcEnv.readEnv("SIGNAL_FROM") || "unknown";
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

function read(topic, opts = {}) {
  const dir = topicDir(topic, opts);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
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
      if (!(recMs > sinceMs)) continue;
    }
    out.push({ ...rec, _file: full });
  }
  if (opts.last && opts.last > 0) return out.slice(-opts.last);
  return out;
}

async function wait(topic, opts = {}) {
  const timeoutMs = (opts.timeoutS != null ? opts.timeoutS : 30) * 1000;
  const pollMs = opts.pollMs != null ? opts.pollMs : 1000;
  const since = opts.since || new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hits = read(topic, { ...opts, since });
    if (hits.length > 0) return { signal: hits[0], all: hits };
    if (Date.now() >= deadline) return { timedOut: true };
    const remaining = deadline - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining)));
  }
}

module.exports = { post, read, wait, boardRoot, topicDir, stripBom };

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
      payload = raw;
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
