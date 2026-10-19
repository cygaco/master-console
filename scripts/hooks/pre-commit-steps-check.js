#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const PROJECT = path.resolve(__dirname, "..", "..");
const STEPS_JSON_REL = "_requirements/00-canonical/STEPS.json";
const CANONICAL_DOC_RELS = [
  "_requirements/00-canonical/PRODUCT_MODEL.md",
  "_requirements/00-canonical/GLOSSARY.md",
  "_requirements/00-canonical/GOLDEN_PATHS.md",
];

function stagedFiles() {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      { cwd: PROJECT, encoding: "utf8" },
    );
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\\/g, "/"));
  } catch (e) {
    return [];
  }
}

function stagedBlob(relPath) {
  const res = spawnSync("git", ["show", `:${relPath}`], {
    cwd: PROJECT,
    encoding: "utf8",
  });
  if (res.status !== 0) return null;
  return res.stdout;
}

function normalizeRegistry(registry, findings) {
  const arrayPhases = Array.isArray(registry.phases);
  let phases = registry.phases;
  if (arrayPhases) {
    phases = Object.create(null);
    registry.phases.forEach((p, i) => {
      const raw =
        typeof p === "string"
          ? p
          : p && typeof p === "object"
            ? (p.id ?? p.name ?? p.key ?? p.label)
            : null;
      if (raw == null || !String(raw).trim()) {
        findings.push(`phases[${i}] has no id`);
        return;
      }
      const id = String(raw);
      if (id in phases) {
        findings.push(`duplicate phase id "${id}"`);
        return;
      }
      phases[id] = p && typeof p === "object" ? p : {};
    });
  }
  let steps = registry.steps;
  if (Array.isArray(registry.steps)) {
    steps = Object.create(null);
    registry.steps.forEach((s, i) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) {
        findings.push(`steps[${i}] is not an object`);
        return;
      }
      const raw = s.id ?? s.key ?? s.name;
      if (raw == null || !String(raw).trim()) {
        findings.push(`steps[${i}] has no id`);
        return;
      }
      const id = String(raw);
      if (id in steps) {
        findings.push(`duplicate step id "${id}"`);
        return;
      }
      steps[id] = s;
    });
  }
  return { phases, steps, arrayPhases };
}

function validateStepsRegistry(body) {
  const findings = [];

  let registry;
  try {
    registry = JSON.parse(body);
  } catch (e) {
    return [`STEPS.json is not valid JSON: ${e.message}`];
  }

  if (typeof registry.version !== "number")
    findings.push("missing or non-numeric `version`");
  if (!registry.phases || typeof registry.phases !== "object")
    findings.push("missing or non-object `phases`");
  if (!registry.steps || typeof registry.steps !== "object")
    findings.push("missing or non-object `steps`");
  if (findings.length) return findings;

  const { phases, steps, arrayPhases } = normalizeRegistry(registry, findings);

  const phaseNames = Object.keys(phases);
  const stepIds = new Set(Object.keys(steps));
  for (const ph of phaseNames) {
    const phaseDef = phases[ph] || {};
    const listed = Array.isArray(phaseDef.steps) ? phaseDef.steps : [];
    for (const id of listed) {
      if (!stepIds.has(id)) {
        findings.push(`phase "${ph}" lists unknown step "${id}"`);
      }
    }
  }

  for (const [id, step] of Object.entries(steps)) {
    if (!step || typeof step !== "object") {
      findings.push(`step "${id}" is not an object`);
      continue;
    }
    const ph = step.phase;
    if (!ph || !phaseNames.includes(ph)) {
      findings.push(`step "${id}" has unknown or missing phase "${ph}"`);
    } else if (!arrayPhases || Array.isArray(phases[ph].steps)) {
      const listed = Array.isArray(phases[ph].steps) ? phases[ph].steps : [];
      if (!listed.includes(id)) {
        findings.push(
          `step "${id}" declares phase "${ph}" but is not listed in phases.${ph}.steps`,
        );
      }
    }
    for (const req of ["position", "component", "feature"]) {
      if (step[req] === undefined) {
        findings.push(`step "${id}" missing required field "${req}"`);
      }
    }
    if (
      step.position !== undefined &&
      (typeof step.position !== "number" || !Number.isInteger(step.position))
    ) {
      findings.push(`step "${id}" position must be an integer`);
    }
  }

  const positionsSeen = new Map();
  for (const [id, step] of Object.entries(steps)) {
    if (typeof step?.position !== "number") continue;
    const prev = positionsSeen.get(step.position);
    if (prev)
      findings.push(`position ${step.position} collides: ${prev} and ${id}`);
    else positionsSeen.set(step.position, id);
  }

  return findings;
}

function runDriftCheck() {
  const script = path.join(PROJECT, "scripts", "generate-steps-maps.js");
  if (!fs.existsSync(script)) {
    return { ok: true, stdout: "", stderr: "(generator missing, skipped)" };
  }
  const res = spawnSync("node", [script, "--check"], {
    cwd: PROJECT,
    encoding: "utf8",
  });
  return {
    ok: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function banner(title, lines) {
  const bar = "━".repeat(72);
  const out = [
    "",
    bar,
    `BLOCKED: ${title}`,
    bar,
    ...lines,
    bar,
    "",
    "To bypass (NOT recommended):",
    "  git commit --no-verify",
    "",
  ];
  process.stderr.write(out.join("\n") + "\n");
}

function main() {
  const staged = stagedFiles();
  if (staged.length === 0) process.exit(0);

  const stepsJsonStaged = staged.includes(STEPS_JSON_REL);
  const canonDocStaged = staged.some((f) => CANONICAL_DOC_RELS.includes(f));

  if (!stepsJsonStaged && !canonDocStaged) process.exit(0);

  let blocked = false;

  if (stepsJsonStaged) {
    const body = stagedBlob(STEPS_JSON_REL);
    if (body == null) {
      banner("pre-commit-steps-check: could not read staged STEPS.json", [
        "  `git show :_requirements/00-canonical/STEPS.json` failed.",
        "  The commit cannot proceed until git can resolve the staged blob.",
      ]);
      process.exit(1);
    }
    const findings = validateStepsRegistry(body);
    if (findings.length) {
      const lines = [
        `${findings.length} schema violation(s) in staged _requirements/00-canonical/STEPS.json:`,
        "",
        ...findings.map((f) => `  • ${f}`),
        "",
        "STEPS.json is the source of truth for step order + phase membership.",
        "Downstream consumers: src/lib/types.ts Step enum, the 3 canonical docs'",
        "step tables, scripts/hooks/step-registry-guard.js.",
        "",
        "Fix STEPS.json, re-stage, and commit again.",
      ];
      banner("STEPS.json schema violations", lines);
      blocked = true;
    }
  }

  if (!blocked) {
    const drift = runDriftCheck();
    if (!drift.ok) {
      const lines = [
        "`node scripts/generate-steps-maps.js --check` reports drift:",
        "",
        ...(drift.stderr || drift.stdout || "(no output)")
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => `  ${l}`),
        "",
        "One of these is true:",
        "  - You edited STEPS.json but did not regenerate the canonical doc tables.",
        "  - You hand-edited an auto-generated region inside a canonical doc.",
        "",
        "Fix: run `/maps:steps` (or `node scripts/generate-steps-maps.js`),",
        "     then stage the updated canonical docs and commit again.",
      ];
      banner("Canonical docs drift from STEPS.json", lines);
      blocked = true;
    }
  }

  process.exit(blocked ? 1 : 0);
}

main();
