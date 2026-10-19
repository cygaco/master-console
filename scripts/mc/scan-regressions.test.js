"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { envNames } = require("../hooks/lib/mc-env");

const SCRIPTS = path.resolve(__dirname, "..");
const WRAPPER = path.join(__dirname, "scan-regressions.js");
const PLAIN_LINE = "the regression suite runs in the framework repository only; nothing to check in this project";
const MISSING_LINE = "regression suite missing in the framework repo";

const RESOLVER_FILES = ["mc/repo-role.js", "hooks/lib/mc-env.js", "hooks/lib/split-brain-core.js"];

function writeFile(root, rel, body) {
  const p = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

function makeTree(stubs, opts) {
  const o = opts || {};
  const resolver = o.resolver || "copy";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scan-regressions-"));
  fs.mkdirSync(path.join(root, "scripts", "mc"), { recursive: true });
  fs.copyFileSync(WRAPPER, path.join(root, "scripts", "mc", "scan-regressions.js"));
  if (resolver === "copy") {
    for (const rel of RESOLVER_FILES) {
      const dest = path.join(root, "scripts", ...rel.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(SCRIPTS, ...rel.split("/")), dest);
    }
  } else if (resolver === "throw") {
    writeFile(root, "scripts/mc/repo-role.js", "throw new Error('resolver exploded at load');\n");
  }
  for (const [name, body] of Object.entries(stubs || {})) {
    writeFile(root, `scripts/testsuite/${name}`, body);
  }
  for (const [rel, body] of Object.entries(o.files || {})) {
    writeFile(root, rel, body);
  }
  return root;
}

function childEnv() {
  const { current, legacy } = envNames("REPO_ROLE");
  const drop = new Set([current.toUpperCase(), legacy.toUpperCase()]);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!drop.has(k.toUpperCase())) env[k] = v;
  return env;
}

function runWrapper(root, args) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "mc", "scan-regressions.js"), ...args], {
    cwd: root,
    env: childEnv(),
    encoding: "utf8",
    timeout: 30000,
  });
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

const CANONICAL_FILES = { ".claude/manifest.json": { repoRole: "canonical" } };
const CONSUMER_FILES = {
  ".claude/framework-installed.json": {
    $schema: "mc/framework-installed/v2",
    installedVersion: "2.1.0",
    source: "https://example.invalid/mc.git",
    target: "C:\\work\\product",
    assets: [],
  },
};

test("without scripts/testsuite/ it prints the one plain line, nothing on stderr, exit 0", () => {
  const root = makeTree();
  try {
    for (const args of [[], ["--json"], ["--enforce"]]) {
      const r = runWrapper(root, args);
      assert.strictEqual(r.status, 0, `args ${JSON.stringify(args)}: exit ${r.status}`);
      assert.strictEqual(r.stdout, PLAIN_LINE + "\n", `args ${JSON.stringify(args)}: stdout`);
      assert.strictEqual(r.stderr, "", `args ${JSON.stringify(args)}: stderr`);
    }
  } finally {
    cleanup(root);
  }
});

test("with a stub run.js that exits 3, the marker passes through and the exit is 3", () => {
  const root = makeTree({
    "run.js": "process.stdout.write('RUN-MARKER-OUT\\n'); process.stderr.write('RUN-MARKER-ERR\\n'); process.exit(3);\n",
  });
  try {
    const r = runWrapper(root, []);
    assert.strictEqual(r.status, 3);
    assert.match(r.stdout, /RUN-MARKER-OUT/);
    assert.match(r.stderr, /RUN-MARKER-ERR/);
    assert.ok(!r.stdout.includes(PLAIN_LINE), "the plain line must not print when the suite exists");
  } finally {
    cleanup(root);
  }
});

test("arguments are forwarded to run.js in order", () => {
  const root = makeTree({
    "run.js": "process.stdout.write('ARGS=' + JSON.stringify(process.argv.slice(2)) + '\\n');\n",
  });
  try {
    const r = runWrapper(root, ["--json", "--quiet", "extra arg"]);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, 'ARGS=["--json","--quiet","extra arg"]\n');
  } finally {
    cleanup(root);
  }
});

test("--enforce runs enforce.js (not run.js), forwards the other arguments and keeps its exit code", () => {
  const root = makeTree({
    "run.js": "process.stdout.write('RUN-CALLED\\n'); process.exit(0);\n",
    "enforce.js": "process.stdout.write('ENFORCE ARGS=' + JSON.stringify(process.argv.slice(2)) + '\\n'); process.exit(4);\n",
  });
  try {
    const r = runWrapper(root, ["--enforce", "--strict"]);
    assert.strictEqual(r.status, 4);
    assert.strictEqual(r.stdout, 'ENFORCE ARGS=["--strict"]\n');
  } finally {
    cleanup(root);
  }
});

test("a tree that resolves canonical and has no suite prints the missing-suite line on stderr and exits 2", () => {
  const root = makeTree(null, { files: CANONICAL_FILES });
  try {
    for (const args of [[], ["--json"], ["--enforce"]]) {
      const r = runWrapper(root, args);
      assert.strictEqual(r.status, 2, `args ${JSON.stringify(args)}: exit ${r.status}`);
      assert.strictEqual(r.stderr, MISSING_LINE + "\n", `args ${JSON.stringify(args)}: stderr`);
      assert.strictEqual(r.stdout, "", `args ${JSON.stringify(args)}: stdout`);
    }
  } finally {
    cleanup(root);
  }
});

test("a canonical tree with run.js but no enforce.js exits 2 under --enforce", () => {
  const root = makeTree({ "run.js": "process.stdout.write('RUN-CALLED\\n');\n" }, { files: CANONICAL_FILES });
  try {
    const r = runWrapper(root, ["--enforce"]);
    assert.strictEqual(r.status, 2);
    assert.strictEqual(r.stderr, MISSING_LINE + "\n");
    assert.strictEqual(r.stdout, "");
  } finally {
    cleanup(root);
  }
});

test("a consumer tree (installer-written record) with no suite prints the plain line and exits 0", () => {
  const root = makeTree(null, { files: CONSUMER_FILES });
  try {
    for (const args of [[], ["--enforce"]]) {
      const r = runWrapper(root, args);
      assert.strictEqual(r.status, 0, `args ${JSON.stringify(args)}: exit ${r.status}`);
      assert.strictEqual(r.stdout, PLAIN_LINE + "\n", `args ${JSON.stringify(args)}: stdout`);
      assert.strictEqual(r.stderr, "", `args ${JSON.stringify(args)}: stderr`);
    }
  } finally {
    cleanup(root);
  }
});

test("a missing or throwing resolver reads as role unknown: the plain line, exit 0, no stack trace", () => {
  for (const resolver of ["none", "throw"]) {
    const root = makeTree(null, { resolver, files: CANONICAL_FILES });
    try {
      const r = runWrapper(root, []);
      assert.strictEqual(r.status, 0, `resolver ${resolver}: exit ${r.status}`);
      assert.strictEqual(r.stdout, PLAIN_LINE + "\n", `resolver ${resolver}: stdout`);
      assert.strictEqual(r.stderr, "", `resolver ${resolver}: stderr`);
    } finally {
      cleanup(root);
    }
  }
});
