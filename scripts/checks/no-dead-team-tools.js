#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "no-dead-team-tools";
const TEXT_EXT = new Set([".js", ".md", ".json", ".ts", ".mjs", ".cjs"]);

const UNIVERSAL_SKIP_DIRS = new Set([".git", "node_modules", ".provider-tmp", ".worktrees"]);

const SKIP_PREFIXES = [
  ".claude/project/events",
  ".claude/agents/president/_system/policy/adr",
  "_docs",
  "_planning",
  "_reports",
  "_mc",
  "runtime",
  "tests/regression",
];
const SKIP_SEGMENTS = new Set(["BASELINE", "EXAMPLES"]);
const SELF_FILES = new Set([
  "scripts/checks/no-dead-team-tools.js",
  "scripts/checks/no-dead-team-tools.test.js",
]);
const SCAN_ROOTS = ["scripts", ".claude/commands", ".claude/agents", ".claude/project"];

function relSkipped(rel) {
  const norm = String(rel).replace(/\\/g, "/");
  if (SELF_FILES.has(norm)) return true;
  for (const pre of SKIP_PREFIXES) {
    if (norm === pre || norm.startsWith(pre + "/")) return true;
  }
  for (const s of norm.split("/")) {
    if (SKIP_SEGMENTS.has(s)) return true;
  }
  return false;
}

const DEAD_TOOL_RE = /\bTeam(?:Create|Delete)\s*\(/;

function lineIsExempt() {
  return false;
}

function evaluate(input) {
  const files = (input && input.files) || [];
  const offenders = [];
  for (const f of files) {
    const content = typeof f.content === "string" ? f.content : "";
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!DEAD_TOOL_RE.test(line)) continue;
      if (lineIsExempt(line)) continue;
      offenders.push({
        path: f.path,
        line: i + 1,
        lineno: i + 1,
        text: line.trim().slice(0, 200),
      });
    }
  }
  return { ok: offenders.length === 0, offenders };
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, "/");
    if (ent.isDirectory()) {
      if (UNIVERSAL_SKIP_DIRS.has(ent.name)) continue;
      if (relSkipped(rel)) continue;
      yield* walk(full);
    } else if (ent.isFile() && TEXT_EXT.has(path.extname(ent.name).toLowerCase())) {
      if (relSkipped(rel)) continue;
      yield full;
    }
  }
}

function assertRemediationExists() {
  const AGENT_SPAWN_RE =
    /Agent\(\s*[\s\S]{0,400}?subagent_type[\s\S]{0,400}?run_in_background\s*[:=]\s*true/i;
  const required = [".claude/commands/mode/sprint.md", ".claude/commands/mode/adhoc.md"];
  const offenders = [];
  for (const rel of required) {
    const abs = path.join(ROOT, rel);
    let ok = false;
    try {
      ok = AGENT_SPAWN_RE.test(fs.readFileSync(abs, "utf8"));
    } catch {
      ok = false;
    }
    if (!ok) {
      offenders.push({
        path: rel,
        line: 0,
        lineno: 0,
        text:
          "NEW remediation not found: no real Agent(subagent_type…, run_in_background:true) spawn shape in this migrated mode skill — a dead-tool migration must leave a WORKING spawn path, not just the keyword",
      });
    }
  }
  return offenders;
}

function run() {
  const files = [];
  let scanned = 0;
  for (const root of SCAN_ROOTS) {
    const abs = path.join(ROOT, root);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file);
      if (relSkipped(rel)) continue;
      try {
        files.push({ path: rel, content: fs.readFileSync(file, "utf8") });
        scanned++;
      } catch {
      }
    }
  }
  const base = evaluate({ files });
  const offenders = base.offenders.slice();
  for (const miss of assertRemediationExists()) offenders.push(miss);
  return { ok: offenders.length === 0, offenders, scanned };
}

module.exports = { evaluate, assertRemediationExists, relSkipped };

if (require.main === module) {
  const JSON_OUT = process.argv.includes("--json");
  let res;
  try {
    res = run();
  } catch (e) {
    const msg = e && e.message ? e.message : e;
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: String(msg) }));
    else console.error(`[${NAME}] runner error (fail-closed): ${msg}`);
    process.exit(2);
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ check: NAME, ...res }));
  } else if (res.ok) {
    console.log(
      `OK   [${NAME}] no live TeamCreate/TeamDelete directives in ${res.scanned} file(s) (+ remediation present)`,
    );
  } else {
    console.error(
      `FAIL [${NAME}] ${res.offenders.length} live directive(s) to a REMOVED team tool (TeamCreate/TeamDelete were removed in Claude Code v2.1.178) — use the Agent(run_in_background:true) spawn instead:`,
    );
    for (const o of res.offenders) console.error(`  - ${o.path}:${o.lineno}  ${o.text}`);
  }
  process.exit(res.ok ? 0 : 1);
}
