#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const START = Date.now();
const NAME = "mc-version-quorum";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}
const JSON_OUT = process.argv.includes("--json");
const TARGET_ROOT = path.resolve(
  arg("--target") || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
);

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

function readJSON(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { __malformed: true };
  }
}

function scriptHeaderVersion() {
  const file = path.join(TARGET_ROOT, "install.ps1");
  if (!fs.existsSync(file)) return null;
  try {
    const txt = fs.readFileSync(file, "utf8");
    const m =
      txt.match(/\$MC_VERSION\s*=\s*['"]([\d.]+)['"]/) ||
      txt.match(/^#?\s*Version[:\s=]+['"]?([\d.]+)['"]?/m) ||
      txt.match(/MC\s+([\d.]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const sources = {};
const vj = readJSON(path.join(TARGET_ROOT, "version.json"));
if (vj && !vj.__malformed) sources["version.json"] = vj.version || null;
const fm = readJSON(
  path.join(TARGET_ROOT, ".claude", "framework-manifest.json"),
);
if (fm && !fm.__malformed)
  sources[".claude/framework-manifest.json"] = fm.version || null;
const fi = readJSON(
  path.join(TARGET_ROOT, ".claude", "framework-installed.json"),
);
if (fi && !fi.__malformed)
  sources[".claude/framework-installed.json"] =
    fi.installedVersion || fi.version || null;
const sh = scriptHeaderVersion();
if (sh) sources["install.ps1#header"] = sh;

const present = Object.entries(sources).filter(([, v]) => v != null);
if (present.length < 2) {
  emit({
    status: "green",
    reason: `only ${present.length} version source(s) reachable — nothing to compare`,
    evidence: { sources },
  });
}

const values = new Set(present.map(([, v]) => v));
if (values.size === 1) {
  emit({
    status: "green",
    reason: `all ${present.length} sources agree on ${present[0][1]}`,
    evidence: { sources, agreedVersion: present[0][1] },
  });
}

const trustWinner =
  sources["version.json"] != null
    ? `version.json wins: ${sources["version.json"]}`
    : "version.json absent; cannot resolve automatically";

const disagreements = present.map(([k, v]) => ({ source: k, version: v }));

emit({
  status: "red",
  reason: `version sources disagree (${values.size} distinct values across ${present.length} sources)`,
  remediation: [
    `Trust order: ${trustWinner}.`,
    `Inspect each disagreeing file:`,
    ...disagreements.map((d) => `  - ${d.source}: ${d.version}`),
    `If .claude/framework-manifest.json is stale:`,
    `  git checkout HEAD -- .claude/framework-manifest.json`,
    `Then re-run /scan:mc-manifest-honesty to confirm.`,
    `Override: none — refuse to update with disagreeing version sources.`,
  ].join("\n"),
  evidence: {
    sources,
    disagreements,
    trustOrder:
      "version.json > framework-installed.json > framework-manifest.json > install.ps1#header",
  },
});
