#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { PROJECT, PATHS, relPath } = require("./lib/paths");

const MARKER_RE =
  /<!--\s*maps:([a-zA-Z0-9_-]+):(START|END)\s*\(region=([^)]+)\)[^]*?-->/g;

function parseMarkers(body) {
  const markers = [];
  MARKER_RE.lastIndex = 0;
  let m;
  while ((m = MARKER_RE.exec(body)) !== null) {
    const line = body.slice(0, m.index).split("\n").length;
    markers.push({
      skill: m[1],
      kind: m[2],
      region: m[3].trim(),
      line,
      raw: m[0],
    });
  }
  return markers;
}

function validate(markers) {
  const violations = [];
  const stack = [];
  const seen = new Map();

  for (const mk of markers) {
    const key = `${mk.skill}::${mk.region}`;

    if (mk.kind === "START") {
      if (seen.has(key)) {
        violations.push({
          type: "duplicate-region",
          line: mk.line,
          skill: mk.skill,
          region: mk.region,
          suggestion: `rename this region — \`${key}\` already used at line ${seen.get(key)}`,
        });
      } else {
        seen.set(key, mk.line);
      }

      if (stack.length > 0) {
        const outer = stack[stack.length - 1];
        violations.push({
          type: "nested-region",
          line: mk.line,
          skill: mk.skill,
          region: mk.region,
          suggestion: `close outer region \`${outer.skill}:${outer.region}\` (opened line ${outer.line}) before starting \`${mk.skill}:${mk.region}\``,
        });
      }
      stack.push(mk);
    } else {
      if (stack.length === 0) {
        violations.push({
          type: "orphan-end",
          line: mk.line,
          skill: mk.skill,
          region: mk.region,
          suggestion: `add a matching \`<!-- maps:${mk.skill}:START (region=${mk.region}) -->\` before line ${mk.line}, or remove this END`,
        });
        continue;
      }
      const top = stack[stack.length - 1];
      if (top.skill !== mk.skill || top.region !== mk.region) {
        violations.push({
          type: "mismatched-end",
          line: mk.line,
          skill: mk.skill,
          region: mk.region,
          suggestion: `expected END for \`${top.skill}:${top.region}\` (opened line ${top.line}); got \`${mk.skill}:${mk.region}\``,
        });
        stack.pop();
        continue;
      }
      stack.pop();
    }
  }

  for (const open of stack) {
    violations.push({
      type: "orphan-start",
      line: open.line,
      skill: open.skill,
      region: open.region,
      suggestion: `add \`<!-- maps:${open.skill}:END (region=${open.region}) -->\` after line ${open.line}`,
    });
  }

  return violations;
}

function emit(rel, violations) {
  const lines = [
    `region-marker-guard: ${violations.length} malformed region marker(s) in ${rel}:`,
  ];
  for (const v of violations) {
    lines.push(
      `  • line ${v.line} [${v.type}] maps:${v.skill} (region=${v.region})`,
    );
    lines.push(`      fix: ${v.suggestion}`);
  }
  lines.push(
    "",
    "Regenerators like /maps:steps require every START to have a matching END",
    "with identical skill and region name. Orphaned or nested markers cause",
    "silent regeneration failure or content corruption.",
    "",
    "This is a WARNING — the edit is allowed. Fix before running /maps:*.",
  );
  process.stderr.write(lines.join("\n") + "\n");

  try {
    const { log } = require("./lib/logger");
    for (const v of violations) {
      log(
        "audit",
        {
          action: "region-marker-violation",
          file: rel,
          line: v.line,
          type: v.type,
          skill: v.skill,
          region: v.region,
        },
        { actor: "region-marker-guard" },
      );
    }
  } catch {
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
  if (toolName !== "Edit" && toolName !== "Write") process.exit(0);

  const filePath = event.tool_input?.file_path || "";
  const rel = relPath(filePath).replace(/\\/g, "/");

  if (!rel.startsWith("_requirements/00-canonical/")) process.exit(0);
  if (!rel.endsWith(".md")) process.exit(0);

  let body;
  try {
    body = fs.readFileSync(filePath, "utf8");
  } catch {
    process.exit(0);
  }

  const markers = parseMarkers(body);
  if (markers.length === 0) process.exit(0);

  const violations = validate(markers);
  if (violations.length === 0) process.exit(0);

  emit(rel, violations);
  process.exit(0);
});
