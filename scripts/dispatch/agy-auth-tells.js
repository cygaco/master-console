"use strict";

const fs = require("fs");

const NON_AUTH_SIGNAL = /(resolved-via-default|resolved-via-fallback|local-chrome-mode|eval-mode|authentication-failed|unauthorized|expired=true)/;

const STARTUP_TRANSIENT = /(resolved-via-default|resolved-via-fallback|local-chrome-mode|eval-mode|not-logged-into-antigravity|not-authenticated)/;
const REVOKING = /(authentication-failed|unauthorized)/;
const EXPIRED = /expired=true/;

const AUTH_SITES = new Map([
  ["auth.go", /^chainedauth: authenticated via keyring\b/i],
  ["server_oauth.go", /^oauth: authenticated successfully as \S/i],
  ["printmode.go", /^print mode: silent auth succeeded\b/i],
]);

function norm(s) {
  return String(s || "").toLowerCase().replace(/[\s_]+/g, "-");
}

function parseGlog(line) {
  const m = String(line).match(/^[IWEF]\d{4}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(\d+)\s+([A-Za-z0-9_.\-]+:\d+)\]\s?(.*)$/);
  if (!m) return null;
  return { pid: Number(m[1]), emitter: m[2], message: m[3] };
}

function glogPid(line) {
  const p = parseGlog(line);
  return p ? p.pid : null;
}

function isAuthSuccessLine(parsed) {
  if (!parsed) return false;
  const file = parsed.emitter.split(":")[0];
  const rx = AUTH_SITES.get(file);
  return !!rx && rx.test((parsed.message || "").trim());
}

function filterAgyLogToRunWindow(agyLog, startedMs, marginMs = 5000, nowMs) {
  if (!agyLog) return "";
  const lo = startedMs - marginMs;
  const realNow = Date.now();
  const hi = (nowMs === undefined ? realNow : Math.min(nowMs, realNow)) + 1000;
  const baseYear = new Date(startedMs).getFullYear();
  const kept = [];
  for (const line of agyLog.split("\n")) {
    const m = line.match(/^[IWEF](\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
    if (!m) continue;
    const [, mo, da, hh, mm, ss, frac] = m;
    const ms = frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0;
    let inWindow = false;
    for (const y of [baseYear, baseYear - 1, baseYear + 1]) {
      const t = new Date(y, Number(mo) - 1, Number(da), Number(hh), Number(mm), Number(ss), ms).getTime();
      if (t >= lo && t <= hi) { inWindow = true; break; }
    }
    if (inWindow) kept.push(line);
  }
  return kept.join("\n");
}

function snapshotAgyLog(logPath) {
  try {
    const size = fs.statSync(logPath).size;
    const n = Math.min(256, size);
    const buf = Buffer.alloc(n);
    if (n > 0) {
      const fd = fs.openSync(logPath, "r");
      try { fs.readSync(fd, buf, 0, n, 0); } finally { fs.closeSync(fd); }
    }
    return { ok: true, size, prefixBuf: buf };
  } catch {
    return { ok: false };
  }
}

function readAgyLogDelta(logPath, pre) {
  let buf;
  try {
    buf = fs.readFileSync(logPath);
  } catch {
    return { ok: false };
  }
  if (!pre || !pre.ok) return { ok: true, delta: buf.toString("utf8") };
  const preBuf = pre.prefixBuf || Buffer.alloc(0);
  const cmpLen = Math.min(preBuf.length, buf.length);
  const rotated = buf.length < pre.size || !buf.subarray(0, cmpLen).equals(preBuf.subarray(0, cmpLen));
  if (rotated) return { ok: true, delta: buf.toString("utf8"), rotated: true };
  return { ok: true, delta: buf.subarray(pre.size).toString("utf8") };
}

function detectAgyAuthFallback({ agyLog = null, agyLogReadError = false, startedMs, runPid, nowMs } = {}) {
  if (typeof startedMs !== "number" || !Number.isFinite(startedMs)) {
    return { auth_fallback: "indeterminate", reason: "no startedMs — cannot bound the shared cli.log to this run", surface: "no-run-window" };
  }
  if (agyLogReadError) {
    return { auth_fallback: "indeterminate", reason: "agy cli.log expected but unreadable", surface: "log-unreadable" };
  }
  if (!Number.isInteger(runPid) || runPid <= 0) {
    return { auth_fallback: "indeterminate", reason: "no run pid — cannot attribute shared cli.log lines to this serve", surface: "no-run-pid" };
  }

  const logWindow = agyLog != null ? filterAgyLogToRunWindow(agyLog, startedMs, undefined, nowMs) : "";
  const pidLines = logWindow.split("\n").map(parseGlog).filter((p) => p && p.pid === runPid);
  if (pidLines.length === 0) {
    return { auth_fallback: "indeterminate", reason: "no run-window cli.log lines attributable to this serve's pid", surface: "no-pid-lines" };
  }

  let lastSuccessIdx = -1;
  for (let i = 0; i < pidLines.length; i++) {
    if (isAuthSuccessLine(pidLines[i])) lastSuccessIdx = i;
  }
  if (lastSuccessIdx >= 0) {
    let hardAfter = false;
    for (let i = lastSuccessIdx + 1; i < pidLines.length; i++) {
      const n = norm(pidLines[i].message);
      if (REVOKING.test(n) || EXPIRED.test(n)) { hardAfter = true; break; }
    }
    if (!hardAfter) {
      return { auth_fallback: false, reason: "authenticated — code-site auth-success with no hard-revoking signal after it", surface: "auth-success" };
    }
  }

  const joined = norm(pidLines.map((p) => p.message).join("\n"));
  if (REVOKING.test(joined) || EXPIRED.test(joined) || STARTUP_TRANSIENT.test(joined)) {
    return { auth_fallback: true, reason: "no code-site auth-success and a terminal/transient tell present in this serve's log", surface: "no-success-with-tell" };
  }

  return { auth_fallback: "indeterminate", reason: "no auth-success and no tell in this serve's run window — cannot verify", surface: "no-signal" };
}

module.exports = {
  NON_AUTH_SIGNAL,
  STARTUP_TRANSIENT,
  REVOKING,
  EXPIRED,
  AUTH_SITES,
  norm,
  parseGlog,
  glogPid,
  isAuthSuccessLine,
  filterAgyLogToRunWindow,
  snapshotAgyLog,
  readAgyLogDelta,
  detectAgyAuthFallback,
};
