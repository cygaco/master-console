#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");

const REQUIRED_DIRS = [
  "_requirements/_audits",
  "_requirements/_index",
  "_requirements/_shared",
  "_requirements/_standards",
  "_requirements/00-canonical",
  "_requirements/01-design-system",
  "_requirements/02-copy-system",
  "_requirements/03-architecture",
  "_requirements/04-features",
  "_requirements/05-operations",
  "_requirements/06-security",
  "_requirements/07-testing",
  "_requirements/08-automation",
  "_docs",
  "framework",
  ".claude/agents",
  ".claude/commands",
  ".claude/project/reference",
  "scripts/hooks",
  "scripts/checks",
  "scripts/paths",
  "scripts/mc",
  "patterns",
  "schemas",
];

const missing = REQUIRED_DIRS.filter((d) => !fs.existsSync(path.join(ROOT, d)));

if (missing.length === 0) {
  if (JSON_OUT)
    console.log(JSON.stringify({ ok: true, count: REQUIRED_DIRS.length }));
  else
    console.log(
      `OK   [mc-structure-parity] all ${REQUIRED_DIRS.length} skeleton dirs present`,
    );
  process.exit(0);
}

const out = {
  ok: false,
  missing,
  present: REQUIRED_DIRS.length - missing.length,
};
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.error(
    `FAIL [mc-structure-parity] ${missing.length} skeleton dir(s) missing:`,
  );
  for (const m of missing) console.error(`  - ${m}/`);
  console.error(
    "\nFix: run /mc:update --apply to pull canonical's structure, or recreate the dirs by hand.",
  );
}
process.exit(1);
