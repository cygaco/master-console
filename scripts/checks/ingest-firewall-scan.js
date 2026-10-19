#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { findInjection } = require("../hooks/lib/untrusted-content");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STORES = ["_docs/research", "_docs/imports", "_docs/briefs", "_docs/clones"];

function* walk(dir) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && /\.(md|txt|json)$/.test(e.name)) yield full;
  }
}

function main(argv) {
  const json = argv.includes("--json");
  const findings = [];
  try {
    for (const store of STORES) {
      for (const file of walk(path.join(REPO_ROOT, store))) {
        const text = fs.readFileSync(file, "utf8");
        if (/data_only:\s*true/i.test(text)) continue;
        const hits = findInjection(text);
        if (hits.length > 0) {
          findings.push({
            file: path.relative(REPO_ROOT, file),
            classes: [...new Set(hits.map((h) => h.class))],
          });
        }
      }
    }
  } catch (e) {
    process.stderr.write(`ingest-firewall-scan error: ${e.message}\n`);
    return 2;
  }
  if (json) {
    process.stdout.write(
      JSON.stringify({ ok: findings.length === 0, findings }, null, 2) + "\n",
    );
    return findings.length ? 1 : 0;
  }
  if (findings.length === 0) {
    process.stdout.write(
      "OK ingest-firewall: no un-firewalled prompt-injection in ingest stores\n",
    );
    return 0;
  }
  process.stderr.write(
    `FAIL ingest-firewall (${findings.length}):\n${findings
      .map((f) => `  - ${f.file} [${f.classes.join(", ")}]`)
      .join("\n")}\n`,
  );
  return 1;
}

process.exit(main(process.argv));
