#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function registryPath(argv) {
  const i = argv.indexOf("--registry");
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return path.join(ROOT, "framework", "panel-registry.json");
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const file = registryPath(argv);

  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    process.stderr.write(`panel:list — panel registry unavailable (${e.message})\n`);
    process.exit(1);
  }

  const panels = reg && reg.panels;
  if (!panels || typeof panels !== "object") {
    process.stderr.write("panel:list — panel registry unavailable (no `panels` map)\n");
    process.exit(1);
  }

  const rows = Object.values(panels);
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, count: rows.length, panels: rows }, null, 2) + "\n");
  } else {
    process.stdout.write(`Panels (${rows.length}) — open any with \`/panel:<name>\`\n\n`);
    for (const p of rows) {
      process.stdout.write(`  /panel:${p.name}   [${p.run_context}]  ${p.description}\n`);
      process.stdout.write(`      → ${p.opener}\n`);
    }
    process.stdout.write(`\nThe roadmap board (/panel:roadmap) answers "what's next" at a glance.\n`);
  }
  process.exit(0);
}

main();
