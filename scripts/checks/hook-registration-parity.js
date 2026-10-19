#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "hook-registration-parity";
const REGISTRY_FILE = path.join(ROOT, "framework", "hooks.registry.json");
const DEFAULTS_FILE = path.join(ROOT, "_mc", "settings", "defaults.json");

function evaluate({ registryHooks, defaultsHooks }) {
  const findings = [];
  for (const h of registryHooks || []) {
    if (h.enabled === false) continue;
    if (h.owner !== "framework") continue;
    if (!h.script) continue;
    const basename = path.basename(h.script);
    for (const reg of h.registrations || []) {
      const event = reg.event;
      const blocks = (defaultsHooks && defaultsHooks[event]) || [];
      const present = blocks.some((b) =>
        (b.hooks || []).some((x) => String(x.command || "").includes(basename)),
      );
      if (!present) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "missing-in-defaults",
          message: `${basename} (${event}) is enabled + owner=framework in hooks.registry.json but has no matching row in _mc/settings/defaults.json's "${event}" block — a fresh Master Console install would silently lack it`,
        });
      }
    }
  }
  return findings;
}

function main() {
  const asJson = process.argv.includes("--json");
  let registry, defaults;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
    defaults = JSON.parse(fs.readFileSync(DEFAULTS_FILE, "utf8"));
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: false, check: NAME, error: msg }) : `ERROR  ${NAME}: ${msg}`) + "\n",
    );
    process.exit(2);
  }

  const findings = evaluate({ registryHooks: registry.hooks || [], defaultsHooks: defaults.hooks || {} });

  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: findings.length === 0, check: NAME, findings }, null, 2) + "\n");
  } else {
    for (const f of findings) process.stdout.write(`FAIL  [${f.kind}] ${f.message}\n`);
    process.stdout.write(`# ${NAME}: ${findings.length} finding(s)\n`);
  }
  process.exit(findings.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { evaluate };
