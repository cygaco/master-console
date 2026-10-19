#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "no-nul-bytes";
const TEXT_EXT = new Set([".js", ".json", ".md", ".ts", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "runtime", ".provider-tmp"]);
const SCAN_ROOTS = ["scripts", ".claude"];

function evaluate(input) {
  const files = (input && input.files) || [];
  const offenders = [];
  for (const f of files) {
    const buf = f.buf;
    if (!Buffer.isBuffer(buf)) continue;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0) {
        offenders.push({ path: f.path, offset: i });
        break;
      }
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
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      yield* walk(path.join(dir, ent.name));
    } else if (ent.isFile() && TEXT_EXT.has(path.extname(ent.name).toLowerCase())) {
      yield path.join(dir, ent.name);
    }
  }
}

function run() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const abs = path.join(ROOT, root);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      try {
        files.push({ path: path.relative(ROOT, file), buf: fs.readFileSync(file) });
      } catch {
      }
    }
  }
  return { ...evaluate({ files }), scanned: files.length };
}

module.exports = { evaluate };

if (require.main === module) {
  const JSON_OUT = process.argv.includes("--json");
  let res;
  try {
    res = run();
  } catch (e) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
    else console.error(`[${NAME}] runner error: ${e && e.message ? e.message : e}`);
    process.exit(2);
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ check: NAME, ...res }));
  } else if (res.ok) {
    console.log(`OK   [${NAME}] no NUL bytes in ${res.scanned} text source file(s)`);
  } else {
    console.error(`FAIL [${NAME}] ${res.offenders.length} file(s) contain a NUL byte (0x00) — likely a Write-tool artifact (e.g. a literal space before ] in a regex char class). Use \\s instead.`);
    for (const o of res.offenders) console.error(`  - ${o.path} (first NUL at byte ${o.offset})`);
  }
  process.exit(res.ok ? 0 : 1);
}
