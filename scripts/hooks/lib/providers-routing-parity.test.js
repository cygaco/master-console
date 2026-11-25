"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { PATHS } = require("./paths");
const { getProviderForRole } = require("./providers");

const reg = JSON.parse(fs.readFileSync(PATHS.orgRoleRegistry, "utf8").replace(/^﻿/, ""));
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(PATHS.manifest, "utf8").replace(/^﻿/, "")); } catch { }
const LEGACY = { builder: "claude", fixer: "claude", reviewer: "openai", compliance: "claude", qa: "claude", redteam: "antigravity", advisor: "openai", consult: "openai", learner: "openai" };

test("every registry role keeps its provider (manifest pin > registry)", () => {
  const ap = (manifest && manifest.agentProviders) || {};
  for (const [role, e] of Object.entries(reg.roles)) {
    if (role.startsWith("_") || !e || typeof e !== "object") continue;
    const expected = ap[role] || e.provider || "claude";
    assert.strictEqual(getProviderForRole(role), expected, `role ${role}`);
  }
});

test("scrapped legacy ids and unknown roles keep their defaults", () => {
  const ap = (manifest && manifest.agentProviders) || {};
  for (const [role, p] of Object.entries(LEGACY)) {
    assert.strictEqual(getProviderForRole(role), ap[role] || p, `legacy ${role}`);
  }
  assert.strictEqual(getProviderForRole("definitely-not-a-role"), "claude");
});
