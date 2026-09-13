#!/usr/bin/env node
/**
 * test-dispatch-config.js — dispatch-config regression enforcer.
 *
 * REBASELINED 2026-07-20 (Gemini deep-clean): the SUNSET individual `gemini` CLI was
 * removed; the Gemini lab now routes through Antigravity (`agy`). This enforcer NO LONGER
 * requires the retired gemini headless fix (GEMINI_DEFAULT / GEMINI_CLI_TRUST_WORKSPACE /
 * loadGeminiApiKey) — those forms are now FORBIDDEN and are enforced by
 * scripts/checks/no-legacy-gemini-cli.js. This file keeps the still-valid invariants:
 *   - codex dispatch built as an argv ARRAY through the safe-spawn kernel (no --full-auto)
 *   - no confirmed-GHOST model ids in catalog code
 *   - manifest + scaffold carry the antigravity provider block (agy), NOT a gemini block
 *   - the --provider override (the 2nd GPT security pass mechanism) survives
 *   - the antigravity primary model (gemini-3.1-pro-high) AGREES across every dispatch point
 *
 * Exits 1 on any violation. Pure text/JSON assertions — no provider calls, CI-safe.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
// Ghost = a model id confirmed NON-SERVABLE (404 / shut down). The current agy-served real
// (gemini-3.1-pro-high) must NOT be flagged. Confirmed-dead ids only:
const GHOST = /gemini-3-pro-preview\b|gemini-3\.1-flash-lite-preview\b|gemini-2\.5-flash-lite-preview-09-2025\b|gemini-2\.0-flash-exp\b|gemini-3-flash\b/;

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error("  FAIL: " + msg);
};
const ok = (msg) => console.log("  ok: " + msg);

function check(label, fn) {
  try {
    fn();
  } catch (e) {
    fail(`${label} — ${e.message}`);
  }
}

// 1. providers.js — the load-bearing dispatch path.
check("providers.js", () => {
  const src = read("scripts/hooks/lib/providers.js");
  // codex dispatch is built as an argv ARRAY routed through the safe-spawn kernel
  // (shell:false), not a shell cmd-string template. Assert the form + deprecated-flag ban.
  const codexArgv = src.match(/argv[:=]\s*\["exec",[^\]]*\]/);
  if (!codexArgv)
    throw new Error("could not locate the codex exec argv array");
  if (/--full-auto/.test(codexArgv[0]))
    throw new Error("codex argv still uses DEPRECATED --full-auto");
  if (!/"--sandbox", "workspace-write"/.test(codexArgv[0]))
    throw new Error("codex argv missing --sandbox workspace-write");
  if (!/safeSpawn\.safeSpawnSync\(toolId, argv/.test(src))
    throw new Error("providers.js no longer routes dispatch through the safe-spawn kernel");
  ok("codex argv uses --sandbox workspace-write through safe-spawn (not --full-auto)");
  // The 2nd-security-pass provider override must survive.
  if (!/opts\.provider\b/.test(src))
    throw new Error("runProvider lost the opts.provider override");
  // The SUNSET gemini CLI wiring must be GONE (belt-and-suspenders vs no-legacy-gemini-cli.js).
  if (/GEMINI_DEFAULT|loadGeminiApiKey|GEMINI_CLI_TRUST_WORKSPACE/.test(src))
    throw new Error("providers.js still carries SUNSET-gemini wiring (GEMINI_DEFAULT / loadGeminiApiKey / GEMINI_CLI_TRUST_WORKSPACE)");
  ok("provider-override present; no SUNSET-gemini wiring in providers.js");
});

// 2. catalog.js — no ghost ids anywhere (comments excepted).
check("catalog.js", () => {
  const src = read("scripts/dispatch/catalog.js");
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return; // comment — allowed to discuss ghosts
    if (GHOST.test(line))
      throw new Error(`ghost model in non-comment line ${i + 1}: ${line.trim()}`);
  });
  ok("no ghost model ids in catalog code");
});

// 3. manifest.json — codex syntax + antigravity provider block (NO gemini provider).
check(".claude/manifest.json", () => {
  const m = JSON.parse(read(".claude/manifest.json"));
  if (/--full-auto/.test(m.providers.openai.syntax))
    throw new Error("manifest openai.syntax still uses --full-auto");
  if (m.providers.gemini)
    throw new Error("manifest.providers still carries a SUNSET gemini provider block");
  if (!m.providers.antigravity || m.providers.antigravity.cli !== "agy")
    throw new Error("manifest.providers.antigravity (cli:agy) missing");
  if (GHOST.test(m.providers.antigravity.default_model))
    throw new Error(`manifest antigravity.default_model is a ghost: ${m.providers.antigravity.default_model}`);
  ok(`manifest clean (antigravity→${m.providers.antigravity.default_model}, no gemini block)`);
});

// 4. scaffold-core.js — NEW products are born agy-only, never with a gemini block.
check("scaffold-core.js", () => {
  const src = read("scripts/mc/scaffold-core.js");
  const block = src.match(/openai:\s*\{[\s\S]*?antigravity:\s*\{[\s\S]*?\}/);
  if (!block) throw new Error("could not locate generated providers block (expected antigravity)");
  if (/cli:\s*"gemini"/.test(src))
    throw new Error("scaffold still emits a gemini provider block for new products");
  if (/--full-auto/.test(block[0]) && !/DEPRECATED/.test(block[0]))
    throw new Error("scaffold still emits --full-auto for new products");
  if (GHOST.test(block[0].replace(/\/\/[^\n]*/g, "")))
    throw new Error("scaffold emits a ghost antigravity default for new products");
  ok("scaffold-core emits antigravity (agy) dispatch config for new products");
});

// 5. security-reviewer spec — provider_model not a ghost; provider is antigravity.
for (const spec of [
  ".claude/agents/engineering/security/reviewer.md",
]) {
  check(spec, () => {
    const src = read(spec);
    const pm = src.match(/provider_model:\s*(\S+)/);
    if (!pm) throw new Error("no provider_model in frontmatter");
    if (GHOST.test(pm[1])) throw new Error(`security-reviewer provider_model is a ghost: ${pm[1]}`);
    const prov = src.match(/\nprovider:\s*(\S+)/);
    if (!prov || prov[1] !== "antigravity")
      throw new Error(`security-reviewer provider should be antigravity, got ${prov ? prov[1] : "none"}`);
    ok(`security-reviewer provider=antigravity, provider_model real: ${pm[1]}`);
  });
}

// 6. dispatch-agent.js — the --provider/--model override (2nd security pass).
check("dispatch-agent.js", () => {
  const src = read("scripts/dispatch-agent.js");
  if (!/--provider/.test(src) || !/providerOverride/.test(src))
    throw new Error("dispatch-agent lost the --provider override");
  ok("dispatch-agent supports --provider/--model override");
});

// 7. ANTIGRAVITY primary-model AGREEMENT across every dispatch point.
// The agy Gemini-lab model (gemini-3.1-pro-high) is pinned in several files; a mismatch
// is the rename-hygiene drift class CLAUDE.md flags. This makes it self-detecting.
check("antigravity primary-model agreement", () => {
  const grab = (file, re, label) => {
    const m = read(file).match(re);
    if (!m) throw new Error(`could not read antigravity model from ${label}`);
    return { label, model: m[1] };
  };
  const points = [
    grab("scripts/hooks/lib/providers.js",
      /antigravity:\s*\{[\s\S]*?default_model:\s*process\.env\.ANTIGRAVITY_MODEL\s*\|\|\s*"([^"]+)"/, "providers.antigravity.default_model"),
    grab("scripts/dispatch/catalog.js",
      /id:\s*"antigravity",[\s\S]*?defaultModel:\s*"([^"]+)"/, "catalog.antigravity.defaultModel"),
    grab("scripts/mc/scaffold-core.js",
      /antigravity:\s*\{[\s\S]*?default_model:\s*"([^"]+)"/, "scaffold.antigravity.default_model"),
    grab(".claude/agents/engineering/security/reviewer.md",
      /provider_model:\s*(\S+)/, "security-reviewer.provider_model"),
  ];
  // JSON-sourced points
  const manifest = JSON.parse(read(".claude/manifest.json"));
  points.push({ label: "manifest.antigravity.default_model", model: manifest.providers.antigravity.default_model });
  const pf = JSON.parse(read(".claude/agents/president/_system/policy/provider-fallback.json"));
  const secPolicy = pf.policies["security-reviewer"] || pf.policies.redteam;
  points.push({ label: "provider-fallback.security.primary", model: String(secPolicy.primary).split(":").pop() });

  const distinct = [...new Set(points.map((p) => p.model))];
  if (distinct.length !== 1) {
    const detail = points.map((p) => `${p.label}=${p.model}`).join(", ");
    throw new Error(`antigravity primary model DRIFT across dispatch points: ${detail}`);
  }
  ok(`antigravity primary model agrees everywhere: ${distinct[0]}`);
});

console.log("");
if (failures) {
  console.error(`test-dispatch-config: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("test-dispatch-config: all dispatch-config invariants hold");
process.exit(0);
