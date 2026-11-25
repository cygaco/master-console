"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const GUARD = path.join(__dirname, "agent-spawn-model-guard.js");
const FIX_FRAGMENTS = [
  "node scripts/dispatch/model-resolve.js --sync-specs",
];

const CATALOG_OK = `module.exports = { PROVIDERS: { claude: { models: [
  { id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }, { id: "claude-fable-5-2" }
] }, openai: { models: [{ id: "gpt-6.1-sol" }] } } };\n`;

const SPECS = {
  ".claude/agents/president/beta.md": { name: "beta", model: "gpt-6.1-sol" },
  ".claude/agents/product/quality-lead.md": { name: "quality-lead", model: "claude-opus-5-5" },
  ".claude/agents/product/quality/test-runner.md": { name: "test-runner", model: "claude-sonnet-5-5" },
  ".claude/agents/engineering/phantom.md": { name: "phantom-lead", model: "claude-opus-9-9" },
  ".claude/agents/president/inheritor.md": { name: "inheritor", model: "inherit" },
  ".claude/agents/president/no-model.md": { name: "no-model", model: null },
  ".claude/agents/growth/research-lead.md": { name: "research-lead", model: "gemini-4-argon-high" },
};

const REGISTRY_ROLES = {
  beta: { spec: ".claude/agents/president/beta.md" },
  "quality-lead": { spec: ".claude/agents/product/quality-lead.md" },
  "test-runner": { spec: ".claude/agents/product/quality/test-runner.md" },
  "phantom-lead": { spec: ".claude/agents/engineering/phantom.md" },
  inheritor: { spec: ".claude/agents/president/inheritor.md" },
  "no-model": { spec: ".claude/agents/president/no-model.md" },
};

const made = [];
test.after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `asmg-${tag}-`));
  made.push(d);
  return d;
}

function write(root, rel, text) {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function specText({ name, model }) {
  return ["---", `name: ${name}`, "description: fixture role", ...(model == null ? [] : [`model: ${model}`]), "---", "", "Fixture body.", ""].join("\n");
}

function makeTree(overrides = {}) {
  const root = tmpDir("fw");
  const files = {
    ".claude/agents/_org/role-registry.json": JSON.stringify({ roles: REGISTRY_ROLES }, null, 2),
    "scripts/dispatch/catalog.js": CATALOG_OK,
  };
  for (const [rel, s] of Object.entries(SPECS)) files[rel] = specText(s);
  Object.assign(files, overrides);
  for (const [rel, text] of Object.entries(files)) if (text != null) write(root, rel, text);
  return root;
}

function run(projectDir, toolInput, { cwd = projectDir, extra = {} } = {}) {
  const payload = { tool_name: "Agent", cwd, tool_input: toolInput, ...extra };
  const r = spawnSync(process.execPath, [GUARD], {
    input: typeof toolInput === "string" ? toolInput : JSON.stringify(payload),
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  return { exit: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function assertBlocked(r, { role, model, spec }) {
  assert.strictEqual(r.exit, 2, `expected exit 2 (refused), got ${r.exit}; stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim());
  assert.strictEqual(out.decision, "block");
  for (const piece of [`"${role}"`, `"${model}"`, spec, `node scripts/dispatch/harness-spawn-model.js ${role}`, ...FIX_FRAGMENTS]) {
    assert.ok(out.reason.includes(piece), `refusal should name ${piece}: ${out.reason}`);
  }
  assert.ok(r.stderr.includes(out.reason), "the refusal reason is also on stderr");
}

function assertAllowedSilently(r) {
  assert.strictEqual(r.exit, 0, `expected exit 0 (allowed), got ${r.exit}; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.strictEqual(r.stdout.trim(), "", "an allow writes nothing to stdout");
  assert.strictEqual(r.stderr.trim(), "", "an allow writes nothing to stderr");
}

function assertAllowedWithOneWarning(r) {
  assert.strictEqual(r.exit, 0, `a crash must allow (exit 0), got ${r.exit}; stderr=${r.stderr}`);
  assert.strictEqual(r.stdout.trim(), "", "a crash allow writes nothing to stdout");
  const lines = r.stderr.split(/\r?\n/).filter((l) => l.trim());
  assert.strictEqual(lines.length, 1, `exactly one stderr warning line, got: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /^\[agent-spawn-model-guard\] WARNING: could not check this spawn's model .*allowing it unchecked\.$/);
}

test("RED-1: an explicit non-Claude model param is refused, naming role, spec, model and fix", () => {
  const root = makeTree();
  assertBlocked(run(root, { subagent_type: "quality-lead", model: "gpt-6.1-sol", prompt: "x" }), {
    role: "quality-lead",
    model: "gpt-6.1-sol",
    spec: ".claude/agents/product/quality-lead.md",
  });
});

test("RED-2a: a non-Claude spec frontmatter with no model param is refused (registry spec path)", () => {
  const root = makeTree();
  assertBlocked(run(root, { subagent_type: "beta", name: "Beta", prompt: "x", run_in_background: true }), {
    role: "beta",
    model: "gpt-6.1-sol",
    spec: ".claude/agents/president/beta.md",
  });
});

test("RED-2b: a non-Claude spec found by frontmatter name (role not in the registry) is refused", () => {
  const root = makeTree();
  assertBlocked(run(root, { subagent_type: "research-lead", prompt: "x" }), {
    role: "research-lead",
    model: "gemini-4-argon-high",
    spec: ".claude/agents/growth/research-lead.md",
  });
});

test("RED-3: a Claude-looking id the catalog does not list is refused (spec and param)", () => {
  const root = makeTree();
  assertBlocked(run(root, { subagent_type: "phantom-lead", prompt: "x" }), {
    role: "phantom-lead",
    model: "claude-opus-9-9",
    spec: ".claude/agents/engineering/phantom.md",
  });
  assertBlocked(run(root, { subagent_type: "test-runner", model: "claude-opus-9-9", prompt: "x" }), {
    role: "test-runner",
    model: "claude-opus-9-9",
    spec: ".claude/agents/product/quality/test-runner.md",
  });
});

test("GREEN-a: a catalog Claude id passed as the param is allowed (even over a non-Claude spec)", () => {
  const root = makeTree();
  assertAllowedSilently(run(root, { subagent_type: "beta", model: "claude-sonnet-5-5", prompt: "x" }));
});

test("GREEN-b: a harness alias passed as the param is allowed (sonnet, opus, haiku, fable)", () => {
  const root = makeTree();
  for (const alias of ["sonnet", "opus", "haiku", "fable", "Opus"]) {
    assertAllowedSilently(run(root, { subagent_type: "beta", model: alias, prompt: "x" }));
  }
});

test("GREEN-c: an absent model with a Claude spec is allowed; a spec with no model or `inherit` too", () => {
  const root = makeTree();
  assertAllowedSilently(run(root, { subagent_type: "test-runner", prompt: "x" }));
  assertAllowedSilently(run(root, { subagent_type: "no-model", prompt: "x" }));
  assertAllowedSilently(run(root, { subagent_type: "inheritor", prompt: "x" }));
  assertAllowedSilently(run(root, { subagent_type: "inheritor", model: "inherit", prompt: "x" }));
});

test("GREEN-d: a built-in agent type (no spec in the project) is allowed", () => {
  const root = makeTree();
  for (const type of ["general-purpose", "Explore", "Plan", "claude-code-guide", "statusline-setup", "fork"]) {
    assertAllowedSilently(run(root, { subagent_type: type, prompt: "x" }));
  }
  assertAllowedSilently(run(root, { prompt: "no subagent_type = the harness default" }));
});

test("GREEN-roster: a conductor-made roster spawn (quality-lead + scopeContract, no model param) is allowed", () => {
  const root = makeTree();
  const prompt =
    "Review the gauntlet evidence for the sprint.\n\nscopeContract: " +
    JSON.stringify({ allowedFiles: ["runtime/review/**"], forbiddenFiles: ["scripts/**"] });
  assertAllowedSilently(run(root, { subagent_type: "quality-lead", name: "QualityLead", prompt }));
});

test("SCOPE: a foreign project dir (no registry, no catalog) is allowed silently, even for a refusable spawn", () => {
  const foreign = tmpDir("foreign");
  write(foreign, ".claude/agents/president/beta.md", specText({ name: "beta", model: "gpt-6.1-sol" }));
  assertAllowedSilently(run(foreign, { subagent_type: "beta", prompt: "x" }));
  assertAllowedSilently(run(foreign, { subagent_type: "general-purpose", model: "gpt-6.1-sol", prompt: "x" }));
});

test("SCOPE: a spawn whose cwd is a sibling repo is allowed silently; a cwd inside the project is checked", () => {
  const root = makeTree();
  const sibling = tmpDir("sibling");
  assertAllowedSilently(run(root, { subagent_type: "beta", prompt: "x" }, { cwd: sibling }));
  const inside = path.join(root, ".claude", "worktrees", "lane-x");
  fs.mkdirSync(inside, { recursive: true });
  assertBlocked(run(root, { subagent_type: "beta", prompt: "x" }, { cwd: inside }), {
    role: "beta",
    model: "gpt-6.1-sol",
    spec: ".claude/agents/president/beta.md",
  });
});

test("SCOPE: non-Agent and PostToolUse payloads are ignored", () => {
  const root = makeTree();
  assertAllowedSilently(run(root, { command: "ls" }, { extra: { tool_name: "Bash" } }));
  assertAllowedSilently(run(root, { subagent_type: "beta" }, { extra: { tool_response: { ok: true } } }));
});

test("CRASH: a catalog that will not load -> allow + one stderr warning line", () => {
  const root = makeTree({ "scripts/dispatch/catalog.js": "throw new Error('catalog exploded');\n" });
  const r = run(root, { subagent_type: "quality-lead", prompt: "x" });
  assertAllowedWithOneWarning(r);
  assert.match(r.stderr, /catalog exploded/);
});

test("CRASH: a catalog with no Claude models -> allow + one stderr warning line", () => {
  const root = makeTree({ "scripts/dispatch/catalog.js": "module.exports = { PROVIDERS: {} };\n" });
  assertAllowedWithOneWarning(run(root, { subagent_type: "quality-lead", prompt: "x" }));
});

test("CRASH: an unterminated spec frontmatter -> allow + one stderr warning line", () => {
  const root = makeTree({ ".claude/agents/president/beta.md": "---\nname: beta\nmodel: gpt-6.1-sol\nno closing fence\n" });
  const r = run(root, { subagent_type: "beta", prompt: "x" });
  assertAllowedWithOneWarning(r);
  assert.match(r.stderr, /never closed/);
});

test("CRASH: a registry that is not JSON, or a payload that is not JSON -> allow + one stderr warning line", () => {
  const root = makeTree({ ".claude/agents/_org/role-registry.json": "{ not json" });
  assertAllowedWithOneWarning(run(root, { subagent_type: "beta", prompt: "x" }));
  assertAllowedWithOneWarning(run(makeTree(), "{ this is not a payload"));
});

test("RED: a spec model line YAML could read differently (empty inline value, quoted key) is refused, naming the spec", () => {
  for (const [tag, fm] of [
    ["next-line", "---\nname: quality-lead\ndescription: d\nmodel:\n  gpt-6.1-sol\n---\nbody\n"],
    ["quoted-key", "---\nname: quality-lead\ndescription: d\n\"model\": gpt-6.1-sol\n---\nbody\n"],
    ["block-scalar", "---\nname: quality-lead\ndescription: d\nmodel: >\n  gpt-6.1-sol\n---\nbody\n"],
  ]) {
    const root = makeTree({ ".claude/agents/product/quality-lead.md": fm });
    const r = run(root, { subagent_type: "quality-lead", prompt: "x" });
    assert.strictEqual(r.exit, 2, `${tag}: expected refusal, got ${r.exit} ${r.stderr}`);
    const out = JSON.parse(r.stdout.trim());
    assert.ok(out.reason.includes(".claude/agents/product/quality-lead.md") && /cannot read the way Claude Code does/.test(out.reason), `${tag}: ${out.reason}`);
  }
});

test("RED: a stray same-name copy of a REGISTERED role with a non-Claude model is refused", () => {
  const root = makeTree({ ".claude/agents/stray/quality-lead-copy.md": specText({ name: "quality-lead", model: "gpt-6.1-sol" }) });
  const r = run(root, { subagent_type: "quality-lead", prompt: "x" });
  assert.strictEqual(r.exit, 2, `expected refusal, got ${r.exit} ${r.stderr}`);
  assert.ok(JSON.parse(r.stdout.trim()).reason.includes("quality-lead-copy.md"));
  assertAllowedSilently(run(makeTree(), { subagent_type: "quality-lead", prompt: "x" }));
});

test("RED: duplicate model keys, and non-canonical column-0 keys (merge, explicit, flow, tagged), are refused", () => {
  for (const [tag, fm] of [
    ["duplicate-model", "---\nname: quality-lead\ndescription: d\nmodel: claude-opus-5-5\nmodel: gpt-6.1-sol\n---\nb\n"],
    ["merge-key", "---\nname: quality-lead\ndescription: d\n<<: {model: gpt-6.1-sol}\n---\nb\n"],
    ["explicit-key-comment", "---\nname: quality-lead\ndescription: d\n? model # c\n: gpt-6.1-sol\n---\nb\n"],
    ["tagged-key", "---\nname: quality-lead\ndescription: d\n!!str model: gpt-6.1-sol\n---\nb\n"],
  ]) {
    const root = makeTree({ ".claude/agents/product/quality-lead.md": fm });
    const r = run(root, { subagent_type: "quality-lead", prompt: "x" });
    assert.strictEqual(r.exit, 2, `${tag}: expected refusal, got ${r.exit} ${r.stderr}`);
  }
});

test("RED: an unregistered spec whose NAME key is non-canonical but mentions the role is a candidate and is refused", () => {
  const root = makeTree({ ".claude/agents/stray/odd.md": "---\n\"name\": research-lead\ndescription: d\nmodel: gpt-6.1-sol\n---\nb\n" });
  const root2 = makeTree({
    ".claude/agents/growth/research-lead.md": null,
    ".claude/agents/stray/odd.md": "---\n\"name\": research-lead\ndescription: d\nmodel: gpt-6.1-sol\n---\nb\n",
  });
  for (const rt of [root, root2]) {
    const r = run(rt, { subagent_type: "research-lead", prompt: "x" });
    assert.strictEqual(r.exit, 2, `expected refusal, got ${r.exit} ${r.stderr}`);
  }
  assertAllowedSilently(run(makeTree({ ".claude/agents/stray/odd.md": "---\n\"name\": someone-else\nmodel: gpt-6.1-sol\n---\nb\n" }), { subagent_type: "quality-lead", prompt: "x" }));
});

test("RED: an unregistered spec hiding its name behind a non-plain value (block, tag, anchor) is refused", () => {
  for (const [tag, nameLine] of [["block", "name: >-\n  research-lead"], ["tag", "name: !!str research-lead"], ["anchor", "name: &n research-lead"]]) {
    const root = makeTree({
      ".claude/agents/growth/research-lead.md": null,
      ".claude/agents/stray/odd.md": `---\n${nameLine}\ndescription: d\nmodel: gpt-6.1-sol\n---\nb\n`,
    });
    const r = run(root, { subagent_type: "research-lead", prompt: "x" });
    assert.strictEqual(r.exit, 2, `${tag}: expected refusal, got ${r.exit} ${r.stderr}`);
  }
});

test("GREEN: a column-0 block list (tools:\n- Read) is plain YAML and allowed; a substring is not a mention", () => {
  const listSpec = "---\nname: quality-lead\ndescription: d\ntools:\n- Read\n- Grep\nmodel: claude-opus-5-5\n---\nb\n";
  assertAllowedSilently(run(makeTree({ ".claude/agents/product/quality-lead.md": listSpec }), { subagent_type: "quality-lead", prompt: "x" }));
  const odd = "---\n\"name\": other\ndescription: about quality-leadership\nmodel: gpt-6.1-sol\n---\nb\n";
  assertAllowedSilently(run(makeTree({ ".claude/agents/stray/odd.md": odd }), { subagent_type: "quality-lead", prompt: "x" }));
});

const PIN_STUB = `const fs=require("fs"),path=require("path");
module.exports={resolveRole(role){const f=path.join(process.env.CLAUDE_PROJECT_DIR,".claude","pin-stub.json");
const s=JSON.parse(fs.readFileSync(f,"utf8"));if(s.throw)throw new Error(s.throw);return s[role]||{spawn:{pinned:false}};}};`;
const pinTree = (stub) => makeTree({ "scripts/dispatch/model-resolve.js": PIN_STUB, ".claude/pin-stub.json": JSON.stringify(stub) });
const QL = "quality-lead";

test("PIN RED: a pinned role spawned with NO alias, or with a WRONG alias, is denied with the exact fix", () => {
  const root = pinTree({ [QL]: { spawn: { pinned: true, model: "opus", effort: null } } });
  for (const input of [{ subagent_type: QL, prompt: "x" }, { subagent_type: QL, model: "sonnet", prompt: "x" }, { subagent_type: QL, model: "fable", prompt: "x" }]) {
    const r = run(root, input);
    assert.strictEqual(r.exit, 2, `${JSON.stringify(input)}: expected refusal, got ${r.exit}`);
    const reason = JSON.parse(r.stdout.trim()).reason;
    assert.match(reason, /re-issue the spawn with model: "opus"/);
    assert.match(reason, /node scripts\/dispatch\.js set quality-lead --default/);
  }
});

test("PIN GREEN: the pinned alias passes (case-insensitive)", () => {
  const root = pinTree({ [QL]: { spawn: { pinned: true, model: "opus", effort: null } } });
  assertAllowedSilently(run(root, { subagent_type: QL, model: "opus", prompt: "x" }));
  assertAllowedSilently(run(root, { subagent_type: QL, model: "Opus", prompt: "x" }));
});

test("PIN effort: a pinned effort must be passed (the Agent tool exposes effort); missing or wrong effort is denied", () => {
  const root = pinTree({ [QL]: { spawn: { pinned: true, model: "opus", effort: "xhigh" } } });
  for (const input of [{ subagent_type: QL, model: "opus", prompt: "x" }, { subagent_type: QL, model: "opus", effort: "high", prompt: "x" }]) {
    const r = run(root, input);
    assert.strictEqual(r.exit, 2, JSON.stringify(input));
    assert.match(JSON.parse(r.stdout.trim()).reason, /model: "opus" and effort: "xhigh"/);
  }
  assertAllowedSilently(run(root, { subagent_type: QL, model: "opus", effort: "xhigh", prompt: "x" }));
});

test("PIN unservable: a pin no alias reaches is denied, never substituted, and names the remove-pin fix", () => {
  const reason = "quality-lead is set to claude-opus-4-8, which no Agent-tool model alias (opus / sonnet / haiku / fable) reaches; an in-process pin chooses a tier, so it cannot be honoured and is not replaced. Fix: node scripts/dispatch.js set quality-lead --default (or pin a tier)";
  const root = pinTree({ [QL]: { spawn: { pinned: true, unservable: true, model: null, reason } } });
  for (const input of [{ subagent_type: QL, prompt: "x" }, { subagent_type: QL, model: "opus", prompt: "x" }]) {
    const r = run(root, input);
    assert.strictEqual(r.exit, 2);
    assert.match(JSON.parse(r.stdout.trim()).reason, /cannot be honoured and is not replaced.*set quality-lead --default/);
  }
});

test("PIN not pinned (e.g. a CLI-provider pin): the spawn stays on the spec default with no parameter", () => {
  assertAllowedSilently(run(pinTree({ [QL]: { spawn: { pinned: false } } }), { subagent_type: QL, prompt: "x" }));
});

test("PIN unreadable project layer / resolver failure: the spec default runs with ONE recorded warning", () => {
  const warned = pinTree({ [QL]: { spawn: { pinned: false }, warning: "the project layer (.claude/manifest.json agentProviders) could not be read (bad JSON); the product default runs" } });
  const r = run(warned, { subagent_type: QL, prompt: "x" });
  assert.strictEqual(r.exit, 0);
  assert.match(r.stderr, /WARNING: the project layer .* could not be read/);
  const thrown = pinTree({ throw: "boom" });
  const r2 = run(thrown, { subagent_type: QL, prompt: "x" });
  assert.strictEqual(r2.exit, 0);
  assert.match(r2.stderr, /WARNING: the model resolver could not say whether "quality-lead" is pinned/);
  const bad = makeTree({ "scripts/dispatch/model-resolve.js": PIN_STUB, ".claude/pin-stub.json": JSON.stringify({ throw: "boom" }) });
  assert.strictEqual(run(bad, { subagent_type: "beta", prompt: "x" }).exit, 2, "beta's non-Claude spec is still refused");
});

const REPO = path.join(__dirname, "..", "..");
const DOE = "director-of-engineering";
const DOE_SPEC = ".claude/agents/engineering/director-of-engineering.md";
function realTree(manifest) {
  const root = tmpDir("real");
  const presets = path.join(REPO, ".claude", "agents", "_org", "presets");
  write(root, ".claude/agents/_org/role-registry.json", fs.readFileSync(path.join(REPO, ".claude", "agents", "_org", "role-registry.json"), "utf8"));
  for (const f of fs.readdirSync(presets)) write(root, `.claude/agents/_org/presets/${f}`, fs.readFileSync(path.join(presets, f), "utf8"));
  write(root, DOE_SPEC, fs.readFileSync(path.join(REPO, ...DOE_SPEC.split("/")), "utf8"));
  write(root, "scripts/dispatch/model-resolve.js", `module.exports = require(${JSON.stringify(path.join(REPO, "scripts", "dispatch", "model-resolve.js"))});\n`);
  write(root, "scripts/dispatch/catalog.js", `module.exports = require(${JSON.stringify(path.join(REPO, "scripts", "dispatch", "catalog.js"))});\n`);
  write(root, ".claude/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  return root;
}
const realResolve = (root) => {
  const MR = require(path.join(REPO, "scripts", "dispatch", "model-resolve.js"));
  const o = {
    projectRoot: root,
    registryPath: path.join(root, ".claude", "agents", "_org", "role-registry.json"),
    manifestPath: path.join(root, ".claude", "manifest.json"),
    presetsDir: path.join(root, ".claude", "agents", "_org", "presets"),
    logPath: path.join(root, "log.jsonl"),
  };
  return { r: MR.resolveRole(DOE, { ...o, channel: "in-process" }), def: MR.specDefault(DOE, o) };
};
const spawnDoe = (root, extra) => run(root, { subagent_type: DOE, prompt: "x", ...extra });
const PRODUCT_DEFAULT = { model: "claude-opus-5-5", effort: "high" };

test("REAL-1: a valid Claude pin in the manifest is enforced; only its alias + effort passes; the product default is untouched", () => {
  const root = realTree({ agentProviders: { [DOE]: { provider: "claude", model: "claude-fable-5-2", effort: "high" } } });
  const { r, def } = realResolve(root);
  assert.deepEqual(def, PRODUCT_DEFAULT, "specDefault does not take the project pin");
  assert.deepEqual(r.spec_default, PRODUCT_DEFAULT);
  assert.deepEqual([r.spawn.pinned, r.spawn.model, r.spawn.effort], [true, "fable", "high"]);
  for (const extra of [{}, { model: "opus" }, { model: "sonnet" }, { model: "fable" }, { model: "opus", effort: "high" }]) {
    assert.strictEqual(spawnDoe(root, extra).exit, 2, `${JSON.stringify(extra)} must be denied`);
  }
  assertAllowedSilently(spawnDoe(root, { model: "fable", effort: "high" }));
});

test("REAL-2: a pin EQUAL to the product default is still a pin — a different alias is denied", () => {
  const root = realTree({ agentProviders: { [DOE]: { provider: "claude", model: "claude-opus-5-5", effort: "high" } } });
  const { r, def } = realResolve(root);
  assert.deepEqual(def, PRODUCT_DEFAULT);
  assert.deepEqual([r.source, r.spawn.pinned, r.spawn.model, r.spawn.effort], ["user-pin", true, "opus", "high"]);
  for (const extra of [{ model: "sonnet" }, { model: "fable", effort: "high" }, { model: "opus", effort: "medium" }]) {
    assert.strictEqual(spawnDoe(root, extra).exit, 2, `${JSON.stringify(extra)} must be denied`);
  }
  assertAllowedSilently(spawnDoe(root, { model: "opus", effort: "high" }));
});

test("REAL-3: no pin — the role is not pinned and the spawn may carry no parameter (unchanged)", () => {
  const root = realTree({ agentProviders: {} });
  const { r, def } = realResolve(root);
  assert.deepEqual(def, PRODUCT_DEFAULT);
  assert.deepEqual(r.spawn, { pinned: false, model: null, effort: null });
  for (const extra of [{}, { model: "sonnet" }, { model: "opus" }, { model: "fable", effort: "high" }]) {
    assertAllowedSilently(spawnDoe(root, extra));
  }
});

test("REAL-5: a provider-only entry (legacy string \"claude\", or {provider} with no model) names no tier and pins nothing", () => {
  for (const entry of ["claude", { provider: "claude" }]) {
    const root = realTree({ agentProviders: { [DOE]: entry } });
    const { r, def } = realResolve(root);
    assert.deepEqual(def, PRODUCT_DEFAULT);
    assert.deepEqual(r.spawn, { pinned: false, model: null, effort: null }, `${JSON.stringify(entry)} is not a spawn pin`);
    for (const extra of [{}, { model: "sonnet" }, { model: "opus" }, { model: "fable", effort: "high" }]) {
      assertAllowedSilently(spawnDoe(root, extra));
    }
  }
});

test("REAL-4: a non-default preset plus a pin never changes the product default the spec carries", () => {
  const root = realTree({ modelPreset: "spend-more-on-claude", agentProviders: { [DOE]: { provider: "claude", model: "claude-opus-5-5", effort: "medium" } } });
  const { r, def } = realResolve(root);
  assert.deepEqual(def, PRODUCT_DEFAULT);
  assert.deepEqual([r.spawn.pinned, r.spawn.model, r.spawn.effort], [true, "opus", "medium"]);
  assert.strictEqual(spawnDoe(root, { model: "fable", effort: "high" }).exit, 2, "the overlay's answer does not beat the project pin");
  assertAllowedSilently(spawnDoe(root, { model: "opus", effort: "medium" }));
});
