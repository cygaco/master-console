// s2h H2 mechanism probe. Does the DIFFERENTIAL form (two --enforce runs whose configs
// differ ONLY in claude's selected tier; assert equal exit codes) detect the regression
// "unknown-self-attested trips the gate" in every host environment?
//   usage: node diff-probe.js <checkout> <label>
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const W = path.resolve(process.argv[2]);
const LABEL = process.argv[3] || "";
const ENGINE = path.join(W, "scripts", "mc", "provider-tier-check.js");
const nodeDir = path.dirname(process.execPath);
const sys = process.env.SystemRoot || "C:\\Windows";
const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "s2h-emptyhome-"));

// STUBBED-HOST (evidence for the conductor only — NOT adopted): bare host + a PATH dir of
// `codex`/`agy` shims that exit 0 + a temp home carrying presence-only auth files.
const stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "s2h-stubbin-"));
for (const cli of ["codex", "agy"]) fs.writeFileSync(path.join(stubBin, cli + ".cmd"), "@echo stub-0.0.0\r\n@exit /b 0\r\n");
const stubHome = fs.mkdtempSync(path.join(os.tmpdir(), "s2h-stubhome-"));
fs.mkdirSync(path.join(stubHome, ".codex")); fs.writeFileSync(path.join(stubHome, ".codex", "auth.json"), JSON.stringify({ tokens: {} }));
fs.mkdirSync(path.join(stubHome, ".gemini")); fs.writeFileSync(path.join(stubHome, ".gemini", "oauth_creds.json"), JSON.stringify({ refresh_token: "" }));

function env(kind) {
  const e = { ...process.env, ANTHROPIC_API_KEY: "fixture-value" }; // same as the test
  if (kind !== "HOST-AS-IS") {
    for (const k of Object.keys(e)) if (k.toLowerCase() === "path") delete e[k];
    const base = [nodeDir, path.join(sys, "System32"), sys];
    e.PATH = (kind === "STUBBED-HOST" ? [stubBin, ...base] : base).join(path.delimiter);
    const h = kind === "STUBBED-HOST" ? stubHome : emptyHome;
    e.USERPROFILE = h; e.HOME = h;
  }
  return e;
}
function cfg(tier) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "s2h-cfg-"));
  const p = path.join(d, "cfg.json");
  fs.writeFileSync(p, JSON.stringify({ version: 1, t3_floor: "max_5x", providers: { claude: { selected_tier: tier } } }));
  return p;
}
function run(kind, tier) {
  const r = spawnSync(process.execPath, [ENGINE, "--json", "--enforce", "--config-path", cfg(tier)], { cwd: W, env: env(kind), encoding: "utf8", timeout: 120000 });
  let rows = "(unparseable)";
  try {
    const j = JSON.parse(r.stdout);
    rows = j.verdict_summary + " | " + j.providers.map((p) => `${p.provider}:${p.verdict}`).join(" ");
  } catch {}
  return { exit: r.status, rows };
}
const planted = /PLANTED REGRESSION/.test(fs.readFileSync(ENGINE, "utf8"));
console.log(`=== ${LABEL}  engine-planted-regression=${planted}  node=${process.version} platform=${process.platform}`);
for (const kind of ["HOST-AS-IS", "BARE-HOST", "STUBBED-HOST"]) {
  const A = run(kind, "t3"); // claude row = unknown-self-attested (the row under test)
  const B1 = run(kind, "t2"); // control: claude row = tier_met
  const B0 = run(kind, "t1"); // control: claude row = tier_met
  const eqT2 = A.exit === B1.exit, eqT1 = A.exit === B0.exit;
  console.log(`--- ${kind}`);
  console.log(`  A  claude=t3 exit=${A.exit}  ${A.rows}`);
  console.log(`  B  claude=t2 exit=${B1.exit}  ${B1.rows}`);
  console.log(`  B' claude=t1 exit=${B0.exit}  ${B0.rows}`);
  console.log(`  differential assertion (A==B, A==B') holds: ${eqT2 && eqT1}   absolute assertion (A exit 0) holds: ${A.exit === 0}`);
}
