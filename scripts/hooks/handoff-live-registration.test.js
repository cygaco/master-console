"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_FILE = path.join(ROOT, "framework", "hooks.registry.json");
const SETTINGS_FILE = path.join(ROOT, ".claude", "settings.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const REQUIRED_EVENTS = ["Stop", "SessionEnd", "StopFailure"];

test("handoff-live has a registry row enabled for Stop, SessionEnd and StopFailure", () => {
  const registry = readJson(REGISTRY_FILE);
  const entry = registry.hooks.find(
    (h) => h.script === "scripts/hooks/handoff-live.js",
  );
  assert.ok(
    entry,
    "no registry row for scripts/hooks/handoff-live.js — the Layer-1 session " +
      "safety net is now a no-op whenever settings.json is regenerated from the registry",
  );
  assert.strictEqual(entry.enabled, true, "handoff-live registry row must be enabled");
  const events = new Set((entry.registrations || []).map((r) => r.event));
  for (const ev of REQUIRED_EVENTS) {
    assert.ok(
      events.has(ev),
      `handoff-live registry row is missing the ${ev} registration`,
    );
  }
});

test("handoff-live.js is wired into the generated .claude/settings.json for Stop, SessionEnd and StopFailure", () => {
  const settings = readJson(SETTINGS_FILE);
  for (const ev of REQUIRED_EVENTS) {
    const groups = settings.hooks[ev] || [];
    const hasIt = groups.some((g) =>
      (g.hooks || []).some((h) => /handoff-live\.js/.test(h.command || "")),
    );
    assert.ok(
      hasIt,
      `handoff-live.js missing from settings.json hooks.${ev} — a hooks regen ` +
        "dropped the Layer-1 safety net; run node scripts/hooks/build.js",
    );
  }
});
