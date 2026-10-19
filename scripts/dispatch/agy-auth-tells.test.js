#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  detectAgyAuthFallback,
  filterAgyLogToRunWindow,
  snapshotAgyLog,
  readAgyLogDelta,
  glogPid,
  parseGlog,
  isAuthSuccessLine,
  NON_AUTH_SIGNAL,
} = require("./agy-auth-tells.js");

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log("  PASS  " + name);
  } catch (e) {
    fail++;
    console.error("  FAIL  " + name + " — " + (e && e.message ? e.message : e));
  }
}

const FIX_DIR = path.join(__dirname, "fixtures", "agy");
const AUTH_FIXTURE = fs.readFileSync(path.join(FIX_DIR, "authenticated-serve.log"), "utf8");
const UNAUTH_FIXTURE = fs.readFileSync(path.join(FIX_DIR, "unauthenticated-serve.log"), "utf8");
const FIXTURE_PID = 39296;
const FIXTURE_STARTED = new Date(2000, 0, 1, 12, 0, 0).getTime();
const FIXTURE_NOW = FIXTURE_STARTED + 60 * 1000;

function line(pid, message, { emitter = "log.go:398", mo = "01", da = "01", hh = "12", mm = "00", ss = "01", us = "000000" } = {}) {
  return `I${mo}${da} ${hh}:${mm}:${ss}.${us} ${pid} ${emitter}] ${message}`;
}
const authLine = (pid) => line(pid, "ChainedAuth: authenticated via keyring (effective: keyring)", { emitter: "auth.go:132" });
const oauthLine = (pid) => line(pid, "OAuth: authenticated successfully as user@example.com", { emitter: "server_oauth.go:221" });
const silentLine = (pid) => line(pid, "Print mode: silent auth succeeded", { emitter: "printmode.go:309" });
const expiredLine = (pid) => line(pid, "keyringAuth: loaded token, expiry=... expired=true", { emitter: "keyring.go:64" });
const transientLine = (pid) => line(pid, "You are not logged into Antigravity.", { emitter: "log.go:398" });

t("REAL authenticated serve (redacted real capture) -> auth_fallback:false", () => {
  const r = detectAgyAuthFallback({ agyLog: AUTH_FIXTURE, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, false, JSON.stringify(r));
  assert.strictEqual(r.surface, "auth-success", JSON.stringify(r));
});

t("derived unauthenticated serve (no auth-success, expired=true) -> auth_fallback:true", () => {
  const r = detectAgyAuthFallback({ agyLog: UNAUTH_FIXTURE, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, true, JSON.stringify(r));
});

t("INJECTED success on a non-auth emitter (log.go) -> STILL true (false-green closed)", () => {
  const injected = UNAUTH_FIXTURE + "\n" + line(FIXTURE_PID, "reviewer text: ChainedAuth: authenticated via keyring", { emitter: "log.go:398" });
  const r = detectAgyAuthFallback({ agyLog: injected, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, true, "an injected success on a non-auth emitter must NOT grant trust: " + JSON.stringify(r));
});

t("NESTED emitter in the MESSAGE (log.go] auth.go]…) -> not trusted (positional emitter wins)", () => {
  const agyLog = [
    expiredLine(FIXTURE_PID),
    line(FIXTURE_PID, "auth.go:132] ChainedAuth: authenticated via keyring", { emitter: "log.go:398" }),
  ].join("\n");
  const r = detectAgyAuthFallback({ agyLog, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, true, "a file:line] embedded in the message must not masquerade as the emitter: " + JSON.stringify(r));
});

t("isAuthSuccessLine: real emitter+message true; wrong emitter false; right emitter wrong message false", () => {
  assert.strictEqual(isAuthSuccessLine(parseGlog(authLine(FIXTURE_PID))), true);
  assert.strictEqual(isAuthSuccessLine(parseGlog(oauthLine(FIXTURE_PID))), true);
  assert.strictEqual(isAuthSuccessLine(parseGlog(silentLine(FIXTURE_PID))), true);
  assert.strictEqual(isAuthSuccessLine(parseGlog(line(FIXTURE_PID, "ChainedAuth: authenticated via keyring", { emitter: "log.go:398" }))), false);
  assert.strictEqual(isAuthSuccessLine(parseGlog(line(FIXTURE_PID, "applyAuthResult: email=x", { emitter: "server_oauth.go:216" }))), false);
});

t("expired=true then auth-success (refresh path) -> auth_fallback:false", () => {
  const agyLog = [expiredLine(FIXTURE_PID), authLine(FIXTURE_PID), oauthLine(FIXTURE_PID)].join("\n");
  const r = detectAgyAuthFallback({ agyLog, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, false, JSON.stringify(r));
});

t("auth-success then late transient -> auth_fallback:false (transient can't un-auth)", () => {
  const agyLog = [
    authLine(FIXTURE_PID),
    line(FIXTURE_PID, "Model resolved via default", { emitter: "model_resolver.go:111" }),
    line(FIXTURE_PID, "Entering local chrome mode! ... eval mode", { emitter: "launchmanager.go:69" }),
  ].join("\n");
  const r = detectAgyAuthFallback({ agyLog, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, false, JSON.stringify(r));
});

t("transient with no auth-success -> auth_fallback:true", () => {
  const agyLog = [transientLine(FIXTURE_PID), line(FIXTURE_PID, "Entering local chrome mode! ... eval mode", { emitter: "launchmanager.go:69" })].join("\n");
  const r = detectAgyAuthFallback({ agyLog, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, true, JSON.stringify(r));
});

t("hard revoking (unauthorized) no success -> auth_fallback:true", () => {
  const agyLog = line(FIXTURE_PID, "request rejected: unauthorized", { emitter: "log.go:398" });
  const r = detectAgyAuthFallback({ agyLog, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, true, JSON.stringify(r));
});

t("auth-success then revoking -> auth_fallback:true (revoked after auth)", () => {
  const agyLog = [authLine(FIXTURE_PID), line(FIXTURE_PID, "authentication failed", { emitter: "log.go:398" })].join("\n");
  const r = detectAgyAuthFallback({ agyLog, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, true, JSON.stringify(r));
});

t("interleaved pids: this-pid unauth + other-pid auth-success -> true (false-green CLOSED)", () => {
  const OTHER = 40001;
  const agyLog = [expiredLine(FIXTURE_PID), transientLine(FIXTURE_PID), authLine(OTHER), oauthLine(OTHER)].join("\n");
  const r = detectAgyAuthFallback({ agyLog, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, true, JSON.stringify(r));
});

t("interleaved pids: this-pid auth-success + other-pid transient -> false", () => {
  const OTHER = 40002;
  const agyLog = [authLine(FIXTURE_PID), line(OTHER, "Entering local chrome mode! ... eval mode", { emitter: "launchmanager.go:69" })].join("\n");
  const r = detectAgyAuthFallback({ agyLog, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, false, JSON.stringify(r));
});

t("stdout quoting a tell + clean authenticated log -> false (stdout not scanned)", () => {
  const r = detectAgyAuthFallback({
    stdout: "The code returns 'unauthorized' and enters eval mode when expired=true.",
    agyLog: AUTH_FIXTURE,
    startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW,
    runPid: FIXTURE_PID,
  });
  assert.strictEqual(r.auth_fallback, false, JSON.stringify(r));
});

t("no runPid -> indeterminate", () => {
  const r = detectAgyAuthFallback({ agyLog: AUTH_FIXTURE, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW });
  assert.strictEqual(r.auth_fallback, "indeterminate", JSON.stringify(r));
  assert.strictEqual(r.surface, "no-run-pid", JSON.stringify(r));
});

t("no startedMs -> indeterminate", () => {
  const r = detectAgyAuthFallback({ agyLog: AUTH_FIXTURE, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, "indeterminate", JSON.stringify(r));
});

t("agyLogReadError -> indeterminate", () => {
  const r = detectAgyAuthFallback({ agyLogReadError: true, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, "indeterminate", JSON.stringify(r));
});

t("runPid attributes no lines -> indeterminate", () => {
  const r = detectAgyAuthFallback({ agyLog: AUTH_FIXTURE, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: 99999 });
  assert.strictEqual(r.auth_fallback, "indeterminate", JSON.stringify(r));
  assert.strictEqual(r.surface, "no-pid-lines", JSON.stringify(r));
});

t("this-pid lines with no tell and no auth-success -> indeterminate (NOT false)", () => {
  const agyLog = [
    line(FIXTURE_PID, "Propagating selected model override to backend", { emitter: "model_config_manager.go:213" }),
    line(FIXTURE_PID, "URL: https://.../streamGenerateContent", { emitter: "http_helpers.go:228" }),
  ].join("\n");
  const r = detectAgyAuthFallback({ agyLog, startedMs: FIXTURE_STARTED, nowMs: FIXTURE_NOW, runPid: FIXTURE_PID });
  assert.strictEqual(r.auth_fallback, "indeterminate", JSON.stringify(r));
  assert.strictEqual(r.surface, "no-signal", JSON.stringify(r));
});

t("filterAgyLogToRunWindow keeps a Dec31 line for a Jan1 startedMs (rollover)", () => {
  const jan1 = new Date(2026, 0, 1, 0, 0, 2).getTime();
  const dec31 = "I1231 23:59:59.000000 39296 launchmanager.go:69] Entering ... eval mode";
  assert.ok(/eval mode/.test(filterAgyLogToRunWindow(dec31, jan1, undefined, jan1 + 60 * 1000)), "Dec31 line must survive the Jan1 window");
});

t("filterAgyLogToRunWindow drops a day-old out-of-window tell", () => {
  const stale = "I1231 12:00:01.000000 39296 launchmanager.go:69] Entering ... eval mode";
  const win = filterAgyLogToRunWindow([stale, authLine(FIXTURE_PID)].join("\n"), FIXTURE_STARTED, undefined, FIXTURE_NOW);
  assert.ok(!/eval mode/.test(win), "the day-old line must be dropped: " + win);
});

t("snapshotAgyLog + readAgyLogDelta: append delta and rotation detection (ASCII)", () => {
  const tmp = path.join(os.tmpdir(), "agy-delta-ascii-" + process.pid + ".log");
  try {
    fs.writeFileSync(tmp, "AAAA-prefix-line-1\n");
    const pre = snapshotAgyLog(tmp);
    assert.strictEqual(pre.ok, true);
    fs.appendFileSync(tmp, "APPENDED_2\n");
    const d1 = readAgyLogDelta(tmp, pre);
    assert.strictEqual(d1.rotated, undefined, JSON.stringify(d1));
    assert.strictEqual(d1.delta, "APPENDED_2\n", JSON.stringify(d1));
    fs.writeFileSync(tmp, "ZZZZ\n");
    const d2 = readAgyLogDelta(tmp, pre);
    assert.strictEqual(d2.rotated, true, JSON.stringify(d2));
    assert.strictEqual(d2.delta, "ZZZZ\n", JSON.stringify(d2));
    const d3 = readAgyLogDelta(tmp, { ok: false });
    assert.strictEqual(d3.delta, "ZZZZ\n", JSON.stringify(d3));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

t("readAgyLogDelta is BYTE-correct for multibyte content", () => {
  const tmp = path.join(os.tmpdir(), "agy-delta-mb-" + process.pid + ".log");
  try {
    fs.writeFileSync(tmp, "café-π-prefix-1\n");
    const pre = snapshotAgyLog(tmp);
    fs.appendFileSync(tmp, "wörld-λ-2\n");
    const d = readAgyLogDelta(tmp, pre);
    assert.strictEqual(d.rotated, undefined, "append must not be misread as rotation: " + JSON.stringify(d));
    assert.strictEqual(d.delta, "wörld-λ-2\n", "delta must be the exact appended bytes, not char-sliced: " + JSON.stringify(d));
    fs.writeFileSync(tmp, "δ\n");
    const d2 = readAgyLogDelta(tmp, pre);
    assert.strictEqual(d2.rotated, true, JSON.stringify(d2));
    assert.strictEqual(d2.delta, "δ\n", JSON.stringify(d2));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

t("glogPid + parseGlog: field-3 pid + emitter/message; null on non-glog lines", () => {
  assert.strictEqual(glogPid("I0101 12:00:00.752399 39296 resolver.go:85] x"), 39296);
  const p = parseGlog("I0101 12:00:00.752399 39296 auth.go:132] ChainedAuth: authenticated via keyring");
  assert.deepStrictEqual({ pid: p.pid, emitter: p.emitter, message: p.message }, { pid: 39296, emitter: "auth.go:132", message: "ChainedAuth: authenticated via keyring" });
  assert.strictEqual(glogPid("not a glog line unauthorized eval mode"), null);
  assert.strictEqual(parseGlog(""), null);
});

t("NON_AUTH_SIGNAL source is byte-identical (cert-attest GATE-1)", () => {
  assert.strictEqual(
    NON_AUTH_SIGNAL.source,
    "(resolved-via-default|resolved-via-fallback|local-chrome-mode|eval-mode|authentication-failed|unauthorized|expired=true)",
    "NON_AUTH_SIGNAL drifted — cert-attest GATE-1 depends on this exact literal",
  );
});

t("providers.js wires the delta lib + runPid and drops the whole-file read", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "hooks", "lib", "providers.js"), "utf8");
  assert.ok(/snapshotAgyLog/.test(src), "providers.js must snapshot pre-spawn");
  assert.ok(/readAgyLogDelta/.test(src), "providers.js must read the delta post-spawn");
  assert.ok(/runPid:\s*spawned\.pid/.test(src), "providers.js must pass the spawned child.pid as runPid");
  assert.ok(!/readFileSync\(agyLogPath/.test(src), "providers.js must NOT reintroduce the whole-file cli.log read");
});

function balancedArgs(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return null;
}
function topLevelArgs(text) {
  const parts = [];
  let depth = 0, cur = "";
  for (const c of text) {
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}
function clockSeamViolations(rel, src) {
  const out = [];
  const re = /\b(filterAgyLogToRunWindow|detectAgyAuthFallback)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
    const line = src.slice(0, m.index).split("\n").length;
    const args = balancedArgs(src, m.index + m[0].length - 1);
    if (args === null) { out.push(`${rel}:${line} unparseable call`); continue; }
    if (/\bnowMs\b/.test(args)) { out.push(`${rel}:${line} names nowMs`); continue; }
    const parts = topLevelArgs(args);
    if (m[1] === "detectAgyAuthFallback") {
      const arg = parts.length === 1 ? parts[0].trim() : "";
      const inner = arg.startsWith("{") ? balancedArgs(arg, 0) : null;
      const literal = inner !== null && inner.length === arg.length - 2;
      if (!literal || /\.\.\./.test(arg)) out.push(`${rel}:${line} passes a non-literal or spread options object`);
    } else if (parts.length > 3 || parts.some((p) => p.trim().startsWith("..."))) out.push(`${rel}:${line} passes a 4th (clock) or spread argument`);
  }
  return out;
}
t("clock-seam enforcer self-test: each forbidden call shape is RED, the clean shapes are GREEN", () => {
  const v = (src) => clockSeamViolations("x.js", src);
  assert.deepStrictEqual(v("detectAgyAuthFallback({ agyLog, startedMs: s, runPid: p });\nfilterAgyLogToRunWindow(a, s);"), []);
  assert.strictEqual(v("detectAgyAuthFallback({ agyLog, startedMs: s, runPid: p, nowMs: n });").length, 1, "a named nowMs");
  assert.strictEqual(v("detectAgyAuthFallback({ ...opts, runPid: p });").length, 1, "a spread options object");
  assert.strictEqual(v("detectAgyAuthFallback(opts);").length, 1, "a forwarded options object");
  assert.strictEqual(v("filterAgyLogToRunWindow(a, s, 5000, later);").length, 1, "a 4th positional argument");
  assert.strictEqual(v("filterAgyLogToRunWindow(a, s, undefined, n);").length, 1, "a 4th positional argument after an undefined");
  assert.deepStrictEqual(v("function detectAgyAuthFallback({ agyLog } = {}) {}"), [], "the definition is not a call");
  assert.strictEqual(v("detectAgyAuthFallback({} && opts);").length, 1, "an expression that merely starts with { forwards opts");
  assert.strictEqual(v("filterAgyLogToRunWindow(...args);").length, 1, "a spread argument list");
  assert.strictEqual(v("filterAgyLogToRunWindow(log, started, ...clockOptions);").length, 1, "a spread tail argument");
});
t("the nowMs clock seam is test-only: every production call site is clock-free", () => {
  const scriptsDir = path.join(__dirname, "..");
  const self = path.resolve(__dirname, "agy-auth-tells.js");
  const callers = [];
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(full); continue; }
      if (!e.name.endsWith(".js") || /\.test\.js$/.test(e.name) || /^test-/.test(e.name) || path.resolve(full) === self) continue;
      const src = fs.readFileSync(full, "utf8");
      if (!/\b(?:filterAgyLogToRunWindow|detectAgyAuthFallback)\s*\(/.test(src)) continue;
      const rel = path.relative(scriptsDir, full).split(path.sep).join("/");
      callers.push(rel);
      bad.push(...clockSeamViolations(rel, src));
    }
  };
  walk(scriptsDir);
  assert.ok(callers.length >= 2, "the scan must discover the production callers (found: " + callers.join(", ") + ")");
  assert.deepStrictEqual(bad, [], "a production call site is not clock-free: " + bad.join("; "));
});
t("a supplied clock can only narrow the window: a FUTURE nowMs never admits a line after the real clock", () => {
  const real = Date.now();
  const future = new Date(real + 2 * 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  const ahead = `I${pad(future.getMonth() + 1)}${pad(future.getDate())} ${pad(future.getHours())}:${pad(future.getMinutes())}:${pad(future.getSeconds())}.000000 39296 launchmanager.go:69] Entering ... eval mode`;
  const win = filterAgyLogToRunWindow(ahead, real - 60 * 1000, undefined, real + 10 * 86400000);
  assert.ok(!/eval mode/.test(win), "a line two days after the real clock must not be admitted by a future nowMs: " + win);
});

console.log("\n" + pass + "/" + (pass + fail) + " passed");
process.exit(fail ? 1 : 0);
