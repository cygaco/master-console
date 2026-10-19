#!/usr/bin/env node
/**
 * PROMOTION_TRIGGER:
 *   action: flip from warn-only to hard-block (remove STRICT env gate, always block)
 *   criteria:
 *     - 5+ audit warnings from this guard in the last 7 days with no corresponding fix commit
 *     - OR: manually flipped via PATH_GUARD_STRICT=1 after deliberation
 *   metric_query:
 *     actor: "path-guard"
 *     action: ["path-guard-warn", "path-stale-reference"]   // audit-event action names this guard would emit (guard currently only writes to stderr — emit via logger to activate this trigger)
 *   notes: guard currently stderr-only; wire lib/logger.js emissions before the checker can score it
 */

const fs = require("fs");
const path = require("path");

const { PROJECT, PATHS, relPath } = require("./lib/paths");

const STRICT = process.env.PATH_GUARD_STRICT === "1";

// default — the file must contain a path-literal-allowed marker to bypass.
const FRAMEWORK_OWNED_PREFIXES = [
  "scripts/hooks/",
  "scripts/paths/",
  ".claude/agents/",
  ".claude/commands/",
  ".claude/project/reference/",
];
const FRAMEWORK_OWNED_FILE_RES = [/^scripts\/generate-[a-z0-9-]+\.js$/];

const STALE_PATTERNS = [
  {
    re: /\.claude\/events\/[^/\s]/,
    why: "use `.claude/project/events/` (or `PATHS.events`)",
  },
  {
    re: /\.claude\/memory\/[^/\s]/,
    why: "use `.claude/project/memory/` (or `PATHS.memory`)",
  },
  {
    re: /\.claude\/maps\/[^/\s]/,
    why: "use `.claude/project/maps/` (or `PATHS.maps`)",
  },
  {
    re: /\.claude\/handoffs\//,
    why: "use `.claude/runtime/handoffs/` (or `PATHS.handoffs`)",
  },
  {
    re: /\.claude\/logs\//,
    why: "use `.claude/runtime/logs/` (or `PATHS.logs`)",
  },
  {
    re: /context-enhancer\.js/,
    why: "renamed to `smart-context.js`",
  },
  {
    re: /prompt-enhancer\.js/,
    why: "merged into `smart-context.js`",
  },
  {
    re: /\.claude\/agents\/.system\/oneshot\/store\.json/,
    why: "use `.claude/agents/store.json` (or `PATHS.store`)",
  },
];

const ALLOW_LIST_SUBSTRINGS = [
  ".claude/runtime/handoffs/",
  ".claude/runtime/plans/archive/",
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/agents/.system/dispatch-backups/",
  ".claude/agents/president/_system/oneshot/retros/",
  "_requirements/_audits/",
  "_docs/",
  "/check/references.md",
  "/path-guard.js",
  "/scripts/paths/gate.js",
  "/scripts/path-lint.js",
  "/framework/paths.registry.json",
];

const ALLOW_MARKER_RE =
  /(?:<!--\s*path-literal-allowed:(?:(?!-->).)*-->|\/\/\s*path-literal-allowed:[^\n]*)/;

function isFrameworkOwned(rel) {
  for (const prefix of FRAMEWORK_OWNED_PREFIXES) {
    if (rel.startsWith(prefix)) return true;
  }
  for (const re of FRAMEWORK_OWNED_FILE_RES) {
    if (re.test(rel)) return true;
  }
  return false;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";
    if (toolName !== "Edit" && toolName !== "Write") {
      process.exit(0);
    }

    const filePath = (event.tool_input || {}).file_path || "";
    if (!filePath) process.exit(0);

    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".md" && ext !== ".js") process.exit(0);

    const rel = relPath(filePath);
    for (const allow of ALLOW_LIST_SUBSTRINGS) {
      const norm = allow.startsWith("/") ? allow.slice(1) : allow;
      if (rel === norm || rel.startsWith(norm)) process.exit(0);
    }

    const body =
      (event.tool_input || {}).content ||
      (event.tool_input || {}).new_string ||
      "";
    if (!body || body.length === 0) process.exit(0);

    let contextBody = body;
    if (toolName === "Edit") {
      try {
        const onDisk = fs.readFileSync(filePath, "utf8");
        contextBody = onDisk + "\n" + body;
      } catch {
      }
    }

    const findings = [];
    const bodyLines = body.split("\n");
    const ctxLines = contextBody.split("\n");
    const ctxOffset = ctxLines.length - bodyLines.length;
    for (let i = 0; i < bodyLines.length; i++) {
      const line = bodyLines[i];
      if (ALLOW_MARKER_RE.test(line)) continue;
      const cIdx = ctxOffset + i;
      const prev1 = cIdx > 0 ? ctxLines[cIdx - 1] : "";
      const prev2 = cIdx > 1 ? ctxLines[cIdx - 2] : "";
      if (ALLOW_MARKER_RE.test(prev1) || ALLOW_MARKER_RE.test(prev2)) continue;
      for (const { re, why } of STALE_PATTERNS) {
        const m = line.match(re);
        if (m) {
          findings.push({ line: i + 1, match: m[0], why });
        }
      }
    }

    if (findings.length === 0) process.exit(0);

    const frameworkOwned = isFrameworkOwned(rel);

    const lines2 = [
      `\x1b[33m[path-guard] Stale path references in ${rel}:\x1b[0m`,
    ];
    for (const f of findings) {
      lines2.push(`  - line ${f.line}: \`${f.match}\` — ${f.why}`);
    }
    if (frameworkOwned) {
      lines2.push(
        "\x1b[31m  framework-owned file — write blocked. Add a `// path-literal-allowed: <reason>` marker if intentional.\x1b[0m",
      );
    } else {
      lines2.push(
        "\x1b[33m  project-owned file — warning only. Set PATH_GUARD_STRICT=1 to block.\x1b[0m",
      );
    }

    process.stderr.write(lines2.join("\n") + "\n");

    if (frameworkOwned || STRICT) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: `path-guard: ${findings.length} stale path reference(s) in ${frameworkOwned ? "framework-owned" : "project"} file — see stderr`,
        }),
      );
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
