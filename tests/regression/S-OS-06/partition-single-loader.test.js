#!/usr/bin/env node
"use strict";
/**
 * partition-single-loader.test.js — S-OS-06 T2, record-trust Req1 (β r3).
 *
 * ONE partition artifact behind ONE loader. The structural guard
 * (partition-loader.js#findUnroutedReaders) names every executable file — tracked or
 * untracked-not-ignored — that references the artifact directly instead of going through
 * the loader. GREEN: the real tree has no such reader, and the codemod + both gates require
 * the loader. RED: planted direct readers in a fixture repo (full name and stem, tracked
 * and untracked) are each named.
 *
 *   node --test tests/regression/S-OS-06/partition-single-loader.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const H = require("./falsifier-harness");

function guardIn(fx) {
  const loaderAbs = path.join(fx.dir, ...H.REL.loader.split("/"));
  const r = spawnSync(
    process.execPath,
    ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(loaderAbs)}).findUnroutedReaders()))`],
    { cwd: fx.dir, encoding: "utf8", timeout: 60000 }
  );
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("single-loader GREEN: no executable file in the real tree names the partition artifact outside the loader", () => {
  const offenders = H.LOADER.findUnroutedReaders();
  assert.deepStrictEqual(offenders, [], `un-routed partition readers: ${JSON.stringify(offenders, null, 2)}`);
});

test("single-loader GREEN: the codemod and both gates consume the partition through the loader", () => {
  for (const rel of [H.REL.codemod, H.REL.purity, H.REL.cutover]) {
    const src = fs.readFileSync(path.join(H.REAL_ROOT, ...rel.split("/")), "utf8");
    assert.match(src, /require\((["'])(\.\/|\.\.\/open-source\/)partition-loader\1\)/, `${rel} must require the partition loader`);
  }
});

test("single-loader RED: planted direct readers (full name + stem, tracked + untracked) are each named by the guard", () => {
  H.withFixture({}, (fx) => {
    assert.deepStrictEqual(guardIn(fx), [], "the clean fixture has no un-routed reader (GREEN baseline)");

    const base = path.basename(H.LOADER.DENYLIST_PATH);
    const stem = base.replace(/\.json$/i, "");
    fx.write("src/bad-reader.js", `module.exports = require("../scripts/open-source/${base}");\n`);
    fx.git(["add", "src/bad-reader.js"]);
    fx.write("tools/untracked-reader.js", `module.exports = require("../scripts/open-source/${stem}");\n`);
    fx.write("tools/raw-read.sh", `cat scripts/open-source/${base}\n`);

    const files = [...new Set(guardIn(fx).map((o) => o.file))].sort();
    assert.deepStrictEqual(files, ["src/bad-reader.js", "tools/raw-read.sh", "tools/untracked-reader.js"]);
  });
});
