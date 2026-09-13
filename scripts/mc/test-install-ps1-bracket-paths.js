"use strict";
/**
 * test-install-ps1-bracket-paths.js — the TARGETED tooth proving the install.ps1 -LiteralPath fix
 * (SP-20260721-001 D-4 INC-2, finding #2). GATE-A's Leg-3 parity-diff CAUGHT this bug, but Leg-3 cannot
 * reach the parity assertion until ED-249 (build.js unclassified paths) clears — so #2 needs an
 * INDEPENDENT proof. This is it.
 *
 * THE BUG (pre-fix): install.ps1's asset-copy loop used `Test-Path $srcPath` / `Copy-Item -Path $srcPath`,
 * which PowerShell WILDCARD-INTERPRETS — a source path with brackets (Next.js [ref] / [...slug] dynamic
 * routes) matches nothing, so Test-Path returns false and the asset is SILENTLY SKIPPED. warp-setup.js
 * (Node) copies it fine → a real shipped-installer divergence.
 *
 * THE PROOF: stage a minimal install.ps1 source whose manifest lists a BRACKET-NAMED asset, run the FIXED
 * install.ps1, and assert the bracket asset LANDED in the target. Pre-fix this file would be absent; with
 * -LiteralPath it copies. Windows-only (real install.ps1); SKIP-LOUD (non-zero-flagged) on a no-PS host.
 *
 * Exit 0 = the bracket asset copied (fix proven). 1 = it did not (regression). 2 = skipped (no PowerShell).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function findPowershell() {
  for (const exe of ["pwsh", "powershell"]) {
    const r = spawnSync(exe, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (r.status === 0) return exe;
  }
  return null;
}

const BRACKET_REL = path.join("app", "[slug]", "page.tsx"); // a Next.js dynamic-route path — the bug's trigger
const MARKER = "// bracket-route asset — must survive install.ps1\n";

function main() {
  const ps = findPowershell();
  if (!ps) {
    // SKIP-LOUD, not a silent pass (AC-15 discipline) — the shipped installer can't be exercised here.
    process.stdout.write("SKIP (no PowerShell on this host): install.ps1 bracket-path proof did not run — NOT a pass.\n");
    process.exit(2);
  }

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "installps1-bracket-"));
  const source = path.join(sandbox, "source");
  const target = path.join(sandbox, "target");
  try {
    // ── minimal install.ps1 source (the FIXED installer + the files its pre-flight requires) ──
    fs.mkdirSync(path.join(source, ".claude"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "install.ps1"), path.join(source, "install.ps1"));
    fs.writeFileSync(path.join(source, "version.json"), JSON.stringify({ version: "0.17.0" }));
    fs.writeFileSync(path.join(source, ".claude", "paths.json"), JSON.stringify({ $schema: "mc/paths/v5" }));
    // The bracket-named asset in the source, and the manifest that enumerates it.
    fs.mkdirSync(path.join(source, path.dirname(BRACKET_REL)), { recursive: true });
    fs.writeFileSync(path.join(source, BRACKET_REL), MARKER);
    const manifest = {
      $schema: "mc/framework-manifest/v2",
      assets: {
        product: [
          { id: "bracket-route", kind: "product", src: BRACKET_REL.replace(/\\/g, "/"), dest: BRACKET_REL.replace(/\\/g, "/"), owner: "test", mergeStrategy: "replace", introducedIn: "0.0.0" },
        ],
      },
    };
    fs.writeFileSync(path.join(source, ".claude", "framework-manifest.json"), JSON.stringify(manifest, null, 2));
    fs.mkdirSync(target, { recursive: true });

    // ── run the FIXED install.ps1 (Stage 1 copies assets; Stage 2/2.5 Write-Warn on the minimal source
    //    but do not fail — so the asset copy is exercised for real) ──
    const run = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(source, "install.ps1"), "-Target", target, "-SkipPrompt"], { encoding: "utf8" });

    // ── the proof: the bracket-named asset LANDED in the target (Node fs handles brackets literally) ──
    const landed = fs.existsSync(path.join(target, BRACKET_REL));
    if (!landed) {
      process.stderr.write(`FAIL: the bracket-route asset ${BRACKET_REL} was NOT copied by install.ps1 — the -LiteralPath fix is missing or regressed.\n`);
      process.stderr.write(`install.ps1 stdout tail:\n${(run.stdout || "").split(/\r?\n/).slice(-8).join("\n")}\n`);
      process.stderr.write(`install.ps1 stderr tail:\n${(run.stderr || "").split(/\r?\n/).slice(-8).join("\n")}\n`);
      process.exit(1);
    }
    const content = fs.readFileSync(path.join(target, BRACKET_REL), "utf8");
    if (content !== MARKER) {
      process.stderr.write(`FAIL: the bracket-route asset landed but its content differs (mis-copy).\n`);
      process.exit(1);
    }
    process.stdout.write(`ok: install.ps1 copied the bracket-route asset ${BRACKET_REL} (the -LiteralPath fix is proven — pre-fix it was silently skipped).\n`);
    process.exit(0);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main();
