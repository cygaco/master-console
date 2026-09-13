#!/usr/bin/env node
/**
 * scripts/check/install.js — Verify a fresh MC install is complete.
 *
 * Runs a series of presence + structural checks. Bails early if .claude/manifest.json
 * is missing — that's the signal we're not in a MC-installed repo.
 *
 * Usage:
 *   node scripts/check/install.js                  full audit
 *   node scripts/check/install.js --json           JSON output
 *
 * Exit:
 *   0 — install complete
 *   1 — install incomplete OR not a MC repo
 *   2 — usage error
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = process.cwd();

function exists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

function check(name, fn) {
  try {
    const r = fn();
    return {
      name,
      ok: r === true || (r && r.ok),
      detail: typeof r === "object" ? r.detail : null,
    };
  } catch (e) {
    return { name, ok: false, detail: e.message };
  }
}

function loadManifest() {
  const f = path.join(REPO_ROOT, ".claude", "manifest.json");
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");

  // Bail-out check first
  if (!exists(".claude/manifest.json")) {
    const msg =
      "not a MC-installed repo (no .claude/manifest.json) — run /mc:setup first";
    if (asJson) {
      process.stdout.write(
        JSON.stringify({ ok: false, bailed: true, reason: msg }) + "\n",
      );
    } else {
      process.stderr.write(`${msg}\n`);
    }
    process.exit(1);
  }

  const manifest = loadManifest();
  const checks = [
    check("manifest.json present and valid", () => manifest !== null),
    check("paths.json present", () => exists(".claude/paths.json")),
    check("CLAUDE.md present", () => exists("CLAUDE.md")),
    check("settings.json present", () => exists(".claude/settings.json")),
    check("agents/ tree present", () => exists(".claude/agents")),
    check("commands/ tree present", () => exists(".claude/commands")),
    check("scripts/hooks/ present", () => exists("scripts/hooks")),
    check("framework-manifest.json present", () =>
      exists(".claude/framework-manifest.json"),
    ),
    check("version.json present", () => exists("version.json")),
    check("manifest.mc.installed === true", () => {
      if (!manifest || !manifest.mc)
        return { ok: false, detail: "no mc block" };
      return manifest.mc.installed === true;
    }),
    check("manifest.mc.version is semver", () => {
      const v = manifest && manifest.mc && manifest.mc.version;
      return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v);
    }),
    check("manifest.mc.version matches version.json", () => {
      const v = manifest && manifest.mc && manifest.mc.version;
      const vjPath = path.join(REPO_ROOT, "version.json");
      if (!fs.existsSync(vjPath))
        return { ok: false, detail: "version.json missing" };
      try {
        const vj = JSON.parse(fs.readFileSync(vjPath, "utf8"));
        if (v !== vj.version)
          return {
            ok: false,
            detail: `manifest=${v} version.json=${vj.version}`,
          };
        return true;
      } catch (e) {
        return { ok: false, detail: `version.json unreadable: ${e.message}` };
      }
    }),
    check("at least one agent under agents/president", () => {
      const dir = path.join(REPO_ROOT, ".claude", "agents", "president");
      if (!fs.existsSync(dir)) return false;
      return fs.readdirSync(dir).some((f) => f.endsWith(".md"));
    }),
    // E-TEAMS-MIGRATION-001: as of Claude Code v2.1.178 (2026-06-15) the
    // experimental agent-teams tools (TeamCreate/TeamDelete) were REMOVED and teams
    // became IMPLICIT + session-scoped (teammates spawn via Agent(run_in_background));
    // CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is phasing out and is NO LONGER REQUIRED.
    // So this is now an INFORMATIONAL presence check, NOT an install-completeness
    // gate: present OR absent both PASS (an unparseable settings.json is still a real
    // failure, caught here and by the dedicated settings.json check above).
    check("agent-teams flag (legacy — informational, no longer required)", () => {
      const f = path.join(REPO_ROOT, ".claude", "settings.json");
      if (!fs.existsSync(f))
        return { ok: false, detail: "settings.json missing" };
      let s;
      try {
        s = JSON.parse(fs.readFileSync(f, "utf8"));
      } catch (e) {
        return { ok: false, detail: `unparseable: ${e.message}` };
      }
      const v = s && s.env && s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      const present = v === "1" || v === 1 || v === true;
      return {
        ok: true,
        detail: present
          ? "present (legacy flag — harmless; v2.1.178 made teams implicit, safe to remove)"
          : "absent (fine — v2.1.178 removed TeamCreate/TeamDelete; teams are implicit + session-scoped, spawn via Agent)",
      };
    }),
    // WG-4: sprint-subsystem readiness. WG-1/2/3/10 all survived /mc:setup and
    // provider smoke because nothing instantiated the sprint pipeline — its
    // install-completeness had no enforcer. These three assert it is wired so a
    // fresh install fails loudly HERE instead of mid-/sprint:full.
    check("sprint-full path keys registered", () => {
      const f = path.join(REPO_ROOT, ".claude", "paths.json");
      if (!fs.existsSync(f)) return { ok: false, detail: "paths.json missing" };
      let p;
      try {
        p = JSON.parse(fs.readFileSync(f, "utf8"));
      } catch (e) {
        return { ok: false, detail: `paths.json unparseable: ${e.message}` };
      }
      const need = [
        "sprintFullAutonomy",
        "sprintFullReports",
        "sprintReleases",
        "sprintSchemas",
      ];
      const missing = need.filter((k) => !p[k]);
      if (missing.length)
        return {
          ok: false,
          detail: `missing: ${missing.join(", ")} — run node scripts/paths/build.js`,
        };
      return true;
    }),
    check("sprint autonomy config valid", () => {
      // SP-20260829-001 B4 T3 / ED-380: validate-autonomy-config.js now exits
      // 3 (not 0) when ajv is unavailable and only contract checks ran — a
      // deliberate, visible distinction from a full schema+contract pass.
      // This repo has no root package.json/node_modules (by design), so ajv
      // is never resolvable here and this install-health check would flip
      // permanently red without --allow-schema-skip. This check has always
      // only verified contract/hard-ceiling checks in practice (schema
      // validation never ran even before this fix); --allow-schema-skip
      // makes that pre-existing scope explicit instead of silently assumed.
      // Self-pulling: if this repo ever gains ajv, schema validation runs
      // for real and this flag becomes a no-op.
      try {
        require("child_process").execSync(
          "node scripts/sprint/validate-autonomy-config.js --allow-schema-skip",
          { cwd: REPO_ROOT, stdio: "pipe", timeout: 30000 },
        );
        return true;
      } catch (e) {
        return {
          ok: false,
          detail:
            "validate-autonomy-config.js exited non-zero — run it directly to see why",
        };
      }
    }),
    check("sprint templates present (init + requirements)", () => {
      const base = path.join(REPO_ROOT, "_mc", "templates", "sprint");
      const missing = ["init", "requirements"].filter(
        (d) => !fs.existsSync(path.join(base, d)),
      );
      if (missing.length)
        return {
          ok: false,
          detail: `_mc/templates/sprint/{${missing.join(",")}} missing — design phase would write a hollow bundle (WG-10). Run /mc:update.`,
        };
      return true;
    }),
    // WG-9 / W-005: ESM/CJS collision. MC framework scripts are CommonJS
    // (require()). If the PRODUCT root package.json declares "type":"module",
    // Node treats every .js under it as ESM — so `node "$CLAUDE_PROJECT_DIR/
    // scripts/hooks/foo.js"` throws "require is not defined in ES module scope"
    // and EVERY hook silently dies (the failure is swallowed by the hook
    // runner). The fix is a scripts/package.json that re-declares
    // {"type":"commonjs"} for that subtree. This check makes the collision
    // fail loudly HERE instead of as silent hook breakage downstream.
    check('no ESM/CJS collision (root "type":"module" vs CJS scripts)', () => {
      const rootPkgPath = path.join(REPO_ROOT, "package.json");
      if (!fs.existsSync(rootPkgPath)) return true; // no root pkg → Node defaults to CJS
      let rootPkg;
      try {
        rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
      } catch (e) {
        return { ok: false, detail: `package.json unparseable: ${e.message}` };
      }
      if (rootPkg.type !== "module") return true; // CJS or unset → no collision
      // Root is ESM. A scripts/package.json with {"type":"commonjs"} insulates
      // the require()-based framework scripts. If present, no collision.
      const scriptsPkgPath = path.join(REPO_ROOT, "scripts", "package.json");
      if (fs.existsSync(scriptsPkgPath)) {
        try {
          const sp = JSON.parse(fs.readFileSync(scriptsPkgPath, "utf8"));
          if (sp.type === "commonjs") return true;
        } catch {
          /* fall through to fail — an unparseable scripts/package.json
             doesn't insulate the subtree */
        }
      }
      // Only flag if framework scripts actually use require() (they do, but
      // confirm so a hypothetical all-ESM scripts tree isn't false-flagged).
      let usesRequire = false;
      const probe = path.join(REPO_ROOT, "scripts", "hooks", "merge-guard.js");
      try {
        usesRequire = /\brequire\s*\(/.test(fs.readFileSync(probe, "utf8"));
      } catch {
        usesRequire = true; // probe missing — assume CJS framework
      }
      if (!usesRequire) return true;
      return {
        ok: false,
        detail:
          'root package.json has "type":"module" but framework scripts are CommonJS (require()). ' +
          'Every hook will die with "require is not defined in ES module scope" — silently. ' +
          'Fix: add scripts/package.json with {"type":"commonjs"} to insulate the framework subtree.',
      };
    }),
  ];

  const failed = checks.filter((c) => !c.ok);
  if (asJson) {
    process.stdout.write(JSON.stringify(checks, null, 2) + "\n");
  } else {
    for (const c of checks) {
      const tag = c.ok ? "OK  " : "FAIL";
      const detail = c.detail ? `  (${c.detail})` : "";
      process.stdout.write(`${tag}  ${c.name}${detail}\n`);
    }
    process.stdout.write(
      `# ${checks.length - failed.length}/${checks.length} passed\n`,
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = { check, exists };
