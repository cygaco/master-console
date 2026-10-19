#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");
const { evaluate, derivePersonaStaleNames } = require("./skill-hook-coverage");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const coherentReg = { skills: {
  "roadmap:next": { domain: "product", hooks: [
    { hook_point: "pick", role: "product-lead", condition: "single-product" },
    { hook_point: "pick", role: "director-of-product", condition: "strategic", default: true },
  ] },
  "growth:message-brief": { domain: "growth", hooks: [
    { hook_point: "distill-message", role: "director-of-growth" },
    { hook_point: "shape-copy", role: "copy-lead" },
  ] },
} };
const ROLE_IDS = ["product-lead", "director-of-product", "director-of-growth", "copy-lead", "marketing-lead"];

const ROOT = path.resolve(__dirname, "..", "..");
const realFile = (skill) => path.join(ROOT, ".claude", "commands", ...skill.replace(/:/g, "/").split("/")) + ".md";
const baseFiles = [
  { skill: "roadmap:next", path: realFile("roadmap:next"), body: "no dispatch here" },
  { skill: "growth:message-brief", path: realFile("growth:message-brief"), body: "no dispatch here" },
];

test("coherent → 0 findings", () => {
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: baseFiles });
  assert.deepStrictEqual(findings, [], `expected clean, got: ${findings.map((f) => f.finding_type).join("; ")}`);
});

test("derivePersonaStaleNames narrows to management personas, drops worker scraps", () => {
  const stale = derivePersonaStaleNames({
    "director-of-marketing": "director-of-growth",
    "growth-lead": "marketing-lead",
    "product-designer": "design-lead",
    qa: "qa-reviewer",
    "req-reviewer": "qa-reviewer",
    compliance: "qa-reviewer",
    redteam: "security-reviewer",
    "": "design-lead",
    "odd-id": null,
  });
  assert.ok(stale.has("director-of-marketing") && stale.has("growth-lead") && stale.has("product-designer"),
    "management-persona legacy ids collected");
  assert.ok(!stale.has("qa") && !stale.has("req-reviewer") && !stale.has("compliance") && !stale.has("redteam"),
    "worker scraps must be excluded (persona-narrowing)");
  assert.ok(!stale.has("") && !stale.has("odd-id"), "empty and canonical-less ids dropped");
});

test("the default alias map yields the six renamed-away management personas", () => {
  assert.deepStrictEqual([...derivePersonaStaleNames()].sort(), [
    "director-of-marketing", "director-of-qa", "growth-lead", "product-designer", "research-insight-lead", "web-conversion-designer",
  ]);
});

test("a planted alias in a fixture copy of role-aliases.js is derived and its use is flagged", () => {
  const os = require("os");
  const fs = require("fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shc-aliases-"));
  const src = fs.readFileSync(path.join(ROOT, "scripts", "hooks", "lib", "role-aliases.js"), "utf8");
  const planted = src.replace("const ROLE_ALIASES = Object.freeze({\n", 'const ROLE_ALIASES = Object.freeze({\n  "old-lead": "marketing-lead",\n');
  assert.notStrictEqual(planted, src, "fixture plant point not found in role-aliases.js");
  fs.writeFileSync(path.join(dir, "role-aliases.js"), planted);
  const { ROLE_ALIASES } = require(path.join(dir, "role-aliases.js"));
  const stale = derivePersonaStaleNames(ROLE_ALIASES);
  assert.ok(stale.has("old-lead"), "the planted legacy id must be derived as stale");
  const files = [baseFiles[0], baseFiles[1], { skill: "growth:planted", path: "p.md", body: "subagent_type: old-lead\n" }];
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: files, personaStaleNames: stale });
  assert.ok(findings.some((f) => f.finding_type === "hardcoded_stale_role" && f.role === "old-lead"),
    `expected hardcoded_stale_role for old-lead, got: ${findings.map((f) => f.finding_type).join("; ")}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("every derived legacy id points at a role that exists in the registry", () => {
  const { ROLE_ALIASES } = require("../hooks/lib/role-aliases");
  const roles = require(path.join(ROOT, ".claude", "agents", "_org", "role-registry.json")).roles;
  for (const legacy of derivePersonaStaleNames()) {
    assert.ok(roles[ROLE_ALIASES[legacy]], `${legacy} → ${ROLE_ALIASES[legacy]}: the target is not a registry role`);
  }
});

test("hardcoded stale role (director-of-marketing) → hardcoded_stale_role", () => {
  const f2 = [
    baseFiles[0], baseFiles[1],
    { skill: "growth:other", path: "x.md", body: "subagent_type: director-of-marketing\n" },
  ];
  const personaStaleNames = new Set(["director-of-marketing"]);
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: f2, personaStaleNames });
  assert.ok(
    findings.some((f) => f.finding_type === "hardcoded_stale_role" && f.role === "director-of-marketing" && f.severity === "high"),
    `expected hardcoded_stale_role, got: ${findings.map((f) => f.finding_type).join("; ")}`,
  );
});

test("persona stale name in plain descriptive prose → hardcoded_stale_role", () => {
  const files = [
    baseFiles[0], baseFiles[1],
    { skill: "growth:doc", path: "d.md", body: "This skill used to consult the director-of-marketing for sign-off.\n" },
  ];
  const personaStaleNames = new Set(["director-of-marketing"]);
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: files, personaStaleNames });
  assert.ok(
    findings.some((f) => f.finding_type === "hardcoded_stale_role" && f.role === "director-of-marketing"),
    `expected hardcoded_stale_role from prose, got: ${findings.map((f) => f.finding_type).join("; ")}`,
  );
});

test("persona stale name on a stale-ok line → NOT flagged", () => {
  const files = [
    baseFiles[0], baseFiles[1],
    { skill: "scan:doc", path: "s.md", body: "e.g. director-of-marketing after the rename <!-- stale-ok: documents the break -->\n" },
  ];
  const personaStaleNames = new Set(["director-of-marketing"]);
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: files, personaStaleNames });
  assert.ok(
    !findings.some((f) => f.finding_type === "hardcoded_stale_role"),
    `stale-ok line must suppress, got: ${findings.map((f) => f.finding_type).join("; ")}`,
  );
});

test("worker-scrap names (redteam, qa) anywhere → NOT flagged", () => {
  const files = [
    baseFiles[0], baseFiles[1],
    { skill: "redteam:full", path: "rt.md", body: "Run /redteam:full then /qa:audit; the redteam subagent and qa pass cover it.\nsubagent_type: redteam\n" },
  ];
  const personaStaleNames = new Set(["director-of-marketing", "growth-lead", "product-designer"]);
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: files, personaStaleNames });
  assert.deepStrictEqual(findings, [],
    `worker-scrap names must never flag (persona-narrowing), got: ${findings.map((f) => f.finding_type).join("; ")}`);
});

test("registered persona skill hardcodes current persona via subagent_type → hardcoded_role", () => {
  const files = [
    baseFiles[1],
    { skill: "roadmap:next", path: realFile("roadmap:next"), body: "subagent_type: product-lead\n" },
  ];
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: files, allowlist: new Set() });
  assert.ok(
    findings.some((f) => f.finding_type === "hardcoded_role" && f.role === "product-lead" && f.skill === "roadmap:next"),
    `expected hardcoded_role, got: ${findings.map((f) => f.finding_type).join("; ")}`,
  );
});

test("current persona bold-backtick + subagent in UNregistered skill → unregistered_persona_skill", () => {
  const files = [
    baseFiles[0], baseFiles[1],
    { skill: "growth:notreg", path: "nr.md", body: "- **`marketing-lead`** subagent (the `eq-scoring` hook) — for scoring\n" },
  ];
  const personaRoles = new Set(["product-lead", "director-of-product", "director-of-growth", "copy-lead", "marketing-lead"]);
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: files, personaRoles });
  assert.ok(
    findings.some((f) => f.finding_type === "unregistered_persona_skill" && f.role === "marketing-lead" && f.skill === "growth:notreg"),
    `expected unregistered_persona_skill, got: ${findings.map((f) => f.finding_type).join("; ")}`,
  );
});

test("current persona bold-backtick with NO dispatch verb → NOT flagged", () => {
  const files = [
    baseFiles[0], baseFiles[1],
    { skill: "growth:notreg", path: "nr.md", body: "- **`marketing-lead`** owns the EQ scoring rubric and the SCALE/TEST/SKIP call.\n" },
  ];
  const personaRoles = new Set(["product-lead", "director-of-product", "director-of-growth", "copy-lead", "marketing-lead"]);
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: files, personaRoles });
  assert.deepStrictEqual(findings, [],
    `bold-backtick without a dispatch verb must not flag, got: ${findings.map((f) => f.finding_type).join("; ")}`);
});

test("same hardcode but allowlisted → info, not findings", () => {
  const files = [
    baseFiles[1],
    { skill: "roadmap:next", path: realFile("roadmap:next"), body: "subagent_type: product-lead\n" },
  ];
  const { findings, info } = evaluate({
    registry: coherentReg, roleIds: ROLE_IDS, commandFiles: files, allowlist: new Set(["roadmap:next"]),
  });
  assert.ok(!findings.some((f) => f.finding_type === "hardcoded_role"), "allowlisted hardcode must not be a finding");
  assert.ok(info.some((f) => f.finding_type === "hardcoded_role" && f.skill === "roadmap:next"), "allowlisted hardcode must be tracked in info");
});

test("allowlisted skill with no hardcode → stale_allowlist_entry", () => {
  const { findings } = evaluate({
    registry: coherentReg, roleIds: ROLE_IDS, commandFiles: baseFiles, allowlist: new Set(["roadmap:next"]),
  });
  assert.ok(
    findings.some((f) => f.finding_type === "stale_allowlist_entry" && f.skill === "roadmap:next"),
    `expected stale_allowlist_entry, got: ${findings.map((f) => f.finding_type).join("; ")}`,
  );
});

test("registered skill with no command file → phantom_skill_entry", () => {
  const reg = { skills: {
    "ghost:skill": { domain: "product", hooks: [{ hook_point: "pick", role: "product-lead" }] },
  } };
  const { findings } = evaluate({ registry: reg, roleIds: ROLE_IDS, commandFiles: [] });
  assert.ok(
    findings.some((f) => f.finding_type === "phantom_skill_entry" && f.skill === "ghost:skill"),
    `expected phantom_skill_entry, got: ${findings.map((f) => f.finding_type).join("; ")}`,
  );
});

test("subagent_type: general-purpose / beta → NOT flagged", () => {
  const files = [
    ...baseFiles,
    { skill: "models:check", path: "m.md", body: "subagent_type: general-purpose\n" },
    { skill: "mode:adhoc", path: "a.md", body: 'subagent_type: "beta"\nsubagent_type: "gamma"\n' },
  ];
  const { findings } = evaluate({ registry: coherentReg, roleIds: ROLE_IDS, commandFiles: files });
  assert.deepStrictEqual(findings, [], `generics/faces must not flag, got: ${findings.map((f) => f.finding_type).join("; ")}`);
});

test("integration: real enforcer process runs and emits OK or FAIL on the live tree", () => {
  let out = "";
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, "skill-hook-coverage.js")], {
      encoding: "utf8", cwd: ROOT,
    });
  } catch (e) {
    assert.strictEqual(e.status, 1, `enforcer must exit 0 or 1, got status ${e.status}: ${e.stderr || e.message}`);
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  assert.ok(/\[skill-hook-coverage\]/.test(out), `expected a skill-hook-coverage status line, got: ${out}`);
});

if (failures.length) {
  process.stderr.write(`skill-hook-coverage bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`skill-hook-coverage bite-test: ${passed}/${passed} passed (positive + bite classes [stale-prose, stale-ok, unregistered-prose, no-verb, worker-scrap, subagent_type, allowlist, rot, phantom, generics] + persona-narrow sanity + integration)\n`);
process.exit(0);
