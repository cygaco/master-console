#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const cHash = require("../mc/lib/content-hash");

function inspectAssets(root, assets) {
  const missing = [];
  const edited = [];
  let checked = 0;
  for (const a of assets) {
    if (a.owner === "project") continue;
    const dest = path.join(root, a.dest);
    if (!fs.existsSync(dest)) {
      missing.push({ kind: "missing", file: a.dest });
      continue;
    }
    if (a.installedHash) {
      const localContent = cHash.contentHash(dest);
      if (!cHash.hashMatches(localContent, a.installedHash)) {
        const localRaw = cHash.rawHash(dest);
        if (!cHash.hashMatches(localRaw, a.installedHash)) {
          edited.push({
            kind: "locally_modified",
            file: a.dest,
            expected: a.installedHash,
            actual: localContent,
          });
        }
      }
    }
    checked++;
  }
  return { checked, missing, edited };
}

function main() {
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
    return 0;
  }
  const installed = JSON.parse(fs.readFileSync(installedFile, "utf8"));
  const { checked, missing, edited } = inspectAssets(
    ROOT,
    installed.assets || [],
  );
  const locallyModified = edited.map((i) => i.file);
  const editedLine = `${edited.length} framework files edited locally — the update keeps them (see the plan)`;

  if (missing.length === 0) {
    if (edited.length === 0) {
      if (JSON_OUT) console.log(JSON.stringify({ ok: true, checked }));
      else
        console.log(
          `OK   [mc-manifest-honesty] ${checked} framework assets verified`,
        );
      return 0;
    }
    if (JSON_OUT)
      console.log(
        JSON.stringify({
          ok: true,
          status: "yellow",
          reason: editedLine,
          checked,
          locallyModified,
          missing: [],
          issues: edited.slice(0, 30),
          totalIssues: edited.length,
        }),
      );
    else console.log(editedLine);
    return 0;
  }

  const issues = [...missing, ...edited];
  if (JSON_OUT)
    console.log(
      JSON.stringify({
        ok: false,
        checked,
        locallyModified,
        missing: missing.map((i) => i.file),
        issues: issues.slice(0, 30),
        totalIssues: issues.length,
      }),
    );
  else {
    console.error(
      `FAIL [mc-manifest-honesty] ${missing.length} missing framework file(s) (${checked} assets checked):`,
    );
    for (const i of missing.slice(0, 10))
      console.error(`  - [${i.kind}] ${i.file}`);
    if (missing.length > 10)
      console.error(`  ... and ${missing.length - 10} more`);
    if (edited.length > 0) console.error(editedLine);
  }
  return 1;
}

module.exports = { inspectAssets };

if (require.main === module) process.exitCode = main();
