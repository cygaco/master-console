"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const signin = require("./signin");

const LEAK_TOKEN = "FAKETOKEN-0123456789abcdef";
const LEAK_EMAIL = "leak.check@example.invalid";
const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const DAY = 86400000;

const AGY_OK =
  "Fetching available models...\n" +
  "gemini-4-argon-high\tGemini 4 Argon (High)\n" +
  "claude-opus-5-5-low\tClaude Opus 5.5 (Low)\r\n" +
  "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n";

function fakes(spec, calls = []) {
  return {
    resolveTool: (id) => {
      if (spec[id] === "missing") return { ok: false, reason: `tool '${id}' not found on PATH` };
      if (id === "codex") return { ok: true, path: process.execPath, kind: "node-entry", entry: "/fake/codex.js", version: "0.169.0", resolution: { reason: "single-candidate", chosen_version: "0.169.0" } };
      return { ok: true, path: `/fake/${id}`, kind: "native" };
    },
    exec: async (s) => {
      calls.push({ id: s.id, args: s.args, timeoutMs: s.timeoutMs });
      const r = spec[s.id];
      if (r instanceof Error) throw r;
      return { exit: null, stdout: "", stderr: "", timedOut: false, ...r };
    },
  };
}

const SIGNED_IN = {
  claude: { exit: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "x@example.invalid", orgName: "Org" }) },
  codex: { exit: 0, stderr: "Logged in using ChatGPT\n" },
  agy: { exit: 0, stdout: AGY_OK },
};

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "signin-"));
const clone = (o) => JSON.parse(JSON.stringify(o));
async function rec(spec, extra = {}) {
  return signin.detect({ ...fakes(spec), now: NOW, ...extra });
}

test("record shape: schema, writer stamp, ts, exactly the kept fields per provider", async () => {
  const r = await rec(SIGNED_IN);
  assert.deepStrictEqual(r, {
    schema: "mc/model-signin/v1",
    writer: { tool: "scripts/dispatch/signin.js", version: 1 },
    ts: "2026-11-17T12:00:00.000Z",
    providers: {
      claude: { signedIn: true, method: "claude.ai", exit: 0 },
      openai: { signedIn: true, method: "codex login status", exit: 0, version: "0.169.0" },
      antigravity: { signedIn: true, method: "agy models", exit: 0, served: ["gemini-4-argon-high", "claude-opus-5-5-low", "gemini-3.8-flash-low"] },
    },
  });
  assert.deepStrictEqual(signin.validateCacheRecord(r, { now: NOW }), { ok: true, reason: null });
});

test("each CLI is asked with its own fixed command, 20 s bound, all three at once", async () => {
  const calls = [];
  let started = 0;
  let maxInFlight = 0;
  let inFlight = 0;
  let release;
  const gate = new Promise((res) => (release = res));
  const f = fakes(SIGNED_IN, calls);
  const exec = async (s) => {
    started++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (started === 3) release();
    await Promise.race([gate, new Promise((res) => setTimeout(res, 2000))]);
    inFlight--;
    return f.exec(s);
  };
  await signin.detect({ resolveTool: f.resolveTool, exec, now: NOW });
  const byId = Object.fromEntries(calls.map((c) => [c.id, c]));
  assert.deepStrictEqual(byId.claude.args, ["auth", "status"]);
  assert.deepStrictEqual(byId.codex.args, ["login", "status"]);
  assert.deepStrictEqual(byId.agy.args, ["models"]);
  for (const c of calls) assert.strictEqual(c.timeoutMs, 20000);
  assert.strictEqual(maxInFlight, 3, "the three checks run in parallel");
});

test("claude: signed in / signed out / missing / timeout / garbage", async () => {
  const cl = async (claude) => (await rec({ ...SIGNED_IN, claude })).providers.claude;
  assert.deepStrictEqual(await cl({ exit: 1, stdout: '{"loggedIn":false,"authMethod":"none"}' }), { signedIn: false, method: "none", exit: 1 });
  assert.deepStrictEqual(await cl("missing"), { signedIn: false, method: "unknown", exit: null });
  assert.deepStrictEqual(await cl({ exit: null, timedOut: true }), { signedIn: null, method: "unknown", exit: null });
  assert.deepStrictEqual(await cl(new Error("boom")), { signedIn: null, method: "unknown", exit: null });
  assert.deepStrictEqual(await cl({ exit: 0, stdout: "<<not json>>" }), { signedIn: null, method: "unknown", exit: 0 });
  assert.deepStrictEqual(await cl({ exit: 7, stdout: "" }), { signedIn: null, method: "unknown", exit: 7 });
  assert.deepStrictEqual(await cl({ exit: 0, stdout: '{"loggedIn":false,"authMethod":"none"}' }), { signedIn: false, method: "none", exit: 0 });
  assert.deepStrictEqual(await cl({ exit: 0, stdout: '{"loggedIn":true,"authMethod":"something-new"}' }), { signedIn: true, method: "unknown", exit: 0 });
  for (const m of ["none", "claude.ai", "oauth_token", "api_key", "api_key_helper", "third_party"]) {
    assert.strictEqual((await cl({ exit: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: m }) })).method, m);
  }
});

test("codex: 'Logged in' on stderr or stdout / signed out / missing / timeout / garbage", async () => {
  const cx = async (codex) => (await rec({ ...SIGNED_IN, codex })).providers.openai;
  assert.deepStrictEqual(await cx({ exit: 0, stdout: "Logged in using an API key\n" }), { signedIn: true, method: "codex login status", exit: 0, version: "0.169.0" });
  assert.deepStrictEqual(await cx({ exit: 1, stderr: "Not logged in\n" }), { signedIn: false, method: "codex login status", exit: 1, version: "0.169.0" });
  assert.deepStrictEqual(await cx("missing"), { signedIn: false, method: "codex login status", exit: null, version: null });
  assert.deepStrictEqual(await cx({ exit: null, timedOut: true }), { signedIn: null, method: "codex login status", exit: null, version: "0.169.0" });
  assert.deepStrictEqual(await cx({ exit: 0, stdout: "garbage\n", stderr: "  Logged in (indented, not a line start)" }), { signedIn: null, method: "codex login status", exit: 0, version: "0.169.0" });
  assert.strictEqual((await cx({ exit: 1, stderr: "Logged in\n" })).signedIn, null, "a non-zero exit is never signed in; without 'Not logged in' it is unknown");
  assert.strictEqual((await cx({ exit: 2, stderr: "error: refused\n" })).signedIn, null, "a refused / failed check is unknown, not signed out");
});

test("agy: served ids / signed out / missing / timeout / garbage / odd id columns refused", async () => {
  const ag = async (agy) => (await rec({ ...SIGNED_IN, agy })).providers.antigravity;
  assert.deepStrictEqual(await ag({ exit: 1, stderr: "please sign in\n" }), { signedIn: null, method: "agy models", exit: 1, served: [] });
  assert.deepStrictEqual(await ag("missing"), { signedIn: false, method: "agy models", exit: null, served: [] });
  assert.deepStrictEqual(await ag({ exit: null, timedOut: true }), { signedIn: null, method: "agy models", exit: null, served: [] });
  assert.deepStrictEqual(await ag({ exit: 0, stdout: "Fetching available models...\nno rows here\n" }), { signedIn: null, method: "agy models", exit: 0, served: [] });
  const odd = await ag({ exit: 0, stdout: `UPPER-CASE\tx\n${LEAK_EMAIL}\ty\nspace id\tz\nok-id\tOK\nok-id\tdup\n` });
  assert.deepStrictEqual(odd.served, ["ok-id"]);
});

async function goodRecord() {
  return rec(SIGNED_IN);
}

test("validateCacheRecord: refuses missing writer stamp, foreign writer, bad schema", async () => {
  const v = (o) => signin.validateCacheRecord(o, { now: NOW }).reason;
  const g = await goodRecord();
  const noWriter = clone(g);
  delete noWriter.writer;
  assert.strictEqual(v(noWriter), "missing-writer-stamp");
  assert.strictEqual(v({ ...clone(g), writer: {} }), "missing-writer-stamp");
  assert.strictEqual(v({ ...clone(g), writer: { tool: "scripts/other.js", version: 1 } }), "foreign-writer");
  assert.strictEqual(v({ ...clone(g), writer: { tool: "scripts/dispatch/signin.js", version: 2 } }), "foreign-writer");
  assert.strictEqual(v({ ...clone(g), schema: "mc/model-signin/v2" }), "bad-schema");
  const forged = { schema: "mc/model-signin/v1", ts: g.ts, providers: { ...clone(g.providers), antigravity: { signedIn: false, method: "agy models", exit: 1, served: [] } } };
  assert.strictEqual(v(forged), "missing-writer-stamp");
});

test("validateCacheRecord: ts — stale, future, unparseable; maxAgeDays honoured", async () => {
  const g = await goodRecord();
  const v = (now, o = {}) => signin.validateCacheRecord(g, { now, ...o });
  assert.strictEqual(v(NOW + 6 * DAY).ok, true);
  assert.strictEqual(v(NOW + 8 * DAY).reason, "stale");
  assert.strictEqual(v(NOW + 2 * DAY, { maxAgeDays: 1 }).reason, "stale");
  assert.strictEqual(v(NOW - 10 * 60000).reason, "ts-in-future");
  assert.strictEqual(v(new Date(NOW + DAY)).ok, true, "now may be a Date");
  assert.strictEqual(v("2026-11-18T12:00:00.000Z").ok, true, "now may be an ISO string");
  assert.strictEqual(signin.validateCacheRecord({ ...clone(g), ts: "yesterday" }, { now: NOW }).reason, "bad-ts");
  assert.strictEqual(signin.validateCacheRecord({ ...clone(g), ts: 1763380800000 }, { now: NOW }).reason, "bad-ts");
});

test("validateCacheRecord: non-boolean signedIn, truncated JSON, BOM text, non-objects", async () => {
  const g = await goodRecord();
  const v = (o) => signin.validateCacheRecord(o, { now: NOW }).reason;
  const nb = clone(g);
  nb.providers.antigravity.signedIn = "true";
  assert.strictEqual(v(nb), "bad-signedIn:antigravity");
  const missingSigned = clone(g);
  delete missingSigned.providers.claude.signedIn;
  assert.strictEqual(v(missingSigned), "bad-signedIn:claude");
  const unknownOk = clone(g);
  unknownOk.providers.openai.signedIn = null;
  unknownOk.providers.openai.exit = null;
  assert.strictEqual(v(unknownOk), null, "null = unknown is a valid answer");
  const text = JSON.stringify(g);
  assert.strictEqual(v(text.slice(0, -12)), "unparseable", "truncated JSON");
  assert.strictEqual(v(""), "unparseable");
  assert.strictEqual(signin.validateCacheRecord("\uFEFF" + text, { now: NOW }).ok, true);
  assert.strictEqual(signin.validateCacheRecord(Buffer.from(text), { now: NOW }).ok, true);
  for (const x of [null, undefined, 42, [], "null", "[]"]) assert.strictEqual(v(x), "not-an-object");
});

test("validateCacheRecord: refuses any field the writer does not write, without echoing it", async () => {
  const g = await goodRecord();
  const v = (o) => signin.validateCacheRecord(o, { now: NOW }).reason;
  const extraClaude = clone(g);
  extraClaude.providers.claude.email = LEAK_EMAIL;
  assert.strictEqual(v(extraClaude), "unexpected-field:providers.claude");
  assert.strictEqual(v({ ...clone(g), [LEAK_TOKEN]: 1 }), "unexpected-field:top");
  const extraProv = clone(g);
  extraProv.providers.gemini = { signedIn: true, method: "x", exit: 0 };
  assert.strictEqual(v(extraProv), "unexpected-field:providers");
  const extraWriter = clone(g);
  extraWriter.writer.host = "x";
  assert.strictEqual(v(extraWriter), "unexpected-field:writer");
});

test("validateCacheRecord: exit / method / version / served / consistency / missing provider", async () => {
  const g = await goodRecord();
  const v = (mut) => {
    const o = clone(g);
    mut(o);
    return signin.validateCacheRecord(o, { now: NOW }).reason;
  };
  assert.strictEqual(v((o) => (o.providers.openai.exit = "0")), "bad-exit:openai");
  assert.strictEqual(v((o) => delete o.providers.openai.exit), "bad-exit:openai");
  assert.strictEqual(v((o) => (o.providers.claude.method = "password")), "bad-method:claude");
  assert.strictEqual(v((o) => (o.providers.antigravity.method = "agy status")), "bad-method:antigravity");
  assert.strictEqual(v((o) => (o.providers.openai.exit = 1)), "inconsistent:openai");
  assert.strictEqual(v((o) => (o.providers.openai.version = "v0.169")), "bad-version:openai");
  assert.strictEqual(v((o) => (o.providers.antigravity.served = ["Not-An-Id"])), "bad-served:antigravity");
  assert.strictEqual(v((o) => (o.providers.antigravity.served = "gemini-4-argon-high")), "bad-served:antigravity");
  assert.strictEqual(v((o) => delete o.providers.openai), "missing-provider:openai");
  assert.strictEqual(v((o) => delete o.providers), "missing-providers");
  assert.strictEqual(v((o) => { delete o.providers.openai.version; delete o.providers.antigravity.served; }), null);
  assert.strictEqual(v((o) => Object.assign(o.providers.openai, { signedIn: false, exit: null })), null);
});

test("validateCacheRecord is pure: same answer twice, input untouched", async () => {
  const g = await goodRecord();
  const before = clone(g);
  const a = signin.validateCacheRecord(g, { now: NOW });
  const b = signin.validateCacheRecord(g, { now: NOW });
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(g, before);
});

test("writeCache: atomic write of a valid record, overwrite, creates the dir, no temp left", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "nested", "model-signin.json");
  const g = await goodRecord();
  const w1 = signin.writeCache(g, { file, now: NOW });
  assert.deepStrictEqual(w1, { ok: true, file });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), g);
  const g2 = clone(g);
  g2.providers.openai = { signedIn: false, method: "codex login status", exit: 1, version: null };
  assert.strictEqual(signin.writeCache(g2, { file, now: NOW }).ok, true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), g2);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ["model-signin.json"], "no temp file left behind");
  assert.strictEqual(signin.validateCacheRecord(fs.readFileSync(file, "utf8"), { now: NOW }).ok, true);
});

test("writeCache: refuses an invalid record and writes nothing", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "model-signin.json");
  const g = await goodRecord();
  const bad = clone(g);
  bad.providers.claude.email = LEAK_EMAIL;
  assert.deepStrictEqual(signin.writeCache(bad, { file, now: NOW }), { ok: false, reason: "refused-invalid-record:unexpected-field:providers.claude" });
  assert.strictEqual(signin.writeCache("{}", { file, now: NOW }).ok, false);
  assert.strictEqual(fs.existsSync(file), false);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

function cli(spec, file, extra = {}) {
  const out = [];
  const err = [];
  const logs = [];
  const calls = [];
  const opts = {
    ...fakes(spec, calls),
    file,
    now: NOW,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    logEvent: (...a) => logs.push(a),
    ...extra,
  };
  return { opts, out, err, logs, calls };
}

test("CLI plain lines: signed in, not signed in, not found; the note line is always there", async () => {
  const dir = tmpDir();
  const a = cli(SIGNED_IN, path.join(dir, "a.json"));
  assert.strictEqual(await signin.main(["--refresh"], a.opts), 0);
  assert.deepStrictEqual(a.out.join("").trim().split("\n"), [
    "Claude: signed in",
    "Codex (OpenAI): signed in",
    "Gemini (agy): signed in — 3 models listed",
    "Checked just now.",
    "Checked with each tool's own status command; the Gemini tool asks Google's service for your model list. This engine calls no AI service itself to check.",
  ]);
  const b = cli({ claude: { exit: 1, stdout: '{"loggedIn":false}' }, codex: { exit: 1, stderr: "Not logged in" }, agy: { exit: 1 } }, path.join(dir, "b.json"));
  await signin.main(["--refresh"], b.opts);
  const bl = b.out.join("");
  assert.match(bl, /^Claude: not signed in or not installed — run `claude auth login` to sign in$/m);
  assert.match(bl, /^Codex \(OpenAI\): not signed in or not installed/m);
  assert.match(bl, /^Gemini \(agy\): could not check .* treated as signed in/m);
  const c = cli({ claude: "missing", codex: "missing", agy: { exit: null, timedOut: true } }, path.join(dir, "c.json"));
  await signin.main(["--refresh"], c.opts);
  const cl = c.out.join("");
  assert.match(cl, /^Claude: not signed in or not installed/m);
  assert.match(cl, /^Codex \(OpenAI\): not signed in or not installed/m);
  assert.match(cl, /^Gemini \(agy\): could not check/m);
  assert.match(cl, /This engine calls no AI service itself to check\.$/m);
});

test("CLI: no cache -> checks and saves; valid cache -> shows it with its age, no CLI run; --refresh re-checks", async () => {
  const file = path.join(tmpDir(), "m.json");
  const first = cli(SIGNED_IN, file);
  assert.strictEqual(await signin.main([], first.opts), 0);
  assert.strictEqual(first.calls.length, 3);
  assert.ok(fs.existsSync(file));

  const second = cli(SIGNED_IN, file, { now: NOW + 3 * 3600000 });
  assert.strictEqual(await signin.main([], second.opts), 0);
  assert.strictEqual(second.calls.length, 0, "the saved result is shown without running any CLI");
  assert.match(second.out.join(""), /^Last checked 3 hours ago\. Run with --refresh to check again\.$/m);

  const j = cli(SIGNED_IN, file, { now: NOW + 3 * 3600000 });
  await signin.main(["--json"], j.opts);
  const parsed = JSON.parse(j.out.join(""));
  assert.strictEqual(parsed.source, "saved");
  assert.strictEqual(parsed.age_seconds, 3 * 3600);
  assert.deepStrictEqual(Object.keys(parsed.record.providers.claude), ["signedIn"]);
  assert.strictEqual(parsed.record.providers.openai.signedIn, true);

  const third = cli(SIGNED_IN, file);
  await signin.main(["--refresh"], third.opts);
  assert.strictEqual(third.calls.length, 3);
});

test("CLI: a stale or broken saved result is checked again and the reason is said", async () => {
  const file = path.join(tmpDir(), "m.json");
  await signin.main(["--refresh"], cli(SIGNED_IN, file).opts);
  const later = cli(SIGNED_IN, file, { now: NOW + 8 * DAY });
  await signin.main([], later.opts);
  assert.strictEqual(later.calls.length, 3);
  assert.match(later.out.join(""), /^The saved result could not be used \(the record is older than 7 days.*\), so it was checked again\.$/m);
  fs.writeFileSync(file, '{"schema":"mc/model-signin/v1","prov');
  const broken = cli(SIGNED_IN, file);
  await signin.main([], broken.opts);
  assert.match(broken.out.join(""), /could not be used \(the sign-in record is not valid JSON/);
  assert.strictEqual(signin.validateCacheRecord(fs.readFileSync(file, "utf8"), { now: NOW }).ok, true, "rewritten");
});

test("CLI: unknown argument -> 2; save failure -> 1 with a plain message", async () => {
  const u = cli(SIGNED_IN, path.join(tmpDir(), "m.json"));
  assert.strictEqual(await signin.main(["--bogus"], u.opts), 2);
  assert.strictEqual(u.calls.length, 0);
  const dir = tmpDir();
  const blocker = path.join(dir, "not-a-dir");
  fs.writeFileSync(blocker, "x");
  const f = cli(SIGNED_IN, path.join(blocker, "m.json"));
  assert.strictEqual(await signin.main(["--refresh"], f.opts), 1);
  assert.match(f.err.join(""), /^Could not save the result \(write-failed:[A-Z]+\)\.$/m);
});

const LEAKY_IN = {
  claude: {
    exit: 0,
    stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: LEAK_EMAIL, orgId: LEAK_TOKEN, orgName: LEAK_EMAIL, token: LEAK_TOKEN }),
    stderr: `debug ${LEAK_TOKEN} ${LEAK_EMAIL}\n`,
  },
  codex: { exit: 0, stdout: `account ${LEAK_EMAIL}\n`, stderr: `Logged in using ChatGPT (${LEAK_EMAIL}) ${LEAK_TOKEN}\n` },
  agy: { exit: 0, stdout: `Account: ${LEAK_EMAIL} token=${LEAK_TOKEN}\ngemini-4-argon-high\t${LEAK_TOKEN}\n${LEAK_EMAIL}\tGemini\n`, stderr: `${LEAK_TOKEN}\n` },
};
const LEAKY_OUT = {
  claude: { exit: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: LEAK_TOKEN, email: LEAK_EMAIL }), stderr: LEAK_TOKEN },
  codex: { exit: 1, stdout: LEAK_EMAIL, stderr: `Not logged in ${LEAK_TOKEN}` },
  agy: { exit: 1, stdout: `${LEAK_EMAIL}\t${LEAK_TOKEN}\n`, stderr: LEAK_EMAIL },
};

function assertClean(label, text) {
  assert.ok(!text.includes(LEAK_TOKEN), `${label}: planted secret leaked`);
  assert.ok(!text.includes(LEAK_EMAIL), `${label}: planted email leaked`);
}

for (const [variant, spec] of [["signed-in", LEAKY_IN], ["signed-out", LEAKY_OUT]]) {
  test(`LEAK (${variant}): planted secret + email reach no cache, CLI output (both modes), logger or record`, async () => {
    const file = path.join(tmpDir(), "model-signin.json");
    const caught = [];
    const saved = { o: process.stdout.write, e: process.stderr.write, log: console.log, error: console.error, warn: console.warn };
    process.stdout.write = function (chunk, ...rest) {
      caught.push(String(chunk));
      return saved.o.call(process.stdout, chunk, ...rest);
    };
    process.stderr.write = function (chunk, ...rest) {
      caught.push(String(chunk));
      return saved.e.call(process.stderr, chunk, ...rest);
    };
    console.log = console.error = console.warn = (...a) => caught.push(a.join(" "));
    const runs = [];
    try {
      for (const argv of [["--refresh"], ["--refresh", "--json"], [], ["--json"]]) {
        const c = cli(spec, file);
        const code = await signin.main(argv, c.opts);
        runs.push({ argv, code, c });
      }
    } finally {
      process.stdout.write = saved.o;
      process.stderr.write = saved.e;
      console.log = saved.log;
      console.error = saved.error;
      console.warn = saved.warn;
    }
    assert.ok(fs.existsSync(file), "cache written");
    const cacheText = fs.readFileSync(file, "utf8");
    assert.strictEqual(signin.validateCacheRecord(cacheText, { now: NOW }).ok, true, "cache validates");
    assertClean("cache", cacheText);
    for (const { argv, code, c } of runs) {
      assert.strictEqual(code, 0, `exit code for ${argv.join(" ") || "(display)"}`);
      assertClean(`stdout ${argv.join(" ")}`, c.out.join(""));
      assertClean(`stderr ${argv.join(" ")}`, c.err.join(""));
      assertClean(`logger ${argv.join(" ")}`, JSON.stringify(c.logs));
      for (const call of c.logs) {
        assert.match(call[4], /^claude=(true|false) openai=(true|false) antigravity=(true|false)$/);
        assert.ok(Object.values(call[5]).every((x) => typeof x === "boolean"), "logged meta is booleans only");
      }
    }
    assert.strictEqual(runs[0].c.logs.length, 1, "a check logs exactly one line");
    assert.strictEqual(runs[2].c.logs.length, 0, "showing the saved result logs nothing");
    assertClean("process streams", caught.join(""));
    const record = await signin.detect({ ...fakes(spec), now: NOW });
    assertClean("detect() record", JSON.stringify(record));
    if (variant === "signed-in") assert.deepStrictEqual(record.providers.antigravity.served, ["gemini-4-argon-high"]);
  });
}

test("runBounded: exit code + both streams captured, stdin closed (no hang)", async () => {
  const script = "process.stdin.on('data',()=>{});process.stdin.on('end',()=>{process.stdout.write('eof');process.stderr.write('err');process.exit(3)});";
  const r = await signin._runBounded(process.execPath, ["-e", script], { timeoutMs: 10000 });
  assert.deepStrictEqual(r, { exit: 3, stdout: "eof", stderr: "err", timedOut: false, spawnError: false });
});

test("runBounded: a command that does not answer is cut off at the bound and reports no exit", async () => {
  const t0 = Date.now();
  const r = await signin._runBounded(process.execPath, ["-e", "process.stdout.write('partial');setTimeout(()=>{},30000)"], { timeoutMs: 400 });
  assert.strictEqual(r.timedOut, true);
  assert.strictEqual(r.exit, null);
  assert.strictEqual(r.stdout, "", "partial output from a timed-out command is dropped");
  assert.ok(Date.now() - t0 < 10000, "returned near the bound");
});

test("runBounded: a missing binary is a spawn error with no exit", async () => {
  const r = await signin._runBounded(path.join(os.tmpdir(), "no-such-signin-binary-xyz"), [], { timeoutMs: 5000 });
  assert.strictEqual(r.spawnError, true);
  assert.strictEqual(r.exit, null);
});

test("invocationFor mirrors safe-spawn's launch shapes", () => {
  assert.deepStrictEqual(signin._invocationFor({ kind: "node-entry", entry: "/pkg/bin/codex.js" }, ["login", "status"]), { bin: process.execPath, args: ["/pkg/bin/codex.js", "login", "status"] });
  assert.deepStrictEqual(signin._invocationFor({ kind: "native", path: "/bin/agy" }, ["models"]), { bin: "/bin/agy", args: ["models"] });
  if (process.platform === "win32") {
    const inv = signin._invocationFor({ kind: "cmd-shim", path: "C:\\tools\\claude.cmd" }, ["auth", "status"]);
    assert.match(inv.bin, /System32[\\/]cmd\.exe$/i);
    assert.deepStrictEqual(inv.args, ["/c", "C:\\tools\\claude.cmd", "auth", "status"]);
  }
});

test("wiring: /mc:health and the installer run the sign-in refresh", () => {
  const root = path.resolve(__dirname, "..", "..");
  const health = fs.readFileSync(path.join(root, ".claude", "commands", "mc", "health.md"), "utf8");
  assert.match(health, /node scripts\/dispatch\/signin\.js --refresh/);
  assert.match(health, /contacts its own service/);
  const setup = fs.readFileSync(path.join(root, "scripts", "mc-setup.js"), "utf8");
  assert.match(setup, /"dispatch", "signin\.js"/);
  assert.match(setup, /\[signinScript, "--refresh"\]/);
  assert.match(setup, /const signinScript = path\.join\(MC, "scripts", "dispatch", "signin\.js"\)/);
  assert.doesNotMatch(setup, /path\.join\(TARGET, "scripts", "dispatch", "signin\.js"\)/);
  assert.match(setup, /CLAUDE_PROJECT_DIR: TARGET/);
  const skill = fs.readFileSync(path.join(root, ".claude", "commands", "mc", "setup.md"), "utf8");
  assert.match(skill, /node scripts\/dispatch\/signin\.js --refresh/);
});
