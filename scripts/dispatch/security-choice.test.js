#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sc = require("./security-choice");

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
async function atest(n, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${n}: ${e.message}`);
  }
}

function tmpManifest(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "choice-"));
  const file = path.join(dir, "manifest.json");
  if (content !== undefined) fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return { file, dir };
}

const BASE = [
  { provider: "antigravity", model: "gemini-4-argon-high", effort: null, key: "primary" },
  { provider: "openai", model: "gpt-5.6-sol", effort: "xhigh", key: "second_pass" },
  { provider: "claude", model: "claude-opus-5-5", effort: "max", key: "third_pass" },
];

test("tupleProblem: a catalog tuple is fine", () => assert.strictEqual(sc.tupleProblem({ provider: "openai", model: "gpt-5.6-sol", effort: "xhigh" }), null));
test("tupleProblem: refuses a non-object, an unknown provider, no model, a bad effort, an unknown model", () => {
  assert.ok(sc.tupleProblem(null));
  assert.ok(sc.tupleProblem("openai"));
  assert.ok(sc.tupleProblem({ provider: "gemini", model: "x" }));
  assert.ok(sc.tupleProblem({ provider: "openai" }));
  assert.ok(sc.tupleProblem({ provider: "openai", model: "  " }));
  assert.ok(sc.tupleProblem({ provider: "openai", model: "gpt-5.6-sol", effort: 5 }));
  assert.ok(sc.tupleProblem({ provider: "openai", model: "gpt-5.6-sol", effort: "bogus" }));
  assert.ok(sc.tupleProblem({ provider: "openai", model: "nope" }));
});
test("the registry's own three default tuples all validate (the default is something a user could also choose)", () => {
  for (const p of BASE) assert.strictEqual(sc.tupleProblem(p), null, `${p.provider}/${p.model}`);
});

test("loadProjectLayer: missing file → no data, no error", () => {
  const m = tmpManifest(undefined);
  assert.deepStrictEqual(sc.loadProjectLayer({ manifestPath: m.file }), { data: null, error: null });
});
test("loadProjectLayer: malformed JSON → an error text, no data", () => {
  const m = tmpManifest("{ nope");
  const r = sc.loadProjectLayer({ manifestPath: m.file });
  assert.strictEqual(r.data, null);
  assert.ok(r.error);
});
test("loadProjectLayer: a JSON array is not a manifest", () => {
  const m = tmpManifest("[1,2]");
  const r = sc.loadProjectLayer({ manifestPath: m.file });
  assert.strictEqual(r.data, null);
  assert.ok(r.error);
});

test("applyProjectChoices: no project value → a new array equal to the input, input untouched", () => {
  const m = tmpManifest({});
  const before = JSON.stringify(BASE);
  const out = sc.applyProjectChoices("security-reviewer", BASE, { manifestPath: m.file, projectRoot: m.dir });
  assert.deepStrictEqual(out, BASE);
  assert.notStrictEqual(out, BASE);
  assert.notStrictEqual(out[0], BASE[0]);
  assert.strictEqual(JSON.stringify(BASE), before);
});
test("applyProjectChoices: both extra passes chosen at once", () => {
  const m = tmpManifest({
    reviewPasses: {
      "security-reviewer": {
        second_pass: { provider: "claude", model: "claude-opus-5-5", effort: "high" },
        third_pass: { provider: "openai", model: "gpt-5.6-sol", effort: "high" },
      },
    },
  });
  const out = sc.applyProjectChoices("security-reviewer", BASE, { manifestPath: m.file, projectRoot: m.dir });
  assert.deepStrictEqual(out.map((p) => p.provider), ["antigravity", "claude", "openai"]);
  assert.deepStrictEqual(out.map((p) => p.key), ["primary", "second_pass", "third_pass"]);
  assert.strictEqual(out[1].source, "project");
  assert.strictEqual(out[2].source, "project");
});
test("applyProjectChoices: an empty role or a prototype key returns the input unchanged", () => {
  const m = tmpManifest({ reviewPasses: { "__proto__": { second_pass: { provider: "claude", model: "claude-opus-5-5" } } } });
  assert.deepStrictEqual(sc.applyProjectChoices("__proto__", BASE, { manifestPath: m.file, projectRoot: m.dir }), BASE);
  assert.deepStrictEqual(sc.applyProjectChoices("security-reviewer", [], { manifestPath: m.file, projectRoot: m.dir }), []);
});

test("deriveDiversity: two labs = multi-lab; Claude alone = claude-only; another lab alone = single-lab; nothing = none", () => {
  assert.strictEqual(sc.deriveDiversity(["openai", "claude"]), "multi-lab");
  assert.strictEqual(sc.deriveDiversity(["claude", "claude"]), "claude-only");
  assert.strictEqual(sc.deriveDiversity(["openai", "openai"]), "single-lab");
  assert.strictEqual(sc.deriveDiversity([]), "none");
  assert.strictEqual(sc.deriveDiversity(undefined), "none");
  assert.strictEqual(sc.deriveDiversity([null, "", 5, {}]), "none");
});
test("checkDiversityClaim: a claim the stamps back is fine; no claim is fine", () => {
  assert.strictEqual(sc.checkDiversityClaim("multi-lab", ["openai", "claude"]).ok, true);
  assert.strictEqual(sc.checkDiversityClaim("claude-only", ["claude"]).ok, true);
  assert.strictEqual(sc.checkDiversityClaim(undefined, ["claude"]).ok, true);
});
test("checkDiversityClaim FALSIFIER: multi-lab over Claude-only stamps, a made-up value, null, and a wrong honest label are all refused", () => {
  const a = sc.checkDiversityClaim("multi-lab", ["claude"]);
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.derived, "claude-only");
  assert.match(a.reason, /claim refused/);
  assert.strictEqual(sc.checkDiversityClaim("banana", ["openai", "claude"]).ok, false);
  assert.strictEqual(sc.checkDiversityClaim(null, ["claude"]).ok, false);
  assert.strictEqual(sc.checkDiversityClaim("claude-only", ["openai", "claude"]).ok, false);
  assert.strictEqual(sc.checkDiversityClaim("multi-lab", []).ok, false);
});

test("claudeOnlyOptIn: exactly true under mc.securityClaudeOnlyFallback", () => {
  const m = tmpManifest({ mc: { securityClaudeOnlyFallback: true } });
  assert.strictEqual(sc.claudeOnlyOptIn({ manifestPath: m.file }), true);
});
test("claudeOnlyOptIn: absent / false / 'true' / 1 / 'yes' / null / wrong block / no manifest / bad manifest → off", () => {
  const off = (c) => sc.claudeOnlyOptIn({ manifestPath: tmpManifest(c).file });
  assert.strictEqual(off({}), false);
  assert.strictEqual(off({ mc: {} }), false);
  assert.strictEqual(off({ mc: { securityClaudeOnlyFallback: false } }), false);
  assert.strictEqual(off({ mc: { securityClaudeOnlyFallback: "true" } }), false);
  assert.strictEqual(off({ mc: { securityClaudeOnlyFallback: 1 } }), false);
  assert.strictEqual(off({ mc: { securityClaudeOnlyFallback: "yes" } }), false);
  assert.strictEqual(off({ mc: { securityClaudeOnlyFallback: null } }), false);
  assert.strictEqual(off({ securityClaudeOnlyFallback: true }), false, "wrong place");
  assert.strictEqual(off({ agentProviders: { securityClaudeOnlyFallback: true } }), false, "wrong place");
  assert.strictEqual(off(undefined), false, "no manifest");
  assert.strictEqual(off("{ nope"), false, "unreadable manifest");
  assert.strictEqual(off({ mc: [true] }), false);
});
test("claudeOnlyOptIn FALSIFIER: an env var cannot turn it on (any spelling), with or without a manifest", () => {
  const names = ["SECURITY_CLAUDE_ONLY_FALLBACK", "MC_SECURITY_CLAUDE_ONLY_FALLBACK", "securityClaudeOnlyFallback", "CLAUDE_ONLY_FALLBACK", "MC_CLAUDE_ONLY", "MC_SECURITY_CLAUDE_ONLY", "CLAUDE_ONLY"];
  const saved = {};
  for (const n of names) saved[n] = process.env[n];
  try {
    for (const n of names) process.env[n] = "1";
    assert.strictEqual(sc.claudeOnlyOptIn({ manifestPath: tmpManifest({ mc: {} }).file }), false);
    assert.strictEqual(sc.claudeOnlyOptIn({ manifestPath: tmpManifest(undefined).file }), false);
    for (const n of names) process.env[n] = "true";
    assert.strictEqual(sc.claudeOnlyOptIn({ manifestPath: tmpManifest({}).file }), false);
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
});
test("claudeOnlyOptIn FALSIFIER: an opts field or a record-shaped argument cannot turn it on", () => {
  const m = tmpManifest({});
  assert.strictEqual(sc.claudeOnlyOptIn({ manifestPath: m.file, optIn: true, securityClaudeOnlyFallback: true, mc: { securityClaudeOnlyFallback: true } }), false);
});
test("the shipped manifest and the shipped role registry carry no opt-in", () => {
  const shipped = path.resolve(__dirname, "..", "..", ".claude", "manifest.json");
  assert.strictEqual(sc.claudeOnlyOptIn({ manifestPath: shipped }), false);
  assert.ok(!fs.readFileSync(shipped, "utf8").includes("securityClaudeOnlyFallback"));
  assert.ok(!fs.readFileSync(path.resolve(__dirname, "..", "..", ".claude", "agents", "_org", "role-registry.json"), "utf8").includes("securityClaudeOnlyFallback"));
});

const HUNTER = (verdict = "pass") => ({ verdict, record: verdict === "pass" || verdict === "warn" ? { dispatch_id: "d-hunter", completed_at: "2000-01-01T00:00:00.000Z" } : null });
{
  const dead = (provider) => ({ pass: provider, provider, ok: false, verdict: "error" });
  const live = (provider, verdict) => ({ pass: provider, provider, ok: true, verdict });
  const lanes = () => [dead("antigravity"), dead("openai")];
  const ctx = (o = {}) => ({ optIn: true, signedIn: { claude: true, openai: false, antigravity: false }, hunter: HUNTER(), ...o });
  test("evaluateClaudeOnly: every condition met → accept (pass)", () => {
    const r = sc.evaluateClaudeOnly(lanes(), ctx());
    assert.deepStrictEqual(r, { accept: true, reason: null, verdict: "pass" });
  });
  test("evaluateClaudeOnly: a live review by another lab in this run refuses, whatever the Claude verdict says", () => {
    for (const verdict of ["pass", "warn"]) {
      const r = sc.evaluateClaudeOnly(lanes(), ctx({ hunter: { ...HUNTER(verdict), otherLabReview: { provider: "openai" } } }));
      assert.strictEqual(r.accept, false);
      assert.strictEqual(r.reason, "another lab reviewed this run; a Claude-only result cannot replace it");
    }
  });
  test("evaluateClaudeOnly: hunter warn → accept as warn", () => assert.strictEqual(sc.evaluateClaudeOnly(lanes(), ctx({ hunter: HUNTER("warn") })).verdict, "warn"));
  test("evaluateClaudeOnly: each condition missing alone → refused with a reason", () => {
    const cases = [
      [lanes(), ctx({ optIn: false })],
      [lanes(), ctx({ optIn: undefined })],
      [lanes(), null],
      [lanes(), ctx({ hunter: HUNTER("fail") })],
      [lanes(), ctx({ hunter: HUNTER("error") })],
      [lanes(), ctx({ hunter: undefined })],
      [lanes(), ctx({ signedIn: { claude: true, openai: true, antigravity: false } })],
      [lanes(), ctx({ signedIn: { claude: true, openai: false, antigravity: null } })],
      [lanes(), ctx({ signedIn: null })],
      [[dead("openai"), live("antigravity", "pass")], ctx()],
      [[dead("openai"), live("claude", "pass")], ctx()],
      [[dead("claude")], ctx()],
      [[dead("openai"), { ok: false }], ctx()],
      [[], ctx()],
      [null, ctx()],
    ];
    for (const [l, c] of cases) {
      const r = sc.evaluateClaudeOnly(l, c);
      assert.strictEqual(r.accept, false, JSON.stringify({ l, c }));
      assert.ok(typeof r.reason === "string" && r.reason.length > 0);
      assert.strictEqual(r.verdict, null);
    }
  });
  test("evaluateClaudeOnly: lanes cannot supply their own sign-in, opt-in or hunter verdict (only ctx counts)", () => {
    const sneaky = lanes().map((l) => ({ ...l, signedIn: false, optIn: true, hunter: HUNTER() }));
    assert.strictEqual(sc.evaluateClaudeOnly(sneaky, ctx({ optIn: false })).accept, false);
    assert.strictEqual(sc.evaluateClaudeOnly(sneaky, ctx({ signedIn: {} })).accept, false);
    assert.strictEqual(sc.evaluateClaudeOnly(sneaky, ctx({ hunter: undefined })).accept, false);
  });
}

(async () => {
  const rec = (o, c, a) => ({ providers: { claude: { signedIn: c }, openai: { signedIn: o }, antigravity: { signedIn: a } } });
  await atest("checkSignedIn: definite answers pass through", async () => {
    const r = await sc.checkSignedIn({ detect: async () => rec(false, true, false) });
    assert.deepStrictEqual(r, { claude: true, openai: false, antigravity: false });
  });
  await atest("checkSignedIn: unknown stays null (never read as signed out)", async () => {
    const r = await sc.checkSignedIn({ detect: async () => rec(null, true, null) });
    assert.deepStrictEqual(r, { claude: true, openai: null, antigravity: null });
  });
  await atest("checkSignedIn: a throwing check, a rejecting check, garbage, and non-boolean values all become unknown", async () => {
    const unknown = { claude: null, openai: null, antigravity: null };
    assert.deepStrictEqual(await sc.checkSignedIn({ detect: () => { throw new Error("x"); } }), unknown);
    assert.deepStrictEqual(await sc.checkSignedIn({ detect: async () => { throw new Error("x"); } }), unknown);
    assert.deepStrictEqual(await sc.checkSignedIn({ detect: async () => null }), unknown);
    assert.deepStrictEqual(await sc.checkSignedIn({ detect: async () => ({ providers: "x" }) }), unknown);
    assert.deepStrictEqual(await sc.checkSignedIn({ detect: async () => rec("no", 0, "false") }), unknown);
  });
  await atest("checkSignedIn: runs the real detector with tool seams and reads 'not installed' as signed out", async () => {
    const absent = (id) => ({ ok: false, reason: `tool '${id}' not found on PATH` });
    const r = await sc.checkSignedIn({ detectOpts: { resolveTool: absent, exec: async () => ({ exit: 0, stdout: "", stderr: "" }) } });
    assert.strictEqual(r.openai, false);
    assert.strictEqual(r.antigravity, false);
    assert.strictEqual(r.claude, false);
  });
  await atest("checkSignedIn FALSIFIER: a resolver that THROWS is doubt (unknown), never 'not installed'", async () => {
    const r = await sc.checkSignedIn({ detectOpts: { resolveTool: () => { throw new Error("resolver exploded"); }, exec: async () => ({ exit: 0, stdout: "", stderr: "" }) } });
    assert.deepStrictEqual(r, { claude: null, openai: null, antigravity: null });
    assert.strictEqual(sc.evaluateClaudeOnly([{ provider: "antigravity", ok: false }, { provider: "openai", ok: false }], { optIn: true, signedIn: r, hunter: HUNTER() }).accept, false);
  });
  await atest("checkSignedIn FALSIFIER: a safety refusal / unvalidated install (ok:false, any other reason) is unknown", async () => {
    const refuse = (id) => ({ ok: false, reason: `no safe codex candidate (C:/x: npm-package-unvalidated)` });
    const r = await sc.checkSignedIn({ detectOpts: { resolveTool: (id) => (id === "claude" ? { ok: false, reason: "tool 'claude' not found on PATH" } : refuse(id)), exec: async () => ({ exit: 0, stdout: "", stderr: "" }) } });
    assert.strictEqual(r.claude, false, "a clean not-found is still a confirmed absence");
    assert.strictEqual(r.openai, null);
    assert.strictEqual(r.antigravity, null);
    assert.strictEqual(await sc.checkSignedIn({ detectOpts: { resolveTool: () => ({ ok: false }), exec: async () => ({}) } }).then((x) => x.openai), null, "no reason at all is doubt");
    assert.strictEqual(await sc.checkSignedIn({ detectOpts: { resolveTool: () => null, exec: async () => ({}) } }).then((x) => x.openai), null);
  });
  await atest("checkSignedIn: a tool that resolved but timed out is unknown", async () => {
    const tool = { ok: true, kind: "binary", path: "x" };
    const r = await sc.checkSignedIn({ detectOpts: { resolveTool: () => tool, exec: async () => ({ exit: null, stdout: "", stderr: "" }) } });
    assert.deepStrictEqual(r, { claude: null, openai: null, antigravity: null });
  });
  await atest("checkSignedIn: a tool that is installed but says nothing readable is UNKNOWN, not signed out", async () => {
    const tool = { ok: true, kind: "binary", path: "x" };
    const r = await sc.checkSignedIn({ detectOpts: { resolveTool: () => tool, exec: async () => ({ exit: 0, stdout: "", stderr: "" }) } });
    assert.strictEqual(r.antigravity, null);
    assert.notStrictEqual(r.openai, false);
  });

  const dr = require("../dispatch-review");
  const dead = (provider) => ({ pass: provider, provider, ok: false, verdict: "error" });
  const L = (provider, verdict) => ({ pass: provider, provider, ok: true, verdict });
  const collapsed = () => [dead("antigravity"), dead("openai")];
  const plain = (lanes) => dr.mergeLanes("security-reviewer", lanes);
  const noCalls = () => {
    const calls = [];
    return { calls, deps: { optIn: () => false, checkSignedIn: async () => { calls.push("signin"); return {}; }, hunterEvidence: () => { calls.push("ledger"); return HUNTER(); } } };
  };
  await atest("glue: opt-in off → the merged result is returned untouched and no sign-in check or ledger read happens", async () => {
    const { calls, deps } = noCalls();
    const m = plain(collapsed());
    const out = await dr.applyClaudeOnlyFallback("security-reviewer", collapsed(), m, {}, deps);
    assert.strictEqual(out, m);
    assert.deepStrictEqual(calls, []);
  });
  await atest("glue: opt-in value other than exactly true → untouched", async () => {
    for (const v of ["true", 1, undefined, null, {}]) {
      const m = plain(collapsed());
      const out = await dr.applyClaudeOnlyFallback("security-reviewer", collapsed(), m, {}, { optIn: () => v, checkSignedIn: async () => ({ openai: false, antigravity: false }), hunterEvidence: () => HUNTER() });
      assert.strictEqual(out, m, String(v));
    }
  });
  await atest("glue: not the security role, or not below the bar → untouched, nothing checked", async () => {
    const calls = [];
    const deps = { optIn: () => true, checkSignedIn: async () => { calls.push("s"); return {}; }, hunterEvidence: () => { calls.push("l"); return HUNTER(); } };
    const other = dr.mergeLanes("qa-reviewer", collapsed());
    assert.strictEqual(await dr.applyClaudeOnlyFallback("qa-reviewer", collapsed(), other, {}, deps), other);
    const good = plain([L("antigravity", "pass"), L("openai", "pass"), L("claude", "pass")]);
    assert.strictEqual(await dr.applyClaudeOnlyFallback("security-reviewer", [], good, {}, deps), good);
    assert.deepStrictEqual(calls, []);
  });
  await atest("glue POSITIVE: opt-in on + other labs signed out + verified hunter review → accepted, labelled", async () => {
    const out = await dr.applyClaudeOnlyFallback("security-reviewer", collapsed(), plain(collapsed()), {}, {
      optIn: () => true, checkSignedIn: async () => ({ claude: true, openai: false, antigravity: false }), hunterEvidence: () => HUNTER(),
    });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.diversity, "claude-only");
    assert.match(out.verdict_text, /reviewed by Claude only — no second lab$/);
  });
  await atest("glue FALSIFIER: opt-in on but a lab is signed in (lane dead anyway) → held, with the reason", async () => {
    const out = await dr.applyClaudeOnlyFallback("security-reviewer", collapsed(), plain(collapsed()), {}, {
      optIn: () => true, checkSignedIn: async () => ({ claude: true, openai: true, antigravity: false }), hunterEvidence: () => HUNTER(),
    });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.diversity, undefined);
    assert.match(out.claude_only_declined, /openai/);
  });
  await atest("glue FALSIFIER: the sign-in check could not answer → held", async () => {
    const out = await dr.applyClaudeOnlyFallback("security-reviewer", collapsed(), plain(collapsed()), {}, {
      optIn: () => true, checkSignedIn: async () => sc.checkSignedIn({ detect: async () => { throw new Error("offline"); } }), hunterEvidence: () => HUNTER(),
    });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.diversity, undefined);
  });
  await atest("glue FALSIFIER: the hunter evidence is missing or not a pass/warn with its record → held", async () => {
    for (const v of [undefined, HUNTER("error"), HUNTER("fail"), { verdict: "pass", record: null }]) {
      const out = await dr.applyClaudeOnlyFallback("security-reviewer", collapsed(), plain(collapsed()), {}, {
        optIn: () => true, checkSignedIn: async () => ({ openai: false, antigravity: false }), hunterEvidence: () => v,
      });
      assert.strictEqual(out.ok, false, String(v));
    }
  });
  await atest("glue FALSIFIER: the real opt-in reader with an env var only (no manifest key) → untouched", async () => {
    const saved = process.env.MC_SECURITY_CLAUDE_ONLY_FALLBACK;
    process.env.MC_SECURITY_CLAUDE_ONLY_FALLBACK = "1";
    const dirBefore = process.env.CLAUDE_PROJECT_DIR;
    const m0 = tmpManifest({ mc: {} });
    process.env.CLAUDE_PROJECT_DIR = path.dirname(m0.file);
    fs.mkdirSync(path.join(path.dirname(m0.file), ".claude"), { recursive: true });
    fs.copyFileSync(m0.file, path.join(path.dirname(m0.file), ".claude", "manifest.json"));
    try {
      const m = plain(collapsed());
      const out = await dr.applyClaudeOnlyFallback("security-reviewer", collapsed(), m, {}, {
        checkSignedIn: async () => { throw new Error("must not be asked"); }, hunterEvidence: () => HUNTER(),
      });
      assert.strictEqual(out, m);
    } finally {
      if (saved === undefined) delete process.env.MC_SECURITY_CLAUDE_ONLY_FALLBACK;
      else process.env.MC_SECURITY_CLAUDE_ONLY_FALLBACK = saved;
      if (dirBefore === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = dirBefore;
    }
  });
  await atest("glue: the real opt-in reader with the manifest key set → the fallback is considered", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "optin-"));
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "manifest.json"), JSON.stringify({ mc: { securityClaudeOnlyFallback: true } }));
    const dirBefore = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = root;
    try {
      const out = await dr.applyClaudeOnlyFallback("security-reviewer", collapsed(), plain(collapsed()), {}, {
        checkSignedIn: async () => ({ openai: false, antigravity: false }), hunterEvidence: () => HUNTER(),
      });
      assert.strictEqual(out.diversity, "claude-only");
    } finally {
      if (dirBefore === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = dirBefore;
    }
  });

  const dropped = () => [dead("antigravity"), dead("claude")];
  const applyWith = (signedIn) => dr.applyClaudeOnlyFallback("security-reviewer", dropped(), plain(dropped()), {}, {
    optIn: () => true, checkSignedIn: async () => signedIn, hunterEvidence: () => HUNTER(),
  });
  await atest("choice-dropped lab FALSIFIER: openai not in the lanes but signed IN (or unknown, or missing) → held", async () => {
    for (const openai of [true, null, undefined]) {
      const out = await applyWith({ claude: true, antigravity: false, ...(openai === undefined ? {} : { openai }) });
      assert.strictEqual(out.ok, false, `openai=${openai}`);
      assert.strictEqual(out.diversity, undefined);
      assert.match(out.claude_only_declined, /openai/);
    }
  });
  await atest("choice-dropped lab: every non-Claude provider definitively signed out → accepted (positive)", async () => {
    const out = await applyWith({ claude: true, antigravity: false, openai: false });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.diversity, "claude-only");
  });
  await atest("evaluateClaudeOnly: a provider the lanes do not name and the sign-in state omits holds the review", async () => {
    const lanes = [dead("antigravity"), dead("claude")];
    assert.strictEqual(sc.evaluateClaudeOnly(lanes, { optIn: true, signedIn: { antigravity: false }, hunter: HUNTER() }).accept, false);
  });

  await atest("dispatch-review with a manifest that exists but cannot be parsed: exits 1 with project_settings_unreadable, fires nothing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "blocked-"));
    fs.mkdirSync(path.join(root, ".claude", "agents", "_org"), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, "..", "..", ".claude", "agents", "_org", "role-registry.json"), path.join(root, ".claude", "agents", "_org", "role-registry.json"));
    fs.writeFileSync(path.join(root, ".claude", "manifest.json"), "{ truncated");
    fs.writeFileSync(path.join(root, "prompt.txt"), "review this");
    const laneDir = path.join(root, "lanes");
    const r = require("child_process").spawnSync(process.execPath, [path.resolve(__dirname, "..", "dispatch-review.js"), "security-reviewer", path.join(root, "prompt.txt"), "--lane-out", laneDir], {
      encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 60000,
    });
    assert.strictEqual(r.status, 1, `exit ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /project_settings_unreadable/);
    assert.strictEqual(fs.existsSync(laneDir), false, "no lane was fired");
  });

  if (failures.length) {
    process.stderr.write(`FAIL [security-choice.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`OK   [security-choice.test] ${passed} passed\n`);
})();
