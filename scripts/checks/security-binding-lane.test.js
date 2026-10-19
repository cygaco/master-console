#!/usr/bin/env node
"use strict";

const sbl = require("./security-binding-lane");

let passed = 0;
const fail = [];
function ok(cond, label) {
  if (cond) passed += 1;
  else fail.push(label);
}
const hasFinding = (errors, re) => errors.some((e) => re.test(e));

const GOOD_DEPS = {
  servedModelUnverifiableFromRecord: (p) => p === "antigravity",
  passesOf: (r) => (r === "security-reviewer" ? [{ provider: "antigravity" }, { provider: "openai" }, { provider: "claude" }] : []),
  panel2family: () => ({ binding: false, min_families: 2, lanes: [{ laneId: "gpt", provider: "openai" }, { laneId: "claude", provider: "claude" }] }),
  getProviderForRole: (r) => (r === "redteam" || r === "security-reviewer" ? "antigravity" : "claude"),
  providersRaw: { redteam: "openai" },
  catalogRaw: { redteam: "openai" },
  loadSupportMatrix: () => MATRIX_OPEN,
};
const agyRow = (fields) => ({ rows: { "agy-antigravity": { status: "down", proven: false, ...fields } } });
const MATRIX_OPEN = agyRow({ served_model_proven: false });
const MATRIX_PROVEN = agyRow({ served_model_proven: true, served_model_evidence_ref: "fixture: an authenticated serve attested the contracted model" });
const clone = (o) => JSON.parse(JSON.stringify(o));
function run(overrides = {}, supportMatrix = MATRIX_OPEN, files = {}) {
  const deps = { ...GOOD_DEPS, ...overrides };
  return sbl.evaluateSecurityBindingLane({ deps, supportMatrix, files });
}

{
  const { errors } = run();
  ok(errors.length === 0, `current-head-green: expected 0 findings, got ${errors.length}: ${errors.join(" | ")}`);
}

{
  const { errors } = run({ servedModelUnverifiableFromRecord: () => false });
  ok(hasFinding(errors, /\(P1\)/) && hasFinding(errors, /un-attestable/), `p1-choke-point-stub: ${errors.join(" | ")}`);
  ok(hasFinding(errors, /FIX:/), `finding-names-reason-and-remediation (P1): ${errors.join(" | ")}`);
}
{
  const { errors } = run({ panel2family: () => ({ binding: false, min_families: 1, lanes: [{ laneId: "gpt", provider: "openai" }] }) });
  ok(hasFinding(errors, /\(P2\)/), `p2-underfloor: ${errors.join(" | ")}`);
}
{
  const { errors } = run({ panel2family: () => ({ binding: false, min_families: 2, lanes: [{ laneId: "gpt", provider: "openai" }, { laneId: "agy", provider: "antigravity" }] }) });
  ok(hasFinding(errors, /\(P2\)/), `p2-agy-in-floor: ${errors.join(" | ")}`);
}
{
  const { errors } = run({ panel2family: () => ({ binding: false, min_families: 2, lanes: [{ laneId: "gpt", provider: "openai" }, { laneId: "gpt2", provider: "openai" }] }) });
  ok(hasFinding(errors, /\(P2\)/), `p2-duplicate-openai: [openai,openai] is one family → RED: ${errors.join(" | ")}`);
}
{
  const { errors } = run({ panel2family: () => ({ binding: false, min_families: 2, lanes: [{ laneId: "gpt", provider: "openai" }, { laneId: "gem", provider: "gemini" }] }) });
  ok(hasFinding(errors, /\(P2\)/), `p2-gemini-in-floor: a non-verifiable lane → RED: ${errors.join(" | ")}`);
}
{
  const { errors } = run({ passesOf: () => [{ provider: "antigravity" }, { provider: "antigravity" }] });
  ok(hasFinding(errors, /\(P3\)/), `p3-no-verifiable-pass: ${errors.join(" | ")}`);
}

{
  const P = sbl.servedModelProofOpen;
  ok(P(agyRow({})).open === true, "setting ABSENT → not proven (strict)");
  ok(P(MATRIX_OPEN).open === true, "setting FALSE → not proven (strict)");
  ok(P(MATRIX_PROVEN).open === false, "setting TRUE with an evidence ref → relaxed");
  ok(P(agyRow({ served_model_proven: true })).open === true, "TRUE without an evidence ref → strict");
  ok(P(agyRow({ served_model_proven: true, served_model_evidence_ref: "" })).open === true, "TRUE with an empty evidence ref → strict");
  ok(P(agyRow({ served_model_proven: true, served_model_evidence_ref: "   " })).open === true, "TRUE with a blank evidence ref → strict");
  ok(P(agyRow({ served_model_proven: true, served_model_evidence_ref: {} })).open === true, "TRUE with an object evidence ref → strict");
  ok(P(agyRow({ served_model_proven: "true", served_model_evidence_ref: "x" })).open === true, 'string "true" → strict');
  ok(P(agyRow({ served_model_proven: 1, served_model_evidence_ref: "x" })).open === true, "number 1 → strict");
  ok(P(agyRow({ served_model_proven: null, served_model_evidence_ref: "x" })).open === true, "null → strict");
  ok(P({ rows: { claude: { served_model_proven: true, served_model_evidence_ref: "x" } } }).open === true, "a proven OTHER row never relaxes the agy gate");
  ok(P({ rows: {} }).open === true, "no agy row → strict");
  ok(P({ rows: [] }).open === true, "rows not an object → strict");
  ok(P({ rows: { "agy-antigravity": [] } }).open === true, "agy row not an object → strict");
  ok(P({}).open === true, "matrix without rows → strict");
  ok(P(null).open === true && P(undefined).open === true, "missing/unreadable matrix → strict");
  ok(P([]).open === true, "matrix not an object → strict");
}

{
  const { errors } = run({ servedModelUnverifiableFromRecord: () => false }, MATRIX_PROVEN);
  ok(!hasFinding(errors, /\(P1\)/), `relax skips Tooth-A: unexpected P1 finding: ${errors.join(" | ")}`);
}

{
  const { errors } = run({ catalogRaw: { redteam: "openai" }, providersRaw: { redteam: "antigravity" } });
  ok(hasFinding(errors, /Tooth-B 1/), `alias-raw-two-maps disagree → RED: ${errors.join(" | ")}`);
  const { errors: e2 } = run({ catalogRaw: { redteam: "openai" }, providersRaw: { redteam: "openai" } });
  ok(!hasFinding(e2, /Tooth-B 1/), `alias-raw agree → no finding`);
}

{
  const { errors } = run({ getProviderForRole: (r) => (r === "redteam" ? "antigravity" : "openai") });
  ok(hasFinding(errors, /Tooth-B 2/), `alias-normalization-stubbed-divergence → RED: ${errors.join(" | ")}`);
}

{
  const dynamicCaller =
    'const ROLES = ["qa-reviewer", "security-reviewer"];\n' +
    'for (const role of ROLES) spawn("node", [path.join(ROOT, "scripts", "dispatch-agent.js"), role, prompt]);';
  const boundFirst =
    'const agent = path.join(ROOT, "scripts", "dispatch-agent.js");\n' +
    'const ROLES = ["security-reviewer"]; spawn("node", [agent, ROLES[0], prompt]);';
  const multiLine =
    'const ROLES = ["security-reviewer"];\nspawn("node", [\n  path.join(ROOT, "scripts", "dispatch-agent.js"),\n  role,\n]);';
  for (const [label, src] of [["dynamic", dynamicCaller], ["bound-first", boundFirst], ["multi-line", multiLine]]) {
    const { errors } = run({}, MATRIX_OPEN, { "scripts/evil.js": src });
    ok(hasFinding(errors, /SINGLE-PASS CREEP-BACK/) && hasFinding(errors, /scripts\/evil\.js/), `creep-back catches ${label} form → RED: ${errors.join(" | ")}`);
  }
  const { errors: clean } = run({}, MATRIX_OPEN, {});
  ok(!hasFinding(clean, /SINGLE-PASS CREEP-BACK/), `no caller → no creep-back finding`);
  const prose = { "scripts/doc.js": '// dispatch-agent serves the "security-reviewer" default\nrequire("../dispatch-agent");' };
  ok(!hasFinding(run({}, MATRIX_OPEN, prose).errors, /SINGLE-PASS CREEP-BACK/), `bare dispatch-agent (no .js) ref must NOT flag`);
  const allowKey = "scripts/fixture-tracked-caller.js";
  sbl.CREEP_BACK_ALLOWLIST[allowKey] = { type: "tracked-caller-proof-gated", reason: "test fixture" };
  ok(!hasFinding(run({}, MATRIX_OPEN, { [allowKey]: dynamicCaller }).errors, /SINGLE-PASS CREEP-BACK/), `tracked caller (${allowKey}) suppressed while served-model proof open`);
  ok(hasFinding(run({}, MATRIX_PROVEN, { [allowKey]: dynamicCaller }).errors, /SINGLE-PASS CREEP-BACK/), `tracked caller FLAGGED when served-model proof closes (mechanical re-open trigger)`);
  delete sbl.CREEP_BACK_ALLOWLIST[allowKey];
  const refKey = Object.keys(sbl.CREEP_BACK_ALLOWLIST).find((k) => sbl.CREEP_BACK_ALLOWLIST[k].type === "reference-only");
  const refContent = '// names the "security-reviewer" role + dispatch-agent.js in a comment; not a spawn';
  ok(!hasFinding(run({}, MATRIX_PROVEN, { [refKey]: refContent }).errors, /SINGLE-PASS CREEP-BACK/), `reference-only (${refKey}) pure-reference content stays suppressed`);
  ok(hasFinding(run({}, MATRIX_OPEN, { [refKey]: dynamicCaller }).errors, /SINGLE-PASS CREEP-BACK/), `reference-only (${refKey}) that GAINS the caller shape → FLAGGED (content-qualified)`);
  const templateCaller = 'const ROLES = [`security-reviewer`]; spawn("node", [path.join(ROOT, "dispatch-agent.js"), ROLES[0]]);';
  ok(hasFinding(run({}, MATRIX_OPEN, { "scripts/evil2.js": templateCaller }).errors, /SINGLE-PASS CREEP-BACK/), `template-literal role caught: ${run({}, MATRIX_OPEN, { "scripts/evil2.js": templateCaller }).errors.join(" | ")}`);
}

{
  ok(sbl.isWalkExcluded("scripts/dispatch-agent.js") === true, "exact dispatch-agent.js (the transport) excluded");
  ok(sbl.isWalkExcluded("scripts/evil/dispatch-agent.js") === false, "PATH-SPOOF scripts/evil/dispatch-agent.js NOT excluded (scanned)");
  ok(sbl.isWalkExcluded("scripts/dispatch-review.js") === true, "exact sanctioned dispatch-review.js excluded");
  ok(sbl.isWalkExcluded("scripts/checks/security-binding-lane.js") === true, "exact self excluded");
  ok(sbl.isWalkExcluded("scripts/evil/dispatch-review.js") === false, "PATH-SPOOF scripts/evil/dispatch-review.js NOT excluded (scanned)");
  ok(sbl.isWalkExcluded("scripts/foo.test.js") === true, "*.test.js excluded");
  ok(sbl.isWalkExcluded("scripts/test-foo.js") === true, "test-*.js excluded");
  ok(sbl.isWalkExcluded("scripts/checks/foo.js") === false, "an ordinary file is scanned");
}

{
  const { errors } = run({ literalsExported: false });
  ok(hasFinding(errors, /Tooth-B 1/) && hasFinding(errors, /NOT exported/), `tooth-b fail-closed on absent literals → RED: ${errors.join(" | ")}`);
  const { errors: e2 } = run({ literalsExported: true, catalogRaw: { redteam: "openai" }, providersRaw: { redteam: "openai" } });
  ok(!hasFinding(e2, /Tooth-B 1/), `tooth-b with exports present + agreeing maps → no finding`);
}

{
  const catalog = require("../dispatch/catalog");
  const providers = require("../hooks/lib/providers");
  ok(!!catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE && !!providers.LITERAL_DEFAULT_AGENT_PROVIDERS, "literal maps are exported (catalog + providers)");
  ok(
    catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE && catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE.redteam === catalog.DEFAULT_PROVIDER_PER_ROLE.redteam,
    `catalog literal[redteam] === derived[redteam] (export behavior-neutral): lit=${catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE && catalog.LITERAL_DEFAULT_PROVIDER_PER_ROLE.redteam} der=${catalog.DEFAULT_PROVIDER_PER_ROLE.redteam}`,
  );
  ok(
    providers.LITERAL_DEFAULT_AGENT_PROVIDERS && providers.LITERAL_DEFAULT_AGENT_PROVIDERS.redteam === providers.DEFAULT_AGENT_PROVIDERS.redteam,
    `providers literal[redteam] === derived[redteam]: lit=${providers.LITERAL_DEFAULT_AGENT_PROVIDERS && providers.LITERAL_DEFAULT_AGENT_PROVIDERS.redteam} der=${providers.DEFAULT_AGENT_PROVIDERS.redteam}`,
  );
}

{
  ok(hasFinding(run({ panel2family: () => ({ binding: "true", min_families: 2, lanes: [{ laneId: "gpt", provider: "openai" }, { laneId: "claude", provider: "claude" }] }) }).errors, /\(P2\)/), `p2-binding-string "true" → RED`);
  ok(hasFinding(run({ panel2family: () => ({ binding: false, min_families: "2", lanes: [{ laneId: "gpt", provider: "openai" }, { laneId: "claude", provider: "claude" }] }) }).errors, /\(P2\)/), `p2-min_families-string "2" → RED`);
}

{
  const fs = require("fs");
  const path = require("path");
  const catalogKey = "scripts/dispatch/catalog.js";
  const real = fs.readFileSync(path.join(__dirname, "..", "dispatch", "catalog.js"), "utf8");
  const sample = real + '\nconst PROBE_NOTE = "checked with a dispatch-agent.js probe";\n';
  ok(/dispatch-agent\.js/.test(sample) && /["'`](?:security-reviewer|redteam)["'`]/.test(real), "the catalog sample co-occurs (the shape a co-occurrence-only check would flag)");
  ok(!hasFinding(run({}, MATRIX_OPEN, { [catalogKey]: sample }).errors, /SINGLE-PASS CREEP-BACK/), "the catalog sample is NOT flagged at the allowlisted path");
  const gained = sample + '\nspawn("node", [path.join(ROOT, "scripts", "dispatch-agent.js"), "security-reviewer", prompt]);\n';
  ok(hasFinding(run({}, MATRIX_OPEN, { [catalogKey]: gained }).errors, /scripts\/dispatch\/catalog\.js/), "the catalog GAINING a spawn-args caller shape IS flagged");
  ok(hasFinding(run({}, MATRIX_OPEN, { "scripts/dispatch/catalog-copy.js": sample }).errors, /catalog-copy.js/), "the same content at an unlisted path is flagged (the allowlist is exact-path)");
}

if (fail.length) {
  process.stderr.write(`security-binding-lane.test: ${passed} passed, ${fail.length} FAILED:\n${fail.map((f) => "  ✗ " + f).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`security-binding-lane.test: ${passed}/${passed} passed\n`);
