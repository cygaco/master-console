#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function dotenvParse(text) {
  const out = {};
  const suspicious = [];
  if (text == null) return { values: out, suspicious };
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  for (const rawLine of s.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    const quoted = /^(["']).*\1$/.test(val);
    if (quoted) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(" #");
      if (hash >= 0) val = val.slice(0, hash);
      val = val.trim();
    }
    if (/\$\(|`/.test(val)) suspicious.push(key);
    out[key] = val;
  }
  return { values: out, suspicious };
}

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function sourceChain(keyName) {
  const home = os.homedir();
  const chain = [];

  const overrideEnv = `${keyName.replace(/_API_KEY$/, "")}_KEY_FILE`;
  if (process.env[overrideEnv]) {
    chain.push({ label: `override:${overrideEnv}`, kind: "keyfile", file: process.env[overrideEnv], key: keyName });
  }

  chain.push({ label: "process.env", kind: "env", key: keyName });

  chain.push({ label: ".env.local", kind: "dotenv", file: path.join(PROJECT_ROOT, ".env.local"), key: keyName });
  chain.push({ label: ".env", kind: "dotenv", file: path.join(PROJECT_ROOT, ".env"), key: keyName });

  if (/^GEMINI_API_KEY$|^GOOGLE_API_KEY$/.test(keyName)) {
    chain.push({ label: "~/.gemini/.env", kind: "dotenv", file: path.join(home, ".gemini", ".env"), key: "GEMINI_API_KEY" });
    chain.push({ label: "~/.gemini/oauth", kind: "gemini-oauth" });
  }
  return chain;
}

function readSource(src) {
  switch (src.kind) {
    case "env": {
      const v = process.env[src.key];
      return v && v.trim() ? v.trim() : null;
    }
    case "keyfile": {
      const txt = readFileSafe(src.file);
      if (txt == null) return null;
      const parsed = dotenvParse(txt);
      if (parsed.values[src.key]) return parsed.values[src.key].trim();
      const bare = String(txt).replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
      return bare || null;
    }
    case "dotenv": {
      const txt = readFileSafe(src.file);
      if (txt == null) return null;
      const parsed = dotenvParse(txt);
      const v = parsed.values[src.key];
      return v && v.trim() ? v.trim() : null;
    }
    case "gemini-oauth": {
      for (const credsPath of [
        path.join(os.homedir(), ".gemini", "oauth_creds.json"),
        path.join(os.homedir(), ".config", "gemini", "oauth_creds.json"),
      ]) {
        const txt = readFileSafe(credsPath);
        if (!txt) continue;
        try {
          const creds = JSON.parse(txt);
          if (creds && (creds.refresh_token || creds.access_token)) return "__oauth__";
        } catch {
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function resolveKey(keyName, opts = {}) {
  const chain = sourceChain(keyName);
  const checked = [];
  for (const src of chain) {
    checked.push(src.label);
    const v = readSource(src);
    if (v) {
      const oauth = v === "__oauth__";
      const parsedSuspicious = !oauth && /\$\(|`/.test(v);
      const result = {
        key: keyName,
        found: true,
        source: src.label,
        checked,
        length: oauth ? 0 : v.length,
        oauth,
        suspicious: parsedSuspicious,
      };
      if (opts.withValue && !oauth) result.value = v;
      return result;
    }
  }
  return { key: keyName, found: false, source: null, checked, length: 0, oauth: false, suspicious: false };
}

function unavailableMessage(res) {
  return `${res.key} unavailable after checking: ${res.checked.join(" → ")}. ` +
    `Set it in .env.local, export it, or point ${res.key.replace(/_API_KEY$/, "")}_KEY_FILE at a key-file.`;
}

function probe(keyName, opts = {}) {
  const res = resolveKey(keyName, { withValue: opts.mode === "live" });
  if (!res.found) {
    return { key: keyName, found: false, source: null, valid: false, reason: unavailableMessage(res) };
  }
  if (res.oauth) {
    return { key: keyName, found: true, source: res.source, valid: null, reason: "OAuth session present (no raw key to format-check; live probe handled by the CLI)." };
  }
  if (res.suspicious) {
    return { key: keyName, found: true, source: res.source, valid: false, reason: `value from ${res.source} contains shell metacharacters ($(/backtick) — refusing to trust (possible injection / corruption).` };
  }
  if (opts.mode !== "live") {
    const plausible = res.length >= 20;
    return {
      key: keyName,
      found: true,
      source: res.source,
      valid: plausible ? null : false,
      reason: plausible
        ? `present (source=${res.source}, len=${res.length}); live validity NOT probed — pass mode:"live" for a real auth call.`
        : `present but implausibly short (len=${res.length}) — likely a placeholder/truncated key.`,
    };
  }
  if (typeof opts.liveCheck === "function") {
    let ok = false, reason = "live check failed";
    try {
      const r = opts.liveCheck(res.value);
      ok = !!(r && (r === true || r.ok));
      reason = ok ? `live auth OK (source=${res.source})` : (r && r.reason) || "live auth check returned false";
    } catch (e) {
      ok = false;
      reason = `live check threw: ${e && e.message ? e.message : e}`;
    }
    return { key: keyName, found: true, source: res.source, valid: ok, reason };
  }
  return { key: keyName, found: true, source: res.source, valid: null, reason: `present (source=${res.source}); no liveCheck supplied — caller must perform the bounded authenticated call.` };
}

module.exports = { resolveKey, dotenvParse, unavailableMessage, probe, sourceChain, PROJECT_ROOT };

if (require.main === module) {
  const [, , cmd, ...keys] = process.argv;
  if (cmd === "report") {
    const targets = keys.length ? keys : ["OPENAI_API_KEY", "GEMINI_API_KEY"];
    const report = targets.map((k) => {
      const r = resolveKey(k);
      return {
        key: r.key,
        found: r.found,
        source: r.source,
        length: r.length,
        oauth: r.oauth,
        suspicious: r.suspicious,
        checked: r.checked,
        ...(r.found ? {} : { hint: unavailableMessage(r) }),
      };
    });
    process.stdout.write(JSON.stringify({ ok: true, report }, null, 2) + "\n");
    process.exit(0);
  }
  process.stderr.write("usage: node scripts/dispatch/auth-resolver.js report [KEY ...]\n");
  process.exit(2);
}
