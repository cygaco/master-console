"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");

const SCAN_ROOTS = [".claude/commands", ".claude/agents"];
const ROOT_DOCS = ["CLAUDE.md", "AGENTS.md", "AGENT-STRUCTURE.md", "PROJECT.md", "ROADMAP.md"];
const SKIP_DIRS = new Set(["node_modules", ".git", "runtime", "_reports"]);
const PRAGMA = "pipe-masks-gate-lint:allow";
const FENCE_RE = /^```(bash|sh|shell)\b/i;
const PASSTHROUGH_SET = new Set(["tail", "head", "tee", "cat", "less", "more"]);
const WIN_EXEC_EXT_RE = /\.(?:exe|com|bat|cmd)$/i;

function findMdFiles(absRoot, out, unreadable) {
  let entries;
  try { entries = fs.readdirSync(absRoot, { withFileTypes: true }); }
  catch (e) { unreadable.push(`${absRoot} (${e.code || e.message})`); return; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) findMdFiles(path.join(absRoot, e.name), out, unreadable); }
    else if (e.isFile() && e.name.endsWith(".md")) out.push(path.join(absRoot, e.name));
  }
}

function stripComment(s) {
  let prevBoundary = true;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; prevBoundary = false; continue; }
    if (c === "\\") { i++; prevBoundary = false; continue; }
    if (c === '"' || c === "'") { q = c; prevBoundary = false; continue; }
    if (c === "#" && prevBoundary) return s.slice(0, i);
    prevBoundary = /\s/.test(c);
  }
  return s;
}

function splitPipeStages(s) {
  const stages = [];
  let cur = "", q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "|") {
      if (s[i + 1] === "|") { cur += "||"; i++; continue; }
      stages.push(cur); cur = "";
      continue;
    }
    cur += c;
  }
  stages.push(cur);
  return stages;
}

function stageCommandBasename(stage) {
  const s = stage.replace(/^\s+/, "");
  let tok = "", q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else tok += c; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (/[\s|;&<>()]/.test(c)) break;
    tok += c;
  }
  const base = (tok.match(/[^/\\]+$/) || [tok])[0];
  return base.replace(WIN_EXEC_EXT_RE, "").toLowerCase();
}

function hasUnquotedChain(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if ((c === ";" || (c === "&" && s[i + 1] === "&")) && /\S/.test(s.slice(c === ";" ? i + 1 : i + 2))) return true;
  }
  return false;
}

function hasPipeMask(logical) {
  const line = stripComment(logical);
  const stages = splitPipeStages(line);
  for (let si = 1; si < stages.length; si++) {
    if (!PASSTHROUGH_SET.has(stageCommandBasename(stages[si]))) continue;
    if (hasUnquotedChain(stages.slice(si).join("|"))) return true;
  }
  return false;
}

function scanText(text) {
  const findings = [];
  const lines = String(text || "").split("\n");
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (FENCE_RE.test(raw.trim())) { inFence = true; i++; continue; }
    if (inFence && raw.trim().startsWith("```")) { inFence = false; i++; continue; }
    if (!inFence) { i++; continue; }
    const startLine = i;
    let logical = raw;
    while (/\\\s*$/.test(logical) && i + 1 < lines.length) { logical = logical.replace(/\\\s*$/, " ") + lines[i + 1]; i++; }
    if (!logical.includes(PRAGMA) && hasPipeMask(logical)) {
      findings.push({ line: startLine + 1, code: logical.trim().slice(0, 200) });
    }
    i++;
  }
  return findings;
}

function collectFiles(unreadable) {
  const files = [];
  for (const r of SCAN_ROOTS) findMdFiles(path.join(ROOT, r), files, unreadable);
  for (const d of ROOT_DOCS) { const p = path.join(ROOT, d); if (fs.existsSync(p)) files.push(p); }
  return files;
}

if (require.main === module) {
  const unreadable = [];
  const files = collectFiles(unreadable);
  const hits = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch (e) { unreadable.push(`${path.relative(ROOT, f)} (${e.code || e.message})`); continue; }
    for (const h of scanText(text)) hits.push({ file: path.relative(ROOT, f), ...h });
  }
  if (unreadable.length) {
    process.stderr.write(`pipe-masks-gate-lint: FAIL-CLOSED — ${unreadable.length} scan root/file unreadable (mandated surface not scanned):\n`);
    for (const u of unreadable) process.stderr.write(`  ${u}\n`);
    process.exit(2);
  }
  if (hits.length === 0) {
    process.stdout.write(`pipe-masks-gate-lint: OK — no pipe-masks-gate patterns in ${files.length} scanned command doc(s).\n`);
    process.exit(0);
  }
  process.stderr.write("pipe-masks-gate-lint: FAIL — a gate piped through a passthrough filter then chained (&&/;) — the pipe masks the gate's exit:\n");
  for (const h of hits) process.stderr.write(`  ${h.file}:${h.line}  ${h.code}\n`);
  process.stderr.write("Fix: run the gate as its OWN command and read its real exit code; truncate output separately if needed (CLAUDE.md Tool-Use). Add `# pipe-masks-gate-lint:allow` to a sanctioned illustrative line.\n");
  process.exit(1);
}

module.exports = { scanText, hasPipeMask, stageCommandBasename };
