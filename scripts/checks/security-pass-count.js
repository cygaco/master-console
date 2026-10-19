#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const fs = require("fs");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");
const path = require("path");

const NAME = "security-pass-count";
const ROOT = path.resolve(__dirname, "..", "..");
const ROLE = "security-reviewer";
const LEGACY_EXEMPT_BEFORE = null;

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function fileHas(rel, ...needles) {
  try {
    const t = fs.readFileSync(path.join(ROOT, rel), "utf8");
    return needles.every((n) => t.includes(n));
  } catch {
    return false;
  }
}

function evaluateConfig(passes) {
  const hard = [];
  const providers = passes.map((p) => p.provider);
  if (passes.length < 3) {
    hard.push(`registry "${ROLE}" declares ${passes.length} pass(es) — the invariant is a FULL 3-provider chain (primary + second_pass + third_pass); a 2-provider chain is a regression`);
  }
  if (new Set(providers).size !== providers.length) {
    hard.push(`registry "${ROLE}" pass providers are not distinct (${providers.join(", ")}) — best-of-each requires different providers per pass`);
  }
  if (passes.length >= 3 && providers[providers.length - 1] !== "claude") {
    hard.push(`registry "${ROLE}" last pass provider is "${providers[providers.length - 1]}" — the Claude pass must be LAST (additive, never displaces cross-family coverage)`);
  }
  if (!fs.existsSync(path.join(ROOT, "scripts", "dispatch-review.js"))) {
    hard.push(`scripts/dispatch-review.js (the firing consumer of second_pass/third_pass) is MISSING — the passes would not fire`);
  }
  if (!fileHas("scripts/sprint/epsilon-runtime.js", "dispatch-review.js", "passesForRole")) {
    hard.push(`scripts/sprint/epsilon-runtime.js does not route multi-pass roles through dispatch-review.js — the sprint gauntlet would fire only the primary pass`);
  }
  return { hard };
}

function evaluateRuntime(records, expectedCount, exemptBefore = LEGACY_EXEMPT_BEFORE) {
  const warns = [];
  const sec = records.filter(
    (r) => r && r.role === ROLE && typeof r.completed_at === "string" && (!exemptBefore || r.completed_at.slice(0, 10) >= exemptBefore),
  );
  if (!sec.length) return warns;
  const groups = new Map();
  for (const r of sec) {
    const key = r.prompt_digest || r.run_id || r.sprint_id;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { total: 0, okProviders: new Set() });
    const g = groups.get(key);
    g.total += 1;
    if (isVerifiedLivenessRecord(r, { requireSignature: mcEnv.readEnv("LIVENESS_REQUIRE_SIG") !== "0" }) && r.provider)
      g.okProviders.add(r.provider);
  }
  for (const [key, g] of groups) {
    if (g.total >= 2 && g.okProviders.size < expectedCount) {
      warns.push(
        `security review "${key}" completed ${g.okProviders.size}/${expectedCount} distinct providers ok (of ${g.total} pass records) — the ${expectedCount}-pass review did not fully succeed`,
      );
    }
  }
  return warns;
}

function main(argv) {
  const strict = (argv || []).includes("--strict");
  const json = (argv || []).includes("--json");
  let passes;
  try {
    const registryRoles = require(path.join(ROOT, "scripts", "dispatch", "registry-roles"));
    passes = registryRoles.passesOf(ROLE);
  } catch (e) {
    process.stderr.write(`${NAME}: cannot resolve registry passes for ${ROLE}: ${e.message}\n`);
    return 2;
  }
  const { hard } = evaluateConfig(passes);

  let records = [];
  const ledger = path.join(ROOT, ".claude", "runtime", "dispatch-completions.jsonl");
  try {
    if (fs.existsSync(ledger)) {
      records = fs
        .readFileSync(ledger, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
  } catch {
  }
  const warns = evaluateRuntime(records, passes.length);

  if (json) {
    process.stdout.write(JSON.stringify({ ok: hard.length === 0, check: NAME, expected_passes: passes.length, config_breaks: hard, runtime_gaps: warns, strict }, null, 2) + "\n");
  } else if (hard.length === 0 && warns.length === 0) {
    process.stdout.write(`OK   [${NAME}] ${ROLE} declares ${passes.length} distinct-provider passes, dispatch-review.js fires them, no runtime under-fire\n`);
  } else {
    if (hard.length)
      process.stderr.write(`FAIL [${NAME}] config-coherence break (${hard.length}):\n${hard.map((e) => `  - ${e}`).join("\n")}\n`);
    if (warns.length)
      process.stderr.write(`${strict ? "FAIL" : "WARN"} [${NAME}] runtime under-fire (${warns.length}, report-only ramp${strict ? " — BLOCKING via --strict" : ""}):\n${warns.map((e) => `  - ${e}`).join("\n")}\n`);
  }
  if (hard.length) return 1;
  if (warns.length && strict) return 1;
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { evaluateConfig, evaluateRuntime, main, NAME, ROLE, LEGACY_EXEMPT_BEFORE };
