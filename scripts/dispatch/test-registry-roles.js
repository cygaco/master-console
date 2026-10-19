#!/usr/bin/env node
"use strict";

const R = require("./registry-roles");

let passes = 0, failures = 0;
function ok(name, cond, detail) {
  if (cond) { passes++; console.log(`  ok  ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => [...a].sort();

console.log("derived maps/sets (vs known-good):");
{
  const ids = R.roleIds();
  ok("roleIds returns the roster (>=24, incl quality-lead)", ids.length >= 24 && ids.includes("quality-lead"), `n=${ids.length}`);
  ok("providerOf alpha = claude", R.providerOf("alpha") === "claude");
  ok("providerOf design-lead = openai", R.providerOf("design-lead") === "openai");
  ok("effortOf alpha = max", R.effortOf("alpha") === "max");
  ok("modelOf design-lead = gpt-5.5", R.modelOf("design-lead") === "gpt-5.5");
  ok("buildChainRoles includes FE/BE/security builders", ["frontend-builder", "backend-builder", "security-builder"].every((r) => R.buildChainRoles().includes(r)), R.buildChainRoles().join(","));
  ok("flagshipOpenaiRoles includes design-lead", R.flagshipOpenaiRoles().includes("design-lead"), R.flagshipOpenaiRoles().join(","));
  ok("security-reviewer provider is antigravity (not the SUNSET gemini)", R.providerOf("security-reviewer") === "antigravity", R.providerOf("security-reviewer"));
  ok("fixerRoles are the 3 pod fixers", eq(sorted(R.fixerRoles()), ["backend-fixer", "frontend-fixer", "security-fixer"]), R.fixerRoles().join(","));
  ok("reviewerGateKeys = the 4 binding pod reviewers (snake)", eq(R.reviewerGateKeys(), ["backend_reviewer", "frontend_reviewer", "qa_reviewer", "security_reviewer"]), R.reviewerGateKeys().join(","));
}

console.log("\nparity vs literals (verify-at-rewire where not exported):");
function tryRequire(p) { try { return require(p); } catch { return null; } }

{
  const afo = tryRequire("../checks/adhoc-fail-override");
  if (afo && afo.REVIEWER_KEYS) {
    ok("reviewerGateKeys deep-equals adhoc-fail-override.REVIEWER_KEYS", eq(sorted(afo.REVIEWER_KEYS), R.reviewerGateKeys()), `lit=${[...afo.REVIEWER_KEYS]} der=${R.reviewerGateKeys()}`);
  } else {
    console.log("  ..  adhoc-fail-override.REVIEWER_KEYS not importable — verify at rewire");
  }
}
{
  const catalog = tryRequire("./catalog");
  if (catalog && catalog.DEFAULT_PROVIDER_PER_ROLE) {
    const lit = catalog.DEFAULT_PROVIDER_PER_ROLE, der = R.providerMap();
    const mism = R.roleIds().filter((r) => lit[r] && der[r] && lit[r] !== der[r]);
    ok("providerMap agrees with catalog.DEFAULT_PROVIDER_PER_ROLE (shared roles)", mism.length === 0, "mismatch: " + mism.map((r) => `${r}:reg=${der[r]}/lit=${lit[r]}`).join(", "));
  } else {
    console.log("  ..  catalog.DEFAULT_PROVIDER_PER_ROLE not exported — verify at rewire");
  }
  if (catalog && catalog.DEFAULT_EFFORT_PER_ROLE) {
    const lit = catalog.DEFAULT_EFFORT_PER_ROLE, der = R.effortMap();
    const mism = R.roleIds().filter((r) => lit[r] && der[r] && lit[r] !== der[r]);
    ok("effortMap agrees with catalog.DEFAULT_EFFORT_PER_ROLE (shared roles)", mism.length === 0, "mismatch: " + mism.map((r) => `${r}:reg=${der[r]}/lit=${lit[r]}`).join(", "));
  }
}

console.log("\nderiveOrFallback (loud fallback):");
{
  ok("returns the derived value when non-empty", eq(R.deriveOrFallback(() => ["a", "b"], ["x"], "t"), ["a", "b"]));

  const orig = process.stderr.write.bind(process.stderr);
  let warned = "";
  process.stderr.write = (s) => { warned += s; return true; };
  const fb = R.deriveOrFallback(() => { throw new Error("boom"); }, ["lit"], "T-LABEL");
  process.stderr.write = orig;
  ok("falls back to the literal on throw", eq(fb, ["lit"]));
  ok("the fallback is LOUD (warns to stderr, names the label)", /WARN[\s\S]*T-LABEL/.test(warned), JSON.stringify(warned));

  let warned2 = "";
  process.stderr.write = (s) => { warned2 += s; return true; };
  const fb2 = R.deriveOrFallback(() => [], ["lit2"], "EMPTY-LABEL");
  process.stderr.write = orig;
  ok("empty derive → loud fallback too", eq(fb2, ["lit2"]) && /EMPTY-LABEL/.test(warned2));
}

console.log("\norg-roles registry-derivation (the collapse cut-safety):");
{
  const OR = tryRequire("./org-roles");
  if (OR) {
    const bcd = OR.buildChainDoerRoles();
    const regBuildChain = R.buildChainRoles();
    const missingBC = regBuildChain.filter((r) => !bcd.has(r));
    ok("buildChainDoerRoles ⊇ registry build_chain set (security pod + fixers included)", missingBC.length === 0, "missing: " + missingBC.join(","));
    ok("buildChainDoerRoles still includes the code-qc gauntlet reviewers", ["frontend-reviewer", "backend-reviewer", "qa-reviewer", "security-reviewer"].every((r) => bcd.has(r)), [...bcd].join(","));

    const dr = OR.domainRoles();
    ok("domainRoles carries LIVE leads (director-of-growth, research-lead, quality-lead)", ["director-of-growth", "research-lead", "quality-lead"].every((r) => dr.has(r)), [...dr].sort().join(","));
    ok("domainRoles has NO stale pre-rename names (director-of-marketing/product-designer/research-insight-lead)", !["director-of-marketing", "product-designer", "research-insight-lead", "qa-lead", "growth-lead", "web-conversion-designer", "director-of-product-management"].some((r) => dr.has(r)), [...dr].sort().join(","));
    ok("domainRoles excludes faces + President's-office tools (president home)", !["alpha", "beta", "gamma", "delta", "epsilon", "ops-analyst", "cabinet", "learner"].some((r) => dr.has(r)), [...dr].sort().join(","));

    const got = OR.gammaOnlyTypes();
    ok("gammaOnlyTypes gates every registry build_chain doer (no gate hole)", regBuildChain.every((r) => got.has(r)), regBuildChain.filter((r) => !got.has(r)).join(","));
  } else {
    console.log("  ..  org-roles not importable — skipped");
  }
}

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
