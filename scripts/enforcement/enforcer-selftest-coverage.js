#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const NAME = "enforcer-selftest-coverage";
const ENFORCER_DIRS = [path.join(REPO, "scripts", "checks"), path.join(REPO, "scripts", "enforcement")];

const CLI_MAIN_RE = /require\.main\s*===\s*module/;
const PLANTED_RE = /(planted|->\s*(?:RED|red|fail|FAIL|finding|1\b)|\bRED\b|must fail|findings\.length|hard\.length|\.length,\s*[1-9]|violation|exit(?:Code)?\s*[:=]?\s*1|not[^\r\n]{0,160}clean)/;
const MAX_TEST_SCAN = 256 * 1024;

function evaluate({ items }) {
  const hard = [];
  const soft = [];
  let enforcerCount = 0;
  for (const it of items || []) {
    if (!it.isEnforcer) continue;
    enforcerCount++;
    if (!it.hasTest) {
      hard.push({ enforcer: it.rel, reason: `enforcer ${it.rel} has NO sibling self-test (${it.rel.replace(/\.(js|cjs|mjs)$/, ".test.$1")}) — requires a sealed known-answer test.` });
      continue;
    }
    if (!PLANTED_RE.test(String(it.testText || "").slice(0, MAX_TEST_SCAN))) {
      soft.push({ enforcer: it.rel, reason: `enforcer ${it.rel} has a sibling test but no detectable PLANTED-VIOLATION (failing-case) assertion — verify it has a known-answer negative case.` });
    }
  }
  return { hard, soft, enforcerCount };
}

function gatherItems(io = fs) {
  const items = [];
  const errors = [];
  let dirsSeen = 0;
  for (const dir of ENFORCER_DIRS) {
    let entries;
    try { entries = io.readdirSync(dir); dirsSeen++; }
    catch (e) { errors.push({ path: dir, error: (e && e.message) || "readdir failed" }); continue; }
    for (const n of entries) {
      if (!/\.(js|cjs|mjs)$/.test(n)) continue;
      if (/\.test\.(js|cjs|mjs)$/.test(n) || /^test-/.test(n)) continue;
      const full = path.join(dir, n);
      let content;
      try {
        const st = io.statSync(full);
        if (!st.isFile()) continue;
        content = io.readFileSync(full, "utf8");
      } catch (e) {
        if (e && e.code === "ENOENT") continue;
        errors.push({ path: full, error: (e && e.message) || "read failed" });
        continue;
      }
      const isEnforcer = CLI_MAIN_RE.test(content);
      const rel = path.relative(REPO, full).replace(/\\/g, "/");
      const testCandidates = [full.replace(/\.(js|cjs|mjs)$/, ".test.$1"), path.join(dir, `test-${n}`)];
      let hasTest = false, testText = "";
      for (const tf of testCandidates) {
        try { testText += (testText ? "\n" : "") + io.readFileSync(tf, "utf8"); hasTest = true; }
        catch (e) { if (e && e.code !== "ENOENT") errors.push({ path: tf, error: (e && e.message) || "test read failed" }); }
      }
      items.push({ rel, isEnforcer, hasTest, testText });
    }
  }
  return { items, errors, dirsSeen, dirsRequired: ENFORCER_DIRS.length };
}

function main(argv) {
  const jsonOut = argv.includes("--json");
  const enforce = argv.includes("--enforce");
  const { items, errors, dirsSeen, dirsRequired } = gatherItems();
  if (dirsSeen < dirsRequired || errors.length) {
    const all = [...(dirsSeen < dirsRequired ? [{ path: "(required enforcer dir)", error: `${dirsRequired - dirsSeen} of ${dirsRequired} dirs unreadable` }] : []), ...errors];
    if (jsonOut) process.stdout.write(JSON.stringify({ name: NAME, status: "error", reason: "unreadable enforcer dir/source (fail-closed)", errors: all }) + "\n");
    else {
      process.stderr.write(`ERROR [${NAME}] ${all.length} unreadable enforcer dir/source(s) (fail-closed):\n`);
      for (const er of all) process.stderr.write(`     - ${er.path}: ${er.error}\n`);
    }
    return 2;
  }
  const { hard, soft, enforcerCount } = evaluate({ items });
  const blocking = enforce && hard.length > 0;
  const out = { name: NAME, status: blocking ? "red" : "green", enforced: enforce, enforcerCount, hardFindings: hard, softAdvisories: soft };
  if (jsonOut) {
    process.stdout.write(JSON.stringify(out) + "\n");
  } else {
    if (hard.length) {
      process.stderr.write(`${blocking ? "FAIL" : "WARN"} [${NAME}] ${hard.length}/${enforcerCount} enforcer(s) with NO self-test:\n`);
      for (const f of hard) process.stderr.write(`     - ${f.enforcer}\n`);
    }
    if (soft.length) {
      process.stderr.write(`INFO [${NAME}] ${soft.length} enforcer test(s) with no detectable planted-violation case (advisory):\n`);
      for (const f of soft.slice(0, 30)) process.stderr.write(`     - ${f.enforcer}\n`);
      if (soft.length > 30) process.stderr.write(`     … +${soft.length - 30} more\n`);
    }
    if (!hard.length && !soft.length) process.stdout.write(`OK   [${NAME}] all ${enforcerCount} enforcer(s) ship a self-test with a planted-violation case\n`);
  }
  return blocking ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, gatherItems, NAME };
