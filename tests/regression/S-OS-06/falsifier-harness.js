"use strict";
/**
 * falsifier-harness.js — shared scaffolding for the S-OS-06 record-trust falsifier
 * fixtures (T-20260913-361, T2). Not a test file itself.
 *
 * R5: every fixture brings its OWN partition. makeFixture() builds a throwaway git repo,
 * copies the gates + loader + codemod into it UNTRACKED (listed in .git/info/exclude so
 * they are never scanned, classified or committed), writes a fixture partition at the
 * loader's own relative artifact path, and commits the baseline. Each gate runs as a
 * child process from INSIDE that repo, so the copied loader's PARTITION_ROOT is the
 * fixture repo — no production env override, no read of the real partition.
 *
 * The artifact path is taken from the real loader (DENYLIST_PATH) — this file never
 * names the artifact itself (the un-routed-reader guard).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REAL_ROOT = path.resolve(__dirname, "..", "..", "..");
const LOADER_FILE = path.join(REAL_ROOT, "scripts", "open-source", "partition-loader.js");
const LOADER = require(LOADER_FILE);

const toPosix = (p) => String(p).split(path.sep).join("/");

// The legacy slug the gates search for. This directory is a Class-3 path glob in the real
// partition, so the codemod never rewrites the fixtures' planted data.
const SLUG = "warpos";

const REL = {
  loader: toPosix(path.relative(REAL_ROOT, LOADER_FILE)),
  partition: toPosix(path.relative(LOADER.PARTITION_ROOT, LOADER.DENYLIST_PATH)),
  ledger: toPosix(path.relative(LOADER.PARTITION_ROOT, LOADER.COMMITTED_LEDGER_PATH)),
  codemod: "scripts/open-source/rename-mc.js",
  purity: "scripts/checks/framework-purity.js",
  cutover: "scripts/checks/cutover-completeness.js",
  cutoverAllowlist: "scripts/checks/cutover-completeness.allowlist.json",
};

// The read-both env helper (+ its decision core) travels with the gates: framework-purity.js requires it (T3 4b).
const ENV_HELPER = ["scripts/hooks/lib/mc-env.js", "scripts/hooks/lib/split-brain-core.js"];
const COPIED = [REL.loader, REL.codemod, REL.purity, REL.cutover, REL.cutoverAllowlist, ...ENV_HELPER];

/** The standard fixture tree: one clean live file, one pinned live literal, Class-3/4 data, one generated view. */
function baseFiles() {
  return {
    "src/app.js": "module.exports = { name: \"fixture\" };\n",
    "src/paths.js": `const LEGACY_HOME_SEGMENT = ".${SLUG}"; // compat fallback read\nmodule.exports = { LEGACY_HOME_SEGMENT };\n`,
    "history/2026-notes.md": `# notes\nthe ${SLUG} era, recorded verbatim\n`,
    [`migrations/1.2.0-to-2.0.0/migrate.js`]: `const FROM = "_${SLUG}";\nmodule.exports = { FROM };\n`,
    ".claude/paths.json": `{ "templates": "_${SLUG}/templates" }\n`,
  };
}

/** A valid, frozen partition for baseFiles(). `mutate(partition)` may edit it before the freeze keys are computed. */
function basePartition({ mutate, freeze = true } = {}) {
  const p = {
    $question: "What must NOT be rewritten by the fixture codemod run (S-OS-06 falsifier fixture partition).",
    generatedViews: [{ path: ".claude/paths.json", class: 1, warrant: "fixture generated view, regenerated from its registry" }],
    pathGlobs: [
      { pattern: "history/**", class: 4, writeProtected: true, warrant: "fixture historical notes, a dated record" },
      { pattern: "migrations/1.2.0-to-2.0.0/**", class: 3, writeProtected: true, warrant: "fixture migration DATA literals" },
      { pattern: REL.partition, class: 3, writeProtected: true, warrant: "the fixture partition quotes the slug as data" },
    ],
    occurrencePins: [
      {
        file: "src/paths.js",
        matchText: `".${SLUG}"`,
        anchor: "const LEGACY_HOME_SEGMENT = ",
        warrant: "fixture HOME-anchored legacy fallback segment",
      },
    ],
    futureEntries: [],
  };
  if (mutate) mutate(p);
  if (freeze) p.$freeze = { baselineKeys: LOADER.entryKeys(p), amendments: [] };
  return p;
}

function cleanEnv(root, extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("GIT_") || k === `${SLUG.toUpperCase()}_PURITY_ROOT` || k === "MC_PURITY_ROOT" || k === "NODE_TEST_CONTEXT") delete env[k];
  }
  env.CLAUDE_PROJECT_DIR = root;
  return { ...env, ...(extra || {}) };
}

function makeFixture({ version = "2.0.0", files, partition, extraFiles } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sos06-falsifier-"));
  const git = (args, { allowFail = false } = {}) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: cleanEnv(dir) });
    if (!allowFail && r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
    return r;
  };
  const abs = (rel) => path.join(dir, ...rel.split("/"));
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), content, "utf8");
  };
  const read = (rel) => fs.readFileSync(abs(rel), "utf8");
  const exists = (rel) => fs.existsSync(abs(rel));
  const writePartition = (p) => write(REL.partition, typeof p === "string" ? p : JSON.stringify(p, null, 2) + "\n");
  const readPartition = () => JSON.parse(read(REL.partition));

  git(["init", "-q"]);
  git(["config", "user.email", "fixture@example.com"]);
  git(["config", "user.name", "S-OS-06 falsifier"]);
  git(["config", "core.autocrlf", "false"]);
  // The copied gates, dry-run outputs and the ledger are never part of the fixture's tracked tree.
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), [...COPIED, "runtime/", REL.ledger].join("\n") + "\n");
  for (const rel of COPIED) write(rel, fs.readFileSync(path.join(REAL_ROOT, ...rel.split("/")), "utf8"));

  write("package.json", JSON.stringify({ name: "sos06-fixture", version, private: true }, null, 2) + "\n");
  const tree = { ...(files || baseFiles()), ...(extraFiles || {}) };
  for (const [rel, content] of Object.entries(tree)) write(rel, content);
  writePartition(partition === undefined ? basePartition() : partition);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "fixture: baseline tree + frozen partition"]);

  function runNode(rel, args, extraEnv) {
    const r = spawnSync(process.execPath, [abs(rel), ...(args || [])], {
      cwd: dir,
      encoding: "utf8",
      env: cleanEnv(dir, extraEnv),
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    });
    // A hang or a spawn failure is NEVER a red observation — only a real exit code is.
    if (r.error) throw new Error(`spawn ${rel} failed: ${r.error.message}`);
    if (r.status === null) throw new Error(`${rel} was killed by ${r.signal} — not an observed exit code`);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}\n${r.stderr}` };
  }

  return {
    dir,
    git,
    write,
    read,
    exists,
    writePartition,
    readPartition,
    commit(message, paths) {
      git(["add", "--", ...paths]);
      git(["commit", "-q", "-m", message]);
      return git(["rev-parse", "HEAD"]).stdout.trim();
    },
    trackedDirty() {
      return git(["status", "--porcelain", "--untracked-files=no"]).stdout.trim();
    },
    runPurity: (args, env) => runNode(REL.purity, args, env),
    runCutover: (args, env) => runNode(REL.cutover, args, env),
    runCodemod: (args, env) => runNode(REL.codemod, args, env),
    runNode,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* temp dir; best effort on Windows file locks */
      }
    },
  };
}

/** Run fn(fixture) and always clean up. */
function withFixture(opts, fn) {
  const fx = makeFixture(opts);
  try {
    return fn(fx);
  } finally {
    fx.cleanup();
  }
}

/** Parse a gate's --json stdout; a non-JSON stdout is a test failure with the output attached. */
function json(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(`expected JSON on stdout (${e.message}); got:\n${result.out.slice(0, 1500)}`);
  }
}

module.exports = { SLUG, REL, REAL_ROOT, LOADER, baseFiles, basePartition, makeFixture, withFixture, json, toPosix };
