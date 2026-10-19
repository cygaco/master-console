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
  "dispatch-agent.js",
  "dispatch-record-fields.js",
  "all-writers-route-recordCompletion.js",
]);

const LEDGER_REF = /dispatch-completions|dispatchCompletionsFile/;

const RAW_WRITE_CALL = /\b(?:fs\.(?:promises\.)?|fsp\.)(?:appendFile|writeFile|createWriteStream)(?:Sync)?\s*\(\s*([^)\n]*)/g;

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

function findAssignment(lines, varName, beforeIndex) {
  const re = new RegExp(`(?:^|[^.\\w$])${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=(?!=)`);
  for (let i = beforeIndex; i >= 0; i--) {
    if (re.test(lines[i])) {
      const windowEnd = Math.min(lines.length, i + 6);
      return lines.slice(i, windowEnd).join("\n");
    }
  }
  return "";
}

function scan(root = ROOT) {
  const violations = [];
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
      if (!LEDGER_REF.test(text)) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        RAW_WRITE_CALL.lastIndex = 0;
        let m;
        while ((m = RAW_WRITE_CALL.exec(lines[i]))) {
          const argRegion = m[1] || "";
          let bypasses = false;
          let reason = "";
          if (LEDGER_REF.test(argRegion)) {
            bypasses = true;
            reason = `writes to a target whose first-arg expression references the ledger (\`${argRegion.trim().slice(0, 60)}\`) — direct, nested (path.resolve/join), or async (fs.promises) form`;
          } else {
            const leadMatch = argRegion.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
            const lead = leadMatch && leadMatch[1];
            if (lead) {
              const assign = findAssignment(lines, lead, i);
              if (assign && LEDGER_REF.test(assign)) {
                bypasses = true;
                reason = `writes to \`${lead}\`, which is assigned from the ledger path a few lines above`;
              }
            }
          }
          if (bypasses) {
            violations.push({
              file: rel,
              line: i + 1,
              what: `raw fs write (\`${lines[i].trim().slice(0, 100)}\`) — ${reason} — with no route through recordCompletion/recordDeath/recordDispatchStart. Route the write through the dispatch-agent.js sink instead of writing the ledger record directly.`,
            });
          }
        }
      }
    }
  }
  return { violations };
}

module.exports = { scan, LEDGER_REF, RAW_WRITE_CALL };

if (require.main === module) {
  const json = process.argv.includes("--json");
  let res;
  try {
    res = scan();
  } catch (e) {
    process.stderr.write(`all-writers-route-recordCompletion: internal error (fail-closed): ${e.message}\n`);
    process.exit(2);
  }
  const fail = res.violations.length > 0;
  if (json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  } else if (!fail) {
    process.stdout.write(
      `OK   [all-writers-route-recordCompletion] every dispatch-completions writer routes through the recordCompletion/recordDeath/recordDispatchStart sink.\n`,
    );
  } else {
    process.stdout.write(`FAIL [all-writers-route-recordCompletion] ${res.violations.length} writer(s) bypass the recordCompletion sink:\n`);
    for (const v of res.violations) process.stdout.write(`  ${v.file}:${v.line}\n    ${v.what}\n`);
  }
  process.exit(fail ? 1 : 0);
}
