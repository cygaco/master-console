
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { printHumanReport } = require("./report-format");
const cHash = require("./lib/content-hash");

const { isExcluded: manifestIsExcluded, RUNTIME_JSONL_PATTERN } = require(
  path.join(__dirname, "..", "generate-framework-manifest.js"),
);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASES_DIR = path.join(REPO_ROOT, "framework", "releases");
const FRAMEWORK_MANIFEST = path.join(
  REPO_ROOT,
  ".claude",
  "framework-manifest.json",
);

function sha256File(filePath) {
  return cHash.contentHash(filePath);
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

const BETA_HONESTY_GATE_BASELINE = null;

function betaHonestyGate(opts, runChecker) {
  if (opts && opts.skipBetaHonestyCheck) return { blocked: false, message: null };
  const run =
    runChecker ||
    (() =>
      spawnSync(
        process.execPath,
        [
          path.join(REPO_ROOT, "scripts", "checks", "sprint-beta-honesty.js"),
          "--json",
          ...(BETA_HONESTY_GATE_BASELINE ? ["--since", BETA_HONESTY_GATE_BASELINE] : []),
        ],
        { cwd: REPO_ROOT, encoding: "utf8" },
      ));
  const res = run() || {};
  if (res.status === 0) return { blocked: false, message: null };

  let detail = (res.stdout || "").trim();
  try {
    const parsed = JSON.parse(detail);
    if (parsed && Array.isArray(parsed.findings)) {
      detail =
        `${parsed.totalFindings} finding(s) across ${parsed.checked} sprint(s) (cutoff ${parsed.cutoff}):\n` +
        parsed.findings
          .slice(0, 10)
          .map((f) => `${f.sprint_id}  ${f.finding_type}  ${f.phase || "-"}  ${f.evidence || ""}`)
          .join("\n");
    }
  } catch {
    detail = (res.stderr || res.stdout || `exit ${res.status}`).trim();
  }
  const message =
    "release-build refuses to build: Beta-consultation honesty findings in recent sprints\n" +
    "(missing_consult / placeholder_verdict / escalate_without_halt / canned_* non-substantive verdicts):\n" +
    (detail ? "  " + detail.split("\n").join("\n  ") + "\n" : "") +
    "Remediation: resolve NEW findings (run `node scripts/checks/sprint-beta-honesty.js`), then re-run release-build.\n" +
    "Sanctioned triage: for immutable/historical findings, waive them with an approver + reason —\n" +
    "  `node scripts/checks/beta-honesty-triage.js list` then `... waive --sprint <id>|--all --expect <N> --reason \"…\" --approver \"…\"`.\n" +
    "  The audit then blocks only on NEW (un-waived) findings — no source edit, no blanket bypass.\n" +
    "Bypass (true emergencies only, leaves NO audit trail): re-run with --skip-beta-honesty-check.";
  return { blocked: true, message };
}

function runtimeExclusionGate(manifestObj, opts) {
  if (opts && opts.skipRuntimeExclusionCheck) return { blocked: false, message: null, offenders: [] };

  if (!manifestObj || typeof manifestObj !== "object") {
    return {
      blocked: true,
      message:
        "runtimeExclusionGate: manifest is not a valid object — cannot verify. " +
        "Remediation: Re-run scripts/generate-framework-manifest.js, then re-run release-build.",
      offenders: [],
    };
  }

  const offenders = [];

  const allAssets = [];
  const assetMap = manifestObj.assets || {};
  for (const kind of Object.keys(assetMap)) {
    const entries = assetMap[kind];
    if (Array.isArray(entries)) {
      for (const a of entries) {
        allAssets.push(a);
      }
    }
  }

  for (const a of allAssets) {
    if (!a) continue;
    const aPath = (a.src || a.dest || "").replace(/\\/g, "/");
    const isRuntime = a.owner === "runtime";
    const isTransient = RUNTIME_JSONL_PATTERN.test(aPath) || manifestIsExcluded(aPath);

    if (isRuntime || isTransient) {
      offenders.push({
        id: a.id || "(no id)",
        path: aPath || "(no path)",
        owner: a.owner || "(no owner)",
        reason: isRuntime
          ? "owner=runtime asset must not ship in capsule"
          : "matches tracked-transient pattern (events/tools/skill-usage .jsonl or excluded prefix)",
      });
    }
  }

  if (offenders.length === 0) return { blocked: false, message: null, offenders: [] };

  const lines = offenders.map(
    (o) => `  ${o.id}  path=${o.path}  owner=${o.owner}  reason: ${o.reason}`,
  );
  const message =
    `release-build refuses to build: snapshotted manifest contains ${offenders.length} owner=runtime / tracked-transient asset(s) that must not ship:\n` +
    lines.join("\n") + "\n" +
    "Remediation: Re-run scripts/generate-framework-manifest.js (it excludes owner=runtime), then re-run release-build.";
  return { blocked: true, message, offenders };
}

const KNOWN_DANGLING_REFS = [
  { skill: ".claude/commands/permissions/authorized.md", script: "scripts/foo.js",
    reason: "(A) illustrative command-pattern example ('node scripts/foo.js'), not a real invocation" },
  { skill: ".claude/commands/discover/systems.md", script: "scripts/hooks/foo.js",
    reason: "(A) illustrative feature-cohesion example placeholder, not a real script" },
  { skill: ".claude/commands/scan/full.md", script: "scripts/foo.js",
    reason: "(A) illustrative prose ('a backtick scripts/foo.js-shaped ref' describing doc-ref-integrity), not a real invocation" },
  { skill: ".claude/commands/maps/enforcements.md", script: "scripts/hooks/hook-name.js",
    reason: "(A) illustrative JSON-schema example value (the 'file' field), not a real script" },
  { skill: ".claude/commands/karpathy/run.md", script: "scripts/score.js",
    reason: "(A) karpathy run-local generated artifact ($KARPATHY_BASE/<run-id>/scripts/score.js), not a canonical script" },

  { skill: ".claude/commands/scan/issues.md", script: "scripts/recurring-issues-helper.js",
    reason: "(B) recurring-issues ledger helper; the recurring-issues store tracks MC-framework bugs (canonical-dev), not shipped" },
  { skill: ".claude/commands/issues/list.md", script: "scripts/recurring-issues-helper.js",
    reason: "(B) recurring-issues ledger helper; canonical-dev framework-bug store, not shipped" },
  { skill: ".claude/commands/issues/log.md", script: "scripts/recurring-issues-helper.js",
    reason: "(B) recurring-issues ledger helper; canonical-dev framework-bug store, not shipped" },
  { skill: ".claude/commands/issues/resolve.md", script: "scripts/recurring-issues-helper.js",
    reason: "(B) recurring-issues ledger helper; canonical-dev framework-bug store, not shipped" },
  { skill: ".claude/commands/oneshot/retro.md", script: "scripts/recurring-issues-helper.js",
    reason: "(B) recurring-issues ledger helper used by the oneshot retro; canonical-dev store, not shipped" },
  { skill: ".claude/commands/sleep/deep.md", script: "scripts/recurring-issues-helper.js",
    reason: "(B) recurring-issues ledger helper used by the sleep cycle; canonical-dev store, not shipped" },
  { skill: ".claude/commands/scan/patterns.md", script: "scripts/check-guard-promotion.js",
    reason: "(B) hook-guard promotion analysis; canonical-dev framework tuning, not shipped" },
  { skill: ".claude/commands/mc/setup.md", script: "scripts/mc-setup.js",
    reason: "(B) canonical installer invoked from a product via ../MC/scripts/mc-setup.js; lives in the canonical clone, never shipped" },

  { skill: ".claude/commands/session/recap.md", script: "scripts/session-recap.js",
    reason: "(C) session transcript recap; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/etc/author.md", script: "scripts/etc/consult.js",
    reason: "(C) etc:author backing engine; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/etc/eval.md", script: "scripts/etc/eval.js",
    reason: "(C) etc:eval backing engine; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/guides/organize.md", script: "scripts/guides/registry.js",
    reason: "(C) guides registry engine; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/models/check.md", script: "scripts/models/check.js",
    reason: "(C) models: suite engine; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/models/router.md", script: "scripts/models/check.js",
    reason: "(C) models: suite engine; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/models/update.md", script: "scripts/models/check.js",
    reason: "(C) models: suite engine; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/models/route.md", script: "scripts/dispatch.js",
    reason: "(C) dispatch console CLI; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/models/router.md", script: "scripts/dispatch.js",
    reason: "(C) dispatch console CLI; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/models/update.md", script: "scripts/dispatch.js",
    reason: "(C) dispatch console CLI; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/models/update.md", script: "scripts/test-dispatch-config.js",
    reason: "(C) dispatch-config enforcer; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/maps/steps.md", script: "scripts/generate-steps-maps.js",
    reason: "(C) steps-map generator; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/scan/architecture.md", script: "scripts/generate-steps-maps.js",
    reason: "(C) steps-map generator; consumer-eligible, not yet installed into products" },
  { skill: ".claude/commands/oneshot/preflight.md", script: "scripts/sync-run-number.js",
    reason: "(C) oneshot run-number sync; consumer-eligible (oneshot mode), not yet installed into products" },
  { skill: ".claude/commands/oneshot/preflight.md", script: "scripts/oneshot-store-reset.js",
    reason: "(C) oneshot store reset; consumer-eligible (oneshot mode), not yet installed into products" },
  { skill: ".claude/commands/oneshot/start.md", script: "scripts/sync-run-number.js",
    reason: "(C) oneshot run-number sync; consumer-eligible (oneshot mode), not yet installed into products" },
  { skill: ".claude/commands/oneshot/start.md", script: "scripts/oneshot-store-reset.js",
    reason: "(C) oneshot store reset; consumer-eligible (oneshot mode), not yet installed into products" },
];

function extractSkillScriptRefs(content) {
  const refs = new Set();
  const scriptPathPat = /scripts\/[A-Za-z0-9._/-]+\.(?:js|cjs|mjs|sh)(?![A-Za-z0-9])/g;

  const fenceBlockPat = /^```[^\n]*\n([\s\S]*?)^```/gm;
  let fenceMatch;
  while ((fenceMatch = fenceBlockPat.exec(content)) !== null) {
    const block = fenceMatch[1];
    const innerPat = /scripts\/[A-Za-z0-9._/-]+\.(?:js|cjs|mjs|sh)(?![A-Za-z0-9])/g;
    let m;
    while ((m = innerPat.exec(block)) !== null) {
      refs.add(m[0].replace(/\\/g, "/"));
    }
  }

  const invocationPat = /(?:node|bash)\s+(scripts\/[A-Za-z0-9._/-]+\.(?:js|cjs|mjs|sh))(?![A-Za-z0-9])/g;
  let inv;
  while ((inv = invocationPat.exec(content)) !== null) {
    refs.add(inv[1].replace(/\\/g, "/"));
  }

  return [...refs];
}

function skillScriptCompletenessGate(manifestObj, opts, readFileFn) {
  if (opts && opts.skipSkillScriptCheck) return { blocked: false, message: null, offenders: [] };

  if (!manifestObj || typeof manifestObj !== "object") {
    return {
      blocked: true,
      message:
        "skillScriptCompletenessGate: manifest is not a valid object — cannot verify. " +
        "Remediation: Re-run scripts/generate-framework-manifest.js, then re-run release-build.",
      offenders: [],
    };
  }

  const readFile = readFileFn || ((p) => fs.readFileSync(p, "utf8"));

  const allShippedPaths = new Set();
  const assetMap = manifestObj.assets || {};
  for (const kind of Object.keys(assetMap)) {
    const entries = assetMap[kind];
    if (!Array.isArray(entries)) continue;
    for (const a of entries) {
      if (!a) continue;
      if (a.src) allShippedPaths.add(a.src.replace(/\\/g, "/"));
      if (a.dest) allShippedPaths.add(a.dest.replace(/\\/g, "/"));
    }
  }

  const allowlistKeys = new Set(
    KNOWN_DANGLING_REFS.map((r) => `${r.skill}::${r.script}`),
  );

  const skillAssets = Array.isArray(assetMap.skill) ? assetMap.skill : [];

  const offenders = [];

  for (const skillAsset of skillAssets) {
    if (!skillAsset || !skillAsset.src) continue;
    const skillSrc = skillAsset.src.replace(/\\/g, "/");

    let content;
    try {
      content = readFile(path.join(REPO_ROOT, skillAsset.src));
    } catch {
      offenders.push({
        skill: skillSrc,
        script: "(unreadable — cannot verify script refs)",
        reason: "shipped skill unreadable — cannot verify script refs",
      });
      continue;
    }

    const refs = extractSkillScriptRefs(content);

    for (const scriptRef of refs) {
      const key = `${skillSrc}::${scriptRef}`;
      if (allowlistKeys.has(key)) continue;

      if (!allShippedPaths.has(scriptRef)) {
        offenders.push({ skill: skillSrc, script: scriptRef });
      }
    }
  }

  if (offenders.length === 0) return { blocked: false, message: null, offenders: [] };

  const lines = offenders.map(
    (o) => `  ${o.skill} → ${o.script}`,
  );
  const message =
    `release-build refuses to build: ${offenders.length} skill(s) reference script(s) not present in the manifest:\n` +
    lines.join("\n") + "\n" +
    "Remediation (for each entry above):\n" +
    "  (a) If the script SHOULD ship: add its directory to ASSET_DIRS in\n" +
    "      scripts/generate-framework-manifest.js, regen the manifest, re-run release-build.\n" +
    "  (b) If the reference is intentionally dev-only: add it to KNOWN_DANGLING_REFS\n" +
    "      in scripts/mc/release-build.js with a justification comment.\n" +
    "  (c) If the reference is stale/wrong: remove or correct it in the skill .md.";
  return { blocked: true, message, offenders };
}

function buildCapsule(version, opts) {
  const checkOnly = opts && opts.check;
  const capsuleDir = path.join(RELEASES_DIR, version);
  if (!fs.existsSync(capsuleDir)) {
    console.error(`Capsule directory missing: ${capsuleDir}`);
    process.exit(2);
  }

  const releaseFile = path.join(capsuleDir, "release.json");
  if (!fs.existsSync(releaseFile)) {
    console.error(`release.json missing in capsule ${version}`);
    process.exit(2);
  }
  const release = JSON.parse(fs.readFileSync(releaseFile, "utf8"));

  const manifestSnap = path.join(capsuleDir, "framework-manifest.json");
  if (!checkOnly) {
    if (!fs.existsSync(FRAMEWORK_MANIFEST)) {
      console.error(
        `framework-manifest.json missing — run scripts/generate-framework-manifest.js first`,
      );
      process.exit(2);
    }
    if (!opts || !opts.skipManifestCheck) {
      const checkRes = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, "scripts", "generate-framework-manifest.js"), "--check"],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      if (checkRes.status !== 0) {
        console.error(
          "release-build refuses to snapshot a stale framework-manifest.json:",
        );
        const detail = (checkRes.stderr || checkRes.stdout || "").trim();
        if (detail) console.error("  " + detail.split("\n").join("\n  "));
        console.error(
          "Remediation: run `node scripts/generate-framework-manifest.js` then re-run release-build.",
        );
        console.error(
          "Bypass (emergencies only): re-run with --skip-manifest-check.",
        );
        process.exit(2);
      }
    }
    fs.copyFileSync(FRAMEWORK_MANIFEST, manifestSnap);

    const honesty = betaHonestyGate(opts);
    if (honesty.blocked) {
      console.error(honesty.message);
      process.exit(2);
    }

    let snapManifestObj = null;
    try {
      snapManifestObj = JSON.parse(fs.readFileSync(manifestSnap, "utf8"));
    } catch (e) {
      console.error(
        `release-build: failed to read snapshotted manifest for runtime-exclusion gate: ${e && e.message ? e.message : e}`,
      );
      process.exit(2);
    }
    const runtimeExcl = runtimeExclusionGate(snapManifestObj, opts);
    if (runtimeExcl.blocked) {
      console.error(runtimeExcl.message);
      process.exit(2);
    }

    const skillGate = skillScriptCompletenessGate(snapManifestObj, opts);
    if (skillGate.blocked) {
      console.error(skillGate.message);
      process.exit(2);
    }
  } else if (!fs.existsSync(manifestSnap)) {
    console.error(
      `Capsule ${version} missing framework-manifest.json snapshot`,
    );
    process.exit(2);
  }

  const MIGRATIONS_ROOT = path.join(REPO_ROOT, "migrations");
  const missingMigrations = [];
  const escapingMigrations = [];
  for (const m of release.migrations || []) {
    const abs = path.resolve(capsuleDir, m.file);
    const rel = path.relative(MIGRATIONS_ROOT, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      escapingMigrations.push({
        id: m.id,
        path: path.relative(REPO_ROOT, abs).replace(/\\/g, "/"),
      });
      continue;
    }
    if (!fs.existsSync(abs)) {
      missingMigrations.push({
        id: m.id,
        expected: path.relative(REPO_ROOT, abs).replace(/\\/g, "/"),
      });
    }
  }
  if (escapingMigrations.length > 0) {
    console.error(
      `Migration paths escape the migrations/ tree (boundary violation):`,
    );
    for (const m of escapingMigrations) {
      console.error(`  ${m.id} → ${m.path}`);
    }
    console.error(
      `Refusing to build capsule. Each migration file must live under ${path.relative(REPO_ROOT, MIGRATIONS_ROOT).replace(/\\/g, "/")}/`,
    );
    process.exit(2);
  }
  if (missingMigrations.length > 0) {
    console.error(`Migration files missing for capsule ${version}:`);
    for (const m of missingMigrations) {
      console.error(`  ${m.id} → ${m.expected}`);
    }
    process.exit(2);
  }

  const checksums = {};
  for (const ent of fs.readdirSync(capsuleDir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name !== "checksums.json") {
      checksums[ent.name] = sha256File(path.join(capsuleDir, ent.name));
    }
  }

  for (const m of release.migrations || []) {
    const abs = path.resolve(capsuleDir, m.file);
    const rel = path.relative(capsuleDir, abs).replace(/\\/g, "/");
    checksums[rel] = sha256File(abs);
  }

  const checksumsFile = path.join(capsuleDir, "checksums.json");
  if (checkOnly) {
    if (!fs.existsSync(checksumsFile)) {
      console.error(`Capsule ${version} missing checksums.json`);
      process.exit(2);
    }
    const existing = JSON.parse(fs.readFileSync(checksumsFile, "utf8"));
    const drift = [];
    for (const [k, v] of Object.entries(checksums)) {
      if (existing.entries[k] !== v)
        drift.push({
          file: k,
          expected: existing.entries[k] || "(missing)",
          actual: v,
        });
    }
    if (drift.length > 0) {
      console.error(`Capsule ${version} checksum drift:`);
      for (const d of drift)
        console.error(
          `  ${d.file}: ${d.expected.slice(0, 12)} → ${d.actual.slice(0, 12)}`,
        );
      process.exit(1);
    }
    console.log(
      `Capsule ${version} verified: ${Object.keys(checksums).length} files, all checksums match.`,
    );
    printHumanReport("mc:release", {
      verdict: "Capsule verified",
      whatChanged: "No files changed in --check mode.",
      why: "The existing release capsule checksum set matches current capsule contents.",
      risksRemaining: "Run release gates separately before publishing.",
      whatWasRejected: "Checksum drift would have been rejected.",
      whatWasTested: `${Object.keys(checksums).length} capsule and migration checksum entries`,
      needsHumanDecision: "None.",
      recommendedNextAction:
        "Run node scripts/mc/release-gates.js before tagging.",
    });
    return { ok: true, version, files: Object.keys(checksums).length };
  }

  const out = {
    version,
    generatedAt: new Date().toISOString(),
    commit: gitHead(),
    entries: checksums,
  };
  fs.writeFileSync(checksumsFile, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Capsule ${version} built: ${Object.keys(checksums).length} files, checksums at ${path.relative(REPO_ROOT, checksumsFile)}`,
  );
  printHumanReport("mc:release", {
    verdict: "Capsule built",
    whatChanged: `Updated manifest snapshot and checksums for ${version}.`,
    why: "Release capsules give /mc:update a deterministic source manifest, migrations, and integrity checks.",
    risksRemaining: "Release gates still need to pass before publishing.",
    whatWasRejected:
      "Migration paths outside migrations/ were rejected before checksums.",
    whatWasTested: `${Object.keys(checksums).length} capsule and migration checksum entries`,
    needsHumanDecision: "Review changelog and upgrade notes before tagging.",
    recommendedNextAction: "Run node scripts/mc/release-gates.js.",
  });
  return { ok: true, version, files: Object.keys(checksums).length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const version = args.find((a) => /^\d+\.\d+\.\d+/.test(a));
  const checkOnly = args.includes("--check");
  const skipManifestCheck = args.includes("--skip-manifest-check");
  const skipBetaHonestyCheck = args.includes("--skip-beta-honesty-check");
  if (!version) {
    console.error(
      "Usage: node scripts/mc/release-build.js <version> [--check]" +
      " [--skip-manifest-check] [--skip-beta-honesty-check]",
    );
    process.exit(2);
  }
  buildCapsule(version, {
    check: checkOnly,
    skipManifestCheck,
    skipBetaHonestyCheck,
  });
}

module.exports = {
  buildCapsule,
  betaHonestyGate,
  runtimeExclusionGate,
  skillScriptCompletenessGate,
  KNOWN_DANGLING_REFS,
};
