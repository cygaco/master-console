#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function discover() {
  const linters = [];
  if (fs.existsSync("scripts/path-lint.js")) {
    linters.push({
      name: "path-lint",
      cmd: "node scripts/path-lint.js",
    });
  }
  if (fs.existsSync("scripts")) {
    for (const f of fs.readdirSync("scripts")) {
      if (f.startsWith("lint-") && f.endsWith(".js")) {
        const stem = f.replace(/\.js$/, "");
        linters.push({
          name: stem,
          cmd: `node scripts/${f}`,
        });
      }
    }
  }
  if (fs.existsSync("scripts/sprint")) {
    for (const f of fs.readdirSync("scripts/sprint")) {
      if (f.startsWith("test-") && f.endsWith(".js")) {
        const stem = f.replace(/\.js$/, "");
        linters.push({
          name: `sprint-${stem}`,
          cmd: `node scripts/sprint/${f}`,
        });
      }
    }
  }
  const MC_TEST_EXCLUDE = new Set([
    "test-install-matrix.js",
    "test-hash-back-compat.js",
  ]);
  if (fs.existsSync("scripts/mc")) {
    for (const f of fs.readdirSync("scripts/mc")) {
      if (f.startsWith("test-") && f.endsWith(".js") && !MC_TEST_EXCLUDE.has(f)) {
        const stem = f.replace(/\.js$/, "");
        linters.push({
          name: `mc-${stem}`,
          cmd: `node scripts/mc/${f}`,
        });
      }
    }
  }
  if (fs.existsSync("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
        if (name.startsWith("lint")) {
          linters.push({
            name: `npm:${name}`,
            cmd: `npm run ${name} --silent`,
            shellCmd: cmd,
          });
        }
      }
    } catch {
    }
  }
  return linters;
}

function run(linter) {
  const start = Date.now();
  try {
    execSync(linter.cmd, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { ...linter, ok: true, elapsedMs: Date.now() - start };
  } catch (e) {
    return {
      ...linter,
      ok: false,
      elapsedMs: Date.now() - start,
      error: (e.stdout || e.stderr || e.message || "")
        .toString()
        .trim()
        .slice(0, 500),
    };
  }
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const list = args.includes("--list");
  const oi = args.indexOf("--only");
  const only = oi !== -1 ? args[oi + 1] : null;

  let linters = discover();
  if (only) linters = linters.filter((l) => l.name.includes(only));

  if (linters.length === 0) {
    process.stderr.write(`no linters discovered\n`);
    process.exit(1);
  }

  if (list) {
    if (asJson) {
      process.stdout.write(JSON.stringify(linters, null, 2) + "\n");
    } else {
      process.stdout.write(`# ${linters.length} linter(s) discovered\n`);
      for (const l of linters) {
        process.stdout.write(`  ${l.name}  →  ${l.cmd}\n`);
      }
    }
    process.exit(0);
  }

  const results = [];
  for (const l of linters) {
    results.push(run(l));
  }

  const failed = results.filter((r) => !r.ok);
  if (asJson) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    for (const r of results) {
      const tag = r.ok ? "PASS" : "FAIL";
      process.stdout.write(`${tag}  ${r.name}  (${r.elapsedMs}ms)\n`);
      if (!r.ok && r.error) {
        const indent = r.error
          .split("\n")
          .slice(0, 5)
          .map((l) => `      ${l}`)
          .join("\n");
        process.stdout.write(`${indent}\n`);
      }
    }
    process.stdout.write(
      `# ${results.length - failed.length}/${results.length} passed\n`,
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = { discover, run };
