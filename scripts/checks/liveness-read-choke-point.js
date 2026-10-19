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
  "verified-liveness-read.js",
  "attest-signing.js",
  "liveness-read-choke-point.js",
]);

const CROSS_SESSION_EXEMPT = Object.freeze({
  "scripts/mc/test-sealed-capsule-gate.js":
    "verifyTyped reads an ISOLATED child repo's ledger (sealed-capsule gate spawns a foreign session that " +
    "signs with its own per-session secret); unverifiable under the same-session HMAC model (ADR-0025).",
});

const LEDGER_READ = /dispatch-completions|COVERAGE_LEDGER|readCompletions|dispatchCompletionsFile/;
const OK_PREDICATE = /\.ok\s*===\s*true|\.ok\s*!==\s*true/;
const VERIFIES = /isVerifiedLivenessRecord|filterVerifiedLiveness|verified-liveness-read|verifyRecord/;
const WINDOW = 12;
const PRAGMA = /liveness-verified:/;
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
      if (!LEDGER_READ.test(text)) continue;
      const lines = text.split(/\r?\n/);
      const okLines = [];
      for (let i = 0; i < lines.length; i++) if (OK_PREDICATE.test(lines[i])) okLines.push(i);
      if (okLines.length === 0) continue;
      if (CROSS_SESSION_EXEMPT[rel]) {
        exemptSeen.push(rel);
        continue;
      }
      for (const i of okLines) {
        const from = Math.max(0, i - WINDOW);
        const to = Math.min(lines.length, i + WINDOW + 1);
        const win = lines.slice(from, to).join("\n");
        if (!VERIFIES.test(stripComments(win)) && !PRAGMA.test(win)) {
          violations.push({
            file: rel,
            line: i + 1,
            what: `an ok:true ledger predicate (\`${lines[i].trim().slice(0, 80)}\`) with NO origin-proof verification within ±${WINDOW} lines — route it through isVerifiedLivenessRecord or verify with attest-signing.verifyRecord (or annotate a reviewed shape-only check with a \`liveness-verified:\` pragma)`,
          });
        }
      }
    }
  }
  const staleExempt = Object.keys(CROSS_SESSION_EXEMPT).filter((f) => !fs.existsSync(path.join(root, f)));
  return { violations, exemptSeen, staleExempt };
}

module.exports = { scan, LEDGER_READ, OK_PREDICATE, VERIFIES, CROSS_SESSION_EXEMPT };

if (require.main === module) {
  const json = process.argv.includes("--json");
  let res;
  try {
    res = scan();
  } catch (e) {
    process.stderr.write(`liveness-read-choke-point: internal error (fail-closed): ${e.message}\n`);
    process.exit(2);
  }
  const fail = res.violations.length > 0 || res.staleExempt.length > 0;
  if (json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  } else if (!fail) {
    process.stdout.write(
      `OK   [liveness-read-choke-point] every same-session dispatch-liveness reader verifies origin-proof signatures` +
        ` (${res.exemptSeen.length} cross-session reader(s) structurally exempt).\n`,
    );
  } else {
    if (res.violations.length) {
      process.stdout.write(`FAIL [liveness-read-choke-point] ${res.violations.length} same-session reader(s) trust unsigned ok:true records:\n`);
      for (const v of res.violations) process.stdout.write(`  ${v.file}${v.line ? ":" + v.line : ""}\n    ${v.what}\n`);
      process.stdout.write("  Route the ok:true read through scripts/dispatch/verified-liveness-read.js#isVerifiedLivenessRecord (same-session), or add a STRUCTURAL cross-session exemption with a reason.\n");
    }
    for (const f of res.staleExempt) process.stdout.write(`  STALE cross-session exemption for a non-existent file: ${f}\n`);
  }
  process.exit(fail ? 1 : 0);
}
