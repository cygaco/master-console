#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const MAX_BYTES = 5 * 1024 * 1024;

let _warned = false;
function warnOnce(msg) {
  if (_warned) return;
  _warned = true;
  try {
    process.stderr.write(`[skill-counter] ${msg}\n`);
  } catch {
  }
}

function loadPaths() {
  try {
    return require("./lib/paths").PATHS;
  } catch {
    return {
      skillUsageFile: ".claude/project/events/skill-usage.jsonl",
    };
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePrompt(input) {
  if (!input.trim()) return null;
  try {
    const o = JSON.parse(input);
    return o.prompt || o.message || null;
  } catch {
    return input;
  }
}

function extractSkill(prompt) {
  if (typeof prompt !== "string") return null;
  const m = prompt.trim().match(/^\/([a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?)\b/);
  return m ? m[1] : null;
}

function rotateIfNeeded(file) {
  try {
    if (!fs.existsSync(file)) return;
    const stat = fs.statSync(file);
    if (stat.size <= MAX_BYTES) return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = file.replace(/\.jsonl$/, `.${ts}.bak.jsonl`);
    fs.renameSync(file, bak);
  } catch {
  }
}

function main() {
  try {
    const PATHS = loadPaths();
    const file = PATHS.skillUsageFile;
    if (!file) return;

    const abs = path.isAbsolute(file)
      ? file
      : path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), file);

    const stdin = readStdin();
    const prompt = parsePrompt(stdin);
    const skill = extractSkill(prompt);
    if (!skill) return;

    const session =
      process.env.CLAUDE_SESSION_ID || process.env.SESSION_ID || "unknown";

    const evt = {
      ts: new Date().toISOString(),
      skill,
      session,
      elapsedMs: null,
    };
    const line = JSON.stringify(evt);
    if (line.length > 500) return;

    rotateIfNeeded(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, line + "\n");
  } catch (e) {
    warnOnce(`error: ${e.message}`);
  }
}

if (require.main === module) main();

module.exports = { extractSkill, parsePrompt };
