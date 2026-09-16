"use strict";
// Controlled experiment: toggle ONE variable (WARPOS_DISPATCH_BACKGROUND) and observe the 3 mismatching entries
// against the register, 2 passes per arm, everything else identical.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const rt = require(path.join(ROOT, "scripts", "checks", "run-tests.js"));
const FILES = ["tests/regression/SP-20260611-001/epsilon-spawn-grace.test.js", "tests/regression/SP-20260611-001/review-fallback-shape.test.js", "tests/regression/SP-20260616-001/wrapper-door.test.js"];
(async () => {
  const { entries } = rt.loadQuarantine(path.join(ROOT, "tests", "quarantine.json"), ROOT);
  const ctx = rt.normalizerContext(ROOT);
  const ambient = process.env.WARPOS_DISPATCH_BACKGROUND;
  const arms = { unset: undefined, set_to_1: "1" };
  const out = { ambientValue: ambient === undefined ? null : ambient, otherWarposMcVars: Object.keys(process.env).filter((k) => /^(WARPOS_|MC_)/.test(k)), rows: [] };
  for (const [arm, val] of Object.entries(arms)) {
    if (val === undefined) delete process.env.WARPOS_DISPATCH_BACKGROUND;
    else process.env.WARPOS_DISPATCH_BACKGROUND = val;
    for (let p = 1; p <= 2; p++) {
      for (const f of FILES) {
        const e = entries.find((x) => x.file === f);
        const r = await rt.runNodeTest(ROOT, [f], { tee: false, timeoutMs: 600000 });
        const cap = rt.captureCauseLines(r.output, ctx);
        out.rows.push({ arm, pass: p, file: f, exit: r.status, eqRegister: rt.sameMultiset(cap.lines, e.causeLines) });
      }
    }
  }
  if (ambient === undefined) delete process.env.WARPOS_DISPATCH_BACKGROUND;
  else process.env.WARPOS_DISPATCH_BACKGROUND = ambient;
  fs.writeFileSync(path.join(__dirname, "env-toggle.summary.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  for (const r of out.rows) console.log(`${r.arm.padEnd(8)} pass${r.pass} exit=${r.exit} eqRegister=${r.eqRegister} ${r.file}`);
  console.log(JSON.stringify({ ambientValue: out.ambientValue, otherWarposMcVars: out.otherWarposMcVars }));
})();
