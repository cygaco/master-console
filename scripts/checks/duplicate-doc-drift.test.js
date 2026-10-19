#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { harness, sealedDir } = require("./lib/fixture-harness");
const {
  evaluate,
  fileMatchesDirGlob,
  shippedDocPaths,
  buildGroups,
} = require("./duplicate-doc-drift");

const SCRIPT = path.join(__dirname, "duplicate-doc-drift.js");
const ROOT = path.resolve(__dirname, "..", "..");
const h = harness("duplicate-doc-drift");

const POD_RULE = { basename: "builder.md", dirGlobs: [".claude/agents/engineering/*/"], reason: "per-pod role doc" };

const driftedGroup = (basename, dirs) => ({
  basename,
  members: dirs.map((d, i) => ({ file: `${d}${basename}`, hash: `hash${i}` })),
});
const identicalGroup = (basename, dirs) => ({
  basename,
  members: dirs.map((d) => ({ file: `${d}${basename}`, hash: "same" })),
});

const flagged = (res, basename) => res.findings.some((f) => f.basename === basename);
const allowedFor = (res, basename) => res.allowed.find((a) => a.basename === basename);

h.pass("no groups → clean", () => evaluate({ groups: [], rules: [] }));

h.violation("planted drifted duplicate (no allowlist rule) is CAUGHT", () => {
  const res = evaluate({
    groups: [driftedGroup("agent-dispatch-guide.md", [".claude/agents/.system/guides/", ".claude/project/reference/"])],
    rules: [POD_RULE],
  });
  assert.ok(flagged(res, "agent-dispatch-guide.md"), "drifted unsanctioned dup must flag");
  assert.strictEqual(res.findings[0].kind, "duplicate-doc-drift");
  return res;
});

h.pass("sanctioned drifted duplicate (per-pod builder.md) is allowed, not flagged", () => {
  const res = evaluate({
    groups: [
      driftedGroup("builder.md", [
        ".claude/agents/engineering/frontend/",
        ".claude/agents/engineering/backend/",
        ".claude/agents/engineering/security/",
      ]),
    ],
    rules: [POD_RULE],
  });
  assert.ok(!flagged(res, "builder.md"), "sanctioned dup must NOT flag");
  assert.ok(/sanctioned-duplicate/.test((allowedFor(res, "builder.md") || {}).allowedBy || ""), "must be recorded as sanctioned");
  return res;
});

h.pass("identical-content duplicate is allowed, not flagged", () => {
  const res = evaluate({
    groups: [identicalGroup("agent-dispatch-guide.md", [".claude/agents/.system/guides/", ".claude/project/reference/"])],
    rules: [],
  });
  assert.ok(!flagged(res, "agent-dispatch-guide.md"), "identical dup must NOT flag");
  assert.strictEqual((allowedFor(res, "agent-dispatch-guide.md") || {}).allowedBy, "identical-content");
  return res;
});

h.violation("a drifted member outside the sanctioned dir is NOT exempted (partial-sanction guard)", () => {
  const res = evaluate({
    groups: [
      {
        basename: "builder.md",
        members: [
          { file: ".claude/agents/engineering/frontend/builder.md", hash: "a" },
          { file: ".claude/project/reference/builder.md", hash: "b" },
        ],
      },
    ],
    rules: [POD_RULE],
  });
  assert.ok(flagged(res, "builder.md"), "a member outside the sanctioned dir must keep the group flagged");
  return res;
});

h.test("fileMatchesDirGlob: single-* matches exactly one segment; literal dirs match", () => {
  assert.ok(fileMatchesDirGlob(".claude/agents/engineering/frontend/builder.md", ".claude/agents/engineering/*/"));
  assert.ok(fileMatchesDirGlob("_knowledge/design/README.md", "_knowledge/*/"));
  assert.ok(fileMatchesDirGlob("patterns/README.md", "patterns/"));
  assert.ok(!fileMatchesDirGlob(".claude/agents/engineering/frontend/sub/builder.md", ".claude/agents/engineering/*/"));
  assert.ok(!fileMatchesDirGlob(".claude/project/reference/builder.md", ".claude/agents/engineering/*/"));
  assert.ok(!fileMatchesDirGlob("patterns/README.md", "patterns"));
});

h.test("disk: shippedDocPaths excludes skill/release_capsule kinds + buildGroups hashes content", () => {
  const manifest = {
    assets: {
      reference: [
        { dest: "a/guide.md", kind: "reference", owner: "framework", removedIn: null },
        { dest: "b/guide.md", kind: "reference", owner: "framework", removedIn: null },
        { dest: "c/solo.md", kind: "reference", owner: "framework", removedIn: null },
        { dest: "d/removed.md", kind: "reference", owner: "framework", removedIn: "0.9.0" },
        { dest: "e/project.md", kind: "reference", owner: "generated", removedIn: null },
      ],
      skill: [
        { dest: ".claude/commands/x/list.md", kind: "skill", owner: "framework", removedIn: null },
        { dest: ".claude/commands/y/list.md", kind: "skill", owner: "framework", removedIn: null },
      ],
      release_capsule: [
        { dest: "framework/releases/0.1.0/changelog.md", kind: "release_capsule", owner: "framework", removedIn: null },
        { dest: "framework/releases/0.2.0/changelog.md", kind: "release_capsule", owner: "framework", removedIn: null },
      ],
    },
  };
  const fx = sealedDir(
    {
      ".claude/framework-manifest.json": JSON.stringify(manifest),
      "a/guide.md": "CANONICAL CONTENT v1",
      "b/guide.md": "DRIFTED CONTENT v2",
      "c/solo.md": "only one of me",
    },
    "ddd-disk",
  );
  try {
    const out = execFileSync(process.execPath, [SCRIPT, "--json"], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: fx.dir },
    });
    const res = JSON.parse(out);
    const scanned = res.notes.join(" ");
    assert.ok(/3 shipped framework doc\(s\)/.test(scanned), `expected 3 in-scope docs, got: ${scanned}`);
    assert.strictEqual(res.findings.length, 1, `expected 1 finding, got ${res.findings.length}`);
    assert.strictEqual(res.findings[0].basename, "guide.md");
    assert.ok(!res.findings.some((f) => f.basename === "list.md" || f.basename === "changelog.md"), "skill/capsule collisions must be excluded");
  } finally {
    fx.cleanup();
  }
});

h.failClosed("malformed framework-manifest → exit 2 (fail-closed)", () => {
  const fx = sealedDir({ ".claude/framework-manifest.json": "{ this is not json" }, "ddd-bad");
  try {
    const r = execFileSync(process.execPath, [SCRIPT, "--json"], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: fx.dir },
    });
    return { exitCode: 0, _unexpected: r };
  } catch (e) {
    return { exitCode: e.status };
  } finally {
    fx.cleanup();
  }
});

h.test("integration: real enforcer runs on the live tree; report-only=0, enforce=0 (clean) or 1 (a drift); never exit 2", () => {
  const { spawnSync } = require("child_process");
  const ro = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: ROOT });
  const statusRO = ro.status;
  const outRO = `${ro.stdout || ""}${ro.stderr || ""}`;
  assert.strictEqual(statusRO, 0, `report-only must exit 0, got ${statusRO}: ${outRO.slice(0, 300)}`);
  assert.ok(/\[duplicate-doc-drift\]/.test(outRO), `expected a verdict line, got: ${outRO.slice(0, 200)}`);
  assert.ok(!/FAIL[\s\S]*builder\.md/.test(outRO) && !/WARN[\s\S]*builder\.md/.test(outRO), "builder.md (sanctioned) must NOT be a finding");

  let statusEnf = 0;
  let outEnf = "";
  try {
    outEnf = execFileSync(process.execPath, [SCRIPT, "--enforce"], { encoding: "utf8", cwd: ROOT });
  } catch (e) {
    statusEnf = e.status;
    outEnf = `${e.stdout || ""}${e.stderr || ""}`;
  }
  assert.ok(statusEnf === 0 || statusEnf === 1, `--enforce must exit 0 (clean) or 1 (drift), never 2, got ${statusEnf}: ${outEnf.slice(0, 300)}`);
  if (statusEnf === 1) assert.ok(/FAIL \[duplicate-doc-drift\]/.test(outEnf), "enforce mode prints a FAIL verdict when it exits 1");
});

h.done();
