#!/usr/bin/env node
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
          detail: `_mc/templates/sprint/{${missing.join(",")}} missing — design phase would write a hollow bundle. Run /mc:update.`,
        };
      return true;
    }),
    check('no ESM/CJS collision (root "type":"module" vs CJS scripts)', () => {
      const rootPkgPath = path.join(REPO_ROOT, "package.json");
      if (!fs.existsSync(rootPkgPath)) return true;
      let rootPkg;
      try {
        rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
      } catch (e) {
        return { ok: false, detail: `package.json unparseable: ${e.message}` };
      }
      if (rootPkg.type !== "module") return true;
      const scriptsPkgPath = path.join(REPO_ROOT, "scripts", "package.json");
      if (fs.existsSync(scriptsPkgPath)) {
        try {
          const sp = JSON.parse(fs.readFileSync(scriptsPkgPath, "utf8"));
          if (sp.type === "commonjs") return true;
        } catch {
        }
      }
      let usesRequire = false;
      const probe = path.join(REPO_ROOT, "scripts", "hooks", "merge-guard.js");
      try {
        usesRequire = /\brequire\s*\(/.test(fs.readFileSync(probe, "utf8"));
      } catch {
        usesRequire = true;
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
