#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

const release = require("./release");

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

function quiet(fn) {
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    return fn();
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
  }
}

const stub = (verdict) => () => verdict;

{
  const ex = quiet(() =>
    release.regressionSeedGate(stub({ enforced: true, role: "canonical", exit: 0, summary: { passing: 14, runnable: 16 } })),
  );
  ok("A: enforced clean verdict → gate exit 0", ex === 0, `got ${ex}`);
}

{
  const ex = quiet(() =>
    release.regressionSeedGate(stub({ enforced: false, role: "product", exit: 0, mode: "opt-in" })),
  );
  ok("B: product opt-in no-op → gate exit 0", ex === 0, `got ${ex}`);
}

{
  const ex = quiet(() =>
    release.regressionSeedGate(
      stub({ enforced: true, role: "canonical", exit: 1, regressions: 2, offending: [{ id: "X-01", name: "x", exit: 1 }] }),
    ),
  );
  ok("C: NEW regression (exit 1) → gate exit 3 (block)", ex === 3, `got ${ex}`);
}

{
  const ex = quiet(() =>
    release.regressionSeedGate(stub({ enforced: true, role: "canonical", exit: 2, error: "run.js produced no parseable JSON" })),
  );
  ok("D: runner error (exit 2) → gate exit 3 (fail closed)", ex === 3, `got ${ex}`);
}

{
  const ex = quiet(() =>
    release.regressionSeedGate(() => {
      throw new Error("module blew up");
    }),
  );
  ok("E: enforcer throws → gate exit 3 (fail closed)", ex === 3, `got ${ex}`);
}

{
  let ex;
  let threw = false;
  try {
    ex = quiet(() => release.regressionSeedGate());
  } catch (e) {
    threw = true;
  }
  ok("F: live enforcer wires through (no throw)", !threw);
  ok("F: live enforcer returns a valid gate code (0 or 3)", ex === 0 || ex === 3, `got ${ex}`);
}

{
  const fullSrc = fs.readFileSync(path.join(__dirname, "full.js"), "utf8");
  const mapsSentinel = /prepRes\.code === 3/.test(fullSrc);
  const namesHalt = /halt_reason:\s*["']regression_seed_failed["']/.test(fullSrc);
  ok("G: full.js phase 4 recognizes the exit-3 sentinel", mapsSentinel);
  ok("G: full.js phase 4 emits a regression_seed_failed halt_reason", namesHalt);
}

{
  const prev = mcEnv.readEnv("REPO_ROLE");
  let ex;
  let threw = false;
  try {
    mcEnv.setEnv("REPO_ROLE", "consumer");
    ex = quiet(() => release.regressionSeedGate());
  } catch (e) {
    threw = true;
  } finally {
    if (prev === undefined) mcEnv.unsetEnv("REPO_ROLE");
    else mcEnv.setEnv("REPO_ROLE", prev);
  }
  ok("H1: MC_REPO_ROLE=consumer does NOT spoof-bypass the gate on canonical (no throw, valid code)", !threw && (ex === 0 || ex === 3), `threw=${threw} exit=${ex}`);

  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "release.js"), "utf8");
  const gateBody = src.slice(src.indexOf("function regressionSeedGate"), src.indexOf("function cmdPrepare"));
  const gateCode = gateBody
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
  const usesModuleExistence = /fs\.existsSync\([^)]*enforce/.test(gateCode) || /existsSync\(\s*enforcerPath/.test(gateCode);
  const noRoleOracleOnGatePath = !/resolveRepoRole/.test(gateCode);
  ok("H2: gate keys product detection on fs.existsSync(testsuite/enforce.js)", usesModuleExistence);
  ok("H2: gate code does NOT consult the spoofable resolveRepoRole on the close path", noRoleOracleOnGatePath, gateCode.match(/resolveRepoRole/) ? "found resolveRepoRole in code" : "");
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
