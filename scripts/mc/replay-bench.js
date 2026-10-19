#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function run(label, cmd, args, opts = {}) {
  const r = spawnSync(process.execPath, [cmd, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    ...opts,
  });
  const ok = opts.expectFail ? r.status !== 0 : r.status === 0;
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"} ${label}  (exit=${r.status})\n`,
  );
  if (!ok) {
    process.stdout.write(
      `  stdout: ${(r.stdout || "").trim().slice(0, 300)}\n`,
    );
    process.stdout.write(
      `  stderr: ${(r.stderr || "").trim().slice(0, 300)}\n`,
    );
  }
  return ok;
}

function jsonAssert(label, fn) {
  try {
    const result = fn();
    process.stdout.write(`${result ? "PASS" : "FAIL"} ${label}\n`);
    return !!result;
  } catch (e) {
    process.stdout.write(`FAIL ${label}\n  err: ${e && e.message}\n`);
    return false;
  }
}

const results = [];

results.push(
  run("content-hash --selftest", "scripts/mc/lib/content-hash.js", [
    "--selftest",
  ]),
);

results.push(
  jsonAssert("framework-manifest.json sha256 length=[64]", () => {
    const m = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, ".claude", "framework-manifest.json"),
        "utf8",
      ),
    );
    const flat = [];
    for (const k of Object.keys(m.assets || {})) {
      for (const a of m.assets[k] || []) flat.push(a);
    }
    const lens = new Set(flat.map((a) => (a.sha256 || "").length));
    return flat.length > 0 && lens.size === 1 && [...lens][0] === 64;
  }),
);

results.push(
  jsonAssert(
    "framework-installed.json installedHash length=[64]",
    () => {
      const i = JSON.parse(
        fs.readFileSync(
          path.join(ROOT, ".claude", "framework-installed.json"),
          "utf8",
        ),
      );
      const lens = new Set(
        (i.assets || []).map((a) => (a.installedHash || "").length),
      );
      return (
        (i.assets || []).length > 0 && lens.size === 1 && [...lens][0] === 64
      );
    },
  ),
);

results.push(
  run(
    "back-compat: hashMatches accepts simulated 12-char prefix",
    "scripts/mc/test-hash-back-compat.js",
    [],
  ),
);

results.push(
  run(
    "manifest-honesty",
    "scripts/checks/mc-manifest-honesty.js",
    [],
  ),
);

results.push(
  run(
    "applied-migrations gate capsule-aware",
    "scripts/checks/mc-applied-migrations.js",
    [],
  ),
);

results.push(
  run(
    "preflight rejects unknown gate name (exit 2)",
    "scripts/mc/preflight.js",
    [
      "--operator-override",
      "not-a-real-gate",
      "--override-reason",
      "valid reason here",
    ],
    { expectFail: true },
  ),
);

results.push(
  run(
    "preflight rejects missing --override-reason (exit 2)",
    "scripts/mc/preflight.js",
    ["--operator-override", "staleness"],
    { expectFail: true },
  ),
);

results.push(
  run(
    "preflight rejects too-short --override-reason (exit 2)",
    "scripts/mc/preflight.js",
    ["--operator-override", "staleness", "--override-reason", "short"],
    { expectFail: true },
  ),
);

const total = results.length;
const passed = results.filter(Boolean).length;
process.stdout.write(`\nreplay-bench: ${passed}/${total} pass\n`);
process.exit(passed === total ? 0 : 1);
