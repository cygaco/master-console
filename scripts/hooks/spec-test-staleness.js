#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const PROJECT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const { PATHS } = (() => {
  try {
    return require("./lib/paths");
  } catch {
    return { PATHS: null };
  }
})();
const SPECS_ROOT_REL = (
  PATHS && PATHS.specsRoot
    ? path.relative(PROJECT, PATHS.specsRoot)
    : "_requirements/04-features"
).replace(/\\/g, "/");
const SPECS_DIR = path.join(PROJECT, SPECS_ROOT_REL);
const REQUIREMENTS_DIR = path.join(PROJECT, "_requirements");
const TEST_RUNS_DIR = path.join(PROJECT, ".claude", "runtime", "test-runs");

const FEATURE_DIR_OVERRIDES = {};

function readToolPayload() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectFeatureFromPath(filePath) {
  if (!filePath) return null;
  const norm = filePath.replace(/\\/g, "/");
  const escapedRoot = SPECS_ROOT_REL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedRoot}/([^/]+)/[A-Z][A-Z-]*\\.md$`);
  const m = norm.match(re);
  if (!m) return null;
  const featureDir = m[1];
  for (const [id, dir] of Object.entries(FEATURE_DIR_OVERRIDES)) {
    if (dir === featureDir) return id;
  }
  return featureDir;
}

function logStale(record) {
  try {
    const { log } = require("./lib/logger");
    log(
      "spec",
      { kind: "test.stale", ...record },
      { actor: "spec-test-staleness" },
    );
    return;
  } catch {
  }
  try {
    const eventsFile = path.join(
      PROJECT,
      ".claude",
      "project",
      "events",
      "events.jsonl",
    );
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        cat: "spec",
        kind: "test.stale",
        ...record,
      }) + "\n";
    fs.appendFileSync(eventsFile, line);
  } catch {
  }
}

function main() {
  const payload = readToolPayload();
  if (!payload) return;

  const tool = payload.tool_name || payload.tool || "";
  if (tool !== "Edit" && tool !== "Write" && tool !== "MultiEdit") return;

  const filePath =
    payload.tool_input?.file_path ||
    payload.tool_response?.filePath ||
    payload.file_path ||
    "";

  const featureId = detectFeatureFromPath(filePath);
  if (!featureId) return;

  const testsDir = path.join(REQUIREMENTS_DIR, featureId, "tests");
  if (!fs.existsSync(testsDir)) return;
  const testFiles = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith(".spec.ts"));
  if (testFiles.length === 0) return;

  const lastRunFile = path.join(TEST_RUNS_DIR, `${featureId}.json`);
  let lastRun = null;
  try {
    lastRun = JSON.parse(fs.readFileSync(lastRunFile, "utf8"));
  } catch {
    lastRun = null;
  }

  const now = new Date();
  const editedAt = now.toISOString();

  const lastPassAt = lastRun?.last_pass || null;
  const lastPassMs = lastPassAt ? new Date(lastPassAt).getTime() : 0;
  const editMs = now.getTime();
  const gapHours = lastPassMs ? (editMs - lastPassMs) / 3_600_000 : null;

  const stale = !lastPassAt || editMs > lastPassMs;
  if (!stale) return;

  logStale({
    feature: featureId,
    spec_file: filePath,
    spec_changed_at: editedAt,
    last_pass_at: lastPassAt,
    last_pass_commit: lastRun?.last_pass_commit || null,
    gap_hours:
      gapHours === null ? "never-passed" : Math.round(gapHours * 10) / 10,
    test_files: testFiles.map((f) =>
      path.join("_requirements", featureId, "tests", f).replace(/\\/g, "/"),
    ),
    suggestion: lastPassAt
      ? `Re-run: npx playwright test _requirements/${featureId}`
      : `Tests have never passed. Run: npx playwright test _requirements/${featureId}`,
  });
}

try {
  main();
} catch {
}
process.exit(0);
