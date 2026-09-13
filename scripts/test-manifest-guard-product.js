#!/usr/bin/env node
/**
 * test-manifest-guard-product.js — Phase 0 workstream G smoke test.
 *
 * Stages-via-temp-repo: build two synthetic repos, one canonical-shaped
 * (version.json + install.ps1 + manifest, no installed.json), one product-
 * shaped (manifest + framework-installed.json + .gitignore declaring
 * .claude/) — and feed a synthetic `git commit` event JSON through the
 * hook. Assert: canonical blocks, product with gitignored .claude/ warns
 * (exit 0, no decision block on stdout).
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

const hookBin = path.resolve(__dirname, "hooks", "framework-manifest-guard.js");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}: ${detail || "false"}`);
  }
}

function setupRepo(kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mc-mgt-${kind}-`));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "t@t.t"', { cwd: dir });
  execSync('git config user.name "t"', { cwd: dir });
  fs.mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "framework-manifest.json"),
    JSON.stringify({ version: "0.0.0", total: 0, assets: {}, counts: {} }),
  );
  if (kind === "canonical") {
    fs.writeFileSync(path.join(dir, "version.json"), '{"version":"0.0.0"}');
    fs.writeFileSync(path.join(dir, "install.ps1"), "# stub");
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "scripts", "generate-framework-manifest.js"),
      "// stub",
    );
  } else {
    fs.writeFileSync(
      path.join(dir, ".claude", "framework-installed.json"),
      JSON.stringify({ installedVersion: "0.0.0", installed_files: [] }),
    );
    fs.writeFileSync(path.join(dir, ".gitignore"), ".claude/\n");
  }
  // Stage a tracked file OUTSIDE .claude/ (product mode gitignores .claude/).
  // scripts/hooks/ is in TRACKED_PREFIXES so the guard's manifest-staging
  // requirement should fire.
  fs.mkdirSync(path.join(dir, "scripts", "hooks"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "scripts", "hooks", "test-edit.js"),
    "// edit\n",
  );
  const r = spawnSync("git", ["add", "scripts/hooks/test-edit.js"], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    throw new Error(`git add failed: ${r.stderr && r.stderr.toString()}`);
  }
  return dir;
}

function runHook(dir, withMessage) {
  const event = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: 'git commit -m "stub"' },
  });
  const r = spawnSync(process.execPath, [hookBin], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    input: event,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ── Canonical repo: tracked edit without manifest → BLOCK ──
const canonical = setupRepo("canonical");
const r1 = runHook(canonical);
check("canonical hook exit 0", r1.status === 0, `status=${r1.status}`);
let parsed1 = null;
try {
  parsed1 = JSON.parse((r1.stdout || "").trim());
} catch {
  /* not JSON */
}
check(
  "canonical hook returns decision:block",
  parsed1 && parsed1.decision === "block",
  r1.stdout,
);
check(
  "canonical reason mentions framework-manifest",
  parsed1 && /framework-manifest/.test(parsed1.reason || ""),
);
check(
  "canonical bypass message includes PowerShell form",
  parsed1 && /\$env:WARPOS_MANIFEST_GUARD/.test(parsed1.reason || ""),
);

// ── Product with gitignored .claude/: tracked edit, stale manifest → WARN ──
const product = setupRepo("product");
const _silence = execSync("git status", {
  cwd: product,
  stdio: ["pipe", "pipe", "ignore"],
});
// Backdate manifest mtime so it's stale relative to the edit
const oldMs = Date.now() / 1000 - 600;
fs.utimesSync(
  path.join(product, ".claude", "framework-manifest.json"),
  oldMs,
  oldMs,
);
const r2 = runHook(product);
check("product hook exit 0", r2.status === 0, `status=${r2.status}`);
let parsed2 = null;
try {
  parsed2 = JSON.parse((r2.stdout || "").trim());
} catch {
  /* not JSON — warn path */
}
check(
  "product hook does NOT emit decision:block",
  !(parsed2 && parsed2.decision === "block"),
  r2.stdout,
);
check(
  "product hook warns via stderr",
  /framework-manifest-guard/.test(r2.stderr || ""),
  r2.stderr,
);

// ── Product with sentinel: bypass entirely ──
fs.mkdirSync(path.join(product, ".mc"), { recursive: true });
fs.writeFileSync(
  path.join(product, ".mc", "manifest-guard-disable"),
  "bypass\n",
);
const r3 = runHook(product);
check("sentinel bypass exit 0", r3.status === 0);
check("sentinel bypass no stdout", !r3.stdout.trim());

// Clean up
try {
  fs.rmSync(canonical, { recursive: true, force: true });
} catch {
  /* ignore */
}
try {
  fs.rmSync(product, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failed > 0) {
  console.error(`FAIL — ${failed} of ${passed + failed} cases failed:`);
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log(`OK — ${passed} cases passed`);
process.exit(0);
