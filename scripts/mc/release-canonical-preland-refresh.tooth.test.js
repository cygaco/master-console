"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "release-canonical.js"), "utf8");
const LINES = SRC.split(/\r?\n/);

const REFRESH_RE = /const syncRefresh = gitC\([^)]*"restore", "--source=main"/;

function lineIndexMatching(re) {
  const i = LINES.findIndex((l) => re.test(l));
  assert.ok(i >= 0, `expected a source line matching ${re}`);
  return i;
}

test("pre-land refresh lives between the origin sync and the brokered land", () => {
  const syncI = lineIndexMatching(/const sync = syncMainFromOrigin\(/);
  const refreshI = lineIndexMatching(REFRESH_RE);
  const mergeI = lineIndexMatching(/\bres = brokerMerge\(/);
  assert.ok(syncI < refreshI, "the pre-land refresh must come AFTER syncMainFromOrigin()");
  assert.ok(refreshI < mergeI, "the pre-land refresh must come BEFORE brokerMerge()");
});

test("pre-land refresh is UNCONDITIONAL — function-body indentation, not nested in a conditional", () => {
  const refreshLine = LINES.find((l) => REFRESH_RE.test(l));
  assert.ok(refreshLine, "the pre-land refresh line must exist");
  const indent = refreshLine.match(/^(\s*)/)[1];
  assert.strictEqual(
    indent,
    "  ",
    `the pre-land refresh must sit at function-body (2-space) indentation so it runs UNCONDITIONALLY; ` +
      `found indent of length ${indent.length} — a deeper indent means it was re-wrapped in a conditional ` +
      `(a per-invocation gate skips the refresh on a crash/resume path).`,
  );
});

test("no per-invocation `if (sync.synced)` gate in the file", () => {
  assert.ok(
    !/if\s*\(\s*sync\.synced\b/.test(SRC),
    "`if (sync.synced)` must not gate the pre-land refresh: on a crash/resume where a PRIOR invocation " +
      "moved main (sync then sees local===origin → synced:false), a gated refresh is skipped and brokerMerge " +
      "merges against a stale tree.",
  );
});
