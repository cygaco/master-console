"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const find = require("./find");

const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), "find-empty-"));
const NOCACHE = { codexHome: EMPTY, claudeDir: EMPTY };
const listServed = (p, o) => find.listServed(p, { ...NOCACHE, ...o });
const runFind = (o) => find.runFind({ ...NOCACHE, ...o });

let n = 0;
function t(name, fn) {
  fn();
  n++;
  console.log("ok - " + name);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "find-"));
function put(rel, obj) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
}

put(".claude/agents/_org/presets/default.json", {
  chains: {
    alpha: [{ provider: "claude", model: "claude-opus-5-5" }],
    beta: [
      { provider: "antigravity", model: "gemini-4-argon-high" },
      { provider: "antigravity", model: "gemini-old-model" },
    ],
  },
});
put(".claude/agents/_org/role-registry.json", {
  roles: { sec: { provider: "antigravity", model: "gemini-old-model", second_pass: { provider: "openai", model: "gpt-x" } } },
});
put(".claude/agents/_org/panel-lane-manifest.json", {
  lanes: { agy: { provider: "antigravity", model: "gemini-4-argon-high" } },
});
put(".claude/manifest.json", { agentProviders: { zeta: { provider: "antigravity", model: "gemini-pin-gone" } } });
put("runtime/models-research/openai.json", {
  fetched_at: "2000-01-01",
  models: [
    { id: "gpt-new-1", display_name: "GPT New 1", status: "GA" },
    { id: "gpt-dead", status: "retired" },
    { id: "gpt-known", status: "GA" },
  ],
});

const fakeCatalog = {
  PROVIDERS: {
    claude: { id: "claude", models: [{ id: "claude-opus-5-5" }] },
    openai: { id: "openai", models: [{ id: "gpt-known" }] },
    antigravity: {
      id: "antigravity",
      models: [
        { id: "gemini-4-argon-high", agyModelName: "Gemini 4 Argon (High)" },
        { id: "gemini-old-model", agyModelName: "Gemini Old (High)" },
        { id: "gemini-pin-gone", agyModelName: "Gemini Pin (High)" },
      ],
    },
  },
};

const LISTING =
  "gemini-4-argon-high\tGemini 4 Argon (High)\ngemini-4-neon-high\tGemini 4 Neon (High)\n";
const FAILFAST =
  'error: invalid model selection\nAvailable models:\n  Gemini 4 Argon (High)\n  Gemini 4 Neon (High)\n\nusage...\n';

function mkExec(handlers, calls) {
  return (cmd, args, o) => {
    calls.push([cmd, ...args].join(" "));
    const key = Object.keys(handlers).find((k) => [cmd, ...args].join(" ").startsWith(k));
    return key ? handlers[key](o) : { code: 127, stdout: "", stderr: "", timedOut: false };
  };
}
const ok = (stdout, stderr) => () => ({ code: 0, stdout, stderr: stderr || "", timedOut: false });
const timeout = () => ({ code: null, stdout: "", stderr: "", timedOut: true });

t("agy models listing parses", () => {
  const calls = [];
  const r = listServed("antigravity", { root, exec: mkExec({ "agy models": ok(LISTING) }, calls) });
  assert.strictEqual(r.source, "cli:agy models");
  assert.deepStrictEqual(r.models.map((m) => m.id), ["gemini-4-argon-high", "gemini-4-neon-high"]);
  assert.strictEqual(r.models[1].displayName, "Gemini 4 Neon (High)");
  assert.strictEqual(calls.length, 1);
});

t("timeout falls back to the fail-fast listing", () => {
  const calls = [];
  const r = listServed("antigravity", {
    root,
    exec: mkExec(
      { "agy models": timeout, "agy --model": () => ({ code: 1, stdout: "", stderr: FAILFAST, timedOut: false }) },
      calls,
    ),
  });
  assert.strictEqual(r.source, "cli:agy --model <invalid>");
  assert.match(r.note, /timed out/);
  assert.deepStrictEqual(r.models.map((m) => m.id), ["gemini-4-argon-high", "gemini-4-neon-high"]);
});

t("non-zero exit and empty output both fall back", () => {
  for (const first of [() => ({ code: 3, stdout: "", stderr: "x", timedOut: false }), ok("")]) {
    const r = listServed("antigravity", {
      root,
      exec: mkExec({ "agy models": first, "agy --model": () => ({ code: 1, stdout: "", stderr: FAILFAST }) }, []),
    });
    assert.strictEqual(r.source, "cli:agy --model <invalid>");
  }
});

t("both agy paths failing falls back to a labelled snapshot or none", () => {
  const r = listServed("antigravity", { root, exec: mkExec({ "agy models": timeout, "agy --model": timeout }, []) });
  assert.strictEqual(r.source, "none");
  assert.deepStrictEqual(r.models, []);
});

t("snapshot fallback is labelled and drops retired rows", () => {
  const calls = [];
  const r = listServed("openai", { root, exec: mkExec({ "codex --help": ok("Commands:\n  exec  run\n") }, calls) });
  assert.strictEqual(r.source, "snapshot:openai.json");
  assert.deepStrictEqual(r.models.map((m) => m.id), ["gpt-new-1", "gpt-known"]);
  assert.match(r.note, /snapshot from 2000-01-01 — not a live listing/);
});

t("missing snapshot is source none, not a crash", () => {
  const r = listServed("claude", { root, exec: mkExec({ "claude --help": ok("Options:\n") }, []) });
  assert.strictEqual(r.source, "none");
  assert.match(r.note, /no snapshot/);
});

t("a help-listed models subcommand is used as a live source", () => {
  const r = listServed("claude", {
    root,
    exec: mkExec({ "claude --help": ok("Commands:\n  models  list\n"), "claude models": ok("m-1\tModel One\n") }, []),
  });
  assert.strictEqual(r.source, "cli:claude models");
  assert.strictEqual(r.models[0].id, "m-1");
});

t("runFind computes new and gone with where", () => {
  const exec = mkExec({ "agy models": ok(LISTING), "codex --help": ok(""), "claude --help": ok("") }, []);
  const res = runFind({ root, exec, catalog: fakeCatalog });
  const agy = res.labs.find((l) => l.provider === "antigravity");
  assert.deepStrictEqual(agy.new.map((m) => m.id), ["gemini-4-neon-high"]);
  const goneIds = agy.gone.map((g) => g.id).sort();
  assert.deepStrictEqual(goneIds, ["gemini-old-model", "gemini-pin-gone"]);
  const old = agy.gone.find((g) => g.id === "gemini-old-model");
  assert.strictEqual(old.where.length, 2);
  assert.ok(old.where.some((w) => w.includes("presets/default.json chains.beta[1]")));
  assert.ok(old.where.some((w) => w.includes("role-registry.json sec")));
  assert.ok(agy.gone.find((g) => g.id === "gemini-pin-gone").where[0].includes("agentProviders.zeta"));
  const oa = res.labs.find((l) => l.provider === "openai");
  assert.deepStrictEqual(oa.new.map((m) => m.id), ["gpt-new-1"]);
  assert.deepStrictEqual(oa.gone, [], "no gone claim from a snapshot");
});

t("main: --json prints the object, usage error exits 2", () => {
  const exec = mkExec({ "agy models": ok(LISTING) }, []);
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  let out = "";
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = () => true;
  let code, bad;
  try {
    code = find.main(["--json", "--provider", "antigravity"], { root, exec, catalog: fakeCatalog });
    bad = find.main(["--bogus"], { root, exec });
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  assert.strictEqual(code, 0);
  assert.strictEqual(bad, 2);
  assert.strictEqual(JSON.parse(out).labs.length, 1);
});

const NOW = Date.parse("2026-06-10T00:00:00Z");
const DAY = 86400000;
function fixtureHome(name, rel, obj) {
  const dir = path.join(root, name);
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
  return dir;
}
const noSub = mkExec({ "codex --help": ok(""), "claude --help": ok("") }, []);

t("a dropped agy row marks the listing partial and says so", () => {
  const dirty = LISTING + "bad id!\tBroken Row\n";
  const r = listServed("antigravity", { root, exec: mkExec({ "agy models": ok(dirty) }, []) });
  assert.strictEqual(r.source, "cli:agy models");
  assert.strictEqual(r.partial, true);
  assert.match(r.note, /1 listing row\(s\) could not be parsed/);
  const exec = mkExec({ "agy models": ok(dirty) }, []);
  const lab = runFind({ root, exec, catalog: fakeCatalog, provider: "antigravity" }).labs[0];
  assert.strictEqual(lab.goneChecked, false);
  assert.deepStrictEqual(lab.gone, []);
  assert.match(lab.goneNote, /partial listing/);
});

t("fail-fast parser skips an unparseable indented name and counts it", () => {
  const r = find.parseFailFastRows("Available models:\n  Gemini 4 Argon (High)\n  Weird; Name\n  Gemini 4 Neon (High)\n\nusage\n");
  assert.deepStrictEqual(r.rows.map((x) => x.displayName), ["Gemini 4 Argon (High)", "Gemini 4 Neon (High)"]);
  assert.strictEqual(r.dropped, 1);
});

t("the fail-fast fallback never claims gone", () => {
  const exec = mkExec(
    { "agy models": timeout, "agy --model": () => ({ code: 1, stdout: "", stderr: FAILFAST }), "codex --help": ok(""), "claude --help": ok("") },
    [],
  );
  const lab = runFind({ root, exec, catalog: fakeCatalog, provider: "antigravity" }).labs[0];
  assert.strictEqual(lab.goneChecked, false);
  assert.deepStrictEqual(lab.gone, []);
  assert.strictEqual(lab.goneNote, "partial listing");
});

t("fresh codex cache is the openai source and counts as live", () => {
  const home = fixtureHome("codex-fresh", "models_cache.json", {
    fetched_at: new Date(NOW - 2 * DAY).toISOString(),
    models: [{ slug: "gpt-known" }, { slug: "gpt-served-new", display_name: "GPT Served New" }, { slug: "codex-auto-review", visibility: "hide" }],
  });
  const r = listServed("openai", { root, exec: noSub, codexHome: home, now: NOW });
  assert.match(r.source, /^cli-cache:models_cache\.json \(fetched 2026-06-08/);
  assert.strictEqual(r.live, true);
  const lab = runFind({ root, exec: noSub, catalog: fakeCatalog, provider: "openai", codexHome: home, now: NOW }).labs[0];
  assert.deepStrictEqual(lab.new.map((m) => m.id), ["gpt-served-new"], "hidden rows are not offered as new");
  assert.strictEqual(lab.goneChecked, true);
});

t("an old codex cache is used but says its age and never claims gone", () => {
  const home = fixtureHome("codex-old", "models_cache.json", {
    fetched_at: new Date(NOW - 9 * DAY).toISOString(),
    models: [{ slug: "gpt-known" }],
  });
  const lab = runFind({ root, exec: noSub, catalog: fakeCatalog, provider: "openai", codexHome: home, now: NOW }).labs[0];
  assert.strictEqual(lab.goneChecked, false);
  assert.match(lab.goneNote, /9 days old/);
  assert.deepStrictEqual(lab.gone, []);
});

t("a missing codex cache falls back to the snapshot", () => {
  const r = listServed("openai", { root, exec: noSub, codexHome: path.join(root, "nowhere"), now: NOW });
  assert.strictEqual(r.source, "snapshot:openai.json");
});

t("codex home resolves from CODEX_HOME in the injected env", () => {
  const home = fixtureHome("codex-env", "models_cache.json", { fetched_at: new Date(NOW).toISOString(), models: [{ slug: "gpt-known" }] });
  const r = find.listServed("openai", { root, exec: noSub, env: { CODEX_HOME: home }, claudeDir: EMPTY, now: NOW });
  assert.match(r.source, /^cli-cache:models_cache\.json/);
});

t("claude model-catalog cache: newest -cc file wins, markers and other surfaces ignored", () => {
  const dir = path.join(root, "claude-home");
  const mk = (name, doc) => {
    fs.mkdirSync(path.join(dir, "cache", "model-catalog"), { recursive: true });
    fs.writeFileSync(path.join(dir, "cache", "model-catalog", name), JSON.stringify(doc));
  };
  const cat = (ids) => ({ config: { models: ids.map((id) => ({ id, name: id })) } });
  mk("a-cc.json", { fetchedAt: NOW - 5 * DAY, catalog: cat(["old-one"]) });
  mk("b-cc.json", { fetchedAt: NOW - 1 * DAY, catalog: cat(["claude-opus-5-5", "claude-new-x"]) });
  mk("c-cc.headless-failed.json", { failedAt: NOW, failures: 1 });
  mk("d-ccd.json", { fetchedAt: NOW, catalog: cat(["wrong-surface"]) });
  const r = listServed("claude", { root, exec: noSub, claudeDir: dir, now: NOW });
  assert.match(r.source, /^cli-cache:model-catalog \(fetched /);
  assert.deepStrictEqual(r.models.map((m) => m.id), ["claude-opus-5-5", "claude-new-x"]);
  assert.strictEqual(r.live, true);
});

t("claude with no listing keeps the snapshot and says it is not live", () => {
  const nowhere = path.join(root, "nowhere");
  assert.strictEqual(listServed("claude", { root, exec: noSub, claudeDir: nowhere }).source, "none");
  put("runtime/models-research/claude.json", { fetched_at: "2026-01-02", models: [{ id: "claude-opus-5-5" }] });
  const s = listServed("claude", { root, exec: noSub, claudeDir: nowhere });
  assert.strictEqual(s.source, "snapshot:claude.json");
  assert.match(s.note, /snapshot from 2026-01-02 — not a live listing/);
});

t("gone includes manifest default models and string-form agentProviders pins", () => {
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), "find-cfg-"));
  const w = (rel, obj) => {
    const p = path.join(r2, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  };
  w(".claude/agents/_org/role-registry.json", { roles: { strrole: { provider: "antigravity", spec: ".claude/agents/strrole.md" } } });
  w(".claude/agents/strrole.md", "---\nprovider_model: gemini-string-pin\n---\nbody\n");
  w(".claude/manifest.json", {
    agentProviders: { strrole: "antigravity" },
    providers: { antigravity: { default_model: "gemini-default-gone" }, openai: { default_model: "gpt-known" } },
  });
  try {
    const choices = find.configuredChoices(r2);
    assert.ok(choices.some((c) => c.model === "gemini-default-gone" && /providers\.antigravity\.default_model/.test(c.where)));
    assert.ok(choices.some((c) => c.model === "gemini-string-pin" && /agentProviders\.strrole/.test(c.where)));
    const exec = mkExec({ "agy models": ok(LISTING), "codex --help": ok(""), "claude --help": ok("") }, []);
    const lab = runFind({ root: r2, exec, catalog: fakeCatalog, provider: "antigravity" }).labs[0];
    assert.deepStrictEqual(lab.gone.map((g) => g.id).sort(), ["gemini-default-gone", "gemini-string-pin"]);
  } finally {
    fs.rmSync(r2, { recursive: true, force: true });
  }
});

t("human output: gone line states why it was not checked", () => {
  const exec = mkExec(
    { "agy models": timeout, "agy --model": () => ({ code: 1, stdout: "", stderr: FAILFAST }), "codex --help": ok(""), "claude --help": ok("") },
    [],
  );
  let out = "";
  const realOut = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try {
    find.main(["--provider", "antigravity"], { root, exec, catalog: fakeCatalog, codexHome: EMPTY, claudeDir: EMPTY });
  } finally {
    process.stdout.write = realOut;
  }
  assert.match(out, /gone: not checked \(partial listing\)/);
});

fs.rmSync(EMPTY, { recursive: true, force: true });
fs.rmSync(root, { recursive: true, force: true });
console.log(`${n} passed`);
