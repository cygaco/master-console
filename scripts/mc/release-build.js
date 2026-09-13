/**
 * release-build.js — Build a release capsule for a given version.
 *
 * Phase 4E artifact (engine; the slash command /mc:release is a wrapper).
 *
 * Usage:
 *   node scripts/mc/release-build.js 0.1.0          # build capsule for 0.1.0
 *   node scripts/mc/release-build.js 0.1.0 --check  # verify capsule integrity, no writes
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { printHumanReport } = require("./report-format");
// SP-20260514-001 R-1 / T-20260514-069 — capsule artifact checksums use
// rawHash (binary-safe). Capsule contents (manifest, migrations) are
// byte-equality content-addressed; LF normalization would be incorrect here.
const cHash = require("./lib/content-hash");

// E1 runtime-exclusion gate: import isExcluded + RUNTIME_JSONL_PATTERN from the
// manifest generator (single source of truth). Both runtimeExclusionGate and
// the generator use the SAME predicate so they cannot silently diverge.
// If the generator refactors isExcluded, this import picks up the change
// automatically — no copy-paste to keep in sync.
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

// Continuous-enforcement baseline for the release-build Beta-honesty gate.
// Sprints that closed BEFORE this date predate the gate (they ran before Beta
// consults were continuously enforced — e.g. inline/manual execution that left
// `missing_consult` findings that can never be retroactively fixed). They are
// ACKNOWLEDGED HISTORICAL DEBT — still surfaced by the on-demand
// /scan:sprint-beta-honesty audit, but NOT release-blocking. Sprints on/after
// this date MUST have honest consults or the build is refused.
//
// This mirrors the regression enforcer's baseline philosophy (only NEW reds
// block; pre-existing tracked debt does not) and the checker's own hardcoded
// SP003_SHIP_DATE cutoff. Advancing the baseline = acknowledging a new tranche
// of debt; it should only move forward when the prior window is genuinely clean
// or its findings are formally accepted.
const BETA_HONESTY_GATE_BASELINE = "2026-05-29";

// SP-20260528-001 / #438 — Beta-consultation honesty gate for release builds.
// Runs scripts/checks/sprint-beta-honesty.js --json --since <baseline> and
// decides whether the build is blocked. Extracted + runner-injectable so the
// wiring is unit-testable without standing up a full capsule fixture.
// Returns { blocked, message }.
//
// Fails CLOSED: exit 1 (findings) AND any other non-zero/crash status
// (status null, exit 2) block — never ship on an unverifiable honesty signal.
// The audit is date-cutoff-aware and graceful-empty, so a repo with no
// applicable post-baseline /sprint:full runs returns blocked:false (a no-op for
// product repos and pre-gate canonical history). Skipped entirely under
// opts.skipBetaHonestyCheck (--skip-beta-honesty-check, emergencies only).
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
          "--since",
          BETA_HONESTY_GATE_BASELINE,
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
    // Not JSON (crash / usage error) — fall back to raw streams (still blocks).
    detail = (res.stderr || res.stdout || `exit ${res.status}`).trim();
  }
  const message =
    "release-build refuses to build: Beta-consultation honesty findings in recent sprints\n" +
    "(missing_consult / placeholder_verdict / escalate_without_halt / canned_* non-substantive verdicts):\n" +
    (detail ? "  " + detail.split("\n").join("\n  ") + "\n" : "") +
    "Remediation: resolve NEW findings (run `node scripts/checks/sprint-beta-honesty.js`), then re-run release-build.\n" +
    "Sanctioned triage (ED-049): for immutable/historical findings, waive them with an approver + reason —\n" +
    "  `node scripts/checks/beta-honesty-triage.js list` then `... waive --sprint <id>|--all --expect <N> --reason \"…\" --approver \"…\"`.\n" +
    "  The audit then blocks only on NEW (un-waived) findings — no source edit, no blanket bypass.\n" +
    "Bypass (true emergencies only, leaves NO audit trail): re-run with --skip-beta-honesty-check.";
  return { blocked: true, message };
}

// ─────────────────────────────────────────────────────────────────────────────
// E1: Runtime-exclusion gate (SP-0181 A2)
//
// Reads the SNAPSHOTTED manifest from the capsule and checks whether any asset
// entry has owner === "runtime" or matches the tracked-transient filename
// pattern (events/tools/skill-usage *.jsonl). These are the W-8 class:
// per-agent event logs that got swept into the manifest walk and mislabeled
// framework/generated. They must never ship.
//
// Fails closed (process.exit(2)) when blocked === true.
// Runner-injectable (runChecker param) for unit tests without a full capsule.
// Returns { blocked, message, offenders }.
// ─────────────────────────────────────────────────────────────────────────────
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

  // Flatten all asset entries from the manifest's assets map (keyed by kind).
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
    // FIX2 belt-and-suspenders: normalise separators before the pattern test so
    // a Windows backslash path (beta\events.jsonl) never evades the check even
    // if RUNTIME_JSONL_PATTERN's [\\/] class is somehow not in effect.
    const aPath = (a.src || a.dest || "").replace(/\\/g, "/");
    const isRuntime = a.owner === "runtime";
    // manifestIsExcluded is the SAME predicate as generate-framework-manifest.js#isExcluded
    // (imported above). If the generator would have excluded this path, so must we.
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
  // FIX3: No production bypass advertised (flag removed from CLI).
  // Tests can still inject opts.skipRuntimeExclusionCheck programmatically.
  return { blocked: true, message, offenders };
}

// ─────────────────────────────────────────────────────────────────────────────
// E3: Skill↔script completeness gate (SP-0181 A3 / WG-15)
//
// Parses every SHIPPED skill .md for `scripts/...` references and fails if any
// referenced script is NOT a manifest asset. A skill that references a backing
// script which never ships gives the consumer a dead slash command.
//
// Fails closed. Runner-injectable. Returns { blocked, message, offenders }.
//
// KNOWN_DANGLING_REFS: curated allowlist for intentional non-shipped script
// references (e.g. dev-only scripts documented in a skill for reference).
// Start EMPTY — only add with justification.
// ─────────────────────────────────────────────────────────────────────────────

// Empty until a genuine intentional case is discovered and documented.
// BASELINE (2026-06-05, MC 0.14.0): the skillScriptCompletenessGate is a new
// enforcer; 0.14.0 is the first release to run it against the full shipped-skill set,
// which surfaced 32 PRE-EXISTING skill->script refs (0.13.x shipped this same drift
// undetected). Per the standard "baseline the known set, fail on anything new" pattern
// for introducing a strict gate against pre-existing debt, the known refs are recorded
// below with honest per-entry reasons in three classes:
//   (A) gate false-positives — illustrative placeholders / run-local artifacts that are
//       not canonical scripts at all (the heuristic matched an example path);
//   (B) canonical-dev / framework-maintenance / installer scripts intentionally NOT
//       shipped into product installs;
//   (C) consumer-eligible scripts that back a shipped consumer skill but are NOT YET in
//       the manifest — these SHOULD ship; the real fix is the E3 ship-boundary audit.
// Tracked follow-up (E3 ship-boundary audit, see issues.md + ROADMAP.md): ship every
// class-(C) script, teach this gate to skip class-(A) placeholders, and confirm the
// class-(B) dev-only calls. The gate still BLOCKS any NEW (unlisted) skill->script ref.
const KNOWN_DANGLING_REFS = [
  // ── (A) Illustrative placeholders / run-local artifacts — gate false-positives ──
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

  // ── (B) Canonical-dev / framework-maintenance / installer — intentionally not shipped ──
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
  { skill: ".claude/commands/scan/patterns.md", script: "scripts/recurring-issues-helper.js",
    reason: "(B) recurring-issues ledger helper; canonical-dev store, not shipped" },
  { skill: ".claude/commands/scan/patterns.md", script: "scripts/check-guard-promotion.js",
    reason: "(B) hook-guard promotion analysis; canonical-dev framework tuning, not shipped" },
  { skill: ".claude/commands/scan/regressions.md", script: "scripts/testsuite/run.js",
    reason: "(B) MC internal regression suite (scripts/testsuite/); canonical CI only, never shipped" },
  { skill: ".claude/commands/roadmap/prioritize.md", script: "scripts/testsuite/enforce.js",
    reason: "(B) MC internal regression-suite enforcer (scripts/testsuite/); canonical CI only, never shipped" },
  { skill: ".claude/commands/mc/setup.md", script: "scripts/warp-setup.js",
    reason: "(B) canonical installer invoked from a product via ../MC/scripts/warp-setup.js; lives in the canonical clone, never shipped" },

  // ── (C) Consumer-eligible — backs a shipped consumer skill but NOT YET shipped (E3 audit will ship these) ──
  { skill: ".claude/commands/session/recap.md", script: "scripts/session-recap.js",
    reason: "(C) session transcript recap; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/etc/author.md", script: "scripts/etc/consult.js",
    reason: "(C) etc:author backing engine; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/etc/eval.md", script: "scripts/etc/eval.js",
    reason: "(C) etc:eval backing engine; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/guides/organize.md", script: "scripts/guides/registry.js",
    reason: "(C) guides registry engine; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/models/check.md", script: "scripts/models/check.js",
    reason: "(C) models: suite engine; consumer-eligible (0.13.0 feature), NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/models/router.md", script: "scripts/models/check.js",
    reason: "(C) models: suite engine; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/models/update.md", script: "scripts/models/check.js",
    reason: "(C) models: suite engine; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/models/route.md", script: "scripts/dispatch.js",
    reason: "(C) dispatch console CLI; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/models/router.md", script: "scripts/dispatch.js",
    reason: "(C) dispatch console CLI; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/models/update.md", script: "scripts/dispatch.js",
    reason: "(C) dispatch console CLI; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/models/update.md", script: "scripts/test-dispatch-config.js",
    reason: "(C) dispatch-config enforcer; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/maps/steps.md", script: "scripts/generate-steps-maps.js",
    reason: "(C) steps-map generator; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/scan/architecture.md", script: "scripts/generate-steps-maps.js",
    reason: "(C) steps-map generator; consumer-eligible, NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/oneshot/preflight.md", script: "scripts/sync-run-number.js",
    reason: "(C) oneshot run-number sync; consumer-eligible (oneshot mode), NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/oneshot/preflight.md", script: "scripts/oneshot-store-reset.js",
    reason: "(C) oneshot store reset; consumer-eligible (oneshot mode), NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/oneshot/start.md", script: "scripts/sync-run-number.js",
    reason: "(C) oneshot run-number sync; consumer-eligible (oneshot mode), NOT YET shipped — ship in E3 audit" },
  { skill: ".claude/commands/oneshot/start.md", script: "scripts/oneshot-store-reset.js",
    reason: "(C) oneshot store reset; consumer-eligible (oneshot mode), NOT YET shipped — ship in E3 audit" },
];

// FIX5: Extract script refs from INVOCATION context only.
//
// Two strategies:
//   1. Any `scripts/...` ref inside a fenced code block (``` ... ```) — these
//      almost always document real invocations, not illustrative prose.
//   2. Any ref immediately preceded by `node ` or `bash ` anywhere in the file
//      (catches inline code spans like `node scripts/foo.js` in prose).
//
// Extensions: .js, .cjs, .mjs, .sh — covers all script types shipped by skills.
// (.ts intentionally excluded — skills don't invoke TypeScript sources directly.)
//
// Heuristic bias: a scripts/ ref inside a fenced block IS caught even if
// illustrative — in practice, skill fenced blocks document real invocations.
// A bare mention in prose ("see scripts/example.js for reference") without a
// node/bash prefix is NOT caught. Residual documented above.
//
// Note: all regexes are created inside extractSkillScriptRefs() per-call to
// avoid lastIndex state leaking between invocations.
function extractSkillScriptRefs(content) {
  const refs = new Set();
  // Trailing (?![A-Za-z0-9]) keeps `.js` from matching inside `.json` paths
  // (e.g. scripts/checks/foo.allowlist.json must NOT yield foo.allowlist.js).
  const scriptPathPat = /scripts\/[A-Za-z0-9._/-]+\.(?:js|cjs|mjs|sh)(?![A-Za-z0-9])/g;

  // Strategy 1: extract all script refs inside fenced code blocks.
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

  // Strategy 2: refs immediately preceded by `node ` or `bash ` (any context).
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

  // Default file reader (real FS) — injected in tests.
  const readFile = readFileFn || ((p) => fs.readFileSync(p, "utf8"));

  // Build a flat set of all shipped asset src/dest paths (all kinds) for fast
  // O(1) lookup. Normalise to forward-slash.
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

  // Build the allowlist as a Set of "skill::script" keys for fast lookup.
  const allowlistKeys = new Set(
    KNOWN_DANGLING_REFS.map((r) => `${r.skill}::${r.script}`),
  );

  // Collect all shipped skill assets.
  const skillAssets = Array.isArray(assetMap.skill) ? assetMap.skill : [];

  const offenders = [];

  for (const skillAsset of skillAssets) {
    if (!skillAsset || !skillAsset.src) continue;
    const skillSrc = skillAsset.src.replace(/\\/g, "/");

    // Read the skill .md from the REPO_ROOT source (not the capsule snapshot —
    // the capsule snapshot only contains framework-manifest.json, not the skill
    // files themselves; skills ship from the canonical source tree).
    let content;
    try {
      content = readFile(path.join(REPO_ROOT, skillAsset.src));
    } catch {
      // FIX4: An unreadable SHIPPED skill is a gate FAILURE (fail-closed).
      // Cannot verify its script refs → block the release. A missing skill
      // source at build time is itself a serious problem; silently skipping
      // would allow a false-green (gap class from gauntlet review).
      offenders.push({
        skill: skillSrc,
        script: "(unreadable — cannot verify script refs)",
        reason: "shipped skill unreadable — cannot verify script refs",
      });
      continue;
    }

    // FIX5: Extract script refs from INVOCATION context only (node/bash prefix
    // or inside a fenced code block). Prose mentions like "see scripts/x.js"
    // are intentionally NOT caught. Extensions: .js, .cjs, .mjs, .sh.
    const refs = extractSkillScriptRefs(content);

    for (const scriptRef of refs) {
      // Is this reference in the allowlist?
      const key = `${skillSrc}::${scriptRef}`;
      if (allowlistKeys.has(key)) continue;

      // Is the referenced script a shipped manifest asset?
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
  // FIX3: No production bypass advertised (flag removed from CLI).
  // Tests can still inject opts.skipSkillScriptCheck programmatically.
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

  // 1. Snapshot framework-manifest.json into capsule (unless already present
  //    and we're in --check mode).
  //
  // SP-20260524-002 / T-183 — Refuse to snapshot a stale manifest. Run
  // generate-framework-manifest.js --check before copying. A stale manifest
  // captured into the capsule would lie about what shipped, downstream
  // /mc:update would fail to copy phantom files (the post-warp:promote
  // ghost-files class), and the only signal would be deep-buried in apply
  // failures days later. Bypass with --skip-manifest-check for emergency
  // re-builds when you've already verified manifest health by other means.
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

    // SP-20260528-001 / #438 — Refuse to build a capsule when recent
    // post-cutoff sprints carry Beta-consultation honesty findings. The
    // /scan:sprint-beta-honesty audit was on-demand only; wiring it here makes
    // the 0.11.0 Beta cadence continuously enforced at release time
    // (mechanism → audit → gate), not spot-checked. See betaHonestyGate().
    const honesty = betaHonestyGate(opts);
    if (honesty.blocked) {
      console.error(honesty.message);
      process.exit(2);
    }

    // SP-0181 E1 — Runtime-exclusion gate. Read the SNAPSHOTTED manifest (just
    // copied above) and assert no asset has owner=runtime or is a tracked-
    // transient (events/tools/skill-usage .jsonl). The W-8 class: these got
    // swept into the agents/maps walk and mislabeled framework/generated in
    // the 0.10.0 capsule. Runs after betaHonestyGate so all gates execute in
    // a consistent order.
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

    // SP-0181 E3 — Skill↔script completeness gate. Parse every shipped skill
    // .md for scripts/...js references and fail if any referenced script is
    // NOT a manifest asset. A skill that references a backing script which
    // never ships gives the consumer a dead slash command (WG-15 class).
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

  // 2. Validate migrations referenced in release.json exist.
  // Fix-forward (codex Phase 4 review 2026-04-30): require all migration
  // paths to resolve INSIDE the repo's migrations/ tree. Without this, a
  // hand-edited release.json could escape via `../../../../etc/...` and
  // checksums.json would silently fingerprint arbitrary local files.
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

  // 3. Compute checksums for every file in the capsule
  const checksums = {};
  for (const ent of fs.readdirSync(capsuleDir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name !== "checksums.json") {
      checksums[ent.name] = sha256File(path.join(capsuleDir, ent.name));
    }
  }

  // 4. Compute checksums for migration files (stored as relative paths under <capsule>/migrations.relative)
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

  // 5. Write checksums.json
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
  // FIX3: E1 and E3 gate bypass flags are REMOVED as public CLI flags.
  // No production bypass is advertised. Tests that need to bypass a gate
  // should inject opts directly into the gate functions via the programmatic
  // opts.skipRuntimeExclusionCheck / opts.skipSkillScriptCheck properties.
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
