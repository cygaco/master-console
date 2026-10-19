#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const REPO_ROOT = process.cwd();

function loadPaths() {
  try {
    return require("../hooks/lib/paths").PATHS;
  } catch {
    return { manifest: ".claude/manifest.json" };
  }
}

function loadOperatorContractStrictness() {
  try {
    return require("../hooks/lib/project-config").OPERATOR_CONTRACT_STRICTNESS;
  } catch {
    return new Set(["off", "advisory", "strict", "pedantic"]);
  }
}

function readManifest() {
  const PATHS = loadPaths();
  const raw = PATHS.manifest || ".claude/manifest.json";
  const file = path.isAbsolute(raw) ? raw : path.join(REPO_ROOT, raw);
  if (!fs.existsSync(file)) {
    process.stderr.write(
      `manifest not found: ${file}\n` +
        `  fix: run \`/mc:setup\` (creates .claude/manifest.json from project scan)\n` +
        `  or:  copy _mc/templates/manifest.template.json (if framework template exists)\n`,
    );
    process.exit(1);
  }
  try {
    return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    process.stderr.write(
      `manifest is not valid JSON (${file}): ${e.message}\n` +
        `  fix: restore from .claude/.mc-backup/ or re-run /mc:setup\n`,
    );
    process.exit(1);
  }
}

function show(args) {
  const { data } = readManifest();
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(data) + "\n");
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  }
  return 0;
}

const REQUIRED_TOP_LEVEL = ["$schema", "project", "mc", "agents"];

const REQUIRED_PROJECT_KEYS = ["name", "slug"];
const REQUIRED_MC_KEYS = ["version", "installed"];

function validateManifest(data) {
  const errors = [];
  const warnings = [];

  if (data.$schema !== "mc/manifest/v1") {
    warnings.push(
      `unexpected $schema: ${data.$schema} (expected mc/manifest/v1)`,
    );
  }
  for (const k of REQUIRED_TOP_LEVEL) {
    if (!(k in data)) errors.push(`missing top-level key: ${k}`);
  }
  if (data.project) {
    for (const k of REQUIRED_PROJECT_KEYS) {
      if (!data.project[k]) errors.push(`missing project.${k}`);
    }
  }
  if (data.mc) {
    for (const k of REQUIRED_MC_KEYS) {
      if (!(k in data.mc)) errors.push(`missing mc.${k}`);
    }
    if (data.mc.version && !/^\d+\.\d+\.\d+$/.test(data.mc.version)) {
      errors.push(`mc.version is not semver: ${data.mc.version}`);
    }
  }
  if (data.agentProviders) {
    const validProviders = new Set(["claude", "openai", "antigravity"]);
    for (const [role, p] of Object.entries(data.agentProviders)) {
      if (!validProviders.has(p)) {
        errors.push(
          `agentProviders.${role}: unknown provider "${p}" (expected one of ${[...validProviders].join("|")})`,
        );
      }
    }
  }
  if (data.mc && data.mc.operatorContract !== undefined) {
    const oc = data.mc.operatorContract;
    const validStrictness = loadOperatorContractStrictness();
    if (typeof oc !== "object" || oc === null || Array.isArray(oc)) {
      warnings.push("mc.operatorContract is not an object — ignored, defaults apply");
    } else {
      if (oc.enabled !== undefined && typeof oc.enabled !== "boolean") {
        warnings.push("mc.operatorContract.enabled should be a boolean — ignored, default applies");
      }
      if (oc.strictness !== undefined && !validStrictness.has(oc.strictness)) {
        warnings.push(
          `mc.operatorContract.strictness: unknown value "${oc.strictness}" (expected one of ${[...validStrictness].join("|")}) — ignored, default applies`,
        );
      }
      if (
        oc.maxLinesBeforeHeader !== undefined &&
        (typeof oc.maxLinesBeforeHeader !== "number" || oc.maxLinesBeforeHeader <= 0)
      ) {
        warnings.push("mc.operatorContract.maxLinesBeforeHeader should be a positive number — ignored, default applies");
      }
      if (oc.allowIdentifiers !== undefined && typeof oc.allowIdentifiers !== "boolean") {
        warnings.push("mc.operatorContract.allowIdentifiers should be a boolean — ignored, default applies");
      }
      if (oc.extraCommandPrefixes !== undefined && !Array.isArray(oc.extraCommandPrefixes)) {
        warnings.push("mc.operatorContract.extraCommandPrefixes should be an array of strings — ignored, default applies");
      }
    }
  }
  return { errors, warnings };
}

function validate() {
  const { data } = readManifest();
  const { errors, warnings } = validateManifest(data);
  for (const w of warnings) process.stdout.write(`W ${w}\n`);
  for (const e of errors) process.stdout.write(`E ${e}\n`);
  if (errors.length === 0) {
    process.stdout.write(`OK manifest valid (${warnings.length} warnings)\n`);
    return 0;
  }
  process.stdout.write(`FAIL manifest invalid (${errors.length} errors)\n`);
  return 1;
}

const MIGRATIONS = [
  {
    from: "0.1.0",
    to: "0.1.1",
    apply: (m) => ({ ...m, mc: { ...m.mc, version: "0.1.1" } }),
  },
  {
    from: "0.1.1",
    to: "0.1.2",
    apply: (m) => ({ ...m, mc: { ...m.mc, version: "0.1.2" } }),
  },
  {
    from: "0.1.2",
    to: "0.1.3",
    apply: (m) => ({ ...m, mc: { ...m.mc, version: "0.1.3" } }),
  },
  {
    from: "0.1.3",
    to: "0.1.4",
    apply: (m) => ({ ...m, mc: { ...m.mc, version: "0.1.4" } }),
  },
];

function semverCmp(a, b) {
  const [aa, ab, ac] = a.split(".").map(Number);
  const [ba, bb, bc] = b.split(".").map(Number);
  if (aa !== ba) return aa - ba;
  if (ab !== bb) return ab - bb;
  return ac - bc;
}

function planChain(from, to) {
  if (from === to) return [];
  const chain = [];
  let cur = from;
  while (cur !== to) {
    const step = MIGRATIONS.find((m) => m.from === cur);
    if (!step) return null;
    chain.push(step);
    if (semverCmp(step.to, to) > 0) return null;
    cur = step.to;
    if (chain.length > 50) return null;
  }
  return chain;
}

function unifiedDiff(beforeStr, afterStr, label) {
  const a = beforeStr.split("\n");
  const b = afterStr.split("\n");
  const out = [`--- ${label} (current)`, `+++ ${label} (after)`];
  const max = Math.max(a.length, b.length);
  let inHunk = false;
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      if (inHunk) out.push(` ${a[i]}`);
      continue;
    }
    if (!inHunk) {
      out.push(`@@ line ${i + 1} @@`);
      inHunk = true;
    }
    if (a[i] !== undefined) out.push(`-${a[i]}`);
    if (b[i] !== undefined) out.push(`+${b[i]}`);
  }
  return out.join("\n");
}

function getArg(args, name) {
  const i = args.indexOf(name);
  if (i !== -1 && i + 1 < args.length) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  return null;
}

function migrate(args) {
  const target = getArg(args, "--to");
  const apply = args.includes("--apply");
  const sourceOverride = getArg(args, "--source");
  if (!target) {
    process.stderr.write("usage: manifest migrate --to <version> [--apply]\n");
    return 2;
  }
  if (!/^\d+\.\d+\.\d+$/.test(target)) {
    process.stderr.write(`target version is not semver: ${target}\n`);
    return 2;
  }

  let manifestData;
  let manifestFile;
  if (sourceOverride) {
    manifestFile = path.resolve(sourceOverride);
    if (!fs.existsSync(manifestFile)) {
      process.stderr.write(`source not found: ${manifestFile}\n`);
      return 1;
    }
    manifestData = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } else {
    const r = readManifest();
    manifestData = r.data;
    manifestFile = r.file;
  }

  const current = manifestData.mc && manifestData.mc.version;
  if (!current) {
    process.stderr.write("manifest has no mc.version — cannot migrate\n");
    return 1;
  }
  const cmp = semverCmp(current, target);
  if (cmp === 0) {
    process.stdout.write(`already at target ${target} — no-op\n`);
    return 0;
  }
  if (cmp > 0) {
    process.stderr.write(
      `downgrade refused: current ${current} > target ${target}\n`,
    );
    return 1;
  }

  const chain = planChain(current, target);
  if (!chain) {
    process.stderr.write(`no migration path from ${current} to ${target}\n`);
    return 1;
  }

  let migrated = manifestData;
  for (const step of chain) {
    migrated = step.apply(migrated);
  }
  const before = JSON.stringify(manifestData, null, 2);
  const after = JSON.stringify(migrated, null, 2);

  if (!apply) {
    process.stdout.write(
      `# DRY RUN — would migrate ${current} → ${target} via ${chain.length} step(s)\n`,
    );
    process.stdout.write(`# pass --apply to write\n`);
    process.stdout.write(unifiedDiff(before, after, manifestFile) + "\n");
    return 0;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = manifestFile.replace(/\.json$/, `.${current}-${ts}.bak.json`);
  fs.writeFileSync(bak, before);
  fs.writeFileSync(manifestFile, after);
  process.stdout.write(
    `MIGRATED ${current} → ${target} (${chain.length} step(s))\n`,
  );
  process.stdout.write(`backup: ${path.relative(REPO_ROOT, bak)}\n`);
  return 0;
}

function main() {
  const [, , sub, ...rest] = process.argv;
  if (!sub) {
    process.stdout.write(
      "usage: node scripts/manifest/cli.js <show|validate|migrate> [args]\n",
    );
    process.exit(2);
  }
  if (sub === "show") process.exit(show(rest));
  if (sub === "validate") process.exit(validate());
  if (sub === "migrate") process.exit(migrate(rest));
  process.stderr.write(`unknown subcommand: ${sub}\n`);
  process.exit(2);
}

if (require.main === module) main();

module.exports = { validateManifest, planChain, semverCmp };
