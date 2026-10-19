#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CHECK = path.join(__dirname, "doc-ref-integrity.js");
const mod = require("./doc-ref-integrity.js");

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

ok("PLANTED: a broken ref flags (high-severity finding)", () => {
  const { findings } = mod.evaluate({
    refs: [{ file: "CLAUDE.md", line: 7, target: "scripts/checks/dispatch-contract.js", exists: false }],
    allowlist: { pathPrefixes: [], literals: [] },
  });
  assert.strictEqual(findings.length, 1, "exactly one finding");
  assert.strictEqual(findings[0].kind, "broken-doc-ref");
  assert.ok(/dispatch-contract\.js/.test(findings[0].message));
});

ok("a resolvable ref does NOT flag", () => {
  const { findings } = mod.evaluate({
    refs: [{ file: "AGENTS.md", line: 1, target: ".claude/agents/_system/agent-system.md", exists: true }],
    allowlist: { pathPrefixes: [], literals: [] },
  });
  assert.strictEqual(findings.length, 0);
});

ok("literal-allowlisted absent ref does NOT flag", () => {
  const { findings, allowed } = mod.evaluate({
    refs: [{ file: "X.md", line: 1, target: "design/placeholder.md", exists: false }],
    allowlist: { pathPrefixes: [], literals: ["design/placeholder.md"] },
  });
  assert.strictEqual(findings.length, 0);
  assert.strictEqual(allowed[0].allowedBy, "literal-allowlist");
});

ok("prefix-allowlisted absent ref does NOT flag", () => {
  const { findings, allowed } = mod.evaluate({
    refs: [{ file: "X.md", line: 1, target: "runtime/notes/scratch.md", exists: false }],
    allowlist: { pathPrefixes: ["runtime/"], literals: [] },
  });
  assert.strictEqual(findings.length, 0);
  assert.ok(/prefix-allowlist/.test(allowed[0].allowedBy));
});

ok("extracts a markdown link target", () => {
  const refs = mod.extractRefs("AGENTS.md", "see [spec](.claude/agents/_system/agent-system.md) for more");
  assert.ok(refs.some((r) => r.target === ".claude/agents/_system/agent-system.md"));
});

ok("extracts an anchored backtick path-ref (even with a trailing arg)", () => {
  const refs = mod.extractRefs("CLAUDE.md", "Enforcer: `scripts/checks/dispatch-contract.js validate`.");
  assert.ok(refs.some((r) => r.target === "scripts/checks/dispatch-contract.js"));
});

ok("does NOT extract external/anchor/site-absolute targets", () => {
  const refs = mod.extractRefs(
    "X.md",
    "[a](https://x.com) [b](#section) [c](mailto:x@example.com) [d](/abs/site)",
  );
  assert.strictEqual(refs.length, 0, `expected 0 refs, got ${JSON.stringify(refs)}`);
});

ok("does NOT extract a <placeholder> path (templates don't false-fire)", () => {
  const refs = mod.extractRefs("X.md", "run `scripts/<name>.js` for a one-off");
  assert.strictEqual(refs.length, 0);
});

ok("a `<!-- doc-ref-ignore -->` line is skipped entirely", () => {
  const refs = mod.extractRefs("X.md", "see [gone](scripts/dead/file.js) <!-- doc-ref-ignore -->");
  assert.strictEqual(refs.length, 0);
});

ok("isExternalOrAnchor classifies correctly", () => {
  assert.ok(mod.isExternalOrAnchor("https://x"));
  assert.ok(mod.isExternalOrAnchor("#frag"));
  assert.ok(mod.isExternalOrAnchor("/abs"));
  assert.ok(mod.isExternalOrAnchor("<x>"));
  assert.ok(mod.isExternalOrAnchor("scripts/foo.js"), "foo.* is a conventional placeholder");
  assert.ok(mod.isExternalOrAnchor("path/to/file.md"), "path/to/ is a conventional placeholder");
  assert.ok(!mod.isExternalOrAnchor("scripts/checks/dispatch-contract.js"), "a real path is not external");
});

ok("backtick foo.* placeholder is NOT extracted (filter applies to backticks too)", () => {
  const refs = mod.extractRefs("X.md", "create `scripts/hooks/foo.js` as a template");
  assert.strictEqual(refs.length, 0);
});

ok("`<!-- doc-ref-ignore: reason -->` (with a reason) also skips the line", () => {
  const refs = mod.extractRefs("X.md", "old [x](scripts/dead/gone.js) <!-- doc-ref-ignore: historical -->");
  assert.strictEqual(refs.length, 0);
});

ok("PER-MACHINE: refs to gitignored/per-machine targets are allowed-absent under the shipped allowlist", () => {
  const allowlist = mod.loadAllowlist();
  const refs = [
    { file: ".claude/agents/president/beta.md", line: 1, target: ".claude/agents/president/_system/beta/mined/beta-source-data.md", exists: false },
    { file: "trackers/epics/E-X.md", line: 1, target: "../../.claude/runtime/example-state.md", exists: false },
    { file: ".claude/commands/permissions/authorized.md", line: 1, target: ".claude/settings.local.json", exists: false },
  ];
  const { findings, allowed } = mod.evaluate({ refs, allowlist });
  assert.strictEqual(findings.length, 0, `per-machine targets must not be broken refs: ${JSON.stringify(findings.map((f) => f.target))}`);
  assert.strictEqual(allowed.length, refs.length, "every per-machine ref is accounted for as allowed-absent");
});

const PROJECT_AUTHORED_KEEP = new Set([
  "RELEASES.md", "issues.md", "ROADMAP.md", "tests/regression", ".claude/project/etc/eval-packs",
  "_docs", "_docs/research", "_requirements", "_requirements/04-features", "_requirements/09-integrations",
  ".claude/manifest.json", ".claude/settings.json",
]);
const PROJECT_AUTHORED_KEYS = new Set(["goldenPaths"]);
function gitCheckIgnore(gitignoreText, paths) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gi-cov-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, ".gitignore"), gitignoreText);
    const r = spawnSync("git", ["check-ignore", "--no-index", "-v", "--stdin"], { cwd: tmp, input: paths.join("\n") + "\n", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.ok(r.status === 0 || r.status === 1, `git check-ignore failed: ${r.stderr}`);
    const ignored = new Set();
    for (const line of (r.stdout || "").split(/\r?\n/)) {
      const m = /^(.+?):(\d+):(.*)\t(.*)$/.exec(line);
      if (m && !m[3].startsWith("!")) ignored.add(m[4]);
    }
    return ignored;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
ok("PER-MACHINE: shipped .gitignore ignores every pure instance store in the paths registry (and no shipped file)", () => {
  const root = path.join(__dirname, "..", "..");
  const seed = path.join(root, "scripts", "public-repo", "seeds", ".gitignore");
  const gitignore = fs.readFileSync(fs.existsSync(seed) ? seed : path.join(root, ".gitignore"), "utf8");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "framework", "paths.registry.json"), "utf8"));
  const allowFile = path.join(root, "scripts", "public-repo", "allowlist.txt");
  let shipped;
  if (fs.existsSync(allowFile)) {
    shipped = fs.readFileSync(allowFile, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  } else {
    const ls = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.strictEqual(ls.status, 0, "git ls-files must work on the emitted clone");
    shipped = ls.stdout.split(/\r?\n/).filter(Boolean);
  }
  const stores = [];
  for (const [key, o] of Object.entries(registry.paths || {})) {
    if (!o || (o.owner !== "runtime" && o.owner !== "project" && o.owner !== "generated")) continue;
    const rel = String(o.path || "").split("\\").join("/").replace(/^\.\//, "").replace(/\/$/, "");
    if (!rel || rel.startsWith("..") || PROJECT_AUTHORED_KEEP.has(rel) || PROJECT_AUTHORED_KEYS.has(key)) continue;
    if (shipped.some((f) => f === rel || f.startsWith(rel + "/"))) continue;
    stores.push({ key, rel, probe: o.kind === "dir" ? rel + "/__probe__" : rel });
  }
  for (const rel of [".claude/agents/president/_system/beta/mined/", ".claude/runtime/"]) {
    stores.push({ key: "anchor", rel, probe: rel + "__probe__" });
  }
  assert.ok(stores.length > 20, `instance-store set unexpectedly small (${stores.length})`);
  const ignored = gitCheckIgnore(gitignore, stores.map((s) => s.probe));
  const uncovered = stores.filter((s) => !ignored.has(s.probe)).map((s) => `${s.key} -> ${s.rel}`);
  assert.deepStrictEqual(uncovered, [], `shipped .gitignore does not ignore these instance stores:\n  ${uncovered.join("\n  ")}`);
  const shadowed = [...gitCheckIgnore(gitignore, shipped)];
  assert.deepStrictEqual(shadowed, [], `shipped paths shadowed by .gitignore: ${shadowed.slice(0, 20).join(", ")}`);
});

ok("PER-MACHINE RED-first: an un-ignored instance store is detected as a completeness failure", () => {
  const root = path.join(__dirname, "..", "..");
  const seed = path.join(root, "scripts", "public-repo", "seeds", ".gitignore");
  const gitignore = fs.readFileSync(fs.existsSync(seed) ? seed : path.join(root, ".gitignore"), "utf8");
  const probe = ".claude/synthetic-uncovered-store-999/__probe__";
  const ignored = gitCheckIgnore(gitignore, [probe]);
  assert.ok(!ignored.has(probe), "control: the synthetic store must NOT be pre-ignored by a broad pattern");
  const uncovered = [{ key: "synthetic", rel: ".claude/synthetic-uncovered-store-999", probe }].filter((s) => !ignored.has(s.probe));
  assert.strictEqual(uncovered.length, 1, "the enforcer must report an un-ignored instance store as a failure (teeth)");
});

ok("PER-MACHINE RED-first: a file store with only a dir-only .gitignore rule is caught (kind probe fix)", () => {
  const dirOnly = ".claude/synthetic-file-store-999.json/\n";
  const asFile = ".claude/synthetic-file-store-999.json";
  assert.ok(!gitCheckIgnore(dirOnly, [asFile]).has(asFile), "a dir-only rule must NOT ignore the file store probed as the file");
  assert.ok(gitCheckIgnore(dirOnly, [asFile + "/__probe__"]).has(asFile + "/__probe__"), "control: a file/__probe__ probe is fooled by the dir-only rule");
  assert.ok(gitCheckIgnore(".claude/synthetic-file-store-999.json\n", [asFile]).has(asFile), "control: a real file rule ignores the file");
});
ok("PER-MACHINE: the generated specGraph store (SPEC_GRAPH.json) is ignored by the shipped seed", () => {
  const root = path.join(__dirname, "..", "..");
  const seed = path.join(root, "scripts", "public-repo", "seeds", ".gitignore");
  const gitignore = fs.readFileSync(fs.existsSync(seed) ? seed : path.join(root, ".gitignore"), "utf8");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "framework", "paths.registry.json"), "utf8"));
  const o = registry.paths.specGraph;
  assert.ok(o && o.owner === "generated", "specGraph must be a generated store in the registry");
  const rel = String(o.path).split("\\").join("/");
  assert.ok(gitCheckIgnore(gitignore, [rel]).has(rel), `${rel} must be ignored by the shipped seed`);
});

ok("LITERAL: one literal is allowed-absent under its root AND dir-relative spellings", () => {
  const base = mod.loadAllowlist();
  const allowlist = { ...base, literals: [...base.literals, "_planning/example-plan.md"] };
  const refs = [
    { file: "ROADMAP.md", line: 1, target: "_planning/example-plan.md", exists: false },
    { file: "trackers/epics/E-X-example.md", line: 1, target: "../../_planning/example-plan.md", exists: false },
  ];
  const { findings, allowed } = mod.evaluate({ refs, allowlist });
  assert.strictEqual(findings.length, 0, `both spellings must be allowed-absent: ${JSON.stringify(findings.map((f) => f.target))}`);
  assert.ok(allowed.every((a) => a.allowedBy === "literal-allowlist"), "allowed by the literal, not by accident");
  const stray = mod.evaluate({
    refs: [{ file: "trackers/epics/E-X.md", line: 1, target: "../_planning/example-plan.md", exists: false }],
    allowlist,
  });
  assert.strictEqual(stray.findings.length, 1, "a spelling resolving to trackers/_planning/... is still a broken ref");
});

ok("LIVE-PLANTED: a dead markdown link in a sealed repo is caught end-to-end", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "dri-proj-"));
  fs.mkdirSync(path.join(proj, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(proj, "scripts", "real.js"), "// real\n");
  fs.writeFileSync(
    path.join(proj, "CLAUDE.md"),
    "valid: [r](scripts/real.js)\nbroken: [d](scripts/checks/moved-away.js)\n",
  );
  const r = spawnSync("node", [CHECK, "--json"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
    encoding: "utf8",
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.ok, false, "should report a broken ref");
  assert.strictEqual(out.fatal, false);
  assert.ok(
    out.findings.some((f) => f.target === "scripts/checks/moved-away.js"),
    "the dead link must be the finding",
  );
  assert.ok(
    !out.findings.some((f) => f.target === "scripts/real.js"),
    "the valid ref must NOT be flagged",
  );
  assert.strictEqual(r.status, 0, "report-only exits 0");
  const r2 = spawnSync("node", [CHECK, "--enforce"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
    encoding: "utf8",
  });
  assert.strictEqual(r2.status, 1, "--enforce blocks on a broken ref");
});

console.log(`\ndoc-ref-integrity: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
