#!/usr/bin/env node
/**
 * scripts/checks/readme-drift.js — README fact lines must match the tree (S-OS-04).
 *
 * CONTRACT: README.md carries three lines, anywhere, exactly of the form
 *
 *   **Version:** <package.json version>
 *   **Skills:** <N> slash commands
 *   **Hooks:** <N> automated hooks
 *
 * Expected values:
 *   version ↔ package.json `version`
 *   skills  ↔ number of git-TRACKED `.claude/commands/**\/*.md` files
 *   hooks   ↔ number of hook entries in .claude/settings.json
 *              (sum over every event of every group's hooks[].length)
 *
 * Usage:
 *   node scripts/checks/readme-drift.js [--readme <file>] [--root <dir>] [--json]
 *        [--expect-version v] [--expect-skills n] [--expect-hooks n]   (test seams)
 *
 * Exit codes:
 *   0  every line present and equal to the expected value
 *   1  a line is missing or drifted (prints expected vs found)
 *   2  fail-closed: README / package.json / settings.json unreadable, git failed
 *
 * Enforcer of its own contract: scripts/checks/readme-drift.test.js (fixture READMEs
 * for pass + fail + missing-line, and the expected-value derivations).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const LINE_RES = {
  version: /^\*\*Version:\*\* (\S+)\s*$/m,
  skills: /^\*\*Skills:\*\* (\d+) slash commands\s*$/m,
  hooks: /^\*\*Hooks:\*\* (\d+) automated hooks\s*$/m,
};

function parseReadme(text) {
  const found = {};
  for (const [k, re] of Object.entries(LINE_RES)) {
    const m = String(text).match(re);
    found[k] = m ? (k === "version" ? m[1] : Number(m[1])) : null;
  }
  return found;
}

function countHooks(settings) {
  let n = 0;
  const hooks = (settings && settings.hooks) || {};
  for (const ev of Object.keys(hooks)) {
    for (const group of hooks[ev] || []) n += ((group && group.hooks) || []).length;
  }
  return n;
}

function countTrackedSkills(root) {
  const out = execSync("git ls-files -- .claude/commands", {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((f) => f && f.endsWith(".md")).length;
}

function expectedFromTree(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const settings = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"));
  return { version: String(pkg.version), skills: countTrackedSkills(root), hooks: countHooks(settings) };
}

// Pure core: compare found vs expected → { ok, problems[] }
function evaluate(found, expected) {
  const problems = [];
  for (const k of ["version", "skills", "hooks"]) {
    if (found[k] === null || found[k] === undefined) {
      problems.push({ field: k, expected: expected[k], found: null, kind: "missing" });
    } else if (String(found[k]) !== String(expected[k])) {
      problems.push({ field: k, expected: expected[k], found: found[k], kind: "drift" });
    }
  }
  return { ok: problems.length === 0, problems };
}

function parseArgs(argv) {
  const o = { readme: null, root: null, json: false, expect: {}, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--readme") o.readme = argv[++i];
    else if (a === "--root") o.root = argv[++i];
    else if (a === "--json") o.json = true;
    else if (a === "--expect-version") o.expect.version = argv[++i];
    else if (a === "--expect-skills") o.expect.skills = Number(argv[++i]);
    else if (a === "--expect-hooks") o.expect.hooks = Number(argv[++i]);
    else if (a === "--help" || a === "-h") o.help = true;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    process.stdout.write("usage: readme-drift.js [--readme file] [--root dir] [--json] [--expect-version v] [--expect-skills n] [--expect-hooks n]\n");
    return 0;
  }
  const root = path.resolve(o.root || process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", ".."));
  const readme = o.readme ? path.resolve(o.readme) : path.join(root, "README.md");

  let text;
  try {
    text = fs.readFileSync(readme, "utf8");
  } catch (e) {
    process.stderr.write(`FAIL [readme-drift] README unreadable: ${readme} (${e.message})\n`);
    return 2;
  }
  let expected;
  try {
    const fromTree = Object.keys(o.expect).length === 3 ? {} : expectedFromTree(root);
    expected = { ...fromTree, ...o.expect };
  } catch (e) {
    process.stderr.write(`FAIL [readme-drift] could not derive expected values from the tree: ${e.message}\n`);
    return 2;
  }
  const found = parseReadme(text);
  const r = evaluate(found, expected);
  if (o.json) {
    process.stdout.write(JSON.stringify({ ok: r.ok, readme, expected, found, problems: r.problems }, null, 2) + "\n");
  } else if (r.ok) {
    process.stdout.write(`OK   [readme-drift] ${path.basename(readme)}: version ${expected.version} · ${expected.skills} slash commands · ${expected.hooks} automated hooks\n`);
  } else {
    process.stderr.write(`FAIL [readme-drift] ${readme} — ${r.problems.length} problem(s):\n`);
    for (const p of r.problems) {
      const label = p.field === "version" ? "**Version:**" : p.field === "skills" ? "**Skills:**" : "**Hooks:**";
      process.stderr.write(`  - ${p.field}: expected ${JSON.stringify(p.expected)}, found ${p.kind === "missing" ? "MISSING line" : JSON.stringify(p.found)}  (line form: ${label} …)\n`);
    }
    process.stderr.write("\nFix: update the three fact lines in README.md to the values above (they are derived from package.json, the tracked .claude/commands tree, and .claude/settings.json).\n");
  }
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { LINE_RES, parseReadme, countHooks, countTrackedSkills, expectedFromTree, evaluate };
