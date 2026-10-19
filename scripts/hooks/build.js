#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_FILE = path.join(ROOT, "framework", "hooks.registry.json");
const CHECK_MODE = process.argv.includes("--check");

const OUT_HOOK_MANIFEST = path.join(
  ROOT,
  "scripts",
  "hooks",
  "hook-manifest.json",
);
const OUT_SETTINGS = path.join(ROOT, ".claude", "settings.json");

function readRegistry() {
  const raw = fs.readFileSync(REGISTRY_FILE, "utf8");
  const reg = JSON.parse(raw);
  if (reg.$schema !== "mc/hooks-registry/v1") {
    throw new Error(`Unexpected registry $schema: ${reg.$schema}`);
  }
  return reg;
}

function buildHookManifest(registry) {
  const hooks = {};
  for (const h of registry.hooks) {
    if (
      h.enabled === false &&
      (!h.registrations || h.registrations.length === 0)
    ) {
      continue;
    }
    const basename = path.basename(h.script);
    hooks[basename] = {
      script: h.script,
      events: (h.registrations || []).map((r) => ({
        hookEvent: r.event,
        matcher: r.matcher || "",
      })),
      failMode: h.failMode,
      blocks: h.blocks || [],
      testFixtures: h.testFixtures || [],
      owner: h.owner,
      fixturesRequired: !!h.fixturesRequired,
      enabled: h.enabled !== false,
    };
  }
  let updatedAt = null;
  try {
    updatedAt =
      "sha256:" +
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(REGISTRY_FILE))
        .digest("hex")
        .slice(0, 16);
  } catch {
  }
  return {
    $schema: "mc/hook-manifest/v1",
    generatedFrom: "framework/hooks.registry.json",
    updatedAt,
    hooks,
  };
}

function buildSettingsHooks(registry) {
  const byEvent = {};
  for (const h of registry.hooks) {
    if (h.enabled === false) continue;
    for (const reg of h.registrations || []) {
      const event = reg.event;
      const matcher = reg.matcher || "";
      byEvent[event] = byEvent[event] || {};
      byEvent[event][matcher] = byEvent[event][matcher] || [];
      byEvent[event][matcher].push({
        type: "command",
        command: `node "$CLAUDE_PROJECT_DIR/${h.script}"`,
      });
    }
  }
  const out = {};
  for (const [event, byMatcher] of Object.entries(byEvent)) {
    out[event] = Object.entries(byMatcher).map(([matcher, hooks]) => {
      const block = { hooks };
      if (matcher) block.matcher = matcher;
      else block.matcher = "";
      return block;
    });
  }
  return out;
}

function readJsonOr(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeIfChanged(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prior = "";
  try {
    prior = fs.readFileSync(file, "utf8");
  } catch {
  }
  if (prior === content) return { changed: false, file };
  if (CHECK_MODE) {
    return { changed: true, file, stale: true };
  }
  fs.writeFileSync(file, content);
  return { changed: true, file };
}

function fmtJson(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

function main() {
  const registry = readRegistry();

  const manifest = buildHookManifest(registry);
  const manifestRes = writeIfChanged(OUT_HOOK_MANIFEST, fmtJson(manifest));

  const existing = readJsonOr(OUT_SETTINGS, {});
  const merged = { ...existing, hooks: buildSettingsHooks(registry) };
  const settingsRes = writeIfChanged(OUT_SETTINGS, fmtJson(merged));

  console.log(`\nscripts/hooks/build.js — registry v${registry.version}`);
  for (const r of [manifestRes, settingsRes]) {
    const rel = path.relative(ROOT, r.file).replace(/\\/g, "/");
    if (CHECK_MODE) {
      console.log(`  ${r.stale ? "STALE" : "ok   "}  ${rel}`);
    } else if (r.changed) {
      console.log(`  wrote  ${rel}`);
    } else {
      console.log(`  ok     ${rel}`);
    }
  }

  if (CHECK_MODE && [manifestRes, settingsRes].some((r) => r.stale)) {
    console.error(`\nHook artifacts stale. Run: node scripts/hooks/build.js`);
    process.exit(1);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`hooks/build: ${e.message}`);
    process.exit(2);
  }
}

module.exports = { buildHookManifest, buildSettingsHooks };
