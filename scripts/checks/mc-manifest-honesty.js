#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const cHash = require("../mc/lib/content-hash");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");

const installedFile = path.join(ROOT, ".claude", "framework-installed.json");
if (!fs.existsSync(installedFile)) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({ ok: true, reason: "no framework-installed.json" }),
    );
  else
    console.log(
      "OK   [mc-manifest-honesty] not a MC-installed project",
    );
  process.exit(0);
}
const installed = JSON.parse(fs.readFileSync(installedFile, "utf8"));
const assets = installed.assets || [];

const issues = [];
let checked = 0;
for (const a of assets) {
  if (a.owner === "project") continue;
  const dest = path.join(ROOT, a.dest);
  if (!fs.existsSync(dest)) {
    issues.push({ kind: "missing", file: a.dest });
    continue;
  }
  if (a.installedHash) {
    const localContent = cHash.contentHash(dest);
    if (!cHash.hashMatches(localContent, a.installedHash)) {
      const localRaw = cHash.rawHash(dest);
      if (!cHash.hashMatches(localRaw, a.installedHash)) {
        issues.push({
          kind: "drift",
          file: a.dest,
          expected: a.installedHash,
          actual: localContent,
        });
      }
    }
  }
  checked++;
}

if (issues.length === 0) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, checked }));
  else
    console.log(
      `OK   [mc-manifest-honesty] ${checked} framework assets verified`,
    );
  process.exit(0);
}
const out = {
  ok: false,
  checked,
  issues: issues.slice(0, 30),
  totalIssues: issues.length,
};
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.error(
    `FAIL [mc-manifest-honesty] ${issues.length} drift issue(s) (${checked} assets checked):`,
  );
  for (const i of issues.slice(0, 10))
    console.error(`  - [${i.kind}] ${i.file}`);
  if (issues.length > 10) console.error(`  ... and ${issues.length - 10} more`);
}
process.exit(1);
