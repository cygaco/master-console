"use strict";
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

const BRACKET_REL = path.join("app", "[slug]", "page.tsx");
const MARKER = "// bracket-route asset — must survive install.ps1\n";

function main() {
  const ps = findPowershell();
  if (!ps) {
    process.stdout.write("SKIP (no PowerShell on this host): install.ps1 bracket-path proof did not run — NOT a pass.\n");
    process.exit(2);
  }

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "installps1-bracket-"));
  const source = path.join(sandbox, "source");
  const target = path.join(sandbox, "target");
  try {
    fs.mkdirSync(path.join(source, ".claude"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "install.ps1"), path.join(source, "install.ps1"));
    fs.writeFileSync(path.join(source, "version.json"), JSON.stringify({ version: "0.17.0" }));
    fs.writeFileSync(path.join(source, ".claude", "paths.json"), JSON.stringify({ $schema: "mc/paths/v5" }));
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

    const run = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(source, "install.ps1"), "-Target", target, "-SkipPrompt"], { encoding: "utf8" });

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
    process.stdout.write(`ok: install.ps1 copied the bracket-route asset ${BRACKET_REL} (the -LiteralPath fix is proven).\n`);
    process.exit(0);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main();
