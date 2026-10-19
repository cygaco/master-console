#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "schemas", "mc-manifest.schema.json");
const BUILD_PATH = path.join(__dirname, "build.js");

const { build, sha256OfFile } = require(BUILD_PATH);

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

process.stdout.write("A. Schema present\n");
const schemaRaw = fs.readFileSync(SCHEMA_PATH, "utf8");
const schema = JSON.parse(schemaRaw);
ok("schema parses", typeof schema === "object");
ok("schema $id is mc/manifest/v1", schema.$id === "mc/manifest/v1");
ok("schema declares version 1", schema.properties.version.const === 1);
ok(
  "ownerClass enum is the 4 canonical classes",
  JSON.stringify(schema.definitions.ownerClass.enum.slice().sort()) ===
    JSON.stringify(["framework", "generated", "project", "runtime"]),
);

process.stdout.write("B. Generator runs ok against this repo\n");
const tmpManifest = path.join(
  REPO_ROOT,
  ".mc",
  `manifest-test-${Date.now()}.json`,
);
const r = build({
  root: REPO_ROOT,
  outPath: tmpManifest,
  sourcePrefix: "framework",
  dryRun: false,
  allowUnclassified: false,
});
ok("build returns ok", r.ok, r.error);
ok("build wrote tmpManifest", fs.existsSync(tmpManifest));
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(tmpManifest, "utf8"));
} catch (e) {
}
ok("tmpManifest parses as JSON", !!manifest);
ok("manifest version === 1", manifest && manifest.version === 1);
ok(
  "manifest has paths",
  manifest && typeof manifest.paths === "object" && Object.keys(manifest.paths).length > 0,
);

process.stdout.write("C. Structural invariants\n");
const ownerClasses = ["framework", "generated", "project", "runtime"];
const counts = { framework: 0, generated: 0, project: 0, runtime: 0 };
let frameworkMissingSource = 0;
let frameworkMissingSha = 0;
let generatedMissingCompiledFrom = 0;
let runtimeHasSource = 0;
let runtimeHasSeededFrom = 0;
let runtimeHasCompiledFrom = 0;
let invalidOwner = 0;
for (const [, entry] of Object.entries(manifest.paths || {})) {
  if (!ownerClasses.includes(entry.owner)) {
    invalidOwner++;
    continue;
  }
  counts[entry.owner]++;
  if (entry.owner === "framework") {
    if (entry.source === undefined) frameworkMissingSource++;
    if (!entry.sha256) frameworkMissingSha++;
  }
  if (entry.owner === "generated" && !Array.isArray(entry.compiled_from)) {
    generatedMissingCompiledFrom++;
  }
  if (entry.owner === "runtime") {
    if (entry.source) runtimeHasSource++;
    if (entry.seeded_from) runtimeHasSeededFrom++;
    if (entry.compiled_from) runtimeHasCompiledFrom++;
  }
}
ok("no invalid owner classes", invalidOwner === 0, `invalidOwner=${invalidOwner}`);
ok("every framework entry has a source field", frameworkMissingSource === 0, `missing=${frameworkMissingSource}`);
ok("every framework entry has sha256", frameworkMissingSha === 0, `missing=${frameworkMissingSha}`);
ok("every generated entry has compiled_from", generatedMissingCompiledFrom === 0, `missing=${generatedMissingCompiledFrom}`);
ok("no runtime entry has source", runtimeHasSource === 0, `has=${runtimeHasSource}`);
ok("no runtime entry has seeded_from", runtimeHasSeededFrom === 0, `has=${runtimeHasSeededFrom}`);
ok("no runtime entry has compiled_from", runtimeHasCompiledFrom === 0, `has=${runtimeHasCompiledFrom}`);
ok(
  "owner class counts > 0 for framework + project + runtime + generated",
  counts.framework > 0 && counts.project > 0 && counts.runtime > 0 && counts.generated > 0,
  JSON.stringify(counts),
);

process.stdout.write("C2. seeded_from resolvability (prefix-drift)\n");
let seededTotal = 0;
const seededDangling = [];
for (const [rel, entry] of Object.entries(manifest.paths || {})) {
  if (entry && typeof entry.seeded_from === "string" && entry.seeded_from) {
    seededTotal++;
    if (!fs.existsSync(path.join(REPO_ROOT, entry.seeded_from))) {
      seededDangling.push(`${rel} → ${entry.seeded_from}`);
    }
  }
}
ok("manifest emits seeded_from entries to check", seededTotal > 0, `seededTotal=${seededTotal}`);
ok(
  "every seeded_from resolves on disk (no prefix-drift)",
  seededDangling.length === 0,
  `${seededDangling.length} dangling: ${JSON.stringify(seededDangling.slice(0, 5))}`,
);

process.stdout.write("E. sha256 helper\n");
const s1 = sha256OfFile(SCHEMA_PATH);
const s2 = sha256OfFile(SCHEMA_PATH);
ok("sha256 is hex64", /^[a-f0-9]{64}$/.test(s1));
ok("sha256 deterministic across two calls", s1 === s2);

process.stdout.write("F. build.js ↔ populate-source lock-step\n");
const { buildRules, classify } = require(BUILD_PATH);
const { isFrameworkViewDest } = require(
  path.join(REPO_ROOT, "scripts", "mc", "views", "populate-source.js"),
);
const prodRules = buildRules("_mc");
const lockStepBreaks = [];
for (const rel of Object.keys(manifest.paths || {})) {
  if (!rel.startsWith(".claude/")) continue;
  const c = classify(rel, prodRules);
  if (!c) continue;
  const src = c.entry.source;
  if (typeof src === "string" && src.startsWith("_mc/") && !isFrameworkViewDest(rel)) {
    lockStepBreaks.push(rel);
  }
}
ok(
  "every .claude/** _mc-mirror source is covered by isFrameworkViewDest",
  lockStepBreaks.length === 0,
  `${lockStepBreaks.length} un-mirrored: ${JSON.stringify(lockStepBreaks.slice(0, 5))}`,
);

process.stdout.write("F2. shipping manifest enumerates _mc-backed dests\n");
const shipDests = new Set();
try {
  const fm = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".claude", "framework-manifest.json"), "utf8"),
  );
  for (const kind of Object.keys(fm.assets || {})) {
    for (const e of fm.assets[kind] || []) {
      if (e && e.dest) shipDests.add(e.dest);
    }
  }
} catch {
}
const notShipped = [];
for (const rel of Object.keys(manifest.paths || {})) {
  if (!rel.startsWith(".claude/")) continue;
  const c = classify(rel, prodRules);
  if (!c) continue;
  const src = c.entry.source;
  if (typeof src === "string" && src.startsWith("_mc/") && !shipDests.has(rel)) {
    notShipped.push(rel);
  }
}
ok("framework-manifest present + non-empty", shipDests.size > 0, `shipDests=${shipDests.size}`);
ok(
  "every .claude/** _mc-mirror source is enumerated by the shipping manifest",
  notShipped.length === 0,
  `${notShipped.length} un-shipped: ${JSON.stringify(notShipped.slice(0, 5))}`,
);

process.stdout.write("G. canonical excludes the generated _mc view mirror\n");
const canonRules = buildRules("framework");
for (const rel of [
  "_mc/agents/president/beta.md",
  "_mc/commands/mc/release.md",
  "_mc/project/reference/evolution.md",
  "_mc/kernel/role-binding.json",
  "_mc/schemas/workorder-min.schema.json",
]) {
  const c = classify(rel, canonRules);
  ok(
    `canonical SKIPS the view-mirror path ${rel}`,
    !!c && c.skip === true && c.rule === "mc-generated-view-mirror",
    `got ${JSON.stringify(c)}`,
  );
}
for (const rel of [
  "_mc/templates/sprint/README.md",
  "_mc/settings/defaults.json",
  "_mc/BASELINE/_requirements/00-canonical/CORE_BRIEF.md",
  "_mc/BASELINE/_requirements/01-design-system/UX_PRINCIPLES.md",
]) {
  const c = classify(rel, canonRules);
  ok(
    `canonical still ENUMERATES non-view _mc content ${rel} (owner=framework)`,
    !!c && !c.skip && c.entry && c.entry.owner === "framework",
    `got ${JSON.stringify(c)}`,
  );
}
{
  const c = classify("_mc/MANIFEST.json", canonRules);
  ok(
    "_mc/MANIFEST.json is enumerated (generated), never skipped",
    !!c && !c.skip && c.entry && c.entry.owner === "generated",
    `got ${JSON.stringify(c)}`,
  );
}
{
  const c = classify("_mc/agents/president/beta.md", prodRules);
  ok(
    "PRODUCT mode ENUMERATES the _mc view mirror (there it is the shipped source)",
    !!c && !c.skip && c.entry && c.entry.owner === "framework",
    `got ${JSON.stringify(c)}`,
  );
}
{
  const viewEntries = Object.keys(manifest.paths || {}).filter((k) =>
    /^_mc\/(agents|commands|project|kernel|schemas)\//.test(k),
  );
  ok(
    "the built canonical manifest has ZERO _mc view-mirror entries",
    viewEntries.length === 0,
    `${viewEntries.length} leaked: ${JSON.stringify(viewEntries.slice(0, 5))}`,
  );
}
{
  const os = require("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-viewmirror-tooth-"));
  try {
    const vf = path.join(tmp, "_mc", "agents", "sample.md");
    fs.mkdirSync(path.dirname(vf), { recursive: true });
    fs.writeFileSync(vf, "# a materialized view-mirror file\n");
    const r = build({ root: tmp, sourcePrefix: "framework", mcVersion: "0.0.0", dryRun: true });
    ok(
      "a re-materialized _mc view file on disk is NOT enumerated (dirty-tree robustness)",
      r.ok === true &&
        r.pathCount === 0 &&
        (r.ruleHits || {})["mc-generated-view-mirror"] === 1,
      `pathCount=${r.pathCount} skipHits=${(r.ruleHits || {})["mc-generated-view-mirror"]} r.ok=${r.ok}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  fs.unlinkSync(tmpManifest);
} catch {
}

process.stdout.write(`\nResults: ${pass} passed, ${fail} failed.\n`);
if (fail > 0) process.exit(1);
