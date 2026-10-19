#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

function resolveRoot() {
  const anchor = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchor, ".claude"))) return anchor;
  return process.env.CLAUDE_PROJECT_DIR || anchor;
}
const ROOT = resolveRoot();

const SCAN_DIRS = ["scripts"];
const EXCLUDE_BASENAMES = new Set([
  "acceptance-record.js",
  "acceptance-read-choke-point.js",
]);

const CROSS_SESSION_EXEMPT = Object.freeze({});

const MERGE_HINT = /merge|integrat/i;
const MERGE_ACTION = /\b(?:merge|mergeInto|integrate|commitIntegration|performRefUpdate)\s*\(|git[\s"'`]+merge\b|update-ref/i;
const SUCCESS_PREDICATE = /\.success\s*===\s*true|\.success\s*!==\s*true|\.success\b(?!\s*[=!])|\[\s*["']success["']\s*\]/;
const VERIFIES = /authorizesIntegration|acceptance-record(\.js)?/;
const WINDOW = 12;

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function listJs(absDir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    if (e.isDirectory()) out.push(...listJs(abs));
    else if (e.isFile() && e.name.endsWith(".js") && !e.name.endsWith(".test.js")) out.push(abs);
  }
  return out;
}

function scan(root = ROOT) {
  const violations = [];
  const exemptSeen = [];
  for (const d of SCAN_DIRS) {
    for (const abs of listJs(path.join(root, d))) {
      if (EXCLUDE_BASENAMES.has(path.basename(abs))) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      let text;
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      if (!MERGE_HINT.test(text)) continue;
      const lines = text.split(/\r?\n/);
      const successLines = [];
      for (let i = 0; i < lines.length; i++) if (SUCCESS_PREDICATE.test(lines[i])) successLines.push(i);
      if (successLines.length === 0) continue;
      if (CROSS_SESSION_EXEMPT[rel]) {
        exemptSeen.push(rel);
        continue;
      }
      for (const i of successLines) {
        const from = Math.max(0, i - WINDOW);
        const to = Math.min(lines.length, i + WINDOW + 1);
        const win = lines.slice(from, to).join("\n");
        const winClean = stripComments(win);
        if (!MERGE_ACTION.test(winClean)) continue;
        if (!VERIFIES.test(winClean)) {
          violations.push({
            file: rel,
            line: i + 1,
            what: `a ResultEnvelope success predicate (\`${lines[i].trim().slice(0, 80)}\`) authorizing a merge with NO acceptance-record routing within ±${WINDOW} lines — route it through acceptance-record.js#authorizesIntegration, or add a reason-tagged STRUCTURAL cross-session exemption (never a code comment)`,
          });
        }
      }
    }
  }
  const staleExempt = Object.keys(CROSS_SESSION_EXEMPT).filter((f) => !fs.existsSync(path.join(root, f)));
  return { violations, exemptSeen, staleExempt };
}

module.exports = { scan, MERGE_HINT, SUCCESS_PREDICATE, VERIFIES, CROSS_SESSION_EXEMPT };

if (require.main === module) {
  const json = process.argv.includes("--json");
  let res;
  try {
    res = scan();
  } catch (e) {
    process.stderr.write(`acceptance-read-choke-point: internal error (fail-closed): ${e.message}\n`);
    process.exit(2);
  }
  const fail = res.violations.length > 0 || res.staleExempt.length > 0;
  if (json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  } else if (!fail) {
    process.stdout.write(
      `OK   [acceptance-read-choke-point] every merge/integrate reader routes through acceptance-record.authorizesIntegration` +
        ` (${res.exemptSeen.length} cross-session reader(s) structurally exempt). NOTE: bounded LEXICAL guard` +
        ` (defense-in-depth) — the runtime guarantee is IN-PRIMITIVE (commitIntegration requires` +
        ` authorizesIntegration); definitive close = pinned trusted checker.\n`,
    );
  } else {
    if (res.violations.length) {
      process.stdout.write(`FAIL [acceptance-read-choke-point] ${res.violations.length} un-routed integrator(s) trust ResultEnvelope.success directly:\n`);
      for (const v of res.violations) process.stdout.write(`  ${v.file}${v.line ? ":" + v.line : ""}\n    ${v.what}\n`);
      process.stdout.write("  Route the merge/integrate decision through scripts/dispatch/acceptance-record.js#authorizesIntegration, or add a STRUCTURAL cross-session exemption with a reason.\n");
    }
    for (const f of res.staleExempt) process.stdout.write(`  STALE cross-session exemption for a non-existent file: ${f}\n`);
  }
  process.exit(fail ? 1 : 0);
}
