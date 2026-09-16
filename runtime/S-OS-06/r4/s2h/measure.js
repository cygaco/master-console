// s2h measurement harness. Runs the three target tests in a given checkout under
// two CONTROLLED host environments and prints the environment with every number.
//   HOST-AS-IS : this machine's env unchanged (codex+agy on PATH, ~/.codex + ~/.gemini auth present)
//   BARE-HOST  : PATH = node dir + System32 + Windows only; HOME/USERPROFILE = an empty temp dir
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const W = path.resolve(process.argv[2]);
const LABEL = process.argv[3] || "";
const nodeDir = path.dirname(process.execPath);
const sys = process.env.SystemRoot || "C:\\Windows";
const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "s2h-emptyhome-"));
function env(kind) {
  const e = { ...process.env };
  if (kind === "BARE-HOST") {
    for (const k of Object.keys(e)) if (k.toLowerCase() === "path") delete e[k];
    e.PATH = [nodeDir, path.join(sys, "System32"), sys].join(path.delimiter);
    e.USERPROFILE = emptyHome; e.HOME = emptyHome;
  }
  return e;
}
function git(args) {
  const r = spawnSync("git", ["-C", W, ...args], { encoding: "utf8" });
  return (r.stdout || "").trim();
}
const TESTS = [
  "tests/regression/SP-20260615-001/roadmap-board-failsoft.test.js",
  "tests/regression/SP-20260615-001/roadmap-board-render.test.js",
  "tests/regression/S-LC-10/provider-tier-check.test.js",
];
const mem = path.join(W, ".claude", "project", "memory");
console.log(`=== ${LABEL}`);
console.log(`checkout=${W}`);
console.log(`HEAD=${git(["rev-parse", "--short", "HEAD"])}  untracked+ignored entries=${git(["status", "--short", "--ignored"]).split(/\n/).filter(Boolean).length}`);
console.log(`registers dir present=${fs.existsSync(mem)}  enforcement-debt.jsonl=${fs.existsSync(path.join(mem, "enforcement-debt.jsonl"))}  recurring-issues.jsonl=${fs.existsSync(path.join(mem, "recurring-issues.jsonl"))}`);
console.log(`node=${process.version} platform=${process.platform} reporter=direct-run (node <file>)`);
for (const kind of ["HOST-AS-IS", "BARE-HOST"]) {
  const e = env(kind);
  const probe = (cli) => spawnSync(cli + " --version", { shell: true, env: e, encoding: "utf8", timeout: 15000 }).status === 0;
  const home = kind === "BARE-HOST" ? emptyHome : os.homedir();
  console.log(`\n--- ${kind}: codex-on-PATH=${probe("codex")} agy-on-PATH=${probe("agy")} ~/.codex/auth.json=${fs.existsSync(path.join(home, ".codex", "auth.json"))} ~/.gemini/oauth_creds.json=${fs.existsSync(path.join(home, ".gemini", "oauth_creds.json"))}`);
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [path.join(W, t)], { cwd: W, env: e, encoding: "utf8", timeout: 180000 });
    const lines = (r.stdout || "").split(/\r?\n/);
    const tally = lines.filter((l) => /pass$|passed, \d+ failed/.test(l)).join(" ");
    const fails = lines.filter((l) => /^FAIL/.test(l)).map((l) => "    " + l.trim());
    console.log(`  exit=${r.status}  ${tally}  [${t}]`);
    if (fails.length) console.log(fails.join("\n"));
  }
}
