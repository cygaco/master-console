#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");
const { log, getSessionId } = require("./lib/logger");
const SYSTEMS_FILE = path.join(
  PATHS.memory || path.join(PROJECT, ".claude", "memory"),
  "systems.jsonl",
);

const SKILL_PATTERN = /^\.claude\/commands\/(.+)\.md$/;
const HOOK_PATTERN = /^scripts\/hooks\/(.+)\.js$/;

const MAPS_DIR = PATHS.maps || path.join(PROJECT, ".claude", "maps");
const STALE_FILE = path.join(MAPS_DIR, ".stale.json");
const MAP_SOURCES = {
  skills: [/^\.claude\/commands\/.+\.md$/],
  hooks: [/^scripts\/hooks\/.+\.js$/, /^\.claude\/settings\.json$/],
  enforcements: [/^scripts\/hooks\/.+\.js$/],
  memory: [
    /^\.claude\/memory\/.+\.jsonl$/,
    /^scripts\/hooks\/.+\.js$/,
    /^scripts\/hooks\/lib\/.+\.js$/,
  ],
  tools: [
    /^\.claude\/commands\/.+\.md$/,
    /^scripts\/hooks\/.+\.js$/,
    /^package\.json$/,
  ],
};

function markMapsStale(rel) {
  try {
    const mapsDir = MAPS_DIR;
    if (!fs.existsSync(mapsDir)) return;

    let stale = {};
    if (fs.existsSync(STALE_FILE)) {
      stale = JSON.parse(fs.readFileSync(STALE_FILE, "utf8"));
    }

    let changed = false;
    for (const [mapName, patterns] of Object.entries(MAP_SOURCES)) {
      if (patterns.some((p) => p.test(rel))) {
        const jsonl = path.join(mapsDir, mapName + ".jsonl");
        if (fs.existsSync(jsonl) && !stale[mapName]) {
          stale[mapName] = {
            stale_since: new Date().toISOString(),
            trigger: rel,
          };
          changed = true;
        }
      }
    }

    if (changed) {
      fs.writeFileSync(STALE_FILE, JSON.stringify(stale, null, 2));
    }
  } catch {
  }
}

const BROADCAST_PATTERNS = [
  /^CLAUDE\.md$/,
  /^\.claude\/settings\.json$/,
  /^src\/lib\/types\.ts$/,
  /^src\/lib\/constants\.ts$/,
  /^\.claude\/commands\/.+\.md$/,
  /^scripts\/hooks\/.+\.js$/,
  /^src\/app\/globals\.css$/,
  /^tsconfig\.json$/,
  /^next\.config\.ts$/,
];

function postToInbox(rel, description) {
  log("inbox", {
    from: "auto / systems-sync",
    message: `File changed: ${rel}${description ? " — " + description : ""}`,
    files_changed: [rel],
  });
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw);
      const toolInput = input.tool_input || {};
      const filePath = toolInput.file_path || toolInput.command || "";
      const rel = relPath(filePath);

      markMapsStale(rel);

      const isSkill = SKILL_PATTERN.test(rel);
      const isHook = HOOK_PATTERN.test(rel);
      const isBroadcast = BROADCAST_PATTERNS.some((p) => p.test(rel));

      if (isBroadcast && !isSkill && !isHook) {
        postToInbox(rel, null);
        return;
      }

      if (!isSkill && !isHook) return;

      const absPath = path.resolve(PROJECT, rel);
      if (!fs.existsSync(absPath)) return;
      const content = fs.readFileSync(absPath, "utf8");

      let description = null;
      if (isSkill) {
        const fm = parseFrontmatter(content);
        if (fm && fm.description) description = fm.description;
      } else if (isHook) {
        const docMatch = content.match(
          /\/\*\*\s*\n\s*\*\s*(.+?)(?:\s*—|\s*\n)/,
        );
        if (docMatch) description = docMatch[1].trim();
      }

      if (!fs.existsSync(SYSTEMS_FILE)) return;
      const lines = fs
        .readFileSync(SYSTEMS_FILE, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      const systems = lines.map((l) => JSON.parse(l));

      let matched = false;
      for (const sys of systems) {
        if (
          sys.files &&
          sys.files.some((f) => rel.includes(f) || f.includes(rel))
        ) {
          sys.last_modified = today();
          if (description && sys.description !== description) {
            sys.notes = (sys.notes || "") + ` | desc updated ${today()}`;
          }
          matched = true;
          break;
        }
      }

      if (!matched && isSkill) {
        const slugMatch = rel.match(SKILL_PATTERN);
        const slug = slugMatch ? slugMatch[1].replace(/\//g, "-") : rel;
        systems.push({
          id: `skill-${slug}`,
          name: description || slug,
          description: description || `Skill: ${rel}`,
          status: "untested",
          category: "cognition",
          files: [rel],
          depends_on: [],
          test: {
            command: `Run /${slug.replace(/-/g, ":")} and verify output`,
            last_tested: null,
            last_result: null,
          },
          diagnose: {
            health_check: `Read ${rel} — verify frontmatter and content`,
            common_failures: [],
          },
          created: today(),
          last_modified: today(),
          notes: "Auto-created by systems-sync hook",
        });
      }

      const tmpFile = SYSTEMS_FILE + ".tmp";
      fs.writeFileSync(
        tmpFile,
        systems.map((s) => JSON.stringify(s)).join("\n") + "\n",
      );
      fs.renameSync(tmpFile, SYSTEMS_FILE);

      const changeDesc = matched
        ? "updated systems.jsonl entry"
        : "created new systems.jsonl entry";
      log("modification", {
        file: rel,
        change: changeDesc,
        reason: "systems-sync hook detected skill/hook edit",
        status: "untested",
      });

      postToInbox(rel, description);
    } catch {
    }
  });
}

main();
