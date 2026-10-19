#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JSON_OUT = process.argv.includes("--json");

const PATHS_FILE = path.join(ROOT, ".claude", "paths.json");
if (!fs.existsSync(PATHS_FILE)) {
  if (JSON_OUT)
    console.log(JSON.stringify({ ok: true, reason: "no paths.json" }));
  else console.log("OK   [mc-path-resolution] no paths.json");
  process.exit(0);
}
const paths = JSON.parse(fs.readFileSync(PATHS_FILE, "utf8"));

const REGISTRY_FILE = path.join(ROOT, "framework", "paths.registry.json");
let registryPaths = null;
try {
  if (fs.existsSync(REGISTRY_FILE)) {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
    if (reg && reg.paths && typeof reg.paths === "object") {
      registryPaths = reg.paths;
    }
  }
} catch {
  registryPaths = null;
}

function isEphemeral(key) {
  const entry = registryPaths && registryPaths[key];
  if (entry) {
    if (entry.owner === "runtime" || entry.owner === "generated") return true;
    if (entry.mutable === true) return true;
    return false;
  }
  return /Lock|checkpoint|prev-run/.test(key);
}

const dangling = [];
const skipped = [];
for (const [key, value] of Object.entries(paths)) {
  if (key.startsWith("$") || key === "version") continue;
  if (typeof value !== "string") continue;
  if (isEphemeral(key)) {
    skipped.push(key);
    continue;
  }
  const abs = path.join(ROOT, value);
  if (!fs.existsSync(abs)) {
    const entry = registryPaths && registryPaths[key];
    const isDir = entry
      ? entry.kind === "dir"
      : !path.extname(value);
    if (isDir) {
      try {
        fs.mkdirSync(abs, { recursive: true });
        skipped.push(key);
        continue;
      } catch {
      }
    }
    dangling.push({ key, value });
  }
}

if (dangling.length === 0) {
  if (JSON_OUT)
    console.log(
      JSON.stringify({
        ok: true,
        checked: Object.keys(paths).length,
        skipped: skipped.length,
        registry: !!registryPaths,
      }),
    );
  else
    console.log(
      `OK   [mc-path-resolution] all resolvable paths.json keys resolve (${skipped.length} runtime/generated/mutable key(s) skipped${registryPaths ? "" : ", registry absent — name-regex fallback"})`,
    );
  process.exit(0);
}

const out = {
  ok: false,
  dangling,
  totalKeys: Object.keys(paths).length,
  skipped: skipped.length,
  registry: !!registryPaths,
};
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.error(
    `FAIL [mc-path-resolution] ${dangling.length} paths.json key(s) point to missing paths:`,
  );
  for (const d of dangling.slice(0, 15))
    console.error(`  - paths.${d.key} → ${d.value}`);
}
process.exit(1);
