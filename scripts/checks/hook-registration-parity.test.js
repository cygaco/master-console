#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluate } = require("./hook-registration-parity.js");

let pass = 0;
let fail = 0;
let skipped = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

check(
  "present in both -> 0 findings",
  evaluate({
    registryHooks: [
      { script: "scripts/hooks/plain-prompt.js", owner: "framework", enabled: true, registrations: [{ event: "UserPromptSubmit" }] },
    ],
    defaultsHooks: {
      UserPromptSubmit: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/plain-prompt.js"' }] }],
    },
  }).length === 0,
);

check(
  "missing from defaults.json -> fires missing-in-defaults",
  evaluate({
    registryHooks: [
      { script: "scripts/hooks/plain-prompt.js", owner: "framework", enabled: true, registrations: [{ event: "UserPromptSubmit" }] },
    ],
    defaultsHooks: { UserPromptSubmit: [{ hooks: [] }] },
  }).some((f) => f.kind === "missing-in-defaults"),
);

check(
  "disabled registry row is exempt",
  evaluate({
    registryHooks: [
      { script: "scripts/hooks/smart-context.js", owner: "framework", enabled: false, registrations: [{ event: "UserPromptSubmit" }] },
    ],
    defaultsHooks: { UserPromptSubmit: [{ hooks: [] }] },
  }).length === 0,
);

check(
  "owner=project row is exempt",
  evaluate({
    registryHooks: [
      { script: "scripts/hooks/my-local-hook.js", owner: "project", enabled: true, registrations: [{ event: "Stop" }] },
    ],
    defaultsHooks: { Stop: [{ hooks: [] }] },
  }).length === 0,
);

check(
  "present under the WRONG event does not satisfy parity",
  evaluate({
    registryHooks: [
      { script: "scripts/hooks/plain-prompt.js", owner: "framework", enabled: true, registrations: [{ event: "UserPromptSubmit" }] },
    ],
    defaultsHooks: {
      Stop: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/plain-prompt.js"' }] }],
    },
  }).some((f) => f.kind === "missing-in-defaults"),
);

(() => {
  const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
  const defaultsPath = path.join(ROOT, "_mc", "settings", "defaults.json");
  if (!fs.existsSync(defaultsPath)) {
    skipped++;
    console.log("SKIP: live parity checks (8) — requires the instance _mc/settings/defaults.json — skipped on a fresh install");
    return;
  }
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "framework", "hooks.registry.json"), "utf8"));
    const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, "_mc", "settings", "defaults.json"), "utf8"));
    const oldRouter = "skill-router.js";
    check(
      "live: the removed skill router is in neither hooks.registry.json nor defaults.json",
      !(registry.hooks || []).some((h) => path.basename(h.script || "") === oldRouter) && !JSON.stringify(defaults.hooks || {}).includes(oldRouter),
    );
    const findings = evaluate({ registryHooks: registry.hooks || [], defaultsHooks: defaults.hooks || {} });
    for (const id of ["plain-session", "plain-prompt", "plain-guard"]) {
      const row = (registry.hooks || []).find((h) => h.id === id);
      check(`live: ${id} is registered and enabled in hooks.registry.json`, !!row && row.enabled === true);
      check(
        `live: ${id}.js has zero parity findings against the real defaults.json`,
        !findings.some((f) => f.message.includes(`${id}.js`)),
        JSON.stringify(findings.filter((f) => f.message.includes(`${id}.js`))),
      );
    }
    check(
      "live: zero parity findings of any kind against the real defaults.json",
      findings.length === 0,
      JSON.stringify(findings.map((f) => f.message)),
    );
  } catch (e) {
    fail++;
    console.error(`FAIL: live parity check could not run — ${e.message}`);
  }
})();

console.log(`hook-registration-parity.test: ${pass} passed, ${fail} failed, ${skipped} skipped`);
process.exit(fail ? 1 : 0);
