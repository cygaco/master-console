#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const rr = require("./registry-roles");

const REGISTRY = path.resolve(__dirname, "..", "..", ".claude", "agents", "_org", "role-registry.json");
const ROLE = "security-reviewer";
const SPEC = ".claude/agents/engineering/security/reviewer.md";

let passed = 0;
const failures = [];
function test(n, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${n}: ${e.message}`);
  }
}

function project(manifest, specFrontmatter) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "passes-"));
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  if (manifest !== undefined) {
    fs.writeFileSync(path.join(root, ".claude", "manifest.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  }
  if (specFrontmatter) {
    fs.mkdirSync(path.join(root, path.dirname(SPEC)), { recursive: true });
    fs.writeFileSync(path.join(root, SPEC), `---\n${specFrontmatter}\n---\nbody\n`);
  }
  return {
    opts: { projectRoot: root, manifestPath: path.join(root, ".claude", "manifest.json"), registryPath: REGISTRY },
    done: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
function withProject(manifest, spec, fn) {
  const p = project(manifest, spec);
  try {
    fn(p.opts);
  } finally {
    p.done();
  }
}
const passes = (opts) => rr.passesOf(ROLE, rr.loadRoles(REGISTRY), opts);

function unmodifiedReading(role, roles) {
  const r = roles[role];
  if (!r) return [];
  const out = [{ provider: r.provider, model: r.model || null, effort: r.effort || null, key: "primary" }];
  for (const key of ["second_pass", "third_pass"]) {
    const p = r[key];
    if (p && p.provider) out.push({ provider: p.provider, model: p.model || null, effort: p.effort || null, key, ...(typeof p.route === "string" && p.route ? { route: p.route } : {}) });
  }
  return out;
}

const ROLES = rr.loadRoles(REGISTRY);

test("no manifest at all: passes equal the unmodified registry reading", () => {
  withProject(undefined, null, (o) => assert.deepStrictEqual(passes(o), unmodifiedReading(ROLE, ROLES)));
});
test("manifest with no pin and no reviewPasses: passes equal the unmodified registry reading", () => {
  withProject({ agentProviders: {}, mc: {} }, null, (o) => assert.deepStrictEqual(passes(o), unmodifiedReading(ROLE, ROLES)));
});
test("a pin on a DIFFERENT role changes nothing", () => {
  withProject({ agentProviders: { "backend-builder": "openai" } }, null, (o) => assert.deepStrictEqual(passes(o), unmodifiedReading(ROLE, ROLES)));
});
test("registryPassesOf is the registry row alone (ignores the project layer)", () => {
  withProject({ agentProviders: { [ROLE]: { provider: "claude", model: "claude-opus-5-5", effort: "high" } } }, null, (o) => {
    assert.deepStrictEqual(rr.registryPassesOf(ROLE, ROLES), unmodifiedReading(ROLE, ROLES));
    assert.notDeepStrictEqual(passes(o), unmodifiedReading(ROLE, ROLES));
  });
});
test("unknown role: []", () => {
  assert.deepStrictEqual(rr.passesOf("no-such-role", ROLES), []);
  assert.deepStrictEqual(rr.passesOf("__proto__", ROLES), []);
});
test("the shipped registry's three passes are what the readers see with no project layer", () => {
  withProject(undefined, null, (o) => {
    const p = passes(o);
    assert.deepStrictEqual(p.map((x) => x.key), ["primary", "second_pass", "third_pass"]);
    assert.deepStrictEqual(p.map((x) => x.provider), ["antigravity", "openai", "claude"]);
    assert.ok(p.every((x) => x.warning === undefined && x.source === undefined));
  });
});

test("primary: an in-process (object form) pin is taken from the project layer", () => {
  withProject({ agentProviders: { [ROLE]: { provider: "claude", model: "claude-opus-5-5", effort: "high" } } }, null, (o) => {
    const p = passes(o);
    assert.deepStrictEqual({ provider: p[0].provider, model: p[0].model, effort: p[0].effort, key: p[0].key, source: p[0].source }, { provider: "claude", model: "claude-opus-5-5", effort: "high", key: "primary", source: "project" });
    assert.deepStrictEqual(p.slice(1), unmodifiedReading(ROLE, ROLES).slice(1));
  });
});
test("primary: a CLI pin (provider string + spec frontmatter) is taken from the project layer", () => {
  withProject({ agentProviders: { [ROLE]: "openai" } }, "provider: openai\nprovider_model: gpt-5.6-sol\nprovider_reasoning_effort: high", (o) => {
    const p = passes(o)[0];
    assert.strictEqual(p.provider, "openai");
    assert.strictEqual(p.model, "gpt-5.6-sol");
    assert.strictEqual(p.effort, "high");
    assert.strictEqual(p.source, "project");
  });
});
test("primary: an invalid pin (model not in the catalog) is ignored, default kept, plain warning on the pass", () => {
  withProject({ agentProviders: { [ROLE]: "openai" } }, "provider: openai\nprovider_model: not-a-real-model", (o) => {
    const p = passes(o);
    const want = unmodifiedReading(ROLE, ROLES);
    assert.strictEqual(p[0].provider, want[0].provider);
    assert.strictEqual(p[0].model, want[0].model);
    assert.match(p[0].warning, /primary choice for security-reviewer ignored/);
    assert.match(p[0].warning, /using the product default/);
    assert.strictEqual(p[0].source, undefined);
  });
});
test("primary: an unsupported effort is ignored with a warning", () => {
  withProject({ agentProviders: { [ROLE]: { provider: "openai", model: "gpt-5.6-sol", effort: "bogus" } } }, null, (o) => {
    const p = passes(o)[0];
    assert.strictEqual(p.provider, "antigravity");
    assert.match(p.warning, /Effort "bogus"/);
  });
});
test("primary: a pin naming a provider the product does not know is ignored with a warning", () => {
  withProject({ agentProviders: { [ROLE]: { provider: "mystery", model: "x" } } }, null, (o) => {
    const p = passes(o)[0];
    assert.strictEqual(p.provider, "antigravity");
    assert.ok(p.warning);
  });
});

test("second_pass: a valid choice replaces only that pass", () => {
  withProject({ reviewPasses: { [ROLE]: { second_pass: { provider: "claude", model: "claude-opus-5-5", effort: "high" } } } }, null, (o) => {
    const p = passes(o);
    const want = unmodifiedReading(ROLE, ROLES);
    assert.strictEqual(p[1].provider, "claude");
    assert.strictEqual(p[1].effort, "high");
    assert.strictEqual(p[1].key, "second_pass");
    assert.strictEqual(p[1].source, "project");
    assert.deepStrictEqual(p[0], want[0]);
    assert.deepStrictEqual(p[2], want[2]);
  });
});
test("third_pass: a valid choice without effort keeps effort null", () => {
  withProject({ reviewPasses: { [ROLE]: { third_pass: { provider: "openai", model: "gpt-5.6-sol" } } } }, null, (o) => {
    const p = passes(o)[2];
    assert.strictEqual(p.provider, "openai");
    assert.strictEqual(p.effort, null);
  });
});
test("an invalid second_pass keeps its default and warns; the other passes are untouched and clean", () => {
  withProject({ reviewPasses: { [ROLE]: { second_pass: { provider: "openai", model: "gpt-9-imaginary" } } } }, null, (o) => {
    const p = passes(o);
    const want = unmodifiedReading(ROLE, ROLES);
    assert.strictEqual(p[1].provider, want[1].provider);
    assert.strictEqual(p[1].model, want[1].model);
    assert.match(p[1].warning, /second_pass choice for security-reviewer ignored/);
    assert.strictEqual(p[0].warning, undefined);
    assert.strictEqual(p[2].warning, undefined);
  });
});
test("a choice that is not an object is ignored with a warning", () => {
  withProject({ reviewPasses: { [ROLE]: { second_pass: "openai" } } }, null, (o) => {
    const p = passes(o)[1];
    assert.strictEqual(p.provider, "openai");
    assert.strictEqual(p.model, "gpt-6.2-sol", "falls back to the shipped registry default for the second pass");
    assert.ok(p.warning);
  });
});
test("reviewPasses that is not an object warns on every extra pass and changes nothing", () => {
  withProject({ reviewPasses: ["x"] }, null, (o) => {
    const p = passes(o);
    const want = unmodifiedReading(ROLE, ROLES);
    assert.strictEqual(p[1].warning !== undefined && p[2].warning !== undefined, true);
    assert.deepStrictEqual(p.map((x) => [x.provider, x.model]), want.map((x) => [x.provider, x.model]));
  });
});
test("a project cannot add a pass the registry row does not declare", () => {
  const roles = { solo: { tier: "worker", provider: "claude", model: "claude-opus-5-5", effort: "high" } };
  withProject({ reviewPasses: { solo: { second_pass: { provider: "openai", model: "gpt-5.6-sol", effort: "high" } } } }, null, (o) => {
    assert.deepStrictEqual(rr.passesOf("solo", roles, o), unmodifiedReading("solo", roles));
  });
});
test("a choice for a different role does not leak into this one", () => {
  withProject({ reviewPasses: { "other-role": { second_pass: { provider: "claude", model: "claude-opus-5-5" } } } }, null, (o) => {
    assert.deepStrictEqual(passes(o), unmodifiedReading(ROLE, ROLES));
  });
});
test("prototype-looking keys in the project layer are not read as choices", () => {
  withProject('{"reviewPasses":{"__proto__":{"second_pass":{"provider":"claude","model":"claude-opus-5-5"}}}}', null, (o) => {
    assert.deepStrictEqual(passes(o), unmodifiedReading(ROLE, ROLES));
  });
});

test("malformed manifest: every pass is blocked (the review holds), the passes still list so the role keeps routing as a panel", () => {
  withProject("{ not json", null, (o) => {
    const p = passes(o);
    const want = unmodifiedReading(ROLE, ROLES);
    assert.deepStrictEqual(p.map((x) => [x.provider, x.model, x.key]), want.map((x) => [x.provider, x.model, x.key]));
    assert.ok(p.every((x) => typeof x.blocked === "string" && /could not be read/.test(x.blocked)), JSON.stringify(p.map((x) => x.blocked)));
  });
});
test("manifest that is not a JSON object, or is a directory (unreadable): blocked", () => {
  withProject("[1,2]", null, (o) => assert.ok(passes(o).every((x) => x.blocked)));
  withProject(undefined, null, (o) => {
    fs.mkdirSync(o.manifestPath);
    assert.ok(passes(o).every((x) => x.blocked));
  });
});
test("an ABSENT manifest keeps the defaults, unblocked; an invalid single choice warns but does not block", () => {
  withProject(undefined, null, (o) => assert.ok(passes(o).every((x) => x.blocked === undefined)));
  withProject({ reviewPasses: { [ROLE]: { second_pass: { provider: "openai", model: "nope" } } } }, null, (o) => {
    const p = passes(o);
    assert.ok(p.every((x) => x.blocked === undefined));
    assert.ok(p[1].warning);
  });
});

test("route: only the shipped third pass (the Claude hunter) carries route in-process", () => {
  withProject(undefined, null, (o) => {
    const p = passes(o);
    assert.deepStrictEqual(p.map((x) => x.route), [undefined, undefined, "in-process"]);
  });
});
test("route: a project choosing a CLI lab for the third pass drops the in-process route (it is fired as a CLI pass)", () => {
  withProject({ reviewPasses: { [ROLE]: { third_pass: { provider: "openai", model: "gpt-5.6-sol", effort: "high" } } } }, null, (o) => {
    assert.strictEqual(passes(o)[2].route, undefined);
  });
});
test("route: a project choosing another Claude model for the third pass keeps the in-process route", () => {
  withProject({ reviewPasses: { [ROLE]: { third_pass: { provider: "claude", model: "claude-opus-5-5", effort: "high" } } } }, null, (o) => {
    assert.strictEqual(passes(o)[2].route, "in-process");
    assert.strictEqual(passes(o)[2].effort, "high");
  });
});

test("the shipped manifest has no reviewPasses block and no security fallback switch", () => {
  const m = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", ".claude", "manifest.json"), "utf8"));
  assert.ok(!Object.prototype.hasOwnProperty.call(m, "reviewPasses"), "reviewPasses must not ship");
  assert.ok(!(m.mc && Object.prototype.hasOwnProperty.call(m.mc, "securityClaudeOnlyFallback")), "the opt-in must not ship");
  assert.deepStrictEqual(m.agentProviders, {});
});

if (failures.length) {
  process.stderr.write(`FAIL [registry-roles.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [registry-roles.test] ${passed} passed\n`);
