#!/usr/bin/env node
// MC 1.2.0 -> 2.0.0 migration 002 — downstream product SETTINGS: legacy hook wiring + env keys -> mc.
//
// S-OS-06 T4 (T-20260913-363). Targets .claude/settings.json and (when present) .claude/settings.local.json.
//   env keys      WARPOS_<X> -> MC_<X>. MC_<X> absent -> renamed in place (value kept). MC_<X> present and equal ->
//                 the legacy key is dropped. MC_<X> present and DIFFERENT -> both kept and reported (the framework's
//                 read-both helper, scripts/hooks/lib/mc-env.js, already resolves MC_ first — this never picks a value).
//   strings       every string VALUE (hook commands, statusLine, _disabled_hooks reasons, env values, ...) gets its
//                 legacy PATH SEGMENTS rewritten: scripts/warpos/ -> scripts/mc/, _warpos/ -> _mc/, .warpos/ -> .mc/,
//                 and env-name tokens WARPOS_<X> -> MC_<X>. Prose ("WarpOS-v1 plan") is left alone.
//   permissions   permissions.allow / deny / ask entries are TWINNED, not replaced: the mc rewrite is inserted right
//                 after the legacy rule, which stays for the compat window (callers still invoking the legacy
//                 `WARPOS_X=1 node ...` form must keep matching their prefix rule).
//   _compiledBy   warpos/settings-compiler/<v> -> mc/settings-compiler/<v> (scripts/mc/settings/compile.js).
//   NEVER         HOME-anchored legacy state: ~/.warpos, $HOME/.warpos, ${HOME}/.warpos, %USERPROFILE%\.warpos, an
//                 absolute os.homedir() path, and .codex-warpos / .warpos-backup. T3 part 5 reads HOME state in place and
//                 never auto-moves it, so a setting naming it must keep matching the real on-disk location.
//
// CLASS-3 DATA: the legacy literals below are what this migration operates ON; migrations/1.2.0-to-2.0.0/ is a
// Class-3, write-protected partition entry (the S-OS-06 partition's futureEntries, a frozen baseline key, read only via
// scripts/open-source/partition-loader.js) — no codemod or purity pass may rewrite them.
//
// Idempotent: a migrated file re-serializes identically -> status "noop", nothing written. EOL style is preserved; a
// PowerShell BOM is tolerated on read and never written back. An unparseable settings file returns ok:false (the
// loader halts; update.js rolls back), matching migrations/0.7.0-to-0.7.1/001.
//
// Invoked by update.js via migrations-loader (apply() / plan()) AND runnable as a CLI (main(); --plan = read-only).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const SETTINGS_RELS = [".claude/settings.json", ".claude/settings.local.json"];
const LEGACY_ENV_PREFIX = "WARPOS_";
const CURRENT_ENV_PREFIX = "MC_";
const LEGACY_COMPILER_RE = /^warpos\/settings-compiler\//;
const CURRENT_COMPILER_PREFIX = "mc/settings-compiler/";
const TWIN_ARRAYS = ["permissions.allow", "permissions.deny", "permissions.ask"];

const HOME_TOKEN_BEFORE_RE = /(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%|%HOMEDRIVE%%HOMEPATH%)[\\/]$/i;

const STRING_RULES = [
  { id: "scripts-dir", re: /(?<=\bscripts[\\/]+)warpos(?![\w-])/g, to: "mc", homeGuard: false },
  { id: "underscore-root", re: /(?<![\w.$%~-])_warpos(?![\w-])/g, to: "_mc", homeGuard: false },
  { id: "dot-root", re: /(?<![\w.-])\.warpos(?![\w-])/g, to: ".mc", homeGuard: true },
  { id: "env-prefix", re: /(?<!\w)WARPOS_(?=[A-Z0-9])/g, to: "MC_", homeGuard: false },
];

function resolveRoot(ctx) {
  return (ctx && ctx.targetRoot) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function homeAnchored(before, homeDir) {
  if (HOME_TOKEN_BEFORE_RE.test(before)) return true;
  if (!homeDir) return false;
  const norm = (p) => String(p).replace(/[\\/]+/g, "/").toLowerCase();
  return norm(before).endsWith(`${norm(homeDir).replace(/\/+$/, "")}/`);
}

function rewriteString(s, cx) {
  let out = s;
  for (const rule of STRING_RULES) {
    out = out.replace(rule.re, (match, offset, whole) => {
      if (rule.homeGuard && homeAnchored(whole.slice(0, offset), cx.homeDir)) return match;
      return rule.to;
    });
  }
  return out;
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function migrateEnv(env, cx, fileReport) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    const value = typeof v === "string" ? rewriteString(v, cx) : v;
    if (typeof v === "string" && value !== v) fileReport.rewrites.push({ at: `env.${k}`, from: v, to: value });
    if (!k.startsWith(LEGACY_ENV_PREFIX)) {
      if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = value;
      continue;
    }
    const ck = CURRENT_ENV_PREFIX + k.slice(LEGACY_ENV_PREFIX.length);
    if (Object.prototype.hasOwnProperty.call(env, ck)) {
      const currentValue = typeof env[ck] === "string" ? rewriteString(env[ck], cx) : env[ck];
      if (currentValue === value) {
        fileReport.env.push({ from: k, to: ck, action: "dropped-identical-legacy" });
        continue;
      }
      fileReport.env.push({ from: k, to: ck, action: "kept-divergent (MC_ wins at read time)" });
      out[k] = value;
      continue;
    }
    out[ck] = value;
    fileReport.env.push({ from: k, to: ck, action: "renamed" });
  }
  return out;
}

function walk(node, keyPath, cx, fileReport) {
  if (typeof node === "string") {
    const next = rewriteString(node, cx);
    if (next !== node) fileReport.rewrites.push({ at: keyPath, from: node, to: next });
    return next;
  }
  if (Array.isArray(node)) {
    if (TWIN_ARRAYS.includes(keyPath)) {
      const result = [];
      for (const item of node) {
        result.push(item);
        if (typeof item !== "string") continue;
        const twin = rewriteString(item, cx);
        if (twin !== item && !node.includes(twin) && !result.includes(twin)) {
          result.push(twin);
          fileReport.twins.push({ at: keyPath, legacy: item, twin });
        }
      }
      return result;
    }
    return node.map((item, i) => walk(item, `${keyPath}[${i}]`, cx, fileReport));
  }
  if (isPlainObject(node)) {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const childPath = keyPath ? `${keyPath}.${k}` : k;
      if (childPath === "env" && isPlainObject(v)) {
        out[k] = migrateEnv(v, cx, fileReport);
      } else if (k === "_compiledBy" && typeof v === "string" && LEGACY_COMPILER_RE.test(v)) {
        out[k] = v.replace(LEGACY_COMPILER_RE, CURRENT_COMPILER_PREFIX);
        fileReport.rewrites.push({ at: childPath, from: v, to: out[k] });
      } else {
        out[k] = walk(v, childPath, cx, fileReport);
      }
    }
    return out;
  }
  return node;
}

function migrateFile(root, rel, apply, cx) {
  const file = path.join(root, ...rel.split("/"));
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { ok: true, file: rel, status: "absent" };
    return { ok: false, file: rel, status: "read-failed", reason: `${rel}: ${e.message}` };
  }
  let settings;
  try {
    settings = JSON.parse(raw.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, file: rel, status: "parse-failed", reason: `${rel} is not valid JSON: ${e.message}` };
  }
  if (!isPlainObject(settings)) return { ok: false, file: rel, status: "not-an-object", reason: `${rel} root is not a JSON object` };

  const fileReport = { ok: true, file: rel, status: "noop", env: [], rewrites: [], twins: [] };
  const next = walk(settings, "", cx, fileReport);
  if (JSON.stringify(next) === JSON.stringify(settings)) return fileReport;

  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const out = JSON.stringify(next, null, 2).replace(/\n/g, eol) + eol;
  fileReport.status = apply ? "migrated" : "planned";
  if (apply) {
    try {
      fs.writeFileSync(file, out, "utf8");
    } catch (e) {
      return { ok: false, file: rel, status: "write-failed", reason: `${rel}: ${e.message}` };
    }
  }
  return fileReport;
}

function run(root, apply, ctx) {
  const cx = { homeDir: (ctx && ctx.homeDir) || os.homedir() };
  const files = [];
  for (const rel of SETTINGS_RELS) {
    const r = migrateFile(root, rel, apply, cx);
    files.push(r);
    if (!r.ok) return { ok: false, status: "failed", reason: r.reason, files };
  }
  const changed = files.some((f) => f.status === "migrated" || f.status === "planned");
  return { ok: true, status: changed ? (apply ? "migrated" : "planned") : "noop", files };
}

function toOps(r) {
  if (!r.ok) return [{ op: "error", reason: r.reason }];
  const ops = [];
  for (const f of r.files) {
    for (const e of f.env || []) ops.push({ op: "env", file: f.file, ...e });
    for (const w of f.rewrites || []) ops.push({ op: "rewrite", file: f.file, ...w });
    for (const t of f.twins || []) ops.push({ op: "twin-permission", file: f.file, ...t });
  }
  return ops;
}

async function apply(ctx) {
  return run(resolveRoot(ctx), true, ctx);
}

async function plan(ctx) {
  return toOps(run(resolveRoot(ctx), false, ctx));
}

function main(argv = process.argv.slice(2)) {
  const r = run(resolveRoot(null), !argv.includes("--plan"), null);
  for (const f of r.files) {
    const n = (a) => (Array.isArray(a) ? a.length : 0);
    console.log(`[002] ${f.file}: ${f.status} env=${n(f.env)} rewrites=${n(f.rewrites)} twins=${n(f.twins)}`);
    for (const e of f.env || []) if (e.action.startsWith("kept")) console.log(`  kept ${e.from} beside ${e.to} — ${e.action}`);
  }
  if (!r.ok) console.error(`[002] ${r.reason}`);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  id: "002-warpos-to-mc-settings",
  from: "1.2.0",
  to: "2.0.0",
  description:
    "Rewire .claude/settings(.local).json for mc@2.0.0: WARPOS_* env keys -> MC_* (divergent pairs kept), legacy path segments in hook wiring -> mc, permission rules twinned, _compiledBy -> mc/settings-compiler; HOME-anchored legacy state never rewritten.",
  apply,
  plan,
  main,
};
