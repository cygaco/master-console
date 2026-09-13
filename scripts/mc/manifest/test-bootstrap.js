#!/usr/bin/env node
/**
 * scripts/mc/manifest/test-bootstrap.js — sanity checks for bootstrap.js.
 *
 * SP-20260522-004 / T-20260523-194. Covers:
 *   A. --help prints usage.
 *   B. Canonical mode refuses.
 *   C. Unknown mode refuses.
 *   D. Product mode without _mc — happy path.
 *   E. Product mode with _mc and no --force — refuses.
 *   F. Product mode with _mc and --force — overwrites.
 *   G. --dry-run writes nothing.
 *   H. --json emits parseable JSON.
 *   I. --source flag honored.
 *   J. Sibling-clone discovery.
 *   K. Source-discovery failure → exit 3.
 *   L. Settings.json hook-path rewrite is correct.
 *   M. Settings.json rewrite is idempotent.
 *   N. Settings.json preserves non-path fields.
 *   O. No .claude/ → refuse.
 *   P. --skip-views / --skip-validate honored.
 *   Q. Hook rewriter unit test (pure function).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BOOTSTRAP_PATH = path.join(__dirname, "bootstrap.js");

const {
  rewriteHookPathsInString,
  rewriteHooksBlock,
  detectMode,
  discoverSource,
} = require(BOOTSTRAP_PATH);

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bootstrap-test-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* */
  }
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function runBootstrap(args, opts = {}) {
  return spawnSync(process.execPath, [BOOTSTRAP_PATH, ...args], {
    encoding: "utf8",
    cwd: opts.cwd || REPO_ROOT,
  });
}

// Create a fake canonical source fixture with framework/ subdirs.
function makeCanonicalSourceFixture(label) {
  const dir = tmpDir(`src-${label}`);
  writeFile(
    path.join(dir, "framework", "commands", "fix", "fast.md"),
    "# /fix:fast\nfast fix skill\n",
  );
  writeFile(
    path.join(dir, "framework", "agents", "00-alex", "alpha.md"),
    "# Alpha\nidentity\n",
  );
  writeFile(
    path.join(dir, "framework", "hooks", "example.js"),
    "// example hook\n",
  );
  writeFile(
    path.join(dir, "framework", "schemas", "example.schema.json"),
    "{}\n",
  );
  writeFile(
    path.join(dir, "framework", "templates", "policy", "x.md"),
    "tpl\n",
  );
  writeFile(
    path.join(dir, "framework", "reference", "guide.md"),
    "ref\n",
  );
  writeFile(
    path.join(dir, "framework", "settings", "defaults.json"),
    JSON.stringify({ hooks: {} }, null, 2) + "\n",
  );
  // Provide build.js + validate.js + regenerate.js stubs that exit 0 quickly.
  writeFile(
    path.join(dir, "scripts", "mc", "manifest", "build.js"),
    `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
let root = process.cwd();
const argv = process.argv;
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--root') root = path.resolve(argv[++i]);
}
const manifest = { '$schema': 'mc/manifest/v1', version: 1, paths: {} };
fs.mkdirSync(path.join(root, '_mc'), { recursive: true });
fs.writeFileSync(path.join(root, '_mc', 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
process.exit(0);
`,
  );
  writeFile(
    path.join(dir, "scripts", "mc", "manifest", "validate.js"),
    `#!/usr/bin/env node
'use strict';
process.exit(0);
`,
  );
  writeFile(
    path.join(dir, "scripts", "mc", "views", "regenerate.js"),
    `#!/usr/bin/env node
'use strict';
process.exit(0);
`,
  );
  // Mark this dir as canonical: _mc/MANIFEST.json + framework/ both present.
  writeFile(
    path.join(dir, "_mc", "MANIFEST.json"),
    JSON.stringify({ "$schema": "mc/manifest/v1", version: 1, paths: {} }, null, 2),
  );
  return dir;
}

// Create a fake product fixture — has .claude/ + scripts/hooks/ but no _mc/.
function makeProductFixture(label, { settingsHooks } = {}) {
  const dir = tmpDir(`prod-${label}`);
  writeFile(path.join(dir, "scripts", "hooks", "existing.js"), "// existing\n");
  writeFile(
    path.join(dir, ".claude", "framework-installed.json"),
    JSON.stringify({ version: "0.8.2" }, null, 2),
  );
  const settings = {
    permissions: { allow: ["Bash(npm install)"] },
    env: { FOO: "bar" },
    hooks: settingsHooks || {
      PreToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [
            {
              type: "command",
              command: "node scripts/hooks/format.js",
            },
          ],
        },
      ],
    },
  };
  writeFile(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify(settings, null, 2),
  );
  return dir;
}

function makeUnknownFixture(label) {
  // No .claude, no _mc, no scripts/hooks/.
  const dir = tmpDir(`unk-${label}`);
  writeFile(path.join(dir, "README.md"), "hello\n");
  return dir;
}

function makeNoClaudeFixture(label) {
  // No .claude/ but has _mc/.
  const dir = tmpDir(`noc-${label}`);
  writeFile(path.join(dir, "_mc", "MANIFEST.json"), "{}");
  return dir;
}

// ── Tests ────────────────────────────────────────────────────────────

// A. --help prints usage.
{
  const r = runBootstrap(["--help"]);
  ok("--help exits 0", r.status === 0);
  ok("--help mentions Usage", /Usage:/.test(r.stdout));
}

// B. Canonical mode refuses.
{
  const src = makeCanonicalSourceFixture("canon-refuse");
  try {
    const r = runBootstrap(["--root", src]);
    ok("canonical mode → exit 1", r.status === 1, `got ${r.status}: ${r.stderr}`);
    ok("canonical refuse mentions canonical", /canonical/i.test(r.stderr));
  } finally {
    cleanup(src);
  }
}

// C. Unknown mode refuses.
{
  const dir = makeUnknownFixture("unk-refuse");
  try {
    const r = runBootstrap(["--root", dir]);
    ok("unknown mode → exit 1", r.status === 1);
    ok("unknown mode mentions detection", /unknown|cannot detect|no \.claude/i.test(r.stderr));
  } finally {
    cleanup(dir);
  }
}

// D. Product happy path: no _mc/.
{
  const src = makeCanonicalSourceFixture("happy-src");
  const prod = makeProductFixture("happy");
  try {
    const r = runBootstrap(["--root", prod, "--source", src]);
    ok("product happy path → exit 0", r.status === 0, `got ${r.status}: ${r.stderr}\n${r.stdout}`);
    ok(
      "product happy path created _mc/commands/",
      fs.existsSync(path.join(prod, "_mc", "commands", "fix", "fast.md")),
    );
    ok(
      "product happy path created _mc/agents/",
      fs.existsSync(path.join(prod, "_mc", "agents", "00-alex", "alpha.md")),
    );
    ok(
      "product happy path created _mc/hooks/",
      fs.existsSync(path.join(prod, "_mc", "hooks", "example.js")),
    );
    ok(
      "product happy path generated MANIFEST.json",
      fs.existsSync(path.join(prod, "_mc", "MANIFEST.json")),
    );
    const settings = JSON.parse(
      fs.readFileSync(path.join(prod, ".claude", "settings.json"), "utf8"),
    );
    const cmd = settings.hooks.PreToolUse[0].hooks[0].command;
    ok(
      "settings.json hook path rewritten to _mc/hooks/",
      cmd.includes("_mc/hooks/") && !cmd.includes("scripts/hooks/"),
      `got: ${cmd}`,
    );
    ok(
      "settings.json preserves permissions",
      Array.isArray(settings.permissions.allow) && settings.permissions.allow[0] === "Bash(npm install)",
    );
    ok("settings.json preserves env", settings.env && settings.env.FOO === "bar");
  } finally {
    cleanup(src);
    cleanup(prod);
  }
}

// E. Refuses product with _mc and no --force.
{
  const src = makeCanonicalSourceFixture("refuse-src");
  const prod = makeProductFixture("refuse-has-mc");
  fs.mkdirSync(path.join(prod, "_mc"), { recursive: true });
  fs.writeFileSync(
    path.join(prod, "_mc", "MANIFEST.json"),
    JSON.stringify({}, null, 2),
  );
  try {
    const r = runBootstrap(["--root", prod, "--source", src]);
    ok("existing _mc without --force → exit 1", r.status === 1);
    ok("refuse mentions --force", /--force/i.test(r.stderr));
  } finally {
    cleanup(src);
    cleanup(prod);
  }
}

// F. --force re-bootstraps existing _mc.
{
  const src = makeCanonicalSourceFixture("force-src");
  const prod = makeProductFixture("force-has-mc");
  fs.mkdirSync(path.join(prod, "_mc"), { recursive: true });
  fs.writeFileSync(
    path.join(prod, "_mc", "MANIFEST.json"),
    JSON.stringify({}, null, 2),
  );
  fs.writeFileSync(
    path.join(prod, "_mc", "stale.md"),
    "stale\n",
  );
  try {
    const r = runBootstrap(["--root", prod, "--source", src, "--force"]);
    ok("--force on existing _mc → exit 0", r.status === 0, `got ${r.status}: ${r.stderr}`);
    ok(
      "--force regenerated MANIFEST.json",
      fs.existsSync(path.join(prod, "_mc", "MANIFEST.json")),
    );
    ok(
      "--force copied new content over stale",
      fs.existsSync(path.join(prod, "_mc", "commands", "fix", "fast.md")),
    );
  } finally {
    cleanup(src);
    cleanup(prod);
  }
}

// G. --dry-run writes nothing.
{
  const src = makeCanonicalSourceFixture("dry-src");
  const prod = makeProductFixture("dry");
  try {
    const r = runBootstrap(["--root", prod, "--source", src, "--dry-run"]);
    ok("--dry-run → exit 0", r.status === 0, `got ${r.status}: ${r.stderr}`);
    ok(
      "--dry-run created no _mc/",
      !fs.existsSync(path.join(prod, "_mc")),
    );
    const settings = JSON.parse(
      fs.readFileSync(path.join(prod, ".claude", "settings.json"), "utf8"),
    );
    ok(
      "--dry-run did not modify settings.json",
      settings.hooks.PreToolUse[0].hooks[0].command.includes("scripts/hooks/"),
    );
    ok("--dry-run mentions dry-run", /dry-run/i.test(r.stdout));
  } finally {
    cleanup(src);
    cleanup(prod);
  }
}

// H. --json emits parseable summary.
{
  const src = makeCanonicalSourceFixture("json-src");
  const prod = makeProductFixture("json");
  try {
    const r = runBootstrap(["--root", prod, "--source", src, "--json"]);
    ok("--json → exit 0", r.status === 0);
    let parsed = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (e) {
      // pass falls through
    }
    ok("--json output is parseable JSON", parsed !== null);
    if (parsed) {
      ok("--json has mode field", typeof parsed.mode === "string");
      ok("--json has filesCopied field", typeof parsed.filesCopied === "number");
      ok(
        "--json has hookPathsRewritten field",
        typeof parsed.hookPathsRewritten === "number",
      );
      ok("--json has source field", typeof parsed.source === "string");
    }
  } finally {
    cleanup(src);
    cleanup(prod);
  }
}

// I. --source flag honored (passing canonical src as explicit source).
{
  const src = makeCanonicalSourceFixture("src-flag");
  const prod = makeProductFixture("src-flag-prod");
  try {
    const r = runBootstrap(["--root", prod, "--source", src, "--json"]);
    const parsed = JSON.parse(r.stdout);
    ok(
      "--source flag recorded in summary.sourceVia",
      /--source flag/.test(parsed.sourceVia),
      `got: ${parsed.sourceVia}`,
    );
  } finally {
    cleanup(src);
    cleanup(prod);
  }
}

// J. Sibling-clone discovery.
{
  const parentDir = tmpDir("sibling-parent");
  const src = makeCanonicalSourceFixture("sibling-src");
  const newSrcLocation = path.join(parentDir, "MC");
  fs.renameSync(src, newSrcLocation);
  const prod = path.join(parentDir, "product");
  fs.mkdirSync(prod, { recursive: true });
  writeFile(path.join(prod, "scripts", "hooks", "x.js"), "// existing\n");
  writeFile(path.join(prod, ".claude", "framework-installed.json"), "{}");
  writeFile(
    path.join(prod, ".claude", "settings.json"),
    JSON.stringify({ hooks: {} }, null, 2),
  );
  try {
    const r = runBootstrap(["--root", prod, "--json"]);
    ok(
      "sibling-clone discovery → exit 0",
      r.status === 0,
      `got ${r.status}: ${r.stderr}\n${r.stdout}`,
    );
    if (r.status === 0) {
      const parsed = JSON.parse(r.stdout);
      ok(
        "sibling-clone recorded in summary.sourceVia",
        /sibling/.test(parsed.sourceVia),
        `got: ${parsed.sourceVia}`,
      );
    }
  } finally {
    cleanup(parentDir);
  }
}

// K. Source-discovery failure.
{
  const prod = makeProductFixture("nosrc");
  // Ensure no sibling clone resolves: place inside a fresh parent.
  const isolated = tmpDir("isolated");
  const movedProd = path.join(isolated, "product");
  fs.renameSync(prod, movedProd);
  try {
    const r = runBootstrap(["--root", movedProd]);
    ok(
      "source-discovery failure → exit 3",
      r.status === 3,
      `got ${r.status}: ${r.stderr}`,
    );
  } finally {
    cleanup(isolated);
  }
}

// L. Settings.json rewriter unit test (string-level).
{
  const r = rewriteHookPathsInString('node scripts/hooks/format.js --check');
  ok("rewriter substitutes scripts/hooks/", r.value.includes("_mc/hooks/"));
  ok("rewriter reports changed count", r.changed === 1);
}

// M. Settings.json rewriter is idempotent.
{
  const r1 = rewriteHookPathsInString("node scripts/hooks/format.js");
  const r2 = rewriteHookPathsInString(r1.value);
  ok("rewriter idempotent (no further changes)", r2.changed === 0);
  ok(
    "rewriter idempotent (no double-prefix)",
    !r2.value.includes("_mc/_mc/"),
  );
}

// N. rewriteHooksBlock handles complex structures.
{
  const block = {
    PreToolUse: [
      {
        matcher: "Edit|Write",
        hooks: [
          {
            type: "command",
            command: "node scripts/hooks/format.js",
          },
          {
            type: "command",
            command: "node scripts/hooks/path-guard.js --warn",
          },
        ],
      },
    ],
    PostToolUse: [],
  };
  const r = rewriteHooksBlock(block);
  ok("rewriteHooksBlock changed 2 commands", r.changed === 2);
  ok(
    "rewriteHooksBlock preserved matcher field",
    r.value.PreToolUse[0].matcher === "Edit|Write",
  );
  ok(
    "rewriteHooksBlock substituted both commands",
    r.value.PreToolUse[0].hooks.every((h) => h.command.includes("_mc/hooks/")),
  );
}

// O. No .claude/ → refuse.
{
  const dir = makeNoClaudeFixture("noclaude");
  try {
    const r = runBootstrap(["--root", dir]);
    ok("no .claude/ → exit 1", r.status === 1);
  } finally {
    cleanup(dir);
  }
}

// P. --skip-views and --skip-validate honored.
{
  const src = makeCanonicalSourceFixture("skip-src");
  const prod = makeProductFixture("skip");
  try {
    const r = runBootstrap([
      "--root",
      prod,
      "--source",
      src,
      "--skip-views",
      "--skip-validate",
      "--json",
    ]);
    ok("--skip-views/--skip-validate → exit 0", r.status === 0, `${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    ok("--skip-views flag observed in summary", parsed.skipViews === true);
    ok("--skip-validate flag observed in summary", parsed.skipValidate === true);
    ok(
      "summary.validate is null when skipped",
      parsed.validate === null,
    );
  } finally {
    cleanup(src);
    cleanup(prod);
  }
}

// Q. detectMode pure function — canonical case.
{
  const src = makeCanonicalSourceFixture("dm-canon");
  try {
    const d = detectMode(src);
    ok("detectMode canonical", d.mode === "canonical");
  } finally {
    cleanup(src);
  }
}

// R. detectMode pure function — product case.
{
  const prod = makeProductFixture("dm-prod");
  try {
    const d = detectMode(prod);
    ok("detectMode product", d.mode === "product");
  } finally {
    cleanup(prod);
  }
}

// ── Summary ─────────────────────────────────────────────────────────

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
