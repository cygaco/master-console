#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "mc-install-baseline.js");
const { extractRemediationPaths } = require("./mc-install-baseline.js");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

{
  const p = extractRemediationPaths(
    'block("run node scripts/foo/bar.js to fix this");',
  );
  ok("extracts a path from a block() remediation", p.includes("scripts/foo/bar.js"));
}
{
  const p = extractRemediationPaths(
    'process.stderr.write("Use: node scripts/dispatch-claude.js role file\\n");',
  );
  ok("extracts from a stderr Use: message", p.includes("scripts/dispatch-claude.js"));
}
{
  const p = extractRemediationPaths(
    'console.error("missing scripts/hooks/hook-manifest.json — run scripts/hooks/build.js");',
  );
  ok(".json artifact NOT matched as .js", !p.includes("scripts/hooks/hook-manifest.js"));
  ok(".js remediation IS matched alongside", p.includes("scripts/hooks/build.js"));
}
{
  const p = extractRemediationPaths('const x = require("./scripts/lib/util.js");');
  ok("non-remediation require() line ignored", p.length === 0, JSON.stringify(p));
}
{
  const p = extractRemediationPaths('block("Run: pwsh scripts/setup.ps1");');
  ok(".ps1 remediation captured", p.includes("scripts/setup.ps1"));
}

{
  const r = spawnSync(process.execPath, [SCRIPT, "--guard-remediation", "--json"], {
    encoding: "utf8",
  });
  let parsed = {};
  try {
    parsed = JSON.parse(r.stdout || "{}");
  } catch {
  }
  ok(
    "real canonical guard set → green, exit 0 (no false-RED)",
    r.status === 0 && parsed.status === "green",
    `exit ${r.status} status ${parsed.status} missing=${JSON.stringify(parsed.missing)}`,
  );
}

function makeSeamRepo(write) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-rem-"));
  fs.mkdirSync(path.join(dir, "scripts", "hooks"), { recursive: true });
  write(dir);
  return dir;
}
function runSeam(dir) {
  const r = spawnSync(process.execPath, [SCRIPT, "--guard-remediation", "--json"], {
    encoding: "utf8",
    env: { ...process.env, ...mcEnv.envPair("GUARD_REMEDIATION_ROOT", dir) },
  });
  let parsed = {};
  try {
    parsed = JSON.parse(r.stdout || "{}");
  } catch {
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
  }
  return { code: r.status, parsed };
}

{
  const dir = makeSeamRepo((d) => {
    fs.writeFileSync(
      path.join(d, "scripts", "hooks", "trap-guard.js"),
      'block("blocked. Use: node scripts/never-shipped.js to recover");\n',
    );
  });
  const { code, parsed } = runSeam(dir);
  ok(
    "missing remediation script → red, exit 1 (closed-trap caught)",
    code === 1 && parsed.status === "red" &&
      (parsed.missing || []).some((m) => m.path === "scripts/never-shipped.js"),
    `exit ${code} ${JSON.stringify(parsed)}`,
  );
}

{
  const dir = makeSeamRepo((d) => {
    fs.writeFileSync(
      path.join(d, "scripts", "hooks", "good-guard.js"),
      'block("blocked. Use: node scripts/real-fixer.js to recover");\n',
    );
    fs.mkdirSync(path.join(d, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(d, "scripts", "real-fixer.js"), "// exists\n");
  });
  const { code, parsed } = runSeam(dir);
  ok(
    "present remediation script → green, exit 0",
    code === 0 && parsed.status === "green",
    `exit ${code} ${JSON.stringify(parsed)}`,
  );
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
