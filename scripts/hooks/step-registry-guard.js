#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { PROJECT, PATHS, relPath } = require("./lib/paths");

const STRICT = process.env.STEP_REGISTRY_GUARD_STRICT !== "0";

const STEP_PATTERNS = [
  {
    re: /\bcurrentStep\s*(===|==|!==|!=|>=|<=|>|<)\s*\d+/g,
    why: "hardcoded integer comparison — use `Step.XYZ` + `STEP_TO_INT[Step.XYZ]` from src/lib/types.ts",
  },
  {
    re: /\bcurrentStep\s*:\s*\d+/g,
    why: "integer literal in object — use `STEP_TO_INT[Step.XYZ]` (source of truth: _requirements/00-canonical/STEPS.json)",
  },
  {
    re: /\bsetCurrentStep\s*\(\s*\d+\s*\)/g,
    why: "setCurrentStep with numeric literal — use `setCurrentStep(STEP_TO_INT[Step.XYZ])`",
  },
];

const ALLOW_LIST_SUBSTRINGS = [
  "src/lib/types.ts",
  "src/lib/constants.ts",
  "src/lib/storage.ts",
  "src/lib/test-harness.ts",
  "scripts/hooks/",
];

const KNOWN_VIOLATIONS_FILES = [];

function reconstructPostEditBody(event) {
  const ti = event.tool_input || {};
  if (event.tool_name === "Write") {
    return typeof ti.content === "string" ? ti.content : "";
  }
  if (event.tool_name === "Edit") {
    const filePath = ti.file_path || "";
    let current = "";
    try {
      current = fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
    const oldStr = ti.old_string || "";
    const newStr = ti.new_string || "";
    if (!oldStr) return newStr || current;
    const idx = current.indexOf(oldStr);
    if (idx < 0) return null;
    return current.slice(0, idx) + newStr + current.slice(idx + oldStr.length);
  }
  return null;
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

function validateStepsRegistry(event, rel) {
  const body = reconstructPostEditBody(event);
  if (body == null) return;

  let registry;
  try {
    registry = JSON.parse(body);
  } catch (e) {
    emitRegistryFindings(rel, [
      `post-edit body is not valid JSON: ${e.message}`,
    ]);
    return;
  }

  const findings = [];

  if (typeof registry.version !== "number")
    findings.push("missing or non-numeric `version`");
  if (!registry.phases || typeof registry.phases !== "object")
    findings.push("missing or non-object `phases`");
  if (!registry.steps || typeof registry.steps !== "object")
    findings.push("missing or non-object `steps`");
  if (findings.length) {
    emitRegistryFindings(rel, findings);
    return;
  }

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
    if (typeof step.position !== "number" || !Number.isInteger(step.position)) {
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

  if (findings.length) emitRegistryFindings(rel, findings);
}

function emitRegistryFindings(rel, findings) {
  const lines = [
    `step-registry-guard: STEPS.json schema validation found ${findings.length} issue(s):`,
  ];
  for (const f of findings) lines.push(`  • ${f}`);
  lines.push(
    "",
    "The registry at _requirements/00-canonical/STEPS.json is the source of truth",
    "for step order + phase membership. Downstream: src/lib/types.ts `Step`",
    "enum, the 3 canonical docs' step tables, scripts/hooks/step-registry-guard.js.",
    "",
    STRICT
      ? "This edit is BLOCKED. Fix the schema violations before retrying."
      : "This is a WARNING (STEP_REGISTRY_GUARD_STRICT=0 set — opt-out mode).",
  );
  process.stderr.write(lines.join("\n") + "\n");

  try {
    const loggerPath = path.join(
      PROJECT,
      "scripts",
      "hooks",
      "lib",
      "logger.js",
    );
    if (fs.existsSync(loggerPath)) {
      const { log } = require(loggerPath);
      log(
        "audit",
        {
          action: "steps-registry-schema-warn",
          file: rel,
          count: findings.length,
          findings: findings.slice(0, 5),
        },
        { actor: "step-registry-guard" },
      );
    }
  } catch {
  }

  if (STRICT) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason: `step-registry-guard: STEPS.json schema violations (${findings.length})`,
      }),
    );
  }
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = event.tool_name;
  if (toolName !== "Edit" && toolName !== "Write") {
    process.exit(0);
  }

  const filePath = event.tool_input?.file_path || "";
  const rel = relPath(filePath).replace(/\\/g, "/");

  if (rel.endsWith("_requirements/00-canonical/STEPS.json")) {
    validateStepsRegistry(event, rel);
    process.exit(0);
  }

  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) {
    process.exit(0);
  }

  if (!rel.startsWith("src/")) {
    process.exit(0);
  }

  if (ALLOW_LIST_SUBSTRINGS.some((s) => rel.includes(s))) {
    process.exit(0);
  }

  if (KNOWN_VIOLATIONS_FILES.some((f) => rel === f || rel.endsWith("/" + f))) {
    process.exit(0);
  }

  const body =
    (event.tool_input?.content || "") +
    "\n" +
    (event.tool_input?.new_string || "");

  if (!body.trim()) {
    process.exit(0);
  }

  const findings = [];
  for (const { re, why } of STEP_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body)) !== null) {
      findings.push({ match: m[0], why });
      if (findings.length >= 8) break;
    }
    if (findings.length >= 8) break;
  }

  if (findings.length === 0) {
    process.exit(0);
  }

  const lines = [
    `step-registry-guard: ${findings.length} hardcoded integer step reference(s) in ${rel}:`,
  ];
  for (const f of findings) {
    lines.push(`  • ${f.match} — ${f.why}`);
  }
  lines.push(
    "",
    "Source of truth: _requirements/00-canonical/STEPS.json. Use the `Step` enum",
    "from src/lib/types.ts (STEP_TO_INT / INT_TO_STEP) instead of raw integers.",
    "",
    STRICT
      ? "This edit is BLOCKED. Replace the integer literal with the Step enum."
      : "This is a WARNING (STEP_REGISTRY_GUARD_STRICT=0 set — opt-out mode).",
  );

  process.stderr.write(lines.join("\n") + "\n");

  try {
    const loggerPath = path.join(
      PROJECT,
      "scripts",
      "hooks",
      "lib",
      "logger.js",
    );
    if (fs.existsSync(loggerPath)) {
      const { log } = require(loggerPath);
      log(
        "audit",
        {
          action: "step-hardcode-warn",
          file: rel,
          count: findings.length,
          patterns: findings.map((f) => f.match).slice(0, 5),
        },
        { actor: "step-registry-guard" },
      );
    }
  } catch {
  }

  if (STRICT) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason: `step-registry-guard: ${findings.length} hardcoded integer step reference(s) — use Step enum`,
      }),
    );
  }

  process.exit(0);
});
