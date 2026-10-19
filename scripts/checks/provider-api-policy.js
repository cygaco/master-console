#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "provider-api-policy";
const ALLOWLIST_FILE = path.join(__dirname, "provider-api-policy.allowlist.json");

const TEXT_EXT = new Set([".js", ".json", ".md", ".ts", ".mjs", ".cjs", ".sh"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "runtime", ".provider-tmp"]);

const norm = (p) => p.replace(/\\/g, "/");

const PROVIDER_HOSTS = ["api.openai.com", "generativelanguage.googleapis.com"];

const HOST_SIGNATURES = [
  { re: /api\.openai\.com/, label: "api.openai.com host literal" },
  { re: /generativelanguage\.googleapis\.com/, label: "generativelanguage.googleapis.com host literal" },
];
const SDK_SIGNATURES = [
  { re: /new\s+OpenAI\s*\(/, label: "new OpenAI( SDK constructor" },
  { re: /responses\.create/, label: "responses.create SDK call" },
  { re: /chat\.completions/, label: "chat.completions SDK call" },
];
const RAW_HTTP = /fetch\s*\(|https?\.request\s*\(/;

const lineNamesProviderHost = (line) => PROVIDER_HOSTS.some((h) => line.includes(h));

function evaluate({ files, allowlist }) {
  const allow = new Map((allowlist || []).filter((a) => a && a.path).map((a) => [norm(a.path), String(a.reason || "")]));
  const matchedAllow = new Set();
  const findings = [];
  const allowed = [];

  for (const f of files || []) {
    const rel = norm(f.path);
    const text = typeof f.text === "string" ? f.text : "";
    const hits = scanText(text);
    if (hits.length === 0) continue;
    if (allow.has(rel)) {
      matchedAllow.add(rel);
      allowed.push({ path: rel, reason: allow.get(rel), hits: hits.length });
      continue;
    }
    findings.push({ severity: "high", check: NAME, kind: "provider-api-when-cli", path: rel, hits });
  }

  const stale = [...allow.keys()].filter((p) => !matchedAllow.has(p));
  return { findings, allowed, stale };
}

function scanText(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const s of HOST_SIGNATURES) if (s.re.test(line)) out.push(mkHit(i + 1, s.label, line));
    for (const s of SDK_SIGNATURES) if (s.re.test(line)) out.push(mkHit(i + 1, s.label, line));
    if (RAW_HTTP.test(line) && lineNamesProviderHost(line)) {
      out.push(mkHit(i + 1, "raw fetch/https.request to a provider host", line));
    }
  }
  return out;
}

function mkHit(line, signature, raw) {
  return { line, signature, snippet: raw.trim().slice(0, 160) };
}

function scanFiles(root) {
  const out = [];
  for (const sub of ["scripts", path.join(".claude", "commands"), path.join(".claude", "agents")]) {
    const abs = path.join(root, sub);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) out.push(file);
  }
  let topEntries = [];
  try {
    topEntries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
  }
  for (const ent of topEntries) {
    if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) out.push(path.join(root, ent.name));
  }
  const seen = new Set();
  const files = [];
  for (const abs of out) {
    const rel = norm(path.relative(root, abs));
    if (seen.has(rel)) continue;
    seen.add(rel);
    files.push({ path: rel, text: fs.readFileSync(abs, "utf8") });
  }
  return files;
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      yield* walk(path.join(dir, ent.name));
    } else if (ent.isFile() && TEXT_EXT.has(path.extname(ent.name).toLowerCase())) {
      yield path.join(dir, ent.name);
    }
  }
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return [];
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8").replace(/^﻿/, ""));
  return (raw.allow || [])
    .filter((e) => e && typeof e.path === "string")
    .map((e) => ({ path: e.path, reason: String(e.reason || "") }));
}

function run() {
  const notes = [];
  let allowlist;
  try {
    allowlist = loadAllowlist();
  } catch (e) {
    return { ok: false, fatal: true, problems: [`allowlist unreadable: ${e.message}`], notes };
  }
  let files;
  try {
    files = scanFiles(ROOT);
  } catch (e) {
    return { ok: false, fatal: true, problems: [`source scan failed: ${e.message}`], notes };
  }

  const { findings, allowed, stale } = evaluate({ files, allowlist });

  for (const p of stale) {
    notes.push(`stale-allowlist-entry: '${p}' is on the allowlist but matched no raw-API hit (safe to remove).`);
  }
  notes.push(
    `${files.length} source file(s) scanned · ${findings.length} with raw-API usage outside allowlist · ${allowed.length} allowlisted hit(s)`,
  );

  const problems = findings.map(
    (f) =>
      `${f.path} uses raw provider API (${f.hits.map((h) => `L${h.line}: ${h.signature}`).join("; ")}). agent-dispatch-guide §1: CLI is mandatory for dispatch; raw API is allowed ONLY for no-CLI capabilities (deep-research, GPT-Pro). Route via dispatch-agent.js / dispatch-claude.js — or, if this is a sanctioned no-CLI use, add it to provider-api-policy.allowlist.json with a reason.`,
  );
  return { ok: findings.length === 0, fatal: false, problems, notes, findings, allowed };
}

function main() {
  const asJson = process.argv.includes("--json");
  const enforce = process.argv.includes("--strict") || mcEnv.readEnv("PROVIDER_API_POLICY_ENFORCE") === "block";
  let res;
  try {
    res = run();
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: false, check: NAME, error: msg }) : `ERROR  [${NAME}] runner error (fail-closed): ${msg}`) + "\n",
    );
    process.exit(2);
  }
  const mode = enforce ? "blocking" : "report-only";
  if (asJson) {
    process.stdout.write(JSON.stringify({ mode, ...res }, null, 2) + "\n");
    process.exit(res.fatal ? 2 : enforce && !res.ok ? 1 : 0);
  }
  if (res.fatal) {
    process.stderr.write(`ERROR  [${NAME}] ${res.problems.join(" · ")}\n`);
    process.exit(2);
  }
  if (res.ok) {
    process.stdout.write(`PASS [${NAME}] ${res.notes.join(" · ")}\n`);
    process.exit(0);
  }
  const label = enforce ? "FAIL" : "WARN";
  process.stderr.write(`${label} [${NAME}] (${mode}) ${res.findings.length} file(s) use raw provider API outside the allowlist:\n`);
  for (const f of res.findings) {
    process.stderr.write(`  - ${f.path}\n`);
    for (const h of f.hits) process.stderr.write(`      L${h.line}: ${h.signature}  ${h.snippet}\n`);
  }
  if (res.notes.length) process.stderr.write(`  (${res.notes.join(" · ")})\n`);
  process.exit(enforce ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  evaluate,
  scanText,
  scanFiles,
  loadAllowlist,
  run,
  PROVIDER_HOSTS,
  ALLOWLIST_FILE,
};
