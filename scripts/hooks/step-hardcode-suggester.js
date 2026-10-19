#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { PROJECT, PATHS, relPath } = require("./lib/paths");

const ALLOW_LIST_SUBSTRINGS = [
  "src/lib/types.ts",
  "src/lib/constants.ts",
  "src/lib/storage.ts",
  "src/lib/test-harness.ts",
  "scripts/hooks/",
];

const PATTERNS = [
  {
    re: /\bcurrentStep\s*(===|!==|==|!=|>=|<=|>|<)\s*(\d+)\b/g,
    kind: "comparison",
    render: (op, n) => `currentStep ${op} ${n}`,
    suggest: (op, n, enumName) =>
      `currentStep ${op} STEP_TO_INT[Step.${enumName}]`,
  },
  {
    re: /\bcurrentStep\s*:\s*(\d+)\b/g,
    kind: "object-literal",
    render: (n) => `currentStep: ${n}`,
    suggest: (n, enumName) => `currentStep: STEP_TO_INT[Step.${enumName}]`,
  },
  {
    re: /\bsetCurrentStep\s*\(\s*(\d+)\s*\)/g,
    kind: "setter",
    render: (n) => `setCurrentStep(${n})`,
    suggest: (n, enumName) => `setCurrentStep(STEP_TO_INT[Step.${enumName}])`,
  },
];

function loadIntToEnum() {
  const typesPath = path.join(PROJECT, "src", "lib", "types.ts");
  let src;
  try {
    src = fs.readFileSync(typesPath, "utf8");
  } catch {
    return {};
  }
  const blockMatch = src.match(
    /export\s+const\s+STEP_TO_INT\s*:[^=]*=\s*\{([\s\S]*?)\}\s*;/,
  );
  if (!blockMatch) return {};
  const body = blockMatch[1];
  const entryRe = /\[\s*Step\.([A-Z0-9_]+)\s*\]\s*:\s*(\d+)/g;
  const map = {};
  let m;
  while ((m = entryRe.exec(body)) !== null) {
    const enumName = m[1];
    const n = Number(m[2]);
    if (!Number.isNaN(n)) map[n] = enumName;
  }
  return map;
}

function lineNumberOf(body, index) {
  let line = 1;
  for (let i = 0; i < index && i < body.length; i++) {
    if (body.charCodeAt(i) === 10) line++;
  }
  return line;
}

function readPostEditBody(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
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
  if (!filePath) process.exit(0);

  const rel = relPath(filePath).replace(/\\/g, "/");

  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) {
    process.exit(0);
  }
  if (!rel.startsWith("src/")) {
    process.exit(0);
  }
  if (ALLOW_LIST_SUBSTRINGS.some((s) => rel.includes(s))) {
    process.exit(0);
  }

  const body = readPostEditBody(filePath);
  if (body == null || !body.trim()) {
    process.exit(0);
  }

  const intToEnum = loadIntToEnum();

  const suggestions = [];
  for (const pat of PATTERNS) {
    pat.re.lastIndex = 0;
    let m;
    while ((m = pat.re.exec(body)) !== null) {
      let n;
      let op = null;
      if (pat.kind === "comparison") {
        op = m[1];
        n = Number(m[2]);
      } else {
        n = Number(m[1]);
      }
      if (Number.isNaN(n)) continue;
      const line = lineNumberOf(body, m.index);
      const from =
        pat.kind === "comparison" ? pat.render(op, n) : pat.render(n);
      const enumName = intToEnum[n];
      if (enumName) {
        const to =
          pat.kind === "comparison"
            ? pat.suggest(op, n, enumName)
            : pat.suggest(n, enumName);
        suggestions.push({
          line,
          pattern: from,
          suggestion: `\`${from}\` → \`${to}\` (matches Step.${enumName} = ${n} in registry)`,
          enumName,
          n,
          kind: pat.kind,
        });
      } else {
        suggestions.push({
          line,
          pattern: from,
          suggestion: `\`${from}\` → no Step enum entry for ${n}; consider adding one to _requirements/00-canonical/STEPS.json`,
          enumName: null,
          n,
          kind: pat.kind,
        });
      }
      if (suggestions.length >= 16) break;
    }
    if (suggestions.length >= 16) break;
  }

  if (suggestions.length === 0) {
    process.exit(0);
  }

  const header = `step-hardcode-suggester: ${suggestions.length} suggestion(s) for ${rel}`;
  const lines = [header];
  for (const s of suggestions) {
    lines.push(`  • Line ${s.line}: ${s.suggestion}`);
  }
  lines.push(
    "",
    "These are SUGGESTIONS — the edit has already been applied. Apply any",
    "that make sense; the Pre-hook (step-registry-guard) warned you first.",
    "Source of truth: _requirements/00-canonical/STEPS.json + src/lib/types.ts.",
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
      for (const s of suggestions) {
        log(
          "audit",
          {
            action: "step-hardcode-suggest",
            file: rel,
            line: s.line,
            pattern: s.pattern,
            suggestion: s.suggestion,
            kind: s.kind,
            enumName: s.enumName,
            n: s.n,
          },
          { actor: "step-hardcode-suggester" },
        );
      }
    }
  } catch {
  }

  process.exit(0);
});
