"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CT = require("./change-trailer");
const MCENV = require("../hooks/lib/mc-env");
const CLI = path.join(__dirname, "change-trailer.js");
const FIXTURE_TRAILERS = {
  "minor-bugfix": "fix(sprint): status lag on closed tickets\n\nOne-line body.\n\nChange: bugfix\nBlast: minor\nRisks: none\n",
  "major-release": "release(mc): cut the release build\n\nChange: release\nBlast: major\nRisks: release-pipeline,paths-registry\n",
  "security-touch": "fix(dispatch): attest-signing key handling\n\nChange: bugfix\nBlast: minor\nRisks: none\n",
  "no-trailer": "chore: tidy a comment\n\nNo classification trailer on purpose.\n",
};

function fixture(name) {
  if (!Object.prototype.hasOwnProperty.call(FIXTURE_TRAILERS, name)) throw new Error("unknown trailer fixture: " + name);
  return FIXTURE_TRAILERS[name];
}

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ct-${tag}-`));
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function writeRegistry(root, { primary, status }) {
  const dir = path.join(root, ".claude", "project", "sprint");
  fs.mkdirSync(dir, { recursive: true });
  const lines = ["schema: mc/sprint/active-sprints/v1"];
  if (primary) lines.push(`primary: ${primary}`);
  lines.push("sprints:");
  lines.push("  - id: SP-OLD-999999", "    title: old", "    status: retrospected");
  if (primary) lines.push(`  - id: ${primary}`, "    title: live", `    status: ${status}`, "    layout: per_sprint_subdir");
  fs.writeFileSync(path.join(dir, "active-sprints.yaml"), lines.join("\n") + "\n");
}

function runCli(args, { cwd, env } = {}) {
  const e = { ...process.env, CLAUDE_PROJECT_DIR: cwd || ROOT, ...(env || {}) };
  MCENV.unsetEnv("CHANGE_TRAILER", e);
  Object.assign(e, env || {});
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: cwd || ROOT, env: e, encoding: "utf8", windowsHide: true, timeout: 30000 });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function readEvents(projectDir) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    let ents = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === ".git") continue;
        walk(p, depth + 1);
      } else if (e.name === "events.jsonl") {
        for (const line of fs.readFileSync(p, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            out.push(JSON.parse(line));
          } catch {
          }
        }
      }
    }
  };
  walk(projectDir, 0);
  return out;
}

const kindsOf = (events) => events.map((e) => e && e.data && e.data.kind).filter(Boolean);

test("minor-bugfix fixture parses to bugfix/minor/none", () => {
  const v = CT.validate(fixture("minor-bugfix"));
  assert.strictEqual(v.ok, true, v.errors.join("; "));
  assert.deepStrictEqual(v.value, { change: "bugfix", blast: "minor", risks: ["none"] });
});

test("major-release fixture parses to release/major/[release-pipeline,paths-registry]", () => {
  const v = CT.validate(fixture("major-release"));
  assert.strictEqual(v.ok, true, v.errors.join("; "));
  assert.deepStrictEqual(v.value, { change: "release", blast: "major", risks: ["release-pipeline", "paths-registry"] });
});

test("security-touch fixture (deliberately under-declared) parses to bugfix/minor/none", () => {
  const v = CT.validate(fixture("security-touch"));
  assert.strictEqual(v.ok, true, v.errors.join("; "));
  assert.deepStrictEqual(v.value, { change: "bugfix", blast: "minor", risks: ["none"] });
});

test("no-trailer fixture is invalid and names all three missing keys", () => {
  const v = CT.validate(fixture("no-trailer"));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.errors.length, 3);
  assert.deepStrictEqual(v.errors.map((e) => /Change|Blast|Risks/.exec(e)[0]), ["Change", "Blast", "Risks"]);
});

test("parse: keys are case-insensitive and values are lower-cased", () => {
  const p = CT.parse("s\n\nCHANGE: Update\nblast: MAJOR\nRisks: Hooks, CI\n");
  assert.deepStrictEqual({ c: p.change, b: p.blast, r: p.risks }, { c: "update", b: "major", r: ["hooks", "ci"] });
});

test("parse: trailers may share the final paragraph with Co-Authored-By or sit above it", () => {
  const same = CT.parse("s\n\nbody\n\nChange: bugfix\nBlast: minor\nRisks: none\nCo-Authored-By: A <a@example.com>\n");
  const split = CT.parse("s\n\nbody\n\nChange: bugfix\nBlast: minor\nRisks: none\n\nCo-Authored-By: A <a@example.com>\n");
  for (const p of [same, split]) assert.deepStrictEqual({ c: p.change, b: p.blast, r: p.risks }, { c: "bugfix", b: "minor", r: ["none"] });
});

test("parse: a Change: line inside prose (not the trailing block) is not a trailer", () => {
  const p = CT.parse("s\n\nChange: bugfix\nBlast: minor\nRisks: none\n\nand then more prose follows this block\n");
  assert.strictEqual(p.change, null);
});

test("parse: git comment lines and CRLF are tolerated", () => {
  const p = CT.parse("s\r\n\r\nChange: update\r\nBlast: minor\r\nRisks: none\r\n# Please enter the commit message\r\n# lines starting with # are ignored\r\n");
  assert.strictEqual(CT.validate(p).ok, true);
});

test("validate: bad values are named", () => {
  const v = CT.validate("s\n\nChange: feature\nBlast: huge\nRisks: Bad Token\n");
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /invalid Change "feature"/.test(e)));
  assert.ok(v.errors.some((e) => /invalid Blast "huge"/.test(e)));
  assert.ok(v.errors.some((e) => /invalid Risks token/.test(e)));
});

test("validate: none cannot be combined, empty Risks is refused, conflicting duplicates are refused", () => {
  assert.strictEqual(CT.validate("s\n\nChange: update\nBlast: minor\nRisks: none,hooks\n").ok, false);
  assert.strictEqual(CT.validate("s\n\nChange: update\nBlast: minor\nRisks:\n").ok, false);
  const dup = CT.validate("s\n\nChange: update\nChange: release\nBlast: minor\nRisks: none\n");
  assert.strictEqual(dup.ok, false);
  assert.ok(dup.errors.some((e) => /conflicting duplicate "Change"/.test(e)));
  assert.strictEqual(CT.validate("s\n\nChange: update\nChange: update\nBlast: minor\nRisks: none\n").ok, true, "identical duplicates are harmless");
});

test("a syntactically well-formed but unrecognized Risks token is REJECTED, not silently accepted", () => {
  const v = CT.validate("s\n\nChange: update\nBlast: minor\nRisks: not-a-real-category\n");
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /outside the controlled vocabulary/.test(e)), v.errors.join("; "));
});

test("every token in RISK_VOCAB itself is accepted (the vocab is internally consistent)", () => {
  for (const tok of CT.RISK_VOCAB) {
    if (tok === "none") continue;
    const v = CT.validate(`s\n\nChange: update\nBlast: minor\nRisks: ${tok}\n`);
    assert.strictEqual(v.ok, true, `${tok}: ${v.errors.join("; ")}`);
  }
});

test("validateClassification (the ticket/plan-contract carrier) also rejects an out-of-vocabulary token", () => {
  const v = CT.validateClassification({ change: "update", blast: "minor", risks: ["made-up-token"] });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /outside the controlled vocabulary/.test(e)), v.errors.join("; "));
});

test("a CSV risks string with one unknown token among known ones is still rejected", () => {
  const v = CT.validateClassification({ change: "update", blast: "minor", risks: "hooks,not-a-real-one" });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /outside the controlled vocabulary/.test(e) && /not-a-real-one/.test(e)), v.errors.join("; "));
});

test("widenClassification takes the MAX severity on change and blast, in either direction", () => {
  assert.deepStrictEqual(
    CT.widenClassification({ change: "bugfix", blast: "minor", risks: ["none"] }, { change: "release", blast: "major", risks: ["none"] }),
    { change: "release", blast: "major", risks: ["none"] },
    "b stricter than a -> b wins",
  );
  assert.deepStrictEqual(
    CT.widenClassification({ change: "release", blast: "major", risks: ["none"] }, { change: "bugfix", blast: "minor", risks: ["none"] }),
    { change: "release", blast: "major", risks: ["none"] },
    "a stricter than b -> a wins (never narrowed)",
  );
  assert.deepStrictEqual(
    CT.widenClassification({ change: "update", blast: "minor", risks: ["none"] }, { change: "update", blast: "minor", risks: ["none"] }),
    { change: "update", blast: "minor", risks: ["none"] },
    "equal on both sides -> unchanged",
  );
});

test("widenClassification UNIONs risks (minus 'none'), in either direction, deduplicated", () => {
  assert.deepStrictEqual(
    CT.widenClassification({ change: "bugfix", blast: "minor", risks: ["hooks"] }, { change: "bugfix", blast: "minor", risks: ["ci"] }).risks.sort(),
    ["ci", "hooks"],
  );
  assert.deepStrictEqual(
    CT.widenClassification({ change: "bugfix", blast: "minor", risks: ["ci"] }, { change: "bugfix", blast: "minor", risks: ["hooks"] }).risks.sort(),
    ["ci", "hooks"],
    "the union is symmetric",
  );
  assert.deepStrictEqual(
    CT.widenClassification({ change: "bugfix", blast: "minor", risks: ["hooks"] }, { change: "bugfix", blast: "minor", risks: ["hooks"] }).risks,
    ["hooks"],
    "duplicates collapse",
  );
  assert.deepStrictEqual(
    CT.widenClassification({ change: "bugfix", blast: "minor", risks: ["none"] }, { change: "bugfix", blast: "minor", risks: ["none"] }).risks,
    ["none"],
    "both 'none' -> stays 'none', never an empty array",
  );
});

test("validateClassification / validatePartial / aggregateClassification (ticket + plan-contract carriers)", () => {
  assert.strictEqual(CT.validateClassification({ change: "update", blast: "minor", risks: ["hooks"] }).ok, true);
  assert.strictEqual(CT.validateClassification({ change: "update", blast: "minor", risks: "hooks,ci" }).ok, true, "CSV accepted");
  assert.strictEqual(CT.validateClassification({ change: "x", blast: "minor", risks: ["hooks"] }).ok, false);
  assert.strictEqual(CT.validateClassification(null).ok, false);
  assert.deepStrictEqual(CT.validatePartial({ change: "release" }).value, { change: "release" });
  assert.strictEqual(CT.validatePartial({ blast: "nope" }).ok, false);
  assert.strictEqual(CT.validatePartial({}).ok, true);
  const agg = CT.aggregateClassification([
    { change: "bugfix", blast: "minor", risks: ["none"] },
    { change: "release", blast: "minor", risks: ["hooks"] },
    { risks: ["ci"], blast: "major" },
    {},
  ]);
  assert.deepStrictEqual(agg, { change: "release", blast: "major", risks: ["hooks", "ci"] });
  assert.strictEqual(CT.aggregateClassification([{}, { title: "x" }]), null);
});

test("activeSprint: live primary is active; closed primary, no registry and null primary are not", () => {
  const a = tmpDir("act-live");
  writeRegistry(a, { primary: "S-X-01", status: "planning" });
  assert.strictEqual(CT.activeSprint(a).active, true);
  const b = tmpDir("act-closed");
  writeRegistry(b, { primary: "S-X-01", status: "closed" });
  assert.strictEqual(CT.activeSprint(b).active, false);
  const c = tmpDir("act-none");
  assert.strictEqual(CT.activeSprint(c).active, false);
  const d = tmpDir("act-noprimary");
  writeRegistry(d, { primary: null });
  assert.strictEqual(CT.activeSprint(d).active, false);
  const e = tmpDir("act-current");
  fs.mkdirSync(path.join(e, ".claude", "project", "sprint"), { recursive: true });
  fs.writeFileSync(path.join(e, ".claude", "project", "sprint", "current-sprint.yaml"), "id: S-X-01\n");
  assert.strictEqual(CT.activeSprint(e).active, true, "no registry but a current-sprint file means active");
});

test("activeSprintAtRef prefers the BASE ref's registry over HEAD's (a same-commit edit at head is irrelevant)", () => {
  const registryAtBase = "schema: mc/sprint/active-sprints/v1\nprimary: S-X-01\nsprints:\n  - id: S-X-01\n    status: executing\n";
  const registryAtHead = "schema: mc/sprint/active-sprints/v1\nsprints: []\n";
  const readFn = (ref, rel) => {
    if (rel.includes("active-sprints.yaml")) return ref === "base-sha" ? registryAtBase : registryAtHead;
    return null;
  };
  const r = CT.activeSprintAtRef("/does/not/matter", { base: "base-sha", head: "head-sha", readFn });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.active, true, "must read BASE's still-active registry, not HEAD's closed one");
  assert.strictEqual(r.id, "S-X-01");
});

test("activeSprintAtRef REFUSES when no base is resolved — the candidate HEAD is never read in its place", () => {
  let readRefs = [];
  const readFn = (ref, rel) => {
    readRefs.push(ref);
    if (rel.includes("active-sprints.yaml")) return ["schema: mc/sprint/active-sprints/v1", "primary: S-X-999902", "sprints:", "  - id: S-X-999902", "    status: executing", ""].join(String.fromCharCode(10));
    return null;
  };
  const r = CT.activeSprintAtRef("/does/not/matter", { base: null, head: "head-sha", readFn });
  assert.strictEqual(r.ok, false, JSON.stringify(r));
  assert.strictEqual(r.active, false);
  assert.deepStrictEqual(readRefs, [], "HEAD must not be consulted");
});

test("gitShowAtRef refuses an option-shaped ref (leading '-') instead of letting git parse it as an option", () => {
  assert.strictEqual(CT.gitShowAtRef(process.cwd(), "--format=INJECTED", "package.json"), null);
  assert.strictEqual(CT.gitShowAtRef(process.cwd(), "", "package.json"), null);
});

test("activeSprintAtRef REFUSES (ok:false) when the registry is unreadable at every available ref — never 'not active'", () => {
  const readFn = () => null;
  const r1 = CT.activeSprintAtRef("/does/not/matter", { base: "base-sha", head: "head-sha", readFn });
  assert.strictEqual(r1.ok, false, JSON.stringify(r1));
  assert.strictEqual(r1.active, false, "ok:false must still carry active:false — callers key off `ok`, but this must never masquerade as a confident not-active");
  const r2 = CT.activeSprintAtRef("/does/not/matter", { base: null, head: null, readFn });
  assert.strictEqual(r2.ok, false, "no ref at all (neither base nor head) must also refuse");
});

test("activeSprintAtRef still finds a current-sprint marker at the ref when the registry itself is absent there", () => {
  const readFn = (ref, rel) => (rel.includes("current-sprint.yaml") ? "id: S-X-999903\n" : null);
  const r = CT.activeSprintAtRef("/does/not/matter", { base: "base-sha", head: "head-sha", readFn });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.active, true);
});

test("activeSprintAtRef resolves a closed/terminal primary at the chosen ref to active:false (not a refusal — the read succeeded)", () => {
  const readFn = (ref, rel) => (rel.includes("active-sprints.yaml") ? "schema: mc/sprint/active-sprints/v1\nprimary: S-X-999904\nsprints:\n  - id: S-X-999904\n    status: retrospected\n" : null);
  const r = CT.activeSprintAtRef("/does/not/matter", { base: "base-sha", readFn });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.active, false);
  assert.strictEqual(r.status, "retrospected");
});

test("CLI validate: trailer-less message is refused (exit 1) with the exact three lines; trailer passes (exit 0)", () => {
  const root = tmpDir("cli-validate");
  writeRegistry(root, { primary: "S-X-01", status: "planning" });
  const bad = path.join(root, "bad.txt");
  const good = path.join(root, "good.txt");
  fs.writeFileSync(bad, "x\n");
  fs.writeFileSync(good, fixture("minor-bugfix"));
  const r1 = runCli(["validate", "--file", bad, "--if-sprint-active", "--root", root], { cwd: root });
  assert.strictEqual(r1.status, 1);
  for (const l of CT.FIX_LINES) assert.ok(r1.stderr.includes(l), `stderr names ${l}`);
  const r2 = runCli(["validate", "--file", good, "--if-sprint-active", "--root", root], { cwd: root });
  assert.strictEqual(r2.status, 0, r2.stderr);
});

test("CLI validate --hook: a block is exit 3 (the only code the commit-msg hook blocks on)", () => {
  const root = tmpDir("cli-hook");
  writeRegistry(root, { primary: "S-X-01", status: "planning" });
  const bad = path.join(root, "bad.txt");
  fs.writeFileSync(bad, "x\n");
  const r = runCli(["validate", "--file", bad, "--if-sprint-active", "--hook", "--root", root], { cwd: root });
  assert.strictEqual(r.status, CT.HOOK_BLOCK_EXIT);
  assert.strictEqual(CT.HOOK_BLOCK_EXIT, 3);
});

test("CLI validate --if-sprint-active: no live sprint means never enforced", () => {
  const root = tmpDir("cli-nosprint");
  writeRegistry(root, { primary: "S-X-01", status: "closed" });
  const bad = path.join(root, "bad.txt");
  fs.writeFileSync(bad, "x\n");
  assert.strictEqual(runCli(["validate", "--file", bad, "--if-sprint-active", "--root", root], { cwd: root }).status, 0);
});

test("CLI validate: kill switch off is a no-op, report demotes to report-only AND is logged", () => {
  const root = tmpDir("cli-modes");
  writeRegistry(root, { primary: "S-X-01", status: "planning" });
  const bad = path.join(root, "bad.txt");
  fs.writeFileSync(bad, "x\n");
  const args = ["validate", "--file", bad, "--if-sprint-active", "--root", root];
  assert.strictEqual(runCli(args, { cwd: root }).status, 1, "RED: enforced without a switch");
  const off = runCli(args, { cwd: root, env: MCENV.envPair("CHANGE_TRAILER", "off") });
  assert.strictEqual(off.status, 0);
  assert.strictEqual(off.stderr, "", "off is silent");
  const rep = runCli(args, { cwd: root, env: MCENV.envPair("CHANGE_TRAILER", "report") });
  assert.strictEqual(rep.status, 0, "report never blocks");
  assert.ok(/report-only/.test(rep.stderr), "report still tells the committer what is wrong");
  const kinds = kindsOf(readEvents(root));
  assert.ok(kinds.includes("change-trailer-report-only"), `report-only is logged (saw ${kinds.join(",") || "nothing"})`);
  assert.ok(kinds.includes("change-trailer-bypass"), "off is logged as a bypass");
});

test("a subject that merely LOOKS like a merge, with NO real merge (no MERGE_HEAD) in progress, is NEVER exempt — --git-generated-ok is not a subject-text bypass", () => {
  const root = tmpDir("cli-merge");
  writeRegistry(root, { primary: "S-X-01", status: "planning" });
  const f = path.join(root, "m.txt");
  fs.writeFileSync(f, "Merge branch 'x' into y\n");
  assert.strictEqual(runCli(["validate", "--file", f, "--if-sprint-active", "--git-generated-ok", "--root", root], { cwd: root }).status, 1);
  assert.strictEqual(runCli(["validate", "--file", f, "--if-sprint-active", "--root", root], { cwd: root }).status, 1);
});

test("validateMergeGenerated — no MERGE_HEAD (nothing to inherit) is the skip", () => {
  const r = CT.validateMergeGenerated("/does/not/matter", { readMergeHead: () => null });
  assert.deepStrictEqual(r, { ok: true, inherited: false });
});

test("validateMergeGenerated — a MERGE_HEAD whose own trailer is VALID inherits it (ok:true, inherited:true)", () => {
  const r = CT.validateMergeGenerated("/does/not/matter", { readMergeHead: () => "feature work\n\nChange: update\nBlast: minor\nRisks: hooks\n" });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.inherited, true);
  assert.deepStrictEqual(r.value, { change: "update", blast: "minor", risks: ["hooks"] });
});

test("validateMergeGenerated — a MERGE_HEAD whose own trailer is INVALID/missing BLOCKS (never a silent bypass)", () => {
  const r = CT.validateMergeGenerated("/does/not/matter", { readMergeHead: () => "feature work, no trailer at all\n" });
  assert.strictEqual(r.ok, false, JSON.stringify(r));
  assert.strictEqual(r.inherited, true);
  assert.ok(r.errors.length > 0);
});

test("CLI end-to-end: a real merge commit inherits the merged branch's VALID trailer and passes", () => {
  const root = tmpDir("cli-merge-real");
  writeRegistry(root, { primary: "S-X-01", status: "planning" });
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "T"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "base"]);
  git(root, ["checkout", "-q", "-b", "feature"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", `feature work\n\nChange: update\nBlast: minor\nRisks: hooks\n`]);
  git(root, ["checkout", "-q", "-"]);
  const merge = git(root, ["merge", "--no-ff", "--no-commit", "feature"]);
  assert.strictEqual(merge.status, 0, merge.stderr);
  const mergeMsgFile = path.join(root, ".git", "MERGE_MSG");
  const mergeMsg = fs.existsSync(mergeMsgFile) ? fs.readFileSync(mergeMsgFile, "utf8") : "Merge branch 'feature'\n";
  const f = path.join(root, "m.txt");
  fs.writeFileSync(f, mergeMsg);
  const res = runCli(["validate", "--file", f, "--if-sprint-active", "--git-generated-ok", "--root", root], { cwd: root });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
});

test("CLI end-to-end: a real merge commit whose merged tip carries NO trailer is BLOCKED, not bypassed", () => {
  const root = tmpDir("cli-merge-notrailer");
  writeRegistry(root, { primary: "S-X-01", status: "planning" });
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "T"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "base"]);
  git(root, ["checkout", "-q", "-b", "feature"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "feature work, no trailer"]);
  git(root, ["checkout", "-q", "-"]);
  const merge = git(root, ["merge", "--no-ff", "--no-commit", "feature"]);
  assert.strictEqual(merge.status, 0, merge.stderr);
  const f = path.join(root, "m.txt");
  fs.writeFileSync(f, "Merge branch 'feature'\n");
  const res = runCli(["validate", "--file", f, "--if-sprint-active", "--git-generated-ok", "--root", root], { cwd: root });
  assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
});

test("CLI: usage errors exit 2 (callers fail open on 2)", () => {
  assert.strictEqual(runCli(["nonsense"]).status, 2);
  assert.strictEqual(runCli(["validate"]).status, 2);
  assert.strictEqual(runCli(["validate", "--file", path.join(os.tmpdir(), "definitely-missing-ct.txt")]).status, 2);
});

function writeTicket(root, id, sprint, cls) {
  const dir = path.join(root, ".claude", "project", "sprint", "tickets");
  fs.mkdirSync(dir, { recursive: true });
  const lines = ["schema: mc/sprint/ticket/v1", `id: ${id}`, `sprint: ${sprint}`];
  if (cls.change) lines.push(`change: ${cls.change}`);
  if (cls.blast) lines.push(`blast: ${cls.blast}`);
  if (cls.risks) {
    lines.push("risks:");
    for (const r of cls.risks) lines.push(`  - ${r}`);
  }
  fs.writeFileSync(path.join(dir, `${id}.yaml`), lines.join("\n") + "\n");
}

function commitMsg(c, b, r) {
  return `subject\n\nChange: ${c}\nBlast: ${b}\nRisks: ${r}\n`;
}

test("reconcile blocks ticket-major / commit-minor", () => {
  const root = tmpDir("rec-down");
  writeTicket(root, "T-99999999-001", "S-X-01", { change: "update", blast: "major", risks: ["hooks"] });
  const logged = [];
  const r = CT.reconcile({ sprint: "S-X-01", root, headMessageFn: () => commitMsg("update", "minor", "hooks"), log: (k, d) => logged.push([k, d]) });
  assert.strictEqual(r.exit, 1);
  assert.strictEqual(r.status, "downgrade-blocked");
  assert.ok(/blast major -> minor/.test(r.lines.join("\n")));
  assert.strictEqual(logged[0][0], "change-trailer-downgrade-blocked");
});

test("reconcile also blocks a change downgrade (release ticket, bugfix commit)", () => {
  const root = tmpDir("rec-down-change");
  writeTicket(root, "T-99999999-001", "S-X-01", { change: "release", blast: "minor", risks: ["none"] });
  const r = CT.reconcile({ sprint: "S-X-01", root, headMessageFn: () => commitMsg("bugfix", "minor", "none"), log: () => {} });
  assert.strictEqual(r.exit, 1);
});

test("reconcile ALLOWS the reverse (ticket-minor / commit-major) and logs a line", () => {
  const root = tmpDir("rec-up");
  writeTicket(root, "T-99999999-001", "S-X-01", { change: "update", blast: "minor", risks: ["none"] });
  const logged = [];
  const r = CT.reconcile({ sprint: "S-X-01", root, headMessageFn: () => commitMsg("update", "major", "hooks"), log: (k, d) => logged.push([k, d]) });
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.status, "upgrade-allowed");
  assert.ok(/upgrade allowed \(blast minor -> major\); logged/.test(r.lines.join("\n")), "the log line is printed");
  assert.strictEqual(logged[0][0], "change-trailer-upgrade", "and the audit event is emitted");
});

test("reconcile: aggregates tickets (max change, any-major blast), match is exit 0, dropped risks only noted", () => {
  const root = tmpDir("rec-agg");
  writeTicket(root, "T-99999999-001", "S-X-01", { change: "bugfix", blast: "minor", risks: ["none"] });
  writeTicket(root, "T-99999999-002", "S-X-01", { change: "update", blast: "major", risks: ["hooks", "ci"] });
  writeTicket(root, "T-99999999-003", "S-OTHER", { change: "release", blast: "major", risks: ["security"] });
  const r = CT.reconcile({ sprint: "S-X-01", root, headMessageFn: () => commitMsg("update", "major", "hooks"), log: () => {} });
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.status, "match");
  assert.ok(/ticket risks not named in the commit: ci/.test(r.lines.join("\n")));
});

test("reconcile: no ticket carries a classification -> skipped (exit 0); invalid HEAD trailer -> exit 1", () => {
  const root = tmpDir("rec-skip");
  writeTicket(root, "T-99999999-001", "S-X-01", {});
  const skip = CT.reconcile({ sprint: "S-X-01", root, headMessageFn: () => "x\n", log: () => {} });
  assert.strictEqual(skip.exit, 0);
  assert.strictEqual(skip.status, "skipped-no-ticket-classification");
  writeTicket(root, "T-99999999-002", "S-X-01", { change: "update", blast: "minor", risks: ["none"] });
  const bad = CT.reconcile({ sprint: "S-X-01", root, headMessageFn: () => "x\n", log: () => {} });
  assert.strictEqual(bad.exit, 1);
  assert.strictEqual(bad.status, "commit-trailer-invalid");
});

test("reconcile CLI against a real git HEAD (downgrade exit 1, upgrade exit 0 + log line + event)", () => {
  const root = tmpDir("rec-cli");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "T"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  writeTicket(root, "T-99999999-001", "S-X-01", { change: "update", blast: "major", risks: ["hooks"] });
  git(root, ["commit", "-q", "--allow-empty", "-m", commitMsg("update", "minor", "hooks")]);
  const down = runCli(["reconcile", "--sprint", "S-X-01", "--root", root], { cwd: root });
  assert.strictEqual(down.status, 1, down.stdout + down.stderr);
  assert.ok(/BLOCK downgrade/.test(down.stdout));
  git(root, ["commit", "-q", "--allow-empty", "-m", commitMsg("release", "major", "hooks")]);
  const up = runCli(["reconcile", "--sprint", "S-X-01", "--root", root], { cwd: root });
  assert.strictEqual(up.status, 0, up.stdout + up.stderr);
  assert.ok(/upgrade allowed/.test(up.stdout));
  assert.ok(kindsOf(readEvents(root)).includes("change-trailer-upgrade"));
});

function extractCommitMsgHook() {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "install-git-hooks.sh"), "utf8");
  const blocks = [...src.matchAll(/<<'HOOK'\n([\s\S]*?)\nHOOK/g)].map((m) => m[1]);
  const hook = blocks.find((b) => b.includes("alex-change-trailer-commit-msg"));
  assert.ok(hook, "install-git-hooks.sh generates a commit-msg hook");
  return hook + "\n";
}

function makeHookRepo({ live }) {
  const root = tmpDir("hook");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "T"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  fs.mkdirSync(path.join(root, "scripts", "checks"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts", "hooks", "lib"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "checks", "change-trailer.js"), path.join(root, "scripts", "checks", "change-trailer.js"));
  for (const f of ["mc-env.js", "split-brain-core.js"]) fs.copyFileSync(path.join(ROOT, "scripts", "hooks", "lib", f), path.join(root, "scripts", "hooks", "lib", f));
  writeRegistry(root, { primary: live ? "S-X-01" : "S-X-01", status: live ? "planning" : "closed" });
  fs.writeFileSync(path.join(root, ".git", "hooks", "commit-msg"), extractCommitMsgHook(), { mode: 0o755 });
  return root;
}

function gitCommit(root, msg, env) {
  const e = { ...process.env };
  MCENV.unsetEnv("CHANGE_TRAILER", e);
  Object.assign(e, env || {});
  const r = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", msg], { cwd: root, env: e, encoding: "utf8", windowsHide: true, timeout: 60000 });
  return { status: r.status, stderr: r.stderr || "", stdout: r.stdout || "" };
}

test("commit-msg hook: a trailer-less commit under an active sprint is blocked with the three lines; a trailered commit lands", () => {
  const root = makeHookRepo({ live: true });
  const bad = gitCommit(root, "no trailer here");
  assert.notStrictEqual(bad.status, 0, "RED: blocked");
  for (const l of CT.FIX_LINES) assert.ok(bad.stderr.includes(l), `stderr names ${l}: ${bad.stderr}`);
  const good = gitCommit(root, fixture("minor-bugfix"));
  assert.strictEqual(good.status, 0, `GREEN: ${good.stderr}`);
});

test("commit-msg hook: --amend --no-edit on a trailered HEAD passes (at the git seam)", () => {
  const root = makeHookRepo({ live: true });
  assert.strictEqual(gitCommit(root, fixture("minor-bugfix")).status, 0);
  const r = spawnSync("git", ["commit", "-q", "--allow-empty", "--amend", "--no-edit"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000 });
  assert.strictEqual(r.status, 0, r.stderr);
});

test("commit-msg hook: no live sprint and kill switch off are not blocked; a single-parent commit merely TITLED like a merge IS blocked", () => {
  const closed = makeHookRepo({ live: false });
  assert.strictEqual(gitCommit(closed, "no trailer, no live sprint").status, 0);
  const live = makeHookRepo({ live: true });
  assert.strictEqual(gitCommit(live, "no trailer", MCENV.envPair("CHANGE_TRAILER", "off")).status, 0);
  assert.notStrictEqual(gitCommit(live, "Merge branch 'x' into main").status, 0, "a single-parent commit titled 'Merge branch x' without a trailer must be BLOCKED");
});

test("commit-msg hook — a crashing validator fails CLOSED (blocks the commit)", () => {
  const root = makeHookRepo({ live: true });
  fs.writeFileSync(path.join(root, "scripts", "checks", "change-trailer.js"), 'throw new Error("boom");\n');
  const r = gitCommit(root, "no trailer");
  assert.notStrictEqual(r.status, 0, "a validator crash must BLOCK the commit, not let it through");
  assert.ok(/BLOCKING/.test(r.stderr), r.stderr);
});

test("commit-msg hook — a SyntaxError in the validator (half-merged file) fails CLOSED too", () => {
  const root = makeHookRepo({ live: true });
  fs.writeFileSync(path.join(root, "scripts", "checks", "change-trailer.js"), "<<<<<<< HEAD\nconst x = ;\n");
  assert.notStrictEqual(gitCommit(root, "no trailer").status, 0, "a SyntaxError must also fail closed");
});

test("commit-msg hook: a pre-trailer checkout (validator script absent) is skipped, not strangled", () => {
  const root = makeHookRepo({ live: true });
  fs.rmSync(path.join(root, "scripts", "checks", "change-trailer.js"));
  assert.strictEqual(gitCommit(root, "no trailer").status, 0);
});

test("schemas: ticket.schema.json carries change/blast/risks; plan-contract carries change_classification", () => {
  const ticket = JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "sprint", "ticket.schema.json"), "utf8"));
  assert.deepStrictEqual(ticket.properties.change.enum, ["bugfix", "update", "release", null]);
  assert.deepStrictEqual(ticket.properties.blast.enum, ["minor", "major", null]);
  assert.strictEqual(ticket.properties.risks.type, "array");
  assert.ok(!ticket.required.includes("change"), "additive: not required on existing tickets");
  const pc = JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "sprint", "plan-contract.schema.json"), "utf8"));
  const cc = pc.properties.change_classification;
  assert.ok(cc, "plan-contract has change_classification");
  assert.deepStrictEqual(cc.required, ["change", "blast", "risks"]);
  assert.ok(!pc.required.includes("change_classification"), "additive: not required on existing contracts");
  assert.deepStrictEqual(cc.properties.change.enum, CT.CHANGE_VALUES);
  assert.deepStrictEqual(cc.properties.blast.enum, CT.BLAST_VALUES);
});

test("ticket.js: --change/--blast/--risks are validated by the shared validator (invalid values exit 2, nothing written)", () => {
  const root = tmpDir("ticket");
  const sprintDir = path.join(root, ".claude", "project", "sprint");
  fs.mkdirSync(path.join(sprintDir, "sprints", "S-X-01"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(sprintDir, "active-sprints.yaml"), "schema: mc/sprint/active-sprints/v1\nprimary: S-X-01\nsprints:\n  - id: S-X-01\n    status: planning\n    layout: per_sprint_subdir\n    pointer: .claude/project/sprint/sprints/S-X-01\n");
  fs.writeFileSync(path.join(sprintDir, "sprints", "S-X-01", "current.yaml"), "schema: mc/sprint/current-sprint/v1\nid: S-X-01\nsource_request: r\nplan_contract: pc\ntickets:\n  proposed: []\n");
  const TICKET = path.join(ROOT, "scripts", "sprint", "ticket.js");
  const run = (args) => {
    const e = { ...process.env, CLAUDE_PROJECT_DIR: root };
    return spawnSync(process.execPath, [TICKET, ...args], { cwd: root, env: e, encoding: "utf8", windowsHide: true, timeout: 30000 });
  };
  const bad = run(["create", "--title", "t", "--type", "chore", "--change", "feature"]);
  assert.strictEqual(bad.status, 2, bad.stdout + bad.stderr);
  assert.ok(/invalid Change "feature"/.test(bad.stderr));
  const bare = run(["create", "--title", "t", "--type", "chore", "--blast"]);
  assert.strictEqual(bare.status, 2);
  const ok = run(["create", "--title", "t", "--type", "chore", "--change", "update", "--blast", "major", "--risks", "hooks,ci"]);
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  const dir = path.join(sprintDir, "tickets");
  const files = fs.readdirSync(dir);
  assert.strictEqual(files.length, 1, "only the valid create wrote a ticket");
  const text = fs.readFileSync(path.join(dir, files[0]), "utf8");
  assert.ok(/^change: update$/m.test(text) && /^blast: major$/m.test(text), text);
  assert.ok(/risks:\n\s+- hooks\n\s+- ci/.test(text), text);
  const upd = run(["update", "--id", files[0].replace(/\.yaml$/, ""), "--risks", "none"]);
  assert.strictEqual(upd.status, 0, upd.stdout + upd.stderr);
  assert.ok(/risks:\n\s+- none/.test(fs.readFileSync(path.join(dir, files[0]), "utf8")));
});
