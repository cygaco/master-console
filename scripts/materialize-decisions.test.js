#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { harness, sealedDir } = require("./checks/lib/fixture-harness");
const core = require("./state/materialize-core");
const md = require("./materialize-decisions");

const h = harness("materialize-decisions");

h.test("computeStaleSnapshot returns an ARRAY (materialize-core needs an array source)", () => {
  const out = md.computeStaleSnapshot([{ stale_consumers: ["docs/x.md"] }]);
  assert.ok(Array.isArray(out), "computeStaleSnapshot MUST return an array");
});

h.test("computeStale is a pure passthrough (array in → array out; non-array → [])", () => {
  assert.deepStrictEqual(md.computeStale(["a", "b"]), ["a", "b"]);
  assert.deepStrictEqual(md.computeStale(null), []);
  assert.deepStrictEqual(md.computeStale({ currentlyStale: ["a"] }), [], "an object is NOT a valid stale list");
});

h.test("teeth: a non-empty stale list renders the files through materialize-core (not always-empty)", () => {
  const fx = sealedDir({}, "materialize-decisions-stale");
  try {
    const outPath = fx.file("docs/.decisions/STALE-FILES.md");
    const res = core.materialize({
      source: () => ["docs/A.md", "docs/B.md"],
      reducer: md.computeStale,
      renderer: md.renderStaleFiles,
      emptyRender: () => md.renderStaleFiles([]),
      outPath,
      root: fx.dir,
    });
    assert.strictEqual(res.ok, true, "materialize writes the stale file");
    const txt = fs.readFileSync(outPath, "utf8");
    assert.ok(/docs\/A\.md/.test(txt) && /docs\/B\.md/.test(txt), "the stale files are listed");
    assert.ok(/2 file\(s\) need review/.test(txt), "the count is rendered");
    assert.ok(!/No stale files/.test(txt), "a non-empty list must NOT render the empty message");
  } finally {
    fx.cleanup();
  }
});

h.violation("planted violation: an OBJECT source (old bug shape) drops a real stale file — teeth catch it", () => {
  const fx = sealedDir({}, "materialize-decisions-stale-neg");
  try {
    const outPath = fx.file("docs/.decisions/STALE-FILES.md");
    core.materialize({
      source: () => ({ currentlyStale: ["docs/A.md"] }),
      reducer: md.computeStale,
      renderer: md.renderStaleFiles,
      emptyRender: () => md.renderStaleFiles([]),
      outPath,
      root: fx.dir,
    });
    const txt = fs.readFileSync(outPath, "utf8");
    const dropped = /No stale files/.test(txt) ? ["docs/A.md"] : [];
    return { violations: dropped };
  } finally {
    fx.cleanup();
  }
});

h.test("sanity: DECISIONS renders grouped events through materialize-core", () => {
  const fx = sealedDir({}, "materialize-decisions-decisions");
  try {
    const outPath = fx.file("docs/DECISIONS.md");
    const events = [
      { id: "E1", ts: "2026-07-18T01:00", file: "a.ts", change: "add", group: "g1" },
      { id: "E2", ts: "2026-07-18T02:00", file: "b.ts", change: "edit", group: "g1" },
    ];
    const res = core.materialize({
      source: () => events,
      reducer: md.groupEvents,
      renderer: md.renderDecisions,
      emptyRender: () => "# Decision Log\n\nNo events.\n",
      outPath,
      root: fx.dir,
    });
    assert.strictEqual(res.ok, true);
    const txt = fs.readFileSync(outPath, "utf8");
    assert.ok(/a\.ts/.test(txt) && /b\.ts/.test(txt), "decisions rows rendered");
  } finally {
    fx.cleanup();
  }
});

h.done();
