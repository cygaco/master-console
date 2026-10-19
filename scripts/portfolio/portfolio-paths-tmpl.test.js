"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const TMPL = path.join(ROOT, "_mc", "templates", "portfolio", ".claude", "paths.json.tmpl");
const REGISTRY = path.join(ROOT, "framework", "paths.registry.json");
const DEAD_TREE = [/\b00-alex\b/, /\b01-adhoc\//, /\b02-oneshot\//, /\b03-managers\b/, /president\/\.system\b/];

const tmpl = JSON.parse(fs.readFileSync(TMPL, "utf8"));
const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
const keys = Object.keys(tmpl).filter((k) => k !== "$schema" && k !== "version");

test("the template header names the registry version", () => {
  assert.strictEqual(tmpl.version, reg.version);
  assert.strictEqual(tmpl.$schema, `mc/paths/v${reg.version}`);
});

test("every template key is a live registry key and its value equals the registry path", () => {
  assert.ok(keys.length > 0, "the template carries path keys");
  const wrong = [];
  for (const k of keys) {
    const e = reg.paths[k];
    if (!e || typeof e.path !== "string") wrong.push(`${k}: not in the registry`);
    else if (e.removedIn) wrong.push(`${k}: removed in ${e.removedIn}`);
    else if (e.path !== tmpl[k]) wrong.push(`${k}: ${tmpl[k]} (registry: ${e.path})`);
  }
  assert.deepStrictEqual(wrong, []);
});

test("no template value names a deleted agent tree", () => {
  const hits = keys.filter((k) => DEAD_TREE.some((re) => re.test(String(tmpl[k]))));
  assert.deepStrictEqual(hits, []);
});
