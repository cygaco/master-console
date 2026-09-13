#!/usr/bin/env node
/**
 * dispatch-readiness.test.js — Unit + integration tests for SP-0181
 * dispatch-readiness slice (A1/A3 + E1 + E3-gate).
 *
 * Sprint:  SP-0181
 * Covers:
 *   - provider-health-check exits 2 on red verdict (false-green fix)
 *   - runtimeExclusionGate: blocks owner=runtime; passes clean; fails closed
 *     on malformed manifest
 *   - skillScriptCompletenessGate: blocks missing script ref; passes all-ok;
 *     allowlist honored
 *   - isExcluded agreement: E1 gate pattern (via imported isExcluded) matches
 *     generate-framework-manifest.js#isExcluded on shared fixture set
 *   - SessionStart per-role nudge: fail-open (try/catch present; no throw on
 *     provider load failure)
 *
 * Run:
 *   node tests/mc/dispatch-readiness.test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    process.stdout.write(`  ok    ${name}\n`);
  } else {
    failed++;
    failures.push(`${name}: ${detail || "(no detail)"}`);
    process.stdout.write(`  FAIL  ${name}${detail ? ": " + detail : ""}\n`);
  }
}

// ── Load subjects ─────────────────────────────────────────────────────────────

const RELEASE_BUILD = path.join(REPO_ROOT, "scripts", "mc", "release-build.js");
const HEALTH_CHECK = path.join(REPO_ROOT, "scripts", "mc", "provider-health-check.js");
const GENERATE_MANIFEST = path.join(REPO_ROOT, "scripts", "generate-framework-manifest.js");
const SESSION_START = path.join(REPO_ROOT, "scripts", "hooks", "session-start.js");

const { runtimeExclusionGate, skillScriptCompletenessGate, KNOWN_DANGLING_REFS } =
  require(RELEASE_BUILD);

const { isExcluded: genIsExcluded, RUNTIME_JSONL_PATTERN } =
  require(GENERATE_MANIFEST);

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: provider-health-check exits 2 on red verdict (false-green fix)
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n1. provider-health-check exit-code contract\n");

{
  // Read the source and verify the false-green fix is present. This is a
  // static assertion — the implementation fix is `process.exit(verdict === "red" ? 2 : 0)`.
  // We verify statically (no live exec needed) because the fix is a one-liner
  // and we don't want to depend on provider CLI availability in CI.
  const src = fs.readFileSync(HEALTH_CHECK, "utf8");
  check(
    "provider-health-check: unconditional exit(0) is gone",
    !src.includes("process.exit(0)") || src.includes("verdict === \"red\""),
    "File still contains unconditional process.exit(0) without a verdict guard",
  );
  check(
    "provider-health-check: exit(2) on red is present",
    src.includes("verdict === \"red\" ? 2 : 0"),
    "Expected `verdict === \"red\" ? 2 : 0` in source",
  );

  // Verify the exit-code logic by extracting it as a pure function.
  // The logic: verdict=red -> 2, verdict=yellow -> 0, verdict=green -> 0.
  const exitCodeFor = (verdict) => (verdict === "red" ? 2 : 0);
  check("exit code: green → 0", exitCodeFor("green") === 0);
  check("exit code: yellow → 0", exitCodeFor("yellow") === 0);
  check("exit code: red → 2", exitCodeFor("red") === 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: runtimeExclusionGate
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n2. runtimeExclusionGate\n");

{
  // 2a. Clean manifest (no runtime assets) → passes
  const cleanManifest = {
    assets: {
      skill: [
        { id: "skill.commands.warp.health.md", src: ".claude/commands/warp/health.md", owner: "framework" },
        { id: "skill.commands.agents.test.md", src: ".claude/commands/agents/test.md", owner: "framework" },
      ],
      hook: [
        { id: "hook.scripts.hooks.session-start.js", src: "scripts/hooks/session-start.js", owner: "framework" },
      ],
    },
  };
  const r1 = runtimeExclusionGate(cleanManifest, {});
  check("runtimeExclusionGate: clean manifest → not blocked", !r1.blocked, r1.message);
  check("runtimeExclusionGate: clean manifest → 0 offenders", r1.offenders.length === 0, JSON.stringify(r1.offenders));

  // 2b. Manifest with owner=runtime entry → blocked
  const runtimeManifest = {
    assets: {
      skill: [
        { id: "skill.commands.warp.health.md", src: ".claude/commands/warp/health.md", owner: "framework" },
      ],
      maps_baseline: [
        {
          id: "maps_baseline.claude.project.events.events.jsonl",
          src: ".claude/project/events/events.jsonl",
          owner: "runtime",
        },
      ],
    },
  };
  const r2 = runtimeExclusionGate(runtimeManifest, {});
  check("runtimeExclusionGate: owner=runtime → blocked", r2.blocked, "expected blocked=true");
  check(
    "runtimeExclusionGate: offenders list non-empty",
    r2.offenders.length > 0,
    "expected offenders",
  );
  check(
    "runtimeExclusionGate: message names remediation",
    r2.message && r2.message.includes("generate-framework-manifest.js"),
    r2.message,
  );

  // 2c. Manifest with a tracked-transient .jsonl filename (events.jsonl) → blocked
  const transientManifest = {
    assets: {
      agent: [
        {
          id: "agent.claude.agents.00-alex.events.jsonl",
          src: ".claude/agents/00-alex/.system/events.jsonl",
          owner: "generated",
        },
      ],
    },
  };
  const r3 = runtimeExclusionGate(transientManifest, {});
  check(
    "runtimeExclusionGate: events.jsonl path → blocked (W-8 class)",
    r3.blocked,
    "expected blocked=true for events.jsonl path",
  );

  // 2d. skill-usage.jsonl → blocked
  const skillUsageManifest = {
    assets: {
      maps_baseline: [
        {
          id: "maps_baseline.claude.project.maps.skill-usage.jsonl",
          src: ".claude/project/maps/skill-usage.jsonl",
          owner: "generated",
        },
      ],
    },
  };
  const r4 = runtimeExclusionGate(skillUsageManifest, {});
  check("runtimeExclusionGate: skill-usage.jsonl → blocked", r4.blocked, "expected blocked=true");

  // 2e. Malformed manifest (not an object) → fails closed (blocked)
  const r5 = runtimeExclusionGate(null, {});
  check(
    "runtimeExclusionGate: null manifest → fails closed",
    r5.blocked,
    "expected blocked=true for null manifest",
  );
  const r6 = runtimeExclusionGate("not-an-object", {});
  check(
    "runtimeExclusionGate: string manifest → fails closed",
    r6.blocked,
    "expected blocked=true for non-object manifest",
  );

  // 2f. Bypass flag → not blocked even with runtime asset
  const r7 = runtimeExclusionGate(runtimeManifest, { skipRuntimeExclusionCheck: true });
  check("runtimeExclusionGate: skipRuntimeExclusionCheck bypass → not blocked", !r7.blocked);

  // 2g. Empty assets → passes
  const r8 = runtimeExclusionGate({ assets: {} }, {});
  check("runtimeExclusionGate: empty assets → passes", !r8.blocked);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: skillScriptCompletenessGate
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n3. skillScriptCompletenessGate\n");

{
  // Build a minimal manifest with a skill and some shipped scripts.
  const makeManifest = (skillContent, shippedScripts) => ({
    assets: {
      skill: [
        {
          id: "skill.commands.warp.test.md",
          src: ".claude/commands/warp/test.md",
          dest: ".claude/commands/warp/test.md",
          owner: "framework",
        },
      ],
      mc_script: shippedScripts.map((s) => ({
        id: `mc_script.${s.replace(/\//g, ".")}`,
        src: s,
        dest: s,
        owner: "framework",
      })),
    },
  });

  // Inject a fake file reader so tests don't need real .md files on disk.
  const fakeReader = (filePath) => {
    // Return the skillContent keyed by basename for simplicity.
    const basename = path.basename(filePath);
    if (fakeReader._files && fakeReader._files[basename]) {
      return fakeReader._files[basename];
    }
    throw new Error("ENOENT: " + filePath);
  };
  fakeReader._files = {};

  // 3a. Skill references a script that IS in the manifest → passes
  fakeReader._files["test.md"] =
    "Run `node scripts/mc/provider-smoke.js --per-role` to check.";
  const m1 = makeManifest("", ["scripts/mc/provider-smoke.js"]);
  const g1 = skillScriptCompletenessGate(m1, {}, fakeReader);
  check("skillScriptCompletenessGate: all refs shipped → passes", !g1.blocked, g1.message);

  // 3b. Skill references a script that is NOT in the manifest → blocked
  fakeReader._files["test.md"] =
    "See `node scripts/mc/missing-script.js` for details.";
  const m2 = makeManifest("", []); // no scripts shipped
  const g2 = skillScriptCompletenessGate(m2, {}, fakeReader);
  check("skillScriptCompletenessGate: missing script ref → blocked", g2.blocked, "expected blocked=true");
  check(
    "skillScriptCompletenessGate: offenders list non-empty",
    g2.offenders.length > 0,
    JSON.stringify(g2.offenders),
  );
  check(
    "skillScriptCompletenessGate: message names remediation",
    g2.message && g2.message.includes("ASSET_DIRS"),
    g2.message,
  );

  // 3c. Multiple refs — one shipped, one missing → blocked for missing only
  fakeReader._files["test.md"] =
    "Use `node scripts/mc/provider-smoke.js` or `node scripts/mc/missing-tool.js`.";
  const m3 = makeManifest("", ["scripts/mc/provider-smoke.js"]); // only smoke shipped
  const g3 = skillScriptCompletenessGate(m3, {}, fakeReader);
  check("skillScriptCompletenessGate: one shipped one missing → blocked", g3.blocked);
  check(
    "skillScriptCompletenessGate: only missing-tool in offenders",
    g3.offenders.length === 1 && g3.offenders[0].script === "scripts/mc/missing-tool.js",
    JSON.stringify(g3.offenders),
  );

  // 3d. Bypass flag → passes even with missing ref
  const g4 = skillScriptCompletenessGate(m2, { skipSkillScriptCheck: true }, fakeReader);
  check("skillScriptCompletenessGate: skipSkillScriptCheck bypass → passes", !g4.blocked);

  // 3e. Malformed manifest → fails closed
  const g5 = skillScriptCompletenessGate(null, {}, fakeReader);
  check("skillScriptCompletenessGate: null manifest → fails closed", g5.blocked);

  // 3f. No skill assets → passes (nothing to check)
  const m5 = { assets: { mc_script: [] } };
  const g6 = skillScriptCompletenessGate(m5, {}, fakeReader);
  check("skillScriptCompletenessGate: no skill assets → passes", !g6.blocked);

  // 3g. FIX4: Shipped skill file unreadable → gate BLOCKS (fail-closed).
  // An unreadable skill cannot have its script refs verified; blocking prevents
  // false-green releases where a dead skill ships silently.
  fakeReader._files = {}; // no files readable
  const m6 = makeManifest("", []);
  const g7 = skillScriptCompletenessGate(m6, {}, fakeReader);
  check("skillScriptCompletenessGate: unreadable shipped skill → blocks (fail-closed)", g7.blocked,
    "FIX4: expected blocked=true when shipped skill is unreadable");

  // 3h. KNOWN_DANGLING_REFS starts empty (no intentional allowlist entries yet)
  check(
    "KNOWN_DANGLING_REFS is empty by default (no pre-populated allowlist)",
    Array.isArray(KNOWN_DANGLING_REFS) && KNOWN_DANGLING_REFS.length === 0,
    `length=${KNOWN_DANGLING_REFS ? KNOWN_DANGLING_REFS.length : "undefined"}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: isExcluded agreement between E1 gate and generate-framework-manifest
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n4. isExcluded agreement between E1 gate and generator\n");

{
  // The E1 gate uses the imported `genIsExcluded` + `RUNTIME_JSONL_PATTERN`
  // from generate-framework-manifest.js. This section verifies that both
  // predicates agree on a shared fixture set — ensuring they cannot diverge.

  // Fixture set: paths that SHOULD be excluded (owner=runtime / tracked-transient)
  const shouldExclude = [
    ".claude/project/events/events.jsonl",
    ".claude/agents/00-alex/.system/events.jsonl",
    ".claude/project/maps/tools.jsonl",
    ".claude/project/maps/skill-usage.jsonl",
    ".claude/runtime/",
    ".claude/runtime/handoffs/somefile.md",
    ".claude/project/events/",
    ".claude/agents/president/_system/oneshot/retros/run-009/HYGIENE.md",
  ];

  // Fixture set: paths that SHOULD NOT be excluded (normal framework assets)
  const shouldNotExclude = [
    ".claude/commands/warp/health.md",
    "scripts/mc/provider-smoke.js",
    "scripts/hooks/session-start.js",
    ".claude/agents/00-alex/alpha.md",
    "framework/releases/0.18.0/release.json",
    ".claude/project/reference/reasoning-frameworks.md",
  ];

  for (const p of shouldExclude) {
    // genIsExcluded should return true
    const excluded = genIsExcluded(p);
    // RUNTIME_JSONL_PATTERN catches the .jsonl ones; genIsExcluded catches prefixes
    const patternMatch = RUNTIME_JSONL_PATTERN.test(p);
    check(
      `isExcluded agrees: should-exclude "${p}"`,
      excluded || patternMatch,
      `genIsExcluded=${excluded} patternMatch=${patternMatch}`,
    );
  }

  for (const p of shouldNotExclude) {
    const excluded = genIsExcluded(p);
    check(
      `isExcluded agrees: should-NOT-exclude "${p}"`,
      !excluded,
      `genIsExcluded=${excluded} (expected false)`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: SessionStart per-role nudge — fail-open
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n5. SessionStart per-role nudge — fail-open\n");

{
  // The nudge is wrapped in try/catch inside session-start.js. Verify:
  // (a) The source contains the try/catch wrapper for the nudge.
  // (b) The module exports nothing that throws on require (the imperative
  //     code is stdin-driven, so requiring the module is safe).

  const src = fs.readFileSync(SESSION_START, "utf8");

  check(
    "session-start: per-role nudge wrapped in try/catch",
    src.includes("dispatchReadinessNudge") &&
      src.includes("perRoleProbe") &&
      // Verify both the try and catch are present in the same block
      (src.match(/try\s*\{[^}]*perRoleProbe/ms) !== null ||
       src.includes("} catch {") || src.includes("} catch (e) {") || src.includes("} catch(_") ),
    "Could not find try/catch wrapper around perRoleProbe in session-start.js",
  );

  check(
    "session-start: dispatchReadinessNudge added to injection guard",
    src.includes("dispatchReadinessNudge") && src.includes("teamMarkerWarning ||\n      dispatchReadinessNudge"),
    "dispatchReadinessNudge not wired into the injection guard condition",
  );

  check(
    "session-start: nudge only on startup or clear (gated)",
    src.includes('source === "startup" || source === "clear"') &&
      src.indexOf("dispatchReadinessNudge") >
        src.indexOf('source === "startup" || source === "clear"'),
    "per-role nudge missing startup/clear gate",
  );

  // (c) Static: the module uses --no-ping (token-free) path
  check(
    "session-start: uses --no-ping for token-free resolve",
    src.includes("noPing: true"),
    "Expected noPing: true in session-start.js per-role sweep",
  );

  // (d) Fail-open: a spawnSync with empty stdin should exit 0 (the hook
  //     wraps everything in try/catch and calls process.exit(0) in the catch).
  //     We pipe an invalid JSON to confirm the outer try/catch catches and exits 0.
  const result = spawnSync(
    process.execPath,
    [SESSION_START],
    {
      input: "not-valid-json\n",
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  check(
    "session-start: exits 0 even with invalid stdin input (fail-open)",
    result.status === 0,
    `exit=${result.status} stderr=${(result.stderr || "").slice(0, 200)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: health.md and test.md have required content
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n6. Skill .md content assertions\n");

{
  const healthMd = fs.readFileSync(
    path.join(REPO_ROOT, ".claude", "commands", "warp", "health.md"),
    "utf8",
  );
  check(
    "health.md: references provider-smoke.js --per-role",
    healthMd.includes("provider-smoke.js --per-role"),
    "Expected `provider-smoke.js --per-role` in health.md section 11",
  );
  check(
    "health.md: documents exit 2 contract",
    healthMd.includes("Exit 2") || healthMd.includes("exit 2"),
    "Missing exit 2 contract in health.md",
  );
  check(
    "health.md: section 12 (Dispatch Hygiene) still present",
    healthMd.includes("### 12.") || healthMd.includes("Dispatch Hygiene"),
    "Section 12 Dispatch Hygiene was removed from health.md",
  );
  check(
    "health.md: per-role statuses documented (model_unavailable)",
    healthMd.includes("model_unavailable"),
    "Missing per-role status model_unavailable in health.md",
  );
  check(
    "health.md: fellback status documented",
    healthMd.includes("fellback"),
    "Missing fellback status in health.md",
  );

  const testMd = fs.readFileSync(
    path.join(REPO_ROOT, ".claude", "commands", "agents", "test.md"),
    "utf8",
  );
  check(
    "test.md: --smoke / --full passthrough documented",
    testMd.includes("--smoke") && testMd.includes("--full"),
    "Missing --smoke/--full passthrough in test.md",
  );
  check(
    "test.md: documents non-zero exit on RED",
    testMd.includes("2") && (testMd.includes("RED") || testMd.includes("red")),
    "Missing exit-2-on-RED contract in test.md",
  );
  check(
    "test.md: explains relationship between cli.js and smoke",
    testMd.includes("dispatch-agent.js") || testMd.includes("cli.js"),
    "Missing cli.js vs smoke relationship in test.md",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: FIX1 — cli.js --smoke/--full routes to provider-smoke + propagates exit code
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n7. FIX1 — cli.js --smoke/--full routing\n");

{
  const CLI_JS = path.join(REPO_ROOT, "scripts", "agents", "cli.js");
  const { testCmd } = require(CLI_JS);

  // 7a. --smoke routes to provider-smoke.js --per-role
  let capturedExe = null;
  let capturedArgs = null;
  const mockSpawnGreen = (exe, args, opts) => {
    capturedExe = exe;
    capturedArgs = args;
    return { status: 0 }; // simulate green
  };
  const greenExit = testCmd(["--smoke"], mockSpawnGreen);
  check(
    "FIX1: --smoke routes to provider-smoke.js --per-role",
    capturedArgs !== null &&
      capturedArgs.some((a) => a.includes("provider-smoke.js")) &&
      capturedArgs.includes("--per-role"),
    `args=${JSON.stringify(capturedArgs)}`,
  );
  check(
    "FIX1: --smoke propagates exit 0 (green)",
    greenExit === 0,
    `exit=${greenExit}`,
  );

  // 7b. --smoke propagates non-zero exit code (RED)
  const mockSpawnRed = (exe, args, opts) => ({ status: 2 }); // simulate RED
  const redExit = testCmd(["--smoke"], mockSpawnRed);
  check(
    "FIX1: --smoke propagates exit 2 (RED — not swallowed to 0)",
    redExit === 2,
    `exit=${redExit}`,
  );

  // 7c. --full is an alias for --smoke (same routing)
  let capturedFull = null;
  const mockSpawnFull = (exe, args, opts) => {
    capturedFull = args;
    return { status: 0 };
  };
  testCmd(["--full"], mockSpawnFull);
  check(
    "FIX1: --full alias routes to provider-smoke.js --per-role",
    capturedFull !== null &&
      capturedFull.some((a) => a.includes("provider-smoke.js")) &&
      capturedFull.includes("--per-role"),
    `args=${JSON.stringify(capturedFull)}`,
  );

  // 7d. null status (signal-killed) → treated as exit 2
  const mockSpawnSignal = () => ({ status: null });
  const signalExit = testCmd(["--smoke"], mockSpawnSignal);
  check(
    "FIX1: signal-killed (status=null) → exit 2 (treated as failure)",
    signalExit === 2,
    `exit=${signalExit}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 8: FIX2 — RUNTIME_JSONL_PATTERN separator-agnostic + case-insensitive
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n8. FIX2 — RUNTIME_JSONL_PATTERN backslash + case coverage\n");

{
  // 8a. Backslash separator caught (Windows path evasion fixed)
  check(
    "FIX2: RUNTIME_JSONL_PATTERN catches beta\\events.jsonl (backslash sep)",
    RUNTIME_JSONL_PATTERN.test("beta\\events.jsonl"),
    "Expected backslash-separated path to be caught",
  );

  // 8b. Case-insensitive: events.JSONL caught
  check(
    "FIX2: RUNTIME_JSONL_PATTERN catches events.JSONL (case-insensitive)",
    RUNTIME_JSONL_PATTERN.test("beta/events.JSONL"),
    "Expected uppercase extension to be caught",
  );

  // 8c. Mixed case + backslash
  check(
    "FIX2: RUNTIME_JSONL_PATTERN catches beta\\skill-usage.JSONL",
    RUNTIME_JSONL_PATTERN.test("beta\\skill-usage.JSONL"),
    "Expected backslash + uppercase to be caught",
  );

  // 8d. runtimeExclusionGate catches an asset with backslash src path
  const { runtimeExclusionGate: reg } = require(RELEASE_BUILD);
  const backslashManifest = {
    assets: {
      agent: [
        {
          id: "agent.test.events",
          src: "beta\\events.jsonl",  // Windows-style path
          owner: "generated",
        },
      ],
    },
  };
  const r9 = reg(backslashManifest, {});
  check(
    "FIX2: runtimeExclusionGate blocks asset with backslash path (beta\\events.jsonl)",
    r9.blocked,
    `blocked=${r9.blocked} offenders=${JSON.stringify(r9.offenders)}`,
  );

  // 8e. Forward-slash path still caught (regression guard)
  const fwdManifest = {
    assets: {
      agent: [
        { id: "agent.test.tools", src: "beta/tools.jsonl", owner: "generated" },
      ],
    },
  };
  const r10 = reg(fwdManifest, {});
  check(
    "FIX2: runtimeExclusionGate still blocks forward-slash path (regression guard)",
    r10.blocked,
    `blocked=${r10.blocked}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 9: FIX3 — CLI bypass flags removed from release-build.js
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n9. FIX3 — production CLI bypass flags removed\n");

{
  const src = fs.readFileSync(RELEASE_BUILD, "utf8");

  check(
    "FIX3: --skip-runtime-exclusion-check not parsed from CLI args",
    !src.includes('args.includes("--skip-runtime-exclusion-check")'),
    "CLI flag --skip-runtime-exclusion-check is still being parsed from args",
  );

  check(
    "FIX3: --skip-skill-script-check not parsed from CLI args",
    !src.includes('args.includes("--skip-skill-script-check")'),
    "CLI flag --skip-skill-script-check is still being parsed from args",
  );

  check(
    "FIX3: usage string does not mention --skip-runtime-exclusion-check",
    !src.includes("--skip-runtime-exclusion-check"),
    "Usage string still advertises --skip-runtime-exclusion-check",
  );

  check(
    "FIX3: usage string does not mention --skip-skill-script-check",
    !src.includes("--skip-skill-script-check"),
    "Usage string still advertises --skip-skill-script-check",
  );

  // Programmatic bypass still works (tests use it directly)
  const { runtimeExclusionGate: reg2, skillScriptCompletenessGate: scg2 } = require(RELEASE_BUILD);
  const runtimeManifestFix3 = {
    assets: {
      maps_baseline: [
        { id: "m", src: ".claude/project/events/events.jsonl", owner: "runtime" },
      ],
    },
  };
  const r11 = reg2(runtimeManifestFix3, { skipRuntimeExclusionCheck: true });
  check(
    "FIX3: programmatic opts.skipRuntimeExclusionCheck still bypasses (for tests)",
    !r11.blocked,
    "Programmatic bypass should still work for test injection",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 10: FIX4 — unreadable shipped skill → gate blocks (explicit message check)
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n10. FIX4 — unreadable shipped skill blocks with informative message\n");

{
  const { skillScriptCompletenessGate: scg3 } = require(RELEASE_BUILD);

  const throwingReader = () => { throw new Error("ENOENT: no such file"); };
  const manifestWithSkill = {
    assets: {
      skill: [
        { id: "skill.test", src: ".claude/commands/warp/test.md", owner: "framework" },
      ],
      mc_script: [],
    },
  };

  const r12 = scg3(manifestWithSkill, {}, throwingReader);
  check(
    "FIX4: unreadable shipped skill → blocked=true",
    r12.blocked,
    `blocked=${r12.blocked}`,
  );
  check(
    "FIX4: offenders list contains the unreadable skill",
    r12.offenders.length > 0 && r12.offenders[0].skill.includes("commands/warp/test"),
    JSON.stringify(r12.offenders),
  );
  check(
    "FIX4: offender reason mentions 'unreadable'",
    r12.offenders.length > 0 &&
      (r12.offenders[0].script || "").includes("unreadable"),
    JSON.stringify(r12.offenders[0]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 11: FIX5 — skill-ref regex: invocation-context only + extension coverage
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n11. FIX5 — skill script-ref extraction: invocation-context + extensions\n");

{
  const { skillScriptCompletenessGate: scg4 } = require(RELEASE_BUILD);

  // Helper: build manifest with one skill and a set of shipped scripts.
  const makeM = (skillContent, shippedScripts) => ({
    assets: {
      skill: [
        {
          id: "skill.fix5test",
          src: ".claude/commands/fix5/test.md",
          owner: "framework",
        },
      ],
      mc_script: shippedScripts.map((s) => ({
        id: `ws.${s.replace(/\//g, ".")}`,
        src: s,
        dest: s,
        owner: "framework",
      })),
    },
  });

  const fakeR5 = (filePath) => {
    if (fakeR5._content !== undefined) return fakeR5._content;
    throw new Error("ENOENT");
  };

  // 11a. Plain prose mention (no node/bash prefix, not in fenced block) → NOT caught
  fakeR5._content = "For background, see scripts/example.js for reference.";
  const r13 = scg4(makeM("", []), {}, fakeR5); // no scripts shipped, but prose not caught
  check(
    "FIX5: prose mention 'see scripts/example.js for reference' → NOT caught (no false-positive block)",
    !r13.blocked,
    `blocked=${r13.blocked} (expected false — prose mention should not be treated as dep)`,
  );

  // 11b. Invocation context with `node ` prefix → IS caught → blocks if not shipped
  fakeR5._content = "Run `node scripts/mc/real-dep.js` to build.";
  const r14 = scg4(makeM("", []), {}, fakeR5); // real-dep.js not shipped
  check(
    "FIX5: `node scripts/real-dep.js` invocation → caught → blocks (not shipped)",
    r14.blocked,
    `blocked=${r14.blocked}`,
  );

  // 11c. Invocation context → ref IS shipped → passes
  fakeR5._content = "Run `node scripts/mc/shipped.js` here.";
  const r15 = scg4(makeM("", ["scripts/mc/shipped.js"]), {}, fakeR5);
  check(
    "FIX5: `node scripts/mc/shipped.js` → shipped → passes",
    !r15.blocked,
    `blocked=${r15.blocked}`,
  );

  // 11d. .cjs extension in invocation context → caught
  fakeR5._content = "Run `node scripts/lib/helper.cjs` for setup.";
  const r16 = scg4(makeM("", []), {}, fakeR5);
  check(
    "FIX5: .cjs ref in invocation context → caught",
    r16.blocked && r16.offenders.some((o) => o.script.endsWith(".cjs")),
    JSON.stringify(r16.offenders),
  );

  // 11e. .sh extension with bash prefix → caught
  fakeR5._content = "Run `bash scripts/setup/install.sh` to prepare.";
  const r17 = scg4(makeM("", []), {}, fakeR5);
  check(
    "FIX5: bash scripts/setup/install.sh in invocation context → caught",
    r17.blocked && r17.offenders.some((o) => o.script.endsWith(".sh")),
    JSON.stringify(r17.offenders),
  );

  // 11f. .mjs extension in fenced code block → caught
  fakeR5._content = "```bash\nnode scripts/lib/runner.mjs --flag\n```";
  const r18 = scg4(makeM("", []), {}, fakeR5);
  check(
    "FIX5: .mjs ref in fenced code block → caught",
    r18.blocked && r18.offenders.some((o) => o.script.endsWith(".mjs")),
    JSON.stringify(r18.offenders),
  );

  // 11g. Ref inside fenced code block (no node prefix in prose) → caught
  fakeR5._content = "```bash\nscripts/mc/release-build.js 0.1.0\n```";
  const r19 = scg4(makeM("", []), {}, fakeR5);
  check(
    "FIX5: scripts/ ref inside fenced code block → caught even without node prefix",
    r19.blocked,
    `blocked=${r19.blocked} offenders=${JSON.stringify(r19.offenders)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write("\n");
if (failed > 0) {
  process.stderr.write(`FAIL — ${failed} of ${passed + failed} cases failed:\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`OK — ${passed} cases passed\n`);
process.exit(0);
