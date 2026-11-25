#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const SCHEMA = "mc/model-signin/v1";
const WRITER = Object.freeze({ tool: "scripts/dispatch/signin.js", version: 1 });
const MAX_AGE_DAYS = 7;
const TIMEOUT_MS = 20 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_SERVED = 500;

const CLAUDE_METHODS = new Set(["none", "claude.ai", "oauth_token", "api_key", "api_key_helper", "third_party"]);
const METHOD_UNKNOWN = "unknown";
const CODEX_METHOD = "codex login status";
const AGY_METHOD = "agy models";

const COMMANDS = Object.freeze({
  claude: Object.freeze(["auth", "status"]),
  codex: Object.freeze(["login", "status"]),
  agy: Object.freeze(["models"]),
});

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const AGY_ROW = /^([a-z0-9][a-z0-9._-]{0,99})\t\S/;
const LOGGED_IN = /^Logged in/m;
const NOT_LOGGED_IN = /^Not logged in/im;
const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const NOTE_LINE =
  "Checked with each tool's own status command; the Gemini tool asks Google's service for your model list. This engine calls no AI service itself to check.";

function kernel() {
  return require("./safe-spawn");
}

function invocationFor(tool, args) {
  if (tool.kind === "node-entry") return { bin: process.execPath, args: [tool.entry, ...args] };
  if (tool.kind === "cmd-shim" && process.platform === "win32") {
    const cmdExe = path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", "cmd.exe");
    if (!fs.existsSync(cmdExe)) return null;
    return { bin: cmdExe, args: ["/c", tool.path, ...args] };
  }
  return { bin: tool.path, args: [...args] };
}

function runBounded(bin, args, o = {}) {
  return new Promise((resolve) => {
    const bufs = { out: [], err: [] };
    const lens = { out: 0, err: 0 };
    let child = null;
    let timer = null;
    let settled = false;
    let timedOut = false;
    const finish = (exit, spawnError) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const dead = timedOut || spawnError;
      resolve({
        exit: dead ? null : exit,
        stdout: dead ? "" : Buffer.concat(bufs.out).toString("utf8"),
        stderr: dead ? "" : Buffer.concat(bufs.err).toString("utf8"),
        timedOut,
        spawnError: !!spawnError,
      });
    };
    try {
      child = spawn(bin, args, {
        cwd: o.cwd,
        env: o.env || process.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch {
      finish(null, true);
      return;
    }
    const take = (k) => (b) => {
      if (lens[k] >= MAX_CAPTURE_BYTES) return;
      bufs[k].push(b);
      lens[k] += b.length;
    };
    child.stdout.on("data", take("out"));
    child.stderr.on("data", take("err"));
    child.on("error", () => finish(null, true));
    child.on("close", (code) => finish(typeof code === "number" ? code : null, false));
    timer = setTimeout(() => {
      timedOut = true;
      try {
        kernel().treeKill(child.pid);
      } catch {
      }
      try {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
      } catch {
      }
      finish(null, false);
    }, o.timeoutMs || TIMEOUT_MS);
  });
}

function defaultExec(spec) {
  const inv = invocationFor(spec.tool, spec.args);
  if (!inv) return Promise.resolve({ exit: null, stdout: "", stderr: "", timedOut: false, spawnError: true });
  const env = spec.id === "codex" ? kernel().withCodexHome("codex", process.env) : process.env;
  return runBounded(inv.bin, inv.args, { env, cwd: kernel().PROJECT_ROOT, timeoutMs: spec.timeoutMs });
}

function claudeFrom(r) {
  let j = null;
  if (r.stdout) {
    try {
      const parsed = JSON.parse(r.stdout.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) j = parsed;
    } catch {
    }
  }
  const method = j && typeof j.authMethod === "string" && CLAUDE_METHODS.has(j.authMethod) ? j.authMethod : METHOD_UNKNOWN;
  let signedIn = null;
  if (r.notFound) signedIn = false;
  else if (r.exit === 0 && j) signedIn = j.loggedIn !== false;
  else if (r.exit === 1) signedIn = false;
  return { signedIn, method, exit: r.exit };
}

function versionOf(tool) {
  const v = tool && (tool.version || (tool.resolution && tool.resolution.chosen_version));
  return typeof v === "string" && SEMVER.test(v) ? v : null;
}

function codexFrom(r) {
  const said = LOGGED_IN.test(r.stdout) || LOGGED_IN.test(r.stderr);
  const saidNot = NOT_LOGGED_IN.test(r.stdout) || NOT_LOGGED_IN.test(r.stderr);
  let signedIn = null;
  if (r.notFound) signedIn = false;
  else if (r.exit === 0 && said) signedIn = true;
  else if (Number.isInteger(r.exit) && r.exit !== 0 && saidNot) signedIn = false;
  return { signedIn, method: CODEX_METHOD, exit: r.exit, version: versionOf(r.tool) };
}

function agyFrom(r) {
  const served = [];
  if (r.exit === 0) {
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = AGY_ROW.exec(line);
      if (m && served.length < MAX_SERVED && !served.includes(m[1])) served.push(m[1]);
    }
  }
  let signedIn = null;
  if (r.notFound) signedIn = false;
  else if (r.exit === 0 && served.length > 0) signedIn = true;
  return { signedIn, method: AGY_METHOD, exit: r.exit, served };
}

function toMs(now) {
  if (now === undefined || now === null) return Date.now();
  const ms = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(String(now));
  return Number.isFinite(ms) ? ms : Date.now();
}

async function detect(opts = {}) {
  const resolveTool = typeof opts.resolveTool === "function" ? opts.resolveTool : (id) => kernel().resolveTool(id);
  const exec = typeof opts.exec === "function" ? opts.exec : defaultExec;
  const run = async (id) => {
    const none = { exit: null, stdout: "", stderr: "", tool: null };
    let tool = null;
    try {
      tool = resolveTool(id);
    } catch {
      tool = null;
    }
    if (!tool || !tool.ok) return { ...none, notFound: true };
    let r = null;
    try {
      r = await exec({ id, tool, args: COMMANDS[id].slice(), timeoutMs: TIMEOUT_MS });
    } catch {
      r = null;
    }
    if (!r || typeof r !== "object") return { ...none, tool, failed: true };
    return {
      exit: Number.isInteger(r.exit) ? r.exit : null,
      stdout: typeof r.stdout === "string" ? r.stdout : "",
      stderr: typeof r.stderr === "string" ? r.stderr : "",
      tool,
    };
  };
  const [c, x, a] = await Promise.all([run("claude"), run("codex"), run("agy")]);
  return {
    schema: SCHEMA,
    writer: { tool: WRITER.tool, version: WRITER.version },
    ts: new Date(toMs(opts.now)).toISOString(),
    providers: { claude: claudeFrom(c), openai: codexFrom(x), antigravity: agyFrom(a) },
  };
}

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v);
const hasOnlyKeys = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));
const exitOk = (v) => v === null || Number.isInteger(v);

function validateCacheRecord(input, opts = {}) {
  const bad = (reason) => ({ ok: false, reason });
  let obj = input;
  if (Buffer.isBuffer(obj)) obj = obj.toString("utf8");
  if (typeof obj === "string") {
    const s = obj.charCodeAt(0) === 0xfeff ? obj.slice(1) : obj;
    try {
      obj = JSON.parse(s);
    } catch {
      return bad("unparseable");
    }
  }
  if (!isPlainObject(obj)) return bad("not-an-object");
  if (obj.schema !== SCHEMA) return bad("bad-schema");
  const w = obj.writer;
  if (!isPlainObject(w) || w.tool === undefined || w.version === undefined) return bad("missing-writer-stamp");
  if (w.tool !== WRITER.tool || w.version !== WRITER.version) return bad("foreign-writer");
  if (!hasOnlyKeys(w, ["tool", "version"])) return bad("unexpected-field:writer");
  if (!hasOnlyKeys(obj, ["schema", "writer", "ts", "providers"])) return bad("unexpected-field:top");

  if (typeof obj.ts !== "string" || !ISO_TS.test(obj.ts) || !Number.isFinite(Date.parse(obj.ts))) return bad("bad-ts");
  const maxAgeDays = typeof opts.maxAgeDays === "number" && opts.maxAgeDays > 0 ? opts.maxAgeDays : MAX_AGE_DAYS;
  const age = toMs(opts.now) - Date.parse(obj.ts);
  if (age > maxAgeDays * 86400000) return bad("stale");
  if (age < -FUTURE_SKEW_MS) return bad("ts-in-future");

  const p = obj.providers;
  if (!isPlainObject(p)) return bad("missing-providers");
  if (!hasOnlyKeys(p, ["claude", "openai", "antigravity"])) return bad("unexpected-field:providers");
  const shapes = {
    claude: { keys: ["signedIn", "method", "exit"], method: (m) => m === METHOD_UNKNOWN || CLAUDE_METHODS.has(m) },
    openai: { keys: ["signedIn", "method", "exit", "version"], method: (m) => m === CODEX_METHOD },
    antigravity: { keys: ["signedIn", "method", "exit", "served"], method: (m) => m === AGY_METHOD },
  };
  for (const [name, shape] of Object.entries(shapes)) {
    const e = p[name];
    if (!isPlainObject(e)) return bad(`missing-provider:${name}`);
    if (!hasOnlyKeys(e, shape.keys)) return bad(`unexpected-field:providers.${name}`);
    if (typeof e.signedIn !== "boolean" && e.signedIn !== null) return bad(`bad-signedIn:${name}`);
    if (!exitOk(e.exit)) return bad(`bad-exit:${name}`);
    if (typeof e.method !== "string" || !shape.method(e.method)) return bad(`bad-method:${name}`);
    if (e.signedIn === true && e.exit !== 0) return bad(`inconsistent:${name}`);
  }
  const v = p.openai.version;
  if (v !== undefined && v !== null && !(typeof v === "string" && SEMVER.test(v))) return bad("bad-version:openai");
  const served = p.antigravity.served;
  if (served !== undefined) {
    if (!Array.isArray(served) || served.length > MAX_SERVED) return bad("bad-served:antigravity");
    if (!served.every((id) => typeof id === "string" && MODEL_ID.test(id))) return bad("bad-served:antigravity");
  }
  return { ok: true, reason: null };
}

function cachePath(opts = {}) {
  if (typeof opts.file === "string" && opts.file) return path.resolve(opts.file);
  let p = null;
  try {
    p = require("../hooks/lib/paths").PATHS.modelSigninCache;
  } catch {
    p = null;
  }
  if (!p) {
    try {
      p = require("../hooks/lib/paths.generated").PATHS.modelSigninCache;
    } catch {
      p = null;
    }
  }
  if (!p) throw new Error("paths.modelSigninCache is not registered — run node scripts/paths/build.js");
  return p;
}

function renameWithRetry(from, to) {
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      lastErr = e;
      if (!e || (e.code !== "EPERM" && e.code !== "EACCES" && e.code !== "EBUSY")) break;
      const until = Date.now() + 50 * (i + 1);
      while (Date.now() < until) {
      }
    }
  }
  throw lastErr;
}

function writeCache(record, opts = {}) {
  if (!isPlainObject(record)) return { ok: false, reason: "refused-invalid-record:not-an-object" };
  const v = validateCacheRecord(record, { now: opts.now, maxAgeDays: MAX_AGE_DAYS });
  if (!v.ok) return { ok: false, reason: `refused-invalid-record:${v.reason}` };
  let file;
  try {
    file = cachePath(opts);
  } catch {
    return { ok: false, reason: "no-cache-path" };
  }
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    renameWithRetry(tmp, file);
    return { ok: true, file };
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
    }
    return { ok: false, reason: `write-failed:${(e && e.code) || "error"}` };
  }
}

function logBooleans(record, opts) {
  const flags = {
    claude: record.providers.claude.signedIn === true,
    openai: record.providers.openai.signedIn === true,
    antigravity: record.providers.antigravity.signedIn === true,
  };
  try {
    const logEvent = typeof opts.logEvent === "function" ? opts.logEvent : require("../hooks/lib/logger").logEvent;
    logEvent("signin", "system", "signin-refresh", "", `claude=${flags.claude} openai=${flags.openai} antigravity=${flags.antigravity}`, flags);
  } catch {
  }
}

function readSaved(opts, nowMs) {
  let file;
  try {
    file = cachePath(opts);
  } catch {
    return { record: null, reason: "none" };
  }
  let st;
  try {
    st = require("./model-resolve").readSigninState({ signinPath: file, now: nowMs });
  } catch {
    return { record: null, reason: "unreadable" };
  }
  if (!st || st.state !== "known") {
    const r = st && typeof st.reason === "string" ? st.reason : "unreadable";
    return { record: null, reason: /no sign-in record yet/.test(r) ? "none" : r };
  }
  return { record: { schema: SCHEMA, writer: { tool: WRITER.tool, version: WRITER.version }, ts: st.ts, providers: st.providers }, reason: null };
}

function humanAge(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} days ago`;
}

function describe(record) {
  const { claude, openai, antigravity } = record.providers;
  const lines = [];
  const UNKNOWN = "could not check (it did not answer, or its answer could not be read) — treated as signed in, so its roles keep their first choice";
  if (claude.signedIn === true) lines.push("Claude: signed in");
  else if (claude.signedIn === null) lines.push(`Claude: ${UNKNOWN}`);
  else lines.push("Claude: not signed in or not installed — run `claude auth login` to sign in");
  if (openai.signedIn === true) lines.push("Codex (OpenAI): signed in");
  else if (openai.signedIn === null) lines.push(`Codex (OpenAI): ${UNKNOWN}`);
  else lines.push("Codex (OpenAI): not signed in or not installed — install it (npm i -g @openai/codex), then run `codex login` to add it");
  const n = Array.isArray(antigravity.served) ? antigravity.served.length : 0;
  if (antigravity.signedIn === true) lines.push(`Gemini (agy): signed in — ${n} model${n === 1 ? "" : "s"} listed`);
  else if (antigravity.signedIn === null) lines.push(`Gemini (agy): ${UNKNOWN}`);
  else lines.push("Gemini (agy): not installed — install the Antigravity agy tool and sign in to it to add it");
  return lines;
}

const USAGE = "Usage: node scripts/dispatch/signin.js [--refresh] [--json]\n";

async function main(argv = [], opts = {}) {
  const out = typeof opts.stdout === "function" ? opts.stdout : (s) => process.stdout.write(s);
  const err = typeof opts.stderr === "function" ? opts.stderr : (s) => process.stderr.write(s);
  const args = new Set(argv);
  if (args.has("--help") || args.has("-h")) {
    out(USAGE);
    return 0;
  }
  const unknown = argv.filter((a) => a !== "--refresh" && a !== "--json");
  if (unknown.length) {
    err(USAGE);
    return 2;
  }
  const refresh = args.has("--refresh");
  const json = args.has("--json");
  const nowMs = toMs(opts.now);

  let record = null;
  let source = "checked";
  let saved = null;
  let note = null;
  if (!refresh) {
    const s = readSaved(opts, nowMs);
    if (s.record) {
      record = s.record;
      source = "saved";
    } else if (s.reason !== "none") {
      note = `The saved result could not be used (${s.reason}), so it was checked again.`;
    }
  }
  if (!record) {
    record = await detect(opts);
    const w = writeCache(record, opts);
    saved = w.ok;
    if (!w.ok) err(`Could not save the result (${w.reason}).\n`);
    logBooleans(record, opts);
  }
  const ageMs = Math.max(0, nowMs - Date.parse(record.ts));

  if (json) {
    const reduced = { schema: record.schema, writer: record.writer, ts: record.ts, providers: {} };
    for (const [k, v] of Object.entries(record.providers || {})) {
      reduced.providers[k] = { signedIn: v.signedIn };
      if (k === "antigravity" && Array.isArray(v.served)) reduced.providers[k].served = v.served.slice();
    }
    out(JSON.stringify({ source, age_seconds: Math.round(ageMs / 1000), saved, record: reduced }, null, 2) + "\n");
  } else {
    const lines = describe(record);
    if (note) lines.unshift(note);
    lines.push(source === "saved" ? `Last checked ${humanAge(ageMs)}. Run with --refresh to check again.` : "Checked just now.");
    lines.push(NOTE_LINE);
    out(lines.join("\n") + "\n");
  }
  return saved === false ? 1 : 0;
}

module.exports = {
  detect,
  writeCache,
  validateCacheRecord,
  cachePath,
  main,
  SCHEMA,
  WRITER,
  MAX_AGE_DAYS,
  TIMEOUT_MS,
  COMMANDS,
  _runBounded: runBounded,
  _invocationFor: invocationFor,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write("signin: unexpected error\n");
      process.exitCode = 1;
    },
  );
}
