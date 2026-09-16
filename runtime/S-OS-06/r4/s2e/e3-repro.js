// E3 controlled reproduction: same node, same OS, same code. Vary ONLY the host's
// provider state (codex/agy CLIs on PATH + ~/.codex, ~/.gemini auth files via homedir).
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const W = process.argv[2];
const TEST = path.join(W, "tests", "regression", "S-LC-10", "provider-tier-check.test.js");
const ENGINE = path.join(W, "scripts", "mc", "provider-tier-check.js");
const nodeDir = path.dirname(process.execPath);
const sys = process.env.SystemRoot || "C:\Windows";
const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "s2e-emptyhome-"));
function env(kind) {
  const e = { ...process.env };
  if (kind === "path-stripped" || kind === "both") {
    e.PATH = [nodeDir, path.join(sys, "System32"), sys].join(path.delimiter);
    if (e.Path) delete e.Path;
  }
  if (kind === "home-empty" || kind === "both") {
    e.USERPROFILE = emptyHome; e.HOME = emptyHome;
  }
  return e;
}
const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "s2e-cfg-"));
const cp = path.join(cfgDir, "cfg.json");
fs.writeFileSync(cp, JSON.stringify({ version: 1, t3_floor: "max_5x", providers: { claude: { selected_tier: "t3" } } }));
console.log(`node ${process.version} ${process.platform} worktree=${W}`);
for (const kind of ["host-as-is", "path-stripped", "home-empty", "both"]) {
  const e = env(kind);
  const eng = spawnSync(process.execPath, [ENGINE, "--json", "--enforce", "--config-path", cp], { cwd: W, encoding: "utf8", env: { ...e, ANTHROPIC_API_KEY: "fixture-value" } });
  let rows = "(unparseable)";
  try { const r = JSON.parse(eng.stdout); rows = r.verdict_summary + " | " + r.providers.map(p => `${p.provider}:t1=${p.t1_met}/${p.auth_tier}/sel=${p.selected_tier}/${p.verdict}`).join(" "); } catch {}
  const t = spawnSync(process.execPath, [TEST], { cwd: W, encoding: "utf8", env: e });
  const failLines = (t.stdout || "").split(/\r?\n/).filter(l => /^FAIL|passed, .* failed/.test(l));
  console.log(`\n--- ${kind}\n  engine --enforce exit=${eng.status}  ${rows}\n  test exit=${t.status}  ${failLines.join(" || ")}`);
}
