#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ml = require("./meta-lockstep");
const rp = require("./role-parity-scan");

let passed = 0;
const fail = [];
function ok(cond, label) {
  if (cond) passed += 1;
  else fail.push(label);
}

const CLASSES = {
  xprov_lead: { allowed_shapes: ["subprocess-cross-provider"] },
  xprov_rev: { allowed_shapes: ["subprocess-cross-provider"] },
  xprov: { allowed_shapes: ["subprocess-cross-provider"] },
  manager: { allowed_shapes: ["in-process-agent"] },
};
const CONTRACT_SYM = {
  class_derivation: {
    rules: [
      { when: { tier: "lead", provider: "openai" }, class: "xprov_lead" },
      { when: { tier: "lead", provider: "antigravity" }, class: "xprov_lead" },
      { when: { kind: "reviewer", provider: "openai" }, class: "xprov_rev" },
      { when: { kind: "reviewer", provider: "antigravity" }, class: "xprov_rev" },
      { when: { tier: "lead" }, class: "manager" },
    ],
    fallback_class: "manager",
  },
  role_classes: CLASSES,
};
const REG_SYM = {
  roles: {
    "design-lead": { tier: "lead", provider: "openai" },
    "research-lead": { tier: "lead", provider: "antigravity" },
  },
};

{
  const { errors } = ml.evaluateMetaLockstep({ reg: REG_SYM, contract: CONTRACT_SYM });
  ok(errors.length === 0, `current-head-green (stub symmetric): expected 0 findings, got ${errors.length}: ${errors.join(" | ")}`);
}

{
  const contract = JSON.parse(JSON.stringify(CONTRACT_SYM));
  contract.class_derivation.rules = contract.class_derivation.rules.filter(
    (r) => !(r.when.tier === "lead" && r.when.provider === "antigravity"),
  );
  const { errors } = ml.evaluateMetaLockstep({ reg: REG_SYM, contract });
  const hit = errors.find((e) => /ASYMMETRY/.test(e) && /antigravity/.test(e) && /"lead"/.test(e));
  ok(!!hit, `asymmetry-reason: expected a symmetry ASYMMETRY finding naming antigravity+lead; got: ${errors.join(" | ")}`);
  ok(hit && /FIX:/.test(hit) && /(waiver|class_derivation rule)/.test(hit), `finding-names-reason-and-remediation: ${hit || "(none)"}`);
}

{
  const contract = {
    class_derivation: {
      rules: [
        { when: { claude_pinned: true }, class: "xprov" },
        { when: { tier: "lead", provider: "openai" }, class: "xprov_lead" },
        { when: { kind: "reviewer", provider: "openai" }, class: "xprov_rev" },
        { when: { kind: "reviewer", provider: "antigravity" }, class: "xprov_rev" },
        { when: { tier: "lead" }, class: "manager" },
      ],
      fallback_class: "manager",
    },
    role_classes: CLASSES,
  };
  const reg = {
    roles: {
      "design-lead": { tier: "lead", provider: "openai" },
      "research-lead": { tier: "lead", provider: "antigravity", claude_pinned: true },
    },
  };
  const rpErrors = rp.evaluateShapeRouteConflicts({ reg, contract });
  ok(rpErrors.length === 0, `precondition: role-parity should be GREEN here, got: ${rpErrors.join(" | ")}`);
  const { errors } = ml.evaluateMetaLockstep({ reg, contract });
  ok(errors.some((e) => /ASYMMETRY/.test(e) && /antigravity/.test(e)), `symmetry-violated-role-parity-green: meta-lockstep must RED where role-parity is green; got: ${errors.join(" | ")}`);
}

{
  const contract = JSON.parse(JSON.stringify(CONTRACT_SYM));
  contract.class_derivation.rules.push({ when: { tier: "director", provider: "openai" }, class: "xprov_lead" });
  contract.class_derivation.rules.push({ when: { tier: "director" }, class: "manager" });
  const excused = ml.evaluateMetaLockstep({ reg: REG_SYM, contract });
  ok(!excused.errors.some((e) => /director/.test(e) && /ASYMMETRY/.test(e)), `director excused (no live role): unexpected finding: ${excused.errors.join(" | ")}`);
  const regDir = { roles: { ...REG_SYM.roles, "dir-x": { tier: "director", provider: "antigravity" } } };
  const waived = ml.evaluateMetaLockstep({ reg: regDir, contract });
  ok(!waived.errors.some((e) => /director/.test(e) && /ASYMMETRY/.test(e)), `director waived (default waiver): unexpected finding: ${waived.errors.join(" | ")}`);
  const unwaived = ml.evaluateMetaLockstep({ reg: regDir, contract, waiver: [] });
  ok(unwaived.errors.some((e) => /director/.test(e) && /ASYMMETRY/.test(e)), `director unwaived (empty waiver): expected a RED; got: ${unwaived.errors.join(" | ")}`);
}

{
  const contract = {
    class_derivation: { rules: [{ when: { tier: "lead", provider: "openai" }, class: "xprov" }, { when: { tier: "lead" }, class: "manager" }], fallback_class: "manager" },
    role_classes: { xprov: { allowed_shapes: ["subprocess-cross-provider"] }, manager: { allowed_shapes: ["in-process-agent"] } },
  };
  const reg = { roles: { "ag-lead": { tier: "lead", provider: "antigravity" } } };
  const withAnti = rp.evaluateShapeRouteConflicts({ reg, contract, scope: ["openai", "antigravity"] });
  const withoutAnti = rp.evaluateShapeRouteConflicts({ reg, contract, scope: ["openai"] });
  ok(withAnti.length > withoutAnti.length && withoutAnti.length === 0, `scope-injection-behavioral: full scope must evaluate the antigravity role (finding), narrowed scope must skip it (none); got with=${withAnti.length} without=${withoutAnti.length}`);
  const realSrc = fs.readFileSync(path.join(__dirname, "role-parity-scan.js"), "utf8");
  ok(ml.shapeFilterReadsScopeConstant(realSrc), `scope-constant-is-read (belt): real filter must default scope to CROSS_PROVIDER_SCOPE + read scope`);
  const reInlined = realSrc.replace(/if \(!scope\.includes\(\s*provider\s*\)\) continue;/, 'if (provider !== "openai" && provider !== "antigravity") continue;');
  ok(reInlined !== realSrc && !ml.shapeFilterReadsScopeConstant(reInlined), `scope-constant-is-read (belt): a re-inlined literal at the filter must FAIL the coupling check`);
  ok(ml.shapeFilterReadsScopeBehaviorally() === true, "scope-injection BEHAVIORAL: the real evaluator reads the injected scope");
}

{
  const broad = ml.checkWaiverIntegrity([{ dimension: "tier", provider: "antigravity", why: "x" }]);
  ok(broad.some((e) => /narrowest-form/.test(e)), `waiver-narrowest: a non-narrowest waiver must RED; got: ${broad.join(" | ")}`);
  const noWhy = ml.checkWaiverIntegrity([{ dimension: "tier", value: "director", provider: "antigravity" }]);
  ok(noWhy.some((e) => /has NO 'why'/.test(e)), `waiver-requires-why: a why-less waiver must RED; got: ${noWhy.join(" | ")}`);
  const widened = ml.checkWaiverIntegrity([
    ...ml.BASELINE_WAIVER,
    { dimension: "tier", value: "face", provider: "antigravity", why: "y" },
  ]);
  ok(widened.some((e) => /WIDENED beyond the frozen baseline/.test(e)), `waiver-widen-flagged: a widened waiver must RED; got: ${widened.join(" | ")}`);
  ok(ml.checkWaiverIntegrity(ml.BASELINE_WAIVER).length === 0, `baseline waiver must be integrity-clean`);
}

if (fail.length) {
  process.stderr.write(`meta-lockstep.test: ${passed} passed, ${fail.length} FAILED:\n${fail.map((f) => "  ✗ " + f).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`meta-lockstep.test: ${passed}/${passed} passed\n`);
