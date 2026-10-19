#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const rb = require("./release-build");

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

{
  const g = rb.betaHonestyGate({}, () => ({ status: 0, stdout: '{"ok":true,"applicable":0}', stderr: "" }));
  ok("A: clean audit (exit 0) → not blocked", g.blocked === false, JSON.stringify(g));
}

{
  const findingsJson = JSON.stringify({
    ok: false,
    checked: 2,
    cutoff: null,
    totalFindings: 1,
    findings: [
      { sprint_id: "SP-00000000-000", finding_type: "placeholder_verdict", phase: "design", evidence: "empty beta_message" },
    ],
  });
  const g = rb.betaHonestyGate({}, () => ({ status: 1, stdout: findingsJson, stderr: "" }));
  ok("B: findings (exit 1) → blocked", g.blocked === true, JSON.stringify(g));
  ok("B: message names the offending sprint", g.message.includes("SP-00000000-000"), g.message);
  ok("B: message names the finding type", g.message.includes("placeholder_verdict"), g.message);
  ok("B: message includes remediation", g.message.includes("Remediation"), g.message);
}

{
  const g = rb.betaHonestyGate({}, () => ({ status: 2, stdout: "", stderr: "invalid --since" }));
  ok("C: runner error (exit 2) → blocked (fail closed)", g.blocked === true, JSON.stringify(g));
  ok("C: raw stderr surfaced", g.message.includes("invalid --since"), g.message);
}

{
  const g = rb.betaHonestyGate({}, () => ({ status: null, stdout: "", stderr: "" }));
  ok("D: crash (status null) → blocked (fail closed)", g.blocked === true, JSON.stringify(g));
}

{
  const g = rb.betaHonestyGate({}, () => ({ status: 1, stdout: "boom not json", stderr: "" }));
  ok("E: non-JSON non-zero → blocked", g.blocked === true, JSON.stringify(g));
  ok("E: raw stdout surfaced as detail", g.message.includes("boom not json"), g.message);
}

{
  let called = false;
  const g = rb.betaHonestyGate({ skipBetaHonestyCheck: true }, () => {
    called = true;
    return { status: 1, stdout: "{}", stderr: "" };
  });
  ok("F: --skip-beta-honesty-check → not blocked", g.blocked === false, JSON.stringify(g));
  ok("F: bypass short-circuits the runner (not invoked)", called === false);
}

{
  let threw = false;
  let g;
  try {
    g = rb.betaHonestyGate({});
  } catch (e) {
    threw = true;
  }
  ok("G: live runner does not throw", !threw);
  ok("G: live runner returns a boolean blocked", g && typeof g.blocked === "boolean", JSON.stringify(g));
}

{
  const src = fs.readFileSync(path.join(__dirname, "release-build.js"), "utf8");
  ok("H: buildCapsule calls betaHonestyGate(opts)", /betaHonestyGate\(opts\)/.test(src));
  ok("H: blocked path exits non-zero", /honesty\.blocked[\s\S]{0,80}process\.exit\(2\)/.test(src));
  ok("H: --skip-beta-honesty-check flag is parsed", src.includes('"--skip-beta-honesty-check"'));
}

{
  const src = fs.readFileSync(path.join(__dirname, "release-build.js"), "utf8");
  ok(
    "I: BETA_HONESTY_GATE_BASELINE defaults to null (no baseline)",
    /BETA_HONESTY_GATE_BASELINE\s*=\s*null;/.test(src),
    "(null default baseline not found)",
  );
  ok(
    "I: default runner passes --since with the baseline only when one is set",
    /BETA_HONESTY_GATE_BASELINE\s*\?\s*\["--since",\s*BETA_HONESTY_GATE_BASELINE\]\s*:\s*\[\]/.test(src),
    "(conditional --since baseline wiring not found)",
  );
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
