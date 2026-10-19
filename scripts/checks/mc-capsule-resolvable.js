#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const START = Date.now();
const NAME = "mc-capsule-resolvable";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}
const JSON_OUT = process.argv.includes("--json");
const TARGET_ROOT = path.resolve(
  arg("--target") || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
);
const VERSION = arg("--to");

function emit(result) {
  const out = {
    name: NAME,
    status: result.status,
    reason: result.reason,
    remediation: result.remediation || null,
    durationMs: Date.now() - START,
    evidence: result.evidence || {},
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out));
  } else if (result.status === "green") {
    console.log(`OK   [${NAME}] ${result.reason}`);
  } else {
    console.error(`FAIL [${NAME}] ${result.reason}`);
    if (result.remediation) console.error(`     fix: ${result.remediation}`);
  }
  process.exit(result.status === "green" ? 0 : 1);
}

if (!VERSION) {
  emit({
    status: "red",
    reason: "missing --to <version>",
    remediation: "node scripts/checks/mc-capsule-resolvable.js --to <v>",
    evidence: {},
  });
}

function compareSemverDir(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function listAvailableVersions(releasesDir) {
  if (!fs.existsSync(releasesDir)) return null;
  try {
    return fs
      .readdirSync(releasesDir)
      .filter((d) => /^\d/.test(d))
      .filter((d) => fs.existsSync(path.join(releasesDir, d, "release.json")))
      .sort(compareSemverDir);
  } catch {
    return null;
  }
}

function manifestSource() {
  const file = path.join(TARGET_ROOT, ".claude", "manifest.json");
  if (!fs.existsSync(file)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    const src = m && m.mc && m.mc.source;
    if (!src) return null;
    if (/^https?:\/\//.test(src)) return null;
    return path.resolve(src);
  } catch {
    return null;
  }
}

function installedSource() {
  const file = path.join(TARGET_ROOT, ".claude", "framework-installed.json");
  if (!fs.existsSync(file)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!j || !j.source) return null;
    if (/^https?:\/\//.test(j.source)) return null;
    let s = path.resolve(j.source);
    if (s.includes(`${path.sep}framework${path.sep}`)) {
      s = s.split(`${path.sep}framework${path.sep}`)[0];
    }
    return s;
  } catch {
    return null;
  }
}

function searchLocations() {
  const list = [];
  list.push({ kind: "self", root: TARGET_ROOT });
  list.push({
    kind: "sibling-MC",
    root: path.resolve(TARGET_ROOT, "..", "MC"),
  });
  list.push({
    kind: "sibling-mc",
    root: path.resolve(TARGET_ROOT, "..", "mc"),
  });
  const ms = manifestSource();
  if (ms) list.push({ kind: "manifest.mc.source", root: ms });
  const is = installedSource();
  if (is) list.push({ kind: "framework-installed.source", root: is });
  const seen = new Set();
  return list.filter((l) => {
    const k = l.root.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function inspect(searchedLocations, version) {
  const evidence = { searched: [], available: {} };
  for (const loc of searchedLocations) {
    const releasesDir = path.join(loc.root, "framework", "releases");
    const capsuleDir = path.join(releasesDir, version);
    const releaseJson = path.join(capsuleDir, "release.json");
    const exists = fs.existsSync(releaseJson);
    let malformed = false;
    if (exists) {
      try {
        JSON.parse(fs.readFileSync(releaseJson, "utf8"));
      } catch {
        malformed = true;
      }
    }
    evidence.searched.push({
      kind: loc.kind,
      releaseJson,
      exists,
      malformed,
    });
    if (fs.existsSync(releasesDir)) {
      evidence.available[loc.root] = listAvailableVersions(releasesDir) || [];
    }
    if (exists && !malformed) {
      evidence.resolvedAt = capsuleDir;
      evidence.resolvedRoot = loc.root;
      return { found: true, malformedOnly: false, evidence };
    }
    if (exists && malformed) {
      evidence.malformedAt = releaseJson;
      return { found: false, malformedOnly: true, evidence };
    }
  }
  return { found: false, malformedOnly: false, evidence };
}

const result = inspect(searchLocations(), VERSION);

if (result.found) {
  emit({
    status: "green",
    reason: `capsule ${VERSION} resolved at ${result.evidence.resolvedAt}`,
    evidence: result.evidence,
  });
}

if (result.malformedOnly) {
  emit({
    status: "red",
    reason: "capsule release.json malformed",
    remediation: `Inspect ${result.evidence.malformedAt} or rebuild with: node scripts/mc/release-build.js ${VERSION}`,
    evidence: result.evidence,
  });
}

const availableLines = Object.entries(result.evidence.available)
  .map(([root, versions]) => {
    if (!versions || versions.length === 0) return `    ${root}: (none)`;
    return `    ${root}: ${versions.slice(-8).join(", ")}`;
  })
  .join("\n");

const remediation = [
  `capsule ${VERSION} not found in any searched location. Options:`,
  availableLines,
  `  1. Use one of the available versions above:`,
  `       /mc:update --to <available-v> --apply`,
  `  2. Or point --source at a canonical clone explicitly:`,
  `       /mc:update --to ${VERSION} --source /abs/path/to/MC --apply`,
  `  3. If the capsule was never built, build it in canonical:`,
  `       node scripts/mc/release-build.js ${VERSION}`,
].join("\n");

emit({
  status: "red",
  reason: `capsule ${VERSION} not found in any searched location`,
  remediation,
  evidence: result.evidence,
});
